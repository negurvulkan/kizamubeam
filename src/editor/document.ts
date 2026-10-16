// Editor: Dokument, Rückgängig/Wiederholen, Autosave und Seiten.
import {
  allObjs, bumpIds, cloneObjs, defaultImageLayer, defaultLayer, normalizeLayer, loadDoc, pageName, ImageLayer, Layer, leaves, newDoc, Obj,
  Shape,
} from '../model';
import { assetUrl, registerAsset, restoreAssets } from '../images';
import { invalidate, invalidateText } from '../geom';
import { t } from '../i18n';
import type { Editor } from '../editor';
import { bumpShapeVersion } from './shared';

const SNAPSHOT_LIMIT = 200;
const STORAGE_KEY = 'laserwerk.autosave';

export class EditorDocument {
  layer(this: Editor, i: number): Layer {
    return normalizeLayer((this.doc.layers[i] ??= defaultLayer(i)));
  }
  /** Bild-Einstellungen eines Layers */
  imgLayer(this: Editor, i: number): ImageLayer {
    return (this.layer(i).img ??= defaultImageLayer());
  }
  /** Welche Arten von Objekten liegen auf dem Layer? (Vektoren und Bilder sind getrennte Einträge) */
  layerParts(this: Editor, i: number): { vec: boolean; img: boolean } {
    let vec = false,
      img = false;
    for (const [o] of leaves(this.doc.objs)) {
      if (o.layer !== i) continue;
      if (o.shape.kind === 'image') img = true;
      else vec = true;
    }
    return { vec, img };
  }
  usedLayers(this: Editor): number[] {
    const set = new Set<number>();
    for (const [o] of leaves(this.doc.objs)) set.add(o.layer);
    return [...set].sort((a, b) => a - b);
  }

  state(this: Editor) {
    return JSON.stringify({ doc: this.doc, sel: this.sel.map((o) => o.id) });
  }
  load(this: Editor, json: string) {
    const st = JSON.parse(json);
    this.doc = loadDoc(st.doc);
    bumpIds(allObjs(this.doc));
    const ids = new Set<number>(st.sel ?? []);
    this.sel = this.doc.objs.filter((o) => ids.has(o.id));
    // Gewählte Kanten zeigen auf die alten Objekte
    this.jointPicks = [];
    this.jointHover = null;
  }
  /** Rückgängig/Wiederholen: Zähler und CSV-Daten des variablen Texts gehören nicht zum Verlauf */
  loadKeepVarText(this: Editor, json: string) {
    const vt = this.doc.vt;
    this.load(json);
    if (vt) this.doc.vt = vt;
    else delete this.doc.vt;
    this.touchVarText();
  }
  /**
   * Mehrere Änderungen als einen Undo-Schritt ausführen (z. B. ein Aufruf eines KI-Agenten).
   * Ändert sich nichts, bleibt der Verlauf, wie er war.
   */
  async batch<T>(this: Editor, fn: () => T | Promise<T>): Promise<T> {
    if (this.batching) return fn();
    const before = this.state();
    const redo = this.redo;
    this.snapshot();
    this.batching = true;
    try {
      return await fn();
    } finally {
      this.batching = false;
      if (this.state() === before) {
        this.undo.pop();
        this.redo = redo;
      }
    }
  }
  /** Vor jeder Änderung aufrufen. */
  snapshot(this: Editor) {
    if (this.batching) return;
    this.undo.push(this.state());
    if (this.undo.length > SNAPSHOT_LIMIT) this.undo.shift();
    this.redo = [];
  }
  dropSnapshot(this: Editor) {
    if (this.batching) return;
    this.undo.pop();
  }
  doUndo(this: Editor) {
    const s = this.undo.pop();
    if (!s) return;
    this.redo.push(this.state());
    this.loadKeepVarText(s);
    this.emit('doc');
    this.emit('sel');
  }
  doRedo(this: Editor) {
    const s = this.redo.pop();
    if (!s) return;
    this.undo.push(this.state());
    this.loadKeepVarText(s);
    this.emit('doc');
    this.emit('sel');
  }
  scheduleSave(this: Editor) {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 500);
  }
  /** Zwischenstand sofort sichern, z. B. vor dem Neuladen der Oberfläche */
  saveNow(this: Editor) {
    clearTimeout(this.saveTimer);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.doc));
    } catch {
      /* Speicher nicht verfügbar */
    }
  }
  restore(this: Editor) {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s) {
        this.doc = loadDoc(JSON.parse(s));
        bumpIds(allObjs(this.doc));
        restoreAssets(this.assetIds());
      }
    } catch {
      this.doc = newDoc();
    }
  }
  /** IDs aller im Dokument verwendeten Bilder */
  assetIds(this: Editor, objs: Obj[] = allObjs(this.doc)): string[] {
    const ids = new Set<string>();
    for (const [o] of leaves(objs)) if (o.shape.kind === 'image') ids.add(o.shape.asset);
    return [...ids];
  }
  /** Projektdatei: Dokument samt Bilddaten */
  serialize(this: Editor) {
    const assets: Record<string, string> = {};
    for (const id of this.assetIds()) {
      const url = assetUrl(id);
      if (url) assets[id] = url;
    }
    return JSON.stringify(Object.keys(assets).length ? { ...this.doc, assets } : this.doc, null, 1);
  }
  openDoc(this: Editor, json: string) {
    const d = loadDoc(JSON.parse(json));
    if (d.assets) for (const [id, url] of Object.entries(d.assets)) registerAsset(id, url);
    delete d.assets;
    restoreAssets(this.assetIds(allObjs(d)));
    this.snapshot();
    this.clearPageState();
    this.doc = d;
    bumpIds(allObjs(d));
    this.zoomPage();
    this.emit('doc');
    this.emit('sel');
  }
  newDocument(this: Editor) {
    this.snapshot();
    this.clearPageState();
    const bed = this.doc.bed;
    this.doc = newDoc();
    this.doc.bed = { ...bed };
    this.emit('doc');
    this.emit('sel');
  }

  // Seiten

  /** Beim Wechsel der Seite: Auswahl und alles, was auf Objekte der alten Seite zeigt, verwerfen */
  clearPageState(this: Editor) {
    if (this.drag) this.cancelDrag();
    if (this.draft) this.finishLine();
    this.sel = [];
    this.pivot = null;
    this.rotateMode = false;
    this.nodeSel.clear();
    this.nodeSelObj = null;
    this.nodeHover = this.segHover = null;
    this.jointPicks = [];
    this.jointHover = null;
    this.clearSnap();
  }
  /** Zur Seite i wechseln (kein eigener Undo-Schritt) */
  setPage(this: Editor, i: number) {
    i = Math.max(0, Math.min(this.doc.pages.length - 1, i));
    if (i === this.doc.page) return;
    this.clearPageState();
    this.doc.page = i;
    this.emit('doc');
    this.emit('sel');
  }
  /** Neue leere Seite hinter der aktuellen (oder an Stelle at) anlegen und zu ihr wechseln */
  addPage(this: Editor, name?: string, at = this.doc.page + 1): number {
    this.snapshot();
    at = Math.max(0, Math.min(this.doc.pages.length, at));
    this.doc.pages.splice(at, 0, { name: name?.trim() || this.freePageName(), objs: [] });
    this.clearPageState();
    this.doc.page = at;
    this.emit('doc');
    this.emit('sel');
    return at;
  }
  /** Seite i samt Objekten (mit neuen IDs) dahinter kopieren und zu ihr wechseln */
  duplicatePage(this: Editor, i = this.doc.page): number {
    const src = this.doc.pages[i];
    if (!src) return -1;
    this.snapshot();
    this.doc.pages.splice(i + 1, 0, { name: t('{name} (Kopie)', { name: src.name }), objs: cloneObjs(src.objs) });
    this.clearPageState();
    this.doc.page = i + 1;
    this.emit('doc');
    this.emit('sel');
    return i + 1;
  }
  /** Seite i löschen; die letzte Seite bleibt immer stehen */
  deletePage(this: Editor, i = this.doc.page) {
    if (this.doc.pages.length < 2 || !this.doc.pages[i]) return;
    this.snapshot();
    this.doc.pages.splice(i, 1);
    const cur = this.doc.page;
    this.clearPageState();
    this.doc.page = Math.min(cur > i ? cur - 1 : cur, this.doc.pages.length - 1);
    this.emit('doc');
    this.emit('sel');
  }
  renamePage(this: Editor, i: number, name: string) {
    const p = this.doc.pages[i];
    name = name.trim();
    if (!p || !name || name === p.name) return;
    this.snapshot();
    p.name = name;
    this.emit('doc');
  }
  /** Seite from an die Stelle to schieben (Index nach dem Herausnehmen) */
  movePage(this: Editor, from: number, to: number) {
    const n = this.doc.pages.length;
    if (from === to || from < 0 || from >= n || to < 0 || to >= n) return;
    this.snapshot();
    const cur = this.doc.pages[this.doc.page];
    const [p] = this.doc.pages.splice(from, 1);
    this.doc.pages.splice(to, 0, p);
    this.doc.page = this.doc.pages.indexOf(cur);
    this.emit('doc');
  }
  /** Oberste Objekte der aktuellen Seite auf Seite i verschieben (vor alle Objekte dort) */
  moveToPage(this: Editor, objs: Obj[], i: number) {
    const target = this.doc.pages[i];
    const moving = this.doc.objs.filter((o) => objs.includes(o));
    if (!target || i === this.doc.page || !moving.length) return;
    this.snapshot();
    this.doc.objs = this.doc.objs.filter((o) => !moving.includes(o));
    target.objs.push(...moving);
    this.setSel(this.sel.filter((o) => !moving.includes(o)));
    this.emit('doc');
  }
  freePageName(this: Editor): string {
    const used = new Set(this.doc.pages.map((p) => p.name));
    for (let n = this.doc.pages.length; ; n++) if (!used.has(pageName(n))) return pageName(n);
  }
  /** Form wurde direkt verändert: Zwischenspeicher leeren. */
  touch(this: Editor, s: Shape) {
    invalidate(s);
    bumpShapeVersion(s);
    if (s.kind === 'text') invalidateText(s);
  }
}
