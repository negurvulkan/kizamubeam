// Editor: Zustand, Zeichnen auf der Arbeitsfläche, Werkzeuge und Befehle.
import {
  about, allObjs, apply, bumpIds, clone, cloneObjs, DEFAULT_ADJUST, defaultImageLayer, defaultLayer, Doc, normalizeLayer, IDENT, loadDoc, pageName, ImageAdjust, ImageLayer,
  ImageShape, inv, Layer, leaves, Mat, mul, newDoc, newId, Node, Obj, PALETTE, Pt, rotate, scale, setLayerDeep, Shape, SubPath,
  TextPath, TextShape, translate, visibleLeaves, homeLayer, BarcodeShape, VarText,
} from './model';
import { advanceVarText, defaultVarText, expand, parseCsv, setVarTextSource, shownText } from './vartext';
import { barcodeData } from './barcode';
import { ArcLength } from './textpath';
import { addAsset, adjustedGray, assetImage, assetUrl, displayCanvas, onImageReady, registerAsset, restoreAssets, sourceSize } from './images';
import { ImportResult, transformSubs } from './importers';
import { traceGray, TraceOptions } from './trace';
import { BoolBase, BoolOp, booleanOp, OffsetOptions, offsetOp, orderForBoolean } from './ops';
import { loadFont, onFontLoaded, textToSubs } from './fonts';
import { MAX_COPIES } from './arrays';
import { computeJoint, EdgePick, isStraight, JointOptions } from './joints';
import { computeHinge, HingeOptions } from './hinges';
import {
  bezierPt, Box, boundsOf, drawText, hitLeaf, invalidate, invalidateText, leafIntersectsBox, localPath, segments, shapeSubs, subsToPath2D,
  textOutline, worldPath,
} from './geom';
import { AlignGuide, alignBox, alignPoint, buildSnapSet, findSnap, SNAP_LABELS, SnapHit, SnapSet } from './snap';
import { dec, t, tn } from './i18n';

export type Tool = 'select' | 'node' | 'line' | 'rect' | 'ellipse' | 'polygon' | 'text' | 'joint';

export const RULER = 22; // px

/** Farben der Arbeitsfläche je Design */
const CANVAS_THEMES = {
  light: {
    outside: '#c9ccd2', bed: '#ffffff', grid1: '#f2f2f2', grid10: '#e0e0e0', grid100: '#c4c4c4', border: '#30343a',
    sel: '#3070ff', handleFill: '#ffffff', nodeLine: '#8090a0',
    ruler: '#eceef1', rulerLine: '#a8adb5', rulerText: '#4a5058', rulerCorner: '#d6d9de',
    label: 'rgba(30,40,60,0.85)', labelText: '#ffffff',
  },
  dark: {
    outside: '#15171b', bed: '#24272d', grid1: '#2a2e34', grid10: '#343940', grid100: '#4a5059', border: '#8a929c',
    sel: '#5b93f5', handleFill: '#24272d', nodeLine: '#7d8894',
    ruler: '#24282e', rulerLine: '#3a4049', rulerText: '#a3abb5', rulerCorner: '#2e333a',
    label: 'rgba(230,235,245,0.92)', labelText: '#1b1e23',
  },
};
const HANDLE_OFF = 9; // Abstand der Griffe vom Auswahlrahmen in px

type Drag =
  | { type: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | {
      type: 'move'; start: Pt; orig: Mat[]; moved: boolean; toggleRotate: boolean; sx: number; sy: number;
      /** Fangpunkt der Auswahl, an dem gegriffen wurde (sonst null: Ecken und Mitte der Auswahl fangen) */
      anchor: Pt | null; box: Box; snapSet: SnapSet;
    }
  | { type: 'scale'; handle: number; box: Box; orig: Mat[] }
  | { type: 'rotate'; center: Pt; a0: number; orig: Mat[]; angle: number }
  | { type: 'pivot' }
  | { type: 'marquee'; start: Pt; end: Pt; base: Obj[]; mode: 'set' | 'add' | 'toggle' | 'remove' }
  | { type: 'create'; start: Pt; obj: Obj | null; snapSet: SnapSet }
  | { type: 'linenode'; node: Node }
  /** Hilfslinie aus dem Lineal ziehen: 'y' = waagrecht (oberes Lineal), 'x' = senkrecht (linkes Lineal) */
  | { type: 'guide'; axis: 'x' | 'y'; obj: Obj | null; snapSet: SnapSet }
  | {
      type: 'node'; obj: Obj; sub: number; idx: number; which: 'p' | 'cin' | 'cout'; start: Pt; orig: Node; moved: boolean;
      /** Gezogener Punkt in Weltkoordinaten zu Beginn und Fangpunkte ohne die bewegten Knoten */
      origWorld: Pt; snapSet: SnapSet;
      /** Beim Ziehen eines Knotens: alle ausgewählten Knoten mit Ausgangslage */
      group: { sub: number; idx: number; orig: Node }[];
    }
  | { type: 'nodebox'; start: Pt; end: Pt; obj: Obj; base: Set<string>; mode: 'set' | 'add' | 'toggle'; onTarget: boolean };

interface NodeHover {
  sub: number;
  idx: number;
  which: 'p' | 'cin' | 'cout';
}
interface SegHover {
  sub: number;
  seg: number;
  t: number;
}

const SNAPSHOT_LIMIT = 200;
const STORAGE_KEY = 'laserwerk.autosave';
const SNAP_KEY = 'laserwerk.snap';
const BOOL_KEY = 'laserwerk.boolean';
/** Fangabstand in Pixeln; mit Alt größer (wie LightBurn) */
const SNAP_PX = 8;
const SNAP_PX_ALT = 20;
/** Werkzeug-Layer T1: Hilfslinien liegen dort und werden nie gelasert */
const GUIDE_LAYER = 30;
type Mods = { altKey: boolean; ctrlKey: boolean; metaKey: boolean };

/** Längste Kontur einer Form (z. B. die äußere bei mehreren) als Kurve für Text auf Pfad */
function linkCurve(s: Shape): SubPath | null {
  const subs = shapeSubs(s).filter((sp) => sp.nodes.length > 1);
  if (!subs.length) return null;
  return clone(subs.reduce((a, b) => (new ArcLength(b).length > new ArcLength(a).length ? b : a)));
}

export class Editor {
  doc: Doc = newDoc();
  sel: Obj[] = [];
  tool: Tool = 'select';
  rotateMode = false;
  /** Frei gesetzter Drehpunkt im Drehmodus */
  pivot: Pt | null = null;
  view = { zoom: 2, ox: 60, oy: 40 };
  filled = true;
  /** Dunkles Design der Arbeitsfläche */
  dark = false;
  snapGrid = false;
  gridStep = 1;
  /** An Objekten fangen (Knoten, Mittelpunkte, Zentren, Schnittpunkte, Linien) */
  snapObjects = true;
  /** Aktueller Fangpunkt zur Anzeige */
  snapHit: SnapHit | null = null;
  /** Ausrichtungshilfen (Alt) zur Anzeige */
  alignGuides: AlignGuide[] = [];
  private snapCache: { ver: number; set: SnapSet } | null = null;
  private snapVer = 0;
  currentLayer = 0;
  activeLayer: number | null = null;
  polySides = 6;
  polyStar = false;
  rectRadius = 0;
  textDefaults: Omit<TextShape, 'kind' | 'text'> = {
    font: 'Arial', size: 10, bold: false, italic: false, upper: false, align: 'left', hSpace: 0, vSpace: 0,
  };
  cursor: Pt = { x: 0, y: 0 };
  /** Linienwerkzeug: Pfad im Entstehen (Weltkoordinaten) */
  draft: SubPath | null = null;
  nodeHover: NodeHover | null = null;
  segHover: SegHover | null = null;
  /** Ausgewählte Knoten des Knotenziels als "Unterpfad:Index" */
  private nodeSel = new Set<string>();
  private nodeSelObj: Obj | null = null;
  hint = '';

  private undo: string[] = [];
  private redo: string[] = [];
  private clipboard: Obj[] = [];
  private drag: Drag | null = null;
  private space = false;
  private dirty = true;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private listeners = new Set<(what: 'doc' | 'sel' | 'view' | 'tool') => void>();
  private saveTimer = 0;
  textEditor: ((o: Obj, isNew: boolean) => void) | null = null;
  /** Einfügen aus der System-Zwischenablage (Bilder, SVG); true = verarbeitet */
  externalPaste: ((data: DataTransfer) => Promise<boolean>) | null = null;
  private pasteTimer = 0;
  /** Hintergrund auf dem Bett unter dem Raster (Kamerabild), in Weltkoordinaten gezeichnet */
  background: ((ctx: CanvasRenderingContext2D) => void) | null = null;

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.restore();
    setVarTextSource(() => this.doc.vt);
    // Datum und Uhrzeit in variablem Text aktuell halten
    window.setInterval(() => this.refreshVarText(), 15000);
    this.loadSnapSettings();
    this.loadBoolSettings();
    // Texte werden mit den Schriftkonturen gezeichnet; nach dem Laden einer Schrift neu zeichnen
    onFontLoaded(() => this.emit('sel'));
    onImageReady(() => this.redraw());
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointerleave', () => {
      if (this.drag || (!this.nodeHover && !this.segHover && !this.snapHit && !this.alignGuides.length)) return;
      this.nodeHover = this.segHover = null;
      this.clearSnap();
      this.redraw();
    });
    canvas.addEventListener('dblclick', (e) => this.onDouble(e));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('paste', (e) => this.onPaste(e));
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.space = false;
    });
    const loop = () => {
      if (this.dirty) {
        this.dirty = false;
        this.syncTextLinks();
        this.render();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  on(fn: (what: 'doc' | 'sel' | 'view' | 'tool') => void) {
    this.listeners.add(fn);
  }
  emit(what: 'doc' | 'sel' | 'view' | 'tool') {
    this.dirty = true;
    if (what !== 'view') this.snapVer++;
    if (what === 'doc') this.syncTextLinks();
    this.listeners.forEach((f) => f(what));
    if (what === 'doc') this.scheduleSave();
  }
  redraw() {
    this.dirty = true;
  }

  // ---------- Dokument, Undo, Autosave ----------

  layer(i: number): Layer {
    return normalizeLayer((this.doc.layers[i] ??= defaultLayer(i)));
  }
  /** Bild-Einstellungen eines Layers */
  imgLayer(i: number): ImageLayer {
    return (this.layer(i).img ??= defaultImageLayer());
  }
  /** Welche Arten von Objekten liegen auf dem Layer? (Vektoren und Bilder sind getrennte Einträge) */
  layerParts(i: number): { vec: boolean; img: boolean } {
    let vec = false,
      img = false;
    for (const [o] of leaves(this.doc.objs)) {
      if (o.layer !== i) continue;
      if (o.shape.kind === 'image') img = true;
      else vec = true;
    }
    return { vec, img };
  }
  usedLayers(): number[] {
    const set = new Set<number>();
    for (const [o] of leaves(this.doc.objs)) set.add(o.layer);
    return [...set].sort((a, b) => a - b);
  }

  private state() {
    return JSON.stringify({ doc: this.doc, sel: this.sel.map((o) => o.id) });
  }
  private load(json: string) {
    const st = JSON.parse(json);
    this.doc = loadDoc(st.doc);
    bumpIds(allObjs(this.doc));
    const ids = new Set<number>(st.sel ?? []);
    this.sel = this.doc.objs.filter((o) => ids.has(o.id));
    // Gewählte Kanten zeigen auf die alten Objekte
    this.jointPicks = [];
    this.jointHover = null;
  }
  /** Rückgängig/Wiederholen: Zähler und CSV-Daten des variablen Texts gehören nicht zum Verlauf */
  private loadKeepVarText(json: string) {
    const vt = this.doc.vt;
    this.load(json);
    if (vt) this.doc.vt = vt;
    else delete this.doc.vt;
    this.touchVarText();
  }
  /** Während batch(): alle Änderungen zählen als ein Undo-Schritt */
  private batching = false;
  /**
   * Mehrere Änderungen als einen Undo-Schritt ausführen (z. B. ein Aufruf eines KI-Agenten).
   * Ändert sich nichts, bleibt der Verlauf, wie er war.
   */
  async batch<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.batching) return fn();
    const before = this.state();
    const redo = this.redo;
    this.snapshot();
    this.batching = true;
    try {
      return await fn();
    } finally {
      this.batching = false;
      if (this.state() === before) {
        this.undo.pop();
        this.redo = redo;
      }
    }
  }
  /** Vor jeder Änderung aufrufen. */
  snapshot() {
    if (this.batching) return;
    this.undo.push(this.state());
    if (this.undo.length > SNAPSHOT_LIMIT) this.undo.shift();
    this.redo = [];
  }
  private dropSnapshot() {
    if (this.batching) return;
    this.undo.pop();
  }
  doUndo() {
    const s = this.undo.pop();
    if (!s) return;
    this.redo.push(this.state());
    this.loadKeepVarText(s);
    this.emit('doc');
    this.emit('sel');
  }
  doRedo() {
    const s = this.redo.pop();
    if (!s) return;
    this.undo.push(this.state());
    this.loadKeepVarText(s);
    this.emit('doc');
    this.emit('sel');
  }
  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 500);
  }
  /** Zwischenstand sofort sichern, z. B. vor dem Neuladen der Oberfläche */
  saveNow() {
    clearTimeout(this.saveTimer);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.doc));
    } catch {
      /* Speicher nicht verfügbar */
    }
  }
  private restore() {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s) {
        this.doc = loadDoc(JSON.parse(s));
        bumpIds(allObjs(this.doc));
        restoreAssets(this.assetIds());
      }
    } catch {
      this.doc = newDoc();
    }
  }
  /** IDs aller im Dokument verwendeten Bilder */
  assetIds(objs: Obj[] = allObjs(this.doc)): string[] {
    const ids = new Set<string>();
    for (const [o] of leaves(objs)) if (o.shape.kind === 'image') ids.add(o.shape.asset);
    return [...ids];
  }
  /** Projektdatei: Dokument samt Bilddaten */
  serialize() {
    const assets: Record<string, string> = {};
    for (const id of this.assetIds()) {
      const url = assetUrl(id);
      if (url) assets[id] = url;
    }
    return JSON.stringify(Object.keys(assets).length ? { ...this.doc, assets } : this.doc, null, 1);
  }
  openDoc(json: string) {
    const d = loadDoc(JSON.parse(json));
    if (d.assets) for (const [id, url] of Object.entries(d.assets)) registerAsset(id, url);
    delete d.assets;
    restoreAssets(this.assetIds(allObjs(d)));
    this.snapshot();
    this.clearPageState();
    this.doc = d;
    bumpIds(allObjs(d));
    this.zoomPage();
    this.emit('doc');
    this.emit('sel');
  }
  newDocument() {
    this.snapshot();
    this.clearPageState();
    const bed = this.doc.bed;
    this.doc = newDoc();
    this.doc.bed = { ...bed };
    this.emit('doc');
    this.emit('sel');
  }

  // ---------- Seiten ----------

  /** Beim Wechsel der Seite: Auswahl und alles, was auf Objekte der alten Seite zeigt, verwerfen */
  private clearPageState() {
    if (this.drag) this.cancelDrag();
    if (this.draft) this.finishLine();
    this.sel = [];
    this.pivot = null;
    this.rotateMode = false;
    this.nodeSel.clear();
    this.nodeSelObj = null;
    this.nodeHover = this.segHover = null;
    this.jointPicks = [];
    this.jointHover = null;
    this.clearSnap();
  }
  /** Zur Seite i wechseln (kein eigener Undo-Schritt) */
  setPage(i: number) {
    i = Math.max(0, Math.min(this.doc.pages.length - 1, i));
    if (i === this.doc.page) return;
    this.clearPageState();
    this.doc.page = i;
    this.emit('doc');
    this.emit('sel');
  }
  /** Neue leere Seite hinter der aktuellen (oder an Stelle at) anlegen und zu ihr wechseln */
  addPage(name?: string, at = this.doc.page + 1): number {
    this.snapshot();
    at = Math.max(0, Math.min(this.doc.pages.length, at));
    this.doc.pages.splice(at, 0, { name: name?.trim() || this.freePageName(), objs: [] });
    this.clearPageState();
    this.doc.page = at;
    this.emit('doc');
    this.emit('sel');
    return at;
  }
  /** Seite i samt Objekten (mit neuen IDs) dahinter kopieren und zu ihr wechseln */
  duplicatePage(i = this.doc.page): number {
    const src = this.doc.pages[i];
    if (!src) return -1;
    this.snapshot();
    this.doc.pages.splice(i + 1, 0, { name: t('{name} (Kopie)', { name: src.name }), objs: cloneObjs(src.objs) });
    this.clearPageState();
    this.doc.page = i + 1;
    this.emit('doc');
    this.emit('sel');
    return i + 1;
  }
  /** Seite i löschen; die letzte Seite bleibt immer stehen */
  deletePage(i = this.doc.page) {
    if (this.doc.pages.length < 2 || !this.doc.pages[i]) return;
    this.snapshot();
    this.doc.pages.splice(i, 1);
    const cur = this.doc.page;
    this.clearPageState();
    this.doc.page = Math.min(cur > i ? cur - 1 : cur, this.doc.pages.length - 1);
    this.emit('doc');
    this.emit('sel');
  }
  renamePage(i: number, name: string) {
    const p = this.doc.pages[i];
    name = name.trim();
    if (!p || !name || name === p.name) return;
    this.snapshot();
    p.name = name;
    this.emit('doc');
  }
  /** Seite from an die Stelle to schieben (Index nach dem Herausnehmen) */
  movePage(from: number, to: number) {
    const n = this.doc.pages.length;
    if (from === to || from < 0 || from >= n || to < 0 || to >= n) return;
    this.snapshot();
    const cur = this.doc.pages[this.doc.page];
    const [p] = this.doc.pages.splice(from, 1);
    this.doc.pages.splice(to, 0, p);
    this.doc.page = this.doc.pages.indexOf(cur);
    this.emit('doc');
  }
  /** Oberste Objekte der aktuellen Seite auf Seite i verschieben (vor alle Objekte dort) */
  moveToPage(objs: Obj[], i: number) {
    const target = this.doc.pages[i];
    const moving = this.doc.objs.filter((o) => objs.includes(o));
    if (!target || i === this.doc.page || !moving.length) return;
    this.snapshot();
    this.doc.objs = this.doc.objs.filter((o) => !moving.includes(o));
    target.objs.push(...moving);
    this.setSel(this.sel.filter((o) => !moving.includes(o)));
    this.emit('doc');
  }
  private freePageName(): string {
    const used = new Set(this.doc.pages.map((p) => p.name));
    for (let n = this.doc.pages.length; ; n++) if (!used.has(pageName(n))) return pageName(n);
  }
  /** Form wurde direkt verändert: Zwischenspeicher leeren. */
  touch(s: Shape) {
    invalidate(s);
    bumpShapeVersion(s);
    if (s.kind === 'text') invalidateText(s);
  }

  // ---------- Ansicht ----------

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    if (!this.sized) {
      this.sized = true;
      this.zoomPage();
    }
    this.dirty = true;
  }
  private sized = false;
  get w() {
    return this.canvas.width / this.dpr;
  }
  get h() {
    return this.canvas.height / this.dpr;
  }
  toWorld(sx: number, sy: number): Pt {
    return { x: (sx - this.view.ox) / this.view.zoom, y: (sy - this.view.oy) / this.view.zoom };
  }
  toScreen(p: Pt): Pt {
    return { x: p.x * this.view.zoom + this.view.ox, y: p.y * this.view.zoom + this.view.oy };
  }
  zoomBox(b: Box, pad = 30) {
    const W = this.w - RULER - pad * 2,
      H = this.h - RULER - pad * 2;
    if (W <= 0 || H <= 0) return;
    const z = Math.min(W / Math.max(b.w, 1), H / Math.max(b.h, 1));
    this.view.zoom = Math.min(200, z);
    this.view.ox = RULER + pad + (W - b.w * this.view.zoom) / 2 - b.x * this.view.zoom;
    this.view.oy = RULER + pad + (H - b.h * this.view.zoom) / 2 - b.y * this.view.zoom;
    this.emit('view');
  }
  zoomPage() {
    this.zoomBox({ x: 0, y: 0, w: this.doc.bed.w, h: this.doc.bed.h });
  }
  zoomSelection() {
    const b = this.selBounds();
    if (b) this.zoomBox(b, 60);
  }
  zoomAt(f: number, sx = this.w / 2, sy = this.h / 2) {
    const z = Math.max(0.05, Math.min(500, this.view.zoom * f));
    const wpt = this.toWorld(sx, sy);
    this.view.zoom = z;
    this.view.ox = sx - wpt.x * z;
    this.view.oy = sy - wpt.y * z;
    this.emit('view');
  }
  /** Maschinenkoordinaten (Ursprung unten links) */
  toMachine(p: Pt): Pt {
    return { x: p.x, y: this.doc.bed.h - p.y };
  }

  // ---------- Auswahl ----------

  selBounds(): Box | null {
    return boundsOf(this.sel);
  }
  setSel(objs: Obj[]) {
    if (objs.length !== this.sel.length || objs.some((o, i) => o !== this.sel[i])) {
      this.pivot = null;
      this.rotateMode = false;
    }
    this.sel = objs;
    if (!objs.length) this.rotateMode = false;
    this.emit('sel');
  }
  /** Oberstes Objekt der Ebene 0 unter dem Weltpunkt. */
  hitTest(p: Pt): Obj | null {
    const tol = 4 / this.view.zoom;
    for (let i = this.doc.objs.length - 1; i >= 0; i--) {
      const top = this.doc.objs[i];
      if (this.isLocked(top)) continue;
      for (const [leaf, m] of visibleLeaves([top])) {
        const ly = this.layer(leaf.layer);
        if (!ly.show) continue;
        if (hitLeaf(leaf, m, p, tol, this.filled && ly.mode === 'fill')) return top;
      }
    }
    return null;
  }

  private handlePoints(b: Box): Pt[] {
    const a = this.toScreen({ x: b.x, y: b.y }),
      c = this.toScreen({ x: b.x + b.w, y: b.y + b.h });
    const x0 = a.x - HANDLE_OFF,
      y0 = a.y - HANDLE_OFF,
      x1 = c.x + HANDLE_OFF,
      y1 = c.y + HANDLE_OFF,
      xm = (x0 + x1) / 2,
      ym = (y0 + y1) / 2;
    return [
      { x: x0, y: y0 }, { x: xm, y: y0 }, { x: x1, y: y0 }, { x: x1, y: ym },
      { x: x1, y: y1 }, { x: xm, y: y1 }, { x: x0, y: y1 }, { x: x0, y: ym },
    ];
  }
  private hitHandle(sx: number, sy: number): number {
    const b = this.selBounds();
    if (!b) return -1;
    const hs = this.handlePoints(b);
    for (let i = 0; i < 8; i++) {
      if (this.rotateMode && i % 2 === 1) continue;
      if (Math.abs(hs[i].x - sx) <= 5 && Math.abs(hs[i].y - sy) <= 5) return i;
    }
    return -1;
  }
  /** Bereich knapp außerhalb der Eckgriffe: dort dreht Ziehen die Auswahl auch im Skaliermodus. */
  private hitRotateZone(sx: number, sy: number): boolean {
    const b = this.selBounds();
    if (!b) return false;
    const hs = this.handlePoints(b);
    const inside = sx > hs[0].x && sx < hs[4].x && sy > hs[0].y && sy < hs[4].y;
    if (inside) return false;
    return [0, 2, 4, 6].some((i) => {
      const d = Math.hypot(hs[i].x - sx, hs[i].y - sy);
      return d > 6 && d < 24;
    });
  }
  /** Drehpunkt: frei gesetzter Punkt oder Mitte der Auswahl */
  rotationCenter(): Pt | null {
    const b = this.selBounds();
    if (!b) return null;
    return this.pivot ?? { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
  private hitPivot(sx: number, sy: number): boolean {
    if (!this.rotateMode) return false;
    const c = this.rotationCenter();
    if (!c) return false;
    const q = this.toScreen(c);
    return Math.hypot(q.x - sx, q.y - sy) < 8;
  }
  private startRotate(wp: Pt) {
    this.snapshot();
    const c = this.rotationCenter()!;
    this.drag = { type: 'rotate', center: c, a0: Math.atan2(wp.y - c.y, wp.x - c.x), orig: this.sel.map((o) => o.m), angle: 0 };
  }

  // ---------- Werkzeuge ----------

  setTool(t: Tool) {
    if (this.draft) this.finishLine();
    this.tool = t;
    this.nodeHover = this.segHover = null;
    this.jointPicks = [];
    this.jointHover = null;
    this.clearSnap();
    this.hint = TOOL_HINTS[t];
    this.canvas.style.cursor = t === 'select' ? 'default' : t === 'text' ? 'text' : 'crosshair';
    this.emit('tool');
  }

  // ---------- Fangen ----------

  /** Fang-Einstellungen ändern und merken */
  setSnap(patch: { grid?: boolean; objects?: boolean; step?: number }) {
    if (patch.grid !== undefined) this.snapGrid = patch.grid;
    if (patch.objects !== undefined) this.snapObjects = patch.objects;
    if (patch.step !== undefined && patch.step > 0) this.gridStep = patch.step;
    try {
      localStorage.setItem(SNAP_KEY, JSON.stringify({ grid: this.snapGrid, objects: this.snapObjects, step: this.gridStep }));
    } catch {
      /* Speicher nicht verfügbar */
    }
    this.emit('view');
  }
  private loadSnapSettings() {
    try {
      const st = JSON.parse(localStorage.getItem(SNAP_KEY) ?? '{}');
      if (typeof st.grid === 'boolean') this.snapGrid = st.grid;
      if (typeof st.objects === 'boolean') this.snapObjects = st.objects;
      if (typeof st.step === 'number' && st.step > 0) this.gridStep = st.step;
    } catch {
      /* Standardwerte */
    }
  }
  private clearSnap() {
    this.snapHit = null;
    this.alignGuides = [];
  }
  /** Fangpunkte aller sichtbaren Objekte außer skip */
  private buildSnap(skip: Obj[] = []): SnapSet {
    return buildSnapSet(this.doc.objs, (o) => this.layer(o.layer).show, new Set(skip));
  }
  /** Fangpunkte aller Objekte, zwischengespeichert bis zur nächsten Änderung */
  private hoverSnapSet(): SnapSet {
    if (!this.snapCache || this.snapCache.ver !== this.snapVer) this.snapCache = { ver: this.snapVer, set: this.buildSnap() };
    return this.snapCache.set;
  }
  /** Ctrl hält gedrückt: Fangen umkehren (Standard: aus), wie in LightBurn */
  private snapModes(e: Mods | null, toggle: boolean) {
    const flip = !!e && toggle && (e.ctrlKey || e.metaKey);
    return { obj: this.snapObjects !== flip, grid: this.snapGrid !== flip, alt: !!e?.altKey };
  }
  private gridRound(p: Pt): Pt {
    const g = this.gridStep;
    return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
  }
  /**
   * Weltpunkt fangen: zuerst Objektfang, mit Alt Ausrichtung an Fangpunkten, sonst Raster.
   * toggle: Ctrl kehrt das Fangen um (nicht beim Aufziehen von Formen, dort heißt Ctrl „von der Mitte“).
   */
  private snapPt(p: Pt, e: Mods | null, opt: { set?: SnapSet; extra?: Pt[]; toggle?: boolean } = {}): Pt {
    this.clearSnap();
    const md = this.snapModes(e, opt.toggle ?? true);
    if (md.obj) {
      const set = opt.set ?? this.hoverSnapSet();
      const tol = (md.alt ? SNAP_PX_ALT : SNAP_PX) / this.view.zoom;
      const hit = findSnap(set, p, tol, opt.extra);
      if (hit) {
        this.snapHit = hit;
        return hit.p;
      }
      if (md.alt) {
        const a = alignPoint(set, p, tol, opt.extra);
        if (a.guides.length) {
          this.alignGuides = a.guides;
          return a.p;
        }
      }
    }
    return md.grid ? this.gridRound(p) : p;
  }
  /** Verschiebung der Auswahl fangen: Griffpunkt oder Ecken/Mitte der Auswahl an anderen Objekten, Alt richtet Kanten aus */
  private snapMove(d: Extract<Drag, { type: 'move' }>, dx: number, dy: number, e: Mods): [number, number] {
    this.clearSnap();
    const md = this.snapModes(e, true);
    const tol = (md.alt ? SNAP_PX_ALT : SNAP_PX) / this.view.zoom;
    if (md.obj) {
      const b = d.box;
      const own = d.anchor
        ? [d.anchor]
        : [0, 0.5, 1].flatMap((fx) => [0, 0.5, 1].map((fy) => ({ x: b.x + fx * b.w, y: b.y + fy * b.h })));
      let best: { hit: SnapHit; from: Pt; dist: number } | null = null;
      for (const pass of ['point', 'line'] as const) {
        for (const q of own) {
          const moved = { x: q.x + dx, y: q.y + dy };
          const hit = findSnap(d.snapSet, moved, tol);
          if (!hit || (pass === 'point') === (hit.kind === 'line')) continue;
          const dist = Math.hypot(hit.p.x - moved.x, hit.p.y - moved.y);
          if (!best || dist < best.dist) best = { hit, from: q, dist };
        }
        if (best) break;
      }
      if (best) {
        this.snapHit = best.hit;
        return [best.hit.p.x - best.from.x, best.hit.p.y - best.from.y];
      }
      if (md.alt) {
        const a = alignBox(d.snapSet, { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h }, tol);
        if (a.guides.length) {
          this.alignGuides = a.guides;
          dx += a.dx;
          dy += a.dy;
          // nicht ausgerichtete Achse darf noch am Raster fangen
          if (md.grid && !a.guides.some((g) => g.axis === 'x')) dx = this.gridDelta(d, dx, 'x');
          if (md.grid && !a.guides.some((g) => g.axis === 'y')) dy = this.gridDelta(d, dy, 'y');
          return [dx, dy];
        }
      }
    }
    if (md.grid) return [this.gridDelta(d, dx, 'x'), this.gridDelta(d, dy, 'y')];
    return [dx, dy];
  }
  /** Rasterfang beim Verschieben: der Griffpunkt landet auf dem Raster, ohne Griffpunkt wird der Weg gerundet */
  private gridDelta(d: Extract<Drag, { type: 'move' }>, v: number, axis: 'x' | 'y'): number {
    const g = this.gridStep;
    if (!d.anchor) return Math.round(v / g) * g;
    return Math.round((d.anchor[axis] + v) / g) * g - d.anchor[axis];
  }
  /** Hilfslinie fangen: an der Höhe (bzw. x-Lage) des nächsten Fangpunkts irgendwo auf der Fläche, sonst am Raster */
  private snapGuide(d: Extract<Drag, { type: 'guide' }>, wp: Pt, e: Mods): number {
    this.clearSnap();
    const md = this.snapModes(e, true);
    const ax = d.axis;
    if (md.obj) {
      const tol = (md.alt ? SNAP_PX_ALT : SNAP_PX) / this.view.zoom;
      let best: (typeof d.snapSet.pts)[number] | null = null;
      for (const q of d.snapSet.pts) if (Math.abs(q[ax] - wp[ax]) <= tol && (!best || Math.abs(q[ax] - wp[ax]) < Math.abs(best[ax] - wp[ax]))) best = q;
      if (best) {
        this.snapHit = { p: { x: best.x, y: best.y }, kind: best.kind };
        return best[ax];
      }
    }
    return md.grid ? this.gridRound(wp)[ax] : wp[ax];
  }
  /** Ist der Werkzeug-Modus einer, bei dem der Mauszeiger schon ohne Ziehen fängt? */
  private get drawTool() {
    return this.tool === 'line' || this.tool === 'rect' || this.tool === 'ellipse' || this.tool === 'polygon' || this.tool === 'text';
  }
  /** Neue Hilfslinie (Werkzeug-Layer T1) über das ganze Bett */
  private makeGuide(axis: 'x' | 'y', v: number): Obj {
    const { w, h } = this.doc.bed;
    const nodes = axis === 'y' ? [{ x: 0, y: 0 }, { x: w, y: 0 }] : [{ x: 0, y: 0 }, { x: 0, y: h }];
    return {
      id: newId(), m: axis === 'y' ? translate(0, v) : translate(v, 0), layer: GUIDE_LAYER,
      shape: { kind: 'path', subs: [{ nodes, closed: false }] },
    };
  }

  private evPt(e: PointerEvent | MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  private onDown(e: PointerEvent) {
    const { sx, sy } = this.evPt(e);
    const wp = this.toWorld(sx, sy);
    this.canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && this.space)) {
      this.drag = { type: 'pan', sx, sy, ox: this.view.ox, oy: this.view.oy };
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button === 2) {
      if (this.draft) this.finishLine();
      return;
    }
    if (e.button !== 0) return;
    const ctrl = e.ctrlKey || e.metaKey;
    // Aus dem Lineal ziehen: Hilfslinie (oben waagrecht, links senkrecht)
    if ((sy < RULER) !== (sx < RULER) && !this.drag) {
      if (this.draft) this.finishLine();
      this.drag = { type: 'guide', axis: sy < RULER ? 'y' : 'x', obj: null, snapSet: this.hoverSnapSet() };
      return;
    }
    switch (this.tool) {
      case 'select': {
        if (this.hitPivot(sx, sy)) {
          this.drag = { type: 'pivot' };
          return;
        }
        const h = this.hitHandle(sx, sy);
        if (h >= 0) {
          if (this.rotateMode) return this.startRotate(wp);
          this.snapshot();
          this.drag = { type: 'scale', handle: h, box: this.selBounds()!, orig: this.sel.map((o) => o.m) };
          return;
        }
        if (this.hitRotateZone(sx, sy)) return this.startRotate(wp);
        const o = this.hitTest(wp);
        if (o) {
          const was = this.sel.includes(o);
          if (e.shiftKey && ctrl) this.setSel(this.sel.filter((x) => x !== o));
          else if (ctrl) this.setSel(was ? this.sel.filter((x) => x !== o) : [...this.sel, o]);
          else if (e.shiftKey) {
            if (!was) this.setSel([...this.sel, o]);
          } else if (!was) {
            this.rotateMode = false;
            this.setSel([o]);
          }
          if (!this.sel.includes(o)) return;
          // Wird an einem Fangpunkt der Auswahl gegriffen, fängt genau dieser Punkt
          const own = findSnap(buildSnapSet(this.sel, (l) => this.layer(l.layer).show), wp, SNAP_PX / this.view.zoom);
          this.drag = {
            type: 'move', start: wp, orig: this.sel.map((x) => x.m), moved: false,
            toggleRotate: was && !e.shiftKey && !ctrl, sx, sy,
            anchor: own && own.kind !== 'line' ? own.p : null, box: this.selBounds()!, snapSet: this.buildSnap(this.sel),
          };
        } else {
          const mode = e.shiftKey && ctrl ? 'remove' : ctrl ? 'toggle' : e.shiftKey ? 'add' : 'set';
          if (mode === 'set' && this.sel.length) this.setSel([]);
          this.drag = { type: 'marquee', start: wp, end: wp, base: [...this.sel], mode };
        }
        return;
      }
      case 'rect':
      case 'ellipse':
      case 'polygon':
        this.drag = { type: 'create', start: this.snapPt(wp, e, { toggle: false }), obj: null, snapSet: this.hoverSnapSet() };
        return;
      case 'line': {
        const p = this.snapPt(wp, e, { extra: this.draft?.nodes });
        if (!this.draft) this.draft = { nodes: [], closed: false };
        const ns = this.draft.nodes;
        if (ns.length >= 2) {
          const f = this.toScreen(ns[0]);
          if (Math.hypot(f.x - sx, f.y - sy) < 8) {
            this.draft.closed = true;
            this.finishLine();
            return;
          }
        }
        const n: Node = { x: p.x, y: p.y };
        ns.push(n);
        this.drag = { type: 'linenode', node: n };
        this.redraw();
        return;
      }
      case 'text': {
        e.preventDefault(); // Fokus bleibt im Texteingabefeld
        const o = this.hitTest(wp);
        if (o && o.shape.kind === 'text') {
          this.setSel([o]);
          this.textEditor?.(o, false);
          return;
        }
        const p = this.snapPt(wp, e);
        this.clearSnap();
        this.snapshot();
        const t: Obj = {
          id: newId(), m: translate(p.x, p.y), layer: this.currentLayer,
          shape: { kind: 'text', text: '', ...this.textDefaults },
        };
        this.doc.objs.push(t);
        this.setSel([t]);
        this.emit('doc');
        this.textEditor?.(t, true);
        return;
      }
      case 'joint': {
        const h = this.jointHover;
        if (!h) return;
        const i = this.jointPicks.findIndex((p) => p.obj === h.obj && p.sub === h.sub && p.seg === h.seg);
        if (i >= 0) this.jointPicks.splice(i, 1);
        else this.jointPicks = [...this.jointPicks.slice(-1), h];
        this.hint = this.jointPicks.length === 1 ? JOINT_HINT_SECOND : TOOL_HINTS.joint;
        this.emit('tool');
        this.redraw();
        if (this.jointPicks.length === 2) this.onJointDialog?.();
        return;
      }
      case 'node': {
        const target = this.nodeTarget();
        const add = e.shiftKey || e.ctrlKey || e.metaKey;
        if (target && this.nodeHover) {
          const h = this.nodeHover;
          if (target.shape.kind !== 'path') this.convertObjToPath(target);
          const subs = (target.shape as { subs: SubPath[] }).subs;
          const sel = this.nodeSelection(target);
          const key = `${h.sub}:${h.idx}`;
          if (h.which === 'p') {
            if (add) {
              if (sel.has(key)) {
                sel.delete(key);
                this.emit('sel');
                return;
              }
              sel.add(key);
            } else if (!sel.has(key)) {
              sel.clear();
              sel.add(key);
            }
            this.emit('sel');
          }
          const group = h.which === 'p' ? this.selectedNodes(target).map(({ sub, idx }) => ({ sub, idx, orig: clone(subs[sub].nodes[idx]) })) : [];
          const orig = clone(subs[h.sub].nodes[h.idx]);
          const op = h.which === 'p' ? orig : orig[h.which]!;
          // Fangpunkte: andere Objekte und die ruhenden Knoten des Ziels
          const snapSet = this.buildSnap([target]);
          const moving = new Set(h.which === 'p' ? group.map((g) => `${g.sub}:${g.idx}`) : []);
          subs.forEach((sp, si) =>
            sp.nodes.forEach((n, ni) => {
              if (moving.has(`${si}:${ni}`) || (si === h.sub && ni === h.idx)) return;
              const q = apply(target.m, n.x, n.y);
              snapSet.addPoint(q.x, q.y, 'node');
            }),
          );
          this.snapshot();
          this.drag = {
            type: 'node', obj: target, sub: h.sub, idx: h.idx,
            which: h.which, start: wp, orig, moved: false, group, origWorld: apply(target.m, op.x, op.y), snapSet,
          };
          return;
        }
        if (target && this.segHover) {
          // Klick auf eine Kante wählt ihre beiden Endknoten
          const sg = segments(shapeSubs(target.shape)[this.segHover.sub])[this.segHover.seg];
          const sel = this.nodeSelection(target);
          if (!add) sel.clear();
          sel.add(`${this.segHover.sub}:${sg.ia}`);
          sel.add(`${this.segHover.sub}:${sg.ib}`);
          this.emit('sel');
          return;
        }
        const hit = this.hitTest(wp);
        if (target && (!hit || hit === target)) {
          // Rahmen zum Auswählen von Knoten
          this.drag = {
            type: 'nodebox', start: wp, end: wp, obj: target, base: new Set(this.nodeSelection(target)),
            mode: e.shiftKey ? 'add' : e.ctrlKey || e.metaKey ? 'toggle' : 'set', onTarget: hit === target,
          };
          return;
        }
        const o = this.hitTest(wp);
        this.setSel(o ? [o] : []);
        if (o && (o.shape.kind === 'text' || o.shape.kind === 'barcode')) this.hint = t('Text und QR-Codes haben keine Knoten. Erst in einen Pfad umwandeln (Ctrl+Shift+C).');
        else if (o && o.shape.kind === 'group') this.hint = t('Gruppen erst auflösen (Ctrl+U), dann Knoten bearbeiten.');
        else this.hint = TOOL_HINTS.node;
        this.emit('tool');
        return;
      }
    }
  }

  private onMove(e: PointerEvent) {
    const { sx, sy } = this.evPt(e);
    const wp = this.toWorld(sx, sy);
    this.cursor = wp;
    const d = this.drag;
    this.emit('view');
    if (!d) {
      const hadSnap = !!this.snapHit || this.alignGuides.length > 0;
      this.clearSnap();
      if ((sy < RULER) !== (sx < RULER)) {
        this.canvas.style.cursor = sy < RULER ? 'row-resize' : 'col-resize';
        return;
      }
      if (this.drawTool) {
        // Fangpunkt schon vor dem Klicken zeigen; die Linie im Entstehen folgt ihm
        this.cursor = this.snapPt(wp, e, { extra: this.draft?.nodes, toggle: this.tool === 'line' || this.tool === 'text' });
        this.canvas.style.cursor = this.space ? 'grab' : this.tool === 'text' ? 'text' : 'crosshair';
        return;
      }
      if (hadSnap) this.redraw();
      if (this.tool === 'select') {
        const h = this.hitHandle(sx, sy);
        this.canvas.style.cursor = this.hitPivot(sx, sy)
          ? 'move'
          : h >= 0
            ? this.rotateMode
              ? ROTATE_CURSOR
              : ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'][h % 4]
            : this.hitRotateZone(sx, sy)
              ? ROTATE_CURSOR
              : this.space
                ? 'grab'
                : 'default';
      } else if (this.tool === 'node') this.updateNodeHover(sx, sy);
      else if (this.tool === 'joint') this.updateJointHover(sx, sy);
      return;
    }
    switch (d.type) {
      case 'pan':
        this.view.ox = d.ox + sx - d.sx;
        this.view.oy = d.oy + sy - d.sy;
        return;
      case 'move': {
        if (!d.moved) {
          if (Math.hypot(sx - d.sx, sy - d.sy) < 3) return;
          d.moved = true;
          this.snapshot();
        }
        let dx = wp.x - d.start.x,
          dy = wp.y - d.start.y;
        const lock = e.shiftKey ? (Math.abs(dx) > Math.abs(dy) ? 'y' : 'x') : null;
        if (lock === 'y') dy = 0;
        if (lock === 'x') dx = 0;
        [dx, dy] = this.snapMove(d, dx, dy, e);
        // Shift hält die Richtung auch beim Fangen
        if (lock === 'y') dy = 0;
        if (lock === 'x') dx = 0;
        const t = translate(dx, dy);
        this.sel.forEach((o, i) => (o.m = mul(t, d.orig[i])));
        this.emit('doc');
        return;
      }
      case 'scale': {
        const b = d.box;
        const hx = [0, 0.5, 1, 1, 1, 0.5, 0, 0][d.handle],
          hy = [0, 0, 0, 0.5, 1, 1, 1, 0.5][d.handle];
        const fromCenter = e.ctrlKey || e.metaKey;
        const ax = fromCenter ? 0.5 : 1 - hx,
          ay = fromCenter ? 0.5 : 1 - hy;
        const A = { x: b.x + ax * b.w, y: b.y + ay * b.h };
        const H = { x: b.x + hx * b.w, y: b.y + hy * b.h };
        let fx = hx === 0.5 || !b.w ? 1 : (wp.x - A.x) / (H.x - A.x);
        let fy = hy === 0.5 || !b.h ? 1 : (wp.y - A.y) / (H.y - A.y);
        const corner = d.handle % 2 === 0;
        if (corner && !e.shiftKey) {
          const s = Math.abs(fx) > Math.abs(fy) ? fx : fy;
          fx = fy = s;
        }
        const clampS = (v: number) => (Math.abs(v) < 1e-3 ? (v < 0 ? -1e-3 : 1e-3) : v);
        const D = about(scale(clampS(fx), clampS(fy)), A.x, A.y);
        this.sel.forEach((o, i) => (o.m = mul(D, d.orig[i])));
        this.emit('doc');
        return;
      }
      case 'rotate': {
        let a = Math.atan2(wp.y - d.center.y, wp.x - d.center.x) - d.a0;
        if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
        else if (e.ctrlKey || e.metaKey) a = Math.round(a / (Math.PI / 36)) * (Math.PI / 36);
        const D = about(rotate(a), d.center.x, d.center.y);
        this.sel.forEach((o, i) => (o.m = mul(D, d.orig[i])));
        d.angle = (-a * 180) / Math.PI;
        this.hint = t('Drehung {angle}° · Shift: 15°-Schritte, Ctrl: 5°-Schritte, Esc: abbrechen', { angle: d.angle.toFixed(1) });
        this.emit('doc');
        return;
      }
      case 'marquee':
      case 'nodebox':
        d.end = wp;
        if (d.type === 'nodebox') this.redraw();
        return;
      case 'pivot':
        this.pivot = this.snapPt(wp, e);
        return;
      case 'guide': {
        const v = this.snapGuide(d, wp, e);
        const onRuler = d.axis === 'y' ? sy < RULER : sx < RULER;
        if (!d.obj) {
          if (onRuler) return;
          this.snapshot();
          d.obj = this.makeGuide(d.axis, v);
          this.doc.objs.push(d.obj);
          this.setSel([d.obj]);
        }
        d.obj.m = d.axis === 'y' ? translate(0, v) : translate(v, 0);
        const mv = this.toMachine({ x: v, y: v });
        this.hint = t('Hilfslinie {axis} = {pos} mm · zurück ins Lineal ziehen verwirft sie', { axis: d.axis === 'y' ? 'y' : 'x', pos: (d.axis === 'y' ? mv.y : mv.x).toFixed(2) });
        this.emit('doc');
        return;
      }
      case 'create': {
        const p = this.snapPt(wp, e, { set: d.snapSet, toggle: false });
        let dx = p.x - d.start.x,
          dy = p.y - d.start.y;
        if (!d.obj) {
          if (Math.hypot(dx, dy) * this.view.zoom < 3) return;
          this.snapshot();
          d.obj = { id: newId(), m: IDENT, layer: this.currentLayer, shape: this.newShape() };
          this.doc.objs.push(d.obj);
          this.setSel([d.obj]);
        }
        const o = d.obj;
        const fromCenter = e.ctrlKey || e.metaKey;
        if (this.tool === 'polygon') {
          const s = o.shape as Extract<Shape, { kind: 'polygon' }>;
          s.r = Math.hypot(dx, dy);
          o.m = mul(translate(d.start.x, d.start.y), e.shiftKey ? IDENT : rotate(Math.atan2(dy, dx) + Math.PI / 2));
        } else {
          if (e.shiftKey) {
            const m = Math.max(Math.abs(dx), Math.abs(dy));
            dx = Math.sign(dx || 1) * m;
            dy = Math.sign(dy || 1) * m;
          }
          const x0 = fromCenter ? d.start.x - Math.abs(dx) : Math.min(d.start.x, d.start.x + dx);
          const y0 = fromCenter ? d.start.y - Math.abs(dy) : Math.min(d.start.y, d.start.y + dy);
          const w = fromCenter ? Math.abs(dx) * 2 : Math.abs(dx);
          const h = fromCenter ? Math.abs(dy) * 2 : Math.abs(dy);
          if (o.shape.kind === 'rect') {
            o.shape.w = w;
            o.shape.h = h;
            o.m = translate(x0, y0);
          } else if (o.shape.kind === 'ellipse') {
            o.shape.rx = w / 2;
            o.shape.ry = h / 2;
            o.m = translate(x0 + w / 2, y0 + h / 2);
          }
        }
        this.touch(o.shape);
        this.hint = this.sizeHint(o);
        this.emit('doc');
        return;
      }
      case 'linenode': {
        const n = d.node;
        const p = this.snapPt(wp, e, { extra: this.draft?.nodes.filter((m) => m !== n) });
        if (Math.hypot(p.x - n.x, p.y - n.y) * this.view.zoom < 3) {
          delete n.cin;
          delete n.cout;
          delete n.smooth;
        } else {
          n.cout = { x: p.x, y: p.y };
          n.cin = { x: 2 * n.x - p.x, y: 2 * n.y - p.y };
          n.smooth = true;
        }
        this.redraw();
        return;
      }
      case 'node': {
        const o = d.obj;
        const im = inv(o.m);
        const tgt = this.snapPt({ x: d.origWorld.x + wp.x - d.start.x, y: d.origWorld.y + wp.y - d.start.y }, e, { set: d.snapSet });
        const a = apply(im, d.origWorld.x, d.origWorld.y),
          b = apply(im, tgt.x, tgt.y);
        const dx = b.x - a.x,
          dy = b.y - a.y;
        d.moved = true;
        const subs = (o.shape as { subs: SubPath[] }).subs;
        const n = subs[d.sub].nodes[d.idx];
        const sh = (p?: Pt) => (p ? { x: p.x + dx, y: p.y + dy } : undefined);
        if (d.which === 'p' && d.group.length) {
          for (const g of d.group) {
            const m = subs[g.sub].nodes[g.idx];
            m.x = g.orig.x + dx;
            m.y = g.orig.y + dy;
            m.cin = sh(g.orig.cin);
            m.cout = sh(g.orig.cout);
            if (!m.cin) delete m.cin;
            if (!m.cout) delete m.cout;
          }
        } else if (d.which === 'p') {
          n.x = d.orig.x + dx;
          n.y = d.orig.y + dy;
          n.cin = sh(d.orig.cin);
          n.cout = sh(d.orig.cout);
          if (!n.cin) delete n.cin;
          if (!n.cout) delete n.cout;
        } else {
          const h = sh(d.orig[d.which])!;
          n[d.which] = h;
          const other = d.which === 'cin' ? 'cout' : 'cin';
          if (n.smooth && !e.altKey && n[other]) {
            const len = Math.hypot(n[other]!.x - n.x, n[other]!.y - n.y);
            const vx = n.x - h.x,
              vy = n.y - h.y,
              vl = Math.hypot(vx, vy) || 1;
            n[other] = { x: n.x + (vx / vl) * len, y: n.y + (vy / vl) * len };
          } else if (e.altKey) n.smooth = false;
        }
        this.touch(o.shape);
        this.emit('doc');
        return;
      }
    }
  }

  private onUp(e: PointerEvent) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (!this.drawTool) this.clearSnap();
    this.alignGuides = [];
    this.redraw();
    switch (d.type) {
      case 'guide': {
        if (!d.obj) return;
        const { sx, sy } = this.evPt(e);
        this.hint = '';
        if (d.axis === 'y' ? sy < RULER : sx < RULER) {
          // zurück ins Lineal gezogen: verwerfen
          this.doc.objs = this.doc.objs.filter((o) => o !== d.obj);
          this.dropSnapshot();
          this.setSel([]);
        }
        this.emit('doc');
        return;
      }
      case 'pan':
        this.canvas.style.cursor = this.tool === 'select' ? 'default' : 'crosshair';
        return;
      case 'move':
        if (!d.moved && d.toggleRotate) {
          this.rotateMode = !this.rotateMode;
          this.emit('sel');
        }
        return;
      case 'scale':
      case 'rotate':
        if (this.sel.every((o, i) => o.m === d.orig[i])) this.dropSnapshot();
        this.hint = '';
        this.emit('sel');
        return;
      case 'marquee': {
        const r = normBox(d.start, d.end);
        if (r.w * this.view.zoom < 3 && r.h * this.view.zoom < 3) {
          this.redraw();
          return;
        }
        const enclose = d.end.x >= d.start.x;
        const hits = this.doc.objs.filter((o) => {
          if (!this.selectable(o)) return false;
          if (enclose) {
            const b = boundsOf([o]);
            return !!b && b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;
          }
          return [...visibleLeaves([o])].some(([l, m]) => leafIntersectsBox(l, m, r));
        });
        let next: Obj[];
        if (d.mode === 'set') next = hits;
        else if (d.mode === 'add') next = [...d.base, ...hits.filter((h) => !d.base.includes(h))];
        else if (d.mode === 'remove') next = d.base.filter((o) => !hits.includes(o));
        else next = [...d.base.filter((o) => !hits.includes(o)), ...hits.filter((h) => !d.base.includes(h))];
        this.rotateMode = false;
        this.setSel(next);
        return;
      }
      case 'create':
        this.hint = '';
        if (d.obj) {
          this.emit('doc');
          this.setTool('select');
          this.setSel([d.obj]);
        }
        return;
      case 'linenode':
      case 'pivot':
        return;
      case 'node':
        if (!d.moved) this.dropSnapshot();
        this.emit('doc');
        return;
      case 'nodebox': {
        const r = normBox(d.start, d.end);
        const sel = this.nodeSelection(d.obj);
        if (r.w * this.view.zoom < 3 && r.h * this.view.zoom < 3) {
          // einfacher Klick: Knotenauswahl aufheben, im Leeren auch das Objekt abwählen
          if (d.mode === 'set') {
            if (!sel.size && !d.onTarget) this.setSel([]);
            sel.clear();
          }
          this.emit('sel');
          return;
        }
        const hits: string[] = [];
        shapeSubs(d.obj.shape).forEach((sp, si) =>
          sp.nodes.forEach((n, ni) => {
            const p = apply(d.obj.m, n.x, n.y);
            if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) hits.push(`${si}:${ni}`);
          }),
        );
        if (d.mode === 'set') sel.clear();
        for (const k of hits) {
          if (d.mode === 'toggle' && d.base.has(k)) sel.delete(k);
          else sel.add(k);
        }
        this.emit('sel');
        return;
      }
    }
    void e;
  }

  private onDouble(e: MouseEvent) {
    const { sx, sy } = this.evPt(e);
    const wp = this.toWorld(sx, sy);
    if (this.tool === 'line' && this.draft) {
      // Doppelklick erzeugt zwei Knoten an derselben Stelle; den zweiten verwerfen
      const ns = this.draft.nodes;
      if (ns.length >= 2) {
        const a = ns[ns.length - 1],
          b = ns[ns.length - 2];
        if (Math.hypot(a.x - b.x, a.y - b.y) * this.view.zoom < 4) ns.pop();
      }
      this.finishLine();
      return;
    }
    if (this.tool === 'select') {
      const o = this.hitTest(wp);
      if (o && o.shape.kind === 'text') {
        this.setSel([o]);
        this.rotateMode = false;
        this.textEditor?.(o, false);
      } else if (o && o.shape.kind === 'barcode') {
        this.setSel([o]);
        this.onBarcodeEdit?.(o);
      } else if (o && o.shape.kind !== 'group') {
        this.setSel([o]);
        this.setTool('node');
      }
    } else if (this.tool === 'node' && this.segHover) this.insertNode();
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const { sx, sy } = this.evPt(e);
    if (e.ctrlKey || Math.abs(e.deltaY) > 0 || e.deltaMode) this.zoomAt(Math.pow(1.0015, -e.deltaY * (e.deltaMode ? 30 : 1)), sx, sy);
  }

  private newShape(): Shape {
    if (this.tool === 'rect') return { kind: 'rect', w: 0, h: 0, r: this.rectRadius };
    if (this.tool === 'ellipse') return { kind: 'ellipse', rx: 0, ry: 0 };
    return { kind: 'polygon', sides: this.polySides, r: 0, star: this.polyStar, inner: 0.5 };
  }

  private sizeHint(o: Obj) {
    const b = boundsOf([o]);
    return b ? `${b.w.toFixed(2)} × ${b.h.toFixed(2)} mm` : '';
  }

  finishLine() {
    const d = this.draft;
    this.draft = null;
    if (!d || d.nodes.length < 2) {
      this.redraw();
      return;
    }
    this.snapshot();
    const o: Obj = { id: newId(), m: IDENT, layer: this.currentLayer, shape: { kind: 'path', subs: [d] } };
    this.doc.objs.push(o);
    this.emit('doc');
    this.setTool('select');
    this.setSel([o]);
  }

  /** Laufendes Ziehen abbrechen und den Ausgangszustand wiederherstellen */
  private cancelDrag() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.type === 'move' || d.type === 'scale' || d.type === 'rotate') {
      this.sel.forEach((o, i) => (o.m = d.orig[i]));
      if (d.type !== 'move' || d.moved) this.dropSnapshot();
    } else if ((d.type === 'create' || d.type === 'guide') && d.obj) {
      this.doc.objs = this.doc.objs.filter((o) => o !== d.obj);
      this.dropSnapshot();
      this.setSel([]);
    } else if (d.type === 'node') {
      const subs = (d.obj.shape as { subs: SubPath[] }).subs;
      const restore = (n: Node, orig: Node) => {
        delete n.cin;
        delete n.cout;
        Object.assign(n, clone(orig));
      };
      restore(subs[d.sub].nodes[d.idx], d.orig);
      for (const g of d.group) restore(subs[g.sub].nodes[g.idx], g.orig);
      this.touch(d.obj.shape);
      this.dropSnapshot();
    }
    this.hint = '';
    this.clearSnap();
    this.emit('doc');
    this.emit('sel');
  }

  // ---------- Knotenbearbeitung ----------

  // ---------- Verbindungen (Fingerzinken, Schlitz und Zapfen) ----------

  /** Gewählte Kanten für eine Verbindung (höchstens zwei) und Kante unter dem Mauszeiger */
  jointPicks: EdgePick[] = [];
  jointHover: EdgePick | null = null;
  /** Öffnet den Verbindungs-Dialog (ui.ts) */
  onJointDialog: (() => void) | null = null;
  /** Vorschau der Verbindung: neue Konturen der betroffenen Objekte (Welt) */
  jointPreview: SubPath[] | null = null;

  /** Nächste gerade Kante eines sichtbaren Objekts unter dem Mauszeiger */
  private updateJointHover(sx: number, sy: number) {
    const prev = this.jointHover;
    let best = 7;
    this.jointHover = null;
    for (const [leaf, m] of visibleLeaves(this.doc.objs)) {
      const k = leaf.shape.kind;
      if (k === 'text' || k === 'image' || k === 'barcode' || !this.layer(leaf.layer).show) continue;
      shapeSubs(leaf.shape).forEach((sp, si) =>
        segments(sp).forEach((sg, gi) => {
          if (sg.curve) return;
          const a = this.toScreen(apply(m, sg.a.x, sg.a.y)),
            b = this.toScreen(apply(m, sg.b.x, sg.b.y));
          const dx = b.x - a.x,
            dy = b.y - a.y;
          const l2 = dx * dx + dy * dy;
          if (l2 < 1) return;
          const t = Math.max(0, Math.min(1, ((sx - a.x) * dx + (sy - a.y) * dy) / l2));
          const d = Math.hypot(a.x + dx * t - sx, a.y + dy * t - sy);
          if (d < best) {
            best = d;
            this.jointHover = { obj: leaf, m, sub: si, seg: gi };
          }
        }),
      );
    }
    // im forEach gesetzt: TypeScript sieht das nicht
    const h = this.jointHover as EdgePick | null;
    this.canvas.style.cursor = h ? 'pointer' : 'crosshair';
    if (!h !== !prev || (h && prev && (h.obj !== prev.obj || h.sub !== prev.sub || h.seg !== prev.seg))) this.redraw();
  }

  /** Gewählte Kanten, die es im Dokument noch gibt */
  validJointPicks(): EdgePick[] {
    const alive = new Set([...leaves(this.doc.objs)].map(([o]) => o));
    return this.jointPicks.filter((p) => alive.has(p.obj) && isStraight(p.obj, p.sub, p.seg));
  }
  clearJointPicks() {
    this.jointPicks = [];
    this.hint = this.tool === 'joint' ? TOOL_HINTS.joint : this.hint;
    this.emit('tool');
    this.redraw();
  }
  setJointPreview(subs: SubPath[] | null) {
    this.jointPreview = subs;
    this.redraw();
  }
  /** Verbindung auf die gewählten Kanten anwenden; die Objekte werden zu Pfaden. */
  applyJoint(opt: JointOptions): boolean {
    const r = computeJoint(this.validJointPicks(), opt);
    if (r.error) {
      this.hint = t('Verbindung: {error}', { error: r.error });
      this.emit('tool');
      return false;
    }
    this.snapshot();
    for (const [obj, { m, subs }] of r.changes) {
      obj.shape = { kind: 'path', subs: transformSubs(subs, inv(m)) };
      invalidate(obj.shape);
    }
    if (r.added.length) {
      // Neue Teile (Keile) auf dem Layer der ersten Kante
      const first = this.jointPicks[0]?.obj;
      this.doc.objs.push({ id: newId(), m: IDENT, layer: first?.layer ?? this.currentLayer, shape: { kind: 'path', subs: r.added } });
    }
    this.jointPicks = [];
    this.hint = t('Verbindung angelegt: {info}.', { info: r.info });
    this.emit('doc');
    this.emit('sel');
    return true;
  }

  // ---------- Biegeschnitte (Living Hinges) ----------

  /** Vorschau der Biegeschnitte (Welt) */
  hingePreview: SubPath[] | null = null;
  /** Gewählte Formen, die ein Biegemuster füllen kann (geschlossene Konturen, keine Bilder und Texte) */
  hingeTargets(): Obj[] {
    return this.sel.filter((o) => [...leaves([o])].some(([l]) => l.shape.kind !== 'image' && l.shape.kind !== 'text' && shapeSubs(l.shape).some((sp) => sp.closed)));
  }
  setHingePreview(subs: SubPath[] | null) {
    this.hingePreview = subs;
    this.redraw();
  }
  /** Biegeschnitte in die gewählten Formen setzen; ohne „Form behalten“ ersetzt das Muster die Formen. */
  applyHinge(opt: HingeOptions): boolean {
    const inputs = this.hingeTargets();
    const r = computeHinge(inputs, opt);
    if (r.error) {
      this.hint = t('Biegeschnitte: {error}', { error: r.error });
      this.emit('tool');
      return false;
    }
    this.snapshot();
    const res: Obj = { id: newId(), m: IDENT, layer: inputs[0].layer, shape: { kind: 'path', subs: r.subs } };
    const z = inputs.map((o) => this.doc.objs.indexOf(o));
    const idx = opt.keepOutline ? Math.max(...z) + 1 : Math.min(...z);
    if (!opt.keepOutline) this.doc.objs = this.doc.objs.filter((o) => !inputs.includes(o));
    this.doc.objs.splice(Math.min(idx, this.doc.objs.length), 0, res);
    this.setSel([res]);
    this.hint = t('Biegeschnitte angelegt: {info}.', { info: r.info });
    this.emit('doc');
    return true;
  }

  private nodeTarget(): Obj | null {
    if (this.sel.length !== 1) return null;
    const o = this.sel[0];
    return o.shape.kind === 'group' || o.shape.kind === 'text' || o.shape.kind === 'image' || o.shape.kind === 'barcode' ? null : o;
  }

  private updateNodeHover(sx: number, sy: number) {
    const o = this.nodeTarget();
    const prevN = JSON.stringify(this.nodeHover),
      prevS = JSON.stringify(this.segHover);
    this.nodeHover = this.segHover = null;
    if (o) {
      const subs = shapeSubs(o.shape);
      const scr = (p: Pt) => this.toScreen(apply(o.m, p.x, p.y));
      let best = 7;
      subs.forEach((sp, si) =>
        sp.nodes.forEach((n, ni) => {
          for (const which of ['p', 'cin', 'cout'] as const) {
            const p = which === 'p' ? n : n[which];
            if (!p) continue;
            const q = scr(p);
            const dd = Math.hypot(q.x - sx, q.y - sy) - (which === 'p' ? 1 : 0);
            if (dd < best) {
              best = dd;
              this.nodeHover = { sub: si, idx: ni, which };
            }
          }
        }),
      );
      if (!this.nodeHover) {
        let bestS = 6;
        subs.forEach((sp, si) =>
          segments(sp).forEach((sg, gi) => {
            for (let i = 0; i <= 32; i++) {
              const t = i / 32;
              const p = sg.curve ? bezierPt(sg.a, sg.c1, sg.c2, sg.b, t) : { x: sg.a.x + (sg.b.x - sg.a.x) * t, y: sg.a.y + (sg.b.y - sg.a.y) * t };
              const q = scr(p);
              const dd = Math.hypot(q.x - sx, q.y - sy);
              if (dd < bestS) {
                bestS = dd;
                this.segHover = { sub: si, seg: gi, t };
              }
            }
          }),
        );
      }
    }
    this.canvas.style.cursor = this.nodeHover ? 'move' : this.segHover ? 'pointer' : 'crosshair';
    if (prevN !== JSON.stringify(this.nodeHover) || prevS !== JSON.stringify(this.segHover)) this.redraw();
  }

  private convertObjToPath(o: Obj) {
    if (o.shape.kind === 'text' || o.shape.kind === 'group' || o.shape.kind === 'path' || o.shape.kind === 'image') return;
    o.shape = { kind: 'path', subs: clone(shapeSubs(o.shape)) };
  }

  /** Formen und Texte der Auswahl in Pfade umwandeln (Texte über die Schriftkonturen). */
  async convertSelToPath() {
    const objs = this.sel.filter((o) => ['rect', 'ellipse', 'polygon', 'text', 'barcode', 'group'].includes(o.shape.kind));
    if (!objs.length) return;
    const fallbacks = new Set<string>();
    const outlines = new Map<Obj, SubPath[]>();
    for (const [leaf] of leaves(objs)) {
      if (leaf.shape.kind !== 'text') continue;
      const t = leaf.shape;
      const f = await loadFont(t.font, t.bold, t.italic);
      if (f.fallback) fallbacks.add(t.font);
      outlines.set(leaf, textToSubs(t, f.font));
    }
    this.snapshot();
    for (const [leaf] of leaves(objs)) {
      const subs = outlines.get(leaf);
      if (subs) {
        leaf.shape = { kind: 'path', subs };
        this.touch(leaf.shape);
      } else this.convertObjToPath(leaf);
    }
    this.hint = fallbacks.size
      ? t('Schrift {fonts} nicht gefunden, Roboto verwendet.', { fonts: [...fallbacks].join(', ') })
      : t('In Pfad umgewandelt.');
    this.emit('doc');
    this.emit('sel');
  }

  /** Kopien der Objekte, in denen Texte schon als Konturen vorliegen (für Boolesche Operationen und Offset). */
  private async withTextOutlines(objs: Obj[]): Promise<Obj[]> {
    const out: Obj[] = [];
    for (const o of objs) {
      const c = clone(o);
      for (const [leaf] of leaves([c])) {
        if (leaf.shape.kind !== 'text') continue;
        const t = leaf.shape;
        const f = await loadFont(t.font, t.bold, t.italic);
        leaf.shape = { kind: 'path', subs: textToSubs(t, f.font) };
      }
      out.push(c);
    }
    return out;
  }

  /** Basis bei Booleschen Operationen: zuerst gewähltes, hinterstes oder vorderstes Objekt */
  boolBase: BoolBase = 'selection';
  /** Originalobjekte nach Booleschen Operationen behalten */
  boolKeep = false;
  setBoolOptions(patch: { base?: BoolBase; keep?: boolean }) {
    if (patch.base) this.boolBase = patch.base;
    if (patch.keep !== undefined) this.boolKeep = patch.keep;
    try {
      localStorage.setItem(BOOL_KEY, JSON.stringify({ base: this.boolBase, keep: this.boolKeep }));
    } catch {
      /* Speicher nicht verfügbar */
    }
    this.emit('tool');
  }
  private loadBoolSettings() {
    try {
      const st = JSON.parse(localStorage.getItem(BOOL_KEY) ?? '{}');
      if (st.base === 'selection' || st.base === 'back' || st.base === 'front') this.boolBase = st.base;
      if (typeof st.keep === 'boolean') this.boolKeep = st.keep;
    } catch {
      /* Standardwerte */
    }
  }

  /**
   * Boolesche Operation auf die Auswahl. Welches Objekt die Basis ist, bestimmt `base`
   * (sonst die Einstellung boolBase): beim Abziehen werden alle anderen von der Basis abgezogen.
   */
  async booleanSel(op: BoolOp, base: BoolBase = this.boolBase) {
    // Bilder nehmen nicht teil (sie haben keine Kontur)
    const inputs = orderForBoolean(this.sel.filter((o) => o.shape.kind !== 'image'), this.doc.objs, base);
    if (inputs.length < 2) {
      this.hint = t('Für Boolesche Operationen mindestens zwei Formen auswählen.');
      this.emit('tool');
      return;
    }
    const subs = booleanOp(op, await this.withTextOutlines(inputs));
    const keep = this.boolKeep;
    if (!subs.length && keep) {
      this.hint = t('Ergebnis ist leer (keine gemeinsame Fläche).');
      this.emit('tool');
      return;
    }
    this.snapshot();
    const z = inputs.map((o) => this.doc.objs.indexOf(o));
    // Ohne Originale nimmt das Ergebnis den Platz des hintersten Objekts ein, sonst liegt es direkt vor dem vordersten
    let idx = keep ? Math.max(...z) + 1 : Math.min(...z);
    if (!keep) this.doc.objs = this.doc.objs.filter((o) => !inputs.includes(o));
    if (!subs.length) {
      this.hint = t('Ergebnis ist leer (keine gemeinsame Fläche).');
      this.setSel([]);
    } else {
      const res: Obj = { id: newId(), m: IDENT, layer: inputs[0].layer, shape: { kind: 'path', subs } };
      idx = Math.min(idx, this.doc.objs.length);
      this.doc.objs.splice(idx, 0, res);
      this.setSel([res]);
      this.hint = keep ? t('Originale behalten, Ergebnis liegt davor.') : '';
    }
    this.emit('doc');
  }

  /** Offset: neue Konturen im Abstand zur Auswahl. */
  async offsetSel(opt: OffsetOptions, keepOriginal: boolean) {
    const inputs = this.sel.filter((o) => o.shape.kind !== 'image');
    if (!inputs.length) return;
    const subs = offsetOp(await this.withTextOutlines(inputs), opt);
    this.snapshot();
    if (!keepOriginal) this.doc.objs = this.doc.objs.filter((o) => !inputs.includes(o));
    if (!subs.length) {
      this.hint = t('Offset ergibt keine Kontur (Abstand zu groß für Innen-Offset?).');
      this.setSel(keepOriginal ? inputs : []);
    } else {
      const res: Obj = { id: newId(), m: IDENT, layer: inputs[0].layer, shape: { kind: 'path', subs } };
      this.doc.objs.push(res);
      this.setSel([res]);
      this.hint = '';
    }
    this.emit('doc');
  }

  /** Vorschau für den Offset-Dialog (ohne das Dokument zu ändern) */
  offsetPreview: SubPath[] | null = null;
  /** Vorschau für die Array-Dialoge: Weltmatrix je Kopie (die erste ist das Original) */
  arrayPreview: Mat[] | null = null;
  /** Mittelpunkt des Kreisarrays (Welt), wird als Kreuz gezeigt */
  arrayCenter: Pt | null = null;
  setArrayPreview(mats: Mat[] | null, center: Pt | null = null) {
    this.arrayPreview = mats;
    this.arrayCenter = mats ? center : null;
    this.redraw();
  }
  /** Array anlegen: Auswahl je Matrix kopieren (erste Matrix = Original), optional alles gruppieren. */
  applyArray(mats: Mat[], asGroup: boolean, what: string) {
    if (!this.sel.length || mats.length < 2) return;
    if (mats.length * this.sel.length > MAX_COPIES) {
      this.hint = t('{what}: zu viele Kopien (höchstens {MAX_COPIES}).', { what, MAX_COPIES });
      this.emit('tool');
      return;
    }
    this.snapshot();
    const originals = this.doc.objs.filter((o) => this.sel.includes(o));
    const copies: Obj[] = [];
    for (const M of mats.slice(1)) {
      cloneObjs(originals).forEach((c, i) => {
        c.m = mul(M, originals[i].m);
        copies.push(c);
      });
    }
    const all = [...originals, ...copies];
    if (asGroup) {
      const idx = this.doc.objs.indexOf(originals[originals.length - 1]);
      const g: Obj = { id: newId(), m: IDENT, layer: originals[0].layer, shape: { kind: 'group', children: all } };
      this.doc.objs.splice(idx + 1, 0, g);
      this.doc.objs = this.doc.objs.filter((o) => !originals.includes(o));
      this.setSel([g]);
    } else {
      this.doc.objs.push(...copies);
      this.setSel(all);
    }
    this.hint = tn('{what}: {n} Kopie angelegt.', '{what}: {n} Kopien angelegt.', mats.length - 1, { what });
    this.emit('doc');
  }
  /** Position des Laserkopfs (Werkstückkoordinaten, y nach oben), solange verbunden */
  laserPos: Pt | null = null;
  async previewOffset(opt: OffsetOptions | null) {
    this.offsetPreview = opt && this.sel.length ? offsetOp(await this.withTextOutlines(this.sel), opt) : null;
    this.redraw();
  }


  private pathTarget(): SubPath[] | null {
    const o = this.nodeTarget();
    if (!o) return null;
    this.convertObjToPath(o);
    return (o.shape as { subs: SubPath[] }).subs;
  }

  /** Knotenauswahl des Ziels; wechselt das Ziel, beginnt sie leer. */
  private nodeSelection(o: Obj | null): Set<string> {
    if (o !== this.nodeSelObj) {
      this.nodeSel = new Set();
      this.nodeSelObj = o;
    }
    return this.nodeSel;
  }

  /** Ausgewählte Knoten (nur gültige Indizes) */
  selectedNodes(o: Obj | null = this.nodeTarget()): { sub: number; idx: number }[] {
    if (!o) return [];
    const subs = shapeSubs(o.shape);
    return [...this.nodeSelection(o)]
      .map((k) => k.split(':').map(Number))
      .filter(([s, i]) => subs[s] && i < subs[s].nodes.length)
      .map(([sub, idx]) => ({ sub, idx }));
  }

  /** Anzahl ausgewählter Knoten für die Oberfläche */
  get nodeSelCount() {
    return this.tool === 'node' ? this.selectedNodes().length : 0;
  }

  selectAllNodes() {
    const o = this.nodeTarget();
    if (!o) return;
    const sel = this.nodeSelection(o);
    shapeSubs(o.shape).forEach((sp, si) => sp.nodes.forEach((_, ni) => sel.add(`${si}:${ni}`)));
    this.emit('sel');
  }

  clearNodeSel() {
    this.nodeSel.clear();
    this.emit('sel');
  }

  /** Knoten, auf die ein Knotenbefehl wirkt: Auswahl, sonst der Knoten unter dem Mauszeiger */
  private nodesToEdit(o: Obj): { sub: number; idx: number }[] {
    const sel = this.selectedNodes(o);
    if (sel.length) return sel;
    return this.nodeHover && this.nodeHover.which === 'p' ? [{ sub: this.nodeHover.sub, idx: this.nodeHover.idx }] : [];
  }

  /** Segmente, auf die ein Segmentbefehl wirkt: zwischen zwei ausgewählten Knoten, sonst die Kante unter dem Mauszeiger */
  private segmentsToEdit(o: Obj) {
    const subs = shapeSubs(o.shape);
    const sel = this.nodeSelection(o);
    const out: { sub: number; seg: number; curve: boolean }[] = [];
    if (sel.size >= 2)
      subs.forEach((sp, si) =>
        segments(sp).forEach((sg, gi) => {
          if (sel.has(`${si}:${sg.ia}`) && sel.has(`${si}:${sg.ib}`)) out.push({ sub: si, seg: gi, curve: sg.curve });
        }),
      );
    if (!out.length && this.segHover) {
      const { sub, seg } = this.segHover;
      out.push({ sub, seg, curve: segments(subs[sub])[seg].curve });
    }
    return out;
  }

  /** Ausgewählte Knoten löschen (oder den Knoten/Anfasser unter dem Mauszeiger) */
  deleteNodes() {
    const o = this.nodeTarget();
    if (!o) return;
    const h = this.nodeHover;
    const handle = !this.selectedNodes(o).length && h && h.which !== 'p' ? h : null;
    const targets = handle ? [] : this.nodesToEdit(o);
    if (!handle && !targets.length) {
      this.hint = t('Erst Knoten auswählen (Klick, Shift+Klick oder Rahmen).');
      this.emit('tool');
      return;
    }
    this.snapshot();
    const subs = this.pathTarget()!;
    if (handle) {
      const n = subs[handle.sub].nodes[handle.idx];
      delete n[handle.which as 'cin' | 'cout'];
      n.smooth = false;
    } else {
      // von hinten nach vorn entfernen, damit die Indizes gültig bleiben
      targets.sort((a, b) => b.sub - a.sub || b.idx - a.idx);
      for (const t of targets) subs[t.sub].nodes.splice(t.idx, 1);
      for (let i = subs.length - 1; i >= 0; i--) {
        const sp = subs[i];
        if (sp.nodes.length < 2) subs.splice(i, 1);
        else if (sp.closed && sp.nodes.length < 3) sp.closed = false;
      }
    }
    this.nodeSel.clear();
    this.nodeHover = this.segHover = null;
    if (!subs.length) {
      this.doc.objs = this.doc.objs.filter((x) => x !== o);
      this.setSel([]);
    }
    this.touch(o.shape);
    this.emit('doc');
    this.emit('sel');
  }

  insertNode() {
    const o = this.nodeTarget();
    const h = this.segHover;
    if (!o || !h) return;
    this.snapshot();
    const sp = this.pathTarget()![h.sub];
    const sg = segments(sp)[h.seg];
    const t = h.t;
    const lerp = (p: Pt, q: Pt) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    let n: Node;
    if (sg.curve) {
      const p01 = lerp(sg.a, sg.c1), p12 = lerp(sg.c1, sg.c2), p23 = lerp(sg.c2, sg.b);
      const p012 = lerp(p01, p12), p123 = lerp(p12, p23), p = lerp(p012, p123);
      sg.a.cout = p01;
      sg.b.cin = p23;
      n = { x: p.x, y: p.y, cin: p012, cout: p123, smooth: true };
    } else n = lerp(sg.a, sg.b);
    sp.nodes.splice(sg.ia + 1, 0, n);
    this.segHover = null;
    // Indizes haben sich verschoben: der neue Knoten ist ausgewählt
    const sel = this.nodeSelection(o);
    sel.clear();
    sel.add(`${h.sub}:${sg.ia + 1}`);
    this.touch(o.shape);
    this.emit('doc');
    this.emit('sel');
  }

  /** Segmente in Geraden (curve = false) oder Kurven umwandeln */
  setSegmentType(curve: boolean) {
    const o = this.nodeTarget();
    if (!o) return;
    const segs = this.segmentsToEdit(o).filter((sg) => sg.curve !== curve);
    if (!segs.length) {
      this.hint = this.segmentsToEdit(o).length
        ? curve ? t('Segment ist schon eine Kurve.') : t('Segment ist schon eine Gerade.')
        : t('Zwei benachbarte Knoten auswählen oder auf eine Kante zeigen.');
      this.emit('tool');
      return;
    }
    this.snapshot();
    // Umwandeln in einen Pfad erhält die Reihenfolge der Knoten, die Indizes bleiben gültig
    const subs = this.pathTarget()!;
    for (const s of segs) {
      const sg = segments(subs[s.sub])[s.seg];
      if (curve) {
        const dx = (sg.b.x - sg.a.x) / 3,
          dy = (sg.b.y - sg.a.y) / 3;
        sg.a.cout = { x: sg.a.x + dx, y: sg.a.y + dy };
        sg.b.cin = { x: sg.b.x - dx, y: sg.b.y - dy };
      } else {
        delete sg.a.cout;
        delete sg.b.cin;
      }
      sg.a.smooth = false;
      sg.b.smooth = false;
    }
    this.hint = curve
      ? tn('{n} Segment in Kurve umgewandelt.', '{n} Segmente in Kurven umgewandelt.', segs.length)
      : tn('{n} Segment in Gerade umgewandelt.', '{n} Segmente in Geraden umgewandelt.', segs.length);
    this.touch(o.shape);
    this.emit('doc');
    this.emit('tool');
  }

  /** Knoten zu Ecke (ohne Anfasser) oder glattem Knoten machen */
  setNodeType(smooth: boolean) {
    const o = this.nodeTarget();
    if (!o) return;
    const targets = this.nodesToEdit(o);
    if (!targets.length) {
      this.hint = t('Erst Knoten auswählen (Klick, Shift+Klick oder Rahmen).');
      this.emit('tool');
      return;
    }
    this.snapshot();
    const subs = this.pathTarget()!;
    for (const h of targets) {
      const sp = subs[h.sub];
      const n = sp.nodes[h.idx];
      if (!smooth) {
        delete n.cin;
        delete n.cout;
        n.smooth = false;
        continue;
      }
      const N = sp.nodes.length;
      const prev = h.idx > 0 ? sp.nodes[h.idx - 1] : sp.closed ? sp.nodes[N - 1] : null;
      const next = h.idx < N - 1 ? sp.nodes[h.idx + 1] : sp.closed ? sp.nodes[0] : null;
      const a = prev ?? n,
        b = next ?? n;
      const dx = b.x - a.x,
        dy = b.y - a.y,
        l = Math.hypot(dx, dy) || 1;
      const ux = dx / l,
        uy = dy / l;
      if (prev) {
        const lp = Math.hypot(n.x - prev.x, n.y - prev.y) / 3;
        n.cin = { x: n.x - ux * lp, y: n.y - uy * lp };
      }
      if (next) {
        const ln = Math.hypot(next.x - n.x, next.y - n.y) / 3;
        n.cout = { x: n.x + ux * ln, y: n.y + uy * ln };
      }
      n.smooth = true;
    }
    this.touch(o.shape);
    this.emit('doc');
  }

  /** Ausgewählte Knoten mit den Pfeiltasten verschieben (Weltabstand in mm) */
  private nudgeNodes(dx: number, dy: number) {
    const o = this.nodeTarget();
    const targets = o ? this.selectedNodes(o) : [];
    if (!o || !targets.length) return false;
    this.snapshot();
    const subs = this.pathTarget()!;
    const im = inv(o.m);
    const p0 = apply(im, 0, 0),
      p1 = apply(im, dx, dy);
    const lx = p1.x - p0.x,
      ly = p1.y - p0.y;
    const sh = (p?: Pt) => p && ((p.x += lx), (p.y += ly));
    for (const t of targets) {
      const n = subs[t.sub].nodes[t.idx];
      n.x += lx;
      n.y += ly;
      sh(n.cin);
      sh(n.cout);
    }
    this.touch(o.shape);
    this.emit('doc');
    return true;
  }

  // ---------- Befehle ----------

  deleteSel() {
    if (!this.sel.length) return;
    this.snapshot();
    this.doc.objs = this.doc.objs.filter((o) => !this.sel.includes(o));
    this.setSel([]);
    this.emit('doc');
  }
  selectAll() {
    this.setSel(this.doc.objs.filter((o) => this.selectable(o)));
  }
  selectLayer(i: number) {
    this.setSel(this.doc.objs.filter((o) => this.selectable(o) && [...visibleLeaves([o])].some(([l]) => l.layer === i)));
  }
  copy() {
    this.clipboard = this.sel.map((o) => clone(o));
    // System-Zwischenablage überschreiben, damit danach nicht ein älteres Bild aus einem anderen Programm eingefügt wird
    navigator.clipboard?.writeText('').catch(() => undefined);
  }
  private async onPaste(e: ClipboardEvent) {
    const el = e.target as HTMLElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    clearTimeout(this.pasteTimer);
    e.preventDefault();
    const data = e.clipboardData;
    if (data && this.externalPaste && (await this.externalPaste(data))) return;
    this.paste();
  }
  /** Rasterarray-Dialog öffnen (Ctrl+Shift+A, von der Oberfläche gesetzt) */
  onGridArray: (() => void) | null = null;
  /** Datei > Importieren (von der Oberfläche gesetzt) */
  onImport: (() => void) | null = null;
  cut() {
    this.copy();
    this.deleteSel();
  }
  paste(offset = 5) {
    if (!this.clipboard.length) return;
    this.snapshot();
    const objs = cloneObjs(this.clipboard).map((c) => {
      c.m = mul(translate(offset, offset), c.m);
      return c;
    });
    this.clipboard = objs.map((o) => clone(o));
    this.doc.objs.push(...objs);
    this.setSel(objs);
    this.emit('doc');
  }
  duplicate() {
    if (!this.sel.length) return;
    this.snapshot();
    const objs = cloneObjs(this.sel);
    this.doc.objs.push(...objs);
    this.setSel(objs);
    this.emit('doc');
  }
  /** Weltmatrix auf alle ausgewählten Objekte anwenden. */
  transformSel(D: Mat, withSnapshot = true) {
    if (!this.sel.length) return;
    if (withSnapshot) this.snapshot();
    this.sel.forEach((o) => (o.m = mul(D, o.m)));
    this.emit('doc');
    this.emit('sel');
  }
  nudge(dx: number, dy: number) {
    this.transformSel(translate(dx, dy));
  }
  mirror(horizontal: boolean) {
    const b = this.selBounds();
    if (!b) return;
    this.transformSel(about(horizontal ? scale(-1, 1) : scale(1, -1), b.x + b.w / 2, b.y + b.h / 2));
  }
  rotateBy(deg: number, anchor?: Pt) {
    const b = this.selBounds();
    if (!b) return;
    const c = anchor ?? { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    // Positive Werte drehen gegen den Uhrzeigersinn (Maschinensicht, y nach oben)
    this.transformSel(about(rotate((-deg * Math.PI) / 180), c.x, c.y));
  }
  // ---------- Objekte-Fenster: Name, Sichtbarkeit, Sperre, Reihenfolge ----------

  /** Gesperrt: selbst oder alle sichtbaren Teile liegen auf gesperrten Layern */
  isLocked(top: Obj): boolean {
    if (top.locked) return true;
    let any = false;
    for (const [l] of visibleLeaves([top])) {
      if (!this.layer(l.layer).locked) return false;
      any = true;
    }
    return any;
  }
  /** Auf der Arbeitsfläche auswählbar: nicht gesperrt und etwas davon ist zu sehen */
  selectable(top: Obj): boolean {
    if (top.hidden || this.isLocked(top)) return false;
    for (const [l] of visibleLeaves([top])) if (this.layer(l.layer).show) return true;
    return false;
  }
  /** Name, Sichtbarkeit oder Sperre eines Objekts (auch in Gruppen) ändern */
  setObjProps(objs: Obj[], patch: { name?: string; hidden?: boolean; locked?: boolean }) {
    if (!objs.length) return;
    this.snapshot();
    for (const o of objs) {
      if (patch.name !== undefined) {
        const n = patch.name.trim();
        if (n) o.name = n;
        else delete o.name;
      }
      if (patch.hidden !== undefined) {
        if (patch.hidden) o.hidden = true;
        else delete o.hidden;
      }
      if (patch.locked !== undefined) {
        if (patch.locked) o.locked = true;
        else delete o.locked;
      }
    }
    this.emit('doc');
    this.dropUnselectable();
  }
  /** Ausgeblendete oder gesperrte Objekte aus der Auswahl nehmen */
  dropUnselectable() {
    const keep = this.sel.filter((o) => this.selectable(o));
    if (keep.length !== this.sel.length) this.setSel(keep);
    else this.emit('sel');
  }
  /**
   * Oberste Objekte in der Stapelreihenfolge verschieben: vor (front) oder hinter ein Bezugsobjekt,
   * ohne Bezug ganz nach vorn. Mit layer wechseln sie dabei auf diesen Layer.
   */
  moveObjects(objs: Obj[], ref: Obj | null, front: boolean, layer?: number) {
    const moving = this.doc.objs.filter((o) => objs.includes(o) && o !== ref);
    if (!moving.length) return;
    this.snapshot();
    const rest = this.doc.objs.filter((o) => !moving.includes(o));
    let at = rest.length;
    if (ref) {
      const k = rest.indexOf(ref);
      if (k >= 0) at = front ? k + 1 : k;
    }
    rest.splice(at, 0, ...moving);
    this.doc.objs = rest;
    if (layer !== undefined) {
      for (const o of moving) if (homeLayer(o) !== layer) setLayerDeep(o, layer);
      this.layer(layer);
    }
    this.emit('doc');
    this.emit('sel');
  }
  /** Layer i in der Ausgabereihenfolge vor (before) oder hinter ref setzen */
  placeLayer(i: number, ref: number, before: boolean) {
    if (i === ref) return;
    const order = this.layerOrder().filter((l) => l !== i);
    const k = order.indexOf(ref);
    if (k < 0) return;
    order.splice(before ? k : k + 1, 0, i);
    this.snapshot();
    order.forEach((l, n) => (this.layer(l).priority = n));
    this.emit('doc');
  }

  group() {
    if (this.sel.length < 2) return;
    this.snapshot();
    const members = this.doc.objs.filter((o) => this.sel.includes(o));
    const idx = this.doc.objs.indexOf(members[members.length - 1]);
    const g: Obj = { id: newId(), m: IDENT, layer: members[0].layer, shape: { kind: 'group', children: members } };
    this.doc.objs.splice(idx + 1, 0, g);
    this.doc.objs = this.doc.objs.filter((o) => !members.includes(o));
    this.setSel([g]);
    this.emit('doc');
  }
  ungroup() {
    const groups = this.sel.filter((o) => o.shape.kind === 'group');
    if (!groups.length) return;
    this.snapshot();
    const out: Obj[] = [];
    for (const g of groups) {
      const kids = (g.shape as { children: Obj[] }).children;
      kids.forEach((k) => (k.m = mul(g.m, k.m)));
      const i = this.doc.objs.indexOf(g);
      this.doc.objs.splice(i, 1, ...kids);
      out.push(...kids);
    }
    this.setSel([...this.sel.filter((o) => !groups.includes(o)), ...out]);
    this.emit('doc');
  }
  align(how: 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter') {
    if (this.sel.length < 2) return;
    const B = this.selBounds()!;
    this.snapshot();
    for (const o of this.sel) {
      const b = boundsOf([o])!;
      let dx = 0,
        dy = 0;
      if (how === 'left') dx = B.x - b.x;
      if (how === 'right') dx = B.x + B.w - (b.x + b.w);
      if (how === 'top') dy = B.y - b.y;
      if (how === 'bottom') dy = B.y + B.h - (b.y + b.h);
      if (how === 'hcenter') dx = B.x + B.w / 2 - (b.x + b.w / 2);
      if (how === 'vcenter') dy = B.y + B.h / 2 - (b.y + b.h / 2);
      o.m = mul(translate(dx, dy), o.m);
    }
    this.emit('doc');
    this.emit('sel');
  }
  distribute(horizontal: boolean) {
    if (this.sel.length < 3) return;
    this.snapshot();
    const items = this.sel.map((o) => ({ o, b: boundsOf([o])! }));
    const key = (b: Box) => (horizontal ? b.x + b.w / 2 : b.y + b.h / 2);
    items.sort((p, q) => key(p.b) - key(q.b));
    const first = key(items[0].b),
      last = key(items[items.length - 1].b);
    items.forEach(({ o, b }, i) => {
      const target = first + ((last - first) * i) / (items.length - 1);
      const d = target - key(b);
      o.m = mul(horizontal ? translate(d, 0) : translate(0, d), o.m);
    });
    this.emit('doc');
    this.emit('sel');
  }
  /** Klick auf eine Palettenfarbe */
  assignLayer(i: number) {
    this.currentLayer = i;
    this.activeLayer = i;
    if (this.sel.length) {
      this.snapshot();
      this.sel.forEach((o) => setLayerDeep(o, i));
      this.emit('doc');
    }
    this.layer(i);
    this.emit('sel');
  }
  updateLayer(i: number, patch: Partial<Layer>) {
    this.snapshot();
    Object.assign(this.layer(i), patch);
    this.emit('doc');
  }
  moveLayer(i: number, dir: -1 | 1) {
    // Reihenfolge der Layer = Reihenfolge der Ausgabe; im Prototyp über ein Prioritätsfeld
    const used = this.usedLayers();
    const order = used.sort((a, b) => (this.layer(a).priority ?? a) - (this.layer(b).priority ?? b));
    const k = order.indexOf(i);
    const j = k + dir;
    if (k < 0 || j < 0 || j >= order.length) return;
    this.snapshot();
    [order[k], order[j]] = [order[j], order[k]];
    order.forEach((l, n) => (this.layer(l).priority = n));
    this.emit('doc');
  }
  layerOrder(): number[] {
    return this.usedLayers().sort((a, b) => (this.layer(a).priority ?? a + 100) - (this.layer(b).priority ?? b + 100));
  }

  // ---------- QR-Codes ----------

  /** Doppelklick auf einen QR-Code: Dialog zum Bearbeiten öffnen */
  onBarcodeEdit: ((o: Obj) => void) | null = null;
  selBarcodes(): Obj[] {
    return this.sel.filter((o) => o.shape.kind === 'barcode');
  }
  /** Neuen QR-Code mittig in der sichtbaren Fläche auf dem aktuellen Layer einfügen */
  addBarcode(shape: BarcodeShape) {
    let c = this.toWorld(RULER + (this.w - RULER) / 2, RULER + (this.h - RULER) / 2);
    const bed = this.doc.bed;
    if (c.x < 0 || c.y < 0 || c.x > bed.w || c.y > bed.h) c = { x: bed.w / 2, y: bed.h / 2 };
    const o: Obj = { id: newId(), m: translate(c.x - shape.size / 2, c.y - shape.size / 2), layer: this.currentLayer, shape };
    this.placeNew([o], t('QR-Code eingefügt. Doppelklick öffnet ihn zum Bearbeiten.'));
  }
  /** Inhalt oder Einstellungen eines QR-Codes ändern; die Größe bleibt um die Mitte erhalten */
  updateBarcode(o: Obj, patch: Partial<BarcodeShape>) {
    if (o.shape.kind !== 'barcode') return;
    this.snapshot();
    const old = o.shape.size;
    Object.assign(o.shape, patch);
    if (patch.vt === undefined && 'vt' in patch) delete o.shape.vt;
    if (o.shape.size !== old) {
      const d = (old - o.shape.size) / 2;
      o.m = mul(o.m, translate(d, d));
    }
    this.touch(o.shape);
    this.emit('doc');
    this.emit('sel');
  }

  // ---------- Variabler Text ----------

  /** Projektweite Einstellungen (werden beim ersten Zugriff angelegt) */
  get varText(): VarText {
    return (this.doc.vt ??= defaultVarText());
  }
  /** Zähler, Schrittweite usw. ändern (nicht rückgängig zu machen, wie in LightBurn) */
  setVarText(patch: Partial<VarText>) {
    Object.assign(this.varText, patch);
    this.touchVarText();
    this.emit('doc');
  }
  /** Nummer um steps Schritte weiter- (oder zurück-)zählen */
  stepVarText(steps: number) {
    advanceVarText(this.varText, steps);
    this.touchVarText();
    this.emit('doc');
  }
  /** CSV-Datei laden: Zähler läuft danach über alle Datenzeilen */
  loadCsv(name: string, text: string, header: boolean): number {
    const rows = parseCsv(text);
    const head = header && rows.length ? rows.shift()! : null;
    Object.assign(this.varText, { csv: { name, header: head, rows }, start: 1, end: Math.max(1, rows.length), current: 1 });
    this.touchVarText();
    this.emit('doc');
    return rows.length;
  }
  clearCsv() {
    delete this.varText.csv;
    this.touchVarText();
    this.emit('doc');
  }
  /** Objekte mit variablem Text (alle Seiten oder nur die aktuelle) */
  varTextObjs(allPages = true): Obj[] {
    const out: Obj[] = [];
    for (const [o] of leaves(allPages ? allObjs(this.doc) : this.doc.objs))
      if ((o.shape.kind === 'text' || o.shape.kind === 'barcode') && o.shape.vt) out.push(o);
    return out;
  }
  /** Zähler oder CSV haben sich geändert: Zwischenspeicher der betroffenen Objekte leeren */
  touchVarText() {
    for (const o of this.varTextObjs()) this.touch(o.shape);
    this.redraw();
  }
  private shownVt = new WeakMap<Shape, string>();
  /** Regelmäßig: Hat sich durch Datum/Uhrzeit ein angezeigter Inhalt geändert? */
  private refreshVarText() {
    let changed = false;
    for (const o of this.varTextObjs(false)) {
      const s = o.shape;
      const v = s.kind === 'text' ? shownText(s) : s.kind === 'barcode' ? barcodeData(s) : '';
      if (this.shownVt.get(s) === v) continue;
      if (this.shownVt.has(s)) {
        this.touch(s);
        changed = true;
      }
      this.shownVt.set(s, v);
    }
    if (changed) this.emit('sel');
  }
  /** Nach einem gestarteten Job oder gespeicherten G-Code: bei „Automatisch weiterzählen“ die Nummer erhöhen */
  afterJob() {
    const vt = this.doc.vt;
    if (!vt?.autoAdvance || !this.varTextObjs(false).length) return;
    this.stepVarText(1);
    this.hint = t('Variabler Text: weiter mit Nummer {n}.', { n: vt.current });
    this.emit('tool');
  }
  /** Variablen Text der Auswahl festschreiben („Bake“): der aktuelle Inhalt wird zu festem Text */
  bakeVarText(): number {
    const objs = this.varTextObjs(false).filter((o) => [...leaves(this.sel)].some(([l]) => l === o));
    if (!objs.length) return 0;
    this.snapshot();
    for (const o of objs) {
      const s = o.shape;
      if (s.kind === 'text') s.text = shownText(s);
      else if (s.kind === 'barcode') s.data = barcodeData(s);
      if (s.kind === 'text' || s.kind === 'barcode') delete s.vt;
      this.touch(s);
    }
    this.emit('doc');
    this.emit('sel');
    return objs.length;
  }
  /** Vorschau eines Platzhaltertexts mit der aktuellen Nummer */
  previewVarText(template: string, offset = 0): string {
    return expand(template, this.varText.current + offset, this.varText);
  }

  selTexts(): Obj[] {
    return this.sel.filter((o) => o.shape.kind === 'text');
  }
  updateTexts(patch: Partial<TextShape>) {
    Object.assign(this.textDefaults, Object.fromEntries(Object.entries(patch).filter(([k]) => k !== 'text' && k !== 'path' && k !== 'vt' && k !== 'maxW')));
    const ts = this.selTexts();
    if (!ts.length) return;
    this.snapshot();
    ts.forEach((o) => {
      Object.assign(o.shape, patch);
      this.touch(o.shape);
    });
    this.emit('doc');
    this.emit('sel');
  }
  /** Formen, die als Kurve für Text auf Pfad taugen */
  private pathCandidates(): Obj[] {
    return this.sel.filter((o) => ['path', 'rect', 'ellipse', 'polygon'].includes(o.shape.kind));
  }
  /** Ist „Text auf Pfad“ möglich? Genau ein Text und eine Form ausgewählt. */
  canApplyPathToText() {
    return this.selTexts().length === 1 && this.pathCandidates().length === 1;
  }
  /**
   * Text auf Pfad (wie „Apply Path to Text“ in LightBurn): Der gewählte Text folgt der gewählten Form.
   * Der Text übernimmt eine Kopie der Kurve; die Form bleibt als eigenes Objekt erhalten.
   * Erneut anwenden ersetzt die Kurve und behält Verschiebung, Abstand und Seite.
   */
  applyPathToText(): boolean {
    const texts = this.selTexts(),
      shapes = this.pathCandidates();
    if (texts.length !== 1 || shapes.length !== 1) {
      this.hint = t('Für Text auf Pfad genau einen Text und eine Form (Linie, Rechteck, Ellipse, Polygon) auswählen.');
      this.emit('tool');
      return false;
    }
    const to = texts[0],
      po = shapes[0];
    const ts = to.shape as TextShape;
    const det = to.m[0] * to.m[3] - to.m[1] * to.m[2];
    const sub = linkCurve(po.shape);
    if (!sub || Math.abs(det) < 1e-12) return false;
    this.snapshot();
    // Drehung des Texts verwerfen (die Glyphen folgen ohnehin der Kurve), Größe und Spiegelung bleiben.
    // So liegt „oben“ bei geschlossenen Formen auch oben auf der Arbeitsfläche.
    const sx = Math.hypot(to.m[0], to.m[1]),
      sy = Math.sign(det) * Math.hypot(to.m[2], to.m[3]);
    to.m = [sx, 0, 0, sy, to.m[4], to.m[5]];
    const local = transformSubs([sub], mul(inv(to.m), po.m))[0];
    ts.path = {
      sub: local, offset: ts.path?.offset ?? 0, dist: ts.path?.dist ?? 0, flip: ts.path?.flip ?? false,
      link: po.id, textM: [...to.m] as Mat, linkM: [...po.m] as Mat,
    };
    this.touch(ts);
    this.setSel([to]);
    this.hint = t('Text folgt jetzt der Form, auch wenn sie später verschoben oder bearbeitet wird. Die Form wird mitgelasert, außer auf einem Werkzeuglayer (T1/T2) oder ausgeblendet.');
    this.emit('doc');
    return true;
  }
  /**
   * Verknüpfte Texte auf Pfad mit ihrer Form abgleichen (läuft vor jedem Zeichnen und nach Änderungen):
   * Wurde die Form verschoben oder bearbeitet, folgt der Text. Wurde nur der Text verschoben, wandert die Form mit.
   * Ist die Form gelöscht, behält der Text die letzte Kurve.
   */
  private syncTextLinks() {
    let texts: [TextShape, Mat][] | null = null;
    const byId = new Map<number, [Obj, Mat]>();
    for (const [leaf, m] of leaves(this.doc.objs)) {
      byId.set(leaf.id, [leaf, m]);
      if (leaf.shape.kind === 'text' && leaf.shape.path?.link !== undefined) (texts ??= []).push([leaf.shape, m]);
    }
    if (!texts) return;
    const same = (a: Mat | undefined, b: Mat) => !!a && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
    for (const [ts, tm] of texts) {
      const tp = ts.path!;
      const hit = byId.get(tp.link!);
      if (!hit || !['path', 'rect', 'ellipse', 'polygon'].includes(hit[0].shape.kind)) {
        delete tp.link;
        delete tp.textM;
        delete tp.linkM;
        continue;
      }
      const [lo] = hit;
      let lm = hit[1];
      // Nur der Text wurde bewegt: Form mitnehmen (nur bei Objekten der obersten Ebene)
      if (tp.textM && !same(tp.textM, tm) && same(tp.linkM, lm) && this.doc.objs.includes(lo)) {
        const d = mul(tm, inv(tp.textM));
        lo.m = mul(d, lo.m);
        lm = lo.m;
        this.touch(lo.shape);
      }
      tp.textM = [...tm] as Mat;
      tp.linkM = [...lm] as Mat;
      const sub = linkCurve(lo.shape);
      if (!sub || Math.abs(tm[0] * tm[3] - tm[1] * tm[2]) < 1e-12) continue;
      const local = transformSubs([sub], mul(inv(tm), lm))[0];
      if (JSON.stringify(local) !== JSON.stringify(tp.sub)) {
        tp.sub = local;
        this.touch(ts);
      }
    }
  }
  /** Text wieder gerade setzen */
  removePathFromText() {
    const ts = this.selTexts().filter((o) => (o.shape as TextShape).path);
    if (!ts.length) return;
    this.snapshot();
    for (const o of ts) {
      delete (o.shape as TextShape).path;
      this.touch(o.shape);
    }
    this.emit('doc');
    this.emit('sel');
  }
  /** Verschiebung, Abstand oder Seite bei Text auf Pfad ändern */
  updateTextPath(patch: Partial<Omit<TextPath, 'sub'>>) {
    const ts = this.selTexts().filter((o) => (o.shape as TextShape).path);
    if (!ts.length) return;
    this.snapshot();
    for (const o of ts) {
      Object.assign((o.shape as TextShape).path!, patch);
      this.touch(o.shape);
    }
    this.emit('doc');
    this.emit('sel');
  }
  setText(o: Obj, text: string) {
    if (o.shape.kind !== 'text') return;
    o.shape.text = text;
    this.touch(o.shape);
    this.emit('doc');
  }
  removeIfEmptyText(o: Obj) {
    if (o.shape.kind === 'text' && !o.shape.text.trim()) {
      this.doc.objs = this.doc.objs.filter((x) => x !== o);
      this.setSel(this.sel.filter((x) => x !== o));
      this.emit('doc');
    }
  }
  /** Formparameter (Eckenradius, Seiten …) der Auswahl ändern */
  updateShapes(kind: 'rect' | 'polygon', patch: Record<string, number | boolean>) {
    if (kind === 'rect' && typeof patch.r === 'number') this.rectRadius = patch.r;
    if (kind === 'polygon') {
      if (typeof patch.sides === 'number') this.polySides = patch.sides;
      if (typeof patch.star === 'boolean') this.polyStar = patch.star;
    }
    const objs = this.sel.filter((o) => o.shape.kind === kind);
    if (!objs.length) return;
    this.snapshot();
    objs.forEach((o) => {
      Object.assign(o.shape, patch);
      this.touch(o.shape);
    });
    this.emit('doc');
    this.emit('sel');
  }
  /** Numerische Felder: Auswahl auf neue Position/Größe bringen (Weltkoordinaten, Anker 0..1). */
  setSelBox(next: { x?: number; y?: number; w?: number; h?: number }, ax: number, ay: number, lock: boolean) {
    const b = this.selBounds();
    if (!b) return;
    let sx = 1,
      sy = 1;
    if (next.w !== undefined && b.w > 1e-9) sx = next.w / b.w;
    if (next.h !== undefined && b.h > 1e-9) sy = next.h / b.h;
    if (lock) {
      if (next.w !== undefined) sy = sx;
      else if (next.h !== undefined) sx = sy;
    }
    if (!isFinite(sx) || !isFinite(sy) || sx <= 0 || sy <= 0) return;
    const A = { x: b.x + ax * b.w, y: b.y + ay * b.h };
    let D = about(scale(sx, sy), A.x, A.y);
    const tx = next.x !== undefined ? next.x - A.x : 0;
    const ty = next.y !== undefined ? next.y - A.y : 0;
    D = mul(translate(tx, ty), D);
    this.transformSel(D);
  }

  // ---------- Bilder und Import ----------

  selImages(): Obj[] {
    return this.sel.filter((o) => o.shape.kind === 'image');
  }
  /** Bild-Einstellungen eines Layers ändern (live ohne Undo-Schritt, wenn snapshot = false) */
  updateImgLayer(i: number, patch: Partial<ImageLayer>, snapshot = true) {
    if (snapshot) this.snapshot();
    Object.assign(this.imgLayer(i), patch);
    this.emit('doc');
  }
  /** Bildanpassungen setzen (live ohne Undo-Schritt, wenn snapshot = false) */
  setImageAdjust(objs: Obj[], patch: Partial<ImageAdjust>, snapshot = true) {
    if (!objs.length) return;
    if (snapshot) this.snapshot();
    for (const o of objs) if (o.shape.kind === 'image') o.shape.adjust = { ...o.shape.adjust, ...patch };
    this.emit('doc');
  }

  /**
   * Bild mit den übrigen gewählten Formen zuschneiden (auf deren Rahmen) oder maskieren (nur das Innere der
   * geschlossenen Formen bleibt, der Rest wird transparent und damit nicht gelasert), wie in LightBurn.
   * Das Bild bekommt neue Bilddaten in Originalauflösung und bleibt an seiner Stelle; die Formen werden entfernt,
   * damit sie nicht versehentlich mitgeschnitten werden. Ein Undo-Schritt.
   */
  async cropImageSel(mask: boolean) {
    const imgs = this.selImages();
    const shapes = this.sel.filter((o) => o.shape.kind !== 'image');
    const say = (msg: string) => {
      this.hint = msg;
      this.emit('tool');
    };
    if (imgs.length !== 1 || !shapes.length)
      return say(mask ? t('Für die Maske ein Bild und eine oder mehrere geschlossene Formen auswählen.') : t('Zum Zuschneiden ein Bild und eine Form darüber auswählen.'));
    const o = imgs[0],
      s = o.shape as ImageShape;
    const img = assetImage(s.asset),
      src = sourceSize(s.asset);
    if (!img || !src) return say(t('Das Bild ist noch nicht geladen.'));
    // Welt → Bildpunkte des Originals
    const toPx = mul([src.w / s.w, 0, 0, src.h / s.h, 0, 0], inv(o.m));
    const subs: SubPath[] = [];
    for (const sh of shapes)
      for (const [leaf, m] of leaves([sh])) {
        const local = leaf.shape.kind === 'text' ? textOutline(leaf.shape)?.subs ?? [] : leaf.shape.kind === 'image' ? [] : shapeSubs(leaf.shape);
        subs.push(...transformSubs(local.filter((sp) => sp.nodes.length > 1 && (sp.closed || !mask)), mul(toPx, m)));
      }
    if (!subs.length) return say(mask ? t('Die gewählten Formen sind nicht geschlossen.') : t('Die gewählten Formen haben keine Kontur.'));
    // Rahmen der Formen (Kurven abgetastet), begrenzt auf das Bild
    let bx0 = Infinity,
      by0 = Infinity,
      bx1 = -Infinity,
      by1 = -Infinity;
    const add = (p: Pt) => {
      bx0 = Math.min(bx0, p.x);
      by0 = Math.min(by0, p.y);
      bx1 = Math.max(bx1, p.x);
      by1 = Math.max(by1, p.y);
    };
    for (const sp of subs) {
      add(sp.nodes[0]);
      for (const g of segments(sp)) {
        if (!g.curve) add(g.b);
        else for (let i = 1; i <= 32; i++) add(bezierPt(g.a, g.c1, g.c2, g.b, i / 32));
      }
    }
    const x0 = Math.max(0, Math.floor(bx0 + 1e-6)),
      y0 = Math.max(0, Math.floor(by0 + 1e-6)),
      x1 = Math.min(src.w, Math.ceil(bx1 - 1e-6)),
      y1 = Math.min(src.h, Math.ceil(by1 - 1e-6));
    if (x1 - x0 < 1 || y1 - y0 < 1) return say(t('Die Formen liegen nicht über dem Bild.'));
    const c = document.createElement('canvas');
    c.width = x1 - x0;
    c.height = y1 - y0;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, -x0, -y0);
    if (mask) {
      ctx.globalCompositeOperation = 'destination-in';
      ctx.translate(-x0, -y0);
      ctx.fill(subsToPath2D(subs), 'evenodd');
    }
    const a = await addAsset(c.toDataURL('image/png'));
    this.snapshot();
    const kx = s.w / src.w,
      ky = s.h / src.h;
    o.m = mul(o.m, translate(x0 * kx, y0 * ky));
    o.shape = { ...s, asset: a.id, w: c.width * kx, h: c.height * ky, pxW: a.w, pxH: a.h };
    this.doc.objs = this.doc.objs.filter((x) => !shapes.includes(x));
    this.setSel([o]);
    this.hint = mask
      ? t('Maske angewendet: {w} × {h} Pixel bleiben, die Masken-Formen wurden entfernt (Ctrl+Z macht es rückgängig).', { w: c.width, h: c.height })
      : t('Bild zugeschnitten auf {w} × {h} Pixel, die Form wurde entfernt (Ctrl+Z macht es rückgängig).', { w: c.width, h: c.height });
    this.emit('doc');
  }

  /** Objekte einfügen: liegen sie außerhalb des Betts, werden sie mittig platziert. Mehrere werden gruppiert. */
  private placeNew(objs: Obj[], label: string) {
    if (!objs.length) return;
    let o: Obj = objs[0];
    if (objs.length > 1) o = { id: newId(), m: IDENT, layer: objs[0].layer, shape: { kind: 'group', children: objs } };
    const b = boundsOf([o]);
    const bed = this.doc.bed;
    if (b && (b.x < -1e-6 || b.y < -1e-6 || b.x + b.w > bed.w + 1e-6 || b.y + b.h > bed.h + 1e-6))
      o.m = mul(translate(bed.w / 2 - (b.x + b.w / 2), bed.h / 2 - (b.y + b.h / 2)), o.m);
    this.snapshot();
    this.doc.objs.push(o);
    this.setTool('select');
    this.setSel([o]);
    this.hint = label;
    this.emit('doc');
  }

  /**
   * Rasterbild einfügen. Größe aus der Auflösung der Datei (sonst 254 DPI = ein Bildpunkt je 0,1-mm-Zeile);
   * zu große Bilder werden auf das Bett verkleinert. Das Bild kommt auf den aktuellen Layer.
   */
  async importImage(dataUrl: string, dpi: number | null, name?: string) {
    const a = await addAsset(dataUrl);
    const res = dpi && dpi > 10 && dpi < 5000 ? dpi : 254;
    let w = (a.w / res) * 25.4,
      h = (a.h / res) * 25.4;
    const bed = this.doc.bed;
    const f = Math.min(1, (bed.w * 0.9) / w, (bed.h * 0.9) / h);
    w *= f;
    h *= f;
    const shape: ImageShape = { kind: 'image', asset: a.id, w, h, pxW: a.w, pxH: a.h, name, adjust: { ...DEFAULT_ADJUST } };
    const o: Obj = { id: newId(), m: translate((bed.w - w) / 2, (bed.h - h) / 2), layer: this.currentLayer, shape };
    this.imgLayer(this.currentLayer);
    this.placeNew([o], t(f < 1 ? 'Bild importiert: {pxW} × {pxH} Pixel, {w} × {h} mm (auf das Bett verkleinert).' : 'Bild importiert: {pxW} × {pxH} Pixel, {w} × {h} mm.', { pxW: a.w, pxH: a.h, w: dec(w.toFixed(1)), h: dec(h.toFixed(1)) }));
  }

  /** Rasterbild an fester Stelle einfügen (Weltkoordinaten), z. B. das entzerrte Kamerabild */
  async importImageAt(dataUrl: string, x: number, y: number, w: number, h: number, name: string, hint: string, layer = this.currentLayer) {
    const a = await addAsset(dataUrl);
    const shape: ImageShape = { kind: 'image', asset: a.id, w, h, pxW: a.w, pxH: a.h, name, adjust: { ...DEFAULT_ADJUST } };
    const o: Obj = { id: newId(), m: translate(x, y), layer, shape };
    this.imgLayer(layer);
    this.placeNew([o], hint);
  }

  /** Ergebnis eines Vektor-Imports (SVG/DXF) einfügen */
  async importVectors(res: ImportResult, name: string) {
    const objs: Obj[] = [];
    const flip: Mat = res.yUp ? [1, 0, 0, -1, 0, this.doc.bed.h] : IDENT;
    for (const it of res.items) {
      if (it.kind === 'path') {
        objs.push({ id: newId(), m: IDENT, layer: it.layer, shape: { kind: 'path', subs: transformSubs(it.subs, flip) } });
        continue;
      }
      try {
        const a = await addAsset(it.href);
        const shape: ImageShape = { kind: 'image', asset: a.id, w: 1, h: 1, pxW: a.w, pxH: a.h, adjust: { ...DEFAULT_ADJUST } };
        objs.push({ id: newId(), m: mul(flip, it.m), layer: it.layer, shape });
      } catch {
        res.notes.push(t('Ein eingebettetes Bild ließ sich nicht lesen.'));
      }
    }
    if (!objs.length) {
      this.hint = t('{name}: keine verwertbaren Formen gefunden. {notes}', { name, notes: res.notes.join(' ') });
      this.emit('tool');
      return;
    }
    const layers = new Set(objs.map((o) => o.layer));
    this.placeNew(objs, `${tn('{name}: {n} Objekt', '{name}: {n} Objekte', objs.length, { name })} ${tn('auf {n} Layer.', 'auf {n} Layern.', layers.size)} ${res.notes.join(' ')}`.trim());
  }

  /** Konturen eines Bildes in Weltkoordinaten (für Vorschau und Übernahme) */
  traceImage(o: Obj, opt: TraceOptions): SubPath[] {
    if (o.shape.kind !== 'image') return [];
    const s = o.shape;
    const src = sourceSize(s.asset);
    if (!src) return [];
    // Auflösung des Originals, höchstens etwa 4 Megapixel
    const f = Math.min(1, Math.sqrt(4e6 / (src.w * src.h)));
    const cols = Math.max(2, Math.round(src.w * f)),
      rows = Math.max(2, Math.round(src.h * f));
    const g = adjustedGray(s, cols, rows);
    if (!g) return [];
    // Bildpunkte → lokale mm → Welt
    const subs = traceGray(g, cols, rows, opt);
    return transformSubs(subs, mul(o.m, [s.w / cols, 0, 0, s.h / rows, 0, 0]));
  }
  /** Vorschau-Konturen (orange gestrichelt) setzen oder entfernen */
  setPreview(subs: SubPath[] | null) {
    this.offsetPreview = subs;
    this.redraw();
  }
  /** Nachgezeichnete Konturen als neues Objekt über dem Bild einfügen */
  commitTrace(o: Obj, subs: SubPath[], deleteImage: boolean) {
    if (!subs.length) return;
    this.snapshot();
    const res: Obj = { id: newId(), m: IDENT, layer: o.layer, shape: { kind: 'path', subs } };
    if (deleteImage) this.doc.objs = this.doc.objs.filter((x) => x !== o);
    this.doc.objs.push(res);
    this.setSel([res]);
    this.hint = tn('{n} Kontur nachgezeichnet.', '{n} Konturen nachgezeichnet.', subs.length);
    this.emit('doc');
  }

  // ---------- Tastatur ----------

  private onKey(e: KeyboardEvent) {
    const el = e.target as HTMLElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const run = (f: () => void) => {
      e.preventDefault();
      f();
    };
    if (e.code === 'Space') {
      this.space = true;
      e.preventDefault();
      return;
    }
    if (ctrl && e.shiftKey) {
      if (k === 'h') return run(() => this.mirror(true));
      if (k === 'v') return run(() => this.mirror(false));
      if (k === 'z') return run(() => this.doRedo());
      if (k === 'c') return run(() => this.convertSelToPath());
      if (k === 'a') return run(() => this.onGridArray?.());
    }
    const nodeMode = this.tool === 'node' && !!this.nodeTarget();
    if (ctrl && !e.shiftKey && k === 'a' && nodeMode) return run(() => this.selectAllNodes());
    if (ctrl) {
      if (k === 'z') return run(() => this.doUndo());
      if (k === 'y') return run(() => this.doRedo());
      if (k === 'c') return run(() => this.copy());
      if (k === 'x') return run(() => this.cut());
      if (k === 'v') {
        // Kein preventDefault: das paste-Ereignis bringt Bilder und SVG aus anderen Programmen.
        // Kommt es nicht (manche Webviews), wird die interne Zwischenablage eingefügt.
        clearTimeout(this.pasteTimer);
        this.pasteTimer = window.setTimeout(() => this.paste(), 80);
        return;
      }
      if (k === 'i') return run(() => this.onImport?.());
      if (k === 'd') return run(() => this.duplicate());
      if (k === 'a') return run(() => this.selectAll());
      if (k === 'g') return run(() => this.group());
      if (k === 'u') return run(() => this.ungroup());
      if (k === 'r') return run(() => this.setTool('rect'));
      if (k === 'e') return run(() => this.setTool('ellipse'));
      if (k === 'l') return run(() => this.setTool('line'));
      if (k === 't') return run(() => this.setTool('text'));
      if (k === '`' || e.code === 'Backquote') return run(() => this.setTool('node'));
      if (k === '0') return run(() => this.zoomPage());
      return;
    }
    if (k === 'pageup' && !e.altKey) return run(() => this.setPage(this.doc.page - 1));
    if (k === 'pagedown' && !e.altKey) return run(() => this.setPage(this.doc.page + 1));
    if (e.altKey && k === 'w') return run(() => ((this.filled = !this.filled), this.emit('view')));
    if (k === 'escape')
      return run(() => {
        if (this.drag) return this.cancelDrag();
        if (this.tool === 'joint' && this.jointPicks.length) return this.clearJointPicks();
        if (nodeMode && this.selectedNodes().length) return this.clearNodeSel();
        if (this.draft) this.finishLine();
        else if (this.tool !== 'select') this.setTool('select');
        else this.setSel([]);
      });
    if (k === 'enter' && this.draft) return run(() => this.finishLine());
    if (k === 'enter' && this.tool === 'joint' && this.jointPicks.length) return run(() => this.onJointDialog?.());
    if (nodeMode && !ctrl && !e.altKey) {
      if (k === 'd' || k === 'delete' || k === 'backspace') return run(() => this.deleteNodes());
      if (k === 'i') return run(() => this.insertNode());
      if (k === 'l') return run(() => this.setSegmentType(false));
      if (k === 'c') return run(() => this.setSegmentType(true));
      if (k === 'e') return run(() => this.setNodeType(false));
      if (k === 's') return run(() => this.setNodeType(true));
      const st = e.shiftKey ? 10 : 1;
      const arrows: Record<string, [number, number]> = { arrowleft: [-st, 0], arrowright: [st, 0], arrowup: [0, -st], arrowdown: [0, st] };
      if (arrows[k] && this.selectedNodes().length) return run(() => this.nudgeNodes(...arrows[k]));
    }
    if (k === 'delete' || k === 'backspace') return run(() => this.deleteSel());
    const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    if (k === 'arrowleft') return run(() => this.nudge(-step, 0));
    if (k === 'arrowright') return run(() => this.nudge(step, 0));
    if (k === 'arrowup') return run(() => this.nudge(0, -step));
    if (k === 'arrowdown') return run(() => this.nudge(0, step));
    if (k === '.') return run(() => this.rotateBy(-90));
    if (k === ',') return run(() => this.rotateBy(90));
    if (k === '+' || k === '=') return run(() => this.zoomAt(1.25));
    if (k === '-') return run(() => this.zoomAt(0.8));
    if (this.sel.length > 1) {
      const map: Record<string, Parameters<Editor['align']>[0]> = {
        l: 'left', r: 'right', t: 'top', b: 'bottom', c: 'hcenter', e: 'vcenter',
      };
      if (map[k]) return run(() => this.align(map[k]));
    }
  }

  // ---------- Zeichnen ----------

  setDark(dark: boolean) {
    this.dark = dark;
    this.redraw();
  }
  private get colors() {
    return this.dark ? CANVAS_THEMES.dark : CANVAS_THEMES.light;
  }
  /** Layerfarbe zum Zeichnen: Schwarz wird auf dunklem Grund hell dargestellt */
  layerDrawColor(i: number): string {
    const c = PALETTE[i] ?? '#000000';
    return this.dark ? brightenForDark(c) : c;
  }

  /**
   * Arbeitsfläche als PNG (data:-URL) für KI-Agenten: Ausschnitt `box` in Weltkoordinaten, längere Seite
   * etwa `size` Pixel, mit Linealen, ohne Auswahl und Hilfslinien. Die Ansicht der Person bleibt unverändert.
   */
  renderImage(box: Box, size: number): string {
    const pad = 12;
    const z = (size - RULER - pad * 2) / Math.max(box.w, box.h, 1);
    const off = document.createElement('canvas');
    off.width = Math.round(RULER + pad * 2 + box.w * z);
    off.height = Math.round(RULER + pad * 2 + box.h * z);
    const saved = {
      canvas: this.canvas, ctx: this.ctx, dpr: this.dpr, view: this.view, sel: this.sel,
      nodeHover: this.nodeHover, segHover: this.segHover, snapHit: this.snapHit, alignGuides: this.alignGuides, draft: this.draft,
    };
    try {
      this.canvas = off;
      this.ctx = off.getContext('2d')!;
      this.dpr = 1;
      this.view = { zoom: z, ox: RULER + pad - box.x * z, oy: RULER + pad - box.y * z };
      this.sel = [];
      this.nodeHover = this.segHover = this.snapHit = null;
      this.alignGuides = [];
      this.draft = null;
      this.render();
      return off.toDataURL('image/png');
    } finally {
      Object.assign(this, saved);
      this.dirty = true;
    }
  }

  private render() {
    const ctx = this.ctx,
      dpr = this.dpr,
      { zoom: z, ox, oy } = this.view;
    const W = this.w,
      H = this.h;
    const bed = this.doc.bed;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const T = this.colors;
    ctx.fillStyle = T.outside;
    ctx.fillRect(0, 0, W, H);

    // Bett und Raster (in Bildschirmkoordinaten für scharfe Linien)
    const p0 = this.toScreen({ x: 0, y: 0 }),
      p1 = this.toScreen({ x: bed.w, y: bed.h });
    ctx.fillStyle = T.bed;
    ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    if (this.background) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
      ctx.clip();
      ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
      this.background(ctx);
      ctx.restore();
    }
    const grid = (step: number, color: string) => {
      if (step * z < 6) return;
      ctx.beginPath();
      const xa = Math.max(0, Math.floor(this.toWorld(0, 0).x / step) * step);
      const xb = Math.min(bed.w, this.toWorld(W, 0).x);
      for (let x = xa; x <= xb + 1e-9; x += step) {
        const s = Math.round(x * z + ox) + 0.5;
        ctx.moveTo(s, p0.y);
        ctx.lineTo(s, p1.y);
      }
      // y-Raster von unten (Maschinennull) gezählt
      for (let y = 0; y <= bed.h + 1e-9; y += step) {
        const s = Math.round((bed.h - y) * z + oy) + 0.5;
        if (s < 0 || s > H) continue;
        ctx.moveTo(p0.x, s);
        ctx.lineTo(p1.x, s);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
    };
    grid(1, T.grid1);
    grid(10, T.grid10);
    grid(100, T.grid100);
    ctx.strokeStyle = T.border;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    // Ursprungsmarker
    ctx.fillStyle = '#e02020';
    ctx.fillRect(p0.x - 4, p1.y - 4, 8, 8);
    ctx.fillStyle = '#20a020';
    ctx.fillRect(p1.x - 4, p0.y - 4, 8, 8);

    // Objekte
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
    const px = 1 / z;
    const selSet = new Set<Obj>();
    for (const o of this.sel) for (const [l] of leaves([o])) selSet.add(l);
    // Pfade je Layer sammeln und gebündelt zeichnen (deutlich schneller als einzeln)
    const batches = new Map<string, { color: string; fill: boolean; sel: boolean; stroke: Path2D; fillPath: Path2D }>();
    const texts: [Obj, Mat, boolean, boolean][] = [];
    const images: [Obj, Mat, boolean][] = [];
    for (const [o, m] of visibleLeaves(this.doc.objs)) {
      const ly = this.layer(o.layer);
      if (!ly.show) continue;
      const selected = selSet.has(o);
      const fill = this.filled && ly.mode === 'fill';
      if (o.shape.kind === 'image') {
        images.push([o, m, selected]);
        continue;
      }
      if (o.shape.kind === 'text') {
        texts.push([o, m, selected, fill]);
        continue;
      }
      const key = `${o.layer}|${selected ? 1 : 0}`;
      let bt = batches.get(key);
      if (!bt) batches.set(key, (bt = { color: this.layerDrawColor(o.layer), fill, sel: selected, stroke: new Path2D(), fillPath: new Path2D() }));
      const p = cachedWorldPath(o, m);
      bt.stroke.addPath(p);
      if (fill) {
        // Offene Pfade werden auf Füll-Layern nicht gefüllt
        const s = o.shape;
        bt.fillPath.addPath(s.kind !== 'path' || s.subs.every((sp) => sp.closed) ? p : closedPath(s.subs, m));
      }
    }
    // Bilder liegen unter den Vektoren und zeigen das Ergebnis der Bildverarbeitung
    for (const [o, m, selected] of images) {
      const s = o.shape as ImageShape;
      const cv = displayCanvas(s, m, this.imgLayer(o.layer));
      ctx.save();
      ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      if (cv) {
        // Vergrößert scharfe Punkte zeigen, verkleinert glätten
        const scr = (z * Math.hypot(m[0], m[1]) * s.w) / cv.width;
        ctx.imageSmoothingEnabled = scr < 1.5;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(cv, 0, 0, s.w, s.h);
      } else {
        ctx.fillStyle = 'rgba(128,128,128,0.25)';
        ctx.fillRect(0, 0, s.w, s.h);
      }
      const k = 1 / Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]) || 1);
      ctx.strokeStyle = this.layerDrawColor(o.layer);
      ctx.lineWidth = (selected ? 1.5 : 1) * px * k;
      ctx.setLineDash(selected ? [5 * px * k, 3 * px * k] : []);
      ctx.strokeRect(0, 0, s.w, s.h);
      ctx.restore();
    }
    for (const bt of batches.values()) {
      ctx.strokeStyle = ctx.fillStyle = bt.color;
      if (bt.fill) {
        ctx.globalAlpha = 0.55;
        ctx.fill(bt.fillPath, 'evenodd');
        ctx.globalAlpha = 1;
      }
      ctx.setLineDash(bt.sel ? [5 * px, 3 * px] : []);
      ctx.lineWidth = bt.sel ? 1.5 * px : 1.2 * px;
      ctx.stroke(bt.stroke);
    }
    for (const [o, m, selected, fill] of texts) {
      const t = o.shape as TextShape;
      ctx.strokeStyle = ctx.fillStyle = this.layerDrawColor(o.layer);
      ctx.setLineDash(selected ? [5 * px, 3 * px] : []);
      drawText(ctx, t, m, fill ? 'fill' : 'stroke', fill ? px : px * 1.2);
      if (selected && t.path && t.path.link === undefined) {
        // Kurve des Texts als Hilfslinie, wenn die Form nicht mehr da ist
        const g = new Path2D();
        g.addPath(subsToPath2D([t.path.sub]), new DOMMatrix(m));
        ctx.save();
        ctx.setLineDash([2 * px, 3 * px]);
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = px;
        ctx.strokeStyle = this.colors.sel;
        ctx.stroke(g);
        ctx.restore();
      }
      if (selected) {
        ctx.setLineDash([5 * px, 3 * px]);
        ctx.globalAlpha = 0.5;
        const b = boundsOf([o], mul(m, inv(o.m)))!;
        ctx.lineWidth = px;
        ctx.strokeStyle = this.colors.sel;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.globalAlpha = 1;
      }
    }
    ctx.setLineDash([]);

    // Linie im Entstehen
    if (this.draft && this.draft.nodes.length) {
      const sp: SubPath = { nodes: [...this.draft.nodes], closed: false };
      if (!this.drag) sp.nodes.push({ x: this.cursor.x, y: this.cursor.y });
      const tmp: Obj = { id: 0, m: IDENT, layer: this.currentLayer, shape: { kind: 'path', subs: [sp] } };
      ctx.strokeStyle = this.layerDrawColor(this.currentLayer);
      ctx.lineWidth = 1.2 * px;
      ctx.stroke(worldPath(tmp.shape, IDENT));
    }

    // Vorschau der Biegeschnitte
    if (this.hingePreview) {
      ctx.strokeStyle = '#ff6020';
      ctx.lineWidth = 1.2 * px;
      ctx.stroke(subsToPath2D(this.hingePreview));
    }

    // Offset-Vorschau
    if (this.offsetPreview) {
      ctx.strokeStyle = '#ff6020';
      ctx.setLineDash([4 * px, 2 * px]);
      ctx.lineWidth = 1.5 * px;
      ctx.stroke(subsToPath2D(this.offsetPreview));
      ctx.setLineDash([]);
    }

    // Verbindungen: gewählte Kanten (nummeriert), Kante unter dem Mauszeiger und Vorschau
    if (this.tool === 'joint') {
      ctx.save();
      const edge = (p: EdgePick) => {
        const s = segments(shapeSubs(p.obj.shape)[p.sub])[p.seg];
        return [apply(p.m, s.a.x, s.a.y), apply(p.m, s.b.x, s.b.y)];
      };
      ctx.lineCap = 'round';
      if (this.jointHover) {
        const [a, b] = edge(this.jointHover);
        ctx.strokeStyle = SNAP_COLOR;
        ctx.lineWidth = 4 * px;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      this.validJointPicks().forEach((p, i) => {
        const [a, b] = edge(p);
        ctx.strokeStyle = '#ff6020';
        ctx.lineWidth = 4 * px;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        const mx = (a.x + b.x) / 2,
          my = (a.y + b.y) / 2;
        ctx.fillStyle = '#ff6020';
        ctx.beginPath();
        ctx.arc(mx, my, 8 * px, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${11 * px}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), mx, my + 0.5 * px);
      });
      if (this.jointPreview) {
        ctx.strokeStyle = '#ff6020';
        ctx.setLineDash([4 * px, 2 * px]);
        ctx.lineWidth = 1.5 * px;
        ctx.stroke(subsToPath2D(this.jointPreview));
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // Array-Vorschau: Umrisse der Kopien
    if (this.arrayPreview && this.sel.length) {
      const p = new Path2D();
      for (const M of this.arrayPreview.slice(1)) {
        for (const [leaf, m] of visibleLeaves(this.sel, M)) {
          const s = leaf.shape;
          const local = s.kind === 'text' ? textOutline(s)?.path : s.kind === 'image' ? rectPath(s.w, s.h) : localPath(s);
          if (local) p.addPath(local, new DOMMatrix(m));
        }
      }
      ctx.strokeStyle = '#ff6020';
      ctx.setLineDash([4 * px, 2 * px]);
      ctx.lineWidth = 1.2 * px;
      ctx.stroke(p);
      ctx.setLineDash([]);
      if (this.arrayCenter) {
        const { x, y } = this.arrayCenter;
        ctx.lineWidth = 1.5 * px;
        ctx.beginPath();
        ctx.moveTo(x - 7 * px, y);
        ctx.lineTo(x + 7 * px, y);
        ctx.moveTo(x, y - 7 * px);
        ctx.lineTo(x, y + 7 * px);
        ctx.stroke();
      }
    }

    // Laserkopf (Werkstückkoordinaten der Maschine, y nach oben)
    if (this.laserPos) {
      const lx = this.laserPos.x,
        ly = bed.h - this.laserPos.y;
      ctx.strokeStyle = '#e02020';
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath();
      ctx.arc(lx, ly, 5 * px, 0, Math.PI * 2);
      ctx.moveTo(lx - 9 * px, ly);
      ctx.lineTo(lx + 9 * px, ly);
      ctx.moveTo(lx, ly - 9 * px);
      ctx.lineTo(lx, ly + 9 * px);
      ctx.stroke();
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.renderOverlay(ctx);
    this.renderRulers(ctx);
  }

  private renderOverlay(ctx: CanvasRenderingContext2D) {
    const T = this.colors;
    // Auswahlrahmen
    const b = this.selBounds();
    if (b && this.tool !== 'node') {
      const hs = this.handlePoints(b);
      ctx.strokeStyle = T.sel;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(hs[0].x + HANDLE_OFF, hs[0].y + HANDLE_OFF, hs[4].x - hs[0].x - 2 * HANDLE_OFF, hs[4].y - hs[0].y - 2 * HANDLE_OFF);
      ctx.setLineDash([]);
      hs.forEach((h, i) => {
        if (this.rotateMode) {
          if (i % 2) return;
          const cx = hs[0].x + (hs[4].x - hs[0].x) / 2,
            cy = hs[0].y + (hs[4].y - hs[0].y) / 2;
          const a = Math.atan2(h.y - cy, h.x - cx);
          ctx.beginPath();
          ctx.arc(h.x, h.y, 6, a + Math.PI / 2 - 0.9, a + Math.PI / 2 + 0.9 + Math.PI);
          ctx.strokeStyle = T.sel;
          ctx.lineWidth = 2;
          ctx.stroke();
          return;
        }
        ctx.fillStyle = T.handleFill;
        ctx.strokeStyle = T.sel;
        ctx.lineWidth = 1;
        ctx.fillRect(h.x - 4, h.y - 4, 8, 8);
        ctx.strokeRect(h.x - 4 + 0.5, h.y - 4 + 0.5, 7, 7);
      });
      if (this.rotateMode) {
        const c = this.toScreen(this.rotationCenter()!);
        ctx.beginPath();
        ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
        ctx.strokeStyle = T.sel;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(c.x - 6, c.y);
        ctx.lineTo(c.x + 6, c.y);
        ctx.moveTo(c.x, c.y - 6);
        ctx.lineTo(c.x, c.y + 6);
        ctx.strokeStyle = T.sel;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    // Winkelanzeige beim Drehen
    const d = this.drag;
    if (d && d.type === 'rotate') {
      const q = this.toScreen(this.cursor);
      const label = `${d.angle.toFixed(1)}°`;
      ctx.font = '12px system-ui, sans-serif';
      const w = ctx.measureText(label).width + 10;
      ctx.fillStyle = T.label;
      ctx.fillRect(q.x + 14, q.y + 10, w, 18);
      ctx.fillStyle = T.labelText;
      ctx.textBaseline = 'middle';
      ctx.fillText(label, q.x + 19, q.y + 19);
      const c = this.toScreen(d.center);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = T.sel;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Auswahlrechteck
    if (d && d.type === 'marquee') {
      const a = this.toScreen(d.start),
        c = this.toScreen(d.end);
      const enclose = c.x >= a.x;
      ctx.strokeStyle = enclose ? '#d02020' : '#10a030';
      ctx.fillStyle = enclose ? 'rgba(208,32,32,0.06)' : 'rgba(16,160,48,0.06)';
      ctx.setLineDash(enclose ? [] : [5, 3]);
      ctx.fillRect(a.x, a.y, c.x - a.x, c.y - a.y);
      ctx.strokeRect(a.x + 0.5, a.y + 0.5, c.x - a.x, c.y - a.y);
      ctx.setLineDash([]);
    }
    if (d && d.type === 'nodebox') {
      const a = this.toScreen(d.start),
        c = this.toScreen(d.end);
      ctx.strokeStyle = T.sel;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(a.x + 0.5, a.y + 0.5, c.x - a.x, c.y - a.y);
      ctx.setLineDash([]);
    }
    // Knoten
    const o = this.tool === 'node' ? this.nodeTarget() : null;
    if (o) {
      const scr = (p: Pt) => this.toScreen(apply(o.m, p.x, p.y));
      const sel = this.nodeSelection(o);
      const subsO = shapeSubs(o.shape);
      // Segmente zwischen ausgewählten Knoten hervorheben (Ziel für Gerade/Kurve)
      if (sel.size >= 2) {
        ctx.strokeStyle = '#ff6020';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        subsO.forEach((sp, si) =>
          segments(sp).forEach((sg) => {
            if (!sel.has(`${si}:${sg.ia}`) || !sel.has(`${si}:${sg.ib}`)) return;
            const a = scr(sg.a), c1 = scr(sg.c1), c2 = scr(sg.c2), b = scr(sg.b);
            ctx.moveTo(a.x, a.y);
            if (sg.curve) ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
            else ctx.lineTo(b.x, b.y);
          }),
        );
        ctx.stroke();
      }
      subsO.forEach((sp, si) => {
        sp.nodes.forEach((n, ni) => {
          const q = scr(n);
          for (const which of ['cin', 'cout'] as const) {
            const hp = n[which];
            if (!hp) continue;
            const hq = scr(hp);
            ctx.strokeStyle = T.nodeLine;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(q.x, q.y);
            ctx.lineTo(hq.x, hq.y);
            ctx.stroke();
            const hot = this.nodeHover?.sub === si && this.nodeHover.idx === ni && this.nodeHover.which === which;
            ctx.fillStyle = hot ? '#ff6020' : T.handleFill;
            ctx.beginPath();
            ctx.arc(hq.x, hq.y, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
          const hot = this.nodeHover?.sub === si && this.nodeHover.idx === ni && this.nodeHover.which === 'p';
          const picked = sel.has(`${si}:${ni}`);
          const col = ni === 0 ? '#20a040' : T.sel;
          // ausgewählt: gefüllt, sonst hohl
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = hot ? '#ff6020' : col;
          ctx.fillStyle = hot ? '#ff6020' : picked ? col : T.handleFill;
          const r = picked ? 4.5 : 3.5;
          ctx.fillRect(q.x - r, q.y - r, 2 * r, 2 * r);
          ctx.strokeRect(q.x - r, q.y - r, 2 * r, 2 * r);
        });
      });
      if (this.segHover) {
        const sg = segments(shapeSubs(o.shape)[this.segHover.sub])[this.segHover.seg];
        const t = this.segHover.t;
        const p = sg.curve ? bezierPt(sg.a, sg.c1, sg.c2, sg.b, t) : { x: sg.a.x + (sg.b.x - sg.a.x) * t, y: sg.a.y + (sg.b.y - sg.a.y) * t };
        const q = scr(p);
        ctx.strokeStyle = '#ff6020';
        ctx.beginPath();
        ctx.arc(q.x, q.y, 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    this.renderSnap(ctx);
    // Startknoten der Linie hervorheben (Schließen)
    if (this.draft && this.draft.nodes.length >= 2) {
      const q = this.toScreen(this.draft.nodes[0]);
      ctx.strokeStyle = '#20a040';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(q.x - 5, q.y - 5, 10, 10);
    }
  }

  /** Ausrichtungshilfen und Fangpunkt mit Art (wie das Fang-Symbol am Mauszeiger in LightBurn) */
  private renderSnap(ctx: CanvasRenderingContext2D) {
    const T = this.colors;
    if (this.alignGuides.length) {
      ctx.strokeStyle = SNAP_COLOR;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      for (const g of this.alignGuides) {
        const a = this.toScreen(g.axis === 'x' ? { x: g.v, y: g.a } : { x: g.a, y: g.v }),
          b = this.toScreen(g.axis === 'x' ? { x: g.v, y: g.b } : { x: g.b, y: g.v });
        const pad = 12;
        if (g.axis === 'x') {
          const x = Math.round(a.x) + 0.5;
          ctx.moveTo(x, Math.min(a.y, b.y) - pad);
          ctx.lineTo(x, Math.max(a.y, b.y) + pad);
        } else {
          const y = Math.round(a.y) + 0.5;
          ctx.moveTo(Math.min(a.x, b.x) - pad, y);
          ctx.lineTo(Math.max(a.x, b.x) + pad, y);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const hit = this.snapHit;
    if (!hit) return;
    const q = this.toScreen(hit.p);
    const x = Math.round(q.x) + 0.5,
      y = Math.round(q.y) + 0.5;
    ctx.strokeStyle = SNAP_COLOR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    switch (hit.kind) {
      case 'node':
        ctx.rect(x - 5, y - 5, 10, 10);
        break;
      case 'mid':
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x + 6, y + 4.5);
        ctx.lineTo(x - 6, y + 4.5);
        ctx.closePath();
        break;
      case 'center':
        ctx.arc(x, y, 5.5, 0, Math.PI * 2);
        ctx.moveTo(x - 8, y);
        ctx.lineTo(x + 8, y);
        ctx.moveTo(x, y - 8);
        ctx.lineTo(x, y + 8);
        break;
      case 'cross':
        ctx.moveTo(x - 5, y - 5);
        ctx.lineTo(x + 5, y + 5);
        ctx.moveTo(x + 5, y - 5);
        ctx.lineTo(x - 5, y + 5);
        break;
      case 'line':
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x + 5, y);
        ctx.lineTo(x, y + 5);
        ctx.lineTo(x - 5, y);
        ctx.closePath();
        break;
    }
    ctx.stroke();
    const label = SNAP_LABELS[hit.kind];
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(label).width + 8;
    ctx.fillStyle = T.label;
    ctx.fillRect(x + 10, y + 8, w, 16);
    ctx.fillStyle = T.labelText;
    ctx.fillText(label, x + 14, y + 16);
  }

  private renderRulers(ctx: CanvasRenderingContext2D) {
    const T = this.colors;
    const W = this.w,
      H = this.h,
      z = this.view.zoom;
    ctx.fillStyle = T.ruler;
    ctx.fillRect(0, 0, W, RULER);
    ctx.fillRect(0, 0, RULER, H);
    ctx.strokeStyle = T.rulerLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, RULER + 0.5);
    ctx.lineTo(W, RULER + 0.5);
    ctx.moveTo(RULER + 0.5, 0);
    ctx.lineTo(RULER + 0.5, H);
    ctx.stroke();
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    const major = steps.find((s) => s * z >= 60) ?? 1000;
    const minor = major / (String(major).startsWith('2') ? 4 : 5);
    ctx.fillStyle = T.rulerText;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.beginPath();
    const x0 = this.toWorld(RULER, 0).x,
      x1 = this.toWorld(W, 0).x;
    for (let x = Math.floor(x0 / minor) * minor; x <= x1; x += minor) {
      const s = Math.round(x * z + this.view.ox) + 0.5;
      if (s < RULER) continue;
      const isMajor = Math.abs(x / major - Math.round(x / major)) < 1e-6;
      ctx.moveTo(s, RULER);
      ctx.lineTo(s, RULER - (isMajor ? 10 : 4));
      if (isMajor) ctx.fillText(fmt(x), s + 2, 2);
    }
    const bedH = this.doc.bed.h;
    const y0 = bedH - this.toWorld(0, H).y,
      y1 = bedH - this.toWorld(0, RULER).y;
    ctx.save();
    for (let y = Math.floor(y0 / minor) * minor; y <= y1; y += minor) {
      const s = Math.round((bedH - y) * z + this.view.oy) + 0.5;
      if (s < RULER) continue;
      const isMajor = Math.abs(y / major - Math.round(y / major)) < 1e-6;
      ctx.moveTo(RULER, s);
      ctx.lineTo(RULER - (isMajor ? 10 : 4), s);
      if (isMajor) {
        ctx.save();
        ctx.translate(2, s - 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(fmt(y), 0, 0);
        ctx.restore();
      }
    }
    ctx.restore();
    ctx.stroke();
    // Cursor-Markierung
    const c = this.toScreen(this.cursor);
    ctx.strokeStyle = '#e02020';
    ctx.beginPath();
    ctx.moveTo(c.x + 0.5, 0);
    ctx.lineTo(c.x + 0.5, RULER);
    ctx.moveTo(0, c.y + 0.5);
    ctx.lineTo(RULER, c.y + 0.5);
    ctx.stroke();
    ctx.fillStyle = T.rulerCorner;
    ctx.fillRect(0, 0, RULER, RULER);
  }
}

const worldCache = new WeakMap<Obj, { m: Mat; shape: Shape; path: Path2D; ver: number }>();
const shapeVersions = new WeakMap<Shape, number>();
/** Nach direkten Formänderungen erhöhen, damit Weltpfade neu gebaut werden. */
function bumpShapeVersion(s: Shape) {
  shapeVersions.set(s, (shapeVersions.get(s) ?? 0) + 1);
}
function cachedWorldPath(o: Obj, m: Mat): Path2D {
  const c = worldCache.get(o);
  if (c && c.shape === o.shape && c.ver === (shapeVersions.get(o.shape) ?? 0) && c.m.every((v, i) => v === m[i])) return c.path;
  const path = worldPath(o.shape, m);
  worldCache.set(o, { m, shape: o.shape, path, ver: shapeVersions.get(o.shape) ?? 0 });
  return path;
}

function rectPath(w: number, h: number): Path2D {
  const p = new Path2D();
  p.rect(0, 0, w, h);
  return p;
}

function closedPath(subs: SubPath[], m: Mat): Path2D {
  const p = new Path2D();
  p.addPath(subsToPath2D(subs.filter((sp) => sp.closed)), new DOMMatrix(m));
  return p;
}

/** Sehr dunkle Layerfarben auf dunklem Grund aufhellen (Farbton bleibt), Schwarz wird Hellgrau. */
const darkColorCache = new Map<string, string>();
function brightenForDark(hex: string): string {
  let out = darkColorCache.get(hex);
  if (out) return out;
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lum = (0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]) / 255;
  if (lum < 0.02) out = '#e8e8e8';
  else if (lum < 0.15) {
    const mix = 0.45;
    out = '#' + v.map((c) => Math.round(c + (255 - c) * mix).toString(16).padStart(2, '0')).join('');
  } else out = hex;
  darkColorCache.set(hex, out);
  return out;
}

const ROTATE_CURSOR =
  `url("data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12a7 7 0 1 1-2-5" stroke="white" stroke-width="4"/><path d="M19 4v4h-4" stroke="white" stroke-width="4"/><path d="M19 12a7 7 0 1 1-2-5" stroke="black" stroke-width="1.8"/><path d="M19 4v4h-4" stroke="black" stroke-width="1.8"/></g></svg>',
  )}") 12 12, alias`;

/** Farbe für Fangpunkte und Ausrichtungshilfen (auf hellem und dunklem Grund gut sichtbar) */
const SNAP_COLOR = '#e0218a';

const fmt = (v: number) => (Math.abs(v) < 1e-9 ? '0' : String(Math.round(v * 100) / 100));

function normBox(a: Pt, b: Pt): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export const TOOL_HINTS: Record<Tool, string> = {
  select: t('Drehen: knapp außerhalb einer Ecke ziehen oder Auswahl nochmals anklicken. Rahmen nach rechts: umschließend, nach links: kreuzend.'),
  node: t('Klick/Rahmen wählt Knoten, Shift ergänzt. Entf löschen, L Gerade, C Kurve, E Ecke, S glatt, I einfügen (oder Doppelklick auf Kante).'),
  line: t('Klicken für Ecken, Ziehen für Kurven. Startpunkt anklicken schließt, Doppelklick/Enter/Rechtsklick beendet.'),
  rect: t('Ziehen zum Zeichnen. Shift: Quadrat, Ctrl: von der Mitte.'),
  ellipse: t('Ziehen zum Zeichnen. Shift: Kreis, Ctrl: von der Mitte.'),
  polygon: t('Von der Mitte aus ziehen. Shift: nicht drehen.'),
  text: t('Klicken, um Text zu setzen, oder vorhandenen Text anklicken.'),
  joint: t('Verbindung: erste gerade Kante anklicken (Zinken, Zapfen oder Schlitze). Esc hebt die Wahl auf.'),
};

const JOINT_HINT_SECOND =
  t('Zweite Kante anklicken (Gegenstück bzw. Linie für die Schlitze) oder Enter für nur eine Kante. Erneuter Klick hebt die Wahl auf.');
