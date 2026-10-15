// Geometrische Operationen mit Clipper (Angus Johnson, JS-Port): Boolesche Verknüpfungen und Offset.
// Kurven werden dafür fein in Linien zerlegt (Toleranz FLATTEN_TOL).
import ClipperLib from 'clipper-lib';
import { apply, leaves, Mat, Obj, Pt, SubPath } from './model';
import { bezierPt, segments, shapeSubs } from './geom';
import { fitPolyline } from './fit';

/** Clipper rechnet mit Ganzzahlen: 1 Einheit = 1 µm */
const SCALE = 1000;
/** Maximale Abweichung beim Zerlegen von Kurven in mm */
const FLATTEN_TOL = 0.01;
/** Größter Punktabstand beim Zerlegen von Kurven (mm); längere Strecken erkennt die Kurvenrückführung als Gerade */
const FLATTEN_MAX_STEP = 1;
/** Erlaubte Abweichung der eingepassten Bézierkurven vom Ergebnis (mm) */
const FIT_TOL = 0.02;

export type JoinStyle = 'round' | 'miter' | 'square';

type Path = ClipperLib.Path;
type Paths = ClipperLib.Paths;
const { Clipper, ClipType, PolyType, PolyFillType, ClipperOffset, JoinType, EndType } = ClipperLib;

function flattenSub(sp: SubPath, m: Mat): Path {
  const out: Path = [];
  const push = (p: Pt) => {
    const q = apply(m, p.x, p.y);
    const X = Math.round(q.x * SCALE),
      Y = Math.round(q.y * SCALE);
    const l = out[out.length - 1];
    if (!l || l.X !== X || l.Y !== Y) out.push({ X, Y });
  };
  if (sp.nodes.length) push(sp.nodes[0]);
  for (const s of segments(sp)) {
    if (!s.curve) {
      push(s.b);
      continue;
    }
    // Anzahl Teilstücke aus der Länge des Kontrollpolygons (in Weltkoordinaten)
    const w = [s.a, s.c1, s.c2, s.b].map((p) => apply(m, p.x, p.y));
    const len = Math.hypot(w[1].x - w[0].x, w[1].y - w[0].y) + Math.hypot(w[2].x - w[1].x, w[2].y - w[1].y) + Math.hypot(w[3].x - w[2].x, w[3].y - w[2].y);
    const n = Math.max(4, Math.min(2048, Math.max(Math.ceil(Math.sqrt(len / FLATTEN_TOL) * 0.6), Math.ceil(len / FLATTEN_MAX_STEP))));
    for (let i = 1; i <= n; i++) push(bezierPt(s.a, s.c1, s.c2, s.b, i / n));
  }
  if (sp.closed && out.length > 1) {
    const a = out[0],
      b = out[out.length - 1];
    if (a.X === b.X && a.Y === b.Y) out.pop();
  }
  return out;
}

/** Geschlossene und offene Konturen eines Objekts (inkl. Gruppen) in Weltkoordinaten. */
export function objectPaths(o: Obj): { closed: Paths; open: Paths } {
  const closed: Paths = [],
    open: Paths = [];
  for (const [leaf, m] of leaves([o])) {
    if (leaf.shape.kind === 'text' || leaf.shape.kind === 'image') continue;
    for (const sp of shapeSubs(leaf.shape)) {
      if (sp.nodes.length < 2) continue;
      (sp.closed ? closed : open).push(flattenSub(sp, m));
    }
  }
  return { closed, open };
}

function execute(type: ClipperLib.ClipType, subj: Paths, clip: Paths, fill: ClipperLib.PolyFillType): Paths {
  const c = new Clipper();
  c.AddPaths(subj, PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(clip, PolyType.ptClip, true);
  const out: Paths = [];
  c.Execute(type, out, fill, fill);
  return out;
}

/** Fläche eines Objekts: Löcher (z. B. in Buchstaben) nach Gerade-Ungerade-Regel. */
function region(o: Obj): Paths {
  return execute(ClipType.ctUnion, objectPaths(o).closed, [], PolyFillType.pftEvenOdd);
}

export function pathsToSubs(paths: Paths): SubPath[] {
  return Clipper.CleanPolygons(paths, 1)
    .filter((p) => p.length >= 3)
    .map((p) => fitPolyline(p.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE })), true, FIT_TOL));
}

export type BoolOp = 'union' | 'subtract' | 'intersect' | 'xor';

/** Welches Objekt die Basis ist: das zuerst gewählte, das hinterste (vordere werden abgezogen) oder das vorderste (hintere werden abgezogen). */
export type BoolBase = 'selection' | 'back' | 'front';

/**
 * Bringt die Auswahl in die Reihenfolge für booleanOp: die Basis zuerst, danach die übrigen.
 * `stack` ist die Stapelreihenfolge des Dokuments (hinten zuerst).
 */
export function orderForBoolean<T>(sel: T[], stack: T[], base: BoolBase): T[] {
  if (base === 'selection') return [...sel];
  const z = [...sel].sort((a, b) => stack.indexOf(a) - stack.indexOf(b));
  return base === 'back' ? z : z.reverse();
}

/**
 * Boolesche Verknüpfung. Das erste Objekt ist die Basis:
 * Vereinen verschmilzt alle, Abziehen entfernt alle weiteren von der Basis, Schnitt behält die gemeinsame Fläche.
 */
export function booleanOp(op: BoolOp, objs: Obj[]): SubPath[] {
  const regions = objs.map(region);
  let acc = regions[0];
  const type = { union: ClipType.ctUnion, subtract: ClipType.ctDifference, intersect: ClipType.ctIntersection, xor: ClipType.ctXor }[op];
  for (const r of regions.slice(1)) acc = execute(type, acc, r, PolyFillType.pftNonZero);
  return pathsToSubs(acc);
}

export interface OffsetOptions {
  /** Abstand in mm, immer positiv */
  distance: number;
  direction: 'outward' | 'inward' | 'both';
  join: JoinStyle;
}

/** Offset der Auswahl. Offene Linien werden zu einer geschlossenen Kontur im Abstand um die Linie. */
export function offsetOp(objs: Obj[], opt: OffsetOptions): SubPath[] {
  const join = opt.join === 'round' ? JoinType.jtRound : opt.join === 'miter' ? JoinType.jtMiter : JoinType.jtSquare;
  const d = opt.distance * SCALE;
  const closed: Paths = [],
    open: Paths = [];
  for (const o of objs) {
    const p = objectPaths(o);
    closed.push(...execute(ClipType.ctUnion, p.closed, [], PolyFillType.pftEvenOdd));
    open.push(...p.open);
  }
  // Bogentoleranz in µm
  const inflate = (paths: Paths, delta: number, end: ClipperLib.EndType) => {
    const co = new ClipperOffset(4, (FLATTEN_TOL / 4) * SCALE);
    co.AddPaths(paths, join, end);
    const out: Paths = [];
    co.Execute(out, delta);
    return out;
  };
  const result: Paths = [];
  if (closed.length) {
    if (opt.direction !== 'inward') result.push(...inflate(closed, d, EndType.etClosedPolygon));
    if (opt.direction !== 'outward') result.push(...inflate(closed, -d, EndType.etClosedPolygon));
  }
  if (open.length) result.push(...inflate(open, d, opt.join === 'round' ? EndType.etOpenRound : EndType.etOpenButt));
  return pathsToSubs(result);
}
