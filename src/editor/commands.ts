// Editor: Befehle: Löschen, Kopieren, Einfügen, Transformieren, Formparameter.
import { about, clone, cloneObjs, Mat, mul, Pt, rotate, scale, translate, visibleLeaves } from '../model';
import type { Editor } from '../editor';

export class EditorCommands {
  deleteSel(this: Editor) {
    if (!this.sel.length) return;
    this.snapshot();
    this.doc.objs = this.doc.objs.filter((o) => !this.sel.includes(o));
    this.setSel([]);
    this.emit('doc');
  }
  selectAll(this: Editor) {
    this.setSel(this.doc.objs.filter((o) => this.selectable(o)));
  }
  selectLayer(this: Editor, i: number) {
    this.setSel(this.doc.objs.filter((o) => this.selectable(o) && [...visibleLeaves([o])].some(([l]) => l.layer === i)));
  }
  copy(this: Editor) {
    this.clipboard = this.sel.map((o) => clone(o));
    // System-Zwischenablage überschreiben, damit danach nicht ein älteres Bild aus einem anderen Programm eingefügt wird
    navigator.clipboard?.writeText('').catch(() => undefined);
  }
  async onPaste(this: Editor, e: ClipboardEvent) {
    const el = e.target as HTMLElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    clearTimeout(this.pasteTimer);
    e.preventDefault();
    const data = e.clipboardData;
    if (data && this.externalPaste && (await this.externalPaste(data))) return;
    this.paste();
  }
  cut(this: Editor) {
    this.copy();
    this.deleteSel();
  }
  paste(this: Editor, offset = 5) {
    if (!this.clipboard.length) return;
    this.snapshot();
    const objs = cloneObjs(this.clipboard).map((c) => {
      c.m = mul(translate(offset, offset), c.m);
      return c;
    });
    this.clipboard = objs.map((o) => clone(o));
    this.doc.objs.push(...objs);
    this.setSel(objs);
    this.emit('doc');
  }
  duplicate(this: Editor) {
    if (!this.sel.length) return;
    this.snapshot();
    const objs = cloneObjs(this.sel);
    this.doc.objs.push(...objs);
    this.setSel(objs);
    this.emit('doc');
  }
  /** Weltmatrix auf alle ausgewählten Objekte anwenden. */
  transformSel(this: Editor, D: Mat, withSnapshot = true) {
    if (!this.sel.length) return;
    if (withSnapshot) this.snapshot();
    this.sel.forEach((o) => (o.m = mul(D, o.m)));
    this.emit('doc');
    this.emit('sel');
  }
  nudge(this: Editor, dx: number, dy: number) {
    this.transformSel(translate(dx, dy));
  }
  mirror(this: Editor, horizontal: boolean) {
    const b = this.selBounds();
    if (!b) return;
    this.transformSel(about(horizontal ? scale(-1, 1) : scale(1, -1), b.x + b.w / 2, b.y + b.h / 2));
  }
  rotateBy(this: Editor, deg: number, anchor?: Pt) {
    const b = this.selBounds();
    if (!b) return;
    const c = anchor ?? { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    // Positive Werte drehen gegen den Uhrzeigersinn (Maschinensicht, y nach oben)
    this.transformSel(about(rotate((-deg * Math.PI) / 180), c.x, c.y));
  }
  /** Formparameter (Eckenradius, Seiten …) der Auswahl ändern */
  updateShapes(this: Editor, kind: 'rect' | 'polygon', patch: Record<string, number | boolean>) {
    if (kind === 'rect' && typeof patch.r === 'number') this.rectRadius = patch.r;
    if (kind === 'polygon') {
      if (typeof patch.sides === 'number') this.polySides = patch.sides;
      if (typeof patch.star === 'boolean') this.polyStar = patch.star;
    }
    const objs = this.sel.filter((o) => o.shape.kind === kind);
    if (!objs.length) return;
    this.snapshot();
    objs.forEach((o) => {
      Object.assign(o.shape, patch);
      this.touch(o.shape);
    });
    this.emit('doc');
    this.emit('sel');
  }
  /** Numerische Felder: Auswahl auf neue Position/Größe bringen (Weltkoordinaten, Anker 0..1). */
  setSelBox(this: Editor, next: { x?: number; y?: number; w?: number; h?: number }, ax: number, ay: number, lock: boolean) {
    const b = this.selBounds();
    if (!b) return;
    let sx = 1,
      sy = 1;
    if (next.w !== undefined && b.w > 1e-9) sx = next.w / b.w;
    if (next.h !== undefined && b.h > 1e-9) sy = next.h / b.h;
    if (lock) {
      if (next.w !== undefined) sy = sx;
      else if (next.h !== undefined) sx = sy;
    }
    if (!isFinite(sx) || !isFinite(sy) || sx <= 0 || sy <= 0) return;
    const A = { x: b.x + ax * b.w, y: b.y + ay * b.h };
    let D = about(scale(sx, sy), A.x, A.y);
    const tx = next.x !== undefined ? next.x - A.x : 0;
    const ty = next.y !== undefined ? next.y - A.y : 0;
    D = mul(translate(tx, ty), D);
    this.transformSel(D);
  }
}
