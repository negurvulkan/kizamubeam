// Automatisches Verschachteln (Nesting): Teile mit ihren echten Konturen platzsparend auf Platten legen.
//
// Verfahren: Platte und Teile werden auf ein Raster gelegt (Zellmitte in der Fläche = belegt). Damit das Raster nie
// zu eng wird, wächst jede Kontur vorher um den halben Teileabstand plus eine halbe Zelldiagonale; die Platte
// schrumpft entsprechend um den Randabstand. Zwei Teile, deren Rasterzellen sich nicht berühren, halten so sicher
// den Abstand. Jedes Teil sucht in jeder erlaubten Drehung die erste freie Lage von der gewählten Ecke aus
// (Bottom-Left-Fill); genommen wird die Drehung, die am wenigsten weit in die Platte hineinragt. Löcher in Teilen
// bleiben frei, kleine Teile können also in ihnen landen. Mehrere Reihenfolgen werden ausprobiert, die beste zählt.
import ClipperLib from 'clipper-lib';
import type { Mat, Pt } from './model';

/** Geschlossener Linienzug in mm */
export type Poly = Pt[];

export interface NestPart {
  key: number;
  /** Fläche des Teils (Gerade-Ungerade über alle Konturen; Löcher bleiben frei), Weltkoordinaten in mm */
  region: Poly[];
}

export interface NestSheet {
  /** Nutzbare Fläche der Platte (Gerade-Ungerade), z. B. ein Rechteck oder ein Reststück */
  area: Poly[];
  /** Flächen, die auf der ersten Platte schon belegt sind (nicht gewählte Objekte) */
  obstacles: Poly[][];
}

export interface NestOptions {
  /** Abstand zwischen Teilen in mm */
  gap: number;
  /** Abstand zum Rand der Platte in mm */
  margin: number;
  /** Erlaubte Drehungen in Grad (0 sollte dabei sein) */
  rotations: number[];
  /** Ecke, an der sich die Teile sammeln: kleinste bzw. größte x- und y-Werte (interne Koordinaten, y nach unten) */
  flipX: boolean;
  flipY: boolean;
  /** Rasterweite in mm */
  cell: number;
  /** Passt ein Teil nicht mehr, eine weitere (leere) Platte anfangen */
  newSheets: boolean;
  /** Höchstzahl der Platten insgesamt */
  maxSheets: number;
  /** Rechenzeit für weitere Reihenfolgen in ms (0 = nur eine) */
  timeLimit: number;
}

export const DEFAULT_NEST: NestOptions = {
  gap: 2, margin: 3, rotations: [0, 90, 180, 270], flipX: false, flipY: true, cell: 0.5, newSheets: true, maxSheets: 50, timeLimit: 1500,
};

export interface NestPlacement {
  key: number;
  /** Index der Platte (0 = die erste, mit den Hindernissen) */
  sheet: number;
  /** Drehung in Grad (Welt) */
  angle: number;
  /** Transformation, die von links an die Weltmatrix des Teils multipliziert wird */
  m: Mat;
}

export interface NestResult {
  placed: NestPlacement[];
  /** Teile, die auf keine Platte passen (auch nicht auf eine leere) */
  unplaced: number[];
  /** Anzahl benutzter Platten (mindestens 1) */
  sheets: number;
  /** Anteil der nutzbaren Fläche je Platte, der von Teilen bedeckt ist (0 … 1) */
  usage: number[];
}

const SCALE = 1000;
const { Clipper, ClipperOffset, JoinType, EndType, PolyFillType, ClipType, PolyType } = ClipperLib;

const toPaths = (polys: Poly[]): ClipperLib.Paths =>
  polys.filter((p) => p.length >= 3).map((p) => p.map((q) => ({ X: Math.round(q.x * SCALE), Y: Math.round(q.y * SCALE) })));
const fromPaths = (paths: ClipperLib.Paths): Poly[] => paths.map((p) => p.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE })));

/** Fläche nach Gerade-Ungerade bereinigen (richtige Umlaufrichtung für den Offset) */
function clean(paths: ClipperLib.Paths): ClipperLib.Paths {
  const c = new Clipper();
  c.AddPaths(paths, PolyType.ptSubject, true);
  const out: ClipperLib.Paths = [];
  c.Execute(ClipType.ctUnion, out, PolyFillType.pftEvenOdd, PolyFillType.pftEvenOdd);
  return out;
}

/** Fläche um d mm wachsen (d > 0) oder schrumpfen lassen, runde Ecken */
export function grow(polys: Poly[], d: number): Poly[] {
  const paths = clean(toPaths(polys));
  if (!paths.length) return [];
  if (Math.abs(d) < 1e-6) return fromPaths(paths);
  const co = new ClipperOffset(2, 0.02 * SCALE);
  co.AddPaths(paths, JoinType.jtRound, EndType.etClosedPolygon);
  const out: ClipperLib.Paths = [];
  co.Execute(out, d * SCALE);
  return fromPaths(out);
}

/** Flächeninhalt nach Gerade-Ungerade (mm²) */
export function regionArea(polys: Poly[]): number {
  return clean(toPaths(polys)).reduce((s, p) => s + ClipperLib.Clipper.Area(p), 0) / (SCALE * SCALE);
}

/**
 * Rasterzeilen einer Fläche: Für jede Zeile j (Mitte bei y0 + (j + ½)·cell) die Bereiche [a, b] der Spalten, deren
 * Mitte innen liegt (Gerade-Ungerade).
 */
function scanSpans(polys: Poly[], x0: number, y0: number, cols: number, rows: number, cell: number): Int32Array[] {
  const xs: number[][] = Array.from({ length: rows }, () => []);
  for (const p of polys)
    for (let i = 0; i < p.length; i++) {
      const a = p[i],
        b = p[(i + 1) % p.length];
      if (a.y === b.y) continue;
      const lo = a.y < b.y ? a : b,
        hi = a.y < b.y ? b : a;
      // Zeilen, deren Mitte im halboffenen Bereich [lo.y, hi.y) liegt
      const j0 = Math.max(0, Math.ceil((lo.y - y0) / cell - 0.5));
      const j1 = Math.min(rows - 1, Math.ceil((hi.y - y0) / cell - 0.5) - 1);
      const k = (hi.x - lo.x) / (hi.y - lo.y);
      for (let j = j0; j <= j1; j++) {
        const y = y0 + (j + 0.5) * cell;
        xs[j].push(lo.x + (y - lo.y) * k);
      }
    }
  return xs.map((row) => {
    row.sort((u, v) => u - v);
    const spans: number[] = [];
    for (let i = 0; i + 1 < row.length; i += 2) {
      const a = Math.max(0, Math.ceil((row[i] - x0) / cell - 0.5));
      const b = Math.min(cols - 1, Math.ceil((row[i + 1] - x0) / cell - 0.5) - 1);
      if (b < a) continue;
      // An vorherige Spanne anschließen, wenn lückenlos
      if (spans.length && spans[spans.length - 1] >= a - 1) spans[spans.length - 1] = Math.max(spans[spans.length - 1], b);
      else spans.push(a, b);
    }
    return Int32Array.from(spans);
  });
}

/** Ein Teil in einer Drehung auf dem Raster */
interface Raster {
  angle: number;
  /** Ausdehnung in Zellen */
  w: number;
  h: number;
  /** Je Zeile die Spaltenbereiche [a0, b0, a1, b1, …] */
  rows: Int32Array[];
  cells: number;
  /** Linke obere Ecke des Rasters im gespiegelten Rahmen, relativ zur Teilmitte */
  ox: number;
  oy: number;
}

interface PartPrep {
  key: number;
  /** Mitte (gespiegelter Rahmen) */
  c: Pt;
  rasters: Raster[];
  area: number;
  bw: number;
  bh: number;
  shape: string;
}

/** Belegung einer Platte */
class Grid {
  occ: Uint8Array;
  /** Je Zelle: Spalte der letzten belegten Zelle bis hierher in derselben Zeile (−1 = keine) */
  prev: Int32Array;
  free: number;
  usable: number;
  covered = 0;
  /** Zuletzt gefundene Lage je Teilform und Drehung: gleiche Teile müssen erst dahinter suchen */
  memo = new Map<string, number>();
  constructor(readonly W: number, readonly H: number, src?: Grid) {
    this.occ = src ? src.occ.slice() : new Uint8Array(W * H);
    this.prev = src ? src.prev.slice() : new Int32Array(W * H);
    this.free = src ? src.free : 0;
    this.usable = src ? src.usable : 0;
  }
  refreshRow(j: number) {
    const W = this.W,
      base = j * W;
    let last = -1;
    for (let i = 0; i < W; i++) {
      if (this.occ[base + i]) last = i;
      this.prev[base + i] = last;
    }
  }
  fill(rows: Int32Array[], px: number, py: number) {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row.length) continue;
      const base = (py + r) * this.W + px;
      for (let s = 0; s < row.length; s += 2)
        for (let i = row[s]; i <= row[s + 1]; i++)
          if (!this.occ[base + i]) {
            this.occ[base + i] = 1;
            this.free--;
          }
      this.refreshRow(py + r);
    }
  }
  /**
   * Erste freie Lage in Zeilenreihenfolge (kleinste Zeile, darin kleinste Spalte), beginnend bei Index start.
   * Zeilen, bei denen das Teil weiter als maxBottom hinausragen würde, werden nicht mehr durchsucht.
   */
  find(r: Raster, start: number, maxBottom: number): number {
    const { W, H, prev } = this;
    const lastPy = Math.min(H - r.h, maxBottom - r.h);
    let hot = 0;
    for (let py = Math.floor(start / W); py <= lastPy; py++) {
      let px = py === Math.floor(start / W) ? start % W : 0;
      while (px <= W - r.w) {
        let hit = -1;
        // Zuerst die Zeile prüfen, die zuletzt im Weg war
        for (let k = 0; k < r.h && hit < 0; k++) {
          const rr = (hot + k) % r.h;
          const row = r.rows[rr];
          const base = (py + rr) * W + px;
          for (let s = 0; s < row.length; s += 2) {
            const q = prev[base + row[s + 1]];
            if (q >= px + row[s]) {
              hit = q - row[s] + 1;
              hot = rr;
              break;
            }
          }
        }
        if (hit < 0) return py * W + px;
        px = hit;
      }
    }
    return -1;
  }
}

/** Schlüssel der Form (relativ zur Mitte), damit gleiche Teile Raster und Suchstand teilen */
function shapeKey(region: Poly[], c: Pt): string {
  return region.map((p) => p.map((q) => `${Math.round((q.x - c.x) * 100)},${Math.round((q.y - c.y) * 100)}`).join(' ')).join('|');
}

function bbox(polys: Poly[]) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of polys)
    for (const q of p) {
      if (q.x < x0) x0 = q.x;
      if (q.y < y0) y0 = q.y;
      if (q.x > x1) x1 = q.x;
      if (q.y > y1) y1 = q.y;
    }
  return { x0, y0, x1, y1 };
}

/** Rasterweite, die für Platte und Teile höchstens etwa maxCells Zellen braucht */
export function autoCell(areaW: number, areaH: number, want: number, maxCells = 1.5e6): number {
  return Math.max(want, Math.sqrt((areaW * areaH) / maxCells));
}

export interface NestProgress {
  /** 0 … 1 */
  done: number;
  /** Bislang beste Lösung: benutzte Platten, Teile ohne Platz */
  sheets: number;
  unplaced: number;
}

/**
 * Teile verschachteln. Als Generator, damit die Oberfläche zwischendurch zeichnen und abbrechen kann; der
 * Rückgabewert ist das Ergebnis. Für einen Aufruf ohne Unterbrechung: nest().
 */
export function* nestSteps(parts: NestPart[], sheet: NestSheet, opt: NestOptions): Generator<NestProgress, NestResult> {
  const cell = opt.cell;
  const sx = opt.flipX ? -1 : 1,
    sy = opt.flipY ? -1 : 1;
  const mir = (polys: Poly[]) => polys.map((p) => p.map((q) => ({ x: q.x * sx, y: q.y * sy })));
  const half = opt.gap / 2 + cell * Math.SQRT1_2;

  // Platte im gespiegelten Rahmen
  const area = mir(sheet.area);
  const ab = bbox(area);
  const empty: NestResult = { placed: [], unplaced: parts.map((p) => p.key), sheets: 1, usage: [0] };
  if (!isFinite(ab.x0)) return empty;
  const X0 = ab.x0,
    Y0 = ab.y0;
  const W = Math.max(1, Math.ceil((ab.x1 - ab.x0) / cell)),
    H = Math.max(1, Math.ceil((ab.y1 - ab.y0) / cell));
  const fresh = new Grid(W, H);
  fresh.occ.fill(1);
  const inner = grow(area, -(opt.margin - opt.gap / 2 + cell * Math.SQRT1_2));
  const allowed = scanSpans(inner, X0, Y0, W, H, cell);
  for (let j = 0; j < H; j++) {
    const row = allowed[j];
    for (let s = 0; s < row.length; s += 2) fresh.occ.fill(0, j * W + row[s], j * W + row[s + 1] + 1);
  }
  for (let j = 0; j < H; j++) fresh.refreshRow(j);
  fresh.free = fresh.occ.reduce((s, v) => s + (v ? 0 : 1), 0);
  fresh.usable = fresh.free;
  const first = new Grid(W, H, fresh);
  for (const ob of sheet.obstacles) {
    const spans = scanSpans(grow(mir(ob), half), X0, Y0, W, H, cell);
    for (let j = 0; j < H; j++) {
      const row = spans[j];
      for (let s = 0; s < row.length; s += 2)
        for (let i = row[s]; i <= row[s + 1]; i++)
          if (!first.occ[j * W + i]) {
            first.occ[j * W + i] = 1;
            first.free--;
          }
    }
  }
  for (let j = 0; j < H; j++) first.refreshRow(j);

  // Teile vorbereiten: gewachsene Kontur in jeder Drehung rastern (gleiche Formen nur einmal)
  const angles = [...new Set(opt.rotations.map((a) => ((Math.round(a * 1000) / 1000) % 360 + 360) % 360))];
  if (!angles.length) angles.push(0);
  const cache = new Map<string, { rasters: Raster[]; area: number }>();
  const preps: PartPrep[] = [];
  const skipped: number[] = [];
  for (const p of parts) {
    const reg = mir(p.region);
    const b = bbox(reg);
    if (!isFinite(b.x0)) {
      skipped.push(p.key);
      continue;
    }
    const c = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    const key = shapeKey(reg, c);
    let hit = cache.get(key);
    if (!hit) {
      const grown = grow(reg, half).map((poly) => poly.map((q) => ({ x: q.x - c.x, y: q.y - c.y })));
      const rasters: Raster[] = [];
      for (const ang of angles) {
        const a = (ang * Math.PI) / 180,
          co = Math.cos(a),
          si = Math.sin(a);
        const rot = grown.map((poly) => poly.map((q) => ({ x: co * q.x - si * q.y, y: si * q.x + co * q.y })));
        const rb = bbox(rot);
        const w = Math.max(1, Math.ceil((rb.x1 - rb.x0) / cell)),
          h = Math.max(1, Math.ceil((rb.y1 - rb.y0) / cell));
        if (w > W || h > H) continue;
        const rows = scanSpans(rot, rb.x0, rb.y0, w, h, cell);
        let cells = 0;
        for (const row of rows) for (let s = 0; s < row.length; s += 2) cells += row[s + 1] - row[s] + 1;
        if (!cells) continue;
        rasters.push({ angle: ang, w, h, rows, cells, ox: rb.x0, oy: rb.y0 });
      }
      hit = { rasters, area: regionArea(reg) };
      cache.set(key, hit);
    }
    preps.push({ key: p.key, c, rasters: hit.rasters, area: hit.area, bw: b.x1 - b.x0, bh: b.y1 - b.y0, shape: key });
  }

  interface Run {
    placed: { prep: PartPrep; sheet: number; r: Raster; px: number; py: number }[];
    unplaced: number[];
    grids: Grid[];
    score: number;
  }
  const run = (order: PartPrep[]): Run => {
    const grids: Grid[] = [new Grid(W, H, first)];
    const placed: Run['placed'] = [];
    const unplaced: number[] = [];
    for (const prep of order) {
      if (!prep.rasters.length) {
        unplaced.push(prep.key);
        continue;
      }
      let done = false;
      for (let s = 0; s <= grids.length && !done; s++) {
        if (s === grids.length) {
          // Neue Platte nur, wenn das Teil auf eine leere überhaupt passt
          if (!opt.newSheets || grids.length >= opt.maxSheets) break;
          grids.push(new Grid(W, H, fresh));
        }
        const g = grids[s];
        let best: { r: Raster; pos: number; bottom: number; right: number } | null = null;
        for (const r of prep.rasters) {
          if (r.cells > g.free) continue;
          const mk = prep.shape + '@' + r.angle;
          const pos = g.find(r, g.memo.get(mk) ?? 0, best ? best.bottom : H);
          if (pos < 0) continue;
          g.memo.set(mk, pos);
          const bottom = Math.floor(pos / W) + r.h,
            right = (pos % W) + r.w;
          if (!best || bottom < best.bottom || (bottom === best.bottom && right < best.right)) best = { r, pos, bottom, right };
        }
        if (best) {
          const px = best.pos % W,
            py = Math.floor(best.pos / W);
          g.fill(best.r.rows, px, py);
          g.covered += prep.area;
          placed.push({ prep, sheet: s, r: best.r, px, py });
          done = true;
        } else if (s === grids.length - 1 && s > 0 && g.free === g.usable) {
          // Passt nicht einmal auf eine leere Platte
          grids.pop();
          break;
        }
      }
      if (!done) unplaced.push(prep.key);
    }
    // Weniger Teile ohne Platz, weniger Platten, dann möglichst wenig Ausdehnung auf der letzten Platte
    const last = grids.length - 1;
    let reach = 0;
    for (const p of placed) if (p.sheet === last) reach = Math.max(reach, (p.py + p.r.h) * (W + 1) + p.px + p.r.w);
    const score = unplaced.length * 1e15 + grids.length * 1e12 + reach;
    return { placed, unplaced, grids, score };
  };

  // Reihenfolgen: größte Fläche, längste Seite, Höhe, Breite zuerst; danach zufällige Vertauschungen der besten
  const orders: ((a: PartPrep, b: PartPrep) => number)[] = [
    (a, b) => b.area - a.area,
    (a, b) => Math.max(b.bw, b.bh) - Math.max(a.bw, a.bh) || b.area - a.area,
    (a, b) => b.bh - a.bh || b.bw - a.bw,
    (a, b) => b.bw - a.bw || b.bh - a.bh,
  ];
  const t0 = Date.now();
  const elapsed = () => Date.now() - t0;
  let best: Run | null = null;
  let bestOrder: PartPrep[] = [];
  const consider = (order: PartPrep[]) => {
    const r = run(order);
    if (!best || r.score < best.score) {
      best = r;
      bestOrder = order;
    }
  };
  const progress = (f: number): NestProgress => ({ done: Math.min(1, f), sheets: best!.grids.length, unplaced: best!.unplaced.length + skipped.length });
  consider([...preps].sort(orders[0]));
  yield progress(opt.timeLimit > 0 ? 0.1 : 1);
  if (opt.timeLimit > 0 && preps.length > 1) {
    for (const cmp of orders.slice(1)) {
      if (elapsed() > opt.timeLimit) break;
      consider([...preps].sort(cmp));
      yield progress(Math.max(0.1, elapsed() / opt.timeLimit));
    }
    // Zufällige Vertauschungen benachbarter (bzw. naher) Teile in der besten Reihenfolge
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let tries = 0;
    while (elapsed() < opt.timeLimit && tries < 400) {
      tries++;
      const o = [...bestOrder];
      const n = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const i = Math.floor(rnd() * o.length);
        const j = Math.min(o.length - 1, i + 1 + Math.floor(rnd() * Math.min(4, o.length)));
        [o[i], o[j]] = [o[j], o[i]];
      }
      consider(o);
      yield progress(elapsed() / opt.timeLimit);
    }
  }

  const b = best as unknown as Run;
  const placed: NestPlacement[] = b.placed.map(({ prep, sheet, r, px, py }) => {
    // Im gespiegelten Rahmen: um die Mitte drehen (Mitte in den Ursprung), dann die Rasterecke auf die Zelle (px, py)
    const tx = X0 + px * cell - r.ox,
      ty = Y0 + py * cell - r.oy;
    // Zurück in die Welt: Drehsinn kehrt sich bei einer Spiegelung um, die Verschiebung wird mitgespiegelt
    const ang = sx * sy * r.angle;
    const a = (ang * Math.PI) / 180,
      co = Math.cos(a),
      si = Math.sin(a);
    const cw = { x: prep.c.x * sx, y: prep.c.y * sy };
    const ex = sx * tx,
      ey = sy * ty;
    const m: Mat = [co, si, -si, co, ex - (co * cw.x - si * cw.y), ey - (si * cw.x + co * cw.y)];
    return { key: prep.key, sheet, angle: ((ang % 360) + 360) % 360, m };
  });
  return {
    placed,
    unplaced: [...b.unplaced, ...skipped],
    sheets: Math.max(1, b.grids.length),
    usage: b.grids.map((g) => {
      const usable = g.usable * cell * cell;
      return usable > 0 ? Math.min(1, g.covered / usable) : 0;
    }),
  };
}

/** Verschachteln ohne Unterbrechung */
export function nest(parts: NestPart[], sheet: NestSheet, opt: NestOptions): NestResult {
  const it = nestSteps(parts, sheet, opt);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}
