# Laserwerk (Arbeitstitel)

[English](README.md) · Deutsch

Freie Laser-Software zum Entwerfen, Bilder bearbeiten und direkt an den Laser senden. Die Bedienung orientiert sich an LightBurn, damit sich Umsteiger sofort zurechtfinden.
Stack: Tauri 2, TypeScript (Oberfläche, Editor, G-Code), Rust (Desktop-Hülle, Maschinenanbindung, MCP-Server). Lizenz: GPL-3.0-or-later (siehe `LICENSE`). Version: 1.0.0-alpha.

## Starten

Voraussetzungen: Node.js 20+, Rust (stable), unter Linux zusätzlich `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `build-essential`, `libssl-dev`
(siehe https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev      # Desktop-App mit Live-Neuladen
npm run dev            # nur die Oberfläche im Browser: http://localhost:1420
npm run tauri build    # Installationspaket
```

Unter Windows baut `npm run tauri build` nur den NSIS-Installer (`.exe`, siehe `src-tauri/tauri.windows.conf.json`): Der MSI-Installer akzeptiert keine Vorabversionen wie `1.0.0-alpha`.

## Was Laserwerk kann

- Vertrautes Layout: Menü, Symbolleiste, Zahlenleiste oben, Werkzeuge links, Schnitte/Layer und Laser rechts, Farbpalette 00–29 plus T1/T2 unten, Statusleiste.
- Anpassbare Oberfläche:
  - Werkzeugfenster (Schnitte/Layer, Objekte, Laser, Verschieben, Konsole, Material, Kamera) sind einzeln andockbar. Reiter ziehen: auf einen anderen Reiterkopf = als Reiter dazu, an den oberen oder unteren Rand einer Gruppe = darüber bzw. darunter, an den linken Rand neben der Werkzeugleiste = linke Andockleiste, auf die Arbeitsfläche = freies Fenster (verschieben am Kopf, Größe an der Ecke unten rechts, ⇥ oder Doppelklick dockt rechts an).
  - Größe: Trennlinien zwischen den Fenstern und der Innenrand der Andockleisten lassen sich ziehen. ▾ oder Doppelklick auf den Kopf klappt eine Gruppe ein.
  - × am Reiter blendet ein Fenster aus; Menü Fenster blendet Fenster und Leisten (Hauptleiste, Werkzeugleiste, Eigenschaftenleiste, Farbpalette, Statusleiste) ein und aus.
  - Funktionsleisten anpassen (Menü Fenster oder Rechtsklick auf die Hauptleiste bzw. Werkzeugleiste): Aktionen aus allen Bereichen hinzufügen, entfernen, per Ziehen oder ↑/↓ umsortieren, Trennlinien einfügen, Symbolgröße klein/normal/groß; Aktionen ohne Symbol erscheinen als Text. „Standard wiederherstellen“ setzt eine Leiste zurück.
  - Anordnung und Leisten werden je Nutzer gespeichert (`localStorage`: `laserwerk.layout`, `laserwerk.toolbars`); Fenster → Fenster und Leisten zurücksetzen stellt den Ausgangszustand wieder her.
- Arbeitsfläche als Maschinenbett in mm (Standard 400 × 400, in den Geräteeinstellungen änderbar), Raster, Lineale, Ursprung unten links, Zoom mit Mausrad, Verschieben mit Leertaste oder mittlerer Maustaste.
- Zeichnen: Linien und Bézierkurven, Rechteck mit Eckenradius, Ellipse, Polygon und Stern, Text (mehrzeilig, Schriftart, Höhe, Fett, Kursiv, Großbuchstaben, Zeichen- und Zeilenabstand, Ausrichtung).
- Bearbeiten: Auswahl per Klick und Rahmen (nach rechts umschließend, nach links kreuzend), Verschieben, Skalieren, Drehen mit der Maus (knapp außerhalb einer Ecke ziehen oder zweiter Klick auf die Auswahl; Drehpunkt verschiebbar, Shift 15°, Ctrl 5°, Esc bricht ab), Zahlenfelder mit 9-Punkt-Anker und Formeln mit Einheiten („100/3“, „2in“), Knotenbearbeitung (Knoten per Klick, Shift+Klick, Rahmen oder Ctrl+A auswählen, gemeinsam ziehen oder mit Pfeiltasten schieben; Entf löschen, L Gerade, C Kurve, E Ecke, S glatt, I einfügen, B Pfad am Knoten aufbrechen, T Kante bis zu den Schnittpunkten trimmen), In Pfad umwandeln, Gruppieren, Spiegeln, Ausrichten, Verteilen, Kopieren, Duplizieren, Rückgängig.
- Fangen (Statusleiste „Fang“ und „Raster“): an Knoten, Mittelpunkten, Zentren, Schnittpunkten und Linien sowie am Raster mit einstellbarer Weite. Ctrl beim Ziehen kehrt das Fangen um, Alt fängt stärker und zeigt Ausrichtungshilfen an anderen Objekten.
- Arrays (Werkzeuge → Rasterarray, Ctrl+Shift+A, und Kreisarray) mit Live-Vorschau: Kopien in Spalten und Zeilen mit Abstand oder Mittenabstand, Richtung, Versatz und Spiegeln jeder zweiten Zeile/Spalte, bzw. im Kreis um einen Mittelpunkt. Bézierkurven bleiben exakt erhalten.
- Text auf Pfad (Werkzeuge → Text auf Pfad oder „Auf Pfad“ in der Textleiste): Text und eine Form wählen, der Text folgt Linie, Kurve, Rechteck, Ellipse oder Polygon. Offene Kurven beginnen je nach Ausrichtung am Anfang, in der Mitte oder am Ende, geschlossene Formen am obersten Punkt. In der Textleiste: Versatz entlang der Kurve, Abstand zur Kurve, Seite wechseln, Lösen. Text und Form bleiben verknüpft: Wird die Form verschoben oder bearbeitet, folgt der Text; wird nur der Text verschoben, wandert die Form mit. Die Form wird mitgelasert, außer auf einem Werkzeuglayer (T1/T2) oder ausgeblendet; wird sie gelöscht, behält der Text die letzte Kurve.
- QR-Codes (QR-Symbol in der Werkzeugleiste links oder Werkzeuge → QR-Code …): Text oder Internetadresse, WLAN-Zugang oder Kontakt (vCard), Fehlerkorrektur L/M/Q/H, Größe in mm, „Negativ“ lasert den Hintergrund samt Ruhezone (für dunkle Materialien). Benachbarte Module werden zu geschlossenen Umrissen zusammengefasst, sodass ein Füll-Layer den Code graviert. Doppelklick öffnet den Code wieder zum Bearbeiten; In Pfad umwandeln macht ihn zu normalen Formen.
- Variabler Text („Variabel“ in der Textleiste, im QR-Dialog, Werkzeuge → Variabler Text …): Platzhalter für Seriennummer (`%#`, mit führenden Nullen `%4#`), Datum und Uhrzeit (`%d.%m.%Y`, `%H:%M` …) und Spalten einer CSV-Datei (`%0`, `%1` … oder `%{Überschrift}`; Komma, Semikolon oder Tab). Eine projektweite Nummer ist Seriennummer und CSV-Zeile zugleich; Start, Ende, Schrittweite und „nach jedem Job weiterzählen“ (nach Start und G-Code speichern) im Fenster „Variabler Text“, jedes Objekt mit eigenem Versatz. „Max. Breite“ in der Textleiste staucht zu lange Zeilen. Werkzeuge → Variablen Text festschreiben macht den aktuellen Inhalt zu festem Text. Tests: `npm run test:vartext`.
- Buchstaben schweißen („Schweißen“ in der Textleiste): überlappende Zeichen verschmelzen zu einer Kontur, z. B. bei Schreibschrift oder engem Zeichenabstand; gilt für Anzeige, Lasern, Export und Umwandeln.
- Text in Pfad umwandeln (Ctrl+Shift+C) mit den echten Schriftkonturen: in der Desktop-App aus den installierten Systemschriften, im Browser mit Roboto als Ersatz.
- Boolesche Operationen: Vereinen, Abziehen, Schnittmenge. Unter „Boolesche Optionen“ wird die Basis gewählt (zuerst gewählte, hinterste oder vorderste Form) und ob die Originale erhalten bleiben; im Menü Werkzeuge gibt es zusätzlich „Vordere vom hinteren abziehen“ und „Hintere vom vorderen abziehen“. Texte und Gruppen werden dabei automatisch als Konturen behandelt.
- Offset (Alt+O) nach außen, innen oder beides, mit runden, spitzen oder abgeschrägten Ecken und Live-Vorschau. Offene Linien bekommen eine geschlossene Kontur.
- Pfad-Werkzeuge, alle Ergebnisse bleiben Bézierkurven:
  - Pfad schließen (Bearbeiten): schließt offene Pfade, deren Anfang und Ende höchstens 0,5 mm auseinanderliegen. „Pfade mit Toleranz schließen …“ mit Schieberegler bis 20 mm, Gerade einfügen oder Enden zusammenziehen, und Anzeige, wie viele offene Formen geschlossen werden.
  - Ausgewählte Formen verbinden (Alt+J, Auto-Join): offene Pfade, deren Enden höchstens 0,05 mm auseinanderliegen, werden ein Pfad; treffen sich die Enden einer Kette, wird sie geschlossen.
  - Zerlegen (Alt+B, Anordnen): Pfade, Formen und Texte in ihre einzelnen Geraden und Kurven aufteilen.
  - Formen trimmen (Ctrl+K): Mauszeiger auf eine Kurve, der Abschnitt bis zu den nächsten Schnittpunkten wird rot und per Klick entfernt (ohne Schnittpunkt der ganze Pfad). Die Reste werden an den Schnittpunkten mit anliegenden Pfaden verbunden, so wird aus zwei überlappenden Kreisen nach zwei Klicks eine Kontur. Ctrl+Klick verbindet nicht, Shift+Klick behält das entfernte Stück auf dem aktuellen Layer. Gruppen erst auflösen.
  - Startpunkt setzen (Werkzeuge): Knoten anklicken, dort beginnt der Schnitt; Shift+Klick kehrt die Richtung um, Ctrl+Klick gibt Startpunkt und Richtung wieder der Optimierung frei. Blauer Pfeil = gesetzt, grau = Standard. Ein gesetzter Startpunkt gilt auch mit „Pfad optimieren“ (nur die Reihenfolge der Formen wird dann noch optimiert); bei Kerf-Ausgleich entsteht eine neue Kontur, dort wählt die Optimierung. „Richtung umkehren“ (Bearbeiten) dreht die Laufrichtung.
- Ergebnisse von Booleschen Operationen und Offset sind wieder Bézierpfade: Ecken und gerade Strecken bleiben erhalten, Rundungen werden mit höchstens 0,02 mm Abweichung als Kurven eingepasst.
- Verbindungen für gelaserte Bauteile (Werkzeug „Verbindung“): Fingerzinken und Schlitz und Zapfen auf gerade Kanten vorhandener Formen, mit Materialdicke, Kerf und Spiel (negativ = Press-Fit). Kante 1 bekommt Zinken bzw. Zapfen, Kante 2 das Gegenstück bzw. die Schlitze; eine einzelne gezeichnete Linie wird durch die Schlitze ersetzt. Das Ergebnis bleibt ein normaler, bearbeitbarer Pfad.
- Überblattung (Kreuzverbindung) im selben Werkzeug: beide Kanten bekommen Schlitze in Materialdicke, die Tiefe ist ein Anteil der Plattenbreite (Kante 1 z. B. 50 %, Kante 2 den Rest). Mehrere Schlitze teilen die Kante in gleiche Fächer, etwa für Rastereinsätze und Flaschentrenner.
- Schnapp- und Hakenverbindung im selben Werkzeug: Schnappzapfen mit zwei federnden Zungen und Rasthaken (Überstand, Hakenlänge und Federschlitz einstellbar) sowie L-förmige Hakenzapfen, deren Schlitz um die Hakenlänge verlängert ist (einstecken, dann schieben).
- Keilzapfen und T-Slot mit Mutter im selben Werkzeug: Keilzapfen stehen durch die Gegenplatte und haben ein Keilloch; die passenden Keile werden gleich mit angelegt. Beim T-Slot sitzt zwischen je zwei Zapfen ein Schraubenschlitz mit Mutternfenster, die Gegenplatte bekommt die Bohrung (Schraube, Mutter und Schraubenlänge einstellbar).
- Biegeschnitte / Living Hinges (Werkzeuge → Biegeschnitte): füllt eine gewählte geschlossene Form mit einem Schnittmuster, damit sich die Platte dort biegt. Muster: gerade Schnitte, Wellen, Rauten, Waben, Dreiecke, Flechtmuster und Spirale, mit Live-Vorschau und Startwerten aus der Materialdicke. Die Schnitte sind exakte Linien und Bézierkurven.
- Farbe ist der Layer: Klick auf eine Palettenfarbe ordnet die Auswahl zu. Layer-Tabelle mit Modus (Linie/Füllen), Speed, Leistung, Air Assist, Ausgabe, Sichtbarkeit und Schnellbearbeitung.
- Layer-Einstellungen (Doppelklick auf einen Layer): Kerf-Versatz, Haltestege (Anzahl oder Abstand, innere Formen auslassen), Scanwinkel, Kreuzschraffur, Bidirektional, Überfahrweg, Air Assist (M8 oder M7, aus mit M9; einstellbar in den Geräteeinstellungen). Die Einstellungen liegen als `CutSettings` im Layer (`src/model.ts`).
- Material-Bibliothek (Fenster „Material“): Layer-Einstellungen (wahlweise auch Bild-Einstellungen) je Material und Dicke speichern und auf Layer übernehmen. Austausch über `.lwm`-Dateien (JSON); LightBurn-Bibliotheken (`.clb`) lassen sich einlesen, soweit ihre Felder eine Entsprechung haben.
- Materialtest (Laser → Materialtest): Raster mit zwei gestuften Werten (z. B. Zeilen Geschwindigkeit, Spalten Leistung) mit Beschriftung, jede Zelle mit eigenem Testlayer. Der Test geht über Vorschau, Rahmen, Start oder G-Code direkt an den Laser, ohne das Dokument zu verändern; die Zellen laufen nach steigender Energie.
- Objekte-Fenster (rechts unter den Layern, ein- und ausblenden über das Menü Fenster): Baum aus Layern und ihren Objekten, Gruppen aufklappbar, vorderstes Objekt oben. Klick wählt aus (Shift/Ctrl fügt hinzu), die Auswahl auf der Arbeitsfläche wird mitgeführt. Doppelklick auf einen Namen benennt Objekt oder Layer um. Auge: ausblenden (ausgeblendete Objekte werden weder gezeichnet noch gelasert oder exportiert). Schloss: sperren (auf der Arbeitsfläche nicht auswählbar), auch für ganze Layer. Ziehen ändert die Stapelreihenfolge, schiebt Objekte auf einen anderen Layer oder ordnet Layer in der Ausgabereihenfolge um. Name, `hidden` und `locked` stehen im Objekt (`src/model.ts`) und erscheinen in `get_document` des MCP-Servers.
- Mehrseitige Projekte: Ein Projekt hat eine oder mehrere Seiten (Objekte-Fenster ganz oben, Menü Seiten, Bild ↑/↓ zum Wechseln). Jede Seite hat eigene Objekte; die Layer-Einstellungen gelten für das ganze Projekt. Gezeichnet, bearbeitet, gelasert und exportiert (SVG, G-Code) wird die aktuelle Seite. Seiten lassen sich anlegen, duplizieren, umbenennen (Doppelklick), löschen und per Ziehen umordnen; Objekte zieht man auf eine Seitenzeile, um sie dorthin zu verschieben. Dateiformat ab `version: 2` mit `pages` und `page`; ältere Dateien öffnen sich als Projekt mit einer Seite. MCP: `get_document` (mit `pages`), `switch_page`, `edit_pages`, `move_to_page`.
- Verlaufsfenster (Reiter neben Objekte, Menü Fenster): die letzten Änderungen (bis 200) als Liste mit Namen wie „Verschieben“, „Offset“ oder „Text bearbeiten“ und Uhrzeit. Klick auf eine Zeile springt dorthin, mehrere Schritte auf einmal zurück oder vor; rückgängig gemachte Schritte stehen ausgegraut unter dem aktuellen Stand und lassen sich per Klick wiederholen, bis eine neue Änderung sie verwirft. Ctrl+Z / Ctrl+Y (oder Ctrl+Shift+Z) gehen weiter einzeln. Jeder MCP-Aufruf erscheint als ein Schritt mit dem Namen seines Werkzeugs.
- Oberfläche auf Deutsch und Englisch (Ansicht → Sprache). Standard folgt der Systemsprache (andere Systemsprachen bekommen Englisch), die Wahl bleibt gespeichert; im Englischen die unter Laser-Nutzern üblichen Begriffe.
- Helles und dunkles Design (Ansicht → Design oder Knopf ganz rechts in der Symbolleiste), Standard folgt dem System. Im dunklen Design werden sehr dunkle Layerfarben auf der Arbeitsfläche aufgehellt.
- Import (Ctrl+I, Ziehen aus dem Dateimanager oder Ctrl+V aus anderen Programmen): Bilder (PNG, JPG, BMP, GIF, WebP, TIFF), SVG und DXF.
  - Bilder bekommen ihre Größe aus der Auflösung der Datei (ohne Angabe 254 DPI, zu große werden aufs Bett verkleinert).
  - TIFF (auch LZW, Deflate, 16 Bit) wird mit utif gelesen und als PNG übernommen; bei mehrseitigen Dateien zählt die erste Seite.
  - SVG: Pfade inkl. Bögen, Rechtecke, Kreise, Ellipsen, Linien, Polygone, `use`, Transformationen, CSS-Klassen, eingebettete Bilder; Einheiten über `width`/`height` und `viewBox`. Texte werden übersprungen.
  - DXF: LINE, LWPOLYLINE/POLYLINE mit Bögen, CIRCLE, ARC, ELLIPSE, SPLINE, INSERT (Blöcke), Einheit aus `$INSUNITS`. Einzellinien werden zu zusammenhängenden Pfaden verbunden.
  - Farben werden auf die nächste Palettenfarbe (= Layer) abgebildet, mehrere Objekte als Gruppe eingefügt.
- Bildbearbeitung: Bilder sind ein eigener Eintrag „Bild“ in der Layer-Tabelle mit Bildmodus (Schwellwert, Geordnet, Atkinson, Floyd-Steinberg, Stucki, Jarvis, Zeitungsdruck/Newsprint, Halbton, Skizze/Sketch, Graustufen), Zeilenabstand/DPI, Negativ, Bidirektional, Überfahrweg, Speed und Leistung. „Bild anpassen“ (Helligkeit, Kontrast, Gamma, Schärfen mit Radius und Entrauschen) mit Vorschau, Original-Vergleich und 1:1-Ausschnitt. Die Arbeitsfläche zeigt das gerasterte Ergebnis in Laserauflösung.
  - Zeitungsdruck setzt je Rasterzelle (Zellen pro Zoll, Rasterwinkel) einen runden Punkt, dessen Fläche der Helligkeit der Zelle entspricht. Skizze macht Kanten zu dunklen Strichen und lässt gleichmäßige Flächen frei; gelasert wird wie bei Graustufen mit Leistung zwischen Min. und Max.
  - Bild-Presets in „Bild anpassen“: Anpassungen und Bildmodus (mit Schwellwert, Zellen und Winkel) unter einem Namen speichern, anwenden und löschen. Speed, Leistung und Zeilenabstand gehören zur Material-Bibliothek.
- Bild zuschneiden und Maske anwenden (Werkzeuge-Menü oder Schaltflächen in der Leiste, wenn ein Bild und Formen gewählt sind): Zuschneiden kürzt das Bild auf den Rahmen der Form, die Maske behält nur das Innere der geschlossenen Formen (auch Text), der Rest wird transparent und nicht gelasert. Das Bild bleibt an seiner Stelle und in Originalauflösung, die Formen werden entfernt, Ctrl+Z macht beides rückgängig.
- Bild nachzeichnen (Alt+T): Schwellwert, kleine Flecken ignorieren, Glättung, Live-Vorschau. Ergebnis sind Bézierpfade mit erhaltenen Ecken.
- Bearbeitetes Bild speichern (das geditherte Bild als PNG, so wie es gelasert würde).
- Maschinenausgabe für FluidNC/GRBL (rechts unten die Fenster Laser, Verschieben und Konsole):
  - Mehrere Geräte speichern und auswählen (Fenster Laser oben, Laser → Geräte …). Neue Geräte aus Vorlagen gängiger Laser (Swiitol, Ortur, Atomstack, Sculpfun, xTool, Creality Falcon, Two Trees) oder allgemein je Steuerung. Das Bett der Arbeitsfläche folgt dem gewählten Gerät.
  - Steuerungen: FluidNC, GRBL 1.1, grblHAL (Zeichenzählung, Echtzeitstatus, M4), Marlin (Zeile für Zeile, Position per M114, Inline-Laser `M3 I`, Pause durch Zurückhalten, Stopp mit M410) und Smoothieware (Zeile für Zeile, S 0 … 1). Home, Joggen, Ursprung und Konsolenknöpfe passen sich an.
  - Verbinden über USB-Seriell oder WLAN (Telnet, Port 23, oder WebSocket, FluidNC Port 81; ist er nicht erreichbar, wird 80 versucht). Status, Position und Laserkopf auf der Arbeitsfläche, Alarme im Klartext.
  - Start, Pause/Weiter, Stopp (Halt und Reset, Position bleibt erhalten), Rahmen als Rechteck oder Kontur (wahlweise mit schwachem Laser), Home, Zum Nullpunkt.
  - Starten ab: Absolute Koordinaten, Benutzer-Ursprung oder Aktuelle Position, jeweils mit 9-Punkt-Job-Ursprung. „Nur Auswahl“ lasert nur die ausgewählten Objekte.
  - G-Code im Lasermodus (M4): Linie mit optimierter Reihenfolge (innere Formen zuerst, kurze Leerwege, bester Startknoten), Füllen mit Zeilenabstand, Scanwinkel, Kreuzschraffur, Überfahrweg und bidirektional, Kerf-Versatz je Objekt, Haltestege als Strecken ohne Leistung, Air Assist je Layer, Bilder in allen Bildmodi (Graustufen mit Leistung zwischen Min. und Max.), Durchgänge, Layer-Reihenfolge. Texte werden mit ihren Schriftkonturen gelasert.
  - Übertragung mit Zeichenzählung (Empfangspuffer 127 Bytes) im Rust-Kern, Fortschritt mit vergangener und geschätzter Restzeit.
  - Vorschau (Alt+P) mit Zeitschätzung wie im Bahnplaner von FluidNC (Beschleunigung, Ecken), Abspielen und Zeitschieber, Leerwege, Schattierung nach Leistung, Zoomen und Verschieben. „Hier starten“ (Start Here) lasert den Job ab der Stelle des Zeitschiebers, z. B. nach einem Abbruch: Eilgang mit Laser aus zu dieser Stelle, dann weiter mit Leistung, Vorschub und Air Assist des Layers. Die Vorschau zeigt dabei dieselbe Reihenfolge wie der Job, auch bei „Benutzer-Ursprung“ und „Aktuelle Position“.
  - Eigene G-Code-Skripte je Gerät (Geräteeinstellungen → G-Code-Skripte): „Vor dem Job“ nach G21, G90 und dem Laser-Modus, „Nach dem Job“ nach M5 und vor dem Programmende (M2 bzw. M400). Gilt für Jobs und gespeicherten G-Code, nicht für Rahmenfahrten.
  - G-Code speichern, Verschieben-Reiter (Jog in Schritten, Ursprung setzen/löschen, Laser zur Auswahl, Entsperren), Konsole mit Verlauf.
  - Geräteeinstellungen: Arbeitsbereich, S-Wert für 100 %, Baudrate, WLAN-Adresse, Eilgang und Beschleunigung, Rahmen. „Von der Maschine lesen“ holt Arbeitsbereich, Eilgang, Beschleunigung (FluidNC-Konfiguration bzw. GRBL `$$`) und bei GRBL auch die Leistungsskala `$30`.
  - Drehachse (Laser → „Drehachse …“ bzw. Laser-Menü → „Drehachse (Rotary) …“, je Gerät): Walzen oder Futter, Rotary am Y-Anschluss (statt Y-Motor) oder als eigene Achse A, B, C oder Z, Achsweg pro Umdrehung (mm bzw. Grad), Walzen- und Objektdurchmesser oder Umfang, Drehrichtung umkehren, Testdrehung (eine Objektumdrehung). Die Y-Richtung des Entwurfs wird in Achsweg umgerechnet, der Vorschub so angepasst, dass die Geschwindigkeit auf der Oberfläche stimmt; das gilt für Jobs, Bilder, Rahmen, Verschieben und „Hier starten“. Eine eigene Achse wird zu Beginn mit `G92 A0` (bzw. B, C, Z) auf die aktuelle Stellung gesetzt, der Rahmen fährt danach zum Start zurück. Im Rotary-Modus prüft Laserwerk nur X gegen das Bett, warnt, wenn der Job höher ist als der Objektumfang, und fragt vor einer Referenzfahrt nach, wenn der Rotary am Y-Anschluss steckt.
- Kamera (Fenster „Kamera“): USB-Kamera wählen, Bild entzerrt und lagerichtig unter den Objekten auf der Arbeitsfläche, Deckkraft, einmalig oder laufend aktualisieren, als Bild auf T1 einfügen (zum Nachzeichnen). Kalibrieren: 2 × 2 bis 5 × 5 Markierungen lasern (oder als G-Code speichern), im Foto anklicken; daraus werden Lage (Homographie) und ab 3 × 3 die Linsenverzeichnung berechnet, mit Restfehler in mm und entzerrter Kontrollansicht. Mehrere Kameras je Gerät, jede mit eigener Kalibrierung, gleichzeitig verbunden und eingeblendet. Kopfkamera (am Laserkopf): Kalibrierung mit kleinen Markierungen um die Kopfposition, die Bilder landen an der jeweiligen Kopfposition als Mosaik auf der Arbeitsfläche, „Bett erfassen“ bzw. „Auswahl erfassen“ fährt den Bereich ohne Laser ab und setzt ihn aus Einzelbildern zusammen; das Sichtfeld wird an der Kopfposition gestrichelt angezeigt. Unter macOS fragt das System beim ersten Verbinden nach der Kamera-Freigabe.
- Zugang für KI-Agenten über MCP (Datei → KI-Agenten (MCP)): kleiner HTTP-Server nur auf 127.0.0.1 (Port 47800, `http://127.0.0.1:47800/mcp`), standardmäßig aus, mit Token. Für Clients, die nur stdio sprechen, startet `laserwerk --mcp-stdio` eine Brücke. Vier Stufen: Lesen (Dokument, Layer, Materialien, Geräte, Schriften, Vorschaubild, Zeitschätzung), Entwerfen (Formen, Text, QR-Codes und variabler Text, Boolesche Operationen, Offset, Pfad-Werkzeuge (`path_tool`: schließen, verbinden, zerlegen, Richtung, Startpunkt, trimmen), Arrays, Biegeschnitte, Verbindungen, Layer, Import, Seiten, Dateien; jeder Aufruf ein Undo-Schritt), G-Code und Maschine. Ein Agent sendet nie rohen G-Code: Job, Rahmen und Referenzfahrt fordert er nur an, gestartet wird erst nach Bestätigung in Laserwerk; Jobs müssen im Arbeitsbereich und in den Gerätegrenzen liegen, Anhalten und Stoppen gehen immer, jede Maschinenaktion wird protokolliert. Die Maschinenstufe gilt nur bis zum Beenden der App.
- Projekt speichern und öffnen (`.lwk`, JSON, Bilder eingebettet), SVG-Export (mit Bildern), automatisches Zwischenspeichern (Bilddaten in IndexedDB).

## Noch nicht enthalten

Konische Objekte bei der Drehachse (Taper Warp, z. B. Becher).

## Übersetzungen

Texte stehen im Code auf Deutsch in `t('…')` (Platzhalter in geschweiften Klammern, `t('{n} Bilder', { n })`; Einzahl/Mehrzahl mit `tn('{n} Bild', '{n} Bilder', n)`). Die deutsche Fassung ist zugleich der Schlüssel in den Sprachdateien `src/locales/<sprache>.json`. Fehlt eine Übersetzung, erscheint der deutsche Text. Hat derselbe deutsche Text zwei Bedeutungen, bekommt er einen Kontext nach `|`, z. B. `t('Verbindung|Gerät')`.

- `npm run i18n:check` listet fehlende, unbenutzte und falsch platzierte Einträge (bricht bei Fehlendem mit Fehler ab).
- `npm run i18n:check -- --write` trägt neue Texte mit leerem Wert ein und entfernt unbenutzte; danach nur noch die leeren Werte übersetzen.
- Neue Sprache: `src/locales/fr.json` anlegen (z. B. Kopie von `en.json` mit leeren Werten), in `src/i18n.ts` bei `LANGUAGES` und `DICTS` eintragen.
- Meldungen aus dem Rust-Teil sind deutsch und werden in `src/i18n.ts` (`tBackend`) übersetzt.

## Aufbau

| Datei | Inhalt |
|---|---|
| `src/model.ts` | Datenmodell: Dokument, Objekte, Layer, Matrizen, Palette |
| `src/geom.ts` | Formen als Bézierpfade, Begrenzungsrahmen, Text-Layout, Treffertest, SVG-Pfade |
| `src/editor.ts` | Editor-Klasse: Zustand, Ansicht, Auswahl, Werkzeugwahl; bindet die Teile darunter ein |
| `src/editor/*.ts` | Teile des Editors: `document` (Undo, Autosave, Seiten), `pointer` (Mauseingaben), `keyboard`, `snapping` (Fangen), `nodes` (Knoten), `paths` (Pfad-Werkzeuge), `shapeops` (Umwandeln, Boolesche Operationen, Offset, Arrays), `joints`, `hinges`, `commands`, `objects`, `text` (QR, variabler Text, Text auf Pfad), `imageops` (Bilder, Import, Nachzeichnen), `render` (Zeichnen der Arbeitsfläche) |
| `src/ui.ts` | Menü, Aktionen der Funktionsleisten, Eigenschaftenleiste, Layer-Fenster, Palette, Statusleiste, Texteingabe |
| `src/dock.ts` | Andockbare Fenster: Reiter, Gruppen, freie Fenster, Größe, Ein-/Ausblenden, gespeicherte Anordnung |
| `src/toolbars.ts` | Anpassbare Funktionsleisten: Aktionen, Belegung, Symbolgröße, Anpassen-Dialog, Leisten ein-/ausblenden |
| `src/layerdialog.ts` | Layer-Einstellungen (Kerf, Haltestege, Füllen, Air Assist) |
| `src/fonts.ts` | Schriftdateien laden (Systemschriften über Rust, Ersatzschrift) und Text in Bézierpfade umwandeln (opentype.js) |
| `src/vartext.ts` | Variabler Text: Platzhalter, CSV einlesen, Weiterzählen |
| `src/barcode.ts`, `src/qrDialog.ts` | QR-Codes (qrcode-generator, MIT) als geschlossene Umrisse; Dialoge „QR-Code“ und „Variabler Text“ |
| `src/textpath.ts` | Text auf Pfad: Bogenlänge, Glyphen entlang der Kurve setzen |
| `src/clip.ts`, `src/curves.ts` | Clipper-Anbindung (Zerlegen, Kurvenrückführung, Buchstaben schweißen) und Bézier-Grundlagen |
| `src/ops.ts` | Boolesche Operationen und Offset (Clipper) |
| `src/pathtools.ts` | Pfad-Werkzeuge: Schließen, Auto-Join, Zerlegen, Startpunkt, Schnittpunkte und Trimmen (Bézier exakt geteilt). Tests: `npm run test:paths` |
| `src/snap.ts` | Fangen: Objektfang (Knoten, Mittelpunkt, Zentrum, Schnittpunkt, Linie) und Ausrichtungshilfen |
| `src/arrays.ts`, `src/arrayDialogs.ts` | Raster- und Kreisarray mit Dialogen und Live-Vorschau |
| `src/hinges.ts`, `src/hingeDialog.ts` | Biegeschnitte (Living Hinges): Muster und Dialog |
| `src/joints.ts`, `src/jointDialog.ts` | Verbindungen: Fingerzinken, Schlitz und Zapfen, Überblattung, Schnapp-, Haken-, Keil- und T-Slot-Verbindung |
| `src/images.ts` | Bilddaten (außerhalb von Undo, gesichert in IndexedDB), Bildverarbeitung und Dithering, Zwischenspeicher der Ergebnisse |
| `src/imagePresets.ts` | Bild-Presets (Anpassungen und Bildmodus) im lokalen Speicher |
| `src/trace.ts` | Bild nachzeichnen: Marching Squares, Vereinfachung, Kurveneinpassung |
| `src/importers.ts` | SVG- und DXF-Import |
| `src/fit.ts` | Kurvenrückführung: Linienzüge in Bézierpfade (Ecken erkennen, Schneider-Verfahren) |
| `src/gcode.ts` | Maschinenausgabe: Job aus dem Dokument (Linie, Füllen, Bilder, Reihenfolge), G-Code, Laufzeitschätzung, Rahmen, Start Here, Start-/End-Skripte, Geräteeinstellungen. Tests: `npm run test:gcode` |
| `src/camera.ts` | Kamera: Zugriff, Kalibriermodell (Homographie und radiale Verzeichnung, Levenberg-Marquardt), Entzerrung aufs Bett |
| `src/cameraui.ts` | Kamera-Reiter, Kamerabild auf der Arbeitsfläche, Kalibrier-Assistent mit Markierungen |
| `src/materials.ts`, `src/materialui.ts` | Material-Bibliothek, `.lwm`-Export/-Import, Einlesen von LightBurn-`.clb`, Reiter „Material“ |
| `src/materialtest.ts` | Materialtest: Raster mit gestuften Werten und eigenen Testlayern |
| `src/objectsPanel.ts` | Objekte-Fenster: Seiten, Layer und Objekte als Baum |
| `src/history.ts`, `src/historyPanel.ts` | Rückgängig-Verlauf mit benannten Schritten, Verlaufsfenster |
| `src/agent.ts`, `src/agentedit.ts`, `src/agentmachine.ts`, `src/agentutil.ts`, `src/agentui.ts` | Werkzeuge für KI-Agenten (MCP) nach Stufen, Sicherheitsregeln der Maschinenstufe, Einstellungsdialog |
| `src/machine.ts` | Verbindung zur Maschine aus Sicht der Oberfläche: Zustand, Statusauswertung, Klartext für Alarme, Befehle an Rust |
| `src/laser.ts` | Fenster Laser, Verschieben und Konsole, Geräteeinstellungen, Vorschau |
| `src/dom.ts` | DOM-Helfer und Zahlenfelder mit Formeln |
| `src/i18n.ts`, `src/locales/` | Mehrsprachigkeit: `t()`, Sprachwahl, englische Sprachdatei |
| `src/files.ts` | Öffnen/Speichern/Importieren (Tauri-Dialoge oder Browser), Ziehen und Einfügen, SVG-Export, bearbeitetes Bild speichern |
| `src-tauri/` | Rust-Hülle: native Dateidialoge, Dateien lesen/schreiben, Liste und Dateien der Systemschriften (fontdb) |
| `src-tauri/src/stream.rs` | G-Code-Übertragung mit Zeichenzählung, Statusabfrage, Halt/Reset (mit Tests: `cargo test`) |
| `src-tauri/src/machine.rs` | Seriell (serialport), Telnet (TCP) und WebSocket, Ereignisse an das Fenster |
| `src-tauri/src/ws.rs` | WebSocket zur Steuerung (tungstenite) als Byte-Strom für die Übertragung, mit Test gegen ein nachgebildetes FluidNC |
| `src-tauri/src/agent.rs` | MCP-Server (Streamable HTTP auf 127.0.0.1, Token, Stufen) und stdio-Brücke `--mcp-stdio` |
| `src-tauri/core/` | Rechenkern ohne Oberfläche (`laserwerk-core`): Bildverarbeitung und Dithering, Rasterzeilen der Bilder, G-Code schreiben. Rechnet wie `images.ts`/`gcode.ts`, die Desktop-App nutzt ihn, der Browser die TypeScript-Fassung. Vergleichstest: `npm run test:core` |
| `src-tauri/src/native.rs` | Rechenkern für die Oberfläche: Graustufen der Bilder und fertiger G-Code bleiben in Rust |
| `src/native.ts` | Aufruf des Rechenkerns aus der Oberfläche |

Intern rechnet der Editor in mm mit y nach unten; angezeigt wird in Maschinenkoordinaten (Ursprung unten links).

## Marken

LightBurn ist eine Marke der LightBurn Software, LLC. Laserwerk ist ein unabhängiges Projekt und steht in keiner Verbindung zu LightBurn Software; es wird von dort weder unterstützt noch empfohlen.
