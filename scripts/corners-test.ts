// Tests des Eckenwerkzeugs (Runden, Innen runden, Fasen). Aufruf: npm run test:corners
import { strict as assert } from 'node:assert';
import { SubPath } from '../src/model';
import { cornerSub, isCorner } from '../src/corners';
import { bezierPt, segments } from '../src/curves';

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
const square = () => line([[0, 0], [20, 0], [20, 20], [0, 20]], true);
/** Größte Abweichung der Kurvensegmente vom Kreis um (cx, cy) mit Radius r */
function arcError(sp: SubPath, cx: number, cy: number, r: number) {
  let err = 0;
  for (const s of segments(sp)) {
    if (!s.curve) continue;
    for (let i = 0; i <= 20; i++) {
      const p = bezierPt(s.a, s.c1, s.c2, s.b, i / 20);
      err = Math.max(err, Math.abs(Math.hypot(p.x - cx, p.y - cy) - r));
    }
  }
  return err;
}

test('Ecken erkennen: Quadratecken ja, glatte Knoten und offene Enden nein', () => {
  const sq = square();
  assert.ok([0, 1, 2, 3].every((i) => isCorner(sq, i)));
  const open = line([[0, 0], [10, 0], [20, 0], [20, 10]]);
  assert.ok(!isCorner(open, 0) && !isCorner(open, 1) && isCorner(open, 2) && !isCorner(open, 3));
});

test('Runden einer Quadratecke: exakter Viertelkreis mit Radius r', () => {
  const r = cornerSub(square(), [1], 'round', 5);
  assert.equal(r.done, 1);
  assert.equal(r.limited, 0);
  assert.equal(r.sub.nodes.length, 5);
  const pts = r.sub.nodes.map((n) => [Math.round(n.x * 1e6) / 1e6, Math.round(n.y * 1e6) / 1e6]);
  assert.deepEqual(pts, [[0, 0], [15, 0], [20, 5], [20, 20], [0, 20]]);
  assert.ok(arcError(r.sub, 15, 5, 5) < 0.01, 'Bogen weicht vom Kreis ab');
  // Tangentenstetig: Anfasser liegen auf den Kanten
  near(r.sub.nodes[1].cout!.y, 0);
  near(r.sub.nodes[2].cin!.x, 20);
});

test('Alle Ecken runden: Ergebnis wie abgerundetes Rechteck', () => {
  const r = cornerSub(square(), [0, 1, 2, 3], 'round', 4);
  assert.equal(r.done, 4);
  assert.equal(r.sub.nodes.length, 8);
  assert.ok(r.sub.closed);
  assert.ok(arcError({ closed: false, nodes: [r.sub.nodes[1], r.sub.nodes[2]] }, 16, 4, 4) < 0.01);
});

test('Fasen: Gerade im Abstand r von der Ecke', () => {
  const r = cornerSub(square(), [2], 'chamfer', 3);
  assert.equal(r.done, 1);
  const n = r.sub.nodes;
  assert.ok(segments(r.sub).every((s) => !s.curve));
  near(n[2].x, 20); near(n[2].y, 17);
  near(n[3].x, 17); near(n[3].y, 20);
});

test('Innen runden: Bogen um die Ecke mit Radius r', () => {
  const r = cornerSub(square(), [1], 'inverse', 6);
  assert.equal(r.done, 1);
  assert.ok(arcError(r.sub, 20, 0, 6) < 0.01);
  // Der Bogen wölbt sich zur Ecke hin: Mittelpunkt des Bogens liegt innerhalb des Kreises um (15, 5)
  const s = segments(r.sub).find((g) => g.curve)!;
  const mid = bezierPt(s.a, s.c1, s.c2, s.b, 0.5);
  assert.ok(mid.x > 15 && mid.y < 5);
});

test('Radius zu groß: wird auf die halbe Kante begrenzt, wenn beide Ecken gerundet werden', () => {
  const r = cornerSub(square(), [0, 1, 2, 3], 'round', 50);
  assert.equal(r.limited, 4);
  // Bei 10 mm Rückversatz treffen sich die Bögen in den Kantenmitten: ein Kreis aus vier Bögen
  assert.equal(r.sub.nodes.length, 4);
  assert.ok(arcError(r.sub, 10, 10, 10) < 0.01);
});

test('Spitzer Winkel: Rückversatz r·tan(θ/2)', () => {
  const tri = line([[0, 0], [40, 0], [0, 30]], true);
  // Innenwinkel bei (40, 0): atan(30/40) ≈ 36,87° → Rückversatz 2 · tan(71,57°) = 6 mm
  const r = cornerSub(tri, [1], 'round', 2);
  assert.equal(r.done, 1);
  const [, p1, p2] = r.sub.nodes;
  near(p1.x, 34); near(p1.y, 0);
  near(Math.hypot(p2.x - 40, p2.y), 6);
  // Kreismittelpunkt im Abstand 2 von beiden Kanten: (40 − 6, 2)
  assert.ok(arcError({ closed: false, nodes: [p1, p2] }, 34, 2, 2) < 0.01);
});

test('Ecke zwischen Kurven: Kurven werden gekürzt, Übergang tangentenstetig', () => {
  // Zwei Bögen, die sich bei (10, 0) spitz treffen
  const sp: SubPath = {
    closed: false,
    nodes: [
      { x: 0, y: 0, cout: { x: 3, y: 6 } },
      { x: 10, y: 0, cin: { x: 7, y: 6 }, cout: { x: 13, y: 6 } },
      { x: 20, y: 0, cin: { x: 17, y: 6 } },
    ],
  };
  assert.ok(isCorner(sp, 1));
  const r = cornerSub(sp, [1], 'round', 1);
  assert.equal(r.done, 1);
  assert.equal(r.sub.nodes.length, 4);
  const [, p1, p2] = r.sub.nodes;
  // Anfasser auf beiden Seiten von p1 und p2 liegen auf einer Geraden
  const col = (a: { x: number; y: number }, m: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.abs((m.x - a.x) * (b.y - a.y) - (m.y - a.y) * (b.x - a.x)) / (Math.hypot(b.x - a.x, b.y - a.y) || 1);
  assert.ok(col(p1.cin!, p1, p1.cout!) < 1e-6);
  assert.ok(col(p2.cin!, p2, p2.cout!) < 1e-6);
  assert.ok(!isCorner(r.sub, 1) && !isCorner(r.sub, 2));
});

test('Keine Ecke: nichts ändert sich', () => {
  const sp = line([[0, 0], [10, 0], [20, 0]]);
  const r = cornerSub(sp, [0, 1, 2], 'round', 2);
  assert.equal(r.done, 0);
  assert.equal(r.sub, sp);
});

test('Startpunkt-Markierung bleibt erhalten', () => {
  const sq = square();
  sq.start = true;
  assert.ok(cornerSub(sq, [2], 'chamfer', 1).sub.start);
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
