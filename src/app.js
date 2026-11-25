'use strict';
const express = require('express');
const { isValidPrefix, listKey, META_KEY } = require('./lib/hash');

// store: object with command(...args). Passed in so tests can fake it.
function createApp({ store, rateLimitPerMin = 120 }) {
  const app = express();
  app.disable('x-powered-by');

  const hits = new Map();
  app.use((req, res, next) => {
    const now = Date.now();
    const key = req.ip;
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

  // k-anonymity range lookup: the client sends only the hash prefix.
  app.get('/api/range/:prefix', async (req, res) => {
    try {
      const meta = await readMeta();
      if (!meta) return res.status(503).json({ error: 'not_ready' });
      if (!isValidPrefix(req.params.prefix, meta.prefixLen)) {
        return res.status(400).json({ error: 'bad_prefix', prefixLen: meta.prefixLen });
      }
      const suffixes = await store.command('LRANGE', listKey(req.params.prefix), 0, -1);
      res.set('Cache-Control', 'no-store');
      res.json({ prefix: req.params.prefix.toUpperCase(), suffixes: suffixes || [] });
    } catch {
      res.status(503).json({ error: 'store_unavailable' });
    }
  });

  app.use((req, res) => res.status(404).json({ error: 'not_found' }));
  return app;
}

module.exports = { createApp };
