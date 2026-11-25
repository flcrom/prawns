'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { sha1Hex, split, isValidPrefix } = require('../src/lib/hash');
const { parse, encode } = require('../src/lib/resp');
const { createApp } = require('../src/app');

test('sha1 is uppercase and matches the known vector', () => {
  assert.strictEqual(sha1Hex('password'), '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
});
test('split and prefix validation', () => {
  assert.deepStrictEqual(split('5BAA61E4', 4), { prefix: '5BAA', suffix: '61E4' });
  assert.ok(isValidPrefix('5baa', 4));
  assert.ok(!isValidPrefix('5BA', 4));
  assert.ok(!isValidPrefix('5BAZ', 4));
  assert.ok(!isValidPrefix('../..', 4));
});
test('resp encode/parse', () => {
  assert.strictEqual(encode(['GET', 'k']).toString(), '*2\r\n$3\r\nGET\r\n$1\r\nk\r\n');
  assert.deepStrictEqual(parse(Buffer.from('*2\r\n$2\r\nab\r\n$1\r\nc\r\n'), 0)[0], ['ab', 'c']);
  assert.strictEqual(parse(Buffer.from('*2\r\n$2\r\nab\r\n$1\r\n'), 0), null);
  assert.strictEqual(parse(Buffer.from('$-1\r\n'), 0)[0], null);
});

async function call(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
  const body = await res.json();
  server.close();
  return { status: res.status, body };
}
const fake = (data) => ({ command: async (c, k) => (c === 'GET' ? data[k] || null : data[k] || []) });

test('api: 503 before load, 400 on bad prefix, suffixes when ready, raw-password route gone', async () => {
  assert.strictEqual((await call(createApp({ store: fake({}) }), '/healthz')).status, 503);
  const meta = JSON.stringify({ status: 'ready', prefixLen: 4, entries: 2 });
  const app = createApp({ store: fake({ 'prawns:meta': meta, 'p:5BAA': ['AA', 'BB'] }) });
  assert.strictEqual((await call(app, '/api/range/zz')).status, 400);
  assert.deepStrictEqual((await call(app, '/api/range/5baa')).body, { prefix: '5BAA', suffixes: ['AA', 'BB'] });
  assert.strictEqual((await call(app, '/api/range/0000')).body.suffixes.length, 0);
  assert.strictEqual((await call(app, '/checkPass')).status, 404);
});
test('api: a half-loaded store (status loading) is not ready', async () => {
  const app = createApp({ store: fake({ 'prawns:meta': JSON.stringify({ status: 'loading' }), 'p:5BAA': ['AA'] }) });
  assert.strictEqual((await call(app, '/healthz')).status, 503);
  assert.strictEqual((await call(app, '/api/range/5BAA')).status, 503);
});
test('api: rate limit', async () => {
  const app = createApp({ store: fake({}), rateLimitPerMin: 2 });
  const s = app.listen(0, '127.0.0.1'); await new Promise((r) => s.once('listening', r));
  const u = `http://127.0.0.1:${s.address().port}/healthz`;
  const codes = []; for (let i = 0; i < 3; i++) codes.push((await fetch(u)).status);
  s.close();
  assert.strictEqual(codes[2], 429);
});
