const canvas = document.getElementById("marketCanvas");
const ctx = canvas.getContext("2d");
const tooltip = document.getElementById("tooltip");
const details = document.getElementById("stockDetails");
const legendEl = document.getElementById("legend");
const periodLabel = document.getElementById("periodLabel");
const countLabel = document.getElementById("countLabel");
const searchInput = document.getElementById("searchInput");
const clearSearchButton = document.getElementById("clearSearch");
const presetSearchButton = document.getElementById("presetSearch");
const presetSearchMenu = document.getElementById("presetSearchMenu");
const presetSearchItems = Array.from(document.querySelectorAll("[data-search-preset]"));
const resetButton = document.getElementById("resetView");
const periodButtons = Array.from(document.querySelectorAll("[data-period]"));
const metricButtons = Array.from(document.querySelectorAll("[data-metric]"));
const brandSubtitle = document.querySelector(".brand p");
const timelineSlider = document.getElementById("timelineSlider");
const timelineDate = document.getElementById("timelineDate");
const timelineStart = document.getElementById("timelineStart");
const timelineEnd = document.getElementById("timelineEnd");
const axisModeLabel = document.getElementById("axisModeLabel");
const nasdaqCanvas = document.getElementById("nasdaqCanvas");
const nasdaqCtx = nasdaqCanvas?.getContext("2d");
const nasdaqIndexLabel = document.getElementById("nasdaqIndexLabel");
const timelineMain = document.querySelector(".timeline-main");

const periods = ["1W", "1M", "3M", "6M", "12M"];
let currentPeriod = "12M";
let currentMetric = "pct";
let timeline = [];
let currentTimelineIndex = 0;
let stocks = [];
let visibleStocks = [];
let hoveredStock = null;
let selectedStock = null;
let query = "";
let raf = 0;
let marketMeta = null;
let sectors = [];
let nasdaqIndex = null;
let timelineDragging = false;
let positionAnimation = null;

const view = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  dragging: false,
  lastX: 0,
  lastY: 0,
};

const featuredTickers = new Set([
  "NVDA",
  "MSFT",
  "GOOGL",
  "GOOG",
  "AMZN",
  "META",
  "AVGO",
  "TSLA",
  "AMD",
  "ORCL",
  "PLTR",
  "CRM",
  "SNOW",
  "SMCI",
  "ARM",
  "TSM",
  "ASML",
  "MU",
  "AAPL",
  "INTC",
  "QCOM",
]);

const industrySearchRules = [
  { pattern: /semiconductor|electronic components/i, aliases: ["半导体", "芯片", "电子元件"] },
  { pattern: /computer software|programming data processing/i, aliases: ["软件", "数据处理", "编程"] },
  { pattern: /edp services|computer processing|information technology/i, aliases: ["数据服务", "信息服务", "IT服务"] },
  { pattern: /computer manufacturing|computer peripheral|consumer electronics/i, aliases: ["硬件", "计算机", "消费电子"] },
  { pattern: /telecommunications|communications equipment|broadcasting|pay television/i, aliases: ["通信", "通信设备", "广播电视"] },
  { pattern: /biotechnology|pharmaceutical|medicinal chemicals|diagnostic/i, aliases: ["生物科技", "制药", "医药", "诊断"] },
  { pattern: /medical|dental|nursing|health/i, aliases: ["医疗", "医疗器械", "医疗服务"] },
  { pattern: /bank|investment|finance|insurer|trust|asset management/i, aliases: ["金融", "银行", "保险", "投资"] },
  { pattern: /real estate|reit|homebuilding/i, aliases: ["房地产", "REIT", "房屋建筑"] },
  { pattern: /oil|gas|energy|power generation|electric utilities/i, aliases: ["能源", "油气", "电力", "公用事业"] },
  { pattern: /mining|steel|metal|precious metals|chemicals|minerals/i, aliases: ["材料", "矿业", "金属", "化工"] },
  { pattern: /industrial|machinery|aerospace|defense|military|construction|engineering/i, aliases: ["工业", "机械", "航空航天", "国防", "工程"] },
  { pattern: /restaurant|food|beverage|apparel|retail|stores|hotel|resort|auto dealer|recreation|toy/i, aliases: ["消费", "零售", "餐饮", "酒店", "服装", "食品"] },
  { pattern: /auto manufacturing|auto parts|motor vehicles/i, aliases: ["汽车", "整车", "汽车零部件"] },
  { pattern: /transportation|marine|air freight|trucking|courier/i, aliases: ["运输", "物流", "航运", "空运"] },
  { pattern: /advertising|business services|professional services|commercial services/i, aliases: ["商业服务", "专业服务", "广告"] },
];

function industrySearchAliases(industry) {
  const text = String(industry || "");
  const aliases = new Set();
  industrySearchRules.forEach((rule) => {
    if (rule.pattern.test(text)) rule.aliases.forEach((alias) => aliases.add(alias));
  });
  return [...aliases];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function dateMs(dateText) {
  const value = Date.parse(`${dateText}T00:00:00.000Z`);
  return Number.isFinite(value) ? value : null;
}

function valueAt(stock, timelineIndex) {
  if (!stock) return null;
  const source = currentMetric === "pct" ? stock.returnSeries : stock.growthSeries;
  const value = source?.[currentPeriod]?.[timelineIndex];
  return currentMetric === "pct" && Number.isFinite(value) ? value * 100 : value;
}

function currentValue(stock) {
  return valueAt(stock, currentTimelineIndex);
}

function currentReturnPct(stock) {
  return stock?.returnSeries?.[currentPeriod]?.[currentTimelineIndex] ?? null;
}

function currentMarketCap(stock) {
  return stock?.marketCapSeries?.[currentTimelineIndex] ?? stock?.marketCapUsd ?? null;
}

function currentClose(stock) {
  return stock?.closeSeries?.[currentTimelineIndex] ?? stock?.latestClose ?? null;
}

function currentWeeklyChangePct(stock) {
  const close = stock?.closeSeries?.[currentTimelineIndex] ?? null;
  if (!Number.isFinite(close)) return null;
  const series = stock.closeSeries || [];
  let previousClose = null;
  for (let index = currentTimelineIndex - 1; index >= 0; index -= 1) {
    if (Number.isFinite(series[index])) {
      previousClose = series[index];
      break;
    }
  }
  return Number.isFinite(previousClose) && previousClose > 0 ? (close / previousClose - 1) * 100 : null;
}

function isFiniteGrowth(stock) {
  return Number.isFinite(currentValue(stock));
}

function hasFiniteSeriesValue(stock) {
  const source = currentMetric === "pct" ? stock.returnSeries : stock.growthSeries;
  const series = source?.[currentPeriod] || [];
  return series.some((value) => Number.isFinite(value));
}

function colorForSector(name) {
  return sectors.find((sector) => sector.name === name)?.color || "#ffffff";
}

function parseHexColor(hex) {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function blendedStockColor(stock) {
  const rgb = stock.sectors.reduce(
    (mix, sector) => {
      const color = parseHexColor(colorForSector(sector.name));
      const weight = sector.weight || 0;
      mix.r += color.r * weight;
      mix.g += color.g * weight;
      mix.b += color.b * weight;
      mix.total += weight;
      return mix;
    },
    { r: 0, g: 0, b: 0, total: 0 },
  );
  const total = rgb.total || 1;
  return `rgb(${Math.round(rgb.r / total)}, ${Math.round(rgb.g / total)}, ${Math.round(rgb.b / total)})`;
}

function buildSectors(items, suppliedSectors = []) {
  const colors = new Map(suppliedSectors.map((sector) => [sector.name, sector.color]));
  const counts = new Map();
  items.forEach((stock) => {
    stock.sectors.forEach((sector) => counts.set(sector.name, (counts.get(sector.name) || 0) + 1));
  });
  sectors = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => ({
      name,
      color: colors.get(name) || "#9aa4ff",
    }));
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return "N/A";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  return `${sign}$${abs.toFixed(0)}`;
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return "N/A";
  return `$${value.toFixed(value >= 100 ? 2 : 3)}`;
}

function formatPct(value) {
  if (!Number.isFinite(value)) return "N/A";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatReturnPct(value) {
  return Number.isFinite(value) ? formatPct(value * 100) : "N/A";
}

function formatAiBasis(stock) {
  const base = Number.isFinite(stock.aiScoreOfficialBase) ? `${stock.aiScoreOfficialBase.toFixed(1)}%` : "N/A";
  const adjustment = Number.isFinite(stock.aiScoreProfileAdjustment)
    ? `${stock.aiScoreProfileAdjustment >= 0 ? "+" : ""}${stock.aiScoreProfileAdjustment.toFixed(1)}`
    : "N/A";
  return `官方 ${base} / 简介 ${adjustment}`;
}

function symlog(value) {
  const constant = currentMetric === "pct" ? 2 : 5e8;
  return Math.sign(value) * Math.log1p(Math.abs(value) / constant);
}

function inverseSymlog(value) {
  const constant = currentMetric === "pct" ? 2 : 5e8;
  return Math.sign(value) * (Math.expm1(Math.abs(value)) * constant);
}

function getBounds() {
  let rawMin = Infinity;
  let rawMax = -Infinity;
  let count = 0;
  stocks.forEach((stock) => {
    if (!hasFiniteSeriesValue(stock)) return;
    const source = currentMetric === "pct" ? stock.returnSeries : stock.growthSeries;
    const series = source?.[currentPeriod] || [];
    series.forEach((rawValue) => {
      const value = currentMetric === "pct" && Number.isFinite(rawValue) ? rawValue * 100 : rawValue;
      if (!Number.isFinite(value)) return;
      const scaled = symlog(value);
      if (!Number.isFinite(scaled)) return;
      rawMin = Math.min(rawMin, scaled);
      rawMax = Math.max(rawMax, scaled);
      count += 1;
    });
  });
  if (!count) return { min: -1, max: 1 };
  const maxAbs = Math.max(Math.abs(rawMin), Math.abs(rawMax), 1);
  return { min: -maxAbs * 1.08, max: maxAbs * 1.08 };
}

function chartArea() {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  return {
    left: 72,
    right: width - 34,
    top: 34,
    bottom: height - 58,
    width: width - 106,
    height: height - 92,
  };
}

function projectAt(stock, bounds, timelineIndex) {
  const area = chartArea();
  const xRatio = stock.aiScore / 100;
  const value = valueAt(stock, timelineIndex);
  const yValue = symlog(value);
  const yRatio = (yValue - bounds.min) / (bounds.max - bounds.min);
  const baseX = area.left + xRatio * area.width;
  const baseY = area.bottom - yRatio * area.height;
  return {
    x: area.left + (baseX - area.left) * view.scale + view.offsetX,
    y: area.top + (baseY - area.top) * view.scale + view.offsetY,
  };
}

function project(stock, bounds) {
  return projectAt(stock, bounds, currentTimelineIndex);
}

function triangleSize(stock) {
  const capScore = Math.log10(currentMarketCap(stock) / 1e9 + 1);
  const prominence = featuredTickers.has(stock.ticker) ? 1.18 : 1;
  return clamp((2.3 + Math.sqrt(capScore) * 2.25) * prominence, 2.8, 12);
}

function triangleAngle(stock) {
  const pct = clamp(currentWeeklyChangePct(stock), -16, 16);
  const maxTilt = Math.PI * 0.42;
  return Math.PI / 2 - (pct / 16) * maxTilt;
}

function trianglePath(x, y, size, angle) {
  const tip = { x: 0, y: -size * 1.22 };
  const left = { x: -size * 0.78, y: size * 0.88 };
  const right = { x: size * 0.78, y: size * 0.88 };
  const rotate = (point) => {
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    return {
      x: x + point.x * cos - point.y * sin,
      y: y + point.x * sin + point.y * cos,
    };
  };
  return [rotate(tip), rotate(left), rotate(right)];
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function lerp(start, end, progress) {
  return start + (end - start) * progress;
}

function projectedVisibleStocks(bounds, timelineIndex) {
  return visibleStocks
    .filter((stock) => Number.isFinite(valueAt(stock, timelineIndex)))
    .map((stock) => [stock, projectAt(stock, bounds, timelineIndex)]);
}

function currentAnimatedPoint(stock, fallback) {
  if (!positionAnimation) return fallback;
  const from = positionAnimation.from.get(stock.id);
  const to = positionAnimation.to.get(stock.id);
  if (!from || !to) return fallback;
  const progress = clamp((performance.now() - positionAnimation.startedAt) / positionAnimation.duration, 0, 1);
  const easing = easeOutCubic(progress);
  return {
    x: lerp(from.x, to.x, easing),
    y: lerp(from.y, to.y, easing),
  };
}

function startPositionAnimation(previousIndex, nextIndex, bounds) {
  const from = new Map();
  const to = new Map();

  projectedVisibleStocks(bounds, previousIndex).forEach(([stock, point]) => {
    const animatedPoint = currentAnimatedPoint(stock, point);
    from.set(stock.id, {
      x: Number.isFinite(stock.screenX) ? animatedPoint.x : point.x,
      y: Number.isFinite(stock.screenY) ? animatedPoint.y : point.y,
    });
  });

  projectedVisibleStocks(bounds, nextIndex).forEach(([stock, point]) => {
    if (!from.has(stock.id)) from.set(stock.id, point);
    to.set(stock.id, point);
  });

  positionAnimation = {
    from,
    to,
    startedAt: performance.now(),
    duration: timelineDragging ? 300 : 520,
  };
}

function cancelPositionAnimation() {
  positionAnimation = null;
}

function drawTriangle(stock, point, isHover, isMatch) {
  const size = triangleSize(stock) * (isHover ? 1.45 : isMatch && query ? 1.9 : isMatch ? 1.25 : 1);
  const angle = triangleAngle(stock);
  const points = trianglePath(point.x, point.y, size, angle);
  const minX = Math.min(points[0].x, points[1].x, points[2].x);
  const maxX = Math.max(points[0].x, points[1].x, points[2].x);
  const minY = Math.min(points[0].y, points[1].y, points[2].y);
  const maxY = Math.max(points[0].y, points[1].y, points[2].y);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  ctx.lineTo(points[1].x, points[1].y);
  ctx.lineTo(points[2].x, points[2].y);
  ctx.closePath();
  ctx.clip();

  ctx.fillStyle = blendedStockColor(stock);
  ctx.globalAlpha = isHover ? 0.98 : isMatch || !query ? 0.82 : 0.055;
  ctx.fillRect(minX - 1, minY - 1, Math.max(1, maxX - minX) + 2, maxY - minY + 2);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  ctx.lineTo(points[1].x, points[1].y);
  ctx.lineTo(points[2].x, points[2].y);
  ctx.closePath();
  const strength = clamp(Math.abs(currentWeeklyChangePct(stock)) / 16, 0, 1);
  ctx.lineWidth = isHover || isMatch ? 1.8 + strength * 1.4 : 0.65 + strength * 1.25;
  ctx.strokeStyle = blendedStockColor(stock);
  ctx.globalAlpha = isHover ? 1 : isMatch || !query ? 0.9 : 0.08;
  ctx.stroke();
  if (isMatch && query) {
    ctx.lineWidth = 4.2;
    ctx.strokeStyle = "rgba(255,207,90,0.82)";
    ctx.globalAlpha = 0.9;
    ctx.stroke();
  }
  ctx.restore();
}

function drawLabels(points, matches) {
  const labelStocks = points
    .filter((stock) =>
      query ? matches.has(stock.id) : featuredTickers.has(stock.ticker),
    )
    .sort((a, b) => currentMarketCap(b) - currentMarketCap(a))
    .slice(0, query ? 24 : view.scale > 1.4 ? 18 : 10);

  ctx.save();
  ctx.font = "600 11px Inter, sans-serif";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  labelStocks.forEach((stock) => {
    const area = chartArea();
    const rawX = stock.screenX + triangleSize(stock) + 4;
    const x = clamp(rawX, area.left + 4, area.right - 44);
    const y = clamp(stock.screenY - triangleSize(stock) * 0.8, area.top + 12, area.bottom - 12);
    ctx.strokeStyle = "rgba(11,12,12,0.9)";
    ctx.fillStyle = "rgba(243,240,232,0.88)";
    ctx.strokeText(stock.ticker, x, y);
    ctx.fillText(stock.ticker, x, y);
  });
  ctx.restore();
}

function clearCanvas() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "#0b0c0c";
  ctx.fillRect(0, 0, rect.width, rect.height);
}

function drawStatus(message) {
  resizeCanvas();
  clearCanvas();
  const rect = canvas.getBoundingClientRect();
  ctx.save();
  ctx.fillStyle = "rgba(243,240,232,0.74)";
  ctx.font = "15px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(message, rect.width / 2, rect.height / 2);
  ctx.restore();
}

function drawGrid(bounds) {
  const area = chartArea();
  const inPlotX = (x) => x >= area.left && x <= area.right;
  const inPlotY = (y) => y >= area.top && y <= area.bottom;
  ctx.save();
  ctx.font = "12px Inter, sans-serif";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.fillStyle = "rgba(243,240,232,0.64)";
  ctx.lineWidth = 1;

  for (let ai = 0; ai <= 100; ai += 20) {
    const x = area.left + ((ai / 100) * area.width) * view.scale + view.offsetX;
    if (!inPlotX(x)) continue;
    ctx.beginPath();
    ctx.moveTo(x, area.top);
    ctx.lineTo(x, area.bottom);
    ctx.stroke();
    ctx.fillText(String(ai), x - 6, area.bottom + 24);
  }

  const ticks = [-0.8, -0.4, 0, 0.4, 0.8];
  ticks.forEach((ratio) => {
    const sy = ratio * Math.max(Math.abs(bounds.min), Math.abs(bounds.max));
    const baseY = area.bottom - ((sy - bounds.min) / (bounds.max - bounds.min)) * area.height;
    const y = area.top + (baseY - area.top) * view.scale + view.offsetY;
    if (!inPlotY(y)) return;
    ctx.beginPath();
    ctx.moveTo(area.left, y);
    ctx.lineTo(area.right, y);
    ctx.strokeStyle = ratio === 0 ? "rgba(255,207,90,0.44)" : "rgba(255,255,255,0.08)";
    ctx.stroke();
    ctx.fillStyle = ratio === 0 ? "rgba(255,207,90,0.9)" : "rgba(243,240,232,0.64)";
    const tickValue = inverseSymlog(sy);
    ctx.fillText(currentMetric === "pct" ? formatPct(tickValue) : formatUsd(tickValue), 12, y);
  });

  ctx.strokeStyle = "rgba(255,255,255,0.34)";
  ctx.beginPath();
  ctx.moveTo(area.left, area.top);
  ctx.lineTo(area.left, area.bottom);
  ctx.lineTo(area.right, area.bottom);
  ctx.stroke();

  ctx.fillStyle = "rgba(243,240,232,0.78)";
  ctx.textAlign = "center";
  ctx.fillText("AI 相关度", area.left + area.width / 2, area.bottom + 44);

  ctx.save();
  ctx.translate(18, area.top + area.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(`${timeline[currentTimelineIndex] || ""} · ${currentPeriod} ${currentMetric === "pct" ? "市值涨跌幅 %" : "市值 USD 增幅"}`, 0, 0);
  ctx.restore();

  ctx.restore();
}

function stockMatches(stock) {
  if (!query) return true;
  if (String(stock.ticker || "").toLowerCase() === query) return true;
  const chineseSearchable = [
    stock.officialSectorName,
    ...industrySearchAliases(stock.industry),
    ...stock.sectors.map((sector) => sector.name),
  ].join(" ");
  return chineseSearchable.toLowerCase().includes(query);
}

function updateClearSearchButton() {
  if (clearSearchButton) clearSearchButton.hidden = !searchInput.value;
}

function closePresetMenu() {
  if (!presetSearchMenu || !presetSearchButton) return;
  presetSearchMenu.hidden = true;
  presetSearchButton.setAttribute("aria-expanded", "false");
}

function togglePresetMenu() {
  if (!presetSearchMenu || !presetSearchButton) return;
  const willOpen = presetSearchMenu.hidden;
  presetSearchMenu.hidden = !willOpen;
  presetSearchButton.setAttribute("aria-expanded", String(willOpen));
}

function applySearchValue(value, shouldFocus = false) {
  cancelPositionAnimation();
  searchInput.value = value;
  query = value.trim().toLowerCase();
  hoveredStock = null;
  hideTooltip();
  updateClearSearchButton();
  updateDetails(query ? stocks.find(stockMatches) || null : null);
  scheduleDraw();
  if (shouldFocus) searchInput.focus();
}

function drawScene() {
  raf = 0;
  resizeCanvas();
  clearCanvas();

  visibleStocks = stocks.filter((stock) => hasFiniteSeriesValue(stock) && stockMatches(stock));
  const bounds = getBounds();
  drawGrid(bounds);

  const area = chartArea();
  const padded = {
    left: area.left - 24,
    right: area.right + 24,
    top: area.top - 24,
    bottom: area.bottom + 24,
  };

  const points = [];
  const matches = new Set(visibleStocks.map((stock) => stock.id));
  const hasQuery = Boolean(query);
  let animationProgress = 1;
  let easing = 1;
  if (positionAnimation) {
    animationProgress = clamp((performance.now() - positionAnimation.startedAt) / positionAnimation.duration, 0, 1);
    easing = easeOutCubic(animationProgress);
  }

  stocks.forEach((stock) => {
    if (!isFiniteGrowth(stock)) return;
    let point = project(stock, bounds);
    if (positionAnimation) {
      const from = positionAnimation.from.get(stock.id);
      const to = positionAnimation.to.get(stock.id);
      if (from && to) {
        point = {
          x: lerp(from.x, to.x, easing),
          y: lerp(from.y, to.y, easing),
        };
      }
    }
    stock.screenX = point.x;
    stock.screenY = point.y;
    stock.screenSize = triangleSize(stock);
    if (point.x < padded.left || point.x > padded.right || point.y < padded.top || point.y > padded.bottom) {
      return;
    }
    points.push(stock);
  });

  points
    .filter((stock) => !hasQuery || !matches.has(stock.id))
    .sort((a, b) => currentMarketCap(a) - currentMarketCap(b))
    .forEach((stock) => drawTriangle(stock, { x: stock.screenX, y: stock.screenY }, false, false));

  points
    .filter((stock) => hasQuery && matches.has(stock.id))
    .sort((a, b) => currentMarketCap(a) - currentMarketCap(b))
    .forEach((stock) => drawTriangle(stock, { x: stock.screenX, y: stock.screenY }, false, true));

  drawLabels(points, matches);

  if (hoveredStock) {
    drawTriangle(
      hoveredStock,
      { x: hoveredStock.screenX, y: hoveredStock.screenY },
      true,
      matches.has(hoveredStock.id),
    );
  }

  countLabel.textContent = `${visibleStocks.length.toLocaleString()} / ${stocks.length.toLocaleString()} symbols`;

  if (positionAnimation && animationProgress < 1) {
    scheduleDraw();
  } else if (positionAnimation) {
    positionAnimation = null;
  }
}

function scheduleDraw() {
  if (!raf) raf = requestAnimationFrame(drawScene);
}

function resizeCanvasToDisplay(targetCanvas, targetCtx) {
  if (!targetCanvas || !targetCtx) return null;
  const rect = targetCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (targetCanvas.width !== width || targetCanvas.height !== height) {
    targetCanvas.width = width;
    targetCanvas.height = height;
  }
  targetCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return rect;
}

function resizeCanvas() {
  resizeCanvasToDisplay(canvas, ctx);
}

function timelineDateRatio(dateText, fromMs, toMs) {
  const value = dateMs(dateText);
  if (!Number.isFinite(value) || toMs <= fromMs) return 0;
  return clamp((value - fromMs) / (toMs - fromMs), 0, 1);
}

function updateTimelineAlignment() {
  if (!timelineMain || !nasdaqIndex?.series?.length || !timeline.length) return;
  const fromMs = dateMs(nasdaqIndex.fromDate || nasdaqIndex.series[0].date);
  const toMs = dateMs(nasdaqIndex.toDate || nasdaqIndex.series[nasdaqIndex.series.length - 1].date);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return;
  const startRatio = timelineDateRatio(timeline[0], fromMs, toMs);
  const endRatio = timelineDateRatio(timeline[timeline.length - 1], fromMs, toMs);
  timelineMain.style.setProperty("--timeline-left", `${(startRatio * 100).toFixed(3)}%`);
  timelineMain.style.setProperty("--timeline-width", `${(Math.max(0.08, endRatio - startRatio) * 100).toFixed(3)}%`);
}

function drawNasdaqIndex() {
  if (!nasdaqCanvas || !nasdaqCtx || !nasdaqIndex?.series?.length) return;
  const rect = resizeCanvasToDisplay(nasdaqCanvas, nasdaqCtx);
  if (!rect) return;
  const width = rect.width;
  const height = rect.height;
  nasdaqCtx.clearRect(0, 0, width, height);

  const series = nasdaqIndex.series.filter((point) => Number.isFinite(point.close) && dateMs(point.date));
  if (series.length < 2) return;
  const fromMs = dateMs(nasdaqIndex.fromDate || series[0].date);
  const toMs = dateMs(nasdaqIndex.toDate || series[series.length - 1].date);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return;

  const closes = series.map((point) => point.close);
  const minClose = Math.min(...closes);
  const maxClose = Math.max(...closes);
  const span = Math.max(1, maxClose - minClose);
  const padTop = 10;
  const padBottom = 8;
  const yForClose = (close) => height - padBottom - ((close - minClose) / span) * (height - padTop - padBottom);
  const xForDate = (dateText) => timelineDateRatio(dateText, fromMs, toMs) * width;
  const timelineStartX = xForDate(timeline[0] || series[0].date);
  const currentX = xForDate(timeline[currentTimelineIndex] || series[series.length - 1].date);

  nasdaqCtx.save();
  nasdaqCtx.fillStyle = "rgba(255,255,255,0.025)";
  nasdaqCtx.fillRect(timelineStartX, 0, Math.max(0, width - timelineStartX), height);

  nasdaqCtx.strokeStyle = "rgba(255,255,255,0.10)";
  nasdaqCtx.lineWidth = 1;
  nasdaqCtx.beginPath();
  nasdaqCtx.moveTo(0, height - padBottom);
  nasdaqCtx.lineTo(width, height - padBottom);
  nasdaqCtx.stroke();

  nasdaqCtx.beginPath();
  series.forEach((point, index) => {
    const x = xForDate(point.date);
    const y = yForClose(point.close);
    if (index === 0) nasdaqCtx.moveTo(x, y);
    else nasdaqCtx.lineTo(x, y);
  });
  nasdaqCtx.strokeStyle = "rgba(255,207,90,0.82)";
  nasdaqCtx.lineWidth = 1.7;
  nasdaqCtx.stroke();

  nasdaqCtx.lineWidth = 1;
  nasdaqCtx.setLineDash([4, 4]);
  nasdaqCtx.strokeStyle = "rgba(243,240,232,0.30)";
  nasdaqCtx.beginPath();
  nasdaqCtx.moveTo(timelineStartX, 0);
  nasdaqCtx.lineTo(timelineStartX, height);
  nasdaqCtx.stroke();

  nasdaqCtx.setLineDash([]);
  nasdaqCtx.strokeStyle = "rgba(255,207,90,0.78)";
  nasdaqCtx.beginPath();
  nasdaqCtx.moveTo(currentX, 0);
  nasdaqCtx.lineTo(currentX, height);
  nasdaqCtx.stroke();
  nasdaqCtx.restore();

  if (nasdaqIndexLabel) {
    nasdaqIndexLabel.textContent = `${nasdaqIndex.name || "NASDAQ Composite"} · ${nasdaqIndex.fromDate || series[0].date} → ${nasdaqIndex.toDate || series[series.length - 1].date}`;
  }
}

function nearestStock(mouseX, mouseY) {
  let best = null;
  let bestDist = Infinity;
  const area = chartArea();
  if (mouseX < area.left || mouseX > area.right || mouseY < area.top || mouseY > area.bottom) return null;
  stocks.forEach((stock) => {
    if (query && !stockMatches(stock)) return;
    const dx = stock.screenX - mouseX;
    const dy = stock.screenY - mouseY;
    const dist = dx * dx + dy * dy;
    const radius = Math.max(11, stock.screenSize + 6);
    if (dist < radius * radius && dist < bestDist) {
      best = stock;
      bestDist = dist;
    }
  });
  return best;
}

function sectorMixHtml(stock) {
  return stock.sectors
    .map(
      (sector) => `
        <div class="mix-row">
          <span class="swatch" style="background:${colorForSector(sector.name)}"></span>
          <span>${sector.name}</span>
          <span>${Math.round(sector.weight * 100)}%</span>
        </div>
      `,
    )
    .join("");
}

function updateDetails(stock) {
  selectedStock = stock;
  if (!stock) {
    details.className = "stock-details empty";
    details.innerHTML = "<p>把鼠标移到任意三角形上，查看 ticker、公司名、官方行业、AI 基准、简介微调、市值增幅和当周涨跌。</p>";
    return;
  }
  const growth = stock.growthSeries?.[currentPeriod]?.[currentTimelineIndex];
  const returnPct = currentReturnPct(stock);
  const weeklyChange = currentWeeklyChangePct(stock);
  details.className = "stock-details";
  details.innerHTML = `
    <div class="stock-card">
      <div class="stock-head">
        <div>
          <strong>${stock.ticker}</strong>
          <span>${stock.name}</span>
        </div>
        <span class="pill">${stock.exchange}</span>
      </div>
      <div class="detail-grid">
        <div><span class="label">AI 相关度</span><strong>${stock.aiScore.toFixed(1)}%</strong></div>
        <div><span class="label">AI 计算</span><strong>${formatAiBasis(stock)}</strong></div>
        <div><span class="label">当周市值</span><strong>${formatUsd(currentMarketCap(stock))}</strong></div>
        <div><span class="label">${currentPeriod} 市值增幅</span><strong class="${growth >= 0 ? "positive" : "negative"}">${formatUsd(growth)}</strong></div>
        <div><span class="label">${currentPeriod} 市值涨跌幅</span><strong class="${returnPct >= 0 ? "positive" : "negative"}">${formatReturnPct(returnPct)}</strong></div>
        <div><span class="label">当周涨跌</span><strong class="${weeklyChange >= 0 ? "positive" : "negative"}">${formatPct(weeklyChange)}</strong></div>
        <div><span class="label">行业</span><strong>${stock.industry || stock.sector || "N/A"}</strong></div>
        <div><span class="label">当周收盘</span><strong>${formatPrice(currentClose(stock))}</strong></div>
      </div>
      <div class="sector-mix">${sectorMixHtml(stock)}</div>
    </div>
  `;
}

function showTooltip(stock, x, y) {
  const growth = stock.growthSeries?.[currentPeriod]?.[currentTimelineIndex];
  const returnPct = currentReturnPct(stock);
  const weeklyChange = currentWeeklyChangePct(stock);
  tooltip.hidden = false;
  tooltip.innerHTML = `
    <strong>${stock.ticker} <span class="muted">${stock.name}</span></strong>
    <dl>
      <dt>AI 相关度</dt><dd>${stock.aiScore.toFixed(1)}%</dd>
      <dt>AI 计算</dt><dd>${formatAiBasis(stock)}</dd>
      <dt>${currentPeriod} 增幅</dt><dd class="${growth >= 0 ? "positive" : "negative"}">${formatUsd(growth)}</dd>
      <dt>${currentPeriod} 涨跌幅</dt><dd class="${returnPct >= 0 ? "positive" : "negative"}">${formatReturnPct(returnPct)}</dd>
      <dt>当周涨跌</dt><dd class="${weeklyChange >= 0 ? "positive" : "negative"}">${formatPct(weeklyChange)}</dd>
      <dt>当周市值</dt><dd>${formatUsd(currentMarketCap(stock))}</dd>
      <dt>行业</dt><dd>${stock.industry || stock.sector || stock.sectors.map((sector) => sector.name).join(" / ")}</dd>
      <dt>周度日期</dt><dd>${timeline[currentTimelineIndex] || "N/A"}</dd>
    </dl>
  `;
  const rect = canvas.getBoundingClientRect();
  const tipRect = tooltip.getBoundingClientRect();
  let left = x + 16;
  let top = y + 16;
  if (left + tipRect.width > rect.width) left = x - tipRect.width - 16;
  if (top + tipRect.height > rect.height) top = y - tipRect.height - 16;
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${Math.max(8, top)}px`;
}

function hideTooltip() {
  tooltip.hidden = true;
}

function renderLegend() {
  const stats = new Map(sectors.map((sector) => [sector.name, { count: 0, aiTotal: 0, marketCapTotal: 0 }]));
  stocks.forEach((stock) => {
    const primary = stock.sectors.reduce((best, sector) => (sector.weight > best.weight ? sector : best), stock.sectors[0]);
    const stat = stats.get(primary.name) || { count: 0, aiTotal: 0, marketCapTotal: 0 };
    stat.count += 1;
    stat.aiTotal += Number.isFinite(stock.aiScore) ? stock.aiScore : 0;
    stat.marketCapTotal += Number.isFinite(currentMarketCap(stock)) ? currentMarketCap(stock) : 0;
    stats.set(primary.name, stat);
  });
  legendEl.innerHTML = sectors
    .map((sector) => {
      const stat = stats.get(sector.name) || { count: 0, aiTotal: 0, marketCapTotal: 0 };
      const averageAi = stat.count ? stat.aiTotal / stat.count : 0;
      return { ...sector, count: stat.count, averageAi, marketCapTotal: stat.marketCapTotal };
    })
    .sort((a, b) => b.averageAi - a.averageAi || b.count - a.count || a.name.localeCompare(b.name))
    .map(
      (sector) => `
        <div class="legend-item">
          <span class="swatch" style="background:${sector.color}"></span>
          <span>${sector.name}</span>
          <strong>${sector.count.toLocaleString()} / ${formatUsd(sector.marketCapTotal)}</strong>
        </div>
      `,
    )
    .join("");
}

function setPeriod(period) {
  cancelPositionAnimation();
  currentPeriod = period;
  periodLabel.textContent = period;
  periodButtons.forEach((button) => button.classList.toggle("active", button.dataset.period === period));
  if (selectedStock) updateDetails(selectedStock);
  scheduleDraw();
}

function setMetric(metric) {
  cancelPositionAnimation();
  currentMetric = metric;
  metricButtons.forEach((button) => button.classList.toggle("active", button.dataset.metric === metric));
  if (axisModeLabel) axisModeLabel.textContent = metric === "pct" ? "市值涨跌幅 %" : "市值 USD 增幅";
  if (selectedStock) updateDetails(selectedStock);
  scheduleDraw();
}

function setTimelineIndex(index) {
  const nextIndex = Math.round(clamp(index, 0, Math.max(0, timeline.length - 1)));
  const previousIndex = currentTimelineIndex;
  if (stocks.length && nextIndex !== previousIndex) {
    visibleStocks = stocks.filter((stock) => hasFiniteSeriesValue(stock) && stockMatches(stock));
    const bounds = getBounds();
    startPositionAnimation(previousIndex, nextIndex, bounds);
  }
  currentTimelineIndex = nextIndex;
  if (timelineSlider) timelineSlider.value = String(currentTimelineIndex);
  if (timelineDate) timelineDate.textContent = timeline[currentTimelineIndex] || "--";
  if (brandSubtitle && stocks.length) {
    brandSubtitle.textContent = `${stocks.length.toLocaleString()} 只真实股票 · 周度 ${timeline[currentTimelineIndex] || "--"}`;
  }
  drawNasdaqIndex();
  renderLegend();
  if (selectedStock) updateDetails(selectedStock);
  scheduleDraw();
}

function updateTimelineControls() {
  if (!timelineSlider) return;
  timelineSlider.min = "0";
  timelineSlider.max = String(Math.max(0, timeline.length - 1));
  timelineSlider.step = "1";
  timelineSlider.value = String(currentTimelineIndex);
  if (timelineStart) timelineStart.textContent = timeline[0] || "--";
  if (timelineEnd) timelineEnd.textContent = timeline[timeline.length - 1] || "--";
  if (timelineDate) timelineDate.textContent = timeline[currentTimelineIndex] || "--";
  updateTimelineAlignment();
  drawNasdaqIndex();
}

function setTimelineFromPointer(event) {
  if (!timelineSlider || !timeline.length) return;
  const rect = timelineSlider.getBoundingClientRect();
  const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const index = Math.round(ratio * (timeline.length - 1));
  setTimelineIndex(index);
}

function resetView() {
  cancelPositionAnimation();
  view.scale = 1;
  view.offsetX = 0;
  view.offsetY = 0;
  scheduleDraw();
}

canvas.addEventListener("mousemove", (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  if (view.dragging) {
    cancelPositionAnimation();
    view.offsetX += x - view.lastX;
    view.offsetY += y - view.lastY;
    view.lastX = x;
    view.lastY = y;
    scheduleDraw();
    return;
  }

  const next = nearestStock(x, y);
  if (next !== hoveredStock) {
    hoveredStock = next;
    updateDetails(next);
    scheduleDraw();
  }
  if (next) showTooltip(next, x, y);
  else hideTooltip();
});

canvas.addEventListener("mouseleave", () => {
  view.dragging = false;
  canvas.classList.remove("dragging");
  hoveredStock = null;
  hideTooltip();
  scheduleDraw();
});

canvas.addEventListener("mousedown", (event) => {
  cancelPositionAnimation();
  const rect = canvas.getBoundingClientRect();
  view.dragging = true;
  view.lastX = event.clientX - rect.left;
  view.lastY = event.clientY - rect.top;
  canvas.classList.add("dragging");
});

window.addEventListener("mouseup", () => {
  view.dragging = false;
  canvas.classList.remove("dragging");
});

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    cancelPositionAnimation();
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const previous = view.scale;
    const next = clamp(previous * (event.deltaY > 0 ? 0.9 : 1.1), 0.72, 5.5);
    view.offsetX = x - (x - view.offsetX) * (next / previous);
    view.offsetY = y - (y - view.offsetY) * (next / previous);
    view.scale = next;
    scheduleDraw();
  },
  { passive: false },
);

periodButtons.forEach((button) => {
  button.addEventListener("click", () => setPeriod(button.dataset.period));
});

metricButtons.forEach((button) => {
  button.addEventListener("click", () => setMetric(button.dataset.metric));
});

timelineSlider?.addEventListener("input", (event) => {
  setTimelineIndex(Number(event.target.value));
});

timelineSlider?.addEventListener("pointerdown", (event) => {
  timelineDragging = true;
  timelineSlider.setPointerCapture?.(event.pointerId);
  setTimelineFromPointer(event);
});

timelineSlider?.addEventListener("pointermove", (event) => {
  if (timelineDragging) setTimelineFromPointer(event);
});

window.addEventListener("pointerup", () => {
  timelineDragging = false;
});

searchInput.addEventListener("input", (event) => {
  applySearchValue(event.target.value);
});

clearSearchButton?.addEventListener("click", () => {
  applySearchValue("", true);
  closePresetMenu();
});

presetSearchButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  togglePresetMenu();
});

presetSearchItems.forEach((button) => {
  button.addEventListener("click", () => {
    applySearchValue(button.dataset.searchPreset || "", true);
    closePresetMenu();
  });
});

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element) || !event.target.closest(".search-control")) closePresetMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePresetMenu();
});

resetButton.addEventListener("click", resetView);
window.addEventListener("resize", () => {
  scheduleDraw();
  drawNasdaqIndex();
});

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load ${path}: ${response.status}`);
  return response.json();
}

async function loadMarketPayload() {
  try {
    const manifest = await fetchJson("./data/market-data.manifest.json");
    const stockChunks = await Promise.all(
      (manifest.stockChunks || []).map((chunk) => fetchJson(`./data/${chunk.file}`)),
    );
    return {
      meta: manifest.meta || null,
      sectors: manifest.sectors || [],
      timeline: manifest.timeline || [],
      indices: manifest.indices || null,
      stocks: stockChunks.flatMap((chunk) => chunk.stocks || []),
    };
  } catch (error) {
    console.info("Chunked market data unavailable, falling back to data/market-data.json", error);
    return fetchJson("./data/market-data.json");
  }
}

async function loadMarketData() {
  countLabel.textContent = "加载真实数据...";
  drawStatus("加载真实市场数据...");
  const payload = await loadMarketPayload();
  marketMeta = payload.meta || null;
  nasdaqIndex = payload.indices?.nasdaqComposite || null;
  timeline = payload.timeline || [];
  currentTimelineIndex = Math.max(0, timeline.length - 1);
  stocks = (payload.stocks || []).filter((stock) => {
    return (
      stock.ticker &&
      stock.name &&
      Number.isFinite(stock.aiScore) &&
      Number.isFinite(stock.marketCapUsd) &&
      stock.growthSeries &&
      stock.returnSeries &&
      periods.every((period) => Array.isArray(stock.growthSeries[period]) && Array.isArray(stock.returnSeries[period])) &&
      Array.isArray(stock.sectors) &&
      stock.sectors.length
    );
  });
  buildSectors(stocks, payload.sectors || []);
  updateTimelineControls();
  setMetric(currentMetric);
  const latestDate = timeline[currentTimelineIndex] || stocks.reduce((latest, stock) => (stock.latestDate > latest ? stock.latestDate : latest), "");
  if (brandSubtitle) {
    brandSubtitle.textContent = `${stocks.length.toLocaleString()} 只真实股票 · 周度 ${latestDate}`;
  }
  renderLegend();
  updateClearSearchButton();
  if (searchInput.value.trim()) {
    applySearchValue(searchInput.value);
  } else {
    updateDetails(null);
    drawScene();
  }
}

loadMarketData().catch((error) => {
  console.error(error);
  const message = error?.message || String(error);
  countLabel.textContent = `真实数据加载失败：${message}`;
  drawStatus(`真实数据加载失败：${message}`);
});
