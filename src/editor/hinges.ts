// Editor: Biegeschnitte (Living Hinges).
import { IDENT, leaves, newId, Obj, SubPath } from '../model';
import { computeHinge, HingeOptions } from '../hinges';
import { shapeSubs } from '../geom';
import { t } from '../i18n';
import type { Editor } from '../editor';

export class EditorHinges {
  /** Gewählte Formen, die ein Biegemuster füllen kann (geschlossene Konturen, keine Bilder und Texte) */
  hingeTargets(this: Editor): Obj[] {
    return this.sel.filter((o) => [...leaves([o])].some(([l]) => l.shape.kind !== 'image' && l.shape.kind !== 'text' && shapeSubs(l.shape).some((sp) => sp.closed)));
  }
  setHingePreview(this: Editor, subs: SubPath[] | null) {
    this.hingePreview = subs;
    this.redraw();
  }
  /** Biegeschnitte in die gewählten Formen setzen; ohne „Form behalten“ ersetzt das Muster die Formen. */
  applyHinge(this: Editor, opt: HingeOptions): boolean {
    const inputs = this.hingeTargets();
    const r = computeHinge(inputs, opt);
    if (r.error) {
      this.hint = t('Biegeschnitte: {error}', { error: r.error });
      this.emit('tool');
      return false;
    }
    this.snapshot();
    const res: Obj = { id: newId(), m: IDENT, layer: inputs[0].layer, shape: { kind: 'path', subs: r.subs } };
    const z = inputs.map((o) => this.doc.objs.indexOf(o));
    const idx = opt.keepOutline ? Math.max(...z) + 1 : Math.min(...z);
    if (!opt.keepOutline) this.doc.objs = this.doc.objs.filter((o) => !inputs.includes(o));
    this.doc.objs.splice(Math.min(idx, this.doc.objs.length), 0, res);
    this.setSel([res]);
    this.hint = t('Biegeschnitte angelegt: {info}.', { info: r.info });
    this.emit('doc');
    return true;
  }
}
