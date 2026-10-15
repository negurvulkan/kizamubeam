# Laserwerk (Arbeitstitel)

Freie Laser-Software mit der Bedienung von LightBurn als Vorbild. Erster Prototyp: Oberfläche und Objekterstellung.
Stack: Tauri 2, TypeScript (Oberfläche und Editor), Rust (Desktop-Hülle, später Maschinenanbindung). Lizenzvorschlag: GPL-3.0-or-later.

## Starten

Voraussetzungen: Node.js 20+, Rust (stable), unter Linux zusätzlich `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `build-essential`, `libssl-dev`
(siehe https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev      # Desktop-App mit Live-Neuladen
npm run dev            # nur die Oberfläche im Browser: http://localhost:1420
npm run tauri build    # Installationspaket
```

## Was der Prototyp kann

- LightBurn-Layout: Menü, Symbolleiste, Zahlenleiste oben, Werkzeuge links, Schnitte/Layer und Laser rechts, Farbpalette 00–29 plus T1/T2 unten, Statusleiste.
- Arbeitsfläche als Maschinenbett in mm (Standard 400 × 400, im Laser-Panel änderbar), Raster, Lineale, Ursprung unten links, Zoom mit Mausrad, Verschieben mit Leertaste oder mittlerer Maustaste.
- Zeichnen: Linien und Bézierkurven, Rechteck mit Eckenradius, Ellipse, Polygon und Stern, Text (mehrzeilig, Schriftart, Höhe, Fett, Kursiv, Großbuchstaben, Zeichen- und Zeilenabstand, Ausrichtung).
- Bearbeiten: Auswahl per Klick und Rahmen (nach rechts umschließend, nach links kreuzend), Verschieben, Skalieren, Drehen (zweiter Klick auf die Auswahl), Zahlenfelder mit 9-Punkt-Anker und Formeln mit Einheiten („100/3“, „2in“), Knotenbearbeitung (D, I, C, S), In Pfad umwandeln, Gruppieren, Spiegeln, Ausrichten, Verteilen, Kopieren, Duplizieren, Rückgängig.
- Farbe ist der Layer: Klick auf eine Palettenfarbe ordnet die Auswahl zu. Layer-Tabelle mit Modus (Linie/Füllen), Speed, Leistung, Ausgabe, Sichtbarkeit und Schnellbearbeitung.
- Projekt speichern und öffnen (`.lwk`, JSON), SVG-Export, automatisches Zwischenspeichern.

## Noch nicht enthalten

Maschinenanbindung (FluidNC), G-Code, Vorschau, Bildgravur, Import (SVG/DXF), Boolesche Operationen, Offset, Text in Pfad umwandeln (braucht eine Schrift-Engine, geplant mit opentype.js oder in Rust).

## Aufbau

| Datei | Inhalt |
|---|---|
| `src/model.ts` | Datenmodell: Dokument, Objekte, Layer, Matrizen, Palette |
| `src/geom.ts` | Formen als Bézierpfade, Begrenzungsrahmen, Text-Layout, Treffertest, SVG-Pfade |
| `src/editor.ts` | Arbeitsfläche: Zeichnen, Werkzeuge, Auswahl, Transformieren, Knoten, Befehle, Undo |
| `src/ui.ts` | Menü, Leisten, Layer- und Laser-Panel, Palette, Statusleiste, Texteingabe |
| `src/files.ts` | Öffnen/Speichern (Tauri-Dialoge oder Browser), SVG-Export |
| `src-tauri/` | Rust-Hülle mit nativen Dateidialogen |

Intern rechnet der Editor in mm mit y nach unten; angezeigt wird in Maschinenkoordinaten (Ursprung unten links).
