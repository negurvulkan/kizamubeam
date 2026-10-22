// Dialog „Verformen“: Auswahl biegen, wölben oder perspektivisch verzerren, mit Live-Vorschau.
import { Editor } from './editor';
import { check, numField, select } from './arrayDialogs';
import { h } from './dom';
import { WarpKind, WarpOptions } from './warp';
import { dec, t } from './i18n';

const STATE_KEY = 'kizamubeam.warp';
const DEFAULT: WarpOptions = { kind: 'arc', amount: 50, vertical: false };

function loadState(): WarpOptions {
  try {
    return { ...DEFAULT, ...JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT };
  }
}
function saveState(st: WarpOptions) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(st));
  } catch {
    /* Speicher nicht verfügbar */
  }
}

export const WARP_LABELS: [WarpKind, string][] = [
  ['arc', t('Bogen')],
  ['arcUpper', t('Bogen oben')],
  ['arcLower', t('Bogen unten')],
  ['bulge', t('Wölben')],
  ['flag', t('Flagge')],
  ['perspective', t('Perspektive')],
];

const NOTES: Record<WarpKind, string> = {
  arc: t('Waagerechte Linien werden zu Kreisbögen, bei 100 % zum Halbkreis. Gut für Schriftzüge auf Schildern und Buttons.'),
  arcUpper: t('Nur die obere Kante wölbt sich, die untere bleibt gerade.'),
  arcLower: t('Nur die untere Kante wölbt sich, die obere bleibt gerade.'),
  bulge: t('Obere und untere Kante wölben sich nach außen, bei negativer Stärke nach innen.'),
  flag: t('Eine Welle über die ganze Breite, wie eine Fahne im Wind.'),
  perspective: t('Fluchtpunkt-Perspektive: die obere Kante wird schmaler, bei negativer Stärke die untere.'),
};

export function openWarpDialog(ed: Editor) {
  if (!ed.sel.length) {
    ed.hint = t('Verformen: erst Formen, Text oder Bilder auswählen.');
    ed.emit('tool');
    return;
  }
  const st = loadState();
  const note = h('div', { class: 'note' }, ' ');
  let applied = false;
  const preview = () => {
    if (!dlg.open) return;
    note.textContent = NOTES[st.kind];
    void ed.previewWarp(st);
  };
  const amount = numField('warp-amount', st.amount, (v) => {
    st.amount = Math.max(-100, Math.min(100, v));
    slider.value = String(st.amount);
    preview();
  }, t('-100 bis 100 %; negativ biegt in die andere Richtung'));
  const slider = h('input', { type: 'range', min: '-100', max: '100', step: '1', value: String(st.amount), style: 'flex: 1; min-width: 0' }) as HTMLInputElement;
  slider.addEventListener('input', () => {
    st.amount = +slider.value;
    amount.value = dec(String(st.amount));
    preview();
  });
  amount.style.width = '4.5em';
  const hasText = ed.sel.some((o) => o.shape.kind === 'text' || o.shape.kind === 'group');
  const hasGen = ed.sel.some((o) => o.shape.kind === 'gen');

  const dlg = h(
    'dialog',
    { class: 'offset-dialog array-dialog warp-dialog' },
    h('h3', {}, t('Verformen')),
    h(
      'div',
      { class: 'form' },
      h('label', { for: 'warp-kind' }, t('Art')),
      select('warp-kind', st.kind, WARP_LABELS, (v) => ((st.kind = v), preview())),
      h('label', { for: 'warp-amount' }, t('Stärke (%)')),
      h('span', { class: 'hinge-inline', style: 'display: flex; gap: 6px; align-items: center' }, slider, amount),
      h('span', { class: 'checks' }, check(st.vertical, (v) => ((st.vertical = v), preview()), t('Senkrecht (um 90° gedreht)'))),
    ),
    note,
    h('div', { class: 'note' },
      [
        t('Orange gestrichelt: Vorschau. Formen und Texte werden zu Bézierpfaden, Bilder werden neu berechnet.'),
        hasText ? t('Text lässt sich danach nicht mehr als Text bearbeiten.') : '',
        hasGen ? t('Parametrische Bauteile werden dabei zu einfachen Pfaden.') : '',
      ].filter(Boolean).join(' '),
    ),
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          applied = true;
          saveState(st);
          dlg.close();
          await ed.previewWarp(null);
          await ed.warpSel(st);
        },
      }, t('Übernehmen')),
    ),
  );
  dlg.addEventListener('close', () => {
    if (!applied) void ed.previewWarp(null);
    dlg.remove();
  });
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
  preview();
}
