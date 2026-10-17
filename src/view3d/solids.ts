// Platten für die 3D-Ansicht: Konturen als Linienzüge mit ihrer Lage im Raum, und die Prüfung, ob sich zwei
// Platten durchdringen (z. B. bei Presspassung oder falsch bemaßten Zinken).
import ClipperLib from 'clipper-lib';
import type { Pt, SubPath } from '../model';
import { IDENT } from '../model';
import { execute, flattenSub, Paths, SCALE } from '../clip';
import { buildGen, getGenerator, normalizeParams, Params } from '../generators';
import { assemblyPoses, cross, dot, genThickness, Pose, V3 } from './poses';

export interface Solid {
  /** Schlüssel des Teils (Baugruppe) bzw. der Objekt-ID */
  key: string;
  label: string;
  /** Geschlossene Konturen in lokalen Koordinaten (mm), Löcher nach Gerade-Ungerade-Regel */
  polys: Pt[][];
  pose: Pose;
  th: number;
  /** Drehzahl relativ zum Antrieb (nur Zahnräder) */
  spin?: number;
}

/** Konturen in Linienzüge zerlegen (offene Pfade werden ignoriert) */
export function subsPolys(subs: SubPath[]): Pt[][] {
  return subs.filter((sp) => sp.closed && sp.nodes.length > 2).map((sp) => flattenSub(sp, IDENT).map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE })));
}

/**
 * Alle Teile einer Baugruppe in Lage, ohne Schnittfuge (so, wie sie nach dem Lasern aussehen).
 * keys: nur diese Teile (vom Nutzer gelöschte fehlen); fallbackTh: Dicke, wenn der Generator keine kennt.
 * Liefert null, wenn der Generator unbekannt ist, keinen räumlichen Aufbau hat oder die Parameter fehlerhaft sind.
 */
export function asmSolids(gen: string, raw: Params, fallbackTh: number, keys?: Set<string>): Solid[] | null {
  const g = getGenerator(gen);
  if (!g) return null;
  const params = normalizeParams(g, { ...raw, kerf: 0 });
  const th = genThickness(params, fallbackTh);
  const poses = assemblyPoses(gen, params, th);
  if (!poses) return null;
  const r = buildGen(g, params);
  if (!r.parts.length) return null;
  const out: Solid[] = [];
  for (const p of r.parts) {
    const key = p.shape.part ?? 'main';
    const pose = poses.poses[key];
    if (!pose || (keys && !keys.has(key))) continue;
    out.push({ key, label: g.label(params, p.shape.part), polys: subsPolys(p.shape.subs), pose, th, spin: poses.spin?.[key] });
  }
  return out;
}

// ---------- Überschneidungen ----------

export interface Overlap {
  a: string;
  b: string;
  /** Volumen der Durchdringung in mm³ */
  volume: number;
  /** Bereiche der Durchdringung als Platten (zum Einfärben) */
  pieces: Solid[];
}

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const world = (s: Solid, x: number, y: number, z = 0): V3 => add(add(add(s.pose.o, s.pose.u, x), s.pose.v, y), s.pose.n, z);

/** Ausdehnung einer Platte entlang der Richtung d */
function extent(s: Solid, d: V3): [number, number] {
  let lo = Infinity,
    hi = -Infinity;
  for (const poly of s.polys)
    for (const q of poly)
      for (const z of [0, s.th]) {
        const v = dot(world(s, q.x, q.y, z), d);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
  return [lo, hi];
}

/** Dicke der Platte entlang ihrer Normalen als Bereich der Koordinate dot(P, d) für d = ±n */
function slab(s: Solid, d: V3): [number, number] {
  const o = dot(s.pose.o, d);
  return dot(s.pose.n, d) > 0 ? [o, o + s.th] : [o - s.th, o];
}

/** Schnitt einer Kontur (in Koordinaten (t, w)) mit der Geraden t = const: Intervalle in w */
function scan(polys: [number, number][][], t: number): [number, number][] {
  const xs: number[] = [];
  for (const poly of polys)
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ta, wa] = poly[j],
        [tb, wb] = poly[i];
      if (ta <= t !== tb <= t) xs.push(wa + ((t - ta) * (wb - wa)) / (tb - ta));
    }
  xs.sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

const clipTo = (iv: [number, number][], lo: number, hi: number) =>
  iv.map(([a, b]): [number, number] => [Math.max(a, lo), Math.min(b, hi)]).filter(([a, b]) => b - a > 1e-9);
const measure = (iv: [number, number][]) => iv.reduce((s, [a, b]) => s + b - a, 0);

const EPS_VOL = 1e-3;

/**
 * Senkrechte Platten (Zinken, Kreuzschlitze): Koordinaten t entlang der Schnittgeraden, a entlang nA, b entlang nB.
 * A ist in a die eigene Dicke und in (t, b) die Kontur, B entsprechend. Für jedes t ist der gemeinsame Querschnitt
 * ein Rechteck aus (Dicke von A ∩ Kontur von B) × (Dicke von B ∩ Kontur von A); t wird fein abgetastet.
 */
function perpendicular(A: Solid, B: Solid): Overlap | null {
  const nA = A.pose.n,
    nB = B.pose.n;
  const d = cross(nA, nB);
  const [sa0, sa1] = slab(A, nA),
    [sb0, sb1] = slab(B, nB);
  const toTW = (s: Solid, w: V3) => s.polys.map((poly) => poly.map((q): [number, number] => { const P = world(s, q.x, q.y); return [dot(P, d), dot(P, w)]; }));
  const pa = toTW(A, nB),
    pb = toTW(B, nA);
  const [ta0, ta1] = extent(A, d),
    [tb0, tb1] = extent(B, d);
  const t0 = Math.max(ta0, tb0),
    t1 = Math.min(ta1, tb1);
  if (t1 - t0 <= 1e-9) return null;
  const n = Math.min(40000, Math.max(1, Math.ceil((t1 - t0) / 0.02)));
  const step = (t1 - t0) / n;
  let volume = 0;
  const pieces: Solid[] = [];
  // Gleiche Querschnitte nacheinander zu einem Quader zusammenfassen
  let run: { t: number; ia: [number, number][]; ib: [number, number][] } | null = null;
  const same = (x: [number, number][], y: [number, number][]) => x.length === y.length && x.every((v, i) => Math.abs(v[0] - y[i][0]) < 1e-6 && Math.abs(v[1] - y[i][1]) < 1e-6);
  const flush = (tEnd: number) => {
    if (!run) return;
    for (const [a0, a1] of run.ib)
      for (const [b0, b1] of run.ia) {
        const o = add(add([0, 0, 0], d, run.t), add([0, 0, 0], add(add([0, 0, 0], nA, a0), nB, b0)));
        pieces.push({ key: '', label: '', pose: { o, u: d, v: nB, n: nA }, th: a1 - a0, polys: [[{ x: 0, y: 0 }, { x: tEnd - run.t, y: 0 }, { x: tEnd - run.t, y: b1 - b0 }, { x: 0, y: b1 - b0 }]] });
      }
    run = null;
  };
  for (let k = 0; k < n; k++) {
    const t = t0 + (k + 0.5) * step;
    // Kontur von A an der Stelle t, begrenzt auf die Dicke von B (und umgekehrt)
    const ia = clipTo(scan(pa, t), sb0, sb1);
    const ib = ia.length ? clipTo(scan(pb, t), sa0, sa1) : [];
    const area = measure(ia) * measure(ib);
    if (area <= 1e-9) {
      flush(t0 + k * step);
      continue;
    }
    volume += area * step;
    if (run && !(same(run.ia, ia) && same(run.ib, ib))) flush(t0 + k * step);
    if (!run) run = { t: t0 + k * step, ia, ib };
  }
  flush(t1);
  return volume > EPS_VOL ? { a: A.key, b: B.key, volume, pieces } : null;
}

/** Parallele Platten (Zahnräder, flach liegende Teile): gemeinsame Fläche in der Ebene × gemeinsame Dicke */
function parallel(A: Solid, B: Solid): Overlap | null {
  const n = A.pose.n;
  const [a0, a1] = slab(A, n),
    [b0, b1] = slab(B, n);
  const z0 = Math.max(a0, b0),
    h = Math.min(a1, b1) - z0;
  if (h <= 1e-9) return null;
  const toA = (P: V3) => {
    const r = add(P, A.pose.o, -1);
    return { X: Math.round(dot(r, A.pose.u) * SCALE), Y: Math.round(dot(r, A.pose.v) * SCALE) };
  };
  const pa: Paths = A.polys.map((poly) => poly.map((q) => ({ X: Math.round(q.x * SCALE), Y: Math.round(q.y * SCALE) })));
  const pb: Paths = B.polys.map((poly) => poly.map((q) => toA(world(B, q.x, q.y))));
  const res = execute(ClipperLib.ClipType.ctIntersection, pa, pb, ClipperLib.PolyFillType.pftEvenOdd);
  const area = res.reduce((s, p) => s + ClipperLib.Clipper.Area(p), 0) / (SCALE * SCALE);
  const volume = Math.abs(area) * h;
  if (volume <= EPS_VOL) return null;
  const o = add(A.pose.o, n, z0 - dot(A.pose.o, n));
  return {
    a: A.key,
    b: B.key,
    volume,
    pieces: [{ key: '', label: '', pose: { ...A.pose, o }, th: h, polys: res.map((p) => p.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE }))) }],
  };
}

/** Bounding Box im Raum */
export function solidBounds(s: Solid): { min: V3; max: V3 } {
  const ax = [extent(s, [1, 0, 0]), extent(s, [0, 1, 0]), extent(s, [0, 0, 1])];
  return { min: [ax[0][0], ax[1][0], ax[2][0]], max: [ax[0][1], ax[1][1], ax[2][1]] };
}

/**
 * Paarweise Durchdringungen. Geprüft werden parallele und senkrechte Platten (alle Aufbauten der Generatoren);
 * schräg zueinander stehende Platten werden übersprungen.
 */
export function findOverlaps(solids: Solid[]): Overlap[] {
  const boxes = solids.map(solidBounds);
  const out: Overlap[] = [];
  for (let i = 0; i < solids.length; i++)
    for (let j = i + 1; j < solids.length; j++) {
      const p = boxes[i],
        q = boxes[j];
      if ([0, 1, 2].some((k) => Math.min(p.max[k], q.max[k]) - Math.max(p.min[k], q.min[k]) <= 1e-9)) continue;
      const c = Math.abs(dot(solids[i].pose.n, solids[j].pose.n));
      const r = c > 1 - 1e-9 ? parallel(solids[i], solids[j]) : c < 1e-9 ? perpendicular(solids[i], solids[j]) : null;
      if (r) out.push(r);
    }
  return out;
}
