// Fokustest: den richtigen Abstand zwischen Laserkopf und Material finden.
// Zwei Verfahren:
//  - Rampe: Das Material liegt schräg (ein Ende auf einer Unterlage). Eine lange Linie läuft die Schräge hinauf,
//    Markierungen darunter zeigen, wie hoch das Material an dieser Stelle liegt. Wo die Linie am dünnsten ist,
//    liegt der Brennpunkt. Geht mit jedem Laser, auch ohne Z-Achse.
//  - Z-Reihe: Mit motorischer Z-Achse lasert jede kurze Linie bei einem anderen Z-Versatz. Die schärfste Linie
//    nennt den besten Z-Versatz.
// Wie beim Materialtest erscheint das Testdokument nicht auf der Arbeitsfläche.
import { CutSettings, defaultCutSettings, defaultTabs, Doc, Layer, newDoc, Obj, rotate, translate, mul, Mat } from './model';
import { dec, t } from './i18n';

export type FocusMethod = 'ramp' | 'z';

export interface FocusOptions {
  method: FocusMethod;
  /** Laser-Einstellungen der Testlinien */
  speed: number;
  power: number;
  air: boolean;
  /** Rampe: Länge der Linie (mm) */
  rampLength: number;
  /** Rampe: Höhe der Unterlage am hohen Ende (mm), gemessen an der Stelle, wo die Linie endet */
  rampRise: number;
  /** Rampe: Abstand der Markierungen (mm entlang der Linie) */
  tickEvery: number;
  /** Z-Reihe: Versatz von … bis (mm, positiv = Fokus tiefer) */
  zFrom: number;
  zTo: number;
  /** Z-Reihe: Anzahl der Linien */
  zCount: number;
  /** Z-Reihe: Länge jeder Linie und Abstand der Linien (mm) */
  lineLength: number;
  lineGap: number;
  /** Untere linke Ecke des ganzen Tests in Maschinenkoordinaten (mm) */
  x: number;
  y: number;
  labels: boolean;
  labelSize: number;
  labelSpeed: number;
  labelPower: number;
}

export const MAX_Z_LINES = 41;

export function defaultFocusOptions(): FocusOptions {
  return {
    method: 'ramp',
    speed: 1500, power: 30, air: false,
    rampLength: 100, rampRise: 10, tickEvery: 10,
    zFrom: -3, zTo: 3, zCount: 13, lineLength: 15, lineGap: 4,
    x: 10, y: 10,
    labels: true, labelSize: 2.5, labelSpeed: 1500, labelPower: 20,
  };
}

/** Gespeicherte Einstellungen mit Standardwerten auffüllen und auf sinnvolle Bereiche begrenzen */
export function cleanFocusOptions(s: unknown): FocusOptions {
  const d = defaultFocusOptions();
  const o = { ...d, ...(s && typeof s === 'object' ? (s as Partial<FocusOptions>) : {}) };
  const num = (v: unknown, def: number, min: number, max: number) => (typeof v === 'number' && isFinite(v) ? Math.max(min, Math.min(max, v)) : def);
  return {
    method: o.method === 'z' ? 'z' : 'ramp',
    speed: num(o.speed, d.speed, 1, 100000),
    power: num(o.power, d.power, 0, 100),
    air: !!o.air,
    rampLength: num(o.rampLength, d.rampLength, 10, 2000),
    rampRise: num(o.rampRise, d.rampRise, 0.5, 200),
    tickEvery: num(o.tickEvery, d.tickEvery, 1, 500),
    zFrom: num(o.zFrom, d.zFrom, -50, 50),
    zTo: num(o.zTo, d.zTo, -50, 50),
    zCount: Math.round(num(o.zCount, d.zCount, 2, MAX_Z_LINES)),
    lineLength: num(o.lineLength, d.lineLength, 2, 200),
    lineGap: num(o.lineGap, d.lineGap, 0.5, 100),
    x: num(o.x, d.x, -10000, 10000),
    y: num(o.y, d.y, -10000, 10000),
    labels: o.labels !== false,
    labelSize: num(o.labelSize, d.labelSize, 0.5, 50),
    labelSpeed: num(o.labelSpeed, d.labelSpeed, 1, 100000),
    labelPower: num(o.labelPower, d.labelPower, 0, 100),
  };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Höhe des Materials über dem tiefen Ende an der Stelle s (mm entlang der Linie) */
export const rampHeight = (o: FocusOptions, s: number) => r2((o.rampRise * Math.max(0, Math.min(o.rampLength, s))) / o.rampLength);

/** Lage der Markierungen entlang der Rampe (immer mit Anfang und Ende) */
export function rampTicks(o: FocusOptions): number[] {
  const out: number[] = [];
  const step = Math.max(1, o.tickEvery);
  for (let s = 0; s < o.rampLength - step * 0.25; s += step) out.push(r2(s));
  out.push(r2(o.rampLength));
  return out;
}

/** Z-Versatz jeder Linie der Z-Reihe */
export function zValues(o: FocusOptions): number[] {
  const n = Math.max(2, Math.min(MAX_Z_LINES, Math.round(o.zCount)));
  return Array.from({ length: n }, (_, i) => r2(o.zFrom + ((o.zTo - o.zFrom) * i) / (n - 1)));
}

/** Zahl mit Vorzeichen, z. B. „+0,5“, „−1“, „0“ */
export const signed = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + dec(String(Math.abs(r2(v))));

export interface FocusDoc {
  doc: Doc;
  layers: Layer[];
  /** Ganzer Test inkl. Beschriftung in Dokumentkoordinaten (mm, y nach unten) */
  bounds: { x: number; y: number; w: number; h: number };
}

const line = (id: number, layer: number, x0: number, y0: number, x1: number, y1: number): Obj => ({
  id, m: translate(0, 0), layer,
  shape: { kind: 'path', subs: [{ nodes: [{ x: x0, y: y0 }, { x: x1, y: y1 }], closed: false }] },
});

function lineSettings(o: FocusOptions): CutSettings {
  return { ...defaultCutSettings('line'), mode: 'line', speed: o.speed, power: o.power, minPower: 0, passes: 1, air: o.air, tabs: defaultTabs(), kerf: 0 };
}

/**
 * Testdokument aufbauen.
 * Rampe: Layer 0 = Linie, Layer 1 = Markierungen + Beschriftung.
 * Z-Reihe: Layer 0 … n-1 = Linien mit steigendem Z-Versatz, Layer n = Beschriftung (ohne Z-Versatz).
 */
export function buildFocusDoc(o: FocusOptions, bed: { w: number; h: number }, font: string): FocusDoc {
  const doc = newDoc();
  doc.bed = { ...bed };
  const layers: Layer[] = [];
  const objs: Obj[] = [];
  let id = 1;
  const ls = Math.max(0.5, o.labelSize);
  const addLabelLayer = () => {
    const li = layers.length;
    layers.push({
      ...defaultCutSettings('line'), mode: 'line', speed: o.labelSpeed, power: o.labelPower, air: o.air,
      index: li, name: t('Beschriftung'), output: true, show: true, priority: li,
    });
    return li;
  };
  const text = (li: number, s: string, m: Mat, align: 'left' | 'center' | 'right'): Obj => ({
    id: id++, m, layer: li,
    shape: { kind: 'text', text: s, font, size: ls, bold: false, italic: false, upper: false, align, hSpace: 0, vSpace: 0 },
  });
  // Lokales System: Linie(n) beginnen bei y = 0, Beschriftung darunter (y nach unten)
  let w: number, hgt: number;
  if (o.method === 'ramp') {
    layers.push({ ...lineSettings(o), index: 0, name: t('Fokuslinie'), output: true, show: true, priority: 0 });
    objs.push(line(id++, 0, 0, 0, o.rampLength, 0));
    w = o.rampLength;
    hgt = 0;
    if (o.labels) {
      const li = addLabelLayer();
      // Markierungen mit Abstand zur Linie, damit sie die Linie nicht verfälschen
      const gap = Math.max(1, ls * 0.6),
        tick = Math.max(1.5, ls);
      const ticks = rampTicks(o);
      for (const s of ticks) {
        objs.push(line(id++, li, s, gap, s, gap + tick));
        objs.push(text(li, dec(String(rampHeight(o, s))), translate(s, gap + tick + ls * 1.2), 'center'));
      }
      // Einheit hinter der letzten Zahl
      objs.push(text(li, t('mm Höhe'), translate(o.rampLength + ls * 1.5, gap + tick + ls * 1.2), 'left'));
      w = o.rampLength + ls * 1.5 + ls * 4.5;
      hgt = gap + tick + ls * 1.5;
    }
  } else {
    const zs = zValues(o);
    zs.forEach((z, i) => {
      layers.push({ ...lineSettings(o), zOffset: z, index: i, name: t('Z {z} mm', { z: signed(z) }), output: true, show: true, priority: i });
      objs.push(line(id++, i, i * o.lineGap, 0, i * o.lineGap, o.lineLength));
    });
    w = (zs.length - 1) * o.lineGap;
    hgt = o.lineLength;
    if (o.labels) {
      const li = addLabelLayer();
      const top = o.lineLength + Math.max(1, ls * 0.6);
      // Werte senkrecht unter den Linien, von unten nach oben zu lesen
      const widest = Math.max(...zs.map((z) => signed(z).length));
      zs.forEach((z, i) => objs.push(text(li, signed(z), mul(translate(i * o.lineGap + ls * 0.36, top), rotate(-Math.PI / 2)), 'right')));
      hgt = top + widest * ls * 0.62;
      const title = t('Z-Versatz (mm)');
      objs.push(text(li, title, translate(w / 2, hgt + ls * 1.4), 'center'));
      hgt += ls * 1.7;
      w = Math.max(w, title.length * ls * 0.55);
    }
  }
  // Untere linke Ecke des Ganzen auf (x, y) in Maschinenkoordinaten legen
  const dx = o.x,
    dy = bed.h - o.y - hgt;
  for (const ob of objs) ob.m = mul(translate(dx, dy), ob.m);
  doc.objs = objs;
  layers.forEach((L) => (doc.layers[L.index] = L));
  return { doc, layers, bounds: { x: dx, y: dy, w, h: hgt } };
}

/** Ergebnis der Rampe: wo der Brennpunkt liegt, wenn die Linie an der Stelle s (mm) am dünnsten ist */
export function rampResult(o: FocusOptions, s: number): string {
  const h = rampHeight(o, s);
  if (h <= 0.05)
    return t('Am tiefen Ende am schärfsten: Der Brennpunkt liegt dort oder noch tiefer. Fokus etwas tiefer einstellen (Kopf runter) oder die Rampe umdrehen und wiederholen.');
  if (h >= o.rampRise - 0.05)
    return t('Am hohen Ende am schärfsten: Der Brennpunkt liegt dort oder noch höher. Eine höhere Unterlage nehmen und wiederholen.');
  return t('Der Brennpunkt liegt etwa {h} mm über der Materialoberfläche am tiefen Ende. Wenn du den Fokus am tiefen Ende eingestellt hast: Kopf um {h} mm absenken (oder das Material um {h} mm anheben) und die Fokuslehre bzw. den Abstand entsprechend anpassen.', { h: dec(String(h)) });
}

/** Ergebnis der Z-Reihe für die schärfste Linie */
export function zResult(z: number): string {
  if (Math.abs(z) < 0.005) return t('Die Linie ohne Versatz ist am schärfsten: Die Fokushöhe stimmt.');
  return z > 0
    ? t('Am schärfsten bei Z-Versatz {z} mm: Der Brennpunkt sollte {a} mm tiefer liegen. Kopf um {a} mm absenken oder den Wert als Z-Versatz im Layer eintragen.', { z: signed(z), a: dec(String(Math.abs(z))) })
    : t('Am schärfsten bei Z-Versatz {z} mm: Der Brennpunkt sollte {a} mm höher liegen. Kopf um {a} mm anheben oder den Wert als Z-Versatz im Layer eintragen.', { z: signed(z), a: dec(String(Math.abs(z))) });
}

/**
 * Z-Fahrt (relativ), die den Kopf an die Höhe der gewählten Linie bringt.
 * Positiver Versatz = Fokus tiefer; ohne zFlip fährt der Kopf dafür nach unten (Z−), wie in gcode.ts zInserts.
 */
export const zMoveFor = (z: number, zFlip: boolean) => r2(z * (zFlip ? 1 : -1));
