// Editor: Bilder und Import.
import { DEFAULT_ADJUST, IDENT, ImageAdjust, ImageLayer, ImageShape, inv, leaves, Mat, mul, newId, Obj, Pt, SubPath, translate } from '../model';
import { addAsset, adjustedGray, assetImage, sourceSize } from '../images';
import { ImportResult, transformSubs } from '../importers';
import { traceGray, TraceOptions } from '../trace';
import { bezierPt, boundsOf, segments, shapeSubs, subsToPath2D, textOutline } from '../geom';
import { dec, t, tn } from '../i18n';
import type { Editor } from '../editor';

export class EditorImages {
  selImages(this: Editor): Obj[] {
    return this.sel.filter((o) => o.shape.kind === 'image');
  }
  /** Bild-Einstellungen eines Layers ändern (live ohne Undo-Schritt, wenn snapshot = false) */
  updateImgLayer(this: Editor, i: number, patch: Partial<ImageLayer>, snapshot = true) {
    if (snapshot) this.snapshot(t('Bild-Einstellungen'));
    Object.assign(this.imgLayer(i), patch);
    this.emit('doc');
  }
  /** Bildanpassungen setzen (live ohne Undo-Schritt, wenn snapshot = false) */
  setImageAdjust(this: Editor, objs: Obj[], patch: Partial<ImageAdjust>, snapshot = true) {
    if (!objs.length) return;
    if (snapshot) this.snapshot(t('Bild anpassen'));
    for (const o of objs) if (o.shape.kind === 'image') o.shape.adjust = { ...o.shape.adjust, ...patch };
    this.emit('doc');
  }

  /**
   * Bild mit den übrigen gewählten Formen zuschneiden (auf deren Rahmen) oder maskieren (nur das Innere der
   * geschlossenen Formen bleibt, der Rest wird transparent und damit nicht gelasert), wie in LightBurn.
   * Das Bild bekommt neue Bilddaten in Originalauflösung und bleibt an seiner Stelle; die Formen werden entfernt,
   * damit sie nicht versehentlich mitgeschnitten werden. Ein Undo-Schritt.
   */
  async cropImageSel(this: Editor, mask: boolean) {
    const imgs = this.selImages();
    const shapes = this.sel.filter((o) => o.shape.kind !== 'image');
    const say = (msg: string) => {
      this.hint = msg;
      this.emit('tool');
    };
    if (imgs.length !== 1 || !shapes.length)
      return say(mask ? t('Für die Maske ein Bild und eine oder mehrere geschlossene Formen auswählen.') : t('Zum Zuschneiden ein Bild und eine Form darüber auswählen.'));
    const o = imgs[0],
      s = o.shape as ImageShape;
    const img = assetImage(s.asset),
      src = sourceSize(s.asset);
    if (!img || !src) return say(t('Das Bild ist noch nicht geladen.'));
    // Welt → Bildpunkte des Originals
    const toPx = mul([src.w / s.w, 0, 0, src.h / s.h, 0, 0], inv(o.m));
    const subs: SubPath[] = [];
    for (const sh of shapes)
      for (const [leaf, m] of leaves([sh])) {
        const local = leaf.shape.kind === 'text' ? textOutline(leaf.shape)?.subs ?? [] : leaf.shape.kind === 'image' ? [] : shapeSubs(leaf.shape);
        subs.push(...transformSubs(local.filter((sp) => sp.nodes.length > 1 && (sp.closed || !mask)), mul(toPx, m)));
      }
    if (!subs.length) return say(mask ? t('Die gewählten Formen sind nicht geschlossen.') : t('Die gewählten Formen haben keine Kontur.'));
    // Rahmen der Formen (Kurven abgetastet), begrenzt auf das Bild
    let bx0 = Infinity,
      by0 = Infinity,
      bx1 = -Infinity,
      by1 = -Infinity;
    const add = (p: Pt) => {
      bx0 = Math.min(bx0, p.x);
      by0 = Math.min(by0, p.y);
      bx1 = Math.max(bx1, p.x);
      by1 = Math.max(by1, p.y);
    };
    for (const sp of subs) {
      add(sp.nodes[0]);
      for (const g of segments(sp)) {
        if (!g.curve) add(g.b);
        else for (let i = 1; i <= 32; i++) add(bezierPt(g.a, g.c1, g.c2, g.b, i / 32));
      }
    }
    const x0 = Math.max(0, Math.floor(bx0 + 1e-6)),
      y0 = Math.max(0, Math.floor(by0 + 1e-6)),
      x1 = Math.min(src.w, Math.ceil(bx1 - 1e-6)),
      y1 = Math.min(src.h, Math.ceil(by1 - 1e-6));
    if (x1 - x0 < 1 || y1 - y0 < 1) return say(t('Die Formen liegen nicht über dem Bild.'));
    const c = document.createElement('canvas');
    c.width = x1 - x0;
    c.height = y1 - y0;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, -x0, -y0);
    if (mask) {
      ctx.globalCompositeOperation = 'destination-in';
      ctx.translate(-x0, -y0);
      ctx.fill(subsToPath2D(subs), 'evenodd');
    }
    const a = await addAsset(c.toDataURL('image/png'));
    this.snapshot(t('Bild zuschneiden'));
    const kx = s.w / src.w,
      ky = s.h / src.h;
    o.m = mul(o.m, translate(x0 * kx, y0 * ky));
    o.shape = { ...s, asset: a.id, w: c.width * kx, h: c.height * ky, pxW: a.w, pxH: a.h };
    this.doc.objs = this.doc.objs.filter((x) => !shapes.includes(x));
    this.setSel([o]);
    this.hint = mask
      ? t('Maske angewendet: {w} × {h} Pixel bleiben, die Masken-Formen wurden entfernt (Ctrl+Z macht es rückgängig).', { w: c.width, h: c.height })
      : t('Bild zugeschnitten auf {w} × {h} Pixel, die Form wurde entfernt (Ctrl+Z macht es rückgängig).', { w: c.width, h: c.height });
    this.emit('doc');
  }

  /** Objekte einfügen: liegen sie außerhalb des Betts, werden sie mittig platziert. Mehrere werden gruppiert. */
  placeNew(this: Editor, objs: Obj[], label: string) {
    if (!objs.length) return;
    let o: Obj = objs[0];
    if (objs.length > 1) o = { id: newId(), m: IDENT, layer: objs[0].layer, shape: { kind: 'group', children: objs } };
    const b = boundsOf([o]);
    const bed = this.doc.bed;
    if (b && (b.x < -1e-6 || b.y < -1e-6 || b.x + b.w > bed.w + 1e-6 || b.y + b.h > bed.h + 1e-6))
      o.m = mul(translate(bed.w / 2 - (b.x + b.w / 2), bed.h / 2 - (b.y + b.h / 2)), o.m);
    this.snapshot(t('Objekt hinzufügen'));
    this.doc.objs.push(o);
    this.setTool('select');
    this.setSel([o]);
    this.hint = label;
    this.emit('doc');
  }

  /**
   * Rasterbild einfügen. Größe aus der Auflösung der Datei (sonst 254 DPI = ein Bildpunkt je 0,1-mm-Zeile);
   * zu große Bilder werden auf das Bett verkleinert. Das Bild kommt auf den aktuellen Layer.
   */
  async importImage(this: Editor, dataUrl: string, dpi: number | null, name?: string) {
    const o = await this.imageObj(dataUrl, dpi, name);
    const s = o.shape as ImageShape;
    const shrunk = s.w < (s.pxW / (dpi && dpi > 10 && dpi < 5000 ? dpi : 254)) * 25.4 - 1e-9;
    this.placeNew([o], t(shrunk ? 'Bild importiert: {pxW} × {pxH} Pixel, {w} × {h} mm (auf das Bett verkleinert).' : 'Bild importiert: {pxW} × {pxH} Pixel, {w} × {h} mm.', { pxW: s.pxW, pxH: s.pxH, w: dec(s.w.toFixed(1)), h: dec(s.h.toFixed(1)) }));
  }
  /** Bild-Objekt mittig auf dem Bett auf dem aktuellen Layer, ohne es einzufügen (Größe wie bei importImage) */
  async imageObj(this: Editor, dataUrl: string, dpi: number | null, name?: string): Promise<Obj> {
    const a = await addAsset(dataUrl);
    const res = dpi && dpi > 10 && dpi < 5000 ? dpi : 254;
    let w = (a.w / res) * 25.4,
      h = (a.h / res) * 25.4;
    const bed = this.doc.bed;
    const f = Math.min(1, (bed.w * 0.9) / w, (bed.h * 0.9) / h);
    w *= f;
    h *= f;
    const shape: ImageShape = { kind: 'image', asset: a.id, w, h, pxW: a.w, pxH: a.h, name, adjust: { ...DEFAULT_ADJUST } };
    this.imgLayer(this.currentLayer);
    return { id: newId(), m: translate((bed.w - w) / 2, (bed.h - h) / 2), layer: this.currentLayer, shape };
  }

  /** Rasterbild an fester Stelle einfügen (Weltkoordinaten), z. B. das entzerrte Kamerabild */
  async importImageAt(this: Editor, dataUrl: string, x: number, y: number, w: number, h: number, name: string, hint: string, layer = this.currentLayer) {
    const a = await addAsset(dataUrl);
    const shape: ImageShape = { kind: 'image', asset: a.id, w, h, pxW: a.w, pxH: a.h, name, adjust: { ...DEFAULT_ADJUST } };
    const o: Obj = { id: newId(), m: translate(x, y), layer, shape };
    this.imgLayer(layer);
    this.placeNew([o], hint);
  }

  /** Ergebnis eines Vektor-Imports (SVG/DXF) einfügen */
  async importVectors(this: Editor, res: ImportResult, name: string) {
    const objs = await this.vectorObjs(res, name);
    if (!objs.length) {
      this.hint = t('{name}: keine verwertbaren Formen gefunden. {notes}', { name, notes: res.notes.join(' ') });
      this.emit('tool');
      return;
    }
    const layers = new Set(objs.map((o) => o.layer));
    this.placeNew(objs, `${tn('{name}: {n} Objekt', '{name}: {n} Objekte', objs.length, { name })} ${tn('auf {n} Layer.', 'auf {n} Layern.', layers.size)} ${res.notes.join(' ')}`.trim());
  }

  /** Objekte aus einem Vektor-Import (SVG/DXF), ohne sie einzufügen; Hinweise landen in res.notes */
  async vectorObjs(this: Editor, res: ImportResult, name: string): Promise<Obj[]> {
    const objs: Obj[] = [];
    const flip: Mat = res.yUp ? [1, 0, 0, -1, 0, this.doc.bed.h] : IDENT;
    for (const it of res.items) {
      if (it.kind === 'path') {
        objs.push({ id: newId(), m: IDENT, layer: it.layer, shape: { kind: 'path', subs: transformSubs(it.subs, flip) } });
        continue;
      }
      try {
        const a = await addAsset(it.href);
        const shape: ImageShape = { kind: 'image', asset: a.id, w: 1, h: 1, pxW: a.w, pxH: a.h, adjust: { ...DEFAULT_ADJUST } };
        objs.push({ id: newId(), m: mul(flip, it.m), layer: it.layer, shape });
      } catch {
        res.notes.push(t('Ein eingebettetes Bild ließ sich nicht lesen.'));
      }
    }
    // Übersprungene Elemente bleiben am Objekt vermerkt und erscheinen in „Konstruktion prüfen“
    if (res.notes.length) for (const o of objs) o.importNote = `${name}: ${res.notes.join(' ')}`;
    return objs;
  }
  /** Konturen eines Bildes in Weltkoordinaten (für Vorschau und Übernahme) */
  traceImage(this: Editor, o: Obj, opt: TraceOptions): SubPath[] {
    if (o.shape.kind !== 'image') return [];
    const s = o.shape;
    const src = sourceSize(s.asset);
    if (!src) return [];
    // Auflösung des Originals, höchstens etwa 4 Megapixel
    const f = Math.min(1, Math.sqrt(4e6 / (src.w * src.h)));
    const cols = Math.max(2, Math.round(src.w * f)),
      rows = Math.max(2, Math.round(src.h * f));
    const g = adjustedGray(s, cols, rows);
    if (!g) return [];
    // Bildpunkte → lokale mm → Welt
    const subs = traceGray(g, cols, rows, opt);
    return transformSubs(subs, mul(o.m, [s.w / cols, 0, 0, s.h / rows, 0, 0]));
  }
  /** Vorschau-Konturen (orange gestrichelt) setzen oder entfernen */
  setPreview(this: Editor, subs: SubPath[] | null) {
    this.offsetPreview = subs;
    this.redraw();
  }
  /** Nachgezeichnete Konturen als neues Objekt über dem Bild einfügen */
  commitTrace(this: Editor, o: Obj, subs: SubPath[], deleteImage: boolean) {
    if (!subs.length) return;
    this.snapshot(t('Bild nachzeichnen'));
    const res: Obj = { id: newId(), m: IDENT, layer: o.layer, shape: { kind: 'path', subs } };
    if (deleteImage) this.doc.objs = this.doc.objs.filter((x) => x !== o);
    this.doc.objs.push(res);
    this.setSel([res]);
    this.hint = tn('{n} Kontur nachgezeichnet.', '{n} Konturen nachgezeichnet.', subs.length);
    this.emit('doc');
  }
}
