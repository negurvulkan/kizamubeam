// Mehrsprachigkeit. Texte stehen im Code auf Deutsch und laufen durch t(); die deutsche
// Fassung ist zugleich der Schlüssel. Weitere Sprachen liegen in src/locales/<code>.json
// (deutscher Text → Übersetzung). Fehlt eine Übersetzung, erscheint der deutsche Text.
// Gleicher deutscher Text mit verschiedener Bedeutung: Kontext nach „|“ anhängen,
// z. B. t('Verbindung|Gerät'); angezeigt wird nur der Teil davor.
// Prüfen mit: npm run i18n:check
import en from './locales/en.json';

export type Lang = 'de' | 'en';
export type LangPref = Lang | 'system';

/** Sprachen mit ihrem Namen in der eigenen Sprache */
export const LANGUAGES: [Lang, string][] = [
  ['de', 'Deutsch'],
  ['en', 'English'],
];

const DICTS: Record<Lang, Record<string, string> | null> = { de: null, en };
const LANG_KEY = 'laserwerk.lang';

function systemLang(): Lang {
  for (const l of navigator.languages ?? [navigator.language]) {
    const code = l.slice(0, 2).toLowerCase();
    if (code in DICTS) return code as Lang;
  }
  return 'en';
}

function readPref(): LangPref {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === 'system' || (v && v in DICTS)) return v as LangPref;
  } catch {
    /* Speicher nicht verfügbar */
  }
  return 'system';
}

let pref: LangPref = readPref();
/** Aktive Sprache; wird beim Start festgelegt, ein Wechsel lädt die Oberfläche neu. */
export const lang: Lang = pref === 'system' ? systemLang() : pref;
document.documentElement.lang = lang;

export const langPref = () => pref;

/** Speichert die Sprachwahl. Gibt true zurück, wenn sich die angezeigte Sprache ändert. */
export function setLangPref(p: LangPref): boolean {
  pref = p;
  try {
    localStorage.setItem(LANG_KEY, p);
  } catch {
    /* Speicher nicht verfügbar */
  }
  return (p === 'system' ? systemLang() : p) !== lang;
}

/**
 * Übersetzt einen deutschen Text. Platzhalter in geschweiften Klammern werden ersetzt:
 * t('{n} Bilder', { n: 3 }).
 */
export function t(de: string, vars?: Record<string, string | number>): string {
  const s = DICTS[lang]?.[de] || de.replace(/\|[^|]*$/, '');
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Meldungen aus dem Rust-Teil (dort deutsch). Platzhalter wie in den Sprachdateien. */
// i18n-keys-start (npm run i18n:check liest die Texte zwischen diesen Markierungen)
const BACKEND_PATTERNS: [RegExp, string][] = [
  [/^Schrift „(.*)“ nicht gefunden$/, 'Schrift „{family}“ nicht gefunden'],
  [/^Schrift „(.*)“ liegt nur als Sammlung \(TTC\) vor$/, 'Schrift „{family}“ liegt nur als Sammlung (TTC) vor'],
  [/^(.*): Adresse nicht gefunden$/, '{host}: Adresse nicht gefunden'],
  [/^Unbekannte Verbindungsart „(.*)“$/, 'Unbekannte Verbindungsart „{kind}“'],
  [/^Senden fehlgeschlagen: (.*)$/s, 'Senden fehlgeschlagen: {error}'],
  [/^Lesen fehlgeschlagen: (.*)$/s, 'Lesen fehlgeschlagen: {error}'],
  [/^Fertig nach (\d+:\d+) min, (\d+) Fehler$/, 'Fertig nach {time} min, {errors} Fehler'],
  [/^Fertig nach (\d+:\d+) min$/, 'Fertig nach {time} min'],
];
const BACKEND_MESSAGES = [
  'Ungültige Daten',
  'Nicht verbunden',
  'Verbindung getrennt',
  'Keine Schnittstelle gewählt',
  'Während ein Job läuft, sind keine Befehle möglich.',
  'Es läuft bereits ein Job.',
  'Die Gegenstelle hat die Verbindung beendet.',
  'Die Steuerung wurde neu gestartet',
  'Alarm, Job abgebrochen',
];
// i18n-keys-end

/** Übersetzt eine Meldung aus dem Rust-Teil; unbekannte bleiben, wie sie sind. */
export function tBackend(msg: string): string {
  if (lang === 'de') return msg;
  if (BACKEND_MESSAGES.includes(msg)) return t(msg);
  for (const [re, key] of BACKEND_PATTERNS) {
    const m = re.exec(msg);
    if (!m) continue;
    const names = [...key.matchAll(/\{(\w+)\}/g)].map((x) => x[1]);
    return t(key, Object.fromEntries(names.map((n, i) => [n, m[i + 1]])));
  }
  return msg;
}

/** Einzahl/Mehrzahl: tn('{n} Bild', '{n} Bilder', n). {n} wird immer ersetzt. */
export function tn(one: string, other: string, n: number, vars?: Record<string, string | number>): string {
  return t(n === 1 ? one : other, { n: n.toLocaleString(locale), ...vars });
}

/** Zahlenformat der Oberfläche */
export const locale = lang === 'de' ? 'de-DE' : 'en-US';

/** Dezimalzeichen für die Anzeige: Komma auf Deutsch, Punkt auf Englisch. */
export const dec = (s: string) => (lang === 'de' ? s.replace('.', ',') : s);
