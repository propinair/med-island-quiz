// ================================================================
// MEDITERRANEAN ISLAND QUIZ — app.js
// Loads data from data/islands.json and data/questions.json
// Photos served via Pexels Cloudflare Worker proxy
// ================================================================

const PHOTO_API = 'https://photo-proxy.ionel-banut.workers.dev';

const COUNTRY_CODES  = { Greece:'gr', France:'fr', Italy:'it', Spain:'es', Malta:'mt', Cyprus:'cy' };
const COUNTRY_COLORS = { Greece:'#1a6fa8', France:'#002395', Italy:'#009246', Spain:'#c60b1e', Malta:'#cf101a', Cyprus:'#ff6600' };

// ── Runtime state ─────────────────────────────────────────────
let ISLANDS   = {};
let ISLAND_KEYS = [];
let QUESTIONS = [];
let answers   = {};
let currentQ  = 0;
let detailFromScreen = 'screen-results';
const PHOTO_CACHE = {};

// ── Boot: load both data files in parallel ────────────────────
async function boot() {
  try {
    const [islandsRes, questionsRes] = await Promise.all([
      fetch('data/islands.json'),
      fetch('data/questions.json'),
    ]);
    if (!islandsRes.ok || !questionsRes.ok) throw new Error('Failed to load data files');
    ISLANDS   = await islandsRes.json();
    QUESTIONS = await questionsRes.json();
    ISLAND_KEYS = Object.keys(ISLANDS);
  } catch (err) {
    document.getElementById('app-loading').innerHTML =
      `<div style="text-align:center;padding:40px;color:#c00">
        <div style="font-size:40px;margin-bottom:12px">⚠️</div>
        <div style="font-weight:700;margin-bottom:8px">Could not load island data</div>
        <div style="font-size:13px;color:#666">This app requires a web server.<br>
        Run: <code>python3 -m http.server</code> then open <a href="http://localhost:8000">localhost:8000</a></div>
      </div>`;
    return;
  }
  // Hide loading overlay and show app
  document.getElementById('app-loading').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', boot);

// ── SCORING ───────────────────────────────────────────────────
// Q1 (country preference) is a hard filter — only islands from the
// chosen country appear in results. "any" disables filtering.
// All other questions add raw point scores per island.
// Scores are normalised against each island's theoretical maximum
// so percentages are always 0–100%.
function calculateScores() {
  const raw = {};
  ISLAND_KEYS.forEach(k => raw[k] = 0);

  let chosenCountryKey = 'any';
  if (answers[0] !== undefined) {
    const opt = QUESTIONS[0].options[answers[0]];
    if (opt) chosenCountryKey = opt.country_key || 'any';
  }

  // Accumulate points from every non-country question
  Object.entries(answers).forEach(([qi, oi]) => {
    const qIdx = parseInt(qi);
    if (qIdx === 0) return;
    const opt = QUESTIONS[qIdx]?.options[oi];
    if (!opt) return;
    Object.entries(opt.scores || {}).forEach(([island, pts]) => {
      if (raw[island] !== undefined) raw[island] += pts;
    });
  });

  // Compute theoretical maximum per island (best possible answer every question)
  const maxPossible = {};
  ISLAND_KEYS.forEach(k => {
    let total = 0;
    QUESTIONS.forEach((q, qi) => {
      if (qi === 0) return;
      let best = 0;
      q.options.forEach(o => { const pts = (o.scores || {})[k] || 0; if (pts > best) best = pts; });
      total += best;
    });
    maxPossible[k] = total;
  });

  // Normalise; hard-filter non-matching countries to 0
  const pct = {};
  ISLAND_KEYS.forEach(k => {
    const isl = ISLANDS[k];
    if (chosenCountryKey !== 'any' && isl.country_key !== chosenCountryKey) {
      pct[k] = 0; return;
    }
    pct[k] = maxPossible[k] > 0 ? Math.min(100, Math.round((raw[k] / maxPossible[k]) * 100)) : 0;
  });
  return pct;
}

function getTopIslands(scores) {
  return ISLAND_KEYS
    .map(k => ({ key: k, pct: scores[k] }))
    .filter(x => x.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3);
}

// ── PHOTO FETCHING ────────────────────────────────────────────
async function fetchPhoto(query) {
  if (!query) return null;
  if (PHOTO_CACHE[query] !== undefined) return PHOTO_CACHE[query];
  try {
    const res = await fetch(PHOTO_API + '?q=' + encodeURIComponent(query), { cache: 'force-cache' });
    if (!res.ok) throw 0;
    const data = await res.json();
    return (PHOTO_CACHE[query] = data.url || null);
  } catch (e) { return (PHOTO_CACHE[query] = null); }
}

function applyPhoto(container, url) {
  if (!container || !url) return;
  const ex = container.querySelector('img'); if (ex) ex.remove();
  const img = document.createElement('img');
  img.src = url; img.referrerPolicy = 'no-referrer';
  img.onload = () => {
    img.style.opacity = '1';
    container.classList.add('loaded');
    const ph = container.querySelector('.photo-loading'); if (ph) ph.style.display = 'none';
  };
  img.onerror = () => img.remove();
  container.appendChild(img);
}

function loadPhotoMulti(container, queries) {
  let i = 0;
  const tryNext = () => {
    if (i >= queries.length) return;
    fetchPhoto(queries[i++]).then(url => { if (url) applyPhoto(container, url); else tryNext(); });
  };
  tryNext();
}

function flagURL(country) {
  return 'https://flagcdn.com/40x30/' + (COUNTRY_CODES[country] || 'eu') + '.png';
}

// ── SCREEN MANAGEMENT ─────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

// ── ROLL THE DICE ─────────────────────────────────────────────
function rollDice() {
  const key = ISLAND_KEYS[Math.floor(Math.random() * ISLAND_KEYS.length)];
  detailFromScreen = 'screen-welcome';
  openDetail(key);
}

// ── QUIZ FLOW ─────────────────────────────────────────────────
const LOADING_MSGS = [
  { e:'🔮', t:'Consulting the Oracle of Delphi...' },
  { e:'🏺', t:'Searching ancient Minoan records...' },
  { e:'⚡', t:'Asking Zeus for guidance...' },
  { e:'🌊', t:'Reading the Aegean currents...' },
  { e:'🌿', t:'Checking ferry schedules...' },
  { e:'⛵', t:'Navigating by the stars like Odysseus...' },
  { e:'🍷', t:'Pouring a libation to Dionysus...' },
  { e:'⚓', t:'The Knights of Malta have deliberated...' },
  { e:'🏛️', t:'Aphrodite is weighing your heart...' },
  { e:'🍋', t:'Consulting the Sicilian fishermen...' },
];

function startQuiz() {
  currentQ = 0; answers = {};
  buildQuizSteps(); renderQuestion(); showScreen('screen-question');
}

function buildQuizSteps() {
  const wrap = document.getElementById('quiz-steps'); if (!wrap) return; wrap.innerHTML = '';
  QUESTIONS.forEach((q, i) => {
    const div = document.createElement('div');
    div.className = 'quiz-step' + (i === 0 ? ' active' : ''); div.id = 'quiz-step-' + i;
    div.innerHTML = `<div class="quiz-step-num">${i+1}</div><span>${q.category}</span>`;
    wrap.appendChild(div);
  });
}

function updateQuizSteps() {
  QUESTIONS.forEach((q, i) => {
    const el = document.getElementById('quiz-step-' + i); if (!el) return;
    el.className = 'quiz-step' + (i === currentQ ? ' active' : i < currentQ ? ' done' : '');
  });
}

function renderQuestion() {
  const q = QUESTIONS[currentQ], total = QUESTIONS.length, pct = Math.round((currentQ / total) * 100);
  document.getElementById('q-category').textContent = q.category;
  document.getElementById('q-text').textContent = q.text;
  document.getElementById('q-hint').textContent = q.hint || '';
  document.getElementById('progress-label').textContent = `Question ${currentQ + 1} of ${total}`;
  document.getElementById('progress-fill').style.width = pct + '%';
  // Mobile progress bar
  const mpText = document.getElementById('mobile-progress-text');
  const mpCat  = document.getElementById('mobile-progress-cat');
  const mpFill = document.getElementById('mobile-progress-fill');
  if (mpText) mpText.textContent = `Question ${currentQ + 1} of ${total}`;
  if (mpCat)  mpCat.textContent  = q.category;
  if (mpFill) mpFill.style.width = pct + '%';
  document.getElementById('btn-prev').style.display = currentQ === 0 ? 'none' : '';
  const nb = document.getElementById('btn-next');
  nb.textContent = currentQ === total - 1 ? 'See my results 🏆' : 'Next →';
  nb.disabled = answers[currentQ] === undefined;
  const c = document.getElementById('options-container'); c.innerHTML = '';
  q.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn' + (answers[currentQ] === i ? ' selected' : '');
    // For country question, use flag images instead of emoji (Windows compatibility)
    const isCountryQ = QUESTIONS[currentQ].is_country_q;
    const COUNTRY_KEY_CODES = {greece:'gr',italy:'it',france:'fr',spain:'es',malta:'mt',cyprus:'cy'};
    const emojiHTML = (isCountryQ && opt.country_key && opt.country_key !== 'any')
      ? `<img src="https://flagcdn.com/32x24/${COUNTRY_KEY_CODES[opt.country_key]||'eu'}.png" style="height:20px;border-radius:3px;vertical-align:middle" onerror="this.style.display='none'">`
      : opt.emoji;
    btn.innerHTML = `<span class="option-emoji">${emojiHTML}</span><span>${opt.text}</span>`;
    btn.onclick = () => selectOption(i); c.appendChild(btn);
  });
  updateQuizSteps();
}

function selectOption(i) {
  answers[currentQ] = i;
  document.querySelectorAll('.option-btn').forEach((b, idx) => b.classList.toggle('selected', idx === i));
  document.getElementById('btn-next').disabled = false;
}

function nextQuestion() {
  if (answers[currentQ] === undefined) return;
  if (currentQ < QUESTIONS.length - 1) { currentQ++; renderQuestion(); } else showResults();
}
function prevQuestion() { if (currentQ > 0) { currentQ--; renderQuestion(); } }

function showResults() {
  showScreen('screen-loading');
  const msg = LOADING_MSGS[Math.floor(Math.random() * LOADING_MSGS.length)];
  document.getElementById('loading-emoji').textContent = msg.e;
  document.getElementById('loading-msg').textContent = msg.t;
  setTimeout(() => {
    buildResults(); showScreen('screen-results'); launchConfetti();
    setTimeout(() => { const el = document.getElementById('winner-bar'); if (el) el.style.width = (el.dataset.target || '0%'); }, 300);
  }, 2200);
}

// ── BUILD RESULTS ─────────────────────────────────────────────
function buildResults() {
  const scores = calculateScores(), top3 = getTopIslands(scores);
  if (!top3.length) return;
  const winner = top3[0], isl = ISLANDS[winner.key];

  const hw = document.getElementById('winner-hero-wrap'); hw.innerHTML = ''; hw.appendChild(buildHeroGrid(winner.key, isl));
  const fi = document.getElementById('winner-flag-img'); if (fi) { fi.src = flagURL(isl.country); fi.alt = isl.country; }
  document.getElementById('winner-name').textContent = isl.name + ' ' + isl.emoji;
  document.getElementById('winner-tagline').textContent = isl.tagline;
  document.getElementById('winner-pct').textContent = winner.pct + '% match';
  const bar = document.getElementById('winner-bar'); bar.style.width = '0%'; bar.dataset.target = winner.pct + '%';
  document.getElementById('winner-desc').textContent = isl.description.split('\n')[0];
  document.getElementById('winner-time').textContent = isl.best_time;
  document.getElementById('winner-budget').textContent = isl.budget;
  const aw = document.getElementById('winner-activities'); aw.innerHTML = '';
  isl.activities.forEach(a => { const p = document.createElement('span'); p.className = 'activity-pill'; p.textContent = a; aw.appendChild(p); });
  document.getElementById('winner-funfact').textContent = isl.funfact;
  document.getElementById('winner-explore').onclick = () => { detailFromScreen = 'screen-results'; openDetail(winner.key); };

  const rc = document.getElementById('runners-container'); rc.innerHTML = '';
  ['🥈','🥉'].forEach((medal, i) => {
    if (!top3[i+1]) return;
    const r = top3[i+1], ri = ISLANDS[r.key];
    const card = document.createElement('div'); card.className = 'runner-card';
    const pw = document.createElement('div'); pw.className = 'runner-photo-wrap';
    pw.innerHTML = `<div class="photo-loading" style="font-size:42px;opacity:0.5">${ri.emoji}</div>`;
    const body = document.createElement('div'); body.className = 'runner-body';
    const cc = COUNTRY_CODES[ri.country] || 'eu';
    body.innerHTML = `
      <div class="runner-header">
        <span class="runner-medal">${medal}</span>
        <div>
          <div class="runner-name">${ri.name} <img src="https://flagcdn.com/24x18/${cc}.png" alt="${ri.country}" style="height:14px;border-radius:2px;vertical-align:middle;margin-left:4px" onerror="this.style.display='none'"></div>
          <div class="runner-tagline">${ri.tagline}</div>
        </div>
      </div>
      <div class="match-bar-wrap">
        <div class="match-bar-label"><span>Match score</span><span class="match-pct">${r.pct}%</span></div>
        <div class="match-bar-bg"><div class="match-bar-fill" style="width:${r.pct}%"></div></div>
      </div>
      <p style="font-size:13px;color:var(--text-mid);line-height:1.6;margin-bottom:12px">${ri.description.split('\n')[0].substring(0, 160)}…</p>
      <div style="font-size:12px;color:var(--text-light);margin-bottom:8px">📅 ${ri.best_time} &nbsp;|&nbsp; 💰 ${ri.budget}</div>`;
    const btn = document.createElement('button'); btn.className = 'btn-outline';
    btn.style.cssText = 'width:100%;margin-top:4px;font-size:13px;padding:10px 16px';
    btn.textContent = `🗺️ Explore ${ri.name} →`;
    btn.onclick = () => { detailFromScreen = 'screen-results'; openDetail(r.key); };
    body.appendChild(btn); card.appendChild(pw); card.appendChild(body); rc.appendChild(card);
    // Use first curated hero photo if available, else fall back to Worker
    if (ri.hero_photos && ri.hero_photos[0]) {
      applyPhoto(pw, ri.hero_photos[0]);
    } else {
      loadPhotoMulti(pw, [ri.best_hero, ri.name]);
    }
  });
}

// ── HERO GRID ─────────────────────────────────────────────────
function buildHeroGrid(key, isl) {
  const photos  = isl.hero_photos  || [];
  const queries = isl.hero_queries || [isl.name];
  const count   = Math.max(photos.length, Math.min(queries.length, 5));
  const grid = document.createElement('div');
  // Use a 4-cell layout class if only 4 photos, 5-cell otherwise
  grid.className = count <= 4 ? 'hero-grid hero-grid-4' : 'hero-grid';
  queries.slice(0, count).forEach((q, idx) => {
    const cell = document.createElement('div'); cell.className = 'hero-cell';
    cell.innerHTML = `<div class="photo-loading">${isl.emoji}</div>`;
    grid.appendChild(cell);
    cell.onclick = () => window.open(googleImgURL(q, isl.name), '_blank');
    if (photos[idx]) {
      applyPhoto(cell, photos[idx]);
    } else {
      const cleaned = q.replace(/\s*\([^)]*\)/g, '').trim();
      loadPhotoMulti(cell, [q, cleaned + ' ' + isl.country, cleaned, isl.name]);
    }
  });
  return grid;
}

// ── ALL ISLANDS GRID ──────────────────────────────────────────
function showAllIslands() {
  const grid = document.getElementById('all-islands-grid'); grid.innerHTML = '';
  ISLAND_KEYS.forEach(key => {
    const isl = ISLANDS[key], cc = COUNTRY_CODES[isl.country] || 'eu', ac = COUNTRY_COLORS[isl.country] || 'var(--blue)';
    const bubble = document.createElement('div'); bubble.className = 'island-bubble'; bubble.style.borderColor = ac + '44';
    bubble.onclick = () => { detailFromScreen = 'screen-all-islands'; openDetail(key); };
    bubble.innerHTML = `
      <div class="bubble-icon-area">
        <div class="bubble-emoji-large">${isl.emoji}</div>
        <img class="bubble-flag-img" src="https://flagcdn.com/40x30/${cc}.png"
          srcset="https://flagcdn.com/80x60/${cc}.png 2x"
          alt="${isl.country}" onerror="this.style.display='none'">
      </div>
      <div class="bubble-country-badge" style="background:${ac}">${isl.country}</div>
      <div class="bubble-name">${isl.name}</div>
      <div class="bubble-tagline">${isl.tagline}</div>`;
    grid.appendChild(bubble);
  });
  const backBtn = document.getElementById('all-islands-back');
  if (backBtn) backBtn.textContent = (Object.keys(answers).length === 0 || detailFromScreen === 'screen-welcome') ? '← Back to Home' : '← Back to Results';
  showScreen('screen-all-islands');
}

function backFromAllIslands() {
  showScreen(Object.keys(answers).length === 0 || detailFromScreen === 'screen-welcome' ? 'screen-welcome' : 'screen-results');
}

// ── ISLAND DETAIL ─────────────────────────────────────────────
function openDetail(key) {
  const isl = ISLANDS[key];
  const lbl = detailFromScreen === 'screen-welcome' ? '← Back to Home' : detailFromScreen === 'screen-all-islands' ? '← All Islands' : '← Back to Results';
  document.getElementById('detail-back-btn').textContent = lbl;
  const dfi = document.getElementById('detail-flag-img'); if (dfi) { dfi.src = flagURL(isl.country); dfi.alt = isl.country; }
  document.getElementById('detail-name').textContent = isl.name + ' ' + isl.emoji;
  document.getElementById('detail-tagline').textContent = isl.tagline;
  const hw = document.getElementById('detail-hero-wrap'); hw.innerHTML = ''; hw.appendChild(buildHeroGrid(key, isl));
  buildTabs(key, isl); showScreen('screen-detail');
}

// buildGallery removed

// ── TABS ──────────────────────────────────────────────────────
function buildTabs(key, isl) {
  const tabs = [
    { id:'overview',    label:'📋 Overview' },
    { id:'sights',      label:'🏛️ Sights' },
    { id:'beaches',     label:'🏖️ Beaches' },
    { id:'restaurants', label:'🍽️ Eat' },
    { id:'travel',      label:'🚗 Get Around' },
    { id:'stay',        label:'🏠 Stay' },
    { id:'tips',        label:'⚠️ Tips' },
  ];
  const tb = document.getElementById('tab-bar'); tb.innerHTML = '';
  const pw = document.getElementById('tab-panels'); pw.innerHTML = '';
  tabs.forEach((tab, idx) => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (idx === 0 ? ' active' : '');
    btn.textContent = tab.label; btn.dataset.tabId = tab.id; btn.onclick = () => switchTab(tab.id); tb.appendChild(btn);
    const panel = document.createElement('div');
    panel.className = 'tab-panel' + (idx === 0 ? ' active' : '');
    panel.id = 'panel-' + tab.id; panel.innerHTML = buildTabContent(tab.id, key, isl); pw.appendChild(panel);
  });
  initTabClickHandler();
}

// Scroll to panel top when switching tabs
function switchTab(id) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tabId === id));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + id));
  const panel = document.getElementById('panel-' + id);
  if (panel) {
    const rect = panel.getBoundingClientRect(), scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    // On mobile the tab bar is sticky at top (~52px); on desktop offset 90px
    const isMobile = window.innerWidth <= 480;
    const offset = isMobile ? 56 : 90;
    window.scrollTo({ top: scrollTop + rect.top - offset, behavior: 'smooth' });
  }
}

// Delegated click handler: item names open TripAdvisor (restaurants) or Google Images
function initTabClickHandler() {
  const panels = document.getElementById('tab-panels');
  if (!panels || panels._delegated) return; panels._delegated = true;
  panels.addEventListener('click', e => {
    const el = e.target.closest('[data-search]'); if (!el) return; e.stopPropagation();
    const search = el.getAttribute('data-search') || '', island = el.getAttribute('data-island') || '';
    const isTA = el.getAttribute('data-tripadvisor');
    if (!search) return;
    window.open(isTA ? 'https://www.tripadvisor.com/Search?q=' + encodeURIComponent(search) : googleImgURL(search, island), '_blank');
  });
}

// loadAllThumbs removed — thumbnails now use emoji placeholders

function backFromDetail() { showScreen(detailFromScreen || 'screen-results'); }

// ── TAB CONTENT ───────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function googleImgURL(item, island) {
  return 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent((item + ' ' + island + ' travel').trim());
}
function dots(n, filled) {
  return Array.from({length:n}, (_, i) => `<div class="dot${i < filled ? ' filled' : ''}"></div>`).join('');
}

function taRating(rating, reviews) {
  const full = Math.floor(rating), half = (rating - full) >= 0.5 ? 1 : 0, empty = 5 - full - half;
  const b = (n, cls) => Array.from({length:n}, () => `<div class="ta-bubble${cls ? (' ' + cls) : ''}"></div>`).join('');
  return `<div class="ta-rating-row"><span class="ta-wordmark">Tripadvisor</span><div class="ta-bubbles">${b(full,'') + b(half,'half') + b(empty,'empty')}</div><span class="ta-score">${rating.toFixed(1)}</span><span class="ta-reviews">(${reviews})</span></div>`;
}

function seaTempChart(isl) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const temps = isl.sea_temps_c || [16,15,16,17,20,23,25,26,25,22,19,17];
  const fahr = c => Math.round(c * 9/5 + 32);
  const W = 520, H = 170, PAD = {top:32, right:16, bottom:36, left:34};
  const chartW = W - PAD.left - PAD.right, chartH = H - PAD.top - PAD.bottom;
  const minT = Math.min(...temps) - 2, maxT = Math.max(...temps) + 2, range = maxT - minT;
  const xScale = i => PAD.left + (i / (temps.length - 1)) * chartW;
  const yScale = t => PAD.top + chartH - ((t - minT) / range) * chartH;
  let gridLines = '';
  for (let t = Math.ceil(minT/5)*5; t <= maxT; t += 5) {
    const y = yScale(t).toFixed(1);
    gridLines += `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="#e8eef4" stroke-width="1"/>`;
    gridLines += `<text x="${PAD.left - 4}" y="${(parseFloat(y)+4).toFixed(1)}" text-anchor="end" font-size="9" fill="#9ab0c4">${t}°</text>`;
  }
  const pts = temps.map((t,i) => `${xScale(i).toFixed(1)},${yScale(t).toFixed(1)}`).join(' ');
  let dots2 = '', labels = '';
  temps.forEach((t, i) => {
    const x = parseFloat(xScale(i).toFixed(1)), y = parseFloat(yScale(t).toFixed(1));
    dots2 += `<circle cx="${x}" cy="${y}" r="2.5" fill="#e05c2a"/>`;
    const anchor = i === 0 ? 'start' : i === temps.length - 1 ? 'end' : 'middle';
    labels += `<text x="${x}" y="${(y - 16).toFixed(1)}" text-anchor="${anchor}" font-size="8.5" font-weight="600" fill="#e05c2a">${t}°C/${fahr(t)}°F</text>`;
    labels += `<text x="${x}" y="${H - 5}" text-anchor="middle" font-size="9" fill="#6b8096">${months[i]}</text>`;
  });
  const svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">${gridLines}<polyline points="${pts}" fill="none" stroke="#e05c2a" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${dots2}${labels}</svg>`;
  return `<div class="sea-temp-chart"><div class="sea-temp-title">🌊 Average Sea Temperature — All Year (°C / °F)</div>${svg}</div>`;
}

function buildTabContent(id, key, isl) {
  if (id === 'overview') {
    const paras = isl.description.split('\n').filter(Boolean);
    const descHTML = paras.map(p => `<p class="overview-text">${esc(p)}</p>`).join('');
    return `<div class="detail-section">${descHTML}<div class="funfact-box-inline"><div class="ff-label">🤓 Fun fact</div><p>${esc(isl.funfact)}</p></div><div class="overview-grid"><div class="overview-stat"><div class="overview-stat-label">📅 Best time</div><div class="overview-stat-value">${esc(isl.best_time)}</div></div><div class="overview-stat"><div class="overview-stat-label">💰 Budget</div><div class="overview-stat-value">${esc(isl.budget)}</div></div><div class="overview-stat"><div class="overview-stat-label">🏙️ Largest city</div><div class="overview-stat-value">${esc(isl.largest_city)} (pop. ${esc(isl.city_population)})</div></div><div class="overview-stat"><div class="overview-stat-label">✈️ Airport(s)</div><div class="overview-stat-value">${esc((isl.airports||[]).join(' · '))}</div></div><div class="overview-stat"><div class="overview-stat-label">⛴️ Ferry</div><div class="overview-stat-value">${esc(isl.ferry)}</div></div><div class="overview-stat"><div class="overview-stat-label">📊 Annual tourists</div><div class="overview-stat-value">${esc(isl.annual_tourists)}</div></div></div></div><div class="detail-section"><div class="detail-section-title">🗺️ Location & Geography</div><div class="map-wrap"><iframe loading="lazy" src="https://maps.google.com/maps?q=${encodeURIComponent(isl.map_q)}&z=${isl.map_zoom}&output=embed" allowfullscreen title="${esc(isl.name)} map"></iframe></div></div>`;
  }
  if (id === 'sights') {
    return '<div class="detail-section"><div class="detail-section-title">Must-see sights & experiences</div>' +
      isl.sights.map(s => `<div class="detail-card"><div class="item-card-row"><div class="item-thumb">${s.emoji||isl.emoji}</div><div class="item-content"><span class="item-name-link" data-search="${esc(s.name)}" data-island="${esc(isl.name)}">${esc(s.name)}</span><p class="item-sub">${esc(s.desc)}</p><span class="item-tag ${s.tag==='must'?'tag-must':s.tag==='hidden'?'tag-hidden':'tag-popular'}">${s.tag==='must'?'✈️ Must-see':s.tag==='hidden'?'🌿 Hidden gem':'⭐ Popular'}</span></div></div></div>`).join('') + '</div>';
  }
  if (id === 'beaches') {
    return '<div class="detail-section"><div class="detail-section-title">Top beaches</div>' +
      isl.beaches.map(b => `<div class="detail-card"><div class="item-card-row"><div class="item-thumb" data-q="${esc(b.pexels_q||b.name)}" data-isl="${esc(isl.name)}">🏖️</div><div class="item-content"><span class="item-name-link" data-search="${esc(b.name)}" data-island="${esc(isl.name)}">🏖️ ${esc(b.name)}</span><div class="sand-type">${esc(b.sand)}</div><p class="item-sub">${esc(b.desc)}</p></div></div><div class="beach-ratings"><div><div class="beach-rating-label">Access</div><div class="dots">${dots(5,b.access)}</div></div><div><div class="beach-rating-label">Swim quality</div><div class="dots">${dots(5,b.swim)}</div></div><div><div class="beach-rating-label">Crowds</div><div class="dots">${dots(5,b.crowd)}</div></div></div></div>`).join('') + seaTempChart(isl) + '</div>';
  }
  if (id === 'restaurants') {
    return '<div class="detail-section"><div class="detail-section-title">Top 10 restaurants</div>' +
      isl.restaurants.map((r,i) => `<div class="detail-card"><div class="rest-row" style="margin-bottom:6px"><div style="flex:1;min-width:0"><div class="rest-num">#${i+1} · ${esc(r.location)}</div><span class="item-name-link" data-search="${esc(r.name+' '+r.location)}" data-island="${esc(isl.name)}" data-tripadvisor="1">${esc(r.name)}</span><div class="rest-cuisine">${esc(r.cuisine)}</div>${taRating(r.ta_rating||4.0,r.ta_reviews||'500')}</div><div style="text-align:right;flex-shrink:0;padding-left:8px"><span class="price-tag">${esc(r.price)}</span></div></div><p class="item-sub">${esc(r.note)}</p></div>`).join('') + '</div>';
  }
  if (id === 'travel') {
    return '<div class="detail-section"><div class="detail-section-title">Getting around & rentals</div>' +
      isl.rentals.map(r => `<div class="rental-card"><div style="flex:1"><div class="rental-type-label">${esc(r.type)}</div><div class="rental-name">${esc(r.name)}</div><div class="rental-desc">${esc(r.desc)}</div></div><div class="rental-price">${esc(r.price)}</div></div>`).join('') + '</div>';
  }
  if (id === 'stay') {
    return '<div class="detail-section"><div class="detail-section-title">Best places to stay</div>' +
      isl.accommodation.map(a => `<div class="accom-card"><div class="accom-town item-name-link" data-search="${esc(a.town+' '+isl.name)}" data-island="${esc(isl.name)}">📍 ${esc(a.town)}</div><div class="accom-why">${esc(a.why)}</div><div class="accom-tags">${a.tags.map(t=>`<span class="accom-tag">${esc(t)}</span>`).join('')}</div></div>`).join('') + '</div>';
  }
  if (id === 'tips') {
    return '<div class="detail-section"><div class="detail-section-title">Things to know before you go</div>' +
      isl.tips.map(t => `<div class="tip-card ${t.type}"><div class="tip-icon">${t.icon}</div><div class="tip-content"><strong>${esc(t.title)}</strong>${esc(t.text)}</div></div>`).join('') + '</div>';
  }
  return '';
}

// ── CONFETTI ──────────────────────────────────────────────────
function launchConfetti() {
  const colors = ['#1a6fa8','#0e8c7a','#f5c842','#e85d4a','#a259e6','#42c4e8','#f58c42'];
  for (let i = 0; i < 90; i++) setTimeout(() => {
    const el = document.createElement('div'); el.className = 'confetti-piece';
    el.style.left = Math.random() * 100 + 'vw';
    el.style.background = colors[Math.floor(Math.random() * colors.length)];
    el.style.width = (Math.random() * 8 + 6) + 'px'; el.style.height = el.style.width;
    el.style.borderRadius = Math.random() > .5 ? '50%' : '2px';
    el.style.animationDuration = (Math.random() * 2 + 2.5) + 's';
    document.body.appendChild(el); setTimeout(() => el.remove(), 5000);
  }, i * 40);
}

// ── RESTART / REDO ────────────────────────────────────────────
function confirmRestart() {
  if (Object.keys(answers).length > 0 && !confirm('Start completely over? This will reset all your answers.')) return;
  currentQ = 0; answers = {}; showScreen('screen-welcome');
}
function redoQuiz() {
  if (confirm('Go back and change your answers?')) {
    currentQ = 0; answers = {}; buildQuizSteps(); renderQuestion(); showScreen('screen-question');
  }
}
