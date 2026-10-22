// Werkstücke im Kamerabild erkennen: gleichartige Teile auf dem Bett finden (Lage und Drehung) und ein Design
// auf alle übertragen.
//
// Eingabe ist das entzerrte Kamerabild in Bettlage (Pixel (i, j) ↔ Welt (i·kx, j·ky), y nach unten wie auf der
// Arbeitsfläche). Durchsichtige Pixel (außerhalb des Kamerabilds) gelten als Hintergrund.
// 1. Trennen: mit einem Foto vom leeren Bett über die Farbabweichung, sonst über die Helligkeit (Otsu-Schwelle;
//    Hintergrund ist die Seite, die am Bildrand überwiegt). Danach Öffnen und Schließen gegen Rauschen.
// 2. Zusammenhängende Flächen ab einer Mindestgröße sind Werkstücke; Flächen am Bildrand sind angeschnitten.
// 3. Drehung: Vorlage (Werkstück oder gezeichneter Umriss) um den Schwerpunkt drehen und die Deckung beider
//    Flächen bewerten, grob über 360° und dann fein. Bei symmetrischen Teilen gewinnt die kleinste Drehung.

import type { Mat, Pt } from './model';

export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface DetectOptions {
  /** Empfindlichkeit 0 … 100: höher = auch schwächer abgehobene Teile */
  sensitivity: number;
  /** Kleinere Flächen in mm² weglassen */
  minArea: number;
}

export const DEFAULT_DETECT: DetectOptions = { sensitivity: 50, minArea: 100 };

/** Fläche als Bitmaske in einem Raster (Welt-mm, y nach unten) */
export interface Blob {
  /** Linke obere Ecke der Maske in mm und Rasterweite */
  x0: number;
  y0: number;
  kx: number;
  ky: number;
  w: number;
  h: number;
  mask: Uint8Array;
  /** Schwerpunkt (mm) und Fläche (mm²) */
  cx: number;
  cy: number;
  area: number;
  /** Stichprobe der Flächenpunkte relativ zum Schwerpunkt (mm), abwechselnd x, y */
  pts: Float32Array;
}

export interface Piece extends Blob {
  /** Umriss (Außen- und Lochkonturen) in Welt-mm */
  outline: Pt[][];
  /** Berührt den Bildrand oder den Rand des Kamerabilds: wahrscheinlich nur teilweise sichtbar */
  cut: boolean;
}

export interface Match {
  /** Drehung der Vorlage auf das Werkstück (Bogenmaß, Weltkoordinaten) */
  angle: number;
  /** Deckung 0 … 1 */
  score: number;
  /** Eine andere Drehung deckt fast genauso gut (symmetrisches Teil) */
  ambiguous: boolean;
  /** Flächenverhältnis Werkstück / Vorlage */
  areaRatio: number;
}

const MAX_PTS = 1500;

// ---------- Trennen ----------

function otsu(hist: Float64Array): number {
  let total = 0,
    sum = 0;
  for (let i = 0; i < 256; i++) ((total += hist[i]), (sum += i * hist[i]));
  if (!total) return 128;
  let wB = 0,
    sumB = 0,
    best = -1,
    thr = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB,
      mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) ((best = v), (thr = i + 0.5));
  }
  return thr;
}

/** Vordergrundmaske (1 = Werkstück); bg = Foto vom leeren Bett in derselben Größe */
export function segment(img: RGBAImage, o: DetectOptions, bg?: RGBAImage | null): Uint8Array {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const valid = new Uint8Array(n);
  const val = new Float32Array(n);
  const useBg = !!bg && bg.width === w && bg.height === h;
  for (let k = 0; k < n; k++) {
    const p = k * 4;
    if (d[p + 3] < 128 || (useBg && bg!.data[p + 3] < 128)) continue;
    valid[k] = 1;
    if (useBg) {
      const b = bg!.data;
      val[k] = Math.max(Math.abs(d[p] - b[p]), Math.abs(d[p + 1] - b[p + 1]), Math.abs(d[p + 2] - b[p + 2]));
    } else val[k] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
  }
  const hist = new Float64Array(256);
  for (let k = 0; k < n; k++) if (valid[k]) hist[Math.min(255, val[k] | 0)]++;
  // Empfindlichkeit verschiebt die Schwelle zum Hintergrund hin (50 = Otsu)
  const shift = ((o.sensitivity - 50) / 50) * 40;
  const mask = new Uint8Array(n);
  if (useBg) {
    // Abweichung vom leeren Bett: Rauschen liegt meist unter 20
    const thr = Math.max(8, Math.max(20, otsu(hist)) - shift);
    for (let k = 0; k < n; k++) mask[k] = valid[k] && val[k] > thr ? 1 : 0;
  } else {
    const thr = otsu(hist);
    // Welche Seite ist Hintergrund? Die, die am Rand des gültigen Bereichs überwiegt
    let darkEdge = 0,
      edge = 0;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        if (!valid[k]) continue;
        const onEdge = i === 0 || j === 0 || i === w - 1 || j === h - 1 || !valid[k - 1] || !valid[k + 1] || !valid[k - w] || !valid[k + w];
        if (!onEdge) continue;
        edge++;
        if (val[k] < thr) darkEdge++;
      }
    const darkBg = darkEdge * 2 > edge;
    const t = darkBg ? thr - shift : thr + shift;
    for (let k = 0; k < n; k++) mask[k] = valid[k] && (darkBg ? val[k] > t : val[k] < t) ? 1 : 0;
  }
  // Rauschen entfernen, kleine Lücken schließen (Radius in Pixeln)
  const r = Math.max(1, Math.round(Math.min(w, h) / 600));
  return morph(morph(morph(morph(mask, w, h, r, false), w, h, r, true), w, h, r, true), w, h, r, false);
}

/** Quadratisches Dehnen (grow) oder Schrumpfen mit Radius r, getrennt nach Zeilen und Spalten */
function morph(m: Uint8Array, w: number, h: number, r: number, grow: boolean): Uint8Array {
  const tmp = new Uint8Array(m.length),
    out = new Uint8Array(m.length);
  const hit = grow ? 1 : 0;
  for (let j = 0; j < h; j++) {
    const row = j * w;
    for (let i = 0; i < w; i++) {
      let v = grow ? 0 : 1;
      for (let x = Math.max(0, i - r), x1 = Math.min(w - 1, i + r); x <= x1; x++)
        if (m[row + x] === hit) {
          v = hit;
          break;
        }
      tmp[row + i] = v;
    }
  }
  for (let i = 0; i < w; i++)
    for (let j = 0; j < h; j++) {
      let v = grow ? 0 : 1;
      for (let y = Math.max(0, j - r), y1 = Math.min(h - 1, j + r); y <= y1; y++)
        if (tmp[y * w + i] === hit) {
          v = hit;
          break;
        }
      out[j * w + i] = v;
    }
  return out;
}

// ---------- Flächen ----------

function samplePts(mask: Uint8Array, w: number, h: number, x0: number, y0: number, kx: number, ky: number, cx: number, cy: number, count: number) {
  const step = Math.max(1, Math.ceil(count / MAX_PTS));
  const pts = new Float32Array(Math.ceil(count / step) * 2);
  let n = 0,
    c = 0;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      if (!mask[j * w + i]) continue;
      if (c++ % step) continue;
      pts[n++] = x0 + (i + 0.5) * kx - cx;
      pts[n++] = y0 + (j + 0.5) * ky - cy;
    }
  return pts.subarray(0, n);
}

/** Blob aus einer Maske im Raster (x0, y0, kx, ky) */
export function blobFromMask(mask: Uint8Array, w: number, h: number, x0: number, y0: number, kx: number, ky: number): Blob | null {
  let sx = 0,
    sy = 0,
    cnt = 0;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++)
      if (mask[j * w + i]) ((sx += i + 0.5), (sy += j + 0.5), cnt++);
  if (!cnt) return null;
  const cx = x0 + (sx / cnt) * kx,
    cy = y0 + (sy / cnt) * ky;
  return { x0, y0, kx, ky, w, h, mask, cx, cy, area: cnt * kx * ky, pts: samplePts(mask, w, h, x0, y0, kx, ky, cx, cy, cnt) };
}

/** Liegt der Weltpunkt (x, y) in der Fläche? */
export function inside(b: Blob, x: number, y: number): boolean {
  const i = Math.floor((x - b.x0) / b.kx),
    j = Math.floor((y - b.y0) / b.ky);
  return i >= 0 && j >= 0 && i < b.w && j < b.h && b.mask[j * b.w + i] === 1;
}

/** Konturen einer Maske (Marching Squares auf Pixelmitten), in Welt-mm */
function contours(mask: Uint8Array, w: number, h: number, x0: number, y0: number, kx: number, ky: number): Pt[][] {
  const W = w + 2;
  const at = (x: number, y: number) => (x < 1 || y < 1 || x > w || y > h ? 0 : mask[(y - 1) * w + (x - 1)]);
  // Kanten zwischen Pixelmitten: (x, y) waagerecht = 2·(y·W+x), senkrecht = +1
  const next = new Map<number, number>();
  const pos = (e: number): Pt => {
    const c = e >> 1,
      x = c % W,
      y = (c - x) / W;
    const px = (e & 1) === 0 ? x + 0.5 : x,
      py = (e & 1) === 0 ? y : y + 0.5;
    // Pixelmitte von Pixel (x-1, y-1) der Maske liegt bei Rasterpunkt (x, y)
    return { x: x0 + (px - 0.5) * kx, y: y0 + (py - 0.5) * ky };
  };
  for (let y = 0; y <= h; y++)
    for (let x = 0; x <= w; x++) {
      const tl = at(x, y),
        tr = at(x + 1, y),
        br = at(x + 1, y + 1),
        bl = at(x, y + 1);
      const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (code === 0 || code === 15) continue;
      const top = 2 * (y * W + x),
        bottom = 2 * ((y + 1) * W + x),
        left = 2 * (y * W + x) + 1,
        right = 2 * (y * W + x + 1) + 1;
      // Richtung so, dass das Werkstück links liegt; Sattelpunkte trennen
      const link = (a: number, b: number) => next.set(a, b);
      switch (code) {
        case 1: link(left, bottom); break;
        case 2: link(bottom, right); break;
        case 3: link(left, right); break;
        case 4: link(right, top); break;
        case 5: link(left, top); link(right, bottom); break;
        case 6: link(bottom, top); break;
        case 7: link(left, top); break;
        case 8: link(top, left); break;
        case 9: link(top, bottom); break;
        case 10: link(top, right); link(bottom, left); break;
        case 11: link(top, right); break;
        case 12: link(right, left); break;
        case 13: link(right, bottom); break;
        case 14: link(bottom, left); break;
      }
    }
  const out: Pt[][] = [];
  const seen = new Set<number>();
  for (const s of next.keys()) {
    if (seen.has(s)) continue;
    const loop: Pt[] = [];
    let e: number | undefined = s;
    while (e !== undefined && !seen.has(e)) {
      seen.add(e);
      loop.push(pos(e));
      e = next.get(e);
    }
    if (loop.length >= 3) out.push(simplify(loop, Math.min(kx, ky) * 0.6));
  }
  return out;
}

/** Geschlossenen Linienzug vereinfachen (Ramer-Douglas-Peucker, zwei Hälften) */
function simplify(p: Pt[], tol: number): Pt[] {
  if (p.length < 8) return p;
  const rdp = (a: number, b: number, out: Pt[]) => {
    let best = -1,
      bi = -1;
    const A = p[a],
      B = p[b % p.length];
    const dx = B.x - A.x,
      dy = B.y - A.y,
      L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((p[i].x - A.x) * dy - (p[i].y - A.y) * dx) / L;
      if (d > best) ((best = d), (bi = i));
    }
    if (best > tol) {
      rdp(a, bi, out);
      rdp(bi, b, out);
    } else out.push(A);
  };
  const half = p.length >> 1;
  const out: Pt[] = [];
  rdp(0, half, out);
  rdp(half, p.length, out);
  return out;
}

/** Werkstücke im entzerrten Bild finden; kx, ky = mm je Pixel */
export function detectPieces(img: RGBAImage, kx: number, ky: number, o: DetectOptions, bg?: RGBAImage | null): Piece[] {
  const { width: w, height: h } = img;
  const mask = segment(img, o, bg);
  const valid = (k: number) => img.data[k * 4 + 3] >= 128;
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const out: Piece[] = [];
  let id = 0;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || label[s]) continue;
    id++;
    let sp = 0,
      cnt = 0,
      cut = false;
    let i0 = w,
      j0 = h,
      i1 = -1,
      j1 = -1;
    stack[sp++] = s;
    label[s] = id;
    while (sp) {
      const k = stack[--sp];
      cnt++;
      const i = k % w,
        j = (k - i) / w;
      if (i < i0) i0 = i;
      if (i > i1) i1 = i;
      if (j < j0) j0 = j;
      if (j > j1) j1 = j;
      if (i === 0 || j === 0 || i === w - 1 || j === h - 1) cut = true;
      const nb = [i > 0 ? k - 1 : -1, i < w - 1 ? k + 1 : -1, j > 0 ? k - w : -1, j < h - 1 ? k + w : -1];
      for (const q of nb) {
        if (q < 0) continue;
        if (!valid(q)) cut = true;
        else if (mask[q] && !label[q]) {
          label[q] = id;
          stack[sp++] = q;
        }
      }
    }
    if (cnt * kx * ky < o.minArea) continue;
    // Eigene Maske im umschließenden Rechteck; Löcher bleiben Löcher
    const bw = i1 - i0 + 1,
      bh = j1 - j0 + 1;
    const m = new Uint8Array(bw * bh);
    for (let j = 0; j < bh; j++)
      for (let i = 0; i < bw; i++) if (label[(j + j0) * w + i + i0] === id) m[j * bw + i] = 1;
    const b = blobFromMask(m, bw, bh, i0 * kx, j0 * ky, kx, ky)!;
    out.push({ ...b, outline: contours(m, bw, bh, b.x0, b.y0, kx, ky), cut });
  }
  return sortPieces(out);
}

/** Reihenfolge wie beim Lesen: Zeilen von oben nach unten, darin von links nach rechts */
export function sortPieces<T extends { cx: number; cy: number; area: number }>(ps: T[]): T[] {
  if (ps.length < 2) return ps;
  const sizes = ps.map((p) => Math.sqrt(p.area)).sort((a, b) => a - b);
  const tol = sizes[sizes.length >> 1] / 2;
  const byY = [...ps].sort((a, b) => a.cy - b.cy);
  const rows: T[][] = [];
  for (const p of byY) {
    const row = rows[rows.length - 1];
    if (row && p.cy - row[0].cy <= tol) row.push(p);
    else rows.push([p]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.cx - b.cx));
}

// ---------- Umriss als Vorlage ----------

/** Gerade-Ungerade-Fläche von Polygonen (Welt-mm) als Blob mit Rasterweite k */
export function blobFromPolys(polys: Pt[][], k: number): Blob | null {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of polys) for (const q of p) ((x0 = Math.min(x0, q.x)), (y0 = Math.min(y0, q.y)), (x1 = Math.max(x1, q.x)), (y1 = Math.max(y1, q.y)));
  if (!(x1 > x0 && y1 > y0)) return null;
  const w = Math.max(1, Math.ceil((x1 - x0) / k)),
    h = Math.max(1, Math.ceil((y1 - y0) / k));
  const mask = new Uint8Array(w * h);
  // Zeilenweise Schnittpunkte mit allen Kanten
  for (let j = 0; j < h; j++) {
    const y = y0 + (j + 0.5) * k;
    const xs: number[] = [];
    for (const p of polys)
      for (let a = 0, b = p.length - 1; a < p.length; b = a++) {
        const A = p[a],
          B = p[b];
        if (A.y > y !== B.y > y) xs.push(A.x + ((y - A.y) * (B.x - A.x)) / (B.y - A.y));
      }
    xs.sort((a, b) => a - b);
    for (let n = 0; n + 1 < xs.length; n += 2) {
      const i0 = Math.max(0, Math.ceil((xs[n] - x0) / k - 0.5)),
        i1 = Math.min(w - 1, Math.floor((xs[n + 1] - x0) / k - 0.5));
      for (let i = i0; i <= i1; i++) mask[j * w + i] = 1;
    }
  }
  return blobFromMask(mask, w, h, x0, y0, k, k);
}

// ---------- Drehung bestimmen ----------

/** Deckung, wenn die Vorlage um a gedreht auf das Werkstück gelegt wird (beide Richtungen, Stichprobe mit Schritt s) */
function overlap(ref: Blob, tgt: Blob, a: number, s: number): number {
  const c = Math.cos(a),
    sn = Math.sin(a);
  let hit = 0,
    n = 0;
  const P = ref.pts;
  for (let i = 0; i < P.length; i += 2 * s) {
    const x = P[i],
      y = P[i + 1];
    n++;
    if (inside(tgt, tgt.cx + c * x - sn * y, tgt.cy + sn * x + c * y)) hit++;
  }
  const a1 = hit / Math.max(1, n);
  hit = 0;
  n = 0;
  const Q = tgt.pts;
  for (let i = 0; i < Q.length; i += 2 * s) {
    const x = Q[i],
      y = Q[i + 1];
    n++;
    if (inside(ref, ref.cx + c * x + sn * y, ref.cy - sn * x + c * y)) hit++;
  }
  return Math.min(a1, hit / Math.max(1, n));
}

const wrap = (a: number) => {
  a %= 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a <= -Math.PI) a += 2 * Math.PI;
  return a;
};

/** Drehung der Vorlage ref auf das Werkstück tgt */
export function matchPiece(ref: Blob, tgt: Blob): Match {
  const areaRatio = tgt.area / ref.area;
  const coarse = Math.max(1, Math.floor(ref.pts.length / 2 / 300));
  const STEP = (3 * Math.PI) / 180;
  const scores: { a: number; s: number }[] = [];
  for (let a = -Math.PI + STEP; a <= Math.PI + 1e-9; a += STEP) scores.push({ a, s: overlap(ref, tgt, a, coarse) });
  // Örtliche Maxima fein nachsuchen
  const n = scores.length;
  const peaks = scores.filter((v, i) => v.s >= scores[(i + n - 1) % n].s && v.s >= scores[(i + 1) % n].s).sort((a, b) => b.s - a.s).slice(0, 6);
  const refined = peaks.map(({ a }) => {
    let best = a,
      bs = overlap(ref, tgt, a, 1);
    for (let d = STEP / 2; d > 0.0015; d /= 2)
      for (const c of [best - d, best + d]) {
        const s = overlap(ref, tgt, c, 1);
        if (s > bs) ((bs = s), (best = c));
      }
    return { a: wrap(best), s: bs };
  });
  refined.sort((a, b) => b.s - a.s);
  const top = refined[0] ?? { a: 0, s: 0 };
  // Fast gleich gute Drehungen (Symmetrie): die kleinste nehmen
  const near = refined.filter((r) => r.s >= top.s - 0.02);
  const distinct = near.filter((r, i) => near.findIndex((q) => Math.abs(wrap(q.a - r.a)) < 0.1) === i);
  const pick = distinct.reduce((b, r) => (Math.abs(r.a) < Math.abs(b.a) - 0.01 ? r : b), distinct[0] ?? top);
  return { angle: pick.a, score: pick.s, ambiguous: distinct.length > 1, areaRatio };
}

/** Matrix (Welt): Vorlage mit Schwerpunkt ref um angle gedreht auf den Schwerpunkt tgt legen */
export function pieceMatrix(ref: Pt, tgt: Pt, angle: number): Mat {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return [c, s, -s, c, tgt.x - (c * ref.x - s * ref.y), tgt.y - (s * ref.x + c * ref.y)];
}
