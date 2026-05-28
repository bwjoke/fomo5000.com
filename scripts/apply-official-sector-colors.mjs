import { readFile, writeFile } from "node:fs/promises";

const path = "data/market-data.json";

const officialSectorColors = {
  Technology: "#ff8a2a",
  Telecommunications: "#ffc247",
  Industrials: "#f4a261",
  "Consumer Discretionary": "#9bd770",
  "Consumer Staples": "#74d86d",
  "Health Care": "#4ecdc4",
  Energy: "#5dd4ff",
  Utilities: "#79b8ff",
  Finance: "#7b8cff",
  "Real Estate": "#9aa4ff",
  "Basic Materials": "#8fb3ff",
  Miscellaneous: "#b6c7ff",
};

const officialSectorNames = {
  "Basic Materials": "基础材料",
  "Consumer Discretionary": "可选消费",
  "Consumer Staples": "必需消费",
  Energy: "能源",
  Finance: "金融",
  "Health Care": "医疗健康",
  Industrials: "工业",
  Miscellaneous: "其他",
  "Real Estate": "房地产",
  Technology: "科技",
  Telecommunications: "通信",
  Utilities: "公用事业",
};

const payload = JSON.parse(await readFile(path, "utf8"));

for (const stock of payload.stocks) {
  const officialName = stock.officialSectorName || officialSectorNames[stock.sector] || stock.sector || "其他";
  stock.officialSectorName = officialName;
  stock.sectors = [{ name: officialName, weight: 1 }];
}

const seen = new Set();
payload.sectors = payload.stocks
  .map((stock) => ({
    source: stock.sector || "Miscellaneous",
    name: stock.officialSectorName || "其他",
    color: officialSectorColors[stock.sector] || officialSectorColors.Miscellaneous,
  }))
  .filter((sector) => {
    if (seen.has(sector.name)) return false;
    seen.add(sector.name);
    return true;
  });

payload.meta.sectorColorMethod =
  "Official Nasdaq screener sector. RGB mixing is only applied when a stock has multiple official sector records; current Nasdaq screener rows provide one sector per symbol.";
payload.meta.themeWeightMethod = "Not used for coloring; color uses official sector/industry classification.";

await writeFile(path, JSON.stringify(payload));
console.log(`applied official sectors to ${payload.stocks.length} stocks`);
