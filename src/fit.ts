// Kurvenrückführung: Linienzüge (z. B. aus Clipper) wieder in Bézierpfade umwandeln.
// Ecken und lange gerade Stücke bleiben erhalten, dazwischen werden kubische Béziers eingepasst
// (Verfahren nach P. J. Schneider, „An Algorithm for Automatically Fitting Digitized Curves“, Graphics Gems 1990).
import { Node, Pt, SubPath } from './model';

/** Ab diesem Knickwinkel (Grad) gilt ein Punkt als Ecke */
const CORNER_DEG = 35;
/** Strecken ab dieser Länge (mm) gelten immer als gerade Linie */
const LINE_MIN = 1.5;
/** Längere Strecken werden zum Prüfen der Abweichung unterteilt (mm) */
const RESAMPLE = 0.5;

type V = Pt;
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y });
const mulS = (a: V, s: number): V => ({ x: a.x * s, y: a.y * s });
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y;
const len = (a: V) => Math.hypot(a.x, a.y);
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y);
const norm = (a: V): V => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};

type Cubic = [V, V, V, V];

/**
 * Linienzug in Bézier-Unterpfad umwandeln.
 * @param tol maximale Abweichung in mm
 * @param opt lineMin: ab dieser Länge ist eine Strecke immer gerade; cornerDeg: Knickwinkel für Ecken
 */
export function fitPolyline(input: Pt[], closed: boolean, tol: number, opt: { lineMin?: number; cornerDeg?: number } = {}): SubPath {
  const lineMin = opt.lineMin ?? LINE_MIN,
    cornerDeg = opt.cornerDeg ?? CORNER_DEG;
  // doppelte Punkte entfernen
  const pts: V[] = [];
  for (const p of input) if (!pts.length || dist(p, pts[pts.length - 1]) > 1e-6) pts.push({ x: p.x, y: p.y });
  if (closed && pts.length > 1 && dist(pts[0], pts[pts.length - 1]) < 1e-6) pts.pop();
  const n = pts.length;
  if (n < 3) return { closed, nodes: pts.map((p) => ({ ...p })) };

  const at = (i: number) => pts[((i % n) + n) % n];
  const segCount = closed ? n : n - 1;
  const segLen = (i: number) => dist(at(i), at(i + 1));

  // Gerade Strecken erkennen
  const isLine: boolean[] = [];
  for (let i = 0; i < segCount; i++) {
    isLine.push(segLen(i) >= lineMin);
  }
  // Ecken und Bruchstellen mit vorgegebener Tangente
  const corner: boolean[] = [];
  const brk: boolean[] = [];
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) {
      corner.push(true);
      brk.push(true);
      continue;
    }
    const a = norm(sub(at(i), at(i - 1))),
      b = norm(sub(at(i + 1), at(i)));
    const ang = (Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180) / Math.PI;
    const c = ang > cornerDeg;
    corner.push(c);
    const lineAdj = isLine[i] || isLine[(i - 1 + segCount) % segCount];
    brk.push(c || lineAdj);
  }

  // Tangente an einer Bruchstelle in Laufrichtung (out) bzw. gegen die Laufrichtung (in)
  const tangentOut = (i: number): V => {
    if (corner[i] || isLine[i % segCount]) return norm(sub(at(i + 1), at(i)));
    if (!closed && i === 0) return norm(sub(at(1), at(0)));
    // glatte Stelle neben einer Geraden: Richtung der Geraden übernehmen
    const prevIdx = (i - 1 + segCount) % segCount;
    if (isLine[prevIdx]) return norm(sub(at(i), at(i - 1)));
    return norm(sub(at(i + 1), at(i - 1)));
  };
  const tangentIn = (i: number): V => {
    const prevIdx = (i - 1 + segCount) % segCount;
    if (corner[i] || isLine[prevIdx]) return norm(sub(at(i - 1), at(i)));
    if (isLine[i % segCount]) return norm(sub(at(i), at(i + 1)));
    return norm(sub(at(i - 1), at(i + 1)));
  };

  let breaks = [...Array(n).keys()].filter((i) => brk[i]);
  if (!breaks.length) breaks = [0]; // geschlossene glatte Kurve (z. B. Kreis)

  const cubics: { c: Cubic; line: boolean }[] = [];
  const runs = closed ? breaks.length : breaks.length - 1;
  for (let r = 0; r < runs; r++) {
    const s = breaks[r];
    let e = breaks[(r + 1) % breaks.length];
    if (e <= s) e += n;
    const runPts: V[] = [];
    for (let i = s; i <= e; i++) runPts.push(at(i));
    if (runPts.length === 2 && isLine[s % segCount]) {
      cubics.push({ c: [runPts[0], runPts[0], runPts[1], runPts[1]], line: true });
      continue;
    }
    const dense = resample(runPts);
    const out: Cubic[] = [];
    fitCubic(dense, 0, dense.length - 1, tangentOut(s % n), tangentIn(e % n), tol * tol, out);
    out.forEach((c) => cubics.push({ c, line: isStraight(c, tol) }));
  }

  // Knoten aufbauen
  const nodes: Node[] = [];
  cubics.forEach(({ c, line }, k) => {
    const isFirst = k === 0;
    let node: Node;
    if (isFirst) {
      node = { x: c[0].x, y: c[0].y };
      nodes.push(node);
    } else node = nodes[nodes.length - 1];
    if (!line) node.cout = { ...c[1] };
    const last = k === cubics.length - 1;
    if (closed && last) {
      if (!line) nodes[0].cin = { ...c[2] };
    } else {
      const nx: Node = { x: c[3].x, y: c[3].y };
      if (!line) nx.cin = { ...c[2] };
      nodes.push(nx);
    }
  });
  // Glatte Übergänge markieren, damit der Knoteneditor die Anfasser gespiegelt hält
  for (const nd of nodes) {
    const a = nd.cin ? norm(sub(nd, nd.cin)) : null;
    const b = nd.cout ? norm(sub(nd.cout, nd)) : null;
    if (a && b && dot(a, b) > 0.999) nd.smooth = true;
  }
  return { closed, nodes };
}

function resample(p: V[]): V[] {
  const out: V[] = [p[0]];
  for (let i = 1; i < p.length; i++) {
    const l = dist(p[i - 1], p[i]);
    const k = Math.ceil(l / RESAMPLE);
    for (let j = 1; j < k; j++) out.push(add(p[i - 1], mulS(sub(p[i], p[i - 1]), j / k)));
    out.push(p[i]);
  }
  return out;
}

function isStraight(c: Cubic, tol: number): boolean {
  const d = sub(c[3], c[0]);
  const L = len(d);
  if (L < 1e-9) return false;
  const u = mulS(d, 1 / L);
  const off = (p: V) => Math.abs((p.x - c[0].x) * u.y - (p.y - c[0].y) * u.x);
  const along = (p: V) => dot(sub(p, c[0]), u);
  return off(c[1]) < tol && off(c[2]) < tol && along(c[1]) >= -tol && along(c[2]) <= L + tol;
}

// ---------- Schneider ----------

function bez(c: Cubic, t: number): V {
  const u = 1 - t;
  return add(add(mulS(c[0], u * u * u), mulS(c[1], 3 * u * u * t)), add(mulS(c[2], 3 * u * t * t), mulS(c[3], t * t * t)));
}
function bezD1(c: Cubic, t: number): V {
  const u = 1 - t;
  return add(add(mulS(sub(c[1], c[0]), 3 * u * u), mulS(sub(c[2], c[1]), 6 * u * t)), mulS(sub(c[3], c[2]), 3 * t * t));
}
function bezD2(c: Cubic, t: number): V {
  return add(mulS(add(sub(c[2], mulS(c[1], 2)), c[0]), 6 * (1 - t)), mulS(add(sub(c[3], mulS(c[2], 2)), c[1]), 6 * t));
}

function fitCubic(d: V[], first: number, last: number, t1: V, t2: V, err2: number, out: Cubic[], depth = 0) {
  const nPts = last - first + 1;
  if (nPts === 2) {
    const l = dist(d[first], d[last]) / 3;
    out.push([d[first], add(d[first], mulS(t1, l)), add(d[last], mulS(t2, l)), d[last]]);
    return;
  }
  let u = chordParams(d, first, last);
  let c = generate(d, first, last, u, t1, t2);
  let [maxE, split] = maxError(d, first, last, c, u);
  if (maxE < err2) {
    out.push(c);
    return;
  }
  if (maxE < err2 * 16) {
    for (let i = 0; i < 6; i++) {
      u = reparam(d, first, u, c);
      c = generate(d, first, last, u, t1, t2);
      [maxE, split] = maxError(d, first, last, c, u);
      if (maxE < err2) {
        out.push(c);
        return;
      }
    }
  }
  if (depth > 40) {
    out.push(c);
    return;
  }
  split = Math.max(first + 1, Math.min(last - 1, split));
  const tc = norm(sub(d[split - 1], d[split + 1]));
  fitCubic(d, first, split, t1, tc, err2, out, depth + 1);
  fitCubic(d, split, last, mulS(tc, -1), t2, err2, out, depth + 1);
}

function chordParams(d: V[], first: number, last: number): number[] {
  const u = [0];
  for (let i = first + 1; i <= last; i++) u.push(u[u.length - 1] + dist(d[i], d[i - 1]));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

function generate(d: V[], first: number, last: number, u: number[], t1: V, t2: V): Cubic {
  const p0 = d[first],
    p3 = d[last];
  const C = [
    [0, 0],
    [0, 0],
  ];
  const X = [0, 0];
  for (let i = 0; i < u.length; i++) {
    const t = u[i],
      s = 1 - t;
    const b1 = 3 * t * s * s,
      b2 = 3 * t * t * s;
    const A1 = mulS(t1, b1),
      A2 = mulS(t2, b2);
    C[0][0] += dot(A1, A1);
    C[0][1] += dot(A1, A2);
    C[1][1] += dot(A2, A2);
    const tmp = sub(d[first + i], add(mulS(p0, s * s * s + b1), mulS(p3, b2 + t * t * t)));
    X[0] += dot(A1, tmp);
    X[1] += dot(A2, tmp);
  }
  C[1][0] = C[0][1];
  const det = C[0][0] * C[1][1] - C[1][0] * C[0][1];
  let a1 = det === 0 ? 0 : (X[0] * C[1][1] - X[1] * C[0][1]) / det;
  let a2 = det === 0 ? 0 : (C[0][0] * X[1] - C[1][0] * X[0]) / det;
  const segL = dist(p0, p3);
  const eps = 1e-6 * segL;
  if (a1 < eps || a2 < eps || !isFinite(a1) || !isFinite(a2)) a1 = a2 = segL / 3;
  return [p0, add(p0, mulS(t1, a1)), add(p3, mulS(t2, a2)), p3];
}

function reparam(d: V[], first: number, u: number[], c: Cubic): number[] {
  return u.map((t, i) => {
    const p = d[first + i];
    const q = bez(c, t),
      q1 = bezD1(c, t),
      q2 = bezD2(c, t);
    const num = dot(sub(q, p), q1);
    const den = dot(q1, q1) + dot(sub(q, p), q2);
    if (Math.abs(den) < 1e-12) return t;
    return Math.max(0, Math.min(1, t - num / den));
  });
}

function maxError(d: V[], first: number, last: number, c: Cubic, u: number[]): [number, number] {
  let max = 0,
    split = Math.floor((first + last) / 2);
  for (let i = first + 1; i < last; i++) {
    const v = sub(bez(c, u[i - first]), d[i]);
    const e = dot(v, v);
    if (e >= max) {
      max = e;
      split = i;
    }
  }
  return [max, split];
}
