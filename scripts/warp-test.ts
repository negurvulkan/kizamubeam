// Tests für Verformen (Bogen, Wölben, Flagge, Perspektive). Aufruf: npm run test:warp
import { strict as assert } from 'node:assert';
import { SubPath } from '../src/model';
import { WARP_KINDS, WARP_TOL, warpError, warpFn, warpSubs, subsBox, homography } from '../src/warp';
import { segments } from '../src/curves';

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
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const line = (pts: [number, number][], closed = false): SubPath => ({ closed, nodes: pts.map(([x, y]) => ({ x, y })) });
const K = 0.5522847498;
const circle = (cx: number, cy: number, r: number): SubPath => {
  const k = r * K;
  return {
    closed: true,
    nodes: [
      { x: cx + r, y: cy, cin: { x: cx + r, y: cy - k }, cout: { x: cx + r, y: cy + k }, smooth: true },
      { x: cx, y: cy + r, cin: { x: cx + k, y: cy + r }, cout: { x: cx - k, y: cy + r }, smooth: true },
      { x: cx - r, y: cy, cin: { x: cx - r, y: cy + k }, cout: { x: cx - r, y: cy - k }, smooth: true },
      { x: cx, y: cy - r, cin: { x: cx - k, y: cy - r }, cout: { x: cx + k, y: cy - r }, smooth: true },
    ],
  };
};
// Ein Rechteck 100 × 30 mit Kreis und Zickzack darin, ähnlich einem Schriftzug
const rect = line([[10, 20], [110, 20], [110, 50], [10, 50]], true);
const shapes = [rect, circle(40, 35, 10), line([[60, 25], [70, 45], [80, 25], [90, 45], [100, 25]])];
const box = subsBox(shapes)!;

test('Rahmen der Testformen', () => {
  near(box.x, 10);
  near(box.y, 20);
  near(box.w, 100);
  near(box.h, 30);
});

for (const kind of WARP_KINDS)
  for (const amount of [100, 50, -70])
    for (const vertical of [false, true])
      test(`${kind} ${amount} % ${vertical ? 'senkrecht' : 'waagerecht'}: Bézier-Ausgabe innerhalb der Toleranz`, () => {
        const f = warpFn({ kind, amount, vertical }, box);
        const out = warpSubs(shapes, f, box);
        assert.equal(out.length, shapes.length);
        out.forEach((sp, i) => assert.equal(sp.closed, shapes[i].closed));
        const err = warpError(shapes, out, f);
        assert.ok(err <= WARP_TOL * 1.5, `Abweichung ${err.toFixed(4)} mm`);
        // Originalknoten bleiben an ihrer abgebildeten Stelle
        const p = f(shapes[2].nodes[2]);
        assert.ok(out[2].nodes.some((n) => Math.hypot(n.x - p.x, n.y - p.y) < 1e-9));
        // Nicht zu viele Knoten (keine Polylinie)
        const nodes = out.reduce((s, sp) => s + sp.nodes.length, 0);
        assert.ok(nodes < 200, `${nodes} Knoten`);
      });

test('Stärke 0 lässt alles unverändert', () => {
  const f = warpFn({ kind: 'arc', amount: 0, vertical: false }, box);
  const out = warpSubs(shapes, f, box);
  assert.deepEqual(out[0].nodes.map((n) => [n.x, n.y]), rect.nodes.map((n) => [n.x, n.y]));
});

test('Bogen 100 %: Mittellinie wird zum Halbkreis mit gleicher Länge, Mitte bleibt', () => {
  const f = warpFn({ kind: 'arc', amount: 100, vertical: false }, box);
  const l = f({ x: 10, y: 35 }),
    r = f({ x: 110, y: 35 }),
    m = f({ x: 60, y: 35 });
  near(m.x, 60);
  near(m.y, 35);
  // Halbkreis mit Umfang 100: Radius 100/π, Enden auf Höhe des Mittelpunkts
  const R = 100 / Math.PI;
  near(l.x, 60 - R, 1e-9);
  near(r.x, 60 + R, 1e-9);
  near(l.y, 35 + R, 1e-9);
  // Positive Stärke wölbt nach oben (y nach unten)
  assert.ok(f({ x: 30, y: 35 }).y > m.y);
});

test('Bogen oben: untere Kante bleibt gerade', () => {
  const f = warpFn({ kind: 'arcUpper', amount: 80, vertical: false }, box);
  for (const x of [10, 35, 60, 90]) near(f({ x, y: 50 }).y, 50);
  assert.ok(f({ x: 60, y: 20 }).y < 20);
});

test('Perspektive: Geraden bleiben Linien ohne Anfasser', () => {
  const f = warpFn({ kind: 'perspective', amount: 60, vertical: false }, box);
  const out = warpSubs([rect], f, box)[0];
  assert.equal(out.nodes.length, 4);
  assert.ok(out.nodes.every((n) => !n.cin && !n.cout));
  // Obere Kante schmaler als die untere
  assert.ok(out.nodes[1].x - out.nodes[0].x < out.nodes[2].x - out.nodes[3].x);
});

test('Homographie bildet die Ecken ab', () => {
  const q = [{ x: 1, y: 2 }, { x: 9, y: 1 }, { x: 11, y: 8 }, { x: 0, y: 7 }] as const;
  const H = homography([...q] as never);
  const c = [H(0, 0), H(1, 0), H(1, 1), H(0, 1)];
  c.forEach((p, i) => (near(p.x, q[i].x, 1e-9), near(p.y, q[i].y, 1e-9)));
});

test('Wölben: Kreis bleibt geschlossen, Kurven bleiben Kurven', () => {
  const f = warpFn({ kind: 'bulge', amount: 100, vertical: false }, box);
  const out = warpSubs([circle(40, 35, 10)], f, box)[0];
  assert.ok(out.closed);
  assert.ok(segments(out).every((g) => g.curve));
  const first = out.nodes[0];
  assert.ok(first.cin && first.cout);
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
