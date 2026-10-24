#!/usr/bin/env node
// YouTube kanal takipçisi. GitHub Actions tarafından ~10 dakikada bir çalıştırılır:
// kanal ve video istatistiklerini çeker, geçmişe ekler, sıçrama / abone hedefi /
// yeni video / günlük rapor bildirimlerini ntfy ve (isteğe bağlı) Telegram'a gönderir.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const API = 'https://www.googleapis.com/youtube/v3';
const HOUR = 3600e3;
const env = process.env;
const DATA_DIR = env.DATA_DIR || 'data';
const CONFIG_PATH = env.CONFIG || 'yt/config.json';
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const MAX_EVENTS = 200;

const DEFAULTS = {
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
  dailyReportHour: 21,
  timezone: 'Europe/Istanbul',
  trackLatestVideos: 15,
};

const nf = new Intl.NumberFormat('tr-TR');
const fmt = (n) => nf.format(Math.round(n));
const signed = (n) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n));

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function loadConfig() {
  const raw = await readJson(CONFIG_PATH, {});
  return { ...DEFAULTS, ...raw, alerts: { ...DEFAULTS.alerts, ...raw.alerts } };
}

// --- YouTube Data API ---

async function yt(endpoint, params) {
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

function parseRef(ref) {
  const s = String(ref).trim();
  if (/^UC[\w-]{22}$/.test(s)) return { id: s };
  const byId = s.match(/channel\/(UC[\w-]{22})/);
  if (byId) return { id: byId[1] };
  const byHandle = s.match(/@([^/?#\s]+)/);
  if (byHandle) return { handle: '@' + byHandle[1] };
  return { handle: '@' + s.replace(/^@/, '') };
}

const CHANNEL_PARTS = 'snippet,statistics,contentDetails';

async function fetchChannels(refs, state) {
  state.resolved ??= {};
  const ids = new Set();
  const byId = new Map();
  for (const ref of refs) {
    const p = parseRef(ref);
    if (p.id) ids.add(p.id);
    else if (state.resolved[p.handle.toLowerCase()]) ids.add(state.resolved[p.handle.toLowerCase()]);
    else {
      const r = await yt('channels', { part: CHANNEL_PARTS, forHandle: p.handle });
      const item = r.items?.[0];
      if (!item) {
        console.warn(`Kanal bulunamadı: ${ref}`);
        continue;
      }
      state.resolved[p.handle.toLowerCase()] = item.id;
      byId.set(item.id, item);
    }
  }
  const missing = [...ids].filter((id) => !byId.has(id));
  for (let i = 0; i < missing.length; i += 50) {
    const r = await yt('channels', { part: CHANNEL_PARTS, id: missing.slice(i, i + 50).join(','), maxResults: 50 });
    for (const item of r.items || []) byId.set(item.id, item);
  }
  return [...byId.values()];
}

async function fetchLatestVideoIds(uploadsPlaylist, max) {
  try {
    const r = await yt('playlistItems', { part: 'contentDetails', playlistId: uploadsPlaylist, maxResults: max });
    return (r.items || []).map((i) => i.contentDetails.videoId);
  } catch (err) {
    if (err.status === 404) return []; // henüz videosu olmayan kanal
    throw err;
  }
}

async function fetchVideos(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const r = await yt('videos', { part: 'snippet,statistics,contentDetails', id: ids.slice(i, i + 50).join(','), maxResults: 50 });
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

// --- Geçmiş ve sıçrama tespiti ---

function pointAtOrBefore(hist, t) {
  let found = null;
  for (const p of hist) {
    if (p.t <= t) found = p;
    else break;
  }
  return found;
}

// Son ~1 saatlik artış hızını, ondan önceki 24 saatin ortalama hızıyla karşılaştırır.
function detectSpike(hist, key, minPerHour, multiplier) {
  if (hist.length < 3) return null;
  const last = hist[hist.length - 1];
  const ref = pointAtOrBefore(hist, last.t - HOUR);
  if (!ref || last.t - ref.t > 3 * HOUR) return null;
  const recentRate = (last[key] - ref[key]) / ((last.t - ref.t) / HOUR);
  const base = pointAtOrBefore(hist, ref.t - 24 * HOUR) || hist[0];
  const baseHours = (ref.t - base.t) / HOUR;
  if (baseHours < 3) return null;
  const baseRate = Math.max((ref[key] - base[key]) / baseHours, 0);
  if (recentRate < minPerHour || recentRate < multiplier * Math.max(baseRate, 1)) return null;
  return { recentRate, baseRate, ratio: baseRate > 0 ? recentRate / baseRate : null };
}

function gainSince(hist, key, ms) {
  if (!hist.length) return null;
  const last = hist[hist.length - 1];
  const ref = pointAtOrBefore(hist, last.t - ms) || hist[0];
  if (ref === last) return null;
  return { delta: last[key] - ref[key], hours: (last.t - ref.t) / HOUR };
}

// fullHours içindeki noktalar olduğu gibi kalır; daha eskiler saatte bire indirilir.
function trimHistory(hist, now, fullHours, maxDays) {
  const out = [];
  let lastBucket = null;
  for (const p of hist) {
    const age = now - p.t;
    if (age > maxDays * 24 * HOUR) continue;
    if (age > fullHours * HOUR) {
      const bucket = Math.floor(p.t / HOUR);
      if (bucket === lastBucket) continue;
      lastBucket = bucket;
    }
    out.push(p);
  }
  return out;
}

// --- Bildirimler ---

const EVENT_STYLE = {
  milestone: { priority: 5, tags: ['tada', 'partying_face'] },
  spike_video: { priority: 4, tags: ['fire', 'chart_with_upwards_trend'] },
  spike_channel: { priority: 4, tags: ['rocket'] },
  subs_jump: { priority: 4, tags: ['busts_in_silhouette'] },
  new_video: { priority: 3, tags: ['clapper'] },
  daily: { priority: 3, tags: ['bar_chart'] },
  test: { priority: 3, tags: ['white_check_mark'] },
};

async function sendNtfy(ev) {
  if (!env.NTFY_TOPIC) return;
  const style = EVENT_STYLE[ev.type] || {};
  const res = await fetch((env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, ''), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(env.NTFY_TOKEN ? { Authorization: `Bearer ${env.NTFY_TOKEN}` } : {}) },
    body: JSON.stringify({
      topic: env.NTFY_TOPIC,
      title: ev.title,
      message: ev.body,
      priority: style.priority,
      tags: style.tags,
      click: ev.url || env.DASHBOARD_URL || undefined,
      icon: ev.icon || undefined,
    }),
  });
  if (!res.ok) throw new Error(`ntfy ${res.status}: ${await res.text()}`);
}

async function sendTelegram(ev) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const link = ev.url || env.DASHBOARD_URL;
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text: `${ev.title}\n\n${ev.body}${link ? `\n\n${link}` : ''}`,
      disable_notification: (EVENT_STYLE[ev.type]?.priority ?? 3) < 4,
    }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
}

async function emit(state, ev) {
  const event = { id: `${ev.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, t: Date.now(), ...ev };
  state.events = [event, ...(state.events || [])].slice(0, MAX_EVENTS);
  console.log(`[bildirim] ${event.title} — ${event.body.replace(/\n/g, ' | ')}`);
  const results = await Promise.allSettled([sendNtfy(event), sendTelegram(event)]);
  for (const r of results) if (r.status === 'rejected') console.warn(`Bildirim gönderilemedi: ${r.reason.message}`);
}

function milestoneMessage(m, channel) {
  if (m === 1000) {
    return {
      title: `🎉🎉 1000 ABONE! ${channel.title}`,
      body:
        'Tebrikler! 1000 abone barajını geçtin 🏆\n' +
        'Para kazanma (YPP) için büyük eşik tamam — şimdi 4000 saat izlenme ya da 10M Shorts izlenmesi hedefi. Devam! 🚀',
    };
  }
  return {
    title: `🎉 ${fmt(m)} abone! ${channel.title}`,
    body: `Kanal ${fmt(m)} aboneyi geçti. Şu an: ${fmt(channel.subs)} abone. Harika gidiyorsun! 🥳`,
  };
}

function localParts(now, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

// --- Ana akış ---

async function processChannel(state, cfg, item, videos, latestIds, now) {
  const a = cfg.alerts;
  const cooldown = a.cooldownHours * HOUR;
  const c = (state.channels[item.id] ??= { id: item.id, history: [], videos: {}, alerts: {}, celebrated: null });
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
    lastSeen: now,
  });
  c.history.push({ t: now, s: c.subs ?? 0, v: c.views, n: c.videoCount });
  c.history = trimHistory(c.history, now, 48, 120);

  // Abone hedefleri — ilk çalıştırmada geçilmiş olanlar sessizce işaretlenir.
  if (c.subs != null) {
    const reached = cfg.milestones.filter((m) => c.subs >= m);
    if (firstRun) c.celebrated = reached;
    else {
      for (const m of reached) {
        if (c.celebrated.includes(m)) continue;
        c.celebrated.push(m);
        await emit(state, { type: 'milestone', milestone: m, channelId: c.id, url: c.url, icon: c.thumb, ...milestoneMessage(m, c) });
      }
    }
  } else c.celebrated ??= [];

  // Videolar
  const prevVideos = c.videos || {};
  const nextVideos = {};
  let videoSpiked = false;
  for (const vid of latestIds) {
    const v = videos.get(vid);
    if (!v) continue;
    const old = prevVideos[vid];
    const s = v.statistics || {};
    const rec = {
      id: vid,
      title: v.snippet.title,
      thumb: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || null,
      publishedAt: v.snippet.publishedAt,
      duration: isoDurationSeconds(v.contentDetails?.duration),
      live: v.snippet.liveBroadcastContent !== 'none' ? v.snippet.liveBroadcastContent : null,
      views: Number(s.viewCount || 0),
      likes: s.likeCount != null ? Number(s.likeCount) : null,
      comments: s.commentCount != null ? Number(s.commentCount) : null,
      hist: [...(old?.hist || []), { t: now, v: Number(s.viewCount || 0) }],
      lastAlert: old?.lastAlert || 0,
    };
    rec.hist = trimHistory(rec.hist, now, 48, 14);
    nextVideos[vid] = rec;
    const url = `https://www.youtube.com/watch?v=${vid}`;

    if (!old && !firstRun && a.newVideo && now - Date.parse(rec.publishedAt) < 48 * HOUR) {
      await emit(state, {
        type: 'new_video', channelId: c.id, videoId: vid, url, icon: c.thumb,
        title: `🎬 Yeni video: ${c.title}`,
        body: `${rec.title}\nİlk saatlerini takip ediyorum, sıçrama olursa haber veririm.`,
      });
    }

    const spike = detectSpike(rec.hist, 'v', a.videoMinViewsPerHour, a.spikeMultiplier);
    if (spike && now - rec.lastAlert > cooldown) {
      rec.lastAlert = now;
      videoSpiked = true;
      await emit(state, {
        type: 'spike_video', channelId: c.id, videoId: vid, url, icon: c.thumb,
        title: `🔥 Video uçuşta: ${rec.title}`,
        body:
          `Saatte ~${fmt(spike.recentRate)} izlenme` +
          (spike.ratio ? ` (normalin ${spike.ratio.toFixed(1)} katı)` : ' (önceden neredeyse hiç izlenmiyordu)') +
          `.\nToplam: ${fmt(rec.views)} izlenme · ${c.title}`,
      });
    }
  }
  c.videos = nextVideos;
  c.latest = latestIds.filter((id) => nextVideos[id]);

  // Kanal geneli izlenme sıçraması (yakın zamanda bir video bildirildiyse tekrar etme)
  videoSpiked ||= Object.values(nextVideos).some((v) => now - v.lastAlert <= cooldown);
  const chSpike = detectSpike(c.history, 'v', a.channelMinViewsPerHour, a.spikeMultiplier);
  if (chSpike && !videoSpiked && now - (c.alerts.views || 0) > cooldown) {
    c.alerts.views = now;
    await emit(state, {
      type: 'spike_channel', channelId: c.id, url: c.url, icon: c.thumb,
      title: `🚀 İzlenme patlaması: ${c.title}`,
      body: `Kanal saatte ~${fmt(chSpike.recentRate)} izlenme alıyor` + (chSpike.ratio ? ` (normalin ${chSpike.ratio.toFixed(1)} katı).` : '.'),
    });
  }

  // Abone artışı
  const subsGain = gainSince(c.history, 's', HOUR);
  if (c.subs != null && subsGain && subsGain.hours >= 0.5 && subsGain.hours <= 3 && subsGain.delta >= a.subsPerHour && now - (c.alerts.subs || 0) > cooldown) {
    c.alerts.subs = now;
    await emit(state, {
      type: 'subs_jump', channelId: c.id, url: c.url, icon: c.thumb,
      title: `👥 Abone yağıyor: ${c.title}`,
      body: `Son ${subsGain.hours < 1.25 ? 'bir saatte' : `${subsGain.hours.toFixed(1)} saatte`} ${signed(subsGain.delta)} abone. Şu an ${fmt(c.subs)}.`,
    });
  }
}

async function dailyReport(state, cfg, now) {
  const { date, hour } = localParts(now, cfg.timezone);
  if (hour < cfg.dailyReportHour || state.lastDailyReport === date) return;
  const channels = Object.values(state.channels).filter((c) => cfg.channelIds.includes(c.id));
  const enough = channels.filter((c) => c.history.length > 1 && now - c.history[0].t >= 6 * HOUR);
  state.lastDailyReport = date;
  if (!enough.length) return;

  const lines = enough.map((c) => {
    const s = gainSince(c.history, 's', 24 * HOUR);
    const v = gainSince(c.history, 'v', 24 * HOUR);
    let top = null;
    for (const vid of Object.values(c.videos)) {
      const g = gainSince(vid.hist, 'v', 24 * HOUR);
      if (g && (!top || g.delta > top.g.delta)) top = { vid, g };
    }
    return (
      `📺 ${c.title}\n` +
      `   ${c.subs != null ? `${fmt(c.subs)} abone (${signed(s?.delta || 0)})` : 'Abone sayısı gizli'} · ${fmt(c.views)} izlenme (${signed(v?.delta || 0)})` +
      (top && top.g.delta > 0 ? `\n   🔝 ${top.vid.title} (${signed(top.g.delta)})` : '')
    );
  });
  await emit(state, { type: 'daily', title: '📊 Günlük YouTube raporu', body: `Son 24 saat:\n\n${lines.join('\n\n')}` });
}

async function main() {
  const cfg = await loadConfig();
  await mkdir(DATA_DIR, { recursive: true });
  const state = await readJson(STATE_PATH, { channels: {}, events: [] });
  state.channels ??= {};
  const now = Date.now();
  let failed = null;

  if (env.TEST_NOTIFICATION === 'true') {
    await emit(state, {
      type: 'test',
      title: '✅ Test bildirimi',
      body: 'YouTube takip sistemi çalışıyor. Sıçrama, yeni video ve abone hedefi bildirimleri buraya gelecek.',
    });
  }

  try {
    if (!env.YT_API_KEY) throw new Error('YT_API_KEY tanımlı değil. Depo ayarlarından Actions secret olarak ekleyin.');
    if (!cfg.channels.length) throw new Error('Takip edilecek kanal yok. yt/config.json içindeki "channels" listesine kanal ekleyin.');

    const items = await fetchChannels(cfg.channels, state);
    if (!items.length) throw new Error('Listede geçerli bir kanal bulunamadı. Kanal linklerini / @kullanıcı adlarını kontrol edin.');
    cfg.channelIds = items.map((i) => i.id);

    const latest = new Map();
    for (const item of items) {
      const uploads = item.contentDetails?.relatedPlaylists?.uploads;
      latest.set(item.id, uploads ? await fetchLatestVideoIds(uploads, cfg.trackLatestVideos) : []);
    }
    const videos = await fetchVideos([...latest.values()].flat());
    for (const item of items) await processChannel(state, cfg, item, videos, latest.get(item.id), now);

    // Listeden çıkarılan kanalları uygulamada gösterme
    for (const id of Object.keys(state.channels)) if (!cfg.channelIds.includes(id)) delete state.channels[id];
    state.order = cfg.channelIds;

    await dailyReport(state, cfg, now);
  } catch (err) {
    failed = err;
    console.error(err.message);
  }

  state.updatedAt = now;
  state.error = failed ? failed.message : null;
  state.config = { milestones: cfg.milestones, timezone: cfg.timezone, alerts: cfg.alerts };
  await writeFile(STATE_PATH, JSON.stringify(state));
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
