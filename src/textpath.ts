// Text auf Pfad: Glyphen entlang einer Kurve anordnen (wie „Apply Path to Text“ in LightBurn).
// Jede Glyphe wird starr verschoben und gedreht, sodass ihre Mitte auf der Kurve sitzt und ihre Grundlinie
// der Tangente folgt. Starre Transformationen erhalten die Bézierkurven der Schrift exakt.
import { Node, Pt, SubPath, TextPath } from './model';
import { bezierPt, segments } from './curves';

/** Eine Glyphe in Textkoordinaten: Konturen, Mitte auf der Grundlinie (x) und Grundlinie ihrer Zeile (y) */
export interface PlacedGlyph {
  subs: SubPath[];
  cx: number;
  y: number;
}

function deriv(a: Pt, c1: Pt, c2: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: 3 * u * u * (c1.x - a.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (b.x - c2.x),
    y: 3 * u * u * (c1.y - a.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (b.y - c2.y),
  };
}

/** Kurve in umgekehrter Laufrichtung */
export function reverseSub(sp: SubPath): SubPath {
  const nodes = [...sp.nodes].reverse().map((n) => ({ ...n, cin: n.cout, cout: n.cin }));
  // Geschlossen: Anfangspunkt beibehalten, damit „Umkehren“ den Text nur auf die andere Seite legt
  if (sp.closed && nodes.length > 1) nodes.unshift(nodes.pop()!);
  return { closed: sp.closed, nodes };
}

/** Bogenlängen-Tabelle einer Kurve: Punkt und Richtung zu jeder Länge */
export class ArcLength {
  readonly length: number;
  readonly closed: boolean;
  private segs: ReturnType<typeof segments>;
  /** je Stützstelle: Länge, Segment, Parameter */
  private table: { s: number; i: number; t: number }[] = [];

  constructor(sp: SubPath) {
    this.closed = sp.closed;
    this.segs = segments(sp).filter((g) => g.curve || Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) > 1e-9);
    let s = 0;
    this.segs.forEach((g, i) => {
      const n = g.curve ? 48 : 1;
      let prev: Pt = g.a;
      if (!this.table.length) this.table.push({ s: 0, i, t: 0 });
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const p = g.curve ? bezierPt(g.a, g.c1, g.c2, g.b, t) : g.b;
        s += Math.hypot(p.x - prev.x, p.y - prev.y);
        this.table.push({ s, i, t });
        prev = p;
      }
    });
    this.length = s;
  }

  private pointAt(i: number, t: number): { p: Pt; d: Pt } {
    const g = this.segs[i];
    if (!g.curve) return { p: { x: g.a.x + (g.b.x - g.a.x) * t, y: g.a.y + (g.b.y - g.a.y) * t }, d: { x: g.b.x - g.a.x, y: g.b.y - g.a.y } };
    let d = deriv(g.a, g.c1, g.c2, g.b, t);
    // Anfasser auf dem Knoten: Richtung knapp daneben nehmen
    if (Math.hypot(d.x, d.y) < 1e-9) d = deriv(g.a, g.c1, g.c2, g.b, t < 0.5 ? t + 1e-3 : t - 1e-3);
    return { p: bezierPt(g.a, g.c1, g.c2, g.b, t), d };
  }

  /** Punkt und Einheitstangente bei Länge s. Offene Kurven werden an den Enden geradlinig verlängert. */
  at(s: number): { p: Pt; t: Pt } {
    const L = this.length;
    if (!this.segs.length || L <= 0) return { p: { x: 0, y: 0 }, t: { x: 1, y: 0 } };
    if (this.closed) s = ((s % L) + L) % L;
    const unit = (d: Pt) => {
      const l = Math.hypot(d.x, d.y) || 1;
      return { x: d.x / l, y: d.y / l };
    };
    if (!this.closed && (s < 0 || s > L)) {
      const end = s > L;
      const e = end ? this.pointAt(this.segs.length - 1, 1) : this.pointAt(0, 0);
      const tt = unit(e.d);
      const over = end ? s - L : s;
      return { p: { x: e.p.x + tt.x * over, y: e.p.y + tt.y * over }, t: tt };
    }
    const tb = this.table;
    let lo = 0,
      hi = tb.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tb[mid].s <= s) lo = mid;
      else hi = mid;
    }
    const A = tb[lo],
      B = tb[hi];
    const f = B.s > A.s ? (s - A.s) / (B.s - A.s) : 0;
    // Stützstellen über eine Segmentgrenze hinweg: B gehört zum nächsten Segment und beginnt dort bei t = 0
    const i = B.i,
      t0 = A.i === B.i ? A.t : 0;
    const r = this.pointAt(i, t0 + (B.t - t0) * f);
    return { p: r.p, t: unit(r.d) };
  }

  /** Länge bis zum obersten (bzw. untersten) Punkt der Kurve */
  extremeY(lowest: boolean): number {
    let best = 0,
      by = lowest ? -Infinity : Infinity;
    for (const e of this.table) {
      const y = this.pointAt(e.i, e.t).p.y;
      if (lowest ? y > by : y < by) {
        by = y;
        best = e.s;
      }
    }
    return best;
  }
}

/**
 * Anker der Zeile auf der Kurve. Offene Kurven: Anfang, Mitte oder Ende je nach Ausrichtung.
 * Geschlossene Formen haben kein natürliches Ende: Der Anker liegt oben (umgekehrt: unten),
 * links ausgerichteter Text beginnt dort, mittiger sitzt mittig darüber, rechter endet dort.
 */
function anchor(curve: ArcLength, align: 'left' | 'center' | 'right', flip: boolean) {
  if (curve.closed) return curve.extremeY(flip);
  const L = curve.length;
  return align === 'left' ? 0 : align === 'center' ? L / 2 : L;
}

/** Glyphen auf die Kurve setzen (Konturen je Glyphe). Ergebnis in denselben lokalen Koordinaten wie die Kurve. */
export function placeOnPath(glyphs: PlacedGlyph[], tp: TextPath, align: 'left' | 'center' | 'right'): SubPath[][] {
  const curve = new ArcLength(tp.flip ? reverseSub(tp.sub) : tp.sub);
  const base = anchor(curve, align, tp.flip) + tp.offset;
  return glyphs.map((g) => {
    const { p, t: T } = curve.at(base + g.cx);
    // Normale zeigt im y-nach-unten-System auf die Unterseite des Texts
    const N = { x: -T.y, y: T.x };
    const map = (q: Pt): Pt => {
      const u = q.x - g.cx,
        v = q.y - tp.dist;
      return { x: p.x + u * T.x + v * N.x, y: p.y + u * T.y + v * N.y };
    };
    return g.subs.map((sp) => ({
      closed: sp.closed,
      nodes: sp.nodes.map((n): Node => {
        const r: Node = { ...map(n) };
        if (n.cin) r.cin = map(n.cin);
        if (n.cout) r.cout = map(n.cout);
        if (n.smooth) r.smooth = true;
        return r;
      }),
    }));
  });
}
