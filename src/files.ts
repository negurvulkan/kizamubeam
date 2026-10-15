// Dateien öffnen/speichern: in Tauri über native Dialoge, im Browser per Download/Dateiauswahl.
import type { Editor } from './editor';
import { leaves, PALETTE } from './model';
import { subsToD, shapeSubs, textLayout, textOutline } from './geom';
import { assetUrl, processedPng, readDpi } from './images';
import { importDxf, importSvg } from './importers';
import { t } from './i18n';

const isTauri = () => '__TAURI_INTERNALS__' in window;

export async function saveText(name: string, filterName: string, ext: string, mime: string, contents: string) {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('save_text_file', { defaultName: name, filterName, extensions: [ext], contents });
    return;
  }
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

export async function saveProject(ed: Editor) {
  await saveText('projekt.lwk', t('Laserwerk-Projekt'), 'lwk', 'application/json', ed.serialize());
}

export async function openProject(ed: Editor) {
  const apply = (text: string) => {
    try {
      ed.openDoc(text);
    } catch (e) {
      alert(t('Datei konnte nicht geöffnet werden: {message}', { message: (e as Error).message }));
    }
  };
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const res = await invoke<[string, string] | null>('open_text_file', { filterName: t('Laserwerk-Projekt'), extensions: ['lwk', 'json'] });
    if (res) apply(res[1]);
    return;
  }
  const input = document.getElementById('fileinput') as HTMLInputElement;
  input.onchange = async () => {
    const f = input.files?.[0];
    input.value = '';
    if (f) apply(await f.text());
  };
  input.click();
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildSvg(ed: Editor): string {
  const { w, h } = ed.doc.bed;
  const parts: string[] = [];
  for (const [o, m] of leaves(ed.doc.objs)) {
    const L = ed.layer(o.layer);
    if (!L.show) continue;
    const color = PALETTE[o.layer];
    const fill = L.mode === 'fill' ? color : 'none';
    if (o.shape.kind === 'image') {
      const url = assetUrl(o.shape.asset);
      if (url)
        parts.push(`<image transform="matrix(${m.join(' ')})" width="${o.shape.w}" height="${o.shape.h}" preserveAspectRatio="none" href="${url}"/>`);
      continue;
    }
    if (o.shape.kind === 'text') {
      const t = o.shape;
      const ol = textOutline(t);
      if (ol) {
        parts.push(`<path d="${subsToD(ol.subs, m)}" fill="${fill}" fill-rule="evenodd" stroke="${color}" stroke-width="0.1"/>`);
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
          `stroke="${fill === 'none' ? color : 'none'}" stroke-width="0.1">${lines}</text>`,
      );
      continue;
    }
    parts.push(`<path d="${subsToD(shapeSubs(o.shape), m)}" fill="${fill}" fill-rule="evenodd" stroke="${color}" stroke-width="0.1"/>`);
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">\n` +
    parts.join('\n') +
    `\n</svg>\n`
  );
}

export async function exportSvg(ed: Editor) {
  await saveText('export.svg', 'SVG', 'svg', 'image/svg+xml', buildSvg(ed));
}

// ---------- Import ----------

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'];
const IMPORT_EXT = ['svg', 'dxf', ...IMAGE_EXT];
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

/** Dateiinhalt anhand von Endung bzw. Dateikopf importieren; Fehler werden geworfen */
export async function importBytesOrThrow(ed: Editor, name: string, bytes: Uint8Array) {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
  const head = new TextDecoder().decode(bytes.slice(0, 512)).trimStart();
  if (ext === 'svg' || head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
    await ed.importVectors(importSvg(new TextDecoder().decode(bytes)), name);
    return;
  }
  if (ext === 'dxf' || /^\s*0\s*\r?\n\s*SECTION/.test(head)) {
    await ed.importVectors(importDxf(new TextDecoder().decode(bytes)), name);
    return;
  }
  const mime = MIME[ext] ?? sniffImage(bytes);
  if (!mime) throw new Error(t('Dateiformat wird nicht unterstützt (SVG, DXF, PNG, JPG, BMP, GIF, WebP).'));
  await ed.importImage(await bytesToDataUrl(bytes, mime), readDpi(bytes), name);
}

/** Dateiinhalt importieren, Fehler als Meldung */
export async function importBytes(ed: Editor, name: string, bytes: Uint8Array) {
  try {
    await importBytesOrThrow(ed, name, bytes);
  } catch (e) {
    alert(t('{name} konnte nicht importiert werden: {message}', { name, message: (e as Error).message }));
  }
}

function sniffImage(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  return null;
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
    for (const f of files) await importBytes(ed, f.name, new Uint8Array(await f.arrayBuffer()));
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

async function saveDataUrl(name: string, filterName: string, ext: string, dataUrl: string) {
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
  const url = processedPng(o.shape, o.m, ed.imgLayer(o.layer));
  if (url) await saveDataUrl(t('bild-bearbeitet.png'), 'PNG', 'png', url);
}
