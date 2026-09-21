//! Async generation-addressed blobs on Durable Object storage.
//! Writes `Uint8Array` chunks so existing TypeScript rooms stay readable.

use js_sys::{Reflect, Uint8Array};
use worker::wasm_bindgen::JsCast;
use worker::wasm_bindgen::JsValue;
use worker::{Result, Storage};
use yrs::merge_updates_v1;

use crate::blob::{storage_count_f64, storage_count_string, PUT_BATCH, STORAGE_CHUNK};

fn gen_base(prefix: &str, gen: u64) -> String {
    format!("{prefix}:{gen}")
}

fn bytes_from_js(value: JsValue) -> Option<Vec<u8>> {
    if value.is_undefined() || value.is_null() {
        return None;
    }
    if let Some(arr) = value.dyn_ref::<Uint8Array>() {
        return Some(arr.to_vec());
    }
    if let Ok(buf) = value.clone().dyn_into::<js_sys::ArrayBuffer>() {
        return Some(Uint8Array::new(&buf).to_vec());
    }
    if value.is_instance_of::<js_sys::Array>() {
        let arr = Uint8Array::new(&value);
        if arr.length() > 0 || js_sys::Array::is_array(&value) {
            return Some(arr.to_vec());
        }
    }
    None
}

async fn get_bytes(storage: &Storage, key: &str) -> Option<Vec<u8>> {
    storage.get::<Vec<u8>>(key).await.ok().flatten()
}

async fn count_key(storage: &Storage, key: &str) -> u64 {
    if let Ok(Some(n)) = storage.get::<f64>(key).await {
        return storage_count_f64(Some(n));
    }
    if let Ok(Some(s)) = storage.get::<String>(key).await {
        return storage_count_string(&s);
    }
    0
}

async fn read_chunked(storage: &Storage, base: &str, n: u64) -> Option<Vec<u8>> {
    let n = usize::try_from(n).ok()?;
    if n == 0 {
        return None;
    }
    let keys: Vec<String> = (0..n).map(|i| format!("{base}:{i}")).collect();
    let map = storage.get_multiple(keys).await.ok()?;
    let mut parts = Vec::with_capacity(n);
    for i in 0..n {
        let key = JsValue::from_str(&format!("{base}:{i}"));
        let value = map.get(&key);
        parts.push(bytes_from_js(value)?);
    }
    Some(crate::blob::join_chunks(&parts))
}

pub async fn read_blob(storage: &Storage, prefix: &str) -> Option<Vec<u8>> {
    let gen = count_key(storage, &format!("{prefix}:gen")).await;
    if gen > 0 {
        let n = count_key(storage, &format!("{}:n", gen_base(prefix, gen))).await;
        if n > 0 {
            return read_chunked(storage, &gen_base(prefix, gen), n).await;
        }
        return None;
    }
    let n = count_key(storage, &format!("{prefix}:n")).await;
    if n > 0 {
        return read_chunked(storage, prefix, n).await;
    }
    get_bytes(storage, prefix).await
}

pub async fn delete_blob(storage: &Storage, prefix: &str) -> Result<()> {
    let gen = count_key(storage, &format!("{prefix}:gen")).await;
    let mut keys = vec![
        prefix.to_string(),
        format!("{prefix}:n"),
        format!("{prefix}:gen"),
    ];
    if gen > 0 {
        let base = gen_base(prefix, gen);
        let n = count_key(storage, &format!("{base}:n")).await;
        keys.push(format!("{base}:n"));
        for i in 0..n.max(1) {
            keys.push(format!("{base}:{i}"));
        }
    }
    let legacy_n = count_key(storage, &format!("{prefix}:n")).await;
    for i in 0..legacy_n.max(1) {
        keys.push(format!("{prefix}:{i}"));
    }
    storage.delete_multiple(keys).await?;
    Ok(())
}

pub async fn write_blob(storage: &Storage, prefix: &str, bytes: &[u8]) -> Result<()> {
    let prev_gen = count_key(storage, &format!("{prefix}:gen")).await;
    let next_gen = prev_gen + 1;
    let base = gen_base(prefix, next_gen);
    let chunks = crate::blob::split_chunks(bytes, STORAGE_CHUNK);
    let mut off = 0;
    while off < chunks.len() {
        let end = (off + PUT_BATCH).min(chunks.len());
        let obj = js_sys::Object::new();
        for (j, chunk) in chunks[off..end].iter().enumerate() {
            let key = JsValue::from_str(&format!("{base}:{}", off + j));
            let value = Uint8Array::from(chunk.as_slice());
            Reflect::set(&obj, &key, &value)?;
        }
        if end == chunks.len() {
            Reflect::set(
                &obj,
                &JsValue::from_str(&format!("{base}:n")),
                &JsValue::from_f64(chunks.len() as f64),
            )?;
        }
        storage.put_multiple_raw(obj).await?;
        off = end;
    }
    storage
        .put(&format!("{prefix}:gen"), next_gen as f64)
        .await?;

    let mut extra = vec![prefix.to_string(), format!("{prefix}:n")];
    if prev_gen > 0 {
        let prev_base = gen_base(prefix, prev_gen);
        let prev_n = count_key(storage, &format!("{prev_base}:n")).await;
        extra.push(format!("{prev_base}:n"));
        for i in 0..prev_n.max(1) {
            extra.push(format!("{prev_base}:{i}"));
        }
    } else {
        let legacy_n = count_key(storage, &format!("{prefix}:n")).await;
        extra.push(format!("{prefix}:n"));
        for i in 0..legacy_n.max(1) {
            extra.push(format!("{prefix}:{i}"));
        }
    }
    storage.delete_multiple(extra).await?;
    Ok(())
}

pub fn merge_tails(prev: Option<&[u8]>, updates: &[Vec<u8>]) -> Option<Vec<u8>> {
    let mut parts: Vec<&[u8]> = Vec::new();
    if let Some(p) = prev {
        if !p.is_empty() {
            parts.push(p);
        }
    }
    for u in updates {
        if !u.is_empty() {
            parts.push(u.as_slice());
        }
    }
    if parts.is_empty() {
        return None;
    }
    if parts.len() == 1 {
        return Some(parts[0].to_vec());
    }
    merge_updates_v1(parts).ok()
}
