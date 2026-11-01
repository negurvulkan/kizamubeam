// 1D-Barcodes (Strichcodes): Inhalt in Strich- und Lückenbreiten kodieren.
// Code 128 (mit automatischem Wechsel zwischen den Zeichensätzen A, B und C), EAN-13, EAN-8, UPC-A, Code 39 und
// Interleaved 2 of 5 (ITF). Rein rechnerisch ohne Zeichnen, damit es sich in Node testen lässt.
import { t } from './i18n';
import type { LinearType } from './model';

export type { LinearType };
export const LINEAR_TYPES: LinearType[] = ['code128', 'ean13', 'ean8', 'upca', 'code39', 'itf'];

/** Anzeigenamen der Strichcode-Arten */
export const LINEAR_NAMES: Record<LinearType, string> = {
  code128: 'Code 128',
  ean13: 'EAN-13',
  ean8: 'EAN-8',
  upca: 'UPC-A',
  code39: 'Code 39',
  itf: 'ITF (2 of 5)',
};

/** Breites Element bei Code 39 und ITF in Modulen (schmal = 1) */
const WIDE = 3;

export interface TextPart {
  /** Text unter den Strichen */
  s: string;
  /** Mitte in Modulen */
  x: number;
  /** Höchstbreite in Modulen (längerer Text wird verkleinert) */
  w: number;
  /** Kleinere Ziffer außerhalb der Striche (erste und letzte Ziffer bei UPC-A) */
  small?: boolean;
}

export interface Linear {
  /** Breiten in Modulen, abwechselnd Strich und Lücke, beginnend mit einem Strich */
  runs: number[];
  /** Gesamtbreite in Modulen (ohne Ruhezone) */
  total: number;
  /** Bereiche in Modulen [von, bis), deren Striche als Begrenzungszeichen nach unten verlängert werden (EAN/UPC) */
  guards: [number, number][];
  /** Klartext unter den Strichen */
  text: TextPart[];
  /** Tatsächlich kodierter Inhalt (mit Prüfziffer) */
  value: string;
}

export type LinearResult = { ok: true; code: Linear } | { ok: false; error: string };

const fail = (error: string): LinearResult => ({ ok: false, error });

/** Mindestbreite der Ruhezone in Modulen laut Norm (links/rechts) */
export function minQuiet(type: LinearType): number {
  return type === 'ean8' ? 7 : type === 'ean13' ? 11 : type === 'upca' ? 9 : 10;
}

/** Prüfziffer nach GS1 (EAN, UPC, ITF-14): von rechts abwechselnd ×3 und ×1 */
export function gs1Check(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) sum += Number(digits[digits.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

/** Strichcode berechnen; check = Prüfziffer anhängen (nur Code 39 und ITF, bei den anderen immer) */
export function encodeLinear(type: LinearType, data: string, check = false): LinearResult {
  if (!data) return fail(t('Bitte einen Inhalt eingeben.'));
  switch (type) {
    case 'code128':
      return code128(data);
    case 'ean13':
      return eanUpc(data, 13);
    case 'ean8':
      return eanUpc(data, 8);
    case 'upca':
      return eanUpc(data, 12);
    case 'code39':
      return code39(data, check);
    case 'itf':
      return itf(data, check);
  }
}

/** Bitfolge („1“ = Strichmodul) in Breiten umrechnen */
function bitsToRuns(bits: string): number[] {
  const runs: number[] = [];
  let cur = bits[0],
    n = 0;
  for (const b of bits) {
    if (b === cur) n++;
    else {
      runs.push(n);
      cur = b;
      n = 1;
    }
  }
  runs.push(n);
  return runs;
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

// ---------- Code 128 ----------

/** Breiten der 107 Zeichen (Strich, Lücke, …); 106 = Stopp */
const C128 = (
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 ' +
  '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 ' +
  '232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 ' +
  '313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 ' +
  '111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
  '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 ' +
  '114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112'
).split(' ');

const START = { A: 103, B: 104, C: 105 } as const;
const CODE_C = 99,
  CODE_B = 100,
  CODE_A = 101;

/** Anzahl der Ziffern ab Position i */
function digitRun(s: string, i: number): number {
  let n = 0;
  while (i + n < s.length && s.charCodeAt(i + n) >= 48 && s.charCodeAt(i + n) <= 57) n++;
  return n;
}

/** Zeichensatz A nötig (Steuerzeichen), bevor ein Kleinbuchstabe kommt? */
function needsA(s: string, i: number): boolean {
  for (; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 32) return true;
    if (c >= 96) return false;
  }
  return false;
}

function code128(data: string): LinearResult {
  for (const ch of data) {
    const c = ch.codePointAt(0)!;
    if (c > 127) return fail(t('Code 128 kann nur ASCII-Zeichen darstellen (keine Umlaute): „{c}“', { c: ch }));
  }
  const vals: number[] = [];
  let set: 'A' | 'B' | 'C';
  const lead = digitRun(data, 0);
  if (lead >= 4 || (lead === data.length && lead >= 2 && lead % 2 === 0)) set = 'C';
  else set = needsA(data, 0) ? 'A' : 'B';
  vals.push(START[set]);
  let i = 0;
  while (i < data.length) {
    if (set === 'C') {
      if (digitRun(data, i) >= 2) {
        vals.push(Number(data.slice(i, i + 2)));
        i += 2;
        continue;
      }
      set = needsA(data, i) ? 'A' : 'B';
      vals.push(set === 'A' ? CODE_A : CODE_B);
      continue;
    }
    // In Zeichensatz C wechseln: mindestens 4 Ziffern am Ende oder 6 mittendrin (bei ungerader Anzahl erst eine Ziffer so)
    const run = digitRun(data, i);
    if (run >= 4 && (i + run === data.length || run >= 6)) {
      if (run % 2 === 1) {
        vals.push(data.charCodeAt(i) - 32);
        i++;
      }
      set = 'C';
      vals.push(CODE_C);
      continue;
    }
    const c = data.charCodeAt(i);
    if (set === 'A' && c >= 96) {
      set = 'B';
      vals.push(CODE_B);
      continue;
    }
    if (set === 'B' && c < 32) {
      set = 'A';
      vals.push(CODE_A);
      continue;
    }
    vals.push(set === 'A' && c < 32 ? c + 64 : c - 32);
    i++;
  }
  let chk = vals[0];
  for (let k = 1; k < vals.length; k++) chk += k * vals[k];
  vals.push(chk % 103, 106);
  const runs = vals.flatMap((v) => [...C128[v]].map(Number));
  const total = sum(runs);
  // Steuerzeichen im Klartext als Leerzeichen zeigen
  const shown = data.replace(/[\x00-\x1f\x7f]/g, ' ');
  return { ok: true, code: { runs, total, guards: [], text: [{ s: shown, x: total / 2, w: total }], value: data } };
}

// ---------- EAN-13, EAN-8, UPC-A ----------

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_R = EAN_L.map((p) => [...p].map((b) => (b === '1' ? '0' : '1')).join(''));
const EAN_G = EAN_R.map((p) => [...p].reverse().join(''));
/** Erste Ziffer der EAN-13 bestimmt, welche der linken sechs Ziffern mit G statt L kodiert werden */
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function eanUpc(data: string, len: 13 | 8 | 12): LinearResult {
  const name = len === 13 ? 'EAN-13' : len === 8 ? 'EAN-8' : 'UPC-A';
  const d = data.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(d)) return fail(t('{name} besteht nur aus Ziffern.', { name }));
  if (d.length !== len - 1 && d.length !== len)
    return fail(t('{name} braucht {a} Ziffern (oder {b} mit Prüfziffer), nicht {n}.', { name, a: len - 1, b: len, n: d.length }));
  const body = d.slice(0, len - 1);
  const ck = gs1Check(body);
  if (d.length === len && Number(d[len - 1]) !== ck)
    return fail(t('Die Prüfziffer stimmt nicht: Die letzte Ziffer müsste {c} sein.', { c: ck }));
  const value = body + ck;
  const text: TextPart[] = [];
  const cell = (s: string, start: number) => ({ s, x: start + 3.5, w: 7 });
  let bits: string;
  let guards: [number, number][];
  if (len === 8) {
    bits = '101' + [...value.slice(0, 4)].map((c) => EAN_L[+c]).join('') + '01010' + [...value.slice(4)].map((c) => EAN_R[+c]).join('') + '101';
    guards = [[0, 3], [31, 36], [64, 67]];
    [...value].forEach((c, i) => text.push(cell(c, i < 4 ? 3 + 7 * i : 36 + 7 * (i - 4))));
  } else {
    // UPC-A ist eine EAN-13 mit führender 0
    const full = len === 12 ? '0' + value : value;
    const par = EAN_PARITY[+full[0]];
    bits = '101' + [...full.slice(1, 7)].map((c, i) => (par[i] === 'L' ? EAN_L : EAN_G)[+c]).join('') + '01010' + [...full.slice(7)].map((c) => EAN_R[+c]).join('') + '101';
    if (len === 13) {
      guards = [[0, 3], [45, 50], [92, 95]];
      text.push({ s: full[0], x: -5, w: 7 });
      [...full.slice(1)].forEach((c, i) => text.push(cell(c, i < 6 ? 3 + 7 * i : 50 + 7 * (i - 6))));
    } else {
      // Erste und letzte Ziffer klein außerhalb, ihre Striche reichen wie die Begrenzungszeichen nach unten
      guards = [[0, 10], [45, 50], [85, 95]];
      text.push({ s: value[0], x: -5, w: 7, small: true });
      [...value.slice(1, 11)].forEach((c, i) => text.push(cell(c, i < 5 ? 10 + 7 * i : 50 + 7 * (i - 5))));
      text.push({ s: value[11], x: 100, w: 7, small: true });
    }
  }
  const runs = bitsToRuns(bits);
  return { ok: true, code: { runs, total: bits.length, guards, text, value } };
}

// ---------- Code 39 ----------

const C39_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';
/** 9 Elemente je Zeichen (Strich, Lücke, …), „1“ = breit */
const C39: Record<string, string> = {};
(
  '000110100 100100001 001100001 101100000 000110001 100110000 001110000 000100101 100100100 001100100 ' +
  '100001001 001001001 101001000 000011001 100011000 001011000 000001101 100001100 001001100 000011100 ' +
  '100000011 001000011 101000010 000010011 100010010 001010010 000000111 100000110 001000110 000010110 ' +
  '110000001 011000001 111000000 010010001 110010000 011010000 010000101 110000100 011000100 010101000 ' +
  '010100010 010001010 000101010'
).split(' ').forEach((p, i) => (C39[C39_CHARS[i]] = p));
C39['*'] = '010010100';

function code39(data: string, check: boolean): LinearResult {
  const d = data.toUpperCase();
  for (const ch of d) if (!(ch in C39) || ch === '*') return fail(t('Code 39 kennt nur A–Z, 0–9 und - . Leerzeichen $ / + %: „{c}“', { c: ch }));
  let value = d;
  if (check) value += C39_CHARS[[...d].reduce((a, c) => a + C39_CHARS.indexOf(c), 0) % 43];
  const runs: number[] = [];
  for (const ch of `*${value}*`) {
    if (runs.length) runs.push(1); // Lücke zwischen den Zeichen
    for (const b of C39[ch]) runs.push(b === '1' ? WIDE : 1);
  }
  const total = sum(runs);
  return { ok: true, code: { runs, total, guards: [], text: [{ s: `*${value}*`, x: total / 2, w: total }], value } };
}

// ---------- Interleaved 2 of 5 ----------

const ITF = ['00110', '10001', '01001', '11000', '00101', '10100', '01100', '00011', '10010', '01010'];

function itf(data: string, check: boolean): LinearResult {
  const d = data.replace(/\s/g, '');
  if (!/^\d+$/.test(d)) return fail(t('{name} besteht nur aus Ziffern.', { name: 'ITF' }));
  let value = check ? d + gs1Check(d) : d;
  // Ziffern werden paarweise verschränkt: bei ungerader Anzahl eine 0 voranstellen
  if (value.length % 2) value = '0' + value;
  const runs = [1, 1, 1, 1];
  for (let i = 0; i < value.length; i += 2) {
    const a = ITF[+value[i]],
      b = ITF[+value[i + 1]];
    for (let k = 0; k < 5; k++) runs.push(a[k] === '1' ? WIDE : 1, b[k] === '1' ? WIDE : 1);
  }
  runs.push(WIDE, 1, 1);
  const total = sum(runs);
  return { ok: true, code: { runs, total, guards: [], text: [{ s: value, x: total / 2, w: total }], value } };
}

/** Striche als Bereiche in Modulen: [Anfang, Ende, Begrenzungszeichen] */
export function bars(code: Linear): [number, number, boolean][] {
  const out: [number, number, boolean][] = [];
  let x = 0;
  code.runs.forEach((w, i) => {
    if (i % 2 === 0) out.push([x, x + w, code.guards.some(([a, b]) => x >= a && x < b)]);
    x += w;
  });
  return out;
}
