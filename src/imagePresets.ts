// Bild-Presets: gespeicherte Bildanpassungen und Bildmodus (wie die Presets in LightBurns „Adjust Image“).
// Geschwindigkeit, Leistung und Zeilenabstand gehören zum Material und stehen in der Material-Bibliothek.
import { DEFAULT_ADJUST, DITHER_MODES, DitherMode, ImageAdjust, ImageLayer } from './model';

/** Teil der Layer-Einstellungen, den ein Preset mitnimmt */
export type PresetOutput = Pick<ImageLayer, 'dither' | 'negative' | 'threshold' | 'cells' | 'angle'>;

export interface ImagePreset {
  name: string;
  adjust: ImageAdjust;
  output: PresetOutput;
}

const STORE_KEY = 'laserwerk.imagePresets';

export const presetOutput = (L: ImageLayer): PresetOutput => ({ dither: L.dither, negative: L.negative, threshold: L.threshold, cells: L.cells, angle: L.angle });

function sanitize(p: Partial<ImagePreset>): ImagePreset | null {
  if (!p || typeof p !== 'object' || typeof p.name !== 'string' || !p.name.trim()) return null;
  const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);
  const a = { ...DEFAULT_ADJUST, ...p.adjust };
  const o: Partial<PresetOutput> = p.output ?? {};
  const dither: DitherMode = DITHER_MODES.some(([m]) => m === o.dither) ? (o.dither as DitherMode) : 'jarvis';
  return {
    name: p.name.trim(),
    adjust: {
      brightness: num(a.brightness, 0), contrast: num(a.contrast, 0), gamma: num(a.gamma, 1),
      sharpen: num(a.sharpen, 0), sharpenRadius: num(a.sharpenRadius, 1), denoise: num(a.denoise, 0),
    },
    output: { dither, negative: !!o.negative, threshold: num(o.threshold, 128), cells: num(o.cells, 50), angle: num(o.angle, 45) },
  };
}

export function loadPresets(): ImagePreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');
    return (Array.isArray(raw) ? raw : []).map(sanitize).filter(Boolean) as ImagePreset[];
  } catch {
    return [];
  }
}

function store(list: ImagePreset[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    /* nicht speicherbar, z. B. privates Fenster */
  }
}

/** Preset speichern; ein gleichnamiges wird ersetzt. Liefert die Liste sortiert nach Namen. */
export function savePreset(p: ImagePreset): ImagePreset[] {
  const clean = sanitize(p);
  const list = loadPresets().filter((x) => x.name !== clean?.name);
  if (clean) list.push(clean);
  list.sort((a, b) => a.name.localeCompare(b.name));
  store(list);
  return list;
}

export function deletePreset(name: string): ImagePreset[] {
  const list = loadPresets().filter((x) => x.name !== name);
  store(list);
  return list;
}
