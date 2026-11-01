// Schriftliste von Google Fonts lesen, durchsuchen und für ein Projekt fehlende Schriften finden.
// Ohne DOM, damit die Tests in Node laufen (npm run test:fonts). Laden und Speichern: src-tauri/src/fonts.rs,
// Fenster: src/fontManager.ts.
import { allObjs, Doc, Obj } from './model';

export type FontCategory = 'sans' | 'serif' | 'display' | 'handwriting' | 'mono' | 'other';

export interface CatalogFont {
  family: string;
  category: FontCategory;
  /** Schnitte wie bei Google: „400“, „700“, „400i“ … */
  variants: string[];
  subsets: string[];
  /** Rang nach Beliebtheit (1 = am beliebtesten); fehlt, wenn die Quelle keinen kennt */
  popularity?: number;
  designers?: string;
}

const CATEGORY: Record<string, FontCategory> = {
  'sans serif': 'sans', 'sans-serif': 'sans', serif: 'serif', display: 'display', handwriting: 'handwriting', monospace: 'mono',
};
const category = (c: unknown): FontCategory => CATEGORY[String(c ?? '').toLowerCase()] ?? 'other';
const strings = (a: unknown): string[] => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []);

/**
 * Schriftliste lesen. source „google“: Antwort von fonts.google.com/metadata/fonts (beginnt evtl. mit „)]}'“),
 * „fontsource“: Antwort von api.fontsource.org/v1/fonts. Unbrauchbare Einträge fallen weg; Fehler nur bei
 * ganz unlesbarem Text.
 */
export function parseCatalog(source: string, text: string): CatalogFont[] {
  const json: unknown = JSON.parse(text.replace(/^\)\]\}'\s*/, ''));
  const out: CatalogFont[] = [];
  if (source === 'fontsource' || Array.isArray(json)) {
    for (const e of Array.isArray(json) ? json : []) {
      if (!e || typeof e.family !== 'string' || (e.type && e.type !== 'google')) continue;
      const weights = (Array.isArray(e.weights) ? e.weights : []).map(Number).filter((w: number) => w > 0 && w <= 1000);
      const styles = strings(e.styles);
      const variants = weights.flatMap((w: number) => [styles.includes('normal') ? `${w}` : '', styles.includes('italic') ? `${w}i` : ''].filter(Boolean));
      out.push({ family: e.family, category: category(e.category), variants: variants.length ? variants : ['400'], subsets: strings(e.subsets) });
    }
  } else {
    const list = (json as { familyMetadataList?: unknown }).familyMetadataList;
    for (const e of Array.isArray(list) ? list : []) {
      if (!e || typeof e.family !== 'string') continue;
      const variants = Object.keys(e.fonts && typeof e.fonts === 'object' ? e.fonts : {}).filter((v) => /^\d{3}i?$/.test(v));
      const pop = Number(e.popularity);
      out.push({
        family: e.family,
        category: category(e.category),
        variants: variants.length ? variants : ['400'],
        subsets: strings(e.subsets).filter((s) => s !== 'menu'),
        popularity: pop > 0 ? pop : undefined,
        designers: strings(e.designers).join(', ') || undefined,
      });
    }
  }
  return out;
}

/**
 * Welche Schnitte geladen werden: KizamuBeam kennt nur normal/fett und gerade/kursiv. Genommen wird je Fall der
 * nächstliegende vorhandene Schnitt (normal ≈ 400, fett ≈ 700); doppelte fallen weg.
 * Ohne bekannte Schnitte die üblichen vier (fehlende überspringt das Laden).
 */
export function pickVariants(f?: Pick<CatalogFont, 'variants'>): [boolean, number][] {
  if (!f?.variants.length) return [[false, 400], [false, 700], [true, 400], [true, 700]];
  const out: [boolean, number][] = [];
  for (const italic of [false, true]) {
    const ws = f.variants.filter((v) => v.endsWith('i') === italic).map((v) => parseInt(v, 10));
    if (!ws.length) continue;
    const near = (target: number) => ws.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    const regular = near(400);
    out.push([italic, regular]);
    const bold = near(700);
    if (bold !== regular && bold >= 600) out.push([italic, bold]);
  }
  return out;
}

/** Fett/kursiv vorhanden? (für die Liste) */
export function styleInfo(f: CatalogFont) {
  return {
    bold: f.variants.some((v) => parseInt(v, 10) >= 600),
    italic: f.variants.some((v) => v.endsWith('i')),
  };
}

export interface FontFilter {
  query?: string;
  category?: FontCategory | 'all';
  /** Nur diese Namen (Favoriten oder installierte) */
  only?: Set<string>;
  /** Schrift muss diese Schriftsysteme abdecken, z. B. „latin-ext“ */
  subset?: string;
  sort?: 'popular' | 'name';
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Liste filtern und sortieren; Namen, die mit der Suche beginnen, stehen vorne */
export function searchFonts(list: CatalogFont[], f: FontFilter): CatalogFont[] {
  const q = norm(f.query ?? '');
  const only = f.only ? new Set([...f.only].map(norm)) : null;
  const hits = list.filter(
    (x) =>
      (!q || norm(x.family).includes(q) || (!!x.designers && norm(x.designers).includes(q))) &&
      (!f.category || f.category === 'all' || x.category === f.category) &&
      (!only || only.has(norm(x.family))) &&
      (!f.subset || x.subsets.includes(f.subset)),
  );
  const byName = (a: CatalogFont, b: CatalogFont) => a.family.localeCompare(b.family);
  const byPop = (a: CatalogFont, b: CatalogFont) => (a.popularity ?? 1e9) - (b.popularity ?? 1e9) || byName(a, b);
  const starts = (x: CatalogFont) => (q && norm(x.family).startsWith(q) ? 0 : 1);
  return hits.sort((a, b) => starts(a) - starts(b) || (f.sort === 'name' ? byName(a, b) : byPop(a, b)));
}

/** Eintrag zu einem Namen (Groß-/Kleinschreibung egal) */
export function findFont(list: CatalogFont[], family: string): CatalogFont | undefined {
  const n = norm(family);
  return list.find((x) => norm(x.family) === n);
}

/** Alle Schriftfamilien, die Texte im Projekt nutzen (alle Seiten, auch in Gruppen), in Reihenfolge des Auftretens */
export function fontsInDoc(doc: Doc): string[] {
  const out: string[] = [];
  const walk = (o: Obj) => {
    if (o.shape.kind === 'group') o.shape.children.forEach(walk);
    else if (o.shape.kind === 'text' && o.shape.font && !out.includes(o.shape.font)) out.push(o.shape.font);
  };
  allObjs(doc).forEach(walk);
  return out;
}

/** Schriften aus used, die nicht unter installed sind (Groß-/Kleinschreibung egal) */
export function missingFonts(used: string[], installed: string[]): string[] {
  const have = new Set(installed.map(norm));
  return used.filter((f) => !have.has(norm(f)));
}

// ---------- Favoriten und Einstellungen (localStorage, falls vorhanden) ----------

const FAV_KEY = 'kizamubeam.fontFavorites';
const AUTO_KEY = 'kizamubeam.fontAutoInstall';

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function fontFavorites(): string[] {
  try {
    return strings(JSON.parse(store()?.getItem(FAV_KEY) ?? '[]'));
  } catch {
    return [];
  }
}

export function setFontFavorite(family: string, on: boolean) {
  const list = fontFavorites().filter((f) => norm(f) !== norm(family));
  if (on) list.push(family);
  list.sort((a, b) => a.localeCompare(b));
  try {
    store()?.setItem(FAV_KEY, JSON.stringify(list));
  } catch {
    /* kein Speicher */
  }
}

/** Fehlende Schriften beim Öffnen ohne Rückfrage von Google Fonts laden? */
export const autoInstallFonts = () => store()?.getItem(AUTO_KEY) === '1';
export function setAutoInstallFonts(on: boolean) {
  try {
    store()?.setItem(AUTO_KEY, on ? '1' : '0');
  } catch {
    /* kein Speicher */
  }
}
