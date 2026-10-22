// Tests für die Projekt-Notizen in der Projektdatei. Aufruf: npm run test:notes
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
const { cleanNotes, loadDoc, newDoc } = await import('../src/model');

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

test('Nur nicht leere Text-Abschnitte bleiben', () => {
  assert.deepEqual(cleanNotes({ material: '3 mm Pappel', setup: '  ', process: 42, extra: 'x' }), { material: '3 mm Pappel' });
  assert.equal(cleanNotes({ material: '' }), undefined);
  assert.equal(cleanNotes('Text'), undefined);
  assert.equal(cleanNotes(null), undefined);
});

test('Notizen überstehen Speichern und Öffnen', () => {
  const d = newDoc();
  d.notes = { material: '4 mm MDF', setup: 'Fokus 2 mm tiefer\nWabenbett', process: 'Zwei Durchgänge' };
  const back = loadDoc(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(back.notes, d.notes);
});

test('Alte Dateien ohne Notizen und kaputte Einträge', () => {
  assert.equal('notes' in newDoc(), false);
  const d = loadDoc({ version: 2, bed: { w: 100, h: 100 }, pages: [{ name: 'A', objs: [] }], page: 0, layers: {}, notes: ['falsch'] });
  assert.equal('notes' in d, false);
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('Alle Tests bestanden');
