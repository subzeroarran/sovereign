// SOVEREIGN online — the server side. The same code runs on Netlify (with Netlify Blobs as storage)
// and in the local test server (with an in-memory store).
//
// Storage keys
//   config        players, PIN hashes, invite code, secret
//   world         the latest full snapshot (gzip bytes)          worldmeta  {day, t0, dayMs, epoch, seq, exact, savedAt}
//   lease         which player's browser is running the world now {slot, epoch, until}
//   stream        messages from the running browser to the others {epoch, msgs:[{s, ...}]}
//   up:N          messages from player N to the running browser   {n, msgs:[{s, ...}]}
//   seen:N        when player N last checked in
import { createHash, createHmac, randomBytes } from 'node:crypto';

export const LEASE_MS = 90000;        // a running browser must check in at least this often (hidden tabs tick about once a minute)
export const STREAM_KEEP = 400;
export const UP_KEEP = 120;
export const MAX_PLAYERS = 16;

const now = () => Date.now();
const sha = s => createHash('sha256').update(s).digest('hex');
const json = (status, obj) => ({ status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(obj) });
const err = (status, msg) => json(status, { error: msg });
const pinHash = (c, pin) => sha('pin:' + c.secret + ':' + pin);
export const DEFAULT_ADMIN_KEY = 'bananas';
const adminHash = (c, key) => sha('adm:' + c.secret + ':' + key);
const live = c => c.players.filter(p => !p.removed);
// an exact snapshot and its details are stored together in one blob, so they can never get out of step
function pack(meta, bytes) { const m = Buffer.from(JSON.stringify(meta)); const out = new Uint8Array(4 + m.length + bytes.length); new DataView(out.buffer).setUint32(0, m.length); out.set(m, 4); out.set(bytes, 4 + m.length); return out; }
function unpack(buf) { const n = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0); return { meta: JSON.parse(Buffer.from(buf.subarray(4, 4 + n)).toString()), bytes: buf.subarray(4 + n) }; }

export function makeCore(store, opts = {}) {
  const LEASE = opts.leaseMs || LEASE_MS;
  const getJ = async k => { const r = await store.getJSONE(k); return r ? r.data : null; };

  async function cfg() { return getJ('config'); }
  function tokenFor(c, slot) { return createHmac('sha256', c.secret).update('slot:' + slot + ':' + c.players[slot].pin).digest('hex').slice(0, 40); }
  async function auth(req) {
    const c = await cfg(); if (!c) return null;
    const t = req.headers['x-sov-token'] || ''; const slot = +(req.headers['x-sov-slot'] ?? -1);
    if (!(slot >= 0) || !c.players[slot] || c.players[slot].removed || t !== tokenFor(c, slot)) return null;
    return { c, slot };
  }
  async function leaseNow() { const r = await store.getJSONE('lease'); const l = r && r.data; return { l: l && l.until > now() ? l : null, raw: l, etag: r && r.etag }; }
  async function seenAll(c) { const out = {}; for (let i = 0; i < c.players.length; i++) { if (c.players[i].removed) continue; const r = await getJ('seen:' + i); out[i] = r ? r.t : 0; } return out; }
  async function wipe(c) { const n = Math.max(MAX_PLAYERS, c ? c.players.length : 0); for (let i = 0; i < n; i++) { await store.del('up:' + i); await store.del('seen:' + i); await store.del('fail:' + i); } }
  async function touch(slot) { await store.set('seen:' + slot, JSON.stringify({ t: now() })); }

  const routes = {
    // what a visitor needs to see before logging in
    'GET info': async () => {
      const c = await cfg(); const meta = await getJ('worldmeta'); const { l } = await leaseNow();
      return json(200, { world: !!(c && meta), meta, now: now(), lease: l ? { slot: l.slot, epoch: l.epoch, until: l.until } : null, invite: !!(c && c.invite),
        players: c ? c.players.map((p, i) => ({ slot: i, name: p.name, country: p.country, removed: p.removed ? 1 : undefined })) : [], seen: c ? await seenAll(c) : {}, max: MAX_PLAYERS });
    },
    // the first player creates the world (the browser builds it and uploads the snapshot)
    'POST create': async req => {
      const b = JSON.parse(req.body || '{}'); const existing = await cfg();
      if (existing) return err(409, 'A world already exists here.');
      if (!b.name || !b.pin || String(b.pin).length < 4 || b.country == null || !b.snap) return err(400, 'Name, a PIN of at least 4 characters, a country and the world are required.');
      const c = { created: now(), secret: randomBytes(24).toString('hex'), invite: b.invite ? sha('inv:' + String(b.invite).trim().toLowerCase()) : null, players: [] };
      c.players.push({ name: String(b.name).slice(0, 24), pin: pinHash(c, b.pin), country: +b.country });
      const r = await store.set('config', JSON.stringify(c), { onlyIfNew: true }); if (r && r.modified === false) return err(409, 'A world already exists here.');
      await store.set('world', Buffer.from(b.snap, 'base64'));
      await store.set('worldmeta', JSON.stringify({ day: b.day || 0, t0: b.t0 || now(), dayMs: b.dayMs || 15000, epoch: 0, seq: -1, exact: false, savedAt: now() }));
      return json(200, { slot: 0, token: tokenFor(c, 0) });
    },
    // another player takes a free country
    'POST join': async req => {
      const b = JSON.parse(req.body || '{}'); const r0 = await store.getJSONE('config'); const c = r0 && r0.data;
      if (!c) return err(404, 'No world yet.');
      if (c.invite && sha('inv:' + String(b.invite || '').trim().toLowerCase()) !== c.invite) return err(403, 'That invite code is not right.');
      if (!b.name || !b.pin || String(b.pin).length < 4 || b.country == null) return err(400, 'Name, a PIN of at least 4 characters and a country are required.');
      if (live(c).length >= MAX_PLAYERS) return err(409, 'This world is full.');
      if (live(c).some(p => p.country === +b.country)) return err(409, 'Someone already leads that country.');
      if (live(c).some(p => p.name.toLowerCase() === String(b.name).toLowerCase())) return err(409, 'That name is taken.');
      c.players.push({ name: String(b.name).slice(0, 24), pin: pinHash(c, b.pin), country: +b.country });
      const w = await store.set('config', JSON.stringify(c), { onlyIfMatch: r0.etag }); if (w && w.modified === false) return err(409, 'Someone joined at the same moment. Try again.');
      const slot = c.players.length - 1; return json(200, { slot, token: tokenFor(c, slot) });
    },
    'POST login': async req => {
      const b = JSON.parse(req.body || '{}'); const c = await cfg(); if (!c) return err(404, 'No world yet.');
      const fk = 'fail:' + (+b.slot), f = (await getJ(fk)) || { n: 0, t: 0 };
      if (f.n >= 5 && now() - f.t < 5 * 60e3) return err(429, 'Too many wrong PINs. Wait 5 minutes and try again.');
      const p = c.players[+b.slot]; if (!p || p.removed || p.pin !== pinHash(c, b.pin)) { await store.set(fk, JSON.stringify({ n: now() - f.t < 5 * 60e3 ? f.n + 1 : 1, t: now() })); return err(403, 'Wrong PIN.'); }
      if (f.n) await store.set(fk, JSON.stringify({ n: 0, t: 0 }));
      return json(200, { slot: +b.slot, token: tokenFor(c, +b.slot) });
    },
    // take, renew or give up the right to run the world
    'POST lease': async req => {
      const a = await auth(req); if (!a) return err(401, 'Please log in again.');
      const b = JSON.parse(req.body || '{}'); const r = await store.getJSONE('lease'); const cur = r && r.data;
      const live = cur && cur.until > now();
      if (b.release) { if (cur && cur.slot === a.slot && cur.epoch === b.epoch) await store.set('lease', JSON.stringify({ ...cur, until: 0 }), r ? { onlyIfMatch: r.etag } : {}); return json(200, { ok: true }); }
      if (live && cur.slot !== a.slot) return json(200, { ok: false, lease: cur });
      const epoch = live && cur.slot === a.slot && b.epoch === cur.epoch ? cur.epoch : ((cur && cur.epoch) || 0) + 1;
      const next = { slot: a.slot, epoch, until: now() + LEASE };
      const w = await store.set('lease', JSON.stringify(next), r ? { onlyIfMatch: r.etag } : { onlyIfNew: true });
      if (w && w.modified === false) { const again = await getJ('lease'); return json(200, { ok: false, lease: again }); }
      if (epoch !== (cur && cur.epoch)) { await store.set('stream', JSON.stringify({ epoch, msgs: [] })); }
      await touch(a.slot);
      const ups = {}; for (let i = 0; i < a.c.players.length; i++) { if (a.c.players[i].removed) continue; const u = await getJ('up:' + i); ups[i] = u ? u.n : 0; }
      return json(200, { ok: true, lease: next, upN: ups });
    },
    'GET world': async req => {
      const a = await auth(req); if (!a) return err(401, 'Please log in again.');
      const ex = req.query && req.query.exact;
      let meta, bytes;
      if (ex) { const r = await store.getBytesE('snap'); if (!r) return err(404, 'No world stored.'); ({ meta, bytes } = unpack(r.data)); }
      else { meta = await getJ('worldmeta'); const r = await store.getBytesE('world'); if (!r) return err(404, 'No world stored.'); bytes = r.data; }
      return { status: 200, headers: { 'content-type': 'application/octet-stream', 'x-sov-meta': JSON.stringify(meta), 'cache-control': 'no-store' }, body: bytes };
    },
    // the running browser stores a snapshot
    'PUT world': async req => {
      const a = await auth(req); if (!a) return err(401, 'Please log in again.');
      const { l } = await leaseNow(); const meta = JSON.parse(req.headers['x-sov-meta'] || '{}');
      if (!l || l.slot !== a.slot || l.epoch !== meta.epoch) return err(409, 'You are not running the world right now.');
      const old = await getJ('worldmeta');
      const m = JSON.stringify({ day: meta.day, t0: meta.t0, dayMs: meta.dayMs || (old && old.dayMs) || 15000, paused: !!meta.paused, epoch: meta.epoch, seq: meta.seq, exact: !!meta.exact, savedAt: now() });
      await store.set('world', req.bodyBytes); await store.set('worldmeta', m);
      if (meta.exact) await store.set('snap', pack(JSON.parse(m), req.bodyBytes));
      return json(200, { ok: true });
    },
    // the message relay. The running browser sends world updates and reads players' actions; the others do the reverse.
    'POST sync': async req => {
      const a = await auth(req); if (!a) return err(401, 'Please log in again.');
      const b = JSON.parse(req.body || '{}'); await touch(a.slot);
      const lr = await store.getJSONE('lease'); const l = lr && lr.data; const live = l && l.until > now();
      if (b.role === 'host') {
        if (!live || l.slot !== a.slot || l.epoch !== b.epoch) return json(200, { lost: true, lease: live ? l : null });
        const next = { ...l, until: now() + LEASE }; const lw = await store.set('lease', JSON.stringify(next), { onlyIfMatch: lr.etag });
        if (lw && lw.modified === false) return json(200, { lost: true, lease: await getJ('lease') });
        if (b.send && b.send.length) {
          const sr = await store.getJSONE('stream'); const st = (sr && sr.data) || { epoch: b.epoch, msgs: [] };
          if (st.epoch > b.epoch) return json(200, { lost: true, lease: await getJ('lease') });   // a newer host owns the stream
          if (st.epoch !== b.epoch) { st.epoch = b.epoch; st.msgs = []; }
          st.msgs.push(...b.send); if (st.msgs.length > STREAM_KEEP) st.msgs.splice(0, st.msgs.length - STREAM_KEEP);
          const sw = await store.set('stream', JSON.stringify(st), sr ? { onlyIfMatch: sr.etag } : { onlyIfNew: true });
          if (sw && sw.modified === false) return json(200, { lost: true, lease: await getJ('lease') });
        }
        const up = {}; const since = b.upSince || {};
        for (let i = 0; i < a.c.players.length; i++) { if (i === a.slot || a.c.players[i].removed) continue; const u = await getJ('up:' + i); if (!u) continue; const s = since[i] || 0; const m = u.msgs.filter(x => x.s > s); if (m.length) up[i] = m; }
        return json(200, { lease: next, up, seen: await seenAll(a.c), now: now() });
      }
      // a player who is not running the world
      if (b.send && b.send.length) {
        const k = 'up:' + a.slot; const u = (await getJ(k)) || { n: 0, msgs: [] };
        for (const m of b.send) u.msgs.push({ ...m, s: ++u.n }); if (u.msgs.length > UP_KEEP) u.msgs.splice(0, u.msgs.length - UP_KEEP);
        await store.set(k, JSON.stringify(u));
      }
      const st = await getJ('stream'); let msgs = [], gap = false, epoch = st ? st.epoch : 0;
      if (st && st.epoch === b.epoch) { const since = b.since ?? -1; msgs = st.msgs.filter(x => x.s > since); if (st.msgs.length && st.msgs[0].s > since + 1 && since >= 0) gap = true; }
      return json(200, { lease: live ? l : null, epoch, msgs, gap, seen: await seenAll(a.c), now: now() });
    },
    // start over (only the player who created the world)
    'POST reset': async req => {
      const a = await auth(req); if (!a || a.slot !== 0) return err(403, 'Only the player who created this world can reset it.');
      for (const k of ['config', 'world', 'worldmeta', 'snap', 'lease', 'stream', 'afail']) await store.del(k);
      await wipe(a.c);
      return json(200, { ok: true });
    },
    // world management, unlocked by the admin key (default "bananas"). Works without logging in, so a locked-out admin can still fix things.
    'POST admin': async req => {
      const b = JSON.parse(req.body || '{}'); const r0 = await store.getJSONE('config'); const c = r0 && r0.data;
      if (!c) return err(404, 'No world yet.');
      const f = (await getJ('afail')) || { n: 0, t: 0 };
      if (f.n >= 5 && now() - f.t < 5 * 60e3) return err(429, 'Too many wrong admin keys. Wait 5 minutes and try again.');
      const good = c.admin ? c.admin === adminHash(c, String(b.key || '')) : String(b.key || '') === DEFAULT_ADMIN_KEY;
      if (!good) { await store.set('afail', JSON.stringify({ n: now() - f.t < 5 * 60e3 ? f.n + 1 : 1, t: now() })); return err(403, 'Wrong admin key.'); }
      if (f.n) await store.set('afail', JSON.stringify({ n: 0, t: 0 }));
      const save = async () => { const w = await store.set('config', JSON.stringify(c), { onlyIfMatch: r0.etag }); if (w && w.modified === false) throw Object.assign(new Error('busy'), { busy: 1 }); };
      const slot = +b.slot, p = c.players[slot];
      const needP = () => { if (!p || p.removed) throw Object.assign(new Error('That player does not exist.'), { user: 1 }); };
      try {
        switch (b.action) {
          case 'check': break;
          case 'setkey': {
            const k = String(b.newKey || ''); if (k.length < 4) return err(400, 'The new admin key needs at least 4 characters.');
            c.admin = adminHash(c, k); await save(); break;
          }
          case 'remove': {
            needP(); c.players[slot] = { name: p.name, country: p.country, pin: '', removed: now() }; await save();
            for (const k of ['up:', 'seen:', 'fail:']) await store.del(k + slot);
            const lr = await store.getJSONE('lease'); if (lr && lr.data && lr.data.slot === slot) await store.set('lease', JSON.stringify({ ...lr.data, until: 0 }), { onlyIfMatch: lr.etag });
            break;
          }
          case 'resetpin': { needP(); if (String(b.pin || '').length < 4) return err(400, 'The new PIN needs at least 4 characters.'); p.pin = pinHash(c, String(b.pin)); await save(); await store.del('fail:' + slot); break; }
          case 'rename': {
            needP(); const n = String(b.name || '').trim().slice(0, 24); if (!n) return err(400, 'Enter a name.');
            if (live(c).some((q, i) => q !== p && q.name.toLowerCase() === n.toLowerCase())) return err(409, 'That name is taken.');
            p.name = n; await save(); break;
          }
          case 'invite': { const v = String(b.invite || '').trim(); c.invite = v ? sha('inv:' + v.toLowerCase()) : null; await save(); break; }
          case 'release': { const lr = await store.getJSONE('lease'); if (lr && lr.data) await store.set('lease', JSON.stringify({ ...lr.data, until: 0 }), { onlyIfMatch: lr.etag }); break; }
          case 'reset': { for (const k of ['config', 'world', 'worldmeta', 'snap', 'lease', 'stream', 'afail']) await store.del(k); await wipe(c); return json(200, { ok: true, reset: true }); }
          default: return err(400, 'Unknown admin action.');
        }
      } catch (e) { if (e.user) return err(400, e.message); if (e.busy) return err(409, 'Someone changed the world settings at the same moment. Try again.'); throw e; }
      const { l } = await leaseNow(); const meta = await getJ('worldmeta');
      return json(200, { ok: true, defaultKey: !c.admin, invite: !!c.invite, meta, lease: l, seen: await seenAll(c), now: now(),
        players: c.players.map((q, i) => ({ slot: i, name: q.name, country: q.country, removed: q.removed || undefined })) });
    },
  };

  async function handle(req) {
    const key = req.method + ' ' + req.path.replace(/^\/?(api\/)?/, '').replace(/\/$/, '');
    const f = routes[key]; if (!f) return err(404, 'Unknown request');
    try { return await f(req); } catch (e) { console.error(e); return err(500, 'Server error: ' + (e && e.message)); }
  }

  // Advance the world while nobody has it open. `eng` is the headless engine; `gz`/`gunz` compress bytes.
  async function tick(eng, { gz, gunz, budgetMs = 20000, maxBehind = 3000 } = {}) {
    const t0 = now();
    const { l } = await leaseNow(); if (l) return { skipped: 'a player is running the world' };
    const meta = await getJ('worldmeta'); if (!meta) return { skipped: 'no world' };
    if (meta.paused) return { skipped: 'the world is paused' };
    const dayMs = meta.dayMs || 15000;
    let target = Math.floor((now() - meta.t0) / dayMs);
    if (target <= meta.day) return { skipped: 'up to date', day: meta.day };
    let t0w = meta.t0;
    if (target - meta.day > maxBehind) { t0w = now() - (meta.day + maxBehind) * dayMs; target = meta.day + maxBehind; }   // the world slept; don't try to replay years
    const wr = await store.getBytesE('world'); if (!wr) return { skipped: 'no world stored' };
    eng.snapLoad(gunz(wr.data));
    let n = 0; while (eng.day() < target && now() - t0 < budgetMs) { eng.stepDay(); eng.applyDefaults(); n++; }
    if ((await leaseNow()).l) return { skipped: 'a player started running the world meanwhile', stepped: n };
    // write only if no player has stored a newer copy meanwhile
    const w = await store.set('world', gz(eng.snapEncode()), { onlyIfMatch: wr.etag });
    if (w && w.modified === false) return { skipped: 'a player saved the world meanwhile', stepped: n };
    await store.set('worldmeta', JSON.stringify({ ...meta, day: eng.day(), t0: t0w, seq: -1, exact: false, savedAt: now(), by: 'server' }));
    return { stepped: n, day: eng.day(), target, ms: now() - t0 };
  }
  return { handle, tick };
}
