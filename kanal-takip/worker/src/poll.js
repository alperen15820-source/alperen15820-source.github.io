// Kanal yoklama ve bildirimleri kullanıcılara dağıtma.
// Her kanal kaç kişi takip ederse etsin bir kez yoklanır; eşikler, bekleme süreleri
// ve dil kullanıcıya özeldir.
import { pushAll } from './apns.js';
import { CHANNEL_TIERS, DAY, HOUR, S, V, VIDEO_TIERS, downsample, gainSince, isSpike, spikeMetrics } from './history.js';
import { t } from './messages.js';
import { channelsById, isoDurationSeconds, latestVideoIds, videosById } from './youtube.js';

export const DEFAULT_PREFS = {
  milestones: [100, 250, 500, 1000, 2000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000],
  alerts: {
    spikeMultiplier: 3,
    videoMinViewsPerHour: 50,
    channelMinViewsPerHour: 100,
    subsPerHour: 10,
    newVideo: true,
    cooldownHours: 3,
  },
  morningFallbackHour: null,
};
export const LATEST_VIDEOS = 10;
const MAX_EVENTS_PER_USER = 100;

export function prefsOf(user) {
  const raw = typeof user.prefs === 'string' ? JSON.parse(user.prefs || '{}') : user.prefs || {};
  return { ...DEFAULT_PREFS, ...raw, alerts: { ...DEFAULT_PREFS.alerts, ...raw.alerts } };
}

// D1 sorgu başına en fazla 100 parametre kabul eder.
export async function selectIn(db, sql, ids, extra = []) {
  const rows = [];
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const q = sql.replace('(?)', `(${chunk.map(() => '?').join(',')})`);
    const r = await db.prepare(q).bind(...extra, ...chunk).all();
    rows.push(...r.results);
  }
  return rows;
}

const newId = (p) => `${p}_${Date.now().toString(36)}${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;

// Kotaya göre yoklama sıklığı (dakika). playlistItems kanal başına 1 birim;
// channels 50 kanalda, videos 50 videoda bir 1 birim. Kotanın %40'ı yeni video
// listesine, %60'ı istatistik yoklamasına ayrılır.
export function schedule(env, channelCount) {
  const quota = Number(env.YT_DAILY_QUOTA || 10000) * 0.9;
  const playlist = Math.max(30, Math.ceil((channelCount * 1440) / (quota * 0.4)));
  const perPoll = Math.ceil(channelCount / 50) + Math.ceil((channelCount * LATEST_VIDEOS) / 50) || 1;
  const poll = Math.max(10, Math.ceil((1440 * perPoll) / (quota * 0.6) / 10) * 10);
  return { poll, playlist };
}

function channelData(item, old) {
  const st = item.statistics || {};
  return {
    ...old,
    id: item.id,
    title: item.snippet.title,
    handle: item.snippet.customUrl || null,
    thumb: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || null,
    url: `https://www.youtube.com/channel/${item.id}`,
    subs: st.hiddenSubscriberCount ? null : Number(st.subscriberCount),
    views: Number(st.viewCount),
    videoCount: Number(st.videoCount),
    uploads: item.contentDetails?.relatedPlaylists?.uploads || null,
  };
}

function videoRecord(v, old, now) {
  const s = v.statistics || {};
  const views = Number(s.viewCount || 0);
  return {
    id: v.id,
    title: v.snippet.title,
    thumb: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || null,
    publishedAt: v.snippet.publishedAt,
    duration: isoDurationSeconds(v.contentDetails?.duration),
    live: v.snippet.liveBroadcastContent !== 'none' ? v.snippet.liveBroadcastContent : null,
    views,
    likes: s.likeCount != null ? Number(s.likeCount) : null,
    comments: s.commentCount != null ? Number(s.commentCount) : null,
    hist: downsample([...(old?.hist || []), [now, views]], now, VIDEO_TIERS),
    lastAlert: old?.lastAlert || 0, // uygulamadaki "Sıçrama" rozeti için
  };
}

/**
 * Verilen kanalları yoklar, kaydeder ve abonelerine olay üretip push gönderir.
 * Dönen değer: { polled, events }
 */
export async function pollChannels(env, ids, { now = Date.now(), force = false } = {}) {
  const db = env.DB;
  if (!ids.length) return { polled: 0, events: 0 };
  const rows = await selectIn(db, 'SELECT id, data, polled_at, playlist_at FROM channels WHERE id IN (?)', ids);
  const stored = new Map(rows.map((r) => [r.id, { data: JSON.parse(r.data || '{}'), polledAt: r.polled_at, playlistAt: r.playlist_at }]));
  const total = (await db.prepare('SELECT COUNT(*) AS n FROM channels').first()).n;
  const { playlist } = schedule(env, total);

  const items = await channelsById(env, ids);
  const latest = new Map();
  const playlistDone = new Set();
  for (const id of ids) {
    const item = items.get(id);
    if (!item) continue;
    const s = stored.get(id);
    const due = force || !s?.playlistAt || now - s.playlistAt >= playlist * 60e3 - 60e3 || !s.data.latest;
    const uploads = item.contentDetails?.relatedPlaylists?.uploads;
    if (due && uploads) {
      latest.set(id, await latestVideoIds(env, uploads, LATEST_VIDEOS));
      playlistDone.add(id);
    } else latest.set(id, s?.data.latest || []);
  }
  const videos = await videosById(env, [...latest.values()].flat());

  const signals = new Map();
  const writes = [];
  for (const id of ids) {
    const item = items.get(id);
    if (!item) continue;
    const prev = stored.get(id)?.data || {};
    const firstPoll = !prev.hist?.length;
    const c = channelData(item, prev);
    c.hist = downsample([...(prev.hist || []), [now, c.subs ?? 0, c.views]], now, CHANNEL_TIERS);

    const ids2 = latest.get(id).filter((v) => videos.has(v));
    const next = {};
    const sig = { channel: c, firstPoll, newVideos: [], videoSpikes: [], channelSpike: null, subsGain: null };
    for (const vid of ids2) {
      const old = prev.videos?.[vid];
      const rec = videoRecord(videos.get(vid), old, now);
      next[vid] = rec;
      if (!old && !firstPoll && now - Date.parse(rec.publishedAt) < 48 * HOUR) sig.newVideos.push(rec);
      const m = spikeMetrics(rec.hist, 1);
      if (m) {
        sig.videoSpikes.push({ video: rec, metrics: m });
        const d = DEFAULT_PREFS.alerts;
        if (isSpike(m, d.videoMinViewsPerHour, d.spikeMultiplier) && now - rec.lastAlert > d.cooldownHours * HOUR) rec.lastAlert = now;
      }
    }
    c.videos = next;
    c.latest = ids2;
    sig.channelSpike = spikeMetrics(c.hist, V);
    const sg = gainSince(c.hist, S, HOUR);
    if (c.subs != null && sg && sg.hours >= 0.5 && sg.hours <= 3) sig.subsGain = sg;
    signals.set(id, sig);

    writes.push(
      db.prepare('INSERT INTO channels (id, data, polled_at, playlist_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, polled_at = excluded.polled_at, playlist_at = excluded.playlist_at')
        .bind(id, JSON.stringify(c), now, playlistDone.has(id) ? now : stored.get(id)?.playlistAt ?? null),
    );
  }
  // YouTube'da bulunamayan (silinmiş) kanallar her turda tekrar sorgulanmasın
  for (const id of ids) if (!items.has(id)) writes.push(db.prepare('UPDATE channels SET polled_at = ? WHERE id = ?').bind(now, id));
  if (writes.length) await db.batch(writes);
  const events = await fanOut(env, signals, now);
  return { polled: signals.size, events };
}

async function fanOut(env, signals, now) {
  const db = env.DB;
  const channelIds = [...signals.keys()];
  if (!channelIds.length) return 0;
  const subs = await selectIn(
    db,
    'SELECT s.user_id, s.channel_id, s.celebrated, u.prefs, u.locale FROM subscriptions s JOIN users u ON u.id = s.user_id WHERE s.channel_id IN (?)',
    channelIds,
  );
  if (!subs.length) return 0;
  const userIds = [...new Set(subs.map((s) => s.user_id))];
  const alertRows = await selectIn(db, 'SELECT user_id, key, t FROM alerts WHERE user_id IN (?)', userIds);
  const cooldowns = new Map(alertRows.map((r) => [`${r.user_id}|${r.key}`, r.t]));

  const writes = [];
  const byUser = new Map();
  const emit = (userId, ev) => {
    const e = { id: newId('ev'), t: now, ...ev };
    if (!byUser.has(userId)) byUser.set(userId, []);
    byUser.get(userId).push(e);
    writes.push(
      db.prepare('INSERT INTO events (id, user_id, t, type, title, body, channel_id, video_id, url, milestone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(e.id, userId, e.t, e.type, e.title, e.body, e.channelId ?? null, e.videoId ?? null, e.url ?? null, e.milestone ?? null),
    );
  };
  const cooled = (userId, key, hours) => now - (cooldowns.get(`${userId}|${key}`) || 0) > hours * HOUR;
  const mark = (userId, key) => {
    cooldowns.set(`${userId}|${key}`, now);
    writes.push(db.prepare('INSERT INTO alerts (user_id, key, t) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET t = excluded.t').bind(userId, key, now));
  };

  for (const s of subs) {
    const sig = signals.get(s.channel_id);
    const c = sig.channel;
    const prefs = prefsOf(s);
    const a = prefs.alerts;
    const l = s.locale;
    const base = { channelId: c.id, channel: c.title };

    // Abone hedefleri — takibe alındığı andaki hedefler sessizce işaretlenir.
    if (c.subs != null) {
      const reached = prefs.milestones.filter((m) => c.subs >= m);
      let celebrated = s.celebrated ? JSON.parse(s.celebrated) : null;
      let changed = false;
      if (celebrated === null) {
        celebrated = reached;
        changed = true;
      } else {
        for (const m of reached) {
          if (celebrated.includes(m)) continue;
          celebrated.push(m);
          changed = true;
          emit(s.user_id, { type: 'milestone', milestone: m, url: c.url, ...base, ...(m === 1000 ? t(l, 'milestone1000', c) : t(l, 'milestone', c, m)) });
        }
      }
      if (changed) writes.push(db.prepare('UPDATE subscriptions SET celebrated = ? WHERE user_id = ? AND channel_id = ?').bind(JSON.stringify(celebrated), s.user_id, s.channel_id));
    }
    if (sig.firstPoll) continue;

    if (a.newVideo)
      for (const v of sig.newVideos) emit(s.user_id, { type: 'new_video', videoId: v.id, url: `https://www.youtube.com/watch?v=${v.id}`, ...base, ...t(l, 'newVideo', c, v) });

    let videoAlerted = false;
    for (const { video, metrics } of sig.videoSpikes) {
      if (!isSpike(metrics, a.videoMinViewsPerHour, a.spikeMultiplier)) continue;
      const key = `v:${video.id}`;
      if (!cooled(s.user_id, key, a.cooldownHours)) {
        videoAlerted = true;
        continue;
      }
      mark(s.user_id, key);
      mark(s.user_id, `vc:${c.id}`);
      videoAlerted = true;
      emit(s.user_id, { type: 'spike_video', videoId: video.id, url: `https://www.youtube.com/watch?v=${video.id}`, ...base, ...t(l, 'spikeVideo', c, video, metrics) });
    }

    // Kanal sıçraması: yakın zamanda bir video bildirildiyse tekrar etme
    const recentVideo = videoAlerted || !cooled(s.user_id, `vc:${c.id}`, a.cooldownHours);
    if (!recentVideo && isSpike(sig.channelSpike, a.channelMinViewsPerHour, a.spikeMultiplier) && cooled(s.user_id, `c:${c.id}`, a.cooldownHours)) {
      mark(s.user_id, `c:${c.id}`);
      emit(s.user_id, { type: 'spike_channel', url: c.url, ...base, ...t(l, 'spikeChannel', c, sig.channelSpike) });
    }

    if (sig.subsGain && sig.subsGain.delta >= a.subsPerHour && cooled(s.user_id, `s:${c.id}`, a.cooldownHours)) {
      mark(s.user_id, `s:${c.id}`);
      emit(s.user_id, { type: 'subs_jump', url: c.url, ...base, ...t(l, 'subsJump', c, sig.subsGain) });
    }
  }

  if (writes.length) await db.batch(writes);
  await pushEvents(env, byUser);
  return [...byUser.values()].reduce((n, list) => n + list.length, 0);
}

const PUSH_STYLE = {
  milestone: ['time-sensitive', 1],
  spike_video: ['time-sensitive', 0.8],
  spike_channel: ['time-sensitive', 0.8],
  subs_jump: ['active', 0.6],
  new_video: ['active', 0.4],
  morning: ['active', 0.7],
  test: ['active', 0.5],
};

export async function pushEvents(env, byUser) {
  const userIds = [...byUser.keys()];
  if (!userIds.length) return;
  const devices = await selectIn(env.DB, 'SELECT token, user_id, env FROM devices WHERE user_id IN (?)', userIds);
  const writes = [];
  for (const [userId, events] of byUser) {
    let list = devices.filter((d) => d.user_id === userId);
    for (const ev of events) {
      const [level, relevance] = PUSH_STYLE[ev.type] || PUSH_STYLE.test;
      const payload = {
        aps: {
          alert: { title: ev.title, body: ev.body },
          sound: 'default',
          'interruption-level': level,
          'relevance-score': relevance,
          ...(ev.channelId ? { 'thread-id': ev.channelId } : {}),
        },
        type: ev.type,
        eventId: ev.id,
        channelId: ev.channelId || null,
        videoId: ev.videoId || null,
        milestone: ev.milestone || null,
      };
      const result = await pushAll(env, list, payload, { collapseId: ev.type === 'morning' ? 'morning' : undefined });
      if (result) {
        for (const d of list) if (!result.keep.includes(d)) writes.push(env.DB.prepare('DELETE FROM devices WHERE token = ?').bind(d.token));
        for (const d of result.moved) writes.push(env.DB.prepare('UPDATE devices SET env = ? WHERE token = ?').bind(d.env, d.token));
        list = result.keep;
      }
    }
  }
  if (writes.length) await env.DB.batch(writes);
}

// Kullanıcı başına olay sayısını sınırla
export async function trimEvents(db, userIds) {
  const writes = userIds.map((id) =>
    db.prepare('DELETE FROM events WHERE user_id = ? AND id NOT IN (SELECT id FROM events WHERE user_id = ? ORDER BY t DESC LIMIT ?)').bind(id, id, MAX_EVENTS_PER_USER),
  );
  if (writes.length) await db.batch(writes);
}

export { DAY };
