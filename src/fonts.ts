// Schriftdateien laden und Text in Bézierpfade umwandeln.
// Desktop: Systemschriften über Rust (fontdb). Browser: lokale Schriften (falls erlaubt), sonst Roboto als Ersatz.
import opentype from 'opentype.js';
import { Node, SubPath, TextShape } from './model';
import roboto400 from '@fontsource/roboto/files/roboto-latin-400-normal.woff?inline';
import roboto700 from '@fontsource/roboto/files/roboto-latin-700-normal.woff?inline';
import roboto400i from '@fontsource/roboto/files/roboto-latin-400-italic.woff?inline';
import roboto700i from '@fontsource/roboto/files/roboto-latin-700-italic.woff?inline';

const isTauri = () => '__TAURI_INTERNALS__' in window;

export interface LoadedFont {
  font: opentype.Font;
  /** true, wenn die gewünschte Schrift fehlte und Roboto eingesprungen ist */
  fallback: boolean;
}

const cache = new Map<string, Promise<LoadedFont>>();

function dataUrlToBuffer(url: string): ArrayBuffer {
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function fallbackFont(bold: boolean, italic: boolean): Promise<opentype.Font> {
  const url = bold ? (italic ? roboto700i : roboto700) : italic ? roboto400i : roboto400;
  // Im fertigen Build eingebettet (data:), im Entwicklungsserver eine normale URL
  const buf = url.startsWith('data:') ? dataUrlToBuffer(url) : await (await fetch(url)).arrayBuffer();
  return opentype.parse(buf);
}

interface LocalFontData {
  family: string;
  style: string;
  blob(): Promise<Blob>;
}

async function browserLocalFont(family: string, bold: boolean, italic: boolean): Promise<ArrayBuffer | null> {
  const q = (window as unknown as { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
  if (!q) return null;
  try {
    // Nur nutzen, wenn der Zugriff schon erlaubt ist; sonst würde eine Rückfrage den Vorgang blockieren
    const perm = await navigator.permissions.query({ name: 'local-fonts' as PermissionName });
    if (perm.state !== 'granted') return null;
    const faces = (await q()).filter((f) => f.family.toLowerCase() === family.toLowerCase());
    if (!faces.length) return null;
    const want = (bold ? 'bold' : '') + (italic ? 'italic' : '');
    const norm = (s: string) => s.toLowerCase().replace(/regular|normal|oblique|\s/g, (m) => (m === 'oblique' ? 'italic' : ''));
    const face = faces.find((f) => norm(f.style) === want) ?? faces.find((f) => norm(f.style) === '') ?? faces[0];
    return await (await face.blob()).arrayBuffer();
  } catch {
    return null;
  }
}

export function loadFont(family: string, bold: boolean, italic: boolean): Promise<LoadedFont> {
  const key = `${family}|${bold}|${italic}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      let buf: ArrayBuffer | null = null;
      if (isTauri()) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          buf = await invoke<ArrayBuffer>('font_data', { family, bold, italic });
        } catch {
          buf = null;
        }
      } else buf = await browserLocalFont(family, bold, italic);
      if (buf) {
        try {
          return { font: opentype.parse(buf), fallback: false };
        } catch {
          /* z. B. nicht unterstütztes Format */
        }
      }
      return { font: await fallbackFont(bold, italic), fallback: true };
    })();
    cache.set(key, p);
  }
  return p;
}

/** Liste der installierten Schriften (nur Desktop), sonst null. */
export async function systemFonts(): Promise<string[] | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string[]>('list_fonts');
  } catch {
    return null;
  }
}

/**
 * Text in Unterpfade umwandeln (lokale Koordinaten des Textobjekts, mm).
 * Gleiche Anordnung wie die Anzeige: Grundlinie der ersten Zeile bei y = 0, Zeilenhöhe 1,2 × Größe + Zeilenabstand.
 */
export function textToSubs(t: TextShape, font: opentype.Font): SubPath[] {
  const size = t.size;
  const scale = size / font.unitsPerEm;
  const lh = size * 1.2 + t.vSpace;
  const lines = (t.upper ? t.text.toUpperCase() : t.text).split('\n');
  const subs: SubPath[] = [];
  lines.forEach((line, li) => {
    const glyphs = font.stringToGlyphs(line);
    const advances = glyphs.map((g, i) => {
      const kern = i < glyphs.length - 1 ? font.getKerningValue(g, glyphs[i + 1]) : 0;
      return ((g.advanceWidth ?? 0) + kern) * scale + (i < glyphs.length - 1 ? t.hSpace : 0);
    });
    const width = advances.reduce((a, b) => a + b, 0);
    let x = t.align === 'left' ? 0 : t.align === 'center' ? -width / 2 : -width;
    const y = li * lh;
    glyphs.forEach((g, i) => {
      subs.push(...commandsToSubs(g.getPath(x, y, size).commands));
      x += advances[i];
    });
  });
  return subs;
}

function commandsToSubs(cmds: opentype.PathCommand[]): SubPath[] {
  const subs: SubPath[] = [];
  let cur: Node[] | null = null;
  let last = { x: 0, y: 0 };
  const close = (closed: boolean) => {
    if (!cur || cur.length < 2) {
      cur = null;
      return;
    }
    // Endpunkt, der auf dem Startpunkt liegt, mit dem Startknoten verschmelzen
    const a = cur[0],
      b = cur[cur.length - 1];
    if (closed && Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) {
      if (b.cin) a.cin = b.cin;
      cur.pop();
    }
    subs.push({ nodes: cur, closed });
    cur = null;
  };
  for (const c of cmds) {
    switch (c.type) {
      case 'M':
        close(false);
        cur = [{ x: c.x, y: c.y }];
        last = { x: c.x, y: c.y };
        break;
      case 'L':
        cur?.push({ x: c.x, y: c.y });
        last = { x: c.x, y: c.y };
        break;
      case 'Q': {
        if (!cur) break;
        const p0 = last;
        const prev = cur[cur.length - 1];
        prev.cout = { x: p0.x + (2 / 3) * (c.x1 - p0.x), y: p0.y + (2 / 3) * (c.y1 - p0.y) };
        cur.push({ x: c.x, y: c.y, cin: { x: c.x + (2 / 3) * (c.x1 - c.x), y: c.y + (2 / 3) * (c.y1 - c.y) } });
        last = { x: c.x, y: c.y };
        break;
      }
      case 'C': {
        if (!cur) break;
        cur[cur.length - 1].cout = { x: c.x1, y: c.y1 };
        cur.push({ x: c.x, y: c.y, cin: { x: c.x2, y: c.y2 } });
        last = { x: c.x, y: c.y };
        break;
      }
      case 'Z':
        close(true);
        break;
    }
  }
  close(false);
  return subs;
}
