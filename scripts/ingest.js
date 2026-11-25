#!/usr/bin/env node
'use strict';
// Reads the first N lines of a wordlist, SHA-1 hashes each password and RPUSHes the
// hash suffix into the Redigo list for its prefix. Plaintext is never stored or logged.
// Afterwards it reads every list back and compares it with what it sent, then writes
// the prawns:meta key that the server uses to decide it is ready.
//
// Lines are counted as they appear in the file. A line is skipped (but still counts toward
// the limit) if it is empty or is not valid UTF-8, because a browser hashes UTF-8 text and
// could never match a hash of other bytes. Skip counts are reported.
const fs = require('fs');
const crypto = require('crypto');
const { RespClient } = require('../src/lib/resp');
const { sha1Hex, split, listKey, META_KEY, DEFAULT_PREFIX_LEN } = require('../src/lib/hash');

function parseArgs(argv) {
  const o = { limit: 1000000, prefixLen: DEFAULT_PREFIX_LEN, host: '127.0.0.1', port: 6379, batch: 200, stats: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--file') o.file = v();
    else if (a === '--limit') o.limit = Number(v());
    else if (a === '--prefix-len') o.prefixLen = Number(v());
    else if (a === '--host') o.host = v();
    else if (a === '--port') o.port = Number(v());
    else if (a === '--batch') o.batch = Number(v());
    else if (a === '--stats') o.stats = v();
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.file) throw new Error('usage: ingest.js --file rockyou.txt [--limit 1000000] [--prefix-len 4] [--host H] [--port P] [--batch 200] [--stats out.json]');
  return o;
}

const decoder = new TextDecoder('utf-8', { fatal: true });

// Yields raw line buffers (without the line break) from a file, streaming.
async function* lines(file) {
  let tail = Buffer.alloc(0);
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 20 })) {
    let buf = tail.length ? Buffer.concat([tail, chunk]) : chunk;
    let start = 0;
    let nl;
    while ((nl = buf.indexOf(0x0a, start)) !== -1) {
      yield buf.subarray(start, nl);
      start = nl + 1;
    }
    tail = buf.subarray(start);
  }
  if (tail.length) yield tail;
}

async function main() {
  const o = parseArgs(process.argv);
  const t0 = Date.now();
  const client = await new RespClient({ host: o.host, port: o.port, timeoutMs: 30000 }).connect();
  await client.command('PING');

  // Fail closed on partial loads. Redigo has no DEL, so a store that has ever been marked
  // cannot be cleaned: restart Redigo (it is empty on start) and ingest into the fresh process.
  if (await client.command('GET', META_KEY)) {
    console.error('store already has a prawns:meta marker (loaded or half-loaded). Restart Redigo and ingest again.');
    process.exit(2);
  }
  // Written before any data, so a crash mid-load leaves the store not ready.
  await client.command('SET', META_KEY, JSON.stringify({ status: 'loading', startedAt: new Date().toISOString() }));

  const expected = new Map(); // prefix -> array of suffixes in push order
  const st = { linesRead: 0, emptyLines: 0, invalidUtf8Lines: 0, hashed: 0, duplicateHashes: 0 };
  const seen = new Set();
  let pending = [];

  const flush = async () => {
    if (!pending.length) return;
    const replies = await client.pipeline(pending.map(([p, s]) => ['RPUSH', listKey(p), s]));
    replies.forEach((r) => { if (r instanceof Error) throw r; });
    pending = [];
  };

  for await (let raw of lines(o.file)) {
    if (st.linesRead >= o.limit) break;
    st.linesRead++;
    if (raw.length && raw[raw.length - 1] === 0x0d) raw = raw.subarray(0, raw.length - 1);
    if (raw.length === 0) { st.emptyLines++; continue; }
    try { decoder.decode(raw); } catch { st.invalidUtf8Lines++; continue; }
    const h = sha1Hex(raw);
    if (seen.has(h)) st.duplicateHashes++; else seen.add(h);
    const { prefix, suffix } = split(h, o.prefixLen);
    let arr = expected.get(prefix);
    if (!arr) expected.set(prefix, (arr = []));
    arr.push(suffix);
    st.hashed++;
    pending.push([prefix, suffix]);
    if (pending.length >= o.batch) await flush();
  }
  await flush();
  const tLoad = Date.now();

  // Readback: every list must come back identical to what was sent.
  let mismatches = 0;
  let largest = 0;
  const prefixes = [...expected.keys()];
  for (let i = 0; i < prefixes.length; i += 100) {
    const group = prefixes.slice(i, i + 100);
    const replies = await client.pipeline(group.map((p) => ['LRANGE', listKey(p), 0, -1]));
    group.forEach((p, j) => {
      const got = replies[j];
      const want = expected.get(p);
      if (got instanceof Error || !Array.isArray(got) || got.length !== want.length || got.some((x, k) => x !== want[k])) mismatches++;
      largest = Math.max(largest, want.length);
    });
  }
  const tRead = Date.now();

  const sizes = prefixes.map((p) => expected.get(p).length).sort((a, b) => a - b);
  const report = {
    ...st,
    prefixLen: o.prefixLen,
    lists: prefixes.length,
    smallestList: sizes[0] || 0,
    medianList: sizes[sizes.length >> 1] || 0,
    largestList: largest,
    singletonLists: sizes.filter((n) => n === 1).length,
    readbackMismatches: mismatches,
    loadMs: tLoad - t0,
    readbackMs: tRead - tLoad,
    expectedDigest: crypto.createHash('sha256').update(prefixes.sort().map((p) => `${p}:${expected.get(p).join(',')}`).join('\n')).digest('hex'),
  };
  if (o.stats) fs.writeFileSync(o.stats, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  if (mismatches !== 0 || st.hashed === 0) {
    console.error('readback failed; not marking the store ready');
    process.exitCode = 1;
  } else {
    const meta = { status: 'ready', version: 1, prefixLen: o.prefixLen, entries: st.hashed, lists: prefixes.length, loadedAt: new Date().toISOString() };
    await client.command('SET', META_KEY, JSON.stringify(meta));
    console.log('ready marker written');
  }
  client.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
