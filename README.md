# Prawns

A password breach checker with k-anonymity lookups. The browser hashes a password with SHA-1 and sends only the first few hex characters of the hash. Prawns returns the list of matching hash suffixes and the browser checks for its own suffix locally. The password and the full hash never leave the browser.

Storage is [Redigo](https://github.com/flcrom/redigo-server), unmodified. Prawns uses `PING`, `GET`, `SET`, `RPUSH` and `LRANGE`.

## How data is stored

One Redigo list per hash prefix: key `p:<PREFIX>` (uppercase hex), one element per hash suffix. The `prawns:meta` key is written last, after every list has been read back and compared. `/healthz` and `/api/range` answer 503 until that key exists. Redigo has no persistence, so a Redigo restart means the store is empty and Prawns reports not ready until you ingest again.

## Ingest

```
node scripts/ingest.js --file rockyou.txt --limit 1000000 --prefix-len 4
```

Reads the first `--limit` lines of the file, SHA-1 hashes each password and RPUSHes the suffix into its prefix list, then reads every list back. Plaintext is never stored or logged. A line counts toward the limit even if it is skipped. Two kinds of line are skipped, for different reasons. Empty lines are skipped as a policy choice: a browser could hash an empty string, but a breach checker has no use for an empty password. Lines that are not valid UTF-8 are skipped for encoding compatibility: a browser hashes UTF-8 text, so it cannot produce the hash of those raw bytes. Counts of both are in the report. It exits non-zero and does not write the ready marker if any list fails the readback.

Hashes of common passwords are easy to reverse. Keep wordlists and Redigo off public networks.

## Run

```
cp .env.example .env
npm install
npm start
```

`GET /api/range/:prefix` returns `{ "prefix": "5BAA", "suffixes": ["61E4...", ...] }`. `GET /healthz` returns readiness. The old raw-password endpoint is gone.

## Frontend

`public/` is the website, served by the same Express app. It hashes the typed password with SHA-1 in the browser (`crypto.subtle`), sends only the first 4 hex characters to `/api/range`, and compares the returned suffixes locally. The page shows that pipeline as it runs: the typed password, the hash with the prefix marked, the prefix on the wire to the server, and the returned suffixes with the caller's own highlighted and the rest struck out. Light by default with a dark toggle. Inter and JetBrains Mono are bundled under their OFL licenses.

Prawns binds to 127.0.0.1 by default. Redigo itself listens on 0.0.0.0:6379 and has no setting for that, so restrict port 6379 at the firewall. Behind a reverse proxy or tunnel, every request may look like one client to the rate limiter.

## Test

```
npm test                                   # unit tests
REDIGO_BIN=/path/to/redigo npm test        # adds the ingest test against a real Redigo (needs port 6379 free)
node scripts/loadcheck.js --file words.txt --prefix-len 4   # concurrent lookups against a running API
```

