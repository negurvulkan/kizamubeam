// Tests der 3D-Ansicht: Baugruppen in Lage bringen und auf Durchdringungen prüfen. Aufruf: npm run test:3d
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import type { Params } from '../src/generators';
import type { Solid } from '../src/view3d/solids';
const { asmSolids, findOverlaps, solidBounds } = await import('../src/view3d/solids');
const { rotatePose } = await import('../src/view3d/poses');
const { defaultParams, getGenerator } = await import('../src/generators/index');

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
const near = (a: number, b: number, eps: number, what = '') => assert.ok(Math.abs(a - b) < eps, `${what} ${a} ≠ ${b} (±${eps})`);

function solids(gen: string, o: Params = {}): Solid[] {
  const s = asmSolids(gen, { ...defaultParams(getGenerator(gen)!), ...o }, 3);
  assert.ok(s && s.length, `${gen}: keine Teile`);
  return s!;
}
function bounds(s: Solid[]) {
  const b = s.map(solidBounds);
  return [0, 1, 2].map((k) => [Math.min(...b.map((x) => x.min[k])), Math.max(...b.map((x) => x.max[k]))]);
}
const pairs = (s: Solid[]) => findOverlaps(s).map((o) => `${o.a}/${o.b}`);

test('Box: Platten ergeben den Kasten, mit Spiel ohne und mit Presspassung mit Durchdringung', () => {
  for (const o of [{ top: 'closed' }, { top: 'open', width: 37, depth: 151, height: 23.5, thickness: 4.2, finger: 6 }]) {
    const s = solids('box', o);
    assert.deepEqual(pairs(s), [], JSON.stringify(o));
  }
  const s = solids('box', { top: 'closed', width: 120, depth: 80, height: 60 });
  const b = bounds(s);
  [120, 80, 60].forEach((len, k) => (near(b[k][0], 0, 1e-6, 'Anfang'), near(b[k][1], len, 1e-6, 'Ende')));
  assert.deepEqual(pairs(solids('box', { top: 'closed', clearance: 0.3 })), []);
  // Jede der zwölf Kanten greift ineinander
  const press = findOverlaps(solids('box', { top: 'closed', clearance: -0.3 }));
  assert.equal(press.length, 12, press.map((o) => `${o.a}/${o.b}`).join(' '));
  assert.ok(press.every((o) => o.pieces.length > 0 && o.volume > 0.01));
});

test('Schublade: Schubkasten im Korpus, Blende davor, nichts durchdringt sich', () => {
  for (const o of [{}, { front: 'inset' }, { carcass: false }, { sidePlay: 0, topPlay: 0, backPlay: 0 }, { front: 'none', handle: 'none' }]) assert.deepEqual(pairs(solids('drawer', o)), [], JSON.stringify(o));
  const b = bounds(solids('drawer', { width: 160, height: 80, depth: 150, thickness: 3 }));
  near(b[0][0], 0, 1e-6, 'links');
  near(b[0][1], 160, 1e-6, 'rechts');
  near(b[1][0], -3, 1e-6, 'Blende vorne');
  near(b[1][1], 150, 1e-6, 'hinten');
  near(b[2][1], 80, 1e-6, 'oben');
  // Schubkasten mit der Luft in der Öffnung des Korpus
  const d = bounds(solids('drawer', { width: 160, height: 80, depth: 150, thickness: 3, sidePlay: 1, topPlay: 2, backPlay: 2 }).filter((x) => x.key.startsWith('d_')));
  assert.deepEqual(d, [[4, 156], [0, 145], [3, 75]]);
  // Presspassung nur innerhalb von Korpus und Schubkasten
  const press = findOverlaps(solids('drawer', { clearance: -0.3 }));
  assert.ok(press.length > 0);
  assert.ok(press.every((o) => o.a.slice(0, 2) === o.b.slice(0, 2)), press.map((o) => `${o.a}/${o.b}`).join(' '));
});

test('Einsatz: Stege kreuzen sich in den Schlitzen', () => {
  assert.deepEqual(pairs(solids('insert', {})), []);
  assert.deepEqual(pairs(solids('insert', { play: 0 })), []);
  const press = findOverlaps(solids('insert', { cellsX: 4, cellsY: 3, play: -0.3 }));
  assert.equal(press.length, 3 * 2, 'jede Kreuzung');
  const b = bounds(solids('insert', { width: 150, depth: 100, height: 40, endPlay: 0.5 }));
  near(b[1][1] - b[1][0], 99.5, 1e-6, 'Längsstege');
  near(b[2][1] - b[2][0], 40, 1e-6, 'Höhe');
});

test('Steckregal: Böden stecken in den Seiten', () => {
  for (const o of [{}, { play: 0 }, { shelves: 5, width: 420, depth: 200, height: 600, thickness: 6, overhang: 0 }]) assert.deepEqual(pairs(solids('shelf', o)), [], JSON.stringify(o));
  const press = findOverlaps(solids('shelf', { shelves: 3, play: -0.3 }));
  assert.equal(press.length, 2 * 3, press.map((o) => `${o.a}/${o.b}`).join(' '));
  const b = bounds(solids('shelf', { width: 300, depth: 150, height: 300 }));
  near(b[0][1] - b[0][0], 300, 1e-6, 'Breite');
  near(b[2][1], 300, 1e-6, 'Höhe');
});

test('Zahnradpaar: Räder greifen ineinander und drehen sich ohne Durchdringung', () => {
  for (const o of [{}, { teeth1: 13, teeth2: 30 }, { teeth1: 9, teeth2: 9, profileShift: 0.3 }, { plate: false }] as Params[]) {
    const s = solids('gearpair', o);
    const z1 = Number(o.teeth1 ?? defaultParams(getGenerator('gearpair')!).teeth1);
    // Über eine Zahnteilung von Rad 1 drehen
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * ((2 * Math.PI) / z1);
      const turned = s.map((x) => (x.spin ? { ...x, pose: rotatePose(x.pose, a * x.spin) } : x));
      assert.deepEqual(pairs(turned), [], `${JSON.stringify(o)} bei ${a}`);
    }
  }
  // Ohne Flankenspiel und um einen halben Zahn verdreht greifen die Zähne aufeinander
  const s = solids('gearpair', { teeth1: 12, teeth2: 20, plate: true });
  const wrong = s.map((x) => (x.key === 'gear2' ? { ...x, pose: rotatePose(x.pose, Math.PI / 20) } : x));
  assert.deepEqual(pairs(wrong), ['gear1/gear2']);
  // Räder liegen auf der Platte
  const plate = s.find((x) => x.key === 'plate')!;
  near(solidBounds(s.find((x) => x.key === 'gear1')!).min[2], solidBounds(plate).max[2], 1e-9, 'auf der Platte');
});

test('Teile ohne räumlichen Aufbau', () => {
  assert.equal(asmSolids('gear', defaultParams(getGenerator('gear')!), 3), null);
  assert.equal(asmSolids('unbekannt', {}, 3), null);
  const some = asmSolids('box', { ...defaultParams(getGenerator('box')!), top: 'closed' }, 3, new Set(['front', 'left']))!;
  assert.deepEqual(some.map((x) => x.key).sort(), ['front', 'left']);
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle 3D-Tests bestanden');
