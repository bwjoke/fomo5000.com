# FOMO5000

AI Market Map for U.S. stocks.

## Build

```sh
npm run build
```

The build step writes Cloudflare Pages-ready static assets to `dist/` and splits `data/market-data.json` into deployable chunks under `dist/data/`.

## Deploy

Cloudflare Pages production builds use:

- Build command: `npm run build`
- Output directory: `dist`
- Production branch: `main`
