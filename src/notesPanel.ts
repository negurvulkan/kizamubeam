// Fenster „Notizen“: freier Text zu Material, Aufbau und Bearbeitung. Die Notizen stehen in der Projektdatei
// (.kzb), damit man beim nächsten Mal weiß, womit und wie das Projekt gelasert wurde.
import type { Editor } from './editor';
import { h } from './dom';
import { t } from './i18n';
import { dockWindow, setBadge } from './dock';
import { NOTE_KEYS, NoteKey } from './model';
import { NOTE_LABELS } from './editor/notes';

const PLACEHOLDERS = (): Record<NoteKey, string> => ({
  material: t('z. B. 3 mm Pappel-Sperrholz, Baumarkt, Schutzfolie oben'),
  setup: t('z. B. Fokus 2 mm tiefer, Wabenbett, Ursprung links unten, mit Magneten fixiert'),
  process: t('z. B. Reihenfolge, zweiter Durchgang nötig, Kanten nachschleifen, was beim nächsten Mal anders'),
});

export function buildNotesPanel(ed: Editor) {
  const body = dockWindow('notes', t('Notizen'), { near: 'params' });
  const areas = new Map<NoteKey, HTMLTextAreaElement>();
  for (const key of NOTE_KEYS) {
    let first = true;
    const area = h('textarea', {
      class: 'note-text',
      rows: 4,
      placeholder: PLACEHOLDERS()[key],
      onfocus: () => (first = true),
      oninput: () => {
        ed.setNote(key, area.value, first);
        first = false;
      },
    });
    areas.set(key, area);
    body.append(h('label', { class: 'note-section' }, h('b', {}, NOTE_LABELS()[key]), area));
  }
  body.append(h('p', { class: 'muted note-hint' }, t('Die Notizen werden mit dem Projekt gespeichert.')));

  const render = () => {
    const notes = ed.doc.notes;
    setBadge('notes', notes ? '•' : '');
    for (const [key, area] of areas) {
      // Das Feld, in dem gerade getippt wird, nicht überschreiben (Cursor bliebe sonst nicht stehen)
      if (document.activeElement === area) continue;
      const v = notes?.[key] ?? '';
      if (area.value !== v) area.value = v;
    }
  };
  ed.on((what) => what === 'doc' && render());
  render();
}
