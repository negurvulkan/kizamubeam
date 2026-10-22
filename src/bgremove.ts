// Bildhintergrund entfernen (Freistellen), lokal ohne Cloud: Hintergrundfarben vom Bildrand schätzen oder
// angeklickt übernehmen, ähnliche Farben (Abstand in CIELAB) transparent machen, kleine Inseln und Löcher
// bereinigen und die Kante weich auslaufen lassen. Arbeitet auf RGBA-Daten, damit es ohne DOM testbar ist.

export interface BgOptions {
  /** Farbabstand (ΔE in CIELAB), bis zu dem ein Bildpunkt als Hintergrund gilt */
  tolerance: number;
  /** 'edge': nur vom Rand aus zusammenhängender Hintergrund; 'all': jede passende Stelle im Bild */
  mode: 'edge' | 'all';
  /** Hintergrundfarben [r, g, b]; leer = automatisch vom Bildrand */
  colors: [number, number, number][];
  /** Vordergrund-Inseln und Hintergrund-Löcher bis zu dieser Fläche (Anteil am Bild in ‰) bereinigen */
  cleanup: number;
  /** weiche Kante in Bildpunkten (0 = hart) */
  feather: number;
}

export const DEFAULT_BG: BgOptions = { tolerance: 18, mode: 'edge', colors: [], cleanup: 0.5, feather: 1 };

type Lab = [number, number, number];

const lin = (c: number) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const LIN = Float32Array.from({ length: 256 }, (_, i) => lin(i));
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

export function toLab(r: number, g: number, b: number): Lab {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/**
 * Hintergrundfarben vom Bildrand: Randpunkte grob in Farbklassen sortieren und die häufigsten (bis zu vier,
 * je mindestens 8 % des Randes) als Mittelwert übernehmen. Transparente Randpunkte zählen nicht.
 */
export function edgeColors(rgba: Uint8ClampedArray, w: number, h: number): [number, number, number][] {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  const add = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    if (rgba[i + 3] < 128) return;
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = bins.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += r;
    e.g += g;
    e.b += b;
    bins.set(k, e);
    total++;
  };
  for (let x = 0; x < w; x++) add(x, 0), h > 1 && add(x, h - 1);
  for (let y = 1; y < h - 1; y++) add(0, y), w > 1 && add(w - 1, y);
  if (!total) return [];
  // Nachbarklassen zusammenfassen, damit ein leichter Verlauf nicht in viele kleine Klassen zerfällt
  const sorted = [...bins.entries()].sort((a, b) => b[1].n - a[1].n);
  const out: { n: number; r: number; g: number; b: number }[] = [];
  for (const [, e] of sorted) {
    const c = [e.r / e.n, e.g / e.n, e.b / e.n];
    const near = out.find((o) => Math.abs(o.r / o.n - c[0]) <= 24 && Math.abs(o.g / o.n - c[1]) <= 24 && Math.abs(o.b / o.n - c[2]) <= 24);
    if (near) {
      near.n += e.n;
      near.r += e.r;
      near.g += e.g;
      near.b += e.b;
    } else out.push({ ...e });
  }
  return out
    .filter((o) => o.n >= total * 0.08)
    .sort((a, b) => b.n - a.n)
    .slice(0, 4)
    .map((o) => [Math.round(o.r / o.n), Math.round(o.g / o.n), Math.round(o.b / o.n)]);
}

/**
 * Deckkraft je Bildpunkt (0 = Hintergrund … 255 = bleibt). Bereits transparente Punkte bleiben transparent.
 */
export function backgroundAlpha(rgba: Uint8ClampedArray, w: number, h: number, o: BgOptions): Uint8ClampedArray {
  const n = w * h;
  const colors = (o.colors.length ? o.colors : edgeColors(rgba, w, h)).map(([r, g, b]) => toLab(r, g, b));
  // Abstand zur nächsten Hintergrundfarbe; Lab je Farbe aus einer Tabelle (gleiche Farben kommen oft vor)
  const tol2 = o.tolerance * o.tolerance;
  const isBg = new Uint8Array(n);
  const memo = new Map<number, number>();
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (rgba[i + 3] < 128) {
      isBg[p] = 2; // war schon transparent
      continue;
    }
    if (!colors.length) continue;
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    let m = memo.get(key);
    if (m === undefined) {
      const [L, A, B] = toLab(rgba[i], rgba[i + 1], rgba[i + 2]);
      m = 0;
      for (const c of colors) if ((L - c[0]) ** 2 + (A - c[1]) ** 2 + (B - c[2]) ** 2 <= tol2) m = 1;
      if (memo.size < 1 << 18) memo.set(key, m);
    }
    isBg[p] = m;
  }
  const bg = new Uint8Array(n);
  if (o.mode === 'all') for (let p = 0; p < n; p++) bg[p] = isBg[p] ? 1 : 0;
  else {
    // vom Rand aus füllen (4er-Nachbarschaft); transparente Stellen leiten weiter
    const stack = new Int32Array(n);
    let sp = 0;
    const push = (p: number) => {
      if (isBg[p] && !bg[p]) (bg[p] = 1), (stack[sp++] = p);
    };
    for (let x = 0; x < w; x++) push(x), push((h - 1) * w + x);
    for (let y = 0; y < h; y++) push(y * w), push(y * w + w - 1);
    while (sp) {
      const p = stack[--sp];
      const x = p % w;
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (p >= w) push(p - w);
      if (p < n - w) push(p + w);
    }
    for (let p = 0; p < n; p++) if (isBg[p] === 2) bg[p] = 1;
  }
  const minArea = Math.round((n * o.cleanup) / 1000);
  if (minArea > 0) {
    flipSmall(bg, w, h, 0, minArea); // kleine Vordergrund-Inseln (Staub, Rauschen) weg
    flipSmall(bg, w, h, 1, minArea); // kleine Löcher im Motiv füllen
    for (let p = 0; p < n; p++) if (isBg[p] === 2) bg[p] = 1;
  }
  const alpha = new Uint8ClampedArray(n);
  for (let p = 0; p < n; p++) alpha[p] = bg[p] ? 0 : 255;
  const r = Math.round(o.feather);
  if (r > 0) {
    // weiche Kante nur nach außen: Motiv bleibt deckend, der Hintergrund am Rand bekommt einen Verlauf
    const soft = boxBlur(alpha, w, h, r);
    for (let p = 0; p < n; p++) if (bg[p] && isBg[p] !== 2) alpha[p] = Math.min(255, soft[p] * 2);
  }
  return alpha;
}

/** Zusammenhängende Flächen mit Wert v (4er-Nachbarschaft) bis maxArea umkehren; Flächen am Bildrand bei v = 1 nicht. */
function flipSmall(m: Uint8Array, w: number, h: number, v: number, maxArea: number) {
  const n = w * h;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const comp: number[] = [];
  let sp = 0;
  const visit = (q: number) => {
    if (!seen[q] && m[q] === v) (seen[q] = 1), (stack[sp++] = q);
  };
  for (let s = 0; s < n; s++) {
    if (seen[s] || m[s] !== v) continue;
    let edge = false;
    sp = 0;
    comp.length = 0;
    seen[s] = 1;
    stack[sp++] = s;
    while (sp) {
      const p = stack[--sp];
      if (comp.length <= maxArea) comp.push(p);
      const x = p % w;
      if (x === 0 || x === w - 1 || p < w || p >= n - w) edge = true;
      if (x > 0) visit(p - 1);
      if (x < w - 1) visit(p + 1);
      if (p >= w) visit(p - w);
      if (p < n - w) visit(p + w);
    }
    if (comp.length <= maxArea && !(v === 1 && edge)) for (const p of comp) m[p] = 1 - v;
  }
}

function boxBlur(v: Uint8ClampedArray, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h),
    out = new Float32Array(w * h);
  const k = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += v[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / k;
      s += v[y * w + Math.min(w - 1, x + r + 1)] - v[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / k;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** Rahmen der deckenden Bildpunkte (Deckkraft ≥ 8), null = alles transparent */
export function opaqueBounds(alpha: Uint8ClampedArray, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (alpha[y * w + x] >= 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
