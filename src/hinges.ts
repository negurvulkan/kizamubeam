// Biegeschnitte (Living Hinges): ein Schnittmuster füllt eine gewählte geschlossene Form, damit sich die Platte
// an dieser Stelle biegen lässt.
// Etappe 1: gerade Schnitte im Mauerwerk-Versatz und Wellen. Die Schnitte laufen in Zeilen parallel zur Biegeachse;
// zwischen zwei Schnitten einer Zeile bleibt ein Steg stehen, jede zweite Zeile ist um eine halbe Teilung versetzt.
// Gerechnet wird in Weltkoordinaten (mm). Jede Zeile wird einmal mit der (um den Rand verkleinerten) Form
// geschnitten; das ergibt die Abschnitte, in denen geschnitten werden darf. Die Schnitte selbst werden danach exakt
// erzeugt: gerade Linien bzw. Wellen als kubische Béziers (Hermite-Stücke je Achtelwelle), keine Polylinien.
import ClipperLib from 'clipper-lib';
import { Node, Obj, Pt, SubPath } from './model';
import { region, SCALE } from './ops';

export type HingeKind = 'straight' | 'wave';
export type HingeOrient = 'auto' | 'vertical' | 'horizontal' | 'angle';

export interface HingeOptions {
  kind: HingeKind;
  /** Materialdicke in mm (nur für den Werte-Vorschlag) */
  thickness: number;
  /** Länge eines Schnitts in mm */
  cutLength: number;
  /** Stegbreite: Material zwischen dem Ende eines Schnitts und dem Beginn des nächsten (mm) */
  bridge: number;
  /** Zeilenabstand: Abstand der Schnittlinien zueinander (mm) */
  spacing: number;
  /** Abstand der Schnitte zum Umriss der Form (mm) */
  margin: number;
  /** Richtung der Schnitte: automatisch längs der längeren Seite, senkrecht, waagerecht oder freier Winkel */
  orient: HingeOrient;
  /** Winkel der Schnitte in Grad, gegen den Uhrzeigersinn, 0 = waagerecht (nur bei orient = 'angle') */
  angle: number;
  /** Wellen: Höhe (Amplitude, mm) und Wellenlänge (mm) */
  waveAmp: number;
  waveLength: number;
  /** Gewählte Form behalten (sonst wird sie durch das Muster ersetzt) */
  keepOutline: boolean;
}

export const DEFAULT_HINGE: HingeOptions = {
  kind: 'straight', thickness: 3, cutLength: 20, bridge: 3, spacing: 1.5, margin: 3,
  orient: 'auto', angle: 90, waveAmp: 1, waveLength: 8, keepOutline: false,
};

export const HINGE_KINDS: [HingeKind, string][] = [
  ['straight', 'Gerade Schnitte (Mauerwerk)'],
  ['wave', 'Wellen'],
];

/** Startwerte für eine Materialdicke: Steg ≈ Dicke, Zeilenabstand ≈ halbe Dicke */
export function suggestHinge(t: number): Partial<HingeOptions> {
  const r = (v: number) => Math.round(v * 10) / 10;
  return { bridge: r(Math.max(2, t)), spacing: r(Math.max(1, t / 2)), cutLength: r(Math.max(15, 6 * t)), margin: r(Math.max(2, t)), waveAmp: r(Math.max(0.5, t / 3)), waveLength: r(Math.max(5, 2.5 * t)) };
}

export interface HingeResult {
  subs: SubPath[];
  info: string;
  error?: string;
}

/** Höchstzahl der Schnitte (Schutz vor versehentlich riesigen Mustern) */
export const MAX_CUTS = 50000;

type Path = ClipperLib.Path;
type Paths = ClipperLib.Paths;
const { Clipper, ClipType, PolyType, PolyFillType, ClipperOffset, JoinType, EndType, PolyTree } = ClipperLib;

const de = (v: number, d = 1) => v.toFixed(d).replace('.', ',');

/** Fläche, in der geschnitten wird: alle gewählten Formen vereint, um den Rand verkleinert */
function hingeArea(objs: Obj[], margin: number): Paths {
  const all: Paths = [];
  for (const o of objs) all.push(...region(o));
  const c = new Clipper();
  c.AddPaths(all, PolyType.ptSubject, true);
  const union: Paths = [];
  c.Execute(ClipType.ctUnion, union, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  if (margin <= 0 || !union.length) return union;
  const co = new ClipperOffset(2, 0.0025 * SCALE);
  co.AddPaths(union, JoinType.jtMiter, EndType.etClosedPolygon);
  const out: Paths = [];
  co.Execute(out, -margin * SCALE);
  return out;
}

/** Abschnitte [a, b] entlang u, in denen die Zeile in der Fläche liegt */
function rowIntervals(area: Paths, line: Path, toU: (p: ClipperLib.IntPoint) => number): [number, number][] {
  const c = new Clipper();
  c.AddPath(line, PolyType.ptSubject, false);
  c.AddPaths(area, PolyType.ptClip, true);
  const tree = new PolyTree();
  c.Execute(ClipType.ctIntersection, tree, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  const iv = Clipper.OpenPathsFromPolyTree(tree).map((p): [number, number] => {
    const us = p.map(toU);
    return [Math.min(...us), Math.max(...us)];
  });
  iv.sort((x, y) => x[0] - y[0]);
  // Berührende Stücke zusammenfassen
  const out: [number, number][] = [];
  for (const [a, b] of iv) {
    const l = out[out.length - 1];
    if (l && a <= l[1] + 1e-3) l[1] = Math.max(l[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Knoten umkehren (Laufrichtung tauschen) */
function reverseNodes(nodes: Node[]): Node[] {
  return nodes.reverse().map((n) => {
    const q: Node = { x: n.x, y: n.y };
    if (n.cout) q.cin = n.cout;
    if (n.cin) q.cout = n.cin;
    if (n.smooth) q.smooth = true;
    return q;
  });
}

export function computeHinge(objs: Obj[], o: HingeOptions): HingeResult {
  const fail = (error: string): HingeResult => ({ subs: [], info: '', error });
  if (!objs.length) return fail('Erst eine geschlossene Form auswählen, die das Muster füllen soll.');
  if (!(o.cutLength > 0)) return fail('Die Schnittlänge muss größer als 0 sein.');
  if (!(o.bridge >= 0.3)) return fail('Die Stegbreite muss mindestens 0,3 mm betragen.');
  if (!(o.spacing >= 0.3)) return fail('Der Zeilenabstand muss mindestens 0,3 mm betragen.');
  if (o.kind === 'wave' && !(o.waveLength >= 1)) return fail('Die Wellenlänge muss mindestens 1 mm betragen.');
  if (o.kind === 'wave' && !(o.waveAmp >= 0)) return fail('Die Wellenhöhe darf nicht negativ sein.');

  const area = hingeArea(objs, Math.max(0, o.margin));
  if (!area.length) return fail(o.margin > 0 ? 'Der Rand ist zu groß für die Form, es bleibt keine Fläche übrig.' : 'Keine geschlossene Form gewählt.');

  // Ausdehnung der Fläche in Weltkoordinaten
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of area) for (const q of p) {
    x0 = Math.min(x0, q.X); x1 = Math.max(x1, q.X);
    y0 = Math.min(y0, q.Y); y1 = Math.max(y1, q.Y);
  }
  // Richtung der Schnitte (Welt, y nach unten): u längs der Schnitte, v quer dazu
  const th =
    o.orient === 'horizontal' ? 0
    : o.orient === 'vertical' ? Math.PI / 2
    : o.orient === 'angle' ? (-o.angle * Math.PI) / 180
    : x1 - x0 >= y1 - y0 ? 0 : Math.PI / 2;
  const U: Pt = { x: Math.cos(th), y: Math.sin(th) },
    V: Pt = { x: -Math.sin(th), y: Math.cos(th) };
  const toU = (q: ClipperLib.IntPoint) => (q.X * U.x + q.Y * U.y) / SCALE;
  const toV = (q: ClipperLib.IntPoint) => (q.X * V.x + q.Y * V.y) / SCALE;
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (const p of area) for (const q of p) {
    const u = toU(q), v = toV(q);
    umin = Math.min(umin, u); umax = Math.max(umax, u);
    vmin = Math.min(vmin, v); vmax = Math.max(vmax, v);
  }
  const uc = (umin + umax) / 2, vc = (vmin + vmax) / 2;
  const wave = o.kind === 'wave' && o.waveAmp > 0;
  const A = wave ? o.waveAmp : 0;
  const k = (2 * Math.PI) / o.waveLength;
  /** Versatz der Welle quer zur Zeile; die Phase hängt nur von u ab, so laufen alle Zeilen parallel und kreuzen sich nie */
  const f = (u: number) => A * Math.sin(k * (u - uc));
  const df = (u: number) => A * k * Math.cos(k * (u - uc));
  const W = (u: number, v: number): Pt => {
    const w = v + f(u);
    return { x: u * U.x + w * V.x, y: u * U.y + w * V.y };
  };

  const K = Math.floor(((vmax - vmin) / 2 + A) / o.spacing);
  const P = o.cutLength + o.bridge;
  const est = (2 * K + 1) * Math.ceil((umax - umin) / P + 1);
  if (est > MAX_CUTS * 1.5) return fail(`Zu viele Schnitte (etwa ${est.toLocaleString('de-DE')}, höchstens ${MAX_CUTS.toLocaleString('de-DE')}): Zeilenabstand oder Schnittlänge vergrößern.`);

  /** Mindestlänge eines am Rand gekürzten Schnitts; kürzere Reste entfallen */
  const minPiece = Math.max(0.5, Math.min(o.bridge, o.cutLength / 2));
  const step = wave ? Math.min(o.waveLength / 16, 0.5) : 0;

  const makeCut = (v: number, a: number, b: number, rev: boolean): SubPath => {
    let nodes: Node[];
    if (!wave) nodes = [W(a, v), W(b, v)];
    else {
      // Stützstellen an jeder Achtelwelle (Hermite-Kubik weicht dort um weniger als 0,1 % der Wellenhöhe ab)
      const q = o.waveLength / 8;
      const ts = [a];
      for (let t = uc + Math.ceil((a - uc) / q + 1e-9) * q; t < b - 1e-6; t += q) if (t > a + 1e-6) ts.push(t);
      ts.push(b);
      const tan = (u: number): Pt => {
        const s = df(u);
        return { x: U.x + s * V.x, y: U.y + s * V.y };
      };
      nodes = ts.map((t) => ({ ...W(t, v) }));
      for (let i = 0; i + 1 < ts.length; i++) {
        const d = (ts[i + 1] - ts[i]) / 3,
          t0 = tan(ts[i]),
          t1 = tan(ts[i + 1]);
        const p0 = nodes[i],
          p1 = nodes[i + 1];
        p0.cout = { x: p0.x + d * t0.x, y: p0.y + d * t0.y };
        p1.cin = { x: p1.x - d * t1.x, y: p1.y - d * t1.y };
        if (i > 0) p0.smooth = true;
      }
    }
    return { closed: false, nodes: rev ? reverseNodes(nodes) : nodes };
  };

  const subs: SubPath[] = [];
  let rows = 0,
    total = 0;
  for (let r = -K; r <= K; r++) {
    const v = vc + r * o.spacing;
    // Zeile als Linienzug über die ganze Fläche, etwas länger als nötig
    const line: Path = [];
    const ua = umin - 1, ub = umax + 1;
    const n = wave ? Math.ceil((ub - ua) / step) : 1;
    for (let i = 0; i <= n; i++) {
      const p = W(ua + ((ub - ua) * i) / n, v);
      line.push({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) });
    }
    const iv = rowIntervals(area, line, toU);
    if (!iv.length) continue;
    // Mauerwerk: jede zweite Zeile um eine halbe Teilung versetzt
    const shift = Math.abs(r) % 2 ? P / 2 : 0;
    const jA = Math.floor((umin - uc - shift) / P) - 1,
      jB = Math.ceil((umax - uc - shift) / P) + 1;
    const row: [number, number][] = [];
    for (let j = jA; j <= jB; j++) {
      const c = uc + shift + j * P;
      const a = c - o.cutLength / 2,
        b = c + o.cutLength / 2;
      for (const [ia, ib] of iv) {
        const s = Math.max(a, ia),
          e = Math.min(b, ib);
        if (e - s >= minPiece - 1e-6) row.push([s, e]);
      }
    }
    if (!row.length) continue;
    // Zeilen abwechselnd hin und zurück, damit der Laser wenig Leerweg fährt
    const rev = rows % 2 === 1;
    if (rev) row.reverse();
    for (const [s, e] of row) {
      subs.push(makeCut(v, s, e, rev));
      total += e - s;
    }
    rows++;
    if (subs.length > MAX_CUTS) return fail(`Zu viele Schnitte (höchstens ${MAX_CUTS.toLocaleString('de-DE')}): Zeilenabstand oder Schnittlänge vergrößern.`);
  }
  if (!subs.length) return fail('Die Form ist zu klein für das Muster: Rand, Schnittlänge oder Stegbreite verkleinern.');
  if (wave) {
    // Schräg verlaufende Wellen rücken näher zusammen als der Zeilenabstand
    const eff = o.spacing * Math.cos(Math.atan(A * k));
    return { subs, info: `${subs.length} Schnitte in ${rows} Zeilen, kleinster Abstand zwischen den Wellen ${de(eff, 2)} mm` };
  }
  return { subs, info: `${subs.length} Schnitte in ${rows} Zeilen, zusammen ${de(total / 1000, 2)} m Schnittlänge` };
}
