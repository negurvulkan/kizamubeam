// Holzverbindungen für gelaserte Bauteile: Fingerzinken, Schlitz und Zapfen sowie Überblattung.
// Eine Verbindung wird auf gerade Kanten vorhandener Formen angewendet. Die Kante wird durch das Zinken- bzw.
// Zapfenprofil ersetzt, Schlitze kommen als geschlossene Unterpfade hinzu. Alles bleibt ein normaler Pfad mit
// geraden Segmenten (exakte Ecken, keine Näherung) und lässt sich danach im Knoteneditor weiter bearbeiten.
// Gerechnet wird in Weltkoordinaten (mm), damit Materialdicke und Breiten auch bei gedrehten oder skalierten
// Objekten stimmen; das Ergebnis wird in die lokalen Koordinaten des Objekts zurückgerechnet.
import { Mat, Obj, Pt, SubPath } from './model';
import { bezierPt, segments, shapeSubs } from './geom';
import { transformSubs } from './importers';

export type JointKind = 'finger' | 'tenon' | 'lap';

export interface JointOptions {
  kind: JointKind;
  /** Materialdicke in mm: Tiefe der Zinken und Zapfen, Breite der Schlitze */
  thickness: number;
  /** Fingerzinken: ungefähre Breite eines Zinkens (die Anzahl wird ungerade gerundet) */
  fingerWidth: number;
  /** Fingerzinken: 'in' schneidet in die Kante ein (Teile im Außenmaß gezeichnet), 'out' lässt Zinken herausstehen (Innenmaß) */
  direction: 'in' | 'out';
  /** Fingerzinken: Zinken und Lücken zwischen den beiden Kanten tauschen */
  swap: boolean;
  /** Schlitz und Zapfen: Anzahl und Breite der Zapfen */
  tenonCount: number;
  tenonWidth: number;
  /** Schlitz und Zapfen: Abstand der Schlitzmitte von der gewählten Linie (bei Kanten geschlossener Formen nach innen) */
  slotOffset: number;
  /** Überblattung: Anzahl der Schlitze je Kante (gleichmäßig verteilt, wie bei Rastereinsätzen) */
  lapCount: number;
  /** Überblattung: Schlitztiefe der ersten Kante in % der Plattenbreite; die zweite Kante bekommt den Rest */
  lapDepth: number;
  /** Schnittbreite des Lasers in mm: Zinken/Zapfen werden um so viel breiter, Lücken/Schlitze schmaler gezeichnet */
  kerf: number;
  /** Spiel in mm: positiv = lockerer, negativ = strammer (Press-Fit) */
  clearance: number;
}

export const DEFAULT_JOINT: JointOptions = {
  kind: 'finger', thickness: 3, fingerWidth: 10, direction: 'in', swap: false,
  tenonCount: 2, tenonWidth: 15, slotOffset: 0, lapCount: 1, lapDepth: 50, kerf: 0, clearance: 0,
};

/** Gewählte gerade Kante: Blatt-Objekt, seine Weltmatrix und das Segment in shapeSubs(obj.shape) */
export interface EdgePick {
  obj: Obj;
  m: Mat;
  sub: number;
  seg: number;
}

interface EdgeGeom {
  a: Pt;
  b: Pt;
  len: number;
  /** Einheitsvektor von a nach b */
  dir: Pt;
  /** Einheitsnormale weg vom Material (bei offenen Linien: links der Laufrichtung in Bildschirmsicht) */
  out: Pt;
  closed: boolean;
}

export interface JointResult {
  /** Neue Unterpfade je geändertem Objekt, in Weltkoordinaten */
  changes: Map<Obj, { m: Mat; subs: SubPath[] }>;
  info: string;
  error?: string;
}

const sameEdge = (p: EdgePick, q: EdgePick) => p.obj === q.obj && p.sub === q.sub && p.seg === q.seg;

/** Unterpfade eines Objekts in Weltkoordinaten (Kopie) */
export const worldSubs = (o: Obj, m: Mat): SubPath[] => transformSubs(shapeSubs(o.shape), m);

/** Ist das Segment eine gerade Kante (keine Kurve, nicht entartet)? */
export function isStraight(o: Obj, sub: number, seg: number): boolean {
  const sp = shapeSubs(o.shape)[sub];
  const s = sp && segments(sp)[seg];
  return !!s && !s.curve && Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > 1e-6;
}

/** Geschlossene Unterpfade als Polygone (Kurven fein abgetastet) */
function polygons(subs: SubPath[]): Pt[][] {
  return subs
    .filter((sp) => sp.closed)
    .map((sp) => {
      const pts: Pt[] = [];
      for (const s of segments(sp)) {
        if (!s.curve) pts.push(s.a);
        else for (let i = 0; i < 16; i++) pts.push(bezierPt(s.a, s.c1, s.c2, s.b, i / 16));
      }
      return pts;
    });
}

/** Punkt in der Fläche der geschlossenen Unterpfade (Gerade-Ungerade-Regel)? */
function insideSubs(subs: SubPath[], p: Pt): boolean {
  let inside = false;
  for (const pts of polygons(subs)) {
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i],
        b = pts[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

function edgeGeom(pick: EdgePick, subs: SubPath[]): EdgeGeom {
  const sp = subs[pick.sub];
  const s = segments(sp)[pick.seg];
  const a = { x: s.a.x, y: s.a.y },
    b = { x: s.b.x, y: s.b.y };
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  let out = { x: dir.y, y: -dir.x };
  if (sp.closed) {
    const eps = Math.min(0.05, len * 0.01);
    const probe = { x: (a.x + b.x) / 2 + out.x * eps, y: (a.y + b.y) / 2 + out.y * eps };
    if (insideSubs(subs, probe)) out = { x: -out.x, y: -out.y };
  }
  return { a, b, len, dir, out, closed: sp.closed };
}

/** Abstand von p in Richtung d bis zur nächsten Kontur (Infinity, wenn keine getroffen wird) */
function rayDistance(subs: SubPath[], p: Pt, d: Pt): number {
  let best = Infinity;
  for (const pts of polygons(subs)) {
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[j],
        e = { x: pts[i].x - a.x, y: pts[i].y - a.y };
      const den = d.x * e.y - d.y * e.x;
      if (Math.abs(den) < 1e-12) continue;
      const wx = a.x - p.x,
        wy = a.y - p.y;
      const t = (wx * e.y - wy * e.x) / den,
        u = (wx * d.y - wy * d.x) / den;
      if (t > 1e-6 && u >= 0 && u <= 1) best = Math.min(best, t);
    }
  }
  return best;
}

/** Punkt im Kantensystem (u entlang der Kante ab a, v nach außen) in Weltkoordinaten */
const at = (g: EdgeGeom, u: number, v: number): Pt => ({ x: g.a.x + g.dir.x * u + g.out.x * v, y: g.a.y + g.dir.y * u + g.out.y * v });

/** Ungerade Zinkenanzahl (mindestens 3) möglichst nahe an Länge / Zielbreite */
export function fingerCount(len: number, width: number): number {
  const q = len / Math.max(0.1, width);
  let n = Math.round(q);
  if (n % 2 === 0) n += q >= n ? 1 : -1;
  return Math.max(3, n);
}

/**
 * Profil einer Fingerzinken-Kante im Kantensystem (ohne die Endpunkte a und b).
 * Das Muster (n gleiche Felder) liegt mittig auf der Kante; ist die Kante länger als pattern, verlängern sich die Endfelder.
 * Feld i ist Material, wenn (i + phase) gerade ist. adj verbreitert jedes Materialfeld insgesamt um adj (Kerf − Spiel).
 */
export function fingerProfile(len: number, pattern: number, n: number, phase: 0 | 1, vMat: number, vGap: number, adj: number): Pt[] {
  const w = pattern / n;
  const margin = (len - pattern) / 2;
  const mat = (i: number) => (i + phase) % 2 === 0;
  const level = (i: number) => (mat(i) ? vMat : vGap);
  const pts: Pt[] = [];
  if (level(0) !== 0) pts.push({ x: 0, y: level(0) });
  for (let i = 1; i < n; i++) {
    // Grenze rückt um adj/2 in das Lückenfeld hinein
    const u = margin + i * w + (mat(i - 1) ? adj / 2 : -adj / 2);
    pts.push({ x: u, y: level(i - 1) }, { x: u, y: level(i) });
  }
  if (level(n - 1) !== 0) pts.push({ x: len, y: level(n - 1) });
  return pts;
}

/** Mitten von n Überblattungs-Schlitzen: teilen die Kante in n + 1 gleiche Abschnitte (Fächer eines Rastereinsatzes) */
export const lapCenters = (len: number, n: number) => Array.from({ length: n }, (_, i) => (len * (i + 1)) / (n + 1));

/** Mitten von n gleichmäßig verteilten Zapfen auf einer Kante der Länge len */
export const tenonCenters = (len: number, n: number) => Array.from({ length: n }, (_, i) => (len * (2 * i + 1)) / (2 * n));

const fmt = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',');

/**
 * Verbindung berechnen. Fingerzinken: eine oder zwei Kanten (die zweite bekommt das Gegenstück).
 * Schlitz und Zapfen: erste Kante bekommt die Zapfen, die zweite Linie (Kante oder einzelne Hilfslinie) die Schlitze.
 */
export function computeJoint(picks: EdgePick[], o: JointOptions): JointResult {
  const changes = new Map<Obj, { m: Mat; subs: SubPath[] }>();
  const fail = (error: string): JointResult => ({ changes: new Map(), info: '', error });
  if (!picks.length) return fail('Keine Kante gewählt.');
  if (picks.length > 1 && sameEdge(picks[0], picks[1])) return fail('Zweimal dieselbe Kante gewählt.');
  const t = o.thickness;
  if (!(t > 0)) return fail('Materialdicke muss größer als 0 sein.');
  const adj = o.kerf - o.clearance;

  const subsOf = (p: EdgePick) => {
    let c = changes.get(p.obj);
    if (!c) changes.set(p.obj, (c = { m: p.m, subs: worldSubs(p.obj, p.m) }));
    return c.subs;
  };
  // Geometrie aller Kanten vor jeder Änderung bestimmen
  const geoms = picks.map((p) => edgeGeom(p, subsOf(p)));
  /** Ersetzungen je Objekt; am Ende von hinten nach vorn einfügen, damit die Indizes stimmen */
  const edits: { pick: EdgePick; pts: Pt[] }[] = [];
  const extra = new Map<Obj, SubPath[]>();
  let info: string;

  if (o.kind === 'finger') {
    const pattern = Math.min(...geoms.map((g) => g.len));
    const n = fingerCount(pattern, o.fingerWidth);
    const w = pattern / n;
    if (w - Math.abs(adj) <= 0.05) return fail('Zinken zu schmal für Kerf und Spiel.');
    const [vMat, vGap] = o.direction === 'in' ? [0, -t] : [t, 0];
    geoms.forEach((g, i) => {
      const phase = ((i + (o.swap ? 1 : 0)) % 2) as 0 | 1;
      edits.push({ pick: picks[i], pts: fingerProfile(g.len, pattern, n, phase, vMat, vGap, adj).map((q) => at(g, q.x, q.y)) });
    });
    info = `${n} Felder à ${fmt(w)} mm`;
    if (geoms.length > 1 && Math.abs(geoms[0].len - geoms[1].len) > 0.01)
      info += `. Kanten unterschiedlich lang (${fmt(geoms[0].len)} / ${fmt(geoms[1].len)} mm): Muster liegt mittig auf ${fmt(pattern)} mm`;
  } else if (o.kind === 'lap') {
    const n = Math.max(1, Math.round(o.lapCount));
    const sw = t - adj;
    if (sw <= 0) return fail('Schlitze zu schmal für Kerf und Spiel.');
    const frac = Math.max(1, Math.min(99, o.lapDepth)) / 100;
    const depths: number[] = [];
    for (let i = 0; i < geoms.length; i++) {
      const g = geoms[i];
      if (!g.closed) return fail('Überblattung braucht Kanten geschlossener Formen.');
      const centers = lapCenters(g.len, n);
      if (g.len / (n + 1) <= sw) return fail('Zu viele Schlitze für die Kantenlänge.');
      const inward = { x: -g.out.x, y: -g.out.y };
      const subs = changes.get(picks[i].obj)!.subs;
      const pts: Pt[] = [];
      let minDepth = Infinity;
      for (const c of centers) {
        // Plattenbreite an dieser Stelle: von der Kante bis zur gegenüberliegenden Kontur
        const width = rayDistance(subs, at(g, c, -1e-4), inward);
        if (!isFinite(width)) return fail('Gegenüberliegende Kante nicht gefunden.');
        const d = width * (i === 0 ? frac : 1 - frac);
        minDepth = Math.min(minDepth, d);
        pts.push(at(g, c - sw / 2, 0), at(g, c - sw / 2, -d), at(g, c + sw / 2, -d), at(g, c + sw / 2, 0));
      }
      depths.push(minDepth);
      edits.push({ pick: picks[i], pts });
    }
    info = `${n} Schlitz${n > 1 ? 'e' : ''} je Kante, ${fmt(sw)} mm breit, ${depths.map((d) => `${fmt(d)} mm`).join(' / ')} tief`;
  } else {
    const g = geoms[0];
    const n = Math.max(1, Math.round(o.tenonCount));
    const tw = o.tenonWidth + adj;
    const centers = tenonCenters(g.len, n);
    if (!(o.tenonWidth > 0) || tw * n >= g.len - 0.1) return fail('Zapfen passen nicht auf die Kante (Anzahl × Breite zu groß).');
    const pts: Pt[] = [];
    for (const c of centers) pts.push(at(g, c - tw / 2, 0), at(g, c - tw / 2, t), at(g, c + tw / 2, t), at(g, c + tw / 2, 0));
    edits.push({ pick: picks[0], pts });
    info = `${n} Zapfen à ${fmt(o.tenonWidth)} × ${fmt(t)} mm`;
    if (picks.length > 1) {
      const s = geoms[1];
      // Schlitzmitte: um slotOffset von der Linie versetzt, bei Kanten geschlossener Formen ins Material hinein
      const side = s.closed ? -1 : 1;
      const sl = o.tenonWidth - adj,
        sw = t - adj;
      if (sl <= 0 || sw <= 0) return fail('Schlitze zu klein für Kerf und Spiel.');
      const mid = s.len / 2;
      const slots: SubPath[] = centers.map((c) => {
        const u = mid + c - g.len / 2,
          v = side * o.slotOffset;
        return {
          closed: true,
          nodes: [at(s, u - sl / 2, v - sw / 2), at(s, u + sl / 2, v - sw / 2), at(s, u + sl / 2, v + sw / 2), at(s, u - sl / 2, v + sw / 2)],
        };
      });
      const target = picks[1].obj;
      const tsubs = subsOf(picks[1]);
      // Eine einzelne Hilfslinie wird durch die Schlitze ersetzt
      const guide = tsubs.length === 1 && !tsubs[0].closed && tsubs[0].nodes.length === 2;
      if (guide) tsubs.length = 0;
      extra.set(target, slots);
      info += `, ${n} Schlitz${n > 1 ? 'e' : ''}`;
      if (s.len < g.len - 0.01) info += `. Achtung: Schlitzlinie (${fmt(s.len)} mm) kürzer als die Zapfenkante (${fmt(g.len)} mm)`;
      if (s.closed && o.slotOffset < t / 2 + 0.01) info += '. Achtung: Schlitze reichen bis an die Kante';
    }
  }

  // Kanten ersetzen: je Unterpfad von hinten nach vorn
  edits.sort((p, q) => (p.pick.obj === q.pick.obj && p.pick.sub === q.pick.sub ? q.pick.seg - p.pick.seg : 0));
  for (const e of edits) {
    const subs = changes.get(e.pick.obj)!.subs;
    const sp = subs[e.pick.sub];
    if (!sp) continue; // Hilfslinie wurde durch Schlitze ersetzt
    sp.nodes.splice(segments(sp)[e.pick.seg].ia + 1, 0, ...e.pts.map((p) => ({ x: p.x, y: p.y })));
  }
  for (const [obj, slots] of extra) changes.get(obj)!.subs.push(...slots);
  return { changes, info };
}
