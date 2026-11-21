use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterProgressPayload {
    pub phase: String,
    pub downloaded: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupUpdateResult {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saved_installer_path: Option<String>,
}

static LAST_MANUAL_INSTALLER_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

fn clear_last_manual_installer() {
    if let Ok(mut guard) = LAST_MANUAL_INSTALLER_PATH.lock() {
        *guard = None;
    }
}

fn set_last_manual_installer(path: PathBuf) {
    if let Ok(mut guard) = LAST_MANUAL_INSTALLER_PATH.lock() {
        *guard = Some(path);
    }
}

fn emit_progress(app: &AppHandle, payload: UpdaterProgressPayload) {
    let _ = app.emit("updater-progress", payload);
}

fn filename_from_update(update: &tauri_plugin_updater::Update) -> String {
    let last = update
        .download_url
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .unwrap_or("");
    let safe: String = last
        .replace('%', "_")
        .chars()
        .map(|char| match char {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if c.is_control() => '-',
            c => c,
        })
        .collect();
    let trimmed = safe.trim_matches('.').trim();
    if trimmed.is_empty() {
        format!("arcane-cleanup-{}.update", update.version)
    } else {
        trimmed.to_string()
    }
}

fn unique_file_path(dir: &Path, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("arcane-cleanup-update");
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    for index in 2_u32..10_000 {
        let next = dir.join(format!("{stem}-{index}{ext}"));
        if !next.exists() {
            return next;
        }
    }
    dir.join(format!("{stem}-{}{ext}", std::process::id()))
}

fn reveal_path_in_folder(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err("Saved installer file is missing.".into());
    }

    #[cfg(target_os = "macos")]
    {
        let value = path.to_str().ok_or("Path is not valid UTF-8")?;
        std::process::Command::new("open")
            .args(["-R", value])
            .status()
            .map_err(|error| error.to_string())?;
    }

    #[cfg(windows)]
    {
        let absolute = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
        let value = absolute.to_str().ok_or("Path is not valid UTF-8")?;
        std::process::Command::new("explorer")
            .arg(format!("/select,{value}"))
            .spawn()
            .map_err(|error| error.to_string())?;
    }

    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let parent = path.parent().ok_or("No parent directory")?;
        let value = parent.to_str().ok_or("Path is not valid UTF-8")?;
        std::process::Command::new("xdg-open")
            .arg(value)
            .spawn()
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn try_save_manual_installer(
    app: &AppHandle,
    update: &tauri_plugin_updater::Update,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    let dir = app.path().download_dir().map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let dest = unique_file_path(&dir, &filename_from_update(update));
    std::fs::write(&dest, bytes).map_err(|error| error.to_string())?;
    Ok(dest)
}

#[tauri::command]
pub fn reveal_last_manual_installer() -> Result<(), String> {
    let path = LAST_MANUAL_INSTALLER_PATH
        .lock()
        .map_err(|error| error.to_string())?
        .clone()
        .ok_or_else(|| "No saved installer from this session.".to_string())?;
    reveal_path_in_folder(&path)
}

/// Checks GitHub Releases for a newer build, downloads and installs it when available.
#[tauri::command]
pub async fn startup_apply_updates(app: AppHandle) -> Result<StartupUpdateResult, String> {
    clear_last_manual_installer();

    emit_progress(
        &app,
        UpdaterProgressPayload {
            phase: "checking".into(),
            downloaded: 0,
            total: None,
            version: None,
        },
    );

    let updater = match app.updater_builder().build() {
        Ok(updater) => updater,
        Err(error) => {
            return Ok(StartupUpdateResult {
                status: "failed".into(),
                message: Some(error.to_string()),
                saved_installer_path: None,
            });
        }
    };

    let update = match updater.check().await {
        Ok(update) => update,
        Err(error) => {
            return Ok(StartupUpdateResult {
                status: "failed".into(),
                message: Some(error.to_string()),
                saved_installer_path: None,
            });
        }
    };

    let Some(update) = update else {
        return Ok(StartupUpdateResult {
            status: "up_to_date".into(),
            message: None,
            saved_installer_path: None,
        });
    };

    let pending_version = update.version.clone();
    let downloaded = std::sync::Arc::new(std::sync::Mutex::new(0u64));
    let app_chunk = app.clone();
    let app_finish = app.clone();
    let downloaded_chunk = downloaded.clone();
    let version_chunk = pending_version.clone();
    let version_finish = pending_version.clone();

    let bytes = match update
        .download(
            move |chunk_len, total| {
                let mut guard = match downloaded_chunk.lock() {
                    Ok(guard) => guard,
                    Err(poisoned) => poisoned.into_inner(),
                };
                *guard += chunk_len as u64;
                emit_progress(
                    &app_chunk,
                    UpdaterProgressPayload {
                        phase: "downloading".into(),
                        downloaded: *guard,
                        total,
                        version: Some(version_chunk.clone()),
                    },
                );
            },
            move || {
                let total = match downloaded.lock() {
                    Ok(guard) => *guard,
                    Err(poisoned) => *poisoned.into_inner(),
                };
                emit_progress(
                    &app_finish,
                    UpdaterProgressPayload {
                        phase: "installing".into(),
                        downloaded: total,
                        total: None,
                        version: Some(version_finish.clone()),
                    },
                );
            },
        )
        .await
    {
        Ok(bytes) => bytes,
        Err(error) => {
            return Ok(StartupUpdateResult {
                status: "failed".into(),
                message: Some(error.to_string()),
                saved_installer_path: None,
            });
        }
    };

    if let Err(install_error) = update.install(&bytes) {
        let install_message = install_error.to_string();
        match try_save_manual_installer(&app, &update, &bytes) {
            Ok(path) => {
                set_last_manual_installer(path.clone());
                let _ = reveal_path_in_folder(&path);
                return Ok(StartupUpdateResult {
                    status: "failed_manual".into(),
                    message: Some(format!(
                        "Automatic install failed ({install_message}). A copy was saved to Downloads — install it manually, then restart."
                    )),
                    saved_installer_path: Some(path.to_string_lossy().into_owned()),
                });
            }
            Err(save_error) => {
                return Ok(StartupUpdateResult {
                    status: "failed".into(),
                    message: Some(format!(
                        "{install_message} (Could not save a manual copy: {save_error})"
                    )),
                    saved_installer_path: None,
                });
            }
        }
    }

    Ok(StartupUpdateResult {
        status: "installed".into(),
        message: Some(pending_version),
        saved_installer_path: None,
    })
}
