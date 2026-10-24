// Sunucuyu sahte YouTube + sahte APNs ile 36 saat boyunca çalıştırır: npm test
import assert from 'node:assert/strict';
import worker from '../src/index.js';

let now = Date.UTC(2026, 9, 20, 3, 0); // 06:00 İstanbul
Date.now = () => now;

// --- sahte KV ---
const kv = new Map();
const KV = {
  async get(k, type) { const v = kv.get(k); return v == null ? null : type === 'json' ? JSON.parse(v) : v; },
  async put(k, v) { kv.set(k, v); },
};

// --- APNs için gerçek bir P-256 anahtarı üret ---
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`;

const env = { KV, YT_API_KEY: 'x', APP_SECRET: 's3cret', APNS_KEY: pem, APNS_KEY_ID: 'ABC123DEFG', APNS_TEAM_ID: 'TEAM123456', APNS_TOPIC: 'com.test.app' };

// --- sahte YouTube: 990 aboneden başlayıp 1000'i geçen kanal, 34. saatte video sıçraması ---
let run = 0;
const pushes = [];
const subs = () => (run < 200 ? 990 + Math.floor(run / 20) : 1003);
const v1 = () => 5000 + run * 10 + (run >= 200 ? (Math.min(run, 206) - 199) * 400 : 0);
const vids = () => (run >= 150 ? ['vNEW', 'v1'] : ['v1']);
const b64urlDecode = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

globalThis.fetch = async (input, opts = {}) => {
  const u = new URL(input);
  const ok = (b, status = 200) => new Response(JSON.stringify(b), { status });
  if (u.hostname.endsWith('push.apple.com')) {
    const [h, p, sig] = opts.headers.authorization.slice(7).split('.');
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, b64urlDecode(sig), new TextEncoder().encode(`${h}.${p}`));
    assert.ok(valid, 'JWT imzası geçersiz');
    assert.equal(JSON.parse(atob(h)).kid, 'ABC123DEFG');
    assert.equal(opts.headers['apns-topic'], 'com.test.app');
    const token = u.pathname.split('/').pop();
    if (token.startsWith('dead')) return ok({ reason: 'Unregistered' }, 410);
    if (u.hostname.startsWith('api.sandbox') && token.startsWith('bbbb')) return ok({ reason: 'BadDeviceToken' }, 400);
    pushes.push({ run, host: u.hostname, token, ...JSON.parse(opts.body) });
    return ok({});
  }
  if (u.pathname.endsWith('/channels')) {
    if (u.searchParams.get('forHandle') === '@yok') return ok({ items: [] });
    return ok({ items: [{ id: 'UCaaaaaaaaaaaaaaaaaaaaaa', snippet: { title: 'Test Kanal', customUrl: '@test', thumbnails: {} }, statistics: { subscriberCount: String(subs()), viewCount: String(v1() + 20000), videoCount: '2' }, contentDetails: { relatedPlaylists: { uploads: 'UUaaa' } } }] });
  }
  if (u.pathname.endsWith('/playlistItems')) return ok({ items: vids().map((id) => ({ contentDetails: { videoId: id } })) });
  if (u.pathname.endsWith('/videos'))
    return ok({ items: vids().map((id) => ({ id, snippet: { title: id === 'v1' ? 'Video Bir' : 'Yeni Video', publishedAt: new Date(id === 'v1' ? now - 30 * 864e5 : now - 36e5).toISOString(), liveBroadcastContent: 'none', thumbnails: {} }, statistics: { viewCount: String(id === 'v1' ? v1() : 100), likeCount: '1', commentCount: '0' }, contentDetails: { duration: 'PT4M5S' } })) });
  throw new Error(`beklenmeyen istek ${input}`);
};

const ctx = { pending: [], waitUntil(p) { this.pending.push(p); } };
const call = async (method, path, body, secret = 's3cret') => {
  const res = await worker.fetch(new Request(`https://w.test${path}`, { method, headers: { authorization: `Bearer ${secret}` }, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  await Promise.all(ctx.pending.splice(0));
  return { status: res.status, body: await res.json() };
};

// Yetki
assert.equal((await call('GET', '/state', null, 'yanlis')).status, 401);
assert.equal((await worker.fetch(new Request('https://w.test/health'), env, ctx)).status, 200);

// Cihazlar: biri sandbox, biri yanlışlıkla sandbox kaydedilmiş production, biri ölü
for (const token of ['aaaa'.repeat(16), 'b'.repeat(64), 'dead'.padEnd(64, 'c')])
  assert.equal((await call('POST', '/devices', { token, env: 'sandbox' })).status, 200);
assert.equal((await call('POST', '/devices', { token: 'xyz' })).status, 400);

// Kanal ekle (biri bulunamayan) → hemen bir tur çalışır
const cfgRes = await call('PUT', '/config', { channels: ['@test', '@yok'], morningFallbackHour: 11 });
assert.equal(cfgRes.status, 200);
assert.deepEqual(cfgRes.body.channels, ['@test', '@yok']);
assert.equal((await call('PUT', '/config', { morningFallbackHour: 30 })).status, 400);
let st = (await call('GET', '/state')).body;
assert.match(st.error, /Bulunamayan kanal: @yok/);

for (run = 1; run <= 215; run++) {
  now += 600e3;
  const c = { pending: [], waitUntil(p) { this.pending.push(p); } };
  await worker.scheduled({}, env, c);
  await Promise.all(c.pending);
  if (run === 120) assert.equal((await call('POST', '/summary/ack')).status, 200); // 2. gün sabah özeti görüldü
}

const types = pushes.filter((p) => p.token.startsWith('aaaa')).map((p) => `${p.run}:${p.type}`);
console.log('Gönderilen bildirimler:', types.join(', '));
const has = (t) => types.some((x) => x.endsWith(':' + t));
assert.ok(has('milestone') && has('spike_video') && has('new_video') && has('morning'));
assert.ok(!has('spike_channel'), 'video sıçraması kanal sıçraması olarak tekrar bildirilmemeli');
assert.equal(types.filter((x) => x.endsWith(':morning')).length, 1, 'ack yapılan gün yedek özet gitmemeli');
const ms = pushes.find((p) => p.type === 'milestone');
assert.equal(ms.milestone, 1000);
assert.equal(ms.aps['interruption-level'], 'time-sensitive');
assert.ok(pushes.some((p) => p.token.startsWith('bbbb') && p.host === 'api.push.apple.com'), 'yanlış ortam düzeltilmeli');

const devices = JSON.parse(kv.get('devices'));
assert.equal(devices.length, 2, 'ölü cihaz silinmeli');
assert.equal(devices.find((d) => d.token.startsWith('bbbb')).env, 'production');

st = (await call('GET', '/state')).body;
const ch = st.channels.UCaaaaaaaaaaaaaaaaaaaaaa;
assert.equal(ch.subs, 1003);
assert.deepEqual(ch.celebrated, [100, 250, 500, 1000]);
console.log(`Geçmiş noktası: ${ch.hist.length}, state boyutu: ${(kv.get('state').length / 1024).toFixed(1)} KB`);

const sum = (await call('GET', '/summary')).body;
assert.equal(sum.channels[0].subs, 1003);
console.log('Özet:', sum.title, '\n' + sum.body);

assert.equal((await call('POST', '/test')).status, 200);
console.log('\n✓ Tüm testler geçti');
