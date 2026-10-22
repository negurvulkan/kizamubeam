// Tests für „Hintergrund entfernen“. Aufruf: npm run test:bgremove
import { strict as assert } from 'node:assert';
import { backgroundAlpha, DEFAULT_BG, edgeColors, opaqueBounds } from '../src/bgremove';
import type { BgOptions } from '../src/bgremove';

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

/** Bild w × h, Farbe je Bildpunkt aus fn */
function image(w: number, h: number, fn: (x: number, y: number) => [number, number, number, number?]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = fn(x, y);
      d.set([r, g, b, a], (y * w + x) * 4);
    }
  return d;
}
const opt = (o: Partial<BgOptions> = {}): BgOptions => ({ ...DEFAULT_BG, feather: 0, cleanup: 0, ...o });
const at = (a: Uint8ClampedArray, w: number, x: number, y: number) => a[y * w + x];
const inRect = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) => x >= x0 && x < x1 && y >= y0 && y < y1;

// weißer Hintergrund, schwarzer Ring 20..80 mit weißem Inneren 35..65
const W = 100;
const ring = image(W, W, (x, y) => (inRect(x, y, 20, 20, 80, 80) && !inRect(x, y, 35, 35, 65, 65) ? [0, 0, 0] : [255, 255, 255]));

test('Randfarbe wird erkannt', () => {
  assert.deepEqual(edgeColors(ring, W, W), [[255, 255, 255]]);
});

test('Vom Rand aus: Hintergrund weg, Inneres des Rings bleibt', () => {
  const a = backgroundAlpha(ring, W, W, opt());
  assert.equal(at(a, W, 2, 2), 0);
  assert.equal(at(a, W, 25, 25), 255);
  assert.equal(at(a, W, 50, 50), 255);
});

test('Überall: auch das Innere des Rings wird transparent', () => {
  const a = backgroundAlpha(ring, W, W, opt({ mode: 'all' }));
  assert.equal(at(a, W, 50, 50), 0);
  assert.equal(at(a, W, 25, 25), 255);
});

test('Bereinigen füllt kleine Löcher, große bleiben', () => {
  // Loch 5 × 5 = 25 px = 2,5 ‰ des Bildes
  const holed = image(W, W, (x, y) => (inRect(x, y, 20, 20, 80, 80) && !inRect(x, y, 30, 30, 35, 35) ? [0, 0, 0] : [255, 255, 255]));
  assert.equal(at(backgroundAlpha(holed, W, W, opt({ mode: 'all', cleanup: 3 })), W, 32, 32), 255);
  assert.equal(at(backgroundAlpha(holed, W, W, opt({ mode: 'all', cleanup: 2 })), W, 32, 32), 0);
  // das Innere des Rings (900 px = 9 ‰) bleibt auch beim stärksten Bereinigen ein Loch
  assert.equal(at(backgroundAlpha(ring, W, W, opt({ mode: 'all', cleanup: 5 })), W, 50, 50), 0);
});

test('Bereinigen entfernt Staub im Hintergrund', () => {
  const dusty = image(W, W, (x, y) => (inRect(x, y, 10, 10, 12, 12) || inRect(x, y, 40, 40, 70, 70) ? [0, 0, 0] : [255, 255, 255]));
  assert.equal(at(backgroundAlpha(dusty, W, W, opt()), W, 10, 10), 255);
  const a = backgroundAlpha(dusty, W, W, opt({ cleanup: 1 }));
  assert.equal(at(a, W, 10, 10), 0);
  assert.equal(at(a, W, 50, 50), 255);
});

test('Toleranz: leichter Verlauf im Hintergrund, helles Motiv bleibt', () => {
  // Hintergrund von 255 nach 225, Motiv hellgrau 170
  const grad = image(W, W, (x, y) => (inRect(x, y, 30, 30, 70, 70) ? [170, 170, 170] : [255 - (x * 30) / W, 255 - (x * 30) / W, 255 - (x * 30) / W]));
  const a = backgroundAlpha(grad, W, W, opt({ tolerance: 18 }));
  assert.equal(at(a, W, 1, 50), 0);
  assert.equal(at(a, W, 98, 50), 0);
  assert.equal(at(a, W, 50, 50), 255);
  assert.equal(at(backgroundAlpha(grad, W, W, opt({ tolerance: 2, colors: [[255, 255, 255]] })), W, 98, 50), 255);
});

test('Gewählte Farbe statt Rand: grüner Hintergrund', () => {
  const green = image(W, W, (x, y) => (inRect(x, y, 30, 30, 70, 70) ? [200, 40, 40] : [30, 200, 60]));
  const a = backgroundAlpha(green, W, W, opt({ colors: [[30, 200, 60]] }));
  assert.equal(at(a, W, 5, 5), 0);
  assert.equal(at(a, W, 50, 50), 255);
  // Motivfarbe gewählt (Modus „überall“): das Motiv verschwindet
  assert.equal(at(backgroundAlpha(green, W, W, opt({ mode: 'all', colors: [[200, 40, 40]] })), W, 50, 50), 0);
});

test('Schon transparente Stellen bleiben transparent', () => {
  const tr = image(W, W, (x, y) => (x < 50 ? [0, 0, 0, 0] : [0, 0, 0]));
  const a = backgroundAlpha(tr, W, W, opt({ colors: [[255, 255, 255]] }));
  assert.equal(at(a, W, 10, 10), 0);
  assert.equal(at(a, W, 80, 10), 255);
});

test('Weiche Kante nur außen, Motiv bleibt deckend', () => {
  const sq = image(W, W, (x, y) => (inRect(x, y, 30, 30, 70, 70) ? [0, 0, 0] : [255, 255, 255]));
  const a = backgroundAlpha(sq, W, W, opt({ feather: 2 }));
  assert.equal(at(a, W, 30, 50), 255);
  assert.ok(at(a, W, 29, 50) > 0 && at(a, W, 29, 50) < 255);
  assert.equal(at(a, W, 20, 50), 0);
});

test('Rahmen des Motivs', () => {
  const a = backgroundAlpha(ring, W, W, opt());
  assert.deepEqual(opaqueBounds(a, W, W), { x: 20, y: 20, w: 60, h: 60 });
  assert.equal(opaqueBounds(new Uint8ClampedArray(4), 2, 2), null);
});

test('12 Megapixel in vertretbarer Zeit', () => {
  const w = 4000,
    h = 3000;
  const big = image(w, h, (x, y) => ((x - 2000) ** 2 + (y - 1500) ** 2 < 1000 ** 2 ? [(x * 7) & 255, (y * 3) & 255, 90] : [250, 248, 245]));
  const t0 = performance.now();
  const a = backgroundAlpha(big, w, h, { ...DEFAULT_BG });
  const ms = performance.now() - t0;
  console.log(`     ${Math.round(ms)} ms`);
  assert.equal(a[0], 0);
  assert.equal(a[1500 * w + 2000], 255);
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
