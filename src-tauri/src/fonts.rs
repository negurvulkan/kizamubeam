//! Schriften: Systemschriften plus eigene Schriften im Einstellungsordner der App (fonts/google für Schriften
//! von Google Fonts, fonts/custom für importierte TTF/OTF-Dateien). Die Oberfläche (src/fontManager.ts) sucht
//! und zeigt; hier wird heruntergeladen, gespeichert und die Schriftdatenbank gepflegt.
//!
//! Google Fonts ohne API-Schlüssel: Die Liste kommt von fonts.google.com/metadata/fonts (ersatzweise von
//! api.fontsource.org), die Dateien über die öffentliche CSS-Schnittstelle fonts.googleapis.com/css2. Ohne
//! Browser-Kennung liefert sie vollständige TTF-Dateien, die die Konturbibliothek lesen kann.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Duration;
use tauri_plugin_dialog::DialogExt;

/// Größte Schriftdatei (einige CJK-Schriften sind sehr groß)
const MAX_FONT_BYTES: usize = 40 * 1024 * 1024;
/// Größte Schriftliste
const MAX_CATALOG_BYTES: usize = 30 * 1024 * 1024;
/// So lange gilt die gespeicherte Schriftliste ohne neues Laden
const CATALOG_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 3600);
const CATALOG_URLS: [(&str, &str); 2] = [
    ("google", "https://fonts.google.com/metadata/fonts"),
    ("fontsource", "https://api.fontsource.org/v1/fonts?type=google"),
];

/// Schriftdatenbank, beim ersten Zugriff mit System- und eigenen Schriften geladen
fn db() -> MutexGuard<'static, fontdb::Database> {
    static DB: OnceLock<Mutex<fontdb::Database>> = OnceLock::new();
    DB.get_or_init(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        if let Ok(d) = user_dir() {
            db.load_fonts_dir(d);
        }
        Mutex::new(db)
    })
    .lock()
    .unwrap_or_else(|e| e.into_inner())
}

fn app_dir() -> Result<PathBuf, String> {
    Ok(dirs::config_dir()
        .ok_or("Kein Ordner für Einstellungen")?
        .join(crate::agent::APP_ID))
}

/// Ordner der eigenen Schriften (wird angelegt)
fn user_dir() -> Result<PathBuf, String> {
    let d = app_dir()?.join("fonts");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn sub_dir(kind: &str) -> Result<PathBuf, String> {
    let d = user_dir()?.join(kind);
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

/// Familienname als Datei-/Ordnername: nur Buchstaben, Ziffern, Bindestrich und Unterstrich
fn safe_name(s: &str) -> String {
    let out: String = s
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .take(80)
        .collect();
    if out.trim_matches('_').is_empty() {
        "font".into()
    } else {
        out
    }
}

/// TrueType oder OpenType (keine Sammlung, kein WOFF): daran erkennt man eine brauchbare Datei
fn is_font_data(b: &[u8]) -> bool {
    b.len() > 12 && (b[..4] == [0, 1, 0, 0] || &b[..4] == b"OTTO" || &b[..4] == b"true")
}

/// Familienname einer Schrift (erster Eintrag, wie in list_fonts)
fn face_family(f: &fontdb::FaceInfo) -> Option<String> {
    f.families.first().map(|(n, _)| n.clone())
}

fn face_path(f: &fontdb::FaceInfo) -> Option<&Path> {
    match &f.source {
        fontdb::Source::File(p) => Some(p.as_path()),
        _ => None,
    }
}

/// Namen aller verfügbaren Schriftfamilien (System und eigene), alphabetisch.
#[tauri::command]
pub async fn list_fonts() -> Vec<String> {
    let mut names: Vec<String> = db().faces().filter_map(face_family).collect();
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup();
    names
}

/// Schriftdatei (TTF/OTF) einer Familie im gewünschten Schnitt.
/// Schriftsammlungen (TTC) liefern wir nicht, weil die Konturbibliothek sie nicht lesen kann.
#[tauri::command]
pub async fn font_data(family: String, bold: bool, italic: bool) -> Result<tauri::ipc::Response, String> {
    let db = db();
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

#[derive(Serialize)]
pub struct InstalledFont {
    family: String,
    /// "google" oder "custom"
    kind: String,
    /// Anzahl der Schnitte (Dateien)
    styles: usize,
}

/// Schriften im eigenen Ordner, je Familie und Herkunft
#[tauri::command]
pub async fn font_installed() -> Result<Vec<InstalledFont>, String> {
    let root = user_dir()?;
    let (google, custom) = (root.join("google"), root.join("custom"));
    let mut out: Vec<InstalledFont> = Vec::new();
    for f in db().faces() {
        let (Some(p), Some(family)) = (face_path(f), face_family(f)) else { continue };
        let kind = if p.starts_with(&google) {
            "google"
        } else if p.starts_with(&custom) {
            "custom"
        } else {
            continue;
        };
        match out.iter_mut().find(|x| x.family == family && x.kind == kind) {
            Some(x) => x.styles += 1,
            None => out.push(InstalledFont { family, kind: kind.into(), styles: 1 }),
        }
    }
    out.sort_by_key(|x| x.family.to_lowercase());
    Ok(out)
}

/// Neu gespeicherte Datei in die Datenbank aufnehmen; liefert die Familiennamen darin
fn load_file(path: &Path) -> Vec<String> {
    let mut db = db();
    let before: Vec<fontdb::ID> = db.faces().map(|f| f.id).collect();
    db.load_font_file(path).ok();
    db.faces()
        .filter(|f| !before.contains(&f.id))
        .filter_map(face_family)
        .collect()
}

/// Schriftliste: (Quelle, Text, Alter in Sekunden). Gespeicherte Liste, solange sie jünger als eine Woche ist
/// (oder wenn das Netz fehlt); refresh lädt neu. Die Oberfläche liest beide Formate (src/fontCatalog.ts).
#[tauri::command]
pub async fn font_catalog(refresh: bool) -> Result<(String, String, u64), String> {
    let cache = app_dir()?.join("font-catalog.txt");
    let cached = || -> Option<(String, String, u64)> {
        let age = std::fs::metadata(&cache).ok()?.modified().ok()?.elapsed().unwrap_or_default().as_secs();
        let text = std::fs::read_to_string(&cache).ok()?;
        let (source, body) = text.split_once('\n')?;
        Some((source.to_string(), body.to_string(), age))
    };
    if !refresh {
        if let Some(c) = cached().filter(|c| c.2 < CATALOG_MAX_AGE.as_secs()) {
            return Ok(c);
        }
    }
    let mut errors = Vec::new();
    for (source, url) in CATALOG_URLS {
        match get(url, MAX_CATALOG_BYTES).await {
            Ok(body) => {
                let body = String::from_utf8_lossy(&body).to_string();
                if body.contains("family") {
                    let _ = std::fs::write(&cache, format!("{source}\n{body}"));
                    return Ok((source.to_string(), body, 0));
                }
                errors.push(format!("{url}: unerwartete Antwort"));
            }
            Err(e) => errors.push(e),
        }
    }
    // Ohne Netz: lieber eine alte Liste als keine
    cached().ok_or_else(|| errors.join("; "))
}

fn client() -> Result<reqwest::Client, String> {
    static INIT: OnceLock<()> = OnceLock::new();
    INIT.get_or_init(|| {
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
    });
    // Eigene Kennung statt Browser-Kennung: Dann liefert Google TTF statt WOFF2
    reqwest::Client::builder()
        .user_agent(concat!("KizamuBeam/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())
}

/// Datei laden; Fehler bei anderem Status als 200 oder zu großer Antwort
async fn get(url: &str, max: usize) -> Result<Vec<u8>, String> {
    let res = client()?.get(url).send().await.map_err(|e| format!("{url}: {e}"))?;
    let status = res.status();
    if !status.is_success() {
        return Err(format!("{url}: HTTP {}", status.as_u16()));
    }
    if res.content_length().is_some_and(|n| n as usize > max) {
        return Err(format!("{url}: Datei zu groß"));
    }
    let body = res.bytes().await.map_err(|e| format!("{url}: {e}"))?;
    if body.len() > max {
        return Err(format!("{url}: Datei zu groß"));
    }
    Ok(body.to_vec())
}

/// Adressen der Schriftdateien aus der Antwort von fonts.googleapis.com/css2, nur von fonts.gstatic.com
fn css_font_urls(css: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = css;
    while let Some(i) = rest.find("url(") {
        rest = &rest[i + 4..];
        let Some(j) = rest.find(')') else { break };
        let u = rest[..j].trim().trim_matches(|c| c == '"' || c == '\'');
        if u.starts_with("https://fonts.gstatic.com/") && !out.iter().any(|x| x == u) {
            out.push(u.to_string());
        }
        rest = &rest[j..];
    }
    out
}

/// Abfrage für einen Schnitt, z. B. „Open+Sans:ital,wght@1,700“; ohne Schnitt der Standardschnitt
fn css_query(family: &str, variant: Option<(bool, u16)>) -> String {
    let fam: String = family
        .chars()
        .map(|c| match c {
            ' ' => "+".to_string(),
            c if c.is_ascii_alphanumeric() || c == '-' => c.to_string(),
            c => c.to_string().bytes().map(|b| format!("%{b:02X}")).collect(),
        })
        .collect();
    match variant {
        Some((italic, w)) => format!("https://fonts.googleapis.com/css2?family={fam}:ital,wght@{},{w}", italic as u8),
        None => format!("https://fonts.googleapis.com/css2?family={fam}"),
    }
}

#[derive(Serialize)]
pub struct InstallResult {
    /// Familiennamen, wie die Schriftdateien sie nennen (fast immer der gesuchte Name)
    families: Vec<String>,
    files: usize,
}

/// Familie von Google Fonts laden. variants: (kursiv, Stärke), z. B. [(false, 400), (false, 700), (true, 400)].
/// Fehlende Schnitte werden übersprungen; klappt keiner, wird der Standardschnitt geladen.
#[tauri::command]
pub async fn font_install_google(family: String, variants: Vec<(bool, u16)>) -> Result<InstallResult, String> {
    let family = family.trim().to_string();
    if family.is_empty() || family.len() > 100 || family.contains(['/', '\\', '\0', '&', '?', '#', ':', ';']) {
        return Err(format!("Ungültiger Schriftname: {family}"));
    }
    let mut queries: Vec<(String, String)> = variants
        .iter()
        .take(8)
        .map(|&(i, w)| (css_query(&family, Some((i, w.clamp(1, 1000)))), format!("{w}{}", if i { "i" } else { "" })))
        .collect();
    queries.push((css_query(&family, None), "default".into()));
    let dir = sub_dir("google")?.join(safe_name(&family));
    let mut saved: Vec<PathBuf> = Vec::new();
    let mut last_err = String::new();
    for (url, tag) in queries {
        // Standardschnitt nur, wenn keiner der gewünschten geklappt hat
        if tag == "default" && !saved.is_empty() {
            break;
        }
        let css = match get(&url, 1024 * 1024).await {
            Ok(b) => String::from_utf8_lossy(&b).to_string(),
            Err(e) => {
                last_err = e;
                continue;
            }
        };
        for (k, u) in css_font_urls(&css).into_iter().enumerate() {
            let data = get(&u, MAX_FONT_BYTES).await?;
            if !is_font_data(&data) {
                return Err(format!("{family}: keine TTF/OTF-Datei erhalten"));
            }
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let suffix = if k == 0 { String::new() } else { format!("-{k}") };
            let path = dir.join(format!("{}-{tag}{suffix}.ttf", safe_name(&family)));
            std::fs::write(&path, &data).map_err(|e| e.to_string())?;
            saved.push(path);
        }
    }
    if saved.is_empty() {
        return Err(if last_err.contains("HTTP 400") {
            format!("„{family}“ gibt es bei Google Fonts nicht")
        } else {
            format!("{family}: {last_err}")
        });
    }
    // Ältere Fassung derselben Familie ersetzen: erst entfernen, dann neu laden
    forget_paths(&saved);
    let mut families: Vec<String> = Vec::new();
    for p in &saved {
        for f in load_file(p) {
            if !families.contains(&f) {
                families.push(f);
            }
        }
    }
    Ok(InstallResult { families, files: saved.len() })
}

/// Schriften aus diesen Dateien aus der Datenbank nehmen
fn forget_paths(paths: &[PathBuf]) {
    let mut db = db();
    let ids: Vec<fontdb::ID> = db
        .faces()
        .filter(|f| face_path(f).is_some_and(|p| paths.iter().any(|x| x == p)))
        .map(|f| f.id)
        .collect();
    for id in ids {
        db.remove_face(id);
    }
}

/// Eigene TTF/OTF-Dateien über einen Öffnen-Dialog in den Schriftordner kopieren. Liefert die neuen Familien;
/// leer bei Abbruch. Unbrauchbare Dateien werden mit Namen gemeldet.
#[tauri::command]
pub async fn font_import(app: tauri::AppHandle, filter_name: String) -> Result<Vec<String>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter(&filter_name, &["ttf", "otf", "TTF", "OTF"])
        .blocking_pick_files()
        .unwrap_or_default();
    let dir = sub_dir("custom")?;
    let mut families = Vec::new();
    let mut bad = Vec::new();
    for p in picked {
        let Ok(src) = p.into_path() else { continue };
        let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let data = std::fs::read(&src).map_err(|e| format!("{name}: {e}"))?;
        if data.len() > MAX_FONT_BYTES || !is_font_data(&data) {
            bad.push(name);
            continue;
        }
        let stem = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let ext = if &data[..4] == b"OTTO" { "otf" } else { "ttf" };
        let dest = dir.join(format!("{}.{ext}", safe_name(&stem)));
        std::fs::write(&dest, &data).map_err(|e| format!("{name}: {e}"))?;
        forget_paths(std::slice::from_ref(&dest));
        let got = load_file(&dest);
        if got.is_empty() {
            let _ = std::fs::remove_file(&dest);
            bad.push(name);
        }
        for f in got {
            if !families.contains(&f) {
                families.push(f);
            }
        }
    }
    if !bad.is_empty() && families.is_empty() {
        return Err(format!("Keine lesbare TTF/OTF-Schrift: {}", bad.join(", ")));
    }
    Ok(families)
}

/// Eigene Schriftfamilie entfernen (alle Schnitte dieser Herkunft)
#[tauri::command]
pub async fn font_remove(family: String, kind: String) -> Result<(), String> {
    if kind != "google" && kind != "custom" {
        return Err(format!("Unbekannte Herkunft: {kind}"));
    }
    let base = user_dir()?.join(&kind);
    let paths: Vec<PathBuf> = db()
        .faces()
        .filter(|f| face_family(f).as_deref() == Some(family.as_str()))
        .filter_map(|f| face_path(f).map(Path::to_path_buf))
        .filter(|p| p.starts_with(&base))
        .collect();
    if paths.is_empty() {
        return Err(format!("Schrift „{family}“ nicht gefunden"));
    }
    forget_paths(&paths);
    for p in &paths {
        // Eine Datei kann weitere Familien enthalten; die bleiben dann bis zum Neustart sichtbar
        std::fs::remove_file(p).map_err(|e| e.to_string())?;
        if let Some(parent) = p.parent().filter(|d| *d != base) {
            let _ = std::fs::remove_dir(parent); // nur, wenn leer
        }
    }
    Ok(())
}

/// Schriftordner im Finder bzw. Explorer zeigen
#[tauri::command]
pub async fn font_open_folder() -> Result<String, String> {
    let d = user_dir()?;
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(target_os = "windows")]
    let cmd = "explorer";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let cmd = "xdg-open";
    std::process::Command::new(cmd).arg(&d).spawn().map_err(|e| e.to_string())?;
    Ok(d.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_from_css() {
        let css = "@font-face {\n  font-family: 'Lobster';\n  src: url(https://fonts.gstatic.com/s/lobster/v32/a.ttf) format('truetype');\n}\n\
                   @font-face { src: url('https://evil.example/x.ttf'); }\n@font-face { src: url(https://fonts.gstatic.com/s/lobster/v32/a.ttf); }";
        assert_eq!(css_font_urls(css), vec!["https://fonts.gstatic.com/s/lobster/v32/a.ttf"]);
    }

    #[test]
    fn query_encoding() {
        assert_eq!(css_query("Open Sans", Some((true, 700))), "https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@1,700");
        assert_eq!(css_query("Noto Sans JP", None), "https://fonts.googleapis.com/css2?family=Noto+Sans+JP");
        assert_eq!(css_query("Ä", None), "https://fonts.googleapis.com/css2?family=%C3%84");
    }

    #[test]
    fn names_and_magic() {
        assert_eq!(safe_name("Open Sans"), "Open_Sans");
        assert_eq!(safe_name("../"), "font");
        assert!(is_font_data(&[0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
        assert!(is_font_data(b"OTTO0000000000"));
        assert!(!is_font_data(b"wOF20000000000"));
    }
}
