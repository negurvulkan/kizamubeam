// Tests für variablen Text und QR-Codes. Aufruf: npm run test:vartext
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
const g = globalThis as Record<string, unknown>;
// Path2D gibt es in Node nicht; für die Umrisse reicht eine leere Hülle
g.Path2D ??= class { moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} addPath() {} };
const { advanceVarText, defaultVarText, expand, parseCsv, setVarTextSource } = await import('../src/vartext');
const { barcodeOutline, cellOutlines, qrMatrix, wifiData } = await import('../src/barcode');
const { buildJob, newDevice } = await import('../src/gcode');
const { defaultImageLayer, defaultLayer, loadDoc } = await import('../src/model');

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

const when = new Date(2026, 9, 6, 14, 5, 9); // 6. Oktober 2026, 14:05:09

await test('Seriennummer, Nullen und Prozentzeichen', () => {
  const vt = { ...defaultVarText(), current: 42 };
  assert.equal(expand('Nr. %#', 42, vt, when), 'Nr. 42');
  assert.equal(expand('%5#', 42, vt, when), '00042');
  assert.equal(expand('100%% %#', 7, vt, when), '100% 7');
  assert.equal(expand('%Q bleibt', 1, vt, when), '%Q bleibt');
});

await test('Datum und Uhrzeit', () => {
  const vt = defaultVarText();
  assert.equal(expand('%d.%m.%Y %H:%M:%S', 1, vt, when), '06.10.2026 14:05:09');
  assert.equal(expand('%y %j %h%p', 1, vt, when), '26 279 02PM');
});

await test('CSV: Trennzeichen, Anführungszeichen, Spalten nach Nummer und Name', () => {
  const rows = parseCsv('﻿Name;Ort\r\n"Müller; Anna";Köln\n"Er sagte ""hi""";Bonn\n\n');
  assert.deepEqual(rows, [['Name', 'Ort'], ['Müller; Anna', 'Köln'], ['Er sagte "hi"', 'Bonn']]);
  const vt = { ...defaultVarText(), csv: { name: 'a.csv', header: rows[0], rows: rows.slice(1) } };
  assert.equal(expand('%0 aus %1', 1, vt, when), 'Müller; Anna aus Köln');
  assert.equal(expand('%{ort}', 2, vt, when), 'Bonn');
  assert.equal(expand('[%0]', 3, vt, when), '[]');
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

await test('Weiterzählen läuft nach dem Ende wieder von vorn', () => {
  const vt = { ...defaultVarText(), start: 1, end: 3, current: 2, advance: 1 };
  advanceVarText(vt);
  assert.equal(vt.current, 3);
  advanceVarText(vt);
  assert.equal(vt.current, 1);
  advanceVarText(vt, -1);
  assert.equal(vt.current, 3);
});

await test('QR-Matrix: Größe je Inhalt, zu lang = null', () => {
  assert.equal(qrMatrix('HELLO', 'M')!.n, 21);
  assert.equal(qrMatrix('https://example.com/äöü', 'H')!.n, 33);
  assert.equal(qrMatrix('x'.repeat(5000), 'L'), null);
  assert.equal(qrMatrix('', 'L'), null);
});

await test('Umrisse: Nachbarzellen verschmelzen, Löcher bleiben, Diagonalen getrennt', () => {
  // 3×3 Ring: ein Umriss außen, ein Loch innen
  const ring = cellOutlines(3, 3, (x, y) => !(x === 1 && y === 1), 1);
  assert.equal(ring.length, 2);
  assert.ok(ring.every((s) => s.closed && s.nodes.length === 4));
  // Zwei Zellen, die sich nur an einer Ecke berühren: zwei getrennte Quadrate
  const diag = cellOutlines(2, 2, (x, y) => x === y, 1);
  assert.equal(diag.length, 2);
  assert.ok(diag.every((s) => s.nodes.length === 4));
  // Fläche der Umrisse = Zahl der dunklen Module (Löcher gegenläufig)
  const m = qrMatrix('KizamuBeam', 'Q')!;
  let dark = 0;
  for (let r = 0; r < m.n; r++) for (let c = 0; c < m.n; c++) if (m.dark(r, c)) dark++;
  const area = cellOutlines(m.n, m.n, (x, y) => m.dark(y, x), 1).reduce((sum, s) => {
    let a = 0;
    s.nodes.forEach((p, i) => {
      const q = s.nodes[(i + 1) % s.nodes.length];
      a += p.x * q.y - q.x * p.y;
    });
    return sum + a / 2;
  }, 0);
  assert.equal(area, dark);
});

await test('WLAN-Inhalt wird maskiert', () => {
  assert.equal(wifiData('Mein;Netz', 'a:b', 'WPA', false), 'WIFI:T:WPA;S:Mein\\;Netz;P:a\\:b;;');
  assert.equal(wifiData('Gast', '', 'nopass', true), 'WIFI:T:nopass;S:Gast;H:true;;');
});

await test('Variabler QR-Code folgt der Nummer, Negativ umfasst die Ruhezone', () => {
  const vt = { ...defaultVarText(), current: 5 };
  const doc = loadDoc({ version: 2, bed: { w: 400, h: 400 }, pages: [{ name: 'S', objs: [] }], page: 0, layers: {}, vt });
  setVarTextSource(() => doc.vt);
  const s = { kind: 'barcode' as const, type: 'qr' as const, data: 'ID-%3#', ec: 'L' as const, size: 21, invert: false, quiet: 2, vt: { offset: 1 } };
  const a = barcodeOutline(s);
  assert.equal(a.key.includes('ID-006'), true);
  vt.current = 6;
  assert.equal(barcodeOutline(s).key.includes('ID-007'), true);
  s.invert = true;
  const inv = barcodeOutline(s);
  const xs = inv.subs.flatMap((sp) => sp.nodes.map((n) => n.x));
  assert.equal(Math.min(...xs), -2);
  assert.equal(Math.max(...xs), 23);
});

await test('Job enthält den QR-Code als geschlossene Konturen', async () => {
  const doc = loadDoc({
    version: 2, bed: { w: 400, h: 400 }, page: 0, layers: {},
    pages: [{ name: 'S', objs: [{ id: 1, m: [1, 0, 0, 1, 50, 50], layer: 1, shape: { kind: 'barcode', type: 'qr', data: 'HELLO', ec: 'M', size: 21, invert: false, quiet: 2 } }] }],
  });
  const job = await buildJob({ doc, layer: (i) => defaultLayer(i), imgLayer: () => defaultImageLayer(), device: newDevice({ fw: 'fluidnc' }), only: null, position: null, forPreview: false });
  assert.ok(job.moves.n > 50);
  assert.ok(job.travel && job.travel.x0 >= 50 - 1e-6 && job.travel.x1 <= 71 + 1e-6);
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('Alle Tests bestanden');
