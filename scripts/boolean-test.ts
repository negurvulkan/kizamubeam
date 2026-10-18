// Tests der Booleschen Operationen (Vereinen, Abziehen, Schnittmenge) und des Offsets. Aufruf: npm run test:boolean
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import ClipperLib from 'clipper-lib';
import type { Mat, Obj, SubPath } from '../src/model';
const { IDENT } = await import('../src/model');
const { booleanOp, closedCount, offsetOp, region } = await import('../src/ops');
const { flattenSub } = await import('../src/clip');
const { bezierPt, segments } = await import('../src/curves');

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
const near = (a: number, b: number, eps: number) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b} (±${eps})`);

const K = 0.5522847498;
let nextId = 1;
const obj = (shape: Obj['shape'], m: Mat = IDENT): Obj => ({ id: nextId++, layer: 0, m, shape }) as Obj;
const rect = (x: number, y: number, w: number, h: number) => obj({ kind: 'rect', w, h, r: 0 } as Obj['shape'], [1, 0, 0, 1, x, y]);
const circleSub = (cx: number, cy: number, r: number): SubPath => {
  const k = r * K;
  return {
    closed: true,
    nodes: [
      { x: cx + r, y: cy, cin: { x: cx + r, y: cy - k }, cout: { x: cx + r, y: cy + k } },
      { x: cx, y: cy + r, cin: { x: cx + k, y: cy + r }, cout: { x: cx - k, y: cy + r } },
      { x: cx - r, y: cy, cin: { x: cx - r, y: cy + k }, cout: { x: cx - r, y: cy - k } },
      { x: cx, y: cy - r, cin: { x: cx - k, y: cy - r }, cout: { x: cx + k, y: cy - r } },
    ],
  };
};
const path = (subs: SubPath[], m: Mat = IDENT) => obj({ kind: 'path', subs }, m);
const group = (children: Obj[]) => obj({ kind: 'group', children });
const rot = (deg: number): Mat => {
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
};
/** Fläche mit Vorzeichen (Löcher negativ), mm² */
const area = (subs: SubPath[]) => subs.reduce((s, sp) => s + ClipperLib.Clipper.Area(flattenSub(sp, IDENT)) / 1e6, 0);
const curves = (subs: SubPath[]) => subs.reduce((s, sp) => s + segments(sp).filter((g) => g.curve).length, 0);

test('Vereinen: zwei überlappende Rechtecke ergeben eine Kontur aus Geraden', () => {
  const r = booleanOp('union', [rect(0, 0, 10, 10), rect(5, 5, 10, 10)]);
  assert.equal(r.length, 1);
  assert.equal(r[0].nodes.length, 8);
  assert.equal(curves(r), 0);
  near(area(r), 175, 1e-6);
});

test('Vereinen: Rechtecke mit gemeinsamer Kante verschmelzen ohne Zwischenknoten', () => {
  const r = booleanOp('union', [rect(0, 0, 10, 10), rect(10, 0, 10, 10)]);
  assert.equal(r.length, 1);
  assert.equal(r[0].nodes.length, 4);
});

test('Abziehen: Kreisloch bleibt Bézierkurve und weicht höchstens 0,02 mm ab', () => {
  const r = booleanOp('subtract', [rect(0, 0, 20, 20), path([circleSub(10, 10, 5)])]);
  assert.equal(r.length, 2);
  const hole = r.find((s) => s.nodes.some((n) => n.cout))!;
  assert.ok(hole.nodes.length <= 8, `${hole.nodes.length} Knoten`);
  let dev = 0;
  for (const g of segments(hole))
    for (let i = 0; i <= 40; i++) {
      const p = bezierPt(g.a, g.c1, g.c2, g.b, i / 40);
      dev = Math.max(dev, Math.abs(Math.hypot(p.x - 10, p.y - 10) - 5));
    }
  assert.ok(dev < 0.02, `Abweichung ${dev}`);
  near(area(r), 400 - Math.PI * 25, 0.2);
});

test('Gruppe aus überlappenden Formen: Überlappung wird kein Loch', () => {
  const g = group([rect(0, 0, 10, 10), rect(5, 0, 10, 10)]);
  near(ClipperLib.Clipper.Area(region(g)[0]) / 1e6, 150, 1e-6);
  const r = booleanOp('union', [g, rect(0, 20, 5, 5)]);
  assert.equal(r.length, 2);
  near(area(r), 175, 1e-6);
});

test('Pfad mit Loch (Ring): Loch bleibt beim Vereinen erhalten', () => {
  const ring = path([circleSub(0, 0, 10), circleSub(0, 0, 5)]);
  const r = booleanOp('union', [ring, rect(8, -2, 10, 4)]);
  assert.equal(r.length, 2);
  near(area(r), Math.PI * 75 + 4 * 8, 0.6);
});

test('Gedrehte Objekte: Matrix wird berücksichtigt', () => {
  const r = booleanOp('intersect', [obj({ kind: 'rect', w: 10, h: 10, r: 0 } as Obj['shape'], rot(45)), rect(-20, -20, 40, 40)]);
  near(area(r), 100, 0.01);
});

test('Deckungsgleiche Formen: Abziehen ergibt nichts, Schnittmenge die Form', () => {
  assert.equal(booleanOp('subtract', [rect(0, 0, 10, 10), rect(0, 0, 10, 10)]).length, 0);
  const r = booleanOp('intersect', [rect(0, 0, 10, 10), rect(0, 0, 10, 10)]);
  assert.equal(r.length, 1);
  near(area(r), 100, 1e-6);
});

test('Gleicher Kreis, gedreht: Abziehen hinterlässt keine haarfeinen Splitter', () => {
  const r = booleanOp('subtract', [path([circleSub(0, 0, 10)]), path([circleSub(0, 0, 10)], rot(36))]);
  assert.equal(r.length, 0, `${r.length} Splitter`);
  const u = booleanOp('union', [path([circleSub(0, 0, 10)]), path([circleSub(0, 0, 10)], rot(36))]);
  assert.equal(u.length, 1);
  assert.ok(u[0].nodes.length <= 12, `${u[0].nodes.length} Knoten`);
});

test('Fast deckungsgleiche Kante (minimal gedreht): keine Splitter', () => {
  const r = booleanOp('subtract', [rect(0, 0, 10, 10), obj({ kind: 'rect', w: 10, h: 10, r: 0 } as Obj['shape'], rot(0.0005))]);
  assert.equal(r.length, 0);
});

test('Splitterfilter verändert echte schmale Teile und Ecken nicht', () => {
  const r = booleanOp('subtract', [rect(0, 0, 10, 10), rect(0.2, -1, 9.6, 9)]);
  near(area(r), 100 - 9.6 * 8, 1e-6);
  const spike = path([{ closed: true, nodes: [{ x: 0, y: 0 }, { x: 20, y: 1 }, { x: 0, y: 2 }] }]);
  near(area(booleanOp('union', [spike, rect(-5, 0, 5, 2)])), 20 + 10, 0.02);
});

test('Abziehen mehrerer Formen von der Basis', () => {
  const r = booleanOp('subtract', [rect(0, 0, 30, 10), rect(2, 2, 3, 3), rect(10, 2, 3, 3), rect(20, 2, 3, 3)]);
  assert.equal(r.length, 4);
  near(area(r), 300 - 27, 1e-6);
});

test('Offene Linien haben keine Fläche', () => {
  assert.equal(closedCount(path([{ closed: false, nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }])), 0);
  assert.equal(closedCount(group([path([{ closed: false, nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }]), rect(0, 0, 1, 1)])), 1);
});

test('Verschweißen einer Gruppe mit sich selbst (Vereinen mit einem Objekt)', () => {
  const r = booleanOp('union', [group([path([circleSub(0, 0, 5)]), path([circleSub(6, 0, 5)]), path([circleSub(12, 0, 5)])])]);
  assert.equal(r.length, 1);
});

test('Offset einer Gruppe mit überlappenden Formen: eine Kontur ohne Loch', () => {
  const r = offsetOp([group([rect(0, 0, 10, 10), rect(5, 0, 10, 10)])], { distance: 1, direction: 'outward', join: 'miter' });
  assert.equal(r.length, 1);
  near(area(r), 17 * 12, 1e-6);
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
