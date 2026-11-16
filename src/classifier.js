const fs = require('fs');
const path = require('path');
const rules = require('../config/rules');
const { termRegex } = require('./utils');

const WATCHLIST_FILE = path.join(__dirname, '..', 'config', 'watchlist.json');
const IMPACT_RANK = { Low: 0, Medium: 1, High: 2 };

const compileList = (list) => list.map((kw) => ({ kw, re: termRegex(kw) }));

const categories = rules.categories.map((c) => ({ ...c, patterns: compileList(c.keywords) }));
const amplifiers = compileList(rules.amplifiers);
const indices = compileList(rules.indices);
const dampeners = compileList(rules.dampeners || []);
const bullish = compileList(rules.bullish);
const bearish = compileList(rules.bearish);
const regionPatterns = Object.fromEntries(
  Object.entries(rules.regions).map(([r, list]) => [r, compileList(list)])
);

const WATCH_BOOST = 2; // a watchlist hit adds +2, so the same story can rank higher for that user
const impactFor = (score) => (score >= rules.thresholds.high ? 'High' : score >= rules.thresholds.medium ? 'Medium' : 'Low');

// Watchlists are per user: compile once, then match items against them
function compileWatchlist(list = []) {
  return list.map((w) => ({
    symbol: w.symbol,
    patterns: compileList([w.symbol, ...(w.aliases || [])].filter(Boolean)),
  }));
}

function matchWatch(item, compiled) {
  if (!compiled || !compiled.length) return [];
  const full = ` ${item.title || ''} ${item.summary || ''} `.toLowerCase();
  return compiled.filter((w) => w.patterns.some((p) => p.re.test(full))).map((w) => w.symbol);
}

// Legacy config/watchlist.json (used once to seed the first admin's watchlist)
function readLegacyWatchlist() {
  try {
    return JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8')).symbols || [];
  } catch {
    return [];
  }
}

const firstHit = (patterns, text) => patterns.find((p) => p.re.test(text));
const allHits = (patterns, text) => patterns.filter((p) => p.re.test(text)).map((p) => p.kw);

function classify(item) {
  const title = ` ${item.title || ''} `.toLowerCase();
  const full = `${title} ${(item.summary || '').toLowerCase()} `;

  let score = 0;
  const cats = [];
  const reasons = [];

  for (const cat of categories) {
    const inTitle = firstHit(cat.patterns, title);
    const hit = inTitle || firstHit(cat.patterns, full);
    if (!hit) continue;
    cats.push(cat.id);
    if (!cat.weight) continue; // sector tag only
    reasons.push(hit.kw);
    score += inTitle ? cat.weight : Math.ceil(cat.weight / 2);
  }

  const amps = allHits(amplifiers, title);
  if (amps.length) {
    score += Math.min(4, amps.length * 2);
    reasons.push(...amps);
  }

  const idx = firstHit(indices, title);
  if (idx) {
    score += 2;
    reasons.push(idx.kw);
  }

  if (firstHit(dampeners, title)) score -= 2;


  const regions = new Set([item.sourceRegion || 'GLOBAL']);
  for (const [r, patterns] of Object.entries(regionPatterns)) {
    if (firstHit(patterns, full)) regions.add(r);
  }
  // A global/US story that names India is more relevant to our market
  if (item.sourceRegion !== 'IN' && regions.has('IN')) score += 1;

  const bull = allHits(bullish, title).length;
  const bear = allHits(bearish, title).length;
  const sentiment = bull > bear ? 'bullish' : bear > bull ? 'bearish' : 'neutral';

  const impact = impactFor(score);

  return {
    score,
    impact,
    categories: cats,
    regions: [...regions],
    sentiment,
    reasons: [...new Set(reasons)].slice(0, 8),
  };
}

const categoryLabels = Object.fromEntries(rules.categories.map((c) => [c.id, c.label]));
const categoryList = rules.categories.map((c) => ({ id: c.id, label: c.label, group: c.group || 'Market moving' }));

module.exports = {
  classify, impactFor, compileWatchlist, matchWatch, readLegacyWatchlist,
  categoryLabels, categoryList, IMPACT_RANK, WATCH_BOOST,
};
