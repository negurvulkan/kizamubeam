// Tests der Maschinenausgabe: Start-/End-Skripte, „Start Here“, Vorschau gegen Job. Aufruf: npm run test:gcode
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { buildJob, burns, estimate, gcodeFooter, Moves, newDevice, sameMoves, startHere, writeGCode } from '../src/gcode';
import { defaultImageLayer, defaultLayer, loadDoc, Obj } from '../src/model';

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

const motion = (lines: string[]) => lines.filter((l) => /^G[01]\b|^[XY]/.test(l));

await test('End-Skript nach M5 und vor dem Programmende', () => {
  const endScript = 'G0 X0 Y0\n\n  M8  \n';
  assert.deepEqual(gcodeFooter({ ...newDevice({ fw: 'fluidnc' }), endScript }), ['M5', 'G0 X0 Y0', 'M8', 'M2']);
  assert.deepEqual(gcodeFooter({ ...newDevice({ fw: 'marlin' }), endScript }), ['M5', 'G0 X0 Y0', 'M8', 'M400']);
  assert.deepEqual(gcodeFooter({ ...newDevice({ fw: 'smoothie' }), endScript }), ['G0 X0 Y0', 'M8']);
  assert.deepEqual(gcodeFooter(newDevice({ fw: 'fluidnc' })), ['M5', 'M2']);
});

function sampleMoves(): Moves {
  const mv = new Moves(0, 0);
  mv.push(10, 0, 0, 0, 1);
  mv.push(20, 0, 1000, 0.5, 1);
  mv.push(20, 10, 1000, 0.5, 1);
  mv.push(0, 0, 0, 0, -1);
  return mv;
}
const jobOf = (mv: Moves, air: number[] = []) => ({ moves: mv, bounds: { x0: 10, y0: 0, x1: 20, y1: 10 }, travel: null, hull: [], warnings: [], offset: { x: 0, y: 0 }, air });

await test('Start-Skript nach G21/G90/M4, End-Skript am Ende', () => {
  const d = { ...newDevice({ fw: 'fluidnc' }), startScript: 'M7\nG4 P1', endScript: 'M9' };
  const mv = sampleMoves();
  const g = writeGCode(jobOf(mv), d, estimate(mv, d)).lines;
  const k = g.indexOf('G21');
  assert.deepEqual(g.slice(k, k + 5), ['G21', 'G90', 'M4 S0', 'M7', 'G4 P1']);
  assert.deepEqual(g.slice(-3), ['M5', 'M9', 'M2']);
  assert.equal(g.length, motion(g).length + k + 5 + 3);
});

await test('Start Here mitten in einer Laserbewegung', () => {
  const mv = startHere(sampleMoves(), 1, 0.5);
  assert.equal(mv.n, 4);
  assert.deepEqual([mv.x[0], mv.y[0], mv.f[0], mv.s[0]], [15, 0, 0, 0]);
  assert.deepEqual([mv.x[1], mv.f[1], mv.s[1]], [20, 1000, 0.5]);
  const d = newDevice({ fw: 'fluidnc' });
  const g = motion(writeGCode(jobOf(mv), d, estimate(mv, d)).lines);
  assert.deepEqual(g, ['G0 X15 Y0', 'G1 X20 S500 F1000', 'Y10', 'G0 X0 Y0']);
});

await test('Start Here in einem Eilgang und am Ende einer Bewegung', () => {
  let mv = startHere(sampleMoves(), 0, 0.3);
  assert.deepEqual([mv.n, mv.x[0], mv.y[0], mv.x[1]], [4, 10, 0, 20]);
  mv = startHere(sampleMoves(), 1, 1);
  assert.deepEqual([mv.n, mv.x[0], mv.y[0], mv.x[1], mv.y[1]], [3, 20, 0, 20, 10]);
  mv = startHere(sampleMoves(), 3, 0);
  assert.equal(burns(mv), false);
  assert.equal(startHere(sampleMoves(), 4, 0).n, 0);
});

await test('Start Here schaltet Air Assist vor dem Anfahren ein', () => {
  const d = newDevice({ fw: 'fluidnc' });
  const mv = startHere(sampleMoves(), 2, 0.5);
  const g = writeGCode(jobOf(mv, [1]), d, estimate(mv, d)).lines;
  const i = g.indexOf('M8');
  assert.ok(i >= 0 && g[i + 1] === 'G0 X20 Y5', g.join('\n'));
  // Die Rückfahrt zum Start gehört zu keinem Layer: Air Assist ist dabei schon aus
  assert.deepEqual(g.slice(-4), ['M9', 'G0 X0 Y0', 'M5', 'M2']);
});

// Vorschau und Job: gleiche Bahnen und Reihenfolge, nur verschoben (sonst passt „Start Here“ nicht)
for (const startFrom of ['absolute', 'user', 'current'] as const) {
  await test(`Vorschau entspricht dem Job (Starten ab: ${startFrom})`, async () => {
    const objs: Obj[] = [];
    for (let i = 0; i < 12; i++)
      objs.push({ id: i + 1, m: [1, 0, 0, 1, 40 + ((i * 37) % 200), 50 + ((i * 53) % 150)], layer: 1, shape: { kind: i % 2 ? 'rect' : 'ellipse', w: 20, h: 10, r: 0, rx: 8, ry: 5 } as never });
    const doc = loadDoc({ bed: { w: 400, h: 400 }, objs, layers: {} });
    const device = { ...newDevice({ fw: 'fluidnc' }), startFrom, jobOrigin: 6 };
    const inp = { doc, layer: (i: number) => ({ ...defaultLayer(i), mode: 'line' as const }), imgLayer: () => defaultImageLayer(), device, position: { x: 123, y: 77 } };
    const prev = await buildJob({ ...inp, forPreview: true });
    const real = await buildJob(inp);
    assert.ok(real.moves.n > 20);
    assert.ok(sameMoves(prev.moves, real.moves, real.offset));
    if (startFrom !== 'absolute') assert.ok(real.offset.x || real.offset.y);
    // Vorschau liegt auf dem Bett, der Job beginnt am Ursprung bzw. an der Laserposition
    assert.deepEqual(prev.bounds, { x0: real.bounds!.x0 - real.offset.x, y0: real.bounds!.y0 - real.offset.y, x1: real.bounds!.x1 - real.offset.x, y1: real.bounds!.y1 - real.offset.y });
    if (startFrom === 'current') assert.deepEqual([real.moves.x0, real.moves.y0], [123, 77]);
  });
}

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
