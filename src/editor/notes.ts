// Editor: Projekt-Notizen (Material, Aufbau, Bearbeitung). Sie stehen in der Projektdatei und gehören zum
// Verlauf; beim Tippen entsteht ein Undo-Schritt je Bearbeitung eines Abschnitts.
import { cleanNotes, NoteKey } from '../model';
import { t } from '../i18n';
import type { Editor } from '../editor';

export const NOTE_LABELS = (): Record<NoteKey, string> => ({
  material: t('Material'),
  setup: t('Aufbau'),
  process: t('Bearbeitung'),
});

export class EditorNotes {
  /** Einen Abschnitt setzen; undo = false hängt an den letzten Schritt an (weiteres Tippen im selben Feld) */
  setNote(this: Editor, key: NoteKey, text: string, undo = true) {
    if ((this.doc.notes?.[key] ?? '') === text) return;
    if (undo) this.snapshot(t('Notiz „{name}“ ändern', { name: NOTE_LABELS()[key] }));
    const notes = cleanNotes({ ...this.doc.notes, [key]: text });
    if (notes) this.doc.notes = notes;
    else delete this.doc.notes;
    this.emit('doc');
  }
}
