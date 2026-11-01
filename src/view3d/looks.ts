// Aussehen von Materialien in der 3D-Ansicht: Farbe, Oberflächenstruktur (Holzmaserung, Schiefer …), Glanz,
// Durchsichtigkeit, Farbe der Schnittkante und wie eine Gravur auf dem Material aussieht. Die Texturen werden im
// Programm erzeugt (keine Bilddateien) und sind kachelbar. Ohne DOM, damit sie sich in Node prüfen lassen.
import type { Layer } from '../model';
import { t } from '../i18n';

/** Oberflächenstruktur */
export type TexKind = 'wood' | 'ply' | 'mdf' | 'cork' | 'paper' | 'leather' | 'slate' | 'granite' | 'brushed' | 'plain';

/** Wie eine Gravur auf dem Material aussieht: gebrannt (dunkel), hell (Schiefer, Eloxal) oder milchig (Acryl, Glas) */
export type EngraveStyle = 'burn' | 'light' | 'frost';

export interface LookPreset {
  id: string;
  /** Anzeigename (deutsch, wird mit t() übersetzt) */
  name: string;
  group: 'wood' | 'board' | 'stone' | 'plastic' | 'metal' | 'other';
  tex: TexKind;
  /** Grundfarbe (#rrggbb) */
  color: string;
  /** Stärke der Struktur 0..1 */
  contrast: number;
  /** Rauheit 0 (spiegelnd) .. 1 (matt) */
  rough: number;
  /** Metallisch 0..1 */
  metal: number;
  /** Lichtdurchlässigkeit 0 (deckend) .. 1 (klar) */
  clear: number;
  /** Brechungsindex durchsichtiger Materialien */
  ior: number;
  /** Farbe der gelaserten Schnittkante; null = wie die Fläche */
  edge: string | null;
  engrave: { style: EngraveStyle; color: string; alpha: number };
  /** Kantenlänge einer Texturkachel in mm */
  tile: number;
}

const BURN_DARK = { style: 'burn' as const, color: '#3a2210', alpha: 0.88 };

const P = (p: Partial<LookPreset> & Pick<LookPreset, 'id' | 'name' | 'group' | 'tex' | 'color'>): LookPreset => ({
  contrast: 0.5,
  rough: 0.75,
  metal: 0,
  clear: 0,
  ior: 1.5,
  edge: '#4a2e18',
  engrave: BURN_DARK,
  tile: 120,
  ...p,
});

export const LOOKS: LookPreset[] = [
  P({ id: 'poplar', name: 'Sperrholz Pappel', group: 'wood', tex: 'ply', color: '#e2cfa4', contrast: 0.35, edge: '#5a3b20' }),
  P({ id: 'birch', name: 'Sperrholz Birke', group: 'wood', tex: 'ply', color: '#ecd9b4', contrast: 0.3, edge: '#5e3f22', engrave: { style: 'burn', color: '#3f2512', alpha: 0.85 } }),
  P({ id: 'beech', name: 'Buche', group: 'wood', tex: 'wood', color: '#d9a878', contrast: 0.4, edge: '#4f2f18' }),
  P({ id: 'oak', name: 'Eiche', group: 'wood', tex: 'wood', color: '#c99a62', contrast: 0.65, edge: '#45291a' }),
  P({ id: 'walnut', name: 'Nussbaum', group: 'wood', tex: 'wood', color: '#7a5034', contrast: 0.55, edge: '#2c1a0f', engrave: { style: 'burn', color: '#1e120a', alpha: 0.85 } }),
  P({ id: 'cherry', name: 'Kirsche', group: 'wood', tex: 'wood', color: '#b8744a', contrast: 0.45, edge: '#3e2414', engrave: { style: 'burn', color: '#2a170c', alpha: 0.85 } }),
  P({ id: 'bamboo', name: 'Bambus', group: 'wood', tex: 'wood', color: '#d8b77a', contrast: 0.3, edge: '#5a3a1c', tile: 60 }),
  P({ id: 'mdf', name: 'MDF', group: 'board', tex: 'mdf', color: '#b98e5f', contrast: 0.2, edge: '#3a2414', engrave: { style: 'burn', color: '#2e1a0c', alpha: 0.9 } }),
  P({ id: 'cardboard', name: 'Karton', group: 'board', tex: 'paper', color: '#c49a6a', contrast: 0.3, edge: '#5a3a20', tile: 80 }),
  P({ id: 'paper', name: 'Papier', group: 'board', tex: 'paper', color: '#f3f0e8', contrast: 0.12, edge: '#8a7458', rough: 0.9, tile: 80 }),
  P({ id: 'cork', name: 'Kork', group: 'board', tex: 'cork', color: '#b98a5a', contrast: 0.7, edge: '#4a2f18', rough: 0.95, tile: 60 }),
  P({ id: 'leather', name: 'Leder', group: 'other', tex: 'leather', color: '#8a5a36', contrast: 0.45, edge: '#3a2416', rough: 0.6, engrave: { style: 'burn', color: '#2a170c', alpha: 0.8 }, tile: 60 }),
  P({ id: 'slate', name: 'Schiefer', group: 'stone', tex: 'slate', color: '#3b3f44', contrast: 0.5, edge: null, rough: 0.85, engrave: { style: 'light', color: '#c9ccc9', alpha: 0.9 } }),
  P({ id: 'granite', name: 'Granit', group: 'stone', tex: 'granite', color: '#2b2b2d', contrast: 0.6, edge: null, rough: 0.35, engrave: { style: 'light', color: '#d6d6d2', alpha: 0.85 }, tile: 80 }),
  P({ id: 'acrylic', name: 'Acryl klar', group: 'plastic', tex: 'plain', color: '#e8f2f2', contrast: 0, edge: '#9dbcbc', rough: 0.04, clear: 0.95, ior: 1.49, engrave: { style: 'frost', color: '#eef2f3', alpha: 0.9 } }),
  P({ id: 'acrylic-color', name: 'Acryl farbig', group: 'plastic', tex: 'plain', color: '#d8333a', contrast: 0, rough: 0.05, clear: 0.6, ior: 1.49, edge: '#a0242a', engrave: { style: 'frost', color: '#f4dede', alpha: 0.8 } }),
  P({ id: 'acrylic-opaque', name: 'Acryl deckend', group: 'plastic', tex: 'plain', color: '#1d1f22', contrast: 0, edge: null, rough: 0.08, engrave: { style: 'frost', color: '#e8e8e8', alpha: 0.8 } }),
  P({ id: 'glass', name: 'Glas', group: 'plastic', tex: 'plain', color: '#e2f0e8', contrast: 0, edge: '#8fb8a4', rough: 0.02, clear: 0.95, ior: 1.52, engrave: { style: 'frost', color: '#eef2f0', alpha: 0.9 } }),
  P({ id: 'anodized', name: 'Aluminium eloxiert', group: 'metal', tex: 'brushed', color: '#222428', contrast: 0.25, edge: '#b8bcc2', rough: 0.35, metal: 0.9, engrave: { style: 'light', color: '#e4e6e8', alpha: 0.92 } }),
  P({ id: 'steel', name: 'Edelstahl', group: 'metal', tex: 'brushed', color: '#b9bdc2', contrast: 0.3, edge: null, rough: 0.3, metal: 1, engrave: { style: 'burn', color: '#202226', alpha: 0.85 } }),
  P({ id: 'plain', name: 'Einfarbig', group: 'other', tex: 'plain', color: '#cfc6b8', contrast: 0, edge: null, rough: 0.7, engrave: { style: 'burn', color: '#2a2622', alpha: 0.85 } }),
];

export const LOOK_GROUPS: { id: LookPreset['group']; name: string }[] = [
  { id: 'wood', name: 'Holz' },
  { id: 'board', name: 'Platten und Papier' },
  { id: 'stone', name: 'Stein' },
  { id: 'plastic', name: 'Kunststoff und Glas' },
  { id: 'metal', name: 'Metall' },
  { id: 'other', name: 'Sonstiges' },
];

// i18n-keys-start (Namen der Vorlagen und Gruppen für npm run i18n:check; werden per t(p.name) übersetzt)
export const LOOK_TEXTS = [
  'Sperrholz Pappel',
  'Sperrholz Birke',
  'Buche',
  'Eiche',
  'Nussbaum',
  'Kirsche',
  'Bambus',
  'MDF',
  'Karton',
  'Papier',
  'Kork',
  'Leder',
  'Schiefer',
  'Granit',
  'Acryl klar',
  'Acryl farbig',
  'Acryl deckend',
  'Glas',
  'Aluminium eloxiert',
  'Edelstahl',
  'Einfarbig',
  'Holz',
  'Platten und Papier',
  'Stein',
  'Kunststoff und Glas',
  'Metall',
  'Sonstiges',
];
// i18n-keys-end

/** Aussehen, wie es an einem Layer gespeichert wird */
export interface MaterialLook {
  /** ID einer Vorlage aus LOOKS */
  id: string;
  /** Eigene Grundfarbe (#rrggbb) statt der Farbe der Vorlage */
  color?: string;
}

/** Aussehen für Layer ohne eigenes und ohne erkennbares Bibliotheksmaterial */
export const DEFAULT_LOOK: MaterialLook = { id: 'birch' };

export const lookPreset = (id: string | undefined) => LOOKS.find((l) => l.id === id);
export const lookName = (p: LookPreset) => t(p.name);

const HEX = /^#[0-9a-f]{6}$/i;

/** Gespeichertes Aussehen prüfen; null, wenn die Vorlage unbekannt ist */
export function cleanLook(v: unknown): MaterialLook | undefined {
  const o = v as Partial<MaterialLook> | undefined;
  if (!o || typeof o !== 'object' || !lookPreset(o.id)) return undefined;
  return typeof o.color === 'string' && HEX.test(o.color) ? { id: o.id!, color: o.color.toLowerCase() } : { id: o.id! };
}

/** Vorlage mit eigener Farbe zu den tatsächlichen Werten zusammensetzen */
export function resolveLook(look: MaterialLook): LookPreset {
  const p = lookPreset(look.id) ?? LOOKS[1];
  return look.color && HEX.test(look.color) ? { ...p, color: look.color } : p;
}

/** Stichwörter im Namen eines Bibliotheksmaterials → Vorlage (erste passende Zeile gewinnt) */
const GUESS: [RegExp, string][] = [
  [/schiefer|slate/i, 'slate'],
  [/granit|marmor|stein|stone|marble|fliese/i, 'granite'],
  [/(acryl|acrylic|plexi|pmma|perspex).*(schwarz|weiß|weiss|black|white|deckend|opaque)|(schwarz|weiß|weiss|black|white|deckend|opaque).*(acryl|acrylic|plexi|pmma|perspex)/i, 'acrylic-opaque'],
  [/acryl|acrylic|plexi|pmma|perspex/i, 'acrylic'],
  [/glas(?!faser)|glass/i, 'glass'],
  [/elox|anodi[sz]ed|alu/i, 'anodized'],
  [/edelstahl|stainless|stahl|steel|metall|metal/i, 'steel'],
  [/leder|leather/i, 'leather'],
  [/kork|cork/i, 'cork'],
  [/karton|pappe(?!l)|cardboard/i, 'cardboard'],
  [/papier|paper/i, 'paper'],
  [/mdf|hdf/i, 'mdf'],
  [/bambus|bamboo/i, 'bamboo'],
  [/nuss|walnut/i, 'walnut'],
  [/kirsch|cherry/i, 'cherry'],
  [/eiche|oak/i, 'oak'],
  [/buche|beech/i, 'beech'],
  [/birke|birch/i, 'birch'],
  [/pappel|poplar|sperrholz|plywood|holz|wood/i, 'poplar'],
];

export function guessLook(material: string): MaterialLook | undefined {
  for (const [re, id] of GUESS) if (re.test(material)) return { id };
  return undefined;
}

/**
 * Aussehen eines Layers: eigenes Aussehen, sonst aus dem Namen seines Bibliotheksmaterials geraten, sonst der
 * Standard der 3D-Ansicht. materialName liefert den Namen zur Eintrags-ID des Layers.
 */
export function layerLook(L: Pick<Layer, 'look' | 'material'>, materialName: (id: string) => string | undefined, fallback: MaterialLook): MaterialLook {
  const own = cleanLook(L.look);
  if (own) return own;
  const name = L.material ? materialName(L.material) : undefined;
  return (name && guessLook(name)) || fallback;
}

// ---------- Farben ----------

export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Hellere bzw. dunklere Farbe (k > 1 heller) */
export function shadeHex(hex: string, k: number): string {
  return '#' + hexRgb(hex).map((c) => Math.max(0, Math.min(255, Math.round(c * k))).toString(16).padStart(2, '0')).join('');
}

// ---------- Texturen ----------

/** Pseudozufall aus Gitterpunkt und Saat, 0..1 */
function hash(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Kachelbares Wertrauschen: (u, v) in Kacheln, per = Gitterzellen je Kachel (getrennt für u und v) */
function vnoise(u: number, v: number, pu: number, pv: number, seed: number) {
  const x = u * pu,
    y = v * pv;
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const fx = x - xi,
    fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy);
  const m = (a: number, p: number) => ((a % p) + p) % p;
  const x0 = m(xi, pu),
    x1 = m(xi + 1, pu),
    y0 = m(yi, pv),
    y1 = m(yi + 1, pv);
  const a = hash(x0, y0, seed),
    b = hash(x1, y0, seed),
    c = hash(x0, y1, seed),
    d = hash(x1, y1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Mehrere Oktaven Rauschen, 0..1 */
function fbm(u: number, v: number, pu: number, pv: number, oct: number, seed: number) {
  let s = 0,
    w = 0.5,
    tot = 0;
  for (let o = 0; o < oct; o++) {
    s += vnoise(u, v, pu << o, pv << o, seed + o * 17) * w;
    tot += w;
    w *= 0.5;
  }
  return s / tot;
}

/**
 * Textur einer Vorlage als RGBA (size × size, kachelbar). Die Holzfasern laufen in Richtung u (X der Platte).
 * Liefert außerdem eine Höhenkarte (0..255) für die Oberflächenstruktur.
 */
export function lookTexture(p: LookPreset, size = 512, seed = 1): { rgba: Uint8ClampedArray; height: Uint8ClampedArray } {
  const rgba = new Uint8ClampedArray(size * size * 4);
  const height = new Uint8ClampedArray(size * size);
  const [r0, g0, b0] = hexRgb(p.color);
  const c = p.contrast;
  for (let j = 0; j < size; j++) {
    const v = j / size;
    for (let i = 0; i < size; i++) {
      const u = i / size;
      // shade: Helligkeitsfaktor um 1, hgt: Höhe 0..1
      let shade = 1,
        hgt = 0.5,
        tint = 0;
      switch (p.tex) {
        case 'wood':
        case 'ply': {
          // Jahresringe quer zur Faser, durch Rauschen gewellt und in Faserrichtung gestreckt
          const rings = p.tex === 'ply' ? 7 : 11;
          const warp = fbm(u, v, 2, 4, 3, seed) * (p.tex === 'ply' ? 2.2 : 1.6) + fbm(u, v, 1, 2, 2, seed + 5) * 0.8;
          const ring = (v * rings + warp) % 1;
          // Spätholz: schmales dunkles Band, weich auslaufend
          const late = Math.pow(Math.max(0, Math.sin(ring * Math.PI)), 6);
          // Feine Poren und Fasern entlang u
          const fibre = fbm(u, v, 4, 96, 2, seed + 9) - 0.5;
          const fleck = fbm(u, v, 16, 16, 2, seed + 13) - 0.5;
          shade = 1 - c * (0.38 * late + 0.22 * fibre * -1 + 0.1 * fleck) - c * 0.08;
          tint = late * c * 0.5;
          hgt = 0.5 - late * 0.3 + fibre * 0.4;
          break;
        }
        case 'mdf': {
          const n = fbm(u, v, 32, 32, 3, seed) - 0.5;
          shade = 1 + n * c * 0.6;
          hgt = 0.5 + n * 0.3;
          break;
        }
        case 'paper': {
          const n = fbm(u, v, 24, 24, 4, seed) - 0.5;
          const f = fbm(u, v, 6, 64, 2, seed + 3) - 0.5;
          shade = 1 + (n * 0.6 + f * 0.4) * c;
          hgt = 0.5 + n * 0.4;
          break;
        }
        case 'cork': {
          const n = fbm(u, v, 24, 24, 3, seed);
          const grain = fbm(u, v, 64, 64, 2, seed + 7);
          const spot = n > 0.62 ? (n - 0.62) * 3 : 0;
          shade = 1 - c * (spot * 0.8 + (grain - 0.5) * 0.5);
          tint = spot * 0.4;
          hgt = 0.5 + (grain - 0.5) * 0.8 - spot * 0.3;
          break;
        }
        case 'leather': {
          // Narbung: feine Mulden aus zwei Rauschfrequenzen
          const a = fbm(u, v, 32, 32, 2, seed);
          const b = fbm(u, v, 8, 8, 2, seed + 4);
          const pit = Math.pow(Math.abs(a - 0.5) * 2, 0.6);
          shade = 1 - c * (0.25 * (1 - pit) + (b - 0.5) * 0.4);
          hgt = pit * 0.8 + 0.1;
          break;
        }
        case 'slate': {
          // Schichten in einer Richtung, dazu feines Korn und hellere Adern
          const layer = fbm(u, v, 2, 24, 4, seed);
          const grain = fbm(u, v, 48, 48, 2, seed + 2) - 0.5;
          const vein = Math.pow(1 - Math.abs(fbm(u, v, 3, 6, 3, seed + 8) - 0.5) * 2, 18);
          shade = 1 + c * ((layer - 0.5) * 0.5 + grain * 0.25 + vein * 0.35);
          hgt = 0.5 + (layer - 0.5) * 0.6 + grain * 0.3;
          break;
        }
        case 'granite': {
          const n = hash(Math.floor(u * 160), Math.floor(v * 160), seed);
          const m = fbm(u, v, 12, 12, 3, seed + 1);
          const speck = n > 0.86 ? 1.9 : n < 0.12 ? 0.55 : 1;
          shade = (speck - 1) * c + 1 + (m - 0.5) * 0.3 * c;
          hgt = 0.5;
          break;
        }
        case 'brushed': {
          const n = fbm(u, v, 2, 256, 2, seed) - 0.5;
          shade = 1 + n * c * 0.5;
          hgt = 0.5 + n * 0.3;
          break;
        }
        default:
          break;
      }
      const k = (j * size + i) * 4;
      // tint: Richtung Rot-Braun abdunkeln (Spätholz, Korkflecken)
      rgba[k] = r0 * shade * (1 - tint * 0.15);
      rgba[k + 1] = g0 * shade * (1 - tint * 0.3);
      rgba[k + 2] = b0 * shade * (1 - tint * 0.45);
      rgba[k + 3] = 255;
      height[j * size + i] = Math.max(0, Math.min(1, hgt)) * 255;
    }
  }
  return { rgba, height };
}
