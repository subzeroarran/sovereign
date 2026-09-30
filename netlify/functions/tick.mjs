// Netlify scheduled function: keeps the world moving while nobody has the game open.
import { getStore } from '@netlify/blobs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { makeCore } from '../../server/core.mjs';
import engine from '../../server/engine.mjs';

export default async () => {
  const s = getStore({ name: 'sovereign', consistency: 'strong' });
  const store = {
    async getJSONE(k) { const r = await s.getWithMetadata(k, { type: 'json' }); return r ? { data: r.data, etag: r.etag } : null; },
    async getBytesE(k) { const r = await s.getWithMetadata(k, { type: 'arrayBuffer' }); return r && r.data ? { data: new Uint8Array(r.data), etag: r.etag } : null; },
    async set(k, v, cond) { if (v instanceof Uint8Array) v = new Blob([v]); return s.set(k, v, cond || {}); },
    async del(k) { await s.delete(k); },
  };
  const r = await makeCore(store).tick(engine, { gz: str => gzipSync(Buffer.from(str)), gunz: b => gunzipSync(Buffer.from(b)).toString(), budgetMs: 16000 });
  console.log('tick', JSON.stringify(r));
};

// every 30 minutes (Netlify runs scheduled functions for up to 30 seconds)
export const config = { schedule: '*/30 * * * *' };
