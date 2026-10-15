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
- Bearbeiten: Auswahl per Klick und Rahmen (nach rechts umschließend, nach links kreuzend), Verschieben, Skalieren, Drehen mit der Maus (knapp außerhalb einer Ecke ziehen oder zweiter Klick auf die Auswahl; Drehpunkt verschiebbar, Shift 15°, Ctrl 5°, Esc bricht ab), Zahlenfelder mit 9-Punkt-Anker und Formeln mit Einheiten („100/3“, „2in“), Knotenbearbeitung (D, I, C, S), In Pfad umwandeln, Gruppieren, Spiegeln, Ausrichten, Verteilen, Kopieren, Duplizieren, Rückgängig.
- Text in Pfad umwandeln (Ctrl+Shift+C) mit den echten Schriftkonturen: in der Desktop-App aus den installierten Systemschriften, im Browser mit Roboto als Ersatz.
- Boolesche Operationen: Vereinen, Abziehen (weitere Formen von der zuerst gewählten), Schnittmenge. Texte und Gruppen werden dabei automatisch als Konturen behandelt.
- Offset (Alt+O) nach außen, innen oder beides, mit runden, spitzen oder abgeschrägten Ecken und Live-Vorschau. Offene Linien bekommen eine geschlossene Kontur.
- Ergebnisse von Booleschen Operationen und Offset sind wieder Bézierpfade: Ecken und gerade Strecken bleiben erhalten, Rundungen werden mit höchstens 0,02 mm Abweichung als Kurven eingepasst.
- Farbe ist der Layer: Klick auf eine Palettenfarbe ordnet die Auswahl zu. Layer-Tabelle mit Modus (Linie/Füllen), Speed, Leistung, Ausgabe, Sichtbarkeit und Schnellbearbeitung.
- Projekt speichern und öffnen (`.lwk`, JSON), SVG-Export, automatisches Zwischenspeichern.

## Noch nicht enthalten

Maschinenanbindung (FluidNC), G-Code, Vorschau, Bildgravur, Import (SVG/DXF), Text auf Pfad, Schweißen von Buchstaben.

## Aufbau

| Datei | Inhalt |
|---|---|
| `src/model.ts` | Datenmodell: Dokument, Objekte, Layer, Matrizen, Palette |
| `src/geom.ts` | Formen als Bézierpfade, Begrenzungsrahmen, Text-Layout, Treffertest, SVG-Pfade |
| `src/editor.ts` | Arbeitsfläche: Zeichnen, Werkzeuge, Auswahl, Transformieren, Knoten, Befehle, Undo |
| `src/ui.ts` | Menü, Leisten, Layer- und Laser-Panel, Palette, Statusleiste, Texteingabe |
| `src/fonts.ts` | Schriftdateien laden (Systemschriften über Rust, Ersatzschrift) und Text in Bézierpfade umwandeln (opentype.js) |
| `src/ops.ts` | Boolesche Operationen und Offset (Clipper) |
| `src/fit.ts` | Kurvenrückführung: Linienzüge in Bézierpfade (Ecken erkennen, Schneider-Verfahren) |
| `src/files.ts` | Öffnen/Speichern (Tauri-Dialoge oder Browser), SVG-Export |
| `src-tauri/` | Rust-Hülle: native Dateidialoge, Liste und Dateien der Systemschriften (fontdb) |

Intern rechnet der Editor in mm mit y nach unten; angezeigt wird in Maschinenkoordinaten (Ursprung unten links).
