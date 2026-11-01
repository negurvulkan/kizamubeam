// QR-Codes: Inhalt kodieren (qrcode-generator, MIT) und die Module zu geschlossenen Umrissen zusammenfassen.
// Zusammenhängende Module ergeben eine Kontur (mit Löchern), damit Linien-Layer nicht jede Modulkante einzeln
// fahren und Füll-Layer saubere Flächen bekommen.
import qrcode from 'qrcode-generator';
import { BarcodeShape, LinearType, Node, SubPath } from './model';
import { expand, numberOf } from './vartext';
import { fillTemplate, scopeOf } from './params';
import { subsToPath2D } from './geom';
import { bars, encodeLinear, Linear } from './barcode1d';
import { loadedFont, textToSubs } from './fonts';

/** Schrift für den Klartext unter Strichcodes (fehlt sie, springt Roboto ein) */
export const BARCODE_FONT = 'Arial';

/** Strichcode (1D) statt QR-Code? */
export const isLinear = (s: BarcodeShape): boolean => s.type !== 'qr';

// Inhalte als UTF-8 kodieren (Umlaute, Emoji); die Bibliothek nimmt sonst nur das untere Byte
qrcode.stringToBytes = (s: string) => [...new TextEncoder().encode(s)];

/** Inhalt, der tatsächlich kodiert wird (variabler Text eingesetzt) */
export function barcodeData(s: BarcodeShape): string {
  // Zahlen immer mit Punkt (Adressen, Kennungen)
  const d = fillTemplate(s.data, scopeOf(), true);
  return s.vt ? expand(d, numberOf(s.vt)) : d;
}

export interface QrMatrix {
  n: number;
  dark: (r: number, c: number) => boolean;
}

/** QR-Matrix zum Inhalt; null, wenn der Inhalt leer oder zu lang ist */
export function qrMatrix(data: string, ec: BarcodeShape['ec']): QrMatrix | null {
  if (!data) return null;
  try {
    const q = qrcode(0, ec);
    const mode = /^\d+$/.test(data) ? 'Numeric' : /^[0-9A-Z $%*+\-./:]+$/.test(data) ? 'Alphanumeric' : 'Byte';
    q.addData(data, mode);
    q.make();
    return { n: q.getModuleCount(), dark: (r, c) => q.isDark(r, c) };
  } catch {
    return null;
  }
}

/**
 * Umrisse aller gesetzten Zellen eines Rasters (w × h Zellen, Zellgröße k, Ursprung x0/y0).
 * Kanten zwischen zwei gesetzten Zellen fallen weg, die übrigen werden zu Ringen verkettet.
 */
export function cellOutlines(w: number, h: number, set: (x: number, y: number) => boolean, k: number, x0 = 0, y0 = 0): SubPath[] {
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && set(x, y);
  // Gerichtete Kanten im Uhrzeigersinn (y nach unten), Schlüssel = Startpunkt
  const W = w + 1;
  const out = new Map<number, number[]>();
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const a = ay * W + ax;
    const list = out.get(a);
    if (list) list.push(by * W + bx);
    else out.set(a, [by * W + bx]);
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue;
      if (!on(x, y - 1)) add(x, y, x + 1, y);
      if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!on(x - 1, y)) add(x, y + 1, x, y);
    }
  const subs: SubPath[] = [];
  const pt = (i: number) => [i % W, Math.floor(i / W)];
  for (const [start] of out) {
    while (out.get(start)?.length) {
      const ring: number[] = [start];
      let prev = start,
        cur = out.get(start)!.pop()!;
      while (cur !== start) {
        ring.push(cur);
        const nexts = out.get(cur)!;
        // Zwei Möglichkeiten nur an Ecken, an denen sich Zellen diagonal berühren: rechts abbiegen hält die Ringe getrennt
        let pick = nexts.length - 1;
        if (nexts.length > 1) {
          const [px, py] = pt(prev),
            [cx, cy] = pt(cur);
          const dx = cx - px,
            dy = cy - py;
          pick = nexts.findIndex((nx) => {
            const [qx, qy] = pt(nx);
            return dx * (qy - cy) - dy * (qx - cx) > 0;
          });
          if (pick < 0) pick = nexts.length - 1;
        }
        prev = cur;
        cur = nexts.splice(pick, 1)[0];
      }
      // Punkte auf geraden Strecken weglassen
      const nodes: Node[] = [];
      for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = pt(ring[(i + ring.length - 1) % ring.length]),
          [bx, by] = pt(ring[i]),
          [cx, cy] = pt(ring[(i + 1) % ring.length]);
        if ((bx - ax) * (cy - by) - (by - ay) * (cx - bx) !== 0) nodes.push({ x: x0 + bx * k, y: y0 + by * k });
      }
      if (nodes.length >= 3) subs.push({ closed: true, nodes });
    }
  }
  return subs;
}

interface Outline {
  key: string;
  subs: SubPath[];
  path: Path2D;
  /** QR: Module je Seite, Strichcode: Module in der Breite (0 = Inhalt leer, zu lang oder ungültig) */
  n: number;
  /** Lokale Fläche samt Klartext und gelaserter Ruhezone */
  ext: Extent;
}
export interface Extent {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const cache = new WeakMap<BarcodeShape, Outline>();

const rect = (x0: number, y0: number, x1: number, y1: number): SubPath => ({
  closed: true,
  nodes: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
});

/** Umrisse des QR- oder Strichcodes in lokalen mm (zwischengespeichert, solange Inhalt und Einstellungen gleich bleiben) */
export function barcodeOutline(s: BarcodeShape): Outline {
  const data = barcodeData(s);
  const lin = isLinear(s);
  // Strichcode mit Klartext: neu rechnen, sobald die Schrift geladen ist
  const font = lin && s.text ? loadedFont(BARCODE_FONT, false, false) : null;
  const key = JSON.stringify(lin ? [data, s.type, s.size, s.height, s.text, s.check, s.bwr, s.invert, s.quiet, !!font] : [data, s.ec, s.size, s.invert, s.quiet]);
  let o = cache.get(s);
  if (o && o.key === key) return o;
  let subs: SubPath[];
  let n = 0;
  let ext: Extent;
  if (lin) {
    const r = encodeLinear(s.type as LinearType, data, s.check);
    const h = linearHeight(s);
    if (!r.ok) {
      subs = [rect(0, 0, s.size, h)];
      ext = { x0: 0, y0: 0, x1: s.size, y1: h };
    } else {
      n = r.code.total;
      ({ subs, ext } = linearSubs(s, r.code, font?.font ?? null));
    }
  } else {
    const m = qrMatrix(data, s.ec);
    if (!m) subs = [rect(0, 0, s.size, s.size)];
    else {
      const k = s.size / m.n;
      const q = s.invert ? Math.max(0, Math.round(s.quiet)) : 0;
      const N = m.n + 2 * q;
      subs = s.invert
        ? cellOutlines(N, N, (x, y) => x < q || y < q || x >= m.n + q || y >= m.n + q || !m.dark(y - q, x - q), k, -q * k, -q * k)
        : cellOutlines(m.n, m.n, (x, y) => m.dark(y, x), k);
      n = m.n;
    }
    const q = s.invert && n ? (Math.max(0, Math.round(s.quiet)) * s.size) / n : 0;
    ext = { x0: -q, y0: -q, x1: s.size + q, y1: s.size + q };
  }
  o = { key, subs, path: subsToPath2D(subs), n, ext };
  cache.set(s, o);
  return o;
}

/** Strichhöhe eines Strichcodes in mm */
export function linearHeight(s: BarcodeShape): number {
  return s.height && s.height > 0 ? s.height : 15;
}

/**
 * Striche (oder bei Negativ: Lücken, Ruhezone und Hintergrund des Klartexts) als geschlossene Umrisse.
 * Der Klartext wird mit Schriftumrissen gesetzt, damit Füll- und Linien-Layer ihn genauso lasern, wie er angezeigt wird.
 */
export function linearSubs(s: BarcodeShape, code: Linear, font: import('opentype.js').Font | null): { subs: SubPath[]; ext: Extent } {
  const k = s.size / code.total;
  const h = linearHeight(s);
  const ean = code.guards.length > 0;
  // Schriftgröße: EAN/UPC nach Norm etwa 9 Module, sonst passend zur Breite, höchstens ein Drittel der Strichhöhe
  const fs = ean ? 9 * k : Math.min(h * 0.3, Math.max(1.5, 7 * k));
  const gap = ean ? k : 0.2 * fs;
  const top = h + gap;
  const base = top + 0.72 * fs;
  const guardEnd = s.text && ean ? top + 0.5 * fs : h;
  const glyphs: SubPath[] = [];
  if (s.text && font) {
    for (const p of code.text) {
      const size = p.small ? fs * 0.75 : fs;
      const ts = {
        kind: 'text' as const, text: p.s, font: BARCODE_FONT, size, bold: false, italic: false, upper: false,
        align: 'center' as const, hSpace: 0, vSpace: 0, maxW: p.w * k, fit: 'shrink' as const,
      };
      const by = p.small ? base - (fs - size) * 0.72 : base;
      for (const sp of textToSubs(ts, font))
        glyphs.push({ ...sp, nodes: sp.nodes.map((nd) => shiftNode(nd, p.x * k, by)) });
    }
  }
  // Klartext reicht bei EAN-13 und UPC-A links (und rechts) über die Striche hinaus
  let gx0 = 0,
    gx1 = s.size,
    gy1 = s.text ? base : guardEnd;
  for (const sp of glyphs)
    for (const nd of sp.nodes) {
      gx0 = Math.min(gx0, nd.x);
      gx1 = Math.max(gx1, nd.x);
      gy1 = Math.max(gy1, nd.y);
    }
  // Strichbreitenkorrektur: gelaserte Elemente werden schmaler (bei Negativ die Lücken, also werden die Striche breiter)
  const bwr = Math.max(0, s.bwr ?? 0);
  const d = (s.invert ? -bwr : bwr) / 2;
  const barRects = bars(code).map(([a, b, guard]) => {
    let x0 = a * k + d,
      x1 = b * k - d;
    if (x1 - x0 < k * 0.1) x0 = x1 = (x0 + x1) / 2;
    return rect(x0, 0, x1, guard ? guardEnd : h);
  }).filter((r) => r.nodes[1].x > r.nodes[0].x);
  if (!s.invert) return { subs: [...barRects, ...glyphs], ext: { x0: gx0, y0: 0, x1: gx1, y1: gy1 } };
  // Negativ: Rechteck um Striche, Ruhezone und Klartext lasern; Striche und Ziffern bleiben als Löcher stehen
  const q = Math.max(0, Math.round(s.quiet)) * k;
  const m = 2 * k;
  const x0 = Math.min(-q, gx0 - k),
    x1 = Math.max(s.size + q, gx1 + k),
    y0 = -m,
    y1 = (s.text ? gy1 + 0.2 * fs : h) + m;
  return { subs: [rect(x0, y0, x1, y1), ...barRects, ...glyphs], ext: { x0, y0, x1, y1 } };
}

function shiftNode(nd: Node, dx: number, dy: number): Node {
  const out: Node = { ...nd, x: nd.x + dx, y: nd.y + dy };
  if (nd.cin) out.cin = { x: nd.cin.x + dx, y: nd.cin.y + dy };
  if (nd.cout) out.cout = { x: nd.cout.x + dx, y: nd.cout.y + dy };
  return out;
}

/** Lokale Fläche des Codes samt Klartext und gelaserter Ruhezone */
export function barcodeExtent(s: BarcodeShape): Extent {
  return barcodeOutline(s).ext;
}

/** Inhalte für den Dialog: WLAN und Kontakt werden zu den üblichen Formaten zusammengesetzt */
export function wifiData(ssid: string, pass: string, auth: string, hidden: boolean): string {
  const esc = (v: string) => v.replace(/([\\;,:"])/g, '\\$1');
  return `WIFI:T:${auth === 'nopass' ? 'nopass' : auth};S:${esc(ssid)};${auth === 'nopass' ? '' : `P:${esc(pass)};`}${hidden ? 'H:true;' : ''};`;
}

export function vcardData(f: { name: string; org: string; phone: string; email: string; url: string }): string {
  const esc = (v: string) => v.replace(/([\\;,])/g, '\\$1');
  const parts = f.name.trim().split(/\s+/);
  const last = parts.length > 1 ? parts.pop()! : parts[0] ?? '';
  const first = parts.length && parts[0] !== last ? parts.join(' ') : '';
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${esc(last)};${esc(first)};;;`,
    `FN:${esc(f.name.trim())}`,
    f.org && `ORG:${esc(f.org)}`,
    f.phone && `TEL:${f.phone}`,
    f.email && `EMAIL:${f.email}`,
    f.url && `URL:${f.url}`,
    'END:VCARD',
  ].filter(Boolean).join('\n');
}
