// Kanal takibi: YouTube'dan veriyi çeker, geçmişe ekler, olay (bildirim) üretir.
export const HOUR = 3600e3;
const DAY = 24 * HOUR;
const API = 'https://www.googleapis.com/youtube/v3';
const MAX_EVENTS = 100;

// Geçmiş noktaları dizi olarak saklanır: kanal [t, abone, izlenme], video [t, izlenme].
export const S = 1;
export const V = 2;

export const DEFAULT_CONFIG = {
  channels: [],
  milestones: [100, 250, 500, 1000, 2000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000],
  alerts: {
    spikeMultiplier: 3,
    videoMinViewsPerHour: 50,
    channelMinViewsPerHour: 100,
    subsPerHour: 10,
    newVideo: true,
    cooldownHours: 3,
  },
  timezone: 'Europe/Istanbul',
  trackLatestVideos: 10,
  // Sabah özeti Kısayollar otomasyonuyla (alarm kapanınca) gelir. Bu saate kadar
  // gelmediyse sunucu yedek olarak gönderir; null = kapalı.
  morningFallbackHour: null,
};

export function mergeConfig(raw = {}) {
  return { ...DEFAULT_CONFIG, ...raw, alerts: { ...DEFAULT_CONFIG.alerts, ...raw.alerts } };
}

const nf = new Intl.NumberFormat('tr-TR');
export const fmt = (n) => nf.format(Math.round(n));
export const signed = (n) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n));

// --- YouTube Data API ---

async function yt(env, endpoint, params) {
  const url = new URL(`${API}/${endpoint}`);
  for (const [k, v] of Object.entries({ ...params, key: env.YT_API_KEY })) url.searchParams.set(k, v);
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`YouTube API ${endpoint} ${res.status}: ${body.error?.message || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

export function parseRef(ref) {
  const s = String(ref).trim();
  if (/^UC[\w-]{22}$/.test(s)) return { id: s };
  const byId = s.match(/channel\/(UC[\w-]{22})/);
  if (byId) return { id: byId[1] };
  const byHandle = s.match(/@([^/?#\s]+)/);
  if (byHandle) return { handle: '@' + byHandle[1] };
  return { handle: '@' + s.replace(/^@/, '') };
}

const CHANNEL_PARTS = 'snippet,statistics,contentDetails';

async function fetchChannels(env, refs, state) {
  state.resolved ??= {};
  const ids = [];
  const byId = new Map();
  const missing = [];
  for (const ref of refs) {
    const p = parseRef(ref);
    const id = p.id || state.resolved[p.handle.toLowerCase()];
    if (id) {
      ids.push(id);
      continue;
    }
    const r = await yt(env, 'channels', { part: CHANNEL_PARTS, forHandle: p.handle });
    const item = r.items?.[0];
    if (!item) {
      missing.push(ref);
      continue;
    }
    state.resolved[p.handle.toLowerCase()] = item.id;
    ids.push(item.id);
    byId.set(item.id, item);
  }
  const need = [...new Set(ids)].filter((id) => !byId.has(id));
  for (let i = 0; i < need.length; i += 50) {
    const r = await yt(env, 'channels', { part: CHANNEL_PARTS, id: need.slice(i, i + 50).join(','), maxResults: 50 });
    for (const item of r.items || []) byId.set(item.id, item);
  }
  return { items: [...new Set(ids)].map((id) => byId.get(id)).filter(Boolean), missing };
}

async function fetchLatestVideoIds(env, playlistId, max) {
  try {
    const r = await yt(env, 'playlistItems', { part: 'contentDetails', playlistId, maxResults: max });
    return (r.items || []).map((i) => i.contentDetails.videoId);
  } catch (err) {
    if (err.status === 404) return [];
    throw err;
  }
}

async function fetchVideos(env, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const r = await yt(env, 'videos', { part: 'snippet,statistics,contentDetails', id: ids.slice(i, i + 50).join(','), maxResults: 50 });
    for (const item of r.items || []) out.set(item.id, item);
  }
  return out;
}

function isoDurationSeconds(d) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || '');
  if (!m) return null;
  const [, days, h, min, s] = m.map((x) => Number(x) || 0);
  return days * 86400 + h * 3600 + min * 60 + s;
}

// --- Geçmiş hesapları ---

export function pointAtOrBefore(hist, t) {
  let found = null;
  for (const p of hist) {
    if (p[0] <= t) found = p;
    else break;
  }
  return found;
}

export function gainSince(hist, k, ms) {
  if (!hist?.length) return null;
  const last = hist[hist.length - 1];
  const ref = pointAtOrBefore(hist, last[0] - ms) || hist[0];
  if (ref === last) return null;
  return { delta: last[k] - ref[k], hours: (last[0] - ref[0]) / HOUR };
}

// Son ~1 saatlik artış hızını önceki 24 saatin ortalamasıyla karşılaştırır.
export function detectSpike(hist, k, minPerHour, multiplier) {
  if (hist.length < 3) return null;
  const last = hist[hist.length - 1];
  const ref = pointAtOrBefore(hist, last[0] - HOUR);
  if (!ref || last[0] - ref[0] > 3 * HOUR) return null;
  const recentRate = (last[k] - ref[k]) / ((last[0] - ref[0]) / HOUR);
  const base = pointAtOrBefore(hist, ref[0] - DAY) || hist[0];
  const baseHours = (ref[0] - base[0]) / HOUR;
  if (baseHours < 3) return null;
  const baseRate = Math.max((ref[k] - base[k]) / baseHours, 0);
  if (recentRate < minPerHour || recentRate < multiplier * Math.max(baseRate, 1)) return null;
  return { recentRate, baseRate, ratio: baseRate > 0 ? recentRate / baseRate : null };
}

// tiers: [[yaşSınırıMs, aralıkMs], ...] — en yeniden eskiye. Sınırı aşan noktalar atılır.
function downsample(hist, now, tiers) {
  const out = [];
  let lastBucket = null;
  for (const p of hist) {
    const age = now - p[0];
    const tier = tiers.find(([maxAge]) => age <= maxAge);
    if (!tier) continue;
    const step = tier[1];
    if (step) {
      const bucket = `${step}:${Math.floor(p[0] / step)}`;
      if (bucket === lastBucket) continue;
      lastBucket = bucket;
    } else lastBucket = null;
    out.push(p);
  }
  return out;
}
const CHANNEL_TIERS = [[6 * HOUR, 0], [7 * DAY, HOUR], [400 * DAY, DAY]];
const VIDEO_TIERS = [[3 * HOUR, 0], [48 * HOUR, HOUR]];

// --- Olaylar ---

export function makeEvent(ev) {
  return { id: `${ev.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, t: Date.now(), ...ev };
}

function milestoneEvent(m, c) {
  if (m === 1000) {
    return {
      title: `🏆 1000 ABONE — ${c.title}`,
      body: 'Tebrikler! 1000 abone barajı geçildi. Para kazanma (YPP) için ilk büyük şart tamam — sırada 4000 saat izlenme ya da 10M Shorts izlenmesi var. 🚀',
    };
  }
  return { title: `🎉 ${fmt(m)} abone — ${c.title}`, body: `Kanal ${fmt(m)} aboneyi geçti. Şu an ${fmt(c.subs)} abone.` };
}

function processChannel(state, cfg, item, videos, latestIds, now, events) {
  const a = cfg.alerts;
  const cooldown = a.cooldownHours * HOUR;
  const c = (state.channels[item.id] ??= { id: item.id, hist: [], videos: {}, alerts: {}, celebrated: null });
  const firstRun = c.celebrated === null;
  const st = item.statistics || {};

  Object.assign(c, {
    title: item.snippet.title,
    handle: item.snippet.customUrl || null,
    thumb: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || null,
    subs: st.hiddenSubscriberCount ? null : Number(st.subscriberCount),
    views: Number(st.viewCount),
    videoCount: Number(st.videoCount),
    url: `https://www.youtube.com/channel/${item.id}`,
  });
  c.hist.push([now, c.subs ?? 0, c.views]);
  c.hist = downsample(c.hist, now, CHANNEL_TIERS);
  const base = { channelId: c.id, channel: c.title };

  if (c.subs != null) {
    const reached = cfg.milestones.filter((m) => c.subs >= m);
    if (firstRun) c.celebrated = reached;
    else
      for (const m of reached) {
        if (c.celebrated.includes(m)) continue;
        c.celebrated.push(m);
        events.push({ type: 'milestone', milestone: m, url: c.url, ...base, ...milestoneEvent(m, c) });
      }
  } else c.celebrated ??= [];

  const prev = c.videos || {};
  const next = {};
  for (const vid of latestIds) {
    const v = videos.get(vid);
    if (!v) continue;
    const old = prev[vid];
    const s = v.statistics || {};
    const views = Number(s.viewCount || 0);
    const rec = {
      id: vid,
      title: v.snippet.title,
      thumb: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || null,
      publishedAt: v.snippet.publishedAt,
      duration: isoDurationSeconds(v.contentDetails?.duration),
      live: v.snippet.liveBroadcastContent !== 'none' ? v.snippet.liveBroadcastContent : null,
      views,
      likes: s.likeCount != null ? Number(s.likeCount) : null,
      comments: s.commentCount != null ? Number(s.commentCount) : null,
      hist: downsample([...(old?.hist || []), [now, views]], now, VIDEO_TIERS),
      lastAlert: old?.lastAlert || 0,
    };
    next[vid] = rec;
    const url = `https://www.youtube.com/watch?v=${vid}`;

    if (!old && !firstRun && a.newVideo && now - Date.parse(rec.publishedAt) < 48 * HOUR) {
      events.push({ type: 'new_video', videoId: vid, url, ...base, title: `🎬 Yeni video — ${c.title}`, body: rec.title });
    }
    const spike = detectSpike(rec.hist, 1, a.videoMinViewsPerHour, a.spikeMultiplier);
    if (spike && now - rec.lastAlert > cooldown) {
      rec.lastAlert = now;
      events.push({
        type: 'spike_video', videoId: vid, url, ...base,
        title: `🔥 Sıçrama — ${rec.title}`,
        body: `Saatte ~${fmt(spike.recentRate)} izlenme` + (spike.ratio ? ` (normalin ${spike.ratio.toFixed(1)} katı)` : '') + `. Toplam ${fmt(views)} · ${c.title}`,
      });
    }
  }
  c.videos = next;
  c.latest = latestIds.filter((id) => next[id]);

  const recentVideoAlert = Object.values(next).some((v) => now - v.lastAlert <= cooldown);
  const chSpike = detectSpike(c.hist, V, a.channelMinViewsPerHour, a.spikeMultiplier);
  if (chSpike && !recentVideoAlert && now - (c.alerts.views || 0) > cooldown) {
    c.alerts.views = now;
    events.push({
      type: 'spike_channel', url: c.url, ...base,
      title: `🚀 İzlenme patlaması — ${c.title}`,
      body: `Kanal saatte ~${fmt(chSpike.recentRate)} izlenme alıyor` + (chSpike.ratio ? ` (normalin ${chSpike.ratio.toFixed(1)} katı).` : '.'),
    });
  }

  const sg = gainSince(c.hist, S, HOUR);
  if (c.subs != null && sg && sg.hours >= 0.5 && sg.hours <= 3 && sg.delta >= a.subsPerHour && now - (c.alerts.subs || 0) > cooldown) {
    c.alerts.subs = now;
    events.push({
      type: 'subs_jump', url: c.url, ...base,
      title: `👥 Abone yağıyor — ${c.title}`,
      body: `Son ${sg.hours < 1.25 ? 'bir saatte' : `${sg.hours.toFixed(1)} saatte`} ${signed(sg.delta)} abone. Şu an ${fmt(c.subs)}.`,
    });
  }
}

// Bir tur kontrol. state yerinde güncellenir; üretilen olaylar döner.
export async function runMonitor(env, state, cfg) {
  const now = Date.now();
  state.channels ??= {};
  const events = [];
  try {
    if (!env.YT_API_KEY) throw new Error('YT_API_KEY tanımlı değil (wrangler secret put YT_API_KEY).');
    if (!cfg.channels.length) throw new Error('Takip edilecek kanal yok. Uygulamada Ayarlar → Kanallar bölümünden ekleyin.');
    const { items, missing } = await fetchChannels(env, cfg.channels, state);
    if (!items.length) throw new Error('Geçerli kanal bulunamadı. Kanal adlarını kontrol edin.');

    const latest = new Map();
    for (const item of items) {
      const uploads = item.contentDetails?.relatedPlaylists?.uploads;
      latest.set(item.id, uploads ? await fetchLatestVideoIds(env, uploads, cfg.trackLatestVideos) : []);
    }
    const videos = await fetchVideos(env, [...latest.values()].flat());
    for (const item of items) processChannel(state, cfg, item, videos, latest.get(item.id), now, events);

    const ids = items.map((i) => i.id);
    for (const id of Object.keys(state.channels)) if (!ids.includes(id)) delete state.channels[id];
    state.order = ids;
    state.error = missing.length ? `Bulunamayan kanal: ${missing.join(', ')}` : null;
  } catch (err) {
    state.error = err.message;
    console.error(err.message);
  }
  state.updatedAt = now;
  const made = events.map(makeEvent);
  state.events = [...made.slice().reverse(), ...(state.events || [])].slice(0, MAX_EVENTS);
  return made;
}

// --- Özet (sabah özeti, widget) ---

export function buildSummary(state, cfg) {
  const order = state.order || Object.keys(state.channels || {});
  const channels = order.map((id) => state.channels[id]).filter(Boolean).map((c) => {
    const s = gainSince(c.hist, S, DAY);
    const v = gainSince(c.hist, V, DAY);
    let top = null;
    for (const vid of Object.values(c.videos || {})) {
      const g = gainSince(vid.hist, 1, DAY);
      if (g && g.delta > 0 && (!top || g.delta > top.gain)) top = { id: vid.id, title: vid.title, gain: g.delta };
    }
    const next = c.subs != null ? cfg.milestones.find((m) => m > c.subs) ?? null : null;
    return {
      id: c.id, title: c.title, thumb: c.thumb,
      subs: c.subs, views: c.views,
      subsDelta: s?.delta ?? 0, viewsDelta: v?.delta ?? 0, hours: s?.hours ?? 0,
      nextMilestone: next, topVideo: top,
    };
  });
  const totalSubs = channels.reduce((a, c) => a + (c.subs || 0), 0);
  const totalSubsDelta = channels.reduce((a, c) => a + c.subsDelta, 0);
  const totalViewsDelta = channels.reduce((a, c) => a + c.viewsDelta, 0);
  const best = [...channels].sort((a, b) => b.viewsDelta - a.viewsDelta)[0];
  const lines = channels.map((c) => `${c.title}: ${c.subs != null ? fmt(c.subs) : '—'} (${signed(c.subsDelta)}) · ${signed(c.viewsDelta)} izl.`);
  const since = Date.now() - DAY;
  const notable = (state.events || []).filter((e) => e.t >= since && ['milestone', 'spike_video', 'spike_channel'].includes(e.type)).length;
  return {
    updatedAt: state.updatedAt || null,
    error: state.error || null,
    totalSubs, totalSubsDelta, totalViewsDelta,
    channels,
    title: `☀️ Günaydın — dün ${signed(totalSubsDelta)} abone, ${signed(totalViewsDelta)} izlenme`,
    body:
      (best?.topVideo ? `En iyi: ${best.topVideo.title} (${signed(best.topVideo.gain)})\n` : '') +
      (notable ? `Son 24 saatte ${notable} önemli olay.\n` : '') +
      lines.join('\n'),
  };
}

export function localDate(now, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
