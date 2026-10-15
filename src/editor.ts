// Editor: Zustand, Zeichnen auf der Arbeitsfläche, Werkzeuge und Befehle.
import {
  about, apply, bumpIds, clone, cloneObj, defaultLayer, Doc, IDENT, inv, Layer, leaves, Mat, mul, newDoc, newId,
  Node, Obj, PALETTE, Pt, rotate, scale, setLayerDeep, Shape, SubPath, TextShape, translate,
} from './model';
import { BoolOp, booleanOp, OffsetOptions, offsetOp } from './ops';
import { loadFont, textToSubs } from './fonts';
import {
  bezierPt, Box, boundsOf, drawText, hitLeaf, invalidate, invalidateText, leafIntersectsBox, segments, shapeSubs, subsToPath2D,
  worldPath,
} from './geom';

export type Tool = 'select' | 'node' | 'line' | 'rect' | 'ellipse' | 'polygon' | 'text';

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
  | { type: 'move'; start: Pt; orig: Mat[]; moved: boolean; toggleRotate: boolean; sx: number; sy: number }
  | { type: 'scale'; handle: number; box: Box; orig: Mat[] }
  | { type: 'rotate'; center: Pt; a0: number; orig: Mat[]; angle: number }
  | { type: 'pivot' }
  | { type: 'marquee'; start: Pt; end: Pt; base: Obj[]; mode: 'set' | 'add' | 'toggle' | 'remove' }
  | { type: 'create'; start: Pt; obj: Obj | null }
  | { type: 'linenode'; node: Node }
  | { type: 'node'; obj: Obj; sub: number; idx: number; which: 'p' | 'cin' | 'cout'; start: Pt; orig: Node; moved: boolean };

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

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.restore();
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('dblclick', (e) => this.onDouble(e));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.space = false;
    });
    const loop = () => {
      if (this.dirty) {
        this.dirty = false;
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
    this.listeners.forEach((f) => f(what));
    if (what === 'doc') this.scheduleSave();
  }
  redraw() {
    this.dirty = true;
  }

  // ---------- Dokument, Undo, Autosave ----------

  layer(i: number): Layer {
    return (this.doc.layers[i] ??= defaultLayer(i));
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
    this.doc = st.doc;
    bumpIds(this.doc.objs);
    const ids = new Set<number>(st.sel ?? []);
    this.sel = this.doc.objs.filter((o) => ids.has(o.id));
  }
  /** Vor jeder Änderung aufrufen. */
  snapshot() {
    this.undo.push(this.state());
    if (this.undo.length > SNAPSHOT_LIMIT) this.undo.shift();
    this.redo = [];
  }
  private dropSnapshot() {
    this.undo.pop();
  }
  doUndo() {
    const s = this.undo.pop();
    if (!s) return;
    this.redo.push(this.state());
    this.load(s);
    this.emit('doc');
    this.emit('sel');
  }
  doRedo() {
    const s = this.redo.pop();
    if (!s) return;
    this.undo.push(this.state());
    this.load(s);
    this.emit('doc');
    this.emit('sel');
  }
  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.doc));
      } catch {
        /* Speicher nicht verfügbar */
      }
    }, 500);
  }
  private restore() {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s) {
        this.doc = JSON.parse(s);
        bumpIds(this.doc.objs);
      }
    } catch {
      this.doc = newDoc();
    }
  }
  serialize() {
    return JSON.stringify(this.doc, null, 1);
  }
  openDoc(json: string) {
    const d = JSON.parse(json) as Doc;
    if (!d || !Array.isArray(d.objs)) throw new Error('Keine gültige Projektdatei');
    this.snapshot();
    this.doc = d;
    bumpIds(d.objs);
    this.sel = [];
    this.zoomPage();
    this.emit('doc');
    this.emit('sel');
  }
  newDocument() {
    this.snapshot();
    const bed = this.doc.bed;
    this.doc = newDoc();
    this.doc.bed = { ...bed };
    this.sel = [];
    this.emit('doc');
    this.emit('sel');
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
      for (const [leaf, m] of leaves([top])) {
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
    this.hint = TOOL_HINTS[t];
    this.canvas.style.cursor = t === 'select' ? 'default' : t === 'text' ? 'text' : 'crosshair';
    this.emit('tool');
  }

  private snap(p: Pt): Pt {
    if (!this.snapGrid) return p;
    const g = this.gridStep;
    return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
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
          this.drag = {
            type: 'move', start: wp, orig: this.sel.map((x) => x.m), moved: false,
            toggleRotate: was && !e.shiftKey && !ctrl, sx, sy,
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
        this.drag = { type: 'create', start: this.snap(wp), obj: null };
        return;
      case 'line': {
        const p = this.snap(wp);
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
        const p = this.snap(wp);
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
      case 'node': {
        const target = this.nodeTarget();
        if (target && this.nodeHover) {
          if (target.shape.kind !== 'path') this.convertObjToPath(target);
          const sp = (target.shape as { subs: SubPath[] }).subs[this.nodeHover.sub];
          const n = sp.nodes[this.nodeHover.idx];
          this.snapshot();
          this.drag = {
            type: 'node', obj: target, sub: this.nodeHover.sub, idx: this.nodeHover.idx,
            which: this.nodeHover.which, start: wp, orig: clone(n), moved: false,
          };
          return;
        }
        const o = this.hitTest(wp);
        this.setSel(o ? [o] : []);
        if (o && o.shape.kind === 'text') this.hint = 'Text hat keine Knoten. Erst in einen Pfad umwandeln (folgt mit der Schrift-Engine).';
        else if (o && o.shape.kind === 'group') this.hint = 'Gruppen erst auflösen (Ctrl+U), dann Knoten bearbeiten.';
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
        if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
        if (this.snapGrid) {
          const g = this.gridStep;
          dx = Math.round(dx / g) * g;
          dy = Math.round(dy / g) * g;
        }
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
        this.hint = `Drehung ${d.angle.toFixed(1)}° · Shift: 15°-Schritte, Ctrl: 5°-Schritte, Esc: abbrechen`;
        this.emit('doc');
        return;
      }
      case 'marquee':
        d.end = wp;
        return;
      case 'pivot':
        this.pivot = this.snap(wp);
        return;
      case 'create': {
        const p = this.snap(wp);
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
        const p = this.snap(wp);
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
        const a = apply(im, d.start.x, d.start.y),
          b = apply(im, this.snap(wp).x, this.snap(wp).y);
        const dx = b.x - a.x,
          dy = b.y - a.y;
        d.moved = true;
        const n = (o.shape as { subs: SubPath[] }).subs[d.sub].nodes[d.idx];
        const sh = (p?: Pt) => (p ? { x: p.x + dx, y: p.y + dy } : undefined);
        if (d.which === 'p') {
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
    switch (d.type) {
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
          if ([...leaves([o])].every(([l]) => !this.layer(l.layer).show)) return false;
          if (enclose) {
            const b = boundsOf([o]);
            return !!b && b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;
          }
          return [...leaves([o])].some(([l, m]) => leafIntersectsBox(l, m, r));
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
    } else if (d.type === 'create' && d.obj) {
      this.doc.objs = this.doc.objs.filter((o) => o !== d.obj);
      this.dropSnapshot();
      this.setSel([]);
    } else if (d.type === 'node') {
      Object.assign((d.obj.shape as { subs: SubPath[] }).subs[d.sub].nodes[d.idx], d.orig);
      this.touch(d.obj.shape);
      this.dropSnapshot();
    }
    this.hint = '';
    this.emit('doc');
    this.emit('sel');
  }

  // ---------- Knotenbearbeitung ----------

  private nodeTarget(): Obj | null {
    if (this.sel.length !== 1) return null;
    const o = this.sel[0];
    return o.shape.kind === 'group' || o.shape.kind === 'text' ? null : o;
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
    this.canvas.style.cursor = this.nodeHover ? 'move' : this.segHover ? 'copy' : 'crosshair';
    if (prevN !== JSON.stringify(this.nodeHover) || prevS !== JSON.stringify(this.segHover)) this.redraw();
  }

  private convertObjToPath(o: Obj) {
    if (o.shape.kind === 'text' || o.shape.kind === 'group' || o.shape.kind === 'path') return;
    o.shape = { kind: 'path', subs: clone(shapeSubs(o.shape)) };
  }

  /** Formen und Texte der Auswahl in Pfade umwandeln (Texte über die Schriftkonturen). */
  async convertSelToPath() {
    const objs = this.sel.filter((o) => ['rect', 'ellipse', 'polygon', 'text', 'group'].includes(o.shape.kind));
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
      ? `Schrift ${[...fallbacks].join(', ')} nicht gefunden, Roboto verwendet.`
      : 'In Pfad umgewandelt.';
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

  /** Boolesche Operation auf die Auswahl. Das zuerst gewählte Objekt ist die Basis. */
  async booleanSel(op: BoolOp) {
    if (this.sel.length < 2) {
      this.hint = 'Für Boolesche Operationen mindestens zwei Objekte auswählen.';
      this.emit('tool');
      return;
    }
    const inputs = this.sel;
    const subs = booleanOp(op, await this.withTextOutlines(inputs));
    this.snapshot();
    const idx = Math.min(...inputs.map((o) => this.doc.objs.indexOf(o)));
    this.doc.objs = this.doc.objs.filter((o) => !inputs.includes(o));
    if (!subs.length) {
      this.hint = 'Ergebnis ist leer (keine gemeinsame Fläche).';
      this.setSel([]);
    } else {
      const res: Obj = { id: newId(), m: IDENT, layer: inputs[0].layer, shape: { kind: 'path', subs } };
      this.doc.objs.splice(idx, 0, res);
      this.setSel([res]);
      this.hint = '';
    }
    this.emit('doc');
  }

  /** Offset: neue Konturen im Abstand zur Auswahl. */
  async offsetSel(opt: OffsetOptions, keepOriginal: boolean) {
    if (!this.sel.length) return;
    const inputs = this.sel;
    const subs = offsetOp(await this.withTextOutlines(inputs), opt);
    this.snapshot();
    if (!keepOriginal) this.doc.objs = this.doc.objs.filter((o) => !inputs.includes(o));
    if (!subs.length) {
      this.hint = 'Offset ergibt keine Kontur (Abstand zu groß für Innen-Offset?).';
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

  deleteNode() {
    const o = this.nodeTarget();
    if (!o || !this.nodeHover) return;
    this.snapshot();
    const subs = this.pathTarget()!;
    const sp = subs[this.nodeHover.sub];
    const n = sp.nodes[this.nodeHover.idx];
    if (this.nodeHover.which !== 'p') delete n[this.nodeHover.which], (n.smooth = false);
    else sp.nodes.splice(this.nodeHover.idx, 1);
    if (sp.nodes.length < 2) subs.splice(this.nodeHover.sub, 1);
    if (sp.closed && sp.nodes.length < 3) sp.closed = false;
    this.nodeHover = null;
    if (!subs.length) {
      this.doc.objs = this.doc.objs.filter((x) => x !== o);
      this.setSel([]);
    }
    this.touch(o.shape);
    this.emit('doc');
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
    this.touch(o.shape);
    this.emit('doc');
  }

  setNodeType(smooth: boolean) {
    const o = this.nodeTarget();
    const h = this.nodeHover;
    if (!o || !h) return;
    this.snapshot();
    const sp = this.pathTarget()![h.sub];
    const n = sp.nodes[h.idx];
    if (!smooth) {
      delete n.cin;
      delete n.cout;
      n.smooth = false;
    } else {
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

  // ---------- Befehle ----------

  deleteSel() {
    if (!this.sel.length) return;
    this.snapshot();
    this.doc.objs = this.doc.objs.filter((o) => !this.sel.includes(o));
    this.setSel([]);
    this.emit('doc');
  }
  selectAll() {
    this.setSel(this.doc.objs.filter((o) => [...leaves([o])].some(([l]) => this.layer(l.layer).show)));
  }
  selectLayer(i: number) {
    this.setSel(this.doc.objs.filter((o) => [...leaves([o])].some(([l]) => l.layer === i)));
  }
  copy() {
    this.clipboard = this.sel.map((o) => clone(o));
  }
  cut() {
    this.copy();
    this.deleteSel();
  }
  paste(offset = 5) {
    if (!this.clipboard.length) return;
    this.snapshot();
    const objs = this.clipboard.map((o) => {
      const c = cloneObj(o);
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
    const objs = this.sel.map(cloneObj);
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

  selTexts(): Obj[] {
    return this.sel.filter((o) => o.shape.kind === 'text');
  }
  updateTexts(patch: Partial<TextShape>) {
    Object.assign(this.textDefaults, Object.fromEntries(Object.entries(patch).filter(([k]) => k !== 'text')));
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
    }
    if (ctrl) {
      if (k === 'z') return run(() => this.doUndo());
      if (k === 'y') return run(() => this.doRedo());
      if (k === 'c') return run(() => this.copy());
      if (k === 'x') return run(() => this.cut());
      if (k === 'v') return run(() => this.paste());
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
    if (e.altKey && k === 'w') return run(() => ((this.filled = !this.filled), this.emit('view')));
    if (k === 'escape')
      return run(() => {
        if (this.drag) return this.cancelDrag();
        if (this.draft) this.finishLine();
        else if (this.tool !== 'select') this.setTool('select');
        else this.setSel([]);
      });
    if (k === 'enter' && this.draft) return run(() => this.finishLine());
    if (this.tool === 'node' && this.nodeTarget()) {
      if (k === 'd' || k === 'delete') return run(() => this.deleteNode());
      if (k === 'i') return run(() => this.insertNode());
      if (k === 'c') return run(() => this.setNodeType(false));
      if (k === 's') return run(() => this.setNodeType(true));
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
    for (const [o, m] of leaves(this.doc.objs)) {
      const ly = this.layer(o.layer);
      if (!ly.show) continue;
      const selected = selSet.has(o);
      const fill = this.filled && ly.mode === 'fill';
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

    // Offset-Vorschau
    if (this.offsetPreview) {
      ctx.strokeStyle = '#ff6020';
      ctx.setLineDash([4 * px, 2 * px]);
      ctx.lineWidth = 1.5 * px;
      ctx.stroke(subsToPath2D(this.offsetPreview));
      ctx.setLineDash([]);
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
    // Knoten
    const o = this.tool === 'node' ? this.nodeTarget() : null;
    if (o) {
      const scr = (p: Pt) => this.toScreen(apply(o.m, p.x, p.y));
      shapeSubs(o.shape).forEach((sp, si) => {
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
          ctx.fillStyle = hot ? '#ff6020' : ni === 0 ? '#20a040' : T.sel;
          ctx.fillRect(q.x - 4, q.y - 4, 8, 8);
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
    // Startknoten der Linie hervorheben (Schließen)
    if (this.draft && this.draft.nodes.length >= 2) {
      const q = this.toScreen(this.draft.nodes[0]);
      ctx.strokeStyle = '#20a040';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(q.x - 5, q.y - 5, 10, 10);
    }
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

const fmt = (v: number) => (Math.abs(v) < 1e-9 ? '0' : String(Math.round(v * 100) / 100));

function normBox(a: Pt, b: Pt): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export const TOOL_HINTS: Record<Tool, string> = {
  select: 'Drehen: knapp außerhalb einer Ecke ziehen oder Auswahl nochmals anklicken. Rahmen nach rechts: umschließend, nach links: kreuzend.',
  node: 'Knoten ziehen. Über Knoten/Kante: D löschen, I einfügen, C Ecke, S glatt. Doppelklick auf Kante fügt ein.',
  line: 'Klicken für Ecken, Ziehen für Kurven. Startpunkt anklicken schließt, Doppelklick/Enter/Rechtsklick beendet.',
  rect: 'Ziehen zum Zeichnen. Shift: Quadrat, Ctrl: von der Mitte.',
  ellipse: 'Ziehen zum Zeichnen. Shift: Kreis, Ctrl: von der Mitte.',
  polygon: 'Von der Mitte aus ziehen. Shift: nicht drehen.',
  text: 'Klicken, um Text zu setzen, oder vorhandenen Text anklicken.',
};
