<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/kizamubeam-logo-dark.png">
    <img src="docs/brand/kizamubeam-logo.png" alt="KizamuBeam" width="520">
  </picture>
</p>

# KizamuBeam

English · [Deutsch](README.de.md)

Free laser software for designing, editing images and sending jobs straight to the laser. The workflow follows LightBurn, so people switching over find their way around right away.
Stack: Tauri 2, TypeScript (UI, editor, G-code), Rust (desktop shell, machine connection, MCP server). License: GPL-3.0-or-later (see `LICENSE`). Version: 1.0.0-alpha.

“Kizamu” (刻む) is Japanese for to carve, to engrave, to cut finely. Up to version 1.0.0-alpha the project was called Laserwerk; settings, devices and material libraries carry over on the first start, and old `.lwk` projects and `.lwm` libraries still open.

## Logo

Logo files are in [`docs/brand/`](docs/brand/): logo with symbol, wordmark, symbol in color and monochrome, symbol above the wordmark, each also as `-dark` for dark backgrounds, plus the app icon (`kizamubeam-app-icon.png`, source for `npx tauri icon`).

## Getting started

Requirements: Node.js 20+, Rust (stable), on Linux also `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `build-essential`, `libssl-dev`
(see https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev      # desktop app with live reload
npm run dev            # UI only, in the browser: http://localhost:1420
npm run tauri build    # installer package
```

On Windows, `npm run tauri build` only builds the NSIS installer (`.exe`, see `src-tauri/tauri.windows.conf.json`), because the MSI installer does not accept pre-release versions such as `1.0.0-alpha`.

## Features

- Familiar layout: menu, main toolbar, numeric edits toolbar at the top, tools on the left, Cuts / Layers and Laser on the right, color palette 00–29 plus T1/T2 at the bottom, status bar.
- Customizable interface:
  - Tool windows (Cuts / Layers, Objects, Laser, Move, Console, Material, Camera) can be docked individually. Drag a tab onto another tab header to add it as a tab, onto the top or bottom edge of a group to place it above or below, onto the left edge next to the tools toolbar for the left dock, or onto the workspace to make it a floating window (move by its header, resize at the bottom-right corner, ⇥ or double-click docks it on the right).
  - Size: the dividers between windows and the inner edge of the docks can be dragged. ▾ or a double-click on the header collapses a group.
  - × on a tab hides a window; the Window menu shows and hides windows and bars (Main Toolbar, Tools Toolbar, Numeric Edits Toolbar, Color Palette, Status Bar).
  - Customize toolbars (Window → Toolbars or right-click on the main or tools toolbar): add actions from every area, remove them, reorder by dragging or with ↑/↓, insert separators, icon size small/normal/large; actions without an icon appear as text. Button groups (zoom, mirror and rotate, align and distribute, Boolean operations, path tools, arrays) take a single slot: the button runs the most recently chosen action, the ▾ arrow next to it shows all of them. Older saved toolbars are merged into the groups automatically. “Restore defaults” resets a toolbar.
  - Layout and toolbars are saved per user (`localStorage`: `kizamubeam.layout`, `kizamubeam.toolbars`); Window → Reset Windows and Toolbars restores the initial state.
- Workspace as the machine bed in mm (default 400 × 400, adjustable in Device Settings), grid, rulers, origin at the bottom left, zoom with the mouse wheel, pan with the space bar or middle mouse button.
- Drawing: lines and Bézier curves, rectangle with corner radius, ellipse, polygon and star, text (multi-line, font, height, bold, italic, upper case, letter and line spacing, alignment).
- Editing: select by click and marquee (to the right: enclosing, to the left: crossing), move, scale, rotate with the mouse (drag just outside a corner or click the selection a second time; movable pivot, Shift 15°, Ctrl 5°, Esc cancels), numeric fields with a 9-point anchor and formulas with units (“100/3”, “2in”), node editing (select nodes by click, Shift+click, marquee or Ctrl+A, drag them together or nudge with the arrow keys; Del deletes, L line, C curve, E corner, S smooth, I insert, B break the path at the node, T trim the edge back to the intersections), Convert to Path, group, mirror, align, distribute, copy, duplicate, undo.
- Snapping (“Snap” and “Grid” in the status bar): to nodes, midpoints, centers, intersections and lines, and to the grid with adjustable spacing. Ctrl while dragging inverts snapping, Alt snaps more strongly and shows alignment guides on other objects.
- Arrays (Tools → Array → Grid Array, Ctrl+Shift+A, and Circular Array) with live preview: copies in columns and rows with gap or center spacing, direction, offset and mirroring of every other row/column, or in a circle around a center point. Bézier curves are preserved exactly.
- Text on a path (Tools → Text Functions → Apply Path to Text, or “On Path” in the text toolbar): select a text and a shape, and the text follows the line, curve, rectangle, ellipse or polygon. Open curves start at the beginning, middle or end depending on alignment, closed shapes at the topmost point. In the text toolbar: offset along the curve, distance from the curve, switch side, detach. Text and shape stay linked: if the shape is moved or edited, the text follows; if only the text is moved, the shape moves with it. The shape is lasered too, unless it is on a tool layer (T1/T2) or hidden; if it is deleted, the text keeps the last curve.
- QR codes (QR icon in the tools toolbar on the left, or Tools → QR Code …): text or web address, Wi-Fi access or contact (vCard), error correction L/M/Q/H, size in mm; “Negative Image” lasers the background including the quiet zone (for dark materials). Adjacent modules are merged into closed outlines, so a fill layer engraves the code. A double-click reopens the code for editing; Convert to Path turns it into ordinary shapes.
- Variable text (“Variable” in the text toolbar, in the QR dialog, Tools → Text Functions → Variable Text …): placeholders for a serial number (`%#`, with leading zeros `%4#`), date and time (`%d.%m.%Y`, `%H:%M` …) and columns of a CSV file (`%0`, `%1` … or `%{Header}`; comma, semicolon or tab). One project-wide number serves as both serial number and CSV row; start, end, step and auto-advance after each job (after Start and after saving G-code) are set in the “Variable Text” window, and each object has its own offset. “Max width” in the text toolbar condenses lines that are too long. Tools → Text Functions → Bake Variable Text turns the current content into fixed text. Tests: `npm run test:vartext`.
- Weld letters (“Weld” in the text toolbar): overlapping characters merge into one outline, e.g. for script fonts or tight letter spacing; applies to display, lasering, export and conversion.
- Convert text to paths (Ctrl+Shift+C) with the real font outlines: in the desktop app from the installed system fonts, in the browser with Roboto as a fallback.
- Boolean operations: weld, difference, intersection. “Boolean Options” sets the base (first selected, backmost or frontmost shape) and whether the originals are kept; the Tools → Boolean Operations menu also has “Subtract front from back” and “Subtract back from front”. Texts and groups are automatically treated as outlines.
- Offset Shapes (Alt+O) outward, inward or both, with round, sharp or beveled corners and live preview. Open lines get a closed outline.
- Path tools (Tools → Path); all results remain Bézier curves:
  - Close path: closes open paths whose start and end are at most 0.5 mm apart. “Close paths with tolerance …” with a slider up to 20 mm, insert a line or pull the ends together, and a count of how many open shapes will be closed.
  - Auto-join selected shapes (Alt+J): open paths whose ends are at most 0.05 mm apart become one path; if the ends of a chain meet, it is closed.
  - Break apart (Alt+B): split paths, shapes and texts into their individual lines and curves.
  - Trim shapes (Ctrl+K): hover over a curve, the segment up to the next intersections turns red and is removed with a click (without an intersection, the whole path). The remaining pieces are joined to adjacent paths at the intersections, so two overlapping circles become one outline after two clicks. Ctrl+click does not join, Shift+click keeps the removed piece on the current layer. Ungroup groups first.
  - Set start point: click a node and the cut starts there; Shift+click reverses the direction, Ctrl+click hands start point and direction back to the optimizer. Blue arrow = set, gray = default. A set start point also applies with “Optimize path” (only the order of the shapes is still optimized); with kerf compensation a new outline is created, and the optimizer chooses there. “Reverse direction” flips the cut direction.
- Results of Boolean operations and offset are Bézier paths again: corners and straight segments are preserved, and rounded parts are fitted as curves with at most 0.02 mm deviation.
- Joints for laser-cut parts (“Joint” tool): finger joints and tab-and-slot on straight edges of existing shapes, with material thickness, kerf and clearance (negative = press fit). Edge 1 gets the fingers or tabs, edge 2 the counterpart or the slots; a single drawn line is replaced by the slots. The result stays an ordinary, editable path.
- Cross-lap joints in the same tool: both edges get slots of material thickness, and the depth is a share of the board width (edge 1 e.g. 50 %, edge 2 the rest). Several slots divide the edge into equal compartments, for grid inserts and bottle dividers, for example.
- Snap-fit and hook joints in the same tool: snap tabs with two flexible tongues and catch hooks (overhang, hook length and spring slot adjustable), and L-shaped hook tabs whose slot is lengthened by the hook length (insert, then slide).
- Wedge tenons and T-slots with nuts in the same tool: wedge tenons pass through the mating board and have a wedge hole; matching wedges are created as well. With T-slots, a screw slot with a nut window sits between every two tabs, and the mating board gets the hole (screw, nut and screw length adjustable).
- Living hinges (Tools → Living Hinge): fills a selected closed shape with a cut pattern so the board bends there. Patterns: straight cuts, waves, diamonds, honeycomb, triangles, weave and spiral, with live preview and starting values derived from the material thickness. The cuts are exact lines and Bézier curves.
- Color is the layer: clicking a palette color assigns the selection to it. Layer table with mode (Line/Fill), speed, power, air assist, output, visibility and quick editing.
- Cut Settings (double-click a layer): kerf offset, tabs (count or spacing, skip inner shapes), scan angle, cross-hatch, bidirectional, overscan, air assist (M8 or M7, off with M9; configurable in Device Settings). The settings are stored as `CutSettings` in the layer (`src/model.ts`).
- Material library (“Material” window): save cut settings (optionally image settings too) per material and thickness and apply them to layers. Exchange via `.kzm` files (JSON; older `.lwm` files can still be imported); LightBurn libraries (`.clb`) can be imported as far as their fields have an equivalent.
- Material test (Laser → Material Test): a grid with two stepped values (e.g. rows speed, columns power) with labels, each cell with its own test layer. The test goes to the laser directly via Preview, Frame, Start or G-code without changing the document; the cells run in order of increasing energy.
- Objects window (on the right below the layers, shown and hidden via the Window menu): tree of layers and their objects, expandable groups, frontmost object on top. A click selects (Shift/Ctrl adds), and the selection on the workspace follows along. Double-click a name to rename an object or layer. Eye: hide (hidden objects are not drawn, lasered or exported). Lock: lock (not selectable on the workspace), also for whole layers. Dragging changes the stacking order, moves objects to another layer or reorders layers in the output order. Name, `hidden` and `locked` are stored in the object (`src/model.ts`) and appear in the MCP server’s `get_document`.
- Multi-page projects: a project has one or more pages (top of the Objects window, Pages menu, Page Up/Down to switch). Each page has its own objects; cut settings apply to the whole project. Drawing, editing, lasering and export (SVG, G-code) work on the current page. Pages can be added, duplicated, renamed (double-click), deleted and reordered by dragging; drag objects onto a page row to move them there. File format from `version: 2` with `pages` and `page`; older files open as a project with one page. MCP: `get_document` (with `pages`), `switch_page`, `edit_pages`, `move_to_page`.
- History window (tab next to Objects, Window menu): the last changes (up to 200) as a list with names such as “Move”, “Offset” or “Edit text” and the time. A click on a row jumps there, several steps back or forward at once; undone steps are shown greyed out below the current state and can be redone with a click until a new change discards them. Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) still step one at a time. Each MCP call appears as one step named after its tool.
- Interface in German and English (View → Language). The default follows the system language (other system languages get English), the choice is remembered; the English terms are the ones laser users already know.
- Light and dark theme (View → Theme, or the button at the far right of the toolbar); the default follows the system. In the dark theme, very dark layer colors are lightened on the workspace.
- Import (Ctrl+I, drag from the file manager, or Ctrl+V from other programs): images (PNG, JPG, BMP, GIF, WebP, TIFF), SVG and DXF.
  - Images take their size from the file’s resolution (254 DPI if none is given; oversized images are scaled down to the bed).
  - TIFF (including LZW, Deflate, 16 bit) is read with utif and stored as PNG; for multi-page files the first page is used.
  - SVG: paths including arcs, rectangles, circles, ellipses, lines, polygons, `use`, transforms, CSS classes, embedded images; units via `width`/`height` and `viewBox`. Texts are skipped.
  - DXF: LINE, LWPOLYLINE/POLYLINE with arcs, CIRCLE, ARC, ELLIPSE, SPLINE, INSERT (blocks), units from `$INSUNITS`. Individual lines are joined into continuous paths.
  - Colors are mapped to the nearest palette color (= layer), and multiple objects are inserted as a group.
- Image editing: images are a separate “Image” entry in the layer table with image mode (Threshold, Ordered, Atkinson, Floyd-Steinberg, Stucki, Jarvis, Newsprint, Halftone, Sketch, Grayscale), line interval/DPI, negative image, bidirectional, overscan, speed and power. “Adjust Image” (brightness, contrast, gamma, sharpening with radius, and denoise) with preview, comparison with the original and a 1:1 crop view. The workspace shows the rasterized result at laser resolution.
  - Newsprint places a round dot in each screen cell (cells per inch, screen angle) whose area matches the cell’s brightness. Sketch turns edges into dark strokes and leaves even areas blank; it is lasered like grayscale, with power between min and max.
  - Image presets in “Adjust Image”: save adjustments and image mode (with threshold, cells and angle) under a name, apply and delete them. Speed, power and line interval belong in the material library.
- Crop image and apply mask (Tools menu, or buttons in the toolbar when an image and shapes are selected): cropping trims the image to the shape’s bounding box, the mask keeps only the inside of the closed shapes (text too), and the rest becomes transparent and is not lasered. The image stays in place at its original resolution, the shapes are removed, and Ctrl+Z undoes both.
- Trace Image (Alt+T): threshold, ignore small specks, smoothing, live preview. The result is Bézier paths with preserved corners.
- Save Processed Bitmap (the dithered image as PNG, exactly as it would be lasered).
- Machine output for FluidNC/GRBL (Laser, Move and Console windows at the bottom right):
  - Save and select multiple devices (top of the Laser window, Laser → Device → Devices …). New devices from templates for common lasers (Swiitol, Ortur, Atomstack, Sculpfun, xTool, Creality Falcon, Two Trees) or generic per controller. The workspace bed follows the selected device.
  - Controllers: FluidNC, GRBL 1.1, grblHAL (character counting, real-time status, M4), Marlin (line by line, position via M114, inline laser `M3 I`, pause by holding back lines, stop with M410) and Smoothieware (line by line, S 0 … 1). Home, jogging, origin and console buttons adapt accordingly.
  - Connect via USB serial or Wi-Fi (Telnet, port 23, or WebSocket, FluidNC port 81; if it is unreachable, 80 is tried). Status, position and laser head on the workspace, alarms in plain language.
  - Start, Pause/Resume, Stop (hold and reset, position is kept), Frame as a rectangle or outline (optionally with a low-power laser), Home, Move to origin.
  - Start from: Absolute Coords, User Origin or Current Position, each with a 9-point job origin. “Cut Selected Graphics” lasers only the selected objects.
  - Work area check before every job and frame: all moves including overscan are checked in machine coordinates, using the work offset the controller reports (GRBL/FluidNC `WCO`), so a wrongly set user origin is caught before starting. If the controller has not reported the origin yet (or never does, as with Marlin), a warning shows the job's extent from the origin and must be confirmed.
  - G-code in laser mode (M4): lines in optimized order (inner shapes first, short travel moves, best start node), fill with line interval, scan angle, cross-hatch, overscan and bidirectional, kerf offset per object, tabs as segments without power, air assist per layer, images in all image modes (grayscale with power between min and max), passes, layer order. Texts are lasered with their font outlines.
  - Streaming with character counting (127-byte receive buffer) in the Rust core, progress with elapsed and estimated remaining time.
  - Preview (Alt+P) with a time estimate like FluidNC’s motion planner (acceleration, corners), playback and time slider, travel moves, shading by power, zoom and pan. “Start Here” lasers the job from the time slider’s position, e.g. after an abort: rapid move with the laser off to that point, then continue with the layer’s power, feed and air assist. The preview shows the same order as the job, also with “User Origin” and “Current Position”.
  - Custom G-code scripts per device (Device Settings → G-code scripts): “Before the job” after G21, G90 and the laser mode, “After the job” after M5 and before the program end (M2 or M400). Applies to jobs and saved G-code, not to framing.
  - Save G-code, Move tab (jog in steps, set/clear origin, Move Laser to Selection, Unlock), console with history.
  - Device Settings: work area, S value for 100 %, baud rate, Wi-Fi address, rapid speed and acceleration, frame. “Read from Machine” fetches work area, rapid speed, acceleration (FluidNC configuration or GRBL `$$`) and, for GRBL, the power scale `$30`.
  - Rotary (Laser → “Rotary …” or Laser menu → Device → “Rotary Setup …”, per device): roller or chuck, rotary on the Y port (instead of the Y motor) or as a separate A, B, C or Z axis, axis travel per revolution (mm or degrees), roller and object diameter or circumference, reverse direction, test rotation (one object revolution). The design’s Y direction is converted into axis travel, and the feed is adjusted so the speed on the surface is correct; this applies to jobs, images, frame, Move and “Start Here”. A separate axis is set to its current position with `G92 A0` (or B, C, Z) at the start, and the frame returns to the start afterwards. In rotary mode KizamuBeam only checks X against the bed, warns when the job is taller than the object’s circumference, and asks for confirmation before homing when the rotary is plugged into the Y port.
- Camera (“Camera” window): choose a USB camera; the image is undistorted and placed correctly under the objects on the workspace, with opacity, single or continuous updates, and Insert as Image on T1 (for tracing). Calibrate: laser 2 × 2 to 5 × 5 markers (or save them as G-code) and click them in the photo; this computes the placement (homography) and, from 3 × 3, the lens distortion, with the residual error in mm and an undistorted check view. Multiple cameras per device, each with its own calibration, connected and overlaid at the same time. Head camera (on the laser head): calibration with small markers around the head position; images land at the respective head position as a mosaic on the workspace, and “Capture bed” or “Capture selection” scans the area without the laser and stitches it from individual shots; the field of view is shown dashed at the head position. On macOS the system asks for camera permission on the first connection.
- Access for AI agents via MCP (File → AI Agents (MCP)): a small HTTP server on 127.0.0.1 only (port 47800, `http://127.0.0.1:47800/mcp`), off by default, with a token. For clients that only speak stdio, `kizamubeam --mcp-stdio` starts a bridge. Four levels: read (document, layers, materials, devices, fonts, preview image, time estimate), design (shapes, text, QR codes and variable text, Boolean operations, offset, path tools (`path_tool`: close, join, break apart, direction, start point, trim), arrays, living hinges, joints, layers, import, pages, files; each call is one undo step), G-code, and machine. An agent never sends raw G-code: it can only request a job, frame or homing, which starts only after confirmation in KizamuBeam; jobs must lie within the work area and device limits, pause and stop always work, and every machine action is logged. The machine level only lasts until the app is closed.
- Save and open projects (`.kzb`, JSON, images embedded; older `.lwk` files still open), SVG export (with images), automatic backup (image data in IndexedDB).

## Not yet included

Tapered objects for the rotary (taper warp, e.g. cups).

## Translations

UI texts are written in German in the code inside `t('…')` (placeholders in curly braces, `t('{n} Bilder', { n })`; singular/plural with `tn('{n} Bild', '{n} Bilder', n)`). The German text is also the key in the language files `src/locales/<language>.json`. If a translation is missing, the German text is shown. If the same German text has two meanings, it gets a context after `|`, e.g. `t('Verbindung|Gerät')`.

- `npm run i18n:check` lists missing, unused and misplaced entries (fails if anything is missing).
- `npm run i18n:check -- --write` adds new texts with an empty value and removes unused ones; afterwards only the empty values need translating.
- New language: create `src/locales/fr.json` (e.g. a copy of `en.json` with empty values) and register it in `LANGUAGES` and `DICTS` in `src/i18n.ts`.
- Messages from the Rust side are in German and are translated in `src/i18n.ts` (`tBackend`).

## Structure

| File | Contents |
|---|---|
| `src/model.ts` | Data model: document, objects, layers, matrices, palette |
| `src/geom.ts` | Shapes as Bézier paths, bounding boxes, text layout, hit testing, SVG paths |
| `src/editor.ts` | Editor class: state, view, selection, tool choice; pulls in the parts below |
| `src/editor/*.ts` | Editor parts: `document` (undo, autosave, pages), `pointer` (mouse input), `keyboard`, `snapping`, `nodes`, `paths` (path tools), `shapeops` (convert, booleans, offset, arrays), `joints`, `hinges`, `commands`, `objects`, `text` (QR, variable text, text on path), `imageops` (images, import, trace), `render` (drawing the workspace) |
| `src/ui.ts` | Menu, toolbar actions, numeric edits toolbar, layer window, palette, status bar, text input |
| `src/storageMigration.ts` | Copies settings saved under the old name (`laserwerk.*`) to `kizamubeam.*` on first start |
| `src/dock.ts` | Dockable windows: tabs, groups, floating windows, sizing, show/hide, saved layout |
| `src/toolbars.ts` | Customizable toolbars: actions, contents, icon size, customize dialog, show/hide bars |
| `src/layerdialog.ts` | Cut settings (kerf, tabs, fill, air assist) |
| `src/fonts.ts` | Load font files (system fonts via Rust, fallback font) and convert text to Bézier paths (opentype.js) |
| `src/vartext.ts` | Variable text: placeholders, CSV import, auto-advance |
| `src/barcode.ts`, `src/qrDialog.ts` | QR codes (qrcode-generator, MIT) as closed outlines; “QR Code” and “Variable Text” dialogs |
| `src/textpath.ts` | Text on a path: arc length, placing glyphs along the curve |
| `src/clip.ts`, `src/curves.ts` | Clipper bindings (flattening, curve refitting, welding letters) and Bézier basics |
| `src/ops.ts` | Boolean operations and offset (Clipper) |
| `src/pathtools.ts` | Path tools: close, auto-join, break apart, start point, intersections and trimming (exact Bézier splitting). Tests: `npm run test:paths` |
| `src/snap.ts` | Snapping: object snap (node, midpoint, center, intersection, line) and alignment guides |
| `src/arrays.ts`, `src/arrayDialogs.ts` | Grid and circular arrays with dialogs and live preview |
| `src/hinges.ts`, `src/hingeDialog.ts` | Living hinges: patterns and dialog |
| `src/joints.ts`, `src/jointDialog.ts` | Joints: finger joints, tab-and-slot, cross-lap, snap-fit, hook, wedge and T-slot joints |
| `src/images.ts` | Image data (outside undo, backed up in IndexedDB), image processing and dithering, result cache |
| `src/imagePresets.ts` | Image presets (adjustments and image mode) in local storage |
| `src/trace.ts` | Trace image: marching squares, simplification, curve fitting |
| `src/importers.ts` | SVG and DXF import |
| `src/fit.ts` | Curve refitting: polylines to Bézier paths (corner detection, Schneider’s algorithm) |
| `src/gcode.ts` | Machine output: job from the document (line, fill, images, order), G-code, runtime estimate, frame, Start Here, start/end scripts, device settings. Tests: `npm run test:gcode` |
| `src/camera.ts` | Camera: access, calibration model (homography and radial distortion, Levenberg-Marquardt), undistortion onto the bed |
| `src/cameraui.ts` | Camera tab, camera image on the workspace, calibration wizard with markers |
| `src/materials.ts`, `src/materialui.ts` | Material library, `.kzm` export/import, reading LightBurn `.clb`, “Material” tab |
| `src/materialtest.ts` | Material test: grid with stepped values and its own test layers |
| `src/objectsPanel.ts` | Objects window: pages, layers and objects as a tree |
| `src/history.ts`, `src/historyPanel.ts` | Undo history with named steps, History window |
| `src/agent.ts`, `src/agentedit.ts`, `src/agentmachine.ts`, `src/agentutil.ts`, `src/agentui.ts` | Tools for AI agents (MCP) by level, safety rules of the machine level, settings dialog |
| `src/machine.ts` | Machine connection from the UI’s side: state, status parsing, plain-language alarms, commands to Rust |
| `src/laser.ts` | Laser, Move and Console windows, device settings, preview |
| `src/dom.ts` | DOM helpers and numeric fields with formulas |
| `src/i18n.ts`, `src/locales/` | Localization: `t()`, language selection, English language file |
| `src/files.ts` | Open/save/import (Tauri dialogs or browser), drag and paste, SVG export, save processed bitmap |
| `src-tauri/` | Rust shell: native file dialogs, reading/writing files, list and files of the system fonts (fontdb) |
| `src-tauri/src/stream.rs` | G-code streaming with character counting, status queries, hold/reset (with tests: `cargo test`) |
| `src-tauri/src/machine.rs` | Serial (serialport), Telnet (TCP) and WebSocket, events to the window |
| `src-tauri/src/ws.rs` | WebSocket to the controller (tungstenite) as a byte stream for streaming, with a test against a simulated FluidNC |
| `src-tauri/src/agent.rs` | MCP server (Streamable HTTP on 127.0.0.1, token, levels) and stdio bridge `--mcp-stdio` |
| `src-tauri/core/` | Computation core without UI (`kizamubeam-core`): image processing and dithering, image raster lines, writing G-code. Computes the same as `images.ts`/`gcode.ts`; the desktop app uses it, the browser uses the TypeScript version. Comparison test: `npm run test:core` |
| `src-tauri/src/native.rs` | Computation core for the UI: image grayscale data and finished G-code stay in Rust |
| `src/native.ts` | Calls into the computation core from the UI |

Internally the editor works in mm with y pointing down; the display uses machine coordinates (origin at the bottom left).

## Trademarks

LightBurn is a trademark of LightBurn Software, LLC. KizamuBeam is an independent project and is not affiliated with or endorsed by LightBurn Software.
