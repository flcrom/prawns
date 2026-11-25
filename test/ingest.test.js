'use strict';
// Runs only when REDIGO_BIN points at a built Redigo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { startRedigo } = require('./helpers');
const { RespClient } = require('../src/lib/resp');
const { sha1Hex, split, listKey } = require('../src/lib/hash');
const { createApp } = require('../src/app');

test('ingest: first N lines, skips empty and non-UTF-8, readback, API answers', { skip: !process.env.REDIGO_BIN }, async () => {
  const redigo = await startRedigo();
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prawns-'));
    const f = path.join(dir, 'words.txt');
    const parts = [Buffer.from('password\r\n123456\n\n'), Buffer.from([0xff, 0xfe, 0x0a]), Buffer.from('héllo\nlast\nbeyondlimit\n')];
    fs.writeFileSync(f, Buffer.concat(parts));
    // lines: password, 123456, "", invalid, héllo, last  -> limit 6 excludes "beyondlimit"
    const out = execFileSync('node', ['scripts/ingest.js', '--file', f, '--limit', '6', '--prefix-len', '3', '--batch', '2'], { encoding: 'utf8' });
    const rep = JSON.parse(out.slice(0, out.lastIndexOf('}') + 1));
    assert.strictEqual(rep.linesRead, 6);
    assert.strictEqual(rep.emptyLines, 1);
    assert.strictEqual(rep.invalidUtf8Lines, 1);
    assert.strictEqual(rep.hashed, 4);
    assert.strictEqual(rep.readbackMismatches, 0);

    const c = await new RespClient().connect();
    const { prefix, suffix } = split(sha1Hex('héllo'), 3);
    assert.ok((await c.command('LRANGE', listKey(prefix), 0, -1)).includes(suffix));
    const { prefix: np } = split(sha1Hex('beyondlimit'), 3);
    const lr = await c.command('LRANGE', listKey(np), 0, -1);
    assert.ok(!lr.includes(split(sha1Hex('beyondlimit'), 3).suffix));

    const app = createApp({ store: c });
    const s = app.listen(0, '127.0.0.1'); await new Promise((r) => s.once('listening', r));
    const j = await (await fetch(`http://127.0.0.1:${s.address().port}/api/range/${split(sha1Hex('password'), 3).prefix}`)).json();
    s.close(); c.close();
    assert.ok(j.suffixes.includes(split(sha1Hex('password'), 3).suffix));
  } finally { redigo && redigo.kill(); }
});
