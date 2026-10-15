// Dialog „Biegeschnitte“ (Living Hinges): Muster in die gewählte Form setzen, mit Live-Vorschau.
import { Editor } from './editor';
import { check, numField, select } from './arrayDialogs';
import { h } from './dom';
import { computeHinge, DEFAULT_HINGE, HINGE_KINDS, HingeKind, HingeOptions, suggestHinge } from './hinges';
import { library } from './materials';
import { dec, t } from './i18n';

const STATE_KEY = 'laserwerk.hinges';

function loadState(): HingeOptions {
  try {
    return { ...DEFAULT_HINGE, ...JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_HINGE };
  }
}
function saveState(st: HingeOptions) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(st));
  } catch {
    /* Speicher nicht verfügbar */
  }
}

const ALONG = t('Die Platte biegt sich um eine Achse parallel zu den Schnitten. Am leichtesten und ohne Splittern geht das, wenn die Schnitte parallel zur Holzmaserung laufen.');
const KIND_NOTES: Record<HingeKind, string> = {
  straight: ALONG,
  wave: t('{ALONG} Wellen verhindern ruckartiges Knicken und geben einen gleichmäßigen Radius.', { ALONG }),
  diamond: t('Rauten sind steifer als gerade Schnitte und eignen sich auch für dickeres Holz (bis etwa 5 mm). An jeder Ecke bleibt ein Steg stehen.'),
  honeycomb: t('Waben sind steifer als gerade Schnitte und eignen sich auch für dickeres Holz (bis etwa 5 mm) und den Modellbau. An jeder Ecke bleibt ein Steg stehen.'),
  triangle: t('Dreiecke machen die Platte in mehrere Richtungen biegsam, z. B. für wellige oder gewölbte Formen. An jeder Ecke bleibt ein Steg stehen.'),
  cross: t('Felder abwechselnd längs und quer geschnitten (Feldgröße = Schnittlänge + Steg): biegsam in beide Richtungen, z. B. für gewölbte Formen.'),
  spiral: t('Ein durchgehender Schnitt von der Mitte der Form nach außen. Danach lässt sich die Platte wie eine Feder in die Höhe ziehen, z. B. für Lampenschirme. Am besten in einer runden Form.'),
};

export function openHingeDialog(ed: Editor) {
  const targets = ed.hingeTargets();
  if (!targets.length) {
    ed.hint = t('Biegeschnitte: erst eine geschlossene Form auswählen (z. B. ein Rechteck über dem Biegebereich).');
    ed.emit('tool');
    return;
  }
  const st = loadState();
  // Materialdicke aus der Material-Bibliothek des Layers übernehmen, falls dort hinterlegt
  const libThickness = library.get(ed.layer(targets[0].layer).material)?.thickness ?? null;
  if (libThickness) st.thickness = libThickness;

  const info = h('div', { class: 'note' }, ' ');
  /** Felder, die nur bei bestimmten Mustern bzw. Einstellungen sichtbar sind */
  const vis: [() => boolean, HTMLElement[]][] = [];
  const when = (cond: () => boolean, ...els: HTMLElement[]) => (vis.push([cond, els]), els);
  const is = (...kinds: HingeKind[]) => () => kinds.includes(st.kind);
  const spacingLabel = h('label', { for: 'hinge-spacing' }, t('Zeilenabstand (mm)'));
  const kindNote = h('div', { class: 'note' }, ' ');
  let applied = false;

  const preview = () => {
    if (!dlg.open) return;
    for (const [cond, els] of vis) {
      const show = cond();
      els.forEach((el) => (el.hidden = !show));
    }
    spacingLabel.textContent = st.kind === 'spiral' ? t('Ringabstand (mm)') : t('Zeilenabstand (mm)');
    kindNote.textContent = [KIND_NOTES[st.kind], ...notes].join(' ');
    const r = computeHinge(targets, st);
    info.textContent = r.error ?? t('{info}. Orange: Vorschau.', { info: r.info });
    info.classList.toggle('error', !!r.error);
    ed.setHingePreview(r.error ? null : r.subs);
  };

  // Felder, deren Wert der Vorschlag für die Materialdicke setzt
  const fields: Partial<Record<keyof HingeOptions, HTMLInputElement>> = {};
  const num = (key: keyof HingeOptions, title?: string, min = -Infinity) =>
    (fields[key] = numField(`hinge-${key}`, st[key] as number, (v) => ((st[key] as number) = Math.max(min, v)), title));
  const suggest = h('button', {
    class: 'btn',
    title: t('Stegbreite, Zeilenabstand, Schnittlänge, Rand und Welle aus der Materialdicke ableiten (Startwerte für einen Probeschnitt)'),
    onclick: () => {
      const s = suggestHinge(st.thickness);
      Object.assign(st, s);
      for (const k of Object.keys(s) as (keyof HingeOptions)[]) {
        const el = fields[k];
        if (el) el.value = dec(String(st[k]));
      }
      preview();
    },
  }, t('Werte vorschlagen'));

  const body = [
    h('label', { for: 'hinge-kind' }, t('Muster')),
    select('hinge-kind', st.kind, HINGE_KINDS, (v) => (st.kind = v)),
    h('label', { for: 'hinge-thickness' }, t('Materialdicke (mm)')),
    h('span', { class: 'hinge-inline' }, num('thickness', t('Nur für „Werte vorschlagen“')), suggest),
    ...when(is('straight', 'wave', 'diamond', 'honeycomb', 'triangle', 'cross'),
      h('label', { for: 'hinge-cutLength' }, t('Schnittlänge (mm)')),
      num('cutLength', t('Länge eines einzelnen Schnitts; bei Rauten, Waben und Dreiecken die Kantenlänge ohne Steg')),
      h('label', { for: 'hinge-bridge' }, t('Stegbreite (mm)')),
      num('bridge', t('Material zwischen dem Ende eines Schnitts und dem Beginn des nächsten. Zu breit: das Holz bricht; zu schmal: es reißt')),
    ),
    ...when(is('straight', 'wave', 'cross', 'spiral'),
      spacingLabel,
      num('spacing', t('Abstand der Schnittlinien zueinander. Je enger, desto kleiner der Biegeradius')),
    ),
    ...when(is('diamond'),
      h('label', { for: 'hinge-diamondAngle' }, t('Rautenwinkel (°)')),
      num('diamondAngle', t('Spitzer Winkel der Rauten an den Ecken in Schnittrichtung; kleiner = flachere Rauten, biegsamer')),
    ),
    ...when(is('wave'),
      h('label', { for: 'hinge-waveAmp' }, t('Wellenhöhe (mm)')),
      num('waveAmp', t('Ausschlag der Welle zu jeder Seite'), 0),
      h('label', { for: 'hinge-waveLength' }, t('Wellenlänge (mm)')),
      num('waveLength', t('Länge einer ganzen Welle')),
    ),
    h('label', { for: 'hinge-margin' }, t('Rand (mm)')),
    num('margin', t('Abstand der Schnitte zum Umriss der gewählten Form'), 0),
    ...when(() => st.kind !== 'spiral',
      h('label', { for: 'hinge-orient' }, t('Schnitte verlaufen')),
      select('hinge-orient', st.orient, [['auto', t('Längs der längeren Seite')], ['vertical', t('Senkrecht')], ['horizontal', t('Waagerecht')], ['angle', t('Im Winkel …')]], (v) => (st.orient = v)),
    ),
    ...when(() => st.kind !== 'spiral' && st.orient === 'angle',
      h('label', { for: 'hinge-angle' }, t('Winkel (°)')),
      num('angle', t('0° = waagerecht, gegen den Uhrzeigersinn')),
    ),
    h('span', { class: 'checks' }, check(st.keepOutline, (v) => (st.keepOutline = v), t('Gewählte Form behalten (sonst ersetzt das Muster sie)'))),
  ];
  const notes = [t('Gut geeignet sind Pappel- und Birkensperrholz sowie MDF.')];
  if (libThickness) notes.push(t('Materialdicke aus der Material-Bibliothek des Layers ({libThickness} mm).', { libThickness: dec(String(libThickness)) }));

  const dlg = h(
    'dialog',
    { class: 'offset-dialog array-dialog joint-dialog hinge-dialog' },
    h('h3', {}, t('Biegeschnitte')),
    h('div', { class: 'form' }, ...body),
    kindNote,
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
    ed.setHingePreview(null);
    if (applied) {
      saveState(st);
      ed.applyHinge(st);
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
