# FOMO5000

AI Market Map for U.S. stocks.

## Build

```sh
npm run build
```

The build step writes Cloudflare Pages-ready static assets to `dist/` and splits `data/market-data.json` into deployable chunks under `dist/data/`.

## Deploy

Production deploys are handled by GitHub Actions on every push to `main`.
The workflow is scoped for a future public repository:

- It does not run on pull requests.
- It only deploys from `bwjoke/fomo5000.com`.
- It uses GitHub's `production` environment for deployment secrets.
- It installs the lockfile-pinned Wrangler CLI with `npm ci`.
- It uses read-only GitHub token permissions.

Required GitHub `production` environment secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The workflow builds with:

- Build command: `npm run build`
- Output directory: `dist`
- Cloudflare Pages project: `fomo5000`
