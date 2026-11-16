const crypto = require('crypto');

const IST = 'Asia/Kolkata';

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Word-boundary match that also works for terms like "s&p 500", "usd/inr", "u.s."
function termRegex(term) {
  return new RegExp(`(^|[^a-z0-9])${escRe(term.toLowerCase())}(?=$|[^a-z0-9])`, 'i');
}

function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function istTime(ts = Date.now(), withDate = false) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    hour: '2-digit', minute: '2-digit', hour12: false,
    ...(withDate ? { day: '2-digit', month: 'short' } : {}),
  }).format(new Date(ts));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run async tasks with a concurrency limit
async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (i < list.length) {
      const idx = i++;
      out[idx] = await fn(list[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

module.exports = { IST, termRegex, normalizeTitle, hash, stripHtml, istTime, sleep, mapLimit };
