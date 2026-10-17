// Werkzeuge zum Aufbau von Generator-Konturen: glatte Kurven als kubische Béziers einpassen, Kreisbögen, Linien.
import type { Node, Pt, SubPath } from '../model';
import { bezierPt } from '../curves';

/**
 * Glatte Parameterkurve f(t), t von t0 bis t1, als Folge kubischer Béziers (Hermite-Interpolation mit
 * numerischer Ableitung, Halbierung bis die Abweichung unter tol liegt).
 */
export function fitCurve(f: (t: number) => Pt, t0: number, t1: number, tol: number): [Pt, Pt, Pt][] {
  const span = Math.abs(t1 - t0) || 1;
  const d = (t: number): Pt => {
    const h = span * 1e-5;
    const a = f(t - h),
      b = f(t + h);
    return { x: (b.x - a.x) / (2 * h), y: (b.y - a.y) / (2 * h) };
  };
  const out: [Pt, Pt, Pt][] = [];
  const rec = (a: number, b: number, depth: number) => {
    const pa = f(a),
      pb = f(b);
    const k = (b - a) / 3;
    const da = d(a),
      db = d(b);
    const c1 = { x: pa.x + da.x * k, y: pa.y + da.y * k };
    const c2 = { x: pb.x - db.x * k, y: pb.y - db.y * k };
    let err = 0;
    for (let i = 1; i < 8; i++) {
      const u = i / 8;
      const q = bezierPt(pa, c1, c2, pb, u),
        p = f(a + (b - a) * u);
      err = Math.max(err, Math.hypot(q.x - p.x, q.y - p.y));
    }
    if (err > tol && depth < 12) {
      const m = (a + b) / 2;
      rec(a, m, depth + 1);
      rec(m, b, depth + 1);
    } else out.push([c1, c2, pb]);
  };
  rec(t0, t1, 0);
  return out;
}

/** Baut einen geschlossenen Unterpfad Stück für Stück auf */
export class PathBuilder {
  nodes: Node[] = [];
  private get last(): Node {
    return this.nodes[this.nodes.length - 1];
  }
  private same(p: Pt) {
    const l = this.last;
    return !!l && Math.hypot(l.x - p.x, l.y - p.y) < 1e-7;
  }
  /** Gerade bis p (bzw. erster Punkt) */
  line(p: Pt) {
    if (!this.same(p)) this.nodes.push({ x: p.x, y: p.y });
  }
  cubic(c1: Pt, c2: Pt, p: Pt) {
    if (!this.nodes.length) throw new Error('PathBuilder: kein Anfangspunkt');
    this.last.cout = { x: c1.x, y: c1.y };
    this.nodes.push({ x: p.x, y: p.y, cin: { x: c2.x, y: c2.y } });
  }
  /** Parameterkurve anhängen; der Anfangspunkt wird bei Bedarf mit einer Geraden erreicht */
  curve(f: (t: number) => Pt, t0: number, t1: number, tol: number) {
    if (Math.abs(t1 - t0) < 1e-12) return;
    this.line(f(t0));
    for (const [c1, c2, p] of fitCurve(f, t0, t1, tol)) this.cubic(c1, c2, p);
  }
  /** Kreisbogen um (cx, cy) mit Radius r von Winkel a0 nach a1 (Bogenmaß, mathematisch positiv, y nach oben) */
  arc(cx: number, cy: number, r: number, a0: number, a1: number) {
    const at = (a: number): Pt => ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    this.line(at(a0));
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9));
    const da = (a1 - a0) / n;
    const k = (4 / 3) * Math.tan(da / 4) * r;
    for (let i = 0; i < n; i++) {
      const s = a0 + i * da,
        e = s + da;
      const ps = at(s),
        pe = at(e);
      this.cubic(
        { x: ps.x - k * Math.sin(s), y: ps.y + k * Math.cos(s) },
        { x: pe.x + k * Math.sin(e), y: pe.y - k * Math.cos(e) },
        pe,
      );
    }
  }
  /** Schließen: fällt der letzte Knoten auf den ersten, werden beide zusammengelegt */
  close(): SubPath {
    const ns = this.nodes;
    if (ns.length > 1) {
      const a = ns[0],
        b = ns[ns.length - 1];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) {
        if (b.cin) a.cin = b.cin;
        ns.pop();
      }
    }
    return { nodes: ns, closed: true };
  }
}

/** Unterpfad mit y-Achse nach unten (intern) aus mathematischen Koordinaten (y nach oben) */
export function flipY(sp: SubPath): SubPath {
  const f = (p: Pt) => ({ x: p.x, y: -p.y });
  return {
    closed: sp.closed,
    nodes: sp.nodes.map((n) => ({ ...f(n), ...(n.cin ? { cin: f(n.cin) } : {}), ...(n.cout ? { cout: f(n.cout) } : {}) })),
  };
}

/** Ausdehnung von Unterpfaden (Knoten und Anfasser; bei Kreisbögen bis 90° liegen die Anfasser innerhalb) */
export function subsBounds(subs: SubPath[]) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const sp of subs)
    for (const n of sp.nodes) {
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x);
      y1 = Math.max(y1, n.y);
    }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/** Rechteckigen Umriss (Punkte, y nach unten) als geschlossenen Unterpfad aus Geraden */
export const polySub = (pts: Pt[]): SubPath => ({ closed: true, nodes: pts.map((q) => ({ x: q.x, y: q.y })) });

/**
 * Teile zum Ausschneiden in Reihen nebeneinanderlegen (größte zuerst), ungefähr quadratisch.
 * Die Konturen liegen um ihre Mitte; das Ergebnis ist die Lage jeder Teilmitte, die ganze Anordnung um den Ursprung.
 */
export function packParts(items: { key: string; subs: SubPath[] }[], gap: number): { key: string; subs: SubPath[]; at: Pt }[] {
  const boxes = items.map((it) => ({ ...it, b: subsBounds(it.subs) }));
  const area = boxes.reduce((s, x) => s + (x.b.w + gap) * (x.b.h + gap), 0);
  const limit = Math.max(Math.sqrt(area) * 1.3, ...boxes.map((x) => x.b.w));
  const order = [...boxes].sort((a, b) => b.b.h - a.b.h || b.b.w - a.b.w);
  const placed: { key: string; subs: SubPath[]; at: Pt }[] = [];
  let x = 0,
    y = 0,
    rowH = 0,
    maxW = 0;
  for (const it of order) {
    if (x > 0 && x + it.b.w > limit) {
      y += rowH + gap;
      x = 0;
      rowH = 0;
    }
    placed.push({ key: it.key, subs: it.subs, at: { x: x - it.b.x0, y: y - it.b.y0 } });
    x += it.b.w + gap;
    rowH = Math.max(rowH, it.b.h);
    maxW = Math.max(maxW, x - gap);
  }
  const H = y + rowH;
  // Reihenfolge wie übergeben, Mitte der Anordnung im Ursprung
  const byKey = new Map(placed.map((p) => [p.key, p]));
  return items.map((it) => {
    const p = byKey.get(it.key)!;
    return { ...p, at: { x: p.at.x - maxW / 2, y: p.at.y - H / 2 } };
  });
}
