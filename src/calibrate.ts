// Kalibrierassistent für Schnittfuge und Steckspiel (DOM-frei): Testteile erzeugen und aus dem, was der Nutzer
// misst bzw. als beste Passung auswählt, die Kalibrierung eines Materials berechnen (MaterialFit).
// Testteile: ein Quadrat 20 × 20 mm zum Messen der Schnittfuge, ein Schlitzkamm mit gestuften Schlitzbreiten
// (für eine Platte in voller Materialdicke) sowie eine Lochplatte und ein Zapfenkamm mit gestuftem Spiel je Seite
// (Teil in Teil, wie Fingerzinken). Die Stufen sind Zugaben zur gezeichneten Geometrie; der Kerf-Versatz des
// Layers wird beim Auswerten abgezogen, damit die Werte zu fitcheck.ts passen.
import type { Obj, SubPath, TextShape } from './model';
import { newId, translate } from './model';
import type { MaterialFit } from './materials';
import { t } from './i18n';

/** Gestufte Werte: Anfang, Schritt, Anzahl */
export interface CalibSteps {
  from: number;
  step: number;
  count: number;
}

export interface CalibOptions {
  /** Nenndicke des Materials (mm) */
  th: number;
  /** Spiel je Seite für Zapfen in Loch (mm, negativ = Pressung) */
  pair: CalibSteps;
  /** Schlitzbreite über der Nenndicke (mm) */
  slot: CalibSteps;
}

/** Was erzeugt wurde: nötig zum Auswerten (gespeichert bis zum Eintragen des Ergebnisses) */
export interface CalibTest {
  th: number;
  /** Kerf-Versatz des Schnitt-Layers beim Erzeugen */
  kl: number;
  layer: number;
  /** Material-Eintrag, für den kalibriert wird */
  entry?: string;
  pair: number[];
  slot: number[];
  date: string;
}

/** Seitenlänge des Quadrats zum Messen der Schnittfuge */
export const SQUARE = 20;
/** Breite der Zapfen bzw. Löcher ohne Spiel */
export const TAB = 10;
const CELL = 16;
const MAX_STEPS = 12;

export function stepValues(s: CalibSteps): number[] {
  const n = Math.max(1, Math.min(MAX_STEPS, Math.round(s.count)));
  return Array.from({ length: n }, (_, i) => Math.round((s.from + i * s.step) * 1000) / 1000);
}

/**
 * Vorschlag für die Stufen: um die zu erwartende Schnittbreite herum, damit eine stramme und eine lockere Passung
 * dabei sind. Ein Kerf-Versatz am Layer verschiebt die Mitte (er macht Zapfen breiter und Löcher schmaler).
 */
export function defaultSteps(beam: number, kl: number): { pair: CalibSteps; slot: CalibSteps } {
  const r = (v: number) => Math.round(v / 0.05) * 0.05;
  return {
    pair: { from: r(2 * kl - beam - 0.05), step: 0.05, count: 6 },
    slot: { from: r(2 * kl - beam - 0.1), step: 0.05, count: 8 },
  };
}

const rectSub = (x: number, y: number, w: number, h: number): SubPath => ({
  closed: true,
  nodes: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
});

/**
 * Testteile in lokalen Koordinaten (y nach unten, oben links bei 0, 0): Schnitte auf cut, Nummern auf label.
 * Liefert die Objekte und die Gesamtgröße.
 */
export function buildCalibParts(o: CalibOptions, cut: number, label: number, font: string): { objs: Obj[]; w: number; h: number } {
  const objs: Obj[] = [];
  const th = o.th;
  const pairs = stepValues(o.pair), slots = stepValues(o.slot);
  const gap = 6;
  const ls = 3;
  const text = (s: string, x: number, y: number): Obj => ({
    id: newId(), m: translate(x, y), layer: label,
    shape: { kind: 'text', text: s, font, size: ls, bold: false, italic: false, upper: false, align: 'center', hSpace: 0, vSpace: 0 } as TextShape,
  });
  const path = (subs: SubPath[], name: string): Obj => ({ id: newId(), m: translate(0, 0), layer: cut, shape: { kind: 'path', subs }, name });

  // Quadrat zum Messen der Schnittfuge
  objs.push({ id: newId(), m: translate(0, 0), layer: cut, shape: { kind: 'rect', w: SQUARE, h: SQUARE, r: 0 }, name: `${SQUARE} × ${SQUARE}` });
  objs.push(text(String(SQUARE), SQUARE / 2, SQUARE / 2 + ls * 0.36));

  // Schlitzkamm: Schlitze von oben, 10 mm tief, dazwischen 6 mm Steg, Nummern darunter
  const depth = 10, combH = 20, x0 = SQUARE + gap;
  const nodes: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  let x = gap;
  slots.forEach((d, i) => {
    const w = th + d;
    nodes.push({ x, y: 0 }, { x, y: depth }, { x: x + w, y: depth }, { x: x + w, y: 0 });
    objs.push(text(String(i + 1), x0 + x + w / 2, depth + 6));
    x += w + gap;
  });
  const combW = x;
  nodes.push({ x: combW, y: 0 }, { x: combW, y: combH }, { x: 0, y: combH });
  objs.push({ ...path([{ closed: true, nodes }], t('Schlitzkamm')), m: translate(x0, 0) });

  // Lochplatte: je Stufe ein Loch TAB × (Dicke + 1), Nummer darunter
  const y1 = combH + gap, holeH = th + 1, plateH = holeH + 12;
  const plateW = pairs.length * CELL;
  const plate: SubPath[] = [rectSub(0, 0, plateW, plateH)];
  pairs.forEach((_, i) => {
    plate.push(rectSub(i * CELL + (CELL - TAB) / 2, 3, TAB, holeH));
    objs.push(text(String(i + 1), i * CELL + CELL / 2, y1 + 3 + holeH + 6));
  });
  objs.push({ ...path(plate, t('Lochplatte')), m: translate(0, y1) });

  // Zapfenkamm: Zapfen TAB − 2·Spiel breit, Dicke + 2 lang, auf einer 12 mm hohen Leiste
  const y2 = y1 + plateH + gap, tabL = th + 2, baseH = 12;
  const tn: { x: number; y: number }[] = [{ x: 0, y: tabL }];
  pairs.forEach((c, i) => {
    const w = TAB - 2 * c, l = i * CELL + (CELL - w) / 2;
    tn.push({ x: l, y: tabL }, { x: l, y: 0 }, { x: l + w, y: 0 }, { x: l + w, y: tabL });
    objs.push(text(String(i + 1), i * CELL + CELL / 2, y2 + tabL + baseH / 2 + ls * 0.36));
  });
  tn.push({ x: plateW, y: tabL }, { x: plateW, y: tabL + baseH }, { x: 0, y: tabL + baseH });
  objs.push({ ...path([{ closed: true, nodes: tn }], t('Zapfenkamm')), m: translate(0, y2) });

  return { objs, w: Math.max(x0 + combW, plateW), h: y2 + tabL + baseH };
}

export type CalibError = 'square' | 'pair' | 'slot';

/**
 * Kalibrierung aus dem Ergebnis: gemessene Seitenlänge des Quadrats (null = nicht gemessen) und Nummer (ab 1)
 * des besten Zapfens bzw. Schlitzes. Werte gezeichnet samt Kerf-Versatz des Layers (siehe MaterialFit).
 */
export function calibResult(test: CalibTest, square: number | null, bestPair: number, bestSlot: number): { fit: MaterialFit } | { error: CalibError } {
  let kerf: number | null = null;
  if (square !== null) {
    // Kontur liegt um kl nach außen versetzt, der Strahl nimmt die halbe Fuge je Seite weg
    kerf = Math.round((SQUARE + 2 * test.kl - square) * 1000) / 1000;
    if (!(kerf >= 0 && kerf <= 1)) return { error: 'square' };
  }
  const c = test.pair[bestPair - 1], d = test.slot[bestSlot - 1];
  if (c === undefined) return { error: 'pair' };
  if (d === undefined) return { error: 'slot' };
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { fit: { kerf, pair: r(c - 2 * test.kl), slot: r(d - 2 * test.kl), th: test.th, date: test.date } };
}

const STORE_KEY = 'kizamubeam.calib';

export function loadCalibTest(): CalibTest | null {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as CalibTest | null;
    return v && Array.isArray(v.pair) && Array.isArray(v.slot) && v.th > 0 ? v : null;
  } catch {
    return null;
  }
}
export function saveCalibTest(v: CalibTest | null) {
  try {
    if (v) localStorage.setItem(STORE_KEY, JSON.stringify(v));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    /* Speicher nicht verfügbar */
  }
}
