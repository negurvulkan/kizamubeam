//! Erweiterungen: Inhaltspakete (.kzp, JSON mit Gerätevorlagen, Vorlagen und Materialien) im Einstellungsordner
//! der App. Geprüft wird in der Oberfläche (src/packs.ts); hier nur Dateien lesen, schreiben und löschen.
//! Die Oberfläche nennt Dateien nur beim Namen; Pfade außerhalb des Ordners sind nicht erreichbar.

use std::path::PathBuf;

/// Größte Paketdatei, wie PACK_MAX_BYTES in src/packs.ts
const MAX_BYTES: u64 = 20 * 1024 * 1024;

fn dir() -> Result<PathBuf, String> {
    let d = dirs::config_dir()
        .ok_or("Kein Ordner für Einstellungen")?
        .join(crate::agent::APP_ID)
        .join("packs");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn is_pack(name: &str) -> bool {
    name.to_lowercase().ends_with(".kzp")
        && !name.starts_with('.')
        && !name.contains(['/', '\\', ':', '\0'])
        && name.len() <= 200
}

/// Nur einfache Dateinamen mit Endung .kzp (kein Pfad, keine versteckten Dateien)
fn file_path(name: &str) -> Result<PathBuf, String> {
    if !is_pack(name) {
        return Err(format!("Ungültiger Name für eine Erweiterung: {name}"));
    }
    Ok(dir()?.join(name))
}

/// Alle Pakete im Ordner: (Dateiname, Inhalt). Zu große oder unlesbare Dateien haben einen leeren Inhalt.
#[tauri::command]
pub async fn pack_list() -> Result<Vec<(String, String)>, String> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir()?).map_err(|e| e.to_string())? {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_pack(&name) {
            continue;
        }
        let small = entry
            .metadata()
            .map(|m| m.len() <= MAX_BYTES)
            .unwrap_or(false);
        let text = if small {
            std::fs::read_to_string(entry.path()).unwrap_or_default()
        } else {
            String::new()
        };
        out.push((name, text));
    }
    out.sort_by_key(|(n, _)| n.to_lowercase());
    Ok(out)
}

#[tauri::command]
pub async fn pack_write(file: String, contents: String) -> Result<(), String> {
    if contents.len() as u64 > MAX_BYTES {
        return Err(format!("{file}: Datei zu groß"));
    }
    std::fs::write(file_path(&file)?, contents).map_err(|e| format!("{file}: {e}"))
}

#[tauri::command]
pub async fn pack_delete(file: String) -> Result<(), String> {
    std::fs::remove_file(file_path(&file)?).map_err(|e| format!("{file}: {e}"))
}

/// Ordner im Finder bzw. Explorer zeigen
#[tauri::command]
pub async fn pack_open_folder() -> Result<String, String> {
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
    use super::is_pack;

    #[test]
    fn only_plain_names() {
        assert!(is_pack("de.beispiel.werkstatt.kzp"));
        assert!(!is_pack("../x.kzp"));
        assert!(!is_pack("a/b.kzp"));
        assert!(!is_pack(".x.kzp"));
        assert!(!is_pack("x.kzt"));
    }
}
