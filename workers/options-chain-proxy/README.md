# Options Chain Proxy

GitHub Pages is static hosting, so it cannot proxy API requests at runtime. This Worker is the free server-side layer that fetches the third-party options-chain endpoint and returns CORS headers for the app.

## Deploy

```sh
cd workers/options-chain-proxy
npx wrangler deploy
```

After deploy, copy the Worker URL and add it as a GitHub repository variable:

```txt
VITE_OPTIONS_CHAIN_ENDPOINT=https://your-worker-url.workers.dev/api/options-chain
```

Then rerun the GitHub Pages workflow. The app will call the Worker in production and keep using the Vite proxy locally.
