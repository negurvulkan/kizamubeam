import type { Shape } from './kit';

/** Ein Eintrag der mitgelieferten Bibliothek */
export interface Def {
  id: string;
  /** Name deutsch / englisch */
  de: string;
  en: string;
  cat: 'motif' | 'element';
  /** Gruppe (siehe GROUPS in src/builtinLibrary.ts) */
  group: string;
  /** Stichwörter [deutsch, englisch] (die Gruppe kommt von selbst dazu) */
  tags?: [string, string][];
  /** Längere Seite in mm (Motive 60, Elemente 80) */
  size?: number;
  draw: () => Shape;
}

/** Kurzschreibweise für Stichwörter: „Katze/cat, Haustier/pet“ */
export function tg(s: string): [string, string][] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const [de, en] = x.split('/');
      return [de.trim(), (en ?? de).trim()];
    });
}

/** Hilfsfunktion für Listen von Einträgen einer Gruppe */
export function group(cat: Def['cat'], name: string, list: [string, string, string, string, () => Shape, number?][]): Def[] {
  return list.map(([id, de, en, tags, draw, size]) => ({ id, de, en, cat, group: name, tags: tg(tags), draw, ...(size ? { size } : {}) }));
}
