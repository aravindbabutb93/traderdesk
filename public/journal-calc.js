// Trade maths shared by the server (require) and the browser (window.JCalc).
// A trade has entry and exit legs, so scaling in and out is supported:
//   entries: [{time, price, qty}]   exits: [{time, price, qty}]
// qty is in units/lots; multiplier converts price moves into money
// (lot size for F&O, contract size for FX, 1 for cash equity).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const round = (v, d = 2) => (v == null || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

  function wavg(legs) {
    const q = sum(legs.map((l) => l.qty));
    return q ? sum(legs.map((l) => l.price * l.qty)) / q : null;
  }

  const cleanLegs = (legs) =>
    (Array.isArray(legs) ? legs : [])
      .map((l) => ({ time: num(l.time), price: num(l.price), qty: num(l.qty) }))
      .filter((l) => l.price != null && l.qty != null && l.qty > 0);

  // Derived fields for one trade
  function compute(t) {
    const entries = cleanLegs(t.entries);
    const exits = cleanLegs(t.exits);
    const dir = t.direction === 'Short' ? -1 : 1;
    const mult = num(t.multiplier) || 1;
    const fees = num(t.fees) || 0;
    const qtyIn = sum(entries.map((l) => l.qty));
    const qtyOut = Math.min(sum(exits.map((l) => l.qty)), qtyIn);
    const avgEntry = wavg(entries);
    const avgExit = wavg(exits);
    const openQty = round(qtyIn - qtyOut, 6);
    const status = !entries.length ? 'Planned' : openQty > 0 ? (qtyOut > 0 ? 'Partial' : 'Open') : 'Closed';

    let gross = avgEntry != null && avgExit != null ? (avgExit - avgEntry) * qtyOut * mult * dir : null;
    const manual = num(t.pnlOverride);
    let net = manual != null ? manual : gross != null ? gross - fees : null;
    if (status === 'Open' || status === 'Planned') net = manual != null ? manual : null;

    const sl = num(t.stopLoss);
    const tp = num(t.target);
    const riskPerUnit = avgEntry != null && sl != null ? Math.abs(avgEntry - sl) : null;
    const risk = num(t.riskOverride) != null ? num(t.riskOverride) : riskPerUnit != null && qtyIn ? riskPerUnit * qtyIn * mult : null;
    const r = net != null && risk ? net / risk : null;
    const plannedRR = riskPerUnit && tp != null ? Math.abs(tp - avgEntry) / riskPerUnit : null;

    const openTime = entries.length ? Math.min(...entries.map((l) => l.time || Infinity)) : num(t.plannedTime);
    const closeTime = status === 'Closed' && exits.length ? Math.max(...exits.map((l) => l.time || 0)) : null;
    const result = net == null ? null : Math.abs(net) < (num(t.beThreshold) || 1e-9) ? 'BE' : net > 0 ? 'Win' : 'Loss';

    return {
      status, qty: qtyIn, openQty, avgEntry: round(avgEntry, 6), avgExit: round(avgExit, 6),
      gross: round(gross), net: round(net), risk: round(risk), r: round(r), plannedRR: round(plannedRR),
      openTime: isFinite(openTime) ? openTime : null, closeTime,
      holdMins: openTime && closeTime ? Math.round((closeTime - openTime) / 60000) : null,
      result,
    };
  }

  // Trading session from entry time (IST based)
  function session(ts, market) {
    if (!ts) return '';
    const d = new Date(ts + 5.5 * 3600e3); // shift to IST
    const m = d.getUTCHours() * 60 + d.getUTCMinutes();
    if (market !== 'Forex' && market !== 'Crypto') {
      if (m >= 555 && m < 600) return 'Open (9:15-10)';
      if (m >= 600 && m < 810) return 'Mid-day';
      if (m >= 810 && m <= 930) return 'Close (13:30-15:30)';
      return 'Outside hours';
    }
    // FX kill zones in IST (approx.): Asia 05:30-12:30, London 12:30-17:30, NY 17:30-22:30
    if (m >= 750 && m < 1050) return 'London';
    if (m >= 1050 && m < 1350) return 'New York';
    if (m >= 330 && m < 750) return 'Asia';
    return 'Off-session';
  }

  // Portfolio statistics for a list of computed trades (closed only)
  function stats(trades, startBalance = 0) {
    const closed = trades.filter((t) => t.c.status === 'Closed' && t.c.net != null).sort((a, b) => (a.c.closeTime || 0) - (b.c.closeTime || 0));
    const wins = closed.filter((t) => t.c.result === 'Win');
    const losses = closed.filter((t) => t.c.result === 'Loss');
    const be = closed.filter((t) => t.c.result === 'BE');
    const grossWin = sum(wins.map((t) => t.c.net));
    const grossLoss = -sum(losses.map((t) => t.c.net));
    const net = sum(closed.map((t) => t.c.net));
    const withR = closed.filter((t) => t.c.r != null);

    let equity = startBalance, peak = startBalance, maxDD = 0, maxDDPct = 0;
    let streakW = 0, streakL = 0, maxW = 0, maxL = 0;
    const curve = [];
    for (const t of closed) {
      equity += t.c.net;
      peak = Math.max(peak, equity);
      const dd = peak - equity;
      if (dd > maxDD) { maxDD = dd; maxDDPct = peak ? (dd / peak) * 100 : 0; }
      if (t.c.result === 'Win') { streakW++; streakL = 0; } else if (t.c.result === 'Loss') { streakL++; streakW = 0; }
      maxW = Math.max(maxW, streakW); maxL = Math.max(maxL, streakL);
      curve.push({ time: t.c.closeTime, equity: round(equity), net: t.c.net, id: t.id, symbol: t.symbol });
    }
    const decided = wins.length + losses.length;
    const winRate = decided ? wins.length / decided : null;
    const avgWin = wins.length ? grossWin / wins.length : null;
    const avgLoss = losses.length ? grossLoss / losses.length : null;
    const holds = closed.filter((t) => t.c.holdMins != null).map((t) => t.c.holdMins);

    return {
      count: closed.length, open: trades.filter((t) => t.c.status === 'Open' || t.c.status === 'Partial').length,
      wins: wins.length, losses: losses.length, be: be.length,
      winRate, net: round(net), grossWin: round(grossWin), grossLoss: round(grossLoss),
      profitFactor: grossLoss ? round(grossWin / grossLoss) : wins.length ? Infinity : null,
      avgWin: round(avgWin), avgLoss: round(avgLoss), payoff: avgWin && avgLoss ? round(avgWin / avgLoss) : null,
      expectancy: closed.length ? round(net / closed.length) : null,
      avgR: withR.length ? round(sum(withR.map((t) => t.c.r)) / withR.length) : null,
      totalR: withR.length ? round(sum(withR.map((t) => t.c.r))) : null,
      best: closed.length ? Math.max(...closed.map((t) => t.c.net)) : null,
      worst: closed.length ? Math.min(...closed.map((t) => t.c.net)) : null,
      maxDD: round(maxDD), maxDDPct: round(maxDDPct), maxWinStreak: maxW, maxLossStreak: maxL,
      fees: round(sum(closed.map((t) => Number(t.fees) || 0))),
      avgHoldMins: holds.length ? Math.round(sum(holds) / holds.length) : null,
      endBalance: round(equity), curve,
    };
  }

  // Group closed trades by a key function -> rows with count, win rate, net, avg R
  function breakdown(trades, keyFn) {
    const groups = new Map();
    for (const t of trades) {
      if (t.c.status !== 'Closed' || t.c.net == null) continue;
      const keys = [].concat(keyFn(t)).filter((k) => k !== undefined && k !== null && k !== '');
      for (const k of keys.length ? keys : ['(none)']) {
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(t);
      }
    }
    return [...groups.entries()].map(([key, list]) => {
      const s = stats(list);
      return { key, count: s.count, winRate: s.winRate, net: s.net, avgR: s.avgR, profitFactor: s.profitFactor, expectancy: s.expectancy };
    }).sort((a, b) => b.net - a.net);
  }

  // Position size from risk
  function positionSize({ balance, riskPct, riskAmount, entry, stop, multiplier = 1, lotSize = 1 }) {
    const riskMoney = num(riskAmount) != null ? num(riskAmount) : (num(balance) || 0) * (num(riskPct) || 0) / 100;
    const perUnit = Math.abs(num(entry) - num(stop)) * (num(multiplier) || 1);
    if (!riskMoney || !perUnit) return null;
    const units = riskMoney / perUnit;
    const lots = Math.floor(units / (num(lotSize) || 1));
    return { riskMoney: round(riskMoney), units: round(units, 4), lots, qtyForLots: lots * (num(lotSize) || 1), actualRisk: round(lots * (num(lotSize) || 1) * perUnit) };
  }

  return { compute, session, stats, breakdown, positionSize, round };
});
