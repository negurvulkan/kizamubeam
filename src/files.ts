// Dateien öffnen/speichern: in Tauri über native Dialoge, im Browser per Download/Dateiauswahl.
import type { Editor } from './editor';
import { IDENT, Obj, visibleLeaves, PALETTE } from './model';
import { boundsOf, subsToD, shapeSubs, textLayout, textOutline } from './geom';
import { assetUrl, processedPng, readDpi } from './images';
import { importDxf, importSvg, ImportResult } from './importers';
import { t } from './i18n';
import { tabNameFromPath } from './editor/tabs';

const isTauri = () => '__TAURI_INTERNALS__' in window;

/** Textdatei speichern; false, wenn der Dialog abgebrochen wurde */
export async function saveText(name: string, filterName: string, ext: string, mime: string, contents: string): Promise<boolean> {
  return (await saveTextAs(name, filterName, ext, mime, contents)) !== null;
}

/** Textdatei speichern; liefert den gewählten Pfad (im Browser den Dateinamen) oder null bei Abbruch */
async function saveTextAs(name: string, filterName: string, ext: string, mime: string, contents: string): Promise<string | null> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string | null>('save_text_file', { defaultName: name, filterName, extensions: [ext], contents });
  }
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

/** Textdatei wählen und lesen; liefert [Dateiname, Inhalt] oder null */
export async function openText(filterName: string, extensions: string[]): Promise<[string, string] | null> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const res = await invoke<[string, string] | null>('open_text_file', { filterName, extensions });
    return res ? [res[0].split(/[\\/]/).pop() ?? res[0], res[1]] : null;
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = extensions.map((e) => '.' + e).join(',');
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? [f.name, await f.text()] : null);
    };
    input.click();
  });
}

/** Projekt des aktiven Tabs speichern; der Tab übernimmt den Dateinamen */
export async function saveProject(ed: Editor) {
  const tab = ed.tab;
  const contents = ed.serialize();
  const saved = ed.tabKey();
  const path = await saveTextAs(`${tab.name ?? t('projekt')}.kzb`, t('KizamuBeam-Projekt'), 'kzb', 'application/json', contents);
  if (path === null) return;
  // Während des Dialogs kann ein anderer Tab aktiv geworden sein
  tab.name = tabNameFromPath(path);
  tab.saved = saved;
  if (tab === ed.tab) ed.updateChanged();
  else tab.changed = false;
  ed.onTabsChange?.();
  ed.scheduleSave();
}

/** Projektdatei in einem neuen Tab öffnen (oder im aktiven, wenn er leer ist) */
export async function openProject(ed: Editor) {
  const apply = (text: string, name: string) => {
    try {
      ed.openInTab(text, tabNameFromPath(name));
    } catch (e) {
      alert(t('Datei konnte nicht geöffnet werden: {message}', { message: (e as Error).message }));
    }
  };
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const res = await invoke<[string, string] | null>('open_text_file', { filterName: t('KizamuBeam-Projekt'), extensions: ['kzb', 'kzt', 'lwk', 'json'] });
    if (res) apply(res[1], res[0]);
    return;
  }
  const input = document.getElementById('fileinput') as HTMLInputElement;
  input.onchange = async () => {
    const f = input.files?.[0];
    input.value = '';
    if (f) apply(await f.text(), f.name);
  };
  input.click();
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * SVG der aktuellen Seite. preview: kleine Vorschau (z. B. für Vorlagen) nur um die Objekte herum, Linien
 * unabhängig von der Größe sichtbar, große Bilder als graue Fläche.
 */
export function buildSvg(ed: Editor, opts: { preview?: boolean } = {}): string {
  const { w, h } = ed.doc.bed;
  const style = (i: number) => {
    const L = ed.layer(i);
    return { show: L.show, fill: L.mode === 'fill' };
  };
  if (opts.preview) return objsPreviewSvg(ed.doc.objs, style);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">\n` +
    objsSvgParts(ed.doc.objs, style, false).parts.join('\n') +
    `\n</svg>\n`
  );
}

type LayerStyle = (layer: number) => { show: boolean; fill: boolean };

/**
 * Kleine SVG-Vorschau nur um die Objekte herum (Vorlagen, Bibliothek). thumbs: verkleinerte Bilder nach
 * Asset-ID; große Bilder ohne verkleinerte Fassung erscheinen als graue Fläche.
 */
export function objsPreviewSvg(objs: Obj[], style: LayerStyle, thumbs: Record<string, string> = {}): string {
  const { parts, box } = objsSvgParts(objs, style, true, thumbs);
  if (!isFinite(box.x0)) return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';
  const pad = Math.max(box.x1 - box.x0, box.y1 - box.y0) * 0.04 + 0.5;
  const vb = [box.x0 - pad, box.y0 - pad, box.x1 - box.x0 + 2 * pad, box.y1 - box.y0 + 2 * pad].map((v) => +v.toFixed(2));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}">${parts.join('')}</svg>`;
}

function objsSvgParts(objs: Obj[], style: LayerStyle, preview: boolean, thumbs: Record<string, string> = {}) {
  const parts: string[] = [];
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const sw = preview ? 'stroke-width="1" vector-effect="non-scaling-stroke"' : 'stroke-width="0.1"';
  for (const [o, m] of visibleLeaves(objs)) {
    const L = style(o.layer);
    if (!L.show) continue;
    if (preview) {
      // m enthält schon die Lage des Objekts
      const b = boundsOf([{ ...o, m: IDENT }], m);
      if (b) {
        box.x0 = Math.min(box.x0, b.x);
        box.y0 = Math.min(box.y0, b.y);
        box.x1 = Math.max(box.x1, b.x + b.w);
        box.y1 = Math.max(box.y1, b.y + b.h);
      }
    }
    const color = PALETTE[o.layer];
    const fill = L.fill ? color : 'none';
    if (o.shape.kind === 'image') {
      const url = thumbs[o.shape.asset] ?? assetUrl(o.shape.asset);
      const tf = `transform="matrix(${m.join(' ')})" width="${o.shape.w}" height="${o.shape.h}"`;
      if (url && preview && url.length > 150_000) parts.push(`<rect ${tf} fill="#bbb"/>`);
      else if (url) parts.push(`<image ${tf} preserveAspectRatio="none" href="${url}"/>`);
      continue;
    }
    if (o.shape.kind === 'text') {
      const t = o.shape;
      const ol = textOutline(t);
      if (ol) {
        parts.push(`<path d="${subsToD(ol.subs, m)}" fill="${fill}" fill-rule="evenodd" stroke="${color}" ${sw}/>`);
        continue;
      }
      const lay = textLayout(t);
      const anchor = t.align === 'left' ? 'start' : t.align === 'center' ? 'middle' : 'end';
      const lines = lay.lines
        .map((ln) => `<tspan x="0" y="${(ln.y * lay.k).toFixed(3)}">${esc(ln.text)}</tspan>`)
        .join('');
      parts.push(
        `<text transform="matrix(${m.join(' ')})" font-family="${esc(t.font)}" font-size="${t.size}" ` +
          `font-weight="${t.bold ? 'bold' : 'normal'}" font-style="${t.italic ? 'italic' : 'normal'}" ` +
          `letter-spacing="${t.hSpace}" text-anchor="${anchor}" fill="${fill === 'none' ? 'none' : color}" ` +
          `stroke="${fill === 'none' ? color : 'none'}" ${sw}>${lines}</text>`,
      );
      continue;
    }
    parts.push(`<path d="${subsToD(shapeSubs(o.shape), m)}" fill="${fill}" fill-rule="evenodd" stroke="${color}" ${sw}/>`);
  }
  return { parts, box };
}

export async function exportSvg(ed: Editor) {
  await saveText('export.svg', 'SVG', 'svg', 'image/svg+xml', buildSvg(ed));
}

// ---------- Import ----------

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp', 'tif', 'tiff'];
/** Was Importieren annimmt; .kza = Eintrag der Bibliothek */
export const IMPORT_EXT = ['svg', 'dxf', ...IMAGE_EXT, 'kza'];
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp', gif: 'image/gif', webp: 'image/webp',
};

function bytesToDataUrl(bytes: Uint8Array, mime: string): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(new Blob([bytes as BlobPart], { type: mime }));
  });
}

type ParsedFile = { kind: 'vectors'; res: ImportResult } | { kind: 'image'; dataUrl: string; dpi: number | null };

/** Dateiinhalt anhand von Endung bzw. Dateikopf lesen; Fehler werden geworfen */
async function parseFile(name: string, bytes: Uint8Array): Promise<ParsedFile> {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
  const head = new TextDecoder().decode(bytes.slice(0, 512)).trimStart();
  if (ext === 'svg' || head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg')))
    return { kind: 'vectors', res: importSvg(new TextDecoder().decode(bytes)) };
  if (ext === 'dxf' || /^\s*0\s*\r?\n\s*SECTION/.test(head)) return { kind: 'vectors', res: importDxf(new TextDecoder().decode(bytes)) };
  if (ext === 'tif' || ext === 'tiff' || isTiff(bytes)) return { kind: 'image', ...(await decodeTiff(bytes)) };
  const mime = MIME[ext] ?? sniffImage(bytes);
  if (!mime) throw new Error(t('Dateiformat wird nicht unterstützt (SVG, DXF, PNG, JPG, BMP, GIF, WebP, TIFF).'));
  return { kind: 'image', dataUrl: await bytesToDataUrl(bytes, mime), dpi: readDpi(bytes) };
}

/** Dateiinhalt anhand von Endung bzw. Dateikopf importieren; Fehler werden geworfen */
export async function importBytesOrThrow(ed: Editor, name: string, bytes: Uint8Array) {
  if (/\.kza$/i.test(name)) {
    const { insertAssetFile } = await import('./libraryPanel');
    await insertAssetFile(ed, new TextDecoder().decode(bytes));
    return;
  }
  const f = await parseFile(name, bytes);
  if (f.kind === 'vectors') await ed.importVectors(f.res, name);
  else await ed.importImage(f.dataUrl, f.dpi, name);
}

/** Datei zu Objekten machen, ohne sie einzufügen (für die Bibliothek); notes: Hinweise des Imports */
export async function fileObjs(ed: Editor, name: string, bytes: Uint8Array): Promise<{ objs: Obj[]; notes: string[] }> {
  const f = await parseFile(name, bytes);
  if (f.kind === 'image') return { objs: [await ed.imageObj(f.dataUrl, f.dpi, name)], notes: [] };
  return { objs: await ed.vectorObjs(f.res, name), notes: f.res.notes };
}

/** Dateiinhalt importieren, Fehler als Meldung */
export async function importBytes(ed: Editor, name: string, bytes: Uint8Array) {
  try {
    await importBytesOrThrow(ed, name, bytes);
  } catch (e) {
    alert(t('{name} konnte nicht importiert werden: {message}', { name, message: (e as Error).message }));
  }
}

const isTiff = (b: Uint8Array) => (b[0] === 0x49 && b[1] === 0x49 && b[2] === 42 && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 42);

/**
 * TIFF lesen (die Webansicht kann es meist nicht) und als PNG weitergeben, damit Projektdatei, Browser und
 * Desktop-App dasselbe Bild sehen. Bei mehrseitigen Dateien zählt die erste Seite. Auflösung aus XResolution.
 */
async function decodeTiff(bytes: Uint8Array): Promise<{ dataUrl: string; dpi: number | null }> {
  const UTIF = (await import('utif')).default;
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  let ifd;
  try {
    ifd = UTIF.decode(buf).find((d) => typeof d.t256 !== 'undefined');
    if (ifd) UTIF.decodeImage(buf, ifd);
  } catch {
    ifd = undefined;
  }
  if (!ifd || !ifd.width || !ifd.height) throw new Error(t('TIFF-Datei konnte nicht gelesen werden.'));
  const rgba = UTIF.toRGBA8(ifd);
  const c = document.createElement('canvas');
  c.width = ifd.width;
  c.height = ifd.height;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(ifd.width, ifd.height);
  img.data.set(rgba.subarray(0, img.data.length));
  ctx.putImageData(img, 0, 0);
  // XResolution (282) je ResolutionUnit (296): 2 = Zoll (Standard), 3 = Zentimeter, 1 = ohne Einheit
  const first = (v: unknown) => (Array.isArray(v) ? Number(v[0]) : NaN);
  const res = first(ifd.t282);
  const unit = first(ifd.t296);
  const dpi = res > 0 && unit !== 1 ? (unit === 3 ? res * 2.54 : res) : null;
  return { dataUrl: c.toDataURL('image/png'), dpi };
}

function sniffImage(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  return null;
}

/** Bilddatei auswählen und als Data-URL lesen (TIFF wird zu PNG); null bei Abbruch, Fehler werden geworfen */
export async function pickImage(): Promise<{ name: string; dataUrl: string } | null> {
  const read = async (name: string, bytes: Uint8Array) => {
    const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
    if (ext === 'tif' || ext === 'tiff' || isTiff(bytes)) return { name, dataUrl: (await decodeTiff(bytes)).dataUrl };
    const mime = MIME[ext] ?? sniffImage(bytes);
    if (!mime) throw new Error(t('Dateiformat wird nicht unterstützt (PNG, JPG, BMP, GIF, WebP, TIFF).'));
    return { name, dataUrl: await bytesToDataUrl(bytes, mime) };
  };
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await invoke<string | null>('pick_file', { filters: [[t('Bilder'), IMAGE_EXT]] });
    if (!path) return null;
    const buf = await invoke<ArrayBuffer>('read_file', { path });
    return read(path.split(/[\\/]/).pop() ?? path, new Uint8Array(buf));
  }
  return new Promise((res, rej) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = IMAGE_EXT.map((e) => '.' + e).join(',');
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return res(null);
      read(f.name, new Uint8Array(await f.arrayBuffer())).then(res, rej);
    };
    input.click();
  });
}

/** Datei > Importieren (Ctrl+I) */
export async function importFile(ed: Editor) {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await invoke<string | null>('pick_file', {
      filters: [
        [t('Alle unterstützten Dateien'), IMPORT_EXT],
        [t('Bilder'), IMAGE_EXT],
        [t('Vektoren (SVG, DXF)'), ['svg', 'dxf']],
        [t('Bibliotheks-Einträge'), ['kza']],
      ],
    });
    if (!path) return;
    const buf = await invoke<ArrayBuffer>('read_file', { path });
    await importBytes(ed, path.split(/[\\/]/).pop() ?? path, new Uint8Array(buf));
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = IMPORT_EXT.map((e) => '.' + e).join(',');
  input.onchange = async () => {
    const f = input.files?.[0];
    if (f) await importBytes(ed, f.name, new Uint8Array(await f.arrayBuffer()));
  };
  input.click();
}

/** Dateien aus dem Dateimanager auf die Arbeitsfläche ziehen; Bilder/SVG aus der Zwischenablage einfügen */
export function installDropAndPaste(ed: Editor, stage: HTMLElement) {
  stage.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });
  stage.addEventListener('drop', async (e) => {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    for (const f of files) {
      if (/\.kzt$/i.test(f.name)) {
        const { useTemplateFile } = await import('./templateDialogs');
        await useTemplateFile(ed, f.name, await f.text());
      } else if (/\.kzp$/i.test(f.name)) {
        const { installPackFile } = await import('./packsDialog');
        await installPackFile(f.name, await f.text());
      } else await importBytes(ed, f.name, new Uint8Array(await f.arrayBuffer()));
    }
  });
  ed.externalPaste = async (data) => {
    const file = [...data.files].find((f) => f.type.startsWith('image/'));
    if (file) {
      await importBytes(ed, file.name || t('Zwischenablage.png'), new Uint8Array(await file.arrayBuffer()));
      return true;
    }
    const text = data.getData('image/svg+xml') || data.getData('text/plain');
    if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(text)) {
      await importBytes(ed, t('Zwischenablage.svg'), new TextEncoder().encode(text));
      return true;
    }
    return false;
  };
}

// ---------- Bearbeitetes Bild speichern ----------

export async function saveDataUrl(name: string, filterName: string, ext: string, dataUrl: string) {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('save_binary_file', { defaultName: name, filterName, extensions: [ext], base64: dataUrl.slice(dataUrl.indexOf(',') + 1) });
    return;
  }
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = name;
  a.click();
}

/** Das gerasterte/geditherte Bild so speichern, wie es gelasert würde */
export async function saveProcessedBitmap(ed: Editor) {
  const o = ed.selImages()[0];
  if (!o || o.shape.kind !== 'image') return;
  const url = await processedPng(o.shape, o.m, ed.imgLayer(o.layer));
  if (url) await saveDataUrl(t('bild-bearbeitet.png'), 'PNG', 'png', url);
}
