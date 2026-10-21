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
  (`cloudflare/wrangler.petrosyan.toml`), live at
  `https://review-hub.petrosyan-dobryakov.workers.dev` — `/health` 200
  (`service: review-hub, proto: 1`) and the full `cf-hub-test` suite passes
  against it (welcome/join/signal/gone, hibernation ping, binary refused,
  room isolation). The early TLS failure was edge propagation, resolved
  itself; no dashboard clicks were needed. Friend's hub verified healthy in
  parallel (`review-hub.amicus-…` → 200, proto 1).
- Remaining on the new account: TURN key (Cloudflare Realtime) for `/turn`
  — needs owner action in dashboard (old key cannot be copied: keys are bound
  to the account). Without it `/turn` answers 404 and strict-NAT peers fall
  back to Nostr relay — acceptable interim state.
- TURN economics (docs 2026-09-22): $0.05/GB egress, first 1000 GB/month free
  (shared SFU+TURN). Whiteboard traffic is KB/s (a lesson ≈ tens of MB), TURN
  only for pairs that can't go direct. Tutor scale fits the free tier with huge
  headroom; usage visible in dashboard. Fallback if it ever grows: own coturn
  on a VPS (~$5/mo flat).

## Incident 2026-10-19: "Cloudflare doesn't work" (0.16.6 desktop)

- Diagnostics show our CF hub signaling WORKS (state open, 2 peers on the hub).
  Both peers are linked with `path: "hub"` = Nostr relay fallback, `attempts: 0`,
  direct WebRTC never established. NAT on reporter side `ok` (srflx gathered).
- So: hub introduces fine, direct link fails, relay carries. Root cause of the
  direct failure unknown — need the other side's diagnostics (NAT kind, link
  close reasons) + symptom description.
- `turn: null` on our hub (no key yet) — TURN fallback unavailable; relay is
  the only fallback. TURN key still pending owner action (dashboard Realtime).
- `offchain.pub` Nostr error ("web of trust") is benign: 3 other relays open.
- Update: both sides' diagnostics received. Both NAT `ok` with srflx, both see
  each other, both on relay path, attempts 0. Public IPs 109.110.91.204 and
  .157 — same ISP pool. Verdict: same-ISP CGNAT hairpinning (documented 0.16.4
  case) — provider doesn't route between its own clients' public mappings, so
  direct can't establish despite good NAT checks. Fix = TURN on our hub (key
  pending); same-Wi-Fi meetup would confirm via instant host-candidate link.
- Second friend (78.30.206.27, other ISP) sent diagnostics with `room: null` —
  not on the board at all. Asked to open the invite and resend from the board.
- F1 fix (this branch): `lastDirectError` survives the relay takeover (was wiped
  by `onLinkOpen`, hence `lastError: null` in every pasted report). Now in
  `PeerInfo`, snapshot and Copy-diagnostics JSON; cleared only by a direct open.
  tsc + build green; mesh e2e needs cargo (CI/friend), live check pending.
- Handshake audit (webrtcLink.ts + mesh knock/glare/sid): no systematic bug —
  roles fixed, sid per attempt, trickle with pending queue, 20s/8s timeouts.
  All 3 pairs failing (incl. cross-ISP) with exchanged srflx points at the
  network path (UDP filtering/firewall), not the handshake. 0.16.7 ships F1 to
  confirm by data; periodic direct re-probe while relayed (F2) on hold until then.
- F1 VALIDATED 2026-10-19 (0.16.7 live reports): both sides show
  `lastDirectError: "ice failed"`, symmetric, srflx exchanged both ways.
  Handshake completes, connectivity checks die both directions = packets die
  between the peers (same-pool CGNAT hairpin). Not a code bug. Fix = TURN on
  our hub (key still pending owner); F2 re-probe won't help this pair
  (structurally blocked, not transient).
- Radmin objection answered (owner: "Radmin connects fine, same idea"). Official
  Radmin docs: "Relay/TCP is established when a direct connection cannot be
  established... most likely on your provider side" — i.e. Radmin itself falls
  back to relay through its servers, exactly like our Nostr fallback. "Works"
  ≠ "direct". Check: Radmin shows per-peer connection type (Direct vs
  Relay/TCP) — if Relay, provider confirmed. Workaround today: with Radmin up,
  our host candidates include 26.x virtual IPs → direct link through the VPN
  tunnel, no TURN needed (verify: peer path should read `lan`).
- Friend 2 joined (78.30.206.27, different ISP, NAT ok, srflx both sides) — and
  STILL relay-only to both peers. Same-ISP CGNAT can't explain this pair, so
  suspicion shifts app-side: either systematic handshake/consent failure or
  local firewall eating inbound UDP (STUN-out works, peer-in dies). Next: ship
  F1 in 0.16.7 so reports carry the real close reason, then tune by data.

- L5 VALIDATED 2026-10-19 (0.16.11 live reports): both sides show relay counters
  (batches ~20, hotBytes KBs, bulkBytes ~100 B, failures 0, queues 0) and
  `awareAgeMs` 4–7 s. Reading: relay healthy both ways, hot lane flowing, no
  backpressure; the age reflects idle peers (dedupe sends nothing when still),
  not a stall. Cursor-disappearance incident NOT reproduced in this snapshot —
  need diagnostics taken DURING the symptom + console `awareness resumed` lines.
- Cursor-lag probe (this branch): `__reviewPeers` hook + `scripts/cursor-lag-probe.mjs`
  (`RELAY_ONLY=1` forces relay path). Measured here: direct 13–100 ms/step,
  relay 117–355 ms/step, zero stale steps — the mechanism delivers; the
  "one step behind" symptom pointed at wedged liveness, not transport.
- F3 follow-up: hot lane missed the head-frame escape, so one oversize frame
  (>8 KiB — easy with uncapped drafts on 0.16.11) wedged ALL later liveness
  behind it permanently. Fixed with the same `size === 0` escape the bulk lane
  has (unreleased yet; F5's cap already makes the wedge unreachable in practice).
- F5 draft cap (this branch, 0.16.12): sender slims live previews to 96 verts
  (was: full raw array ~20/s → MBs of backlog on relay, stroke drew on long
  after pen-up). Receive side untouched (old full previews still render).
  `draft-slim-test` green, relay-e2e green.
- F4-tune + L5 telemetry (this branch, 0.16.11): draft tip feeds every frame
  (held pen zeroes velocity — no more comet tails), lead 0.25 s / 48 px cap;
  relay counters (batches, hot/bulk bytes, failures, queued lanes), per-peer
  `awareAgeMs`/`queued`, >10 s awareness gaps logged. relay-e2e green locally.
- F3 relay hot lane (this branch, 0.16.7+): liveness frames
  (awareness/cursor/draft, ping, hello, neighbors) jump ahead of bulk
  sync/media inside every relay batch (hot cap 8 KiB/tick so bulk never
  starves). Before: a 300 KB sync blocked cursors for seconds; now liveness
  rides the first tick. `relay-link-test` green (hot-first, FIFO per lane,
  requeue intact); full Node suite green except cargo-bound `p2p-test`;
  `npm run build` green. Live check: peer drafts/cursors should feel instant
  on relay paths; bulk speed unchanged by design.
- Next candidate F4: sparse-draft tip extrapolation (self-tuning by update gap,
  no link-path plumbing). Not started.
- F4 DONE (this branch): draft tip rides the cursor motion machine
  (`draftTipPoints` in Engine, `DRAFT_TIP_LEAD_SEC = 0.4`, lead capped at
  64 screen px, teleport snap, only when smoothing on). Dense links render
  byte-identical; sparse links glide between packets. tsc + build green.
- E2E milestone: Playwright Chromium installed here; `relay-e2e` passes
  locally with F3+F4 in the build (linked 731ms, stroke 2ms both ways,
  300KB photo ~1s). First live-mesh verification on this machine.

## Open blockers (carried over)

- No cargo/rustup/MSVC on this machine: `npm test` (needs review-host build),
  `test:e2e`/`test:cf`/`test:desktop`, and any Rust edit are unverifiable here.
  JS-only changes remain fully checkable (`tsc`, `npm run build`, Node tests).

## Long-term ideas (2026-10-20, deferred — Nostr relay stays the fallback)

Context: one-shot diagnostics (0.16.13, `reviewDiag()` + mesh event ring) proved
the failure mode. Cross-ISP pair (109.110.91.204 vs 46.35.249.48): direct open on
attempt 1 in ~2.5 s, no errors. Same-ISP same-pool pair (109.110.91.204 vs .157,
one city, one provider): direct dies twice (`ice failed` in ~15 s, then
`timeout`), relay takes over and carries. Handshake and signaling are clean
(peers meet even with CF hub at `peers: 0`, via Nostr); the break is same-CGNAT
hairpinning. `/turn` on our hub answers 404: no TURN key (Cloudflare Realtime
needs a card, owner has none), so `turn: null` on both sides.

- **P1 — own coturn on a cheap RU VPS (primary fix, no code).** Mir/SBP billing,
  no Visa needed. One static `turn:<ip>:3478|user|pass` line in Settings →
  Connection → Advanced on both sides (STUN lines stay; `p2pIce` replaces
  defaults, max 8 lines). TURN forwards encrypted WebRTC at network level, so
  the product rule (no server carries board data) holds. Same VPS can also host
  a review-host binary as an RU signaling hub (robustness only, does not affect
  ICE). Needs no app update.
- **P2 — Cloudflare frame relay through our Worker (backup plan, NOT decided).**
  Retarget `RelayLink` pump from Nostr events to a WS endpoint on `SignalRoom`
  (~20-60 ms vs Nostr's 117-355 ms, no flapping/base64). Blockers: it is a
  server carrying board frames, which contradicts the product rule (owner call
  required); free-tier quotas (100k req/day, DO calls) need measuring against
  real relay counters before committing to 100 people/day; days of build.
  Nostr already fills the last-resort slot for free, so this stays parked.
- **P3 — home coturn via `cloudflared` tunnel (temporary zero-cost).** Publishes
  TCP 3478 from an always-on home machine, no VPS. UDP through the tunnel is
  unverified; TCP TURN is enough for whiteboard traffic. Fiddly, interim only.
- **P4 — OpenRelay public TURN (`openrelay.metered.ca:80/443`, open creds) as a
  5-minute validation** that TURN fixes a given pair before spending on a VPS.
  Shared quota, test-only, skipped so far.
- Standing decision: keep hardening the current path (Nostr relay QoS +
  diagnostics) instead of chasing the above until P1 is done.

## Journal

- 2026-10-19: branch `dev-petrosyan-p2p` created from `claude/full-p2p-desktop`;
  backup tag pushed; this plan written. No code changes yet.
- 2026-10-20: 0.16.13 shipped (`p2p-desktop-v0.16.13`): mesh event ring,
  `reviewDiag()`, extended copy diagnostics. Cross-ISP direct and same-pool
  relay failure both confirmed by pasted JSON; see Long-term ideas above.
