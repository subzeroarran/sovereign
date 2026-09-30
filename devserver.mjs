// Local stand-in for Netlify: serves the game and the same /api, with storage in memory (or a folder).
// Run: node devserver.mjs [port]      Then open http://localhost:8888
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { makeCore } from './server/core.mjs';
import engine from './server/engine.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const port = +(process.argv[2] || 8888);
const mem = new Map(); let etagN = 1;
const store = {
  async getJSONE(k) { const e = mem.get(k); return e ? { data: JSON.parse(Buffer.from(e.v).toString()), etag: e.etag } : null; },
  async getBytesE(k) { const e = mem.get(k); return e ? { data: new Uint8Array(e.v), etag: e.etag } : null; },
  async set(k, v, cond = {}) {
    const e = mem.get(k);
    if (cond.onlyIfNew && e) return { modified: false };
    if (cond.onlyIfMatch && (!e || e.etag !== cond.onlyIfMatch)) return { modified: false };
    const etag = 'e' + (etagN++); mem.set(k, { v: typeof v === 'string' ? Buffer.from(v) : Buffer.from(v), etag }); return { modified: true, etag };
  },
  async del(k) { mem.delete(k); },
};
const core = makeCore(store, { leaseMs: +(process.env.LEASE_MS || 0) || undefined });
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/') || url.pathname === '/__tick') {
    const chunks = []; for await (const c of req) chunks.push(c); const buf = Buffer.concat(chunks);
    if (url.pathname === '/__tick') { const r = await core.tick(engine, { gz: s => gzipSync(Buffer.from(s)), gunz: b => gunzipSync(Buffer.from(b)).toString() }); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(r)); return; }
    const headers = {}; for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = v;
    const r = await core.handle({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers, body: buf.toString(), bodyBytes: new Uint8Array(buf) });
    res.writeHead(r.status, r.headers); res.end(r.body instanceof Uint8Array ? Buffer.from(r.body) : r.body); return;
  }
  const f = path.join(here, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!f.startsWith(here) || !fs.existsSync(f)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
server.listen(port, () => console.log('SOVEREIGN test server on http://localhost:' + port));
