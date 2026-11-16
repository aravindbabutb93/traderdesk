const Parser = require('rss-parser');
const crypto = require('crypto');
const { hash, normalizeTitle, stripHtml, mapLimit } = require('./utils');

const TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 8000);
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TradeDesk/2.0',
  Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
};

const parser = new Parser();

// Per-source health, shown in the dashboard
const health = {};
// Per-source HTTP cache validators so unchanged feeds come back as a tiny 304
const cache = {};

function toItem(raw, src) {
  let title = stripHtml(raw.title);
  if (!title) return null;

  let source = src.name;
  // Google News titles look like "Headline - Publisher"
  if (src.google) {
    const m = title.match(/^(.*\S)\s+-\s+([^-]{2,60})$/);
    if (m) {
      title = m[1].trim();
      source = `${m[2].trim()} · via Google News`;
    }
  }

  const d = new Date(raw.isoDate || raw.pubDate || Date.now());
  const publishedAt = isNaN(d.getTime()) ? Date.now() : Math.min(d.getTime(), Date.now());

  // Google News "summary" is just a list of links, so skip it
  const summary = src.google ? '' : stripHtml(raw.contentSnippet || raw.content || raw.summary || '').slice(0, 400);

  return {
    id: hash(normalizeTitle(title)),
    title,
    link: raw.link || '',
    source,
    sourceId: src.id,
    sourceRegion: src.region,
    publishedAt,
    summary,
  };
}

// Returns { items, changed }. changed=false means the feed was identical to last time.
async function fetchSource(src) {
  const started = Date.now();
  const h = (health[src.id] = { ...(health[src.id] || {}), id: src.id, name: src.name, region: src.region, lastTry: started });
  const c = (cache[src.id] = cache[src.id] || {});
  const headers = { ...HEADERS };
  if (c.etag) headers['If-None-Match'] = c.etag;
  if (c.lastModified) headers['If-Modified-Since'] = c.lastModified;

  try {
    const res = await fetch(src.url, { headers, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 304) {
      Object.assign(h, { ok: true, lastOk: Date.now(), error: null, ms: Date.now() - started, status: 304 });
      return { items: [], changed: false };
    }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    c.etag = res.headers.get('etag') || null;
    c.lastModified = res.headers.get('last-modified') || null;

    const body = await res.text();
    // Many feeds ignore validators; skip parsing if the bytes are identical
    const digest = crypto.createHash('sha1').update(body).digest('hex');
    if (digest === c.digest) {
      Object.assign(h, { ok: true, lastOk: Date.now(), error: null, ms: Date.now() - started, status: 200 });
      return { items: [], changed: false };
    }
    c.digest = digest;

    const feed = await parser.parseString(body);
    const items = (feed.items || []).map((r) => toItem(r, src)).filter(Boolean);
    Object.assign(h, { ok: true, lastOk: Date.now(), count: items.length, error: null, ms: Date.now() - started, status: 200 });
    return { items, changed: true };
  } catch (e) {
    const msg = e.name === 'TimeoutError' ? `timeout after ${TIMEOUT_MS}ms` : String(e.message || e);
    Object.assign(h, { ok: false, error: msg.slice(0, 160), ms: Date.now() - started, status: e.status || null });
    const err = new Error(msg);
    err.status = e.status;
    throw err;
  }
}

// One-shot fetch of every source (startup / manual refresh)
async function fetchAll(sources, concurrency = 10) {
  const results = await mapLimit(sources, concurrency, (s) => fetchSource(s).then((r) => r.items).catch(() => []));
  return results.flat();
}

// Record how late we saw an item vs. its publish time (rolling average per source)
function recordLag(sourceId, lagMs) {
  const h = health[sourceId];
  if (!h || lagMs < 0) return;
  const s = lagMs / 1000;
  h.lagSec = h.lagSec == null ? Math.round(s) : Math.round(h.lagSec * 0.8 + s * 0.2);
  h.lastNew = Date.now();
}

module.exports = { fetchSource, fetchAll, recordLag, health };
