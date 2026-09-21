//! Rust Durable Object published as Cloudflare worker `review-sync`.
//!
//! `worker/src/*.ts` stays so the Node unit tests can import it. Wrangler
//! `main` is the wasm shim this crate builds, not `src/index.ts`.

mod blob;
mod names;
mod token;

#[cfg(target_arch = "wasm32")]
mod edge;
#[cfg(target_arch = "wasm32")]
mod room;
#[cfg(target_arch = "wasm32")]
mod storage_blob;
