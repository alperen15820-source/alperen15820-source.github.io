// Çok kullanıcılı sunucuyu gerçek SQLite (D1 yerine) + sahte YouTube + sahte APNs ile
// 36 saat boyunca çalıştırır: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker, { tick } from '../src/index.js';

let now = Date.UTC(2026, 9, 20, 3, 0); // 06:00 İstanbul
const realNow = Date.now;
Date.now = () => now;

// --- D1 uyumlu küçük katman ---
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
class Stmt {
  constructor(sql, params = []) { this.sql = sql; this.params = params; }
  bind(...p) { return new Stmt(this.sql, p); }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.params) }; }
  async first() { return sqlite.prepare(this.sql).get(...this.params) ?? null; }
  async run() { sqlite.prepare(this.sql).run(...this.params); return { success: true }; }
}
const DB = {
  prepare: (sql) => new Stmt(sql),
  async batch(list) {
    sqlite.exec('BEGIN');
    try { for (const s of list) sqlite.prepare(s.sql).run(...s.params); sqlite.exec('COMMIT'); } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  },
};

// --- APNs için gerçek P-256 anahtar ---
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`;
const env = { DB, YT_API_KEY: 'x', APNS_KEY: pem, APNS_KEY_ID: 'ABC123DEFG', APNS_TEAM_ID: 'TEAM123456', APNS_TOPIC: 'com.test.app', MAX_CHANNELS_PER_USER: '5', MAX_TOTAL_CHANNELS: '300' };

// --- sahte YouTube ---
// X: 990'dan 1000'i geçen kanal, 200. turda video sıçraması. Y: iki kullanıcının ortak kanalı.
let run = 0;
const calls = { channels: 0, playlistItems: 0, videos: 0, forHandle: 0 };
const pushes = [];
const CH = {
  UCxxxxxxxxxxxxxxxxxxxxxx: () => ({ title: 'Kanal X', subs: run < 200 ? 990 + Math.floor(run / 20) : 1003, vids: run >= 150 ? ['xNEW', 'x1'] : ['x1'] }),
  UCyyyyyyyyyyyyyyyyyyyyyy: () => ({ title: 'Kanal Y', subs: 5000 + run, vids: ['y1'] }),
};
const views = (vid) => (vid === 'x1' ? 5000 + run * 10 + (run >= 200 ? (Math.min(run, 206) - 199) * 400 : 0) : vid === 'y1' ? 90000 + run * 30 : 100);
const b64d = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

globalThis.fetch = async (input, opts = {}) => {
  const u = new URL(input);
  const ok = (b, status = 200) => new Response(JSON.stringify(b), { status });
  if (u.hostname.endsWith('push.apple.com')) {
    const [h, p, sig] = opts.headers.authorization.slice(7).split('.');
    assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, b64d(sig), new TextEncoder().encode(`${h}.${p}`)), 'JWT imzası');
    const token = u.pathname.split('/').pop();
    if (token.startsWith('dead')) return ok({ reason: 'Unregistered' }, 410);
    if (u.hostname.startsWith('api.sandbox') && token.startsWith('bbbb')) return ok({ reason: 'BadDeviceToken' }, 400);
    pushes.push({ run, host: u.hostname, token, ...JSON.parse(opts.body) });
    return ok({});
  }
  const ep = u.pathname.split('/').pop();
  if (ep === 'channels') {
    const handle = u.searchParams.get('forHandle');
    if (handle) {
      calls.forHandle++;
      const map = { '@kanalx': 'UCxxxxxxxxxxxxxxxxxxxxxx', '@kanaly': 'UCyyyyyyyyyyyyyyyyyyyyyy' };
      if (!map[handle]) return ok({ items: [] });
      u.searchParams.set('id', map[handle]);
    } else calls.channels++;
    const items = u.searchParams.get('id').split(',').filter((id) => CH[id]).map((id) => {
      const c = CH[id]();
      return { id, snippet: { title: c.title, customUrl: '@' + c.title.toLowerCase().replace(' ', ''), thumbnails: {} }, statistics: { subscriberCount: String(c.subs), viewCount: String(100000 + run * 50), videoCount: '3' }, contentDetails: { relatedPlaylists: { uploads: 'UU' + id.slice(2) } } };
    });
    return ok({ items });
  }
  if (ep === 'playlistItems') {
    calls.playlistItems++;
    const id = 'UC' + u.searchParams.get('playlistId').slice(2);
    return ok({ items: CH[id]().vids.map((v) => ({ contentDetails: { videoId: v } })) });
  }
  if (ep === 'videos') {
    calls.videos++;
    return ok({ items: u.searchParams.get('id').split(',').map((id) => ({ id, snippet: { title: `Video ${id}`, publishedAt: new Date(id === 'xNEW' ? now - 36e5 : now - 30 * 864e5).toISOString(), liveBroadcastContent: 'none', thumbnails: {} }, statistics: { viewCount: String(views(id)), likeCount: '1', commentCount: '0' }, contentDetails: { duration: 'PT4M5S' } })) });
  }
  throw new Error(`beklenmeyen istek ${input}`);
};

const pending = [];
const ctx = { waitUntil: (p) => pending.push(p) };
async function call(method, path, body, token, headers = {}) {
  const res = await worker.fetch(new Request(`https://w.test${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'cf-connecting-ip': '1.2.3.4', ...headers }, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  await Promise.all(pending.splice(0));
  return { status: res.status, body: await res.json() };
}

// --- Kayıt ve yetki ---
assert.equal((await call('GET', '/v1/state', null, 'f'.repeat(64))).status, 401);
const A = (await call('POST', '/v1/register', { locale: 'tr-TR', timezone: 'Europe/Istanbul' })).body.token;
const B = (await call('POST', '/v1/register', { locale: 'en-US', timezone: 'America/New_York' })).body.token;
assert.match(A, /^[0-9a-f]{64}$/);
for (let i = 0; i < 8; i++) assert.equal((await call('POST', '/v1/register', { locale: 'en' })).status, 200);
assert.equal((await call('POST', '/v1/register', { locale: 'tr' })).status, 429, 'IP başına kayıt sınırı');

// --- Cihazlar ---
assert.equal((await call('POST', '/v1/devices', { token: 'a'.repeat(64), env: 'sandbox' }, A)).status, 200);
await call('POST', '/v1/devices', { token: 'b'.repeat(64), env: 'sandbox' }, A); // aslında production
await call('POST', '/v1/devices', { token: 'dead'.padEnd(64, 'c'), env: 'sandbox' }, A);
await call('POST', '/v1/devices', { token: 'e'.repeat(64), env: 'production' }, B);

// --- Kanallar ---
let r = await call('PUT', '/v1/config', { channels: ['@kanalx', '@yok'] }, A);
assert.equal(r.status, 400);
assert.match(r.body.error, /Kanal bulunamadı: @yok/);
r = await call('PUT', '/v1/config', { channels: ['@yok'] }, B);
assert.match(r.body.error, /Channel not found/);
r = await call('PUT', '/v1/config', { channels: ['1', '2', '3', '4', '5', '6'] }, A);
assert.match(r.body.error, /En fazla 5/);

r = await call('PUT', '/v1/config', { channels: ['https://youtube.com/@KanalX', '@kanaly'], morningFallbackHour: 11 }, A);
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.deepEqual(r.body.channels, ['https://youtube.com/@KanalX', '@kanaly']);
r = await call('PUT', '/v1/config', { channels: ['UCyyyyyyyyyyyyyyyyyyyyyy'], alerts: { videoMinViewsPerHour: 100000 } }, B);
assert.equal(r.status, 200);
assert.equal(r.body.alerts.videoMinViewsPerHour, 100000);

let st = (await call('GET', '/v1/state', null, A)).body;
assert.deepEqual(Object.keys(st.channels).sort(), ['UCxxxxxxxxxxxxxxxxxxxxxx', 'UCyyyyyyyyyyyyyyyyyyyyyy'], 'yeni kanallar hemen yoklanmalı');
assert.equal(st.channels.UCxxxxxxxxxxxxxxxxxxxxxx.subs, 990);
assert.equal(st.devices, 3);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM channels').get().n, 2, 'ortak kanal bir kez saklanmalı');

// --- 36 saatlik simülasyon ---
const before = { ...calls };
for (run = 1; run <= 215; run++) {
  now += 600e3;
  await tick(env, now);
  if (run === 120) assert.equal((await call('POST', '/v1/summary/ack', null, A)).status, 200);
}
const perDay = (k) => ((calls[k] - before[k]) / 215) * 144;
console.log(`Günlük YouTube çağrısı (2 kanal): channels ${perDay('channels').toFixed(0)}, playlistItems ${perDay('playlistItems').toFixed(0)}, videos ${perDay('videos').toFixed(0)}`);
assert.ok(perDay('playlistItems') <= 2 * 48 + 2, 'playlistItems 30 dakikada bir olmalı');

const of = (tok) => pushes.filter((p) => p.token === tok).map((p) => `${p.run}:${p.type}`);
const a = of('a'.repeat(64));
const b = of('e'.repeat(64));
console.log('A (tr):', a.join(', '));
console.log('B (en):', b.join(', '));
for (const type of ['milestone', 'spike_video', 'new_video', 'morning']) assert.ok(a.some((x) => x.endsWith(':' + type)), `A ${type}`);
assert.ok(!a.some((x) => x.endsWith(':spike_channel')), 'video sıçraması kanal sıçraması olarak tekrar edilmemeli');
assert.equal(a.filter((x) => x.endsWith(':morning')).length, 1, 'ack yapılan gün yedek özet gitmemeli');
assert.ok(!b.some((x) => /spike_video|milestone|new_video/.test(x)), "B'nin kanalında bu olaylar yok / eşik yüksek");
assert.ok(!b.some((x) => x.endsWith(':morning')), 'B yedek özeti açmadı');

const ms = pushes.find((p) => p.type === 'milestone');
assert.equal(ms.milestone, 1000);
assert.match(ms.aps.alert.title, /1000 ABONE/);
assert.equal(ms.aps['interruption-level'], 'time-sensitive');
assert.ok(pushes.some((p) => p.token.startsWith('bbbb') && p.host === 'api.push.apple.com'), 'yanlış ortam düzeltilmeli');
const devs = sqlite.prepare('SELECT token, env FROM devices ORDER BY token').all();
assert.ok(!devs.some((d) => d.token.startsWith('dead')), 'ölü cihaz silinmeli');
assert.equal(devs.find((d) => d.token.startsWith('bbbb')).env, 'production');

// İngilizce test bildirimi
assert.equal((await call('POST', '/v1/test', null, B)).status, 200);
assert.match(pushes.at(-1).aps.alert.title, /Test notification/);

st = (await call('GET', '/v1/state', null, A)).body;
const X = st.channels.UCxxxxxxxxxxxxxxxxxxxxxx;
assert.equal(X.subs, 1003);
assert.deepEqual(X.celebrated, [100, 250, 500, 1000]);
assert.ok(X.videos.x1.lastAlert > 0, 'sıçrama rozeti');
assert.ok(st.events.some((e) => e.type === 'milestone' && e.channel === 'Kanal X'));
assert.equal(st.config.morningFallbackHour, 11);
console.log(`Kanal geçmiş noktası: ${X.hist.length}, state boyutu: ${(JSON.stringify(st).length / 1024).toFixed(1)} KB`);

const sum = (await call('GET', '/v1/summary', null, B)).body;
assert.match(sum.title, /Good morning/);
assert.equal(sum.channels.length, 1);
console.log('Özet (en):', sum.title);

// Hesap silme: B silinince ortak kanal kalmalı, A silinince kanallar da gitmeli
assert.equal((await call('DELETE', '/v1/me', null, B)).status, 200);
assert.equal((await call('GET', '/v1/state', null, B)).status, 401);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM channels').get().n, 2);
await call('DELETE', '/v1/me', null, A);
for (const table of ['channels', 'subscriptions', 'devices', 'events', 'alerts'])
  assert.equal(sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0, `${table} temizlenmeli`);

Date.now = realNow;
console.log('\n✓ Tüm testler geçti');
