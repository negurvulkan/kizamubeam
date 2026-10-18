// Geometrische Operationen mit Clipper (Angus Johnson, JS-Port): Boolesche Verknüpfungen und Offset.
// Kurven werden dafür fein in Linien zerlegt (Toleranz FLATTEN_TOL).
import ClipperLib from 'clipper-lib';
import { apply, IDENT, leaves, Mat, Node, Obj, Pt, SubPath } from './model';
import { shapeSubs } from './geom';
import { execute, FLATTEN_TOL, flattenSub, Paths, pathsToSubs, SCALE } from './clip';
import { extract, nearestParam, piecesOf } from './pathtools';

export { SCALE };

export type JoinStyle = 'round' | 'miter' | 'square';

const { Clipper, ClipType, PolyType, PolyFillType, PolyTree, ClipperOffset, JoinType, EndType } = ClipperLib;

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
 * Offene Linien (z. B. Biegeschnitte) der Basis und der Objekte in `lines` werden beim Abziehen an den Flächen
 * der abgezogenen Formen gekürzt, beim Schnitt auf die gemeinsame Fläche beschränkt. Ist neben `lines` nur eine
 * Fläche gewählt, ist sie selbst die abgezogene bzw. begrenzende Form. Beim Vereinen bleiben offene Linien unverändert.
 * Die Linien behalten ihre Geraden und Bézierkurven, nur die Enden liegen neu auf dem Rand.
 */
export function booleanOp(op: BoolOp, objs: Obj[], lines: Obj[] = []): SubPath[] {
  const regions = objs.map(region);
  if (op === 'union' || op === 'xor') {
    let acc = regions[0];
    for (const r of regions.slice(1)) acc = execute(op === 'union' ? ClipType.ctUnion : ClipType.ctXor, acc, r, PolyFillType.pftNonZero);
    return [...pathsToSubs(dropSlivers(acc)), ...objs.flatMap(openSubs)];
  }
  // Nur Linien und eine Fläche: die Fläche schneidet die Linien
  const onlyLines = objs.length === 1 && lines.length > 0;
  const lineSrc = onlyLines ? lines : [objs[0], ...lines];
  let closed: Paths = [];
  let open: SubPath[];
  if (op === 'subtract') {
    const cutters = onlyLines ? regions : regions.slice(1);
    if (!onlyLines) {
      closed = regions[0];
      for (const r of cutters) closed = execute(ClipType.ctDifference, closed, r, PolyFillType.pftNonZero);
    }
    open = lineSrc.flatMap((o) => clipOpen(o, cutters.flat(), false));
  } else {
    let common = regions[0];
    for (const r of regions.slice(1)) common = execute(ClipType.ctIntersection, common, r, PolyFillType.pftNonZero);
    if (!onlyLines) closed = common;
    open = lineSrc.flatMap((o) => clipOpen(o, common, true));
  }
  return [...pathsToSubs(dropSlivers(closed)), ...open];
}

/** Offene Unterpfade eines Objekts (inkl. Gruppen) in Weltkoordinaten */
export function openSubs(o: Obj): SubPath[] {
  const out: SubPath[] = [];
  for (const [leaf, m] of leaves([o])) {
    if (leaf.shape.kind === 'text' || leaf.shape.kind === 'image') continue;
    for (const sp of shapeSubs(leaf.shape)) if (!sp.closed && sp.nodes.length > 1) out.push(mapSub(sp, m));
  }
  return out;
}

function mapSub(sp: SubPath, m: Mat): SubPath {
  const q = (p: Pt) => apply(m, p.x, p.y);
  return {
    closed: sp.closed,
    nodes: sp.nodes.map((n) => {
      const r: Node = q(n);
      if (n.cin) r.cin = q(n.cin);
      if (n.cout) r.cout = q(n.cout);
      if (n.smooth) r.smooth = true;
      return r;
    }),
  };
}

/**
 * Offene Linien eines Objekts an einer Fläche kürzen: inside = nur die Stücke in der Fläche behalten, sonst nur die außerhalb.
 * Clipper liefert die Schnittstellen am zerlegten Linienzug; das Stück wird dann aus der Originalkurve herausgeschnitten.
 */
function clipOpen(o: Obj, area: Paths, inside: boolean): SubPath[] {
  const subs = openSubs(o);
  if (!area.length) return inside ? [] : subs;
  const out: SubPath[] = [];
  for (const sp of subs) {
    const c = new Clipper();
    c.AddPath(flattenSub(sp, IDENT), PolyType.ptSubject, false);
    c.AddPaths(area, PolyType.ptClip, true);
    const tree = new PolyTree();
    c.Execute(inside ? ClipType.ctIntersection : ClipType.ctDifference, tree, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
    const n = piecesOf(sp).length;
    const parts = Clipper.OpenPathsFromPolyTree(tree)
      .filter((p) => p.length > 1)
      .map((p) => {
        const end = (q: ClipperLib.IntPoint) => nearestParam(sp, { x: q.X / SCALE, y: q.Y / SCALE }).u;
        const a = end(p[0]),
          b = end(p[p.length - 1]);
        return [Math.min(a, b), Math.max(a, b)];
      })
      .sort((x, y) => x[0] - y[0]);
    // Stücke, die an derselben Stelle aneinanderstoßen, zusammenfassen
    const spans: number[][] = [];
    for (const [a, b] of parts) {
      const l = spans[spans.length - 1];
      if (l && a <= l[1] + 1e-6) l[1] = Math.max(l[1], b);
      else spans.push([a, b]);
    }
    for (const [a, b] of spans) {
      if (b - a < 1e-6) continue;
      out.push(a < 1e-6 && b > n - 1e-6 ? sp : extract(sp, a, b));
    }
  }
  return out;
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
