# Ship verification

Always verify each completed change before reporting it: run the focused checks for what changed and confirm the build passes. Do not stop at editing files, and do not ask again for permission to verify. Preserve user boards and settings; if verification is blocked, report the specific blocker.

## Windows development

Use PowerShell for builds, tests, and git; if `npm` is blocked by execution policy, call `node` / `npm.cmd` directly. Dev server (Vite) is on `:5173`, the signaling hub on `:1234`, per-board rooms are `review-<boardId>`. Commands: `npm ci`, `npm run dev`, `npm run server`, `npm test`, `npm run build`, `npm run preview`.

## Communication style

- When talking to the user directly: human language always, warm and plain. No robot lists unless asked.
- Still verify like an engineer: base claims on logs and code (`file:line`), run the checks, confirm the result. Just tell it like a human.
- Never use emojis in any output — no emoji characters, unicode emoji, or emoji-like emoticons. Use plain text only in all responses, commits, comments, and docs.

## Testing scope

- Never run the full test suite on a minor change: run only the focused scripts for what changed. The full suite runs only when the change touches shared harnesses or module boundaries, or the user asks for it.

## Do not break

- Board data moves only between peers over WebRTC; the hubs introduce peers and forward signaling only. Do not add server-side board storage or relay.
- Media lives as blobs by SHA-256; shapes carry references, not bytes. Do not put media bytes back into the Y.Doc.

## Git

- Work from the current branch tip: fetch and update to tip before editing. Push only the branch you are working on.
- Do not rewrite, delete, or rename other people's branches, tags, or published versions without their explicit say-so.

## Versioning

- Semver lives in `package.json` (and matching `package-lock.json`); read it, never hard-code the number in notes. Product changes bump the patch and add a `CHANGELOG.md` section; never reuse a version string already on the remote. Minor/major only when the user asks.

## What this is

Local-first infinite whiteboard (React 19, Vite 7, TypeScript, Yjs over WebRTC). Product intent: `PRODUCT.md`, `DESIGN.md`; hosting: `docs/DEPLOY.md`; desktop: `docs/DESKTOP.md`.
