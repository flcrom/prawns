'use strict';
const { spawn } = require('child_process');
const path = require('path');
const express = require('express');
const { isValidPrefix, listKey, META_KEY } = require('./lib/hash');

// store: object with command(...args). Passed in so tests can fake it.
function createApp({ store, rateLimitPerMin = 120 }) {
  const app = express();
  app.disable('x-powered-by');

  // The app is fully self-hosted; nothing may load or beacon to third parties.
  // Blocks edge-injected analytics (e.g. Cloudflare RUM) without zone changes.
  const CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  app.use((req, res, next) => { res.set('Content-Security-Policy', CSP); next(); });

  const hits = new Map();
  // Only API lookups count against the budget: static assets must not 429 the page.
  // Client key: CF-Connecting-IP is set/overwritten by the Cloudflare edge, and the
  // origin listens on loopback so the only inbound path is cloudflared itself; a
  // client-supplied value never survives the edge. Fall back to the socket address
  // for direct local callers (watchdog probes, tests).
  app.use('/api', (req, res, next) => {
    const now = Date.now();
    const key = req.get('cf-connecting-ip') || req.ip;
    const rec = hits.get(key) || { n: 0, reset: now + 60000 };
    if (now > rec.reset) { rec.n = 0; rec.reset = now + 60000; }
    rec.n++;
    hits.set(key, rec);
    if (rec.n > rateLimitPerMin) return res.status(429).json({ error: 'rate_limited' });
    next();
  });

  async function readMeta() {
    const raw = await store.command('GET', META_KEY);
    if (!raw) return null;
    const meta = JSON.parse(raw);
    // Only a fully verified load counts. 'loading' means a load started and has not finished.
    return meta.status === 'ready' ? meta : null;
  }

  app.get('/healthz', async (req, res) => {
    try {
      const meta = await readMeta();
      if (!meta) return res.status(503).json({ ready: false, reason: 'not loaded' });
      res.json({ ready: true, prefixLen: meta.prefixLen, entries: meta.entries });
    } catch {
      res.status(503).json({ ready: false, reason: 'store unavailable' });
    }
  });


// Android lookup notification (deployment feature): surfaces each range lookup's
// k-anonymity prefix. Only the prefix the client sent is shown - the API never
// sees passwords or full hashes. --id replaces the previous notification so a
// burst of lookups updates one notice instead of flooding the shade.
function notifyLookup(prefix) {
  try {
    const child = spawn('termux-notification', ['--id', 'prawns-lookup', '--title', 'Prawns lookup', '--content', 'hash prefix ' + prefix.toUpperCase()], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', () => {});
    if (child.stdout) child.stdout.resume();
    if (child.stderr) child.stderr.resume();
    child.unref();
  } catch { /* notification is best-effort */ }
}

  // k-anonymity range lookup: the client sends only the hash prefix.
  app.get('/api/range/:prefix', async (req, res) => {
    try {
      const meta = await readMeta();
      if (!meta) return res.status(503).json({ error: 'not_ready' });
      if (!isValidPrefix(req.params.prefix, meta.prefixLen)) {
        return res.status(400).json({ error: 'bad_prefix', prefixLen: meta.prefixLen });
      }
      notifyLookup(req.params.prefix);
      const suffixes = await store.command('LRANGE', listKey(req.params.prefix), 0, -1);
      res.set('Cache-Control', 'no-store');
      res.json({ prefix: req.params.prefix.toUpperCase(), suffixes: suffixes || [] });
    } catch {
      res.status(503).json({ error: 'store_unavailable' });
    }
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use((req, res) => res.status(404).json({ error: 'not_found' }));
  return app;
}

module.exports = { createApp };
