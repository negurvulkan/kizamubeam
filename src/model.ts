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
  ['threshold', 'Schwellwert'],
  ['ordered', 'Geordnet'],
  ['atkinson', 'Atkinson'],
  ['floyd', 'Dither (Floyd-Steinberg)'],
  ['stucki', 'Stucki'],
  ['jarvis', 'Jarvis'],
  ['halftone', 'Halbton'],
  ['grayscale', 'Graustufen'],
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
}

export interface Obj {
  id: number;
  m: Mat;
  /** Layer-/Paletten-Index 0..31 */
  layer: number;
  shape: Shape;
}

export type LayerMode = 'line' | 'fill';

export interface Layer {
  index: number;
  name: string;
  mode: LayerMode;
  /** mm/min */
  speed: number;
  /** % */
  power: number;
  minPower: number;
  passes: number;
  /** Zeilenabstand bei Fill in mm */
  interval: number;
  output: boolean;
  show: boolean;
  /** Ausgabereihenfolge (kleiner = früher) */
  priority?: number;
  /** Einstellungen für die Bilder dieses Layers */
  img?: ImageLayer;
}

export interface Doc {
  version: 1;
  bed: { w: number; h: number };
  objs: Obj[];
  layers: Record<number, Layer>;
  /** Nur in Projektdateien: Bilddaten (Asset-ID → data:-URL) */
  assets?: Record<string, string>;
}

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
    index,
    name: `C${layerLabel(index)}`,
    mode: index === 0 ? 'fill' : 'line',
    speed: index === 0 ? 3000 : 600,
    power: index === 0 ? 30 : 80,
    minPower: 0,
    passes: 1,
    interval: 0.1,
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
  return { version: 1, bed: { w: 400, h: 400 }, objs: [], layers: {} };
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

export function setLayerDeep(o: Obj, layer: number) {
  o.layer = layer;
  if (o.shape.kind === 'group') o.shape.children.forEach((c) => setLayerDeep(c, layer));
}
