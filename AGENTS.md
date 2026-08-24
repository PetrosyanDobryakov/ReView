# Доска (ReView) — agent notes

Local-first infinite whiteboard built with React 19, Vite 7, TypeScript, and optional Yjs sync.

## Cursor Cloud specific instructions

### Prerequisites

- Node 20+ (the cloud snapshot ships Node 22).
- No secrets or external services are required for basic development and testing.

### Commands

| Task | Command |
| --- | --- |
| Install dependencies | `npm ci` |
| Dev server (Vite + sync) | `npm run dev` |
| Sync server only | `npm run server` |
| Run tests | `npm test` |
| Production build | `npm run build` |
| Preview production build | `npm run preview` |

The dev server starts automatically in the **dev** terminal. Vite listens on port **5173**; the Yjs websocket sync server listens on port **1234** (room `doska`).

### Testing changes

1. **Unit / integration tests:** `npm test` — store, paste, and engine checks; no browser required.
2. **Manual UI testing:** open `http://localhost:5173` in the browser. Draw, add stickies, paste images, and verify persistence after refresh (IndexedDB key `doska-v1`).
3. **Sync testing:** open a second browser tab or window on the same origin; both should share room `doska` via the websocket server.

### Gotchas

- `localhost` and `127.0.0.1` are different origins — IndexedDB will not follow you between them. Pick one and stay there.
- Sync is optional; the board works fully offline with IndexedDB persistence.
- UI defaults to Russian; English and Chinese are available in settings.
