// Tests für die Auswertung eines Materialtests per Foto. Aufruf: npm run test:testphoto
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import type { Corners, GridLayout } from '../src/testphoto';
const { applyH, invertH } = await import('../src/camera');
const { cellAt, cellQuad, cellRect, cornersFromView, gridSize, gridToImage, measureCells, suggestCell } = await import('../src/testphoto');

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
const near = (a: number, b: number, tol: number, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} ≠ ${b} (±${tol})`);

const L: GridLayout = { rows: 3, cols: 4, cellW: 5, cellH: 5, gap: 2 };
// Schräg und perspektivisch fotografiert, gedreht: Ecke 1 liegt im Bild rechts oben
const corners: Corners = [{ x: 560, y: 90 }, { x: 540, y: 420 }, { x: 290, y: 400 }, { x: 300, y: 110 }];
const H = gridToImage(corners, L)!;
// Helligkeit je Zelle: Zeile r, Spalte c; Material 0,8
const MATERIAL = 0.8;
const cellLum = (r: number, c: number) => MATERIAL * (1 - Math.min(0.95, 0.1 + 0.2 * c + 0.12 * r));

/** Foto synthetisch erzeugen: jedes Pixel über die inverse Abbildung ins Raster */
function photo(W: number, Hh: number) {
  const data = new Uint8ClampedArray(W * Hh * 4);
  const inv = invertH(H);
  for (let y = 0; y < Hh; y++)
    for (let x = 0; x < W; x++) {
      const q = applyH(inv, x, y);
      let v = MATERIAL;
      for (let r = 0; r < L.rows; r++)
        for (let c = 0; c < L.cols; c++) {
          const b = cellRect(L, r, c);
          if (q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h) v = cellLum(r, c);
        }
      // Etwas Rauschen
      v = Math.max(0, Math.min(1, v + (((x * 7 + y * 13) % 11) - 5) * 0.002));
      const k = (y * W + x) * 4;
      data[k] = data[k + 1] = data[k + 2] = Math.round(v * 255);
      data[k + 3] = 255;
    }
  return { width: W, height: Hh, data };
}

test('Ecken des Rasters landen auf den angeklickten Punkten', () => {
  const { w, h } = gridSize(L);
  assert.deepEqual([w, h], [26, 19]);
  const q = [applyH(H, 0, 0), applyH(H, w, 0), applyH(H, w, h), applyH(H, 0, h)];
  q.forEach((p, i) => (near(p.x, corners[i].x, 1e-6), near(p.y, corners[i].y, 1e-6)));
  const first = cellQuad(H, L, 0, 0);
  near(first[0].x, corners[0].x, 1e-6);
});

test('Klick im Foto trifft die richtige Zelle, Lücken zählen zur nächsten', () => {
  for (let r = 0; r < L.rows; r++)
    for (let c = 0; c < L.cols; c++) {
      const b = cellRect(L, r, c);
      assert.deepEqual(cellAt(H, L, applyH(H, b.x + b.w / 2, b.y + b.h / 2)), { r, c });
    }
  // Knapp rechts neben Zelle (0, 0) in der Lücke
  assert.deepEqual(cellAt(H, L, applyH(H, 5.8, 2)), { r: 0, c: 0 });
  assert.deepEqual(cellAt(H, L, applyH(H, 6.2, 2)), { r: 0, c: 1 });
  // Weit außerhalb
  assert.equal(cellAt(H, L, applyH(H, -5, 2)), null);
  assert.equal(cellAt(H, L, applyH(H, 10, 30)), null);
});

const img = photo(640, 480);
const m = measureCells(img, H, L);

test('Material in den Lücken wird gemessen', () => {
  assert.ok(m.materialMeasured);
  near(m.material, MATERIAL, 0.02, 'Material');
});

test('Färbung je Zelle gegenüber dem Material', () => {
  for (const t of m.cells) {
    const want = (MATERIAL - cellLum(t.r, t.c)) / MATERIAL;
    near(t.dark, want, 0.03, `Zelle ${t.r}/${t.c}`);
    assert.ok(t.spread < 0.05, `gleichmäßig ${t.spread}`);
  }
});

test('Vorschlag: fast so kräftig wie die kräftigste, mit wenig Energie', () => {
  // Energie steigt mit Spalte und Zeile; kräftigste Zellen liegen rechts unten (gekappt bei 95 %)
  const s = suggestCell(m, (r, c) => (c + 1) * 10 + r);
  assert.ok(s);
  const ds = m.cells.map((t) => t.dark);
  const max = Math.max(...ds), min = Math.min(...ds);
  const chosen = m.cells.find((t) => t.r === s!.r && t.c === s!.c)!;
  assert.ok(chosen.dark >= min + (max - min) * 0.9);
  // Keine andere Zelle mit genug Färbung braucht weniger Energie
  for (const t of m.cells) if (t.dark >= min + (max - min) * 0.9) assert.ok((t.c + 1) * 10 + t.r >= (s!.c + 1) * 10 + s!.r);
});

test('Kein Vorschlag bei gleichförmigem Foto', () => {
  const flat = { width: 100, height: 100, data: new Uint8ClampedArray(100 * 100 * 4).fill(200) };
  const H2 = gridToImage([{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 70 }, { x: 10, y: 70 }], L)!;
  assert.equal(suggestCell(measureCells(flat, H2, L), () => 1), null);
});

test('Ecken aus einem entzerrten Kamerabild', () => {
  // Bett 400 × 300 mm als 800 × 600 Pixel, Raster bei (100, 50) mit 26 × 19 mm
  const c = cornersFromView({ x: 100, y: 50, w: 26, h: 19 }, { x: 0, y: 0, w: 400, h: 300 }, 800, 600)!;
  assert.deepEqual(c[0], { x: 200, y: 100 });
  assert.deepEqual(c[2], { x: 252, y: 138 });
  // Raster außerhalb des Bilds (Kopfkamera-Ausschnitt)
  assert.equal(cornersFromView({ x: 100, y: 50, w: 26, h: 19 }, { x: 200, y: 0, w: 100, h: 100 }, 400, 400), null);
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('alle Tests bestanden');
