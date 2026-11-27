const logger = require("../../infrastructure/logger");

/**
 * Public market data.
 *
 * Both sources are keyless public endpoints:
 * - Yahoo Finance chart/search API for listed stocks and ETFs (NSE/BSE);
 * - MFAPI.in for Indian mutual-fund NAVs.
 *
 * Results are cached in-process (quotes ~60s, NAVs ~6h, search ~10min) and
 * identical in-flight requests are coalesced, so opening the page does not
 * fan out one upstream call per holding. Nothing is written to the database.
 */

const QUOTE_TTL_MS = 60 * 1000;
const NAV_TTL_MS = 6 * 60 * 60 * 1000;
const SEARCH_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_CACHE_ENTRIES = 500;

const cache = new Map();
const inFlight = new Map();

const fetchJson = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Yahoo rejects requests without a browser-like agent.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) FinTrack/1.0 (market tracking)",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Market data request failed (${response.status})`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

const pruneCache = () => {
  if (cache.size <= MAX_CACHE_ENTRIES) return;

  const now = Date.now();

  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }

  // Still oversized: drop the oldest inserted entries.
  while (cache.size > MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
};

const cached = (key, ttlMs, loader) => {
  const hit = cache.get(key);

  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.value);
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = loader()
    .then((value) => {
      cache.set(key, { expiresAt: Date.now() + ttlMs, value });
      pruneCache();
      return value;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, promise);
  return promise;
};

const round = (value, digits = 2) => {
  const number = Number(value);

  if (!Number.isFinite(number)) return null;

  const factor = 10 ** digits;
  return Math.round((number + Number.EPSILON) * factor) / factor;
};

const normalizeSparkline = (values, limit = 30) =>
  values
    .map((value) => round(value))
    .filter((value) => Number.isFinite(value))
    .slice(-limit);

/** Latest quote for a Yahoo symbol (stock or ETF). */
const stockQuote = async (symbol) => {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    "?range=1mo&interval=1d";

  const payload = await fetchJson(url);
  const result = payload?.chart?.result?.[0];

  if (!result?.meta) {
    throw new Error("No market data for this symbol");
  }

  const meta = result.meta;
  const price = round(meta.regularMarketPrice ?? meta.previousClose);
  const previousClose = round(
    meta.chartPreviousClose ?? meta.previousClose ?? price,
  );

  if (!Number.isFinite(price)) {
    throw new Error("No market price for this symbol");
  }

  const closes = (result.indicators?.quote?.[0]?.close ?? []).filter((value) =>
    Number.isFinite(value),
  );
  // `chartPreviousClose` is the close before the whole range (a month ago for
  // this query), not yesterday. The second-to-last daily close is yesterday.
  const seriesPrevious =
    closes.length > 1 ? closes[closes.length - 2] : undefined;
  const dailyPreviousClose = round(
    meta.previousClose ?? seriesPrevious ?? meta.chartPreviousClose ?? price,
  );

  return {
    kind: "STOCK",
    symbol: meta.symbol || symbol,
    name: meta.shortName || meta.longName || meta.symbol || symbol,
    exchange: meta.fullExchangeName || meta.exchangeName || "NSE",
    currency: meta.currency || "INR",
    price,
    previousClose: dailyPreviousClose,
    change: round(price - dailyPreviousClose),
    changePercent:
      dailyPreviousClose > 0
        ? round(((price - dailyPreviousClose) / dailyPreviousClose) * 100)
        : null,
    asOf: meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : new Date().toISOString(),
    sparkline: normalizeSparkline(closes),
    source: "Yahoo Finance",
  };
};

const fundCacheKey = (code) => `fund:${code}`;

/** Latest NAV for an MFAPI scheme code. */
const fundQuote = async (code) => {
  const payload = await fetchJson(
    `https://api.mfapi.in/mf/${encodeURIComponent(code)}`,
  );
  const meta = payload?.meta;
  const rows = Array.isArray(payload?.data) ? payload.data : [];

  if (!meta || rows.length === 0) {
    throw new Error("No NAV data for this fund");
  }

  const latest = round(rows[0].nav);
  const previous = round(rows[1]?.nav ?? latest);

  if (!Number.isFinite(latest)) {
    throw new Error("No NAV value for this fund");
  }

  return {
    kind: "FUND",
    symbol: String(meta.scheme_code || code),
    name: meta.scheme_name || "Mutual fund",
    exchange: meta.fund_house || "Mutual fund",
    currency: "INR",
    price: latest,
    previousClose: previous,
    change: round(latest - previous),
    changePercent: previous > 0 ? round(((latest - previous) / previous) * 100) : null,
    asOf: rows[0].date
      ? new Date(rows[0].date.split("-").reverse().join("-")).toISOString()
      : new Date().toISOString(),
    sparkline: normalizeSparkline(
      rows
        .slice(0, 30)
        .map((row) => Number(row.nav))
        .reverse(),
    ),
    source: "MFAPI.in (AMFI NAV)",
  };
};

const quote = async ({ kind, symbol }) => {
  const requested = String(symbol ?? "").trim();
  // Tickers are case-insensitive upstream, so normalise before the cache: one
  // instrument must not occupy a separate cache entry per capitalisation.
  const instrument = kind === "FUND" ? requested : requested.toUpperCase();
  const key = `${kind}:${instrument}`;

  return cached(key, kind === "FUND" ? NAV_TTL_MS : QUOTE_TTL_MS, () =>
    kind === "FUND" ? fundQuote(instrument) : stockQuote(instrument),
  );
};

const INDEX_SYMBOLS = [
  { symbol: "^NSEI", label: "NIFTY 50" },
  { symbol: "^BSESN", label: "SENSEX" },
  { symbol: "^NSEBANK", label: "BANK NIFTY" },
];

/** Indices shown at the top of the investments page. */
const marketOverview = async () => {
  const results = await Promise.allSettled(
    INDEX_SYMBOLS.map((index) => cached(index.symbol, QUOTE_TTL_MS, () => stockQuote(index.symbol))),
  );

  return INDEX_SYMBOLS.map((index, position) => {
    const result = results[position];

    if (result.status !== "fulfilled") {
      logger.warn("market.index_unavailable", { symbol: index.symbol });
      return { symbol: index.symbol, label: index.label, available: false };
    }

    return {
      symbol: index.symbol,
      label: index.label,
      available: true,
      price: result.value.price,
      change: result.value.change,
      changePercent: result.value.changePercent,
      asOf: result.value.asOf,
    };
  });
};

const mapStockResult = (row) => ({
  kind: "STOCK",
  symbol: row.symbol,
  name: row.longname || row.shortname || row.symbol,
  exchange: row.exchDisp || row.exchange || "",
  type: row.typeDisp || row.quoteType || "Equity",
});

/**
 * Search both sources. Stocks come from Yahoo (filtered to Indian listings);
 * funds come from MFAPI's scheme search. A failure in one source still returns
 * the other, so the picker keeps working when an upstream is down.
 */
const searchAssets = async (query) => {
  const term = String(query || "").trim().slice(0, 80);

  if (term.length < 2) return [];

  return cached(`search:${term.toLowerCase()}`, SEARCH_TTL_MS, async () => {
    const yahooUrl =
      "https://query1.finance.yahoo.com/v1/finance/search" +
      `?q=${encodeURIComponent(term)}&quotesCount=10&newsCount=0&listsCount=0`;

    const [stocks, funds] = await Promise.allSettled([
      fetchJson(yahooUrl),
      fetchJson(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(term)}`),
    ]);

    const stockRows =
      stocks.status === "fulfilled"
        ? (stocks.value?.quotes || [])
            .filter(
              (row) =>
                ["EQUITY", "ETF"].includes(row.quoteType) &&
                (/\.(NS|BO)$/i.test(row.symbol || "") ||
                  ["NSI", "BSE"].includes(row.exchange)),
            )
            .slice(0, 8)
            .map(mapStockResult)
        : [];

    const fundRows =
      funds.status === "fulfilled" && Array.isArray(funds.value)
        ? funds.value.slice(0, 6).map((row) => ({
            kind: "FUND",
            symbol: String(row.schemeCode),
            name: row.schemeName,
            exchange: "Mutual fund",
            type: "Fund",
          }))
        : [];

    if (stocks.status !== "fulfilled" && funds.status !== "fulfilled") {
      throw new Error("Market search is unavailable right now");
    }

    return [...stockRows, ...fundRows];
  });
};

module.exports = {
  quote,
  marketOverview,
  searchAssets,
  stockQuote,
  fundQuote,
  __cache: cache,
  fundCacheKey,
};
