// Materialtest (wie „Material Test“ in LightBurn): Raster mit zwei gestuften Werten, z. B. Zeilen =
// Geschwindigkeit, Spalten = Leistung, mit Beschriftung. Jede Zelle bekommt einen eigenen Testlayer.
// Das Testdokument erscheint nicht auf der Arbeitsfläche, sondern geht über Vorschau, Rahmen, Start
// oder G-Code direkt an den Laser. Die Zellen laufen nach steigender Energie (geringes Brandrisiko zuerst).
import type { Editor } from './editor';
import { h, numInput } from './dom';
import { device, frameJob, JobSource, openPreview, saveGCode, startJob } from './laser';
import {
  CutSettings, cutSettings, defaultCutSettings, defaultImageLayer, defaultTabs, Doc, Layer, LayerMode, layerLabel, newDoc, Obj, rotate, translate, mul,
} from './model';
import { library, entryLabel } from './materials';
import { openEntryDialog } from './materialui';
import type { GridLayout } from './testphoto';
import { openTestPhotoDialog } from './testphotoDialog';
import { dec, t } from './i18n';

export type TestParam = 'speed' | 'power' | 'passes' | 'interval';

const PARAMS: Record<TestParam, { label: string; short: string; min: number; max: number; int: boolean; digits: number }> = {
  speed: { label: t('Geschwindigkeit (mm/min)'), short: t('Geschw. (mm/min)'), min: 1, max: 100000, int: false, digits: 0 },
  power: { label: t('Leistung (%)'), short: t('Leistung (%)'), min: 0, max: 100, int: false, digits: 1 },
  passes: { label: t('Durchgänge'), short: t('Durchgänge'), min: 1, max: 100, int: true, digits: 0 },
  interval: { label: t('Zeilenabstand (mm)'), short: t('Zeilenabst. (mm)'), min: 0.01, max: 5, int: false, digits: 3 },
};

interface Axis {
  param: TestParam;
  min: number;
  max: number;
  count: number;
}

export interface TestOptions {
  mode: LayerMode;
  rows: Axis;
  cols: Axis;
  /** Feste Werte für die Größen, die nicht gestuft werden */
  base: Pick<CutSettings, 'speed' | 'power' | 'minPower' | 'passes' | 'interval' | 'air'>;
  cellW: number;
  cellH: number;
  gap: number;
  /** Untere linke Ecke des ganzen Tests in Maschinenkoordinaten (mm) */
  x: number;
  y: number;
  labels: boolean;
  labelSize: number;
  labelMode: LayerMode;
  labelSpeed: number;
  labelPower: number;
}

export const MAX_STEPS = 20;
const KEY = 'kizamubeam.materialtest';
const LAST_KEY = 'kizamubeam.materialtest.last';

function defaults(): TestOptions {
  return {
    mode: 'fill',
    rows: { param: 'speed', min: 1000, max: 6000, count: 6 },
    cols: { param: 'power', min: 10, max: 100, count: 10 },
    base: { speed: 3000, power: 50, minPower: 0, passes: 1, interval: 0.1, air: false },
    cellW: 5, cellH: 5, gap: 2,
    x: 10, y: 10,
    labels: true, labelSize: 2.5, labelMode: 'line', labelSpeed: 1500, labelPower: 20,
  };
}

function load(): TestOptions {
  const d = defaults();
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s) return { ...d, ...s, rows: { ...d.rows, ...s.rows }, cols: { ...d.cols, ...s.cols }, base: { ...d.base, ...s.base } };
  } catch {
    /* Standardwerte */
  }
  return d;
}
function save(o: TestOptions, key = KEY) {
  try {
    localStorage.setItem(key, JSON.stringify(o));
  } catch {
    /* nicht speicherbar */
  }
}

/** Einstellungen des zuletzt gelaserten bzw. als G-Code gespeicherten Tests, sonst die zuletzt eingestellten */
export function lastTestOptions(): TestOptions {
  const d = load();
  try {
    const s = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null');
    if (s) return { ...d, ...s, rows: { ...d.rows, ...s.rows }, cols: { ...d.cols, ...s.cols }, base: { ...d.base, ...s.base } };
  } catch {
    /* zuletzt eingestellte */
  }
  return d;
}

/** Gestufte Werte einer Achse (gleichmäßig von min bis max) */
export function axisValues(a: Axis): number[] {
  const P = PARAMS[a.param];
  const n = Math.max(1, Math.min(MAX_STEPS, Math.round(a.count)));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = n === 1 ? a.min : a.min + ((a.max - a.min) * i) / (n - 1);
    const k = 10 ** P.digits;
    out.push(P.int ? Math.round(v) : Math.round(v * k) / k);
  }
  return out;
}

const fmt = (p: TestParam, v: number) => {
  const k = 10 ** PARAMS[p].digits;
  return dec(String(Math.round(v * k) / k));
};

export interface TestCell {
  row: number;
  col: number;
  settings: CutSettings;
}

/** Einstellungen der Zelle (Zeile r, Spalte c) */
export function cellSettings(o: TestOptions, r: number, c: number): CutSettings {
  const s: CutSettings = { ...defaultCutSettings(o.mode), ...o.base, mode: o.mode, tabs: defaultTabs(), kerf: 0 };
  s[o.rows.param] = axisValues(o.rows)[r];
  s[o.cols.param] = axisValues(o.cols)[c];
  return s;
}

/** Grobe Energie je Fläche, für die Reihenfolge nach Brandrisiko */
export const energy = (s: CutSettings) => (s.power * s.passes) / Math.max(1, s.speed) / (s.mode === 'fill' ? Math.max(0.01, s.interval) : 1);

export interface TestDoc {
  doc: Doc;
  layers: Layer[];
  cells: TestCell[];
  /** Testraster ohne Beschriftung in Dokumentkoordinaten (mm, y nach unten) */
  grid: { x: number; y: number; w: number; h: number };
  /** Ganzer Test inkl. Beschriftung */
  bounds: { x: number; y: number; w: number; h: number };
}

/** Testdokument aufbauen: Zellen auf Layer 0 … n-1, Beschriftung auf Layer n */
export function buildTestDoc(o: TestOptions, bed: { w: number; h: number }, font: string): TestDoc {
  const rows = axisValues(o.rows),
    cols = axisValues(o.cols);
  const doc = newDoc();
  doc.bed = { ...bed };
  const layers: Layer[] = [];
  const cells: TestCell[] = [];
  const objs: Obj[] = [];
  let id = 1;
  const { cellW: cw, cellH: ch, gap } = o;
  // Erst in einem lokalen System mit dem Raster bei (0, 0) aufbauen, dann verschieben
  for (let r = 0; r < rows.length; r++)
    for (let c = 0; c < cols.length; c++) {
      const settings = cellSettings(o, r, c);
      const li = layers.length;
      layers.push({ ...settings, index: li, name: t('Zelle {r}/{c}', { r: r + 1, c: c + 1 }), output: true, show: true });
      cells.push({ row: r, col: c, settings });
      objs.push({ id: id++, m: translate(c * (cw + gap), r * (ch + gap)), layer: li, shape: { kind: 'rect', w: cw, h: ch, r: 0 } });
    }
  // Reihenfolge nach steigender Energie
  [...layers].sort((a, b) => energy(a) - energy(b)).forEach((L, n) => (L.priority = n));

  const gw = cols.length * cw + (cols.length - 1) * gap,
    gh = rows.length * ch + (rows.length - 1) * gap;
  let left = 0,
    top = 0;
  if (o.labels) {
    const li = layers.length;
    const ls = Math.max(0.5, o.labelSize);
    layers.push({
      ...defaultCutSettings(o.labelMode), mode: o.labelMode, speed: o.labelSpeed, power: o.labelPower, air: o.base.air,
      index: li, name: t('Beschriftung'), output: true, show: true, priority: layers.length,
    });
    const text = (s: string, m: Obj['m'], align: 'left' | 'center' | 'right'): Obj => ({
      id: id++, m, layer: li,
      shape: { kind: 'text', text: s, font, size: ls, bold: false, italic: false, upper: false, align, hSpace: 0, vSpace: 0 },
    });
    // Spaltenwerte über dem Raster, darüber der Name der Größe
    const colBase = -gap - ls * 0.3;
    cols.forEach((v, c) => objs.push(text(fmt(o.cols.param, v), translate(c * (cw + gap) + cw / 2, colBase), 'center')));
    const colTitle = colBase - ls * 1.4;
    objs.push(text(PARAMS[o.cols.param].short, translate(gw / 2, colTitle), 'center'));
    top = colTitle - ls * 0.85;
    // Zeilenwerte links, rechtsbündig; davor der Name der Größe, um 90° gedreht
    const rowRight = -gap - ls * 0.3;
    rows.forEach((v, r) => objs.push(text(fmt(o.rows.param, v), translate(rowRight, r * (ch + gap) + ch / 2 + ls * 0.36), 'right')));
    const widest = Math.max(...rows.map((v) => fmt(o.rows.param, v).length));
    const rowTitle = rowRight - widest * ls * 0.6 - ls * 0.6;
    objs.push(text(PARAMS[o.rows.param].short, mul(translate(rowTitle, gh / 2), rotate(-Math.PI / 2)), 'center'));
    left = rowTitle - ls * 0.85;
  }
  // Untere linke Ecke des Ganzen auf (x, y) in Maschinenkoordinaten legen
  const dx = o.x - left,
    dy = bed.h - o.y - gh;
  for (const ob of objs) ob.m = mul(translate(dx, dy), ob.m);
  doc.objs = objs;
  layers.forEach((L) => (doc.layers[L.index] = L));
  return {
    doc, layers, cells,
    grid: { x: dx, y: dy, w: gw, h: gh },
    bounds: { x: dx + left, y: dy + top, w: gw - left, h: gh - top },
  };
}

/** Aufbau des Zellrasters für die Auswertung per Foto */
export const gridLayout = (o: TestOptions): GridLayout => ({
  rows: axisValues(o.rows).length, cols: axisValues(o.cols).length, cellW: o.cellW, cellH: o.cellH, gap: o.gap,
});

/** Kurzbeschreibung einer Zelle, z. B. „Geschw. (mm/min) 3000, Leistung (%) 40“ */
export const cellCaption = (o: TestOptions, r: number, c: number) =>
  t('{row}, {col}', {
    row: `${PARAMS[o.rows.param].short} ${fmt(o.rows.param, axisValues(o.rows)[r])}`,
    col: `${PARAMS[o.cols.param].short} ${fmt(o.cols.param, axisValues(o.cols)[c])}`,
  });

/** Beschreibung des Rasters, z. B. „6 Zeilen Geschw. (mm/min) 1000 … 6000 × 10 Spalten Leistung (%) 10 … 100“ */
export function testSummary(o: TestOptions) {
  const ax = (a: Axis) => {
    const v = axisValues(a);
    return `${PARAMS[a.param].short} ${fmt(a.param, v[0])} … ${fmt(a.param, v[v.length - 1])}`;
  };
  return t('{rows} Zeilen {rowAxis} × {cols} Spalten {colAxis}, Zellen {w} × {h} mm, Abstand {gap} mm', {
    rows: axisValues(o.rows).length, rowAxis: ax(o.rows), cols: axisValues(o.cols).length, colAxis: ax(o.cols),
    w: dec(String(o.cellW)), h: dec(String(o.cellH)), gap: dec(String(o.gap)),
  });
}

const targetLayer = (ed: Editor) => ed.activeLayer ?? ed.currentLayer;
export const targetLayerLabel = (ed: Editor) => layerLabel(targetLayer(ed));

/** Werte der Zelle auf den aktiven Layer übernehmen; die übrigen Einstellungen des Layers bleiben */
export function applyCell(ed: Editor, o: TestOptions, r: number, c: number) {
  const L = targetLayer(ed);
  const { mode, speed, power, minPower, passes, interval, air } = cellSettings(o, r, c);
  ed.updateLayer(L, { ...cutSettings(ed.layer(L)), mode, speed, power, minPower, passes, interval, air, material: undefined });
  ed.hint = t('Werte der Testzelle auf Layer {layer} übernommen.', { layer: layerLabel(L) });
  ed.emit('tool');
}

/** Werte der Zelle als Eintrag in der Material-Bibliothek speichern (Dialog zum Benennen) */
export function saveCell(ed: Editor, o: TestOptions, r: number, c: number, desc = '') {
  const s = cellSettings(o, r, c);
  openEntryDialog({ material: '', thickness: null, title: o.mode === 'fill' ? t('Gravieren') : t('Schneiden'), desc, settings: s }, (e) => {
    const n = library.add(e);
    ed.hint = t('„{entry}“ in der Material-Bibliothek gespeichert.', { entry: entryLabel(n) });
    ed.emit('tool');
  });
}

/** Farbe einer Testzelle in der Vorschau: von blass (wenig Energie) nach kräftig */
function cellColor(t: number) {
  const l = 78 - t * 50;
  return `hsl(18 85% ${l}%)`;
}

export function openMaterialTestDialog(ed: Editor) {
  const o = load();
  const font = ed.textDefaults.font;
  let picked: { r: number; c: number } | null = null;

  const num = (get: () => number, set: (v: number) => void, min: number, max: number, int = false, title?: string) => {
    const el = numInput('', (v) => {
      set(Math.max(min, Math.min(max, int ? Math.round(v) : v)));
      el.value = String(get());
      update();
    }, title);
    el.value = String(get());
    return el;
  };
  const row = (label: string, el: HTMLElement, title?: string) => [h('label', { title }, label), el];
  const sel = <T extends string>(value: T, options: [T, string][], set: (v: T) => void) =>
    h('select', { onchange: (e: Event) => (set((e.target as HTMLSelectElement).value as T), render()) },
      ...options.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));

  const form = h('div', { class: 'form' });
  const svgBox = h('div', { class: 'mt-preview' });
  const info = h('div', { class: 'note' });
  const pickBox = h('div', { class: 'mt-pick' });

  const paramOptions = (): [TestParam, string][] =>
    (Object.keys(PARAMS) as TestParam[]).filter((p) => p !== 'interval' || o.mode === 'fill').map((p) => [p, PARAMS[p].label]);

  const axisFields = (title: string, a: Axis, other: Axis) => {
    const P = PARAMS[a.param];
    return [
      h('div', { class: 'form-title sub' }, title),
      ...row(t('Größe'), sel(a.param, paramOptions(), (v) => {
        if (v === other.param) other.param = a.param;
        a.param = v;
        const Q = PARAMS[v];
        const d = defaults();
        const preset = [d.rows, d.cols].find((x) => x.param === v);
        a.min = preset?.min ?? Q.min;
        a.max = preset?.max ?? (v === 'passes' ? 5 : v === 'interval' ? 0.3 : Q.max);
        if (v === 'interval') a.min = 0.05;
      })),
      ...row(t('Von'), num(() => a.min, (v) => (a.min = v), P.min, P.max, P.int)),
      ...row(t('Bis'), num(() => a.max, (v) => (a.max = v), P.min, P.max, P.int)),
      ...row(t('Stufen'), num(() => a.count, (v) => (a.count = v), 1, MAX_STEPS, true)),
    ];
  };

  const render = () => {
    if (o.mode === 'line') {
      // Zeilenabstand gibt es nur beim Füllen
      if (o.rows.param === 'interval') o.rows.param = o.cols.param === 'speed' ? 'power' : 'speed';
      if (o.cols.param === 'interval') o.cols.param = o.rows.param === 'power' ? 'speed' : 'power';
    }
    const varied = new Set([o.rows.param, o.cols.param]);
    const fixed = (p: TestParam, key: 'speed' | 'power' | 'passes' | 'interval') =>
      varied.has(p) ? [] : row(PARAMS[p].label, num(() => o.base[key], (v) => (o.base[key] = v), PARAMS[p].min, PARAMS[p].max, PARAMS[p].int));
    form.replaceChildren(
      ...row(t('Modus'), sel(o.mode, [['fill', t('Füllen (Gravur)')], ['line', t('Linie (Schnitt)')]], (v) => (o.mode = v))),
      ...axisFields(t('Zeilen'), o.rows, o.cols),
      ...axisFields(t('Spalten'), o.cols, o.rows),
      h('div', { class: 'form-title sub' }, t('Feste Werte')),
      ...fixed('speed', 'speed'),
      ...fixed('power', 'power'),
      ...fixed('passes', 'passes'),
      ...(o.mode === 'fill' ? fixed('interval', 'interval') : []),
      ...row(t('Min. Leistung (%)'), num(() => o.base.minPower, (v) => (o.base.minPower = v), 0, 100)),
      h('span', { class: 'checks' }, h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: o.base.air, onchange: (e: Event) => ((o.base.air = (e.target as HTMLInputElement).checked), update()) }), t('Air Assist'))),
      h('div', { class: 'form-title sub' }, t('Raster')),
      ...row(t('Zellenbreite (mm)'), num(() => o.cellW, (v) => (o.cellW = v), 0.5, 200)),
      ...row(t('Zellenhöhe (mm)'), num(() => o.cellH, (v) => (o.cellH = v), 0.5, 200)),
      ...row(t('Abstand (mm)'), num(() => o.gap, (v) => (o.gap = v), 0, 100)),
      ...row(t('Position X (mm)'), num(() => o.x, (v) => (o.x = v), -10000, 10000), t('Untere linke Ecke des Tests inkl. Beschriftung, in Maschinenkoordinaten. Gilt bei „Starten ab: Absolut“; sonst bestimmt die Startposition die Lage.')),
      ...row(t('Position Y (mm)'), num(() => o.y, (v) => (o.y = v), -10000, 10000)),
      h('div', { class: 'form-title sub' }, t('Beschriftung')),
      h('span', { class: 'checks' }, h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: o.labels, onchange: (e: Event) => ((o.labels = (e.target as HTMLInputElement).checked), render()) }), t('Werte beschriften'))),
      ...(o.labels
        ? [
            ...row(t('Schrifthöhe (mm)'), num(() => o.labelSize, (v) => (o.labelSize = v), 0.5, 50)),
            ...row(t('Modus'), sel(o.labelMode, [['line', t('Linie')], ['fill', t('Füllen')]], (v) => (o.labelMode = v))),
            ...row(t('Geschwindigkeit (mm/min)'), num(() => o.labelSpeed, (v) => (o.labelSpeed = v), 1, 100000)),
            ...row(t('Leistung (%)'), num(() => o.labelPower, (v) => (o.labelPower = v), 0, 100)),
          ]
        : []),
    );
    update();
  };

  /** Schaubild des Tests: Zellen nach Energie eingefärbt, Klick wählt eine Zelle */
  const update = () => {
    save(o);
    const test = buildTestDoc(o, ed.doc.bed, font);
    const rows = axisValues(o.rows),
      cols = axisValues(o.cols);
    if (picked && (picked.r >= rows.length || picked.c >= cols.length)) picked = null;
    const es = test.cells.map((c) => energy(c.settings));
    const e0 = Math.min(...es),
      e1 = Math.max(...es);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    const pad = 4;
    const lw = 34,
      th = 28;
    const W = 340,
      cell = Math.min((W - lw - pad * 2) / cols.length, 26);
    const gw = cols.length * cell,
      gh = rows.length * cell;
    svg.setAttribute('viewBox', `0 0 ${lw + gw + pad * 2} ${th + gh + pad * 2}`);
    svg.setAttribute('width', String(lw + gw + pad * 2));
    const el = (tag: string, attrs: Record<string, string | number>, text?: string) => {
      const e = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      if (text) e.textContent = text;
      svg.append(e);
      return e;
    };
    el('text', { x: lw + pad + gw / 2, y: 10, 'text-anchor': 'middle', class: 'mt-axis' }, PARAMS[o.cols.param].short);
    cols.forEach((v, c) => el('text', { x: lw + pad + c * cell + cell / 2, y: th - 4, 'text-anchor': 'middle', class: 'mt-val' }, fmt(o.cols.param, v)));
    rows.forEach((v, r) => el('text', { x: lw + pad - 4, y: th + pad + r * cell + cell / 2 + 3, 'text-anchor': 'end', class: 'mt-val' }, fmt(o.rows.param, v)));
    test.cells.forEach((c, k) => {
      const f = e1 > e0 ? (es[k] - e0) / (e1 - e0) : 0.5;
      const r = el('rect', {
        x: lw + pad + c.col * cell + 1, y: th + pad + c.row * cell + 1, width: cell - 2, height: cell - 2, rx: 2,
        fill: cellColor(f), class: picked && picked.r === c.row && picked.c === c.col ? 'mt-cell picked' : 'mt-cell',
      });
      const title = document.createElementNS(ns, 'title');
      title.textContent = `${PARAMS[o.rows.param].short}: ${fmt(o.rows.param, rows[c.row])}, ${PARAMS[o.cols.param].short}: ${fmt(o.cols.param, cols[c.col])}`;
      r.append(title);
      r.addEventListener('click', () => {
        picked = { r: c.row, c: c.col };
        update();
      });
    });
    svgBox.replaceChildren(svg);
    const b = test.bounds;
    const x0 = b.x,
      y1 = ed.doc.bed.h - b.y;
    const outside = x0 < -0.01 || b.y < -0.01 || x0 + b.w > ed.doc.bed.w + 0.01 || b.y + b.h > ed.doc.bed.h + 0.01;
    info.replaceChildren(
      t('{cells} Zellen, etwa {w} × {h} mm (X {x0} … {x1}, Y {y0} … {y1}). Die Zellen laufen von wenig zu viel Energie. Gerät: {device}.', {
        cells: test.cells.length, w: b.w.toFixed(0), h: b.h.toFixed(0), x0: x0.toFixed(0), x1: (x0 + b.w).toFixed(0),
        y0: (y1 - b.h).toFixed(0), y1: y1.toFixed(0), device: device.name,
      }),
      ...(outside ? [h('div', { class: 'warn' }, t('Der Test ragt über das Bett hinaus.'))] : []),
    );
    pickBox.replaceChildren(
      ...(picked
        ? [
            h('span', {}, t('Gewählt: {row}, {col}', { row: `${PARAMS[o.rows.param].short} ${fmt(o.rows.param, rows[picked.r])}`, col: `${PARAMS[o.cols.param].short} ${fmt(o.cols.param, cols[picked.c])}` })),
            h('button', { class: 'btn', title: t('Werte dieser Zelle auf den aktiven Layer übernehmen'), onclick: () => applyPicked() }, t('Auf Layer {layer}', { layer: targetLayerLabel(ed) })),
            h('button', { class: 'btn', title: t('Werte dieser Zelle als Eintrag in der Material-Bibliothek speichern'), onclick: () => savePicked() }, t('In Bibliothek …')),
          ]
        : [h('span', { class: 'muted' }, t('Nach dem Lasern die beste Zelle anklicken, um ihre Werte zu übernehmen.'))]),
      h('button', { class: 'btn', title: t('Foto des gelaserten Tests laden und die Zellen direkt im Bild anklicken'), onclick: () => openTestPhotoDialog(ed, structuredClone(o)) }, t('Foto auswerten …')),
    );
  };

  const applyPicked = () => picked && applyCell(ed, o, picked.r, picked.c);
  const savePicked = () => picked && saveCell(ed, o, picked.r, picked.c);
  /** Gelaserter Test: Einstellungen für die Auswertung per Foto merken */
  const ran = () => save(o, LAST_KEY);

  const source = (): JobSource => {
    const test = buildTestDoc(o, ed.doc.bed, font);
    const n = test.cells.length;
    return {
      doc: test.doc,
      layer: (i) => test.doc.layers[i],
      imgLayer: () => defaultImageLayer(),
      name: t('Materialtest'),
      color: (i) => (i >= n ? '#3070d0' : cellColor(0.6)),
    };
  };

  const dlg = h('dialog', { class: 'mt-dialog' },
    h('h3', {}, t('Materialtest')),
    h('div', { class: 'mt-body' },
      h('div', { class: 'mt-left' }, form),
      h('div', { class: 'mt-right' }, svgBox, pickBox, info,
        h('div', { class: 'note' }, t('Weitere Einstellungen (Scanwinkel, Überfahrweg, Bidirektional) kommen von den Standardwerten. Der Test wird nicht auf der Arbeitsfläche abgelegt.')),
      ),
    ),
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'btn', title: t('Ablauf und Dauer ansehen'), onclick: () => openPreview(ed, source()) }, t('Vorschau')),
      h('button', { class: 'btn', title: t('Umriss des Tests abfahren'), onclick: () => frameJob(ed, false, source()) }, t('Rahmen')),
      h('button', { class: 'btn', onclick: () => (ran(), saveGCode(ed, source())) }, t('G-Code speichern')),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Schließen')),
      h('button', { class: 'btn primary', title: t('Test an den verbundenen Laser senden'), onclick: () => (ran(), startJob(ed, source())) }, t('Starten')),
    ),
  );
  render();
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
}

