use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

pub const MAX_FILE: u64 = 512 * 1024;
#[derive(Clone, Serialize)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub directory: bool,
}

pub fn resolve(root: &Path, input: &str, create: bool) -> Result<PathBuf, String> {
    let p = Path::new(input);
    if p.is_absolute()
        || p.components()
            .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_)))
    {
        return Err(
            "Use a relative workspace path without '..'. Outside-workspace access is not granted."
                .into(),
        );
    }
    let joined = root.join(p);
    // Reject symlinks in every component, including dangling symlinks and creation parents.
    let mut cur = root.to_path_buf();
    for c in p.components() {
        cur.push(c);
        if let Ok(meta) = fs::symlink_metadata(&cur) {
            if meta.file_type().is_symlink() {
                return Err("Symlinks are excluded from agent filesystem access.".into());
            }
        }
    }
    let canonical = if joined.exists() {
        joined.canonicalize().map_err(|e| e.to_string())?
    } else if create {
        let parent = joined
            .parent()
            .ok_or("Missing parent")?
            .canonicalize()
            .map_err(|_| "Parent directory must exist")?;
        parent.join(joined.file_name().ok_or("Missing filename")?)
    } else {
        return Err("File or directory no longer exists".into());
    };
    if !canonical.starts_with(root) {
        return Err("Path leaves the workspace".into());
    }
    Ok(canonical)
}
pub fn read(path: &Path) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("Expected a regular file".into());
    }
    if meta.len() > MAX_FILE {
        return Err("File exceeds 512 KiB. Use a smaller source file.".into());
    }
    let b = fs::read(path).map_err(|e| e.to_string())?;
    if b.contains(&0) {
        return Err("Binary file cannot be added to context".into());
    }
    String::from_utf8(b).map_err(|_| "File is not UTF-8 text".into())
}
pub fn list(root: &Path, path: &str) -> Result<Value, String> {
    let dir = resolve(root, path, false)?;
    if !dir.is_dir() {
        return Err("Expected a directory".into());
    }
    let mut entries = vec![];
    for item in WalkBuilder::new(&dir)
        .max_depth(Some(1))
        .hidden(false)
        .follow_links(false)
        .build()
        .skip(1)
    {
        if entries.len() >= 1000 {
            break;
        }
        let e = item.map_err(|e| e.to_string())?;
        if excluded(e.path(), root) || e.file_type().is_some_and(|t| t.is_symlink()) {
            continue;
        }
        entries.push(Entry {
            name: e.file_name().to_string_lossy().into(),
            path: e
                .path()
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .into(),
            directory: e.file_type().is_some_and(|t| t.is_dir()),
        });
    }
    entries.sort_by(|a, b| {
        b.directory
            .cmp(&a.directory)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(json!({"entries": entries}))
}
fn excluded(p: &Path, root: &Path) -> bool {
    p.strip_prefix(root).unwrap_or(p).components().any(|c| {
        matches!(
            c.as_os_str().to_str(),
            Some(
                ".git"
                    | "node_modules"
                    | "dist"
                    | "build"
                    | "target"
                    | ".toolchain"
                    | ".next"
                    | ".venv"
            )
        )
    })
}
pub fn search(root: &Path, query: &str, contents: bool) -> Result<Value, String> {
    if query.is_empty() || query.len() > 500 {
        return Err("Search query must contain 1–500 characters".into());
    }
    let mut matches = vec![];
    let mut visited = 0;
    let mut truncated = false;
    for entry in WalkBuilder::new(root)
        .hidden(false)
        .follow_links(false)
        .filter_entry({
            let root = root.to_owned();
            move |e| !excluded(e.path(), &root)
        })
        .build()
    {
        let Ok(e) = entry else { continue };
        visited += 1;
        if visited > 20000 || matches.len() >= 150 {
            truncated = true;
            break;
        }
        if !e.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let path = e
            .path()
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_string_lossy();
        if !contents {
            if path.to_lowercase().contains(&query.to_lowercase()) {
                matches.push(json!({"path":path}));
            }
        } else if let Ok(text) = read(e.path()) {
            for (n, line) in text.lines().enumerate() {
                if line.to_lowercase().contains(&query.to_lowercase()) {
                    matches.push(json!({"path":path,"line":n+1,"text":line.chars().take(500).collect::<String>()}));
                }
                if matches.len() >= 150 {
                    truncated = true;
                    break;
                }
            }
        }
    }
    Ok(json!({"matches":matches,"truncated":truncated,"visited":visited}))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PathArgs {
    pub path: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RangeArgs {
    pub path: String,
    pub start: usize,
    pub end: usize,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SearchArgs {
    pub query: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WriteArgs {
    pub path: String,
    pub content: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EditArgs {
    pub path: String,
    pub old_text: String,
    pub new_text: String,
}
#[derive(Deserialize, Clone, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CommandArgs {
    pub program: String,
    pub args: Vec<String>,
    #[serde(default = "default_timeout")]
    pub timeout_seconds: u64,
}
fn default_timeout() -> u64 {
    120
}
pub fn parse<T: serde::de::DeserializeOwned>(v: Value) -> Result<T, String> {
    serde_json::from_value(v).map_err(|e| format!("Invalid tool arguments: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temp() -> PathBuf {
        let p = std::env::temp_dir().join(format!("localforge-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&p).unwrap();
        p.canonicalize().unwrap()
    }
    #[test]
    fn boundaries() {
        let r = temp();
        fs::write(r.join("ok"), "hi").unwrap();
        assert!(resolve(&r, "ok", false).is_ok());
        assert!(resolve(&r, "../escape", true).is_err());
        assert!(resolve(&r, "/etc/passwd", false).is_err());
        assert!(resolve(&r, "new", true).is_ok());
        fs::remove_dir_all(r).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn symlinks() {
        let r = temp();
        std::os::unix::fs::symlink("/tmp", r.join("link")).unwrap();
        assert!(resolve(&r, "link/file", true).is_err());
        std::os::unix::fs::symlink("/nonexistent", r.join("dangling")).unwrap();
        assert!(resolve(&r, "dangling", true).is_err());
        fs::remove_dir_all(r).unwrap();
    }
    #[test]
    fn binary_rejected() {
        let r = temp();
        fs::write(r.join("binary"), [1, 0, 2]).unwrap();
        assert!(read(&r.join("binary")).is_err());
        fs::remove_dir_all(r).unwrap();
    }
}
