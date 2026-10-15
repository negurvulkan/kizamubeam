use tauri_plugin_dialog::DialogExt;

/// Speichert Text über einen nativen Speichern-Dialog. Gibt den Pfad zurück oder None bei Abbruch.
#[tauri::command]
async fn save_text_file(
    app: tauri::AppHandle,
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
    contents: String,
) -> Result<Option<String>, String> {
    let exts: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
    let picked = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter(&filter_name, &exts)
        .blocking_save_file();
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

/// Öffnet eine Textdatei über einen nativen Öffnen-Dialog.
#[tauri::command]
async fn open_text_file(
    app: tauri::AppHandle,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Option<(String, String)>, String> {
    let exts: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
    let picked = app
        .dialog()
        .file()
        .add_filter(&filter_name, &exts)
        .blocking_pick_file();
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some((path.display().to_string(), text)))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_text_file, open_text_file])
        .run(tauri::generate_context!())
        .expect("Fehler beim Start der Anwendung");
}
