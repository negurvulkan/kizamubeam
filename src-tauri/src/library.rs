//! Bibliothek: eigene Motive, Bilder und Designelemente (.kza, JSON mit Objekten und eingebetteten Bildern) im
//! Einstellungsordner der App. Geprüft wird in der Oberfläche (src/assetFormat.ts); hier nur Dateien lesen,
//! schreiben und löschen. Die Oberfläche nennt Dateien nur beim Namen; Pfade außerhalb des Ordners sind nicht
//! erreichbar.

use serde_json::Value;
use std::path::PathBuf;

/// Größte Datei, wie ASSET_MAX_BYTES in src/assetFormat.ts
const MAX_BYTES: u64 = 20 * 1024 * 1024;

fn dir() -> Result<PathBuf, String> {
    let d = dirs::config_dir()
        .ok_or("Kein Ordner für Einstellungen")?
        .join(crate::agent::APP_ID)
        .join("library");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn is_asset(name: &str) -> bool {
    name.to_lowercase().ends_with(".kza")
        && !name.starts_with('.')
        && !name.contains(['/', '\\', ':', '\0'])
        && name.len() <= 200
}

/// Nur einfache Dateinamen mit Endung .kza (kein Pfad, keine versteckten Dateien)
fn file_path(name: &str) -> Result<PathBuf, String> {
    if !is_asset(name) {
        return Err(format!("Ungültiger Name für einen Bibliotheks-Eintrag: {name}"));
    }
    Ok(dir()?.join(name))
}

/// Angaben eines Eintrags für die Liste: alles außer Objekten und Bilddaten (die machen die Datei groß)
fn meta(text: &str) -> Value {
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Object(mut o)) => {
            o.remove("objs");
            o.remove("images");
            Value::Object(o)
        }
        _ => Value::Null,
    }
}

/// Alle Einträge im Ordner: (Dateiname, Angaben als JSON). Zu große oder unlesbare Dateien haben „null“.
#[tauri::command]
pub async fn library_list() -> Result<Vec<(String, String)>, String> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir()?).map_err(|e| e.to_string())? {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_asset(&name) {
            continue;
        }
        let small = entry
            .metadata()
            .map(|m| m.len() <= MAX_BYTES)
            .unwrap_or(false);
        let info = if small {
            std::fs::read_to_string(entry.path())
                .map(|t| meta(&t))
                .unwrap_or(Value::Null)
        } else {
            Value::Null
        };
        out.push((name, info.to_string()));
    }
    out.sort_by_key(|(n, _)| n.to_lowercase());
    Ok(out)
}

#[tauri::command]
pub async fn library_read(file: String) -> Result<String, String> {
    std::fs::read_to_string(file_path(&file)?).map_err(|e| format!("{file}: {e}"))
}

#[tauri::command]
pub async fn library_write(file: String, contents: String) -> Result<(), String> {
    if contents.len() as u64 > MAX_BYTES {
        return Err(format!("{file}: Datei zu groß"));
    }
    std::fs::write(file_path(&file)?, contents).map_err(|e| format!("{file}: {e}"))
}

#[tauri::command]
pub async fn library_delete(file: String) -> Result<(), String> {
    std::fs::remove_file(file_path(&file)?).map_err(|e| format!("{file}: {e}"))
}

/// Ordner im Finder bzw. Explorer zeigen
#[tauri::command]
pub async fn library_open_folder() -> Result<String, String> {
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
    use super::{is_asset, meta};

    #[test]
    fn only_plain_names() {
        assert!(is_asset("Rose.kza"));
        assert!(!is_asset("../x.kza"));
        assert!(!is_asset("a/b.kza"));
        assert!(!is_asset(".x.kza"));
        assert!(!is_asset("x.kzp"));
    }

    #[test]
    fn meta_drops_content() {
        let m = meta(r#"{"name":"Rose","objs":[1],"images":{"a":"b"}}"#);
        assert_eq!(m["name"], "Rose");
        assert!(m.get("objs").is_none() && m.get("images").is_none());
        assert!(meta("kein json").is_null());
    }
}
