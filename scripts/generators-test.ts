// Tests der Generatoren (Zahnrad, Box). Aufruf: npm run test:generators
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import type { Pt, SubPath } from '../src/model';
import type { GearParams } from '../src/generators/gear';
import type { BoxParams } from '../src/generators/box';
const { GEAR, gearGeometry, GEAR_TOL } = await import('../src/generators/gear');
const { BOX, boxOuter, fieldCount } = await import('../src/generators/box');
const { buildGen, checkInput, defaultParams, normalizeParams } = await import('../src/generators/index');
const { bezierPt, segments } = await import('../src/curves');
const ClipperLib = (await import('clipper-lib')).default;

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

const gear = (o: Partial<GearParams> = {}): GearParams => ({ ...(defaultParams(GEAR) as unknown as GearParams), boreType: 'none', kerf: 0, backlash: 0, ...o });
function outline(o: Partial<GearParams>): SubPath[] {
  const r = buildGen(GEAR, gear(o) as unknown as Record<string, number | string | boolean>);
  assert.equal(r.parts.length, 1, r.issues.map((i) => i.msg).join('; '));
  assert.equal(r.parts[0].shape.part, undefined);
  return r.parts[0].shape.subs;
}
/** Unterpfad fein abgetastet; y wieder nach oben (wie in gearGeometry) */
function flatten(sp: SubPath, n = 24): Pt[] {
  const pts: Pt[] = [];
  for (const s of segments(sp)) {
    if (!s.curve) pts.push(s.a);
    else for (let i = 0; i < n; i++) pts.push(bezierPt(s.a, s.c1, s.c2, s.b, i / n));
  }
  return pts.map((p) => ({ x: p.x, y: -p.y }));
}
const polar = (p: Pt) => ({ R: Math.hypot(p.x, p.y), th: Math.PI / 2 - Math.atan2(p.y, p.x) });
/** Winkel auf (−π, π] */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

test('Kenngrößen: Teilkreis, Kopfkreis, Fußkreis, Zahndicke', () => {
  const g = gearGeometry(gear({ teeth: 24, module: 2 }));
  near(g.r, 24, 1e-9, 'r');
  near(g.ra, 26, 1e-9, 'ra');
  near(g.rf, 24 - 2.5, 1e-9, 'rf');
  // Zahndicke auf dem Teilkreis = halbe Teilung
  near(2 * g.flankAngle(g.r) * g.r, Math.PI, 1e-9, 's');
  assert.ok(!g.undercut);
});

test('Kontur folgt der Evolvente und den Kreisen (Abweichung ≤ Toleranz)', () => {
  for (const teeth of [12, 24, 61]) {
    const p = gear({ teeth, module: 1.5 });
    const g = gearGeometry(p);
    const pts = flatten(outline(p)[0]);
    let checked = 0;
    for (const q of pts) {
      const { R, th } = polar(q);
      // in den Zahn 0..z-1 zurückfalten, |θ| = Abstand zur nächsten Zahnmitte
      const tooth = (2 * Math.PI) / teeth;
      const a = Math.abs(wrap(th - Math.round(th / tooth) * tooth));
      assert.ok(R <= g.ra + GEAR_TOL && R >= g.rf - GEAR_TOL, `Radius ${R} außerhalb`);
      if (R > g.rFlank + 0.02 && R < g.ra - 0.02) {
        near(a * R, g.flankAngle(R) * R, GEAR_TOL * 1.5, `Flanke z=${teeth} R=${R.toFixed(3)}`);
        checked++;
      }
    }
    assert.ok(checked > teeth * 20, `zu wenige Flankenpunkte (${checked})`);
  }
});

test('Kontur ist geschlossen und überschneidet sich nicht', () => {
  for (const teeth of [6, 9, 17, 40]) {
    const pts = flatten(outline({ teeth, module: 2 })[0], 8);
    const n = pts.length;
    const cross = (a: Pt, b: Pt, c: Pt, d: Pt) => {
      const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
      return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
    };
    for (let i = 0; i < n; i++)
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        assert.ok(!cross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n]), `z=${teeth}: Selbstüberschneidung bei ${i}/${j}`);
      }
  }
});

test('Unterschnitt bei kleinen Zähnezahlen, nicht ab 17 Zähnen', () => {
  assert.ok(gearGeometry(gear({ teeth: 8 })).undercut, 'z=8 ohne Unterschnitt');
  assert.ok(gearGeometry(gear({ teeth: 12 })).undercut, 'z=12 ohne Unterschnitt');
  assert.ok(!gearGeometry(gear({ teeth: 18 })).undercut, 'z=18 mit Unterschnitt');
  // Profilverschiebung x = 1 − z·sin²α/2 hebt ihn auf
  const x = 1 - (10 * Math.sin((20 * Math.PI) / 180) ** 2) / 2 + 0.01;
  assert.ok(!gearGeometry(gear({ teeth: 10, profileShift: x })).undercut, 'z=10 mit Profilverschiebung');
  const w = GEAR.validate(gear({ teeth: 8 }) as never);
  assert.ok(w.some((i) => i.level === 'warn' && i.key === 'teeth'), 'keine Warnung');
});

test('Schnittfuge versetzt die Kontur um die halbe Fuge, Flankenspiel macht Zähne dünner', () => {
  const a = gearGeometry(gear({ teeth: 20, module: 2 }));
  const k = gearGeometry(gear({ teeth: 20, module: 2, kerf: 0.2 }));
  near(k.ra - a.ra, 0.1, 1e-9, 'Kopfkreis');
  near(k.rf - a.rf, 0.1, 1e-9, 'Fußkreis');
  // Normalabstand der Flanken = halbe Fuge: Bogen auf dem Grundkreis
  near((k.flankAngle(25) - a.flankAngle(25)) * a.rb, 0.1, 1e-9, 'Flanke');
  const j = gearGeometry(gear({ teeth: 20, module: 2, backlash: 0.2 }));
  near(2 * (a.flankAngle(a.r) - j.flankAngle(a.r)) * a.r, 0.1, 1e-9, 'Spiel');
});

test('Bohrungen: rund, D-Profil und Passfedernut, mit Fuge kleiner', () => {
  const round = outline({ boreType: 'round', boreDia: 8, kerf: 0.2 })[1];
  for (const p of flatten(round)) near(Math.hypot(p.x, p.y), 3.9, 0.002, 'Rundbohrung');
  const d = flatten(outline({ boreType: 'dflat', boreDia: 8, boreFlat: 7 })[1]);
  near(Math.max(...d.map((p) => p.y)), 3, 1e-6, 'Abflachung');
  near(Math.min(...d.map((p) => p.y)), -4, 0.01, 'Gegenseite');
  const key = flatten(outline({ boreType: 'key', boreDia: 8, keyWidth: 2, keyDepth: 1.2 })[1]);
  near(Math.max(...key.map((p) => p.y)), 5.2, 1e-6, 'Nutgrund');
  near(Math.max(...key.filter((p) => p.y > 4.5).map((p) => Math.abs(p.x))), 1, 1e-6, 'Nutbreite');
});

/** Zwei Räder im Eingriff: Schnittfläche der Konturen bei verschiedenen Drehstellungen */
function meshOverlap(z1: number, z2: number, o: Partial<GearParams>): number {
  const S = 1e5;
  const g1 = flatten(outline({ ...o, teeth: z1 })[0], 16);
  const g2 = flatten(outline({ ...o, teeth: z2 })[0], 16);
  const m = o.module ?? 2;
  const x = (o.profileShift ?? 0) * 2;
  const a = (m * (z1 + z2)) / 2 + x * m;
  const place = (pts: Pt[], ang: number, cy: number) =>
    pts.map((p) => ({ X: Math.round((p.x * Math.cos(ang) - p.y * Math.sin(ang)) * S), Y: Math.round((p.x * Math.sin(ang) + p.y * Math.cos(ang) + cy) * S) }));
  let worst = 0;
  for (let i = 0; i < 24; i++) {
    const d = ((i / 24) * 2 * Math.PI) / z1;
    // Rad 2 oben, mit einer Lücke nach unten (gegenüber Zahn 0 von Rad 1)
    const a2 = Math.PI + Math.PI / z2 - (d * z1) / z2;
    const c = new ClipperLib.Clipper();
    c.AddPath(place(g1, d, 0), ClipperLib.PolyType.ptSubject, true);
    c.AddPath(place(g2, a2, a), ClipperLib.PolyType.ptClip, true);
    const sol: { X: number; Y: number }[][] = [];
    c.Execute(ClipperLib.ClipType.ctIntersection, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    const area = sol.reduce((s, p) => s + Math.abs(ClipperLib.Clipper.Area(p)), 0) / (S * S);
    worst = Math.max(worst, area);
  }
  return worst;
}

test('Räder greifen ohne Überschneidung ineinander (auch mit Unterschnitt)', () => {
  for (const [z1, z2] of [[20, 20], [12, 30], [8, 25], [15, 16]]) {
    const ov = meshOverlap(z1, z2, { module: 2, backlash: 0.04 });
    assert.ok(ov < 1e-4, `z=${z1}/${z2}: Überschneidung ${ov} mm²`);
  }
  // Gegenprobe: ohne Spiel und mit Fuge (Rad zu dick) überschneiden sie sich
  assert.ok(meshOverlap(20, 20, { module: 2, kerf: 0.3 }) > 1e-3, 'dicke Räder überschneiden sich nicht');
});

test('Profilverschiebung x1 + x2 = 0 kämmt beim Null-Achsabstand', () => {
  // gleiche Verschiebung an beiden Rädern geht nur mit vergrößertem Achsabstand; hier: beide x = 0,3, a + 0,6·m
  const ov = meshOverlap(14, 14, { module: 2, backlash: 0.15, profileShift: 0.3 });
  assert.ok(ov < 1e-4, `Überschneidung ${ov}`);
});

test('Validierung: spitze Zähne, zu große Bohrung, unbekannte Parameter', () => {
  const err = (o: Partial<GearParams>) => GEAR.validate(gear(o) as never).filter((i) => i.level === 'error');
  assert.ok(err({ teeth: 10, profileShift: 0.85 }).length, 'spitze Zähne nicht erkannt');
  assert.ok(err({ boreType: 'round', boreDia: 50 }).length, 'Bohrung zu groß nicht erkannt');
  assert.ok(err({ boreType: 'dflat', boreDia: 6, boreFlat: 2 }).length, 'Abflachung nicht geprüft');
  assert.equal(err({}).length, 0);
  assert.ok(checkInput(GEAR, { teeth: 3 }).length, 'Bereich nicht geprüft');
  assert.ok(checkInput(GEAR, { zaehne: 12 }).length, 'unbekannter Parameter nicht erkannt');
  const n = normalizeParams(GEAR, { teeth: 12.4, module: 'x', boreType: 'quadrat' });
  assert.equal(n.teeth, 12);
  assert.equal(n.module, 2);
  assert.equal(n.boreType, 'round');
});

// Box

const box = (o: Partial<BoxParams> = {}): BoxParams => ({ ...(defaultParams(BOX) as unknown as BoxParams), kerf: 0, ...o });
function boxParts(o: Partial<BoxParams>) {
  const r = buildGen(BOX, box(o) as unknown as Record<string, number | string | boolean>);
  assert.ok(r.parts.length, r.issues.map((i) => i.msg).join('; '));
  for (const p of r.parts) for (const sp of p.shape.subs) assert.ok(sp.nodes.every((n) => !n.cin && !n.cout), 'Box-Kanten müssen gerade sein');
  return new Map(r.parts.map((p) => [p.shape.part!, p.shape.subs[0].nodes as Pt[]]));
}
const bbox = (pts: Pt[]) => ({
  w: Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)),
  h: Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)),
});
function inside(pts: Pt[], x: number, y: number) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i],
      b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
/**
 * Teile in 3D zusammenstecken und mit Zufallspunkten prüfen: Wie viele Platten enthalten jeden Punkt?
 * Liefert Zahl der Punkte in zwei Platten und Zahl der Punkte der Wandschale ohne Platte.
 */
function assemble(o: Partial<BoxParams>, samples = 60000) {
  const p = box(o);
  const parts = boxParts(o);
  const { W, D, H } = boxOuter(p);
  const th = p.thickness;
  // Lokale Koordinaten der Teile: Mitte im Ursprung, y nach unten (oben = Oberkante der Wände)
  const inPart = (k: string, x: number, y: number, a: number, b: number) => parts.has(k) && inside(parts.get(k)!, x - a / 2, y - b / 2);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let overlap = 0,
    holes = 0;
  for (let n = 0; n < samples; n++) {
    // Punkte nur in der Schale (Abstand < Dicke zur Außenfläche)
    const X = rnd() * W,
      Y = rnd() * D,
      Z = rnd() * H;
    if (X > th && X < W - th && Y > th && Y < D - th && Z > th && Z < H - th) continue;
    let cnt = 0;
    if (Z < th && inPart('bottom', X, Y, W, D)) cnt++;
    if (Z > H - th && inPart('top', X, Y, W, D)) cnt++;
    if (Y < th && inPart('front', X, H - Z, W, H)) cnt++;
    if (Y > D - th && inPart('back', X, H - Z, W, H)) cnt++;
    if (X < th && inPart('left', Y, H - Z, D, H)) cnt++;
    if (X > W - th && inPart('right', Y, H - Z, D, H)) cnt++;
    if (cnt > 1) overlap++;
    const openTop = p.top === 'open' && Z > H - th && X > th && X < W - th && Y > th && Y < D - th;
    if (cnt === 0 && !openTop) holes++;
  }
  return { overlap, holes };
}

test('Box: Teile, Außenmaße und gerade Kanten', () => {
  const open = boxParts({ width: 120, depth: 80, height: 60, thickness: 4 });
  assert.deepEqual([...open.keys()].sort(), ['back', 'bottom', 'front', 'left', 'right']);
  near(bbox(open.get('bottom')!).w, 120, 1e-9, 'Boden Breite');
  near(bbox(open.get('bottom')!).h, 80, 1e-9, 'Boden Tiefe');
  near(bbox(open.get('front')!).h, 60, 1e-9, 'Wand Höhe');
  near(bbox(open.get('left')!).w, 80, 1e-9, 'Seitenwand Breite');
  const closed = boxParts({ top: 'closed' });
  assert.equal(closed.size, 6);
  // Innenmaß: Wände kommen dazu
  const p = box({ sizeMode: 'inner', width: 100, depth: 50, height: 40, thickness: 3, top: 'closed' });
  assert.deepEqual(boxOuter(p), { W: 106, D: 56, H: 46 });
  assert.equal(fieldCount(94, 10), 9);
  assert.equal(fieldCount(30, 10), 3);
  assert.equal(fieldCount(5, 10), 1);
});

test('Box: Teile passen lückenlos und ohne Überschneidung zusammen', () => {
  for (const o of [
    { width: 100, depth: 80, height: 50, thickness: 3 },
    { width: 100, depth: 80, height: 50, thickness: 3, top: 'closed' as const },
    { width: 37, depth: 151, height: 23.5, thickness: 4.2, finger: 6, top: 'closed' as const },
    { width: 60, depth: 60, height: 60, thickness: 5, finger: 50 },
  ]) {
    const r = assemble(o);
    assert.equal(r.overlap, 0, `Überschneidung bei ${JSON.stringify(o)}: ${r.overlap}`);
    assert.equal(r.holes, 0, `Lücke bei ${JSON.stringify(o)}: ${r.holes}`);
  }
});

test('Box: Steckspiel lässt Luft, Presspassung überschneidet', () => {
  const play = assemble({ top: 'closed', clearance: 0.3 });
  assert.equal(play.overlap, 0, `Überschneidung mit Spiel: ${play.overlap}`);
  assert.ok(play.holes > 0, 'Spiel ohne Luft');
  const press = assemble({ top: 'closed', clearance: -0.3 });
  assert.ok(press.overlap > 0, 'Presspassung ohne Überdeckung');
  assert.equal(press.holes, 0, `Lücke bei Presspassung: ${press.holes}`);
});

test('Box: Schnittfuge versetzt jede Kontur um die halbe Fuge', () => {
  const a = boxParts({ top: 'closed' }),
    k = boxParts({ top: 'closed', kerf: 0.2 });
  for (const [key, pts] of a) {
    const b0 = bbox(pts),
      b1 = bbox(k.get(key)!);
    near(b1.w, b0.w + 0.2, 1e-9, `${key} Breite`);
    near(b1.h, b0.h + 0.2, 1e-9, `${key} Höhe`);
    assert.equal(k.get(key)!.length, pts.length, `${key}: Eckenzahl`);
  }
});

test('Box: Validierung', () => {
  const lvl = (o: Partial<BoxParams>, l: string) => BOX.validate(box(o) as never).filter((i) => i.level === l);
  assert.equal(lvl({}, 'error').length, 0);
  assert.ok(lvl({ height: 10, thickness: 3 }, 'error').length, 'zu dick nicht erkannt');
  assert.ok(lvl({ clearance: 1, finger: 3 }, 'error').length, 'Spiel zu groß nicht erkannt');
  assert.ok(lvl({ finger: 2 }, 'warn').length, 'schmale Zinken nicht gewarnt');
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Generator-Tests bestanden');
