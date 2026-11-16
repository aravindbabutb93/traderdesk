// Market digest: clubs the same story from many sources into one point, ranks the
// points by market impact and groups them by theme. Works with no API key.
// If ANTHROPIC_API_KEY is set, it can also write a short AI brief from those points.
const { IMPACT_RANK } = require('./classifier');

const IST_OFFSET = 5.5 * 3600e3;
const DAY = 86400e3;

// Theme order in the summary (first weighted category of the lead story decides the theme)
const THEMES = [
  ['central-bank', 'Central banks & rates'],
  ['inflation', 'Inflation'],
  ['macro-data', 'Macro data'],
  ['flows', 'FII / DII flows'],
  ['policy', 'Policy & regulation'],
  ['geopolitics', 'Geopolitics'],
  ['commodities', 'Commodities'],
  ['currency', 'Currency'],
  ['global-markets', 'Global markets'],
  ['earnings', 'Earnings'],
  ['corporate', 'Corporate actions'],
];
const THEME_IDS = new Set(THEMES.map(([id]) => id));

const STOP = new Set(('a an the and or but of to in on at for from by with as is are was were be been it its this that these those ' +
  'after before over under amid into than then up down out about says said say report reports news live update updates today ' +
  'yesterday week will may could would should can new latest vs via what why how who when where here there his her their our your ' +
  'stock stocks share shares market markets').split(' '));

const tokens = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9%&.]+/g, ' ').split(' ')
  .map((w) => w.replace(/^\.+|\.+$/g, '')).filter((w) => w.length > 1 && !STOP.has(w)));

function similar(a, b) {
  let common = 0;
  for (const t of a) if (b.has(t)) common++;
  if (!common) return false;
  const jaccard = common / (a.size + b.size - common);
  return jaccard >= 0.45 || (common >= 4 && common / Math.min(a.size, b.size) >= 0.6);
}

// ---------- time windows (all in IST) ----------
const H = 3600e3;
const dayStartIst = (ts) => Math.floor((ts + IST_OFFSET) / DAY) * DAY - IST_OFFSET; // 00:00 IST of that day
const weekdayIst = (ts) => new Date(ts + IST_OFFSET).getUTCDay(); // 0 Sun … 5 Fri, 6 Sat

const WINDOWS = {
  auto: 'Since last session',
  yesterday: 'Yesterday 00:00 → now',
  close: 'Since last close (15:30)',
  weekend: 'Weekend: Fri close → Mon 09:15',
  '1d': 'Last 1 day',
  '2d': 'Last 2 days',
  '3d': 'Last 3 days',
  thisweek: 'This week (Mon → now)',
  '7d': 'Last 7 days',
  lastweek: 'Last week (Mon–Sun)',
};

// Returns { from, to, label } for a window name
function windowRange(kind, now = Date.now()) {
  const today = dayStartIst(now);
  const wd = weekdayIst(now);
  const sinceMon = (wd + 6) % 7; // days since Monday
  const r = (from, to = now, label = WINDOWS[kind]) => ({ from, to: Math.min(to, now), label });

  switch (kind) {
    case '1d': return r(now - DAY);
    case '2d': return r(now - 2 * DAY);
    case '3d': return r(now - 3 * DAY);
    case '7d': return r(now - 7 * DAY);
    case 'yesterday': return r(today - DAY);
    case 'thisweek': return r(today - sinceMon * DAY);
    case 'lastweek': return r(today - (sinceMon + 7) * DAY, today - sinceMon * DAY);
    case 'close': {
      let t = today + 15.5 * H; // 15:30 IST
      if (t > now) t -= DAY;
      while (weekdayIst(t) === 0 || weekdayIst(t) === 6) t -= DAY;
      return r(t);
    }
    case 'weekend': {
      // most recent Friday 15:30 that has already passed → the following Monday 09:15
      let fri = today - ((wd - 5 + 7) % 7) * DAY + 15.5 * H;
      if (fri > now) fri -= 7 * DAY;
      return r(fri, fri + 3 * DAY - 6.25 * H);
    }
    default: {
      // 'auto': Monday, Saturday or Sunday → from Friday 00:00 (covers the whole weekend); other days → yesterday 00:00
      if (wd === 1 || wd === 6 || wd === 0) {
        const back = wd === 1 ? 3 : wd === 0 ? 2 : 1;
        return r(today - back * DAY, now, wd === 1 ? 'Fri → Mon (weekend included)' : 'Fri → now (weekend)');
      }
      return r(today - DAY, now, 'Yesterday → now');
    }
  }
}

function clusterItems(items) {
  // strongest stories first, so each cluster's lead is its best headline
  const sorted = [...items].sort((a, b) => b.score - a.score || b.publishedAt - a.publishedAt);
  const clusters = [];
  const index = new Map(); // token -> cluster ids that contain it (only candidates are compared)
  for (const it of sorted) {
    const tk = tokens(it.title);
    if (!tk.size) continue;
    const cand = new Set();
    for (const t of tk) for (const id of index.get(t) || []) cand.add(id);
    // match against the cluster's lead and its first few members (not every member, so clusters don't snowball)
    let c = null;
    for (const id of [...cand].sort((a, b) => a - b)) {
      if (clusters[id].keys.some((k) => similar(k, tk))) { c = clusters[id]; break; }
    }
    if (!c) {
      c = { id: clusters.length, keys: [], items: [] };
      clusters.push(c);
    }
    c.items.push(it);
    if (c.keys.length < 4) {
      c.keys.push(tk);
      for (const t of tk) {
        if (!index.has(t)) index.set(t, []);
        const arr = index.get(t);
        if (arr[arr.length - 1] !== c.id) arr.push(c.id);
      }
    }
  }
  return clusters.map(toPoint);
}

const brief = (i) => i && ({ title: i.title, source: i.source, at: i.publishedAt });

function toPoint(cl) {
  const lead = cl.items[0];
  const sources = [...new Set(cl.items.map((i) => i.source))];
  const bull = cl.items.filter((i) => i.sentiment === 'bullish').length;
  const bear = cl.items.filter((i) => i.sentiment === 'bearish').length;
  const impact = cl.items.reduce((m, i) => (IMPACT_RANK[i.impact] > IMPACT_RANK[m] ? i.impact : m), 'Low');
  const cats = [...new Set(cl.items.flatMap((i) => i.categories))];
  const theme = (lead.categories.find((c) => THEME_IDS.has(c)) || cats.find((c) => THEME_IDS.has(c)) || 'other');
  const times = cl.items.map((i) => i.publishedAt);
  const byTime = [...cl.items].sort((a, b) => a.publishedAt - b.publishedAt);
  return {
    id: lead.id,
    title: lead.title,
    summary: lead.summary ? lead.summary.slice(0, 300) : '',
    link: lead.link,
    impact,
    score: lead.score,
    rank: lead.score + 1.5 * Math.log2(sources.length) + (impact === 'High' ? 2 : 0),
    sentiment: bull > bear ? 'bullish' : bear > bull ? 'bearish' : 'neutral',
    theme,
    categories: cats,
    regions: [...new Set(cl.items.flatMap((i) => i.regions))],
    watch: [...new Set(cl.items.flatMap((i) => i.watch || []))],
    sources,
    count: cl.items.length,
    first: Math.min(...times),
    last: Math.max(...times),
    firstStory: brief(byTime[0]),
    lastStory: brief(byTime[byTime.length - 1]),
    related: cl.items.slice(1, 4).map((i) => ({ title: i.title, link: i.link, source: i.source })),
  };
}

// Top movers: best-ranked points, at most 3 per theme so one topic doesn't fill the list
function pickTop(points, n) {
  const out = []; const per = {};
  for (const p of points) {
    if ((per[p.theme] || 0) >= 3) continue;
    per[p.theme] = (per[p.theme] || 0) + 1;
    out.push(p);
    if (out.length >= n) break;
  }
  return out;
}

/**
 * items: the user's personalised news (already filtered to what they want)
 * opts: { window: one of WINDOWS, regions: [...], storeOldest: ts of the oldest story kept }
 */
function build(items, opts = {}) {
  const now = Date.now();
  const { from, to, label } = windowRange(opts.window, now);
  const long = to - from > 2.5 * DAY; // multi-day windows show more points
  const inWindow = items.filter((it) => it.publishedAt >= from && it.publishedAt <= to + 60e3 &&
    (!opts.regions || !opts.regions.length || it.regions.some((r) => opts.regions.includes(r))));

  // Low-impact stories only count if several outlets ran them (that's a sign they matter)
  const points = clusterItems(inWindow)
    .filter((p) => p.impact !== 'Low' || p.sources.length >= 3)
    .sort((a, b) => b.rank - a.rank);

  const themeLabels = Object.fromEntries([...THEMES, ['other', 'Other market movers']]);
  const themes = [...THEMES.map(([id]) => id), 'other']
    .map((id) => ({ id, label: themeLabels[id], points: points.filter((p) => p.theme === id).slice(0, long ? 12 : 8) }))
    .filter((t) => t.points.length);

  // Tone: impact-weighted bullish vs bearish across all points
  let bull = 0; let bear = 0;
  for (const p of points) {
    const w = 1 + IMPACT_RANK[p.impact];
    if (p.sentiment === 'bullish') bull += w;
    if (p.sentiment === 'bearish') bear += w;
  }
  const tone = bull + bear === 0 ? 'neutral' : bull > bear * 1.3 ? 'bullish' : bear > bull * 1.3 ? 'bearish' : 'mixed';

  const byRegion = {};
  for (const p of points) for (const r of p.regions) byRegion[r] = (byRegion[r] || 0) + 1;

  const ordered = [...inWindow].sort((a, b) => a.publishedAt - b.publishedAt);
  return {
    from,
    to,
    label,
    // the server only keeps RETENTION_DAYS / MAX_ITEMS of news; flag windows that reach past that
    partial: Boolean(opts.storeOldest && opts.storeOldest > from + 3 * H),
    storeOldest: opts.storeOldest || null,
    oldest: brief(ordered[0]),   // first story the summary covers
    newest: brief(ordered[ordered.length - 1]), // latest story it covers
    window: WINDOWS[opts.window] ? opts.window : 'auto',
    stories: inWindow.length,
    pointsTotal: points.length,
    high: points.filter((p) => p.impact === 'High').length,
    medium: points.filter((p) => p.impact === 'Medium').length,
    tone,
    toneScore: { bull, bear },
    byRegion,
    top: pickTop(points, long ? 15 : 10),
    themes,
    watch: points.filter((p) => p.watch.length).slice(0, 10),
  };
}

// ---------- optional AI brief (Claude API) ----------
const AI_KEY = () => process.env.ANTHROPIC_API_KEY || '';
const AI_MODEL = () => process.env.SUMMARY_MODEL || 'claude-haiku-5-5';
const aiCache = new Map(); // key -> { at, text }

function aiEnabled() { return Boolean(AI_KEY()); }

async function aiBrief(digest, cacheKey) {
  if (!aiEnabled()) throw new Error('AI brief is off. Set ANTHROPIC_API_KEY in .env');
  const hit = aiCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 10 * 60e3) return hit.text;

  const fmt = (ts) => new Date(ts + IST_OFFSET).toISOString().slice(5, 16).replace('T', ' ');
  const lines = digest.themes.flatMap((t) => t.points.map((p) =>
    `[${t.label}] [${p.impact}] [${p.sentiment}] [${p.regions.join('/')}] [${p.sources.length} src] ${fmt(p.last)} IST — ${p.title}${p.summary ? ' :: ' + p.summary.slice(0, 200) : ''}`))
    .slice(0, digest.to - digest.from > 2.5 * DAY ? 140 : 90);

  const prompt = `You are a market analyst for an Indian trader who trades Nifty / Bank Nifty F&O and forex (USDINR, EURUSD).
Below are the clubbed market-moving headlines from ${fmt(digest.from)} IST to ${fmt(digest.to)} IST, tagged with theme, impact, headline sentiment, region and how many outlets carried them.

Window: ${digest.label}. Write a ${digest.to - digest.from > 2.5 * DAY ? 'multi-day market recap' : 'pre-market style brief'}. Use ONLY these headlines; do not invent numbers or events.
Format exactly:
BIAS: <one line: overall bias for Indian equities and a one-line USD/INR view>
- <8 to 12 bullets, most market-moving first. Merge related headlines into one point. Each bullet: what happened → why it matters / likely market impact (index, sector or currency).>
WATCH: <one line: key events, levels or data to watch next>

Headlines:
${lines.join('\n')}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': AI_KEY(), 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: AI_MODEL(), max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j.error && j.error.message) || `AI request failed (${res.status})`);
    const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    aiCache.set(cacheKey, { at: Date.now(), text });
    if (aiCache.size > 200) aiCache.delete(aiCache.keys().next().value);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { build, windowRange, WINDOWS, aiEnabled, aiBrief };
