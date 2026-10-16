// Geometrische Operationen mit Clipper (Angus Johnson, JS-Port): Boolesche Verknüpfungen und Offset.
// Kurven werden dafür fein in Linien zerlegt (Toleranz FLATTEN_TOL).
import ClipperLib from 'clipper-lib';
import { leaves, Obj, SubPath } from './model';
import { shapeSubs } from './geom';
import { execute, FLATTEN_TOL, flattenSub, Paths, pathsToSubs, SCALE } from './clip';

export { SCALE };

export type JoinStyle = 'round' | 'miter' | 'square';

const { ClipType, PolyFillType, ClipperOffset, JoinType, EndType } = ClipperLib;

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

/** Fläche eines Objekts: Löcher (z. B. in Buchstaben) nach Gerade-Ungerade-Regel. */
export function region(o: Obj): Paths {
  return execute(ClipType.ctUnion, objectPaths(o).closed, [], PolyFillType.pftEvenOdd);
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
