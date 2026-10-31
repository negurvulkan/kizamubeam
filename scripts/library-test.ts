// Tests für die Bibliothek (Motive, Bilder, Designelemente): Format prüfen, Suche, Dateinamen, Einträge in
// Erweiterungen und Speichern im Browser-Speicher (in Node ohne IndexedDB: im Arbeitsspeicher).
// Aufruf: npm run test:library
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
const F = await import('../src/assetFormat');
const L = await import('../src/assetLibrary');
const P = await import('../src/packs');

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

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const rect = (x = 0, layer = 0) => ({ id: 7, m: [1, 0, 0, 1, x, 0], layer, shape: { kind: 'rect', w: 10, h: 5, r: 0 } });
const asset = (extra: Record<string, unknown> = {}) => ({
  format: 'kizamubeam-asset',
  formatVersion: 1,
  name: 'Rahmen',
  category: 'element',
  tags: ['Schild', 'rand'],
  w: 10,
  h: 5,
  objs: [rect()],
  ...extra,
});
const throws = (raw: unknown, re: RegExp) => assert.throws(() => F.parseAsset(raw), (e: Error) => e instanceof F.AssetError && re.test(e.message));

await test('parseAsset: gültiger Eintrag, aus Text und Objekt', () => {
  const a = F.parseAsset(JSON.stringify(asset()));
  assert.equal(a.name, 'Rahmen');
  assert.equal(a.category, 'element');
  assert.deepEqual(a.tags, ['Schild', 'rand']);
  assert.equal(a.objs.length, 1);
  assert.deepEqual(F.parseAsset(asset()).objs, a.objs);
});

await test('parseAsset: Aufbau-Fehler', () => {
  assert.throws(() => F.parseAsset('kein json'), /JSON/);
  throws(asset({ format: 'kizamubeam-pack' }), /Kein Bibliotheks-Eintrag/);
  throws(asset({ formatVersion: 2 }), /neuere Version/);
  throws(asset({ name: '' }), /Name fehlt/);
  throws(asset({ objs: [] }), /keine Objekte/);
  throws(asset({ objs: [{ ...rect(), m: [1, 0, 0] }] }), /Lage/);
  throws(asset({ objs: [{ ...rect(), layer: 40 }] }), /Layer/);
  throws(asset({ objs: [{ ...rect(), shape: { kind: 'script', code: 'x' } }] }), /unbekannte Form/);
  throws(asset({ objs: [{ ...rect(), shape: { kind: 'rect', w: 'breit', h: 1 } }] }), /ungültige Form/);
  throws(asset({ objs: [{ ...rect(), shape: { kind: 'path', subs: [{ closed: true, nodes: [{ x: 1 }] }] } }] }), /ungültiger Pfad/);
});

await test('parseAsset: Formeln, Bedingungen, Ausblenden fallen weg; Gruppen werden geprüft', () => {
  const a = F.parseAsset(asset({
    objs: [{
      ...rect(), bind: { x: 'Breite' }, showIf: 'Deckel', hidden: true, locked: true,
      shape: { kind: 'group', children: [rect(), { ...rect(5), shape: { kind: 'gen', gen: 'gear', v: 1, params: {}, subs: [], bind: { teeth: 'Z' } } }] },
    }],
  }));
  const o = a.objs[0] as unknown as Record<string, unknown>;
  assert.equal(o.bind, undefined);
  assert.equal(o.showIf, undefined);
  assert.equal(o.hidden, undefined);
  assert.equal(o.locked, undefined);
  const gen = (a.objs[0].shape as { children: { shape: Record<string, unknown> }[] }).children[1].shape;
  assert.equal(gen.bind, undefined);
  throws(asset({ objs: [{ ...rect(), shape: { kind: 'group', children: [{ ...rect(), layer: -1 }] } }] }), /Layer/);
});

await test('parseAsset: Bilder nur als data:-URL, unbenutzte fallen weg', () => {
  const img = { id: 1, m: [1, 0, 0, 1, 0, 0], layer: 2, shape: { kind: 'image', asset: 'abc', w: 10, h: 10, pxW: 1, pxH: 1 } };
  const a = F.parseAsset(asset({ category: undefined, objs: [img], images: { abc: PNG, unused: PNG } }));
  assert.deepEqual(Object.keys(a.images), ['abc']);
  assert.equal(a.category, 'image');
  assert.ok((a.objs[0].shape as { adjust?: unknown }).adjust);
  throws(asset({ objs: [img] }), /Bilddaten fehlen/);
  throws(asset({ objs: [img], images: { abc: 'https://example.com/x.png' } }), /Bilddaten/);
  throws(asset({ objs: [img], images: { abc: 'data:text/html;base64,PGI+' } }), /Bilddaten/);
});

await test('parseTags: Komma-Text oder Liste, ohne doppelte', () => {
  assert.deepEqual(F.parseTags('Blume,  Ranke ; blume,,'), ['Blume', 'Ranke']);
  assert.deepEqual(F.parseTags(['a', { de: 'Herz', en: 'heart' }]), ['a', 'Herz']);
  assert.deepEqual(F.parseTags(undefined), []);
});

await test('assetJson und parseAsset ergeben denselben Eintrag', () => {
  const a = F.parseAsset(asset({ fill: [0, 0, 99], created: '2026-10-22T08:00:00Z' }));
  assert.deepEqual(a.fill, [0]);
  const b = F.parseAsset(F.assetJson(a));
  assert.deepEqual(b, a);
});

await test('assetFileName: unerlaubte Zeichen weg, Nummer bei Gleichheit', () => {
  assert.equal(F.assetFileName('Rose / Blüte'), 'Rose Blüte.kza');
  assert.equal(F.assetFileName('Rose', ['rose.kza', 'Rose (2).kza']), 'Rose (3).kza');
  assert.equal(F.assetFileName('...'), 'Eintrag.kza');
});

await test('searchAssets: alle Wörter, Akzente egal, Art, Treffer am Namensanfang zuerst', () => {
  const it = (name: string, tags: string[], category: 'motif' | 'image' | 'element', pack?: string) => ({ meta: { name, tags, category, w: 1, h: 1 }, pack });
  const items = [it('Blumenranke', ['Hochzeit'], 'element'), it('Rose', ['Blume'], 'motif'), it('Foto Café', [], 'image', 'Werkstatt'), it('Wildrose', [], 'motif')];
  assert.deepEqual(F.searchAssets(items, 'blume').map((x) => x.meta.name), ['Blumenranke', 'Rose']);
  assert.deepEqual(F.searchAssets(items, 'rose').map((x) => x.meta.name), ['Rose', 'Wildrose']);
  assert.deepEqual(F.searchAssets(items, 'cafe').map((x) => x.meta.name), ['Foto Café']);
  assert.deepEqual(F.searchAssets(items, 'werkstatt').map((x) => x.meta.name), ['Foto Café']);
  assert.deepEqual(F.searchAssets(items, 'motive').map((x) => x.meta.name), ['Rose', 'Wildrose']);
  assert.deepEqual(F.searchAssets(items, 'rose hochzeit').length, 0);
  assert.deepEqual(F.searchAssets(items, '', 'element').map((x) => x.meta.name), ['Blumenranke']);
  assert.equal(F.searchAssets(items, '').length, 4);
});

await test('Erweiterungen: Einträge „assets“ werden geprüft, Kennungen eindeutig', () => {
  const base = { format: 'kizamubeam-pack', id: 'de.test.motive', version: '1.0.0', name: 'Motive' };
  const p = P.parsePack(JSON.stringify({ ...base, assets: [{ ...asset(), id: 'rahmen', name: { de: 'Rahmen', en: 'Frame' } }, asset({ name: 'Zweiter' })] }));
  assert.equal(p.assets.length, 2);
  assert.equal(p.assets[0].id, 'rahmen');
  assert.equal(p.assets[1].id, '2');
  assert.equal(p.assets[0].name, 'Rahmen');
  assert.equal(P.packSummary(p), '2 Bibliotheks-Einträge');
  assert.throws(() => P.parsePack(JSON.stringify({ ...base, assets: [asset({ objs: [] })] })), (e: Error) => e instanceof P.PackError && /Bibliotheks-Eintrag 1/.test(e.message));
  assert.throws(() => P.parsePack(JSON.stringify({ ...base, assets: [{ ...asset(), id: 'x' }, { ...asset(), id: 'x' }] })), /doppelter/);
});

await test('Bibliothek: speichern, auflisten, laden, ändern, löschen', async () => {
  const a = F.parseAsset(asset());
  const file = await L.addToLibrary(a);
  assert.equal(file, 'Rahmen.kza');
  assert.equal(await L.addToLibrary(a), 'Rahmen (2).kza');
  let items = await L.libraryItems();
  assert.deepEqual(items.filter((x) => !x.source).map((x) => x.key), ['Rahmen.kza', 'Rahmen (2).kza']);
  const loaded = await L.loadLibraryAsset(file);
  assert.ok(loaded.created);
  assert.deepEqual(loaded.objs, a.objs);
  await L.updateLibraryAsset(file, { ...loaded, name: 'Schildrahmen', tags: ['Tür'] });
  assert.deepEqual((await L.findAssets('tür')).filter((x) => !x.source).map((x) => x.meta.name), ['Schildrahmen']);
  await L.removeFromLibrary('Rahmen (2).kza');
  items = await L.libraryItems();
  assert.deepEqual(items.filter((x) => !x.source).map((x) => x.key), ['Rahmen.kza']);
  await assert.rejects(() => L.loadLibraryAsset('Fehlt.kza'), /nicht gefunden/);
});

await test('Bibliothek: Einträge aus installierten Erweiterungen, nicht änderbar', async () => {
  await P.installPack(readFileSync(new URL('../packs/org.kizamubeam.example.kzp', import.meta.url), 'utf8'));
  const items = await L.libraryItems();
  const heart = items.find((x) => x.key === 'pack:org.kizamubeam.example/heart');
  assert.ok(heart);
  assert.equal(heart.meta.name, 'Herz');
  assert.equal(heart.pack, 'Beispielpaket');
  assert.ok((await L.findAssets('hochzeit')).some((x) => x.key === heart.key));
  const a = await L.loadLibraryAsset(heart.key);
  assert.equal(a.objs.length, 1);
  await assert.rejects(() => L.removeFromLibrary(heart.key), /Erweiterung/);
  await assert.rejects(() => L.updateLibraryAsset(heart.key, a), /Erweiterungen/);
  await P.removePack('org.kizamubeam.example.kzp');
  assert.ok(!(await L.libraryItems()).some((x) => x.pack));
});

await test('Mitgelieferte Bibliothek: 200 Motive und 200 Designelemente, gültig und nicht änderbar', async () => {
  const B = await import('../src/builtinLibrary');
  const Fm = await import('../src/builtinFormat');
  const list = await B.builtinAssets();
  assert.equal(list.filter((x) => x.asset.category === 'motif').length, 200);
  assert.equal(list.filter((x) => x.asset.category === 'element').length, 200);
  assert.equal(new Set(list.map((x) => x.key)).size, list.length);
  const raw = JSON.parse(readFileSync(new URL('../src/library/builtin.json', import.meta.url), 'utf8')).items as { id: string; d: string; w: number; h: number; g: string }[];
  for (const r of raw) {
    assert.ok(Fm.GROUPS[r.g], `${r.id}: Gruppe ${r.g}`);
    // Pfaddaten verlustfrei lesen und wieder schreiben
    assert.equal(Fm.encodeSubs(Fm.decodeD(r.d)), r.d, r.id);
    const a = await L.loadLibraryAsset(`builtin:${r.id}`);
    // Wie ein Eintrag aus einer Datei prüfen; Pfade geschlossen und im Rahmen w × h
    const parsed = F.parseAsset(F.assetJson(a));
    assert.equal(parsed.objs.length, 1);
    const shape = parsed.objs[0].shape;
    assert.ok(shape.kind === 'path' && shape.subs.length > 0 && shape.subs.every((sp) => sp.closed && sp.nodes.length >= 2), r.id);
    for (const sp of shape.kind === 'path' ? shape.subs : [])
      for (const n of sp.nodes) assert.ok(n.x >= -0.05 && n.y >= -0.05 && n.x <= r.w + 0.05 && n.y <= r.h + 0.05, `${r.id}: Knoten außerhalb`);
  }
  // In der Liste nach den eigenen Einträgen; Suche auch in der anderen Sprache
  const items = await L.libraryItems();
  assert.ok(items.findIndex((x) => x.builtin) > items.findIndex((x) => !x.source));
  const cat = await L.findAssets('katze');
  assert.ok(cat.some((x) => x.key === 'builtin:cat-head'));
  assert.ok((await L.findAssets('cat')).some((x) => x.key === 'builtin:cat-head'));
  assert.ok((await L.findAssets('rahmen', 'element')).length >= 30);
  const a = await L.loadLibraryAsset('builtin:heart');
  await assert.rejects(() => L.removeFromLibrary('builtin:heart'), /Mitgelieferte/);
  await assert.rejects(() => L.updateLibraryAsset('builtin:heart', a), /Mitgelieferte/);
  await assert.rejects(() => L.loadLibraryAsset('builtin:gibt-es-nicht'), /nicht gefunden/);
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
