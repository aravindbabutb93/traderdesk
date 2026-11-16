// Run: npm run test:rules
// Shows how sample headlines score, so you can tune config/rules.js.
const c = require('../src/classifier');

const samples = [
  ['IN', 'RBI cuts repo rate by 25 bps in surprise move, shifts stance to accommodative'],
  ['US', 'Fed holds rates steady; Powell signals two cuts next year'],
  ['IN', 'Sensex crashes 1,000 points as FIIs dump Indian stocks'],
  ['US', 'Trump announces new tariffs on India, rupee slips to record low'],
  ['GLOBAL', 'Crude oil jumps 4% after OPEC+ agrees deeper output cuts'],
  ['US', 'US nonfarm payrolls beat estimates; Treasury yields rise'],
  ['IN', 'Infosys Q2 results: net profit rises 5%, beats estimates'],
  ['IN', 'SEBI tightens F&O rules, raises lot size for index derivatives'],
  ['FX', 'EUR/USD steadies ahead of ECB minutes'],
  ['IN', 'Tata Motors launches new EV variant in Pune'],
  ['IN', 'HDFC Bank Q2 net profit rises 11%; NPAs ease'],
  ['IN', 'PSU bank stocks rally as RBI eases bad loan norms'],
];

for (const [region, title] of samples) {
  const r = c.classify({ title, summary: '', sourceRegion: region });
  const s = r.sentiment === 'bullish' ? '▲' : r.sentiment === 'bearish' ? '▼' : ' ';
  console.log(`${r.impact.padEnd(6)} ${String(r.score).padStart(2)} ${s}  ${title}`);
  console.log(`            ${r.regions.join('/')} | ${r.categories.join(', ')}`);
}
