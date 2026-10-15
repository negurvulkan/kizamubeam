// Arrays: Raster- und Kreiskopien der Auswahl (wie „Grid Array“ und „Circular Array“ in LightBurn).
// Beide liefern nur Weltmatrizen je Kopie; die Formen selbst werden unverändert kopiert,
// Bézierkurven bleiben also exakt erhalten. Die erste Matrix ist immer die Identität (das Original).
import { about, IDENT, Mat, mul, rotate, scale, translate } from './model';
import { Box } from './geom';

/** Obergrenze für die Zahl der Kopien, damit eine Fehleingabe die App nicht lahmlegt */
export const MAX_COPIES = 5000;

export interface GridOptions {
  columns: number;
  rows: number;
  /** Abstand in mm: Lücke zwischen den Objekten oder Mittenabstand (siehe spacing) */
  dx: number;
  dy: number;
  spacing: 'gap' | 'center';
  /** Richtung in Maschinensicht: Spalten nach rechts (1) oder links (-1), Zeilen nach oben (1) oder unten (-1) */
  dirX: 1 | -1;
  dirY: 1 | -1;
  /** Jede zweite Zeile waagerecht um diesen Betrag (mm) versetzen */
  rowShift: number;
  /** Jede zweite Spalte senkrecht um diesen Betrag (mm) versetzen, positiv = nach oben */
  colShift: number;
  /** Jede zweite Spalte waagerecht spiegeln */
  mirrorCols: boolean;
  /** Jede zweite Zeile senkrecht spiegeln */
  mirrorRows: boolean;
}

export const DEFAULT_GRID: GridOptions = {
  columns: 3, rows: 2, dx: 5, dy: 5, spacing: 'gap', dirX: 1, dirY: -1, rowShift: 0, colShift: 0, mirrorCols: false, mirrorRows: false,
};

/**
 * Matrizen für ein Rasterarray. b ist die Auswahlbox in Weltkoordinaten (mm, y nach unten).
 * Reihenfolge: zeilenweise, innerhalb der Zeile spaltenweise.
 */
export function gridMatrices(b: Box, o: GridOptions): Mat[] {
  const cols = Math.max(1, Math.round(o.columns)),
    rows = Math.max(1, Math.round(o.rows));
  if (cols * rows > MAX_COPIES) return [IDENT];
  const stepX = o.spacing === 'gap' ? b.w + o.dx : o.dx;
  const stepY = o.spacing === 'gap' ? b.h + o.dy : o.dy;
  const cx = b.x + b.w / 2,
    cy = b.y + b.h / 2;
  const out: Mat[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * stepX * o.dirX + (r % 2 ? o.rowShift : 0);
      // Maschinensicht: nach oben = Welt-y kleiner
      const y = -(r * stepY * o.dirY) - (c % 2 ? o.colShift : 0);
      let m: Mat = translate(x, y);
      const sx = o.mirrorCols && c % 2 ? -1 : 1,
        sy = o.mirrorRows && r % 2 ? -1 : 1;
      if (sx !== 1 || sy !== 1) m = mul(m, about(scale(sx, sy), cx, cy));
      out.push(m);
    }
  }
  return out;
}

export interface CircularOptions {
  /** Anzahl einschließlich Original */
  count: number;
  /** Mittelpunkt in Weltkoordinaten (mm, y nach unten) */
  cx: number;
  cy: number;
  /** Winkelbereich in Grad; 360 = gleichmäßig auf dem ganzen Kreis */
  span: number;
  /** Drehrichtung in Maschinensicht */
  ccw: boolean;
  /** Kopien mitdrehen (sonst nur verschieben, Ausrichtung bleibt) */
  rotate: boolean;
}

/**
 * Matrizen für ein Kreisarray um (cx, cy). b ist die Auswahlbox; ohne Mitdrehen wandert deren Mitte auf dem Kreis.
 * Bei einem vollen Kreis verteilen sich die Kopien gleichmäßig, sonst liegen erste und letzte Kopie an den Enden des Bogens.
 */
export function circularMatrices(b: Box, o: CircularOptions): Mat[] {
  const n = Math.max(1, Math.round(o.count));
  if (n > MAX_COPIES) return [IDENT];
  const full = Math.abs(Math.abs(o.span) - 360) < 1e-9;
  const step = n < 2 ? 0 : full ? 360 / n : o.span / (n - 1);
  const bx = b.x + b.w / 2,
    by = b.y + b.h / 2;
  const out: Mat[] = [];
  for (let i = 0; i < n; i++) {
    // Gegen den Uhrzeigersinn in Maschinensicht ist im Uhrzeigersinn in Weltkoordinaten (y nach unten)
    const a = ((o.ccw ? -1 : 1) * i * step * Math.PI) / 180;
    const R = about(rotate(a), o.cx, o.cy);
    if (o.rotate) out.push(R);
    else {
      const p = { x: R[0] * bx + R[2] * by + R[4], y: R[1] * bx + R[3] * by + R[5] };
      out.push(translate(p.x - bx, p.y - by));
    }
  }
  return out;
}
