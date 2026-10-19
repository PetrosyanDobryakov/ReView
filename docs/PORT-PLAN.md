# Port plan: our desktop line → P2P line

Base of this branch: `claude/full-p2p-desktop` @ `c682105` (0.16.5).
Our line backup: tag `backup/dev-petrosyan-desktop-2026-10-19` (+ branch
`dev-petrosyan-desktop`). Nothing here touches `claude/*`, `dev-warexpor`,
`main`, the amicus hub, or zpro prod — this branch is ours to experiment on.

## Rules of engagement

- Version line here is `0.16.x`. Never invent `1.0.x` (that line belongs elsewhere).
- No deploys (amicus or zpro) without the owner's explicit word. Read-only by default.
- Cloudflare граница (2026-10-19): мои инструменты авторизованы как zpro, доступа
  к amicus-аккаунту друга у меня нет и не будет без его токена. Живой хаб друга
  (`review-hub` на amicus) я не трогаю вообще — ни чтение метрик, ни тем более
  изменения. Если понадобится — только через друга или его явную просьбу.
  Наш zpro-прод — тоже руки прочь. Рабочая зона: только код в `dev-petrosyan-p2p`.
- Friend's `docs/HANDOFF.md` is their source of truth — re-read before touching
  shared areas (`mediaBlobs`, hub protocol, Electron packaging).
- Overlaps go through the owner/friend first; no silent rewrites of their mesh.

## Already shared — no action

- `src/core/blobs.ts`, `src/core/boardFileV2.ts`, tsconfig `allowImportingTsExtensions`
  — identical, they took ours as-is.
- `mediaBlobs` ingest + LOD read path + `pageBlobs` + migration runner — ported and
  evolved (`loadBlob` peer fetch, `prefetchBlobs`, `DesktopFileBlobStore`, phase B
  compaction drops inline bytes). Our versions are superseded; do not re-port.
- `.review` v2 export/import + Home size guard — kept and improved (peer fetch
  instead of v1 fallback).
- Desktop detection — they have their own (`src/net/p2p/desktop.ts`); our
  `src/core/desktop.ts` is redundant here.

## Patch / idea candidates (ours → theirs)

- **P1 — showcase human hierarchy (port, small, safe).** Our `desktop-showcase/`
  (`Start.bat`/`start.py`/README + `boards/` + `releases/` READMEs) vs their
  `electron/` + `release/` + `scripts/desktop.mjs`. If their tree lacks the
  `boards/` concept, port it. Verifiable without cargo.
- **P2 — transport supervisor (idea only).** Sleeps a redundant data channel when
  P2P covers all peers. Their hub carries no board data, so there is no redundant
  channel to sleep — does not map 1:1. Possible adaptation: prefer one signaling
  path when several cover the room (VITE_HUBS + Nostr). Low priority, needs their
  mesh knowledge first.
- **P3 — Node signal relay (reference only).** `sync/signalRelay.mjs` +
  `scripts/signal-server.mjs` are redundant with their Rust signal + hub, but stay
  a valid fallback for cargo-less environments. Do not wire into their dev flow
  without asking.
- **P4 — Tauri shell (documented alternative, no code).** Their direction is
  Electron; our `tauri.conf`/capabilities/`desktop.ts` stay on the backup tag.
  Coding Tauri here needs an explicit owner decision (two shells = fork).
- **P5 — DO-persisted slim docs (discussion).** Our line keeps history server-side;
  theirs accepts "media visible only while a holder is online" (their Known limits).
  If tutors hit that limit, our persist experience is the reference — but it
  contradicts their product rule (no server-side board data), so proposal-only.

## New clean account strategy (2026-10-19, owner decision)

- Owner created a fresh empty Cloudflare account ("Petrosyan Dobryakov").
- Friend's amicus infra stays the live backup; we clone the hub code (in git)
  onto the new account and develop against the clone. zpro prod untouched too.
- Key fact: the hub is stateless (signaling only, rooms vanish when empty) —
  there is NO data to migrate. "Transfer" = deploy the same worker code under
  the new account + fresh TURN secrets. Zero risk to amicus/zpro by construction.
- Blocker: my Cloudflare tools are authed as zpro only — I cannot log in as
  someone else. Deploy to the new account goes via `wrangler` CLI with an API
  token the owner pastes (used via env var, never committed to git).
- Needed from owner: (1) workers.dev subdomain claimed (open Workers & Pages
  once), (2) Account ID, (3) API token (Workers Scripts Edit), (4) later: TURN
  key (Realtime) for `/turn`.
- Deploy status 2026-10-19: `review-hub` uploaded to the new account
  (`cloudflare/wrangler.petrosyan.toml`, version `b150e9b1`), URL
  `https://review-hub.petrosyan-dobryakov.workers.dev` — edge returns TLS
  handshake failure, i.e. the workers.dev subdomain is NOT claimed yet.
  Action for owner: open Workers & Pages in the new account once, then tell me
  and I re-verify `/health` + run `cf-hub-test` against it. Friend's hub
  verified healthy in parallel (`review-hub.amicus-…` → 200, proto 1).

## Open blockers (carried over)

- No cargo/rustup/MSVC on this machine: `npm test` (needs review-host build),
  `test:e2e`/`test:cf`/`test:desktop`, and any Rust edit are unverifiable here.
  JS-only changes remain fully checkable (`tsc`, `npm run build`, Node tests).

## Journal

- 2026-10-19: branch `dev-petrosyan-p2p` created from `claude/full-p2p-desktop`;
  backup tag pushed; this plan written. No code changes yet.
