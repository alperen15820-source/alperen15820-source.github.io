// ?demo ile açıldığında gerçek veri yerine örnek veri üretir (kurulum öncesi önizleme).
const HOUR = 3600e3;

function series(now, days, start, perDay, noise, burstAt) {
  const out = [];
  let s = start.s, v = start.v;
  for (let t = now - days * 24 * HOUR; t <= now; t += t < now - 48 * HOUR ? HOUR : HOUR / 6) {
    const step = t < now - 48 * HOUR ? 1 : 1 / 6;
    const burst = burstAt && now - t < burstAt ? 6 : 1;
    s += Math.max(0, (perDay.s / 24) * step * (1 + (Math.random() - 0.5) * noise) * (burst > 1 ? 2 : 1));
    v += Math.max(0, (perDay.v / 24) * step * (1 + (Math.random() - 0.5) * noise) * burst);
    out.push({ t, s: Math.round(s), v: Math.round(v), n: 0 });
  }
  return out;
}

function video(id, title, ageHours, views, rate, now, spiking) {
  const hist = [];
  for (let t = now - Math.min(ageHours, 48) * HOUR, v = views - rate * Math.min(ageHours, 48); t <= now; t += HOUR / 6) {
    v += (rate / 6) * (spiking && now - t < HOUR ? 8 : 1);
    hist.push({ t, v: Math.round(v) });
  }
  return {
    id, title, thumb: null,
    publishedAt: new Date(now - ageHours * HOUR).toISOString(),
    duration: 30 + Math.round(Math.random() * 600),
    views: hist.at(-1).v, likes: Math.round(views * 0.04), comments: Math.round(views * 0.004),
    hist, lastAlert: spiking ? now - 20 * 60e3 : 0,
  };
}

export function makeDemoState() {
  const now = Date.now();
  const a = series(now, 30, { s: 640, v: 41000 }, { s: 12, v: 900 }, 0.8, 1.2 * HOUR);
  const b = series(now, 30, { s: 11800, v: 2.1e6 }, { s: 25, v: 6000 }, 0.5);
  const va = [
    video('demo1', 'Yapay zekâ ile 1 günde 10 Shorts ürettim', 20, 6400, 260, now, true),
    video('demo2', 'Faceless kanal açmak: sıfırdan rehber', 96, 3100, 22, now),
    video('demo3', 'En çok izlenen 5 otomasyon aracı', 200, 1800, 6, now),
  ];
  const vb = [
    video('demo4', 'Günün en ilginç 10 bilgisi', 5, 8200, 1500, now),
    video('demo5', 'Bunları biliyor muydun? #shorts', 60, 41000, 300, now),
  ];
  const mk = (id, title, hist, vids) => ({
    id, title, handle: '@' + id, thumb: null, url: 'https://www.youtube.com',
    subs: hist.at(-1).s, views: hist.at(-1).v, videoCount: 40 + vids.length,
    history: hist, celebrated: [], alerts: {},
    videos: Object.fromEntries(vids.map((v) => [v.id, v])), latest: vids.map((v) => v.id),
  });
  return {
    updatedAt: now - 3 * 60e3,
    error: null,
    order: ['otomasyonkanali', 'bilgikutusu'],
    config: { milestones: [100, 250, 500, 1000, 2000, 5000, 10000, 25000, 50000, 100000], alerts: { cooldownHours: 3 } },
    channels: {
      otomasyonkanali: mk('otomasyonkanali', 'Otomasyon Kanalı', a, va),
      bilgikutusu: mk('bilgikutusu', 'Bilgi Kutusu', b, vb),
    },
    events: [
      { id: 'e1', t: now - 4 * 60e3, type: 'milestone', milestone: 1000, channelId: 'otomasyonkanali', title: '🎉🎉 1000 ABONE! Otomasyon Kanalı', body: 'Tebrikler! 1000 abone barajını geçtin 🏆\nPara kazanma (YPP) için büyük eşik tamam — şimdi 4000 saat izlenme ya da 10M Shorts izlenmesi hedefi. Devam! 🚀' },
      { id: 'e2', t: now - 20 * 60e3, type: 'spike_video', channelId: 'otomasyonkanali', videoId: 'demo1', title: '🔥 Video uçuşta: Yapay zekâ ile 1 günde 10 Shorts ürettim', body: 'Saatte ~2.080 izlenme (normalin 8,0 katı).\nToplam: 6.400 izlenme · Otomasyon Kanalı' },
      { id: 'e3', t: now - 5 * HOUR, type: 'new_video', channelId: 'bilgikutusu', videoId: 'demo4', title: '🎬 Yeni video: Bilgi Kutusu', body: 'Günün en ilginç 10 bilgisi\nİlk saatlerini takip ediyorum, sıçrama olursa haber veririm.' },
      { id: 'e4', t: now - 22 * HOUR, type: 'daily', title: '📊 Günlük YouTube raporu', body: 'Son 24 saat:\n\n📺 Otomasyon Kanalı\n   985 abone (+14) · 52.100 izlenme (+1.020)' },
    ],
  };
}
