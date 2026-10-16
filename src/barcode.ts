// QR-Codes: Inhalt kodieren (qrcode-generator, MIT) und die Module zu geschlossenen Umrissen zusammenfassen.
// Zusammenhängende Module ergeben eine Kontur (mit Löchern), damit Linien-Layer nicht jede Modulkante einzeln
// fahren und Füll-Layer saubere Flächen bekommen.
import qrcode from 'qrcode-generator';
import { BarcodeShape, Node, SubPath } from './model';
import { expand, numberOf } from './vartext';
import { subsToPath2D } from './geom';

// Inhalte als UTF-8 kodieren (Umlaute, Emoji); die Bibliothek nimmt sonst nur das untere Byte
qrcode.stringToBytes = (s: string) => [...new TextEncoder().encode(s)];

/** Inhalt, der tatsächlich kodiert wird (variabler Text eingesetzt) */
export function barcodeData(s: BarcodeShape): string {
  return s.vt ? expand(s.data, numberOf(s.vt)) : s.data;
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
  /** Module je Seite (0 = Inhalt leer oder zu lang) */
  n: number;
}
const cache = new WeakMap<BarcodeShape, Outline>();

/** Umrisse des QR-Codes in lokalen mm (zwischengespeichert, solange Inhalt und Einstellungen gleich bleiben) */
export function barcodeOutline(s: BarcodeShape): Outline {
  const data = barcodeData(s);
  const key = JSON.stringify([data, s.ec, s.size, s.invert, s.quiet]);
  let o = cache.get(s);
  if (o && o.key === key) return o;
  const m = qrMatrix(data, s.ec);
  let subs: SubPath[];
  if (!m) subs = [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: s.size, y: 0 }, { x: s.size, y: s.size }, { x: 0, y: s.size }] }];
  else {
    const k = s.size / m.n;
    const q = s.invert ? Math.max(0, Math.round(s.quiet)) : 0;
    const N = m.n + 2 * q;
    subs = s.invert
      ? cellOutlines(N, N, (x, y) => x < q || y < q || x >= m.n + q || y >= m.n + q || !m.dark(y - q, x - q), k, -q * k, -q * k)
      : cellOutlines(m.n, m.n, (x, y) => m.dark(y, x), k);
  }
  o = { key, subs, path: subsToPath2D(subs), n: m?.n ?? 0 };
  cache.set(s, o);
  return o;
}

/** Lokale Fläche des QR-Codes samt gelaserter Ruhezone: von lo bis hi in x und y */
export function barcodeExtent(s: BarcodeShape): { lo: number; hi: number } {
  const o = barcodeOutline(s);
  const q = s.invert && o.n ? (Math.max(0, Math.round(s.quiet)) * s.size) / o.n : 0;
  return { lo: -q, hi: s.size + q };
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
