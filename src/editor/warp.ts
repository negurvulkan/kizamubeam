// Editor: Verformen (Warp) von Formen, Texten und Bildern.
import { apply, ImageShape, inv, leaves, Mat, mul, Obj, Pt, SubPath, translate } from '../model';
import { addAsset, assetImage, sourceSize } from '../images';
import { transformSubs } from '../importers';
import { loadFont, textToSubs } from '../fonts';
import { shapeSubs } from '../geom';
import { subsBox, warpFn, WarpOptions, warpSubs } from '../warp';
import { t, tn } from '../i18n';
import type { Box } from '../geom';
import type { Editor } from '../editor';

/** Ein Blatt der Auswahl mit Weltmatrix und Kontur in Weltkoordinaten (Bilder: ihr Rahmen) */
interface WarpLeaf {
  leaf: Obj;
  m: Mat;
  subs: SubPath[];
}

/** Bildpunkte je Seite höchstens, Fläche höchstens (Megapixel) für das verformte Bild */
const MAX_SIDE = 8192;
const MAX_PIXELS = 40e6;
/** Gitter, in das ein Bild für die Verformung zerlegt wird (Zellen je Seite) */
const GRID = 48;
/** Zähler der Vorschau: Eine ältere, noch laufende Berechnung überschreibt keine neuere */
let previewRun = 0;

export class EditorWarp {
  /** Konturen der Auswahl in Weltkoordinaten; Texte über ihre Schriftumrisse */
  async warpLeaves(this: Editor, objs: Obj[]): Promise<{ items: WarpLeaf[]; box: Box | null }> {
    const items: WarpLeaf[] = [];
    for (const [leaf, m] of leaves(objs)) {
      let local: SubPath[];
      if (leaf.shape.kind === 'text') {
        const s = leaf.shape;
        local = textToSubs(s, (await loadFont(s.font, s.bold, s.italic)).font);
      } else local = shapeSubs(leaf.shape);
      items.push({ leaf, m, subs: transformSubs(local.filter((sp) => sp.nodes.length), m) });
    }
    return { items, box: subsBox(items.flatMap((it) => it.subs)) };
  }

  /** Vorschau (orange gestrichelt) der verformten Auswahl; null entfernt sie */
  async previewWarp(this: Editor, opt: WarpOptions | null) {
    const run = ++previewRun;
    if (!opt || !this.sel.length) {
      this.offsetPreview = null;
      return this.redraw();
    }
    const { items, box } = await this.warpLeaves(this.sel);
    if (!box || run !== previewRun) return;
    const f = warpFn(opt, box);
    // Für die Vorschau genügt eine gröbere Toleranz
    this.offsetPreview = items.flatMap((it) => warpSubs(it.subs, f, box, 0.1));
    this.redraw();
  }

  /**
   * Auswahl verformen. Formen und Texte werden zu Pfaden aus Bézierkurven, Bilder bekommen neue Bilddaten
   * (außerhalb der Verformung transparent, wird also nicht gelasert). Gruppen bleiben erhalten. Ein Undo-Schritt.
   */
  async warpSel(this: Editor, opt: WarpOptions) {
    const objs = this.sel.slice();
    if (!objs.length) return;
    if (!(await this.guardGen(objs, t('Verformen')))) return;
    const { items, box } = await this.warpLeaves(objs);
    if (!box || box.w <= 0 || box.h <= 0) {
      this.hint = t('Verformen: die Auswahl hat keine Fläche.');
      return this.emit('tool');
    }
    const f = warpFn(opt, box);
    // Bilder zuerst berechnen (asynchron), damit der Undo-Schritt alles auf einmal ändert
    const images = new Map<Obj, Awaited<ReturnType<typeof warpImage>>>();
    for (const it of items) if (it.leaf.shape.kind === 'image') images.set(it.leaf, await warpImage(it.leaf.shape, it.m, f));
    this.snapshot(t('Verformen'));
    let skipped = 0;
    for (const it of items) {
      const { leaf, m } = it;
      const parent = mul(m, inv(leaf.m));
      if (leaf.shape.kind === 'image') {
        const r = images.get(leaf);
        if (!r) {
          skipped++;
          continue;
        }
        leaf.shape = { ...leaf.shape, asset: r.asset, w: r.w, h: r.h, pxW: r.pxW, pxH: r.pxH };
        leaf.m = mul(inv(parent), translate(r.x, r.y));
        continue;
      }
      // Ergebnis in die lokalen Koordinaten des Objekts zurückrechnen, Lage und Gruppen bleiben
      leaf.shape = { kind: 'path', subs: transformSubs(warpSubs(it.subs, f, box), inv(m)) };
      delete leaf.bind;
    }
    for (const o of objs) delete o.bind;
    this.setSel(objs);
    this.hint = skipped ? tn('{n} Bild war noch nicht geladen und blieb unverändert.', '{n} Bilder waren noch nicht geladen und blieben unverändert.', skipped) : '';
    this.emit('doc');
  }
}

/** Affine Abbildung, die das Dreieck s auf das Dreieck d legt (für Canvas setTransform) */
function triAffine(s: Pt[], d: Pt[]): Mat | null {
  const den = (s[1].x - s[0].x) * (s[2].y - s[0].y) - (s[2].x - s[0].x) * (s[1].y - s[0].y);
  if (Math.abs(den) < 1e-12) return null;
  const S: Mat = [s[1].x - s[0].x, s[1].y - s[0].y, s[2].x - s[0].x, s[2].y - s[0].y, s[0].x, s[0].y];
  const D: Mat = [d[1].x - d[0].x, d[1].y - d[0].y, d[2].x - d[0].x, d[2].y - d[0].y, d[0].x, d[0].y];
  return mul(D, inv(S));
}

/**
 * Bild verformen: Das Original wird in ein Gitter aus Dreiecken zerlegt, jedes Dreieck an seine verformte Stelle
 * gezeichnet. Ergebnis achsparallel in Weltkoordinaten (x, y, w, h in mm), etwa in der Auflösung des Originals.
 */
async function warpImage(s: ImageShape, m: Mat, f: (p: Pt) => Pt) {
  const img = assetImage(s.asset),
    src = sourceSize(s.asset);
  if (!img || !src) return null;
  // Gitterpunkte: Bildpunkte des Originals und verformte Weltlage
  const sp: Pt[] = [],
    wp: Pt[] = [];
  for (let j = 0; j <= GRID; j++)
    for (let i = 0; i <= GRID; i++) {
      sp.push({ x: (i / GRID) * src.w, y: (j / GRID) * src.h });
      wp.push(f(apply(m, (i / GRID) * s.w, (j / GRID) * s.h)));
    }
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of wp) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  // Auflösung wie im Original (Bildpunkte je mm in der Welt)
  const area = Math.abs(s.w * s.h * (m[0] * m[3] - m[1] * m[2])) || 1;
  let k = Math.sqrt((src.w * src.h) / area);
  k = Math.min(k, MAX_SIDE / (x1 - x0), MAX_SIDE / (y1 - y0), Math.sqrt(MAX_PIXELS / ((x1 - x0) * (y1 - y0))));
  const W = Math.max(1, Math.ceil((x1 - x0) * k)),
    H = Math.max(1, Math.ceil((y1 - y0) * k));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const out = wp.map((p) => ({ x: (p.x - x0) * k, y: (p.y - y0) * k }));
  const at = (i: number, j: number) => j * (GRID + 1) + i;
  const draw = (a: number, b: number, cc: number) => {
    const S = [sp[a], sp[b], sp[cc]],
      D = [out[a], out[b], out[cc]];
    const T = triAffine(S, D);
    if (!T) return;
    // Zielfläche etwas vergrößern, damit zwischen den Dreiecken keine Haarrisse bleiben
    const gx = (D[0].x + D[1].x + D[2].x) / 3,
      gy = (D[0].y + D[1].y + D[2].y) / 3;
    ctx.save();
    ctx.beginPath();
    D.forEach((p, i) => {
      const dx = p.x - gx,
        dy = p.y - gy;
      const l = Math.hypot(dx, dy) || 1;
      const q = { x: p.x + (dx / l) * 0.75, y: p.y + (dy / l) * 0.75 };
      if (i) ctx.lineTo(q.x, q.y);
      else ctx.moveTo(q.x, q.y);
    });
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(T[0], T[1], T[2], T[3], T[4], T[5]);
    // Nur den Ausschnitt der Zelle (mit Rand) zeichnen, nicht das ganze Bild
    const bx = Math.max(0, Math.floor(Math.min(S[0].x, S[1].x, S[2].x)) - 2),
      by = Math.max(0, Math.floor(Math.min(S[0].y, S[1].y, S[2].y)) - 2),
      bw = Math.min(src.w, Math.ceil(Math.max(S[0].x, S[1].x, S[2].x)) + 2) - bx,
      bh = Math.min(src.h, Math.ceil(Math.max(S[0].y, S[1].y, S[2].y)) + 2) - by;
    if (bw > 0 && bh > 0) ctx.drawImage(img, bx, by, bw, bh, bx, by, bw, bh);
    ctx.restore();
  };
  for (let j = 0; j < GRID; j++)
    for (let i = 0; i < GRID; i++) {
      draw(at(i, j), at(i + 1, j), at(i + 1, j + 1));
      draw(at(i, j), at(i + 1, j + 1), at(i, j + 1));
    }
  const a = await addAsset(c.toDataURL('image/png'));
  return { asset: a.id, pxW: a.w, pxH: a.h, x: x0, y: y0, w: W / k, h: H / k };
}

