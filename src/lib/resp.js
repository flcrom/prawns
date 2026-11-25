'use strict';
// Minimal RESP2 client for Redigo. Supports pipelining, per-command timeouts and
// the reply types Redigo produces: simple string, error, integer, bulk, null, array.
const net = require('net');

function encode(args) {
  const parts = [`*${args.length}\r\n`];
  for (const a of args) {
    const b = Buffer.isBuffer(a) ? a : Buffer.from(String(a), 'utf8');
    parts.push(`$${b.length}\r\n`, b, '\r\n');
  }
  return Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
}

// Returns [value, nextOffset] or null if the buffer does not hold a full reply yet.
function parse(buf, off) {
  if (off >= buf.length) return null;
  const type = String.fromCharCode(buf[off]);
  const eol = buf.indexOf('\r\n', off, 'latin1');
  if (eol === -1) return null;
  const line = buf.toString('utf8', off + 1, eol);
  const next = eol + 2;
  switch (type) {
    case '+': return [line, next];
    case '-': return [new Error(line), next];
    case ':': return [Number(line), next];
    case '$': {
      const len = Number(line);
      if (len === -1) return [null, next];
      if (buf.length < next + len + 2) return null;
      return [buf.toString('utf8', next, next + len), next + len + 2];
    }
    case '_': return [null, next];
    case '*': {
      const n = Number(line);
      if (n === -1) return [null, next];
      const out = [];
      let pos = next;
      for (let i = 0; i < n; i++) {
        const r = parse(buf, pos);
        if (!r) return null;
        out.push(r[0]);
        pos = r[1];
      }
      return [out, pos];
    }
    default:
      throw new Error(`unexpected RESP type byte ${JSON.stringify(type)}`);
  }
}

class RespClient {
  constructor({ host = '127.0.0.1', port = 6379, timeoutMs = 5000 } = {}) {
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.sock = null;
    this.buf = Buffer.alloc(0);
    this.queue = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: this.host, port: this.port });
      sock.setNoDelay(true);
      const onErr = (e) => reject(e);
      sock.once('error', onErr);
      sock.once('connect', () => {
        sock.off('error', onErr);
        this.sock = sock;
        sock.on('data', (d) => this._onData(d));
        sock.on('error', (e) => this._fail(e));
        sock.on('close', () => this._fail(new Error('connection closed')));
        resolve(this);
      });
    });
  }

  _fail(err) {
    this.sock = null;
    const q = this.queue;
    this.queue = [];
    for (const p of q) { clearTimeout(p.timer); p.reject(err); }
  }

  _onData(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    let off = 0;
    while (this.queue.length) {
      const r = parse(this.buf, off);
      if (!r) break;
      off = r[1];
      const p = this.queue.shift();
      clearTimeout(p.timer);
      if (r[0] instanceof Error) p.reject(r[0]); else p.resolve(r[0]);
    }
    this.buf = off ? this.buf.subarray(off) : this.buf;
  }

  _send(args) {
    return new Promise((resolve, reject) => {
      if (!this.sock) return reject(new Error('not connected'));
      const p = { resolve, reject, timer: null };
      p.timer = setTimeout(() => {
        // A timed-out reply would desync the stream, so drop the connection.
        const err = new Error(`timeout after ${this.timeoutMs}ms: ${args[0]}`);
        if (this.sock) this.sock.destroy();
        this._fail(err);
      }, this.timeoutMs);
      this.queue.push(p);
      this.sock.write(encode(args));
    });
  }

  // Reconnects on demand, so a Redigo restart does not need a Prawns restart.
  async command(...args) {
    if (!this.sock) await this.connect();
    return this._send(args);
  }

  // Sends many commands in one write and resolves with every reply, in order.
  // Errors come back as Error objects in the array instead of rejecting.
  pipeline(commands) {
    return Promise.all(commands.map((c) => this._send(c).catch((e) => e)));
  }

  close() { if (this.sock) this.sock.end(); }
}

module.exports = { RespClient, encode, parse };
