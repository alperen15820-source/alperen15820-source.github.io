// Kanal Takip sunucusu (Cloudflare Worker).
// - Her 10 dakikada bir (cron) kanalları kontrol eder ve iPhone'a push gönderir.
// - iOS uygulaması ve widget verileri buradan okur.
import { apnsConfigured, pushAll } from './apns.js';
import { buildSummary, localDate, makeEvent, mergeConfig, runMonitor } from './monitor.js';

const PUSH_STYLE = {
  milestone: { level: 'time-sensitive', relevance: 1 },
  spike_video: { level: 'time-sensitive', relevance: 0.8 },
  spike_channel: { level: 'time-sensitive', relevance: 0.8 },
  subs_jump: { level: 'active', relevance: 0.6 },
  new_video: { level: 'active', relevance: 0.4 },
  morning: { level: 'active', relevance: 0.7 },
  test: { level: 'active', relevance: 0.5 },
};

async function load(env) {
  const [state, config, devices] = await Promise.all([
    env.KV.get('state', 'json'),
    env.KV.get('config', 'json'),
    env.KV.get('devices', 'json'),
  ]);
  return { state: state || { channels: {}, events: [] }, cfg: mergeConfig(config || {}), devices: devices || [] };
}

async function notify(env, devices, events) {
  let list = devices;
  for (const ev of events) {
    const style = PUSH_STYLE[ev.type] || PUSH_STYLE.test;
    const payload = {
      aps: {
        alert: { title: ev.title, body: ev.body },
        sound: 'default',
        'interruption-level': style.level,
        'relevance-score': style.relevance,
        ...(ev.channelId ? { 'thread-id': ev.channelId } : {}),
      },
      type: ev.type,
      eventId: ev.id,
      channelId: ev.channelId || null,
      videoId: ev.videoId || null,
      milestone: ev.milestone || null,
      url: ev.url || null,
    };
    const updated = await pushAll(env, list, payload, { collapseId: ev.type === 'morning' ? 'morning' : undefined });
    if (updated) list = updated;
  }
  if (list !== devices) await env.KV.put('devices', JSON.stringify(list));
}

async function tick(env) {
  const { state, cfg, devices } = await load(env);
  const events = await runMonitor(env, state, cfg);

  // Yedek sabah özeti: Kısayollar otomasyonu bugün çalışmadıysa
  if (cfg.morningFallbackHour != null) {
    const { date, hour } = localDate(Date.now(), cfg.timezone);
    const morning = (await env.KV.get('morning', 'json')) || {};
    if (hour >= cfg.morningFallbackHour && morning.date !== date) {
      await env.KV.put('morning', JSON.stringify({ date, fallback: Date.now() }));
      const s = buildSummary(state, cfg);
      events.push(makeEvent({ type: 'morning', title: s.title, body: s.body }));
    }
  }

  await env.KV.put('state', JSON.stringify(state));
  if (events.length) await notify(env, devices, events);
  return { events: events.length, error: state.error };
}

// --- HTTP API ---

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

function authorized(req, env) {
  const header = req.headers.get('authorization') || '';
  return env.APP_SECRET && header === `Bearer ${env.APP_SECRET}`;
}

function validateConfig(input) {
  const out = {};
  if (input.channels !== undefined) {
    if (!Array.isArray(input.channels) || input.channels.length > 50) throw new Error('channels bir liste olmalı (en fazla 50)');
    out.channels = input.channels.map((c) => String(c).trim()).filter(Boolean);
  }
  if (input.milestones !== undefined) {
    out.milestones = [...new Set(input.milestones.map(Number).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
  }
  if (input.alerts !== undefined) {
    const a = {};
    for (const k of ['spikeMultiplier', 'videoMinViewsPerHour', 'channelMinViewsPerHour', 'subsPerHour', 'cooldownHours']) {
      if (input.alerts[k] !== undefined) {
        const n = Number(input.alerts[k]);
        if (!Number.isFinite(n) || n < 0) throw new Error(`${k} geçersiz`);
        a[k] = n;
      }
    }
    if (input.alerts.newVideo !== undefined) a.newVideo = Boolean(input.alerts.newVideo);
    out.alerts = a;
  }
  if (input.morningFallbackHour !== undefined) {
    const h = input.morningFallbackHour;
    if (h !== null && !(Number.isInteger(h) && h >= 0 && h <= 23)) throw new Error('morningFallbackHour 0–23 veya null olmalı');
    out.morningFallbackHour = h;
  }
  if (input.timezone !== undefined) {
    new Intl.DateTimeFormat('en', { timeZone: input.timezone }); // geçersizse hata fırlatır
    out.timezone = input.timezone;
  }
  if (input.trackLatestVideos !== undefined) out.trackLatestVideos = Math.min(Math.max(Number(input.trackLatestVideos) || 10, 1), 50);
  return out;
}

async function handle(req, env, ctx) {
  const url = new URL(req.url);
  const route = `${req.method} ${url.pathname.replace(/\/+$/, '') || '/'}`;

  if (route === 'GET /' || route === 'GET /health') return json({ ok: true, app: 'kanal-takip' });
  if (!authorized(req, env)) return json({ error: 'Yetkisiz' }, 401);

  switch (route) {
    case 'GET /state': {
      const { state, cfg, devices } = await load(env);
      return json({ ...state, resolved: undefined, config: cfg, devices: devices.length, push: apnsConfigured(env) });
    }
    case 'GET /summary': {
      const { state, cfg } = await load(env);
      return json(buildSummary(state, cfg));
    }
    // Sabah özeti telefonda gösterildi: yedek push bugün gönderilmesin.
    case 'POST /summary/ack': {
      const { cfg } = await load(env);
      await env.KV.put('morning', JSON.stringify({ date: localDate(Date.now(), cfg.timezone).date, ack: Date.now() }));
      return json({ ok: true });
    }
    case 'GET /config': {
      const { cfg } = await load(env);
      return json(cfg);
    }
    case 'PUT /config': {
      const body = await req.json().catch(() => null);
      if (!body) return json({ error: 'Geçersiz JSON' }, 400);
      let patch;
      try {
        patch = validateConfig(body);
      } catch (err) {
        return json({ error: err.message }, 400);
      }
      const current = (await env.KV.get('config', 'json')) || {};
      const next = { ...current, ...patch, alerts: { ...current.alerts, ...patch.alerts } };
      await env.KV.put('config', JSON.stringify(next));
      // Kanal listesi değiştiyse hemen kontrol et
      if (patch.channels) ctx.waitUntil(tick(env));
      return json(mergeConfig(next));
    }
    case 'POST /devices': {
      const body = await req.json().catch(() => ({}));
      if (!/^[0-9a-f]{32,200}$/i.test(body.token || '')) return json({ error: 'Geçersiz token' }, 400);
      const devices = ((await env.KV.get('devices', 'json')) || []).filter((d) => d.token !== body.token);
      devices.push({ token: body.token, env: body.env === 'production' ? 'production' : 'sandbox', name: String(body.name || '').slice(0, 60), added: Date.now() });
      await env.KV.put('devices', JSON.stringify(devices.slice(-10)));
      return json({ ok: true, devices: devices.length });
    }
    case 'POST /run':
      return json(await tick(env));
    case 'POST /test': {
      if (!apnsConfigured(env)) return json({ error: 'APNs anahtarları tanımlı değil (APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC).' }, 400);
      const devices = (await env.KV.get('devices', 'json')) || [];
      if (!devices.length) return json({ error: 'Kayıtlı cihaz yok. Uygulamada bildirim iznini verin.' }, 400);
      await notify(env, devices, [makeEvent({ type: 'test', title: '✅ Test bildirimi', body: 'Kanal Takip çalışıyor. Sıçrama ve hedef bildirimleri buraya gelecek.' })]);
      return json({ ok: true });
    }
    default:
      return json({ error: 'Bulunamadı' }, 404);
  }
}

export default {
  async fetch(req, env, ctx) {
    try {
      return await handle(req, env, ctx);
    } catch (err) {
      console.error(err);
      return json({ error: err.message }, 500);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(tick(env));
  },
};
