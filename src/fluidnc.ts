// FluidNC und die GRBL-Familie: Echtzeit-Overrides, Dateien auf SD-Karte/Flash, Konfiguration (config.yaml),
// Ausgänge und Kühlmittel. Reine Logik ohne Oberfläche (Tests: npm run test:fluidnc); die Dialoge stehen in fluidncDialog.ts.
import type { Device } from './gcode';
import { t } from './i18n';

// ---------- Echtzeit-Overrides (GRBL 1.1, grblHAL, FluidNC) ----------

/** Echtzeitbefehle für Vorschub und Laserleistung: 100 %, +10, −10, +1, −1 (Bereich 10 … 200 %) */
export const OVERRIDE = {
  feed: { reset: 0x90, plus10: 0x91, minus10: 0x92, plus1: 0x93, minus1: 0x94 },
  power: { reset: 0x99, plus10: 0x9a, minus10: 0x9b, plus1: 0x9c, minus1: 0x9d },
} as const;
/** Eilgang: 100 %, 50 %, 25 % */
export const RAPID_OVERRIDE: Record<100 | 50 | 25, number> = { 100: 0x95, 50: 0x96, 25: 0x97 };
/** Kühlmittel umschalten (wirkt auch während eines Jobs): Flood (M8), Mist (M7) */
export const TOGGLE_FLOOD = 0xa0;
export const TOGGLE_MIST = 0xa1;

/** Bytes, um einen Override von `from` auf `to` Prozent zu bringen (in Schritten von 10 und 1) */
export function overrideSteps(kind: keyof typeof OVERRIDE, from: number, to: number): number[] {
  const c = OVERRIDE[kind];
  to = Math.max(10, Math.min(200, Math.round(to)));
  if (to === 100) return [c.reset];
  // Vom bekannten Stand aus; unbekannt = erst auf 100 % zurück
  const out: number[] = [];
  let cur = from;
  if (!(from >= 10 && from <= 200)) ((out.push(c.reset)), (cur = 100));
  let d = to - cur;
  while (Math.abs(d) >= 10) ((out.push(d > 0 ? c.plus10 : c.minus10)), (d -= Math.sign(d) * 10));
  while (d !== 0) ((out.push(d > 0 ? c.plus1 : c.minus1)), (d -= Math.sign(d)));
  return out;
}

/** Eingänge aus dem Statusbericht (Pn:) in Klartext */
export function pinNames(pins: string): string[] {
  const names: Record<string, string> = {
    X: t('Endschalter X'), Y: t('Endschalter Y'), Z: t('Endschalter Z'), A: t('Endschalter A'), B: t('Endschalter B'), C: t('Endschalter C'),
    P: t('Taster'), D: t('Tür'), H: t('Halt-Taster'), R: t('Reset-Taster'), S: t('Start-Taster'),
  };
  return [...pins].map((c) => names[c] ?? c);
}

// ---------- Dateien auf der Steuerung ----------

/** Speicher der Steuerung: SD-Karte oder interner Flash (LocalFS) */
export type FluidFs = 'sd' | 'localfs';

export interface FluidFile {
  name: string;
  size: number;
  dir: boolean;
}

/** Befehle für die Dateiverwaltung */
export const fsCmd = (fs: FluidFs) => (fs === 'sd' ? '$SD' : '$LocalFS');
export const listCmd = (fs: FluidFs) => `${fsCmd(fs)}/List`;
export const runCmd = (fs: FluidFs, name: string) => `${fsCmd(fs)}/Run=${absName(name)}`;
export const deleteCmd = (fs: FluidFs, name: string) => `${fsCmd(fs)}/Delete=${absName(name)}`;
const absName = (n: string) => (n.startsWith('/') ? n : `/${n}`);

/** Antwort auf $SD/List bzw. $LocalFS/List: „[FILE:/a.gcode|SIZE:123]“, „[DIR:/sub]“ */
export function parseFileList(lines: string[]): FluidFile[] {
  const out: FluidFile[] = [];
  for (const l of lines) {
    const m = /^\[(FILE|DIR):\s*([^|\]]+?)\s*(?:\|SIZE:\s*(\d+))?\]$/i.exec(l.trim());
    if (!m) continue;
    out.push({ name: m[2], size: Number(m[3] ?? 0), dir: m[1].toUpperCase() === 'DIR' });
  }
  return out.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
}

/** Dateiname für die Steuerung: nur Buchstaben, Ziffern, - und _, Endung .gcode; FluidNC mag keine Leer- und Sonderzeichen */
export function safeFileName(name: string): string {
  const base = name
    .replace(/\.(gcode|nc|gc|ngc)$/i, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'kizamubeam'}.gcode`;
}

// ---------- Konfiguration (config.yaml) ----------

/** Einen Wert der laufenden Konfiguration setzen (wirkt sofort, ist aber erst nach dem Speichern dauerhaft) */
export function setCmd(path: string, value: string): string {
  if (!/^[a-z0-9_]+(\/[a-z0-9_]+)*$/i.test(path)) throw new Error(t('Ungültiger Konfigurationspfad: {path}', { path }));
  if (/[\r\n]/.test(value)) throw new Error(t('Der Wert darf keinen Zeilenumbruch enthalten.'));
  return `$/${path}=${value.trim()}`;
}

/** Laufende Konfiguration in die Datei schreiben, aus der FluidNC beim Start liest */
export const saveCmd = (file: string) => `$CD=${file.trim() || 'config.yaml'}`;
export const RESTART_CMD = '$Bye';

/** Antwort auf $Config/Filename (FluidNC meldet „$Config/Filename=config.yaml“) */
export function parseConfigFile(lines: string[]): string | null {
  for (const l of lines) {
    const m = /^\$?Config\/Filename\s*[=:]\s*(\S+)/i.exec(l.trim());
    if (m) return m[1];
  }
  return null;
}

/** Text der Konfiguration aus der Antwort auf $CD: alles außer ok, Meldungen und Statusberichten */
export function configText(lines: string[]): string {
  return lines.filter((l) => !/^\s*(ok\b|error|\[|<|ALARM)/i.test(l)).join('\n').replace(/\s+$/, '') + '\n';
}

export interface ConfigChange {
  path: string;
  from: string | undefined;
  to: string;
}

/** Was sich zwischen zwei gelesenen Konfigurationen unterscheidet (Pfade wie aus parseFluidConfig) */
export function diffConfig(before: Record<string, string>, after: Record<string, string>): ConfigChange[] {
  const out: ConfigChange[] = [];
  for (const [path, to] of Object.entries(after)) if (before[path] !== to) out.push({ path, from: before[path], to });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Zeilen, um eine Sicherung wiederherzustellen: abweichende Werte setzen, dann speichern */
export function restoreCmds(current: Record<string, string>, backup: Record<string, string>, file: string): string[] {
  const ch = diffConfig(current, backup);
  return ch.length ? [...ch.map((c) => setCmd(c.path, c.to)), saveCmd(file)] : [];
}

/** Pin umkehren: „gpio.14“ ↔ „gpio.14:low“ (weitere Angaben wie „:pu“ bleiben erhalten) */
export function invertPin(v: string): string {
  const parts = v.trim().split(':');
  const low = parts.findIndex((p, i) => i > 0 && p.toLowerCase() === 'low');
  if (low > 0) parts.splice(low, 1);
  else parts.push('low');
  return parts.join(':');
}

/** Pfad des direction_pin einer Achse (Treiber steht dazwischen, z. B. axes/x/motor0/stepstick/direction_pin) */
export function directionPinPath(c: Record<string, string>, axis: string): string | null {
  const re = new RegExp(`^axes/${axis}/motor0/[a-z0-9_]+/direction_pin$`);
  const k = Object.keys(c).find((p) => re.test(p));
  return k && !/^no_pin$/i.test(c[k]) ? k : null;
}

/** Ein Pin ist belegt, wenn er nicht fehlt und nicht „no_pin“ ist */
const used = (v: string | undefined) => !!v && !/^no_pin$/i.test(v.trim());

/** Kühlmittel-Ausgänge laut Konfiguration; null = Konfiguration unbekannt */
export function coolantPins(c: Record<string, string>): { flood: boolean; mist: boolean } | null {
  if (!Object.keys(c).length) return null;
  return { flood: used(c['coolant/flood_pin']), mist: used(c['coolant/mist_pin']) };
}

/** Warnung, wenn ein Layer Air Assist will, die Steuerung dafür aber keinen Ausgang hat */
export function airProblem(c: Record<string, string>, airCmd: Device['airCmd']): string | null {
  const p = coolantPins(c);
  if (!p) return null;
  if (airCmd === 'M7' ? p.mist : p.flood) return null;
  const other = airCmd === 'M7' ? p.flood : p.mist;
  return (
    t('Air Assist wird mit {cmd} eingeschaltet, in der FluidNC-Konfiguration ist dafür aber kein Ausgang eingetragen (coolant/{pin}). Die Luft bleibt aus.', {
      cmd: airCmd,
      pin: airCmd === 'M7' ? 'mist_pin' : 'flood_pin',
    }) + (other ? ' ' + t('Eingetragen ist {other}; stelle in den Geräteeinstellungen unter „Air Assist“ auf {other} um.', { other: airCmd === 'M7' ? 'M8' : 'M7' }) : '')
  );
}

export interface FluidOutput {
  /** Nummer für M62–M65 P… */
  n: number;
  pin: string;
}

/** Freie digitale Ausgänge (user_outputs/digitalN_pin) */
export function digitalOutputs(c: Record<string, string>): FluidOutput[] {
  const out: FluidOutput[] = [];
  for (const [k, v] of Object.entries(c)) {
    const m = /^user_outputs\/digital(\d+)_pin$/.exec(k);
    if (m && used(v)) out.push({ n: +m[1], pin: v });
  }
  return out.sort((a, b) => a.n - b.n);
}

/** Ausgang sofort schalten (M64/M65); im Job: an vor der ersten Bewegung, aus erst nach der letzten (G4 P0 wartet) */
export const outputCmd = (n: number, on: boolean) => `${on ? 'M64' : 'M65'} P${n}`;
export const jobOutputsOn = (d: Device) => (d.jobOutputs ?? []).map((n) => outputCmd(n, true));
export const jobOutputsOff = (d: Device) => ((d.jobOutputs ?? []).length ? ['G4 P0', ...d.jobOutputs.map((n) => outputCmd(n, false))] : []);

// ---------- Suche im Netzwerk ----------

/** Antwort auf [ESP800] (Weboberfläche von FluidNC): „FW version: FluidNC v3.7.8 # … # hostname:fluidnc # …“ */
export function parseEsp800(body: string): { version: string; hostname: string } | null {
  const v = /FW version:\s*(FluidNC\s*v?[\w.\-]+)/i.exec(body);
  if (!v) return null;
  const hn = /hostname:\s*([\w.\-]+)/i.exec(body);
  return { version: v[1], hostname: hn ? hn[1] : '' };
}
