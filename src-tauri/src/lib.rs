use std::sync::OnceLock;
use tauri_plugin_dialog::DialogExt;

/// Systemschriften, beim ersten Zugriff geladen.
fn font_db() -> &'static fontdb::Database {
    static DB: OnceLock<fontdb::Database> = OnceLock::new();
    DB.get_or_init(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        db
    })
}

/// Namen aller installierten Schriftfamilien, alphabetisch.
#[tauri::command]
async fn list_fonts() -> Vec<String> {
    let mut names: Vec<String> = font_db()
        .faces()
        .filter_map(|f| f.families.first().map(|(name, _)| name.clone()))
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup();
    names
}

/// Schriftdatei (TTF/OTF) einer Familie im gewünschten Schnitt.
/// Schriftsammlungen (TTC) liefern wir nicht, weil die Konturbibliothek sie nicht lesen kann.
#[tauri::command]
async fn font_data(family: String, bold: bool, italic: bool) -> Result<tauri::ipc::Response, String> {
    let db = font_db();
    let families = [fontdb::Family::Name(&family)];
    let query = fontdb::Query {
        families: &families,
        weight: if bold { fontdb::Weight::BOLD } else { fontdb::Weight::NORMAL },
        style: if italic { fontdb::Style::Italic } else { fontdb::Style::Normal },
        ..Default::default()
    };
    let id = db.query(&query).ok_or_else(|| format!("Schrift „{family}“ nicht gefunden"))?;
    let data = db
        .with_face_data(id, |data, index| if index == 0 { Some(data.to_vec()) } else { None })
        .flatten()
        .ok_or_else(|| format!("Schrift „{family}“ liegt nur als Sammlung (TTC) vor"))?;
    Ok(tauri::ipc::Response::new(data))
}


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
        .invoke_handler(tauri::generate_handler![save_text_file, open_text_file, list_fonts, font_data])
        .run(tauri::generate_context!())
        .expect("Fehler beim Start der Anwendung");
}
