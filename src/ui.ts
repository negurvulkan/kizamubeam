// Oberfläche: Menü, Leisten, Panels, Palette, Statusleiste.
import { Editor, Tool } from './editor';
import { ICONS } from './icons';
import { DITHER_MODES, DitherMode, ImageAdjust, ImageLayer, ImageShape, Layer, layerLabel, Obj, PALETTE, SubPath, TextShape } from './model';
import { exportSvg, importFile, installDropAndPaste, openProject, saveProcessedBitmap, saveProject } from './files';
import { assetImage, displayCanvas, outputGrid } from './images';
import { systemFonts } from './fonts';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k === 'class') el.className = String(v);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined) el.append(c);
  return el;
}

const iconBtn = (icon: string, title: string, onclick: () => void, id?: string) =>
  h('button', { class: 'ib', title, html: ICONS[icon], onclick, id });

const sep = () => h('div', { class: 'sep' });

/** Zahlenfeld-Auswertung mit Einheiten und Grundrechenarten: „5in“, „100/3“, „2*(3+4)cm“. */
export function evalExpr(src: string): number | null {
  const s = src.replace(/,/g, '.').trim().toLowerCase();
  let i = 0;
  const peek = () => s[i];
  const ws = () => {
    while (s[i] === ' ') i++;
  };
  const unit = (v: number) => {
    ws();
    const m = /^(mm|cm|in|"|m)/.exec(s.slice(i));
    if (!m) return v;
    i += m[0].length;
    return v * ({ mm: 1, cm: 10, in: 25.4, '"': 25.4, m: 1000 } as Record<string, number>)[m[0]];
  };
  const atom = (): number => {
    ws();
    if (peek() === '(') {
      i++;
      const v = sum();
      ws();
      if (peek() !== ')') throw 0;
      i++;
      return unit(v);
    }
    if (peek() === '-') {
      i++;
      return -atom();
    }
    const m = /^\d*\.?\d+(e[-+]?\d+)?/.exec(s.slice(i));
    if (!m) throw 0;
    i += m[0].length;
    return unit(parseFloat(m[0]));
  };
  const prod = (): number => {
    let v = atom();
    for (;;) {
      ws();
      if (peek() === '*') (i++, (v *= atom()));
      else if (peek() === '/') (i++, (v /= atom()));
      else return v;
    }
  };
  const sum = (): number => {
    let v = prod();
    for (;;) {
      ws();
      if (peek() === '+') (i++, (v += prod()));
      else if (peek() === '-') (i++, (v -= prod()));
      else return v;
    }
  };
  try {
    const v = sum();
    ws();
    return i === s.length && isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

const f2 = (v: number) => (Math.round(v * 1000) / 1000).toFixed(Math.abs(v) >= 1000 ? 1 : 2);

/** Eingabefeld, das bei Enter/Verlassen einen Ausdruck auswertet. */
function numInput(cls: string, onCommit: (v: number) => void, title?: string) {
  const el = h('input', { type: 'text', class: cls, title }) as HTMLInputElement;
  let before = '';
  el.addEventListener('focus', () => {
    before = el.value;
    el.select();
  });
  const commit = () => {
    if (el.value === before) return;
    const v = evalExpr(el.value);
    if (v === null) el.value = before;
    else {
      before = el.value;
      onCommit(v);
    }
  };
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      commit();
      el.blur();
    } else if (e.key === 'Escape') {
      el.value = before;
      el.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const v = evalExpr(el.value) ?? 0;
      const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      el.value = f2(v + (e.key === 'ArrowUp' ? step : -step));
      commit();
    }
  });
  el.addEventListener('blur', commit);
  return el;
}

const setVal = (el: HTMLInputElement, v: string) => {
  if (document.activeElement !== el) el.value = v;
};

const FONT_CANDIDATES = [
  'Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Calibri', 'Times New Roman', 'Georgia',
  'Garamond', 'Courier New', 'Consolas', 'Impact', 'Comic Sans MS', 'DejaVu Sans', 'DejaVu Serif', 'DejaVu Sans Mono',
  'Liberation Sans', 'Liberation Serif', 'Liberation Mono', 'Noto Sans', 'Noto Serif', 'Ubuntu', 'Cantarell',
  'Roboto', 'Open Sans', 'Helvetica Neue', 'Menlo', 'Monaco', 'Avenir', 'Futura', 'Gill Sans',
];

function availableFonts(): string[] {
  const c = document.createElement('canvas').getContext('2d')!;
  const sample = 'abcdefghijklmnopqrstuvwxyzWMI0123456789';
  const widths = (fb: string) => {
    c.font = `40px ${fb}`;
    return c.measureText(sample).width;
  };
  const base = { monospace: widths('monospace'), serif: widths('serif'), 'sans-serif': widths('sans-serif') };
  const found = FONT_CANDIDATES.filter((f) =>
    (Object.keys(base) as (keyof typeof base)[]).some((fb) => {
      c.font = `40px "${f}", ${fb}`;
      return c.measureText(sample).width !== base[fb];
    }),
  );
  return [...found, 'sans-serif', 'serif', 'monospace'];
}

// ======================================================================

// ---------- Design (hell/dunkel) ----------

type ThemeMode = 'system' | 'light' | 'dark';
const THEME_KEY = 'laserwerk.theme';
let themeMode: ThemeMode = 'system';
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const themeListeners = new Set<() => void>();

export function isDark() {
  return themeMode === 'dark' || (themeMode === 'system' && darkQuery.matches);
}

function applyTheme(ed: Editor, mode: ThemeMode) {
  themeMode = mode;
  const root = document.documentElement;
  if (mode === 'system') delete root.dataset.theme;
  else root.dataset.theme = mode;
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* Speicher nicht verfügbar */
  }
  ed.setDark(isDark());
  themeListeners.forEach((f) => f());
}

function initTheme(ed: Editor) {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {
    saved = null;
  }
  applyTheme(ed, saved === 'light' || saved === 'dark' ? saved : 'system');
  darkQuery.addEventListener('change', () => themeMode === 'system' && applyTheme(ed, 'system'));
}

export function buildUI(ed: Editor) {
  initTheme(ed);
  buildMenu(ed);
  buildToolbar(ed);
  buildNumbar(ed);
  buildTools(ed);
  buildLayers(ed);
  buildLaser(ed);
  buildPalette(ed);
  buildStatus(ed);
  buildTextEditor(ed);
  ed.onImport = () => importFile(ed);
  installDropAndPaste(ed, $('#stage'));
  window.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
    if (e.altKey && !e.ctrlKey && e.key.toLowerCase() === 't' && ed.selImages().length) {
      e.preventDefault();
      openTraceDialog(ed);
    }
  });
}

// ---------- Menü ----------

type MenuItem = [label: string, key: string, action: () => void] | 'sep';

function buildMenu(ed: Editor) {
  const menus: [string, MenuItem[]][] = [
    ['Datei', [
      ['Neu', '', () => ed.newDocument()],
      ['Öffnen …', '', () => openProject(ed)],
      ['Speichern …', '', () => saveProject(ed)],
      'sep',
      ['Importieren …', 'Ctrl+I', () => importFile(ed)],
      ['Als SVG exportieren …', '', () => exportSvg(ed)],
      ['Bearbeitetes Bild speichern …', '', () => saveProcessedBitmap(ed)],
    ]],
    ['Bearbeiten', [
      ['Rückgängig', 'Ctrl+Z', () => ed.doUndo()],
      ['Wiederholen', 'Ctrl+Y', () => ed.doRedo()],
      'sep',
      ['Ausschneiden', 'Ctrl+X', () => ed.cut()],
      ['Kopieren', 'Ctrl+C', () => ed.copy()],
      ['Einfügen', 'Ctrl+V', () => ed.paste()],
      ['Duplizieren', 'Ctrl+D', () => ed.duplicate()],
      ['Löschen', 'Entf', () => ed.deleteSel()],
      'sep',
      ['Alles auswählen', 'Ctrl+A', () => ed.selectAll()],
      ['In Pfad umwandeln', 'Ctrl+Shift+C', () => ed.convertSelToPath()],
    ]],
    ['Werkzeuge', [
      ['Auswählen', 'Esc', () => ed.setTool('select')],
      ['Knoten bearbeiten', 'Ctrl+`', () => ed.setTool('node')],
      ['Linien zeichnen', 'Ctrl+L', () => ed.setTool('line')],
      ['Rechteck', 'Ctrl+R', () => ed.setTool('rect')],
      ['Ellipse', 'Ctrl+E', () => ed.setTool('ellipse')],
      ['Polygon', '', () => ed.setTool('polygon')],
      ['Text', 'Ctrl+T', () => ed.setTool('text')],
      'sep',
      ['Vereinen', '', () => ed.booleanSel('union')],
      ['Abziehen', '', () => ed.booleanSel('subtract')],
      ['Schnittmenge', '', () => ed.booleanSel('intersect')],
      ['Offset …', 'Alt+O', () => openOffsetDialog(ed)],
      'sep',
      ['Bild anpassen …', '', () => openAdjustDialog(ed)],
      ['Bild nachzeichnen …', 'Alt+T', () => openTraceDialog(ed)],
    ]],
    ['Anordnen', [
      ['Gruppieren', 'Ctrl+G', () => ed.group()],
      ['Gruppierung aufheben', 'Ctrl+U', () => ed.ungroup()],
      'sep',
      ['Horizontal spiegeln', 'Ctrl+Shift+H', () => ed.mirror(true)],
      ['Vertikal spiegeln', 'Ctrl+Shift+V', () => ed.mirror(false)],
      ['90° im Uhrzeigersinn', '.', () => ed.rotateBy(-90)],
      ['90° gegen Uhrzeigersinn', ',', () => ed.rotateBy(90)],
      'sep',
      ['Links ausrichten', 'L', () => ed.align('left')],
      ['Rechts ausrichten', 'R', () => ed.align('right')],
      ['Oben ausrichten', 'T', () => ed.align('top')],
      ['Unten ausrichten', 'B', () => ed.align('bottom')],
      ['Mitten horizontal', 'C', () => ed.align('hcenter')],
      ['Mitten vertikal', 'E', () => ed.align('vcenter')],
      ['Horizontal verteilen', '', () => ed.distribute(true)],
      ['Vertikal verteilen', '', () => ed.distribute(false)],
    ]],
    ['Ansicht', [
      ['Ganze Seite', 'Ctrl+0', () => ed.zoomPage()],
      ['Auf Auswahl zoomen', '', () => ed.zoomSelection()],
      ['Vergrößern', '+', () => ed.zoomAt(1.25)],
      ['Verkleinern', '-', () => ed.zoomAt(0.8)],
      'sep',
      ['Drahtgitter / Gefüllt', 'Alt+W', () => ((ed.filled = !ed.filled), ed.emit('view'))],
      'sep',
      ['Design: wie System', '', () => applyTheme(ed, 'system')],
      ['Design: hell', '', () => applyTheme(ed, 'light')],
      ['Design: dunkel', '', () => applyTheme(ed, 'dark')],
    ]],
    ['Hilfe', [['Tastenkürzel', 'F1', () => showHelp()]]],
  ];
  const bar = $('#menubar');
  let openMenu: HTMLElement | null = null;
  const close = () => {
    openMenu?.classList.remove('open');
    openMenu = null;
  };
  for (const [title, items] of menus) {
    const box = h('div', { class: 'menu' });
    const btn = h('button', {}, title);
    const list = h('div', { class: 'menu-items' });
    for (const it of items) {
      if (it === 'sep') list.append(h('hr'));
      else
        list.append(
          h('button', { onclick: () => (close(), it[2]()) }, h('span', {}, it[0]), it[1] ? h('kbd', {}, it[1]) : null),
        );
    }
    btn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (openMenu === box) return close();
      close();
      box.classList.add('open');
      openMenu = box;
    });
    btn.addEventListener('mouseenter', () => {
      if (openMenu && openMenu !== box) {
        close();
        box.classList.add('open');
        openMenu = box;
      }
    });
    box.append(btn, list);
    bar.append(box);
  }
  document.addEventListener('mousedown', (e) => {
    if (openMenu && !openMenu.contains(e.target as Node)) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F1') {
      e.preventDefault();
      showHelp();
    }
  });
}

function showHelp() {
  const rows: [string, string][] = [
    ['Esc', 'Auswahlwerkzeug / Auswahl aufheben'],
    ['Ctrl+L / R / E / T', 'Linie / Rechteck / Ellipse / Text'],
    ['Ctrl+`', 'Knoten bearbeiten'],
    ['Klick auf Auswahl', 'Zwischen Skalieren und Drehen wechseln'],
    ['Shift / Ctrl beim Ziehen', 'Proportional bzw. frei / von der Mitte'],
    ['Pfeiltasten', '1 mm verschieben (Shift 10 mm, Alt 0,1 mm)'],
    ['. und ,', '90° drehen'],
    ['L R T B C E', 'Ausrichten (mehrere Objekte gewählt)'],
    ['Leertaste + Ziehen, Mitteltaste', 'Ansicht verschieben'],
    ['Mausrad', 'Zoomen'],
    ['Knoten: D I C S', 'Löschen, Einfügen, Ecke, Glatt'],
    ['Alt+W', 'Drahtgitter / Gefüllt'],
    ['Ctrl+I', 'Importieren (Bilder, SVG, DXF); Dateien auch auf die Arbeitsfläche ziehen oder mit Ctrl+V einfügen'],
    ['Alt+T', 'Bild nachzeichnen'],
    ['Palette', 'Farbe anklicken = Auswahl diesem Layer zuordnen'],
  ];
  const dlg = h(
    'dialog',
    {},
    h('h3', {}, 'Tastenkürzel'),
    h('table', {}, ...rows.map(([k, d]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, d)))),
    h('p', {}, h('button', { class: 'btn', onclick: () => dlg.close() }, 'Schließen')),
  );
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

// ---------- Hauptleiste ----------

function buildToolbar(ed: Editor) {
  const bar = $('#toolbar');
  const needSel: HTMLButtonElement[] = [];
  const needMulti: HTMLButtonElement[] = [];
  const needThree: HTMLButtonElement[] = [];
  const add = (list: HTMLButtonElement[] | null, ...args: Parameters<typeof iconBtn>) => {
    const b = iconBtn(...args);
    list?.push(b);
    bar.append(b);
    return b;
  };
  add(null, 'new', 'Neu (rückgängig machbar)', () => ed.newDocument());
  add(null, 'open', 'Öffnen', () => openProject(ed));
  add(null, 'save', 'Speichern', () => saveProject(ed));
  add(null, 'import', 'Importieren: Bilder, SVG, DXF (Ctrl+I)', () => importFile(ed));
  add(null, 'export', 'Als SVG exportieren', () => exportSvg(ed));
  bar.append(sep());
  add(null, 'undo', 'Rückgängig (Ctrl+Z)', () => ed.doUndo());
  add(null, 'redo', 'Wiederholen (Ctrl+Y)', () => ed.doRedo());
  bar.append(sep());
  add(needSel, 'cut', 'Ausschneiden (Ctrl+X)', () => ed.cut());
  add(needSel, 'copy', 'Kopieren (Ctrl+C)', () => ed.copy());
  add(null, 'paste', 'Einfügen (Ctrl+V)', () => ed.paste());
  add(needSel, 'delete', 'Löschen (Entf)', () => ed.deleteSel());
  bar.append(sep());
  add(null, 'zoomin', 'Vergrößern (+)', () => ed.zoomAt(1.25));
  add(null, 'zoomout', 'Verkleinern (-)', () => ed.zoomAt(0.8));
  add(null, 'zoompage', 'Ganze Seite (Ctrl+0)', () => ed.zoomPage());
  add(needSel, 'zoomsel', 'Auf Auswahl zoomen', () => ed.zoomSelection());
  bar.append(sep());
  add(needMulti, 'group', 'Gruppieren (Ctrl+G)', () => ed.group());
  add(needSel, 'ungroup', 'Gruppierung aufheben (Ctrl+U)', () => ed.ungroup());
  add(needSel, 'mirrorh', 'Horizontal spiegeln (Ctrl+Shift+H)', () => ed.mirror(true));
  add(needSel, 'mirrorv', 'Vertikal spiegeln (Ctrl+Shift+V)', () => ed.mirror(false));
  add(needSel, 'rotccw', '90° gegen Uhrzeigersinn (,)', () => ed.rotateBy(90));
  add(needSel, 'rotcw', '90° im Uhrzeigersinn (.)', () => ed.rotateBy(-90));
  add(needSel, 'tolines', 'In Pfad umwandeln (Ctrl+Shift+C)', () => ed.convertSelToPath());
  bar.append(sep());
  add(needMulti, 'alignl', 'Links ausrichten (L)', () => ed.align('left'));
  add(needMulti, 'alignhc', 'Mitten horizontal ausrichten (C)', () => ed.align('hcenter'));
  add(needMulti, 'alignr', 'Rechts ausrichten (R)', () => ed.align('right'));
  add(needMulti, 'alignt', 'Oben ausrichten (T)', () => ed.align('top'));
  add(needMulti, 'alignvc', 'Mitten vertikal ausrichten (E)', () => ed.align('vcenter'));
  add(needMulti, 'alignb', 'Unten ausrichten (B)', () => ed.align('bottom'));
  add(needThree, 'disth', 'Horizontal verteilen', () => ed.distribute(true));
  add(needThree, 'distv', 'Vertikal verteilen', () => ed.distribute(false));
  bar.append(sep());
  const themeBtn = add(null, 'moon', '', () => applyTheme(ed, isDark() ? 'light' : 'dark'));
  const refreshTheme = () => {
    themeBtn.innerHTML = isDark() ? ICONS.sun : ICONS.moon;
    themeBtn.title = isDark() ? 'Helles Design' : 'Dunkles Design';
  };
  themeListeners.add(refreshTheme);
  refreshTheme();
  const refresh = () => {
    const n = ed.sel.length;
    needSel.forEach((b) => (b.disabled = n < 1));
    needMulti.forEach((b) => (b.disabled = n < 2));
    needThree.forEach((b) => (b.disabled = n < 3));
  };
  ed.on((w) => (w === 'sel' || w === 'doc') && refresh());
  refresh();
}

// ---------- Numerik-, Form- und Textleiste ----------

function buildNumbar(ed: Editor) {
  const bar = $('#numbar');
  let ax = 0.5,
    ay = 0.5,
    lock = true;
  const bed = () => ed.doc.bed;
  const fx = numInput('num', (v) => ed.setSelBox({ x: v }, ax, ay, lock), 'X-Position (mm)');
  const fy = numInput('num', (v) => ed.setSelBox({ y: bed().h - v }, ax, ay, lock), 'Y-Position (mm, Ursprung unten links)');
  const fw = numInput('num', (v) => ed.setSelBox({ w: v }, ax, ay, lock), 'Breite (mm)');
  const fh = numInput('num', (v) => ed.setSelBox({ h: v }, ax, ay, lock), 'Höhe (mm)');
  const fwp = numInput('small', (v) => {
    const b = ed.selBounds();
    if (b) ed.setSelBox({ w: (b.w * v) / 100 }, ax, ay, lock);
  }, 'Breite in %');
  const fhp = numInput('small', (v) => {
    const b = ed.selBounds();
    if (b) ed.setSelBox({ h: (b.h * v) / 100 }, ax, ay, lock);
  }, 'Höhe in %');
  const currentRot = () => {
    if (ed.sel.length !== 1) return 0;
    const m = ed.sel[0].m;
    return (-Math.atan2(m[1], m[0]) * 180) / Math.PI;
  };
  const fr = numInput('small', (v) => {
    const b = ed.selBounds();
    if (!b) return;
    ed.rotateBy(v - currentRot(), { x: b.x + ax * b.w, y: b.y + ay * b.h });
  }, 'Drehung in Grad (gegen den Uhrzeigersinn)');
  const lockBtn = h('button', { class: 'ib on', title: 'Seitenverhältnis sperren', html: ICONS.lock });
  lockBtn.addEventListener('click', () => {
    lock = !lock;
    lockBtn.classList.toggle('on', lock);
    lockBtn.innerHTML = lock ? ICONS.lock : ICONS.unlock;
  });
  const anchor = h('div', { class: 'anchor', title: 'Bezugspunkt' });
  const anchorBtns: HTMLButtonElement[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      const b = h('button', {
        onclick: () => {
          ax = c / 2;
          ay = r / 2;
          anchorBtns.forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          refresh();
        },
      });
      if (r === 1 && c === 1) b.classList.add('on');
      anchorBtns.push(b);
      anchor.append(b);
    }
  const geo = h(
    'div',
    { class: 'field' },
    h('label', {}, 'X', fx), h('label', {}, 'Y', fy), anchor,
    h('label', {}, 'B', fw), h('label', {}, 'H', fh), lockBtn,
    h('label', {}, fwp, '%'), h('label', {}, fhp, '%'),
    h('label', {}, '↻', fr, '°'), h('span', { class: 'toggle', title: 'Einheit' }, 'mm'),
  );

  // Formeigenschaften
  const fRad = numInput('small', (v) => ed.updateShapes('rect', { r: Math.max(0, v) }), 'Eckenradius (mm)');
  const fSides = numInput('small', (v) => ed.updateShapes('polygon', { sides: Math.max(3, Math.min(64, Math.round(v))) }), 'Anzahl Ecken');
  const starBtn = h('button', { class: 'toggle', title: 'Stern' }, 'Stern');
  starBtn.addEventListener('click', () => ed.updateShapes('polygon', { star: !starBtn.classList.contains('on') }));
  const rectProps = h('label', {}, 'Radius', fRad);
  const polyProps = h('span', { class: 'field' }, h('label', {}, 'Ecken', fSides), starBtn);

  // Text
  const fontSel = h('select', { title: 'Schriftart' }) as HTMLSelectElement;
  for (const f of availableFonts()) fontSel.append(h('option', { value: f }, f));
  fontSel.addEventListener('change', () => ed.updateTexts({ font: fontSel.value }));
  systemFonts().then((list) => {
    if (!list?.length) return;
    const cur = fontSel.value;
    fontSel.replaceChildren(...list.map((f) => h('option', { value: f }, f)));
    fontSel.value = list.includes(cur) ? cur : list[0];
  });
  const fSize = numInput('small', (v) => v > 0 && ed.updateTexts({ size: v }), 'Schriftgröße (mm)');
  const fHs = numInput('small', (v) => ed.updateTexts({ hSpace: v }), 'Zeichenabstand (mm)');
  const fVs = numInput('small', (v) => ed.updateTexts({ vSpace: v }), 'Zeilenabstand (mm)');
  const tog = (label: string, key: 'bold' | 'italic' | 'upper', title: string) => {
    const b = h('button', { class: 'toggle', title }, label);
    b.addEventListener('click', () => ed.updateTexts({ [key]: !b.classList.contains('on') } as Partial<TextShape>));
    return b;
  };
  const bBold = tog('F', 'bold', 'Fett');
  bBold.style.fontWeight = '700';
  const bItal = tog('K', 'italic', 'Kursiv');
  bItal.style.fontStyle = 'italic';
  const bUp = tog('AB', 'upper', 'Großbuchstaben');
  const alignBtns = (['left', 'center', 'right'] as const).map((a) => {
    const b = iconBtn(a === 'left' ? 'alignTextL' : a === 'center' ? 'alignTextC' : 'alignTextR', `Ausrichtung ${a === 'left' ? 'links' : a === 'center' ? 'mittig' : 'rechts'}`, () => ed.updateTexts({ align: a }));
    b.style.width = b.style.height = '24px';
    b.dataset.align = a;
    return b;
  });
  const textProps = h(
    'div',
    { class: 'field' },
    h('label', {}, 'Schrift', fontSel), h('label', {}, 'Höhe', fSize),
    h('label', {}, 'Abst. H', fHs), h('label', {}, 'V', fVs), ...alignBtns, bBold, bItal, bUp,
  );

  // Knotenbearbeitung
  const nodeBtn = (label: string, title: string, f: () => void) => h('button', { class: 'toggle', title, onclick: f }, label);
  const nodeInfo = h('span', { class: 'muted' });
  const nodeProps = h(
    'div',
    { class: 'field' },
    nodeInfo,
    nodeBtn('Gerade', 'Segmente zwischen den ausgewählten Knoten in Geraden umwandeln (L)', () => ed.setSegmentType(false)),
    nodeBtn('Kurve', 'Segmente zwischen den ausgewählten Knoten in Kurven umwandeln (C)', () => ed.setSegmentType(true)),
    nodeBtn('Ecke', 'Ausgewählte Knoten zu Ecken machen, Anfasser entfernen (E)', () => ed.setNodeType(false)),
    nodeBtn('Glatt', 'Ausgewählte Knoten glätten (S)', () => ed.setNodeType(true)),
    nodeBtn('Löschen', 'Ausgewählte Knoten löschen (Entf)', () => ed.deleteNodes()),
  );
  const sepNode = sep();

  // Bilder
  const imgInfo = h('span', { class: 'muted' });
  const imgProps = h(
    'div',
    { class: 'field' },
    h('span', { html: ICONS.image, class: 'muted icon-inline' }), imgInfo,
    h('button', { class: 'toggle', title: 'Helligkeit, Kontrast, Gamma, Schärfen, Bildmodus', onclick: () => openAdjustDialog(ed) }, 'Anpassen …'),
    h('button', { class: 'toggle', title: 'Bild in Vektoren umwandeln (Alt+T)', onclick: () => openTraceDialog(ed) }, 'Nachzeichnen …'),
  );
  const sepImg = sep();

  const sepShape = sep();
  bar.append(geo, sepNode, nodeProps, sepImg, imgProps, sepShape, rectProps, polyProps, sep(), textProps);

  const refresh = () => {
    const b = ed.selBounds();
    geo.classList.toggle('group-disabled', !b);
    if (b) {
      setVal(fx, f2(b.x + ax * b.w));
      setVal(fy, f2(bed().h - (b.y + ay * b.h)));
      setVal(fw, f2(b.w));
      setVal(fh, f2(b.h));
      setVal(fwp, '100');
      setVal(fhp, '100');
      setVal(fr, f2(currentRot()));
    } else [fx, fy, fw, fh, fwp, fhp, fr].forEach((f) => setVal(f, ''));

    nodeProps.hidden = sepNode.hidden = ed.tool !== 'node';
    const imgs = ed.selImages();
    imgProps.hidden = sepImg.hidden = !imgs.length;
    if (imgs.length) {
      const o = imgs[0],
        s = o.shape as ImageShape;
      const L = ed.imgLayer(o.layer);
      const g = outputGrid(s, o.m, L.interval);
      imgInfo.textContent = imgs.length > 1 ? `${imgs.length} Bilder` : `${s.pxW} × ${s.pxH} px → ${g.cols} × ${g.rows} Punkte (${Math.round(25.4 / L.interval)} DPI)`;
    }
    const nn = ed.nodeSelCount;
    nodeInfo.textContent = nn ? `${nn} Knoten` : 'Knoten';
    nodeProps.classList.toggle('group-disabled', ed.tool === 'node' && !ed.sel.length);

    const rect = ed.sel.find((o) => o.shape.kind === 'rect');
    const poly = ed.sel.find((o) => o.shape.kind === 'polygon');
    rectProps.hidden = !(rect || ed.tool === 'rect');
    polyProps.hidden = !(poly || ed.tool === 'polygon');
    sepShape.hidden = rectProps.hidden && polyProps.hidden;
    setVal(fRad, f2(rect && rect.shape.kind === 'rect' ? rect.shape.r : ed.rectRadius));
    const pv = poly && poly.shape.kind === 'polygon' ? poly.shape : { sides: ed.polySides, star: ed.polyStar };
    setVal(fSides, String(pv.sides));
    starBtn.classList.toggle('on', pv.star);

    const ts = ed.selTexts();
    const t = ts.length ? (ts[0].shape as TextShape) : ed.textDefaults;
    textProps.classList.toggle('group-disabled', !ts.length && ed.tool !== 'text');
    if (![...fontSel.options].some((o) => o.value === t.font)) fontSel.append(h('option', { value: t.font }, t.font));
    if (document.activeElement !== fontSel) fontSel.value = t.font;
    setVal(fSize, f2(t.size));
    setVal(fHs, f2(t.hSpace));
    setVal(fVs, f2(t.vSpace));
    bBold.classList.toggle('on', t.bold);
    bItal.classList.toggle('on', t.italic);
    bUp.classList.toggle('on', t.upper);
    alignBtns.forEach((b) => b.classList.toggle('on', b.dataset.align === t.align));
  };
  ed.on((w) => w !== 'view' && refresh());
  refresh();
}

// ---------- Werkzeugleiste links ----------

function buildTools(ed: Editor) {
  const bar = $('#tools');
  const tools: [Tool, string, string][] = [
    ['select', 'select', 'Auswählen (Esc)'],
    ['node', 'node', 'Knoten bearbeiten (Ctrl+`)'],
    ['line', 'line', 'Linien zeichnen (Ctrl+L)'],
    ['rect', 'rect', 'Rechteck (Ctrl+R)'],
    ['ellipse', 'ellipse', 'Ellipse (Ctrl+E)'],
    ['polygon', 'polygon', 'Polygon'],
    ['text', 'text', 'Text (Ctrl+T)'],
  ];
  const btns = new Map<Tool, HTMLButtonElement>();
  tools.forEach(([t, icon, title], i) => {
    if (i === 2) bar.append(sep());
    const b = iconBtn(icon, title, () => ed.setTool(t));
    b.dataset.tool = t;
    btns.set(t, b);
    bar.append(b);
  });
  bar.append(sep());
  const mods = [
    iconBtn('union', 'Vereinen: alle gewählten Formen verschmelzen', () => ed.booleanSel('union')),
    iconBtn('subtract', 'Abziehen: weitere Formen von der zuerst gewählten abziehen', () => ed.booleanSel('subtract')),
    iconBtn('intersect', 'Schnittmenge: nur die gemeinsame Fläche behalten', () => ed.booleanSel('intersect')),
  ];
  const off = iconBtn('offset', 'Offset (Alt+O)', () => openOffsetDialog(ed));
  bar.append(...mods, off);
  const refresh = () => {
    btns.forEach((b, t) => b.classList.toggle('on', ed.tool === t));
    mods.forEach((b) => (b.disabled = ed.sel.length < 2));
    off.disabled = ed.sel.length < 1;
  };
  ed.on((w) => (w === 'tool' || w === 'sel') && refresh());
  refresh();
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.key.toLowerCase() === 'o' && ed.sel.length) {
      e.preventDefault();
      openOffsetDialog(ed);
    }
  });
}

// ---------- Offset-Dialog ----------

let offsetState = { distance: 2, direction: 'outward' as 'outward' | 'inward' | 'both', join: 'round' as 'round' | 'miter' | 'square', keep: true };

function openOffsetDialog(ed: Editor) {
  if (!ed.sel.length) return;
  const st = { ...offsetState };
  const preview = () => ed.previewOffset({ distance: st.distance, direction: st.direction, join: st.join });
  const dist = numInput('', (v) => {
    if (v > 0) st.distance = v;
    preview();
  }, 'Abstand in mm');
  dist.id = 'offset-distance';
  dist.value = String(st.distance);
  const radio = <T extends string>(name: string, value: T, label: string, cur: T, set: (v: T) => void) =>
    h('label', {}, h('input', { type: 'radio', name, value, checked: value === cur, onchange: () => (set(value), preview()) }), label);
  const join = h('select', { id: 'offset-join', onchange: (e: Event) => ((st.join = (e.target as HTMLSelectElement).value as typeof st.join), preview()) },
    h('option', { value: 'round', selected: st.join === 'round' }, 'Rund'),
    h('option', { value: 'miter', selected: st.join === 'miter' }, 'Spitz'),
    h('option', { value: 'square', selected: st.join === 'square' }, 'Abgeschrägt'),
  ) as HTMLSelectElement;
  const keep = h('input', { type: 'checkbox', id: 'offset-keep', checked: st.keep, onchange: (e: Event) => (st.keep = (e.target as HTMLInputElement).checked) }) as HTMLInputElement;
  const dlg = h(
    'dialog',
    { class: 'offset-dialog' },
    h('h3', {}, 'Offset'),
    h(
      'div',
      { class: 'form' },
      h('label', { for: 'offset-distance' }, 'Abstand (mm)'), dist,
      h('label', {}, 'Richtung'),
      h('div', { class: 'radios' },
        radio('dir', 'outward', 'Außen', st.direction, (v) => (st.direction = v)),
        radio('dir', 'inward', 'Innen', st.direction, (v) => (st.direction = v)),
        radio('dir', 'both', 'Beides', st.direction, (v) => (st.direction = v)),
      ),
      h('label', { for: 'offset-join' }, 'Ecken'), join,
      h('label', { for: 'offset-keep' }, 'Original behalten'), keep,
    ),
    h('div', { class: 'note' }, 'Orange gestrichelt: Vorschau. Offene Linien bekommen eine geschlossene Kontur im Abstand.'),
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, 'Abbrechen'),
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          const v = evalExpr(dist.value);
          if (v && v > 0) st.distance = v;
          offsetState = st;
          dlg.close();
          await ed.offsetSel({ distance: st.distance, direction: st.direction, join: st.join }, st.keep);
        },
      }, 'Übernehmen'),
    ),
  );
  dlg.addEventListener('close', () => {
    ed.previewOffset(null);
    dlg.remove();
  });
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
  preview();
}

// ---------- Layer-Panel ----------

function buildLayers(ed: Editor) {
  const root = $('#layers');
  /** Gewählter Eintrag: Vektoren oder Bilder des aktiven Layers */
  let part: 'vec' | 'img' = 'vec';
  const render = () => {
    const used = ed.layerOrder();
    if (ed.activeLayer === null || !used.includes(ed.activeLayer)) ed.activeLayer = used[0] ?? null;
    root.replaceChildren();
    if (!used.length) {
      root.append(h('div', { class: 'empty' }, 'Noch keine Objekte. Zeichne links eine Form oder einen Text, oder importiere ein Bild (Ctrl+I). Die Farbe unten bestimmt den Layer.'));
      return;
    }
    const table = h(
      'table',
      { class: 'layers' },
      h('tr', {}, ...['Nr.', 'Layer', 'Modus', 'Speed', 'Leist.', 'Aus', 'Zeig.'].map((t) => h('th', {}, t))),
    );
    const partsOf = new Map(used.map((i) => [i, ed.layerParts(i)]));
    const ap = partsOf.get(ed.activeLayer!)!;
    if (part === 'img' && !ap.img) part = 'vec';
    if (part === 'vec' && !ap.vec && ap.img) part = 'img';
    for (const i of used) {
      const L = ed.layer(i);
      const parts = partsOf.get(i)!;
      const rows: ('vec' | 'img')[] = [];
      if (parts.vec) rows.push('vec');
      if (parts.img) rows.push('img');
      for (const p of rows) {
        const isImg = p === 'img';
        const IL = isImg ? ed.imgLayer(i) : null;
        const mode = isImg
          ? h('span', { class: 'mode-img', title: 'Bilder dieses Layers' }, 'Bild')
          : h('select', { onchange: (e: Event) => ed.updateLayer(i, { mode: (e.target as HTMLSelectElement).value as Layer['mode'] }) },
              h('option', { value: 'line', selected: L.mode === 'line' }, 'Linie'),
              h('option', { value: 'fill', selected: L.mode === 'fill' }, 'Füllen'),
            );
        const out = h('input', { type: 'checkbox', checked: L.output, onchange: (e: Event) => ed.updateLayer(i, { output: (e.target as HTMLInputElement).checked }) });
        const show = h('input', { type: 'checkbox', checked: L.show, onchange: (e: Event) => ed.updateLayer(i, { show: (e.target as HTMLInputElement).checked }) });
        const row = h(
          'tr',
          { class: ed.activeLayer === i && part === p ? 'active' : '', title: 'Doppelklick: alle Formen dieses Layers auswählen' },
          h('td', {}, h('span', { class: 'swatch', style: `background:${PALETTE[i]}` }, layerLabel(i))),
          h('td', {}, L.name),
          h('td', {}, mode),
          h('td', {}, String(IL ? IL.speed : L.speed)),
          h('td', {}, `${IL ? IL.power : L.power}%`),
          h('td', {}, out),
          h('td', {}, show),
        );
        row.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('select,input')) return;
          ed.activeLayer = i;
          ed.currentLayer = i;
          part = p;
          render();
          ed.emit('tool');
        });
        row.addEventListener('dblclick', () => ed.selectLayer(i));
        table.append(row);
      }
    }
    root.append(table);
    const a = ed.activeLayer!;
    root.append(
      h(
        'div',
        { class: 'layer-tools' },
        h('button', { title: 'Nach oben (früher ausgeben)', onclick: () => ed.moveLayer(a, -1), html: '▲' }),
        h('button', { title: 'Nach unten (später ausgeben)', onclick: () => ed.moveLayer(a, 1), html: '▼' }),
        h('button', { onclick: () => ed.selectLayer(a) }, 'Formen auswählen'),
      ),
    );
    const L = ed.layer(a);
    const name = h('input', { type: 'text', value: L.name, onchange: (e: Event) => ed.updateLayer(a, { name: (e.target as HTMLInputElement).value }) });
    const head = [h('label', {}, h('span', { class: 'swatch', style: `background:${PALETTE[a]}` }, layerLabel(a)), ' Name'), name];
    if (part === 'img') {
      root.append(imageLayerForm(ed, a, head));
      return;
    }
    const num = (key: 'speed' | 'power' | 'minPower' | 'passes' | 'interval', min: number, max: number, int = false) => {
      const el = numInput('', (v) => {
        const c = Math.max(min, Math.min(max, int ? Math.round(v) : v));
        ed.updateLayer(a, { [key]: c } as Partial<Layer>);
      });
      el.value = String(L[key]);
      return el;
    };
    root.append(
      h(
        'div',
        { class: 'form' },
        ...head,
        h('label', {}, 'Geschwindigkeit (mm/min)'), num('speed', 1, 100000),
        h('label', {}, 'Max. Leistung (%)'), num('power', 0, 100),
        h('label', {}, 'Min. Leistung (%)'), num('minPower', 0, 100),
        h('label', {}, 'Durchgänge'), num('passes', 1, 100, true),
        ...(L.mode === 'fill' ? [h('label', {}, 'Zeilenabstand (mm)'), num('interval', 0.01, 5)] : []),
      ),
    );
  };
  ed.on((w) => (w === 'doc' || w === 'sel') && schedule());
  let pending = false;
  // Während eines Ziehvorgangs nicht bei jeder Bewegung neu aufbauen
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (!root.contains(document.activeElement)) render();
    });
  };
  root.addEventListener('focusout', () => setTimeout(schedule, 0));
  render();
}

/** Felder für die Bild-Einstellungen eines Layers (auch im Dialog „Bild anpassen“ verwendet) */
function imageLayerFields(ed: Editor, i: number, live: boolean, onChange?: () => void): HTMLElement[] {
  const IL = ed.imgLayer(i);
  const set = (patch: Partial<ImageLayer>) => {
    ed.updateImgLayer(i, patch, !live);
    onChange?.();
  };
  const num = (key: 'speed' | 'power' | 'minPower' | 'passes' | 'overscan' | 'cells' | 'angle' | 'threshold', min: number, max: number, int = false) => {
    const el = numInput('', (v) => set({ [key]: Math.max(min, Math.min(max, int ? Math.round(v) : v)) } as Partial<ImageLayer>));
    el.value = String(IL[key]);
    return el;
  };
  const interval = numInput('', (v) => {
    const c = Math.max(0.01, Math.min(2, v));
    set({ interval: c });
    dpi.value = String(Math.round(25.4 / c));
  }, 'Zeilenabstand in mm');
  interval.value = String(IL.interval);
  const dpi = numInput('', (v) => {
    const c = Math.max(12.7, Math.min(2540, v));
    set({ interval: Math.round((25.4 / c) * 10000) / 10000 });
    interval.value = String(ed.imgLayer(i).interval);
  }, 'Auflösung in Punkten pro Zoll');
  dpi.value = String(Math.round(25.4 / IL.interval));
  const modeSel = h('select', {}, ...DITHER_MODES.map(([v, t]) => h('option', { value: v, selected: IL.dither === v }, t))) as HTMLSelectElement;
  const extra = h('div', { class: 'form sub' });
  const renderExtra = () => {
    const d = ed.imgLayer(i).dither;
    extra.replaceChildren(
      ...(d === 'threshold' ? [h('label', {}, 'Schwellwert (0–255)'), num('threshold', 0, 255, true)] : []),
      ...(d === 'halftone' ? [h('label', {}, 'Zellen pro Zoll'), num('cells', 2, 300), h('label', {}, 'Rasterwinkel (°)'), num('angle', -90, 90)] : []),
    );
    extra.hidden = !extra.childElementCount;
  };
  modeSel.addEventListener('change', () => {
    set({ dither: modeSel.value as DitherMode });
    renderExtra();
  });
  renderExtra();
  const check = (key: 'negative' | 'bidirectional', label: string) =>
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: IL[key], onchange: (e: Event) => set({ [key]: (e.target as HTMLInputElement).checked }) }), label);
  return [
    h('label', {}, 'Bildmodus'), modeSel,
    extra,
    h('label', {}, 'Zeilenabstand (mm)'), interval,
    h('label', {}, 'DPI'), dpi,
    h('span', { class: 'checks' }, check('negative', 'Negativ'), check('bidirectional', 'Bidirektional')),
    ...(live ? [] : [
      h('label', {}, 'Geschwindigkeit (mm/min)'), num('speed', 1, 100000),
      h('label', {}, 'Max. Leistung (%)'), num('power', 0, 100),
      h('label', {}, 'Min. Leistung (%)'), num('minPower', 0, 100),
      h('label', {}, 'Durchgänge'), num('passes', 1, 100, true),
      h('label', {}, 'Überfahrweg (%)'), num('overscan', 0, 50),
    ]),
  ];
}

function imageLayerForm(ed: Editor, i: number, head: HTMLElement[]) {
  return h(
    'div',
    {},
    h('div', { class: 'form' }, ...head, ...imageLayerFields(ed, i, false)),
    h('div', { class: 'layer-tools' },
      h('button', { onclick: () => openAdjustDialog(ed, i) }, 'Bild anpassen …'),
    ),
  );
}

// ---------- Bild anpassen ----------

/** Schieberegler mit Zahlenanzeige */
function slider(label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void) {
  const out = h('span', { class: 'slider-val' }, fmtNum(value));
  const inp = h('input', { type: 'range', min, max, step, value: String(value) }) as HTMLInputElement;
  inp.addEventListener('input', () => {
    out.textContent = fmtNum(+inp.value);
    onInput(+inp.value);
  });
  const set = (v: number) => {
    inp.value = String(v);
    out.textContent = fmtNum(v);
  };
  return { el: [h('label', {}, label), h('span', { class: 'slider' }, inp, out)], set };
}
const fmtNum = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',');

function targetImages(ed: Editor, layer?: number): Obj[] {
  const sel = ed.selImages();
  if (sel.length) return sel;
  if (layer === undefined) return [];
  return ed.doc.objs.filter((o) => o.shape.kind === 'image' && o.layer === layer);
}

function openAdjustDialog(ed: Editor, layer?: number) {
  const targets = targetImages(ed, layer);
  if (!targets.length) {
    ed.hint = 'Erst ein Bild auswählen.';
    ed.emit('tool');
    return;
  }
  const first = targets[0];
  const shape = () => first.shape as ImageShape;
  const li = first.layer;
  const origAdj = targets.map((o) => ({ ...(o.shape as ImageShape).adjust }));
  const origLayer = { ...ed.imgLayer(li) };
  const adj: ImageAdjust = { ...shape().adjust };

  const view = h('canvas', { class: 'adjust-preview', width: 420, height: 300 }) as HTMLCanvasElement;
  let showOrig = false,
    oneToOne = false;
  let timer = 0;
  const drawPreview = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const ctx = view.getContext('2d')!;
      const dpr = window.devicePixelRatio || 1;
      const W = view.clientWidth || 420,
        H = view.clientHeight || 300;
      view.width = Math.round(W * dpr);
      view.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      const s = shape();
      const src: CanvasImageSource | null = showOrig ? assetImageOf(s) : displayCanvas(s, first.m, ed.imgLayer(li), true);
      if (!src) return;
      const sw = (src as HTMLCanvasElement).width || (src as HTMLImageElement).naturalWidth,
        sh = (src as HTMLCanvasElement).height || (src as HTMLImageElement).naturalHeight;
      if (oneToOne && !showOrig) {
        // Mitte des Bildes, ein Bildschirmpunkt je Laserpunkt
        ctx.imageSmoothingEnabled = false;
        const cw = W * dpr,
          ch = H * dpr;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(src, Math.max(0, (sw - cw) / 2), Math.max(0, (sh - ch) / 2), Math.min(sw, cw), Math.min(sh, ch), Math.max(0, (cw - sw) / 2), Math.max(0, (ch - sh) / 2), Math.min(sw, cw), Math.min(sh, ch));
        return;
      }
      const k = Math.min(W / sw, H / sh);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, (W - sw * k) / 2, (H - sh * k) / 2, sw * k, sh * k);
    }, 40);
  };
  const setAdj = (patch: Partial<ImageAdjust>) => {
    Object.assign(adj, patch);
    ed.setImageAdjust(targets, patch, false);
    drawPreview();
  };
  const sB = slider('Helligkeit', -100, 100, 1, adj.brightness, (v) => setAdj({ brightness: v }));
  const sC = slider('Kontrast', -100, 100, 1, adj.contrast, (v) => setAdj({ contrast: v }));
  const sG = slider('Gamma', 0.1, 4, 0.01, adj.gamma, (v) => setAdj({ gamma: v }));
  const sS = slider('Schärfen (%)', 0, 300, 1, adj.sharpen, (v) => setAdj({ sharpen: v }));
  const sR = slider('Radius', 1, 10, 0.5, adj.sharpenRadius, (v) => setAdj({ sharpenRadius: v }));
  const sD = slider('Entrauschen', 0, 50, 1, adj.denoise, (v) => setAdj({ denoise: v }));
  const fields = imageLayerFields(ed, li, true, drawPreview);
  const chk = (label: string, f: (v: boolean) => void) =>
    h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e: Event) => (f((e.target as HTMLInputElement).checked), drawPreview()) }), label);
  let applied = false;
  const dlg = h(
    'dialog',
    { class: 'adjust-dialog' },
    h('h3', {}, targets.length > 1 ? `Bild anpassen (${targets.length} Bilder)` : 'Bild anpassen'),
    h(
      'div',
      { class: 'adjust-body' },
      h('div', { class: 'adjust-left' },
        view,
        h('div', { class: 'checks' }, chk('Original zeigen', (v) => (showOrig = v)), chk('Ausschnitt 1:1', (v) => (oneToOne = v))),
      ),
      h('div', { class: 'adjust-right' },
        h('div', { class: 'form' }, ...sB.el, ...sC.el, ...sG.el),
        h('div', { class: 'form-title' }, 'Schärfen'),
        h('div', { class: 'form' }, ...sS.el, ...sR.el, ...sD.el),
        h('div', { class: 'form-title' }, `Layer ${layerLabel(li)}: Bildausgabe`),
        h('div', { class: 'form' }, ...fields),
      ),
    ),
    h('div', { class: 'note' }, 'Die Arbeitsfläche zeigt das Ergebnis live. Bildmodus und Auflösung gelten für alle Bilder des Layers.'),
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', {
        class: 'btn',
        onclick: () => {
          const d = { brightness: 0, contrast: 0, gamma: 1, sharpen: 0, sharpenRadius: 1, denoise: 0 };
          sB.set(0), sC.set(0), sG.set(1), sS.set(0), sR.set(1), sD.set(0);
          setAdj(d);
        },
      }, 'Zurücksetzen'),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn', onclick: () => dlg.close() }, 'Abbrechen'),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          applied = true;
          dlg.close();
        },
      }, 'Übernehmen'),
    ),
  );
  dlg.addEventListener('close', () => {
    clearTimeout(timer);
    const newAdj = targets.map((o) => ({ ...(o.shape as ImageShape).adjust }));
    const newLayer = { ...ed.imgLayer(li) };
    // Ausgangszustand herstellen; bei „Übernehmen“ die Änderung als ein Undo-Schritt wieder anwenden
    targets.forEach((o, k) => ((o.shape as ImageShape).adjust = origAdj[k]));
    Object.assign(ed.imgLayer(li), origLayer);
    if (applied && (JSON.stringify(newAdj) !== JSON.stringify(origAdj) || JSON.stringify(newLayer) !== JSON.stringify(origLayer))) {
      ed.snapshot();
      targets.forEach((o, k) => ((o.shape as ImageShape).adjust = newAdj[k]));
      Object.assign(ed.imgLayer(li), newLayer);
    }
    ed.emit('doc');
    dlg.remove();
  });
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
  drawPreview();
}

function assetImageOf(s: ImageShape): HTMLImageElement | null {
  return assetImage(s.asset);
}

// ---------- Bild nachzeichnen ----------

let traceState = { threshold: 128, ignoreLess: 10, smooth: 0.3, deleteImage: false };

function openTraceDialog(ed: Editor) {
  const o = ed.selImages()[0];
  if (!o) {
    ed.hint = 'Erst ein Bild auswählen.';
    ed.emit('tool');
    return;
  }
  const st = { ...traceState };
  const info = h('div', { class: 'note' }, ' ');
  let subs: SubPath[] = [];
  let timer = 0;
  const preview = () => {
    clearTimeout(timer);
    info.textContent = 'Berechne …';
    timer = window.setTimeout(() => {
      const t0 = performance.now();
      subs = ed.traceImage(o, st);
      ed.setPreview(subs);
      const nodes = subs.reduce((n, sp) => n + sp.nodes.length, 0);
      info.textContent = `${subs.length} Konturen, ${nodes} Knoten (${Math.round(performance.now() - t0)} ms). Orange gestrichelt: Vorschau.`;
    }, 120);
  };
  const sT = slider('Schwellwert', 0, 255, 1, st.threshold, (v) => ((st.threshold = v), preview()));
  const sI = slider('Kleines ignorieren (px²)', 0, 500, 1, st.ignoreLess, (v) => ((st.ignoreLess = v), preview()));
  const sS = slider('Glättung', 0, 1, 0.05, st.smooth, (v) => ((st.smooth = v), preview()));
  const del = h('input', { type: 'checkbox', checked: st.deleteImage, onchange: (e: Event) => (st.deleteImage = (e.target as HTMLInputElement).checked) });
  let applied = false;
  const dlg = h(
    'dialog',
    { class: 'offset-dialog trace-dialog' },
    h('h3', {}, 'Bild nachzeichnen'),
    h('div', { class: 'form' }, ...sT.el, ...sI.el, ...sS.el, h('span', { class: 'checks' }, h('label', { class: 'check' }, del, 'Bild danach löschen'))),
    h('div', { class: 'note' }, 'Dunkler als der Schwellwert wird zur Fläche. Helligkeit, Kontrast und Gamma aus „Bild anpassen“ wirken mit.'),
    info,
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, 'Abbrechen'),
      h('button', { class: 'btn primary', onclick: () => ((applied = true), dlg.close()) }, 'Übernehmen'),
    ),
  );
  dlg.addEventListener('close', () => {
    clearTimeout(timer);
    ed.setPreview(null);
    if (applied) {
      traceState = st;
      subs = ed.traceImage(o, st);
      ed.commitTrace(o, subs, st.deleteImage);
    }
    dlg.remove();
  });
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
  preview();
}

// ---------- Laser-Panel ----------

function buildLaser(ed: Editor) {
  const root = $('#laser');
  const btn = (icon: string, label: string) =>
    h('button', { class: 'btn', disabled: true, title: 'Kommt mit der Maschinenanbindung' }, h('span', { html: ICONS[icon] }), label);
  const bw = numInput('', (v) => v > 0 && ((ed.doc.bed.w = v), ed.emit('doc'), ed.zoomPage()), 'Breite des Arbeitsbereichs');
  const bh = numInput('', (v) => v > 0 && ((ed.doc.bed.h = v), ed.emit('doc'), ed.zoomPage()), 'Höhe des Arbeitsbereichs');
  bw.style.width = bh.style.width = '46px';
  root.append(
    h('div', { class: 'laser-status' }, h('span', {}, h('span', { class: 'dot' }), 'Nicht verbunden'), h('span', { style: 'color:var(--muted)' }, 'Swiitol E6 Pro · FluidNC')),
    h(
      'div',
      { class: 'laser-grid' },
      btn('play', 'Start'), btn('pause', 'Pause'), btn('stop', 'Stopp'),
      btn('frame', 'Rahmen'), btn('home', 'Home'), btn('origin', 'Ursprung'),
    ),
    h(
      'div',
      { class: 'form' },
      h('label', {}, 'Arbeitsbereich (mm)'), h('span', { class: 'field' }, bw, '×', bh),
      h('label', {}, 'Starten ab'), h('select', { disabled: true }, h('option', {}, 'Absolute Koordinaten')),
    ),
    h('div', { class: 'note' }, 'Senden, Rahmen und G-Code folgen im Schritt „Maschinenausgabe“.'),
  );
  const refresh = () => {
    setVal(bw, String(ed.doc.bed.w));
    setVal(bh, String(ed.doc.bed.h));
  };
  ed.on((w) => w === 'doc' && refresh());
  refresh();
}

// ---------- Palette ----------

function buildPalette(ed: Editor) {
  const root = $('#palette');
  const btns: HTMLButtonElement[] = [];
  PALETTE.forEach((c, i) => {
    const b = h('button', {
      class: i >= 30 ? 'tool' : '',
      style: `background:${c}`,
      title: i >= 30 ? `Werkzeug-Layer ${layerLabel(i)} (wird nicht gelasert)` : `Layer ${layerLabel(i)}: Auswahl zuordnen`,
      onclick: () => ed.assignLayer(i),
    }, layerLabel(i));
    btns.push(b);
    root.append(b);
  });
  const refresh = () => btns.forEach((b, i) => b.classList.toggle('cur', i === ed.currentLayer));
  ed.on((w) => (w === 'sel' || w === 'tool') && refresh());
  refresh();
}

// ---------- Statusleiste ----------

function buildStatus(ed: Editor) {
  const root = $('#status');
  const coords = h('span', { class: 'coords' });
  const selInfo = h('span', {});
  const hint = h('span', { class: 'hint' });
  const snap = h('input', { type: 'checkbox', onchange: (e: Event) => ((ed.snapGrid = (e.target as HTMLInputElement).checked), ed.emit('view')) }) as HTMLInputElement;
  const step = numInput('', (v) => v > 0 && (ed.gridStep = v), 'Rasterweite (mm)');
  step.style.width = '40px';
  step.value = String(ed.gridStep);
  const filled = h('input', { type: 'checkbox', checked: ed.filled, onchange: (e: Event) => ((ed.filled = (e.target as HTMLInputElement).checked), ed.emit('view')) }) as HTMLInputElement;
  const zoom = h('span', {});
  root.append(
    coords, selInfo, hint,
    h('label', { title: 'Am Raster fangen' }, snap, 'Raster', step, 'mm'),
    h('label', { title: 'Füll-Layer gefüllt anzeigen (Alt+W)' }, filled, 'Gefüllt'),
    zoom,
  );
  const refresh = () => {
    const m = ed.toMachine(ed.cursor);
    coords.textContent = `x ${m.x.toFixed(2)}  y ${m.y.toFixed(2)} mm`;
    const b = ed.selBounds();
    selInfo.textContent = b ? `${ed.sel.length} Objekt${ed.sel.length > 1 ? 'e' : ''} · ${b.w.toFixed(2)} × ${b.h.toFixed(2)} mm` : `${ed.doc.objs.length} Objekte`;
    hint.textContent = ed.hint;
    snap.checked = ed.snapGrid;
    filled.checked = ed.filled;
    zoom.textContent = `${Math.round(ed.view.zoom * 100) / 100} px/mm`;
  };
  ed.on(refresh);
  refresh();
}

// ---------- Texteingabe ----------

function buildTextEditor(ed: Editor) {
  const box = $('#texteditor');
  const ta = box.querySelector('textarea')!;
  let target: import('./model').Obj | null = null;
  let snapDone = false;
  const close = () => {
    if (!target) return;
    const t = target;
    target = null;
    box.hidden = true;
    ed.removeIfEmptyText(t);
    ed.canvas.focus();
  };
  ed.textEditor = (o, isNew) => {
    close();
    target = o;
    snapDone = isNew; // neuer Text: Snapshot wurde schon beim Anlegen erstellt
    ta.value = o.shape.kind === 'text' ? o.shape.text : '';
    const stage = $('#stage').getBoundingClientRect();
    const p = ed.toScreen({ x: o.m[4], y: o.m[5] });
    box.style.left = `${Math.max(4, Math.min(stage.width - 290, p.x))}px`;
    box.style.top = `${Math.max(4, Math.min(stage.height - 110, p.y + 12))}px`;
    box.hidden = false;
    ta.focus();
    setTimeout(() => ta.focus(), 0);
  };
  ta.addEventListener('input', () => {
    if (!target) return;
    if (!snapDone) {
      ed.snapshot();
      snapDone = true;
    }
    ed.setText(target, ta.value);
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      close();
    }
    e.stopPropagation();
  });
  ed.canvas.addEventListener('pointerdown', () => {
    if (target && ed.tool !== 'text') close();
  }, true);
  ta.addEventListener('blur', () => setTimeout(() => document.activeElement !== ta && close(), 0));
}
