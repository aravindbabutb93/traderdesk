(() => {
  const { api, esc, flash } = MN;
  const $ = (id) => document.getElementById(id);
  const IST_MS = 5.5 * 3600e3;
  const DAY = 864e5;

  const S = {
    me: null, data: null, tab: 'dashboard',
    calMonth: null, editing: null, form: null,
    sort: { key: 'openTime', dir: -1 }, newsCache: null,
  };

  // ---------- time helpers (everything shown in IST) ----------
  const istDate = (ts) => new Date(ts + IST_MS).toISOString().slice(0, 10);
  const istInput = (ts) => (ts ? new Date(ts + IST_MS).toISOString().slice(0, 16) : '');
  const fromInput = (v) => (v ? Date.parse(v + ':00+05:30') : null);
  const dayStart = (dateStr) => Date.parse(dateStr + 'T00:00:00+05:30');
  const fmtDT = (ts) => (ts ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts)) : '—');
  const fmtD = (ts) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(ts));
  const todayStr = () => istDate(Date.now());
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hold = (m) => (m == null ? '—' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.round(m / 144) / 10}d`);

  // ---------- money ----------
  const SYM = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };
  function currency() {
    const accs = filteredAccounts();
    const set = [...new Set(accs.map((a) => a.currency))];
    return set.length === 1 ? set[0] : null;
  }
  function money(v, ccy = currency(), signed = false) {
    if (v == null || !isFinite(v)) return '—';
    const s = Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 });
    const sign = v < 0 ? '−' : signed && v > 0 ? '+' : '';
    return `${sign}${ccy ? SYM[ccy] || ccy + ' ' : ''}${s}`;
  }
  const pct = (v) => (v == null ? '—' : `${Math.round(v * 1000) / 10}%`);
  const rr = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}R`);
  const pnlCls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  const accCcy = (id) => (S.data.accounts.find((a) => a.id === id) || {}).currency;

  // ---------- filters ----------
  function filteredAccounts() {
    const v = $('fAccount').value;
    const all = S.data.accounts;
    return v ? all.filter((a) => a.id === v) : all.filter((a) => !a.archived);
  }

  function rangeBounds() {
    const v = $('fRange').value;
    const today = dayStart(todayStr());
    const d = new Date(today + IST_MS);
    switch (v) {
      case 'today': return [today, today + DAY];
      case 'week': { const wd = (d.getUTCDay() + 6) % 7; return [today - wd * DAY, today + DAY]; }
      case 'month': return [dayStart(todayStr().slice(0, 8) + '01'), today + DAY];
      case '30d': return [today - 29 * DAY, today + DAY];
      case '90d': return [today - 89 * DAY, today + DAY];
      case 'year': return [dayStart(todayStr().slice(0, 5) + '01-01'), today + DAY];
      case 'custom': return [$('fFrom').value ? dayStart($('fFrom').value) : -Infinity, $('fTo').value ? dayStart($('fTo').value) + DAY : Infinity];
      default: return [-Infinity, Infinity];
    }
  }

  // trades in the selected accounts/market/setup (any date)
  function scopeTrades() {
    const ids = new Set(filteredAccounts().map((a) => a.id));
    const m = $('fMarket').value, st = $('fSetup').value;
    return S.data.trades.filter((t) => ids.has(t.accountId) && (!m || t.market === m) && (!st || t.setup === st));
  }

  // ... and in the date range (by close time, or open time if still open)
  function rangeTrades() {
    const [a, b] = rangeBounds();
    return scopeTrades().filter((t) => {
      const ts = t.c.closeTime || t.c.openTime || t.createdAt;
      return ts >= a && ts < b;
    });
  }

  const startBalance = () => filteredAccounts().reduce((s, a) => s + (a.startingBalance || 0), 0);

  // ---------- load ----------
  async function reload(data) {
    const first = !S.data;
    S.data = data || (await api('/api/journal'));
    fillFilterOptions();
    if (first) {
      let saved = null; try { saved = localStorage.getItem('td-acc'); } catch {}
      const active = S.data.accounts.filter((a) => !a.archived);
      if (saved !== null && (saved === '' || S.data.accounts.some((a) => a.id === saved))) $('fAccount').value = saved;
      else if (new Set(active.map((a) => a.currency)).size > 1) $('fAccount').value = active[0].id;
      fillFilterOptions();
    }
    render();
  }

  function fillFilterOptions() {
    const d = S.data;
    const keep = (el, html) => { const v = el.value; el.innerHTML = html; if ([...el.options].some((o) => o.value === v)) el.value = v; };
    const accOpts = d.accounts.map((a) => `<option value="${a.id}">${esc(a.name)}${a.archived ? ' (archived)' : ''} · ${a.currency}</option>`).join('');
    keep($('fAccount'), `<option value="">All active accounts</option>${accOpts}`);
    keep($('fMarket'), `<option value="">All markets</option>${d.markets.map((m) => `<option>${m}</option>`).join('')}`);
    const setups = [...new Set([...d.settings.setups, ...d.trades.map((t) => t.setup).filter(Boolean)])];
    keep($('fSetup'), `<option value="">All setups</option>${setups.map((s) => `<option>${esc(s)}</option>`).join('')}`);
    keep($('impAcc'), accOpts); keep($('psAcc'), accOpts);
    $('symList').innerHTML = [...new Set(d.trades.map((t) => t.symbol))].slice(0, 300).map((s) => `<option value="${esc(s)}">`).join('');
    $('fNote').textContent = currency() ? '' : 'Mixed currencies: totals add raw numbers. Pick one account for accurate sums.';
    $('exportCsv').href = '/api/journal/export.csv' + ($('fAccount').value ? `?accountId=${$('fAccount').value}` : '');
  }

  // ---------- render dispatch ----------
  function render() {
    document.querySelectorAll('[data-view]').forEach((v) => { v.hidden = v.dataset.view !== S.tab; });
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
    ({ dashboard: renderDashboard, trades: renderTrades, calendar: renderCalendar, daily: renderDaily, reports: renderReports, tools: renderTools, setup: renderSetup })[S.tab]();
  }

  // ---------- tooltip ----------
  const tip = $('tip');
  function showTip(e, html) {
    tip.innerHTML = html; tip.hidden = false;
    const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    const y = Math.max(8, e.clientY - tip.offsetHeight - 12);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  const hideTip = () => { tip.hidden = true; };

  // ---------- charts (plain SVG) ----------
  function niceTicks(min, max, n = 4) {
    if (min === max) { min -= 1; max += 1; }
    const step0 = (max - min) / n;
    const mag = 10 ** Math.floor(Math.log10(step0));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const out = []; for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }
  const short = (v) => { const a = Math.abs(v); const s = a >= 1e7 ? (a / 1e7).toFixed(1) + 'Cr' : a >= 1e5 ? (a / 1e5).toFixed(1) + 'L' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'k' : String(Math.round(a * 100) / 100); return (v < 0 ? '−' : '') + s; };

  function lineChart(el, points, { height = 220, fmt = money } = {}) {
    if (points.length < 1) { el.innerHTML = '<div class="empty small">Close some trades to see your equity curve.</div>'; return; }
    const W = el.clientWidth || 600, H = height, P = { l: 52, r: 12, t: 10, b: 24 };
    const ys = points.map((p) => p.y);
    const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const X = (i) => P.l + (points.length === 1 ? (W - P.l - P.r) / 2 : (i / (points.length - 1)) * (W - P.l - P.r));
    const Y = (v) => P.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - P.t - P.b);
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
    const xl = [0, Math.floor((points.length - 1) / 2), points.length - 1].filter((v, i, a) => a.indexOf(v) === i);
    el.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="Line chart">
      ${ticks.map((t) => `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ax" x="${P.l - 6}" y="${Y(t) + 4}" text-anchor="end">${short(t)}</text>`).join('')}
      ${xl.map((i) => `<text class="ax" x="${X(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}">${esc(points[i].label)}</text>`).join('')}
      <path class="line" d="${d}"/>
      <line class="xh" id="${el.id}-xh" y1="${P.t}" y2="${H - P.b}" visibility="hidden"/>
      <circle class="dotm" id="${el.id}-dot" r="4" visibility="hidden"/>
      <rect x="${P.l}" y="0" width="${W - P.l - P.r}" height="${H}" fill="transparent" class="hit"/>
    </svg>`;
    const svg = el.querySelector('svg'), xh = svg.querySelector('.xh'), dot = svg.querySelector('.dotm');
    svg.querySelector('.hit').addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(points.length - 1, Math.round(((e.clientX - r.left - P.l) / (W - P.l - P.r)) * (points.length - 1))));
      const p = points[i];
      xh.setAttribute('x1', X(i)); xh.setAttribute('x2', X(i)); xh.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(p.y)); dot.setAttribute('visibility', 'visible');
      showTip(e, p.tip || `${esc(p.label)}<br><b>${fmt(p.y)}</b>`);
    });
    svg.querySelector('.hit').addEventListener('mouseleave', () => { hideTip(); xh.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); });
  }

  function barChart(el, bars, { height = 200, fmt = (v) => money(v, currency(), true), polar = true } = {}) {
    if (!bars.length) { el.innerHTML = '<div class="empty small">No closed trades in this range.</div>'; return; }
    const W = el.clientWidth || 600, H = height, P = { l: 52, r: 8, t: 10, b: 24 };
    const ys = bars.map((b) => b.y);
    const ticks = niceTicks(Math.min(0, ...ys), Math.max(0, ...ys));
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const Y = (v) => P.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - P.t - P.b);
    const slot = (W - P.l - P.r) / bars.length;
    const bw = Math.max(2, Math.min(28, slot - 2));
    const every = bars.length <= 10 ? 1 : Math.ceil(bars.length / 8);
    el.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="Bar chart">
      ${ticks.map((t) => `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ax" x="${P.l - 6}" y="${Y(t) + 4}" text-anchor="end">${short(t)}</text>`).join('')}
      <line class="base" x1="${P.l}" x2="${W - P.r}" y1="${Y(0)}" y2="${Y(0)}"/>
      ${bars.map((b, i) => {
        const x = P.l + i * slot + (slot - bw) / 2, top = Math.min(Y(0), Y(b.y)), h = Math.max(1, Math.abs(Y(b.y) - Y(0)));
        return `<rect class="bar ${polar ? (b.y >= 0 ? 'pos' : 'neg') : 'neu'}" x="${x}" y="${top}" width="${bw}" height="${h}" rx="2" data-i="${i}"/>
          <rect class="hit" x="${P.l + i * slot}" y="${P.t}" width="${slot}" height="${H - P.t - P.b}" fill="transparent" data-i="${i}"/>
          ${i % every === 0 ? `<text class="ax" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(b.label)}</text>` : ''}`;
      }).join('')}
    </svg>`;
    el.querySelectorAll('.hit').forEach((r) => {
      r.addEventListener('mousemove', (e) => { const b = bars[r.dataset.i]; showTip(e, b.tip || `${esc(b.full || b.label)}<br><b>${fmt(b.y)}</b>`); });
      r.addEventListener('mouseleave', hideTip);
      r.addEventListener('click', () => { const b = bars[r.dataset.i]; if (b.onClick) b.onClick(); });
    });
  }

  // ---------- dashboard ----------
  function kpi(label, value, sub = '', cls = '') {
    return `<div class="kpi"><div class="kl">${label}</div><div class="kv ${cls}">${value}</div><div class="ks">${sub}</div></div>`;
  }

  function renderDashboard() {
    const trades = rangeTrades();
    const st = JCalc.stats(trades, startBalance());
    $('kpis').innerHTML = [
      kpi('Net P&amp;L', money(st.net, currency(), true), `${st.count} closed · fees ${money(st.fees)}`, pnlCls(st.net)),
      kpi('Win rate', pct(st.winRate), `${st.wins}W · ${st.losses}L · ${st.be} BE`),
      kpi('Profit factor', st.profitFactor === Infinity ? '∞' : st.profitFactor ?? '—', `avg win ${money(st.avgWin)} · avg loss ${money(st.avgLoss)}`),
      kpi('Expectancy', money(st.expectancy, currency(), true), `per trade · ${st.avgR != null ? rr(st.avgR) + ' avg' : 'add stops for R'}`, pnlCls(st.expectancy)),
      kpi('Total R', st.totalR != null ? rr(st.totalR) : '—', `payoff ${st.payoff ?? '—'}`, pnlCls(st.totalR)),
      kpi('Max drawdown', money(-st.maxDD), st.maxDDPct ? `${st.maxDDPct}% from peak` : '', st.maxDD ? 'neg' : ''),
      kpi('Streaks', `${st.maxWinStreak}W / ${st.maxLossStreak}L`, `avg hold ${hold(st.avgHoldMins)}`),
    ].join('');

    $('eqNote').textContent = startBalance() ? `start ${money(startBalance())}` : '';
    lineChart($('equityChart'), [{ y: startBalance(), label: 'Start', tip: `Start<br><b>${money(startBalance())}</b>` },
      ...st.curve.map((p) => ({ y: p.equity, label: istDate(p.time).slice(5), tip: `${esc(p.symbol)} · ${fmtDT(p.time)}<br>${money(p.net, currency(), true)} → <b>${money(p.equity)}</b>` }))]);

    // daily bars
    const byDay = new Map();
    for (const t of trades) if (t.c.status === 'Closed' && t.c.net != null) {
      const k = istDate(t.c.closeTime); byDay.set(k, (byDay.get(k) || { net: 0, n: 0 })); byDay.get(k).net += t.c.net; byDay.get(k).n++;
    }
    const days = [...byDay.entries()].sort().slice(-60);
    barChart($('dailyChart'), days.map(([k, v]) => ({ y: Math.round(v.net * 100) / 100, label: k.slice(5), full: `${fmtD(dayStart(k))} · ${v.n} trade${v.n > 1 ? 's' : ''}`, onClick: () => openDay(k) })));

    renderToday();
    const open = scopeTrades().filter((t) => t.c.status === 'Open' || t.c.status === 'Partial');
    $('openPos').innerHTML = open.length ? `<ul class="mini">${open.map((t) => `<li data-id="${t.id}"><b>${esc(t.symbol)}</b> <span class="pill">${t.direction}</span> ${t.c.openQty} @ ${t.c.avgEntry} <span class="muted">SL ${t.stopLoss ?? '—'}</span></li>`).join('')}</ul>` : '<p class="muted small">No open positions.</p>';
    $('recent').innerHTML = '<div class="tbl-wrap">' + tradeTableHtml(trades.slice().sort((a, b) => (b.c.closeTime || b.c.openTime || 0) - (a.c.closeTime || a.c.openTime || 0)).slice(0, 8), true) + '</div>';
  }

  function renderToday() {
    const t0 = dayStart(todayStr());
    const accs = filteredAccounts();
    const rows = accs.map((a) => {
      const list = S.data.trades.filter((t) => t.accountId === a.id && (t.c.openTime >= t0 || (t.c.closeTime || 0) >= t0));
      const net = list.filter((t) => t.c.closeTime >= t0 && t.c.net != null).reduce((s, t) => s + t.c.net, 0);
      const n = list.filter((t) => t.c.openTime >= t0).length;
      const warn = [];
      if (a.dailyLossLimit && net <= -a.dailyLossLimit) warn.push(`<span class="warn bad">⛔ Daily loss limit hit (${money(-a.dailyLossLimit, a.currency)}). Stop trading today.</span>`);
      else if (a.dailyLossLimit && net <= -0.7 * a.dailyLossLimit) warn.push(`<span class="warn">⚠ ${Math.round((-net / a.dailyLossLimit) * 100)}% of daily loss limit used</span>`);
      if (a.maxTradesPerDay && n >= a.maxTradesPerDay) warn.push(`<span class="warn">⚠ Max ${a.maxTradesPerDay} trades/day reached</span>`);
      return `<div class="todayrow"><div><b>${esc(a.name)}</b> <span class="muted small">${n} trade${n === 1 ? '' : 's'} today</span></div><div class="${pnlCls(net)}">${money(net, a.currency, true)}</div>${warn.join('')}</div>`;
    });
    const note = S.data.notes[todayStr()];
    $('today').innerHTML = rows.join('') + `<p class="small"><a href="#" id="todayNote">${note && note.plan ? '📝 Today’s plan: ' + esc(note.plan.slice(0, 90)) + (note.plan.length > 90 ? '…' : '') : '📝 Write today’s pre-market plan →'}</a></p>`;
    $('todayNote').onclick = (e) => { e.preventDefault(); $('dDate').value = todayStr(); S.tab = 'daily'; render(); };
  }

  // ---------- trades table ----------
  const COLS = [
    ['openTime', 'Opened'], ['symbol', 'Symbol'], ['direction', 'Side'], ['setup', 'Setup'], ['qty', 'Qty'],
    ['avgEntry', 'Entry'], ['avgExit', 'Exit'], ['net', 'Net P&L'], ['r', 'R'], ['hold', 'Hold'], ['status', 'Status'],
  ];
  const sortVal = (t, k) => ({ openTime: t.c.openTime || 0, symbol: t.symbol, direction: t.direction, setup: t.setup, qty: t.c.qty, avgEntry: t.c.avgEntry, avgExit: t.c.avgExit, net: t.c.net ?? -Infinity, r: t.c.r ?? -Infinity, hold: t.c.holdMins ?? -1, status: t.c.status })[k];

  function tradeTableHtml(list, compact = false) {
    if (!list.length) return '<div class="empty small">No trades yet. Press <b>+ New trade</b> to log one.</div>';
    const cols = compact ? COLS.filter(([k]) => !['qty', 'avgExit', 'hold'].includes(k)) : COLS;
    return `<table class="tbl jt"><thead><tr>${cols.map(([k, l]) => `<th data-sort="${k}" class="${['qty', 'avgEntry', 'avgExit', 'net', 'r'].includes(k) ? 'num' : ''}">${l}${!compact && S.sort.key === k ? (S.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>
      ${list.map((t) => `<tr data-id="${t.id}" class="${t.c.result === 'Win' ? 'rw' : t.c.result === 'Loss' ? 'rl' : ''}">
        ${cols.map(([k]) => {
          switch (k) {
            case 'openTime': return `<td class="nowrap">${fmtDT(t.c.openTime)}</td>`;
            case 'symbol': return `<td><b>${esc(t.symbol)}</b>${t.optionType ? ` <span class="muted small">${t.strike ?? ''}${t.optionType}</span>` : ''}<div class="muted small">${t.market}${t.screenshots.length ? ' · 🖼' : ''}${t.mistakes.length ? ` · <span class="negt">${t.mistakes.length} mistake${t.mistakes.length > 1 ? 's' : ''}</span>` : ''}</div></td>`;
            case 'direction': return `<td><span class="pill ${t.direction === 'Long' ? 'long' : 'short'}">${t.direction}</span></td>`;
            case 'setup': return `<td class="small">${esc(t.setup || '—')}${t.grade ? ` <span class="pill">${t.grade}</span>` : ''}</td>`;
            case 'qty': return `<td class="num">${t.c.qty}</td>`;
            case 'avgEntry': return `<td class="num">${t.c.avgEntry ?? '—'}</td>`;
            case 'avgExit': return `<td class="num">${t.c.avgExit ?? '—'}</td>`;
            case 'net': return `<td class="num ${pnlCls(t.c.net)}"><b>${money(t.c.net, accCcy(t.accountId), true)}</b></td>`;
            case 'r': return `<td class="num ${pnlCls(t.c.r)}">${rr(t.c.r)}</td>`;
            case 'hold': return `<td>${hold(t.c.holdMins)}</td>`;
            case 'status': return `<td><span class="pill st-${t.c.status}">${t.c.status}</span></td>`;
          }
          return '<td></td>';
        }).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function renderTrades() {
    const q = $('tSearch').value.trim().toLowerCase();
    const st = $('tStatus').value, res = $('tResult').value, dir = $('tDir').value;
    let list = rangeTrades().filter((t) => (!st || t.c.status === st) && (!res || t.c.result === res) && (!dir || t.direction === dir));
    if (q) list = list.filter((t) => [t.symbol, t.setup, t.thesis, t.review, t.lessons, t.management, ...t.tags, ...t.mistakes].join(' ').toLowerCase().includes(q));
    const { key, dir: sd } = S.sort;
    list.sort((a, b) => { const x = sortVal(a, key), y = sortVal(b, key); return (x > y ? 1 : x < y ? -1 : 0) * sd; });
    const net = list.reduce((s, t) => s + (t.c.net || 0), 0);
    $('tCount').innerHTML = `${list.length} trades · net <b class="${pnlCls(net)}">${money(net, currency(), true)}</b>`;
    $('tradeTable').outerHTML = `<div id="tradeTable">${tradeTableHtml(list)}</div>`;
  }

  // ---------- calendar ----------
  function renderCalendar() {
    if (!S.calMonth) S.calMonth = todayStr().slice(0, 7);
    const [y, m] = S.calMonth.split('-').map(Number);
    $('calTitle').textContent = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const first = new Date(Date.UTC(y, m - 1, 1)), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7; // Monday first
    const byDay = {};
    for (const t of scopeTrades()) {
      const ts = t.c.closeTime || t.c.openTime; if (!ts) continue;
      const k = istDate(ts); if (!k.startsWith(S.calMonth)) continue;
      (byDay[k] = byDay[k] || { net: 0, n: 0, w: 0, closed: 0 }); byDay[k].n++;
      if (t.c.net != null && t.c.status === 'Closed') { byDay[k].net += t.c.net; byDay[k].closed++; if (t.c.result === 'Win') byDay[k].w++; }
    }
    const maxAbs = Math.max(1, ...Object.values(byDay).map((d) => Math.abs(d.net)));
    let html = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Week'].map((d) => `<div class="calh">${d}</div>`).join('');
    let week = { net: 0, n: 0 }, cells = 0, monthNet = 0, green = 0, red = 0;
    const flushWeek = () => { html += `<div class="calw"><span class="${pnlCls(week.net)}">${week.n ? money(week.net, currency(), true) : ''}</span><span class="muted small">${week.n ? week.n + ' trades' : ''}</span></div>`; week = { net: 0, n: 0 }; };
    for (let i = 0; i < lead; i++) { html += '<div class="calc empty"></div>'; cells++; }
    for (let d = 1; d <= days; d++) {
      const k = `${S.calMonth}-${String(d).padStart(2, '0')}`;
      const v = byDay[k]; const note = S.data.notes[k];
      const a = v ? Math.min(1, Math.abs(v.net) / maxAbs) : 0;
      const bg = v && v.net ? `style="--a:${(0.12 + a * 0.5).toFixed(2)}"` : '';
      html += `<div class="calc ${v ? (v.net > 0 ? 'cpos' : v.net < 0 ? 'cneg' : 'cbe') : ''} ${k === todayStr() ? 'ctoday' : ''}" data-day="${k}" ${bg}>
        <div class="cd">${d}${note ? ' <span title="Has notes">📝</span>' : ''}</div>
        ${v ? `<div class="cv">${v.closed ? money(v.net, currency(), true) : '<span class="muted">open</span>'}</div><div class="cn">${v.n} trade${v.n > 1 ? 's' : ''}${v.closed ? ` · ${Math.round((v.w / v.closed) * 100)}% win` : ''}</div>` : ''}</div>`;
      if (v) { week.net += v.net; week.n += v.n; monthNet += v.net; if (v.net > 0) green++; else if (v.net < 0) red++; }
      cells++;
      if (cells % 7 === 0) flushWeek();
    }
    if (cells % 7) { while (cells % 7) { html += '<div class="calc empty"></div>'; cells++; } flushWeek(); }
    $('calGrid').innerHTML = html;
    $('calSum').innerHTML = `Month: <b class="${pnlCls(monthNet)}">${money(monthNet, currency(), true)}</b> · ${green} green day${green === 1 ? '' : 's'} · ${red} red`;
  }

  function openDay(k) {
    S.tab = 'calendar'; S.calMonth = k.slice(0, 7); render();
    const list = scopeTrades().filter((t) => istDate(t.c.closeTime || t.c.openTime || 0) === k);
    const n = S.data.notes[k];
    $('calDay').hidden = false;
    $('calDay').innerHTML = `<div class="row tbar"><h2>${fmtD(dayStart(k))}</h2><span class="grow"></span><button class="ghost" id="calDayNote">📝 Open daily journal</button></div>
      ${n ? `<p class="small">${n.bias ? `<span class="pill">${esc(n.bias)}</span> ` : ''}${esc(n.plan || '')}</p>${n.review ? `<p class="small muted">${esc(n.review)}</p>` : ''}` : ''}
      ${tradeTableHtml(list)}`;
    $('calDayNote').onclick = () => { $('dDate').value = k; S.tab = 'daily'; render(); };
    $('calDay').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---------- daily journal ----------
  function stars(el, value, onChange) {
    el.innerHTML = [1, 2, 3, 4, 5].map((i) => `<button type="button" data-v="${i}" class="${i <= value ? 'on' : ''}" aria-label="${i}">★</button>`).join('');
    el.dataset.value = value;
    el.onclick = (e) => {
      const v = Number(e.target.dataset.v); if (!v) return;
      const nv = Number(el.dataset.value) === v ? 0 : v;
      stars(el, nv, onChange); onChange && onChange(nv);
    };
  }

  async function renderDaily() {
    if (!$('dDate').value) $('dDate').value = todayStr();
    const k = $('dDate').value;
    const n = S.data.notes[k] || {};
    $('nBias').value = n.bias || ''; $('nLevels').value = n.keyLevels || ''; $('nPlan').value = n.plan || '';
    $('nReview').value = n.review || ''; $('nLessons').value = n.lessons || '';
    stars($('nMood'), n.mood || 0); stars($('nDisc'), n.discipline || 0);
    const list = scopeTrades().filter((t) => istDate(t.c.closeTime || t.c.openTime || 0) === k);
    const net = list.reduce((s, t) => s + (t.c.net || 0), 0);
    $('dTrades').innerHTML = list.length ? `<p>Net <b class="${pnlCls(net)}">${money(net, currency(), true)}</b> from ${list.length} trade${list.length > 1 ? 's' : ''}</p><ul class="mini">${list.map((t) => `<li data-id="${t.id}"><b>${esc(t.symbol)}</b> ${t.direction} <span class="${pnlCls(t.c.net)}">${money(t.c.net, accCcy(t.accountId), true)}</span> <span class="muted">${rr(t.c.r)}</span></li>`).join('')}</ul>` : '<p class="muted small">No trades on this day.</p>';
    try {
      if (!S.newsCache || Date.now() - S.newsCache.at > 60e3) S.newsCache = { at: Date.now(), items: await (await fetch('/api/news?limit=3000')).json() };
      const a = dayStart(k), b = a + DAY;
      const items = S.newsCache.items.filter((x) => x.publishedAt >= a && x.publishedAt < b && x.impact === 'High').slice(0, 15);
      $('dNews').innerHTML = items.length ? `<ul class="mini">${items.map((x) => `<li><span class="muted">${fmtDT(x.publishedAt).slice(-5)}</span> <a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.title)}</a></li>`).join('')}</ul>` : '<p class="muted">None stored for this day (news is kept for 7 days).</p>';
    } catch { $('dNews').textContent = ''; }
  }

  // ---------- reports ----------
  function groupKey(t, g) {
    const ot = t.c.openTime;
    switch (g) {
      case 'weekday': return ot ? WEEKDAYS[new Date(ot + IST_MS).getUTCDay()] : '';
      case 'hour': return ot ? `${String(new Date(ot + IST_MS).getUTCHours()).padStart(2, '0')}:00` : '';
      case 'month': return t.c.closeTime ? istDate(t.c.closeTime).slice(0, 7) : '';
      case 'followedPlan': return t.followedPlan == null ? '' : t.followedPlan ? 'Followed plan' : 'Broke plan';
      case 'account': return (S.data.accounts.find((a) => a.id === t.accountId) || {}).name;
      default: return t[g];
    }
  }

  function breakdownTable(rows, { costMode = false } = {}) {
    if (!rows.length) return '<div class="empty small">No closed trades in this range.</div>';
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.net)));
    return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${costMode ? 'Mistake' : 'Group'}</th><th class="num">Trades</th>${costMode ? '' : '<th class="num">Win %</th><th class="num">Avg R</th><th class="num">PF</th>'}<th class="num">Net</th><th class="barcol"></th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.key)}</td><td class="num">${r.count}</td>${costMode ? '' : `<td class="num">${pct(r.winRate)}</td><td class="num ${pnlCls(r.avgR)}">${rr(r.avgR)}</td><td class="num">${r.profitFactor === Infinity ? '∞' : r.profitFactor ?? '—'}</td>`}
        <td class="num ${pnlCls(r.net)}"><b>${money(r.net, currency(), true)}</b></td>
        <td class="barcol"><span class="hbar ${r.net >= 0 ? 'pos' : 'neg'}" style="width:${Math.round((Math.abs(r.net) / max) * 100)}%"></span></td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderReports() {
    const trades = rangeTrades();
    const g = $('rGroup').value;
    let rows = JCalc.breakdown(trades, (t) => groupKey(t, g));
    if (g === 'weekday') rows.sort((a, b) => WEEKDAYS.indexOf(a.key) - WEEKDAYS.indexOf(b.key));
    if (g === 'hour' || g === 'month') rows.sort((a, b) => (a.key > b.key ? 1 : -1));
    $('rTable').innerHTML = breakdownTable(rows);
    const mist = JCalc.breakdown(trades.filter((t) => t.mistakes.length), (t) => t.mistakes).sort((a, b) => a.net - b.net);
    $('rMistakes').innerHTML = breakdownTable(mist, { costMode: true });

    const rs = trades.filter((t) => t.c.status === 'Closed' && t.c.r != null).map((t) => t.c.r);
    const bins = [[-Infinity, -2, '≤ −2R'], [-2, -1, '−2…−1'], [-1, -0.5, '−1…−0.5'], [-0.5, 0, '−0.5…0'], [0, 0.5, '0…0.5'], [0.5, 1, '0.5…1'], [1, 2, '1…2'], [2, 3, '2…3'], [3, Infinity, '≥ 3R']];
    barChart($('rHist'), rs.length ? bins.map(([a, b, l]) => ({ y: rs.filter((r) => r >= a && r < b).length, label: l, neg: b <= 0 })).map((x) => ({ ...x, tip: `${x.label}<br><b>${x.y} trade${x.y === 1 ? '' : 's'}</b>` })) : [], { polar: false, fmt: (v) => v });
    $('rHist').querySelectorAll('rect.bar').forEach((r, i) => { if (bins[i] && bins[i][1] <= 0) r.classList.add('negsoft'); });

    const st = JCalc.stats(trades, startBalance());
    const longS = JCalc.stats(trades.filter((t) => t.direction === 'Long')), shortS = JCalc.stats(trades.filter((t) => t.direction === 'Short'));
    const planned = trades.filter((t) => t.c.plannedRR != null);
    $('rMore').innerHTML = `<dl class="dl">
      <dt>Best trade</dt><dd class="pos">${money(st.best, currency(), true)}</dd>
      <dt>Worst trade</dt><dd class="neg">${money(st.worst, currency(), true)}</dd>
      <dt>Gross profit / loss</dt><dd>${money(st.grossWin)} / ${money(-st.grossLoss)}</dd>
      <dt>Long trades</dt><dd>${longS.count} · ${pct(longS.winRate)} · <span class="${pnlCls(longS.net)}">${money(longS.net, currency(), true)}</span></dd>
      <dt>Short trades</dt><dd>${shortS.count} · ${pct(shortS.winRate)} · <span class="${pnlCls(shortS.net)}">${money(shortS.net, currency(), true)}</span></dd>
      <dt>Avg planned R:R</dt><dd>${planned.length ? (planned.reduce((s, t) => s + t.c.plannedRR, 0) / planned.length).toFixed(2) : '—'}</dd>
      <dt>Avg holding time</dt><dd>${hold(st.avgHoldMins)}</dd>
      <dt>Total fees</dt><dd>${money(st.fees)}</dd>
      <dt>Trades with mistakes</dt><dd>${trades.filter((t) => t.mistakes.length).length} of ${trades.length}</dd>
      <dt>Ending balance</dt><dd>${money(st.endBalance)}</dd></dl>`;
  }

  // ---------- tools ----------
  function renderTools() {
    if ($('fAccount').value && !$('psAcc').dataset.touched) $('psAcc').value = $('fAccount').value;
    const a = S.data.accounts.find((x) => x.id === $('psAcc').value) || S.data.accounts[0];
    if (!$('psBal').value || $('psBal').dataset.acc !== a.id) {
      const realized = S.data.trades.filter((t) => t.accountId === a.id && t.c.status === 'Closed').reduce((s, t) => s + (t.c.net || 0), 0);
      $('psBal').value = Math.round((a.startingBalance + realized) * 100) / 100; $('psBal').dataset.acc = a.id; $('psRisk').value = a.riskPct;
    }
    calcPs();
    $('rules').innerHTML = S.data.accounts.filter((x) => !x.archived).map((x) => `<p><b>${esc(x.name)}</b>: risk ${x.riskPct}% per trade · daily loss limit ${x.dailyLossLimit ? money(x.dailyLossLimit, x.currency) : '<span class="muted">not set</span>'} · max trades/day ${x.maxTradesPerDay || '<span class="muted">not set</span>'}</p>`).join('');
  }

  function calcPs() {
    const a = S.data.accounts.find((x) => x.id === $('psAcc').value) || S.data.accounts[0];
    const r = JCalc.positionSize({ balance: $('psBal').value, riskPct: $('psRisk').value, entry: $('psEntry').value, stop: $('psStop').value, multiplier: $('psMult').value, lotSize: $('psLot').value });
    if (!r) { $('psOut').innerHTML = '<p class="muted small">Fill in balance, risk %, entry and stop loss.</p>'; return; }
    const e = Number($('psEntry').value), s = Number($('psStop').value), tg = Number($('psTarget').value);
    const rrv = tg ? Math.abs(tg - e) / Math.abs(e - s) : null;
    const lot = Number($('psLot').value) || 1;
    $('psOut').innerHTML = `<div class="kpis small3">
      ${kpi('Risk amount', money(r.riskMoney, a.currency))}
      ${kpi(lot > 1 ? 'Lots' : 'Quantity', lot > 1 ? r.lots : Math.floor(r.units * 100) / 100, lot > 1 ? `${r.qtyForLots} qty · exact ${r.units}` : '')}
      ${kpi('Actual risk', money(lot > 1 ? r.actualRisk : r.riskMoney, a.currency), lot > 1 ? 'rounded down to whole lots' : '')}
      ${rrv ? kpi('Reward : risk', `${rrv.toFixed(2)} : 1`, `target pays ${money((lot > 1 ? r.qtyForLots : r.units) * Math.abs(tg - e) * (Number($('psMult').value) || 1), a.currency)}`) : ''}
      ${lot > 1 && r.lots === 0 ? kpi('⚠ Too small', '0 lots', `1 lot risks ${money(lot * Math.abs(e - s) * (Number($('psMult').value) || 1), a.currency)}, more than your ${money(r.riskMoney, a.currency)}`, 'neg') : ''}
      ${kpi('1R / 2R / 3R price', [1, 2, 3].map((k) => JCalc.round(e + (e > s ? 1 : -1) * k * Math.abs(e - s), 5)).join(' · '))}</div>`;
  }

  // ---------- setup ----------
  function renderSetup() {
    const d = S.data;
    $('accTable').innerHTML = `<thead><tr><th>Name</th><th>Type</th><th>Broker</th><th class="num">Start</th><th class="num">Realized</th><th class="num">Balance</th><th class="num">Trades</th><th>Rules</th><th></th></tr></thead><tbody>
      ${d.accounts.map((a) => {
        const tr = d.trades.filter((t) => t.accountId === a.id);
        const realized = tr.filter((t) => t.c.status === 'Closed').reduce((s, t) => s + (t.c.net || 0), 0);
        return `<tr class="${a.archived ? 'off' : ''}"><td><b>${esc(a.name)}</b> <span class="muted small">${a.currency}</span></td><td>${esc(a.type)}</td><td>${esc(a.broker || '—')}</td>
          <td class="num">${money(a.startingBalance, a.currency)}</td><td class="num ${pnlCls(realized)}">${money(realized, a.currency, true)}</td><td class="num"><b>${money(a.startingBalance + realized, a.currency)}</b></td><td class="num">${tr.length}</td>
          <td class="small">${a.riskPct}%${a.dailyLossLimit ? ` · DLL ${money(a.dailyLossLimit, a.currency)}` : ''}${a.maxTradesPerDay ? ` · ${a.maxTradesPerDay}/day` : ''}</td>
          <td><div class="acts"><button class="ghost" data-aedit="${a.id}">Edit</button><button class="ghost" data-aarch="${a.id}">${a.archived ? 'Unarchive' : 'Archive'}</button>${tr.length ? '' : `<button class="danger" data-adel="${a.id}">Delete</button>`}</div></td></tr>`;
      }).join('')}</tbody>`;
    const s = d.settings;
    $('lSetups').value = s.setups.join('\n'); $('lMistakes').value = s.mistakes.join('\n'); $('lEmotions').value = s.emotions.join('\n');
    $('lTags').value = s.tags.join('\n'); $('lTf').value = s.timeframes.join('\n'); $('lBE').value = s.beThreshold || '';
  }

  function editAccount(a) {
    $('aId').value = a ? a.id : ''; $('aName').value = a ? a.name : ''; $('aBroker').value = a ? a.broker : '';
    $('aType').value = a ? a.type : 'Live'; $('aCcy').value = a ? a.currency : 'INR'; $('aBal').value = a ? a.startingBalance : '';
    $('aRisk').value = a ? a.riskPct : 1; $('aDLL').value = a && a.dailyLossLimit != null ? a.dailyLossLimit : ''; $('aMax').value = a && a.maxTradesPerDay != null ? a.maxTradesPerDay : '';
    $('aSave').textContent = a ? 'Save account' : 'Add account'; $('aCancel').hidden = !a;
    if (a) $('accForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ---------- trade editor ----------
  function chipPicker(el, options, selected) {
    const sel = new Set(selected);
    const all = [...new Set([...options, ...selected])];
    el.innerHTML = all.map((o) => `<button type="button" class="chip ${sel.has(o) ? 'on' : ''}" data-v="${esc(o)}">${esc(o)}</button>`).join('') + '<input type="text" class="chipadd" placeholder="+ add" />';
    el.onclick = (e) => { const b = e.target.closest('button.chip'); if (b) { b.classList.toggle('on'); } };
    el.querySelector('.chipadd').onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = e.target.value.trim(); if (!v) return;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip on'; b.dataset.v = v; b.textContent = v;
      el.insertBefore(b, e.target); e.target.value = '';
    };
  }
  const chipValues = (el) => [...el.querySelectorAll('button.chip.on')].map((b) => b.dataset.v);

  function segSet(el, v) { el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(v))); el.dataset.value = v == null ? '' : String(v); }
  function segInit(el, onChange) { el.onclick = (e) => { const v = e.target.dataset.v; if (v == null) return; segSet(el, el.dataset.value === v && el.id === 'tfPlan' ? null : v); onChange && onChange(); }; }

  function legRow(kind, l = {}) {
    const div = document.createElement('div');
    div.className = 'leg';
    div.innerHTML = `<input type="datetime-local" class="inp lt" value="${istInput(l.time)}" title="Time (IST)" />
      <input type="text" inputmode="decimal" class="inp lp" placeholder="Price" value="${l.price ?? ''}" />
      <input type="text" inputmode="decimal" class="inp lq" placeholder="Qty" value="${l.qty ?? ''}" />
      <button type="button" class="ghost lx" title="Remove">✕</button>`;
    div.querySelector('.lx').onclick = () => { div.remove(); updateCalc(); };
    div.querySelectorAll('input').forEach((i) => i.addEventListener('input', updateCalc));
    $(kind === 'entries' ? 'tfEntries' : 'tfExits').appendChild(div);
  }
  const readLegs = (id) => [...$(id).querySelectorAll('.leg')].map((r) => ({ time: fromInput(r.querySelector('.lt').value), price: r.querySelector('.lp').value, qty: r.querySelector('.lq').value })).filter((l) => l.price !== '' || l.qty !== '');

  function readForm() {
    return {
      accountId: $('tfAcc').value, symbol: $('tfSymbol').value.trim(), market: $('tfMarket').value, direction: $('tfDir').dataset.value || 'Long',
      optionType: $('tfOpt').value, strike: $('tfStrike').value, expiry: $('tfExpiry').value, multiplier: $('tfMult').value,
      entries: readLegs('tfEntries'), exits: readLegs('tfExits'),
      stopLoss: $('tfSL').value, target: $('tfTP').value, fees: $('tfFees').value, pnlOverride: $('tfPnl').value,
      setup: $('tfSetup').value, timeframe: $('tfTf').value, htfBias: $('tfBias').value, grade: $('tfGrade').value,
      confidence: Number($('tfConf').dataset.value || 0), followedPlan: $('tfPlan').dataset.value === '' ? null : $('tfPlan').dataset.value === 'true',
      chartLink: $('tfLink').value.trim(), tags: chipValues($('tfTags')), emotionsBefore: chipValues($('tfEmoB')), emotionsAfter: chipValues($('tfEmoA')), mistakes: chipValues($('tfMist')),
      thesis: $('tfThesis').value, management: $('tfMgmt').value, review: $('tfReview').value, lessons: $('tfLessons').value,
      newsContext: S.editing ? S.editing.newsContext : [],
    };
  }

  function updateCalc() {
    const f = readForm();
    const c = JCalc.compute({ ...f, beThreshold: S.data.settings.beThreshold });
    const ccy = accCcy(f.accountId);
    document.querySelectorAll('.optonly').forEach((el) => { el.hidden = f.market !== 'Options'; });
    $('tfCalc').innerHTML = `<span>Status <b>${c.status}</b></span><span>Avg entry <b>${c.avgEntry ?? '—'}</b></span><span>Avg exit <b>${c.avgExit ?? '—'}</b></span>
      <span>Open qty <b>${c.openQty || 0}</b></span><span>Gross <b>${money(c.gross, ccy, true)}</b></span><span>Net <b class="${pnlCls(c.net)}">${money(c.net, ccy, true)}</b></span>
      <span>Risk <b>${money(c.risk, ccy)}</b></span><span>R <b class="${pnlCls(c.r)}">${rr(c.r)}</b></span><span>Planned R:R <b>${c.plannedRR ?? '—'}</b></span>
      <span>Session <b>${JCalc.session(c.openTime, f.market) || '—'}</b></span><span>Hold <b>${hold(c.holdMins)}</b></span>`;
    $('tfSummary').innerHTML = c.net != null ? `<b class="${pnlCls(c.net)}">${money(c.net, ccy, true)}</b> ${rr(c.r)}` : `<span class="pill st-${c.status}">${c.status}</span>`;
  }

  function fillSelect(el, list, value, blank = '—') {
    const all = [...new Set([...list, ...(value ? [value] : [])])];
    el.innerHTML = `<option value="">${blank}</option>` + all.map((x) => `<option>${esc(x)}</option>`).join('');
    el.value = value || '';
  }

  function openTrade(t, copy = false) {
    const d = S.data, s = d.settings;
    S.editing = copy ? null : t || null;
    const x = t || { accountId: $('fAccount').value || (d.accounts.find((a) => !a.archived) || d.accounts[0]).id, market: $('fMarket').value || 'Equity', direction: 'Long', multiplier: 1, entries: [], exits: [], tags: [], mistakes: [], emotionsBefore: [], emotionsAfter: [], screenshots: [], newsContext: [], setup: $('fSetup').value };
    $('tfTitle').textContent = S.editing ? `Edit ${S.editing.symbol}` : copy ? `Copy of ${t.symbol}` : 'New trade';
    $('tfAcc').innerHTML = d.accounts.filter((a) => !a.archived || a.id === x.accountId).map((a) => `<option value="${a.id}">${esc(a.name)} · ${a.currency}</option>`).join('');
    $('tfAcc').value = x.accountId;
    $('tfSymbol').value = x.symbol || ''; $('tfMarket').innerHTML = d.markets.map((m) => `<option>${m}</option>`).join(''); $('tfMarket').value = x.market;
    segSet($('tfDir'), x.direction);
    $('tfOpt').value = x.optionType || ''; $('tfStrike').value = x.strike ?? ''; $('tfExpiry').value = x.expiry || ''; $('tfMult').value = x.multiplier ?? 1;
    $('tfEntries').innerHTML = ''; $('tfExits').innerHTML = '';
    (copy ? [] : x.entries).forEach((l) => legRow('entries', l));
    if (!$('tfEntries').children.length) legRow('entries', { time: Date.now() });
    (copy ? [] : x.exits).forEach((l) => legRow('exits', l));
    $('tfSL').value = copy ? '' : x.stopLoss ?? ''; $('tfTP').value = copy ? '' : x.target ?? ''; $('tfFees').value = copy ? '' : x.fees || ''; $('tfPnl').value = copy ? '' : x.pnlOverride ?? '';
    fillSelect($('tfSetup'), s.setups, x.setup); fillSelect($('tfTf'), s.timeframes, x.timeframe);
    $('tfBias').value = x.htfBias || ''; $('tfGrade').value = copy ? '' : x.grade || ''; $('tfLink').value = copy ? '' : x.chartLink || '';
    stars($('tfConf'), copy ? 0 : x.confidence || 0);
    segSet($('tfPlan'), copy || x.followedPlan == null ? null : x.followedPlan);
    chipPicker($('tfTags'), s.tags, x.tags || []);
    chipPicker($('tfEmoB'), s.emotions, copy ? [] : x.emotionsBefore || []);
    chipPicker($('tfEmoA'), s.emotions, copy ? [] : x.emotionsAfter || []);
    chipPicker($('tfMist'), s.mistakes, copy ? [] : x.mistakes || []);
    $('tfThesis').value = copy ? '' : x.thesis || ''; $('tfMgmt').value = copy ? '' : x.management || ''; $('tfReview').value = copy ? '' : x.review || ''; $('tfLessons').value = copy ? '' : x.lessons || '';
    $('tfDel').hidden = !S.editing; $('tfDup').hidden = !S.editing; $('tfMsg').textContent = '';
    renderShots(); renderNewsCtx();
    updateCalc();
    if (!$('tradeDlg').open) $('tradeDlg').showModal();
  }

  function renderShots() {
    const t = S.editing;
    $('tfShotsBox').querySelector('label.filebtn').hidden = false;
    $('shotMsg').textContent = t ? '' : 'Save the trade first, then add screenshots.';
    $('tfShots').innerHTML = t ? t.screenshots.map((s) => `<figure data-sid="${s.id}"><img src="/api/journal/files/${s.file}" alt="${esc(s.caption || s.name)}" loading="lazy" /><figcaption><input class="inp cap" value="${esc(s.caption)}" placeholder="Caption" /><button type="button" class="ghost sx" title="Delete">✕</button></figcaption></figure>`).join('') : '';
  }

  function renderNewsCtx() {
    const t = S.editing;
    const list = t ? t.newsContext : [];
    $('tfNewsRefresh').hidden = !t;
    $('tfNews').innerHTML = list.length ? `<ul class="mini">${list.map((n) => `<li><span class="badge ${n.impact}">${n.kind === 'event' ? '📅 ' : ''}${esc(n.impact)}</span> <span class="muted">${fmtDT(n.time)}</span> ${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>` : esc(n.title)} <span class="muted">· ${esc(n.source)}</span></li>`).join('')}</ul>`
      : `<p class="muted">${t ? 'No High/Medium-impact news or calendar events in the 90 minutes before to 30 minutes after entry.' : 'Saved automatically when you save the trade: High/Medium news and calendar events from 90 min before to 30 min after entry.'}</p>`;
  }

  async function uploadFiles(files) {
    if (!S.editing) return flash($('shotMsg'), 'Save the trade first, then add screenshots.', false);
    for (const f of files) {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) { flash($('shotMsg'), `${f.name}: not a supported image`, false); continue; }
      if (f.size > 6 * 1024 * 1024) { flash($('shotMsg'), `${f.name}: larger than 6 MB`, false); continue; }
      const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
      try {
        flash($('shotMsg'), 'Uploading…');
        const data = await api(`/api/journal/trades/${S.editing.id}/screenshots`, { method: 'POST', body: { name: f.name, dataUrl } });
        S.data = data; S.editing = data.trades.find((x) => x.id === S.editing.id);
        renderShots(); flash($('shotMsg'), 'Added');
      } catch (e) { flash($('shotMsg'), e.message, false); }
    }
    render();
  }

  // ---------- events ----------
  function bind() {
    $('tabs').onclick = (e) => { const t = e.target.dataset.tab; if (t) { S.tab = t; render(); } };
    ['fAccount', 'fMarket', 'fSetup'].forEach((id) => $(id).addEventListener('change', () => { fillFilterOptions(); render(); }));
    $('fAccount').addEventListener('change', () => { try { localStorage.setItem('td-acc', $('fAccount').value); } catch {} });
    $('fRange').addEventListener('change', () => { $('customRange').hidden = $('fRange').value !== 'custom'; render(); });
    ['fFrom', 'fTo'].forEach((id) => $(id).addEventListener('change', render));
    ['tSearch', 'tStatus', 'tResult', 'tDir'].forEach((id) => $(id).addEventListener('input', renderTrades));
    $('rGroup').addEventListener('change', renderReports);
    $('newTrade').onclick = () => openTrade(null);

    // open trade on row/list click; sort on header click
    document.body.addEventListener('click', (e) => {
      const th = e.target.closest('th[data-sort]');
      if (th && S.tab === 'trades') { const k = th.dataset.sort; S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : -1 }; renderTrades(); return; }
      const row = e.target.closest('tr[data-id], li[data-id]');
      if (row && !e.target.closest('a')) { const t = S.data.trades.find((x) => x.id === row.dataset.id); if (t) openTrade(t); }
      const cell = e.target.closest('.calc[data-day]');
      if (cell) openDay(cell.dataset.day);
    });

    // calendar nav
    const shift = (n) => { const [y, m] = S.calMonth.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); S.calMonth = d.toISOString().slice(0, 7); $('calDay').hidden = true; renderCalendar(); };
    $('calPrev').onclick = () => shift(-1); $('calNext').onclick = () => shift(1);
    $('calToday').onclick = () => { S.calMonth = todayStr().slice(0, 7); renderCalendar(); };

    // daily journal
    const dShift = (n) => { $('dDate').value = istDate(dayStart($('dDate').value) + n * DAY + 3600e3); renderDaily(); };
    $('dPrev').onclick = () => dShift(-1); $('dNext').onclick = () => dShift(1);
    $('dToday').onclick = () => { $('dDate').value = todayStr(); renderDaily(); };
    $('dDate').onchange = renderDaily;
    $('noteForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await reload(await api(`/api/journal/notes/${$('dDate').value}`, { method: 'PUT', body: { bias: $('nBias').value, keyLevels: $('nLevels').value, plan: $('nPlan').value, review: $('nReview').value, lessons: $('nLessons').value, mood: Number($('nMood').dataset.value), discipline: Number($('nDisc').dataset.value) } }));
        flash($('noteMsg'), 'Saved');
      } catch (err) { flash($('noteMsg'), err.message, false); }
    };

    // tools
    $('psForm').addEventListener('input', calcPs);
    $('psAcc').addEventListener('change', () => { $('psAcc').dataset.touched = '1'; $('psBal').value = ''; renderTools(); });

    // accounts
    $('accTable').onclick = async (e) => {
      const d = e.target.dataset;
      try {
        if (d.aedit) editAccount(S.data.accounts.find((a) => a.id === d.aedit));
        if (d.aarch) { const a = S.data.accounts.find((x) => x.id === d.aarch); await reload(await api(`/api/journal/accounts/${a.id}`, { method: 'PUT', body: { archived: !a.archived } })); }
        if (d.adel && confirm('Delete this account?')) await reload(await api(`/api/journal/accounts/${d.adel}`, { method: 'DELETE' }));
      } catch (err) { flash($('accMsg'), err.message, false); }
    };
    $('aCancel').onclick = () => editAccount(null);
    $('accForm').onsubmit = async (e) => {
      e.preventDefault();
      const body = { name: $('aName').value, broker: $('aBroker').value, type: $('aType').value, currency: $('aCcy').value, startingBalance: $('aBal').value, riskPct: $('aRisk').value, dailyLossLimit: $('aDLL').value, maxTradesPerDay: $('aMax').value };
      try {
        const id = $('aId').value;
        await reload(await api(id ? `/api/journal/accounts/${id}` : '/api/journal/accounts', { method: id ? 'PUT' : 'POST', body }));
        flash($('accMsg'), id ? 'Saved' : 'Account added'); editAccount(null);
      } catch (err) { flash($('accMsg'), err.message, false); }
    };
    $('listsForm').onsubmit = async (e) => {
      e.preventDefault();
      const lines = (id) => $(id).value.split('\n').map((x) => x.trim()).filter(Boolean);
      try {
        await reload(await api('/api/journal/settings', { method: 'PUT', body: { setups: lines('lSetups'), mistakes: lines('lMistakes'), emotions: lines('lEmotions'), tags: lines('lTags'), timeframes: lines('lTf'), beThreshold: $('lBE').value } }));
        flash($('listsMsg'), 'Saved');
      } catch (err) { flash($('listsMsg'), err.message, false); }
    };

    // import / restore
    $('impFile').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try {
        const r = await api('/api/journal/import', { method: 'POST', body: { csv: await f.text(), accountId: $('impAcc').value } });
        flash($('impMsg'), `Imported ${r.added} trade${r.added === 1 ? '' : 's'}${r.errors.length ? `. Skipped: ${r.errors.join('; ')}` : ''}`, !r.errors.length || r.added > 0);
        await reload();
      } catch (err) { flash($('impMsg'), err.message, false); }
    };
    $('restoreFile').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      if (!confirm('Restoring replaces your whole journal with the backup. Continue?')) return;
      try {
        const r = await api('/api/journal/restore', { method: 'POST', body: await f.text() });
        flash($('restoreMsg'), `Restored ${r.trades} trades`); await reload();
      } catch (err) { flash($('restoreMsg'), err.message, false); }
    };

    // trade editor
    segInit($('tfDir'), updateCalc); segInit($('tfPlan'));
    document.querySelectorAll('[data-add]').forEach((b) => { b.onclick = () => { legRow(b.dataset.add, { time: Date.now() }); updateCalc(); }; });
    ['tfAcc', 'tfMarket', 'tfMult', 'tfSL', 'tfTP', 'tfFees', 'tfPnl'].forEach((id) => $(id).addEventListener('input', updateCalc));
    $('tfMarket').addEventListener('change', () => { if ($('tfMarket').value === 'Forex' && $('tfMult').value === '1') $('tfMult').value = 100000; updateCalc(); });
    $('tfClose').onclick = () => $('tradeDlg').close();
    $('tradeForm').onsubmit = async (e) => {
      e.preventDefault();
      const body = readForm();
      if (!body.entries.length) return flash($('tfMsg'), 'Add at least one entry (price and qty)', false);
      try {
        const id = S.editing && S.editing.id;
        const data = await api(id ? `/api/journal/trades/${id}` : '/api/journal/trades', { method: id ? 'PUT' : 'POST', body });
        const saved = id ? data.trades.find((x) => x.id === id) : data.trades[data.trades.length - 1];
        await reload(data);
        S.editing = saved; $('tfTitle').textContent = `Edit ${saved.symbol}`; $('tfDel').hidden = false; $('tfDup').hidden = false;
        renderShots(); renderNewsCtx();
        flash($('tfMsg'), id ? 'Saved' : 'Saved. You can add screenshots now.');
      } catch (err) { flash($('tfMsg'), err.message, false); }
    };
    $('tfDel').onclick = async () => {
      if (!S.editing || !confirm(`Delete this ${S.editing.symbol} trade?`)) return;
      await reload(await api(`/api/journal/trades/${S.editing.id}`, { method: 'DELETE' }));
      $('tradeDlg').close();
    };
    $('tfDup').onclick = () => openTrade(S.data.trades.find((x) => x.id === S.editing.id), true);
    $('tfNewsRefresh').onclick = async () => {
      const data = await api(`/api/journal/trades/${S.editing.id}/refresh-news`, { method: 'POST' });
      S.data = data; S.editing = data.trades.find((x) => x.id === S.editing.id); renderNewsCtx();
    };
    $('tfShotFile').onchange = (e) => { const fs = [...e.target.files]; e.target.value = ''; uploadFiles(fs); };
    $('tradeDlg').addEventListener('paste', (e) => {
      const files = [...(e.clipboardData || {}).items || []].filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile());
      if (files.length) { e.preventDefault(); uploadFiles(files); }
    });
    $('tfShots').addEventListener('click', async (e) => {
      const fig = e.target.closest('figure'); if (!fig) return;
      const sid = fig.dataset.sid;
      if (e.target.classList.contains('sx')) {
        if (!confirm('Delete this screenshot?')) return;
        const data = await api(`/api/journal/trades/${S.editing.id}/screenshots/${sid}`, { method: 'DELETE' });
        S.data = data; S.editing = data.trades.find((x) => x.id === S.editing.id); renderShots(); render();
      } else if (e.target.tagName === 'IMG') {
        $('lbImg').src = e.target.src; $('lbCap').textContent = fig.querySelector('.cap').value; $('lightbox').showModal();
      }
    });
    $('tfShots').addEventListener('change', async (e) => {
      if (!e.target.classList.contains('cap')) return;
      const sid = e.target.closest('figure').dataset.sid;
      const data = await api(`/api/journal/trades/${S.editing.id}/screenshots/${sid}`, { method: 'PATCH', body: { caption: e.target.value } });
      S.data = data; S.editing = data.trades.find((x) => x.id === S.editing.id);
    });
    $('lightbox').onclick = () => $('lightbox').close();
    window.addEventListener('resize', () => { clearTimeout(S.rz); S.rz = setTimeout(render, 150); });
    document.addEventListener('keydown', (e) => { if (e.key === 'n' && !e.target.closest('input,textarea,select,dialog')) { e.preventDefault(); openTrade(null); } });
  }

  // ---------- start ----------
  (async () => {
    S.me = await api('/api/me');
    MN.nav($('nav'), S.me.user, 'journal');
    bind();
    try { S.tab = localStorage.getItem('td-tab') || 'dashboard'; } catch {}
    const origRender = render;
    render = () => { try { localStorage.setItem('td-tab', S.tab); } catch {} origRender(); };
    await reload();
  })();
})();
