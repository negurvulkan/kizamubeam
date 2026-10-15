# Laserwerk (Arbeitstitel)

Freie Laser-Software mit der Bedienung von LightBurn als Vorbild. Erster Prototyp: Oberfläche und Objekterstellung.
Stack: Tauri 2, TypeScript (Oberfläche, Editor, G-Code), Rust (Desktop-Hülle, Maschinenanbindung). Lizenzvorschlag: GPL-3.0-or-later.

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
- Bearbeiten: Auswahl per Klick und Rahmen (nach rechts umschließend, nach links kreuzend), Verschieben, Skalieren, Drehen mit der Maus (knapp außerhalb einer Ecke ziehen oder zweiter Klick auf die Auswahl; Drehpunkt verschiebbar, Shift 15°, Ctrl 5°, Esc bricht ab), Zahlenfelder mit 9-Punkt-Anker und Formeln mit Einheiten („100/3“, „2in“), Knotenbearbeitung (Knoten per Klick, Shift+Klick, Rahmen oder Ctrl+A auswählen, gemeinsam ziehen oder mit Pfeiltasten schieben; Entf löschen, L Gerade, C Kurve, E Ecke, S glatt, I einfügen), In Pfad umwandeln, Gruppieren, Spiegeln, Ausrichten, Verteilen, Kopieren, Duplizieren, Rückgängig.
- Text in Pfad umwandeln (Ctrl+Shift+C) mit den echten Schriftkonturen: in der Desktop-App aus den installierten Systemschriften, im Browser mit Roboto als Ersatz.
- Boolesche Operationen: Vereinen, Abziehen, Schnittmenge. Unter „Boolesche Optionen“ wird die Basis gewählt (zuerst gewählte, hinterste oder vorderste Form) und ob die Originale erhalten bleiben; im Menü Werkzeuge gibt es zusätzlich „Vordere vom hinteren abziehen“ und „Hintere vom vorderen abziehen“. Texte und Gruppen werden dabei automatisch als Konturen behandelt.
- Offset (Alt+O) nach außen, innen oder beides, mit runden, spitzen oder abgeschrägten Ecken und Live-Vorschau. Offene Linien bekommen eine geschlossene Kontur.
- Ergebnisse von Booleschen Operationen und Offset sind wieder Bézierpfade: Ecken und gerade Strecken bleiben erhalten, Rundungen werden mit höchstens 0,02 mm Abweichung als Kurven eingepasst.
- Farbe ist der Layer: Klick auf eine Palettenfarbe ordnet die Auswahl zu. Layer-Tabelle mit Modus (Linie/Füllen), Speed, Leistung, Air Assist, Ausgabe, Sichtbarkeit und Schnellbearbeitung.
- Layer-Einstellungen (Doppelklick auf einen Layer, wie der Cut Settings Editor in LightBurn): Kerf-Versatz, Haltestege (Anzahl oder Abstand, innere Formen auslassen), Scanwinkel, Kreuzschraffur, Bidirektional, Überfahrweg, Air Assist (M8 oder M7, aus mit M9; einstellbar in den Geräteeinstellungen). Die Einstellungen liegen als `CutSettings` im Layer (`src/model.ts`).
- Helles und dunkles Design (Ansicht → Design oder Knopf ganz rechts in der Symbolleiste), Standard folgt dem System. Im dunklen Design werden sehr dunkle Layerfarben auf der Arbeitsfläche aufgehellt.
- Import (Ctrl+I, Ziehen aus dem Dateimanager oder Ctrl+V aus anderen Programmen): Bilder (PNG, JPG, BMP, GIF, WebP), SVG und DXF.
  - Bilder bekommen ihre Größe aus der Auflösung der Datei (ohne Angabe 254 DPI, zu große werden aufs Bett verkleinert).
  - SVG: Pfade inkl. Bögen, Rechtecke, Kreise, Ellipsen, Linien, Polygone, `use`, Transformationen, CSS-Klassen, eingebettete Bilder; Einheiten über `width`/`height` und `viewBox`. Texte werden übersprungen.
  - DXF: LINE, LWPOLYLINE/POLYLINE mit Bögen, CIRCLE, ARC, ELLIPSE, SPLINE, INSERT (Blöcke), Einheit aus `$INSUNITS`. Einzellinien werden zu zusammenhängenden Pfaden verbunden.
  - Farben werden auf die nächste Palettenfarbe (= Layer) abgebildet, mehrere Objekte als Gruppe eingefügt.
- Bildbearbeitung wie in LightBurn: Bilder sind ein eigener Eintrag „Bild“ in der Layer-Tabelle mit Bildmodus (Schwellwert, Geordnet, Atkinson, Floyd-Steinberg, Stucki, Jarvis, Halbton, Graustufen), Zeilenabstand/DPI, Negativ, Bidirektional, Überfahrweg, Speed und Leistung. „Bild anpassen“ (Helligkeit, Kontrast, Gamma, Schärfen mit Radius und Entrauschen) mit Vorschau, Original-Vergleich und 1:1-Ausschnitt. Die Arbeitsfläche zeigt das gerasterte Ergebnis in Laserauflösung.
- Bild nachzeichnen (Alt+T): Schwellwert, kleine Flecken ignorieren, Glättung, Live-Vorschau. Ergebnis sind Bézierpfade mit erhaltenen Ecken.
- Bearbeitetes Bild speichern (das geditherte Bild als PNG, so wie es gelasert würde).
- Maschinenausgabe für FluidNC/GRBL (Laser-Panel rechts unten mit den Reitern Laser, Verschieben, Konsole):
  - Mehrere Geräte speichern und auswählen (Laser-Reiter oben, Laser → Geräte …). Neue Geräte aus Vorlagen gängiger Laser (Swiitol, Ortur, Atomstack, Sculpfun, xTool, Creality Falcon, Two Trees) oder allgemein je Steuerung. Das Bett der Arbeitsfläche folgt dem gewählten Gerät.
  - Steuerungen: FluidNC, GRBL 1.1, grblHAL (Zeichenzählung, Echtzeitstatus, M4), Marlin (Zeile für Zeile, Position per M114, Inline-Laser `M3 I`, Pause durch Zurückhalten, Stopp mit M410) und Smoothieware (Zeile für Zeile, S 0 … 1). Home, Joggen, Ursprung und Konsolenknöpfe passen sich an.
  - Verbinden über USB-Seriell oder WLAN (Telnet, Port 23). Status, Position und Laserkopf auf der Arbeitsfläche, Alarme im Klartext.
  - Start, Pause/Weiter, Stopp (Halt und Reset, Position bleibt erhalten), Rahmen als Rechteck oder Kontur (wahlweise mit schwachem Laser), Home, Zum Nullpunkt.
  - Starten ab: Absolute Koordinaten, Benutzer-Ursprung oder Aktuelle Position, jeweils mit 9-Punkt-Job-Ursprung. „Nur Auswahl“ lasert nur die ausgewählten Objekte.
  - G-Code im Lasermodus (M4): Linie mit optimierter Reihenfolge (innere Formen zuerst, kurze Leerwege, bester Startknoten), Füllen mit Zeilenabstand, Scanwinkel, Kreuzschraffur, Überfahrweg und bidirektional, Kerf-Versatz je Objekt, Haltestege als Strecken ohne Leistung, Air Assist je Layer, Bilder in allen Bildmodi (Graustufen mit Leistung zwischen Min. und Max.), Durchgänge, Layer-Reihenfolge. Texte werden mit ihren Schriftkonturen gelasert.
  - Übertragung mit Zeichenzählung (Empfangspuffer 127 Bytes) im Rust-Kern, Fortschritt mit vergangener und geschätzter Restzeit.
  - Vorschau (Alt+P) mit Zeitschätzung wie im Bahnplaner von FluidNC (Beschleunigung, Ecken), Abspielen und Zeitschieber, Leerwege, Schattierung nach Leistung, Zoomen und Verschieben.
  - G-Code speichern, Verschieben-Reiter (Jog in Schritten, Ursprung setzen/löschen, Laser zur Auswahl, Entsperren), Konsole mit Verlauf.
  - Geräteeinstellungen: Arbeitsbereich, S-Wert für 100 %, Baudrate, WLAN-Adresse, Eilgang und Beschleunigung, Rahmen. „Von der Maschine lesen“ holt Arbeitsbereich, Eilgang, Beschleunigung (FluidNC-Konfiguration bzw. GRBL `$$`) und bei GRBL auch die Leistungsskala `$30`.
- Kamera (Reiter „Kamera“ im Laser-Panel): USB-Kamera wählen, Bild entzerrt und lagerichtig unter den Objekten auf der Arbeitsfläche, Deckkraft, einmalig oder laufend aktualisieren, als Bild auf T1 einfügen (zum Nachzeichnen). Kalibrieren: 2 × 2 bis 5 × 5 Markierungen lasern (oder als G-Code speichern), im Foto anklicken; daraus werden Lage (Homographie) und ab 3 × 3 die Linsenverzeichnung berechnet, mit Restfehler in mm und entzerrter Kontrollansicht. Kalibrierung je Gerät gespeichert. Unter macOS fragt das System beim ersten Verbinden nach der Kamera-Freigabe.
- Projekt speichern und öffnen (`.lwk`, JSON, Bilder eingebettet), SVG-Export (mit Bildern), automatisches Zwischenspeichern (Bilddaten in IndexedDB).

## Noch nicht enthalten

Verbindung per WebSocket, Lasern ab einem Punkt der Vorschau („Start Here“), Kopfkamera und mehrere Kameras, Tabs/Brücken, Kerf-Ausgleich, eigene Start-/End-Skripte, Text auf Pfad, Schweißen von Buchstaben. Bei Bildern fehlen noch Zuschneiden/Maske, TIFF, die Verfahren Newsprint und Sketch sowie Bild-Presets.

## Aufbau

| Datei | Inhalt |
|---|---|
| `src/model.ts` | Datenmodell: Dokument, Objekte, Layer, Matrizen, Palette |
| `src/geom.ts` | Formen als Bézierpfade, Begrenzungsrahmen, Text-Layout, Treffertest, SVG-Pfade |
| `src/editor.ts` | Arbeitsfläche: Zeichnen, Werkzeuge, Auswahl, Transformieren, Knoten, Befehle, Undo |
| `src/ui.ts` | Menü, Leisten, Layer- und Laser-Panel, Palette, Statusleiste, Texteingabe |
| `src/layerdialog.ts` | Layer-Einstellungen (Kerf, Haltestege, Füllen, Air Assist) |
| `src/fonts.ts` | Schriftdateien laden (Systemschriften über Rust, Ersatzschrift) und Text in Bézierpfade umwandeln (opentype.js) |
| `src/ops.ts` | Boolesche Operationen und Offset (Clipper) |
| `src/images.ts` | Bilddaten (außerhalb von Undo, gesichert in IndexedDB), Bildverarbeitung und Dithering, Zwischenspeicher der Ergebnisse |
| `src/trace.ts` | Bild nachzeichnen: Marching Squares, Vereinfachung, Kurveneinpassung |
| `src/importers.ts` | SVG- und DXF-Import |
| `src/fit.ts` | Kurvenrückführung: Linienzüge in Bézierpfade (Ecken erkennen, Schneider-Verfahren) |
| `src/gcode.ts` | Maschinenausgabe: Job aus dem Dokument (Linie, Füllen, Bilder, Reihenfolge), G-Code, Laufzeitschätzung, Rahmen, Geräteeinstellungen |
| `src/camera.ts` | Kamera: Zugriff, Kalibriermodell (Homographie und radiale Verzeichnung, Levenberg-Marquardt), Entzerrung aufs Bett |
| `src/cameraui.ts` | Kamera-Reiter, Kamerabild auf der Arbeitsfläche, Kalibrier-Assistent mit Markierungen |
| `src/machine.ts` | Verbindung zur Maschine aus Sicht der Oberfläche: Zustand, Statusauswertung, Klartext für Alarme, Befehle an Rust |
| `src/laser.ts` | Laser-Panel (Laser, Verschieben, Konsole), Geräteeinstellungen, Vorschau |
| `src/dom.ts` | DOM-Helfer und Zahlenfelder mit Formeln |
| `src/files.ts` | Öffnen/Speichern/Importieren (Tauri-Dialoge oder Browser), Ziehen und Einfügen, SVG-Export, bearbeitetes Bild speichern |
| `src-tauri/` | Rust-Hülle: native Dateidialoge, Dateien lesen/schreiben, Liste und Dateien der Systemschriften (fontdb) |
| `src-tauri/src/stream.rs` | G-Code-Übertragung mit Zeichenzählung, Statusabfrage, Halt/Reset (mit Tests: `cargo test`) |
| `src-tauri/src/machine.rs` | Seriell (serialport) und Telnet (TCP), Ereignisse an das Fenster |

Intern rechnet der Editor in mm mit y nach unten; angezeigt wird in Maschinenkoordinaten (Ursprung unten links).
