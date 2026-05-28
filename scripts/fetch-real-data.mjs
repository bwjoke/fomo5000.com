import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const periods = [
  ["1W", 7],
  ["1M", 30],
  ["3M", 91],
  ["6M", 182],
  ["12M", 365],
];

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = ""] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);

const maxArg = args.get("max") || "2400";
const maxSymbols = maxArg === "all" ? Infinity : Number(maxArg);
const concurrency = Number(args.get("concurrency") || 3);
const requestDelayMs = Number(args.get("delay") || 240);
const maxAttempts = Number(args.get("attempts") || 6);
const cacheDir = args.get("cache") || "data/cache/nasdaq";
const useFallback = args.get("fallback") !== "none";
const profileMode = args.get("profiles") || "best-effort";
const outputPath = args.get("out") || "data/market-data.json";
const today = new Date();
const fromDate = args.get("from") || formatDate(addDays(today, -760));
const toDate = args.get("to") || formatDate(today);
const timelineFromDate = args.get("timeline-from") || "";

const headers = {
  "accept": "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  "origin": "https://www.nasdaq.com",
  "referer": "https://www.nasdaq.com/market-activity/stocks/screener",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
};

const stooqHeaders = {
  "accept": "text/csv,*/*",
  "user-agent": headers["user-agent"],
};

let existingStocksByTicker = new Map();

const officialSectorNames = {
  "Basic Materials": "基础材料",
  "Consumer Discretionary": "可选消费",
  "Consumer Staples": "必需消费",
  "Energy": "能源",
  "Finance": "金融",
  "Health Care": "医疗健康",
  "Industrials": "工业",
  "Miscellaneous": "其他",
  "Real Estate": "房地产",
  "Technology": "科技",
  "Telecommunications": "通信",
  "Utilities": "公用事业",
};

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return NaN;
  return Number(String(value).replace(/[$,%\s,]/g, ""));
}

function parseUsDate(value) {
  const [month, day, year] = value.split("/").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatCompactDate(dateText) {
  return dateText.replaceAll("-", "");
}

function safeSymbol(symbol) {
  return symbol.replace(/[^A-Z0-9._-]/gi, "_");
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data));
  await rename(tmpPath, path);
}

function cachePath(...parts) {
  return join(cacheDir, ...parts);
}

let nextRequestAt = 0;

async function throttleNetwork() {
  const now = Date.now();
  const wait = Math.max(0, nextRequestAt - now);
  nextRequestAt = Math.max(now, nextRequestAt) + requestDelayMs;
  if (wait > 0) await sleep(wait);
}

async function fetchText(url, { headers: requestHeaders = headers, cacheFile, label } = {}, attempt = 1) {
  if (cacheFile) {
    try {
      return await readFile(cacheFile, "utf8");
    } catch {
      // cache miss
    }
  }

  await throttleNetwork();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { headers: requestHeaders, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`${label || url}: ${response.status} ${response.statusText}`);
      error.status = response.status;
      error.retryAfter = Number(response.headers.get("retry-after") || 0);
      throw error;
    }
    if (cacheFile) {
      await mkdir(dirname(cacheFile), { recursive: true });
      await writeFile(cacheFile, text);
    }
    return text;
  } catch (error) {
    if (attempt >= maxAttempts) throw error;
    const retryAfter = Number.isFinite(error.retryAfter) && error.retryAfter > 0 ? error.retryAfter * 1000 : 0;
    const rateLimitDelay = error.status === 429 || error.status === 403 ? 8000 * attempt : 0;
    await sleep(Math.max(retryAfter, rateLimitDelay, 900 * attempt ** 1.45));
    return fetchText(url, { headers: requestHeaders, cacheFile, label }, attempt + 1);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options);
  return JSON.parse(text);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCommonEquity(row) {
  const symbol = row.symbol || "";
  const name = row.name || "";
  const marketCap = parseNumber(row.marketCap);
  const lastSale = parseNumber(row.lastsale);
  if (!/^[A-Z][A-Z.]{0,5}$/.test(symbol)) return false;
  if (!Number.isFinite(marketCap) || marketCap <= 0) return false;
  if (!Number.isFinite(lastSale) || lastSale <= 0) return false;
  if (!row.sector || !row.industry) return false;
  if (/\b(warrant|rights?|units?|preferred|preference|notes?|bond|debenture|etf|etn|fund)\b/i.test(name)) {
    return false;
  }
  return true;
}

function sectorDisplayName(sector) {
  return officialSectorNames[sector] || sector || "其他";
}

function findIndexAtOrBefore(rows, targetDate) {
  let lo = 0;
  let hi = rows.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (rows[mid].date <= targetDate) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

async function fetchProfile(row) {
  const existing = existingProfile(row);
  if (profileMode === "skip") {
    return existing || emptyProfile();
  }
  if ((profileMode === "reuse" || profileMode === "missing") && existing?.description) {
    return existing;
  }
  const symbol = encodeURIComponent(row.symbol);
  const path = cachePath("profiles", `${safeSymbol(row.symbol)}.json`);
  try {
    const json = await fetchJson(`https://api.nasdaq.com/api/company/${symbol}/company-profile`, {
      cacheFile: path,
      label: `${row.symbol} profile`,
    });
    const data = json?.data || {};
    const value = (key) => data[key]?.value || "";
    return {
      companyName: value("CompanyName"),
      description: value("CompanyDescription"),
      companyUrl: value("CompanyUrl"),
      profileSector: value("Sector"),
      profileIndustry: value("Industry"),
      region: value("Region"),
    };
  } catch {
    return existing || emptyProfile();
  }
}

function existingProfile(row) {
  const existing = existingStocksByTicker.get(row.symbol);
  if (!existing) return null;
  return {
    companyName: existing.name || "",
    description: existing.companyDescription || "",
    companyUrl: existing.companyUrl || "",
    profileSector: existing.sector || "",
    profileIndustry: existing.industry || "",
    region: existing.region || "",
  };
}

function emptyProfile() {
  return {
    companyName: "",
    description: "",
    companyUrl: "",
    profileSector: "",
    profileIndustry: "",
    region: "",
  };
}

function normalizeNasdaqHistory(json) {
  const rows = json?.data?.tradesTable?.rows || [];
  return rows
    .map((item) => ({
      date: parseUsDate(item.date),
      close: parseNumber(item.close),
    }))
    .filter((item) => item.date instanceof Date && !Number.isNaN(item.date.valueOf()) && Number.isFinite(item.close))
    .sort((a, b) => a.date - b.date);
}

async function fetchNasdaqHistory(row) {
  const symbol = encodeURIComponent(row.symbol);
  const url = `https://api.nasdaq.com/api/quote/${symbol}/historical?assetclass=stocks&fromdate=${fromDate}&todate=${toDate}&limit=9999`;
  const path = cachePath("history", `${fromDate}_${toDate}`, `${safeSymbol(row.symbol)}.json`);
  const json = await fetchJson(url, {
    cacheFile: path,
    label: `${row.symbol} nasdaq history`,
  });
  return normalizeNasdaqHistory(json);
}

function stooqSymbol(symbol) {
  return `${symbol.toLowerCase().replaceAll(".", "-")}.us`;
}

function parseStooqHistory(csv) {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2 || !/^date,/i.test(lines[0])) return [];
  return lines
    .slice(1)
    .map((line) => {
      const cells = line.split(",");
      return {
        date: new Date(`${cells[0]}T00:00:00.000Z`),
        close: parseNumber(cells[4]),
      };
    })
    .filter((item) => item.date instanceof Date && !Number.isNaN(item.date.valueOf()) && Number.isFinite(item.close))
    .sort((a, b) => a.date - b.date);
}

async function fetchStooqHistory(row) {
  const symbol = stooqSymbol(row.symbol);
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&d1=${formatCompactDate(fromDate)}&d2=${formatCompactDate(toDate)}&i=d`;
  const path = cachePath("stooq-history", `${fromDate}_${toDate}`, `${safeSymbol(row.symbol)}.csv`);
  const csv = await fetchText(url, {
    headers: stooqHeaders,
    cacheFile: path,
    label: `${row.symbol} stooq history`,
  });
  return parseStooqHistory(csv);
}

async function fetchHistory(row) {
  const profilePromise = fetchProfile(row);
  let historySource = "NASDAQ";
  let history = [];
  try {
    history = await fetchNasdaqHistory(row);
  } catch (error) {
    if (!useFallback) throw error;
  }
  if (history.length < 20 && useFallback) {
    try {
      const fallbackHistory = await fetchStooqHistory(row);
      if (fallbackHistory.length >= history.length) {
        history = fallbackHistory;
        historySource = "Stooq";
      }
    } catch {
      // Keep the original Nasdaq result/error outcome.
    }
  }
  const profile = await profilePromise;

  if (history.length < 20) return null;

  const current = history[history.length - 1];
  const marketCap = parseNumber(row.marketCap);

  return {
    id: row.symbol,
    ticker: row.symbol,
    name: (profile.companyName || row.name).replace(/\s+/g, " ").trim(),
    exchange: "US-listed",
    country: row.country || "",
    sector: row.sector,
    industry: row.industry,
    officialSectorName: sectorDisplayName(row.sector),
    companyDescription: profile.description,
    companyUrl: profile.companyUrl,
    region: profile.region,
    historySource,
    aiScore: null,
    marketCapUsd: Math.round(marketCap),
    lastSale: parseNumber(row.lastsale),
    dailyChangePct: parseNumber(row.pctchange),
    volume: parseNumber(row.volume),
    latestClose: current.close,
    latestDate: formatDate(current.date),
    history,
    sectors: [{ name: sectorDisplayName(row.sector), weight: 1 }],
  };
}

function makeTimeline(latestDate, startDateText = "") {
  if (!startDateText) {
    const weekCount = 52;
    return Array.from({ length: weekCount + 1 }, (_, index) => {
      return formatDate(addDays(latestDate, (index - weekCount) * 7));
    });
  }

  const timeline = [];
  const startDate = new Date(`${startDateText}T00:00:00.000Z`);
  for (let date = startDate; date <= latestDate; date = addDays(date, 7)) {
    timeline.push(formatDate(date));
  }
  const latestDateText = formatDate(latestDate);
  if (timeline[timeline.length - 1] !== latestDateText) timeline.push(latestDateText);
  return timeline;
}

function buildSeries(stock, timeline) {
  const sharesEstimate = stock.marketCapUsd / stock.latestClose;
  const growthSeries = Object.fromEntries(periods.map(([label]) => [label, []]));
  const returnSeries = Object.fromEntries(periods.map(([label]) => [label, []]));
  const closeSeries = [];
  const marketCapSeries = [];
  const dailyChangePctSeries = [];

  for (const dateText of timeline) {
    const snapshotDate = new Date(`${dateText}T00:00:00.000Z`);
    const snapshotIndex = findIndexAtOrBefore(stock.history, snapshotDate);
    const snapshot = snapshotIndex >= 0 ? stock.history[snapshotIndex] : null;
    const close = snapshot?.close ?? null;
    closeSeries.push(close);
    marketCapSeries.push(close ? Math.round(sharesEstimate * close) : null);

    const previousClose = snapshotIndex > 0 ? stock.history[snapshotIndex - 1].close : null;
    dailyChangePctSeries.push(close && previousClose ? (close / previousClose - 1) * 100 : null);

    for (const [label, days] of periods) {
      if (!close) {
        growthSeries[label].push(null);
        returnSeries[label].push(null);
        continue;
      }
      const baselineDate = addDays(snapshotDate, -days);
      const baselineIndex = findIndexAtOrBefore(stock.history, baselineDate);
      const baselineClose = baselineIndex >= 0 ? stock.history[baselineIndex].close : null;
      if (!baselineClose) {
        growthSeries[label].push(null);
        returnSeries[label].push(null);
        continue;
      }
      growthSeries[label].push(Math.round(sharesEstimate * (close - baselineClose)));
      returnSeries[label].push(close / baselineClose - 1);
    }
  }

  stock.closeSeries = closeSeries;
  stock.marketCapSeries = marketCapSeries;
  stock.dailyChangePctSeries = dailyChangePctSeries;
  stock.growthSeries = growthSeries;
  stock.returnSeries = returnSeries;

  const latestIndex = timeline.length - 1;
  stock.growth = Object.fromEntries(periods.map(([label]) => [label, growthSeries[label][latestIndex]]));
  stock.returns = Object.fromEntries(periods.map(([label]) => [label, returnSeries[label][latestIndex]]));
  stock.dailyChangePct = dailyChangePctSeries[latestIndex] ?? stock.dailyChangePct;
  stock.latestClose = closeSeries[latestIndex] ?? stock.latestClose;
  stock.marketCapUsd = marketCapSeries[latestIndex] ?? stock.marketCapUsd;

  delete stock.history;
  return stock;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  const stats = { completed: 0, usable: 0, failed: 0, nasdaq: 0, stooq: 0 };
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      try {
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
        if (results[currentIndex]) {
          stats.usable += 1;
          stats[results[currentIndex].historySource === "Stooq" ? "stooq" : "nasdaq"] += 1;
        } else {
          stats.failed += 1;
        }
      } catch (error) {
        results[currentIndex] = null;
        stats.failed += 1;
      }
      stats.completed += 1;
      if (stats.completed % 25 === 0 || stats.completed === items.length) {
        console.log(
          `history ${stats.completed}/${items.length} usable=${stats.usable} failed=${stats.failed} nasdaq=${stats.nasdaq} stooq=${stats.stooq}`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

console.log("Fetching NASDAQ screener...");
const existingPayload = await readJson(outputPath);
existingStocksByTicker = new Map((existingPayload?.stocks || []).map((stock) => [stock.ticker, stock]));
const screenerUrl = "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25&offset=0&download=true";
const screener = await fetchJson(screenerUrl, {
  cacheFile: args.get("refresh-screener") === "false" ? cachePath("screener", "stocks.json") : undefined,
  label: "nasdaq screener",
});
const sourceRows = screener?.data?.rows || [];
const eligibleRows = sourceRows.filter(isCommonEquity);
const universe = eligibleRows
  .filter(isCommonEquity)
  .sort((a, b) => parseNumber(b.marketCap) - parseNumber(a.marketCap))
  .slice(0, maxSymbols);

console.log(`Eligible common equities: ${eligibleRows.length}`);
console.log(`Fetching history for top ${universe.length} by market cap...`);

const stocks = (await mapLimit(universe, concurrency, fetchHistory)).filter(Boolean);
const latestDate = stocks.reduce((latest, stock) => (stock.latestDate > latest ? stock.latestDate : latest), "");
const timeline = makeTimeline(new Date(`${latestDate}T00:00:00.000Z`), timelineFromDate);
const sortedStocks = stocks
  .map((stock) => buildSeries(stock, timeline))
  .sort((a, b) => b.marketCapUsd - a.marketCapUsd);

const payload = {
  meta: {
    generatedAt: new Date().toISOString(),
    source: "NASDAQ screener + NASDAQ historical quote API",
    sourceRows: sourceRows.length,
    eligibleRows: eligibleRows.length,
    requestedRows: universe.length,
    usableRows: sortedStocks.length,
    historyFrom: fromDate,
    historyTo: toDate,
    latestDate,
    timelineGranularity: "weekly",
    timelineFrom: timeline[0],
    historySources: sortedStocks.reduce((counts, stock) => {
      counts[stock.historySource || "NASDAQ"] = (counts[stock.historySource || "NASDAQ"] || 0) + 1;
      return counts;
    }, {}),
    cacheDir,
    requestDelayMs,
    concurrency,
    indexSeries: existingPayload?.meta?.indexSeries,
    notes:
      "Market cap is current NASDAQ screener marketCap. Weekly market-cap changes are estimated from close-price returns with shares held constant. AI relevance is filled by scripts/semantic-score.py from official Nasdaq sector/industry plus company descriptions. Colors use official Nasdaq sector.",
  },
  timeline,
  periods: Object.fromEntries(periods),
  sectors: Object.entries(officialSectorNames).map(([source, name]) => ({ source, name })),
  indices: existingPayload?.indices || {},
  stocks: sortedStocks,
};

await mkdir("data", { recursive: true });
await writeJson(outputPath, payload);
console.log(`Wrote ${sortedStocks.length} stocks to ${outputPath}`);
