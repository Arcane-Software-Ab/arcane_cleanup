use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOptions {
    pub root: String,
    pub target: bool,
    pub node_modules: bool,
    pub dist: bool,
    pub build: bool,
    pub next: bool,
    pub output: bool,
    pub nuxt: bool,
    pub turbo: bool,
    pub vite: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactHit {
    pub path: String,
    pub kind: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub root: String,
    pub items: Vec<ArtifactHit>,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteItem {
    pub path: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteReport {
    pub removed: Vec<String>,
    pub failed: Vec<String>,
    pub freed_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CleanupProgress {
    phase: String,
    current: usize,
    total: usize,
    path: String,
    message: String,
}

fn emit_progress(app: &AppHandle, progress: CleanupProgress) {
    eprintln!(
        "[arcane-cleanup] {} ({}/{}) {}",
        progress.phase, progress.current, progress.total, progress.path
    );
    let _ = app.emit("cleanup-progress", progress);
}

fn expand_root(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Root path is empty".into());
    }
    let expanded = if trimmed == "~" {
        home_dir()?
    } else if let Some(rest) = trimmed.strip_prefix("~/") {
        home_dir()?.join(rest)
    } else {
        PathBuf::from(trimmed)
    };
    let canonical = fs::canonicalize(&expanded).map_err(|error| {
        format!("Cannot open root {}: {error}", expanded.display())
    })?;
    if !canonical.is_dir() {
        return Err(format!("Root is not a directory: {}", canonical.display()));
    }
    Ok(canonical)
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is not set".into())
}

fn kind_for(name: &str, options: &ScanOptions) -> Option<&'static str> {
    match name {
        "target" if options.target => Some("target"),
        "node_modules" if options.node_modules => Some("node_modules"),
        "dist" if options.dist => Some("dist"),
        "build" if options.build => Some("build"),
        ".next" if options.next => Some(".next"),
        ".output" if options.output => Some(".output"),
        ".nuxt" if options.nuxt => Some(".nuxt"),
        ".turbo" if options.turbo => Some(".turbo"),
        ".vite" if options.vite => Some(".vite"),
        _ => None,
    }
}

fn dir_size(path: &Path) -> u64 {
    let mut total = 0_u64;
    let mut stack = vec![path.to_path_buf()];
    while let Some(current) = stack.pop() {
        let entries = match fs::read_dir(&current) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let meta = match entry.metadata() {
                Ok(meta) => meta,
                Err(_) => continue,
            };
            if meta.is_dir() {
                stack.push(entry.path());
            } else {
                total = total.saturating_add(meta.len());
            }
        }
    }
    total
}

fn collect_hits(root: &Path, options: &ScanOptions) -> Vec<ArtifactHit> {
    let mut hits = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(current) = stack.pop() {
        let entries = match fs::read_dir(&current) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else { continue };
            if !meta.is_dir() {
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if let Some(kind) = kind_for(&name, options) {
                hits.push(ArtifactHit {
                    path: path.display().to_string(),
                    kind: kind.to_string(),
                    bytes: dir_size(&path),
                });
                continue;
            }
            if name == ".git" || name == ".svn" || name == ".hg" {
                continue;
            }
            stack.push(path);
        }
    }

    hits.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.path.cmp(&b.path)));
    hits
}

fn ensure_under_root(root: &Path, candidate: &Path) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(candidate)
        .map_err(|error| format!("Cannot resolve {}: {error}", candidate.display()))?;
    if !canonical.starts_with(root) {
        return Err(format!(
            "Refusing path outside root: {}",
            canonical.display()
        ));
    }
    Ok(canonical)
}

fn is_allowed_artifact_name(name: &str) -> bool {
    matches!(
        name,
        "target"
            | "node_modules"
            | "dist"
            | "build"
            | ".next"
            | ".output"
            | ".nuxt"
            | ".turbo"
            | ".vite"
    )
}

fn remove_tree(path: &Path) -> Result<(), String> {
    // /bin/rm is much faster than walk-based remove_dir_all on huge target dirs.
    let status = Command::new("/bin/rm")
        .arg("-rf")
        .arg(path)
        .status()
        .map_err(|error| format!("Failed to start rm: {error}"))?;
    if status.success() {
        return Ok(());
    }
    // Fallback if rm fails for any reason.
    fs::remove_dir_all(path).map_err(|error| error.to_string())
}

fn delete_inner(app: &AppHandle, root: PathBuf, items: Vec<DeleteItem>) -> DeleteReport {
    let mut removed = Vec::new();
    let mut failed = Vec::new();
    let mut freed_bytes = 0_u64;
    let total = items.len();

    for (index, item) in items.into_iter().enumerate() {
        let current = index + 1;
        emit_progress(
            app,
            CleanupProgress {
                phase: "delete".into(),
                current,
                total,
                path: item.path.clone(),
                message: format!("Deleting {current}/{total}: {}", item.path),
            },
        );

        let candidate = PathBuf::from(&item.path);
        let name = candidate
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        if !is_allowed_artifact_name(name) {
            failed.push(format!("{} (not an allowed artifact name)", item.path));
            continue;
        }
        let path = match ensure_under_root(&root, &candidate) {
            Ok(path) => path,
            Err(error) => {
                failed.push(error);
                continue;
            }
        };
        if !path.is_dir() {
            failed.push(format!("{} (not a directory)", path.display()));
            continue;
        }

        match remove_tree(&path) {
            Ok(()) => {
                freed_bytes = freed_bytes.saturating_add(item.bytes);
                removed.push(path.display().to_string());
                eprintln!("[arcane-cleanup] removed {}", path.display());
            }
            Err(error) => {
                failed.push(format!("{} ({error})", path.display()));
                eprintln!("[arcane-cleanup] failed {}: {error}", path.display());
            }
        }
    }

    emit_progress(
        app,
        CleanupProgress {
            phase: "done".into(),
            current: total,
            total,
            path: String::new(),
            message: format!(
                "Finished delete: {} removed, {} failed",
                removed.len(),
                failed.len()
            ),
        },
    );

    DeleteReport {
        removed,
        failed,
        freed_bytes,
    }
}

#[tauri::command]
pub async fn scan_cleanup_targets(options: ScanOptions) -> Result<ScanReport, String> {
    eprintln!("[arcane-cleanup] scan start: {}", options.root);
    let report = tauri::async_runtime::spawn_blocking(move || {
        let root = expand_root(&options.root)?;
        let items = collect_hits(&root, &options);
        let total_bytes = items.iter().map(|item| item.bytes).sum();
        Ok::<ScanReport, String>(ScanReport {
            root: root.display().to_string(),
            items,
            total_bytes,
        })
    })
    .await
    .map_err(|error| format!("Scan task failed: {error}"))??;
    eprintln!(
        "[arcane-cleanup] scan done: {} items, {} bytes",
        report.items.len(),
        report.total_bytes
    );
    Ok(report)
}

#[tauri::command]
pub async fn delete_cleanup_targets(
    app: AppHandle,
    root: String,
    items: Vec<DeleteItem>,
) -> Result<DeleteReport, String> {
    eprintln!(
        "[arcane-cleanup] delete start: {} paths under {root}",
        items.len()
    );
    let app_handle = app.clone();
    let report = tauri::async_runtime::spawn_blocking(move || {
        let root = expand_root(&root)?;
        Ok::<DeleteReport, String>(delete_inner(&app_handle, root, items))
    })
    .await
    .map_err(|error| format!("Delete task failed: {error}"))??;
    eprintln!(
        "[arcane-cleanup] delete done: removed={} failed={} freed={}",
        report.removed.len(),
        report.failed.len(),
        report.freed_bytes
    );
    Ok(report)
}

#[tauri::command]
pub fn default_cleanup_root() -> Result<String, String> {
    Ok(home_dir()?.join("dev/arcane").display().to_string())
}
