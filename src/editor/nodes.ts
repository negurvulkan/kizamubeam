// Editor: Knotenbearbeitung.
import { apply, inv, Node, Obj, Pt, SubPath } from '../model';
import { bezierPt, segments, shapeSubs } from '../geom';
import { t, tn } from '../i18n';
import type { Editor } from '../editor';

export class EditorNodes {
  nodeTarget(this: Editor): Obj | null {
    if (this.sel.length !== 1) return null;
    const o = this.sel[0];
    return o.shape.kind === 'group' || o.shape.kind === 'text' || o.shape.kind === 'image' || o.shape.kind === 'barcode' ? null : o;
  }

  updateNodeHover(this: Editor, sx: number, sy: number) {
    const o = this.nodeTarget();
    const prevN = JSON.stringify(this.nodeHover),
      prevS = JSON.stringify(this.segHover);
    this.nodeHover = this.segHover = null;
    if (o) {
      const subs = shapeSubs(o.shape);
      const scr = (p: Pt) => this.toScreen(apply(o.m, p.x, p.y));
      let best = 7;
      subs.forEach((sp, si) =>
        sp.nodes.forEach((n, ni) => {
          for (const which of ['p', 'cin', 'cout'] as const) {
            const p = which === 'p' ? n : n[which];
            if (!p) continue;
            const q = scr(p);
            const dd = Math.hypot(q.x - sx, q.y - sy) - (which === 'p' ? 1 : 0);
            if (dd < best) {
              best = dd;
              this.nodeHover = { sub: si, idx: ni, which };
            }
          }
        }),
      );
      if (!this.nodeHover) {
        let bestS = 6;
        subs.forEach((sp, si) =>
          segments(sp).forEach((sg, gi) => {
            for (let i = 0; i <= 32; i++) {
              const t = i / 32;
              const p = sg.curve ? bezierPt(sg.a, sg.c1, sg.c2, sg.b, t) : { x: sg.a.x + (sg.b.x - sg.a.x) * t, y: sg.a.y + (sg.b.y - sg.a.y) * t };
              const q = scr(p);
              const dd = Math.hypot(q.x - sx, q.y - sy);
              if (dd < bestS) {
                bestS = dd;
                this.segHover = { sub: si, seg: gi, t };
              }
            }
          }),
        );
      }
    }
    this.canvas.style.cursor = this.nodeHover ? 'move' : this.segHover ? 'pointer' : 'crosshair';
    if (prevN !== JSON.stringify(this.nodeHover) || prevS !== JSON.stringify(this.segHover)) this.redraw();
  }

  pathTarget(this: Editor): SubPath[] | null {
    const o = this.nodeTarget();
    if (!o) return null;
    this.convertObjToPath(o);
    return (o.shape as { subs: SubPath[] }).subs;
  }

  /** Knotenauswahl des Ziels; wechselt das Ziel, beginnt sie leer. */
  nodeSelection(this: Editor, o: Obj | null): Set<string> {
    if (o !== this.nodeSelObj) {
      this.nodeSel = new Set();
      this.nodeSelObj = o;
    }
    return this.nodeSel;
  }

  /** Ausgewählte Knoten (nur gültige Indizes) */
  selectedNodes(this: Editor, o: Obj | null = this.nodeTarget()): { sub: number; idx: number }[] {
    if (!o) return [];
    const subs = shapeSubs(o.shape);
    return [...this.nodeSelection(o)]
      .map((k) => k.split(':').map(Number))
      .filter(([s, i]) => subs[s] && i < subs[s].nodes.length)
      .map(([sub, idx]) => ({ sub, idx }));
  }

  selectAllNodes(this: Editor) {
    const o = this.nodeTarget();
    if (!o) return;
    const sel = this.nodeSelection(o);
    shapeSubs(o.shape).forEach((sp, si) => sp.nodes.forEach((_, ni) => sel.add(`${si}:${ni}`)));
    this.emit('sel');
  }

  clearNodeSel(this: Editor) {
    this.nodeSel.clear();
    this.emit('sel');
  }

  /** Knoten, auf die ein Knotenbefehl wirkt: Auswahl, sonst der Knoten unter dem Mauszeiger */
  nodesToEdit(this: Editor, o: Obj): { sub: number; idx: number }[] {
    const sel = this.selectedNodes(o);
    if (sel.length) return sel;
    return this.nodeHover && this.nodeHover.which === 'p' ? [{ sub: this.nodeHover.sub, idx: this.nodeHover.idx }] : [];
  }

  /** Segmente, auf die ein Segmentbefehl wirkt: zwischen zwei ausgewählten Knoten, sonst die Kante unter dem Mauszeiger */
  segmentsToEdit(this: Editor, o: Obj) {
    const subs = shapeSubs(o.shape);
    const sel = this.nodeSelection(o);
    const out: { sub: number; seg: number; curve: boolean }[] = [];
    if (sel.size >= 2)
      subs.forEach((sp, si) =>
        segments(sp).forEach((sg, gi) => {
          if (sel.has(`${si}:${sg.ia}`) && sel.has(`${si}:${sg.ib}`)) out.push({ sub: si, seg: gi, curve: sg.curve });
        }),
      );
    if (!out.length && this.segHover) {
      const { sub, seg } = this.segHover;
      out.push({ sub, seg, curve: segments(subs[sub])[seg].curve });
    }
    return out;
  }

  /** Ausgewählte Knoten löschen (oder den Knoten/Anfasser unter dem Mauszeiger) */
  deleteNodes(this: Editor) {
    const o = this.nodeTarget();
    if (!o) return;
    const h = this.nodeHover;
    const handle = !this.selectedNodes(o).length && h && h.which !== 'p' ? h : null;
    const targets = handle ? [] : this.nodesToEdit(o);
    if (!handle && !targets.length) {
      this.hint = t('Erst Knoten auswählen (Klick, Shift+Klick oder Rahmen).');
      this.emit('tool');
      return;
    }
    this.snapshot(t('Knoten löschen'));
    const subs = this.pathTarget()!;
    if (handle) {
      const n = subs[handle.sub].nodes[handle.idx];
      delete n[handle.which as 'cin' | 'cout'];
      n.smooth = false;
    } else {
      // von hinten nach vorn entfernen, damit die Indizes gültig bleiben
      targets.sort((a, b) => b.sub - a.sub || b.idx - a.idx);
      for (const t of targets) subs[t.sub].nodes.splice(t.idx, 1);
      for (let i = subs.length - 1; i >= 0; i--) {
        const sp = subs[i];
        if (sp.nodes.length < 2) subs.splice(i, 1);
        else if (sp.closed && sp.nodes.length < 3) sp.closed = false;
      }
    }
    this.nodeSel.clear();
    this.nodeHover = this.segHover = null;
    if (!subs.length) {
      this.doc.objs = this.doc.objs.filter((x) => x !== o);
      this.setSel([]);
    }
    this.touch(o.shape);
    this.emit('doc');
    this.emit('sel');
  }

  insertNode(this: Editor) {
    const o = this.nodeTarget();
    const h = this.segHover;
    if (!o || !h) return;
    this.snapshot(t('Knoten einfügen'));
    const sp = this.pathTarget()![h.sub];
    const sg = segments(sp)[h.seg];
    const u = h.t;
    const lerp = (p: Pt, q: Pt) => ({ x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u });
    let n: Node;
    if (sg.curve) {
      const p01 = lerp(sg.a, sg.c1), p12 = lerp(sg.c1, sg.c2), p23 = lerp(sg.c2, sg.b);
      const p012 = lerp(p01, p12), p123 = lerp(p12, p23), p = lerp(p012, p123);
      sg.a.cout = p01;
      sg.b.cin = p23;
      n = { x: p.x, y: p.y, cin: p012, cout: p123, smooth: true };
    } else n = lerp(sg.a, sg.b);
    sp.nodes.splice(sg.ia + 1, 0, n);
    this.segHover = null;
    // Indizes haben sich verschoben: der neue Knoten ist ausgewählt
    const sel = this.nodeSelection(o);
    sel.clear();
    sel.add(`${h.sub}:${sg.ia + 1}`);
    this.touch(o.shape);
    this.emit('doc');
    this.emit('sel');
  }

  /** Segmente in Geraden (curve = false) oder Kurven umwandeln */
  setSegmentType(this: Editor, curve: boolean) {
    const o = this.nodeTarget();
    if (!o) return;
    const segs = this.segmentsToEdit(o).filter((sg) => sg.curve !== curve);
    if (!segs.length) {
      this.hint = this.segmentsToEdit(o).length
        ? curve ? t('Segment ist schon eine Kurve.') : t('Segment ist schon eine Gerade.')
        : t('Zwei benachbarte Knoten auswählen oder auf eine Kante zeigen.');
      this.emit('tool');
      return;
    }
    this.snapshot(t('Segmenttyp ändern'));
    // Umwandeln in einen Pfad erhält die Reihenfolge der Knoten, die Indizes bleiben gültig
    const subs = this.pathTarget()!;
    for (const s of segs) {
      const sg = segments(subs[s.sub])[s.seg];
      if (curve) {
        const dx = (sg.b.x - sg.a.x) / 3,
          dy = (sg.b.y - sg.a.y) / 3;
        sg.a.cout = { x: sg.a.x + dx, y: sg.a.y + dy };
        sg.b.cin = { x: sg.b.x - dx, y: sg.b.y - dy };
      } else {
        delete sg.a.cout;
        delete sg.b.cin;
      }
      sg.a.smooth = false;
      sg.b.smooth = false;
    }
    this.hint = curve
      ? tn('{n} Segment in Kurve umgewandelt.', '{n} Segmente in Kurven umgewandelt.', segs.length)
      : tn('{n} Segment in Gerade umgewandelt.', '{n} Segmente in Geraden umgewandelt.', segs.length);
    this.touch(o.shape);
    this.emit('doc');
    this.emit('tool');
  }

  /** Knoten zu Ecke (ohne Anfasser) oder glattem Knoten machen */
  setNodeType(this: Editor, smooth: boolean) {
    const o = this.nodeTarget();
    if (!o) return;
    const targets = this.nodesToEdit(o);
    if (!targets.length) {
      this.hint = t('Erst Knoten auswählen (Klick, Shift+Klick oder Rahmen).');
      this.emit('tool');
      return;
    }
    this.snapshot(t('Knotentyp ändern'));
    const subs = this.pathTarget()!;
    for (const h of targets) {
      const sp = subs[h.sub];
      const n = sp.nodes[h.idx];
      if (!smooth) {
        delete n.cin;
        delete n.cout;
        n.smooth = false;
        continue;
      }
      const N = sp.nodes.length;
      const prev = h.idx > 0 ? sp.nodes[h.idx - 1] : sp.closed ? sp.nodes[N - 1] : null;
      const next = h.idx < N - 1 ? sp.nodes[h.idx + 1] : sp.closed ? sp.nodes[0] : null;
      const a = prev ?? n,
        b = next ?? n;
      const dx = b.x - a.x,
        dy = b.y - a.y,
        l = Math.hypot(dx, dy) || 1;
      const ux = dx / l,
        uy = dy / l;
      if (prev) {
        const lp = Math.hypot(n.x - prev.x, n.y - prev.y) / 3;
        n.cin = { x: n.x - ux * lp, y: n.y - uy * lp };
      }
      if (next) {
        const ln = Math.hypot(next.x - n.x, next.y - n.y) / 3;
        n.cout = { x: n.x + ux * ln, y: n.y + uy * ln };
      }
      n.smooth = true;
    }
    this.touch(o.shape);
    this.emit('doc');
  }

  /** Ausgewählte Knoten mit den Pfeiltasten verschieben (Weltabstand in mm) */
  nudgeNodes(this: Editor, dx: number, dy: number) {
    const o = this.nodeTarget();
    const targets = o ? this.selectedNodes(o) : [];
    if (!o || !targets.length) return false;
    this.snapshot(t('Knoten verschieben'));
    const subs = this.pathTarget()!;
    const im = inv(o.m);
    const p0 = apply(im, 0, 0),
      p1 = apply(im, dx, dy);
    const lx = p1.x - p0.x,
      ly = p1.y - p0.y;
    const sh = (p?: Pt) => p && ((p.x += lx), (p.y += ly));
    for (const t of targets) {
      const n = subs[t.sub].nodes[t.idx];
      n.x += lx;
      n.y += ly;
      sh(n.cin);
      sh(n.cout);
    }
    this.touch(o.shape);
    this.emit('doc');
    return true;
  }
}
