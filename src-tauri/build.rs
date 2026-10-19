fn main() {
    // öffentlicher Schlüssel für Updates (src/updater.rs), vom Release-Workflow gesetzt
    println!("cargo:rerun-if-env-changed=KIZAMUBEAM_UPDATER_PUBKEY");
    tauri_build::build()
}
