// Tests für Erweiterungen (Inhaltspakete .kzp): Format prüfen, erlaubte Felder, Versionen, Materialien,
// Installieren und Entfernen im Browser-Speicher.
// Aufruf: npm run test:packs
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
const g = globalThis as Record<string, unknown>;
// Meldungen auf Deutsch prüfen, unabhängig von der Sprache des Systems
const mem = new Map<string, string>([['kizamubeam.lang', 'de']]);
g.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const P = await import('../src/packs');
const { library } = await import('../src/materials');
const { builtinTemplates } = await import('../src/builtinTemplates');
const { PRESETS } = await import('../src/gcode');

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

const base = (extra: Record<string, unknown> = {}) => ({
  format: 'kizamubeam-pack',
  formatVersion: 1,
  id: 'de.test.werkstatt',
  version: '1.0.0',
  name: { de: 'Werkstatt', en: 'Workshop' },
  devices: [{ name: 'Testlaser', fw: 'grbl', bedW: 300, bedH: 200 }],
  ...extra,
});
const pack = (extra: Record<string, unknown> = {}) => JSON.stringify(base(extra));
const throws = (text: string, re: RegExp) => assert.throws(() => P.parsePack(text, '1.2.1-beta'), (e: Error) => e instanceof P.PackError && re.test(e.message));

await test('parsePack: gültiges Paket, Name in der Sprache der Oberfläche', () => {
  const p = P.parsePack(pack());
  assert.equal(p.id, 'de.test.werkstatt');
  assert.equal(p.name, 'Werkstatt');
  assert.equal(p.devices.length, 1);
  assert.equal(P.localText({ en: 'Workshop', de: 'Werkstatt' }, 'en'), 'Workshop');
  assert.equal(P.localText({ fr: 'Atelier' }, 'en'), 'Atelier');
});

await test('parsePack: Aufbau-Fehler lehnen das ganze Paket ab', () => {
  throws('nicht json', /JSON/);
  throws(JSON.stringify({ ...base(), format: 'etwas' }), /Keine KizamuBeam-Erweiterung/);
  throws(pack({ formatVersion: 2 }), /neuere Version/);
  throws(pack({ id: 'Ohne Punkt' }), /Kennung/);
  throws(pack({ id: 'werkstatt' }), /Kennung/);
  throws(pack({ version: '1.0' }), /Version/);
  throws(pack({ name: '' }), /Name/);
  throws(pack({ devices: [] }), /leer/);
  throws(pack({ devices: {} }), /Liste/);
});

await test('parsePack: minApp gegen die App-Version', () => {
  assert.doesNotThrow(() => P.parsePack(pack({ minApp: '1.2.0' }), '1.2.1-beta'));
  throws(pack({ minApp: '1.3.0' }), /1\.3\.0 oder neuer/);
  throws(pack({ minApp: 'bald' }), /minApp/);
});

await test('Gerätevorlagen: nur erlaubte Felder, keine Skripte oder Adressen', () => {
  const p = P.parsePack(pack({
    devices: [{
      name: 'Laser', fw: 'fluidnc', bedW: 400, bedH: 300, baud: 230400, sMax: 1000, conn: 'ws', wsPort: 81, airCmd: 'M7',
      startScript: '$32=0', endScript: 'M3 S1000', host: '10.0.0.1', rotary: { mode: 'roller' }, agentMaxPower: 100, source: 'https://example.com',
    }],
  }));
  const d = p.devices[0];
  assert.deepEqual(d.preset, { name: 'Laser', fw: 'fluidnc', bedW: 400, bedH: 300, baud: 230400, sMax: 1000, conn: 'ws', wsPort: 81, airCmd: 'M7' });
  assert.equal(d.source, 'https://example.com');
});

await test('Gerätevorlagen: fehlende Pflichtfelder und Unsinn', () => {
  throws(pack({ devices: [{ fw: 'grbl', bedW: 300, bedH: 200 }] }), /Gerätevorlage 1: Name/);
  throws(pack({ devices: [{ name: 'x', fw: 'mach3', bedW: 300, bedH: 200 }] }), /Firmware/);
  throws(pack({ devices: [{ name: 'x', fw: 'grbl', bedW: 1, bedH: 200 }] }), /Arbeitsbereich/);
  // Ungültige freiwillige Werte fallen weg statt das Paket abzulehnen
  const p = P.parsePack(pack({ devices: [{ name: 'x', fw: 'grbl', bedW: 300, bedH: 200, baud: -5, conn: 'usb' }] }));
  assert.equal(p.devices[0].preset.baud, undefined);
  assert.equal(p.devices[0].preset.conn, undefined);
});

await test('Vorlagen: .kzt-Inhalt mit mehrsprachigem Titel; ohne „template“ abgelehnt', () => {
  const kzt = JSON.parse(builtinTemplates()[0].json());
  kzt.template.title = { de: 'Anhänger', en: 'Key fob' };
  const p = P.parsePack(pack({ templates: [kzt] }));
  assert.equal(p.templates[0].info.title, 'Anhänger');
  assert.equal(JSON.parse(p.templates[0].json).template.title, 'Anhänger');
  delete kzt.template;
  throws(pack({ templates: [kzt] }), /Vorlage 1/);
  throws(pack({ templates: [{ template: {} }] }), /Vorlage 1/);
});

await test('Materialien: stabile Kennungen mit Paket-Präfix, doppelte abgelehnt', () => {
  const m = { id: 'pappel3', material: 'Pappel', thickness: 3, title: 'Schneiden', settings: { mode: 'line', speed: 600, power: 80 } };
  const p = P.parsePack(pack({ materials: [m, { ...m, id: undefined, title: 'Gravieren' }] }));
  assert.equal(p.materials[0].id, 'pk:de.test.werkstatt:pappel3');
  assert.equal(p.materials[1].id, 'pk:de.test.werkstatt:2');
  assert.equal(p.materials[0].pack, 'de.test.werkstatt');
  throws(pack({ materials: [m, m] }), /doppelter/);
  throws(pack({ materials: [{ material: 'x' }] }), /Material 1/);
});

await test('Installieren, Update, Materialien übernehmen und Entfernen', async () => {
  const m = (title: string, power: number) => ({ id: title, material: 'Pappel', thickness: 3, title, settings: { mode: 'line', speed: 600, power } });
  await P.installPack(pack({ materials: [m('cut', 80), m('mark', 10)] }));
  assert.equal(P.installedPacks().length, 1);
  assert.equal(P.presetList().length, PRESETS.length + 1);
  assert.equal(P.presetList().at(-1)!.pack, 'Werkstatt');
  assert.deepEqual(library.entries.map((e) => e.id), ['pk:de.test.werkstatt:cut', 'pk:de.test.werkstatt:mark']);
  // Hier geänderter Eintrag gehört danach der Person und bleibt beim Update
  library.update('pk:de.test.werkstatt:mark', { desc: 'eigene Notiz' });
  assert.equal(library.get('pk:de.test.werkstatt:mark')!.pack, undefined);

  assert.equal(P.installKind(P.parsePack(pack({ version: '1.1.0' }))).kind, 'update');
  assert.equal(P.installKind(P.parsePack(pack({ version: '0.9.0' }))).kind, 'downgrade');
  assert.equal(P.installKind(P.parsePack(pack())).kind, 'same');

  await P.installPack(pack({ version: '1.1.0', materials: [m('cut', 90), m('mark', 20)] }));
  assert.equal(P.installedPacks().length, 1);
  assert.equal(P.installedPacks()[0].pack.version, '1.1.0');
  assert.equal(library.get('pk:de.test.werkstatt:cut')!.settings.power, 90);
  assert.equal(library.get('pk:de.test.werkstatt:mark')!.settings.power, 10);

  await P.removePack(P.installedPacks()[0].file);
  assert.equal(P.installedPacks().length, 0);
  assert.deepEqual(library.entries.map((e) => e.id), ['pk:de.test.werkstatt:mark']);
});

await test('Kaputte Datei im Speicher erscheint als fehlerhaft, nicht als Absturz', async () => {
  mem.set('kizamubeam.packs', JSON.stringify({ 'de.kaputt.x.kzp': '{' }));
  await P.loadPacks();
  assert.equal(P.installedPacks().length, 0);
  assert.equal(P.brokenPacks()[0].file, 'de.kaputt.x.kzp');
  await P.removePack('de.kaputt.x.kzp');
  assert.equal(P.brokenPacks().length, 0);
});

await test('Beispielpaket in packs/ ist gültig', () => {
  const p = P.parsePack(readFileSync(new URL('../packs/org.kizamubeam.example.kzp', import.meta.url), 'utf8'));
  assert.ok(p.devices.length && p.materials.length && p.templates.length);
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
