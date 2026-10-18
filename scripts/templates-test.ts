// Tests für Vorlagen: Angaben bereinigen, Dateinamen, Vorlagen-Datei und Vorlagen-Ordner (Browser-Speicher).
// Aufruf: npm run test:templates
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
const g = globalThis as Record<string, unknown>;
const mem = new Map<string, string>();
g.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const T = await import('../src/templates');
const { loadDoc, newDoc } = await import('../src/model');
const { t } = await import('../src/i18n');
import type { ProjectParam } from '../src/params';

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

const params: ProjectParam[] = [
  { name: 'Name', type: 'text', value: 'Anna' },
  { name: 'Breite', type: 'number', value: 60, min: 30, max: 120 },
  { name: 'Dicke', type: 'number', value: 3 },
  { name: 'Loch', type: 'bool', value: true },
];

await test('normalizeTemplate: unbekannte und doppelte Felder fallen weg, Namen wie im Projekt', () => {
  const info = T.normalizeTemplate(
    { title: '  Schild ', fields: [{ name: 'breite', slider: true }, 'Name', { name: 'Gibtsnicht' }, { name: 'BREITE' }, { name: 'Dicke', slider: true, label: 'Dicke' }] },
    params,
  );
  assert.deepEqual(info, { title: 'Schild', fields: [{ name: 'Breite', slider: true }, { name: 'Name' }, { name: 'Dicke' }] });
});

await test('normalizeTemplate: ohne Titel „Vorlage“, Beschreibung und Vorschau bleiben', () => {
  const info = T.normalizeTemplate({ description: ' Text ', preview: '<svg/>', fields: 'x' }, params);
  assert.deepEqual(info, { title: t('Vorlage'), description: 'Text', preview: '<svg/>', fields: [] });
  assert.equal(T.normalizeTemplate({ preview: 'javascript:1' }, params).preview, undefined);
});

await test('defaultTemplate und templateFields: ohne Angaben alle Parameter, Schieberegler wo möglich', () => {
  const d = newDoc();
  d.params = params;
  assert.deepEqual(T.defaultTemplate(d).fields, [{ name: 'Name' }, { name: 'Breite', slider: true }, { name: 'Dicke' }, { name: 'Loch' }]);
  d.template = { title: 'X', fields: [{ name: 'Loch' }, { name: 'Name', label: 'Dein Name' }] };
  assert.deepEqual(T.templateFields(d).map(([p, f]) => [p.name, f.label]), [['Loch', undefined], ['Name', 'Dein Name']]);
});

await test('templateFileName: keine Pfadzeichen, Endung .kzt', () => {
  assert.equal(T.templateFileName('Schild für Anna'), 'Schild für Anna.kzt');
  assert.equal(T.templateFileName('../a/b:c*?'), 'a b c.kzt');
  assert.equal(T.templateFileName('  ...  '), `${t('Vorlage')}.kzt`);
});

await test('templateJson: Projektdatei mit bereinigten Angaben und Vorschau, wieder ladbar', () => {
  const d = newDoc();
  d.params = params;
  const json = T.templateJson(JSON.stringify(d), { title: 'S', fields: [{ name: 'Name' }, { name: 'X' }], preview: '<svg old/>' }, '<svg new/>');
  const back = loadDoc(JSON.parse(json));
  assert.deepEqual(back.template, { title: 'S', fields: [{ name: 'Name' }], preview: '<svg new/>' });
  assert.equal(back.params?.length, 4);
});

await test('Vorlagen-Ordner im Browser: schreiben, auflisten, lesen, löschen', async () => {
  const d = newDoc();
  d.params = params;
  const json = T.templateJson(JSON.stringify(d), { title: 'Schild', description: 'Für Namen', fields: [{ name: 'Name' }] }, '<svg/>');
  await T.writeTemplate('Schild.kzt', json, false);
  await assert.rejects(() => T.writeTemplate('Schild.kzt', json, false));
  await T.writeTemplate('Schild.kzt', json, true);
  mem.set('kizamubeam.templates', JSON.stringify({ ...JSON.parse(mem.get('kizamubeam.templates')!), 'Kaputt.kzt': '{' }));
  const list = await T.listTemplates();
  assert.deepEqual(list.map((e) => [e.file, e.info.title, !!e.broken]), [['Kaputt.kzt', 'Kaputt', true], ['Schild.kzt', 'Schild', false]]);
  assert.equal(list[1].info.description, 'Für Namen');
  assert.equal(await T.readTemplate('Schild.kzt'), json);
  await T.deleteTemplate('Schild.kzt');
  await assert.rejects(() => T.readTemplate('Schild.kzt'));
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
