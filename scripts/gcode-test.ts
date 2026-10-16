// Tests der Maschinenausgabe: Start-/End-Skripte, „Start Here“, Vorschau gegen Job. Aufruf: npm run test:gcode
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { buildJob, burns, DEFAULT_ROTARY, Device, estimate, frameGCode, gcodeFooter, jogLines, Moves, newDevice, Rotary, rotaryTestLines, sameMoves, startHere, writeGCode } from '../src/gcode';
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

// Gesetzter Startpunkt (Set Start Point): die Optimierung beginnt dort und behält die Richtung
for (const fixed of [false, true]) {
  await test(`Startpunkt ${fixed ? 'gesetzt: bleibt' : 'frei: nächster Knoten'}`, async () => {
    const sq = { closed: true, nodes: [{ x: 100, y: 300 }, { x: 120, y: 300 }, { x: 120, y: 320 }, { x: 100, y: 320 }], ...(fixed ? { start: true } : {}) };
    const ln = { closed: false, nodes: [{ x: 300, y: 300 }, { x: 200, y: 300 }], ...(fixed ? { start: true } : {}) };
    const objs: Obj[] = [
      { id: 1, m: [1, 0, 0, 1, 0, 0], layer: 1, shape: { kind: 'path', subs: [sq] } },
      { id: 2, m: [1, 0, 0, 1, 0, 0], layer: 1, shape: { kind: 'path', subs: [ln] } },
    ];
    const doc = loadDoc({ bed: { w: 400, h: 400 }, objs, layers: {} });
    const device = { ...newDevice({ fw: 'fluidnc' }), startFrom: 'absolute' as const, optimize: true, returnHome: false };
    const job = await buildJob({ doc, layer: (i: number) => ({ ...defaultLayer(i), mode: 'line' as const }), imgLayer: () => defaultImageLayer(), device });
    const mv = job.moves;
    // erste Eilfahrt: zur Ecke des Quadrats
    const first = [mv.x[0], mv.y[0]];
    assert.deepEqual(first, fixed ? [100, 100] : [100, 80]);
    // zweite Eilfahrt: zur Linie; frei am näheren Ende (200), gesetzt am Anfang (300)
    let k = 1;
    while (k < mv.n && mv.f[k] !== 0) k++;
    assert.deepEqual([mv.x[k], mv.y[k]], fixed ? [300, 100] : [200, 100]);
  });
}

// ---------- Drehachse ----------

const rotDev = (r: Partial<Rotary>, extra: Partial<Device> = {}): Device => ({ ...newDevice({ fw: 'fluidnc' }), ...extra, rotary: { ...DEFAULT_ROTARY, enabled: true, ...r } });
const moveLines = (lines: string[]) => lines.filter((l) => /^G[01]\b|^[XYAZ]/.test(l));

await test('Drehachse am Y-Anschluss: Y gestreckt, Vorschub auf der Oberfläche gleich', () => {
  // Walze Ø 10 mm, 20π mm Achsweg je Umdrehung: 1 mm Oberfläche = 2 mm Y
  const d = rotDev({ kind: 'roller', axis: 'Y', rollerDiam: 10, perRev: 20 * Math.PI });
  const mv = sampleMoves();
  const g = writeGCode(jobOf(mv), d, estimate(mv, d)).lines;
  assert.deepEqual(moveLines(g), ['G0 X10 Y0', 'G1 X20 S500 F1000', 'Y20 F2000', 'G0 X0 Y0']);
  assert.ok(!g.some((l) => l.startsWith('G92')));
});

await test('Drehachse aus: G-Code unverändert', () => {
  const d = rotDev({ kind: 'roller', axis: 'A', rollerDiam: 10, perRev: 360 }, {});
  d.rotary.enabled = false;
  const mv = sampleMoves();
  assert.deepEqual(moveLines(writeGCode(jobOf(mv), d, estimate(mv, d)).lines), ['G0 X10 Y0', 'G1 X20 S500 F1000', 'Y10', 'G0 X0 Y0']);
});

await test('Eigene Achse A mit Futter: Grad statt Y, G92 A0 zu Beginn', () => {
  // Objekt Ø 360/π mm: Umfang 360 mm, also 1 mm = 1°; Start bei Y 50 (aktuelle Position)
  const d = rotDev({ kind: 'chuck', axis: 'A', objectDiam: 360 / Math.PI, perRev: 360 });
  const mv = new Moves(5, 50);
  mv.push(5, 60, 0, 0, 1);
  mv.push(15, 60, 600, 1, 1);
  mv.push(15, 40, 600, 1, 1);
  mv.push(5, 50, 0, 0, -1);
  const g = writeGCode(jobOf(mv), d, estimate(mv, d)).lines;
  const k = g.indexOf('G21');
  assert.deepEqual(g.slice(k, k + 4), ['G21', 'G90', 'G92 A0', 'M4 S0']);
  assert.deepEqual(moveLines(g), ['G0 X5 A10', 'G1 X15 S1000 F600', 'A-10', 'G0 X5 A0']);
  assert.ok(!moveLines(g).some((l) => /Y/.test(l)));
});

await test('Drehrichtung umkehren spiegelt um den Startpunkt', () => {
  const d = rotDev({ kind: 'chuck', axis: 'Y', objectDiam: 100 / Math.PI, perRev: 100, mirror: true });
  const mv = new Moves(0, 50);
  mv.push(0, 60, 0, 0, 1);
  const g = moveLines(writeGCode(jobOf(mv), d, estimate(mv, d)).lines);
  assert.deepEqual(g, ['G0 X0 Y40']);
});

await test('Rahmen mit Drehachse fährt zum Start zurück', () => {
  const d = rotDev({ kind: 'chuck', axis: 'A', objectDiam: 360 / Math.PI, perRev: 360 });
  const job = { ...jobOf(new Moves(0, 0)), bounds: { x0: 10, y0: 0, x1: 20, y1: 5 } };
  const g = frameGCode(job, d, false)!;
  assert.deepEqual(g.slice(0, 3), ['G21', 'G90', 'G92 A0']);
  assert.ok(g.includes('G1 X20 A0 S0 F3000'), g.join('\n'));
  assert.ok(g.includes('G1 X20 A5'), g.join('\n'));
  assert.equal(g[g.length - 2], 'G0 X0 A0');
  // Ohne Drehachse wie bisher
  const g0 = frameGCode(job, newDevice({ fw: 'fluidnc' }), false)!;
  assert.deepEqual(g0, ['G21', 'G90', 'G0 X10 Y0', 'G1 X20 Y0 S0 F3000', 'G1 X20 Y5', 'G1 X10 Y5', 'G1 X10 Y0', 'M5']);
});

await test('Verfahren und Testdrehung auf der Drehachse', () => {
  const d = rotDev({ kind: 'roller', axis: 'A', rollerDiam: 20, objectDiam: 80, perRev: 360 });
  // 1 mm Oberfläche = 360 / (20π) °
  assert.deepEqual(jogLines(d, 0, 20 * Math.PI, 1000), ['$J=G91 G21 A360 F' + Math.round((1000 * 360) / (20 * Math.PI))]);
  // Objekt Ø 80 auf Walze Ø 20: eine Objektumdrehung = vier Walzenumdrehungen
  assert.match(rotaryTestLines(d)[0], /^\$J=G91 G21 A1440 F/);
  assert.deepEqual(jogLines(newDevice({ fw: 'marlin' }), 0, 5, 1000), ['G91', 'G0 Y5 F1000', 'G90']);
});

await test('Warnung, wenn der Job höher ist als der Objektumfang', async () => {
  const objs: Obj[] = [{ id: 1, m: [1, 0, 0, 1, 50, 50], layer: 1, shape: { kind: 'rect', w: 20, h: 100, r: 0 } as never }];
  const doc = loadDoc({ bed: { w: 400, h: 400 }, objs, layers: {} });
  const job = (od: number) => buildJob({ doc, layer: (i: number) => ({ ...defaultLayer(i), mode: 'line' as const }), imgLayer: () => defaultImageLayer(), device: rotDev({ objectDiam: od }) });
  assert.equal((await job(20)).warnings.length, 1);
  assert.equal((await job(40)).warnings.length, 0);
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
