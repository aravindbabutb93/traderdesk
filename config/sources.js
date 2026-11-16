// News sources. Each feed is tagged with a home region:
//   IN = India, US = United States, GLOBAL = world/commodities, FX = currencies
// Set enabled:false to switch a feed off, slow:true (or every:<seconds>) to poll it less often. Feed URLs do change; the dashboard's
// "Sources" panel shows which ones are failing so you can swap them out.

const gnews = (query, gl = 'IN') =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query + ' when:1d')}&hl=en-${gl}&gl=${gl}&ceid=${gl}:en`;

module.exports = [
  // ---------- India ----------
  { id: 'et-markets',  name: 'Economic Times – Markets', region: 'IN', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms' },
  { id: 'et-economy',  name: 'Economic Times – Economy', region: 'IN', url: 'https://economictimes.indiatimes.com/news/economy/rssfeeds/1373380680.cms' },
  { id: 'mc-markets',  name: 'Moneycontrol – Markets',   region: 'IN', url: 'https://www.moneycontrol.com/rss/marketreports.xml' },
  { id: 'mc-latest',   name: 'Moneycontrol – Latest',    region: 'IN', url: 'https://www.moneycontrol.com/rss/latestnews.xml' },
  { id: 'mint-markets',name: 'Mint – Markets',           region: 'IN', url: 'https://www.livemint.com/rss/markets' },
  { id: 'bs-markets',  name: 'Business Standard – Markets', region: 'IN', url: 'https://www.business-standard.com/rss/markets-106.rss' },
  { id: 'hbl-markets', name: 'BusinessLine – Markets',   region: 'IN', url: 'https://www.thehindubusinessline.com/markets/feeder/default.rss' },
  { id: 'gn-india',    name: 'Google News – India markets', region: 'IN', google: true,
    url: gnews('Nifty OR Sensex OR "Bank Nifty" OR RBI OR SEBI OR FII', 'IN') },

  // ---------- United States ----------
  { id: 'cnbc-top',     name: 'CNBC – Top News', region: 'US', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
  { id: 'cnbc-economy', name: 'CNBC – Economy',  region: 'US', url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html' },
  { id: 'mw-top',       name: 'MarketWatch – Top Stories', region: 'US', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
  { id: 'yahoo-fin',    name: 'Yahoo Finance',   region: 'US', url: 'https://finance.yahoo.com/news/rssindex' },
  { id: 'gn-us',        name: 'Google News – US markets', region: 'US', google: true,
    url: gnews('"Federal Reserve" OR FOMC OR "Wall Street" OR "Treasury yields" OR Nasdaq', 'US') },

  // ---------- Global / commodities / geopolitics ----------
  { id: 'investing-stocks', name: 'Investing.com – Stock Market', region: 'GLOBAL', slow: true, url: 'https://www.investing.com/rss/news_25.rss' },
  { id: 'investing-econ',   name: 'Investing.com – Economy',      region: 'GLOBAL', slow: true, url: 'https://www.investing.com/rss/news_14.rss' },
  { id: 'gn-global',        name: 'Google News – Global macro',   region: 'GLOBAL', google: true,
    url: gnews('"crude oil" OR OPEC OR "China economy" OR ECB OR "Bank of Japan" OR tariffs', 'US') },

  // ---------- Forex ----------
  { id: 'fxstreet', name: 'FXStreet – News', region: 'FX', url: 'https://www.fxstreet.com/rss/news' },
  { id: 'gn-fx',    name: 'Google News – Forex', region: 'FX', google: true,
    url: gnews('"dollar index" OR EURUSD OR "rupee" OR "USD/INR" OR forex', 'IN') },
];
