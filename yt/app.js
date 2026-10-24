// Kanal Takip — GitHub Actions'ın "yt-data" dalına yazdığı state.json'u okuyup gösterir.
const HOUR = 3600e3;
const DAY = 24 * HOUR;
const REFRESH_MS = 2 * 60e3;
const nf = new Intl.NumberFormat('tr-TR');
const cf = new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 1 });
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => (n == null ? '—' : nf.format(Math.round(n)));
const compact = (n) => (n == null ? '—' : n < 10000 ? nf.format(n) : cf.format(n));
const signed = (n) => (n == null ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '±') + compact(Math.abs(Math.round(n))));
const trend = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'muted');

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* özel mod */ } },
};

let state = null;
let loadError = null;
let selected = store.get('yt.sel', 'all');
let chartMetric = store.get('yt.metric', 's');
let chartRange = store.get('yt.range', 7);

function ago(t) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'az önce';
  if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
  if (s < 86400) return `${Math.floor(s / 3600)} sa önce`;
  return `${Math.floor(s / 86400)} gün önce`;
}

function duration(sec) {
  if (sec == null) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`;
}

function pointAtOrBefore(hist, t) {
  let found = null;
  for (const p of hist) {
    if (p.t <= t) found = p;
    else break;
  }
  return found;
}

function gain(hist, key, ms) {
  if (!hist?.length) return null;
  const last = hist[hist.length - 1];
  const ref = pointAtOrBefore(hist, last.t - ms) || hist[0];
  if (ref === last) return null;
  return { delta: last[key] - ref[key], hours: (last.t - ref.t) / HOUR };
}

function perHour(hist, key) {
  const g = gain(hist, key, HOUR);
  return g && g.hours >= 0.25 ? g.delta / g.hours : null;
}

function dataUrl() {
  if (params.get('data')) return params.get('data');
  const host = location.hostname;
  if (host.endsWith('.github.io')) return `https://raw.githubusercontent.com/${host.split('.')[0]}/${host}/yt-data/state.json`;
  return '../data/state.json';
}

async function load() {
  const btn = $('#refresh');
  btn.classList.add('spin');
  try {
    if (DEMO) {
      state = (await import('./demo.js')).makeDemoState();
    } else {
      const res = await fetch(`${dataUrl()}?t=${Math.floor(Date.now() / 60e3)}`, { cache: 'no-store' });
      if (res.status === 404) throw Object.assign(new Error('Henüz veri yok'), { notReady: true });
      if (!res.ok) throw new Error(`Veri alınamadı (${res.status})`);
      state = await res.json();
    }
    loadError = null;
  } catch (err) {
    loadError = err;
  } finally {
    btn.classList.remove('spin');
  }
  render();
  maybeCelebrate();
}

function channels() {
  if (!state) return [];
  const order = state.order || Object.keys(state.channels);
  return order.map((id) => state.channels[id]).filter(Boolean);
}

function goalFor(subs) {
  const ms = state?.config?.milestones || [100, 250, 500, 1000, 2000, 5000, 10000, 25000, 50000, 100000];
  const next = ms.find((m) => m > subs);
  if (!next) return null;
  const prev = [...ms].reverse().find((m) => m <= subs) || 0;
  return { next, prev, pct: Math.min(100, ((subs - prev) / (next - prev)) * 100), left: next - subs };
}

function goalHtml(c) {
  if (c.subs == null) return '<p class="goal-note">Abone sayısı gizli olduğu için hedef takibi yapılamıyor.</p>';
  const g = goalFor(c.subs);
  if (!g) return '<p class="goal-note">Tüm hedefler tamamlandı 🏆</p>';
  const daily = gain(c.history, 's', DAY);
  const rate = daily && daily.hours >= 6 ? daily.delta / (daily.hours / 24) : null;
  const eta = rate > 0 ? Math.ceil(g.left / rate) : null;
  return `
    <div class="goal ${g.next === 1000 ? 'gold' : ''}">
      <div class="goal-row"><b>${g.next === 1000 ? '🏆 ' : '🎯 '}${fmt(g.next)} abone hedefi</b><span>${fmt(g.left)} kaldı</span></div>
      <div class="bar"><i style="width:${g.pct.toFixed(1)}%"></i></div>
      <p class="goal-note">${
        g.next === 1000 ? 'Para kazanma programının (YPP) ilk şartı. ' : ''
      }${eta ? `Bu hızla yaklaşık ${eta <= 1 ? '1 gün' : `${fmt(eta)} gün`} içinde.` : 'Ulaştığında kutlama bildirimi gelecek 🎉'}</p>
    </div>`;
}

function renderTabs() {
  const list = channels();
  const tabs = $('#tabs');
  if (list.length < 2) {
    tabs.innerHTML = '';
    tabs.hidden = true;
    if (list.length === 1) selected = list[0].id;
    return;
  }
  tabs.hidden = false;
  if (selected !== 'all' && !state.channels[selected]) selected = 'all';
  tabs.innerHTML =
    `<button class="tab" role="tab" data-id="all" aria-selected="${selected === 'all'}"><span>Tümü</span></button>` +
    list
      .map((c) => `<button class="tab" role="tab" data-id="${esc(c.id)}" aria-selected="${selected === c.id}">${c.thumb ? `<img src="${esc(c.thumb)}" alt="">` : ''}<span>${esc(c.title)}</span></button>`)
      .join('');
}

function setupNotice() {
  const err = loadError?.notReady ? null : loadError;
  return `
    <section class="card notice">
      <h2>${err ? 'Veri yüklenemedi' : 'Kurulum neredeyse bitti 👋'}</h2>
      <p>${err ? esc(err.message) : 'İlk veriler henüz gelmedi. Takip sistemi ilk kez çalıştığında bu ekran dolacak.'}</p>
      <ol>
        <li><code>yt/config.json</code> dosyasına kanallarını ekle (ör. <code>"@kanaladin"</code>).</li>
        <li>Depo ayarlarında <b>Secrets → Actions</b> kısmına <code>YT_API_KEY</code> ve <code>NTFY_TOPIC</code> ekle.</li>
        <li><b>Actions → YouTube Takip → Run workflow</b> ile ilk çalıştırmayı başlat.</li>
      </ol>
      <div class="btn-row">
        <a class="btn" href="https://github.com/${esc(location.hostname.split('.')[0])}/${esc(location.hostname)}/blob/main/yt/KURULUM.md">Kurulum rehberi</a>
        <a class="btn secondary" href="?demo">Demoyu gör</a>
      </div>
    </section>`;
}

function overviewHtml(list) {
  return `
    <section class="card">
      <h3>Kanallarım</h3>
      <div class="overview">
        ${list
          .map((c) => {
            const s = gain(c.history, 's', DAY);
            const g = c.subs != null ? goalFor(c.subs) : null;
            return `
              <button class="ov" data-open="${esc(c.id)}" style="background:none;border:0;padding:0">
                <img src="${esc(c.thumb || 'icons/icon.svg')}" alt="">
                <div style="min-width:0">
                  <h2>${esc(c.title)}</h2>
                  <span class="muted" style="font-size:12px">${compact(c.views)} izlenme · ${fmt(c.videoCount)} video</span>
                  ${g ? `<div class="bar"><i style="width:${g.pct.toFixed(1)}%"></i></div>` : ''}
                </div>
                <div class="num">${compact(c.subs)}<small class="${trend(s?.delta)}">${signed(s?.delta ?? 0)} / 24s</small></div>
              </button>`;
          })
          .join('')}
      </div>
    </section>`;
}

function channelHtml(c) {
  const s24 = gain(c.history, 's', DAY);
  const v24 = gain(c.history, 'v', DAY);
  const v1 = perHour(c.history, 'v');
  const s7 = gain(c.history, 's', 7 * DAY);
  return `
    <section class="card">
      <div class="channel-hero">
        <img src="${esc(c.thumb || 'icons/icon.svg')}" alt="">
        <div style="min-width:0">
          <a href="${esc(c.url)}" target="_blank" rel="noopener"><h2>${esc(c.title)}</h2></a>
          <span class="muted" style="font-size:13px">${esc(c.handle || '')}</span>
        </div>
      </div>
      <div class="subs-big">${fmt(c.subs)}</div>
      <div class="subs-label">abone · <span class="${trend(s24?.delta)}">${signed(s24?.delta ?? 0)} son 24 saat</span></div>
      ${goalHtml(c)}
    </section>

    <section class="stats">
      <div class="stat"><b>${compact(c.views)}</b><span>Toplam izlenme</span></div>
      <div class="stat"><b class="${trend(v24?.delta)}">${signed(v24?.delta ?? 0)}</b><span>İzlenme / 24 saat</span></div>
      <div class="stat"><b>${v1 == null ? '—' : compact(Math.round(v1))}</b><span>İzlenme / saat (şu an)</span></div>
      <div class="stat"><b class="${trend(s7?.delta)}">${signed(s7?.delta ?? 0)}</b><span>Abone / 7 gün</span></div>
    </section>

    <section class="card">
      <div class="chart-controls">
        <div class="seg" data-seg="metric">
          <button data-v="s" aria-pressed="${chartMetric === 's'}">Abone</button>
          <button data-v="v" aria-pressed="${chartMetric === 'v'}">İzlenme</button>
        </div>
        <div class="seg" data-seg="range">
          <button data-v="1" aria-pressed="${chartRange === 1}">24s</button>
          <button data-v="7" aria-pressed="${chartRange === 7}">7g</button>
          <button data-v="30" aria-pressed="${chartRange === 30}">30g</button>
          <button data-v="120" aria-pressed="${chartRange === 120}">Tümü</button>
        </div>
      </div>
      <div class="chart" id="chart"></div>
    </section>

    <section class="card">
      <div class="card-head"><h3>Son videolar</h3><span class="muted" style="font-size:12px">${fmt(c.videoCount)} video</span></div>
      <div class="videos">${videosHtml(c)}</div>
    </section>

    ${eventsHtml(c.id)}`;
}

function videosHtml(c) {
  const vids = (c.latest || []).map((id) => c.videos[id]).filter(Boolean);
  if (!vids.length) return '<p class="muted">Henüz video yok.</p>';
  const spikeMs = (state.config?.alerts?.cooldownHours || 3) * HOUR;
  return vids
    .map((v) => {
      const rate = perHour(v.hist, 'v');
      const d24 = gain(v.hist, 'v', DAY);
      const hot = v.lastAlert && Date.now() - v.lastAlert < spikeMs;
      return `
        <a class="video" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener">
          <div class="thumb">${v.thumb ? `<img src="${esc(v.thumb)}" alt="" loading="lazy">` : ''}${v.duration ? `<span class="dur">${duration(v.duration)}</span>` : ''}</div>
          <div style="min-width:0">
            <h4>${esc(v.title)}</h4>
            <div class="meta">
              <span>${compact(v.views)} izlenme</span>
              ${v.likes != null ? `<span>👍 ${compact(v.likes)}</span>` : ''}
              ${v.comments != null ? `<span>💬 ${compact(v.comments)}</span>` : ''}
              <span>${ago(Date.parse(v.publishedAt))}</span>
            </div>
            <div class="meta">
              ${rate != null ? `<span>${compact(Math.round(rate))}/saat</span>` : ''}
              ${d24 && d24.delta ? `<span class="${trend(d24.delta)}">${signed(d24.delta)} / 24s</span>` : ''}
            </div>
            ${hot ? '<span class="badge">🔥 Sıçrama</span>' : ''}
            ${v.live === 'live' ? '<span class="badge">🔴 Canlı</span>' : ''}
          </div>
        </a>`;
    })
    .join('');
}

const EVENT_ICON = { milestone: '🎉', spike_video: '🔥', spike_channel: '🚀', subs_jump: '👥', new_video: '🎬', daily: '📊', test: '✅' };

function eventsHtml(channelId) {
  const evs = (state.events || []).filter((e) => !channelId || !e.channelId || e.channelId === channelId).slice(0, 30);
  return `
    <section class="card">
      <h3>Bildirimler</h3>
      ${
        evs.length
          ? `<ul class="events">${evs
              .map(
                (e) => `
            <li class="event">
              <div class="ico">${EVENT_ICON[e.type] || '🔔'}</div>
              <div>
                ${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener" style="text-decoration:none">` : ''}<b>${esc(e.title)}</b>${e.url ? '</a>' : ''}
                <p>${esc(e.body)}</p>
                <time>${ago(e.t)}</time>
              </div>
            </li>`,
              )
              .join('')}</ul>`
          : '<p class="muted">Henüz bildirim yok. Sıçrama, yeni video ve hedefler burada listelenecek.</p>'
      }
    </section>`;
}

function render() {
  const app = $('#app');
  $('#updated').textContent = state?.updatedAt
    ? `${DEMO ? 'Demo · ' : ''}Güncellendi: ${ago(state.updatedAt)}`
    : loadError ? 'Bağlantı yok' : 'Yükleniyor…';
  renderTabs();
  const list = channels();
  let html = '';
  if (state?.updatedAt && !DEMO && Date.now() - state.updatedAt > HOUR)
    html += `<section class="card notice"><h2>Takip durmuş olabilir</h2><p>Veriler ${ago(state.updatedAt)} güncellendi. GitHub'da <b>Actions → YouTube Takip</b> iş akışının açık olduğunu kontrol et.</p></section>`;
  if (state?.error) html +=`<section class="card notice"><h2>Takip uyarısı</h2><p>${esc(state.error)}</p></section>`;
  if (!list.length) {
    app.innerHTML = html + setupNotice();
    return;
  }
  if (selected === 'all' && list.length > 1) html += overviewHtml(list) + eventsHtml(null);
  else html += channelHtml(state.channels[selected] || list[0]);
  app.innerHTML = html;
  const c = state.channels[selected] || (list.length === 1 ? list[0] : null);
  if (c && $('#chart')) drawChart($('#chart'), c);
}

function drawChart(el, c) {
  const key = chartMetric;
  const now = c.history.at(-1)?.t || Date.now();
  const pts = c.history.filter((p) => p.t >= now - chartRange * DAY);
  if (pts.length < 2) {
    el.innerHTML = '<div class="empty-chart">Grafik için biraz daha veri birikmesi gerekiyor.<br>Her 10 dakikada bir yeni nokta ekleniyor.</div>';
    return;
  }
  const W = el.clientWidth || 320, H = el.clientHeight || 180, padL = 4, padR = 4, padT = 24, padB = 18;
  const t0 = pts[0].t, t1 = pts.at(-1).t;
  let lo = Math.min(...pts.map((p) => p[key])), hi = Math.max(...pts.map((p) => p[key]));
  if (lo === hi) { lo -= 1; hi += 1; }
  const x = (t) => padL + ((t - t0) / (t1 - t0 || 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  const area = `${d}L${x(t1).toFixed(1)},${H - padB}L${x(t0).toFixed(1)},${H - padB}Z`;
  const dateFmt = new Intl.DateTimeFormat('tr-TR', chartRange <= 1 ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' });
  const tipFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${key === 's' ? 'Abone' : 'İzlenme'} grafiği">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity="0.28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
      <line class="grid" x1="0" x2="${W}" y1="${y(hi)}" y2="${y(hi)}"/>
      <line class="grid" x1="0" x2="${W}" y1="${y(lo)}" y2="${y(lo)}"/>
      <text x="${padL}" y="${y(hi) - 5}">${compact(hi)}</text>
      <text x="${padL}" y="${y(lo) - 5}">${compact(lo)}</text>
      <path d="${area}" fill="url(#g)"/>
      <path class="line" d="${d}"/>
      <text x="${padL}" y="${H - 3}">${dateFmt.format(t0)}</text>
      <text x="${W - padR}" y="${H - 3}" text-anchor="end">${dateFmt.format(t1)}</text>
      <g id="cur" style="display:none"><line class="cursor" y1="${padT}" y2="${H - padB}"/><circle class="dot" r="4.5"/></g>
    </svg>
    <div class="tip" style="display:none"></div>`;
  const svg = $('svg', el), cur = $('#cur', el), tip = $('.tip', el);
  const show = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const t = t0 + ((px - padL) / (W - padL - padR)) * (t1 - t0);
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    const cx = x(best.t), cy = y(best[key]);
    cur.style.display = '';
    $('line', cur).setAttribute('x1', cx);
    $('line', cur).setAttribute('x2', cx);
    $('circle', cur).setAttribute('cx', cx);
    $('circle', cur).setAttribute('cy', cy);
    tip.style.display = '';
    tip.style.left = `${Math.min(Math.max((cx / W) * 100, 15), 85)}%`;
    tip.textContent = `${fmt(best[key])} · ${tipFmt.format(best.t)}`;
  };
  const hide = () => { cur.style.display = 'none'; tip.style.display = 'none'; };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
}

// --- Kutlama ---

function maybeCelebrate() {
  const key = DEMO ? 'yt.demo.celebrated' : 'yt.celebrated';
  const seen = store.get(key, 0);
  const ev = (state?.events || []).find((e) => e.type === 'milestone' && e.t > seen);
  if (!ev) return;
  $('#celebrate-title').textContent = ev.milestone === 1000 ? '1000 ABONE! 🏆' : `${fmt(ev.milestone)} abone!`;
  $('#celebrate-body').textContent = ev.body;
  $('#celebrate').hidden = false;
  confetti($('#confetti'));
  $('#celebrate-close').onclick = () => {
    store.set(key, ev.t);
    $('#celebrate').hidden = true;
  };
}

function confetti(canvas) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  const dpr = devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colors = ['#ff2d3d', '#ffc53d', '#3ddc84', '#4c8dff', '#c86bff', '#ff8a3d'];
  const parts = Array.from({ length: 180 }, () => ({
    x: innerWidth / 2, y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 16 - 4,
    w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  const start = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.cos(t / 120 + p.r));
      ctx.restore();
    }
    if (t - start < 5000 && !$('#celebrate').hidden) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })(start);
}

// --- Olaylar ---

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-id]');
  const open = e.target.closest('[data-open]');
  const seg = e.target.closest('[data-seg] button');
  if (tab || open) {
    selected = (tab || open).dataset.id || open.dataset.open;
    store.set('yt.sel', selected);
    render();
    scrollTo({ top: 0, behavior: 'smooth' });
  } else if (seg) {
    const kind = seg.parentElement.dataset.seg;
    if (kind === 'metric') store.set('yt.metric', (chartMetric = seg.dataset.v));
    else store.set('yt.range', (chartRange = Number(seg.dataset.v)));
    render();
  }
});
$('#refresh').addEventListener('click', load);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && load());
let lastWidth = innerWidth, resizeTimer;
addEventListener('resize', () => {
  if (innerWidth === lastWidth) return; // mobilde adres çubuğu açılıp kapanınca yeniden çizme
  lastWidth = innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => state && render(), 150);
});
setInterval(() => document.visibilityState === 'visible' && load(), REFRESH_MS);

if ('serviceWorker' in navigator && !DEMO) navigator.serviceWorker.register('sw.js').catch(() => {});

$('#app').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
load();
