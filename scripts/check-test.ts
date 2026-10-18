// Tests für „Konstruktion prüfen“. Aufruf: npm run test:check
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import type { CheckIssue } from '../src/check';
import type { Layer, Obj, Shape, SubPath } from '../src/model';
const { defaultLayer, IDENT, translate } = await import('../src/model');
const { checkDesign, DEFAULT_CHECK, removeSpans } = await import('../src/check');
const { buildGen, defaultParams, GENERATORS } = await import('../src/generators/index');

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

let id = 1;
const obj = (shape: Shape, x = 0, y = 0, layer = 1): Obj => ({ id: id++, m: x || y ? translate(x, y) : IDENT, layer, shape });
const rect = (w: number, h: number, x = 0, y = 0, layer = 1) => obj({ kind: 'rect', w, h, r: 0 }, x, y, layer);
const ellipse = (r: number, x: number, y: number, layer = 1) => obj({ kind: 'ellipse', rx: r, ry: r }, x, y, layer);
const line = (pts: [number, number][], closed = false): SubPath => ({ closed, nodes: pts.map(([x, y]) => ({ x, y })) });
const path = (subs: SubPath[], layer = 1) => obj({ kind: 'path', subs }, 0, 0, layer);

const layers: Record<number, Layer> = {};
const layerOf = (i: number) => (layers[i] ??= defaultLayer(i));
const run = (objs: Obj[], settings = {}): CheckIssue[] =>
  checkDesign({ objs, layer: layerOf, bed: { w: 400, h: 400 }, settings: { ...DEFAULT_CHECK, ...settings } });
const kinds = (xs: CheckIssue[]) => xs.map((x) => x.kind).sort();

test('Saubere Teile: keine Befunde', () => {
  const plate = rect(100, 60, 10, 10);
  const hole = ellipse(5, 40, 40);
  assert.deepEqual(run([plate, hole, rect(30, 30, 150, 10)]), []);
});

test('Deckungsgleiches Objekt: wird gemeldet, Korrektur löscht das spätere', () => {
  const a = rect(50, 50, 10, 10);
  const b = rect(50, 50, 10, 10);
  const xs = run([a, b]);
  assert.deepEqual(kinds(xs), ['double']);
  assert.equal(xs[0].fix?.kind, 'delete');
  assert.deepEqual(xs[0].fix?.kind === 'delete' && xs[0].fix.objs, [b]);
});

test('Gemeinsame Kante: Länge stimmt, Korrektur entfernt sie aus dem späteren Teil', () => {
  const a = rect(50, 30, 10, 10);
  const b = rect(40, 30, 60, 10); // linke Kante von b liegt auf der rechten von a
  const xs = run([a, b]);
  assert.deepEqual(kinds(xs), ['double']);
  assert.match(xs[0].msg, /30/);
  const f = xs[0].fix;
  assert.ok(f && f.kind === 'spans');
  assert.equal(f.items.length, 1);
  assert.equal(f.items[0].leaf, b);
  const rest = removeSpans(line([[0, 0], [40, 0], [40, 30], [0, 30]], true), f.items[0].spans);
  assert.equal(rest.length, 1);
  assert.ok(!rest[0].closed);
  // die linke Kante (x = 0, von unten nach oben) fehlt, der Rest ist ein Linienzug über drei Seiten
  const xsOf = rest[0].nodes.map((n) => Math.round(n.x * 100) / 100);
  assert.deepEqual([xsOf[0], xsOf[xsOf.length - 1]], [0, 0]);
  assert.equal(rest[0].nodes.length, 4);
});

test('Kreis zweimal (verschiedene Startpunkte): als doppelt erkannt', () => {
  const a = ellipse(10, 50, 50);
  const b = obj({ kind: 'ellipse', rx: 10, ry: 10 }, 0, 0);
  b.m = [0, 1, -1, 0, 50, 50]; // um 90° gedreht
  const xs = run([a, b]);
  assert.deepEqual(kinds(xs), ['double']);
  assert.equal(xs[0].fix?.kind, 'delete');
});

test('Fast geschlossener Umriss: gemeldet mit Lücke, Korrektur schließt', () => {
  const p = path([line([[0, 0], [20, 0], [20, 20], [0, 20], [0, 0.4]])]);
  p.m = translate(10, 10);
  const xs = run([p]);
  assert.deepEqual(kinds(xs), ['open']);
  assert.match(xs[0].msg, /0[.,]40/);
  assert.equal(xs[0].fix?.kind, 'close');
});

test('Offene Linie mit großer Lücke auf Linien-Layer: kein Befund, auf Füll-Layer schon', () => {
  const p = path([line([[0, 0], [20, 0], [20, 20]])]);
  p.m = translate(10, 10);
  assert.deepEqual(run([p]), []);
  const q = path([line([[0, 0], [20, 0], [20, 20]])], 0);
  q.m = translate(10, 10);
  assert.deepEqual(kinds(run([q])), ['open']);
});

test('Einzellinien, die einen Umriss bilden: nicht verbunden, Korrektur verbindet', () => {
  const a = path([line([[10, 10], [30, 10]])]);
  const b = path([line([[30, 10], [30, 30]])]);
  const c = path([line([[30, 30], [10, 30], [10, 10]])]);
  const xs = run([a, b, c]);
  assert.deepEqual(kinds(xs), ['unjoined']);
  assert.equal(xs[0].fix?.kind, 'join');
  assert.equal(xs[0].objs.length, 3);
});

test('Schmaler Steg zwischen Loch und Rand: gemeldet mit Breite', () => {
  const plate = rect(50, 50, 10, 10);
  const hole = rect(10, 10, 20, 10.6); // 0,6 mm vom oberen Rand
  const xs = run([plate, hole]);
  assert.deepEqual(kinds(xs), ['web']);
  // 0,6 − Schnittbreite 0,15 = 0,45 mm
  assert.match(xs[0].msg, /0[.,]45/);
  assert.deepEqual(new Set(xs[0].objs), new Set([plate, hole]));
});

test('Füll- und Gravur-Konturen davor stören die Suche nicht', () => {
  const engr = rect(20, 20, 200, 200, 0);
  const plate = rect(50, 50, 10, 10);
  const hole = rect(10, 10, 20, 10.6);
  const dup = rect(30, 30, 100, 100);
  const dup2 = rect(30, 30, 100, 100);
  assert.deepEqual(kinds(run([engr, plate, hole, dup, dup2])), ['double', 'web']);
});

test('Steg breit genug und Kerf-Ausgleich zählt mit', () => {
  const plate = rect(50, 50, 10, 10);
  const hole = rect(10, 10, 20, 12);
  assert.deepEqual(run([plate, hole]), []);
  // schmaler Steg wird mit Kerf-Ausgleich breiter: 0,9 − 0,2 + 2·0,1 = 0,9 < 1 → noch gemeldet; mit 1,1 nicht mehr
  layers[2] = { ...defaultLayer(2), kerf: 0.1 };
  const p2 = rect(50, 50, 10, 10, 0 + 2);
  const h2 = rect(10, 10, 20, 11.1, 2);
  assert.deepEqual(run([p2, h2]), []);
  const h3 = rect(10, 10, 20, 10.8, 2);
  assert.deepEqual(kinds(run([p2, h3])), ['web']);
});

test('Teil im Loch eines anderen ist kein Steg, Spitzen werden erkannt', () => {
  const frame = rect(60, 60, 10, 10);
  const win = rect(40, 40, 20, 20);
  const inner = rect(30, 30, 25, 25); // liegt im Fenster, 5 mm Abstand
  assert.deepEqual(run([frame, win, inner]), []);
  const star = obj({ kind: 'polygon', sides: 5, r: 20, star: true, inner: 0.2 }, 100, 100);
  assert.ok(kinds(run([star])).includes('web'));
});

test('Zu kleiner Ausschnitt und Kerf-Ausgleich, der ihn verschwinden lässt', () => {
  const plate = rect(50, 50, 10, 10);
  const tiny = ellipse(0.12, 30, 30);
  assert.deepEqual(kinds(run([plate, tiny])), ['hole']);
  layers[3] = { ...defaultLayer(3), kerf: 0.2 };
  const p3 = rect(50, 50, 10, 10, 3);
  const h3 = ellipse(0.15, 30, 30, 3);
  const xs = run([p3, h3]);
  assert.deepEqual(kinds(xs), ['hole']);
  assert.equal(xs[0].level, 'error');
  // Gravur-Layer zählen nicht als Schnitt
  assert.deepEqual(run([plate, tiny], { engraveLayers: [1] }), []);
});

test('Außerhalb des Arbeitsbereichs: Korrektur schiebt aufs Bett', () => {
  const a = rect(50, 50, 380, 10);
  const xs = run([a]);
  assert.deepEqual(kinds(xs), ['bed']);
  const f = xs[0].fix;
  assert.ok(f && f.kind === 'bed');
  assert.equal(f.dx, -30);
  assert.equal(f.dy, 0);
  // ausgeblendete Objekte und Layer ohne Ausgabe zählen nicht
  const b = rect(50, 50, 500, 10);
  b.hidden = true;
  const c = rect(50, 50, 500, 10, 30);
  assert.deepEqual(run([b, c]), []);
});

test('Import-Hinweis: ein Befund je Hinweis, Korrektur blendet ihn aus', () => {
  const a = rect(10, 10, 10, 10);
  const b = rect(10, 10, 30, 10);
  a.importNote = b.importNote = 'test.svg: 2 Texte übersprungen.';
  const xs = run([a, b]);
  assert.deepEqual(kinds(xs), ['import']);
  assert.equal(xs[0].level, 'info');
  assert.equal(xs[0].objs.length, 2);
});

test('Generatoren mit Standardwerten: keine Befunde außer den feinen GT2-Zähnen', () => {
  for (const g of GENERATORS) {
    const r = buildGen(g, defaultParams(g));
    assert.ok(r.parts.length, g.id);
    const objs = r.parts.map((p) => obj(p.shape, 20 + (p.at?.x ?? 0), 20 + (p.at?.y ?? 0)));
    const xs = run(objs).filter((x) => x.kind !== 'bed');
    // GT2-Zähne sind zwischen den Lücken nur gut 0,5 mm breit: das ist ein echter Hinweis
    if (g.id === 'pulley') assert.ok(xs.length && xs.every((x) => x.kind === 'web'), g.id);
    else assert.deepEqual(xs.map((x) => `${g.id}: ${x.msg}`), []);
  }
});

test('removeSpans: geschlossener Pfad, Abschnitt über den Anfang', () => {
  const sq = line([[0, 0], [10, 0], [10, 10], [0, 10]], true);
  const r = removeSpans(sq, [[3.5, 0.5]]);
  assert.equal(r.length, 1);
  const xy = (n: { x: number; y: number }) => [n.x, n.y];
  assert.deepEqual(xy(r[0].nodes[0]), [5, 0]);
  assert.deepEqual(xy(r[0].nodes[r[0].nodes.length - 1]), [0, 5]);
  assert.deepEqual(removeSpans(sq, [[0, 4]]), []);
  const open = line([[0, 0], [10, 0], [20, 0]]);
  const r2 = removeSpans(open, [[0.5, 1.5]]);
  assert.equal(r2.length, 2);
});

test('Laufzeit: 400 Teile mit Löchern', () => {
  const objs: Obj[] = [];
  for (let i = 0; i < 20; i++)
    for (let j = 0; j < 20; j++) {
      objs.push(rect(15, 15, 5 + i * 19, 5 + j * 19));
      objs.push(ellipse(3, 12.5 + i * 19, 12.5 + j * 19));
    }
  const t0 = Date.now();
  const xs = run(objs);
  const ms = Date.now() - t0;
  console.log(`     ${ms} ms`);
  assert.deepEqual(xs, []);
  assert.ok(ms < 4000);
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('alle Tests bestanden');
