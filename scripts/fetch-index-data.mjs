import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = ""] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);

const outputPath = args.get("out") || "data/market-data.json";
const cacheDir = args.get("cache") || "data/cache/nasdaq";
const fromDate = args.get("from") || "2024-01-01";

const headers = {
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  origin: "https://www.nasdaq.com",
  referer: "https://www.nasdaq.com/market-activity/index/comp/historical",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
};

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return NaN;
  return Number(String(value).replace(/[$,%\s,]/g, ""));
}

function parseUsDate(value) {
  const [month, day, year] = value.split("/").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data));
  await rename(tmpPath, path);
}

async function fetchJson(url, cacheFile) {
  try {
    return JSON.parse(await readFile(cacheFile, "utf8"));
  } catch {
    // cache miss
  }

  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Nasdaq index request failed: ${response.status} ${response.statusText}`);
  const text = await response.text();
  await mkdir(dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, text);
  return JSON.parse(text);
}

function normalizeIndexRows(rows) {
  return rows
    .map((row) => ({
      date: parseUsDate(row.date),
      close: parseNumber(row.close),
    }))
    .filter((row) => row.date instanceof Date && !Number.isNaN(row.date.valueOf()) && Number.isFinite(row.close))
    .sort((a, b) => a.date - b.date)
    .map((row) => ({
      date: formatDate(row.date),
      close: row.close,
    }));
}

const payload = await readJson(outputPath);
const toDate = args.get("to") || payload.meta?.latestDate || payload.timeline?.[payload.timeline.length - 1];
if (!toDate) throw new Error("Unable to determine index end date");

const cacheFile = join(cacheDir, "indices", `COMP_${fromDate}_${toDate}.json`);
const url = `https://api.nasdaq.com/api/quote/COMP/historical?assetclass=index&fromdate=${fromDate}&todate=${toDate}&limit=9999`;
const json = await fetchJson(url, cacheFile);
const series = normalizeIndexRows(json?.data?.tradesTable?.rows || []);
if (series.length < 50) throw new Error(`Unexpectedly short Nasdaq Composite series: ${series.length}`);

payload.indices = {
  ...(payload.indices || {}),
  nasdaqComposite: {
    symbol: "COMP",
    name: "Nasdaq Composite",
    source: "NASDAQ index historical quote API",
    fromDate,
    toDate,
    series,
  },
};
payload.meta = {
  ...(payload.meta || {}),
  indexSeries: {
    ...(payload.meta?.indexSeries || {}),
    nasdaqComposite: {
      source: "NASDAQ index historical quote API",
      symbol: "COMP",
      fromDate,
      toDate,
      rows: series.length,
    },
  },
};

await writeJson(outputPath, payload);
console.log(`updated Nasdaq Composite index series: ${series.length} rows from ${fromDate} to ${toDate}`);
