'use strict';
require('dotenv').config();
const { createApp } = require('./app');
const { RespClient } = require('./lib/resp');

async function main() {
  const store = await new RespClient({
    host: process.env.REDIGO_HOST || '127.0.0.1',
    port: Number(process.env.REDIGO_PORT || 6379),
  }).connect();
  const port = Number(process.env.PORT || 3000);
  // Bind to loopback by default; a tunnel on the same machine reaches it.
  createApp({ store, rateLimitPerMin: Number(process.env.RATE_LIMIT_PER_MIN || 120) }).listen(port, process.env.HOST || '127.0.0.1', () => console.log(`prawns listening on ${port}`));
}
main().catch((e) => { console.error(e.message); process.exit(1); });
