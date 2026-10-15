// Bild nachzeichnen (Bild → Vektor): Konturen mit Marching Squares an der Schwelle,
// danach vereinfachen und als Bézierkurven einpassen (fit.ts).
import { fitPolyline } from './fit';
import { Pt, SubPath } from './model';

export interface TraceOptions {
  /** Grauwert-Grenze 0 … 255: dunkler als die Grenze wird nachgezeichnet */
  threshold: number;
  /** Konturen mit kleinerer Fläche (in Bildpunkten²) weglassen */
  ignoreLess: number;
  /** Glättung 0 … 1 */
  smooth: number;
}

/**
 * Konturen der dunklen Flächen eines Graustufenbilds in Bildpunkten (Ursprung oben links).
 * Ecken bleiben erhalten, alles andere wird als Bézierkurve eingepasst.
 */
export function traceGray(g: Float32Array, w: number, h: number, o: TraceOptions): SubPath[] {
  const loops = marchingSquares(g, w, h, o.threshold);
  const out: SubPath[] = [];
  // Toleranzen in Bildpunkten; die Einpassung darf etwas mehr abweichen als die Vereinfachung,
  // sonst zerlegt sie Treppenstufen harter Kanten in viele kleine Kurven
  const rdpTol = 0.5 + o.smooth * 1.5;
  const fitTol = rdpTol + 0.35;
  for (const loop of loops) {
    if (Math.abs(area(loop)) < Math.max(0.5, o.ignoreLess)) continue;
    const simple = rdpClosed(loop, rdpTol);
    if (simple.length < 3) continue;
    // Keine Mindestlänge für Geraden: gerade Stücke erkennt die Einpassung selbst
    out.push(fitPolyline(simple, true, fitTol, { lineMin: Infinity, cornerDeg: 42 }));
  }
  return out;
}

function area(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  return a / 2;
}

/**
 * Geschlossene Konturen an der Schwelle t. Das Bild wird mit einem weißen Rand umgeben,
 * damit alle Konturen geschlossen sind. Koordinaten in Bildpunkten (Punktmitte = x + 0,5).
 */
export function marchingSquares(g: Float32Array, w: number, h: number, t: number): Pt[][] {
  const W = w + 2,
    H = h + 2;
  const val = (x: number, y: number) => (x < 1 || y < 1 || x > w || y > h ? 255 : g[(y - 1) * w + (x - 1)]) - t;
  // Kanten-IDs: waagerecht (x,y)-(x+1,y) = 2·(y·W+x), senkrecht (x,y)-(x,y+1) = 2·(y·W+x)+1
  const next = new Int32Array(W * H * 2).fill(-1);
  const ptX = new Float32Array(W * H * 2);
  const ptY = new Float32Array(W * H * 2);
  const known = new Uint8Array(W * H * 2);
  const crossing = (e: number) => {
    if (known[e]) return;
    known[e] = 1;
    const c = e >> 1,
      x = c % W,
      y = (c - x) / W;
    const fa = val(x, y);
    const fb = (e & 1) === 0 ? val(x + 1, y) : val(x, y + 1);
    const k = fa / (fa - fb);
    // Punktmitten liegen bei Index - 0,5 (wegen des Randes)
    ptX[e] = (e & 1) === 0 ? x + k - 0.5 : x - 0.5;
    ptY[e] = (e & 1) === 0 ? y - 0.5 : y + k - 0.5;
  };
  const starts: number[] = [];
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const tl = val(x, y) < 0,
        tr = val(x + 1, y) < 0,
        br = val(x + 1, y + 1) < 0,
        bl = val(x, y + 1) < 0;
      const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = 2 * (y * W + x),
        bottom = 2 * ((y + 1) * W + x),
        left = 2 * (y * W + x) + 1,
        right = 2 * (y * W + x + 1) + 1;
      // Kanten neben jeder Ecke
      const adj: Record<'tl' | 'tr' | 'br' | 'bl', [number, number]> = {
        tl: [left, top], tr: [top, right], br: [right, bottom], bl: [bottom, left],
      };
      const pos = { tl: [x, y], tr: [x + 1, y], br: [x + 1, y + 1], bl: [x, y + 1] } as const;
      const inside = { tl, tr, br, bl };
      let pairs: [number, number, 'tl' | 'tr' | 'br' | 'bl'][] = [];
      if (code === 10 || code === 5) {
        // Sattel: Mittelwert entscheidet, welche Ecken abgetrennt werden
        const center = (val(x, y) + val(x + 1, y) + val(x + 1, y + 1) + val(x, y + 1)) / 4 < 0;
        const iso = (['tl', 'tr', 'br', 'bl'] as const).filter((c) => inside[c] !== center);
        pairs = iso.map((c) => [adj[c][0], adj[c][1], c]);
      } else {
        const es: number[] = [];
        if (tl !== tr) es.push(top);
        if (tr !== br) es.push(right);
        if (br !== bl) es.push(bottom);
        if (bl !== tl) es.push(left);
        const ref = (['tl', 'tr', 'br', 'bl'] as const).find((c) => inside[c])!;
        pairs = [[es[0], es[1], ref]];
      }
      for (const [a, b, c] of pairs) {
        crossing(a);
        crossing(b);
        // Richtung so wählen, dass innen rechts liegt
        const [cx, cy] = pos[c];
        const ax = ptX[a] + 0.5,
          ay = ptY[a] + 0.5,
          bx = ptX[b] + 0.5,
          by = ptY[b] + 0.5;
        let cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (!inside[c]) cross = -cross;
        if (cross > 0) next[a] = b;
        else next[b] = a;
        starts.push(a);
      }
    }
  }
  const loops: Pt[][] = [];
  const used = new Uint8Array(next.length);
  for (const s of starts) {
    for (const st of [s, next[s]]) {
      if (st < 0 || used[st] || next[st] < 0) continue;
      const loop: Pt[] = [];
      let e = st;
      let guard = 0;
      while (e >= 0 && !used[e] && guard++ < 1e7) {
        used[e] = 1;
        loop.push({ x: ptX[e], y: ptY[e] });
        e = next[e];
      }
      if (loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

/** Douglas-Peucker für geschlossene Linienzüge */
function rdpClosed(pts: Pt[], tol: number): Pt[] {
  const n = pts.length;
  if (n < 4) return pts;
  // am weitesten vom Startpunkt entfernten Punkt als zweiten Anker nehmen
  let far = 0,
    fd = -1;
  for (let i = 1; i < n; i++) {
    const d = (pts[i].x - pts[0].x) ** 2 + (pts[i].y - pts[0].y) ** 2;
    if (d > fd) ((fd = d), (far = i));
  }
  const a = rdp(pts.slice(0, far + 1), tol);
  const b = rdp([...pts.slice(far), pts[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function rdp(pts: Pt[], tol: number): Pt[] {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    const a = pts[i0],
      b = pts[i1];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const L = Math.hypot(dx, dy) || 1e-9;
    let best = -1,
      bi = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / L;
      if (d > best) ((best = d), (bi = i));
    }
    if (best > tol) {
      keep[bi] = 1;
      stack.push([i0, bi], [bi, i1]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
