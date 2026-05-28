import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(root, "dist");
const dataDir = join(distDir, "data");
const stockChunkSize = 400;

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value));
}

await rm(distDir, { recursive: true, force: true });
await mkdir(dataDir, { recursive: true });

await Promise.all([
  copyFile(join(root, "index.html"), join(distDir, "index.html")),
  copyFile(join(root, "app.js"), join(distDir, "app.js")),
  copyFile(join(root, "styles.css"), join(distDir, "styles.css")),
]);

const payload = JSON.parse(await readFile(join(root, "data", "market-data.json"), "utf8"));
const stocks = payload.stocks || [];
const stockChunks = [];

for (let index = 0; index < stocks.length; index += stockChunkSize) {
  const chunkIndex = Math.floor(index / stockChunkSize);
  const file = `market-data-stocks-${String(chunkIndex).padStart(3, "0")}.json`;
  const chunk = { stocks: stocks.slice(index, index + stockChunkSize) };
  await writeJson(join(dataDir, file), chunk);
  stockChunks.push({
    file,
    count: chunk.stocks.length,
  });
}

await writeJson(join(dataDir, "market-data.manifest.json"), {
  meta: payload.meta || null,
  sectors: payload.sectors || [],
  timeline: payload.timeline || [],
  indices: payload.indices || null,
  stockCount: stocks.length,
  stockChunks,
});

await writeFile(
  join(distDir, "_headers"),
  [
    "/data/*",
    "  Cache-Control: public, max-age=3600",
    "/index.html",
    "  Cache-Control: public, max-age=300",
    "/*",
    "  X-Content-Type-Options: nosniff",
    "",
  ].join("\n"),
);

console.log(`Built ${distDir}`);
console.log(`Split ${stocks.length} stocks into ${stockChunks.length} chunks`);
