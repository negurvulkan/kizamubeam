// Verformen (Warp): Formen, Texte und Bilder biegen, wölben oder perspektivisch verzerren.
// Die Verformung wirkt auf den gemeinsamen Rahmen der Auswahl. Vektoren bleiben Bézierkurven: Jedes Segment wird
// abgebildet und als kubische Kurve mit den abgebildeten Tangenten eingepasst; weicht es mehr als die Toleranz ab,
// wird es geteilt. Die Knoten des Originals (und damit seine Ecken) bleiben erhalten.
import { Node, Pt, SubPath } from './model';
import { bezierPt, segments } from './curves';
import type { Box } from './geom';

export type WarpKind = 'arc' | 'arcUpper' | 'arcLower' | 'bulge' | 'flag' | 'perspective';
export const WARP_KINDS: WarpKind[] = ['arc', 'arcUpper', 'arcLower', 'bulge', 'flag', 'perspective'];

export interface WarpOptions {
  kind: WarpKind;
  /** Stärke in % (-100 … 100); negativ biegt in die andere Richtung */
  amount: number;
  /** Senkrecht: die Verformung wirkt um 90° gedreht (z. B. Bogen nach links/rechts statt nach oben/unten) */
  vertical: boolean;
}

/** Größte Abweichung der Bézier-Ausgabe vom exakt verformten Verlauf in mm */
export const WARP_TOL = 0.02;
const MAX_DEPTH = 10;

/** Abbildung eines Punkts (Weltkoordinaten in mm) für den Rahmen box */
export function warpFn(opt: WarpOptions, box: Box): (p: Pt) => Pt {
  const a = Math.max(-1, Math.min(1, opt.amount / 100));
  if (!a || box.w <= 0 || box.h <= 0) return (p) => ({ x: p.x, y: p.y });
  // Senkrecht: x und y tauschen, waagerecht rechnen, zurücktauschen (ein Bogen nach rechts statt nach oben)
  const f = horizontal(opt.kind, opt.vertical ? -a : a, opt.vertical ? { x: box.y, y: box.x, w: box.h, h: box.w } : box);
  if (!opt.vertical) return f;
  return (p) => {
    const q = f({ x: p.y, y: p.x });
    return { x: q.y, y: q.x };
  };
}

function horizontal(kind: WarpKind, a: number, b: Box): (p: Pt) => Pt {
  const cx = b.x + b.w / 2,
    cy = b.y + b.h / 2;
  // u: -1 … 1 von links nach rechts; v: 0 oben … 1 unten (y zeigt nach unten)
  const U = (x: number) => (x - cx) / (b.w / 2);
  const V = (y: number) => (y - b.y) / b.h;
  switch (kind) {
    case 'arc': {
      // Waagerechte Linien werden zu konzentrischen Bögen, bei 100 % zum Halbkreis; die Mittellinie behält ihre Länge
      const th = a * Math.PI;
      const R = b.w / th;
      return (p) => {
        const phi = ((p.x - cx) / b.w) * th;
        const r = R + (cy - p.y);
        return { x: cx + r * Math.sin(phi), y: cy + R - r * Math.cos(phi) };
      };
    }
    case 'arcUpper':
    case 'arcLower': {
      // Nur die obere (untere) Kante wölbt sich, die gegenüberliegende bleibt gerade
      const d = a * b.h * 0.5;
      const upper = kind === 'arcUpper';
      return (p) => {
        const u = U(p.x),
          v = V(p.y);
        return { x: p.x, y: p.y - d * (1 - u * u) * (upper ? 1 - v : v) * (upper ? 1 : -1) };
      };
    }
    case 'bulge': {
      // Obere und untere Kante wölben sich nach außen (negativ: nach innen)
      const k = a * 0.5;
      return (p) => {
        const u = U(p.x);
        return { x: p.x, y: cy + (p.y - cy) * (1 + k * (1 - u * u)) };
      };
    }
    case 'flag': {
      // Eine volle Welle über die Breite, alle Zeilen gleich verschoben
      const amp = a * b.h * 0.25;
      return (p) => ({ x: p.x, y: p.y - amp * Math.sin(((p.x - b.x) / b.w) * Math.PI * 2) });
    }
    case 'perspective': {
      // Echte Fluchtpunkt-Perspektive (Projektion): die obere Kante wird schmaler, bei negativer Stärke die untere
      const s = 1 - Math.abs(a) * 0.9;
      const top = a > 0 ? s : 1,
        bot = a > 0 ? 1 : s;
      const H = homography([
        { x: cx - (b.w / 2) * top, y: b.y },
        { x: cx + (b.w / 2) * top, y: b.y },
        { x: cx + (b.w / 2) * bot, y: b.y + b.h },
        { x: cx - (b.w / 2) * bot, y: b.y + b.h },
      ]);
      return (p) => H((p.x - b.x) / b.w, (p.y - b.y) / b.h);
    }
  }
}

/** Projektive Abbildung des Einheitsquadrats auf ein Viereck (Ecken oben links, oben rechts, unten rechts, unten links) */
export function homography(q: [Pt, Pt, Pt, Pt]): (u: number, v: number) => Pt {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x,
    dx2 = p3.x - p2.x,
    dy1 = p1.y - p2.y,
    dy2 = p3.y - p2.y;
  const sx = p0.x - p1.x + p2.x - p3.x,
    sy = p0.y - p1.y + p2.y - p3.y;
  const det = dx1 * dy2 - dx2 * dy1 || 1e-12;
  const g = (sx * dy2 - dx2 * sy) / det,
    h = (dx1 * sy - sx * dy1) / det;
  const A = p1.x - p0.x + g * p1.x,
    B = p3.x - p0.x + h * p3.x,
    D = p1.y - p0.y + g * p1.y,
    E = p3.y - p0.y + h * p3.y;
  return (u, v) => {
    const w = g * u + h * v + 1;
    return { x: (A * u + B * v + p0.x) / w, y: (D * u + E * v + p0.y) / w };
  };
}

type Cubic = [Pt, Pt, Pt, Pt];

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Kubische Kurve bei t teilen (de Casteljau) */
function split(c: Cubic, t: number): [Cubic, Cubic] {
  const [a, b, cc, d] = c;
  const ab = lerp(a, b, t),
    bc = lerp(b, cc, t),
    cd = lerp(cc, d, t);
  const abc = lerp(ab, bc, t),
    bcd = lerp(bc, cd, t);
  const m = lerp(abc, bcd, t);
  return [
    [a, ab, abc, m],
    [m, bcd, cd, d],
  ];
}

function deriv(c: Cubic, t: number): Pt {
  const [a, b, cc, d] = c;
  const u = 1 - t;
  return {
    x: 3 * u * u * (b.x - a.x) + 6 * u * t * (cc.x - b.x) + 3 * t * t * (d.x - cc.x),
    y: 3 * u * u * (b.y - a.y) + 6 * u * t * (cc.y - b.y) + 3 * t * t * (d.y - cc.y),
  };
}

function distToPolyline(p: Pt, poly: Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1],
      b = poly[i];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
}

const SAMPLES = 16;

/**
 * Ein Segment (als kubische Kurve; Geraden mit Anfassern auf den Endpunkten) abbilden. Ergebnis: Kurvenstücke,
 * null an einer Stelle bedeutet „gerade Linie“.
 */
function warpSegment(c: Cubic, line: boolean, f: (p: Pt) => Pt, eps: number, tol: number, depth: number, out: (Cubic | [Pt, null])[]) {
  const p0 = f(c[0]),
    p3 = f(c[3]);
  const exact: Pt[] = [p0];
  for (let i = 1; i < SAMPLES; i++) exact.push(f(bezierPt(c[0], c[1], c[2], c[3], i / SAMPLES)));
  exact.push(p3);
  // Bleibt eine Gerade gerade (z. B. bei der Perspektive), bleibt sie eine Linie ohne Anfasser
  if (line && exact.every((p) => distToPolyline(p, [p0, p3]) <= tol)) return void out.push([p3, null]);
  // Tangenten der Abbildung: Richtungsableitung entlang der Kurve, numerisch
  const tangent = (t: number) => {
    const p = bezierPt(c[0], c[1], c[2], c[3], t);
    const d = deriv(c, t);
    const l = Math.hypot(d.x, d.y);
    if (l < 1e-12) return { x: 0, y: 0 };
    const e = eps / l;
    const a = f({ x: p.x - d.x * e, y: p.y - d.y * e }),
      b = f({ x: p.x + d.x * e, y: p.y + d.y * e });
    return { x: (b.x - a.x) / (2 * e), y: (b.y - a.y) / (2 * e) };
  };
  const d0 = tangent(0),
    d1 = tangent(1);
  const fit: Cubic = [p0, { x: p0.x + d0.x / 3, y: p0.y + d0.y / 3 }, { x: p3.x - d1.x / 3, y: p3.y - d1.y / 3 }, p3];
  if (depth < MAX_DEPTH) {
    const approx: Pt[] = [];
    for (let i = 0; i <= SAMPLES * 4; i++) approx.push(bezierPt(fit[0], fit[1], fit[2], fit[3], i / (SAMPLES * 4)));
    // Gleicher Parameter auf beiden Seiten als grobe Schranke gegen Schleifen, sonst der kürzeste Abstand
    const mid = bezierPt(fit[0], fit[1], fit[2], fit[3], 0.5);
    const bad = exact.some((p) => distToPolyline(p, approx) > tol) || Math.hypot(mid.x - exact[SAMPLES / 2].x, mid.y - exact[SAMPLES / 2].y) > tol * 50;
    if (bad) {
      const [l, r] = split(c, 0.5);
      warpSegment(l, false, f, eps, tol, depth + 1, out);
      warpSegment(r, false, f, eps, tol, depth + 1, out);
      return;
    }
  }
  out.push(fit);
}

/** Unterpfade (Weltkoordinaten) verformen; das Ergebnis besteht aus Linien und Bézierkurven */
export function warpSubs(subs: SubPath[], f: (p: Pt) => Pt, box: Box, tol = WARP_TOL): SubPath[] {
  const eps = Math.max(box.w, box.h, 1) * 1e-5;
  return subs.map((sp): SubPath => {
    if (!sp.nodes.length) return { closed: sp.closed, nodes: [] };
    const first: Node = { ...f(sp.nodes[0]), ...(sp.nodes[0].smooth ? { smooth: true } : {}) };
    const nodes: Node[] = [first];
    const segs = segments(sp);
    segs.forEach((g, si) => {
      const pieces: (Cubic | [Pt, null])[] = [];
      warpSegment([g.a, g.c1, g.c2, g.b], !g.curve, f, eps, tol, 0, pieces);
      const closing = sp.closed && si === segs.length - 1;
      pieces.forEach((pc, i) => {
        const last = i === pieces.length - 1;
        const prev = nodes[nodes.length - 1];
        if (pc[1] !== null) prev.cout = pc[1];
        if (last && closing) {
          if (pc[1] !== null) first.cin = (pc as Cubic)[2];
          return;
        }
        const end = pc[1] === null ? pc[0] : (pc as Cubic)[3];
        const n: Node = { x: end.x, y: end.y };
        if (pc[1] !== null) n.cin = (pc as Cubic)[2];
        // Neue Teilungspunkte liegen auf einer glatten Kurve, Originalknoten behalten ihre Art
        if (!last || g.b.smooth) n.smooth = true;
        nodes.push(n);
      });
    });
    return { closed: sp.closed, nodes, ...(sp.start ? { start: true } : {}) };
  });
}

/** Rahmen von Unterpfaden mit abgetasteten Kurven (enger als die Anfasser) */
export function subsBox(subs: SubPath[]): Box | null {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const add = (p: Pt) => {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  };
  for (const sp of subs) {
    if (sp.nodes.length) add(sp.nodes[0]);
    for (const g of segments(sp)) {
      if (!g.curve) add(g.b);
      else for (let i = 1; i <= 16; i++) add(bezierPt(g.a, g.c1, g.c2, g.b, i / 16));
    }
  }
  return x0 <= x1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Größte Abweichung zwischen verformten Unterpfaden und dem exakt verformten Original (für Tests) */
export function warpError(orig: SubPath[], warped: SubPath[], f: (p: Pt) => Pt): number {
  const poly = (sp: SubPath, n: number): Pt[] => {
    const pts: Pt[] = sp.nodes.length ? [sp.nodes[0]] : [];
    for (const g of segments(sp)) for (let i = 1; i <= n; i++) pts.push(bezierPt(g.a, g.c1, g.c2, g.b, i / n));
    return pts;
  };
  let worst = 0;
  orig.forEach((sp, i) => {
    const exact = poly(sp, 400).map(f);
    const got = poly(warped[i], 128);
    for (let k = 0; k < exact.length; k += 7) worst = Math.max(worst, distToPolyline(exact[k], got));
    for (let k = 0; k < got.length; k += 5) worst = Math.max(worst, distToPolyline(got[k], exact));
  });
  return worst;
}
