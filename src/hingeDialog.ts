// Dialog „Biegeschnitte“ (Living Hinges): Muster in die gewählte Form setzen, mit Live-Vorschau.
import { Editor } from './editor';
import { check, numField, select } from './arrayDialogs';
import { h } from './dom';
import { computeHinge, DEFAULT_HINGE, HINGE_KINDS, HingeKind, HingeOptions, suggestHinge } from './hinges';
import { library } from './materials';

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

export function openHingeDialog(ed: Editor) {
  const targets = ed.hingeTargets();
  if (!targets.length) {
    ed.hint = 'Biegeschnitte: erst eine geschlossene Form auswählen (z. B. ein Rechteck über dem Biegebereich).';
    ed.emit('tool');
    return;
  }
  const st = loadState();
  // Materialdicke aus der Material-Bibliothek des Layers übernehmen, falls dort hinterlegt
  const libThickness = library.get(ed.layer(targets[0].layer).material)?.thickness ?? null;
  if (libThickness) st.thickness = libThickness;

  const info = h('div', { class: 'note' }, ' ');
  const rows: Record<HingeKind | 'angle', HTMLElement[]> = { straight: [], wave: [], angle: [] };
  const row = (k: HingeKind | 'angle', ...els: HTMLElement[]) => (rows[k].push(...els), els);
  let applied = false;

  const preview = () => {
    if (!dlg.open) return;
    for (const k of HINGE_KINDS.map(([k]) => k)) rows[k].forEach((el) => (el.hidden = st.kind !== k));
    rows.angle.forEach((el) => (el.hidden = st.orient !== 'angle'));
    const r = computeHinge(targets, st);
    info.textContent = r.error ?? `${r.info}. Orange: Vorschau.`;
    info.classList.toggle('error', !!r.error);
    ed.setHingePreview(r.error ? null : r.subs);
  };

  // Felder, deren Wert der Vorschlag für die Materialdicke setzt
  const fields: Partial<Record<keyof HingeOptions, HTMLInputElement>> = {};
  const num = (key: keyof HingeOptions, title?: string, min = -Infinity) =>
    (fields[key] = numField(`hinge-${key}`, st[key] as number, (v) => ((st[key] as number) = Math.max(min, v)), title));
  const suggest = h('button', {
    class: 'btn',
    title: 'Stegbreite, Zeilenabstand, Schnittlänge, Rand und Welle aus der Materialdicke ableiten (Startwerte für einen Probeschnitt)',
    onclick: () => {
      const s = suggestHinge(st.thickness);
      Object.assign(st, s);
      for (const k of Object.keys(s) as (keyof HingeOptions)[]) {
        const el = fields[k];
        if (el) el.value = String(st[k]).replace('.', ',');
      }
      preview();
    },
  }, 'Werte vorschlagen');

  const body = [
    h('label', { for: 'hinge-kind' }, 'Muster'),
    select('hinge-kind', st.kind, HINGE_KINDS, (v) => (st.kind = v)),
    h('label', { for: 'hinge-thickness' }, 'Materialdicke (mm)'),
    h('span', { class: 'hinge-inline' }, num('thickness', 'Nur für „Werte vorschlagen“'), suggest),
    h('label', { for: 'hinge-cutLength' }, 'Schnittlänge (mm)'),
    num('cutLength', 'Länge eines einzelnen Schnitts'),
    h('label', { for: 'hinge-bridge' }, 'Stegbreite (mm)'),
    num('bridge', 'Material zwischen dem Ende eines Schnitts und dem Beginn des nächsten. Zu breit: das Holz bricht; zu schmal: es reißt'),
    h('label', { for: 'hinge-spacing' }, 'Zeilenabstand (mm)'),
    num('spacing', 'Abstand der Schnittlinien zueinander. Je enger, desto kleiner der Biegeradius'),
    ...row('wave',
      h('label', { for: 'hinge-waveAmp' }, 'Wellenhöhe (mm)'),
      num('waveAmp', 'Ausschlag der Welle zu jeder Seite', 0),
      h('label', { for: 'hinge-waveLength' }, 'Wellenlänge (mm)'),
      num('waveLength', 'Länge einer ganzen Welle'),
    ),
    h('label', { for: 'hinge-margin' }, 'Rand (mm)'),
    num('margin', 'Abstand der Schnitte zum Umriss der gewählten Form', 0),
    h('label', { for: 'hinge-orient' }, 'Schnitte verlaufen'),
    select('hinge-orient', st.orient, [['auto', 'Längs der längeren Seite'], ['vertical', 'Senkrecht'], ['horizontal', 'Waagerecht'], ['angle', 'Im Winkel …']], (v) => (st.orient = v)),
    ...row('angle',
      h('label', { for: 'hinge-angle' }, 'Winkel (°)'),
      num('angle', '0° = waagerecht, gegen den Uhrzeigersinn'),
    ),
    h('span', { class: 'checks' }, check(st.keepOutline, (v) => (st.keepOutline = v), 'Gewählte Form behalten (sonst ersetzt das Muster sie)')),
  ];
  const notes = [
    'Die Platte biegt sich um eine Achse parallel zu den Schnitten. Am leichtesten und ohne Splittern geht das, wenn die Schnitte parallel zur Holzmaserung laufen. Gut geeignet sind Pappel- und Birkensperrholz sowie MDF.',
  ];
  if (libThickness) notes.push(`Materialdicke aus der Material-Bibliothek des Layers (${String(libThickness).replace('.', ',')} mm).`);

  const dlg = h(
    'dialog',
    { class: 'offset-dialog array-dialog joint-dialog hinge-dialog' },
    h('h3', {}, 'Biegeschnitte'),
    h('div', { class: 'form' }, ...body),
    h('div', { class: 'note' }, notes.join(' ')),
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
