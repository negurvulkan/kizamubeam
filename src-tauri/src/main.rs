// Kein Konsolenfenster unter Windows im Release-Build
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Brücke für MCP-Clients, die nur stdio sprechen (siehe agent.rs); öffnet kein Fenster
    if std::env::args().any(|a| a == "--mcp-stdio") {
        return laserwerk_lib::agent::stdio_bridge();
    }
    laserwerk_lib::run()
}
