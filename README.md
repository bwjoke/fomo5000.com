# FOMO5000

[English](README.md) | [中文](README.zh-CN.md)

FOMO5000 is a static market map for scanning 5,000+ U.S.-listed stocks at once.

Live site: https://fomo5000.com

## What It Shows

- X axis: estimated AI relevance, based on official sector/industry data plus a company-description semantic adjustment.
- Y axis: recent market-cap change over 1W, 1M, 3M, 6M, or 12M.
- Color: official Nasdaq sector.
- Triangle angle: weekly price move at the selected timeline point.
- Timeline: weekly snapshots from 2025-01-01 through the latest data date.

## Data Notes

The checked-in market dataset is a generated snapshot from Nasdaq screener and historical quote endpoints. The current snapshot contains 5,292 usable symbols and is latest through 2026-05-26.

Market-cap changes are estimates: current screener market cap is combined with historical close-price returns, holding share count constant. AI relevance is an experimental ranking signal, not a recommendation.

This project is for visualization and learning only. It is not financial advice. Market data remains subject to the terms of the original data providers.

## Development

```sh
npm ci
npm run build
```

The build step writes Cloudflare Pages-ready static assets to `dist/` and splits `data/market-data.json` into deployable chunks under `dist/data/`.

## Deployment

Production deploys from `main` to Cloudflare Pages through GitHub Actions. Deployment credentials are stored only in GitHub environment secrets; no credentials are committed to this repository.

## License

Code is released under the MIT License. Market data is not covered by the code license and remains subject to the terms of the original data providers.
