# ReView Sync Worker (Cloudflare Worker + Durable Object)

`BOARD_ROOM` — одна DO-комната на `review-<boardId>`. Реле Yjs (sync + awareness) как в `server.mjs`, GC 5 мин без коннектов.

## Deploy

```bash
cd worker
npm i
npx wrangler login
npx wrangler deploy
# -> https://review-sync.<subdomain>.workers.dev
```

Проверить: `curl https://review-sync.<subdomain>.workers.dev/health`

## Фронт

Cloudflare Pages → Build `npm run build` с env:

```
VITE_SYNC_URL=wss://review-sync.<subdomain>.workers.dev
# optional: VITE_SYNC_PORT not needed when VITE_SYNC_URL set
```

Локально: без env фронт падает на `ws://host:1234` (dev `server.mjs`).

## Локальная отладка воркера

```bash
npx wrangler dev --local
# фронт: VITE_SYNC_URL=ws://127.0.0.1:8787 npm run dev
```
