// Trade journal: per-user accounts, trades, daily notes, screenshots and settings.
// Each user's journal is one file: data/journal/<userId>.json (screenshots in data/journal/files/<userId>/).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const JCalc = require('../public/journal-calc');

const DIR = path.join(__dirname, '..', 'data', 'journal');
const FILES = path.join(DIR, 'files');
const newId = () => crypto.randomBytes(8).toString('hex');

const MARKETS = ['Equity', 'Futures', 'Options', 'Forex', 'Commodity', 'Crypto', 'Index'];
const DEFAULT_SETTINGS = () => ({
  setups: [
    'Liquidity sweep → OB + FVG', 'BOS continuation (60% retrace)', 'CHoCH reversal', 'FVG fill',
    'Power of 3 / AMD', 'Kill zone breakout', 'Order block retest', 'Breakout', 'Pullback / EMA', 'News trade', 'Other',
  ],
  mistakes: [
    'Entered early (no confirmation)', 'Chased entry', 'Moved stop loss', 'No stop loss', 'Exited too early',
    'Held loser too long', 'Oversized position', 'Revenge trade', 'Overtrading', 'Traded against HTF bias',
    'Ignored news / calendar', 'Broke daily loss limit', 'FOMO',
  ],
  emotions: ['Calm', 'Confident', 'Focused', 'Anxious', 'Fearful', 'Greedy', 'Impatient', 'Frustrated', 'Bored', 'Overconfident', 'Tired'],
  tags: ['A+ setup', 'HTF aligned', 'Counter-trend', 'Scalp', 'Swing', 'Expiry day', 'Prop challenge'],
  timeframes: ['1m', '3m', '5m', '15m', '30m', '1H', '4H', '1D', '1W'],
  beThreshold: 0,
});

const str = (v, max = 200) => (v == null ? '' : String(v).trim().slice(0, max));
const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
const strList = (v, max = 30) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[;,]/)).map((x) => str(x, 80)).filter(Boolean))].slice(0, max);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);

// ---------- storage ----------
const cache = new Map(); // userId -> doc
const timers = new Map();

function file(userId) {
  if (!/^[a-f0-9]{16}$/.test(userId)) throw new Error('bad user id');
  return path.join(DIR, `${userId}.json`);
}

function load(userId) {
  if (cache.has(userId)) return cache.get(userId);
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file(userId), 'utf8'));
  } catch {
    doc = {};
  }
  doc.accounts = doc.accounts || [];
  doc.trades = doc.trades || [];
  doc.notes = doc.notes || {};
  doc.settings = { ...DEFAULT_SETTINGS(), ...(doc.settings || {}) };
  if (!doc.accounts.length) {
    doc.accounts.push(sanitizeAccount({ name: 'Main account', currency: 'INR', type: 'Live', startingBalance: 100000, riskPct: 1 }));
  }
  cache.set(userId, doc);
  return doc;
}

function save(userId) {
  if (timers.has(userId)) return;
  timers.set(userId, setTimeout(() => {
    timers.delete(userId);
    flush(userId);
  }, 500));
}

function flush(userId) {
  const doc = cache.get(userId);
  if (!doc) return;
  fs.mkdirSync(DIR, { recursive: true });
  const f = file(userId);
  fs.writeFileSync(f + '.tmp', JSON.stringify(doc));
  fs.renameSync(f + '.tmp', f);
}

function flushAll() {
  for (const [id, t] of timers) { clearTimeout(t); timers.delete(id); flush(id); }
}
process.on('SIGINT', () => { flushAll(); process.exit(0); });
process.on('SIGTERM', () => { flushAll(); process.exit(0); });

function removeUser(userId) {
  cache.delete(userId);
  try { fs.unlinkSync(file(userId)); } catch {}
  try { fs.rmSync(path.join(FILES, userId), { recursive: true, force: true }); } catch {}
}

// ---------- sanitizers ----------
function sanitizeAccount(a, old = {}) {
  return {
    id: old.id || newId(),
    name: str(a.name ?? old.name, 60) || 'Account',
    broker: str(a.broker ?? old.broker, 60),
    type: oneOf(a.type ?? old.type, ['Live', 'Demo', 'Prop / Funded', 'Paper'], 'Live'),
    currency: oneOf(a.currency ?? old.currency, ['INR', 'USD', 'EUR', 'GBP'], 'INR'),
    startingBalance: num(a.startingBalance ?? old.startingBalance) ?? 0,
    riskPct: num(a.riskPct ?? old.riskPct) ?? 1,
    dailyLossLimit: num(a.dailyLossLimit ?? old.dailyLossLimit),
    maxTradesPerDay: num(a.maxTradesPerDay ?? old.maxTradesPerDay),
    archived: Boolean(a.archived ?? old.archived),
    createdAt: old.createdAt || Date.now(),
  };
}

const sanitizeLegs = (legs) =>
  (Array.isArray(legs) ? legs : []).slice(0, 50)
    .map((l) => ({ time: num(l.time), price: num(l.price), qty: num(l.qty), note: str(l.note, 120) }))
    .filter((l) => l.price != null && l.qty != null && l.qty > 0);

function sanitizeTrade(t, doc, old = {}) {
  const accountIds = doc.accounts.map((a) => a.id);
  const pick = (k) => (t[k] !== undefined ? t[k] : old[k]);
  const out = {
    id: old.id || newId(),
    accountId: oneOf(pick('accountId'), accountIds, accountIds[0]),
    symbol: str(pick('symbol'), 40).toUpperCase(),
    market: oneOf(pick('market'), MARKETS, 'Equity'),
    direction: pick('direction') === 'Short' ? 'Short' : 'Long',
    optionType: oneOf(pick('optionType'), ['CE', 'PE', ''], ''),
    strike: num(pick('strike')),
    expiry: str(pick('expiry'), 10),
    multiplier: num(pick('multiplier')) || 1,
    entries: sanitizeLegs(pick('entries')),
    exits: sanitizeLegs(pick('exits')),
    plannedTime: num(pick('plannedTime')),
    stopLoss: num(pick('stopLoss')),
    target: num(pick('target')),
    fees: num(pick('fees')) || 0,
    pnlOverride: num(pick('pnlOverride')),
    riskOverride: num(pick('riskOverride')),
    setup: str(pick('setup'), 80),
    timeframe: str(pick('timeframe'), 10),
    htfBias: oneOf(pick('htfBias'), ['Bullish', 'Bearish', 'Neutral', ''], ''),
    tags: strList(pick('tags')),
    mistakes: strList(pick('mistakes')),
    emotionsBefore: strList(pick('emotionsBefore'), 10),
    emotionsAfter: strList(pick('emotionsAfter'), 10),
    confidence: Math.min(5, Math.max(0, Math.round(num(pick('confidence')) || 0))),
    grade: oneOf(pick('grade'), ['A+', 'A', 'B', 'C', 'D', 'F', ''], ''),
    followedPlan: pick('followedPlan') === undefined || pick('followedPlan') === null ? null : Boolean(pick('followedPlan')),
    thesis: str(pick('thesis'), 5000),
    management: str(pick('management'), 5000),
    review: str(pick('review'), 5000),
    lessons: str(pick('lessons'), 3000),
    chartLink: /^https?:\/\//.test(str(pick('chartLink'), 500)) ? str(pick('chartLink'), 500) : '',
    screenshots: old.screenshots || [],
    newsContext: Array.isArray(pick('newsContext')) ? pick('newsContext').slice(0, 15).map((n) => ({
      title: str(n.title, 300), impact: str(n.impact, 10), time: num(n.time), source: str(n.source, 80),
      link: /^https?:\/\//.test(str(n.link, 600)) ? str(n.link, 600) : '', kind: n.kind === 'event' ? 'event' : 'news',
    })) : [],
    createdAt: old.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  if (!out.symbol) throw new Error('Symbol is required');
  return out;
}

const withCalc = (doc) => (t) => {
  const c = JCalc.compute({ ...t, beThreshold: doc.settings.beThreshold });
  return { ...t, c, session: JCalc.session(c.openTime, t.market) };
};

function sanitizeNote(n) {
  return {
    bias: oneOf(n.bias, ['Bullish', 'Bearish', 'Neutral', 'Range', ''], ''),
    plan: str(n.plan, 5000),
    keyLevels: str(n.keyLevels, 2000),
    review: str(n.review, 5000),
    lessons: str(n.lessons, 3000),
    mood: Math.min(5, Math.max(0, Math.round(num(n.mood) || 0))),
    discipline: Math.min(5, Math.max(0, Math.round(num(n.discipline) || 0))),
    updatedAt: Date.now(),
  };
}

function sanitizeSettings(s, old) {
  return {
    setups: s.setups !== undefined ? strList(s.setups, 60) : old.setups,
    mistakes: s.mistakes !== undefined ? strList(s.mistakes, 60) : old.mistakes,
    emotions: s.emotions !== undefined ? strList(s.emotions, 40) : old.emotions,
    tags: s.tags !== undefined ? strList(s.tags, 80) : old.tags,
    timeframes: s.timeframes !== undefined ? strList(s.timeframes, 20) : old.timeframes,
    beThreshold: num(s.beThreshold) ?? old.beThreshold ?? 0,
  };
}

// ---------- CSV ----------
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  text = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// "2026-11-05 09:20" (IST, no zone) or ISO with zone, or dd-mm-yyyy hh:mm
function parseTime(v) {
  const s = str(v, 40);
  if (!s) return null;
  if (/^\d{10,13}$/.test(s)) return Number(s.length === 10 ? s + '000' : s);
  let m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return Date.parse(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${(m[4] || '0').padStart(2, '0')}:${m[5] || '00'}:${m[6] || '00'}+05:30`);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${(m[4] || '0').padStart(2, '0')}:${m[5] || '00'}:${m[6] || '00'}+05:30`);
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}

const istString = (ts) => (ts ? new Date(ts + 5.5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '');

const CSV_COLS = ['date', 'account', 'symbol', 'market', 'direction', 'entry_time', 'entry_price', 'qty', 'exit_time', 'exit_price',
  'multiplier', 'stop_loss', 'target', 'fees', 'net_pnl', 'r_multiple', 'status', 'setup', 'timeframe', 'session', 'tags', 'mistakes', 'grade', 'notes'];

const ALIASES = {
  symbol: ['symbol', 'instrument', 'scrip', 'ticker', 'pair', 'tradingsymbol'],
  market: ['market', 'segment', 'asset', 'type'],
  direction: ['direction', 'side', 'buy/sell', 'trade type', 'position'],
  entry_time: ['entry_time', 'entry time', 'open time', 'opened', 'entry date', 'date', 'buy time'],
  entry_price: ['entry_price', 'entry price', 'open price', 'buy price', 'avg entry', 'entry'],
  qty: ['qty', 'quantity', 'size', 'lots', 'volume', 'units'],
  exit_time: ['exit_time', 'exit time', 'close time', 'closed', 'exit date', 'sell time'],
  exit_price: ['exit_price', 'exit price', 'close price', 'sell price', 'avg exit', 'exit'],
  multiplier: ['multiplier', 'lot size', 'contract size'],
  stop_loss: ['stop_loss', 'stop loss', 'sl', 'stop'],
  target: ['target', 'take profit', 'tp'],
  fees: ['fees', 'charges', 'commission', 'brokerage'],
  net_pnl: ['net_pnl', 'net p&l', 'pnl', 'p&l', 'profit', 'net profit', 'realized p&l'],
  setup: ['setup', 'strategy'],
  timeframe: ['timeframe', 'tf'],
  tags: ['tags'],
  mistakes: ['mistakes'],
  grade: ['grade', 'rating'],
  notes: ['notes', 'comment', 'comments', 'review'],
};

function importCsv(doc, text, accountId) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('The file has no data rows');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {};
  for (const [k, names] of Object.entries(ALIASES)) {
    const i = head.findIndex((h) => names.includes(h));
    if (i >= 0) idx[k] = i;
  }
  if (idx.symbol === undefined || idx.entry_price === undefined) throw new Error('Need at least "symbol" and "entry_price" columns');
  const get = (r, k) => (idx[k] === undefined ? '' : r[idx[k]]);
  let added = 0; const errors = [];
  rows.slice(1).forEach((r, n) => {
    try {
      if (num(get(r, 'entry_price')) == null) throw new Error('missing entry price');
      const dirRaw = str(get(r, 'direction')).toLowerCase();
      const qty = Math.abs(num(get(r, 'qty')) || 1);
      const marketRaw = str(get(r, 'market'));
      const market = MARKETS.find((m) => m.toLowerCase() === marketRaw.toLowerCase()) || (/[A-Z]{3}\/?[A-Z]{3}/.test(str(get(r, 'symbol')).toUpperCase()) && str(get(r, 'symbol')).length <= 7 ? 'Forex' : 'Equity');
      const t = {
        accountId,
        symbol: get(r, 'symbol'),
        market,
        direction: /^(s|short|sell)/.test(dirRaw) ? 'Short' : 'Long',
        multiplier: num(get(r, 'multiplier')) || 1,
        entries: [{ time: parseTime(get(r, 'entry_time')), price: num(get(r, 'entry_price')), qty }],
        exits: num(get(r, 'exit_price')) != null ? [{ time: parseTime(get(r, 'exit_time')) || parseTime(get(r, 'entry_time')), price: num(get(r, 'exit_price')), qty }] : [],
        stopLoss: num(get(r, 'stop_loss')),
        target: num(get(r, 'target')),
        fees: Math.abs(num(get(r, 'fees')) || 0),
        pnlOverride: idx.net_pnl !== undefined && num(get(r, 'net_pnl')) != null ? num(get(r, 'net_pnl')) : null,
        setup: get(r, 'setup'), timeframe: get(r, 'timeframe'),
        tags: get(r, 'tags'), mistakes: get(r, 'mistakes'),
        grade: str(get(r, 'grade')).toUpperCase(),
        review: get(r, 'notes'),
      };
      doc.trades.push(sanitizeTrade(t, doc));
      added++;
    } catch (e) {
      if (errors.length < 10) errors.push(`Row ${n + 2}: ${e.message}`);
    }
  });
  return { added, errors };
}

function exportCsv(doc, accountId) {
  const accName = Object.fromEntries(doc.accounts.map((a) => [a.id, a.name]));
  const lines = [CSV_COLS.join(',')];
  for (const t of doc.trades.filter((x) => !accountId || x.accountId === accountId).map(withCalc(doc))) {
    const c = t.c;
    lines.push([
      istString(c.openTime).slice(0, 10), accName[t.accountId], t.symbol, t.market, t.direction, istString(c.openTime), c.avgEntry, c.qty,
      istString(c.closeTime), c.avgExit, t.multiplier, t.stopLoss, t.target, t.fees, c.net, c.r, c.status, t.setup, t.timeframe, t.session,
      t.tags.join('; '), t.mistakes.join('; '), t.grade, [t.thesis, t.review, t.lessons].filter(Boolean).join(' | '),
    ].map(csvCell).join(','));
  }
  return lines.join('\r\n');
}

// ---------- routes ----------
function router({ requireUser, store, calendar }) {
  const r = express.Router();
  const small = express.json({ limit: '1mb' });
  const big = express.json({ limit: '20mb' }); // screenshots, CSV import, backup restore
  r.use(requireUser);
  r.use((req, res, next) => (/\/(screenshots|import|restore)$/.test(req.path) ? big : small)(req, res, next));
  const doc = (req) => load(req.user.id);
  const send = (req, res) => {
    const d = doc(req);
    res.json({ accounts: d.accounts, trades: d.trades.map(withCalc(d)), notes: d.notes, settings: d.settings, markets: MARKETS });
  };
  const findTrade = (d, id) => {
    const t = d.trades.find((x) => x.id === id);
    if (!t) { const e = new Error('Trade not found'); e.status = 404; throw e; }
    return t;
  };

  // News and calendar events around a time window, for a trade's context
  function newsAround(from, to) {
    const items = store.all()
      .filter((n) => n.publishedAt >= from && n.publishedAt <= to && n.impact !== 'Low')
      .sort((a, b) => b.score - a.score).slice(0, 8)
      .map((n) => ({ kind: 'news', title: n.title, impact: n.impact, time: n.publishedAt, source: n.source, link: n.link }));
    const events = calendar.getEvents()
      .filter((e) => e.time >= from && e.time <= to && (e.impact === 'High' || e.impact === 'Medium'))
      .slice(0, 6)
      .map((e) => ({ kind: 'event', title: `${e.country} – ${e.title}`, impact: e.impact, time: e.time, source: 'Economic calendar', link: '' }));
    return [...events, ...items].sort((a, b) => a.time - b.time);
  }

  r.get('/', send);

  r.get('/news-around', (req, res) => {
    const t = Number(req.query.time) || Date.now();
    res.json(newsAround(t - 90 * 60e3, t + 30 * 60e3));
  });

  // trades
  r.post('/trades', (req, res) => {
    const d = doc(req);
    const t = sanitizeTrade(req.body, d);
    const open = JCalc.compute(t).openTime;
    if (!t.newsContext.length && open) t.newsContext = newsAround(open - 90 * 60e3, open + 30 * 60e3);
    d.trades.push(t);
    save(req.user.id);
    send(req, res);
  });

  r.put('/trades/:id', (req, res) => {
    const d = doc(req);
    const old = findTrade(d, req.params.id);
    const t = sanitizeTrade(req.body, d, old);
    d.trades[d.trades.indexOf(old)] = t;
    save(req.user.id);
    send(req, res);
  });

  r.post('/trades/:id/refresh-news', (req, res) => {
    const d = doc(req);
    const t = findTrade(d, req.params.id);
    const open = JCalc.compute(t).openTime || Date.now();
    t.newsContext = newsAround(open - 90 * 60e3, open + 30 * 60e3);
    save(req.user.id);
    send(req, res);
  });

  r.delete('/trades/:id', (req, res) => {
    const d = doc(req);
    const t = findTrade(d, req.params.id);
    for (const s of t.screenshots) try { fs.unlinkSync(path.join(FILES, req.user.id, s.file)); } catch {}
    d.trades = d.trades.filter((x) => x !== t);
    save(req.user.id);
    send(req, res);
  });

  // screenshots: JSON {name, dataUrl} (png / jpeg / webp / gif, max 6 MB)
  r.post('/trades/:id/screenshots', (req, res) => {
    const d = doc(req);
    const t = findTrade(d, req.params.id);
    if (t.screenshots.length >= 12) return res.status(400).json({ error: 'Max 12 screenshots per trade' });
    const m = String(req.body.dataUrl || '').match(/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return res.status(400).json({ error: 'Upload a PNG, JPG, WEBP or GIF image' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 6 * 1024 * 1024) return res.status(400).json({ error: 'Image is larger than 6 MB' });
    const id = newId();
    const fileName = `${id}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    fs.mkdirSync(path.join(FILES, req.user.id), { recursive: true });
    fs.writeFileSync(path.join(FILES, req.user.id, fileName), buf);
    t.screenshots.push({ id, file: fileName, name: str(req.body.name, 80) || 'Chart', caption: str(req.body.caption, 200), at: Date.now() });
    save(req.user.id);
    send(req, res);
  });

  r.patch('/trades/:id/screenshots/:sid', (req, res) => {
    const d = doc(req);
    const s = findTrade(d, req.params.id).screenshots.find((x) => x.id === req.params.sid);
    if (!s) return res.status(404).json({ error: 'Not found' });
    s.caption = str(req.body.caption, 200);
    save(req.user.id);
    send(req, res);
  });

  r.delete('/trades/:id/screenshots/:sid', (req, res) => {
    const d = doc(req);
    const t = findTrade(d, req.params.id);
    const s = t.screenshots.find((x) => x.id === req.params.sid);
    if (s) try { fs.unlinkSync(path.join(FILES, req.user.id, s.file)); } catch {}
    t.screenshots = t.screenshots.filter((x) => x !== s);
    save(req.user.id);
    send(req, res);
  });

  r.get('/files/:file', (req, res) => {
    if (!/^[a-f0-9]{16}\.(png|jpg|webp|gif)$/.test(req.params.file)) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=86400');
    res.sendFile(path.join(FILES, req.user.id, req.params.file), (err) => err && res.status(404).end());
  });

  // daily notes (date = YYYY-MM-DD)
  r.put('/notes/:date', (req, res) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) return res.status(400).json({ error: 'Bad date' });
    const d = doc(req);
    const n = sanitizeNote(req.body);
    if (!n.plan && !n.review && !n.lessons && !n.keyLevels && !n.bias && !n.mood && !n.discipline) delete d.notes[req.params.date];
    else d.notes[req.params.date] = n;
    save(req.user.id);
    send(req, res);
  });

  // accounts
  r.post('/accounts', (req, res) => {
    const d = doc(req);
    if (d.accounts.length >= 30) return res.status(400).json({ error: 'Too many accounts' });
    d.accounts.push(sanitizeAccount(req.body));
    save(req.user.id);
    send(req, res);
  });

  r.put('/accounts/:id', (req, res) => {
    const d = doc(req);
    const i = d.accounts.findIndex((a) => a.id === req.params.id);
    if (i < 0) return res.status(404).json({ error: 'Account not found' });
    d.accounts[i] = sanitizeAccount(req.body, d.accounts[i]);
    save(req.user.id);
    send(req, res);
  });

  r.delete('/accounts/:id', (req, res) => {
    const d = doc(req);
    if (d.trades.some((t) => t.accountId === req.params.id)) return res.status(400).json({ error: 'This account has trades. Archive it instead, or delete its trades first.' });
    if (d.accounts.length <= 1) return res.status(400).json({ error: 'Keep at least one account' });
    d.accounts = d.accounts.filter((a) => a.id !== req.params.id);
    save(req.user.id);
    send(req, res);
  });

  r.put('/settings', (req, res) => {
    const d = doc(req);
    d.settings = sanitizeSettings(req.body || {}, d.settings);
    save(req.user.id);
    send(req, res);
  });

  // import / export
  r.get('/export.csv', (req, res) => {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="tradedesk-trades-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('﻿' + exportCsv(doc(req), req.query.accountId));
  });

  r.get('/backup.json', (req, res) => {
    const d = doc(req);
    res.set('Content-Disposition', `attachment; filename="tradedesk-journal-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ app: 'TradeDesk', version: 1, exportedAt: Date.now(), accounts: d.accounts, trades: d.trades, notes: d.notes, settings: d.settings });
  });

  r.post('/import', (req, res) => {
    const d = doc(req);
    const accountId = d.accounts.some((a) => a.id === req.body.accountId) ? req.body.accountId : d.accounts[0].id;
    const result = importCsv(d, req.body.csv, accountId);
    save(req.user.id);
    res.json(result);
  });

  r.post('/restore', (req, res) => {
    const b = req.body || {};
    if (b.app !== 'TradeDesk' || !Array.isArray(b.trades)) return res.status(400).json({ error: 'Not a TradeDesk backup file' });
    const fresh = { accounts: [], trades: [], notes: {}, settings: DEFAULT_SETTINGS() };
    fresh.accounts = (b.accounts || []).slice(0, 30).map((a) => ({ ...sanitizeAccount(a), id: /^[a-f0-9]{16}$/.test(a.id) ? a.id : newId() }));
    if (!fresh.accounts.length) fresh.accounts.push(sanitizeAccount({ name: 'Main account' }));
    fresh.settings = sanitizeSettings(b.settings || {}, fresh.settings);
    for (const t of b.trades.slice(0, 20000)) {
      try {
        const s = sanitizeTrade(t, fresh, { id: /^[a-f0-9]{16}$/.test(t.id) ? t.id : undefined, createdAt: t.createdAt });
        s.screenshots = []; // image files are not part of the backup
        fresh.trades.push(s);
      } catch {}
    }
    for (const [date, n] of Object.entries(b.notes || {})) if (/^\d{4}-\d{2}-\d{2}$/.test(date)) fresh.notes[date] = sanitizeNote(n);
    // keep screenshots for trades that still exist
    const oldShots = Object.fromEntries(doc(req).trades.map((t) => [t.id, t.screenshots]));
    for (const t of fresh.trades) t.screenshots = oldShots[t.id] || [];
    cache.set(req.user.id, fresh);
    save(req.user.id);
    res.json({ ok: true, trades: fresh.trades.length });
  });

  // eslint-disable-next-line no-unused-vars
  r.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'File is too large' });
    res.status(err.status || 400).json({ error: err.message || 'Something went wrong' });
  });
  return r;
}

module.exports = { router, removeUser, flushAll, parseCsv, importCsv, exportCsv, parseTime };
