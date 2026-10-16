// Bézier-Grundlagen ohne weitere Abhängigkeiten (von Geometrie, Clipper-Anbindung und Text genutzt).
import { Node, Pt, SubPath } from './model';

export function bezierPt(a: Pt, c1: Pt, c2: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
  };
}

/** Segmente eines Unterpfads: [a, b, c1, c2, isCurve, indexA, indexB] */
export function segments(sp: SubPath) {
  const out: { a: Node; b: Node; c1: Pt; c2: Pt; curve: boolean; ia: number; ib: number }[] = [];
  const n = sp.nodes.length;
  const last = sp.closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = sp.nodes[i],
      b = sp.nodes[(i + 1) % n];
    out.push({ a, b, c1: a.cout ?? a, c2: b.cin ?? b, curve: !!(a.cout || b.cin), ia: i, ib: (i + 1) % n });
  }
  return out;
}
