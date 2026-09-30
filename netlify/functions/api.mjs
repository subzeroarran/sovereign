// Netlify function: every /api/* request lands here.
import { getStore } from '@netlify/blobs';
import { makeCore } from '../../server/core.mjs';

function blobStore() {
  const s = getStore({ name: 'sovereign', consistency: 'strong' });
  return {
    async getJSONE(k) { const r = await s.getWithMetadata(k, { type: 'json' }); return r ? { data: r.data, etag: r.etag } : null; },
    async getBytesE(k) { const r = await s.getWithMetadata(k, { type: 'arrayBuffer' }); return r && r.data ? { data: new Uint8Array(r.data), etag: r.etag } : null; },
    async set(k, v, cond) { if (v instanceof Uint8Array) v = new Blob([v]); return s.set(k, v, cond || {}); },
    async del(k) { await s.delete(k); },
  };
}

export default async (request) => {
  const url = new URL(request.url);
  const headers = {}; request.headers.forEach((v, k) => headers[k.toLowerCase()] = v);
  const req = { method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers };
  if (request.method === 'PUT') req.bodyBytes = new Uint8Array(await request.arrayBuffer());
  else if (request.method === 'POST') req.body = await request.text();
  const res = await makeCore(blobStore()).handle(req);
  return new Response(res.body, { status: res.status, headers: res.headers });
};

export const config = { path: '/api/*' };
