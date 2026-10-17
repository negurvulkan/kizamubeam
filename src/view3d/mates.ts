// Teile, die mit dem Verbindungs-Werkzeug verbunden wurden, im Raum zusammensetzen.
//
// Jede gemerkte Verbindung (Mate in model.ts) legt fest, wie das Gegenstück zum ersten Teil steht. Gerechnet wird
// in den Weltkoordinaten der Arbeitsfläche (mm): Eine Lage bildet (x, y, Höhe in der Platte) in den Raum ab.
// Ausgehend vom Teil mit den meisten Verbindungen wird Teil für Teil angesetzt (Breitensuche); schließt eine
// Verbindung einen Kreis (Box mit vier Wänden), entscheidet die Überschneidungsprüfung, ob alles passt.
import type { Mat, Mate, Pt } from '../model';
import { apply } from '../model';
import { flatPose, Pose, V3 } from './poses';
import type { Solid } from './solids';

export interface MatePart {
  id: number;
  label: string;
  /** Konturen in Weltkoordinaten der Arbeitsfläche */
  polys: Pt[][];
  /** Weltmatrix des Objekts (für die lokal gespeicherten Punkte der Verbindungen) */
  m: Mat;
  mates: Mate[];
}

interface Line {
  /** Anfang, Ende, Einheitsrichtung, Einheitsnormale ins Material (alles 2D, Welt) */
  a: Pt;
  b: Pt;
  dir: Pt;
  in: Pt;
}

const sub = (p: Pt, q: Pt): Pt => ({ x: p.x - q.x, y: p.y - q.y });

function line(m: Mat, pts: [Pt, Pt, Pt]): Line {
  const [a, b, c] = pts.map((p) => apply(m, p.x, p.y));
  const d = sub(b, a);
  const l = Math.hypot(d.x, d.y) || 1;
  const dir = { x: d.x / l, y: d.y / l };
  let n = { x: -dir.y, y: dir.x };
  const w = sub(c, a);
  if (n.x * w.x + n.y * w.y < 0) n = { x: -n.x, y: -n.y };
  return { a, b, dir, in: n };
}

const v3 = (p: Pt, z = 0): V3 => [p.x, p.y, z];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const plus = (...vs: V3[]): V3 => vs.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0] as V3);
const lerp = (l: Line, t: number): Pt => ({ x: l.a.x + (l.b.x - l.a.x) * t, y: l.a.y + (l.b.y - l.a.y) * t });

/**
 * Lage einer Platte, deren Linie L auf die Raumlinie durch Q mit Richtung T fällt, deren Material von der Linie aus
 * in Richtung I liegt und deren Dicke in Richtung N zeigt. at: Anteil der Linie, der auf Q fällt.
 */
function fit(L: Line, at: number, Q: V3, T: V3, I: V3, N: V3): Pose {
  // Lineare Abbildung über die Basis (dir, in) der Linie: dir → T, in → I
  const u = plus(scale(T, L.dir.x), scale(I, L.in.x));
  const v = plus(scale(T, L.dir.y), scale(I, L.in.y));
  const p = lerp(L, at);
  return { o: plus(Q, scale(u, -p.x), scale(v, -p.y)), u, v, n: N };
}

/**
 * Lage des Gegenstücks B, wenn das erste Teil A die Lage „Identität“ hat (Weltkoordinaten, Dicke nach +z).
 * Konventionen: Gegenstücke stehen auf der Seite +z von A; die beiden Kanten laufen gegenläufig wie in einem
 * aufgefalteten Netz.
 */
export function mateRelative(A: Line, B: Line, mt: Mate): Pose | null {
  const th = mt.th;
  const Z: V3 = [0, 0, 1];
  const inA = v3(A.in),
    dirA = v3(A.dir);
  const midA = lerp(A, 0.5);
  switch (mt.kind) {
    case 'finger':
      // Ecke: B steht senkrecht auf der Kante von A. Zinken nach innen (Außenmaß): B liegt im Zinkenstreifen von A,
      // seine Außenseite bündig mit der Kante. Zinken nach außen (Innenmaß): B liegt vor der Kante, über der Dicke von A.
      return mt.out
        ? fit(B, 0.5, v3(midA, th), scale(dirA, -1), Z, scale(inA, -1))
        : fit(B, 0.5, v3(midA, 0), scale(dirA, -1), Z, inA);
    case 'lidhinge':
      // Deckel liegt geschlossen auf der Oberkante der Rückwand A, hinten bündig mit ihrer Außenseite (z = 0)
      return fit(B, 0.5, v3(midA, 0), scale(dirA, -1), Z, scale(inA, -1));
    case 'lap': {
      if (!mt.lap) return null;
      // Kreuzung: Der Schlitz von A läuft von der Kante ins Material (Richtung inA). B steht senkrecht dazu,
      // seine Kante liegt um beide Schlitztiefen tiefer, sein Material zeigt zurück zur Kante von A.
      const P = lerp(A, mt.lap.ua);
      const foot = { x: P.x + A.in.x * (mt.lap.da + mt.lap.db), y: P.y + A.in.y * (mt.lap.da + mt.lap.db) };
      return fit(B, mt.lap.ub, plus(v3(foot, th / 2), scale(dirA, -th / 2)), Z, scale(inA, -1), dirA);
    }
    default: {
      // Zapfen-Familie: A ist das Teil mit den Zapfen, B hat die Schlitze. Dafür B fest und A ansetzen,
      // dann umkehren: A steht auf B (Seite +z), Mittelebene von A durch die Schlitzmitte, Zapfen nach unten durch B.
      const nB = v3(B.in);
      const mid = lerp(B, 0.5);
      const PA = fit(A, 0.5, plus(v3(mid, th), scale(nB, -th / 2)), v3(B.dir), Z, nB);
      return invert(PA);
    }
  }
}

/** Verkettung: erst q, dann p */
export function compose(p: Pose, q: Pose): Pose {
  const L = (w: V3): V3 => plus(scale(p.u, w[0]), scale(p.v, w[1]), scale(p.n, w[2]));
  return { o: plus(p.o, L(q.o)), u: L(q.u), v: L(q.v), n: L(q.n) };
}

/** Umkehrung (die Achsen sind orthonormal: Transponierte) */
export function invert(p: Pose): Pose {
  const d = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return {
    o: [-d(p.u, p.o), -d(p.v, p.o), -d(p.n, p.o)],
    u: [p.u[0], p.v[0], p.n[0]],
    v: [p.u[1], p.v[1], p.n[1]],
    n: [p.u[2], p.v[2], p.n[2]],
  };
}

export interface MateAssembly {
  solids: Solid[];
  /** Kennung der Gruppe je Teil (zusammenhängende Teile werden gemeinsam auseinandergezogen) */
  groups: Map<string, string>;
  /** Teile, die über Verbindungen angesetzt wurden */
  placed: Set<number>;
}

/**
 * Verbundene Teile zusammensetzen. Teile ohne Verbindung kommen nicht vor. fallbackTh: Dicke für Teile, deren
 * Verbindungen keine nennen (gibt es nicht, aber sicher ist sicher).
 */
export function assembleMates(parts: MatePart[], fallbackTh: number): MateAssembly {
  const byId = new Map(parts.map((p) => [p.id, p]));
  // Kanten des Verbindungsgraphen in beide Richtungen
  const adj = new Map<number, { other: number; rel: Pose; th: number }[]>();
  const link = (x: number, y: number, rel: Pose, th: number) => {
    if (!adj.has(x)) adj.set(x, []);
    adj.get(x)!.push({ other: y, rel, th });
  };
  for (const p of parts)
    for (const mt of p.mates) {
      const q = byId.get(mt.to);
      if (!q || q === p) continue;
      const rel = mateRelative(line(p.m, mt.a), line(q.m, mt.b), mt);
      if (!rel) continue;
      link(p.id, q.id, rel, mt.th);
      link(q.id, p.id, invert(rel), mt.th);
    }
  const poses = new Map<number, Pose>();
  const thick = new Map<number, number>();
  const groups = new Map<string, string>();
  // Wurzel: das Teil mit den meisten Verbindungen, bei Gleichstand das größte (Seitenwand statt Regalboden)
  const size = (id: number) => {
    const pts = byId.get(id)!.polys.flat();
    const xs = pts.map((q) => q.x),
      ys = pts.map((q) => q.y);
    return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  };
  const order = [...adj.keys()].sort((x, y) => adj.get(y)!.length - adj.get(x)!.length || size(y) - size(x));
  for (const root of order) {
    if (poses.has(root)) continue;
    // Wurzel liegt flach, von oben gesehen wie auf der Arbeitsfläche
    poses.set(root, flatPose());
    const queue = [root];
    while (queue.length) {
      const x = queue.shift()!;
      groups.set(String(x), 'm' + root);
      for (const e of adj.get(x)!) {
        if (!thick.has(x)) thick.set(x, e.th);
        if (poses.has(e.other)) continue;
        poses.set(e.other, compose(poses.get(x)!, e.rel));
        thick.set(e.other, e.th);
        queue.push(e.other);
      }
    }
  }
  const solids: Solid[] = [];
  for (const [id, pose] of poses) {
    const p = byId.get(id)!;
    solids.push({ key: String(id), label: p.label, polys: p.polys, pose, th: thick.get(id) ?? fallbackTh });
  }
  return { solids, groups, placed: new Set(poses.keys()) };
}
