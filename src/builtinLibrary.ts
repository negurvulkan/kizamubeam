// Mitgelieferte Bibliothek: rund 400 Motive und Designelemente, die mit KizamuBeam ausgeliefert werden. Die
// Formen entstehen in scripts/build-library.ts (Quellen in scripts/library/) und liegen als kompakte
// SVG-Pfaddaten in src/library/builtin.json; die Datei wird erst geladen, wenn die Bibliothek gebraucht wird.
// Einträge haben die Kennung „builtin:<id>“ und lassen sich nicht ändern oder löschen.
import type { Obj } from './model';
import { decodeD, f, GROUPS } from './builtinFormat';
export { GROUPS } from './builtinFormat';
import type { AssetData } from './assetFormat';
import { lang, t } from './i18n';

// ---------- Einträge ----------

interface RawItem {
  id: string;
  /** m = Motiv, e = Designelement */
  c: 'm' | 'e';
  g: string;
  n: [string, string];
  /** Stichwörter: gleich in beiden Sprachen oder [deutsch, englisch] */
  t?: (string | [string, string])[];
  w: number;
  h: number;
  d: string;
}

export interface BuiltinAsset {
  key: string;
  asset: AssetData;
}

let loaded: Promise<BuiltinAsset[]> | null = null;
let ready: BuiltinAsset[] | null = null;

const pick = (v: string | [string, string], de: boolean) => (typeof v === 'string' ? v : de ? v[0] : v[1]);

function toAsset(r: RawItem, de: boolean): AssetData {
  const g = GROUPS[r.g];
  const tags = [...(g ? [de ? g.de : g.en] : []), ...(r.t ?? []).map((x) => pick(x, de))];
  // Englische Namen und Stichwörter auch im Deutschen finden (und umgekehrt): als weitere Stichwörter
  const other = [r.n[de ? 1 : 0], ...(r.t ?? []).filter((x) => typeof x !== 'string').map((x) => pick(x, !de))];
  const seen = new Set<string>();
  const allTags = [...tags, ...other].filter((x) => {
    const k = x.toLowerCase();
    if (seen.has(k) || k === r.n[de ? 0 : 1].toLowerCase()) return false;
    seen.add(k);
    return true;
  });
  const preview = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(-r.w * 0.05)} ${f(-r.h * 0.05 - Math.max(0, r.w - r.h) / 2)} ${f(Math.max(r.w, r.h) * 1.1)} ${f(Math.max(r.w, r.h) * 1.1)}"><path d="${r.d}" transform="translate(${f(Math.max(0, r.h - r.w) / 2)} 0)" fill="#3a3a3a" fill-rule="evenodd"/></svg>`;
  return {
    name: de ? r.n[0] : r.n[1],
    category: r.c === 'm' ? 'motif' : 'element',
    tags: allTags.slice(0, 30),
    w: r.w,
    h: r.h,
    preview,
    objs: [],
    images: {},
    fill: [0],
    // Objekte erst beim Einfügen (builtinAsset), damit die Liste schnell bleibt
    ...({ raw: r } as object),
  } as AssetData;
}

/** Alle mitgelieferten Einträge (Objekte noch leer; vollständig über builtinAsset) */
export async function builtinAssets(): Promise<BuiltinAsset[]> {
  if (ready) return ready;
  // Die Sprache wechselt erst nach einem Neustart
  const de = lang === 'de';
  loaded ??= import('./library/builtin.json').then((m) => {
    const raw = ((m as { default?: { items: RawItem[] } }).default ?? (m as unknown as { items: RawItem[] })).items;
    return raw.map((r) => ({ key: `builtin:${r.id}`, asset: toAsset(r, de) }));
  });
  ready = await loaded;
  return ready;
}

/** Schon geladene Einträge (ohne zu laden); leer, solange builtinAssets nicht fertig ist */
export const builtinAssetsNow = (): BuiltinAsset[] => ready ?? [];

/** Vollständiger Eintrag mit Objekten: ein Pfad auf Layer 0, Rahmen bei (0, 0) */
export async function builtinAsset(key: string): Promise<AssetData | null> {
  const list = await builtinAssets();
  const it = list.find((x) => x.key === key);
  if (!it) return null;
  const r = (it.asset as unknown as { raw: RawItem }).raw;
  const obj: Obj = { id: 1, m: [1, 0, 0, 1, 0, 0], layer: 0, shape: { kind: 'path', subs: decodeD(r.d) } };
  const { raw: _r, ...rest } = it.asset as unknown as { raw: RawItem } & AssetData;
  return { ...structuredClone(rest), objs: [obj] };
}

/** Name, unter dem die mitgelieferten Einträge in der Liste erscheinen */
export const builtinSource = () => t('Mitgeliefert');
