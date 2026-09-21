# ReView Sync Worker (Cloudflare Worker + Durable Object)

`BOARD_ROOM` — одна DO-комната на `review-<boardId>`. Реле Yjs (sync + awareness) как в `server.mjs`. Пустые комнаты GC через **90 с**.

Документ пишется чанками (`doc:n` + `doc:0…`): SQLite `put()` не больше 2 МиБ на ключ, фото-доски иначе молча терялись. Хвост апдейтов (`tail`) пишется на каждое сообщение (безопасно при hibernation); полный encode — не чаще раза в секунду.

## Deploy

```bash
cd worker
npm i
npx wrangler login
npx wrangler deploy
# -> https://review-sync.<subdomain>.workers.dev
```

Проверить: `curl https://review-sync.<subdomain>.workers.dev/health`

`DELETE /room/<name>`:

- Комната с сокетами: нужен `wrangler secret put REVIEW_COMPACT_TOKEN` (или `REVIEW_ROOM_DELETE_TOKEN`) и тот же токен в `X-Review-Compact-Token` / Bearer.
- Пустая комната (0 сокетов): без токена, чтобы compact после detach реально стёр DO. Тот же итог, что GC через 90 с.

## Фронт

Cloudflare Pages → Build `npm run build` с env:

```
VITE_SYNC_URL=wss://review-sync.<subdomain>.workers.dev
# optional: VITE_SYNC_PORT not needed when VITE_SYNC_URL set
```

Локально: без env фронт падает на `ws://host:1234` (Rust `review-sync`, `npm run server`). Worker-режим того же бинаря: `REVIEW_SYNC_MODE=worker`.

## Локальная отладка воркера

```bash
npx wrangler dev --local
# фронт: VITE_SYNC_URL=ws://127.0.0.1:8787 npm run dev
```
