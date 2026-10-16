// Editor: Verbindungen (Fingerzinken, Schlitz und Zapfen).
import { apply, IDENT, inv, leaves, newId, SubPath, visibleLeaves } from '../model';
import { transformSubs } from '../importers';
import { computeJoint, EdgePick, isStraight, JointOptions } from '../joints';
import { invalidate, segments, shapeSubs } from '../geom';
import { t } from '../i18n';
import type { Editor } from '../editor';
import { TOOL_HINTS } from './shared';

export class EditorJoints {
  /** Nächste gerade Kante eines sichtbaren Objekts unter dem Mauszeiger */
  updateJointHover(this: Editor, sx: number, sy: number) {
    const prev = this.jointHover;
    let best = 7;
    this.jointHover = null;
    for (const [leaf, m] of visibleLeaves(this.doc.objs)) {
      const k = leaf.shape.kind;
      if (k === 'text' || k === 'image' || k === 'barcode' || !this.layer(leaf.layer).show) continue;
      shapeSubs(leaf.shape).forEach((sp, si) =>
        segments(sp).forEach((sg, gi) => {
          if (sg.curve) return;
          const a = this.toScreen(apply(m, sg.a.x, sg.a.y)),
            b = this.toScreen(apply(m, sg.b.x, sg.b.y));
          const dx = b.x - a.x,
            dy = b.y - a.y;
          const l2 = dx * dx + dy * dy;
          if (l2 < 1) return;
          const t = Math.max(0, Math.min(1, ((sx - a.x) * dx + (sy - a.y) * dy) / l2));
          const d = Math.hypot(a.x + dx * t - sx, a.y + dy * t - sy);
          if (d < best) {
            best = d;
            this.jointHover = { obj: leaf, m, sub: si, seg: gi };
          }
        }),
      );
    }
    // im forEach gesetzt: TypeScript sieht das nicht
    const h = this.jointHover as EdgePick | null;
    this.canvas.style.cursor = h ? 'pointer' : 'crosshair';
    if (!h !== !prev || (h && prev && (h.obj !== prev.obj || h.sub !== prev.sub || h.seg !== prev.seg))) this.redraw();
  }

  /** Gewählte Kanten, die es im Dokument noch gibt */
  validJointPicks(this: Editor): EdgePick[] {
    const alive = new Set([...leaves(this.doc.objs)].map(([o]) => o));
    return this.jointPicks.filter((p) => alive.has(p.obj) && isStraight(p.obj, p.sub, p.seg));
  }
  clearJointPicks(this: Editor) {
    this.jointPicks = [];
    this.hint = this.tool === 'joint' ? TOOL_HINTS.joint : this.hint;
    this.emit('tool');
    this.redraw();
  }
  setJointPreview(this: Editor, subs: SubPath[] | null) {
    this.jointPreview = subs;
    this.redraw();
  }
  /** Verbindung auf die gewählten Kanten anwenden; die Objekte werden zu Pfaden. */
  applyJoint(this: Editor, opt: JointOptions): boolean {
    const r = computeJoint(this.validJointPicks(), opt);
    if (r.error) {
      this.hint = t('Verbindung: {error}', { error: r.error });
      this.emit('tool');
      return false;
    }
    this.snapshot(t('Holzverbindung'));
    for (const [obj, { m, subs }] of r.changes) {
      obj.shape = { kind: 'path', subs: transformSubs(subs, inv(m)) };
      invalidate(obj.shape);
    }
    if (r.added.length) {
      // Neue Teile (Keile) auf dem Layer der ersten Kante
      const first = this.jointPicks[0]?.obj;
      this.doc.objs.push({ id: newId(), m: IDENT, layer: first?.layer ?? this.currentLayer, shape: { kind: 'path', subs: r.added } });
    }
    this.jointPicks = [];
    this.hint = t('Verbindung angelegt: {info}.', { info: r.info });
    this.emit('doc');
    this.emit('sel');
    return true;
  }
}
