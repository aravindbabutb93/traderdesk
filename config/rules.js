// Keyword rules that decide how much a headline is likely to move the market.
// Tune freely, then run `npm run test:rules` to see how sample headlines score.
//
// Scoring:
//   - each category matched in the HEADLINE adds its full weight
//   - matched only in the summary adds half (rounded up)
//   - amplifier words in the headline add +2 each (max +4)
//   - an index name (Nifty, Sensex...) in the headline adds +2
//   - a watchlist symbol adds +2
//   - a dampener (preview/explainer) in the headline subtracts 2
//   - an India link (India, RBI, rupee...) on a global/US story adds +1
// impact = High if score >= thresholds.high, Medium if >= thresholds.medium

module.exports = {
  thresholds: { high: 6, medium: 3 },

  categories: [
    { id: 'central-bank', label: 'Central Bank', weight: 6, keywords: [
      'rbi', 'reserve bank', 'repo rate', 'reverse repo', 'crr', 'mpc', 'monetary policy',
      'fed', 'federal reserve', 'fomc', 'powell', 'rate cut', 'rate cuts', 'rate hike', 'rate hikes',
      'interest rate', 'interest rates', 'ecb', 'lagarde', 'boj', 'bank of japan', 'bank of england',
      'boe', 'pboc', 'dot plot', 'basis points', 'bps', 'malhotra', 'quantitative', 'liquidity infusion', 'omo' ] },

    { id: 'inflation', label: 'Inflation', weight: 4, keywords: [
      'cpi', 'wpi', 'inflation', 'pce', 'core inflation', 'ppi', 'consumer prices', 'retail inflation', 'wholesale inflation' ] },

    { id: 'macro-data', label: 'Macro Data', weight: 4, keywords: [
      'nonfarm', 'non-farm', 'payrolls', 'nfp', 'jobless claims', 'unemployment', 'jobs report',
      'gdp', 'iip', 'pmi', 'recession', 'retail sales', 'trade deficit', 'current account', 'core sector', 'ism' ] },

    { id: 'flows', label: 'FII / DII Flows', weight: 4, keywords: [
      'fii', 'fiis', 'fpi', 'fpis', 'dii', 'diis', 'foreign investors', 'foreign portfolio',
      'outflow', 'outflows', 'inflow', 'inflows', 'net sellers', 'net buyers' ] },

    { id: 'policy', label: 'Policy / Regulation', weight: 5, keywords: [
      'sebi', 'budget', 'union budget', 'fiscal deficit', 'gst', 'finance ministry', 'sitharaman',
      'stt', 'capital gains tax', 'f&o', 'fno', 'derivatives', 'expiry', 'lot size', 'margin rules', 'circuit breaker' ] },

    { id: 'geopolitics', label: 'Geopolitics', weight: 5, keywords: [
      'war', 'missile', 'missiles', 'airstrike', 'sanctions', 'tariff', 'tariffs', 'trade war', 'trade deal',
      'ceasefire', 'military', 'conflict', 'attack', 'invasion', 'border tension', 'election results', 'exit poll', 'exit polls' ] },

    { id: 'commodities', label: 'Commodities', weight: 4, keywords: [
      'crude', 'brent', 'wti', 'opec', 'opec+', 'oil prices', 'oil price', 'gold', 'silver', 'natural gas', 'copper' ] },

    { id: 'currency', label: 'Currency', weight: 3, keywords: [
      'rupee', 'inr', 'usd/inr', 'usdinr', 'dollar index', 'dxy', 'yuan', 'yen', 'euro', 'eur/usd', 'eurusd',
      'forex reserves', 'fx reserves', 'sterling', 'greenback' ] },

    { id: 'global-markets', label: 'Global Markets', weight: 2, keywords: [
      'wall street', 'dow', 'nasdaq', 's&p 500', 'treasury', 'treasury yields', 'bond yields', 'us yields',
      '10-year yield', 'vix', 'nikkei', 'hang seng', 'shanghai', 'kospi', 'ftse', 'dax', 'selloff', 'sell-off', 'global markets' ] },

    { id: 'earnings', label: 'Earnings', weight: 2, keywords: [
      'earnings', 'q1 results', 'q2 results', 'q3 results', 'q4 results', 'quarterly results', 'net profit',
      'profit', 'revenue', 'guidance', 'ebitda', 'margin', 'dividend', 'buyback' ] },

    { id: 'corporate', label: 'Corporate Action', weight: 2, keywords: [
      'merger', 'acquisition', 'acquire', 'ipo', 'stake sale', 'block deal', 'bulk deal', 'downgrade',
      'upgrade', 'rating', 'target price', 'demerger', 'delisting', 'fraud', 'raid', 'probe' ] },

    // ---------- Sectors (weight 0: tags only, they don't change the impact score) ----------
    // Users pick these in Settings to follow e.g. only banking news.
    { id: 'banking', label: 'Banking & Finance', group: 'Sector', weight: 0, keywords: [
      'bank', 'banks', 'banking', 'banker', 'lender', 'lenders', 'nbfc', 'nbfcs', 'bank nifty', 'nifty bank', 'banknifty',
      'psu bank', 'psu banks', 'private bank', 'hdfc bank', 'icici bank', 'sbi', 'state bank', 'axis bank', 'kotak',
      'indusind', 'bank of baroda', 'pnb', 'canara bank', 'yes bank', 'idfc first', 'federal bank', 'au small finance',
      'bajaj finance', 'npa', 'npas', 'bad loans', 'loan growth', 'credit growth', 'deposit growth', 'deposits',
      'microfinance', 'nim', 'casa', 'repo rate', 'crr', 'liquidity', 'fintech', 'upi', 'insurance', 'insurer' ] },

    { id: 'it', label: 'IT & Tech', group: 'Sector', weight: 0, keywords: [
      'it stocks', 'it sector', 'nifty it', 'infosys', 'tcs', 'wipro', 'hcl tech', 'hcltech', 'tech mahindra', 'ltimindtree',
      'software', 'semiconductor', 'semiconductors', 'chip', 'chips', 'nvidia', 'apple', 'microsoft', 'alphabet', 'meta',
      'artificial intelligence', 'ai', 'h-1b', 'outsourcing', 'big tech', 'nasdaq' ] },

    { id: 'auto', label: 'Auto', group: 'Sector', weight: 0, keywords: [
      'auto', 'autos', 'automaker', 'automobile', 'car sales', 'vehicle sales', 'two-wheeler', 'ev', 'evs', 'electric vehicle',
      'maruti', 'tata motors', 'mahindra', 'm&m', 'bajaj auto', 'hero motocorp', 'tvs motor', 'eicher', 'ashok leyland', 'tesla' ] },

    { id: 'pharma', label: 'Pharma & Healthcare', group: 'Sector', weight: 0, keywords: [
      'pharma', 'pharmaceutical', 'drugmaker', 'usfda', 'fda', 'healthcare', 'hospital', 'hospitals', 'vaccine',
      'sun pharma', 'dr reddy', "dr reddy's", 'cipla', 'lupin', 'divi', 'aurobindo', 'biocon', 'apollo hospitals', 'nifty pharma' ] },

    { id: 'energy', label: 'Oil, Gas & Power', group: 'Sector', weight: 0, keywords: [
      'oil', 'crude', 'brent', 'opec', 'natural gas', 'lng', 'refinery', 'refiner', 'petrol', 'diesel', 'fuel',
      'reliance', 'ongc', 'ioc', 'bpcl', 'hpcl', 'gail', 'power', 'electricity', 'ntpc', 'power grid', 'adani green',
      'tata power', 'renewable', 'solar', 'coal india', 'nifty energy' ] },

    { id: 'metals', label: 'Metals & Mining', group: 'Sector', weight: 0, keywords: [
      'metal', 'metals', 'steel', 'aluminium', 'aluminum', 'copper', 'zinc', 'iron ore', 'mining', 'tata steel',
      'jsw steel', 'hindalco', 'vedanta', 'sail', 'nmdc', 'nifty metal' ] },

    { id: 'fmcg', label: 'FMCG & Consumer', group: 'Sector', weight: 0, keywords: [
      'fmcg', 'consumer goods', 'consumption', 'rural demand', 'hul', 'hindustan unilever', 'itc', 'nestle', 'britannia',
      'dabur', 'marico', 'tata consumer', 'retail', 'retailer', 'dmart', 'titan', 'jewellery', 'nifty fmcg' ] },

    { id: 'realty', label: 'Realty & Infra', group: 'Sector', weight: 0, keywords: [
      'realty', 'real estate', 'housing', 'home sales', 'property', 'dlf', 'godrej properties', 'infrastructure', 'infra',
      'cement', 'ultratech', 'larsen', 'l&t', 'capex', 'construction', 'roads', 'railways', 'nifty realty' ] },

    { id: 'telecom', label: 'Telecom & Media', group: 'Sector', weight: 0, keywords: [
      'telecom', 'airtel', 'bharti', 'jio', 'vodafone idea', 'vi', 'spectrum', '5g', 'tariff hike', 'media', 'broadcaster' ] },
  ],

  // Words that make a headline more urgent (headline only)
  amplifiers: [
    'surprise', 'unexpected', 'unexpectedly', 'emergency', 'crash', 'crashes', 'plunge', 'plunges', 'plummets',
    'record high', 'record low', 'all-time high', 'lifetime low', 'halt', 'halted', 'default', 'biggest',
    'tumble', 'tumbles', 'soar', 'soars', 'slump', 'slumps', 'bloodbath', 'panic', 'shock', 'collapse', 'spike', 'spikes' ],

  // Low-signal headline patterns (previews, explainers, listicles): -2
  dampeners: [ 'ahead of', 'preview', 'what to expect', 'explained', 'explainer', 'stocks to watch', 'buzzing stocks',
    'top gainers', 'top losers', 'opinion', 'how to', 'should you', 'things to know', 'trade setup' ],

  // Headline mentions of these get +2
  indices: [ 'nifty', 'nifty 50', 'sensex', 'bank nifty', 'banknifty', 'nifty bank', 'finnifty', 'india vix', 'gift nifty', 'midcap', 'smallcap', 'dalal street', 'f&o', 'fno', 'index derivatives' ],

  // Extra region tags detected from text (added to the source's own region)
  regions: {
    IN: [ 'india', 'indian', 'rbi', 'sebi', 'nifty', 'sensex', 'rupee', 'nse', 'bse', 'dalal street', 'mumbai', 'modi', 'sitharaman', 'gift nifty', 'fii', 'fiis', 'fpi', 'fpis', 'dii', 'diis' ],
    US: [ 'fed', 'federal reserve', 'fomc', 'powell', 'wall street', 'nasdaq', 'dow', 's&p 500', 'treasury', 'u.s.', 'us economy', 'united states', 'trump', 'white house', 'nonfarm', 'payrolls' ],
    FX: [ 'forex', 'dollar index', 'dxy', 'eur/usd', 'eurusd', 'usd/inr', 'usdinr', 'yen', 'euro', 'sterling', 'currency', 'currencies', 'greenback' ],
    GLOBAL: [ 'china', 'europe', 'ecb', 'boj', 'japan', 'opec', 'crude', 'brent', 'gold', 'global', 'asia', 'asian', 'middle east', 'russia', 'ukraine', 'israel', 'iran', 'tariff', 'tariffs' ],
  },

  // Rough direction hint from the headline (not a trading signal)
  bullish: [ 'rally', 'rallies', 'cuts repo rate', 'cuts interest rates', 'surge', 'surges', 'jumps', 'soars', 'gains', 'rises', 'climbs', 'record high', 'rate cut', 'cuts rates',
    'upgrade', 'beats', 'inflows', 'net buyers', 'rebound', 'rebounds', 'recovers', 'ceasefire', 'trade deal', 'eases', 'cools' ],
  bearish: [ 'crash', 'crashes', 'plunge', 'plunges', 'falls', 'drops', 'slips', 'tumbles', 'slumps', 'sinks', 'selloff', 'sell-off',
    'rate hike', 'hikes rates', 'downgrade', 'misses', 'outflows', 'net sellers', 'war', 'tariff', 'tariffs', 'sanctions', 'recession',
    'record low', 'lifetime low', 'weakens', 'fears', 'hot inflation', 'bloodbath' ],
};
