// Geometrie: Formen in Pfade umwandeln, Begrenzungsrahmen, Text-Layout, Treffertest.
import { apply, IDENT, inv, mul, Mat, Node, Obj, Pt, Shape, SubPath, TextShape } from './model';
import { loadedFont, onFontLoaded, textLines, textToSubs } from './fonts';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const K = 0.5522847498; // Bézier-Näherung für Viertelkreise

/** Grundformen als Knotenpfade (lokale Koordinaten). */
export function shapeSubs(s: Shape): SubPath[] {
  switch (s.kind) {
    case 'path':
      return s.subs;
    case 'image':
      // Umriss des Bildes (für Begrenzung, Auswahl und Rahmen)
      return [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: s.w, y: 0 }, { x: s.w, y: s.h }, { x: 0, y: s.h }] }];
    case 'rect': {
      const { w, h } = s;
      const r = Math.max(0, Math.min(s.r, Math.abs(w) / 2, Math.abs(h) / 2));
      if (r <= 0)
        return [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] }];
      const k = r * K;
      return [
        {
          closed: true,
          nodes: [
            { x: r, y: 0, cin: { x: r - k, y: 0 } },
            { x: w - r, y: 0, cout: { x: w - r + k, y: 0 } },
            { x: w, y: r, cin: { x: w, y: r - k } },
            { x: w, y: h - r, cout: { x: w, y: h - r + k } },
            { x: w - r, y: h, cin: { x: w - r + k, y: h } },
            { x: r, y: h, cout: { x: r - k, y: h } },
            { x: 0, y: h - r, cin: { x: 0, y: h - r + k } },
            { x: 0, y: r, cout: { x: 0, y: r - k } },
          ],
        },
      ];
    }
    case 'ellipse': {
      const { rx, ry } = s;
      const kx = rx * K,
        ky = ry * K;
      return [
        {
          closed: true,
          nodes: [
            { x: rx, y: 0, cin: { x: rx, y: -ky }, cout: { x: rx, y: ky }, smooth: true },
            { x: 0, y: ry, cin: { x: kx, y: ry }, cout: { x: -kx, y: ry }, smooth: true },
            { x: -rx, y: 0, cin: { x: -rx, y: ky }, cout: { x: -rx, y: -ky }, smooth: true },
            { x: 0, y: -ry, cin: { x: -kx, y: -ry }, cout: { x: kx, y: -ry }, smooth: true },
          ],
        },
      ];
    }
    case 'polygon': {
      const n = Math.max(3, Math.round(s.sides));
      const nodes: Node[] = [];
      const count = s.star ? n * 2 : n;
      for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / count;
        const r = s.star && i % 2 === 1 ? s.r * s.inner : s.r;
        nodes.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
      }
      return [{ closed: true, nodes }];
    }
    default:
      return [];
  }
}

export function subsToPath2D(subs: SubPath[], p = new Path2D()): Path2D {
  for (const sp of subs) {
    const ns = sp.nodes;
    if (!ns.length) continue;
    p.moveTo(ns[0].x, ns[0].y);
    const seg = (a: Node, b: Node) => {
      if (a.cout || b.cin) {
        const c1 = a.cout ?? a,
          c2 = b.cin ?? b;
        p.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
      } else p.lineTo(b.x, b.y);
    };
    for (let i = 1; i < ns.length; i++) seg(ns[i - 1], ns[i]);
    if (sp.closed && ns.length > 1) {
      seg(ns[ns.length - 1], ns[0]);
      p.closePath();
    }
  }
  return p;
}

const localCache = new WeakMap<Shape, Path2D>();
/** Lokaler Pfad, zwischengespeichert pro Form-Objekt. Nach Änderung invalidate() aufrufen. */
export function localPath(s: Shape): Path2D {
  let p = localCache.get(s);
  if (!p) {
    p = subsToPath2D(shapeSubs(s));
    localCache.set(s, p);
  }
  return p;
}
export function invalidate(s: Shape) {
  localCache.delete(s);
}

export function worldPath(s: Shape, m: Mat): Path2D {
  const p = new Path2D();
  p.addPath(localPath(s), new DOMMatrix(m));
  return p;
}

export function bezierPt(a: Pt, c1: Pt, c2: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
  };
}

/** Segmente eines Unterpfads: [a, b, c1, c2, isCurve, indexA, indexB] */
export function segments(sp: SubPath) {
  const out: { a: Node; b: Node; c1: Pt; c2: Pt; curve: boolean; ia: number; ib: number }[] = [];
  const n = sp.nodes.length;
  const last = sp.closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = sp.nodes[i],
      b = sp.nodes[(i + 1) % n];
    out.push({ a, b, c1: a.cout ?? a, c2: b.cin ?? b, curve: !!(a.cout || b.cin), ia: i, ib: (i + 1) % n });
  }
  return out;
}

function samplePoints(subs: SubPath[]): Pt[] {
  const pts: Pt[] = [];
  for (const sp of subs) {
    if (sp.nodes.length === 1) pts.push(sp.nodes[0]);
    for (const s of segments(sp)) {
      if (!s.curve) pts.push(s.a, s.b);
      else for (let t = 0; t <= 1.0001; t += 1 / 16) pts.push(bezierPt(s.a, s.c1, s.c2, s.b, t));
    }
  }
  return pts;
}

// ---------- Text ----------

const BASE = 100; // Text wird mit 100px gesetzt und auf mm skaliert
let mctx: CanvasRenderingContext2D | null = null;
function measureCtx() {
  if (!mctx) mctx = document.createElement('canvas').getContext('2d')!;
  return mctx;
}

export function fontString(t: TextShape) {
  return `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${BASE}px "${t.font}", sans-serif`;
}

export interface TextLayout {
  k: number;
  font: string;
  spacing: number; // in Basiseinheiten
  lines: { text: string; x: number; y: number; w: number }[];
  /** Begrenzung in lokalen mm */
  box: Box;
}

let layoutCache = new WeakMap<TextShape, TextLayout>();
/** Schriftkonturen je Text: dieselbe Geometrie wie bei Umwandeln in Pfad, Offset und Booleschen Operationen */
let outlineCache = new WeakMap<TextShape, { subs: SubPath[]; path: Path2D }>();
onFontLoaded(() => {
  layoutCache = new WeakMap();
  outlineCache = new WeakMap();
});

/** Konturen des Texts in lokalen mm, sobald die Schrift geladen ist; vorher null */
export function textOutline(t: TextShape): { subs: SubPath[]; path: Path2D } | null {
  let o = outlineCache.get(t);
  if (o) return o;
  const f = loadedFont(t.font, t.bold, t.italic);
  if (!f) return null;
  const subs = textToSubs(t, f.font);
  o = { subs, path: subsToPath2D(subs) };
  outlineCache.set(t, o);
  return o;
}
export function textLayout(t: TextShape): TextLayout {
  const cached = layoutCache.get(t);
  if (cached) return cached;
  const ctx = measureCtx();
  const k = t.size / BASE;
  const font = fontString(t);
  ctx.font = font;
  const spacing = t.hSpace / k;
  const lh = BASE * 1.2 + t.vSpace / k;
  const raw = (t.upper ? t.text.toUpperCase() : t.text).split('\n');
  let minX = Infinity,
    maxX = -Infinity;
  const lines = raw.map((text, i) => {
    const chars = [...text];
    const w = ctx.measureText(text).width + spacing * Math.max(0, chars.length - 1);
    const x = t.align === 'left' ? 0 : t.align === 'center' ? -w / 2 : -w;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + w);
    return { text, x, y: i * lh, w };
  });
  // Mit geladener Schrift die echten Vorschübe verwenden, damit Rahmen und Konturen zusammenpassen
  const f = loadedFont(t.font, t.bold, t.italic);
  if (f) {
    const ls = textLines(t, f.font);
    minX = Math.min(...ls.map((l) => l.x)) / k;
    maxX = Math.max(...ls.map((l) => l.x + l.w)) / k;
  }
  if (maxX - minX < BASE * 0.2) maxX = minX + BASE * 0.2; // leere Zeile bleibt anklickbar
  const top = -BASE * 0.8,
    bottom = (raw.length - 1) * lh + BASE * 0.22;
  const box = { x: minX * k, y: top * k, w: (maxX - minX) * k, h: (bottom - top) * k };
  const lay = { k, font, spacing, lines, box };
  layoutCache.set(t, lay);
  return lay;
}
export function invalidateText(t: TextShape) {
  layoutCache.delete(t);
  outlineCache.delete(t);
}

/** Text zeichnen. ctx muss bereits die Ansichtstransformation tragen. */
export function drawText(ctx: CanvasRenderingContext2D, t: TextShape, m: Mat, mode: 'fill' | 'stroke', px: number) {
  const outline = textOutline(t);
  if (outline) {
    ctx.save();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    if (mode === 'fill') ctx.fill(outline.path, 'evenodd');
    else {
      ctx.lineWidth = px / Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      ctx.stroke(outline.path);
    }
    ctx.restore();
    return;
  }
  // Schrift noch nicht geladen: vorläufig mit der Browserschrift zeichnen
  const lay = textLayout(t);
  ctx.save();
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.scale(lay.k, lay.k);
  ctx.font = lay.font;
  ctx.textBaseline = 'alphabetic';
  if (mode === 'stroke') {
    const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) * lay.k;
    ctx.lineWidth = px / s;
  }
  for (const ln of lay.lines) {
    if (!lay.spacing) {
      if (mode === 'fill') ctx.fillText(ln.text, ln.x, ln.y);
      else ctx.strokeText(ln.text, ln.x, ln.y);
      continue;
    }
    let x = ln.x;
    for (const ch of ln.text) {
      if (mode === 'fill') ctx.fillText(ch, x, ln.y);
      else ctx.strokeText(ch, x, ln.y);
      x += ctx.measureText(ch).width + lay.spacing;
    }
  }
  ctx.restore();
}

// ---------- Begrenzung ----------

export function emptyBox(): Box {
  return { x: Infinity, y: Infinity, w: -Infinity, h: -Infinity };
}

function addPts(b: { x0: number; y0: number; x1: number; y1: number }, m: Mat, pts: Pt[]) {
  for (const p of pts) {
    const q = apply(m, p.x, p.y);
    b.x0 = Math.min(b.x0, q.x);
    b.y0 = Math.min(b.y0, q.y);
    b.x1 = Math.max(b.x1, q.x);
    b.y1 = Math.max(b.y1, q.y);
  }
}

function objExtents(o: Obj, parent: Mat, b: { x0: number; y0: number; x1: number; y1: number }) {
  const m = mul(parent, o.m);
  const s = o.shape;
  if (s.kind === 'group') s.children.forEach((c) => objExtents(c, m, b));
  else if (s.kind === 'text') {
    const bx = textLayout(s).box;
    addPts(b, m, [
      { x: bx.x, y: bx.y },
      { x: bx.x + bx.w, y: bx.y },
      { x: bx.x + bx.w, y: bx.y + bx.h },
      { x: bx.x, y: bx.y + bx.h },
    ]);
  } else addPts(b, m, samplePoints(shapeSubs(s)));
}

export function boundsOf(objs: Iterable<Obj>, parent: Mat = IDENT): Box | null {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const o of objs) objExtents(o, parent, b);
  if (!isFinite(b.x0)) return null;
  return { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 };
}

// ---------- Treffertest ----------

let hctx: CanvasRenderingContext2D | null = null;
function hitCtx() {
  if (!hctx) hctx = document.createElement('canvas').getContext('2d')!;
  return hctx;
}

/** Trifft der Weltpunkt p ein Blatt-Objekt? tol in mm. */
export function hitLeaf(o: Obj, m: Mat, p: Pt, tol: number, inside: boolean): boolean {
  const s = o.shape;
  if (s.kind === 'text') {
    const q = apply(inv(m), p.x, p.y);
    const b = textLayout(s).box;
    const t = tol / Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]) || 1);
    return q.x >= b.x - t && q.x <= b.x + b.w + t && q.y >= b.y - t && q.y <= b.y + b.h + t;
  }
  if (s.kind === 'image') {
    const q = apply(inv(m), p.x, p.y);
    const t = tol / Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]) || 1);
    return q.x >= -t && q.x <= s.w + t && q.y >= -t && q.y <= s.h + t;
  }
  const ctx = hitCtx();
  const wp = worldPath(s, m);
  ctx.lineWidth = tol * 2;
  if (ctx.isPointInStroke(wp, p.x, p.y)) return true;
  return inside && ctx.isPointInPath(wp, p.x, p.y, 'evenodd');
}

/** Schnell: Überschneidet die Kontur das Rechteck? (Für Kreuzungsauswahl) */
export function leafIntersectsBox(o: Obj, m: Mat, r: Box): boolean {
  const s = o.shape;
  const inBox = (q: Pt) => q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h;
  if (s.kind === 'text') {
    const b = boundsOf([o], mul(m, inv(o.m)));
    if (!b) return false;
    return !(b.x > r.x + r.w || b.x + b.w < r.x || b.y > r.y + r.h || b.y + b.h < r.y);
  }
  for (const sp of shapeSubs(s)) {
    const pts = samplePoints([sp]).map((p) => apply(m, p.x, p.y));
    if (pts.some(inBox)) return true;
    for (let i = 1; i < pts.length; i++) if (segHitsBox(pts[i - 1], pts[i], r)) return true;
  }
  return false;
}

function segHitsBox(a: Pt, b: Pt, r: Box): boolean {
  // Liang-Barsky
  let t0 = 0,
    t1 = 1;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, a.x - r.x) && clip(dx, r.x + r.w - a.x) && clip(-dy, a.y - r.y) && clip(dy, r.y + r.h - a.y);
}

// ---------- SVG-Export ----------

const n2 = (v: number) => String(Math.round(v * 1000) / 1000);

export function subsToD(subs: SubPath[], m: Mat): string {
  const P = (p: Pt) => {
    const q = apply(m, p.x, p.y);
    return `${n2(q.x)} ${n2(q.y)}`;
  };
  let d = '';
  for (const sp of subs) {
    if (!sp.nodes.length) continue;
    d += `M${P(sp.nodes[0])}`;
    for (const s of segments(sp)) d += s.curve ? `C${P(s.c1)} ${P(s.c2)} ${P(s.b)}` : `L${P(s.b)}`;
    if (sp.closed) d += 'Z';
  }
  return d;
}
