// Baukasten für die mitgelieferte Bibliothek (Motive und Designelemente): Grundformen, glatte Umrisse aus
// Stützpunkten, Striche mit Breite und Boolesche Verknüpfungen (Clipper). Gezeichnet wird in einem Feld von
// etwa 100 × 100 Einheiten; finish() verschiebt nach (0, 0), skaliert auf die Zielgröße in mm und passt
// Bézierkurven ein. Nur für scripts/build-library.ts, nicht Teil der App.
import ClipperLib from 'clipper-lib';
import { fitPolyline } from '../../src/fit';
import type { SubPath } from '../../src/model';

const { Clipper, ClipperOffset, ClipType, PolyType, PolyFillType, JoinType, EndType } = ClipperLib;
type Path = ClipperLib.Path;
export type Shape = ClipperLib.Paths;
export type Pt = [number, number];

const K = 1000;
const toPath = (pts: Pt[]): Path => pts.map(([x, y]) => ({ X: Math.round(x * K), Y: Math.round(y * K) }));
const rad = (d: number) => (d * Math.PI) / 180;

function exec(type: ClipperLib.ClipType, a: Shape, b: Shape, fill = PolyFillType.pftNonZero): Shape {
  const c = new Clipper();
  c.AddPaths(a, PolyType.ptSubject, true);
  if (b.length) c.AddPaths(b, PolyType.ptClip, true);
  const out: Shape = [];
  c.Execute(type, out, fill, fill);
  return out;
}
/** Pfade nach Gerade-Ungerade bereinigen (z. B. für Ringe aus zwei Kreisen) */
export const evenodd = (s: Shape): Shape => exec(ClipType.ctUnion, s, [], PolyFillType.pftEvenOdd);
export const U = (...s: Shape[]): Shape => exec(ClipType.ctUnion, s.flat(), []);
export const D = (a: Shape, ...b: Shape[]): Shape => exec(ClipType.ctDifference, U(a), U(...b));
export const I = (a: Shape, b: Shape): Shape => exec(ClipType.ctIntersection, U(a), U(b));
export const X = (a: Shape, b: Shape): Shape => exec(ClipType.ctXor, U(a), U(b));

// ---------- Punkte ----------

export function arcPts(cx: number, cy: number, rx: number, a0: number, a1: number, ry = rx, n = 0): Pt[] {
  const steps = n || Math.max(8, Math.ceil(Math.abs(a1 - a0) / 4));
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = rad(a0 + ((a1 - a0) * i) / steps);
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}
/** Kubische Bézierkurve als Punkte */
export function bez(p0: Pt, c1: Pt, c2: Pt, p1: Pt, n = 24): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n,
      u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
      u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
    ]);
  }
  return out;
}
/** Catmull-Rom durch die Punkte (geschlossen oder offen), fein abgetastet */
export function cr(pts: Pt[], closed: boolean, tension = 0.5, n = 12): Pt[] {
  const m = pts.length;
  if (m < 3) return pts;
  const get = (i: number) => (closed ? pts[(i + m) % m] : pts[Math.max(0, Math.min(m - 1, i))]);
  const out: Pt[] = [];
  const last = closed ? m : m - 1;
  for (let i = 0; i < last; i++) {
    const p0 = get(i - 1),
      p1 = get(i),
      p2 = get(i + 1),
      p3 = get(i + 2);
    const k = tension / 3 * 2;
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) * k / 2, p1[1] + (p2[1] - p0[1]) * k / 2];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) * k / 2, p2[1] - (p3[1] - p1[1]) * k / 2];
    const seg = bez(p1, c1, c2, p2, n);
    out.push(...(i ? seg.slice(1) : seg));
  }
  if (closed) out.pop();
  return out;
}
/** Halber Umriss rechts von der Achse x = ax (von oben nach unten) gespiegelt zu ganzem Punktzug */
export function mirrorPts(half: Pt[], ax = 50): Pt[] {
  const back = half.slice().reverse().map(([x, y]): Pt => [2 * ax - x, y]);
  // Punkte auf der Achse nicht doppeln
  const onAxis = (p: Pt) => Math.abs(p[0] - ax) < 1e-6;
  return [...half, ...back.filter((p, i) => !(onAxis(p) && (i === 0 || i === back.length - 1)))];
}

// ---------- Formen ----------

export const poly = (pts: Pt[]): Shape => U([toPath(pts)]);
/** Glatte geschlossene Form durch die Punkte */
export const blob = (pts: Pt[], tension = 0.5): Shape => poly(cr(pts, true, tension));
/** Symmetrische glatte Form aus dem rechten halben Umriss (Achse x = ax) */
export const sym = (half: Pt[], ax = 50, tension = 0.5): Shape => blob(mirrorPts(half, ax), tension);
/** Symmetrisches Vieleck (eckig) aus dem rechten halben Umriss */
export const symPoly = (half: Pt[], ax = 50): Shape => poly(mirrorPts(half, ax));
export const circle = (cx: number, cy: number, r: number): Shape => poly(arcPts(cx, cy, r, 0, 360, r, Math.max(24, Math.ceil(r * 4))).slice(0, -1));
export const ellipse = (cx: number, cy: number, rx: number, ry: number, rot = 0): Shape =>
  T(poly(arcPts(0, 0, rx, 0, 360, ry, Math.max(32, Math.ceil(Math.max(rx, ry) * 4))).slice(0, -1)), { rot, dx: cx, dy: cy });
export function rect(x: number, y: number, w: number, h: number, r = 0): Shape {
  if (r <= 0) return poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
  r = Math.min(r, w / 2, h / 2);
  return poly([
    ...arcPts(x + w - r, y + r, r, -90, 0),
    ...arcPts(x + w - r, y + h - r, r, 0, 90),
    ...arcPts(x + r, y + h - r, r, 90, 180),
    ...arcPts(x + r, y + r, r, 180, 270),
  ]);
}
export function ngon(cx: number, cy: number, n: number, r: number, rot = -90): Shape {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) pts.push([cx + r * Math.cos(rad(rot + (360 * i) / n)), cy + r * Math.sin(rad(rot + (360 * i) / n))]);
  return poly(pts);
}
export function star(cx: number, cy: number, n: number, ro: number, ri: number, rot = -90): Shape {
  const pts: Pt[] = [];
  for (let i = 0; i < 2 * n; i++) {
    const r = i % 2 ? ri : ro,
      a = rad(rot + (180 * i) / n);
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return poly(pts);
}
export const ring = (cx: number, cy: number, r: number, w: number): Shape => D(circle(cx, cy, r + w / 2), circle(cx, cy, r - w / 2));
/** Kreisbogen mit Breite */
export const arc = (cx: number, cy: number, r: number, a0: number, a1: number, w: number, cap: Cap = 'round'): Shape => stroke(arcPts(cx, cy, r, a0, a1), w, cap);

export type Cap = 'round' | 'butt' | 'square';
/** Offener Strich mit Breite w durch die Punkte (smooth: Catmull-Rom) */
export function stroke(pts: Pt[], w: number, cap: Cap = 'round', smooth = false, join: 'round' | 'miter' = 'round'): Shape {
  const p = smooth ? cr(pts, false) : pts;
  const co = new ClipperOffset(2, 0.05 * K);
  const et = cap === 'round' ? EndType.etOpenRound : cap === 'square' ? EndType.etOpenSquare : EndType.etOpenButt;
  co.AddPath(toPath(p), join === 'round' ? JoinType.jtRound : JoinType.jtMiter, et);
  const out: Shape = [];
  co.Execute(out, (w / 2) * K);
  return U(out);
}
/** Geschlossener Strich (Umriss mit Breite w) */
export function outline(pts: Pt[], w: number, smooth = false, join: 'round' | 'miter' = 'miter'): Shape {
  const p = smooth ? cr(pts, true) : pts;
  const co = new ClipperOffset(3, 0.05 * K);
  co.AddPath(toPath(p), join === 'round' ? JoinType.jtRound : JoinType.jtMiter, EndType.etClosedLine);
  const out: Shape = [];
  co.Execute(out, (w / 2) * K);
  return U(out);
}
/** Rand einer Form (Linie mit Breite w mittig auf dem Umriss) */
export function edge(s: Shape, w: number, join: 'round' | 'miter' = 'round'): Shape {
  const co = new ClipperOffset(3, 0.05 * K);
  co.AddPaths(U(s), join === 'round' ? JoinType.jtRound : JoinType.jtMiter, EndType.etClosedLine);
  const out: Shape = [];
  co.Execute(out, (w / 2) * K);
  return U(out);
}
/** Form vergrößern (d > 0) oder verkleinern */
export function off(s: Shape, d: number, join: 'round' | 'miter' = 'round'): Shape {
  const co = new ClipperOffset(3, 0.05 * K);
  co.AddPaths(U(s), join === 'round' ? JoinType.jtRound : JoinType.jtMiter, EndType.etClosedPolygon);
  const out: Shape = [];
  co.Execute(out, d * K);
  return U(out);
}
/** Kontur als Linie mit Breite w nach innen (Rahmen aus einer Form) */
export const hollow = (s: Shape, w: number): Shape => D(s, off(s, -w));

export interface Tf {
  dx?: number;
  dy?: number;
  /** Drehung in Grad um (cx, cy) */
  rot?: number;
  cx?: number;
  cy?: number;
  sx?: number;
  sy?: number;
}
/** Verschieben, Skalieren und Drehen (um cx, cy; zuerst Skalieren und Drehen, dann Verschieben) */
export function T(s: Shape, t: Tf): Shape {
  const { dx = 0, dy = 0, rot = 0, cx = 0, cy = 0, sx = 1, sy = sx } = t;
  const c = Math.cos(rad(rot)),
    sn = Math.sin(rad(rot));
  const out = s.map((p) =>
    p.map(({ X, Y }) => {
      const x = (X / K - cx) * sx,
        y = (Y / K - cy) * sy;
      return { X: Math.round((cx + x * c - y * sn + dx) * K), Y: Math.round((cy + x * sn + y * c + dy) * K) };
    }),
  );
  // Spiegeln dreht die Umlaufrichtung: neu vereinen
  return U(out);
}
/** Horizontal spiegeln an x = ax */
export const flipX = (s: Shape, ax = 50) => T(s, { sx: -1, sy: 1, cx: ax });
export const flipY = (s: Shape, ay = 50) => T(s, { sx: 1, sy: -1, cy: ay });
/** Form und ihr Spiegelbild */
export const mirror = (s: Shape, ax = 50) => U(s, flipX(s, ax));
/** n Kopien im Kreis um (cx, cy) */
export function polar(s: Shape, n: number, cx = 50, cy = 50, start = 0): Shape {
  const parts: Shape[] = [];
  for (let i = 0; i < n; i++) parts.push(T(s, { rot: start + (360 * i) / n, cx, cy }));
  return U(...parts);
}
/** Kopien in einer Reihe */
export function row(s: Shape, n: number, dx: number, dy = 0): Shape {
  const parts: Shape[] = [];
  for (let i = 0; i < n; i++) parts.push(T(s, { dx: dx * i, dy: dy * i }));
  return U(...parts);
}

export function bounds(s: Shape) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of s)
    for (const { X, Y } of p) {
      x0 = Math.min(x0, X / K);
      y0 = Math.min(y0, Y / K);
      x1 = Math.max(x1, X / K);
      y1 = Math.max(y1, Y / K);
    }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/** Fläche (für Prüfungen: winzige Teile finden) */
export const area = (p: Path) => Math.abs(Clipper.Area(p)) / K / K;

/**
 * Fertige Form: nach (0, 0) schieben, so skalieren, dass die längere Seite size mm misst (oder genau w × h),
 * kleine Splitter entfernen und Bézierkurven einpassen.
 */
export function finish(s: Shape, size: number | { w: number } | { h: number }): { subs: SubPath[]; w: number; h: number } {
  s = U(s);
  const b = bounds(s);
  const k = typeof size === 'number' ? size / Math.max(b.w, b.h) : 'w' in size ? size.w / b.w : size.h / b.h;
  const minArea = (0.05 / k) ** 2; // Teile unter etwa 0,05 × 0,05 mm fallen weg
  const subs: SubPath[] = [];
  for (const p of Clipper.CleanPolygons(s, 2)) {
    if (p.length < 3 || area(p) < minArea) continue;
    const pts = p.map(({ X, Y }) => ({ x: (X / K - b.x0) * k, y: (Y / K - b.y0) * k }));
    subs.push(fitPolyline(pts, true, 0.05));
  }
  return { subs, w: b.w * k, h: b.h * k };
}

/** Ecken abrunden: außen (r > 0) – innen mit r < 0 */
export const round = (s: Shape, r: number): Shape => (r > 0 ? off(off(s, -r), r) : off(off(s, -r), r));
/** Vorderes Teil auf hinterem, getrennt durch eine Fuge der Breite gap */
export const over = (back: Shape, front: Shape, gap = 1.6): Shape => U(D(back, off(front, gap)), front);
/** Fuge (Schnittlinie) durch eine Form entlang der Punkte */
export const cut = (s: Shape, pts: Pt[], w = 1.6, smooth = true): Shape => D(s, stroke(pts, w, 'round', smooth));

/** Strich, dessen Breite von w0 auf w1 übergeht (spitz zulaufende Schwänze, Blätter, Flammen) */
export function taper(pts: Pt[], w0: number, w1: number, smooth = true): Shape {
  const p = smooth ? cr(pts, false) : pts;
  const L: Pt[] = [],
    R: Pt[] = [];
  let total = 0;
  const acc = [0];
  for (let i = 1; i < p.length; i++) acc.push((total += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])));
  for (let i = 0; i < p.length; i++) {
    const a = p[Math.max(0, i - 1)],
      b = p[Math.min(p.length - 1, i + 1)];
    let nx = -(b[1] - a[1]),
      ny = b[0] - a[0];
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    const w = (w0 + ((w1 - w0) * acc[i]) / (total || 1)) / 2;
    L.push([p[i][0] + nx * w, p[i][1] + ny * w]);
    R.push([p[i][0] - nx * w, p[i][1] - ny * w]);
  }
  const s = poly([...L, ...R.reverse()]);
  return U(s, w0 > 0.1 ? circle(p[0][0], p[0][1], w0 / 2) : [], w1 > 0.1 ? circle(p[p.length - 1][0], p[p.length - 1][1], w1 / 2) : []);
}

/** Spitzes Blatt von p0 nach p1 mit größter Breite w; bend biegt die Mittellinie zur Seite */
export function leaf(p0: Pt, p1: Pt, w: number, bend = 0, n = 32): Shape {
  const dx = p1[0] - p0[0],
    dy = p1[1] - p0[1];
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l,
    ny = dx / l;
  const L: Pt[] = [],
    R: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s = Math.sin(Math.PI * t);
    const cx = p0[0] + dx * t + nx * bend * s,
      cy = p0[1] + dy * t + ny * bend * s;
    const hw = (w / 2) * Math.pow(s, 0.85);
    L.push([cx + nx * hw, cy + ny * hw]);
    R.push([cx - nx * hw, cy - ny * hw]);
  }
  return poly([...L, ...R.reverse().slice(1, -1)]);
}

/** Herz mit Mitte (cx, cy) und Breite w (Spitze unten) */
export function heart(cx: number, cy: number, w: number): Shape {
  const r = w * 0.27;
  const c1: Pt = [cx - w / 2 + r, cy - w * 0.12],
    c2: Pt = [cx + w / 2 - r, cy - w * 0.12];
  const tip: Pt = [cx, cy + w * 0.5];
  // Tangenten von der Spitze an die beiden Kreise
  const tan = (c: Pt, side: number): Pt => {
    const vx = c[0] - tip[0],
      vy = c[1] - tip[1];
    const d = Math.hypot(vx, vy);
    const a = Math.atan2(vy, vx) + side * Math.asin(r / d);
    const tl = Math.sqrt(d * d - r * r);
    return [tip[0] + tl * Math.cos(a), tip[1] + tl * Math.sin(a)];
  };
  return U(circle(c1[0], c1[1], r), circle(c2[0], c2[1], r), poly([tan(c1, -1), tip, tan(c2, 1), [cx, cy - w * 0.12]]));
}

/** Archimedische Spirale als Punkte */
export function spiralPts(cx: number, cy: number, r0: number, r1: number, turns: number, start = 0): Pt[] {
  const out: Pt[] = [];
  const n = Math.ceil(turns * 72);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = ((start + t * turns * 360) * Math.PI) / 180;
    const r = r0 + (r1 - r0) * t;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}
