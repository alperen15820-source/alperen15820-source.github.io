// Geçmiş noktaları dizi olarak saklanır: kanal [t, abone, izlenme], video [t, izlenme].
export const HOUR = 3600e3;
export const DAY = 24 * HOUR;
export const S = 1;
export const V = 2;

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

// Son ~1 saatlik artış hızı ve önceki 24 saatin ortalama hızı. Eşikleri her
// kullanıcı kendi ayarına göre uygular (isSpike).
export function spikeMetrics(hist, k) {
  if (hist.length < 3) return null;
  const last = hist[hist.length - 1];
  const ref = pointAtOrBefore(hist, last[0] - HOUR);
  if (!ref || last[0] - ref[0] > 3 * HOUR) return null;
  const recentRate = (last[k] - ref[k]) / ((last[0] - ref[0]) / HOUR);
  const base = pointAtOrBefore(hist, ref[0] - DAY) || hist[0];
  const baseHours = (ref[0] - base[0]) / HOUR;
  if (baseHours < 3) return null;
  const baseRate = Math.max((ref[k] - base[k]) / baseHours, 0);
  return { recentRate, baseRate, ratio: baseRate > 0 ? recentRate / baseRate : null };
}

export function isSpike(m, minPerHour, multiplier) {
  return Boolean(m) && m.recentRate >= minPerHour && m.recentRate >= multiplier * Math.max(m.baseRate, 1);
}

// tiers: [[yaşSınırıMs, aralıkMs], ...] — en yeniden eskiye. Sınırı aşan noktalar atılır.
export function downsample(hist, now, tiers) {
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

// YouTube API politikası gereği istatistikler en fazla 30 gün saklanır.
export const CHANNEL_TIERS = [[6 * HOUR, 0], [7 * DAY, HOUR], [30 * DAY, 6 * HOUR]];
export const VIDEO_TIERS = [[3 * HOUR, 0], [48 * HOUR, HOUR]];
