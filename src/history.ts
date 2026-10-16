// Rückgängig/Wiederholen mit benannten Schritten. Jeder Schritt speichert den Dokumentstand als JSON:
// auf dem Undo-Stapel den Stand *vor* der Änderung, auf dem Redo-Stapel den Stand *nach* ihr.
// Der Name wandert beim Rückgängig/Wiederholen mit, so dass das Verlaufsfenster immer dieselbe Liste zeigt:
//   [Ausgangsstand] Schritt 1 … Schritt n (aktuell) | wiederholbare Schritte (ausgegraut)

export interface HistoryEntry {
  label: string;
  state: string;
  /** Zeitpunkt der Änderung (ms) */
  time: number;
}

export interface HistoryRow {
  label: string;
  time: number;
  /** true = rückgängig gemacht, per Wiederholen erreichbar */
  undone: boolean;
}

export class History {
  private undo: HistoryEntry[] = [];
  private redo: HistoryEntry[] = [];
  /** Ältere Schritte wurden wegen des Limits verworfen */
  truncated = false;
  constructor(private limit = 200) {}

  get canUndo() {
    return this.undo.length > 0;
  }
  get canRedo() {
    return this.redo.length > 0;
  }
  /** Anzahl der Schritte bis zum aktuellen Stand (= Index der aktuellen Zeile in rows()) */
  get position() {
    return this.undo.length;
  }

  /** Stand vor einer Änderung merken. Verwirft die wiederholbaren Schritte. */
  push(state: string, label: string) {
    this.undo.push({ label, state, time: Date.now() });
    if (this.undo.length > this.limit) {
      this.undo.shift();
      this.truncated = true;
    }
    this.redo = [];
  }
  /** Letzten Schritt verwerfen, z. B. wenn ein Ziehen doch nichts geändert hat */
  drop() {
    this.undo.pop();
  }
  /** Namen des letzten Schritts nachträglich setzen */
  relabel(label: string) {
    const e = this.undo[this.undo.length - 1];
    if (e) e.label = label;
  }
  /** Für batch(): Redo-Stapel sichern und wiederherstellen, wenn sich nichts geändert hat */
  saveRedo() {
    return this.redo;
  }
  restoreRedo(r: HistoryEntry[]) {
    this.redo = r;
  }

  /** Einen Schritt zurück; liefert den zu ladenden Stand oder null */
  stepBack(current: string): string | null {
    const e = this.undo.pop();
    if (!e) return null;
    this.redo.push({ label: e.label, state: current, time: e.time });
    return e.state;
  }
  /** Einen Schritt vor; liefert den zu ladenden Stand oder null */
  stepForward(current: string): string | null {
    const e = this.redo.pop();
    if (!e) return null;
    this.undo.push({ label: e.label, state: current, time: e.time });
    return e.state;
  }
  /**
   * Zu einer Zeile aus rows() springen (0 = Ausgangsstand). Liefert den zu ladenden Stand,
   * oder null, wenn die Zeile schon aktuell ist. Zwischenstände werden nicht geladen.
   */
  jumpTo(row: number, current: string): string | null {
    row = Math.max(0, Math.min(row, this.undo.length + this.redo.length));
    let s: string | null = null;
    while (this.undo.length > row) s = this.stepBack(s ?? current);
    while (this.undo.length < row) s = this.stepForward(s ?? current);
    return s;
  }

  /** Zeilen fürs Verlaufsfenster ohne den Ausgangsstand, älteste zuerst */
  rows(): HistoryRow[] {
    return [
      ...this.undo.map((e) => ({ label: e.label, time: e.time, undone: false })),
      ...[...this.redo].reverse().map((e) => ({ label: e.label, time: e.time, undone: true })),
    ];
  }
  /** Name des Schritts, den Rückgängig bzw. Wiederholen als Nächstes betrifft */
  nextUndo() {
    return this.undo[this.undo.length - 1]?.label ?? null;
  }
  nextRedo() {
    return this.redo[this.redo.length - 1]?.label ?? null;
  }
}
