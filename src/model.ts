import { t } from './i18n';
// Datenmodell: Dokument, Objekte, Layer, Matrizen.
// Interne Koordinaten sind Millimeter mit y nach unten (wie SVG), Ursprung oben links am Bett.
// Angezeigt wird in Maschinenkoordinaten (Ursprung unten links, y nach oben).

export type Mat = [number, number, number, number, number, number]; // a b c d e f

export const IDENT: Mat = [1, 0, 0, 1, 0, 0];

export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function inv(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function apply(m: Mat, x: number, y: number): Pt {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const scale = (sx: number, sy: number): Mat => [sx, 0, 0, sy, 0, 0];
export const rotate = (a: number): Mat => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
/** Transformation m um den Punkt (cx, cy) herum. */
export const about = (m: Mat, cx: number, cy: number): Mat => mul(translate(cx, cy), mul(m, translate(-cx, -cy)));

export interface Pt {
  x: number;
  y: number;
}

export interface Node {
  x: number;
  y: number;
  /** Eingehender Bézier-Anfasser (absolut, lokal) */
  cin?: Pt;
  /** Ausgehender Bézier-Anfasser */
  cout?: Pt;
  /** Anfasser bleiben beim Ziehen gespiegelt */
  smooth?: boolean;
}

export interface SubPath {
  nodes: Node[];
  closed: boolean;
}

export type Shape =
  | { kind: 'rect'; w: number; h: number; r: number }
  | { kind: 'ellipse'; rx: number; ry: number }
  | { kind: 'polygon'; sides: number; r: number; star: boolean; inner: number }
  | { kind: 'path'; subs: SubPath[] }
  | TextShape
  | ImageShape
  | { kind: 'group'; children: Obj[] };

/** Bildanpassungen je Bild (wie „Adjust Image“ in LightBurn) */
export interface ImageAdjust {
  /** -100 … 100 */
  brightness: number;
  /** -100 … 100 */
  contrast: number;
  /** 0,1 … 5, 1 = unverändert */
  gamma: number;
  /** Schärfen (Unscharfmaskierung): Stärke 0 … 300 % */
  sharpen: number;
  /** Radius der Unscharfmaskierung in Bildpunkten der Ausgabe */
  sharpenRadius: number;
  /** Unterschiede unter diesem Wert (0 … 50) werden nicht geschärft */
  denoise: number;
}

export const DEFAULT_ADJUST: ImageAdjust = { brightness: 0, contrast: 0, gamma: 1, sharpen: 0, sharpenRadius: 1, denoise: 0 };

/** Rasterbild. Lokale Fläche 0..w × 0..h in mm; die Bilddaten liegen im Asset-Speicher (images.ts). */
export interface ImageShape {
  kind: 'image';
  asset: string;
  w: number;
  h: number;
  /** Pixelmaße des Originals */
  pxW: number;
  pxH: number;
  name?: string;
  adjust: ImageAdjust;
}

export type DitherMode = 'threshold' | 'ordered' | 'atkinson' | 'floyd' | 'stucki' | 'jarvis' | 'halftone' | 'grayscale';

export const DITHER_MODES: [DitherMode, string][] = [
  ['threshold', t('Schwellwert')],
  ['ordered', t('Geordnet')],
  ['atkinson', t('Atkinson')],
  ['floyd', t('Dither (Floyd-Steinberg)')],
  ['stucki', t('Stucki')],
  ['jarvis', t('Jarvis')],
  ['halftone', t('Halbton')],
  ['grayscale', t('Graustufen')],
];

/** Einstellungen für Bilder auf einem Layer (eigener Eintrag „Bild“ in der Layer-Tabelle) */
export interface ImageLayer {
  speed: number;
  power: number;
  minPower: number;
  passes: number;
  /** Zeilenabstand in mm (DPI = 25,4 / interval) */
  interval: number;
  dither: DitherMode;
  negative: boolean;
  bidirectional: boolean;
  /** Überfahrweg in % der Geschwindigkeit */
  overscan: number;
  /** Halbton: Zellen pro Zoll und Rasterwinkel */
  cells: number;
  angle: number;
  /** Schwellwert-Verfahren: Grenze 0 … 255 */
  threshold: number;
}

export function defaultImageLayer(): ImageLayer {
  return {
    speed: 3000, power: 30, minPower: 0, passes: 1, interval: 0.1, dither: 'jarvis', negative: false,
    bidirectional: true, overscan: 2.5, cells: 50, angle: 45, threshold: 128,
  };
}

export interface TextShape {
  kind: 'text';
  text: string;
  font: string;
  /** Schriftgröße in mm (Em-Höhe) */
  size: number;
  bold: boolean;
  italic: boolean;
  upper: boolean;
  align: 'left' | 'center' | 'right';
  /** zusätzlicher Zeichenabstand in mm */
  hSpace: number;
  /** zusätzlicher Zeilenabstand in mm */
  vSpace: number;
  /** Buchstaben schweißen: überlappende Glyphen zu einer Kontur verschmelzen */
  weld?: boolean;
  /** Text auf Pfad: die Grundlinie folgt dieser Kurve */
  path?: TextPath;
}

/** Kurve für Text auf Pfad, in lokalen Koordinaten des Texts (Kopie der gewählten Form) */
export interface TextPath {
  sub: SubPath;
  /** Verschiebung entlang der Kurve in mm (vom Anfang, der Mitte oder dem Ende je nach Ausrichtung; bei geschlossenen Formen vom obersten Punkt) */
  offset: number;
  /** Abstand der Grundlinie von der Kurve in mm; positiv = nach oben vom Text aus gesehen */
  dist: number;
  /** Laufrichtung umkehren: Text auf der anderen Seite der Kurve */
  flip: boolean;
}

export interface Obj {
  id: number;
  m: Mat;
  /** Layer-/Paletten-Index 0..31 */
  layer: number;
  shape: Shape;
  /** Eigener Name aus dem Objekte-Fenster (sonst wird er aus der Form abgeleitet) */
  name?: string;
  /** Ausgeblendet: nicht gezeichnet, nicht gelasert, nicht exportiert */
  hidden?: boolean;
  /** Gesperrt: auf der Arbeitsfläche nicht auswählbar (nur oberste Ebene) */
  locked?: boolean;
}

export type LayerMode = 'line' | 'fill';

/** Haltestege (Tabs/Brücken): kurze Stellen, an denen der Laser aus ist, damit Teile nicht herausfallen */
export interface TabSettings {
  enabled: boolean;
  /** Länge eines Stegs in mm */
  size: number;
  /** true: feste Anzahl je Form, false: Abstand in mm */
  useCount: boolean;
  count: number;
  spacing: number;
  /** Formen, die in anderen Formen liegen (Löcher), bekommen keine Stege */
  skipInner: boolean;
}

/**
 * Bearbeitungseinstellungen eines Layers (wie im Cut Settings Editor von LightBurn).
 * Alles, was eine Material-Bibliothek speichern und wieder auf einen Layer anwenden kann.
 */
export interface CutSettings {
  mode: LayerMode;
  /** mm/min */
  speed: number;
  /** % */
  power: number;
  minPower: number;
  passes: number;
  /** Air Assist während dieses Layers einschalten (M8/M7, aus mit M9) */
  air: boolean;
  /** Kerf-Versatz in mm: positiv = Außenkonturen nach außen, Löcher nach innen */
  kerf: number;
  /** Nur Linie: Haltestege */
  tabs: TabSettings;
  /** Füllen: Zeilenabstand in mm */
  interval: number;
  /** Füllen: Scanwinkel in Grad (0 = waagerecht) */
  angle: number;
  /** Füllen: zweiter Durchgang um 90° gedreht */
  crossHatch: boolean;
  /** Füllen: in beide Richtungen lasern */
  bidirectional: boolean;
  /** Füllen: Überfahrweg in % der Geschwindigkeit */
  overscan: number;
}

export const CUT_KEYS: (keyof CutSettings)[] = [
  'mode', 'speed', 'power', 'minPower', 'passes', 'air', 'kerf', 'tabs', 'interval', 'angle', 'crossHatch', 'bidirectional', 'overscan',
];

export function defaultTabs(): TabSettings {
  return { enabled: false, size: 0.5, useCount: true, count: 4, spacing: 50, skipInner: true };
}

export function defaultCutSettings(mode: LayerMode = 'line'): CutSettings {
  return {
    mode,
    speed: mode === 'fill' ? 3000 : 600,
    power: mode === 'fill' ? 30 : 80,
    minPower: 0,
    passes: 1,
    air: false,
    kerf: 0,
    tabs: defaultTabs(),
    interval: 0.1,
    angle: 0,
    crossHatch: false,
    bidirectional: true,
    overscan: 2.5,
  };
}

/** Bearbeitungseinstellungen eines Layers als eigenständige Kopie (z. B. für die Material-Bibliothek) */
export function cutSettings(L: CutSettings): CutSettings {
  const out = {} as Record<string, unknown>;
  for (const k of CUT_KEYS) out[k] = structuredClone(L[k]);
  return out as unknown as CutSettings;
}

export interface Layer extends CutSettings {
  index: number;
  name: string;
  output: boolean;
  show: boolean;
  /** Ausgabereihenfolge (kleiner = früher) */
  priority?: number;
  /** Einstellungen für die Bilder dieses Layers */
  img?: ImageLayer;
  /** ID des Eintrags der Material-Bibliothek, aus dem die Einstellungen stammen */
  material?: string;
  /** Objekte dieses Layers sind auf der Arbeitsfläche nicht auswählbar */
  locked?: boolean;
}

/** Ältere Dateien kennen nicht alle Einstellungen: fehlende mit Standardwerten auffüllen */
export function normalizeLayer(L: Layer): Layer {
  if (L.tabs && L.overscan !== undefined) return L;
  const d = defaultCutSettings(L.mode);
  for (const k of CUT_KEYS) if (L[k] === undefined) (L as unknown as Record<string, unknown>)[k] = d[k];
  L.tabs = { ...defaultTabs(), ...L.tabs };
  return L;
}

/** Eine Seite des Projekts: eigene Objekte, Layer-Einstellungen gelten für das ganze Projekt */
export interface Page {
  name: string;
  objs: Obj[];
}

export interface Doc {
  version: 2;
  bed: { w: number; h: number };
  pages: Page[];
  /** Index der aktuellen Seite; gezeichnet, bearbeitet, gelasert und exportiert wird nur sie */
  page: number;
  /**
   * Objekte der aktuellen Seite. Zugriff auf pages[page].objs (nicht aufzählbar, landet also nicht in JSON);
   * Dokumente immer über newDoc() bzw. loadDoc() erzeugen.
   */
  objs: Obj[];
  layers: Record<number, Layer>;
  /** Nur in Projektdateien: Bilddaten (Asset-ID → data:-URL) */
  assets?: Record<string, string>;
}

export const pageName = (i: number) => t('Seite {n}', { n: i + 1 });

/**
 * Rohdaten (Datei, Autosave, Undo-Zwischenstand) zu einem Dokument machen.
 * Ältere einseitige Dateien (version 1, nur objs) werden zu einem Projekt mit einer Seite.
 */
export function loadDoc(raw: unknown): Doc {
  const d = raw as Record<string, unknown>;
  if (!d || typeof d !== 'object') throw new Error(t('Keine gültige Projektdatei'));
  let pages = d.pages as Page[] | undefined;
  if (!Array.isArray(pages)) {
    if (!Array.isArray(d.objs)) throw new Error(t('Keine gültige Projektdatei'));
    pages = [{ name: pageName(0), objs: d.objs as Obj[] }];
  }
  pages = pages.filter((p) => p && Array.isArray(p.objs));
  if (!pages.length) pages = [{ name: pageName(0), objs: [] }];
  pages.forEach((p, i) => (p.name = typeof p.name === 'string' && p.name ? p.name : pageName(i)));
  delete d.objs;
  d.version = 2;
  d.pages = pages;
  d.page = Math.min(Math.max(0, Math.floor(Number(d.page) || 0)), pages.length - 1);
  d.bed ??= { w: 400, h: 400 };
  d.layers ??= {};
  Object.defineProperty(d, 'objs', {
    enumerable: false,
    configurable: true,
    get(this: Doc) {
      return this.pages[this.page].objs;
    },
    set(this: Doc, v: Obj[]) {
      this.pages[this.page].objs = v;
    },
  });
  return d as unknown as Doc;
}

/** Objekte aller Seiten (oberste Ebene) */
export const allObjs = (doc: Doc): Obj[] => doc.pages.flatMap((p) => p.objs);

// Farbpalette 00–29 plus T1/T2 (Werkzeug-Layer), angelehnt an die gewohnte Reihenfolge.
export const PALETTE: string[] = [
  '#000000', '#0000ff', '#ff0000', '#00c000', '#c0c000', '#ff8000', '#00c0c0', '#ff00ff',
  '#a0a0a0', '#0000a0', '#a00000', '#00a000', '#a0a000', '#c08000', '#00a0ff', '#a000a0',
  '#808080', '#7d87b9', '#bb7784', '#4a6fe3', '#d33f6a', '#8cd78c', '#f0b98d', '#f6c4e1',
  '#fa9ed4', '#500a78', '#b45a00', '#004754', '#86fa88', '#e0c040', '#f36926', '#0c96d9',
];

export const layerLabel = (i: number) => (i >= 30 ? `T${i - 29}` : String(i).padStart(2, '0'));

export function defaultLayer(index: number): Layer {
  return {
    ...defaultCutSettings(index === 0 ? 'fill' : 'line'),
    index,
    name: `C${layerLabel(index)}`,
    output: index < 30,
    show: true,
  };
}

let nextId = 1;
export const newId = () => nextId++;
export function bumpIds(objs: Obj[]) {
  const walk = (o: Obj) => {
    nextId = Math.max(nextId, o.id + 1);
    if (o.shape.kind === 'group') o.shape.children.forEach(walk);
  };
  objs.forEach(walk);
}

export function newDoc(): Doc {
  return loadDoc({ version: 2, bed: { w: 400, h: 400 }, pages: [{ name: pageName(0), objs: [] }], page: 0, layers: {} });
}

export function clone<T>(v: T): T {
  return structuredClone(v);
}

/** Tiefe Kopie mit neuen IDs. */
export function cloneObj(o: Obj): Obj {
  const c = clone(o);
  const re = (x: Obj) => {
    x.id = newId();
    if (x.shape.kind === 'group') x.shape.children.forEach(re);
  };
  re(c);
  return c;
}

/** Alle Blatt-Objekte samt Welt-Matrix. */
export function* leaves(objs: Obj[], parent: Mat = IDENT): Generator<[Obj, Mat]> {
  for (const o of objs) {
    const m = mul(parent, o.m);
    if (o.shape.kind === 'group') yield* leaves(o.shape.children, m);
    else yield [o, m];
  }
}

/** Wie leaves(), aber ohne ausgeblendete Objekte (samt dem Inhalt ausgeblendeter Gruppen). */
export function* visibleLeaves(objs: Obj[], parent: Mat = IDENT): Generator<[Obj, Mat]> {
  for (const o of objs) {
    if (o.hidden) continue;
    const m = mul(parent, o.m);
    if (o.shape.kind === 'group') yield* visibleLeaves(o.shape.children, m);
    else yield [o, m];
  }
}

/** Layer, unter dem ein Objekt im Objekte-Fenster steht: bei Gruppen der Layer des ersten Teils */
export function homeLayer(o: Obj): number {
  if (o.shape.kind !== 'group') return o.layer;
  for (const [l] of leaves([o])) return l.layer;
  return o.layer;
}

export function setLayerDeep(o: Obj, layer: number) {
  o.layer = layer;
  if (o.shape.kind === 'group') o.shape.children.forEach((c) => setLayerDeep(c, layer));
}
