#!/usr/bin/env python3
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

DATA_PATH = Path("data/market-data.json")

THEMES = [
    {
        "name": "AI 基建",
        "aiAffinity": 1.0,
        "color": "#ff5f3a",
        "text": "accelerated computing artificial intelligence infrastructure model training inference data center gpu high performance compute",
    },
    {
        "name": "半导体",
        "aiAffinity": 0.94,
        "color": "#ff8a2a",
        "text": "semiconductor processors chips integrated circuits silicon memory compute accelerators fabrication equipment",
    },
    {
        "name": "云与数据",
        "aiAffinity": 0.82,
        "color": "#ffc247",
        "text": "cloud computing data platform database analytics enterprise software infrastructure storage distributed systems",
    },
    {
        "name": "软件应用",
        "aiAffinity": 0.74,
        "color": "#ffd166",
        "text": "software applications enterprise platform productivity digital workflow developer tools subscription services",
    },
    {
        "name": "自动化机器人",
        "aiAffinity": 0.66,
        "color": "#f4a261",
        "text": "industrial automation robotics autonomous systems sensors manufacturing equipment intelligent machines",
    },
    {
        "name": "通信网络",
        "aiAffinity": 0.56,
        "color": "#5dd4ff",
        "text": "communications networking broadband wireless optical internet connectivity telecommunications infrastructure",
    },
    {
        "name": "医疗科技",
        "aiAffinity": 0.44,
        "color": "#4ecdc4",
        "text": "healthcare medical devices diagnostics biotechnology pharmaceutical research clinical laboratory therapy",
    },
    {
        "name": "能源电力",
        "aiAffinity": 0.34,
        "color": "#74d86d",
        "text": "energy electricity power utilities battery renewable generation grid oil gas industrial energy services",
    },
    {
        "name": "金融地产",
        "aiAffinity": 0.22,
        "color": "#7b8cff",
        "text": "banking insurance lending investment real estate financial services asset management payments markets",
    },
    {
        "name": "消费与其他",
        "aiAffinity": 0.12,
        "color": "#8fb3ff",
        "text": "consumer retail travel restaurants entertainment apparel food household products logistics transportation services",
    },
]

AI_REFERENCE = """
companies whose core business is artificial intelligence, machine learning, accelerated computing, model training,
inference, data center AI infrastructure, generative AI platforms, AI software, AI chips, automation, robotics,
data platforms and cloud services used to build or deploy intelligent systems
"""

STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "are",
    "its",
    "into",
    "has",
    "was",
    "were",
    "will",
    "company",
    "corporation",
    "inc",
    "incorporated",
    "common",
    "stock",
    "shares",
    "class",
    "limited",
    "holdings",
    "group",
    "plc",
    "ltd",
    "provides",
    "offers",
    "operates",
    "engages",
    "develops",
    "manufactures",
    "markets",
    "sells",
    "services",
    "products",
    "solutions",
    "business",
    "through",
    "including",
    "various",
    "worldwide",
    "united",
    "states",
}

OFFICIAL_SECTOR_NAMES = {
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
}

OFFICIAL_SECTOR_COLORS = {
    "Technology": "#ff8a2a",
    "Telecommunications": "#ffc247",
    "Industrials": "#f4a261",
    "Consumer Discretionary": "#9bd770",
    "Consumer Staples": "#74d86d",
    "Health Care": "#4ecdc4",
    "Energy": "#5dd4ff",
    "Utilities": "#79b8ff",
    "Finance": "#7b8cff",
    "Real Estate": "#9aa4ff",
    "Basic Materials": "#8fb3ff",
    "Miscellaneous": "#b6c7ff",
}

SECTOR_AI_PRIOR = {
    "technology": 0.50,
    "telecommunications": 0.36,
    "industrials": 0.24,
    "health care": 0.18,
    "energy": 0.14,
    "utilities": 0.12,
    "finance": 0.10,
    "consumer discretionary": 0.13,
    "consumer staples": 0.08,
    "basic materials": 0.10,
    "real estate": 0.06,
    "miscellaneous": 0.10,
}


def tokenize(text):
    tokens = [
        token
        for token in re.findall(r"[a-z][a-z0-9]{1,}", text.lower())
        if token not in STOPWORDS and not token.isdigit()
    ]
    bigrams = [f"{tokens[index]}_{tokens[index + 1]}" for index in range(len(tokens) - 1)]
    return tokens + bigrams


def official_ai_prior(stock):
    sector = (stock.get("sector") or "").strip().lower()
    industry = (stock.get("industry") or "").strip().lower()
    base = SECTOR_AI_PRIOR.get(sector, 0.10)

    def raise_to(value):
        nonlocal base
        base = max(base, value)

    if "semiconductor" in industry:
        raise_to(0.88)
    if "computer software" in industry:
        if "programming" in industry or "data processing" in industry:
            raise_to(0.70)
        else:
            raise_to(0.72)
    if "edp services" in industry:
        raise_to(0.64)
    if "computer communications equipment" in industry:
        raise_to(0.58)
    if "radio and television broadcasting and communications equipment" in industry:
        raise_to(0.50)
    if "telecommunications equipment" in industry:
        raise_to(0.46)
    if "electronic components" in industry:
        raise_to(0.48)
    if "electrical products" in industry:
        raise_to(0.36)
    if "computer manufacturing" in industry or "computer peripheral" in industry:
        raise_to(0.52)
    if "industrial machinery" in industry and sector == "technology":
        raise_to(0.56)
    elif "industrial machinery" in industry:
        raise_to(0.34)
    if "aerospace" in industry or "military/government/technical" in industry:
        raise_to(0.34)
    if "auto manufacturing" in industry:
        raise_to(0.32)
    if "biotechnology: laboratory analytical instruments" in industry:
        raise_to(0.38)
    if "medical/dental instruments" in industry or "medical specialities" in industry:
        raise_to(0.28)
    if "business services" in industry or "professional services" in industry or "engineering" in industry:
        raise_to(0.24)
    if "oilfield services/equipment" in industry or "power generation" in industry:
        raise_to(0.20)

    return base


def official_sector_entry(stock):
    source = stock.get("sector") or "Miscellaneous"
    name = stock.get("officialSectorName") or OFFICIAL_SECTOR_NAMES.get(source, source or "其他")
    return {"name": name, "weight": 1}


def theme_prior(stock):
    sector = (stock.get("sector") or "").lower()
    industry = (stock.get("industry") or "").lower()
    text = f"{stock.get('name') or ''} {stock.get('companyDescription') or ''}".lower()
    prior = defaultdict(float)

    def boost(name, value):
        prior[name] = max(prior[name], value)

    if "technology" in sector:
        boost("软件应用", 0.62)
        boost("云与数据", 0.58)
        boost("AI 基建", 0.35)
    if "semiconductor" in industry:
        boost("半导体", 0.96)
        boost("AI 基建", 0.74)
        boost("云与数据", 0.22)
    if "software" in industry or "programming" in industry or "data processing" in industry:
        boost("软件应用", 0.92)
        boost("云与数据", 0.72)
        boost("AI 基建", 0.42)
    if "computer manufacturing" in industry:
        boost("消费与其他", 0.58)
        boost("软件应用", 0.48)
        boost("AI 基建", 0.24)
    if "telecommunications" in sector or "communication" in industry or "network" in industry:
        boost("通信网络", 0.9)
        boost("云与数据", 0.34)
    if "industrials" in sector:
        boost("自动化机器人", 0.7)
        boost("能源电力", 0.16)
    if "machinery" in industry or "automation" in text or "robot" in text:
        boost("自动化机器人", 0.9)
    if "health care" in sector or "biotechnology" in industry or "medical" in industry:
        boost("医疗科技", 0.92)
    if "finance" in sector or "bank" in industry or "insurance" in industry or "investment" in industry:
        boost("金融地产", 0.95)
    if "real estate" in sector or "real estate" in industry:
        boost("金融地产", 0.9)
    if "energy" in sector or "utilities" in sector or "oil" in industry or "gas" in industry:
        boost("能源电力", 0.9)
    if "consumer" in sector or "retail" in industry or "restaurant" in industry:
        boost("消费与其他", 0.82)

    if "cloud" in text or "data center" in text or "database" in text:
        boost("云与数据", 0.88)
    if "artificial intelligence" in text or "generative ai" in text or re.search(r"\bai\b", text):
        boost("AI 基建", 0.86)
    if "platform" in text or "application" in text or "software" in text:
        boost("软件应用", 0.78)
    if "social" in text or "messenger" in text or "instagram" in text or "whatsapp" in text or "connection" in text:
        boost("通信网络", 0.54)

    if "finance" not in sector and "real estate" not in sector:
        prior["金融地产"] = 0.0
    if "health care" not in sector and "medical" not in industry and "biotech" not in industry:
        prior["医疗科技"] = 0.0
    if "energy" not in sector and "utilities" not in sector:
        prior["能源电力"] = 0.0

    if not any(prior[theme["name"]] > 0 for theme in THEMES):
        boost("消费与其他", 0.5)

    return np.array([prior[theme["name"]] for theme in THEMES], dtype=np.float32)


def percentile_scale(values, low=5, high=99):
    lo = float(np.percentile(values, low))
    hi = float(np.percentile(values, high))
    if hi <= lo:
        return np.zeros_like(values)
    scaled = (values - lo) / (hi - lo)
    return np.clip(scaled, 0, 1)


def cosine_matrix(a, b):
    a_norm = a / np.maximum(np.linalg.norm(a, axis=1, keepdims=True), 1e-9)
    b_norm = b / np.maximum(np.linalg.norm(b, axis=1, keepdims=True), 1e-9)
    return a_norm @ b_norm.T


payload = json.loads(DATA_PATH.read_text())
stocks = payload["stocks"]

stock_docs = []
for stock in stocks:
    description = stock.get("companyDescription") or ""
    fallback = " ".join(
        str(stock.get(key) or "")
        for key in ["name", "industry", "sector", "officialSectorName"]
    )
    stock_docs.append(f"{description} {fallback}")

reference_docs = [AI_REFERENCE] + [theme["text"] for theme in THEMES]
docs = stock_docs + reference_docs
tokenized = [tokenize(doc) for doc in docs]

df = Counter()
for tokens in tokenized:
    for token in set(tokens):
        df[token] += 1

vocab = [
    token
    for token, count in df.items()
    if 3 <= count <= max(4, int(len(docs) * 0.55))
]
vocab = sorted(vocab, key=lambda token: (-df[token], token))[:6500]
index = {token: i for i, token in enumerate(vocab)}

matrix = np.zeros((len(docs), len(vocab)), dtype=np.float32)
idf = np.array(
    [math.log((1 + len(docs)) / (1 + df[token])) + 1 for token in vocab],
    dtype=np.float32,
)

for row, tokens in enumerate(tokenized):
    counts = Counter(token for token in tokens if token in index)
    total = sum(counts.values()) or 1
    for token, count in counts.items():
        matrix[row, index[token]] = (count / total) * idf[index[token]]

k = min(48, min(matrix.shape) - 1)
rng = np.random.default_rng(42)
omega = rng.normal(size=(matrix.shape[1], k + 12)).astype(np.float32)
y = matrix @ omega
q, _ = np.linalg.qr(y)
b = q.T @ matrix
u_hat, s, _ = np.linalg.svd(b, full_matrices=False)
embedding = (q @ u_hat[:, :k]) * s[:k]

stock_embedding = embedding[: len(stocks)]
ai_vector = embedding[len(stocks) : len(stocks) + 1]

ai_raw = cosine_matrix(stock_embedding, ai_vector).reshape(-1)
ai_scaled = percentile_scale(ai_raw, 5, 99)

for stock_index, stock in enumerate(stocks):
    official_base = official_ai_prior(stock)
    semantic_adjustment = (float(ai_scaled[stock_index]) - 0.5) * 0.24
    ai_score = max(0.0, min(1.0, official_base + semantic_adjustment))

    stock["aiScore"] = round(ai_score * 100, 1)
    stock["aiScoreOfficialBase"] = round(official_base * 100, 1)
    stock["aiScoreProfileAdjustment"] = round(semantic_adjustment * 100, 1)
    stock["aiScoreProfileSemantic"] = round(float(ai_scaled[stock_index]) * 100, 1)
    stock["aiScoreMethod"] = "official_sector_industry_prior_plus_profile_lsa_adjustment"
    stock["officialSectorName"] = (
        stock.get("officialSectorName")
        or OFFICIAL_SECTOR_NAMES.get(stock.get("sector"), stock.get("sector") or "其他")
    )
    stock["sectors"] = [official_sector_entry(stock)]

payload["sectors"] = [
    {
        "source": source,
        "name": name,
        "color": OFFICIAL_SECTOR_COLORS.get(source, OFFICIAL_SECTOR_COLORS["Miscellaneous"]),
    }
    for source, name in OFFICIAL_SECTOR_NAMES.items()
]
payload["meta"]["aiScoreMethod"] = (
    "Official Nasdaq sector/industry prior plus a limited company-profile semantic adjustment "
    "(TF-IDF + randomized LSA). Sector/industry sets the baseline; profile text can move the score by about +/-12 percentage points."
)
payload["meta"]["notes"] = (
    "Market cap is current NASDAQ screener marketCap. Weekly market-cap changes are estimated from close-price returns "
    "with shares held constant. AI relevance is an official Nasdaq sector/industry prior plus company-profile semantic adjustment. "
    "Colors use official Nasdaq sector."
)
payload["meta"]["themeWeightMethod"] = "Not used for AI score or color; color uses official Nasdaq sector classification."
payload["meta"]["sectorColorMethod"] = "Official Nasdaq screener sector; each current screener row has one sector per symbol."
payload["meta"]["vocabSize"] = len(vocab)
payload["meta"]["embeddingDims"] = int(k)

DATA_PATH.write_text(json.dumps(payload, separators=(",", ":")))
print(f"semantic-scored {len(stocks)} stocks; vocab={len(vocab)} dims={k}")
