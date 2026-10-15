// Dialoge „Rasterarray“ und „Kreisarray“ mit Live-Vorschau auf der Arbeitsfläche.
import { Editor } from './editor';
import { circularMatrices, CircularOptions, DEFAULT_GRID, gridMatrices, GridOptions, MAX_COPIES } from './arrays';
import { evalExpr, f2, h } from './dom';
import { Mat } from './model';

let gridState: GridOptions & { group: boolean } = { ...DEFAULT_GRID, group: false };
let circState = { count: 6, span: 360, ccw: true, rotate: true, group: false };

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : f2(v));

/** Zahlenfeld mit Formeln, das schon beim Tippen die Vorschau aktualisiert */
function numField(id: string, value: number, set: (v: number) => void, title?: string) {
  const el = h('input', { type: 'text', id, title, value: fmt(value) }) as HTMLInputElement;
  const take = () => {
    const v = evalExpr(el.value);
    if (v !== null) set(v);
  };
  el.addEventListener('input', take);
  el.addEventListener('focus', () => el.select());
  el.addEventListener('blur', () => {
    const v = evalExpr(el.value);
    if (v !== null) el.value = fmt(v);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    el.value = fmt((evalExpr(el.value) ?? 0) + (e.key === 'ArrowUp' ? step : -step));
    take();
  });
  return el;
}

const check = (checked: boolean, set: (v: boolean) => void, label: string) =>
  h('label', { class: 'check' }, h('input', { type: 'checkbox', checked, onchange: (e: Event) => set((e.target as HTMLInputElement).checked) }), label);

function select<T extends string>(id: string, cur: T, opts: [T, string][], set: (v: T) => void) {
  return h('select', { id, onchange: (e: Event) => set((e.target as HTMLSelectElement).value as T) },
    ...opts.map(([v, l]) => h('option', { value: v, selected: v === cur }, l)));
}

/** Gemeinsamer Rahmen: Vorschau, Kopienzahl, Abbrechen/Übernehmen */
function arrayDialog(ed: Editor, title: string, body: HTMLElement[], compute: () => { mats: Mat[]; center?: { x: number; y: number } }, apply: (mats: Mat[]) => void) {
  const info = h('div', { class: 'note' }, ' ');
  let applied = false;
  const preview = () => {
    // Beim Schließen meldet das verlassene Feld noch ein change-Ereignis
    if (!dlg.open) return;
    const { mats, center } = compute();
    const n = (mats.length - 1) * ed.sel.length;
    info.textContent = mats.length < 2 ? `Keine Kopien (höchstens ${MAX_COPIES}).` : `${n} neue Objekt${n > 1 ? 'e' : ''}. Orange gestrichelt: Vorschau.`;
    ed.setArrayPreview(mats, center ?? null);
  };
  const dlg = h(
    'dialog',
    { class: 'offset-dialog array-dialog' },
    h('h3', {}, title),
    h('div', { class: 'form' }, ...body),
    info,
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, 'Abbrechen'),
      h('button', { class: 'btn primary', onclick: () => ((applied = true), dlg.close()) }, 'Übernehmen'),
    ),
  );
  dlg.addEventListener('input', preview);
  dlg.addEventListener('change', preview);
  dlg.addEventListener('close', () => {
    ed.setArrayPreview(null);
    if (applied) apply(compute().mats);
    dlg.remove();
  });
  dlg.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault();
      applied = true;
      dlg.close();
    }
  });
  document.body.append(dlg);
  dlg.showModal();
  preview();
}

export function openGridArrayDialog(ed: Editor) {
  const b = ed.selBounds();
  if (!b) {
    ed.hint = 'Rasterarray: erst Objekte auswählen.';
    ed.emit('tool');
    return;
  }
  const st = { ...gridState };
  const spacingLabel = () => (st.spacing === 'gap' ? 'Abstand' : 'Mittenabstand');
  const lx = h('label', { for: 'grid-dx' }, `${spacingLabel()} X (mm)`),
    ly = h('label', { for: 'grid-dy' }, `${spacingLabel()} Y (mm)`);
  const body = [
    h('label', { for: 'grid-cols' }, 'Spalten'), numField('grid-cols', st.columns, (v) => (st.columns = Math.max(1, Math.round(v)))),
    h('label', { for: 'grid-rows' }, 'Zeilen'), numField('grid-rows', st.rows, (v) => (st.rows = Math.max(1, Math.round(v)))),
    h('label', { for: 'grid-spacing' }, 'Abstand messen'),
    select('grid-spacing', st.spacing, [['gap', 'Zwischen den Objekten'], ['center', 'Von Mitte zu Mitte']], (v) => {
      st.spacing = v;
      lx.textContent = `${spacingLabel()} X (mm)`;
      ly.textContent = `${spacingLabel()} Y (mm)`;
    }),
    lx, numField('grid-dx', st.dx, (v) => (st.dx = v)),
    ly, numField('grid-dy', st.dy, (v) => (st.dy = v)),
    h('label', { for: 'grid-dirx' }, 'Spalten nach'),
    select('grid-dirx', String(st.dirX) as '1' | '-1', [['1', 'Rechts'], ['-1', 'Links']], (v) => (st.dirX = v === '1' ? 1 : -1)),
    h('label', { for: 'grid-diry' }, 'Zeilen nach'),
    select('grid-diry', String(st.dirY) as '1' | '-1', [['-1', 'Unten'], ['1', 'Oben']], (v) => (st.dirY = v === '1' ? 1 : -1)),
    h('label', { for: 'grid-rowshift' }, 'Jede 2. Zeile versetzen (mm)'), numField('grid-rowshift', st.rowShift, (v) => (st.rowShift = v), 'Waagerechter Versatz jeder zweiten Zeile'),
    h('label', { for: 'grid-colshift' }, 'Jede 2. Spalte versetzen (mm)'), numField('grid-colshift', st.colShift, (v) => (st.colShift = v), 'Senkrechter Versatz jeder zweiten Spalte, positiv nach oben'),
    h('span', { class: 'checks' },
      check(st.mirrorCols, (v) => (st.mirrorCols = v), 'Jede 2. Spalte spiegeln'),
      check(st.mirrorRows, (v) => (st.mirrorRows = v), 'Jede 2. Zeile spiegeln'),
      check(st.group, (v) => (st.group = v), 'Als Gruppe'),
    ),
  ];
  arrayDialog(ed, 'Rasterarray', body, () => ({ mats: gridMatrices(b, st) }), (mats) => {
    gridState = st;
    ed.applyArray(mats, st.group, 'Rasterarray');
  });
}

export function openCircularArrayDialog(ed: Editor) {
  const b = ed.selBounds();
  if (!b) {
    ed.hint = 'Kreisarray: erst Objekte auswählen.';
    ed.emit('tool');
    return;
  }
  const st = { ...circState };
  // Mittelpunkt in Maschinenkoordinaten (y nach oben); Vorgabe: unterhalb der Auswahl
  const bedH = ed.doc.bed.h;
  const c = { x: b.x + b.w / 2, y: bedH - (b.y + b.h / 2) - Math.max(20, 1.5 * Math.max(b.w, b.h)) };
  const opts = (): CircularOptions => ({ count: st.count, span: st.span, ccw: st.ccw, rotate: st.rotate, cx: c.x, cy: bedH - c.y });
  const body = [
    h('label', { for: 'circ-count' }, 'Anzahl (mit Original)'), numField('circ-count', st.count, (v) => (st.count = Math.max(1, Math.round(v)))),
    h('label', { for: 'circ-cx' }, 'Mittelpunkt X (mm)'), numField('circ-cx', c.x, (v) => (c.x = v)),
    h('label', { for: 'circ-cy' }, 'Mittelpunkt Y (mm)'), numField('circ-cy', c.y, (v) => (c.y = v)),
    h('label', { for: 'circ-span' }, 'Winkelbereich (°)'), numField('circ-span', st.span, (v) => (st.span = v), '360 = gleichmäßig auf dem ganzen Kreis, sonst von der ersten bis zur letzten Kopie'),
    h('label', { for: 'circ-dir' }, 'Richtung'),
    select('circ-dir', st.ccw ? 'ccw' : 'cw', [['ccw', 'Gegen den Uhrzeigersinn'], ['cw', 'Im Uhrzeigersinn']], (v) => (st.ccw = v === 'ccw')),
    h('span', { class: 'checks' },
      check(st.rotate, (v) => (st.rotate = v), 'Objekte mitdrehen'),
      check(st.group, (v) => (st.group = v), 'Als Gruppe'),
    ),
  ];
  arrayDialog(ed, 'Kreisarray', body, () => {
    const o = opts();
    return { mats: circularMatrices(b, o), center: { x: o.cx, y: o.cy } };
  }, (mats) => {
    circState = st;
    ed.applyArray(mats, st.group, 'Kreisarray');
  });
}
