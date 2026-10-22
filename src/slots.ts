// Schlitze an eine neue Materialdicke anpassen (wie „Resize Slots“): findet in Pfaden und Rechtecken Schlitze,
// in die eine Platte gesteckt wird, also zwei gegenüberliegende parallele Geraden im Abstand der Materialdicke
// mit Luft dazwischen und Material außen. Das sind Durchbrüche (Zapfenlöcher) und vom Rand her eingeschnittene
// Kerben (Kreuzschlitze, Überblattungen), auch in importierten SVG/DXF-Konstruktionen. Beim Anpassen werden beide
// Seiten um die halbe Dickenänderung nach außen (bzw. innen) geschoben, Spiel und Lage bleiben erhalten.
// Bauteile aus Generatoren bekommen stattdessen die neue Materialdicke als Parameter. Ohne DOM (Tests).
import { apply, inv, Mat, mul, Obj, Pt, SubPath, translate } from './model';
import { shapeSubs } from './geom';
import { bezierPt, segments } from './curves';

/** Formen, deren Kontur angepasst wird (Rechtecke bleiben Rechtecke) */
const EDITABLE = ['path', 'rect'];

/** Gerade Strecke aus einem oder mehreren aufeinanderfolgenden, gleich gerichteten Segmenten (Weltkoordinaten) */
interface Run {
  /** Segment-Indizes in Pfadrichtung */
  segs: number[];
  a: Pt;
  b: Pt;
  dir: Pt;
  len: number;
}

export interface Slot {
  leaf: Obj;
  m: Mat;
  sub: number;
  /** Die beiden Seiten; nrm zeigt von Seite 0 in den Schlitz (zu Seite 1) */
  sides: [Run, Run];
  nrm: Pt;
  /** Breite (Abstand der Seiten) und Tiefe (gemeinsame Länge) in mm */
  width: number;
  depth: number;
  /** Durchbruch (beide Enden geschlossen) oder Kerbe vom Rand */
  hole: boolean;
  /** Umriss zum Markieren (Weltkoordinaten) */
  outline: Pt[];
}

export interface SlotSearch {
  /** Gesuchte Breite und erlaubte Abweichung (mm); ohne Angabe alle Breiten von 0,5 bis 25 mm */
  width?: number;
  tol?: number;
}

const sub = (p: Pt, q: Pt): Pt => ({ x: p.x - q.x, y: p.y - q.y });
const dot = (p: Pt, q: Pt) => p.x * q.x + p.y * q.y;
const at = (p: Pt, d: Pt, s: number): Pt => ({ x: p.x + d.x * s, y: p.y + d.y * s });

function worldSegs(sp: SubPath, m: Mat) {
  return segments(sp).map((s) => {
    const a = apply(m, s.a.x, s.a.y), b = apply(m, s.b.x, s.b.y);
    const c1 = apply(m, s.c1.x, s.c1.y), c2 = apply(m, s.c2.x, s.c2.y);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    // Kurven, deren Anfasser auf der Sehne liegen (manche Importe), zählen als Gerade
    const offLine = (c: Pt) => (len < 1e-9 ? Infinity : Math.abs((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / len);
    const straight = len > 1e-6 && (!s.curve || (offLine(c1) < 1e-3 && offLine(c2) < 1e-3));
    let arc = len;
    if (s.curve) {
      arc = 0;
      let p = a;
      for (let i = 1; i <= 8; i++) {
        const q = bezierPt(a, c1, c2, b, i / 8);
        arc += Math.hypot(q.x - p.x, q.y - p.y);
        p = q;
      }
    }
    return { a, b, c1, c2, curve: s.curve, straight, len: arc, ia: s.ia, ib: s.ib };
  });
}

type WSeg = ReturnType<typeof worldSegs>[number];

/** Gerade Strecken eines geschlossenen Unterpfads; gleich gerichtete Nachbarn werden zusammengefasst */
function runsOf(segs: WSeg[]): Run[] {
  const n = segs.length;
  const dirOf = (s: WSeg) => ({ x: (s.b.x - s.a.x) / Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), y: (s.b.y - s.a.y) / Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) });
  const joins = (i: number, j: number) => {
    if (!segs[i].straight || !segs[j].straight) return false;
    const d = dirOf(segs[i]), e = dirOf(segs[j]);
    return dot(d, e) > 0.99999;
  };
  // Anfang so wählen, dass keine Strecke über das Pfadende hinausläuft
  let start = 0;
  while (start < n && joins((start - 1 + n) % n, start)) start++;
  if (start === n) return [];
  const runs: Run[] = [];
  let cur: number[] = [];
  const flush = () => {
    if (!cur.length) return;
    const a = segs[cur[0]].a, b = segs[cur[cur.length - 1]].b;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 1e-6) runs.push({ segs: cur, a, b, dir: { x: (b.x - a.x) / len, y: (b.y - a.y) / len }, len });
    cur = [];
  };
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (!segs[i].straight) {
      flush();
      continue;
    }
    if (cur.length && !joins(cur[cur.length - 1], i)) flush();
    cur.push(i);
  }
  flush();
  return runs;
}

/** Geschlossene Konturen als Polygone für den Innen-/Außen-Test (gerade-ungerade über alle Formen) */
function polygonsOf(items: [Obj, Mat][]): Pt[][] {
  const out: Pt[][] = [];
  for (const [l, m] of items) {
    if (!['path', 'rect', 'ellipse', 'polygon', 'gen'].includes(l.shape.kind)) continue;
    for (const sp of shapeSubs(l.shape)) {
      if (!sp.closed) continue;
      const pts: Pt[] = [];
      for (const s of worldSegs(sp, m)) {
        if (!s.curve) pts.push(s.a);
        else for (let i = 0; i < 12; i++) pts.push(bezierPt(s.a, s.c1, s.c2, s.b, i / 12));
      }
      if (pts.length > 2) out.push(pts);
    }
  }
  return out;
}

function inside(polys: Pt[][], p: Pt): boolean {
  let c = false;
  for (const poly of polys)
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
  return c;
}

/** Länge des Pfads zwischen dem Ende von r und dem Anfang von s (in Pfadrichtung) */
function between(segs: WSeg[], r: Run, s: Run): number {
  const n = segs.length;
  let len = 0;
  for (let i = (r.segs[r.segs.length - 1] + 1) % n; i !== s.segs[0]; i = (i + 1) % n) len += segs[i].len;
  return len;
}

/**
 * Schlitze in den Formen finden. items: Blätter mit Weltmatrix; alle geschlossenen Konturen zählen für die Frage,
 * wo Material ist (ein Durchbruch darf ein eigenes Objekt in einer Platte sein). Bauteile aus Generatoren, Texte
 * und Bilder werden nicht durchsucht.
 */
export function findSlots(items: [Obj, Mat][], q: SlotSearch = {}): Slot[] {
  const lo = q.width !== undefined ? q.width - (q.tol ?? 0.3) : 0.5;
  const hi = q.width !== undefined ? q.width + (q.tol ?? 0.3) : 25;
  const polys = polygonsOf(items);
  const out: Slot[] = [];
  for (const [leaf, m] of items) {
    if (!EDITABLE.includes(leaf.shape.kind)) continue;
    shapeSubs(leaf.shape).forEach((sp, si) => {
      if (!sp.closed || sp.nodes.length < 4) return;
      const segs = worldSegs(sp, m);
      const runs = runsOf(segs);
      const cands: Slot[] = [];
      for (let i = 0; i < runs.length; i++)
        for (let j = i + 1; j < runs.length; j++) {
          const r = runs[i], s = runs[j];
          if (dot(r.dir, s.dir) > -0.9998) continue;
          let nrm = { x: -r.dir.y, y: r.dir.x };
          let d = dot(sub(s.a, r.a), nrm);
          if (d < 0) {
            nrm = { x: -nrm.x, y: -nrm.y };
            d = -d;
          }
          if (d < Math.max(lo, 0.05) || d > hi) continue;
          // gemeinsamer Bereich der beiden Seiten
          const t0 = dot(sub(s.a, r.a), r.dir), t1 = dot(sub(s.b, r.a), r.dir);
          const o0 = Math.max(0, Math.min(t0, t1)), o1 = Math.min(r.len, Math.max(t0, t1));
          const depth = o1 - o0;
          if (depth <= 0.3) continue;
          // dazwischen Luft, außen Material
          const eps = Math.min(0.05, d / 4);
          const ok = [0.25, 0.5, 0.75].every((f) => {
            const p = at(r.a, r.dir, o0 + depth * f);
            return !inside(polys, at(p, nrm, d / 2)) && inside(polys, at(p, nrm, -eps)) && inside(polys, at(p, nrm, d + eps));
          });
          if (!ok) continue;
          // die Seiten hängen über einen kurzen Boden zusammen: an einem Ende (Kerbe) oder an beiden (Durchbruch)
          const short = (len: number) => len <= 2.2 * d + 0.5;
          const e1 = short(between(segs, r, s)), e2 = short(between(segs, s, r));
          if (!e1 && !e2) continue;
          const hole = e1 && e2;
          // Fingerzinken und quadratische Löcher sind keine Schlitze für eine Platte: Tiefe deutlich über der Breite
          if (depth < (hole ? 1.25 : 1.5) * d) continue;
          const p0 = at(r.a, r.dir, o0), p1 = at(r.a, r.dir, o1);
          cands.push({
            leaf, m, sub: si, sides: [r, s], nrm, width: d, depth, hole,
            outline: [p0, p1, at(p1, nrm, d), at(p0, nrm, d), p0],
          });
        }
      // Jede Seite gehört zu höchstens einem Schlitz: der engste gewinnt
      const used = new Set<Run>();
      for (const c of cands.sort((x, y) => x.width - y.width)) {
        if (used.has(c.sides[0]) || used.has(c.sides[1])) continue;
        used.add(c.sides[0]);
        used.add(c.sides[1]);
        out.push(c);
      }
    });
  }
  return out;
}

/** Häufigste Schlitzbreiten (auf 0,05 mm gerundet), die häufigste zuerst */
export function slotWidths(slots: Slot[]): { width: number; count: number }[] {
  const bins = new Map<number, number[]>();
  for (const s of slots) {
    const k = Math.round(s.width / 0.05);
    (bins.get(k) ?? bins.set(k, []).get(k)!).push(s.width);
  }
  return [...bins.values()]
    .map((ws) => ({ width: Math.round((ws.reduce((a, b) => a + b, 0) / ws.length) * 100) / 100, count: ws.length }))
    .sort((a, b) => b.count - a.count || a.width - b.width);
}

/**
 * Schlitze um delta (mm, Weltmaß) breiter machen, je Seite um delta/2; negativ = schmaler. Die Formen werden
 * direkt geändert, Rückgabe sind die geänderten Blätter. Schlitze, die dabei zu schmal würden, bleiben unverändert.
 */
export function resizeSlots(slots: Slot[], delta: number): Obj[] {
  const byLeaf = new Map<Obj, Slot[]>();
  for (const s of slots) if (s.width + delta > 0.05) (byLeaf.get(s.leaf) ?? byLeaf.set(s.leaf, []).get(s.leaf)!).push(s);
  const changed: Obj[] = [];
  for (const [leaf, list] of byLeaf) {
    const m = list[0].m;
    const im = inv(m);
    // Weltvektor → lokaler Vektor
    const local = (v: Pt): Pt => ({ x: im[0] * v.x + im[2] * v.y, y: im[1] * v.x + im[3] * v.y });
    if (leaf.shape.kind === 'rect' && resizeRect(leaf, list, delta, local)) {
      changed.push(leaf);
      continue;
    }
    if (leaf.shape.kind === 'rect') leaf.shape = { kind: 'path', subs: shapeSubs(leaf.shape) };
    if (leaf.shape.kind !== 'path') continue;
    const subs = leaf.shape.subs;
    for (const [si, sp] of subs.entries()) {
      const mine = list.filter((s) => s.sub === si);
      if (!mine.length) continue;
      const segs = worldSegs(sp, m);
      const moved = new Map<number, Pt>();
      const runOfSeg = new Set(mine.flatMap((s) => s.sides.flatMap((r) => r.segs)));
      const add = (node: number, v: Pt) => {
        const p = moved.get(node) ?? { x: 0, y: 0 };
        moved.set(node, { x: p.x + v.x, y: p.y + v.y });
      };
      for (const s of mine)
        s.sides.forEach((r, k) => {
          // Seite 0 nach −nrm, Seite 1 nach +nrm
          const w = k === 0 ? { x: -s.nrm.x, y: -s.nrm.y } : s.nrm;
          const dist = delta / 2;
          const nodes = [segs[r.segs[0]].ia, ...r.segs.map((i) => segs[i].ib)];
          nodes.forEach((node, idx) => {
            const end = idx === 0 ? 'start' : idx === nodes.length - 1 ? 'end' : null;
            let v = at({ x: 0, y: 0 }, w, dist);
            if (end) {
              // Am Ende entlang der anschließenden Geraden schieben, damit z. B. die Kante an der Öffnung gerade bleibt
              const nb = end === 'start' ? segs[(r.segs[0] - 1 + segs.length) % segs.length] : segs[(r.segs[r.segs.length - 1] + 1) % segs.length];
              if (nb.straight && !runOfSeg.has(segs.indexOf(nb))) {
                const u = { x: (nb.b.x - nb.a.x), y: (nb.b.y - nb.a.y) };
                const ul = Math.hypot(u.x, u.y);
                const k2 = dot(u, w) / ul;
                if (Math.abs(k2) > 0.25) v = at({ x: 0, y: 0 }, u, dist / k2 / ul);
              }
            }
            add(node, v);
          });
        });
      for (const [node, v] of moved) {
        const lv = local(v);
        const nd = sp.nodes[node];
        nd.x += lv.x;
        nd.y += lv.y;
        if (nd.cin) nd.cin = { x: nd.cin.x + lv.x, y: nd.cin.y + lv.y };
        if (nd.cout) nd.cout = { x: nd.cout.x + lv.x, y: nd.cout.y + lv.y };
      }
    }
    changed.push(leaf);
  }
  return changed;
}

/** Rechteck als Durchbruch: Breite bzw. Höhe ändern und mittig halten (bleibt ein Rechteck) */
function resizeRect(leaf: Obj, list: Slot[], delta: number, local: (v: Pt) => Pt): boolean {
  const s = leaf.shape;
  if (s.kind !== 'rect' || list.length !== 1 || !list[0].hole) return false;
  const ln = local(list[0].nrm);
  const ax = Math.abs(ln.x) > Math.abs(ln.y) ? 'x' : 'y';
  if (Math.abs(ax === 'x' ? ln.y : ln.x) > 1e-6 * Math.hypot(ln.x, ln.y)) return false;
  // lokale Länge je Weltmillimeter quer zum Schlitz
  const dl = (delta / 2) * Math.hypot(ln.x, ln.y);
  if (ax === 'x') {
    s.w += Math.sign(s.w) * 2 * dl;
    leaf.m = mul(leaf.m, translate(-Math.sign(s.w) * dl, 0));
  } else {
    s.h += Math.sign(s.h) * 2 * dl;
    leaf.m = mul(leaf.m, translate(0, -Math.sign(s.h) * dl));
  }
  return true;
}
