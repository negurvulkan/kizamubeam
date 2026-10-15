// Dateien öffnen/speichern: in Tauri über native Dialoge, im Browser per Download/Dateiauswahl.
import type { Editor } from './editor';
import { leaves, PALETTE } from './model';
import { subsToD, shapeSubs, textLayout } from './geom';

const isTauri = () => '__TAURI_INTERNALS__' in window;

async function saveText(name: string, filterName: string, ext: string, mime: string, contents: string) {
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

export async function saveProject(ed: Editor) {
  await saveText('projekt.lwk', 'Laserwerk-Projekt', 'lwk', 'application/json', ed.serialize());
}

export async function openProject(ed: Editor) {
  const apply = (text: string) => {
    try {
      ed.openDoc(text);
    } catch (e) {
      alert(`Datei konnte nicht geöffnet werden: ${(e as Error).message}`);
    }
  };
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const res = await invoke<[string, string] | null>('open_text_file', { filterName: 'Laserwerk-Projekt', extensions: ['lwk', 'json'] });
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
    if (o.shape.kind === 'text') {
      const t = o.shape;
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
