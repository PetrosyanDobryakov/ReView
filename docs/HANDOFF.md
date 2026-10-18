# Handoff: P2P line, Cloudflare hub, media blobs

Branch `claude/full-p2p-desktop` (0.16.0). Live hub: `wss://review-hub.amicus-vamicus.workers.dev`. Pick it up locally:

```bash
git fetch origin && git checkout claude/full-p2p-desktop && npm ci
```

## To do, in order

1. **Done.** **Cloudflare login.** `npx wrangler login` as amicus.vamicus@gmail.com (account `2f8144b0acc394459de5ca531dcfddf5`, already set in `cloudflare/wrangler.toml`). On a fresh account, open Workers & Pages in the dashboard once to claim a workers.dev subdomain.
2. **Done (0.16.0).** **Deploy the hub.** `bash scripts/deploy.sh hub`, then check `https://review-hub.<subdomain>.workers.dev/health` (expect `service: "review-hub"`). Only the amicus account is touched; the zpro Workers (`review`, `review-sync`) and their data stay as they are.
3. **Done (0.16.0).** **Test the live hub.** `CF_HUB_URL=https://review-hub.amicus-vamicus.workers.dev node scripts/cf-hub-test.mjs` and the same env with `E2E_HUB=cloudflare node scripts/p2p-e2e.mjs`.
4. **Board with a friend.**
   - Build with the hub baked in: `VITE_HUBS=wss://review-hub.<subdomain>.workers.dev npm run build`.
   - Each runs `npm run host` (or the desktop app), or publish that build as a static copy (`bash scripts/deploy.sh spa`) and both open the URL.
   - Share an invite link (it can carry `#hub=wss://...`).
5. **Strict networks.** Behind CGNAT or locked-down wifi, both peers can sit in the room without ever linking. Fix: own TURN server (coturn on a small VPS), entered under Settings, Connection, Advanced (`turn:host:3478|user|pass`).
6. **Land it.** Merge into `dev-warexpor` once happy: version bump, CHANGELOG section, push `dev-warexpor` (no PR, per AGENTS.md).

## Optional cleanup

- `review-sync` on the zpro account (the old server-side board storage) is unused by this line. Delete it only once nothing needs it.

## Known limits

- Old shared boards keep their inline images until compacted while alone on the board.
- An image shows for others only while some device that holds it is online (every member prefetches the board's media, so this mostly bites when the uploader leaves before anyone synced).
