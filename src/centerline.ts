// Mittellinien nachzeichnen (Centerline): Striche eines Graustufenbilds auf ihre Mitte
// ausdünnen (Zhang-Suen), das Skelett als Graph auslesen, kurze Seitenäste entfernen,
// an Kreuzungen gerade weiterlaufende Äste verbinden und als offene Bézierpfade einpassen.
import { fitPolyline } from './fit';
import { Pt, SubPath } from './model';
import { rdp, rdpClosed, TraceOptions } from './trace';

/** Mittellinien der dunklen Striche in Bildpunkten (Ursprung oben links, Punktmitte = x + 0,5) */
export function centerlineGray(g: Float32Array, w: number, h: number, o: TraceOptions): SubPath[] {
  // Gepolstertes Raster: ein Bildpunkt Rand ringsum bleibt immer leer
  const W = w + 2,
    H = h + 2;
  const img = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (g[y * w + x] < o.threshold) img[(y + 1) * W + x + 1] = 1;
  const minArea = Math.max(1, o.ignoreLess);
  // Flecken entfernen und kleine Löcher füllen, sonst entstehen Ästchen und Schleifen
  removeSmall(img, W, H, 1, minArea, true);
  removeSmall(img, W, H, 0, minArea, false);
  let fg = 0;
  for (let i = 0; i < img.length; i++) fg += img[i];
  if (!fg) return [];
  thin(img, W, H);
  let skel = 0;
  for (let i = 0; i < img.length; i++) skel += img[i];
  // Mittlere Strichbreite: Fläche / Skelettlänge
  const stroke = fg / Math.max(1, skel);
  const graph = buildGraph(img, W);
  prune(graph, Math.max(2, stroke * 1.2));
  const chains = chain(graph, stroke);
  const rdpTol = 0.5 + o.smooth * 1.5;
  const fitTol = rdpTol + 0.35;
  const minLen = Math.max(2, Math.sqrt(minArea));
  const out: SubPath[] = [];
  for (const c of chains) {
    if (pathLen(c.pts, c.closed) < minLen) continue;
    // Gepolsterte Koordinaten → Bildpunkte (Punktmitte bei x + 0,5)
    let pts = c.pts.map((p) => ({ x: p.x - 0.5, y: p.y - 0.5 }));
    pts = smoothPts(pts, c.closed, o.smooth);
    const simple = c.closed ? rdpClosed(pts, rdpTol) : rdp(pts, rdpTol);
    if (simple.length < (c.closed ? 3 : 2)) continue;
    out.push(fitPolyline(simple, c.closed, fitTol, { lineMin: Infinity, cornerDeg: 42 }));
  }
  return out;
}

const N8 = (W: number) => [-W - 1, -W, -W + 1, 1, W + 1, W, W - 1, -1];

/** Zusammenhängende Bereiche mit Wert v und weniger als minArea Punkten umfärben (Rand-Bereiche bleiben bei Löchern) */
function removeSmall(img: Uint8Array, W: number, H: number, v: number, minArea: number, eight: boolean) {
  const seen = new Uint8Array(img.length);
  const nb = eight ? N8(W) : [-W, 1, W, -1];
  const stack: number[] = [];
  const comp: number[] = [];
  for (let s = 0; s < img.length; s++) {
    if (seen[s] || img[s] !== v) continue;
    comp.length = 0;
    let border = false;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      comp.push(p);
      const x = p % W,
        y = (p - x) / W;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) {
        border = true;
        continue;
      }
      for (const d of nb) {
        const q = p + d;
        if (!seen[q] && img[q] === v) ((seen[q] = 1), stack.push(q));
      }
    }
    if (!border && comp.length < minArea) for (const p of comp) img[p] = 1 - v;
  }
}

/** Ausdünnen nach Zhang-Suen, bearbeitet nur noch gesetzte Punkte */
function thin(img: Uint8Array, W: number, H: number) {
  let cand: number[] = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (img[y * W + x]) cand.push(y * W + x);
  const del: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (const p of cand) {
        const p2 = img[p - W], p3 = img[p - W + 1], p4 = img[p + 1], p5 = img[p + W + 1];
        const p6 = img[p + W], p7 = img[p + W - 1], p8 = img[p - 1], p9 = img[p - W - 1];
        const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (b < 2 || b > 6) continue;
        const a =
          (+(!p2 && p3) as number) + (+(!p3 && p4) as number) + (+(!p4 && p5) as number) + (+(!p5 && p6) as number) +
          (+(!p6 && p7) as number) + (+(!p7 && p8) as number) + (+(!p8 && p9) as number) + (+(!p9 && p2) as number);
        if (a !== 1) continue;
        if (step === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
        del.push(p);
      }
      if (del.length) changed = true;
      for (const p of del) img[p] = 0;
    }
    cand = cand.filter((p) => img[p]);
  }
}

interface Edge {
  a: number;
  b: number;
  pts: Pt[];
  dead?: boolean;
}
interface Graph {
  /** Knotenlage (Kreuzungen als Mittelpunkt ihrer Punktgruppe) */
  pos: Pt[];
  edges: Edge[];
}

/**
 * Skelettpunkte zu Graph: Nachbarn in m-Nachbarschaft (Diagonale nur, wenn keine
 * gemeinsame waagerecht/senkrecht benachbarte Ecke gesetzt ist), damit Treppenstufen keine Kreuzungen sind.
 */
function buildGraph(img: Uint8Array, W: number): Graph {
  const nbs = (p: number): number[] => {
    const r: number[] = [];
    const n = img[p - W], e = img[p + 1], s = img[p + W], wv = img[p - 1];
    if (n) r.push(p - W);
    if (e) r.push(p + 1);
    if (s) r.push(p + W);
    if (wv) r.push(p - 1);
    if (img[p - W + 1] && !n && !e) r.push(p - W + 1);
    if (img[p + W + 1] && !s && !e) r.push(p + W + 1);
    if (img[p + W - 1] && !s && !wv) r.push(p + W - 1);
    if (img[p - W - 1] && !n && !wv) r.push(p - W - 1);
    return r;
  };
  const pt = (p: number): Pt => ({ x: p % W, y: Math.floor(p / W) });
  const deg = new Uint8Array(img.length);
  const pix: number[] = [];
  for (let p = 0; p < img.length; p++) if (img[p]) (pix.push(p), (deg[p] = nbs(p).length));
  // Knoten: Enden und Kreuzungen; benachbarte Kreuzungspunkte bilden einen Knoten
  const node = new Int32Array(img.length).fill(-1);
  const pos: Pt[] = [];
  for (const s of pix) {
    if (deg[s] === 2 || node[s] >= 0) continue;
    const id = pos.length;
    const grp = [s];
    node[s] = id;
    if (deg[s] > 2) {
      for (let i = 0; i < grp.length; i++)
        for (const q of nbs(grp[i])) if (deg[q] > 2 && node[q] < 0) ((node[q] = id), grp.push(q));
    }
    let sx = 0, sy = 0;
    for (const p of grp) ((sx += p % W), (sy += Math.floor(p / W)));
    pos.push({ x: sx / grp.length, y: sy / grp.length });
  }
  const edges: Edge[] = [];
  const used = new Uint8Array(img.length);
  const direct = new Set<string>();
  for (const s of pix) {
    const a = node[s];
    if (a < 0) continue;
    for (const q of nbs(s)) {
      if (node[q] >= 0) {
        // Zwei Knoten direkt benachbart
        const b = node[q];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        if (b !== a && !direct.has(key)) (direct.add(key), edges.push({ a, b, pts: [pos[a], pos[b]] }));
        continue;
      }
      if (used[q]) continue;
      const pts: Pt[] = [pos[a]];
      let prev = s, cur = q;
      while (node[cur] < 0 && !used[cur]) {
        used[cur] = 1;
        pts.push(pt(cur));
        const nx = nbs(cur).find((r) => r !== prev);
        if (nx === undefined) break;
        prev = cur;
        cur = nx;
      }
      const b = node[cur] >= 0 ? node[cur] : a;
      pts.push(pos[b]);
      edges.push({ a, b, pts });
    }
  }
  // Übrige Punkte bilden Ringe ohne Knoten (z. B. ein „O“)
  for (const s of pix) {
    if (used[s] || node[s] >= 0) continue;
    const id = pos.length;
    pos.push(pt(s));
    const pts: Pt[] = [pt(s)];
    used[s] = 1;
    let prev = s, cur = nbs(s)[0];
    while (cur !== undefined && !used[cur]) {
      used[cur] = 1;
      pts.push(pt(cur));
      const nx = nbs(cur).find((r) => r !== prev && !used[r]);
      prev = cur;
      cur = nx ?? -1;
      if (cur < 0) break;
    }
    pts.push(pt(s));
    edges.push({ a: id, b: id, pts });
  }
  return { pos, edges };
}

function pathLen(pts: Pt[], closed = false): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  if (closed && pts.length > 1) l += Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
  return l;
}

function degrees(g: Graph): number[] {
  const d = new Array(g.pos.length).fill(0);
  for (const e of g.edges) if (!e.dead) (d[e.a]++, d[e.b]++);
  return d;
}

/** Kurze Seitenäste (freies Ende an einer Kreuzung) entfernen, danach durchlaufende Knoten auflösen */
function prune(g: Graph, spur: number) {
  for (let pass = 0; pass < 3; pass++) {
    const d = degrees(g);
    let removed = false;
    for (const e of g.edges) {
      if (e.dead) continue;
      if (e.a === e.b) {
        // Winzige Schleife an einer Kreuzung
        if (pathLen(e.pts) < spur) (e.dead = true), (removed = true);
        continue;
      }
      const freeA = d[e.a] === 1, freeB = d[e.b] === 1;
      if (freeA !== freeB && d[freeA ? e.b : e.a] >= 3 && pathLen(e.pts) < spur) {
        e.dead = true;
        d[e.a]--;
        d[e.b]--;
        removed = true;
      }
    }
    if (!removed) break;
  }
}

interface Chain {
  pts: Pt[];
  closed: boolean;
}

/**
 * Kanten zu möglichst langen Linienzügen verbinden: an jedem Knoten werden die Äste paarweise
 * verknüpft, die am geradesten ineinander übergehen (Knick unter 70°). So wird z. B. ein „X“ zu zwei Strichen.
 */
function chain(g: Graph, stroke: number): Chain[] {
  const edges = g.edges.filter((e) => !e.dead);
  // Enden: 2·i = Anfang (an a), 2·i+1 = Ende (an b)
  const ends: number[][] = g.pos.map(() => []);
  edges.forEach((e, i) => (ends[e.a].push(2 * i), ends[e.b].push(2 * i + 1)));
  const look = Math.max(3, stroke * 1.5);
  // Richtung vom Knoten weg, über ein Stück der Kante gemittelt
  const dir = (end: number): Pt => {
    const e = edges[end >> 1];
    const pts = end & 1 ? [...e.pts].reverse() : e.pts;
    const o = pts[0];
    let q = pts[pts.length - 1];
    let l = 0;
    for (let i = 1; i < pts.length; i++) {
      l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (l >= look) {
        q = pts[i];
        break;
      }
    }
    const dx = q.x - o.x, dy = q.y - o.y;
    const L = Math.hypot(dx, dy) || 1;
    return { x: dx / L, y: dy / L };
  };
  const partner = new Int32Array(edges.length * 2).fill(-1);
  for (const list of ends) {
    if (list.length < 2) continue;
    const dirs = list.map(dir);
    const pairs: [number, number, number][] = [];
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        if (list[i] >> 1 === list[j] >> 1 && list.length > 2) continue;
        // −1 = genau gegenüber (gerade weiter)
        pairs.push([dirs[i].x * dirs[j].x + dirs[i].y * dirs[j].y, list[i], list[j]]);
      }
    pairs.sort((p, q) => p[0] - q[0]);
    const limit = list.length === 2 ? Infinity : Math.cos((110 * Math.PI) / 180);
    for (const [c, a, b] of pairs) {
      if (c > limit || partner[a] >= 0 || partner[b] >= 0) continue;
      partner[a] = b;
      partner[b] = a;
    }
  }
  const used = new Uint8Array(edges.length);
  const out: Chain[] = [];
  const walk = (startEnd: number): Chain => {
    const pts: Pt[] = [];
    let end = startEnd;
    let closed = false;
    for (;;) {
      const i = end >> 1;
      used[i] = 1;
      const e = edges[i];
      const seg = end & 1 ? [...e.pts].reverse() : e.pts;
      pts.push(...(pts.length ? seg.slice(1) : seg));
      const far = end ^ 1;
      const nx = partner[far];
      if (nx < 0) break;
      if (nx === startEnd) {
        closed = true;
        break;
      }
      if (used[nx >> 1]) break;
      end = nx;
    }
    if (closed || (pts.length > 2 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y)) {
      pts.pop();
      closed = true;
    }
    return { pts, closed };
  };
  // Zuerst an freien Enden beginnen, dann bleiben nur noch Ringe
  for (let end = 0; end < edges.length * 2; end++) if (!used[end >> 1] && partner[end] < 0) out.push(walk(end));
  for (let i = 0; i < edges.length; i++) if (!used[i]) out.push(walk(2 * i));
  return out;
}

/** Treppenstufen des Pixelrasters glätten (Mittelwert über Nachbarpunkte, freie Enden bleiben) */
function smoothPts(pts: Pt[], closed: boolean, smooth: number): Pt[] {
  const n = pts.length;
  const r = 1 + Math.round(smooth * 2);
  if (n < 3) return pts;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) {
      out.push(pts[i]);
      continue;
    }
    const k = closed ? r : Math.min(r, i, n - 1 - i);
    let sx = 0, sy = 0;
    for (let j = -k; j <= k; j++) {
      const p = pts[(i + j + n) % n];
      sx += p.x;
      sy += p.y;
    }
    out.push({ x: sx / (2 * k + 1), y: sy / (2 * k + 1) });
  }
  return out;
}
