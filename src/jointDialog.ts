// Dialog „Verbindung“: Fingerzinken bzw. Schlitz und Zapfen auf die gewählten Kanten anwenden, mit Live-Vorschau.
import { Editor } from './editor';
import { check, numField, select } from './arrayDialogs';
import { h } from './dom';
import { computeJoint, DEFAULT_JOINT, JointKind, JointOptions } from './joints';
import { library } from './materials';

const STATE_KEY = 'laserwerk.joints';

function loadState(): JointOptions {
  try {
    return { ...DEFAULT_JOINT, ...JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_JOINT };
  }
}
function saveState(st: JointOptions) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(st));
  } catch {
    /* Speicher nicht verfügbar */
  }
}

export function openJointDialog(ed: Editor) {
  const picks = ed.validJointPicks();
  if (!picks.length) {
    ed.setTool('joint');
    return;
  }
  const st = loadState();
  if (picks.length < 2 && st.kind === 'finger') st.swap = false;
  // Materialdicke aus der Material-Bibliothek des Layers übernehmen, falls dort hinterlegt
  const L = ed.layer(picks[0].obj.layer);
  const libThickness = library.get(L.material)?.thickness ?? null;
  if (libThickness) st.thickness = libThickness;
  const notes: string[] = [];
  if (libThickness) notes.push(`Materialdicke aus der Material-Bibliothek des Layers (${String(libThickness).replace('.', ',')} mm).`);
  if (L.kerf) notes.push('Der Layer hat schon einen Kerf-Versatz: Kerf hier auf 0 lassen, sonst wird doppelt ausgeglichen.');

  const info = h('div', { class: 'note' }, ' ');
  const rows: Record<JointKind, HTMLElement[]> = { finger: [], tenon: [] };
  const row = (kind: JointKind, ...els: HTMLElement[]) => (rows[kind].push(...els), els);
  let applied = false;

  const preview = () => {
    if (!dlg.open) return;
    for (const k of ['finger', 'tenon'] as JointKind[]) rows[k].forEach((el) => (el.hidden = st.kind !== k));
    const r = computeJoint(picks, st);
    info.textContent = r.error ?? `${r.info}. Orange gestrichelt: Vorschau.`;
    info.classList.toggle('error', !!r.error);
    ed.setJointPreview(r.error ? null : [...r.changes.values()].flatMap((c) => c.subs));
  };

  const second = picks.length > 1;
  const body = [
    h('label', { for: 'joint-kind' }, 'Art'),
    select('joint-kind', st.kind, [['finger', 'Fingerzinken'], ['tenon', 'Schlitz und Zapfen']], (v) => (st.kind = v)),
    h('label', { for: 'joint-t' }, 'Materialdicke (mm)'),
    numField('joint-t', st.thickness, (v) => (st.thickness = v), 'Tiefe der Zinken und Zapfen, Breite der Schlitze'),
    ...row('finger',
      h('label', { for: 'joint-fw' }, 'Zinkenbreite ca. (mm)'),
      numField('joint-fw', st.fingerWidth, (v) => (st.fingerWidth = v), 'Die Anzahl wird auf eine ungerade Zahl gerundet, damit beide Enden gleich sind'),
      h('label', { for: 'joint-dir' }, 'Zinken'),
      select('joint-dir', st.direction, [['in', 'Einschneiden (Außenmaß)'], ['out', 'Herausstehen (Innenmaß)']], (v) => (st.direction = v)),
    ),
    ...row('tenon',
      h('label', { for: 'joint-n' }, 'Anzahl Zapfen'),
      numField('joint-n', st.tenonCount, (v) => (st.tenonCount = Math.max(1, Math.round(v)))),
      h('label', { for: 'joint-tw' }, 'Zapfenbreite (mm)'),
      numField('joint-tw', st.tenonWidth, (v) => (st.tenonWidth = v)),
      h('label', { for: 'joint-off' }, 'Schlitzmitte ab Linie (mm)'),
      numField('joint-off', st.slotOffset, (v) => (st.slotOffset = v), 'Bei einer Kante: Abstand nach innen. Bei einer einzelnen Hilfslinie: 0 = Schlitze mittig auf der Linie'),
    ),
    h('label', { for: 'joint-kerf' }, 'Kerf (mm)'),
    numField('joint-kerf', st.kerf, (v) => (st.kerf = Math.max(0, v)), 'Schnittbreite des Lasers: Zinken/Zapfen werden breiter, Lücken/Schlitze schmaler gezeichnet'),
    h('label', { for: 'joint-clear' }, 'Spiel (mm)'),
    numField('joint-clear', st.clearance, (v) => (st.clearance = v), 'Positiv = lockerer, negativ = strammer (Press-Fit)'),
    ...row('finger', h('span', { class: 'checks' }, check(st.swap, (v) => (st.swap = v), 'Zinken und Lücken tauschen'))),
  ];
  const howto = second
    ? 'Kante 1 bekommt die Zinken bzw. Zapfen, Kante 2 das Gegenstück bzw. die Schlitze. Eine einzelne gezeichnete Linie wird durch die Schlitze ersetzt.'
    : 'Nur eine Kante gewählt: Zinken bzw. Zapfen ohne Gegenstück.';

  const dlg = h(
    'dialog',
    { class: 'offset-dialog array-dialog joint-dialog' },
    h('h3', {}, 'Verbindung'),
    h('div', { class: 'form' }, ...body),
    h('div', { class: 'note' }, [howto, ...notes].join(' ')),
    info,
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, 'Abbrechen'),
      h('button', { class: 'btn primary', onclick: () => ((applied = true), dlg.close()) }, 'Übernehmen'),
    ),
  ) as HTMLDialogElement;
  dlg.addEventListener('input', preview);
  dlg.addEventListener('change', preview);
  dlg.addEventListener('close', () => {
    ed.setJointPreview(null);
    if (applied) {
      saveState(st);
      ed.applyJoint(st);
    }
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
