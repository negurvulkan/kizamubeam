// Tests für den Werkzeugkasten (Kacheln, Gruppen, Suche). Aufruf: npm run test:apps
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
const { appGroups, appList, fold, isNewIn, pushRecent, searchApps } = await import('../src/apps');
const { ICONS } = await import('../src/icons');

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

const apps = appList();
const ui = readFileSync(new URL('../src/ui.ts', import.meta.url), 'utf8');
// Aktionen der Funktionsleisten mit ihrem Symbol: { id: 'gear', cat: W, icon: 'gear', … } bzw. tool('joint', 'joint', …)
const actionIcons = new Map<string, string | undefined>();
for (const m of ui.matchAll(/\{\s*id: '([^']+)', cat: \w+,(?: icon: '([^']+)')?/g)) actionIcons.set(m[1], m[2]);
for (const m of ui.matchAll(/tool\('([^']+)', '([^']+)'/g)) actionIcons.set(`tool:${m[1]}`, m[2]);

test('Kennungen eindeutig, Gruppen bekannt, Texte vorhanden', () => {
  const ids = apps.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  const groups = new Set(appGroups().map((g) => g.id));
  for (const a of apps) {
    assert.ok(groups.has(a.group), a.id);
    assert.ok(a.name && a.desc && a.keys, a.id);
    assert.ok(!a.keys.includes('|'), `Kontext im angezeigten Text: ${a.id}`);
  }
  for (const g of appGroups()) assert.ok(apps.some((a) => a.group === g.id), `leere Gruppe ${g.id}`);
});

test('Jede Kachel hat eine Aktion mit Symbol', () => {
  for (const a of apps) {
    assert.ok(actionIcons.has(a.id), `keine Aktion „${a.id}“ in ui.ts`);
    const icon = actionIcons.get(a.id);
    assert.ok(icon && ICONS[icon], `Aktion „${a.id}“ ohne bekanntes Symbol`);
  }
  for (const g of appGroups()) assert.ok(ICONS[g.icon], g.id);
});

test('Ohne Suchtext alle, sonst passende Treffer', () => {
  assert.equal(searchApps(apps, '  ').length, apps.length);
  const ids = (q: string) => searchApps(apps, q).map((a) => a.id);
  assert.deepEqual(ids('zahnrad').slice(0, 1), ['gear']);
  assert.ok(ids('box').includes('box') && ids('box').includes('insert') && ids('box').includes('lidhinge'));
  assert.equal(ids('box')[0], 'box', 'Treffer im Namen zuerst');
  assert.deepEqual(ids('nichtsdergleichen'), []);
});

test('Suche findet auch englische Wörter und ignoriert Umlaute', () => {
  const ids = (q: string) => searchApps(apps, q).map((a) => a.id);
  assert.ok(ids('gear').includes('gear'));
  assert.ok(ids('kerf').includes('calibrate'));
  assert.ok(ids('living hinge').includes('hinge'));
  assert.ok(ids('Gehause').includes('box'));
  assert.ok(ids('FUGE').includes('calibrate'));
  assert.equal(fold('Schlüssel Größe'), 'schlussel grosse');
});

test('Mehrere Wörter müssen alle passen', () => {
  const ids = searchApps(apps, 'kopien kreis').map((a) => a.id);
  assert.deepEqual(ids, ['circarray']);
});

test('NEU gilt für die aktuelle und die zwei vorigen Nebenversionen', () => {
  assert.equal(isNewIn(undefined, '1.7.0-beta'), false);
  assert.equal(isNewIn('1.7.0', '1.7.0-beta'), true);
  assert.equal(isNewIn('1.5.0', '1.7.0-beta'), true);
  assert.equal(isNewIn('1.4.0', '1.7.0-beta'), false);
  assert.equal(isNewIn('1.8.0', '1.7.0'), false, 'aus der Zukunft');
  assert.equal(isNewIn('1.9.0', '2.0.0'), false, 'neue Hauptversion');
  assert.equal(isNewIn('kaputt', '1.7.0'), false);
  for (const a of apps) if (a.since) assert.match(a.since, /^\d+\.\d+\.\d+$/, a.id);
});

test('Zuletzt benutzt: vorne, ohne Doppelte, begrenzt', () => {
  assert.deepEqual(pushRecent(['a', 'b', 'c'], 'b'), ['b', 'a', 'c']);
  assert.deepEqual(pushRecent(['a', 'b', 'c'], 'd', 3), ['d', 'a', 'b']);
  assert.deepEqual(pushRecent([], 'x'), ['x']);
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('Alle Tests bestanden');
