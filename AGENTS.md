# AGENTS.md

## What this is

Local-first infinite whiteboard (React 19, Vite 7, TypeScript, Yjs over WebRTC). Product intent: `PRODUCT.md`, `DESIGN.md`; hosting: `docs/DEPLOY.md`; desktop: `docs/DESKTOP.md`. Read the product docs before making product or design decisions.

## Do not break

- Board data moves only between peers over WebRTC; the hubs introduce peers and forward signaling only. Do not add server-side board storage or relay.
- Media lives as blobs by SHA-256; shapes carry references, not bytes. Do not put media bytes back into the Y.Doc.
- Preserve user boards and settings.

## Ship verification

Always verify each completed change before reporting it. Do not stop at editing files, and do not ask for permission to verify.

- The build must pass every time: `npm run build`.
- Tests are focused: run only the scripts for what changed (see Testing scope).
- If verification is blocked, report the specific blocker.

## Testing scope

- Never run the full test suite on a minor change: run only the focused scripts for what changed. The full suite runs only when the change touches shared harnesses or module boundaries, or the user asks for it.

## Stay inside the project, be careful with the machine

- No files outside the project directory. Everything you create, including test output, scratch files, logs, screenshots, fixtures and caches, lives inside the project, in a gitignored folder such as `.tmp/`. Do not write to the home directory, Desktop, Downloads, the system temp folder, or anywhere else. Do not commit scratch files.
- Treat the computer with care. Nothing destructive or risky: no deleting or moving anything outside the project, no recursive deletes on broad paths, no changing system or user settings (execution policy, registry, environment variables, PATH), no global installs, no killing processes you did not start, no touching other projects or personal files.
- If a command could harm the machine, or you are not sure what it does, do not run it. Say what you wanted to do and why.

## When you do not know what to do

1. Look at how established online whiteboards solve it (Miro, FigJam, Excalidraw, tldraw). Use them for behavior and UX ideas only. Do not copy code, assets or text; licenses differ. Many of them rely on servers, so adapt the idea to the rules in "Do not break".
2. If you are still unsure, ask the user: one short, specific question with your best guess attached. This is for product and design decisions. It does not apply to verification, which you do without asking.

## Windows development

When working on Windows, use PowerShell for builds, tests, and git. If `npm` is blocked by execution policy, call `node` / `npm.cmd` directly; do not change the execution policy itself. Commands: `npm ci`, `npm run dev`, `npm run server`, `npm test`, `npm run build`, `npm run preview`.

## Git

- Work from the current branch tip: fetch and update to tip before editing. Push only the branch you are working on.
- Do not rewrite, delete, or rename other people's branches, tags, or published versions without their explicit say-so.

## Versioning

- Semver lives in `package.json` (and matching `package-lock.json`); read it, never hard-code the number in notes.
- Bump the patch for changes that affect the shipped product (behavior, UI, fixes, shipped dependencies) and add a `CHANGELOG.md` section. Docs-only edits, comments, test-only changes and refactors with no behavior change do not bump.
- Before choosing a number, check the remote (`git ls-remote --tags origin`) and never reuse a version string already there.
- Minor/major only when the user asks.

## Communication style

- When talking to the user directly: human language always, warm and plain. No robot lists unless asked.
- Still verify like an engineer: base claims on logs and code (`file:line`), run the checks, confirm the result. Just tell it like a human. Example of the tone: "Fixed the toolbar flicker, the cause was in `src/Toolbar.tsx:88`. I ran the toolbar tests and the build, both pass."
- Never use emojis in any output: no emoji characters, unicode emoji, or emoji-like emoticons. Use plain text only in all responses, commits, comments, and docs.

## Reference

- Dev server (Vite): `:5173`. Signaling hub: `:1234`. Per-board rooms: `review-<boardId>`.
