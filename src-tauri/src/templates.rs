//! Vorlagen-Ordner: Vorlagen (.kzt, Projektdateien mit Vorlagen-Angaben) im Einstellungsordner der App.
//! Die Oberfläche nennt Dateien nur beim Namen; Pfade außerhalb des Ordners sind nicht erreichbar.

use serde_json::Value;
use std::path::PathBuf;

fn dir() -> Result<PathBuf, String> {
    let d = dirs::config_dir()
        .ok_or("Kein Ordner für Einstellungen")?
        .join(crate::agent::APP_ID)
        .join("templates");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

/// Nur einfache Dateinamen mit Endung .kzt (kein Pfad, keine versteckten Dateien)
fn file_path(name: &str) -> Result<PathBuf, String> {
    let ok = name.to_lowercase().ends_with(".kzt")
        && !name.starts_with('.')
        && !name.contains(['/', '\\', ':', '\0'])
        && name.len() <= 200;
    if !ok {
        return Err(format!("Ungültiger Name für eine Vorlage: {name}"));
    }
    Ok(dir()?.join(name))
}

/// Alle Vorlagen im Ordner: (Dateiname, Vorlagen-Angaben als JSON). Unlesbare Dateien haben „null“.
#[tauri::command]
pub async fn template_list() -> Result<Vec<(String, String)>, String> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir()?).map_err(|e| e.to_string())? {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.to_lowercase().ends_with(".kzt") || name.starts_with('.') {
            continue;
        }
        let info = std::fs::read_to_string(entry.path())
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .map(|v| {
                v.get("template")
                    .cloned()
                    .unwrap_or(Value::Object(Default::default()))
            })
            .unwrap_or(Value::Null);
        out.push((name, info.to_string()));
    }
    out.sort_by_key(|(n, _)| n.to_lowercase());
    Ok(out)
}

#[tauri::command]
pub async fn template_read(file: String) -> Result<String, String> {
    std::fs::read_to_string(file_path(&file)?).map_err(|e| format!("{file}: {e}"))
}

#[tauri::command]
pub async fn template_write(file: String, contents: String, overwrite: bool) -> Result<(), String> {
    let p = file_path(&file)?;
    if p.exists() && !overwrite {
        return Err(format!("{file}: Vorlage gibt es schon"));
    }
    std::fs::write(&p, contents).map_err(|e| format!("{file}: {e}"))
}

#[tauri::command]
pub async fn template_delete(file: String) -> Result<(), String> {
    std::fs::remove_file(file_path(&file)?).map_err(|e| format!("{file}: {e}"))
}

/// Ordner im Finder bzw. Explorer zeigen
#[tauri::command]
pub async fn template_open_folder() -> Result<String, String> {
    let d = dir()?;
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(target_os = "windows")]
    let cmd = "explorer";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let cmd = "xdg-open";
    std::process::Command::new(cmd)
        .arg(&d)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(d.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::file_path;

    #[test]
    fn only_plain_names() {
        assert!(file_path("Schild.kzt").is_ok());
        assert!(file_path("../x.kzt").is_err());
        assert!(file_path("a/b.kzt").is_err());
        assert!(file_path(".x.kzt").is_err());
        assert!(file_path("x.kzb").is_err());
    }
}
