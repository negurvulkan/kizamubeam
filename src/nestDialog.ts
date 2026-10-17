// Dialog „Verschachteln“: Auswahl mit ihren echten Konturen platzsparend auf Bett, Material oder Reststück legen.
import { Editor } from './editor';
import { check, numField, select } from './arrayDialogs';
import { h } from './dom';
import { DEFAULT_NEST_SETTINGS, NestSettings } from './editor/nest';
import { t } from './i18n';

const KEY = 'kizamubeam.nest';

function load(): NestSettings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULT_NEST_SETTINGS, ...(s && typeof s === 'object' ? s : {}), container: undefined };
  } catch {
    return { ...DEFAULT_NEST_SETTINGS };
  }
}
function save(s: NestSettings) {
  try {
    const { container: _, ...rest } = s;
    localStorage.setItem(KEY, JSON.stringify(rest));
  } catch {
    /* Speicher nicht verfügbar */
  }
}

export function openNestDialog(ed: Editor) {
  if (!ed.sel.length) {
    ed.hint = t('Verschachteln: erst Objekte auswählen.');
    ed.emit('tool');
    return;
  }
  const st = load();
  const material = h('div', { class: 'form' },
    h('label', { for: 'nest-w' }, t('Breite (mm)')), numField('nest-w', st.w, (v) => (st.w = Math.max(1, v))),
    h('label', { for: 'nest-h' }, t('Höhe (mm)')), numField('nest-h', st.h, (v) => (st.h = Math.max(1, v))),
    h('label', { for: 'nest-x' }, t('Linke untere Ecke X (mm)')), numField('nest-x', st.x, (v) => (st.x = v)),
    h('label', { for: 'nest-y' }, t('Linke untere Ecke Y (mm)')), numField('nest-y', st.y, (v) => (st.y = v)),
  );
  const shapeNote = h('div', { class: 'note' }, t('Die gewählte Form mit der größten Fläche ist die Platte (z. B. der Umriss eines Reststücks auf einem Werkzeug-Layer). Sie bleibt liegen.'));
  const sync = () => {
    material.style.display = st.sheet === 'material' ? '' : 'none';
    shapeNote.style.display = st.sheet === 'shape' ? '' : 'none';
  };
  const info = h('div', { class: 'note' }, t('Teile mit Gravuren, Löchern als eigene Form und Text auf Pfad bleiben zusammen. Rückgängig mit Ctrl+Z.'));
  const bar = h('progress', { max: 1, value: 0, style: 'width:100%;display:none' }) as HTMLProgressElement;
  let busy = false,
    cancel = false;
  const run = h('button', { class: 'btn primary' }, t('Verschachteln')) as HTMLButtonElement;
  const abort = h('button', { class: 'btn', onclick: () => (busy ? (cancel = true) : dlg.close()) }, t('Abbrechen'));
  const go = async () => {
    if (busy) return;
    busy = true;
    cancel = false;
    save(st);
    run.disabled = true;
    bar.style.display = '';
    try {
      const r = await ed.nestSel(st, (f) => {
        bar.value = f;
        return !cancel;
      });
      if (r || !cancel) dlg.close();
    } finally {
      busy = false;
      run.disabled = false;
      bar.style.display = 'none';
    }
  };
  run.addEventListener('click', go);
  const dlg = h(
    'dialog',
    { class: 'offset-dialog nest-dialog' },
    h('h3', {}, t('Verschachteln')),
    h('div', { class: 'form' },
      h('label', { for: 'nest-sheet' }, t('Fläche')),
      select('nest-sheet', st.sheet, [['bed', t('Arbeitsbereich')], ['material', t('Materialgröße')], ['shape', t('Gewählte Form (Reststück)')]], (v) => {
        st.sheet = v;
        sync();
      }),
    ),
    material,
    shapeNote,
    h('div', { class: 'form' },
      h('label', { for: 'nest-gap' }, t('Abstand zwischen Teilen (mm)')), numField('nest-gap', st.gap, (v) => (st.gap = Math.max(0, v))),
      h('label', { for: 'nest-margin' }, t('Abstand zum Rand (mm)')), numField('nest-margin', st.margin, (v) => (st.margin = Math.max(0, v))),
      h('label', { for: 'nest-rot' }, t('Drehen')),
      select('nest-rot', String(st.rotStep) as string, [
        ['0', t('Nicht drehen')], ['180', t('Nur 180°')], ['90', t('In 90°-Schritten')], ['45', t('In 45°-Schritten')],
        ['15', t('In 15°-Schritten')], ['5', t('In 5°-Schritten')],
      ], (v) => (st.rotStep = Number(v))),
      h('label', { for: 'nest-corner' }, t('Beginnen an')),
      select('nest-corner', st.corner, [['bl', t('Unten links')], ['br', t('Unten rechts')], ['tl', t('Oben links')], ['tr', t('Oben rechts')]], (v) => (st.corner = v)),
      h('label', { for: 'nest-quality' }, t('Genauigkeit')),
      select('nest-quality', st.quality, [['fast', t('Schnell')], ['normal', t('Normal')], ['fine', t('Gründlich')]], (v) => (st.quality = v)),
      h('span', { class: 'checks' },
        check(st.holes, (v) => (st.holes = v), t('Kleine Teile in Löcher legen')),
        check(st.avoid, (v) => (st.avoid = v), t('Andere Objekte auf der Seite umgehen')),
        check(st.newPages, (v) => (st.newPages = v), t('Was nicht passt, auf neue Seiten')),
      ),
    ),
    info,
    bar,
    h('div', { class: 'dialog-buttons' }, abort, run),
  );
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('cancel', (e) => {
    if (busy) {
      e.preventDefault();
      cancel = true;
    }
  });
  dlg.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault();
      go();
    }
  });
  document.body.append(dlg);
  sync();
  dlg.showModal();
}
