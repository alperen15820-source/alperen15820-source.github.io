// Kanal Takip sunucusu (Cloudflare Worker + D1). Çok kullanıcılı:
// - Uygulama ilk açılışta anonim bir hesap oluşturur (POST /v1/register).
// - Kanallar kullanıcılar arasında paylaşılır ve kotaya göre yoklanır (cron).
// - Bildirimler her kullanıcıya kendi eşikleri ve diliyle gönderilir.
import { apnsConfigured } from './apns.js';
import { DAY, S, V, gainSince } from './history.js';
import { lang, t } from './messages.js';
import { DEFAULT_PREFS, LATEST_VIDEOS, prefsOf, pollChannels, pushEvents, schedule, selectIn, trimEvents } from './poll.js';
import { channelByHandle, channelsById, parseRef } from './youtube.js';

const MAX_PER_TICK = 150;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

function validTimezone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function localDate(now, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

async function rateLimit(db, key, limit, windowMs) {
  const now = Date.now();
  const row = await db.prepare('SELECT count, expires_at FROM ratelimits WHERE key = ?').bind(key).first();
  if (row && row.expires_at > now) {
    if (row.count >= limit) return false;
    await db.prepare('UPDATE ratelimits SET count = count + 1 WHERE key = ?').bind(key).run();
  } else {
    await db.prepare('INSERT INTO ratelimits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, expires_at = excluded.expires_at').bind(key, now + windowMs).run();
  }
  return true;
}

async function authenticate(req, env) {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const user = await env.DB.prepare('SELECT * FROM users WHERE token_hash = ?').bind(await sha256(token)).first();
  if (user && Date.now() - user.last_seen > 3600e3) await env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(Date.now(), user.id).run();
  return user;
}

// --- Kullanıcı verisi ---

async function userChannels(env, userId) {
  const subs = (await env.DB.prepare('SELECT channel_id, ref, celebrated FROM subscriptions WHERE user_id = ? ORDER BY position').bind(userId).all()).results;
  const rows = await selectIn(env.DB, 'SELECT id, data, polled_at FROM channels WHERE id IN (?)', subs.map((s) => s.channel_id));
  const byId = new Map(rows.map((r) => [r.id, { ...JSON.parse(r.data), polledAt: r.polled_at }]));
  return subs.map((s) => ({ sub: s, data: byId.get(s.channel_id) })).filter((x) => x.data?.hist?.length);
}

function configOf(user, subs) {
  const p = prefsOf(user);
  return {
    channels: subs.map((s) => s.ref),
    milestones: p.milestones,
    alerts: p.alerts,
    timezone: user.timezone,
    trackLatestVideos: LATEST_VIDEOS,
    morningFallbackHour: p.morningFallbackHour,
  };
}

async function stateFor(env, user) {
  const db = env.DB;
  const [list, subs, events, devices] = await Promise.all([
    userChannels(env, user.id),
    db.prepare('SELECT ref FROM subscriptions WHERE user_id = ? ORDER BY position').bind(user.id).all(),
    db.prepare('SELECT * FROM events WHERE user_id = ? ORDER BY t DESC LIMIT 100').bind(user.id).all(),
    db.prepare('SELECT COUNT(*) AS n FROM devices WHERE user_id = ?').bind(user.id).first(),
  ]);
  const channels = {};
  let updatedAt = null;
  for (const { sub, data } of list) {
    const { uploads, polledAt, ...rest } = data;
    channels[data.id] = { ...rest, celebrated: sub.celebrated ? JSON.parse(sub.celebrated) : [] };
    updatedAt = Math.max(updatedAt || 0, polledAt || 0);
  }
  return {
    updatedAt,
    error: null,
    order: list.map((x) => x.data.id),
    channels,
    events: events.results.map((e) => ({
      id: e.id, t: e.t, type: e.type, title: e.title, body: e.body,
      channelId: e.channel_id, videoId: e.video_id, url: e.url, milestone: e.milestone,
      channel: e.channel_id ? channels[e.channel_id]?.title ?? null : null,
    })),
    config: configOf(user, subs.results),
    devices: devices.n,
    push: apnsConfigured(env),
    limits: { maxChannels: Number(env.MAX_CHANNELS_PER_USER || 5) },
  };
}

async function summaryFor(env, user, since = Date.now() - DAY) {
  const l = user.locale;
  const prefs = prefsOf(user);
  const list = await userChannels(env, user.id);
  const channels = list.map(({ data: c }) => {
    const s = gainSince(c.hist, S, DAY);
    const v = gainSince(c.hist, V, DAY);
    let top = null;
    for (const vid of Object.values(c.videos || {})) {
      const g = gainSince(vid.hist, 1, DAY);
      if (g && g.delta > 0 && (!top || g.delta > top.gain)) top = { id: vid.id, title: vid.title, gain: g.delta };
    }
    return {
      id: c.id, title: c.title, thumb: c.thumb, subs: c.subs, views: c.views,
      subsDelta: s?.delta ?? 0, viewsDelta: v?.delta ?? 0, hours: s?.hours ?? 0,
      nextMilestone: c.subs != null ? prefs.milestones.find((m) => m > c.subs) ?? null : null,
      topVideo: top,
    };
  });
  const totalSubs = channels.reduce((a, c) => a + (c.subs || 0), 0);
  const totalSubsDelta = channels.reduce((a, c) => a + c.subsDelta, 0);
  const totalViewsDelta = channels.reduce((a, c) => a + c.viewsDelta, 0);
  const best = channels.filter((c) => c.topVideo).sort((a, b) => b.topVideo.gain - a.topVideo.gain)[0];
  const notable = (
    await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE user_id = ? AND t >= ? AND type IN ('milestone', 'spike_video', 'spike_channel')").bind(user.id, since).first()
  ).n;
  const updatedAt = list.reduce((m, x) => Math.max(m, x.data.polledAt || 0), 0) || null;
  return {
    updatedAt, error: null, totalSubs, totalSubsDelta, totalViewsDelta, channels,
    title: t(l, 'morningTitle', totalSubsDelta, totalViewsDelta),
    body: [
      best ? t(l, 'morningBest', best.topVideo.title, best.topVideo.gain) : null,
      notable ? t(l, 'morningNotable', notable) : null,
      ...channels.map((c) => t(l, 'morningLine', c)),
    ].filter(Boolean).join('\n'),
  };
}

// --- Ayarlar ---

function patchPrefs(user, body) {
  const p = prefsOf(user);
  const L = user.locale;
  if (body.milestones !== undefined) {
    if (!Array.isArray(body.milestones)) throw new HttpError(400, t(L, 'badRequest', 'milestones'));
    p.milestones = [...new Set(body.milestones.map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b).slice(0, 30);
  }
  if (body.alerts !== undefined) {
    const limits = { spikeMultiplier: [1.5, 50], videoMinViewsPerHour: [1, 1e7], channelMinViewsPerHour: [1, 1e8], subsPerHour: [1, 1e6], cooldownHours: [0.5, 72] };
    for (const [k, [lo, hi]] of Object.entries(limits)) {
      if (body.alerts[k] === undefined) continue;
      const n = Number(body.alerts[k]);
      if (!Number.isFinite(n)) throw new HttpError(400, t(L, 'badRequest', k));
      p.alerts[k] = Math.min(Math.max(n, lo), hi);
    }
    if (body.alerts.newVideo !== undefined) p.alerts.newVideo = Boolean(body.alerts.newVideo);
  }
  if (body.morningFallbackHour !== undefined) {
    const h = body.morningFallbackHour;
    if (h !== null && !(Number.isInteger(h) && h >= 0 && h <= 23)) throw new HttpError(400, t(L, 'badRequest', 'morningFallbackHour'));
    p.morningFallbackHour = h;
  }
  return p;
}

async function resolveRefs(env, user, refs) {
  const db = env.DB;
  const L = user.locale;
  const out = [];
  const missing = [];
  const needCheck = [];
  for (const raw of refs) {
    const ref = String(raw).trim().slice(0, 200);
    const p = parseRef(ref);
    if (!p) {
      missing.push(ref);
      continue;
    }
    if (p.id) {
      out.push({ ref, id: p.id });
      needCheck.push(p.id);
      continue;
    }
    const cached = await db.prepare('SELECT channel_id FROM handles WHERE handle = ?').bind(p.handle).first();
    if (cached) {
      out.push({ ref, id: cached.channel_id });
      continue;
    }
    const item = await channelByHandle(env, p.handle);
    if (!item) {
      missing.push(ref);
      continue;
    }
    await db.prepare('INSERT OR REPLACE INTO handles (handle, channel_id, resolved_at) VALUES (?, ?, ?)').bind(p.handle, item.id, Date.now()).run();
    out.push({ ref, id: item.id });
  }
  // UC… kimliklerinin gerçekten var olduğunu doğrula (henüz takip edilmeyenler için)
  const known = new Set((await selectIn(db, 'SELECT id FROM channels WHERE id IN (?)', needCheck)).map((r) => r.id));
  const unknown = needCheck.filter((id) => !known.has(id));
  if (unknown.length) {
    const found = await channelsById(env, unknown);
    for (const x of out) if (unknown.includes(x.id) && !found.has(x.id)) missing.push(x.ref);
  }
  if (missing.length) throw new HttpError(400, t(L, 'notFound', missing.join(', ')));
  // Aynı kanal iki kez yazıldıysa birini tut
  const seen = new Set();
  return out.filter((x) => !seen.has(x.id) && seen.add(x.id));
}

async function setChannels(env, ctx, user, refs) {
  const db = env.DB;
  const L = user.locale;
  const max = Number(env.MAX_CHANNELS_PER_USER || 5);
  if (!Array.isArray(refs)) throw new HttpError(400, t(L, 'badRequest', 'channels'));
  if (refs.length > max) throw new HttpError(400, t(L, 'tooMany', max));
  const resolved = await resolveRefs(env, user, refs);

  const current = (await db.prepare('SELECT channel_id FROM subscriptions WHERE user_id = ?').bind(user.id).all()).results.map((r) => r.channel_id);
  const added = resolved.filter((x) => !current.includes(x.id)).map((x) => x.id);
  if (added.length) {
    const existing = new Set((await selectIn(db, 'SELECT id FROM channels WHERE id IN (?)', added)).map((r) => r.id));
    const brandNew = added.filter((id) => !existing.has(id));
    const total = (await db.prepare('SELECT COUNT(*) AS n FROM channels').first()).n;
    if (brandNew.length && total + brandNew.length > Number(env.MAX_TOTAL_CHANNELS || 100)) throw new HttpError(503, t(L, 'capacity'));
  }

  const now = Date.now();
  const writes = [db.prepare('DELETE FROM subscriptions WHERE user_id = ?').bind(user.id)];
  const keepCelebrated = new Map(
    (await db.prepare('SELECT channel_id, celebrated FROM subscriptions WHERE user_id = ?').bind(user.id).all()).results.map((r) => [r.channel_id, r.celebrated]),
  );
  resolved.forEach((x, i) => {
    writes.push(
      db.prepare('INSERT INTO subscriptions (user_id, channel_id, ref, position, celebrated, added_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(user.id, x.id, x.ref, i, keepCelebrated.get(x.id) ?? null, now),
    );
    writes.push(db.prepare("INSERT OR IGNORE INTO channels (id, data) VALUES (?, '{}')").bind(x.id));
  });
  await db.batch(writes);
  // Yeni kanalları hemen yokla ki uygulama birkaç saniyede veri görsün
  const fresh = (await selectIn(db, 'SELECT id FROM channels WHERE polled_at IS NULL AND id IN (?)', resolved.map((x) => x.id))).map((r) => r.id);
  if (fresh.length) ctx.waitUntil(pollChannels(env, fresh).catch((e) => console.error(e)));
  await removeOrphans(db);
}

async function removeOrphans(db) {
  await db.prepare('DELETE FROM channels WHERE id NOT IN (SELECT DISTINCT channel_id FROM subscriptions)').run();
}

async function deleteUser(db, id) {
  await db.batch(
    ['devices', 'subscriptions', 'alerts', 'events'].map((table) => db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(id)).concat(db.prepare('DELETE FROM users WHERE id = ?').bind(id)),
  );
  await removeOrphans(db);
}

// --- Zamanlanmış görev ---

export async function tick(env, now = Date.now()) {
  const db = env.DB;
  const rows = (await db.prepare('SELECT id, polled_at FROM channels ORDER BY polled_at ASC').all()).results;
  const { poll } = schedule(env, rows.length);
  const due = rows.filter((r) => !r.polled_at || now - r.polled_at >= poll * 60e3 - 60e3).slice(0, MAX_PER_TICK).map((r) => r.id);
  let result = { polled: 0, events: 0 };
  if (due.length) result = await pollChannels(env, due, { now });

  // Yedek sabah özeti: Kısayollar otomasyonu o gün çalışmadıysa
  const users = (await db.prepare("SELECT * FROM users WHERE json_extract(prefs, '$.morningFallbackHour') IS NOT NULL").all()).results;
  const byUser = new Map();
  for (const u of users) {
    const { date, hour } = localDate(now, u.timezone);
    if (hour < prefsOf(u).morningFallbackHour || u.morning_date === date) continue;
    await db.prepare('UPDATE users SET morning_date = ? WHERE id = ?').bind(date, u.id).run();
    const s = await summaryFor(env, u);
    if (s.channels.length) byUser.set(u.id, [{ id: `m_${now}`, type: 'morning', title: s.title, body: s.body }]);
  }
  await pushEvents(env, byUser);

  // Saatte bir temizlik
  if (new Date(now).getUTCMinutes() < 10) {
    const touched = (await db.prepare('SELECT DISTINCT user_id FROM events WHERE t >= ?').bind(now - 3600e3).all()).results.map((r) => r.user_id);
    await trimEvents(db, touched);
    await db.batch([
      db.prepare('DELETE FROM events WHERE t < ?').bind(now - 30 * DAY),
      db.prepare('DELETE FROM alerts WHERE t < ?').bind(now - 7 * DAY),
      db.prepare('DELETE FROM ratelimits WHERE expires_at < ?').bind(now),
      db.prepare('DELETE FROM handles WHERE resolved_at < ?').bind(now - 30 * DAY),
    ]);
    // 180 gündür açılmayan anonim hesapları sil (gizlilik politikasında belirtildi)
    const stale = (await db.prepare('SELECT id FROM users WHERE last_seen < ?').bind(now - 180 * DAY).all()).results;
    for (const u of stale) await deleteUser(db, u.id);
  }
  return { ...result, due: due.length, channels: rows.length, interval: poll };
}

// --- HTTP ---

async function handle(req, env, ctx) {
  const url = new URL(req.url);
  const route = `${req.method} ${url.pathname.replace(/\/+$/, '') || '/'}`;
  const db = env.DB;
  const body = async () => (req.method === 'GET' ? {} : await req.json().catch(() => ({})));

  if (route === 'GET /' || route === 'GET /health') return json({ ok: true, app: 'kanal-takip' });

  if (route === 'POST /v1/register') {
    const b = await body();
    const locale = lang(b.locale);
    const ip = req.headers.get('cf-connecting-ip') || 'unknown';
    if (!(await rateLimit(db, `reg:${ip}`, Number(env.REGISTER_PER_IP_PER_DAY || 10), DAY))) throw new HttpError(429, t(locale, 'rateLimited'));
    const token = randomHex(32);
    const id = `u_${randomHex(10)}`;
    const now = Date.now();
    await db.prepare('INSERT INTO users (id, token_hash, locale, timezone, prefs, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, await sha256(token), locale, validTimezone(b.timezone) ? b.timezone : 'UTC', '{}', now, now).run();
    return json({ token, userId: id });
  }

  const user = await authenticate(req, env);
  if (!user) return json({ error: t(req.headers.get('accept-language'), 'unauthorized') }, 401);
  const L = user.locale;

  switch (route) {
    case 'GET /v1/state':
      return json(await stateFor(env, user));

    case 'GET /v1/summary':
      return json(await summaryFor(env, user));

    case 'POST /v1/summary/ack':
      await db.prepare('UPDATE users SET morning_date = ? WHERE id = ?').bind(localDate(Date.now(), user.timezone).date, user.id).run();
      return json({ ok: true });

    case 'GET /v1/config': {
      const subs = (await db.prepare('SELECT ref FROM subscriptions WHERE user_id = ? ORDER BY position').bind(user.id).all()).results;
      return json(configOf(user, subs));
    }

    case 'PUT /v1/config': {
      const b = await body();
      if (!(await rateLimit(db, `cfg:${user.id}`, 60, 3600e3))) throw new HttpError(429, t(L, 'rateLimited'));
      const prefs = patchPrefs(user, b);
      const locale = b.locale !== undefined ? lang(b.locale) : user.locale;
      const timezone = b.timezone !== undefined && validTimezone(b.timezone) ? b.timezone : user.timezone;
      await db.prepare('UPDATE users SET prefs = ?, locale = ?, timezone = ? WHERE id = ?').bind(JSON.stringify(prefs), locale, timezone, user.id).run();
      const updated = { ...user, prefs: JSON.stringify(prefs), locale, timezone };
      if (b.channels !== undefined) await setChannels(env, ctx, updated, b.channels);
      const subs = (await db.prepare('SELECT ref FROM subscriptions WHERE user_id = ? ORDER BY position').bind(user.id).all()).results;
      return json(configOf(updated, subs));
    }

    case 'POST /v1/devices': {
      const b = await body();
      if (!/^[0-9a-f]{32,200}$/i.test(b.token || '')) throw new HttpError(400, t(L, 'badRequest', 'token'));
      await db.prepare('INSERT INTO devices (token, user_id, env, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, env = excluded.env, updated_at = excluded.updated_at')
        .bind(b.token.toLowerCase(), user.id, b.env === 'production' ? 'production' : 'sandbox', Date.now()).run();
      // Aynı kullanıcıda en fazla 5 cihaz
      await db.prepare('DELETE FROM devices WHERE user_id = ? AND token NOT IN (SELECT token FROM devices WHERE user_id = ? ORDER BY updated_at DESC LIMIT 5)').bind(user.id, user.id).run();
      return json({ ok: true });
    }

    case 'POST /v1/refresh': {
      if (!(await rateLimit(db, `ref:${user.id}`, 12, 3600e3))) throw new HttpError(429, t(L, 'rateLimited'));
      const ids = (await db.prepare('SELECT s.channel_id FROM subscriptions s JOIN channels c ON c.id = s.channel_id WHERE s.user_id = ? AND (c.polled_at IS NULL OR c.polled_at < ?)').bind(user.id, Date.now() - 3 * 60e3).all()).results.map((r) => r.channel_id);
      const r = await pollChannels(env, ids);
      return json({ ok: true, ...r });
    }

    case 'POST /v1/test': {
      if (!apnsConfigured(env)) throw new HttpError(400, t(L, 'pushOff'));
      if (!(await rateLimit(db, `test:${user.id}`, 10, 3600e3))) throw new HttpError(429, t(L, 'rateLimited'));
      const n = (await db.prepare('SELECT COUNT(*) AS n FROM devices WHERE user_id = ?').bind(user.id).first()).n;
      if (!n) throw new HttpError(400, t(L, 'noDevices'));
      await pushEvents(env, new Map([[user.id, [{ id: `t_${Date.now()}`, type: 'test', ...t(L, 'test') }]]]));
      return json({ ok: true });
    }

    case 'DELETE /v1/me':
      await deleteUser(db, user.id);
      return json({ ok: true });

    default:
      return json({ error: 'Not found' }, 404);
  }
}

export default {
  async fetch(req, env, ctx) {
    try {
      return await handle(req, env, ctx);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Server error' }, 500);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(tick(env).then((r) => console.log('tick', JSON.stringify(r))));
  },
};

export { DEFAULT_PREFS };
