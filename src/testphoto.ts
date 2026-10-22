// Materialtest per Foto auswerten: Ein Foto des gelaserten Testrasters (Kamera oder Datei) wird über die vier
// Ecken des Rasters entzerrt, sodass jede Testzelle im Bild anklickbar ist. Zusätzlich wird die Färbung jeder
// Zelle gegen das unbearbeitete Material in den Lücken gemessen. Daraus ergibt sich ein Vorschlag, aber keine
// Bewertung: Ob eine Zelle verbrannt, zu blass oder durchgeschnitten ist, entscheidet die Person.
import type { Pt } from './model';
import { applyH, homography, invertH } from './camera';

/** Aufbau des Testrasters in mm (wie im Materialtest-Dialog) */
export interface GridLayout {
  rows: number;
  cols: number;
  cellW: number;
  cellH: number;
  gap: number;
}

/**
 * Ecken des Zellrasters im Foto (Pixel), ohne Beschriftung: oben links an der ersten Zelle (Zeile 1, Spalte 1),
 * oben rechts, unten rechts, unten links. „Oben“ ist die Seite mit den Spaltenwerten.
 */
export type Corners = [Pt, Pt, Pt, Pt];

export const gridSize = (L: GridLayout) => ({
  w: L.cols * L.cellW + (L.cols - 1) * L.gap,
  h: L.rows * L.cellH + (L.rows - 1) * L.gap,
});

/** Homographie Raster (mm, Ursprung oben links an der ersten Zelle, y nach unten) → Foto (Pixel) */
export function gridToImage(c: Corners, L: GridLayout): number[] | null {
  const { w, h } = gridSize(L);
  return homography([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], c);
}

/** Lage der Zelle (r, c) im Raster (mm) */
export const cellRect = (L: GridLayout, r: number, c: number) => ({
  x: c * (L.cellW + L.gap),
  y: r * (L.cellH + L.gap),
  w: L.cellW,
  h: L.cellH,
});

/** Umriss der Zelle im Foto */
export function cellQuad(H: number[], L: GridLayout, r: number, c: number): Pt[] {
  const b = cellRect(L, r, c);
  return [
    applyH(H, b.x, b.y),
    applyH(H, b.x + b.w, b.y),
    applyH(H, b.x + b.w, b.y + b.h),
    applyH(H, b.x, b.y + b.h),
  ];
}

/**
 * Zelle unter einem Bildpunkt. Liegt der Punkt in einer Lücke, zählt die nächste Zelle, solange er nicht weiter
 * als eine halbe Lücke daneben liegt; außerhalb des Rasters null.
 */
export function cellAt(H: number[], L: GridLayout, p: Pt): { r: number; c: number } | null {
  const q = applyH(invertH(H), p.x, p.y);
  const { w, h } = gridSize(L);
  const m = L.gap / 2;
  if (!isFinite(q.x) || !isFinite(q.y) || q.x < -m || q.y < -m || q.x > w + m || q.y > h + m) return null;
  const pick = (v: number, size: number, n: number) => Math.max(0, Math.min(n - 1, Math.floor((v + L.gap / 2) / (size + L.gap))));
  return { r: pick(q.y, L.cellH, L.rows), c: pick(q.x, L.cellW, L.cols) };
}

/** Bilddaten wie ImageData (RGBA, zeilenweise) */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Helligkeit 0 (schwarz) … 1 (weiß) am Bildpunkt; null außerhalb des Bilds */
function lum(img: Pixels, p: Pt): number | null {
  const x = Math.round(p.x),
    y = Math.round(p.y);
  if (!(x >= 0 && y >= 0 && x < img.width && y < img.height)) return null;
  const k = (y * img.width + x) * 4;
  const d = img.data;
  return (0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]) / 255;
}

const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const i = s.length >> 1;
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};

export interface CellTone {
  r: number;
  c: number;
  /** Mittlere Helligkeit 0 … 1 */
  lum: number;
  /** Färbung gegenüber dem Material: 0 = wie unbearbeitet, 1 = schwarz */
  dark: number;
  /** Ungleichmäßigkeit: Standardabweichung der Helligkeit, bezogen auf das Material */
  spread: number;
}

export interface Measurement {
  cells: CellTone[];
  /** Helligkeit des unbearbeiteten Materials (Lücken zwischen den Zellen, Rand rechts und unten) */
  material: number;
  /** false, wenn kein Materialbereich messbar war und Weiß als Bezug dient */
  materialMeasured: boolean;
}

/**
 * Färbung jeder Zelle messen. Gemessen wird das innere Feld jeder Zelle (Rand 15 % weggelassen, damit kleine
 * Fehler beim Ausrichten nicht stören); das Material in den Lücken und knapp außerhalb rechts und unten.
 */
export function measureCells(img: Pixels, H: number[], L: GridLayout, samples = 10): Measurement {
  const cells: CellTone[] = [];
  const n = Math.max(2, samples);
  const inner = (a: number, size: number, i: number) => a + size * (0.15 + (0.7 * i) / (n - 1));
  for (let r = 0; r < L.rows; r++)
    for (let c = 0; c < L.cols; c++) {
      const b = cellRect(L, r, c);
      const v: number[] = [];
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const l = lum(img, applyH(H, inner(b.x, b.w, i), inner(b.y, b.h, j)));
          if (l !== null) v.push(l);
        }
      const mean = v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
      const sd = v.length ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length) : NaN;
      cells.push({ r, c, lum: mean, dark: 0, spread: sd });
    }

  // Material: Mitte der Lücken (nur breite genug, sonst trifft man die Zellränder), dazu ein Streifen außerhalb
  // rechts und unten im Abstand einer Lücke bzw. mindestens 1 mm (oben und links steht die Beschriftung)
  const bg: number[] = [];
  const { w, h } = gridSize(L);
  const add = (x: number, y: number) => {
    const l = lum(img, applyH(H, x, y));
    if (l !== null) bg.push(l);
  };
  const along = (len: number, f: (s: number) => void) => {
    const k = Math.max(4, Math.round(len / 1.5));
    for (let i = 0; i <= k; i++) f((len * i) / k);
  };
  if (L.gap >= 0.8) {
    for (let c = 1; c < L.cols; c++) {
      const x = c * (L.cellW + L.gap) - L.gap / 2;
      along(h, (y) => add(x, y));
    }
    for (let r = 1; r < L.rows; r++) {
      const y = r * (L.cellH + L.gap) - L.gap / 2;
      along(w, (x) => add(x, y));
    }
  }
  const off = Math.max(1, L.gap);
  along(h, (y) => add(w + off, y));
  along(w, (x) => add(x, h + off));
  const m = median(bg);
  const material = m !== null && m > 0.02 ? m : 1;
  for (const t of cells) {
    t.dark = isFinite(t.lum) ? Math.max(0, Math.min(1, (material - t.lum) / material)) : 0;
    t.spread = isFinite(t.spread) ? t.spread / material : 0;
  }
  return { cells, material, materialMeasured: m !== null && m > 0.02 };
}

/**
 * Vorschlag für eine Gravur: unter den Zellen, die fast so kräftig gefärbt sind wie die kräftigste (ab `share`
 * ihrer Färbung), die mit der geringsten Energie. Mehr Energie färbt dann kaum noch stärker, verbrennt aber
 * eher und dauert länger. null, wenn sich die Zellen kaum unterscheiden.
 */
export function suggestCell(m: Measurement, energy: (r: number, c: number) => number, share = 0.9): { r: number; c: number } | null {
  const ds = m.cells.map((t) => t.dark);
  const max = Math.max(...ds),
    min = Math.min(...ds);
  if (!(max - min > 0.08)) return null;
  let best: CellTone | null = null;
  for (const t of m.cells)
    if (t.dark >= min + (max - min) * share && (!best || energy(t.r, t.c) < energy(best.r, best.c))) best = t;
  return best && { r: best.r, c: best.c };
}

/** Ecken des Rasters in einem bettgerechten Kamerabild, das den Bereich `view` (Dokument-mm, y nach unten) zeigt */
export function cornersFromView(grid: { x: number; y: number; w: number; h: number }, view: { x: number; y: number; w: number; h: number }, imgW: number, imgH: number): Corners | null {
  const sx = imgW / view.w,
    sy = imgH / view.h;
  const p = (x: number, y: number): Pt => ({ x: (x - view.x) * sx, y: (y - view.y) * sy });
  const c: Corners = [p(grid.x, grid.y), p(grid.x + grid.w, grid.y), p(grid.x + grid.w, grid.y + grid.h), p(grid.x, grid.y + grid.h)];
  // Nur, wenn das Raster ganz im Bild liegt
  return c.every((q) => q.x >= 0 && q.y >= 0 && q.x <= imgW && q.y <= imgH) ? c : null;
}
