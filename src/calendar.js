// Economic calendar: weekly global events (USD, EUR, GBP, JPY, CNY, ...) from the
// free ForexFactory JSON feed, merged with India events from config/india-events.json.
const fs = require('fs');
const path = require('path');
const { hash } = require('./utils');

const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const INDIA_FILE = path.join(__dirname, '..', 'config', 'india-events.json');

let globalEvents = [];
const status = { lastOk: null, error: null };

function loadIndiaEvents() {
  try {
    const { events = [] } = JSON.parse(fs.readFileSync(INDIA_FILE, 'utf8'));
    return events
      .map((e) => ({
        id: hash(`IN|${e.title}|${e.date}`),
        title: e.title,
        country: 'INR',
        time: new Date(e.date).getTime(),
        impact: e.impact || 'High',
        forecast: e.forecast || '',
        previous: e.previous || '',
        source: 'India events',
      }))
      .filter((e) => !isNaN(e.time));
  } catch (e) {
    console.warn('[calendar] india-events.json:', e.message);
    return [];
  }
}

async function refresh() {
  try {
    const res = await fetch(FF_URL, { headers: { 'User-Agent': 'MarketNews/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    globalEvents = data
      .filter((e) => ['High', 'Medium', 'Holiday'].includes(e.impact))
      .map((e) => ({
        id: hash(`${e.country}|${e.title}|${e.date}`),
        title: e.title,
        country: e.country,
        time: new Date(e.date).getTime(),
        impact: e.impact,
        forecast: e.forecast || '',
        previous: e.previous || '',
        source: 'ForexFactory',
      }))
      .filter((e) => !isNaN(e.time));
    status.lastOk = Date.now();
    status.error = null;
  } catch (e) {
    status.error = String(e.message || e); // keep last good data
  }
  return getEvents();
}

function getEvents() {
  return [...globalEvents, ...loadIndiaEvents()].sort((a, b) => a.time - b.time);
}

module.exports = { refresh, getEvents, status };
