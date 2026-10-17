// Tests für Projekt-Parameter: Formeln, Platzhalter in Texten und QR-Codes, Umbenennen, Formeln an Generatoren.
// Aufruf: npm run test:params
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
const g = globalThis as Record<string, unknown>;
g.Path2D ??= class { moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} addPath() {} };
const P = await import('../src/params');
const { dec, t } = await import('../src/i18n');
const { evaluate, fillTemplate, scopeOf, renameInExpr, renameInTemplate, usesName, nameError, coerce, namesIn, setParamSource, hasPlaceholders } = P;
const { shownText, defaultVarText, setVarTextSource } = await import('../src/vartext');
const { barcodeData } = await import('../src/barcode');
const { BOX } = await import('../src/generators/box');
const { buildGen, defaultParams, resolveBinds } = await import('../src/generators/index');
import type { ProjectParam } from '../src/params';
import type { BarcodeShape, TextShape } from '../src/model';

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

const params: ProjectParam[] = [
  { name: 'Breite', type: 'number', value: 80, unit: 'mm' },
  { name: 'Dicke', type: 'number', value: 3 },
  { name: 'Name', type: 'text', value: 'Anna' },
  { name: 'Mit_Datum', type: 'bool', value: false },
];
const scope = scopeOf(params);

test('Formeln: Rechnen, Vorrang, Einheiten, Dezimalkomma', () => {
  assert.equal(evaluate('Breite / 2 + 1', scope), 41);
  assert.equal(evaluate('2 + 3 * 4 ^ 2', scope), 50);
  assert.equal(evaluate('-(2 + 3) * 2', scope), -10);
  assert.equal(evaluate('2cm + 5mm', scope), 25);
  assert.equal(evaluate('1in', scope), 25.4);
  assert.equal(evaluate('2,5 * 2', scope), 5);
  assert.equal(evaluate('breite', scope), 80, 'Groß-/Kleinschreibung egal');
  assert.equal(evaluate('10 % 3', scope), 1);
});

test('Formeln: Texte, Vergleiche, Bedingungen und Funktionen', () => {
  assert.equal(evaluate('Name + " GmbH"', scope), 'Anna GmbH');
  assert.equal(evaluate('„Hallo “ + Name', scope), 'Hallo Anna');
  assert.equal(evaluate('Breite > 50 ? "groß" : "klein"', scope), 'groß');
  assert.equal(evaluate('Mit_Datum || Dicke == 3', scope), true);
  assert.equal(evaluate('!Mit_Datum && true', scope), true);
  assert.equal(evaluate('max(Dicke; 5, 2)', scope), 5);
  assert.equal(evaluate('max(2, 5)', scope), 5, 'Komma mit Leerzeichen trennt Argumente');
  assert.equal(evaluate('round(10 / 3; 2)', scope), 3.33);
  assert.equal(evaluate('len(Name) * 7', scope), 28);
  assert.equal(evaluate('if(Mit_Datum; "x"; "y")', scope), 'y');
  assert.equal(evaluate('upper(Name)', scope), 'ANNA');
  assert.ok(Math.abs((evaluate('sin(30)', scope) as number) - 0.5) < 1e-12, 'Winkel in Grad');
});

test('Formeln: verständliche Fehler', () => {
  const msg = (m: string) => (e: unknown) => (e as Error).message === m;
  assert.throws(() => evaluate('Höhe * 2', scope), msg(t('Unbekannter Parameter „{name}“', { name: 'Höhe' })));
  assert.throws(() => evaluate('2 +', scope), msg(t('Formel unvollständig')));
  assert.throws(() => evaluate('1 / 0', scope), msg(t('Teilung durch null')));
  assert.throws(() => evaluate('foo(1)', scope), msg(t('Unbekannte Funktion „{name}“', { name: 'foo' })));
  assert.throws(() => evaluate('(1 + 2', scope));
  assert.throws(() => evaluate('', scope));
  assert.deepEqual(namesIn('max(Breite; dicke) + 2'), ['breite', 'dicke']);
});

test('Platzhalter in Texten: Werte, Formeln, unbekannte Klammern bleiben', () => {
  assert.equal(fillTemplate('Hallo {Name}!', scope), 'Hallo Anna!');
  assert.equal(fillTemplate('{Breite / 3} mm', scope), `${dec('26.667')} mm`, 'Dezimalzeichen der Sprache, höchstens 3 Stellen');
  assert.equal(fillTemplate('{Breite / 3}', scope, true), '26.667', 'QR-Codes mit Punkt');
  assert.equal(fillTemplate('{Mit_Datum}', scope), t('nein'));
  assert.equal(fillTemplate('{unbekannt} und {2 +} bleiben', scope), '{unbekannt} und {2 +} bleiben');
  assert.equal(fillTemplate('{{Name}} = {Name}', scope), '{Name}} = Anna'.replace('}}', '}'));
  assert.equal(fillTemplate('Spalte %{Name} bleibt', scope), 'Spalte %{Name} bleibt', 'CSV-Spalte des variablen Texts');
  assert.equal(fillTemplate('ohne Klammern', scope), 'ohne Klammern');
  assert.equal(fillTemplate('{Name}', new Map()), '{Name}', 'ohne Parameter unverändert');
  assert.ok(hasPlaceholders('a {b}') && !hasPlaceholders('a %{b}') && !hasPlaceholders('ab'));
});

test('Angezeigter Text und QR-Inhalt: erst Parameter, dann variabler Text', () => {
  setParamSource(() => params);
  const vt = { ...defaultVarText(), current: 7 };
  setVarTextSource(() => vt);
  const text = { kind: 'text', text: '{Name} Nr. %#', font: 'Arial', size: 10, bold: false, italic: false, upper: false, align: 'left', hSpace: 0, vSpace: 0 } as TextShape;
  assert.equal(shownText(text), '{Name} Nr. %#'.replace('{Name}', 'Anna'));
  text.vt = { offset: 1 };
  assert.equal(shownText(text), 'Anna Nr. 8');
  const qr = { kind: 'barcode', type: 'qr', data: 'https://x.de/?b={Breite / 3}', ec: 'M', size: 20, invert: false, quiet: 2 } as BarcodeShape;
  assert.equal(barcodeData(qr), 'https://x.de/?b=26.667');
  setParamSource(() => undefined);
  setVarTextSource(() => undefined);
});

test('Umbenennen in Formeln und Platzhaltern, Verwendung erkennen', () => {
  assert.equal(renameInExpr('Breite*2 + breite + max(Breite; 1) + "Breite"', 'Breite', 'W'), 'W*2 + W + max(W; 1) + "Breite"');
  assert.equal(renameInExpr('round(Breite)', 'round', 'x'), 'round(Breite)', 'Funktionen bleiben');
  assert.equal(renameInTemplate('Breite {Breite} {Breite/2} %{Breite}', 'Breite', 'W'), 'Breite {W} {W/2} %{Breite}');
  assert.ok(usesName('a {Breite + 1}', 'breite', true));
  assert.ok(!usesName('Breite {Name}', 'Breite', true));
  assert.ok(usesName('Breite - 2', 'Breite', false));
});

test('Namen prüfen und Werte auf den Typ bringen', () => {
  assert.equal(nameError('Länge_2', params), null);
  assert.ok(nameError('2x', params));
  assert.ok(nameError('mit leerzeichen', params));
  assert.ok(nameError('breite', params), 'schon vergeben (ohne Groß-/Kleinschreibung)');
  assert.ok(nameError('max', params), 'Funktionsname');
  assert.ok(nameError('pi', params));
  assert.equal(nameError('Breite', params, params[0]), null, 'eigener Name beim Bearbeiten');
  const n: ProjectParam = { name: 'n', type: 'number', value: 5, min: 0, max: 10 };
  assert.equal(coerce(n, 20), 10);
  assert.equal(coerce(n, '2,5'), 2.5);
  assert.equal(coerce(n, 'abc'), 5);
  assert.equal(coerce({ name: 'b', type: 'bool', value: false }, 'true'), true);
  assert.equal(coerce({ name: 't', type: 'text', value: '' }, 12), '12');
});

test('Generator-Felder mit Formeln: Box folgt der Materialdicke', () => {
  const base = defaultParams(BOX);
  const bind = { thickness: 'Dicke', width: 'Breite + 2 * Dicke', top: 'Mit_Datum ? "closed" : "open"' };
  const r1 = resolveBinds(BOX, base, bind, scope);
  assert.equal(r1.issues.length, 0, JSON.stringify(r1.issues));
  assert.equal(r1.params.thickness, 3);
  assert.equal(r1.params.width, 86);
  assert.equal(r1.params.top, 'open');
  const parts1 = buildGen(BOX, r1.params).parts.length;
  const scope2 = scopeOf(params.map((p) => (p.name === 'Mit_Datum' ? { ...p, value: true } : p.name === 'Dicke' ? { ...p, value: 4 } : p)));
  const r2 = resolveBinds(BOX, r1.params, bind, scope2);
  assert.equal(r2.params.thickness, 4);
  assert.equal(r2.params.width, 88);
  assert.equal(r2.params.top, 'closed');
  assert.equal(buildGen(BOX, r2.params).parts.length, parts1 + 1, 'Deckel kommt dazu');
});

test('Generator-Formeln: Fehler und Begrenzung', () => {
  const base = defaultParams(BOX);
  const bad = resolveBinds(BOX, base, { thickness: 'Fehlt * 2' }, scope);
  assert.equal(bad.issues[0].level, 'error');
  assert.equal(bad.params.thickness, base.thickness, 'behält den letzten Wert');
  const clamp = resolveBinds(BOX, base, { thickness: 'Breite' }, scope);
  assert.equal(clamp.params.thickness, 50, 'auf das Maximum begrenzt');
  assert.equal(clamp.issues[0].level, 'warn');
  const en = resolveBinds(BOX, base, { top: '"halb"' }, scope);
  assert.equal(en.issues[0].level, 'error');
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
