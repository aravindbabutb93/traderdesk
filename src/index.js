require('dotenv').config();
const path = require('path');
const express = require('express');

const sources = require('../config/sources');
const { fetchSource, recordLag, health } = require('./fetcher');
const classifier = require('./classifier');
const Store = require('./store');
const calendar = require('./calendar');
const telegram = require('./telegram');
const users = require('./users');
const journal = require('./journal');
const digest = require('./digest');
const { istTime } = require('./utils');

const crypto = require('crypto');

const PORT = Number(process.env.PORT || 4100);
// Behind nginx on a server, set HOST=127.0.0.1 so the app is only reachable through nginx
const HOST = process.env.HOST || '0.0.0.0';
const IS_PROD = process.env.NODE_ENV === 'production';
// Each source runs on its own timer, so a slow feed never delays a fast one.
// Direct publisher feeds poll fast; Google News / Investing.com poll slower (they rate-limit).
const POLL_FAST = Math.max(10, Number(process.env.POLL_FAST_SECONDS || 20));
const POLL_SLOW = Math.max(30, Number(process.env.POLL_SLOW_SECONDS || 60));
const MAX_AGE_HOURS = Number(process.env.MAX_AGE_HOURS || 48);
const REMIND_MIN = Number(process.env.CALENDAR_REMIND_MINUTES || 15);
const { IMPACT_RANK } = classifier;

// ---------- state ----------
const store = new Store({ retentionDays: Number(process.env.RETENTION_DAYS || 7), maxItems: Number(process.env.MAX_ITEMS || 3000) });
users.load();
store.load();
reclassifyAll(); // rules may have changed since last run

let lastPoll = null;
const seeded = new Set(); // sources whose backlog is already loaded (no alerts for backlog)
const timers = {};
const failures = {};
const remindedEvents = new Set();

function reclassifyAll() {
  for (const it of store.all()) {
    delete it.watch; // watchlists are per user now
    Object.assign(it, classifier.classify(it));
  }
}

// ---------- live updates (Server-Sent Events, filtered per user) ----------
const clients = new Map(); // res -> userId
const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

function broadcast(event, data) {
  for (const [res] of clients) send(res, event, data);
}

function broadcastNews(items) {
  for (const [res, userId] of clients) {
    const u = users.get(userId);
    if (!u || !u.active) continue;
    const mine = items.map((it) => users.personalize(it, u)).filter((it) => users.wants(it, u));
    if (mine.length) send(res, 'news', mine);
  }
}

function reloadUser(userId) {
  for (const [res, id] of clients) if (id === userId) send(res, 'reload', {});
}

// ---------- alerts (each user gets Telegram alerts for their own categories) ----------
function shouldAlert(it, p) {
  if (Date.now() - it.publishedAt > 90 * 60 * 1000) return false; // stale
  if (p.alertMinImpact !== 'Off' && IMPACT_RANK[it.impact] >= IMPACT_RANK[p.alertMinImpact]) return true;
  return p.alertWatchMedium && it.watch.length > 0 && it.impact !== 'Low';
}

function alertNews(items) {
  if (!telegram.enabled()) return;
  for (const u of users.list()) {
    if (!u.active || !u.prefs.telegramChatId) continue;
    items
      .map((it) => users.personalize(it, u))
      .filter((it) => users.wants(it, u) && shouldAlert(it, u.prefs))
      .slice(0, 10)
      .forEach((it) => telegram.send(telegram.formatNews(it, classifier.categoryLabels), u.prefs.telegramChatId));
  }
}

// ---------- polling ----------
const enabledSources = () => sources.filter((s) => s.enabled !== false);
const intervalFor = (src) => (src.every || (src.slow || src.google ? POLL_SLOW : POLL_FAST)) * 1000;

// Score, store and push new items immediately
function ingest(raw, src) {
  const cutoff = Date.now() - MAX_AGE_HOURS * 3600 * 1000;
  const now = Date.now();
  const fresh = [];
  for (const it of raw) {
    if (it.publishedAt < cutoff || store.has(it)) continue;
    Object.assign(it, classifier.classify(it), { firstSeen: now });
    if (store.add(it)) fresh.push(it);
  }
  lastPoll = now;
  if (!fresh.length) return fresh;
  fresh.sort((a, b) => b.publishedAt - a.publishedAt);
  broadcastNews(fresh);
  if (src && seeded.has(src.id)) {
    for (const it of fresh) recordLag(src.id, now - it.publishedAt);
    alertNews(fresh);
  }
  return fresh;
}

async function pollSource(src) {
  clearTimeout(timers[src.id]);
  let next = intervalFor(src);
  try {
    const { items, changed } = await fetchSource(src);
    failures[src.id] = 0;
    if (changed) {
      const fresh = ingest(items, src);
      if (fresh.length && seeded.has(src.id)) {
        console.log(`[${istTime()}] ${src.id}: ${fresh.length} new (${health[src.id].ms}ms)`);
      }
    }
    seeded.add(src.id);
  } catch (e) {
    // Back off on errors (2x, 4x ... up to 10 min), harder on 403/429 rate limits
    const f = (failures[src.id] = (failures[src.id] || 0) + 1);
    const mult = Math.min(2 ** f, e.status === 429 || e.status === 403 ? 16 : 8);
    next = Math.min(next * mult, 10 * 60 * 1000);
    if (f === 1 || f % 10 === 0) console.warn(`[${istTime()}] ${src.id} failing (${e.message}), retry in ${Math.round(next / 1000)}s`);
  }
  // small jitter so sources don't all fire together
  timers[src.id] = setTimeout(() => pollSource(src), next + Math.random() * 2000);
}

let refreshing = false;
async function refreshAll() {
  if (refreshing) return;
  refreshing = true;
  try {
    await Promise.all(enabledSources().map(pollSource));
    store.prune();
  } finally {
    refreshing = false;
  }
}

async function startPolling() {
  const list = enabledSources();
  console.log(`Polling ${list.length} sources: fast every ${POLL_FAST}s, Google/slow every ${POLL_SLOW}s`);
  await refreshAll(); // first pass loads the backlog quietly, then each source keeps its own timer
  const failing = Object.values(health).filter((h) => !h.ok).length;
  console.log(`[${istTime()}] backlog loaded: ${store.items.size} stories, ${failing} source(s) failing`);
  setInterval(() => store.prune(), 5 * 60 * 1000);
}

async function refreshCalendar() {
  const events = await calendar.refresh();
  broadcast('calendar', events);
}

function checkReminders() {
  if (!telegram.enabled()) return;
  const now = Date.now();
  for (const ev of calendar.getEvents()) {
    if (ev.impact !== 'High' || remindedEvents.has(ev.id)) continue;
    const mins = Math.round((ev.time - now) / 60000);
    if (mins >= 0 && mins <= REMIND_MIN) {
      remindedEvents.add(ev.id);
      for (const u of users.list()) {
        const p = u.prefs;
        if (u.active && p.telegramChatId && p.calendarAlerts && (!p.ccys.length || p.ccys.includes(ev.country))) {
          telegram.send(telegram.formatEvent(ev, mins), p.telegramChatId);
        }
      }
    }
  }
}

// ---------- HTTP ----------
const app = express();
app.disable('x-powered-by');
// Trust X-Forwarded-* only from a proxy on this machine (nginx), so req.ip / req.secure are real
app.set('trust proxy', 'loopback');
const PUBLIC = path.join(__dirname, '..', 'public');

// ---------- security ----------
// Headers: strict CSP (scripts only from this site), no framing, no MIME sniffing, HSTS on HTTPS
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
      "connect-src 'self'", "font-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});

// CSRF guard: state-changing API calls must come from this site's own pages
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin') || req.get('referer');
  if (!origin) return next(); // non-browser clients (curl, scripts) send neither; they still need a session cookie
  let host;
  try { host = new URL(origin).host; } catch { host = ''; }
  if (host !== req.get('host')) return res.status(403).json({ error: 'Blocked cross-site request' });
  next();
});

// Simple per-IP rate limit for the API (nginx adds its own in front)
const API_LIMIT = Number(process.env.API_RATE_PER_MIN || 600);
const hits = new Map();
app.use('/api', (req, res, next) => {
  const now = Date.now();
  let h = hits.get(req.ip);
  if (!h || now > h.reset) h = { n: 0, reset: now + 60e3 };
  h.n++;
  hits.set(req.ip, h);
  if (h.n > API_LIMIT) {
    res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
    return res.status(429).json({ error: 'Too many requests, slow down' });
  }
  next();
});
setInterval(() => { const now = Date.now(); for (const [ip, h] of hits) if (now > h.reset) hits.delete(ip); }, 60e3).unref();

const audit = (event, req, extra = '') => console.log(`[audit] ${new Date().toISOString()} ${event} ip=${req.ip} ${extra}`.trim());

const wrap = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r && r.catch) r.catch(next);
  } catch (e) {
    next(e);
  }
};

function requireUser(req, res, next) {
  const u = users.userFromReq(req);
  if (!u) return res.status(401).json({ error: 'Please sign in' });
  req.user = u;
  next();
}

let journalRouter; // created below once calendar/store exist

function requireAdmin(req, res, next) {
  requireUser(req, res, () => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only' })));
}

// Trade journal API (has its own body parser so screenshots/imports can be larger)
app.use('/api/journal', (req, res, next) => journalRouter(req, res, next));
app.use(express.json({ limit: '200kb' }));

// Pages: send people to the login page until they are signed in
app.get(['/', '/index.html'], (req, res) => (users.userFromReq(req) ? res.sendFile(path.join(PUBLIC, 'index.html')) : res.redirect('/login.html')));
app.get(['/journal', '/journal.html'], (req, res) => (users.userFromReq(req) ? res.sendFile(path.join(PUBLIC, 'journal.html')) : res.redirect('/login.html')));
app.get(['/settings', '/settings.html'], (req, res) => (users.userFromReq(req) ? res.sendFile(path.join(PUBLIC, 'settings.html')) : res.redirect('/login.html')));
app.get(['/admin', '/admin.html'], (req, res) => {
  const u = users.userFromReq(req);
  if (!u) return res.redirect('/login.html');
  if (u.role !== 'admin') return res.redirect('/');
  res.sendFile(path.join(PUBLIC, 'admin.html'));
});
app.use(express.static(PUBLIC, { index: false }));

journalRouter = journal.router({ requireUser, store, calendar });

// ---------- auth ----------
// Lock out after repeated failures, per IP (10 in 15 min) and per username (20 in 15 min, so others can't easily lock you out)
const loginFails = new Map(); // key -> {n, until}
function tooManyFails(key, max) {
  const f = loginFails.get(key);
  return f && f.n >= max && Date.now() < f.until;
}
function noteFail(key) {
  const f = loginFails.get(key) || { n: 0, until: 0 };
  if (Date.now() > f.until) f.n = 0;
  f.n++;
  f.until = Date.now() + 15 * 60 * 1000;
  loginFails.set(key, f);
}
setInterval(() => { const now = Date.now(); for (const [k, f] of loginFails) if (now > f.until) loginFails.delete(k); }, 5 * 60e3).unref();

// First-run setup needs a one-time code printed in the server log, so a stranger who
// finds a fresh server can't create the admin account before you do.
let setupCode = null;
function ensureSetupCode() {
  if (users.count() > 0) { setupCode = null; return; }
  if (!setupCode) setupCode = process.env.SETUP_CODE || crypto.randomBytes(4).toString('hex');
  console.log(`\n  First run: create the admin account with setup code  ${setupCode}\n`);
}

app.get('/api/auth/state', (req, res) => {
  const u = users.userFromReq(req);
  res.json({ setupNeeded: users.count() === 0, user: u ? { id: u.id, name: u.name, role: u.role } : null });
});

// First run only: create the admin account
app.post('/api/auth/setup', wrap((req, res) => {
  if (users.count() > 0) return res.status(400).json({ error: 'Setup is already done' });
  if (tooManyFails('setup:' + req.ip, 10)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const code = String(req.body.setupCode || '').trim();
  if (!setupCode || code.length !== setupCode.length || !crypto.timingSafeEqual(Buffer.from(code), Buffer.from(setupCode))) {
    noteFail('setup:' + req.ip);
    audit('setup-failed', req);
    return res.status(403).json({ error: 'Wrong setup code. It is printed in the server log when the app starts.' });
  }
  const u = users.create({
    username: req.body.username,
    name: req.body.name,
    password: req.body.password,
    role: 'admin',
    prefs: {
      watchlist: classifier.readLegacyWatchlist(), // carry over the old shared watchlist
      telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
      alertMinImpact: process.env.ALERT_MIN_IMPACT || 'High',
    },
  });
  setupCode = null;
  audit('setup-admin-created', req, `user=${u.username}`);
  users.recordLogin(u);
  users.setSessionCookie(req, res, u);
  res.json({ user: users.publicUser(u) });
}));

app.post('/api/auth/login', wrap((req, res) => {
  const ip = req.ip;
  const name = String(req.body.username || '').trim().toLowerCase().slice(0, 40);
  if (tooManyFails('ip:' + ip, 10) || tooManyFails('user:' + name, 20)) {
    audit('login-locked', req, `user=${name}`);
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }
  const u = users.byUsername(name);
  const passOk = users.checkPassword(req.body.password, u && u.pass); // always hash, even for unknown users
  if (!u || !passOk) {
    noteFail('ip:' + ip);
    noteFail('user:' + name);
    audit('login-failed', req, `user=${name}`);
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  if (!u.active) return res.status(403).json({ error: 'This account is disabled. Ask the admin.' });
  loginFails.delete('ip:' + ip);
  loginFails.delete('user:' + name);
  audit('login-ok', req, `user=${u.username}`);
  users.recordLogin(u);
  users.setSessionCookie(req, res, u);
  res.json({ user: users.publicUser(u) });
}));

app.post('/api/auth/logout', (req, res) => {
  users.clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------- current user ----------
app.get('/api/me', requireUser, (req, res) => {
  res.json({
    user: users.publicUser(req.user),
    options: {
      categories: classifier.categoryList,
      regions: users.REGIONS,
      impacts: users.IMPACTS,
      ccys: users.CCYS,
    },
    telegramBot: telegram.enabled(),
  });
});

app.put('/api/me/prefs', requireUser, wrap((req, res) => {
  const u = users.update(req.user.id, { prefs: req.body.prefs || {} });
  reloadUser(u.id);
  res.json({ user: users.publicUser(u) });
}));

app.post('/api/me/password', requireUser, wrap((req, res) => {
  if (!users.checkPassword(req.body.current, req.user.pass)) { audit('password-change-failed', req, `user=${req.user.username}`); return res.status(400).json({ error: 'Current password is wrong' }); }
  audit('password-changed', req, `user=${req.user.username}`);
  const u = users.update(req.user.id, { password: req.body.password });
  users.setSessionCookie(req, res, u); // keep this browser signed in
  res.json({ ok: true });
}));

// ---------- news ----------
function feedFor(u, limit) {
  const out = [];
  for (const it of store.list(store.maxItems)) {
    const p = users.personalize(it, u);
    if (users.wants(p, u)) out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

app.get('/api/news', requireUser, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 500, 3000);
  res.json(feedFor(req.user, limit));
});

// ---------- market digest (yesterday → now, clubbed by story) ----------
const digestCache = new Map(); // key -> { at, d }; long windows take ~1s to build, so reuse for 60s
function digestFor(req) {
  const window = digest.WINDOWS[req.query.window] ? req.query.window : 'auto';
  const regions = String(req.query.regions || '').split(',').filter((r) => ['IN', 'US', 'GLOBAL', 'FX'].includes(r));
  const key = `${req.user.id}:${window}:${regions.join(',')}`;
  const hit = digestCache.get(key);
  if (hit && Date.now() - hit.at < 60e3 && hit.v === req.user.updatedAt) return { d: hit.d, key };
  const { from, to } = digest.windowRange(window);
  const all = store.list(store.maxItems); // newest first
  const mine = [];
  for (const it of all) {
    if (it.publishedAt < from) break;
    if (it.publishedAt > to + 60e3) continue;
    const p = users.personalize(it, req.user);
    if (users.wants(p, req.user)) mine.push(p);
  }
  const storeOldest = all.length ? all[all.length - 1].publishedAt : null;
  const d = digest.build(mine, { window, regions, storeOldest });
  digestCache.set(key, { at: Date.now(), d, v: req.user.updatedAt });
  if (digestCache.size > 300) digestCache.delete(digestCache.keys().next().value);
  return { d, key };
}

app.get('/api/digest', requireUser, (req, res) => {
  const { d } = digestFor(req);
  res.json({ ...d, ai: digest.aiEnabled() });
});

const aiHits = new Map(); // userId -> [timestamps], max 10 AI briefs per user per hour
app.post('/api/digest/ai', requireUser, wrap(async (req, res) => {
  if (!digest.aiEnabled()) return res.status(400).json({ error: 'AI brief is off. The admin needs to set ANTHROPIC_API_KEY in .env' });
  const recent = (aiHits.get(req.user.id) || []).filter((t) => Date.now() - t < 3600e3);
  if (recent.length >= 10) return res.status(429).json({ error: 'AI brief limit reached (10 per hour). Try again later.' });
  const { d, key } = digestFor(req);
  if (!d.pointsTotal) return res.json({ text: '' });
  const bucket = Math.floor(Date.now() / (10 * 60e3)); // reuse the same brief for 10 minutes
  const text = await digest.aiBrief(d, `${key}:${bucket}`);
  recent.push(Date.now());
  aiHits.set(req.user.id, recent);
  res.json({ text, model: process.env.SUMMARY_MODEL || 'claude-haiku-5-5' });
}));

app.get('/api/calendar', requireUser, (req, res) => res.json(calendar.getEvents()));

app.get('/api/status', requireUser, (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const list = sources.map((s) => health[s.id] || { id: s.id, name: s.name, region: s.region, enabled: s.enabled !== false });
  res.json({
    lastPoll,
    pollSeconds: POLL_FAST,
    pollSlowSeconds: POLL_SLOW,
    items: store.items.size,
    telegram: telegram.enabled() && Boolean(req.user.prefs.telegramChatId),
    telegramBot: telegram.enabled(),
    calendar: calendar.status,
    categories: classifier.categoryLabels,
    sourcesOk: list.filter((x) => x.ok).length,
    sourcesTotal: list.length,
    sources: isAdmin ? list : undefined,
  });
});

// Watchlist (per user)
app.get('/api/watchlist', requireUser, (req, res) => res.json(req.user.prefs.watchlist));

app.post('/api/watchlist', requireUser, wrap((req, res) => {
  const symbol = String(req.body.symbol || '').trim().toUpperCase();
  if (!/^[A-Z0-9&_.\-/]{1,30}$/.test(symbol)) return res.status(400).json({ error: 'Invalid symbol' });
  const list = req.user.prefs.watchlist.filter((w) => w.symbol !== symbol);
  list.push({ symbol, aliases: req.body.aliases });
  const u = users.update(req.user.id, { prefs: { watchlist: list } });
  reloadUser(u.id);
  res.json(u.prefs.watchlist);
}));

app.delete('/api/watchlist/:symbol', requireUser, wrap((req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const u = users.update(req.user.id, { prefs: { watchlist: req.user.prefs.watchlist.filter((w) => w.symbol !== symbol) } });
  reloadUser(u.id);
  res.json(u.prefs.watchlist);
}));

app.post('/api/telegram/test', requireUser, (req, res) => {
  if (!telegram.enabled()) return res.json({ ok: false, message: 'The admin has not set TELEGRAM_BOT_TOKEN in .env yet' });
  if (!req.user.prefs.telegramChatId) return res.json({ ok: false, message: 'Add your Telegram chat ID in Settings first' });
  const ok = telegram.send(`✅ TradeDesk is connected for ${req.user.name}. You will get alerts here.`, req.user.prefs.telegramChatId);
  res.json({ ok, message: ok ? 'Test message sent' : 'Could not queue the message' });
});

app.post('/api/refresh', requireAdmin, wrap(async (req, res) => {
  await refreshAll();
  res.json({ ok: true, lastPoll });
}));

app.get('/api/stream', requireUser, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  clients.set(res, req.user.id);
  req.on('close', () => clients.delete(res));
});

setInterval(() => {
  for (const [res, id] of clients) {
    const u = users.get(id);
    if (!u || !u.active) { res.end(); clients.delete(res); continue; } // signed out by admin
    res.write(': ping\n\n');
  }
}, 25000);

// ---------- admin ----------
app.get('/api/admin/users', requireAdmin, (req, res) => res.json(users.list().map(users.publicUser)));

app.post('/api/admin/users', requireAdmin, wrap((req, res) => {
  const { username, name, password, role, prefs } = req.body;
  const u = users.create({ username, name, password, role, prefs });
  audit('admin-user-created', req, `by=${req.user.username} user=${u.username} role=${u.role}`);
  res.json(users.publicUser(u));
}));

app.patch('/api/admin/users/:id', requireAdmin, wrap((req, res) => {
  const { name, role, active, password, prefs } = req.body;
  const u = users.update(req.params.id, { name, role, active, password, prefs });
  audit('admin-user-updated', req, `by=${req.user.username} user=${u.username}${role !== undefined ? ' role=' + u.role : ''}${active !== undefined ? ' active=' + u.active : ''}${password ? ' password-reset' : ''}`);
  if (u.active) reloadUser(u.id);
  res.json(users.publicUser(u));
}));

app.delete('/api/admin/users/:id', requireAdmin, wrap((req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "You can't delete your own account" });
  const gone = users.get(req.params.id);
  users.remove(req.params.id);
  journal.removeUser(req.params.id);
  audit('admin-user-deleted', req, `by=${req.user.username} user=${gone && gone.username}`);
  res.json({ ok: true });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
  res.status(400).json({ error: err.message || 'Something went wrong' });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`TradeDesk running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}${IS_PROD ? ' (production)' : ''}`);
  ensureSetupCode();
  console.log(`Telegram bot: ${telegram.enabled() ? 'ON (each user adds their chat ID in Settings)' : 'off (set TELEGRAM_BOT_TOKEN in .env)'}`);
  startPolling();
  refreshCalendar();
  setInterval(refreshCalendar, 60 * 60 * 1000);
  setInterval(checkReminders, 60 * 1000);
});

// Slow-client protection
server.headersTimeout = 20000;
server.requestTimeout = 60000;
server.keepAliveTimeout = 65000;
