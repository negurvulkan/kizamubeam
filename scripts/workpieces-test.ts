// Tests der Werkstückerkennung im Kamerabild. Aufruf: npm run test:workpieces
import { strict as assert } from 'node:assert';
import type { Pt } from '../src/model';
import { blobFromPolys, DEFAULT_DETECT, detectPieces, matchPiece, pieceMatrix, RGBAImage } from '../src/workpieces';

let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

const K = 0.5; // mm je Pixel
const W = 600,
  H = 400; // 300 × 200 mm

/** Zufall mit festem Startwert */
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** Werkstück: 60 × 30 mm mit Kerbe oben rechts (10 × 10), damit die Drehung eindeutig ist */
const notched = (): Pt[] => [
  { x: -30, y: -15 }, { x: 20, y: -15 }, { x: 20, y: -5 }, { x: 30, y: -5 }, { x: 30, y: 15 }, { x: -30, y: 15 },
];
const plain = (): Pt[] => [{ x: -30, y: -15 }, { x: 30, y: -15 }, { x: 30, y: 15 }, { x: -30, y: 15 }];
const place = (p: Pt[], cx: number, cy: number, deg: number) => {
  const a = (deg * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return p.map((q) => ({ x: cx + c * q.x - s * q.y, y: cy + s * q.x + c * q.y }));
};
const inPoly = (p: Pt[], x: number, y: number) => {
  let r = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++)
    if (p[i].y > y !== p[j].y > y && x < p[i].x + ((y - p[i].y) * (p[j].x - p[i].x)) / (p[j].y - p[i].y)) r = !r;
  return r;
};

/** Hellgraues Bett mit Rauschen, dunkle Werkstücke; transparent = außerhalb des Kamerabilds */
function render(polys: Pt[][], o: { bg?: number; fg?: number; noise?: number; hole?: (x: number, y: number) => boolean; texture?: boolean } = {}): RGBAImage {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const x = (i + 0.5) * K,
        y = (j + 0.5) * K;
      const k = (j * W + i) * 4;
      let v = o.bg ?? 200;
      if (o.texture) v += 25 * Math.sin(x / 3) * Math.sin(y / 5);
      if (polys.some((p) => inPoly(p, x, y))) v = o.fg ?? 110;
      v += ((o.noise ?? 12) * (rnd() - 0.5)) * 2;
      data[k] = v;
      data[k + 1] = v * 0.9;
      data[k + 2] = v * 0.8;
      data[k + 3] = o.hole?.(x, y) ? 0 : 255;
    }
  return { width: W, height: H, data };
}

const deg = (a: number) => (a * 180) / Math.PI;
const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} statt ${b}`);
const angDiff = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

test('Gleichartige Werkstücke: Anzahl, Lage, Reihenfolge', () => {
  const at: [number, number, number][] = [[60, 50, 0], [170, 45, 30], [250, 60, -75], [70, 150, 180], [180, 150, 100]];
  const img = render(at.map(([x, y, d]) => place(notched(), x, y, d)));
  const ps = detectPieces(img, K, K, DEFAULT_DETECT);
  assert.equal(ps.length, 5);
  // Lesereihenfolge: obere Reihe links → rechts, dann untere
  const order = [0, 1, 2, 3, 4];
  ps.forEach((p, i) => {
    const [x, y] = at[order[i]];
    // Schwerpunkt des gekerbten Teils liegt nicht in der Mitte des Rechtecks; nur grob prüfen
    near(Math.hypot(p.cx - x, p.cy - y), 0, 3, `Lage ${i}`);
    near(p.area, 60 * 30 - 100, 60, `Fläche ${i}`);
    assert.ok(!p.cut);
    assert.ok(p.outline.length >= 1);
  });
});

test('Drehung gegenüber einem Werkstück als Vorlage', () => {
  const at: [number, number, number][] = [[60, 50, 0], [170, 45, 30], [250, 60, -75], [70, 150, 180], [180, 150, 100], [260, 150, 7]];
  const ps = detectPieces(render(at.map(([x, y, d]) => place(notched(), x, y, d))), K, K, DEFAULT_DETECT);
  assert.equal(ps.length, 6);
  for (let i = 1; i < ps.length; i++) {
    const m = matchPiece(ps[0], ps[i]);
    assert.ok(angDiff(deg(m.angle), at[i][2]) < 1.2, `Teil ${i}: ${deg(m.angle).toFixed(2)}° statt ${at[i][2]}°`);
    assert.ok(m.score > 0.9, `Deckung ${m.score}`);
    assert.ok(!m.ambiguous);
  }
});

test('Gezeichneter Umriss als Vorlage, Matrix trifft das Werkstück', () => {
  const ps = detectPieces(render([place(notched(), 150, 100, 140)]), K, K, DEFAULT_DETECT);
  assert.equal(ps.length, 1);
  // Umriss irgendwo neben dem Bett gezeichnet
  const outline = place(notched(), -80, 40, 0);
  const ref = blobFromPolys([outline], K)!;
  const m = matchPiece(ref, ps[0]);
  assert.ok(angDiff(deg(m.angle), 140) < 1.2, `${deg(m.angle)}`);
  near(m.areaRatio, 1, 0.05, 'Flächenverhältnis');
  // Eine Ecke der Kerbe landet an der richtigen Stelle
  const M = pieceMatrix({ x: ref.cx, y: ref.cy }, { x: ps[0].cx, y: ps[0].cy }, m.angle);
  const q = { x: -80 + 20, y: 40 - 5 };
  const got = { x: M[0] * q.x + M[2] * q.y + M[4], y: M[1] * q.x + M[3] * q.y + M[5] };
  const want = place([{ x: 20, y: -5 }], 150, 100, 140)[0];
  near(Math.hypot(got.x - want.x, got.y - want.y), 0, 0.8, 'Kerbe');
});

test('Symmetrisches Teil: kleinste Drehung, als mehrdeutig markiert', () => {
  const ps = detectPieces(render([place(plain(), 70, 70, 0), place(plain(), 200, 120, 183)]), K, K, DEFAULT_DETECT);
  assert.equal(ps.length, 2);
  const m = matchPiece(ps[0], ps[1]);
  assert.ok(m.ambiguous);
  assert.ok(angDiff(deg(m.angle), 3) < 1.2, `${deg(m.angle)}`);
});

test('Helle Werkstücke auf dunklem Bett', () => {
  const ps = detectPieces(render([place(notched(), 80, 80, 20), place(notched(), 200, 120, 0)], { bg: 40, fg: 220 }), K, K, DEFAULT_DETECT);
  assert.equal(ps.length, 2);
});

test('Kleine Flecken fallen weg, angeschnittene Teile werden markiert', () => {
  const dots = [place(plain(), 0, 0, 0).map((q) => ({ x: 250 + q.x / 10, y: 30 + q.y / 10 }))];
  const img = render([place(notched(), 100, 100, 0), place(notched(), 290, 150, 0), ...dots]);
  const ps = detectPieces(img, K, K, DEFAULT_DETECT);
  assert.equal(ps.length, 2);
  assert.ok(!ps[0].cut && ps[1].cut);
  // Rand des Kamerabilds (durchsichtig) zählt wie der Bildrand
  const img2 = render([place(notched(), 100, 100, 0), place(notched(), 200, 100, 0)], { hole: (x) => x > 215 });
  const ps2 = detectPieces(img2, K, K, DEFAULT_DETECT);
  assert.equal(ps2.length, 2);
  assert.ok(!ps2[0].cut && ps2[1].cut);
});

test('Gemustertes Bett: Foto vom leeren Bett trennt besser', () => {
  seed = 7;
  const empty = render([], { texture: true, bg: 150, noise: 6 });
  seed = 8;
  const img = render([place(notched(), 90, 90, 45), place(notched(), 210, 110, -20)], { texture: true, bg: 150, fg: 95, noise: 6 });
  const ps = detectPieces(img, K, K, DEFAULT_DETECT, empty);
  assert.equal(ps.length, 2);
  const m = matchPiece(ps[0], ps[1]);
  assert.ok(angDiff(deg(m.angle), -65) < 1.5, `${deg(m.angle)}`);
});

test('Werkstück mit Loch: Loch bleibt im Umriss', () => {
  const ring = place(plain(), 150, 100, 0);
  const img = render([ring]);
  // Loch hineinmalen
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const x = (i + 0.5) * K,
        y = (j + 0.5) * K;
      if (Math.hypot(x - 150, y - 100) < 8) for (let c = 0; c < 3; c++) img.data[(j * W + i) * 4 + c] = 200;
    }
  const ps = detectPieces(img, K, K, DEFAULT_DETECT);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].outline.length, 2);
  near(ps[0].area, 1800 - Math.PI * 64, 40, 'Fläche');
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('Alle Tests bestanden');
