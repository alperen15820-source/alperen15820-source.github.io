// Kullanıcının diline göre bildirim ve hata metinleri (tr / en).
const nf = { tr: new Intl.NumberFormat('tr-TR'), en: new Intl.NumberFormat('en-US') };

export const lang = (locale) => (String(locale || '').toLowerCase().startsWith('tr') ? 'tr' : 'en');

export function fmt(n, locale) {
  return nf[lang(locale)].format(Math.round(n));
}
export function signed(n, locale) {
  return (n >= 0 ? '+' : '−') + fmt(Math.abs(n), locale);
}
const ratio = (r, l) => (l === 'tr' ? r.toFixed(1).replace('.', ',') : r.toFixed(1));

const T = {
  milestone1000: {
    tr: (c) => ({
      title: `🏆 1000 ABONE — ${c.title}`,
      body: 'Tebrikler! 1000 abone barajı geçildi. Para kazanma (YPP) için ilk büyük şart tamam — sırada 4000 saat izlenme ya da 10M Shorts izlenmesi var. 🚀',
    }),
    en: (c) => ({
      title: `🏆 1,000 SUBSCRIBERS — ${c.title}`,
      body: 'Congrats! You crossed 1,000 subscribers — the first big step toward the YouTube Partner Program. Next up: 4,000 watch hours or 10M Shorts views. 🚀',
    }),
  },
  milestone: {
    tr: (c, m, l) => ({ title: `🎉 ${fmt(m, l)} abone — ${c.title}`, body: `Kanal ${fmt(m, l)} aboneyi geçti. Şu an ${fmt(c.subs, l)} abone.` }),
    en: (c, m, l) => ({ title: `🎉 ${fmt(m, l)} subscribers — ${c.title}`, body: `Your channel passed ${fmt(m, l)} subscribers. Now at ${fmt(c.subs, l)}.` }),
  },
  spikeVideo: {
    tr: (c, v, s, l) => ({
      title: `🔥 Sıçrama — ${v.title}`,
      body: `Saatte ~${fmt(s.recentRate, l)} izlenme` + (s.ratio ? ` (normalin ${ratio(s.ratio, l)} katı)` : '') + `. Toplam ${fmt(v.views, l)} · ${c.title}`,
    }),
    en: (c, v, s, l) => ({
      title: `🔥 Spike — ${v.title}`,
      body: `~${fmt(s.recentRate, l)} views/hour` + (s.ratio ? ` (${ratio(s.ratio, l)}× normal)` : '') + `. Total ${fmt(v.views, l)} · ${c.title}`,
    }),
  },
  spikeChannel: {
    tr: (c, s, l) => ({ title: `🚀 İzlenme patlaması — ${c.title}`, body: `Kanal saatte ~${fmt(s.recentRate, l)} izlenme alıyor` + (s.ratio ? ` (normalin ${ratio(s.ratio, l)} katı).` : '.') }),
    en: (c, s, l) => ({ title: `🚀 View surge — ${c.title}`, body: `Your channel is getting ~${fmt(s.recentRate, l)} views/hour` + (s.ratio ? ` (${ratio(s.ratio, l)}× normal).` : '.') }),
  },
  subsJump: {
    tr: (c, g, l) => ({ title: `👥 Abone yağıyor — ${c.title}`, body: `Son ${g.hours < 1.25 ? 'bir saatte' : `${ratio(g.hours, l)} saatte`} ${signed(g.delta, l)} abone. Şu an ${fmt(c.subs, l)}.` }),
    en: (c, g, l) => ({ title: `👥 Subscribers pouring in — ${c.title}`, body: `${signed(g.delta, l)} subscribers in the last ${g.hours < 1.25 ? 'hour' : `${ratio(g.hours, l)} hours`}. Now at ${fmt(c.subs, l)}.` }),
  },
  newVideo: {
    tr: (c, v) => ({ title: `🎬 Yeni video — ${c.title}`, body: v.title }),
    en: (c, v) => ({ title: `🎬 New video — ${c.title}`, body: v.title }),
  },
  test: {
    tr: () => ({ title: '✅ Test bildirimi', body: 'Kanal Takip çalışıyor. Sıçrama ve hedef bildirimleri buraya gelecek.' }),
    en: () => ({ title: '✅ Test notification', body: 'Kanal Takip is working. Spike and milestone alerts will show up here.' }),
  },
  morningTitle: {
    tr: (s, v, l) => `☀️ Günaydın — dün ${signed(s, l)} abone, ${signed(v, l)} izlenme`,
    en: (s, v, l) => `☀️ Good morning — ${signed(s, l)} subscribers, ${signed(v, l)} views yesterday`,
  },
  morningBest: { tr: (t, g, l) => `En iyi: ${t} (${signed(g, l)})`, en: (t, g, l) => `Top: ${t} (${signed(g, l)})` },
  morningNotable: { tr: (n) => `Son 24 saatte ${n} önemli olay.`, en: (n) => `${n} notable events in the last 24 hours.` },
  morningLine: {
    tr: (c, l) => `${c.title}: ${c.subs != null ? fmt(c.subs, l) : '—'} (${signed(c.subsDelta, l)}) · ${signed(c.viewsDelta, l)} izl.`,
    en: (c, l) => `${c.title}: ${c.subs != null ? fmt(c.subs, l) : '—'} (${signed(c.subsDelta, l)}) · ${signed(c.viewsDelta, l)} views`,
  },
  // Hatalar
  unauthorized: { tr: () => 'Oturum geçersiz. Uygulamayı yeniden açın.', en: () => 'Session invalid. Please reopen the app.' },
  notFound: { tr: (refs) => `Kanal bulunamadı: ${refs}`, en: (refs) => `Channel not found: ${refs}` },
  tooMany: { tr: (n) => `En fazla ${n} kanal takip edebilirsin.`, en: (n) => `You can track up to ${n} channels.` },
  capacity: { tr: () => 'Sunucu şu an kapasitede. Lütfen daha sonra tekrar dene.', en: () => 'The service is at capacity. Please try again later.' },
  rateLimited: { tr: () => 'Çok fazla istek. Biraz bekleyip tekrar dene.', en: () => 'Too many requests. Please wait a moment and try again.' },
  noDevices: { tr: () => 'Bildirim izni verilmemiş ya da cihaz kaydı yok.', en: () => 'Notifications are off or this device is not registered.' },
  pushOff: { tr: () => 'Sunucuda push anahtarları tanımlı değil.', en: () => 'Push keys are not configured on the server.' },
  badRequest: { tr: (m) => `Geçersiz istek: ${m}`, en: (m) => `Invalid request: ${m}` },
};

export function t(locale, key, ...args) {
  const l = lang(locale);
  return T[key][l](...args, l);
}
