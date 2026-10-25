// YouTube Data API v3 çağrıları. Birim maliyetleri: channels/videos/playlistItems = 1.
const API = 'https://www.googleapis.com/youtube/v3';

export class YouTubeError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function call(env, endpoint, params) {
  const url = new URL(`${API}/${endpoint}`);
  for (const [k, v] of Object.entries({ ...params, key: env.YT_API_KEY })) url.searchParams.set(k, v);
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new YouTubeError(`YouTube API ${endpoint} ${res.status}: ${body.error?.message || res.statusText}`, res.status);
  return body;
}

export function parseRef(ref) {
  const s = String(ref).trim();
  if (/^UC[\w-]{22}$/.test(s)) return { id: s };
  const byId = s.match(/channel\/(UC[\w-]{22})/);
  if (byId) return { id: byId[1] };
  const byHandle = s.match(/@([^/?#\s]+)/);
  if (byHandle) return { handle: '@' + byHandle[1].toLowerCase() };
  if (!s || /[\s/]/.test(s.replace(/^https?:\/\/(www\.|m\.)?youtube\.com\//i, ''))) return null;
  return { handle: '@' + s.replace(/^https?:\/\/(www\.|m\.)?youtube\.com\//i, '').replace(/^@/, '').toLowerCase() };
}

const PARTS = 'snippet,statistics,contentDetails';

export async function channelByHandle(env, handle) {
  const r = await call(env, 'channels', { part: PARTS, forHandle: handle });
  return r.items?.[0] || null;
}

export async function channelsById(env, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const r = await call(env, 'channels', { part: PARTS, id: ids.slice(i, i + 50).join(','), maxResults: 50 });
    for (const item of r.items || []) out.set(item.id, item);
  }
  return out;
}

export async function latestVideoIds(env, playlistId, max) {
  try {
    const r = await call(env, 'playlistItems', { part: 'contentDetails', playlistId, maxResults: max });
    return (r.items || []).map((i) => i.contentDetails.videoId);
  } catch (err) {
    if (err.status === 404) return []; // henüz videosu olmayan kanal
    throw err;
  }
}

export async function videosById(env, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const r = await call(env, 'videos', { part: 'snippet,statistics,contentDetails', id: ids.slice(i, i + 50).join(','), maxResults: 50 });
    for (const item of r.items || []) out.set(item.id, item);
  }
  return out;
}

export function isoDurationSeconds(d) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || '');
  if (!m) return null;
  const [, days, h, min, s] = m.map((x) => Number(x) || 0);
  return days * 86400 + h * 3600 + min * 60 + s;
}
