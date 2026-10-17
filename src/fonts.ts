// Schriftdateien laden und Text in Bézierpfade umwandeln.
// Desktop: Systemschriften über Rust (fontdb). Browser: lokale Schriften (falls erlaubt), sonst Roboto als Ersatz.
import opentype from 'opentype.js';
import { Node, SubPath, TextShape } from './model';
import { PlacedGlyph, placeOnPath } from './textpath';
import { weldGlyphs } from './clip';
import { shownText } from './vartext';
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
/** Bereits geladene Schriften für synchronen Zugriff beim Zeichnen */
const ready = new Map<string, LoadedFont>();
const fontKey = (family: string, bold: boolean, italic: boolean) => `${family}|${bold}|${italic}`;

/** Schrift, falls schon geladen; sonst null (und das Laden beginnt). */
export function loadedFont(family: string, bold: boolean, italic: boolean): LoadedFont | null {
  const f = ready.get(fontKey(family, bold, italic));
  if (!f) void loadFont(family, bold, italic);
  return f ?? null;
}

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
  const key = fontKey(family, bold, italic);
  let p = cache.get(key);
  if (!p) {
    p = (async (): Promise<LoadedFont> => {
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
    })().then((f) => {
      ready.set(key, f);
      fontListeners.forEach((cb) => cb());
      return f;
    });
    cache.set(key, p);
  }
  return p;
}

const fontListeners: (() => void)[] = [];
/** Wird aufgerufen, sobald eine weitere Schrift geladen ist */
export function onFontLoaded(cb: () => void) {
  fontListeners.push(cb);
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
  t = fitText(t, font);
  const scale = t.size / font.unitsPerEm;
  const glyphs: PlacedGlyph[] = [];
  for (const ln of textLines(t, font))
    ln.glyphs.forEach((g, i) => {
      const subs = commandsToSubs(g.getPath(ln.xs[i], ln.y, t.size).commands);
      // Gestauchte Zeile (Höchstbreite): Glyphe um ihren Anfang waagerecht zusammenschieben
      if (ln.sx !== 1) for (const sp of subs) for (const n of sp.nodes) squeezeNode(n, ln.xs[i], ln.sx);
      if (subs.length) glyphs.push({ subs, cx: ln.xs[i] + ((g.advanceWidth ?? 0) * scale * ln.sx) / 2, y: ln.y });
    });
  // Text auf Pfad: jede Glyphe für sich auf die Kurve setzen
  const placed = t.path && t.path.sub.nodes.length > 1 ? placeOnPath(glyphs, t.path, t.align) : glyphs.map((g) => g.subs);
  return t.weld ? weldGlyphs(placed) : placed.flat();
}

function squeezeNode(n: Node, x0: number, sx: number) {
  n.x = x0 + (n.x - x0) * sx;
  if (n.cin) n.cin.x = x0 + (n.cin.x - x0) * sx;
  if (n.cout) n.cout.x = x0 + (n.cout.x - x0) * sx;
}

/**
 * Zeilen mit Glyphen und deren x-Positionen (mm); x/w ist die Zeilenbreite nach Vorschub.
 * sx < 1: Die Zeile ist breiter als die Höchstbreite und wird um diesen Faktor gestaucht.
 */
export function textLines(t: TextShape, font: opentype.Font) {
  return linesOf(fitText(t, font), font);
}

/**
 * Text in Rahmen einpassen: Ist der Block höher als maxH oder (bei fit = shrink) breiter als maxW, wird er mit
 * Schriftgröße und Abständen gleichmäßig verkleinert (nie vergrößert). Sonst bleibt der Text, wie er ist.
 */
export function fitText(t: TextShape, font: opentype.Font): TextShape {
  const byW = t.fit === 'shrink' && !!t.maxW && t.maxW > 0;
  const byH = !!t.maxH && t.maxH > 0;
  if (!byW && !byH) return t;
  const lines = linesOf({ ...t, maxW: undefined }, font);
  const w = Math.max(0, ...lines.map((l) => l.w));
  const h = (lines.length - 1) * (t.size * 1.2 + t.vSpace) + t.size;
  const f = Math.min(1, byW && w > 0 ? t.maxW! / w : 1, byH && h > 0 ? t.maxH! / h : 1);
  if (f >= 1 && !byW) return t;
  const out: TextShape = { ...t, size: t.size * f, hSpace: t.hSpace * f, vSpace: t.vSpace * f };
  // Verkleinert passt die Breite schon; ein Rest durch Rundung wird nicht mehr gestaucht
  if (byW) delete out.maxW;
  return out;
}

function linesOf(t: TextShape, font: opentype.Font) {
  const size = t.size;
  const scale = size / font.unitsPerEm;
  const lh = size * 1.2 + t.vSpace;
  const text = shownText(t);
  const lines = (t.upper ? text.toUpperCase() : text).split('\n');
  return lines.map((line, li) => {
    const glyphs = font.stringToGlyphs(line);
    let advances = glyphs.map((g, i) => {
      const kern = i < glyphs.length - 1 ? font.getKerningValue(g, glyphs[i + 1]) : 0;
      return ((g.advanceWidth ?? 0) + kern) * scale + (i < glyphs.length - 1 ? t.hSpace : 0);
    });
    let w = advances.reduce((a, b) => a + b, 0);
    const sx = t.maxW && t.maxW > 0 && w > t.maxW ? t.maxW / w : 1;
    if (sx !== 1) {
      advances = advances.map((a) => a * sx);
      w = t.maxW!;
    }
    let x = t.align === 'left' ? 0 : t.align === 'center' ? -w / 2 : -w;
    const x0 = x;
    const xs = advances.map((adv) => {
      const cur = x;
      x += adv;
      return cur;
    });
    return { glyphs, xs, x: x0, w, y: li * lh, sx };
  });
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
