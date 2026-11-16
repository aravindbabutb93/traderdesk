// Users, passwords, sessions and per-user news settings.
// Stored in data/users.json. Passwords are hashed with scrypt; sessions are
// HMAC-signed cookies, so they survive a restart and need no database.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const classifier = require('./classifier');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, '.session-secret');
const COOKIE = 'mn_session';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);

const REGIONS = ['IN', 'US', 'GLOBAL', 'FX'];
const IMPACTS = ['High', 'Medium', 'Low'];
const CCYS = ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'AUD', 'CAD'];

const DEFAULT_PREFS = () => ({
  categories: [],            // empty = all categories
  regions: [...REGIONS],
  minImpact: 'Low',          // hide stories below this impact
  watchlist: [],             // [{symbol, aliases}]
  watchOnly: false,
  ccys: ['INR', 'USD', 'EUR', 'CNY'],
  telegramChatId: '',
  alertMinImpact: 'High',    // Telegram: alert at or above this impact (within your categories)
  alertWatchMedium: true,    // Telegram: also Medium stories that hit your watchlist
  calendarAlerts: true,      // Telegram: reminder before High-impact calendar events
});

let users = [];
const compiledWatch = new Map(); // userId -> compiled watchlist
let secret;

// ---------- persistence ----------
function loadSecret() {
  if (process.env.SESSION_SECRET) return (secret = process.env.SESSION_SECRET);
  try {
    secret = fs.readFileSync(SECRET_FILE, 'utf8').trim();
  } catch {
    secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  }
  return secret;
}

function load() {
  loadSecret();
  try {
    users = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    users = [];
  }
  for (const u of users) {
    u.prefs = sanitizePrefs({ ...DEFAULT_PREFS(), ...(u.prefs || {}) });
    compiledWatch.set(u.id, classifier.compileWatchlist(u.prefs.watchlist));
  }
  console.log(`[users] ${users.length} user(s)`);
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

// ---------- passwords ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

const DUMMY = hashPassword('dummy-password-for-timing');
function checkPassword(password, stored) {
  if (!stored) stored = DUMMY; // same work for unknown usernames, so timing doesn't reveal them
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(password), salt, 64);
  const real = Buffer.from(hash, 'hex');
  return real.length === test.length && crypto.timingSafeEqual(real, test);
}

const COMMON = new Set(['password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123', 'iloveyou', 'admin123', 'welcome1', 'trading123', 'nifty123', 'sensex123']);
function validatePassword(p, username = '') {
  if (typeof p !== 'string' || p.length < 10) return 'Password must be at least 10 characters';
  if (p.length > 200) return 'Password is too long';
  if (COMMON.has(p.toLowerCase())) return 'That password is too common';
  if (username && p.toLowerCase().includes(String(username).toLowerCase())) return 'Password must not contain the username';
  if (/^(.)\1+$/.test(p)) return 'Password is too simple';
  return null;
}

// ---------- prefs ----------
const pick = (list, allowed) => [...new Set((Array.isArray(list) ? list : []).filter((x) => allowed.includes(x)))];

function sanitizeWatchlist(list) {
  return (Array.isArray(list) ? list : [])
    .map((w) => ({
      symbol: String(w.symbol || '').trim().toUpperCase(),
      aliases: (Array.isArray(w.aliases) ? w.aliases : String(w.aliases || '').split(','))
        .map((a) => String(a).trim().slice(0, 60))
        .filter(Boolean)
        .slice(0, 10),
    }))
    .filter((w) => /^[A-Z0-9&_.\-/]{1,30}$/.test(w.symbol))
    .slice(0, 200);
}

function sanitizePrefs(p) {
  const catIds = classifier.categoryList.map((c) => c.id);
  const d = DEFAULT_PREFS();
  return {
    categories: pick(p.categories, catIds),
    regions: p.regions === undefined ? d.regions : pick(p.regions, REGIONS),
    minImpact: IMPACTS.includes(p.minImpact) ? p.minImpact : d.minImpact,
    watchlist: sanitizeWatchlist(p.watchlist),
    watchOnly: Boolean(p.watchOnly),
    ccys: p.ccys === undefined ? d.ccys : pick(p.ccys, CCYS),
    telegramChatId: /^-?\d{1,20}$/.test(String(p.telegramChatId || '').trim()) ? String(p.telegramChatId).trim() : '',
    alertMinImpact: IMPACTS.includes(p.alertMinImpact) || p.alertMinImpact === 'Off' ? p.alertMinImpact : d.alertMinImpact,
    alertWatchMedium: p.alertWatchMedium === undefined ? d.alertWatchMedium : Boolean(p.alertWatchMedium),
    calendarAlerts: p.calendarAlerts === undefined ? d.calendarAlerts : Boolean(p.calendarAlerts),
  };
}

// ---------- CRUD ----------
const publicUser = (u) => u && {
  id: u.id, username: u.username, name: u.name, role: u.role, active: u.active,
  createdAt: u.createdAt, lastLogin: u.lastLogin || null, prefs: u.prefs,
};

const list = () => users;
const count = () => users.length;
const get = (id) => users.find((u) => u.id === id);
const byUsername = (name) => users.find((u) => u.username === String(name || '').trim().toLowerCase());
const adminCount = () => users.filter((u) => u.role === 'admin' && u.active).length;

function create({ username, name, password, role = 'user', prefs = {} }) {
  username = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error('Username: 3-32 letters, numbers, dot, dash or underscore');
  if (byUsername(username)) throw new Error('That username is taken');
  const pwErr = validatePassword(password, username);
  if (pwErr) throw new Error(pwErr);
  const u = {
    id: crypto.randomBytes(8).toString('hex'),
    username,
    name: String(name || username).trim().slice(0, 60),
    role: role === 'admin' ? 'admin' : 'user',
    active: true,
    pass: hashPassword(password),
    tokenVersion: 1,
    createdAt: Date.now(),
    prefs: sanitizePrefs({ ...DEFAULT_PREFS(), ...prefs }),
  };
  users.push(u);
  compiledWatch.set(u.id, classifier.compileWatchlist(u.prefs.watchlist));
  save();
  return u;
}

function update(id, changes) {
  const u = get(id);
  if (!u) throw new Error('User not found');
  if (changes.name !== undefined) u.name = String(changes.name).trim().slice(0, 60) || u.username;
  if (changes.role !== undefined) {
    const role = changes.role === 'admin' ? 'admin' : 'user';
    if (u.role === 'admin' && role !== 'admin' && adminCount() <= 1) throw new Error('Keep at least one active admin');
    u.role = role;
  }
  if (changes.active !== undefined) {
    const active = Boolean(changes.active);
    if (!active && u.role === 'admin' && u.active && adminCount() <= 1) throw new Error('Keep at least one active admin');
    if (!active) u.tokenVersion++; // sign them out
    u.active = active;
  }
  if (changes.password !== undefined) {
    const pwErr = validatePassword(changes.password, u.username);
    if (pwErr) throw new Error(pwErr);
    u.pass = hashPassword(changes.password);
    u.tokenVersion++; // sign out other sessions
  }
  if (changes.prefs) {
    u.prefs = sanitizePrefs({ ...u.prefs, ...changes.prefs });
    compiledWatch.set(u.id, classifier.compileWatchlist(u.prefs.watchlist));
  }
  save();
  return u;
}

function remove(id) {
  const u = get(id);
  if (!u) throw new Error('User not found');
  if (u.role === 'admin' && u.active && adminCount() <= 1) throw new Error('Keep at least one active admin');
  users = users.filter((x) => x.id !== id);
  compiledWatch.delete(id);
  save();
}

// ---------- sessions ----------
const sign = (data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

function makeToken(u) {
  const payload = Buffer.from(JSON.stringify({ id: u.id, v: u.tokenVersion, exp: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const good = sign(payload);
  if (good.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(good), Buffer.from(sig))) return null;
  try {
    const { id, v, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const u = get(id);
    if (!u || !u.active || u.tokenVersion !== v || Date.now() > exp) return null;
    return u;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const userFromReq = (req) => readToken(parseCookies(req.headers.cookie)[COOKIE]);

function setSessionCookie(req, res, u) {
  // Secure flag when served over HTTPS (req.secure is reliable because only a local proxy is trusted)
  const secure = req.secure || process.env.COOKIE_SECURE === 'true';
  res.setHeader('Set-Cookie', `${COOKIE}=${makeToken(u)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`);
}

const clearSessionCookie = (res) => res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);

function recordLogin(u) {
  u.lastLogin = Date.now();
  save();
}

// ---------- per-user view of the news ----------
// Adds this user's watchlist hits and a user-specific impact (watchlist hits rank higher)
function personalize(item, u) {
  const watch = classifier.matchWatch(item, compiledWatch.get(u.id));
  if (!watch.length) return { ...item, watch };
  const score = item.score + classifier.WATCH_BOOST;
  return { ...item, watch, score, impact: classifier.impactFor(score) };
}

// Does this (personalized) item belong in the user's feed?
function wants(item, u) {
  const p = u.prefs;
  if (p.categories.length && !item.categories.some((c) => p.categories.includes(c)) && !item.watch.length) return false;
  if (!item.regions.some((r) => p.regions.includes(r))) return false;
  if (classifier.IMPACT_RANK[item.impact] < classifier.IMPACT_RANK[p.minImpact]) return false;
  if (p.watchOnly && !item.watch.length) return false;
  return true;
}

module.exports = {
  load, list, count, get, byUsername, create, update, remove, publicUser,
  checkPassword, userFromReq, setSessionCookie, clearSessionCookie, recordLogin,
  personalize, wants, DEFAULT_PREFS, REGIONS, IMPACTS, CCYS,
};
