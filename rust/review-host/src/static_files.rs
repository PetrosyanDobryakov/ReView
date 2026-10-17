//! Serving the built web UI. The binary reads `dist/` from disk; the desktop
//! app plugs in its embedded assets through the same trait.

use std::borrow::Cow;
use std::path::{Component, Path, PathBuf};

pub struct Asset {
    pub bytes: Cow<'static, [u8]>,
    pub mime: String,
}

pub trait StaticSource: Send + Sync + 'static {
    /// `path` is the URL path without the leading slash, already decoded and
    /// free of `..` segments. Empty means the index.
    fn get(&self, path: &str) -> Option<Asset>;
}

/// SPA lookup: the exact file, else `index.html` for extension-less routes
/// such as `board/abc` so client-side routing works on reload.
pub fn resolve(source: &dyn StaticSource, url_path: &str) -> Option<Asset> {
    let path = sanitize(url_path)?;
    if path.is_empty() {
        return source.get("index.html");
    }
    if let Some(a) = source.get(&path) {
        return Some(a);
    }
    let last = path.rsplit('/').next().unwrap_or("");
    if last.contains('.') {
        return None;
    }
    source.get("index.html")
}

/// Strip the leading slash and query, refuse traversal.
pub fn sanitize(url_path: &str) -> Option<String> {
    let path = url_path.split(['?', '#']).next().unwrap_or("");
    let path = path.trim_start_matches('/');
    let mut parts = Vec::new();
    for seg in path.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." || seg.contains('\\') || seg.contains('\0') {
            return None;
        }
        parts.push(seg);
    }
    Some(parts.join("/"))
}

pub fn mime_for(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "webmanifest" => "application/manifest+json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        "txt" => "text/plain; charset=utf-8",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

pub struct DirSource {
    root: PathBuf,
}

impl DirSource {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }
}

impl StaticSource for DirSource {
    fn get(&self, path: &str) -> Option<Asset> {
        let rel = Path::new(path);
        if rel
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
        {
            return None;
        }
        let full = self.root.join(rel);
        if !full.is_file() {
            return None;
        }
        let bytes = std::fs::read(&full).ok()?;
        Some(Asset {
            bytes: Cow::Owned(bytes),
            mime: mime_for(path).to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    struct Mem(HashMap<&'static str, &'static [u8]>);
    impl StaticSource for Mem {
        fn get(&self, path: &str) -> Option<Asset> {
            self.0.get(path).map(|b| Asset {
                bytes: Cow::Borrowed(*b),
                mime: mime_for(path).to_string(),
            })
        }
    }

    #[test]
    fn spa_fallback_and_traversal() {
        let mem = Mem(HashMap::from([
            ("index.html", b"<html>" as &[u8]),
            ("assets/app.js", b"js" as &[u8]),
        ]));
        assert_eq!(&*resolve(&mem, "/").unwrap().bytes, b"<html>");
        assert_eq!(&*resolve(&mem, "/board/abc").unwrap().bytes, b"<html>");
        assert_eq!(&*resolve(&mem, "/assets/app.js?v=1").unwrap().bytes, b"js");
        assert!(resolve(&mem, "/assets/missing.js").is_none());
        assert!(resolve(&mem, "/../etc/passwd").is_none());
        assert_eq!(sanitize("//a/./b/"), Some("a/b".into()));
        assert!(mime_for("x.JS").starts_with("text/javascript"));
    }
}
