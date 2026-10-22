// Tests für Mittellinien nachzeichnen. Aufruf: npm run test:centerline
import { strict as assert } from 'node:assert';
import { centerlineGray } from '../src/centerline';
import { SubPath } from '../src/model';

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

/** Weißes Bild, dunkel wo inside(x, y) für die Punktmitte gilt */
function img(w: number, h: number, inside: (x: number, y: number) => boolean): Float32Array {
  const g = new Float32Array(w * h).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x + 0.5, y + 0.5)) g[y * w + x] = 0;
  return g;
}
/** Abstand Punkt–Strecke */
const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax, dy = by - ay;
  const k = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - k * dx, py - ay - k * dy);
};
const stroke = (segs: [number, number, number, number][], r: number) => (x: number, y: number) =>
  segs.some(([ax, ay, bx, by]) => segDist(x, y, ax, ay, bx, by) <= r);
const opt = { threshold: 128, ignoreLess: 10, smooth: 0.3 };
const run = (w: number, h: number, f: (x: number, y: number) => boolean) => centerlineGray(img(w, h, f), w, h, opt);
const allNodes = (subs: SubPath[]) => subs.flatMap((s) => s.nodes);

test('Waagerechter Strich wird eine offene Linie auf der Mitte', () => {
  const subs = run(120, 40, stroke([[10, 20, 110, 20]], 6));
  assert.equal(subs.length, 1);
  assert.equal(subs[0].closed, false);
  for (const n of subs[0].nodes) assert.ok(Math.abs(n.y - 20) < 1, `y = ${n.y}`);
  const xs = subs[0].nodes.map((n) => n.x);
  assert.ok(Math.min(...xs) < 14 && Math.max(...xs) > 106, `x ${Math.min(...xs)} … ${Math.max(...xs)}`);
});

test('Kreuz (X) wird zu zwei durchgehenden Strichen', () => {
  const subs = run(120, 120, stroke([[10, 10, 110, 110], [110, 10, 10, 110]], 5));
  assert.equal(subs.length, 2);
  for (const s of subs) {
    const a = s.nodes[0], b = s.nodes[s.nodes.length - 1];
    assert.ok(Math.hypot(b.x - a.x, b.y - a.y) > 120, 'Strich läuft durch die Kreuzung');
  }
});

test('Ring wird ein geschlossener Pfad mit passendem Radius', () => {
  const subs = run(120, 120, (x, y) => Math.abs(Math.hypot(x - 60, y - 60) - 40) <= 5);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].closed, true);
  for (const n of subs[0].nodes) assert.ok(Math.abs(Math.hypot(n.x - 60, n.y - 60) - 40) < 1.2, `r = ${Math.hypot(n.x - 60, n.y - 60)}`);
});

test('T: Querbalken bleibt ganz, Stamm ist ein zweiter Strich, keine Ästchen', () => {
  const subs = run(120, 120, stroke([[10, 15, 110, 15], [60, 15, 60, 110]], 6));
  assert.equal(subs.length, 2);
});

test('L-Ecke ohne Seitenast', () => {
  const subs = run(120, 120, stroke([[15, 10, 15, 105], [15, 105, 110, 105]], 7));
  assert.equal(subs.length, 1);
});

test('Flecken unter „Kleines ignorieren“ fallen weg', () => {
  const subs = run(120, 40, (x, y) => stroke([[10, 20, 110, 20]], 4)(x, y) || Math.hypot(x - 60, y - 5) < 1.5);
  assert.equal(subs.length, 1);
});

test('Leeres Bild liefert nichts', () => {
  assert.equal(run(50, 50, () => false).length, 0);
});

test('Laufzeit: 2000 × 2000 Bildpunkte mit vielen Strichen', () => {
  const segs: [number, number, number, number][] = [];
  for (let i = 0; i < 40; i++) segs.push([50 + i * 45, 100, 80 + i * 45, 1900], [100, 50 + i * 45, 1900, 90 + i * 45]);
  const w = 2000;
  const g = new Float32Array(w * w).fill(255);
  // Gitter aus dicken Linien direkt zeichnen (schneller als segDist je Punkt)
  for (const [ax, ay, bx, by] of segs) {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay));
    for (let k = 0; k <= n; k++) {
      const cx = ax + ((bx - ax) * k) / n, cy = ay + ((by - ay) * k) / n;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) if (dx * dx + dy * dy <= 36) g[Math.round(cy + dy) * w + Math.round(cx + dx)] = 0;
    }
  }
  const t0 = performance.now();
  const subs = centerlineGray(g, w, w, opt);
  const ms = performance.now() - t0;
  console.log(`     ${subs.length} Linien, ${allNodes(subs).length} Knoten, ${Math.round(ms)} ms`);
  assert.ok(subs.length >= 80 && subs.length < 200, `${subs.length} Linien`);
  assert.ok(ms < 5000);
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
