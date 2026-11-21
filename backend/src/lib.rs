mod cleanup;
mod desktop;
mod updates;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("index.html?view=settings".into()))
        .title("Cleanup Settings")
        .inner_size(520.0, 600.0)
        .min_inner_size(420.0, 320.0)
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn reset_local_user_data(app: tauri::AppHandle) -> Result<(), String> {
    let store_path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("shell.json");
    if store_path.exists() {
        std::fs::remove_file(store_path).map_err(|error| error.to_string())?;
    }
    if let Some(main) = app.get_webview_window("main") {
        main.reload().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.handle().plugin(tauri_plugin_store::Builder::default().build())?;
            app.handle().plugin(tauri_plugin_dialog::init())?;
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            app.handle().plugin(tauri_plugin_process::init())?;
            desktop::setup(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cleanup::scan_cleanup_targets,
            cleanup::delete_cleanup_targets,
            cleanup::default_cleanup_root,
            updates::startup_apply_updates,
            updates::reveal_last_manual_installer,
            desktop::get_start_on_boot,
            desktop::set_start_on_boot,
            open_settings_window,
            reset_local_user_data,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Arcane Cleanup");
}
