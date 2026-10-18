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

/**
 * Fläche eines Objekts. Innerhalb eines Pfads gilt die Gerade-Ungerade-Regel (Löcher wie in Buchstaben),
 * die Teile einer Gruppe werden danach vereint: überlappende Formen in einer Gruppe ergeben kein Loch.
 */
export function region(o: Obj): Paths {
  const parts: Paths = [];
  let n = 0;
  for (const [leaf, m] of leaves([o])) {
    if (leaf.shape.kind === 'text' || leaf.shape.kind === 'image') continue;
    const own = shapeSubs(leaf.shape)
      .filter((sp) => sp.closed && sp.nodes.length > 1)
      .map((sp) => flattenSub(sp, m));
    if (!own.length) continue;
    parts.push(...execute(ClipType.ctUnion, own, [], PolyFillType.pftEvenOdd));
    n++;
  }
  return n > 1 ? execute(ClipType.ctUnion, parts, [], PolyFillType.pftNonZero) : parts;
}

/** Anzahl geschlossener Konturen. Ohne sie hat ein Objekt keine Fläche (offene Linien nehmen an Booleschen Operationen nicht teil). */
export function closedCount(o: Obj): number {
  return objectPaths(o).closed.length;
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
  return pathsToSubs(dropSlivers(acc));
}

/** Breite (mm), unter der Reste beim Verrechnen nur Rundungsfehler sind */
const SLIVER = FLATTEN_TOL;

/**
 * Haarfeine Reste entfernen (morphologisches Öffnen: kurz schrumpfen, dann wieder wachsen).
 * Liegen Kanten zweier Formen aufeinander, aber ihre Kurven wurden verschieden zerlegt (z. B. gedrehte Kreise),
 * bleiben sonst hauchdünne Splitter übrig, die der Laser als eigene Linien schneiden würde.
 */
export function dropSlivers(paths: Paths): Paths {
  if (!paths.length) return paths;
  const run = (p: Paths, delta: number) => {
    const co = new ClipperOffset(4, (FLATTEN_TOL / 4) * SCALE);
    co.AddPaths(p, JoinType.jtMiter, EndType.etClosedPolygon);
    const out: Paths = [];
    co.Execute(out, delta);
    return out;
  };
  return ClipperLib.Clipper.CleanPolygons(run(run(paths, -SLIVER * SCALE), SLIVER * SCALE), (SLIVER / 2) * SCALE);
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
    closed.push(...region(o));
    open.push(...objectPaths(o).open);
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
