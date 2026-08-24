# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary job is a local infinite whiteboard used at the desk or on a LAN. Audience is not specialized (not “design tool only” or “classroom only”). Copy and chrome must work in three locales the project will ship: Russian (incumbent), English, and Chinese.

## Product Purpose

ReView is a local-first board: draw, shape, text, stickers, images, erase; optional realtime collab via Yjs. Success is a board that stays usable offline, syncs when the local server is up, and does not feel like a generic AI dashboard.

## Positioning

Runs on the user’s machine (Vite + local websocket), persists in IndexedDB, optional same-room sync. Not a cloud whiteboard SaaS.

## Operating Context

Desktop browser first. Chrome floats over a full-bleed canvas: file island (name, undo/redo, zoom) top-left; presence stack and settings top-right; grouped toolbelt bottom-center; a style island above the belt for the live tool or the selection. Sync and persist copy live in the settings sheet, not as labeled status pills. No full-width top bar, left tool rail, or status bar. Settings is an inset sheet. Main developer owns product identity.

## Capabilities and Constraints

- Product name is **ReView** (owner decision, 2026-08-23). The on-screen name is user-editable (click it in the header); default `ReView`, stored in localStorage key `review-name`.
- Keep the island chrome above; do not return to 2015 window frames.
- Canvas engine, Yjs document, tools, and existing features stay.
- **Chrome theme and canvas theme are independent.** Separate controls; mixing them into one “skin” is wrong.
- Board background is canvas-side, not chrome-side.
- Locales to build: `ru`, `en`, `zh`. Default first launch: Russian.
- IndexedDB key `review-v1` and WS room `review` stay unless a migration is explicit.

## Brand Commitments

Name: ReView (user-renameable on screen). Incumbent UI language: Russian. Contributor must not replace identity copy with a fork brand.

## Evidence on Hand

Runnable app: `src/App.tsx`, `src/index.css`, canvas engine under `src/engine/`. Design system lives in `DESIGN.md`. GitHub name and on-screen default are ReView. No marketing site and no cloud claims.

## Product Principles

- The board is the product; chrome is a work surface, not a landing page.
- Local-first and existing tools outrank visual fashion.
- Chrome look and paper look are two choices, not one.
- Three languages are first-class, not an afterthought overlay.
- Do not restyle the current violet accent into “the brand.”
