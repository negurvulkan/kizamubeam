// Biegeschnitte (Living Hinges): ein Schnittmuster füllt eine gewählte geschlossene Form, damit sich die Platte
// an dieser Stelle biegen lässt.
// Gerade Schnitte im Mauerwerk-Versatz und Wellen laufen in Zeilen parallel zur Biegeachse; zwischen zwei Schnitten
// einer Zeile bleibt ein Steg stehen, jede zweite Zeile ist um eine halbe Teilung versetzt.
// Rauten, Waben und Dreiecke sind Gitter aus geraden Schnitten mit Stegen an jedem Knoten, das Flechtmuster wechselt
// die Schnittrichtung schachbrettartig (biegsam in zwei Richtungen). Die Spirale ist ein einziger Schnitt von innen
// nach außen, der die Platte wie eine Feder ausziehbar macht.
// Gerechnet wird in Weltkoordinaten (mm). Jede Zeile wird einmal mit der (um den Rand verkleinerten) Form
// geschnitten; das ergibt die Abschnitte, in denen geschnitten werden darf. Die Schnitte selbst werden danach exakt
// erzeugt: gerade Linien bzw. Wellen als kubische Béziers (Hermite-Stücke je Achtelwelle), keine Polylinien.
import ClipperLib from 'clipper-lib';
import { Node, Obj, Pt, SubPath } from './model';
import { region, SCALE } from './ops';
import { dec, locale, t } from './i18n';

export type HingeKind = 'straight' | 'wave' | 'diamond' | 'honeycomb' | 'triangle' | 'cross' | 'spiral';
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
  /** Rauten: spitzer Winkel der Rauten in Grad (an den Ecken in Schnittrichtung) */
  diamondAngle: number;
  /** Gewählte Form behalten (sonst wird sie durch das Muster ersetzt) */
  keepOutline: boolean;
}

export const DEFAULT_HINGE: HingeOptions = {
  kind: 'straight', thickness: 3, cutLength: 20, bridge: 3, spacing: 1.5, margin: 3,
  orient: 'auto', angle: 90, waveAmp: 1, waveLength: 8, diamondAngle: 60, keepOutline: false,
};

export const HINGE_KINDS: [HingeKind, string][] = [
  ['straight', t('Gerade Schnitte (Mauerwerk)')],
  ['wave', t('Wellen')],
  ['diamond', t('Rauten (Diamant)')],
  ['honeycomb', t('Waben')],
  ['triangle', t('Dreiecke (3D)')],
  ['cross', t('Kreuz / Flechtmuster (3D)')],
  ['spiral', t('Spirale')],
];

/** Gittermuster aus geraden Schnitten mit Stegen an den Knoten */
const LATTICE: HingeKind[] = ['diamond', 'honeycomb', 'triangle', 'cross'];

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

const de = (v: number, d = 1) => dec(v.toFixed(d));

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
  if (!objs.length) return fail(t('Erst eine geschlossene Form auswählen, die das Muster füllen soll.'));
  if (o.kind !== 'spiral' && !(o.cutLength > 0)) return fail(t('Die Schnittlänge muss größer als 0 sein.'));
  if (o.kind !== 'spiral' && !(o.bridge >= 0.3)) return fail(t('Die Stegbreite muss mindestens 0,3 mm betragen.'));
  if (o.kind === 'diamond' && !(o.diamondAngle >= 10 && o.diamondAngle <= 170)) return fail(t('Der Rautenwinkel muss zwischen 10° und 170° liegen.'));
  if ((o.kind !== 'diamond' && o.kind !== 'honeycomb' && o.kind !== 'triangle') && !(o.spacing >= 0.3)) return fail(t('Der Zeilenabstand muss mindestens 0,3 mm betragen.'));
  if (o.kind === 'wave' && !(o.waveLength >= 1)) return fail(t('Die Wellenlänge muss mindestens 1 mm betragen.'));
  if (o.kind === 'wave' && !(o.waveAmp >= 0)) return fail(t('Die Wellenhöhe darf nicht negativ sein.'));

  const area = hingeArea(objs, Math.max(0, o.margin));
  if (!area.length) return fail(o.margin > 0 ? t('Der Rand ist zu groß für die Form, es bleibt keine Fläche übrig.') : t('Keine geschlossene Form gewählt.'));

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
  if (o.kind === 'spiral') return spiralHinge(area, o, { x: (x0 + x1) / 2 / SCALE, y: (y0 + y1) / 2 / SCALE });
  if (LATTICE.includes(o.kind)) return latticeHinge(area, o, U, V, uc, vc, (umax - umin) / 2, (vmax - vmin) / 2);
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
  if (est > MAX_CUTS * 1.5) return fail(t('Zu viele Schnitte (etwa {est}, höchstens {MAX_CUTS}): Zeilenabstand oder Schnittlänge vergrößern.', { est: est.toLocaleString(locale), MAX_CUTS: MAX_CUTS.toLocaleString(locale) }));

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
    if (subs.length > MAX_CUTS) return fail(t('Zu viele Schnitte (höchstens {MAX_CUTS}): Zeilenabstand oder Schnittlänge vergrößern.', { MAX_CUTS: MAX_CUTS.toLocaleString(locale) }));
  }
  if (!subs.length) return fail(t('Die Form ist zu klein für das Muster: Rand, Schnittlänge oder Stegbreite verkleinern.'));
  if (wave) {
    // Schräg verlaufende Wellen rücken näher zusammen als der Zeilenabstand
    const eff = o.spacing * Math.cos(Math.atan(A * k));
    return { subs, info: t('{subs} Schnitte in {rows} Zeilen, kleinster Abstand zwischen den Wellen {eff} mm', { subs: subs.length, rows, eff: de(eff, 2) }) };
  }
  return { subs, info: t('{subs} Schnitte in {rows} Zeilen, zusammen {total} m Schnittlänge', { subs: subs.length, rows, total: de(total / 1000, 2) }) };
}

/** Gerade Schnitte (u, v relativ zur Mitte) in die Fläche schneiden; zu kurze Reste entfallen */
function clipSegments(area: Paths, segs: [number, number, number, number][], toWorld: (u: number, v: number) => Pt, minPiece: number) {
  const ip = (p: Pt) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) });
  const c = new Clipper();
  for (const [u0, v0, u1, v1] of segs) c.AddPath([ip(toWorld(u0, v0)), ip(toWorld(u1, v1))], PolyType.ptSubject, false);
  c.AddPaths(area, PolyType.ptClip, true);
  const tree = new PolyTree();
  c.Execute(ClipType.ctIntersection, tree, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  const out: { a: Pt; b: Pt }[] = [];
  for (const p of Clipper.OpenPathsFromPolyTree(tree)) {
    if (p.length < 2) continue;
    const a = { x: p[0].X / SCALE, y: p[0].Y / SCALE },
      b = { x: p[p.length - 1].X / SCALE, y: p[p.length - 1].Y / SCALE };
    if (Math.hypot(b.x - a.x, b.y - a.y) >= minPiece - 1e-6) out.push({ a, b });
  }
  return out;
}

function latticeHinge(area: Paths, o: HingeOptions, U: Pt, V: Pt, uc: number, vc: number, hu: number, hv: number): HingeResult {
  const L = o.cutLength,
    g = o.bridge,
    e = L + g;
  /** Gerade Schnitte als [u0, v0, u1, v1] relativ zur Mitte */
  const segs: [number, number, number, number][] = [];
  /** Kante zwischen zwei Gitterknoten, an beiden Enden um den halben Steg gekürzt */
  const edge = (ax: number, ay: number, bx: number, by: number) => {
    const d = Math.hypot(bx - ax, by - ay);
    if (d <= g) return;
    const t = g / 2 / d;
    segs.push([ax + (bx - ax) * t, ay + (by - ay) * t, bx - (bx - ax) * t, by - (by - ay) * t]);
  };
  // Grobe Schätzung vorab, damit riesige Muster gar nicht erst entstehen
  const cellArea = o.kind === 'cross' ? (e * o.spacing) : e * e * 0.4;
  const est = ((2 * hu + 2 * e) * (2 * hv + 2 * e)) / cellArea;
  if (est > MAX_CUTS * 1.5) return { subs: [], info: '', error: t('Zu viele Schnitte (etwa {est}, höchstens {MAX_CUTS}): Schnittlänge oder Zeilenabstand vergrößern.', { est: Math.round(est).toLocaleString(locale), MAX_CUTS: MAX_CUTS.toLocaleString(locale) }) };

  if (o.kind === 'diamond') {
    const a = (o.diamondAngle * Math.PI) / 360;
    const dx = e * Math.cos(a), dy = e * Math.sin(a);
    const J = Math.ceil(hv / dy) + 1, I = Math.ceil(hu / (2 * dx)) + 1;
    for (let j = -J; j <= J; j++)
      for (let i = -I; i <= I; i++) {
        const x = 2 * dx * i + (Math.abs(j) % 2 ? dx : 0), y = dy * j;
        edge(x, y, x + dx, y + dy);
        edge(x, y, x + dx, y - dy);
      }
  } else if (o.kind === 'triangle') {
    const hh = (e * Math.sqrt(3)) / 2;
    const J = Math.ceil(hv / hh) + 1, I = Math.ceil(hu / e) + 1;
    for (let j = -J; j <= J; j++)
      for (let i = -I; i <= I; i++) {
        const x = e * i + (Math.abs(j) % 2 ? e / 2 : 0), y = hh * j;
        edge(x, y, x + e, y);
        edge(x, y, x + e / 2, y + hh);
        edge(x, y, x - e / 2, y + hh);
      }
  } else if (o.kind === 'honeycomb') {
    // Sechsecke mit waagerechter Ober- und Unterkante; je Wabe die drei oberen Kanten, die unteren gehören den Nachbarn
    const s3 = Math.sqrt(3) * e;
    const I = Math.ceil(hu / (1.5 * e)) + 1, J = Math.ceil(hv / s3) + 1;
    const P = (cx: number, cy: number, k: number) => [cx + e * Math.cos((k * Math.PI) / 3), cy - e * Math.sin((k * Math.PI) / 3)];
    for (let i = -I; i <= I; i++)
      for (let j = -J; j <= J; j++) {
        const cx = 1.5 * e * i, cy = s3 * j + (Math.abs(i) % 2 ? s3 / 2 : 0);
        for (let k = 0; k < 3; k++) {
          const [ax, ay] = P(cx, cy, k), [bx, by] = P(cx, cy, k + 1);
          edge(ax, ay, bx, by);
        }
      }
  } else {
    // Flechtmuster: quadratische Felder, abwechselnd längs und quer geschnitten
    const n = Math.floor((e / 2 - g / 2) / o.spacing + 1e-9);
    const I = Math.ceil(hu / e) + 1, J = Math.ceil(hv / e) + 1;
    for (let i = -I; i <= I; i++)
      for (let j = -J; j <= J; j++) {
        const cx = e * i, cy = e * j;
        for (let t = -n; t <= n; t++) {
          if ((i + j) % 2 === 0) segs.push([cx - L / 2, cy + t * o.spacing, cx + L / 2, cy + t * o.spacing]);
          else segs.push([cx + t * o.spacing, cy - L / 2, cx + t * o.spacing, cy + L / 2]);
        }
      }
  }
  const toWorld = (u: number, v: number): Pt => {
    const uu = uc + u, vv = vc + v;
    return { x: uu * U.x + vv * V.x, y: uu * U.y + vv * V.y };
  };
  const minPiece = Math.max(0.5, Math.min(g, L / 2));
  const cuts = clipSegments(area, segs, toWorld, minPiece);
  if (!cuts.length) return { subs: [], info: '', error: t('Die Form ist zu klein für das Muster: Rand, Schnittlänge oder Stegbreite verkleinern.') };
  if (cuts.length > MAX_CUTS) return { subs: [], info: '', error: t('Zu viele Schnitte (höchstens {MAX_CUTS}): Schnittlänge oder Zeilenabstand vergrößern.', { MAX_CUTS: MAX_CUTS.toLocaleString(locale) }) };
  // Grob zeilenweise sortieren, damit der Laser nicht kreuz und quer springt
  const key = (p: Pt) => p.x * V.x + p.y * V.y;
  const row = Math.max(1, o.kind === 'cross' ? e : L / 2);
  cuts.sort((x, y) => Math.floor(key(x.a) / row) - Math.floor(key(y.a) / row) || x.a.x * U.x + x.a.y * U.y - (y.a.x * U.x + y.a.y * U.y));
  let total = 0;
  const subs = cuts.map(({ a, b }): SubPath => {
    total += Math.hypot(b.x - a.x, b.y - a.y);
    return { closed: false, nodes: [{ ...a }, { ...b }] };
  });
  return { subs, info: t('{subs} Schnitte, zusammen {total} m Schnittlänge', { subs: subs.length, total: de(total / 1000, 2) }) };
}

/** Archimedische Spirale r = r0 + b·θ um die Mitte der Fläche, als Bézierkurve (Hermite-Stücke je Achteldrehung) */
function spiralHinge(area: Paths, o: HingeOptions, c: Pt): HingeResult {
  const b = o.spacing / (2 * Math.PI),
    r0 = o.spacing;
  let rmax = 0;
  for (const p of area) for (const q of p) rmax = Math.max(rmax, Math.hypot(q.X / SCALE - c.x, q.Y / SCALE - c.y));
  const tmax = (rmax - r0) / b + Math.PI / 4;
  if (tmax <= 0) return { subs: [], info: '', error: t('Die Form ist zu klein für eine Spirale: Rand oder Zeilenabstand verkleinern.') };
  if (tmax / (2 * Math.PI) > 5000) return { subs: [], info: '', error: t('Zu viele Windungen: Zeilenabstand vergrößern.') };
  const r = (t: number) => r0 + b * t;
  const P = (t: number): Pt => ({ x: c.x + r(t) * Math.cos(t), y: c.y + r(t) * Math.sin(t) });
  const D = (t: number): Pt => ({ x: b * Math.cos(t) - r(t) * Math.sin(t), y: b * Math.sin(t) + r(t) * Math.cos(t) });
  // Winkel eines Punkts: Richtung genau, Anzahl der Umdrehungen aus dem Radius
  const angleOf = (q: ClipperLib.IntPoint) => {
    const x = q.X / SCALE - c.x, y = q.Y / SCALE - c.y;
    const phi = Math.atan2(y, x), coarse = (Math.hypot(x, y) - r0) / b;
    return phi + 2 * Math.PI * Math.round((coarse - phi) / (2 * Math.PI));
  };
  // Spirale fein zerlegen und Windung für Windung mit der Fläche schneiden (eine lange Spirale auf einmal wäre für
  // Clipper sehr langsam). Schrittweite so, dass die Sehnen höchstens 0,005 mm von der Kurve abweichen.
  const all: [number, number][] = [];
  for (let t0 = 0; t0 < tmax; t0 += 2 * Math.PI) {
    const t1 = Math.min(tmax, t0 + 2 * Math.PI);
    const line: Path = [];
    for (let t = t0; ; t += Math.min(Math.PI / 16, Math.sqrt(0.04 / r(t)))) {
      const p = P(Math.min(t, t1));
      line.push({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) });
      if (t >= t1) break;
    }
    all.push(...rowIntervals(area, line, angleOf));
  }
  // Stücke an den Windungsgrenzen wieder zusammenfügen
  const iv: [number, number][] = [];
  for (const [a, z] of all.sort((x, y) => x[0] - y[0])) {
    const l = iv[iv.length - 1];
    if (l && a <= l[1] + 1e-4) l[1] = Math.max(l[1], z);
    else iv.push([Math.max(0, a), Math.min(tmax, z)]);
  }
  const subs: SubPath[] = [];
  let total = 0;
  for (const [a, z] of iv) {
    const len = ((r(a) + r(z)) / 2) * (z - a);
    if (len < 1) continue;
    const q = Math.PI / 4;
    const ts = [a];
    for (let t = Math.ceil(a / q + 1e-9) * q; t < z - 1e-6; t += q) if (t > a + 1e-6) ts.push(t);
    ts.push(z);
    const nodes: Node[] = ts.map((t) => ({ ...P(t) }));
    for (let i = 0; i + 1 < ts.length; i++) {
      const d = (ts[i + 1] - ts[i]) / 3, d0 = D(ts[i]), d1 = D(ts[i + 1]);
      const p0 = nodes[i], p1 = nodes[i + 1];
      p0.cout = { x: p0.x + d * d0.x, y: p0.y + d * d0.y };
      p1.cin = { x: p1.x - d * d1.x, y: p1.y - d * d1.y };
      if (i > 0) p0.smooth = true;
    }
    subs.push({ closed: false, nodes });
    total += len;
  }
  if (!subs.length) return { subs: [], info: '', error: t('Die Form ist zu klein für eine Spirale: Rand oder Zeilenabstand verkleinern.') };
  const turns = iv.length ? (iv[iv.length - 1][1] - iv[0][0]) / (2 * Math.PI) : 0;
  return { subs, info: subs.length > 1
    ? t('Spirale mit {turns} Windungen in {pieces} Stücken, zusammen {length} m Schnittlänge', { turns: de(turns, 1), pieces: subs.length, length: de(total / 1000, 2) })
    : t('Spirale mit {turns} Windungen, zusammen {length} m Schnittlänge', { turns: de(turns, 1), length: de(total / 1000, 2) }) };
}
