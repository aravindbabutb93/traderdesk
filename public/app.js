(() => {
  const $ = (id) => document.getElementById(id);
  const IST = 'Asia/Kolkata';
  const REGIONS = [['IN', 'India'], ['US', 'US'], ['GLOBAL', 'Global'], ['FX', 'Forex']];
  const IMPACTS = ['High', 'Medium', 'Low'];
  const CCYS = ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'AUD', 'CAD'];

  // Any 401 means the session ended: go to the login page
  const api = async (url, opts) => {
    const res = await fetch(url, opts);
    if (res.status === 401) { location.href = '/login.html'; throw new Error('signed out'); }
    return res;
  };

  const prefs = loadPrefs();
  const state = {
    items: [],
    events: [],
    categories: {},
    me: null,
    newIds: new Set(),
    unseen: 0,
  };

  function loadPrefs() {
    const def = { regions: ['IN', 'US', 'GLOBAL', 'FX'], impacts: ['High', 'Medium', 'Low'], ccys: ['INR', 'USD', 'EUR', 'CNY'], category: 'all', watchOnly: false, sound: false };
    try { return { ...def, ...JSON.parse(localStorage.getItem('mn-prefs') || '{}') }; } catch { return def; }
  }
  function savePrefs() { try { localStorage.setItem('mn-prefs', JSON.stringify(prefs)); } catch {} }

  // ---------- formatting ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTime = (ts, opts) => new Intl.DateTimeFormat('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: false, ...opts }).format(new Date(ts));
  const fmtDay = (ts) => new Intl.DateTimeFormat('en-IN', { timeZone: IST, weekday: 'short', day: '2-digit', month: 'short' }).format(new Date(ts));
  const dayKey = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(new Date(ts));

  function ago(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m ago`;
    return fmtDay(ts) + ' ' + fmtTime(ts);
  }

  function countdown(ts) {
    const m = Math.round((ts - Date.now()) / 60000);
    if (m < -1) return 'done';
    if (m <= 0) return 'now';
    if (m < 60) return `in ${m}m`;
    const h = Math.floor(m / 60);
    if (h < 48) return `in ${h}h ${m % 60}m`;
    return `in ${Math.floor(h / 24)}d`;
  }

  // ---------- filters UI ----------
  function chip(label, on, cls, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip ${cls || ''} ${on ? 'on' : ''}`;
    b.textContent = label;
    b.onclick = onClick;
    return b;
  }

  function toggleIn(list, v) {
    const i = list.indexOf(v);
    i >= 0 ? list.splice(i, 1) : list.push(v);
  }

  function renderFilters() {
    const rc = $('regionChips'); rc.innerHTML = '';
    REGIONS.forEach(([v, l]) => rc.appendChild(chip(l, prefs.regions.includes(v), '', () => { toggleIn(prefs.regions, v); savePrefs(); renderFilters(); renderFeed(); })));
    const ic = $('impactChips'); ic.innerHTML = '';
    IMPACTS.forEach((v) => ic.appendChild(chip(v, prefs.impacts.includes(v), v.toLowerCase(), () => { toggleIn(prefs.impacts, v); savePrefs(); renderFilters(); renderFeed(); })));
    const cc = $('calChips'); cc.innerHTML = '';
    CCYS.forEach((v) => cc.appendChild(chip(v, prefs.ccys.includes(v), '', () => { toggleIn(prefs.ccys, v); savePrefs(); renderFilters(); renderCalendar(); })));
    $('watchOnly').checked = prefs.watchOnly;
    $('soundBtn').textContent = prefs.sound ? '🔔 Sound on' : '🔕 Sound off';
  }

  function renderCategoryOptions() {
    const sel = $('categorySel');
    const mine = state.me ? state.me.user.prefs.categories : [];
    const all = state.me ? state.me.options.categories : Object.entries(state.categories).map(([id, label]) => ({ id, label, group: '' }));
    const list = mine.length ? all.filter((c) => mine.includes(c.id)) : all;
    const groups = [...new Set(list.map((c) => c.group))];
    sel.innerHTML = `<option value="all">${mine.length ? 'All my categories' : 'All categories'}</option>` +
      groups.map((g) => `<optgroup label="${esc(g)}">${list.filter((c) => c.group === g).map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}</optgroup>`).join('');
    sel.value = state.categories[prefs.category] ? prefs.category : 'all';
  }

  // ---------- feed ----------
  function visible(it) {
    if (!prefs.impacts.includes(it.impact)) return false;
    if (!it.regions.some((r) => prefs.regions.includes(r))) return false;
    if (prefs.category !== 'all' && !it.categories.includes(prefs.category)) return false;
    if (prefs.watchOnly && !it.watch.length) return false;
    const q = $('search').value.trim().toLowerCase();
    if (q && !(`${it.title} ${it.summary} ${it.source}`.toLowerCase().includes(q))) return false;
    return true;
  }

  function cardHtml(it) {
    const sent = it.sentiment === 'bullish' ? '<span class="sent bullish" title="Headline reads bullish">▲</span>'
      : it.sentiment === 'bearish' ? '<span class="sent bearish" title="Headline reads bearish">▼</span>' : '';
    const tags = [
      ...it.regions.map((r) => `<span class="tag">${esc(r)}</span>`),
      ...it.categories.map((c) => `<span class="tag">${esc(state.categories[c] || c)}</span>`),
      ...it.watch.map((s) => `<span class="tag watch">${esc(s)}</span>`),
    ].join('');
    return `<article class="card ${it.impact} ${state.newIds.has(it.id) ? 'fresh' : ''}">
      <div class="meta">
        <span class="badge ${it.impact}" title="Score ${it.score}: ${esc(it.reasons.join(', '))}">${it.impact}</span>
        ${sent}
        <span>${esc(it.source)}</span>·
        <span title="${fmtDay(it.publishedAt)} ${fmtTime(it.publishedAt)} IST">${ago(it.publishedAt)}</span>
      </div>
      <h3><a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.title)}</a></h3>
      ${it.summary ? `<p>${esc(it.summary.slice(0, 240))}${it.summary.length > 240 ? '…' : ''}</p>` : ''}
      <div class="tags">${tags}</div>
    </article>`;
  }

  function renderFeed() {
    const list = state.items.filter(visible).slice(0, 400);
    $('feed').innerHTML = list.length ? list.map(cardHtml).join('') : '<div class="empty">No news matches these filters yet.</div>';
    $('count').textContent = `${list.length} shown · ${state.items.length} total`;
  }

  // ---------- calendar ----------
  function renderCalendar() {
    const now = Date.now();
    const evs = state.events.filter((e) => e.time > now - 3 * 3600e3 && e.time < now + 4 * 24 * 3600e3 && prefs.ccys.includes(e.country));
    if (!evs.length) { $('calendar').innerHTML = '<div class="muted small">No upcoming events for the selected currencies.</div>'; return; }
    let html = ''; let lastDay = '';
    for (const e of evs) {
      const dk = dayKey(e.time);
      if (dk !== lastDay) { html += `<div class="cal-day">${fmtDay(e.time)}</div>`; lastDay = dk; }
      const mins = (e.time - now) / 60000;
      const cls = mins < -1 ? 'past' : mins <= 30 && e.impact === 'High' ? 'soon' : '';
      const fp = [e.forecast && `F ${esc(e.forecast)}`, e.previous && `P ${esc(e.previous)}`].filter(Boolean).join(' · ');
      html += `<div class="cal-row ${cls}">
        <span>${fmtTime(e.time)}</span>
        <span class="cal-ccy">${esc(e.country)}</span>
        <span><span class="cal-imp ${e.impact}"></span>${esc(e.title)}${fp ? `<div class="cal-fp">${fp}</div>` : ''}</span>
        <span class="cal-cd">${countdown(e.time)}</span>
      </div>`;
    }
    $('calendar').innerHTML = html;
  }

  // ---------- watchlist ----------
  async function loadWatchlist() {
    const list = await (await api('/api/watchlist')).json();
    $('watchlist').innerHTML = list.map((w) =>
      `<span class="wchip" title="${esc((w.aliases || []).join(', '))}">${esc(w.symbol)}<button data-sym="${esc(w.symbol)}" title="Remove">×</button></span>`).join('') || '<span class="muted small">Empty</span>';
  }

  $('watchlist').addEventListener('click', async (e) => {
    const sym = e.target.dataset && e.target.dataset.sym;
    if (!sym) return;
    await api(`/api/watchlist/${encodeURIComponent(sym)}`, { method: 'DELETE' });
    loadWatchlist();
  });

  $('watchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await api('/api/watchlist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: $('watchSymbol').value, aliases: $('watchAliases').value }),
    });
    if (!res.ok) { alert((await res.json()).error || 'Could not add'); return; }
    $('watchSymbol').value = ''; $('watchAliases').value = '';
    loadWatchlist();
  });

  // ---------- status ----------
  async function loadStatus() {
    const s = await (await api('/api/status')).json();
    state.categories = s.categories;
    renderCategoryOptions();
    $('status').textContent = `${s.items} stories · ${s.sourcesOk}/${s.sourcesTotal} sources OK · last poll ${s.lastPoll ? fmtTime(s.lastPoll) : '—'} IST · every ${s.pollSeconds}s (Google ${s.pollSlowSeconds}s)`;
    $('tgStatus').innerHTML = s.telegram ? 'Alerts are ON for your categories. Change them in <a href="/settings.html">Settings</a>.'
      : s.telegramBot ? 'Off. Add your Telegram chat ID in <a href="/settings.html">Settings</a>.' : 'Off. The admin needs to set TELEGRAM_BOT_TOKEN in .env.';
    $('sourcesPanel').hidden = !s.sources;
    if (s.sources) $('sources').innerHTML = s.sources.map((x) => `<li><span class="${x.ok ? 'ok' : x.lastTry ? 'bad' : 'muted'}">●</span>
      <span>${esc(x.name)} <span class="muted">${x.ok ? `(${x.count ?? 0}${x.lagSec != null ? ` · ~${x.lagSec < 120 ? x.lagSec + 's' : Math.round(x.lagSec / 60) + 'm'} lag` : ''})` : ''}</span>${x.error ? `<span class="err">${esc(x.error)}</span>` : ''}</span></li>`).join('');
  }

  // ---------- data loading ----------
  async function loadNews() {
    state.items = await (await api('/api/news?limit=1500')).json();
    renderFeed();
  }
  async function loadCalendar() {
    state.events = await (await api('/api/calendar')).json();
    renderCalendar();
  }

  // ---------- sound ----------
  let audioCtx;
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.frequency.value = 880; g.gain.value = 0.08;
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + 0.18);
    } catch {}
  }

  // ---------- live stream ----------
  function connect() {
    const es = new EventSource('/api/stream');
    es.onopen = () => $('liveDot').classList.add('live');
    es.onerror = () => {
      $('liveDot').classList.remove('live');
      // if the session ended, the stream can't reconnect: check and go to login
      fetch('/api/auth/state').then((r) => r.json()).then((st) => { if (!st.user) location.href = '/login.html'; }).catch(() => {});
    };
    es.addEventListener('news', (e) => {
      const fresh = JSON.parse(e.data);
      const known = new Set(state.items.map((i) => i.id));
      const added = fresh.filter((i) => !known.has(i.id));
      if (!added.length) return;
      added.forEach((i) => state.newIds.add(i.id));
      state.items = [...added, ...state.items].sort((a, b) => b.publishedAt - a.publishedAt);
      renderFeed();
      const highs = added.filter((i) => i.impact === 'High' && visible(i));
      if (prefs.sound && highs.length) beep();
      if (document.hidden) { state.unseen += added.filter(visible).length; updateTitle(); }
      setTimeout(() => { added.forEach((i) => state.newIds.delete(i.id)); renderFeed(); }, 60000);
      loadStatus();
    });
    es.addEventListener('calendar', (e) => { state.events = JSON.parse(e.data); renderCalendar(); });
    es.addEventListener('reload', () => { loadMe().then(() => { renderCategoryOptions(); loadNews(); loadWatchlist(); }); });
  }

  function updateTitle() { document.title = state.unseen ? `(${state.unseen}) News · TradeDesk` : 'News · TradeDesk'; }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { state.unseen = 0; updateTitle(); } });

  // ---------- events ----------
  $('search').addEventListener('input', renderFeed);
  $('categorySel').addEventListener('change', (e) => { prefs.category = e.target.value; savePrefs(); renderFeed(); });
  $('watchOnly').addEventListener('change', (e) => { prefs.watchOnly = e.target.checked; savePrefs(); renderFeed(); });
  $('soundBtn').addEventListener('click', () => { prefs.sound = !prefs.sound; savePrefs(); renderFilters(); if (prefs.sound) beep(); });
  $('refreshBtn').addEventListener('click', async () => {
    $('refreshBtn').disabled = true;
    try { await api('/api/refresh', { method: 'POST' }); await loadNews(); await loadStatus(); } finally { $('refreshBtn').disabled = false; }
  });
  $('tgTest').addEventListener('click', async () => {
    const r = await (await api('/api/telegram/test', { method: 'POST' })).json();
    alert(r.message);
  });

  // ---------- market summary ----------
  const REGION_NAMES = Object.fromEntries(REGIONS);
  const TONE = { bullish: ['▲ Bullish', 'bullish'], bearish: ['▼ Bearish', 'bearish'], mixed: ['◆ Mixed', 'mixed'], neutral: ['● Neutral', 'mixed'] };
  let lastDigest = null;
  let lastAi = '';

  // Hover text: which story the range starts at and ends at
  const storyLine = (st) => st ? `${fmtDay(st.at)} ${fmtTime(st.at)} IST · ${st.source}\n   ${st.title}` : '—';
  const rangeTip = (a, b) => `From:\n${storyLine(a)}\n\nTo:\n${storyLine(b)}`;

  function pointHtml(p) {
    const sent = p.sentiment === 'bullish' ? '<span class="sent bullish">▲</span>' : p.sentiment === 'bearish' ? '<span class="sent bearish">▼</span>' : '';
    const when = p.first === p.last ? `${fmtDay(p.last)} ${fmtTime(p.last)}` : `${fmtDay(p.first)} ${fmtTime(p.first)} – ${dayKey(p.first) === dayKey(p.last) ? '' : fmtDay(p.last) + ' '}${fmtTime(p.last)}`;
    const related = p.related.length ? `<details class="dg-rel"><summary>${p.count - 1} more from ${p.sources.length > 1 ? 'other sources' : 'same source'}</summary>
      ${p.related.map((r) => `<div><a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.title)}</a> <span class="muted">· ${esc(r.source)}</span></div>`).join('')}</details>` : '';
    return `<li class="dg-pt ${p.impact}">
      <div class="meta"><span class="badge ${p.impact}">${p.impact}</span>${sent}
        <span title="${esc(p.sources.join(', '))}">${p.sources.length} source${p.sources.length > 1 ? 's' : ''}</span>·<span class="hov" title="${esc(p.count > 1 ? rangeTip(p.firstStory, p.lastStory) : storyLine(p.firstStory))}">${when} IST</span>
        ${p.regions.map((r) => `<span class="tag">${esc(r)}</span>`).join('')}${p.watch.map((s) => `<span class="tag watch">${esc(s)}</span>`).join('')}</div>
      <a class="dg-title" href="${esc(p.link)}" target="_blank" rel="noopener">${esc(p.title)}</a>
      ${p.summary ? `<p class="muted">${esc(p.summary)}</p>` : ''}${related}
    </li>`;
  }

  function aiHtml(text) {
    return esc(text).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      if (/^bias:/i.test(l)) return `<div class="ai-bias">${l.replace(/^bias:\s*/i, '<b>Bias:</b> ')}</div>`;
      if (/^watch:/i.test(l)) return `<div class="ai-watch">${l.replace(/^watch:\s*/i, '<b>Watch:</b> ')}</div>`;
      return `<div class="ai-li">${l.replace(/^[-•*]\s*/, '• ')}</div>`;
    }).join('');
  }

  function renderDigest(d) {
    const [toneLabel, toneCls] = TONE[d.tone] || TONE.neutral;
    const regions = Object.entries(d.byRegion).map(([r, n]) => `${REGION_NAMES[r] || r} ${n}`).join(' · ');
    let html = `<div class="dg-stats">
      <span class="dg-label">${esc(d.label)}</span>
      <span class="dg-tone ${toneCls}">${toneLabel}</span>
      <span><b>${d.pointsTotal}</b> key points from <b>${d.stories}</b> stories</span>
      <span class="badge High">${d.high} High</span><span class="badge Medium">${d.medium} Medium</span>
      <span class="muted small hov" title="${esc(d.oldest ? rangeTip(d.oldest, d.newest) : 'No stories in this window')}">${fmtDay(d.from)} ${fmtTime(d.from)} → ${fmtDay(d.to)} ${fmtTime(d.to)} IST</span>
      ${d.oldest ? `<span class="muted small hov" title="${esc(rangeTip(d.oldest, d.newest))}">ⓘ news ${fmtTime(d.oldest.at)} ${fmtDay(d.oldest.at)} → ${fmtTime(d.newest.at)} ${fmtDay(d.newest.at)}</span>` : ''}
      ${regions ? `<span class="muted small">${regions}</span>` : ''}
    </div>`;
    if (d.partial) html += `<div class="dg-warn">⚠ Only news from ${fmtDay(d.storeOldest)} ${fmtTime(d.storeOldest)} IST onward is stored, so the start of this window is missing. Raise RETENTION_DAYS / MAX_ITEMS in .env to keep more.</div>`;
    if (!d.pointsTotal) { $('digestBody').innerHTML = html + '<div class="empty">No market-moving news in this window for your filters.</div>'; return; }

    if (d.ai) html += `<section class="dg-sec ai-sec"><h3>🤖 AI market brief <button id="aiBtn" class="ghost small">${lastAi ? '↻ Regenerate' : 'Generate'}</button></h3><div id="aiOut" class="ai-out">${lastAi ? aiHtml(lastAi) : '<span class="muted small">Writes a short pre-market brief from the points below.</span>'}</div></section>`;
    html += `<section class="dg-sec"><h3>🔥 Top market movers</h3><ol class="dg-list">${d.top.map(pointHtml).join('')}</ol></section>`;
    if (d.watch.length) html += `<section class="dg-sec"><h3>👁 Your watchlist</h3><ol class="dg-list">${d.watch.map(pointHtml).join('')}</ol></section>`;
    const topIds = new Set(d.top.map((p) => p.id));
    for (const t of d.themes) {
      const rest = t.points.filter((p) => !topIds.has(p.id));
      if (rest.length) html += `<details class="dg-sec" open><summary><h3>${esc(t.label)} <span class="muted small">${rest.length}</span></h3></summary><ol class="dg-list">${rest.map(pointHtml).join('')}</ol></details>`;
    }
    $('digestBody').innerHTML = html;
    if (d.ai) $('aiBtn').onclick = genAi;
  }

  function digestQuery() {
    const q = new URLSearchParams({ window: $('digestWindow').value });
    if ($('digestUseRegions').checked) q.set('regions', prefs.regions.join(','));
    return q.toString();
  }

  async function loadDigest() {
    $('digestBody').innerHTML = '<div class="empty">Clubbing the news…</div>';
    lastAi = '';
    try {
      const r = await api('/api/digest?' + digestQuery());
      lastDigest = await r.json();
      renderDigest(lastDigest);
    } catch (e) {
      $('digestBody').innerHTML = `<div class="empty">Could not build the summary: ${esc(e.message)}</div>`;
    }
  }

  async function genAi() {
    const btn = $('aiBtn'); btn.disabled = true;
    $('aiOut').innerHTML = '<span class="muted small">Writing the brief…</span>';
    try {
      const r = await api('/api/digest/ai?' + digestQuery(), { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      lastAi = j.text || '';
      $('aiOut').innerHTML = lastAi ? aiHtml(lastAi) : '<span class="muted small">Nothing to summarize.</span>';
      btn.textContent = '↻ Regenerate';
    } catch (e) {
      $('aiOut').innerHTML = `<span class="err">${esc(e.message)}</span>`;
    } finally { btn.disabled = false; }
  }

  function digestText(d) {
    const line = (p) => `${p.impact === 'High' ? '🔴' : p.impact === 'Medium' ? '🟠' : '⚪'} ${p.sentiment === 'bullish' ? '▲ ' : p.sentiment === 'bearish' ? '▼ ' : ''}${p.title} (${p.sources.length} src, ${fmtTime(p.last)})`;
    const out = [`Market summary · ${d.label} · ${fmtDay(d.from)} ${fmtTime(d.from)} → ${fmtDay(d.to)} ${fmtTime(d.to)} IST`, ...(d.oldest ? [`Covers news from: ${storyLine(d.oldest).replace('\n  ', '')}`, `             to: ${storyLine(d.newest).replace('\n  ', '')}`] : []), `Tone: ${(TONE[d.tone] || TONE.neutral)[0]} · ${d.pointsTotal} key points (${d.high} High, ${d.medium} Medium)`, ''];
    if (lastAi) out.push('AI brief:', lastAi, '');
    out.push('Top market movers:', ...d.top.map(line), '');
    const topIds = new Set(d.top.map((p) => p.id));
    for (const t of d.themes) {
      const rest = t.points.filter((p) => !topIds.has(p.id));
      if (rest.length) out.push(`${t.label}:`, ...rest.map(line), '');
    }
    return out.join('\n');
  }

  // Always opens on the default window (yesterday 00:00 → now); custom windows apply only until closed
  function openDigest() { $('digestWindow').value = 'yesterday'; $('digestModal').hidden = false; document.body.classList.add('noscroll'); loadDigest(); }
  function closeDigest() { $('digestModal').hidden = true; document.body.classList.remove('noscroll'); }
  $('digestBtn').addEventListener('click', openDigest);
  $('digestClose').addEventListener('click', closeDigest);
  $('digestModal').addEventListener('click', (e) => { if (e.target.id === 'digestModal') closeDigest(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('digestModal').hidden) closeDigest(); });
  $('digestWindow').addEventListener('change', loadDigest);
  $('digestUseRegions').addEventListener('change', loadDigest);
  $('digestCopy').addEventListener('click', async () => {
    if (!lastDigest) return;
    try { await navigator.clipboard.writeText(digestText(lastDigest)); $('digestCopy').textContent = '✓ Copied'; }
    catch { $('digestCopy').textContent = 'Copy failed'; }
    setTimeout(() => { $('digestCopy').textContent = '⧉ Copy'; }, 1500);
  });

  setInterval(() => { $('clock').textContent = fmtTime(Date.now(), { second: '2-digit' }) + ' IST'; }, 1000);
  setInterval(() => { renderFeed(); renderCalendar(); }, 30000);
  setInterval(loadStatus, 60000);

  async function loadMe() {
    state.me = await (await api('/api/me')).json();
    const u = state.me.user;
    MN.nav($('nav'), u, 'news');
    $('refreshBtn').hidden = u.role !== 'admin';
    const n = u.prefs.categories.length;
    $('myCats').textContent = n ? `Showing ${n} chosen categor${n === 1 ? 'y' : 'ies'}` : '';
  }


  renderFilters();
  loadMe().then(loadStatus).then(loadNews);
  loadCalendar();
  loadWatchlist();
  connect();
})();
