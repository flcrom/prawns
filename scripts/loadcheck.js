#!/usr/bin/env node
'use strict';
// Hits a running Prawns API with concurrent range lookups and checks answers against
// a known wordlist sample. Usage: loadcheck.js --file words.txt --prefix-len 4 [--url http://127.0.0.1:3000] [--n 3000] [--conc 16]
const fs = require('fs');
const { sha1Hex, split } = require('../src/lib/hash');
const a = process.argv.slice(2);
const arg = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
const file = arg('--file'); const pl = Number(arg('--prefix-len', 4)); const url = arg('--url', 'http://127.0.0.1:3000');
const n = Number(arg('--n', 3000)); const conc = Number(arg('--conc', 16));
const words = fs.readFileSync(file, 'utf8').split('\n').slice(0, 1000000);
let idx = 0, bad = 0, done = 0;
async function worker() {
  while (idx < n) {
    const i = idx++;
    const hit = i % 2 === 0; // alternate known words and words that are not in the list
    const w = hit ? words[(i * 997) % words.length] : `not-in-list-${i}`;
    const { prefix, suffix } = split(sha1Hex(w), pl);
    const r = await (await fetch(`${url}/api/range/${prefix}`)).json();
    if (r.suffixes.includes(suffix) !== hit) bad++;
    done++;
  }
}
const t = Date.now();
Promise.all(Array.from({ length: conc }, worker)).then(() => {
  const ms = Date.now() - t;
  console.log(JSON.stringify({ requests: done, concurrency: conc, wrongAnswers: bad, ms, reqPerSec: Math.round(done / (ms / 1000)) }));
  process.exit(bad ? 1 : 0);
});
