# Sigma Sell Planner

A lightweight web app for planning weekly short put and covered call entries.

## What it calculates

- `Buying power = cash capital x leverage`
- `Deployed buying power = buying power x chosen percentage`
- `1-sigma = put ask + call ask` using the strike just above spot
- `Short put target = spot - 1-sigma`
- `Covered call target = spot + 1-sigma`
- `Short put contracts = deployed BP / (put strike x 100)`
- `Covered call contracts = deployed BP / (spot x 100 shares)`

The app stores the latest inputs in local browser storage so the setup is still there when you come back.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run lint
```

## Notes

- Strike suggestions are rounded by the increment you choose: `0.5`, `1`, `2.5`, or `5`.
- Covered call sizing is estimated from current spot price, not the call strike.
- This is a planning calculator, not broker margin advice.

## Hosting

The app is static, so the production `dist/` output can be deployed to any static host. Common free options are Vercel, Cloudflare Pages, Netlify, or GitHub Pages.
