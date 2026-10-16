// Tests für den Rückgängig-Verlauf. Aufruf: npm run test:history
import { strict as assert } from 'node:assert';
const { History } = await import('../src/history');

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
const labels = (h: InstanceType<typeof History>) => h.rows().map((r) => (r.undone ? `(${r.label})` : r.label));

/** Drei Änderungen: Dokument „A“ → „B“ → „C“ → „D“ */
function sample() {
  const h = new History();
  let doc = 'A';
  for (const [label, next] of [['Rechteck', 'B'], ['Verschieben', 'C'], ['Offset', 'D']]) {
    h.push(doc, label);
    doc = next;
  }
  return { h, doc };
}

test('Rückgängig und Wiederholen behalten die Namen', () => {
  const { h } = sample();
  assert.deepEqual(labels(h), ['Rechteck', 'Verschieben', 'Offset']);
  assert.equal(h.stepBack('D'), 'C');
  assert.deepEqual(labels(h), ['Rechteck', 'Verschieben', '(Offset)']);
  assert.equal(h.position, 2);
  assert.equal(h.nextRedo(), 'Offset');
  assert.equal(h.stepForward('C'), 'D');
  assert.deepEqual(labels(h), ['Rechteck', 'Verschieben', 'Offset']);
  assert.equal(h.stepForward('D'), null);
});

test('Sprung mehrere Schritte zurück und wieder vor', () => {
  const { h } = sample();
  assert.equal(h.jumpTo(0, 'D'), 'A');
  assert.equal(h.position, 0);
  assert.deepEqual(labels(h), ['(Rechteck)', '(Verschieben)', '(Offset)']);
  assert.equal(h.jumpTo(2, 'A'), 'C');
  assert.equal(h.position, 2);
  assert.equal(h.jumpTo(2, 'C'), null);
  assert.equal(h.jumpTo(3, 'C'), 'D');
  // Einzelschritte danach passen zum Sprung
  assert.equal(h.stepBack('D'), 'C');
  assert.equal(h.stepBack('C'), 'B');
  assert.equal(h.stepBack('B'), 'A');
  assert.equal(h.stepBack('A'), null);
});

test('Neue Änderung verwirft die rückgängig gemachten Schritte', () => {
  const { h } = sample();
  h.jumpTo(1, 'D');
  h.push('B', 'Spiegeln');
  assert.deepEqual(labels(h), ['Rechteck', 'Spiegeln']);
  assert.equal(h.canRedo, false);
});

test('Limit verwirft die ältesten Schritte', () => {
  const h = new History(2);
  h.push('A', '1');
  h.push('B', '2');
  assert.equal(h.truncated, false);
  h.push('C', '3');
  assert.equal(h.truncated, true);
  assert.deepEqual(labels(h), ['2', '3']);
  assert.equal(h.jumpTo(0, 'D'), 'B');
});

test('drop und relabel betreffen den letzten Schritt', () => {
  const { h } = sample();
  h.relabel('Ausschneiden');
  assert.equal(h.nextUndo(), 'Ausschneiden');
  h.drop();
  assert.deepEqual(labels(h), ['Rechteck', 'Verschieben']);
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
