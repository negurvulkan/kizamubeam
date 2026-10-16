// Dialog „Verbindung“: Fingerzinken bzw. Schlitz und Zapfen auf die gewählten Kanten anwenden, mit Live-Vorschau.
import { Editor } from './editor';
import { check, numField, select } from './arrayDialogs';
import { h } from './dom';
import { computeJoint, DEFAULT_JOINT, JointKind, JointOptions } from './joints';
import { library } from './materials';
import { dec, t } from './i18n';

const STATE_KEY = 'kizamubeam.joints';

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
  if (libThickness) notes.push(t('Materialdicke aus der Material-Bibliothek des Layers ({libThickness} mm).', { libThickness: dec(String(libThickness)) }));
  if (L.kerf) notes.push(t('Der Layer hat schon einen Kerf-Versatz: Kerf hier auf 0 lassen, sonst wird doppelt ausgeglichen.'));

  const info = h('div', { class: 'note' }, ' ');
  const rows: Record<JointKind | 'tenons', HTMLElement[]> = { finger: [], tenon: [], lap: [], snap: [], hook: [], wedge: [], tslot: [], tenons: [] };
  const row = (kind: JointKind | 'tenons', ...els: HTMLElement[]) => (rows[kind].push(...els), els);
  /** Alle Arten mit Zapfen und Schlitzen */
  const tenonKinds: JointKind[] = ['tenon', 'snap', 'hook', 'wedge', 'tslot'];
  let applied = false;

  const preview = () => {
    if (!dlg.open) return;
    for (const k of ['finger', 'tenon', 'lap', 'snap', 'hook', 'wedge', 'tslot'] as JointKind[]) rows[k].forEach((el) => (el.hidden = st.kind !== k));
    rows.tenons.forEach((el) => (el.hidden = !tenonKinds.includes(st.kind)));
    const r = computeJoint(picks, st);
    info.textContent = r.error ?? t('{info}. Orange gestrichelt: Vorschau.', { info: r.info });
    info.classList.toggle('error', !!r.error);
    ed.setJointPreview(r.error ? null : [...[...r.changes.values()].flatMap((c) => c.subs), ...r.added]);
  };

  const second = picks.length > 1;
  const body = [
    h('label', { for: 'joint-kind' }, t('Art')),
    select('joint-kind', st.kind, [['finger', t('Fingerzinken')], ['tenon', t('Schlitz und Zapfen')], ['lap', t('Überblattung (Kreuzverbindung)')], ['snap', t('Schnappverbindung')], ['hook', t('Hakenverbindung')], ['wedge', t('Keilzapfen')], ['tslot', t('T-Slot mit Mutter')]], (v) => (st.kind = v)),
    h('label', { for: 'joint-t' }, t('Materialdicke (mm)')),
    numField('joint-t', st.thickness, (v) => (st.thickness = v), t('Tiefe der Zinken und Zapfen, Breite der Schlitze')),
    ...row('finger',
      h('label', { for: 'joint-fw' }, t('Zinkenbreite ca. (mm)')),
      numField('joint-fw', st.fingerWidth, (v) => (st.fingerWidth = v), t('Die Anzahl wird auf eine ungerade Zahl gerundet, damit beide Enden gleich sind')),
      h('label', { for: 'joint-dir' }, t('Zinken')),
      select('joint-dir', st.direction, [['in', t('Einschneiden (Außenmaß)')], ['out', t('Herausstehen (Innenmaß)')]], (v) => (st.direction = v)),
    ),
    ...row('tenons',
      h('label', { for: 'joint-n' }, t('Anzahl Zapfen')),
      numField('joint-n', st.tenonCount, (v) => (st.tenonCount = Math.max(1, Math.round(v)))),
      h('label', { for: 'joint-tw' }, t('Zapfenbreite (mm)')),
      numField('joint-tw', st.tenonWidth, (v) => (st.tenonWidth = v)),
      h('label', { for: 'joint-off' }, t('Schlitzmitte ab Linie (mm)')),
      numField('joint-off', st.slotOffset, (v) => (st.slotOffset = v), t('Bei einer Kante: Abstand nach innen. Bei einer einzelnen Hilfslinie: 0 = Schlitze mittig auf der Linie')),
    ),
    ...row('snap',
      h('label', { for: 'joint-lip' }, t('Rasthaken-Überstand (mm)')),
      numField('joint-lip', st.snapLip, (v) => (st.snapLip = v), t('Wie weit die Rasthaken seitlich überstehen; bei 3-mm-Sperrholz etwa 0,4 bis 0,8 mm')),
      h('label', { for: 'joint-slen' }, t('Rasthaken-Länge (mm)')),
      numField('joint-slen', st.snapLength, (v) => (st.snapLength = v), t('Länge der Einführschräge hinter der Gegenplatte')),
      h('label', { for: 'joint-relief' }, t('Federschlitz in die Platte (mm)')),
      numField('joint-relief', st.snapRelief, (v) => (st.snapRelief = Math.max(0, v)), t('Schlitz zwischen den beiden Zungen; je tiefer, desto leichter federn sie ein')),
    ),
    ...row('hook',
      h('label', { for: 'joint-hl' }, t('Hakenlänge (mm)')),
      numField('joint-hl', st.hookLength, (v) => (st.hookLength = v), t('Seitlicher Überstand des Hakens; um so viel wird nach dem Einstecken geschoben')),
    ),
    ...row('wedge',
      h('label', { for: 'joint-ww' }, t('Keilbreite (mm)')),
      numField('joint-ww', st.wedgeWidth, (v) => (st.wedgeWidth = v), t('Länge des Keillochs im Zapfen; die Keile werden 1,5 mm schmaler bis breiter gezeichnet')),
      h('label', { for: 'joint-wp' }, t('Keil zieht an (mm)')),
      numField('joint-wp', st.wedgePull, (v) => (st.wedgePull = v), t('So weit reicht das Keilloch in die Gegenplatte hinein; der Keil zieht die Platten um diesen Betrag zusammen')),
    ),
    ...row('tslot',
      h('label', { for: 'joint-bd' }, t('Schraube Ø (mm)')),
      numField('joint-bd', st.boltDia, (v) => (st.boltDia = v), t('Für M3 etwa 3,2')),
      h('label', { for: 'joint-bl' }, t('Schraubenlänge (mm)')),
      numField('joint-bl', st.boltLength, (v) => (st.boltLength = v), t('Länge unter dem Kopf')),
      h('label', { for: 'joint-nw' }, t('Mutter Schlüsselweite (mm)')),
      numField('joint-nw', st.nutWidth, (v) => (st.nutWidth = v), t('M3: 5,5 (mit etwas Luft 5,6)')),
      h('label', { for: 'joint-nh' }, t('Mutter Höhe (mm)')),
      numField('joint-nh', st.nutHeight, (v) => (st.nutHeight = v), t('M3: 2,4 (mit etwas Luft 2,6)')),
    ),
    ...row('lap',
      h('label', { for: 'joint-ln' }, t('Schlitze je Kante')),
      numField('joint-ln', st.lapCount, (v) => (st.lapCount = Math.max(1, Math.round(v))), t('Teilen die Kante in gleiche Fächer, z. B. 3 Schlitze = 4 Fächer')),
      h('label', { for: 'joint-ld' }, t('Tiefe Kante 1 (%)')),
      numField('joint-ld', st.lapDepth, (v) => (st.lapDepth = v), t('Anteil der Plattenbreite; Kante 2 wird um den Rest geschlitzt (50 % = beide zur Hälfte)')),
    ),
    h('label', { for: 'joint-kerf' }, t('Kerf (mm)')),
    numField('joint-kerf', st.kerf, (v) => (st.kerf = Math.max(0, v)), t('Schnittbreite des Lasers: Zinken/Zapfen werden breiter, Lücken/Schlitze schmaler gezeichnet')),
    h('label', { for: 'joint-clear' }, t('Spiel (mm)')),
    numField('joint-clear', st.clearance, (v) => (st.clearance = v), t('Positiv = lockerer, negativ = strammer (Press-Fit)')),
    ...row('finger', h('span', { class: 'checks' }, check(st.swap, (v) => (st.swap = v), t('Zinken und Lücken tauschen')))),
    ...row('hook', h('span', { class: 'checks' }, check(st.hookFlip, (v) => (st.hookFlip = v), t('Haken in die andere Richtung')))),
  ];
  const howto = second
    ? t('Kante 1 bekommt die Zinken, Zapfen bzw. Überblattungs-Schlitze, Kante 2 das Gegenstück. Bei Zapfen (auch Schnapp- und Hakenzapfen) wird eine einzelne gezeichnete Linie durch die Schlitze ersetzt.')
    : t('Nur eine Kante gewählt: Zinken, Zapfen bzw. Schlitze ohne Gegenstück.');

  const dlg = h(
    'dialog',
    { class: 'offset-dialog array-dialog joint-dialog' },
    h('h3', {}, t('Verbindung')),
    h('div', { class: 'form' }, ...body),
    h('div', { class: 'note' }, [howto, ...notes].join(' ')),
    info,
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', { class: 'btn primary', onclick: () => ((applied = true), dlg.close()) }, t('Übernehmen')),
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
