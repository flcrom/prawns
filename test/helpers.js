'use strict';
const { spawn } = require('child_process');
const net = require('net');

// Starts an unmodified Redigo build (REDIGO_BIN). Redigo binds 0.0.0.0:6379 and has no
// port setting, so only one test process can use it at a time.
async function startRedigo() {
  const bin = process.env.REDIGO_BIN;
  if (!bin) return null;
  const proc = spawn(bin, [], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    const ok = await new Promise((r) => {
      const s = net.createConnection({ port: 6379, host: '127.0.0.1' }, () => { s.destroy(); r(true); });
      s.on('error', () => r(false));
    });
    if (ok) return proc;
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error('redigo did not start');
}
module.exports = { startRedigo };
