// Material-Bibliothek (wie die Material Library in LightBurn): Layer-Einstellungen je Material und Dicke.
// Ein Eintrag hält die Bearbeitungseinstellungen eines Layers und wahlweise die Bild-Einstellungen.
// Gespeichert wird im Browser-Speicher der App; Austausch über .lwm-Dateien (JSON). LightBurn-
// Bibliotheken (.clb) lassen sich einlesen, soweit ihre Felder hier eine Entsprechung haben.
import { CutSettings, cutSettings, defaultCutSettings, defaultImageLayer, defaultTabs, DitherMode, ImageLayer, Layer, LayerMode } from './model';
import { dec, t } from './i18n';

export interface MaterialEntry {
  id: string;
  /** z. B. „Sperrholz Pappel“ */
  material: string;
  /** Dicke in mm; null = ohne Dicke (z. B. Gravur auf Schiefer) */
  thickness: number | null;
  /** z. B. „Schneiden“, „Gravieren“, „Markieren“ */
  title: string;
  desc: string;
  settings: CutSettings;
  /** Bild-Einstellungen, falls aus einem Layer mit Bildern erstellt */
  img?: ImageLayer;
}

const STORE_KEY = 'laserwerk.materials';
const FORMAT = 'laserwerk-materials';

const newEntryId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function sanitize(e: Partial<MaterialEntry>): MaterialEntry | null {
  if (!e || typeof e !== 'object' || !e.settings) return null;
  const mode: LayerMode = e.settings.mode === 'fill' ? 'fill' : 'line';
  const settings = { ...defaultCutSettings(mode), ...e.settings, mode };
  settings.tabs = { ...defaultTabs(), ...e.settings.tabs };
  const th = Number(e.thickness);
  return {
    id: typeof e.id === 'string' && e.id ? e.id : newEntryId(),
    material: String(e.material ?? '').trim() || t('Ohne Namen'),
    thickness: e.thickness === null || e.thickness === undefined || !isFinite(th) || th <= 0 ? null : th,
    title: String(e.title ?? '').trim(),
    desc: String(e.desc ?? ''),
    settings,
    img: e.img ? { ...defaultImageLayer(), ...e.img } : undefined,
  };
}

class Library {
  entries: MaterialEntry[] = [];
  private listeners = new Set<() => void>();

  constructor() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) this.entries = (JSON.parse(raw).entries ?? []).map(sanitize).filter(Boolean) as MaterialEntry[];
    } catch {
      /* leer beginnen */
    }
  }
  on(f: () => void) {
    this.listeners.add(f);
  }
  private changed() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ format: FORMAT, version: 1, entries: this.entries }));
    } catch {
      /* nicht speicherbar, z. B. privates Fenster */
    }
    this.listeners.forEach((f) => f());
  }
  get(id: string | undefined) {
    return id ? this.entries.find((e) => e.id === id) : undefined;
  }
  materials(): string[] {
    return [...new Set(this.entries.map((e) => e.material))].sort((a, b) => a.localeCompare(b, 'de'));
  }
  add(e: Omit<MaterialEntry, 'id'>): MaterialEntry {
    const entry = { ...structuredClone(e), id: newEntryId() };
    this.entries.push(entry);
    this.changed();
    return entry;
  }
  update(id: string, patch: Partial<Omit<MaterialEntry, 'id'>>) {
    const e = this.get(id);
    if (!e) return;
    Object.assign(e, structuredClone(patch));
    this.changed();
  }
  remove(id: string) {
    this.entries = this.entries.filter((e) => e.id !== id);
    this.changed();
  }
  /** Einträge zusammenführen: gleiche Kombination aus Material, Dicke und Titel wird ersetzt */
  merge(list: MaterialEntry[]): { added: number; replaced: number } {
    let added = 0,
      replaced = 0;
    for (const n of list) {
      const k = entryKey(n);
      const i = this.entries.findIndex((e) => e.id === n.id || entryKey(e) === k);
      if (i >= 0) {
        this.entries[i] = { ...n, id: this.entries[i].id };
        replaced++;
      } else {
        this.entries.push({ ...n, id: this.entries.some((e) => e.id === n.id) ? newEntryId() : n.id });
        added++;
      }
    }
    this.changed();
    return { added, replaced };
  }
  serialize(): string {
    return JSON.stringify({ format: FORMAT, version: 1, entries: this.entries }, null, 1);
  }
}

export const library = new Library();

const entryKey = (e: MaterialEntry) => `${e.material.toLowerCase()}|${e.thickness ?? ''}|${e.title.toLowerCase()}`;

const fmt = (v: number) => dec(String(Math.round(v * 100) / 100));
export const thicknessLabel = (th: number | null) => (th === null ? t('ohne Dicke') : `${fmt(th)} mm`);
export const entryLabel = (e: MaterialEntry) =>
  [e.material, e.thickness === null ? '' : `${fmt(e.thickness)} mm`, e.title].filter(Boolean).join(' ');
export const settingsSummary = (s: CutSettings) =>
  `${s.mode === 'fill' ? t('Füllen') : t('Linie')}, ${fmt(s.speed)} mm/min, ${fmt(s.power)} %${s.passes > 1 ? `, ${s.passes}×` : ''}`;

/** Neuer Eintrag aus den Einstellungen eines Layers */
export function entryFromLayer(L: Layer, withImg: boolean): Pick<MaterialEntry, 'settings' | 'img'> {
  return { settings: cutSettings(L), img: withImg && L.img ? structuredClone(L.img) : undefined };
}

/** Änderung für einen Layer, der einen Eintrag übernimmt */
export function layerPatch(e: MaterialEntry): Partial<Layer> {
  const p: Partial<Layer> = { ...structuredClone(e.settings), material: e.id, name: entryLabel(e) };
  if (e.img) p.img = structuredClone(e.img);
  return p;
}

/** Weichen die Einstellungen des Layers vom Eintrag ab? */
export function differsFrom(L: Layer, e: MaterialEntry): boolean {
  if (JSON.stringify(cutSettings(L)) !== JSON.stringify(cutSettings(e.settings))) return true;
  return !!e.img && JSON.stringify(L.img) !== JSON.stringify(e.img);
}

// ---------- Import ----------

/** Inhalt einer .lwm- oder .clb-Datei lesen */
export function parseLibrary(text: string): MaterialEntry[] {
  const src = text.trimStart();
  if (src.startsWith('<')) return parseClb(src);
  const data = JSON.parse(src);
  const list = Array.isArray(data) ? data : data?.entries;
  if (!Array.isArray(list)) throw new Error(t('Keine Laserwerk-Materialbibliothek'));
  return list.map(sanitize).filter(Boolean) as MaterialEntry[];
}

/**
 * LightBurn-Bibliothek (.clb, XML): Material → Entry (Thickness, Desc, NoThickTitle) → CutSetting.
 * LightBurn speichert Geschwindigkeiten in mm/s, Leistung in %. Unbekannte Felder werden ignoriert.
 */
function parseClb(xml: string): MaterialEntry[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error(t('Die XML-Datei ist fehlerhaft'));
  const out: MaterialEntry[] = [];
  for (const mat of Array.from(doc.getElementsByTagName('Material'))) {
    const material = mat.getAttribute('name') ?? '';
    for (const en of Array.from(mat.getElementsByTagName('Entry'))) {
      const cs = en.getElementsByTagName('CutSetting')[0] ?? en.getElementsByTagName('CutSetting_Img')[0];
      if (!cs) continue;
      const val = (...names: string[]) => {
        for (const n of names) {
          const el = Array.from(cs.children).find((c) => c.tagName === n);
          const v = el?.getAttribute('Value');
          if (v !== null && v !== undefined && v !== '') return v;
        }
        return null;
      };
      const num = (d: number, ...names: string[]) => {
        const v = Number(val(...names));
        return val(...names) === null || !isFinite(v) ? d : v;
      };
      const bool = (d: boolean, ...names: string[]) => {
        const v = val(...names);
        return v === null ? d : v === '1' || v.toLowerCase() === 'true';
      };
      const type = (cs.getAttribute('type') ?? 'Cut').toLowerCase();
      const isImg = type === 'image' || cs.tagName === 'CutSetting_Img';
      const mode = type === 'scan' || isImg ? 'fill' : 'line';
      const d = defaultCutSettings(mode);
      const speed = Math.round(num(d.speed / 60, 'speed') * 60 * 100) / 100;
      const settings: CutSettings = {
        ...d,
        speed,
        power: num(d.power, 'maxPower'),
        minPower: num(d.minPower, 'minPower'),
        passes: Math.max(1, Math.round(num(d.passes, 'numPasses'))),
        air: bool(d.air, 'enableAir', 'airAssist', 'air'),
        kerf: num(d.kerf, 'kerf'),
        interval: num(d.interval, 'interval'),
        angle: num(d.angle, 'angle'),
        crossHatch: bool(d.crossHatch, 'crossHatch'),
        bidirectional: bool(d.bidirectional, 'bidir'),
        overscan: num(d.overscan, 'overscanPercent', 'overscan'),
      };
      const thickness = Number(en.getAttribute('Thickness'));
      const e = sanitize({
        material,
        thickness: isFinite(thickness) && thickness > 0 ? thickness : null,
        title: en.getAttribute('Desc') || en.getAttribute('NoThickTitle') || '',
        desc: '',
        settings,
      });
      if (!e) continue;
      if (isImg) {
        const dither: Record<string, DitherMode> = {
          threshold: 'threshold', ordered: 'ordered', atkinson: 'atkinson', dither: 'floyd', stucki: 'stucki', jarvis: 'jarvis', halftone: 'halftone', grayscale: 'grayscale',
        };
        const di = defaultImageLayer();
        e.img = {
          ...di,
          speed: settings.speed, power: settings.power, minPower: settings.minPower, passes: settings.passes,
          interval: settings.interval, bidirectional: settings.bidirectional, overscan: settings.overscan, angle: settings.angle,
          dither: dither[(val('ditherMode') ?? '').toLowerCase()] ?? di.dither,
          negative: bool(di.negative, 'negativeImage'),
        };
      }
      out.push(e);
    }
  }
  if (!out.length) throw new Error(t('Keine Einträge gefunden'));
  return out;
}
