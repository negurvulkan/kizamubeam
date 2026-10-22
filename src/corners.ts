// Eckenwerkzeug: einzelne Ecken beliebiger Vektorformen runden, nach innen runden (Konkavbogen) oder fasen.
// Die angrenzenden Segmente werden exakt gekürzt (de Casteljau), die neue Ecke ist eine Bézierkurve bzw. Gerade.
// Bei Geraden ist die Rundung ein exakter Kreisbogen (Radius r), bei Kurven ein tangentenstetiger Übergang.
import { Node, Pt, SubPath } from './model';
import { bezierPt } from './curves';
import { piecesOf, Piece, subPiece } from './pathtools';

export type CornerMode = 'round' | 'inverse' | 'chamfer';

/** Knicke unter diesem Winkel gelten nicht als Ecke (Grad) */
const MIN_TURN = 0.5;
/** Umkehrpunkte (fast 180°) lassen sich nicht runden */
const MAX_TURN = 179.5;

const sub = (p: Pt, q: Pt): Pt => ({ x: p.x - q.x, y: p.y - q.y });
const dist = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y);
const unit = (v: Pt): Pt | null => {
  const l = Math.hypot(v.x, v.y);
  return l < 1e-9 ? null : { x: v.x / l, y: v.y / l };
};
const at = (p: Piece, t: number): Pt => (p.curve ? bezierPt(p.a, p.c1, p.c2, p.b, t) : { x: p.a.x + (p.b.x - p.a.x) * t, y: p.a.y + (p.b.y - p.a.y) * t });

/** Laufrichtung am Ende eines Stücks */
function endDir(p: Piece) {
  return unit(sub(p.b, p.c2)) ?? unit(sub(p.b, p.c1)) ?? unit(sub(p.b, p.a));
}
/** Laufrichtung am Anfang eines Stücks */
function startDir(p: Piece) {
  return unit(sub(p.c1, p.a)) ?? unit(sub(p.c2, p.a)) ?? unit(sub(p.b, p.a));
}

/** Knickwinkel am Knoten idx in Grad (0 = gerade weiter), null = kein Innenknoten */
export function turnAngle(sp: SubPath, idx: number): number | null {
  const ps = piecesOf(sp);
  const n = sp.nodes.length;
  if (idx < 0 || idx >= n) return null;
  if (!sp.closed && (idx === 0 || idx === n - 1)) return null;
  const pin = ps[(idx - 1 + ps.length) % ps.length],
    pout = ps[idx % ps.length];
  const d1 = endDir(pin),
    d2 = startDir(pout);
  if (!d1 || !d2) return null;
  return (Math.acos(Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y))) * 180) / Math.PI;
}

/** Ist der Knoten eine Ecke, die das Werkzeug bearbeiten kann? */
export function isCorner(sp: SubPath, idx: number): boolean {
  const a = turnAngle(sp, idx);
  return a !== null && a > MIN_TURN && a < MAX_TURN;
}

/**
 * Parameter t auf dem Stück, an dem der Abstand (Sehne) zum Eckpunkt c gleich len ist.
 * fromEnd: die Ecke liegt am Ende des Stücks (gesucht wird von t = 1 rückwärts bis tLim), sonst am Anfang (bis tLim).
 */
function paramAt(p: Piece, c: Pt, len: number, fromEnd: boolean, tLim: number): number {
  const N = 64;
  let prev = fromEnd ? 1 : 0;
  for (let i = 1; i <= N; i++) {
    const t = fromEnd ? 1 - ((1 - tLim) * i) / N : (tLim * i) / N;
    if (dist(at(p, t), c) >= len) {
      let lo = prev,
        hi = t;
      for (let k = 0; k < 40; k++) {
        const m = (lo + hi) / 2;
        if (dist(at(p, m), c) >= len) hi = m;
        else lo = m;
      }
      return hi;
    }
    prev = t;
  }
  return tLim;
}

/** Größter Sehnenabstand zum Eckpunkt bis zur Grenze tLim (so weit darf die Ecke höchstens ins Segment reichen) */
function maxReach(p: Piece, c: Pt, fromEnd: boolean, tLim: number) {
  let m = 0;
  for (let i = 1; i <= 64; i++) {
    const t = fromEnd ? 1 - ((1 - tLim) * i) / 64 : (tLim * i) / 64;
    m = Math.max(m, dist(at(p, t), c));
  }
  return m;
}

export interface CornerResult {
  sub: SubPath;
  /** bearbeitete Ecken */
  done: number;
  /** davon mit kleinerem Radius, weil die Segmente zu kurz sind */
  limited: number;
}

/**
 * Ecken an den Knoten idxs runden ('round', Radius r), nach innen runden ('inverse', Bogen um die Ecke mit Radius r)
 * oder fasen ('chamfer', Abstand r von der Ecke entlang beider Kanten). Knoten, die keine Ecke sind, bleiben.
 * Liefert einen neuen Unterpfad; die Eingabe bleibt unverändert.
 */
export function cornerSub(sp: SubPath, idxs: number[], mode: CornerMode, r: number): CornerResult {
  const n = sp.nodes.length;
  const targets = new Set(idxs.filter((i) => isCorner(sp, i)));
  if (!targets.size || !(r > 0)) return { sub: sp, done: 0, limited: 0 };
  const ps = piecesOf(sp);
  const m = ps.length;
  // Kürzung je Segment: Anfang t0 (Ecke am Anfangsknoten), Ende t1 (Ecke am Endknoten)
  const t0 = ps.map(() => 0),
    t1 = ps.map(() => 1);
  const arcs = new Map<number, Piece>();
  let limited = 0;
  for (const i of targets) {
    const ki = (i - 1 + m) % m, // Segment, das an der Ecke endet
      ko = i % m; // Segment, das an der Ecke beginnt
    const pin = ps[ki],
      pout = ps[ko];
    const c: Pt = sp.nodes[i];
    // Grenzt das Segment an eine zweite bearbeitete Ecke, darf jede höchstens die Hälfte nehmen
    const limIn = targets.has(ki) && ki !== i ? 0.5 : 0,
      limOut = targets.has((ko + 1) % n) && (ko + 1) % n !== i ? 0.5 : 1;
    const turn = ((turnAngle(sp, i) as number) * Math.PI) / 180;
    const want = mode === 'round' ? r * Math.tan(turn / 2) : r;
    const len = Math.min(want, maxReach(pin, c, true, limIn), maxReach(pout, c, false, limOut));
    if (len < want - 1e-6) limited++;
    if (len < 1e-6) continue;
    const ta = paramAt(pin, c, len, true, limIn),
      tb = paramAt(pout, c, len, false, limOut);
    t1[ki] = ta;
    t0[ko] = tb;
    const p1 = at(pin, ta),
      p2 = at(pout, tb);
    let arc: Piece;
    if (mode === 'chamfer') arc = { a: p1, c1: p1, c2: p2, b: p2, curve: false };
    else if (mode === 'round') {
      // tangentenstetiger Bogen; bei Geraden exakt der Kreisbogen mit Radius r
      const d1 = endDir(subPiece(pin, 0, ta)) ?? startDir(pin)!,
        d2 = startDir(subPiece(pout, tb, 1)) ?? endDir(pout)!;
      const phi = Math.acos(Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y)));
      const h = dist(p1, p2) / (3 * Math.cos(phi / 4) ** 2);
      arc = { a: p1, c1: { x: p1.x + d1.x * h, y: p1.y + d1.y * h }, c2: { x: p2.x - d2.x * h, y: p2.y - d2.y * h }, b: p2, curve: true };
    } else {
      // Kreisbogen um die Ecke (Mittelpunkt c, Radius len), kürzester Weg von p1 nach p2
      const a1 = Math.atan2(p1.y - c.y, p1.x - c.x);
      let da = Math.atan2(p2.y - c.y, p2.x - c.x) - a1;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const k = (4 / 3) * Math.tan(da / 4) * len;
      const a2 = a1 + da;
      arc = {
        a: p1, b: p2, curve: true,
        c1: { x: p1.x - k * Math.sin(a1), y: p1.y + k * Math.cos(a1) },
        c2: { x: p2.x + k * Math.sin(a2), y: p2.y - k * Math.cos(a2) },
      };
    }
    arcs.set(i, arc);
  }
  if (!arcs.size) return { sub: sp, done: 0, limited };

  // Neue Stückfolge: je Knoten erst der Eckbogen, dann das gekürzte Segment
  const out: Piece[] = [];
  for (let i = 0; i < n; i++) {
    const arc = arcs.get(i);
    if (arc) out.push(arc);
    if (i < m) {
      const q = t0[i] === 0 && t1[i] === 1 ? ps[i] : subPiece(ps[i], t0[i], t1[i]);
      if (dist(q.a, q.b) > 1e-6 || (q.curve && (dist(q.a, q.c1) > 1e-6 || dist(q.b, q.c2) > 1e-6))) out.push(q);
    }
  }

  // Stücke zu Knoten zusammensetzen; unveränderte Knoten behalten ihre Glättung
  const smoothAt = new Map<string, boolean>();
  sp.nodes.forEach((nd, i) => nd.smooth && !targets.has(i) && smoothAt.set(`${nd.x},${nd.y}`, true));
  const nodes: Node[] = [];
  out.forEach((q, k) => {
    const nd: Node = { x: q.a.x, y: q.a.y };
    if (q.curve) nd.cout = { x: q.c1.x, y: q.c1.y };
    const prev = k > 0 ? out[k - 1] : sp.closed ? out[out.length - 1] : null;
    if (prev?.curve) nd.cin = { x: prev.c2.x, y: prev.c2.y };
    if (smoothAt.get(`${nd.x},${nd.y}`)) nd.smooth = true;
    nodes.push(nd);
  });
  if (!sp.closed && out.length) {
    const q = out[out.length - 1];
    const nd: Node = { x: q.b.x, y: q.b.y };
    if (q.curve) nd.cin = { x: q.c2.x, y: q.c2.y };
    nodes.push(nd);
  }
  const res: SubPath = { closed: sp.closed, nodes };
  if (sp.start) res.start = true;
  return { sub: res, done: arcs.size, limited };
}
