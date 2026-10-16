// Maschinenausgabe: aus dem Dokument einen Job berechnen (Linien, Füllen, Bilder), G-Code schreiben,
// Laufzeit schätzen und Rahmenfahrten erzeugen. Alles in Maschinenkoordinaten (mm, Ursprung unten links, y nach oben).
import ClipperLib from 'clipper-lib';
import { apply, Doc, ImageLayer, ImageShape, inv, Layer, visibleLeaves, Mat, mul, normalizeLayer, Obj, Pt, SubPath, TabSettings } from './model';
import { bezierPt, segments, shapeSubs } from './geom';
import { loadFont, textToSubs } from './fonts';
import { outputGrid, processImage } from './images';
import { locale, t, tn } from './i18n';

// ---------- Geräte und Firmware ----------

export type StartFrom = 'absolute' | 'user' | 'current';

export type Firmware = 'fluidnc' | 'grbl' | 'grblhal' | 'marlin' | 'smoothie';

/** Was je Steuerung anders ist: Übertragung, Laserbefehle, Maschinenbefehle */
export interface FirmwareInfo {
  label: string;
  /** Übliche Leistungsskala (S-Wert für 100 %) */
  sMax: number;
  /** Zeile für Zeile senden statt Zeichenzählung */
  sync: boolean;
  /** Echtzeitbefehle ? ! ~ 0x18 */
  realtime: boolean;
  /** Positionsabfrage per Befehl, wenn es keinen Echtzeitstatus gibt */
  poll: string | null;
  /** Laser vorbereiten (vor der ersten Bewegung) */
  laserOn: string[];
  /** Laser für den Rahmen mit fester Leistung einschalten */
  frameOn: string[];
  /** Ende des Jobs */
  footer: string[];
  home: string;
  unlock: string | null;
  jog: (x: number, y: number, f: number) => string[];
  setOrigin: string;
  clearOrigin: string | null;
  /** Einstellungen der Maschine lesen: FluidNC-Pfade, GRBL-$$ oder gar nicht */
  read: 'fluidnc' | 'grbl' | null;
}

const grblJog = (x: number, y: number, f: number) => [`$J=G91 G21${x ? ` X${num(x)}` : ''}${y ? ` Y${num(y)}` : ''} F${Math.round(f)}`];
const relJog = (x: number, y: number, f: number) => ['G91', `G0${x ? ` X${num(x)}` : ''}${y ? ` Y${num(y)}` : ''} F${Math.round(f)}`, 'G90'];
const GRBL_BASE = {
  sync: false, realtime: true, poll: null, laserOn: ['M4 S0'], frameOn: ['M3 S0'], footer: ['M5', 'M2'],
  home: '$H', unlock: '$X', jog: grblJog, setOrigin: 'G10 L20 P1 X0 Y0', clearOrigin: 'G10 L2 P1 X0 Y0',
};

export const FIRMWARES: Record<Firmware, FirmwareInfo> = {
  fluidnc: { ...GRBL_BASE, label: 'FluidNC', sMax: 1000, read: 'fluidnc' },
  grbl: { ...GRBL_BASE, label: 'GRBL 1.1', sMax: 1000, read: 'grbl' },
  grblhal: { ...GRBL_BASE, label: 'grblHAL', sMax: 1000, read: 'grbl' },
  marlin: {
    label: 'Marlin (Laser)', sMax: 255, sync: true, realtime: false, poll: 'M114',
    // Inline-Modus: S an jedem G1 setzt die Leistung, G0 fährt aus
    laserOn: ['M3 I S0'], frameOn: ['M3 I S0'], footer: ['M5', 'M400'],
    home: 'G28 X Y', unlock: null, jog: relJog, setOrigin: 'G92 X0 Y0', clearOrigin: null, read: null,
  },
  smoothie: {
    label: 'Smoothieware', sMax: 1, sync: true, realtime: true, poll: null,
    // Smoothieware feuert nur bei G1, S ist der Anteil 0 … 1
    laserOn: [], frameOn: [], footer: [],
    home: '$H', unlock: '$X', jog: relJog, setOrigin: 'G10 L20 P1 X0 Y0', clearOrigin: 'G10 L2 P1 X0 Y0', read: null,
  },
};

export interface Device {
  id: string;
  name: string;
  fw: Firmware;
  /** Arbeitsbereich in mm */
  bedW: number;
  bedH: number;
  /** Verbindung: USB-Seriell oder Netzwerk (Telnet, z. B. FluidNC Port 23) */
  conn: 'serial' | 'tcp';
  port: string;
  baud: number;
  host: string;
  tcpPort: number;
  /** S-Wert für 100 % Leistung (FluidNC/GRBL meist 1000, Marlin 255, Smoothieware 1) */
  sMax: number;
  /** Eilgang in mm/min (für Zeitschätzung und Leerwege) */
  rapid: number;
  /** Beschleunigung in mm/s² (Zeitschätzung) */
  accel: number;
  /** Junction Deviation in mm (Zeitschätzung, GRBL-Standard 0,01) */
  junction: number;
  startFrom: StartFrom;
  /** Job-Ursprung 0 … 8: Zeilen von oben nach unten, je links → rechts */
  jobOrigin: number;
  cutSelected: boolean;
  optimize: boolean;
  /** Nach dem Job zum Startpunkt zurückfahren */
  returnHome: boolean;
  homeOnConnect: boolean;
  /** Rahmen mit eingeschaltetem Laser (niedrige Leistung) */
  frameLaser: boolean;
  framePower: number;
  frameSpeed: number;
  /** Befehl für Air Assist an (aus immer mit M9): M8 = Flood, M7 = Mist */
  airCmd: 'M8' | 'M7';
  /** Grenzen für Jobs, die ein KI-Agent anfordert: höchste Leistung in %, kleinste Geschwindigkeit in mm/min (0 = keine) */
  agentMaxPower: number;
  agentMinSpeed: number;
}

export const DEFAULT_DEVICE: Device = {
  id: 'standard',
  name: 'Swiitol E6 Pro',
  fw: 'fluidnc',
  bedW: 400,
  bedH: 400,
  conn: 'serial',
  port: '',
  baud: 115200,
  host: 'fluidnc.local',
  tcpPort: 23,
  sMax: 1000,
  rapid: 6000,
  accel: 1500,
  junction: 0.01,
  startFrom: 'absolute',
  jobOrigin: 6,
  cutSelected: false,
  optimize: true,
  returnHome: true,
  homeOnConnect: false,
  frameLaser: false,
  framePower: 1,
  frameSpeed: 3000,
  airCmd: 'M8',
  agentMaxPower: 100,
  agentMinSpeed: 0,
};

/** Vorlagen für neue Geräte. Maße nach Herstellerangabe; vor dem ersten Job mit „Von der Maschine lesen“ prüfen. */
export const PRESETS: (Partial<Device> & { name: string; fw: Firmware })[] = [
  { name: 'Swiitol E6 Pro', fw: 'fluidnc', bedW: 400, bedH: 400 },
  { name: 'Ortur Laser Master 3', fw: 'grbl', bedW: 400, bedH: 380 },
  { name: 'Atomstack A20 Pro', fw: 'grbl', bedW: 400, bedH: 400 },
  { name: 'Sculpfun S30', fw: 'grbl', bedW: 410, bedH: 400 },
  { name: 'xTool D1 Pro', fw: 'grbl', bedW: 432, bedH: 406, baud: 230400 },
  { name: 'Creality Falcon 2', fw: 'grbl', bedW: 400, bedH: 415 },
  { name: 'Two Trees TS2', fw: 'grbl', bedW: 450, bedH: 450 },
  { name: t('GRBL-Laser (allgemein)'), fw: 'grbl', bedW: 400, bedH: 400 },
  { name: t('grblHAL-Laser (allgemein)'), fw: 'grblhal', bedW: 400, bedH: 400 },
  { name: t('FluidNC-Laser (allgemein)'), fw: 'fluidnc', bedW: 400, bedH: 400 },
  { name: t('Marlin mit Laser'), fw: 'marlin', bedW: 300, bedH: 300, baud: 250000 },
  { name: t('Smoothieware-Laser'), fw: 'smoothie', bedW: 300, bedH: 200 },
];

export function newDevice(preset: Partial<Device> & { fw: Firmware }): Device {
  const fw = FIRMWARES[preset.fw];
  return {
    ...DEFAULT_DEVICE,
    host: preset.fw === 'fluidnc' ? 'fluidnc.local' : '',
    sMax: fw.sMax,
    ...preset,
    id: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  };
}

export interface DeviceStore {
  devices: Device[];
  current: string;
}

const STORE_KEY = 'laserwerk.devices';
const OLD_KEY = 'laserwerk.device';

export function loadDevices(): DeviceStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const st = JSON.parse(raw) as DeviceStore;
      st.devices = st.devices.map((d) => ({ ...DEFAULT_DEVICE, ...d }));
      if (st.devices.length) {
        if (!st.devices.some((d) => d.id === st.current)) st.current = st.devices[0].id;
        return st;
      }
    }
    // Früher gab es nur ein Gerät
    const old = localStorage.getItem(OLD_KEY);
    if (old) return { devices: [{ ...DEFAULT_DEVICE, ...JSON.parse(old), id: 'standard' }], current: 'standard' };
  } catch {
    /* Standardwerte */
  }
  return { devices: [{ ...DEFAULT_DEVICE }], current: DEFAULT_DEVICE.id };
}

export function saveDevices(st: DeviceStore) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(st));
  } catch {
    /* nicht speicherbar, z. B. privates Fenster */
  }
}

// ---------- Bewegungsliste ----------

/** Bewegungen als typisierte Felder (Rasterjobs haben schnell Hunderttausende davon). f = 0 bedeutet Eilgang. */
export class Moves {
  n = 0;
  x = new Float64Array(1024);
  y = new Float64Array(1024);
  /** Leistung 0 … 1 */
  s = new Float32Array(1024);
  /** Vorschub mm/min, 0 = Eilgang */
  f = new Float32Array(1024);
  /** Layer-Index; Int16, weil der Materialtest bis zu 400 eigene Testlayer anlegt */
  layer = new Int16Array(1024);
  constructor(public x0 = 0, public y0 = 0) {}
  push(x: number, y: number, f: number, s: number, layer: number) {
    if (this.n === this.x.length) {
      const grow = <T extends Float64Array | Float32Array | Int16Array>(a: T): T => {
        const b = new (a.constructor as new (n: number) => T)(a.length * 2);
        b.set(a);
        return b;
      };
      this.x = grow(this.x);
      this.y = grow(this.y);
      this.s = grow(this.s);
      this.f = grow(this.f);
      this.layer = grow(this.layer);
    }
    const i = this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.f[i] = f;
    this.s[i] = s;
    this.layer[i] = layer;
  }
  lastX() {
    return this.n ? this.x[this.n - 1] : this.x0;
  }
  lastY() {
    return this.n ? this.y[this.n - 1] : this.y0;
  }
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Job {
  moves: Moves;
  /** Ausdehnung der Laserbahnen (ohne Überfahrwege) in Ausgabekoordinaten */
  bounds: Box | null;
  /** Ausdehnung inkl. Überfahrwegen */
  travel: Box | null;
  /** Kontur aller Laserbahnen (konvexe Hülle) für den Gummiband-Rahmen */
  hull: Pt[];
  warnings: string[];
  /** Verschiebung von Bettkoordinaten auf Ausgabekoordinaten */
  offset: Pt;
  /** Layer, bei denen Air Assist läuft */
  air: number[];
}

export interface JobInput {
  doc: Doc;
  layer: (i: number) => Layer;
  imgLayer: (i: number) => ImageLayer;
  device: Device;
  /** Nur diese Objekte (für „Nur Auswahl lasern“) */
  only?: Obj[] | null;
  /** Aktuelle Werkstückposition des Lasers (für „Aktuelle Position“) */
  position?: Pt | null;
  /** Für die Vorschau: Lage auf dem Bett zeigen, unabhängig von „Starten ab“ */
  forPreview?: boolean;
}

// ---------- Geometrie ----------

interface Poly {
  pts: Pt[];
  closed: boolean;
  /** Haltestege: off[i] = 1 heißt, die Strecke von pts[i] zum nächsten Punkt wird ohne Laser gefahren */
  off?: Uint8Array;
}

const FLATTEN_TOL = 0.01;

function flatten(sp: SubPath, m: Mat): Poly {
  const pts: Pt[] = [];
  const push = (p: Pt) => {
    const q = apply(m, p.x, p.y);
    const l = pts[pts.length - 1];
    if (!l || Math.abs(l.x - q.x) > 1e-6 || Math.abs(l.y - q.y) > 1e-6) pts.push(q);
  };
  if (sp.nodes.length) push(sp.nodes[0]);
  for (const s of segments(sp)) {
    if (!s.curve) {
      push(s.b);
      continue;
    }
    const w = [s.a, s.c1, s.c2, s.b].map((p) => apply(m, p.x, p.y));
    const len = Math.hypot(w[1].x - w[0].x, w[1].y - w[0].y) + Math.hypot(w[2].x - w[1].x, w[2].y - w[1].y) + Math.hypot(w[3].x - w[2].x, w[3].y - w[2].y);
    const n = Math.max(2, Math.min(4096, Math.ceil(Math.sqrt(len / FLATTEN_TOL) * 0.6)));
    for (let i = 1; i <= n; i++) push(bezierPt(s.a, s.c1, s.c2, s.b, i / n));
  }
  if (sp.closed && pts.length > 2) {
    const a = pts[0],
      b = pts[pts.length - 1];
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) pts.pop();
  }
  return { pts, closed: sp.closed && pts.length > 2 };
}

function emptyBox(): Box {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
}
function addPt(b: Box, x: number, y: number) {
  if (x < b.x0) b.x0 = x;
  if (y < b.y0) b.y0 = y;
  if (x > b.x1) b.x1 = x;
  if (y > b.y1) b.y1 = y;
}
const finite = (b: Box) => (isFinite(b.x0) ? b : null);

function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Konvexe Hülle (monotone Kette) */
export function convexHull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [],
    upper: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Ankerpunkt des Job-Ursprungs (0 … 8, oben links bis unten rechts) in einem Rahmen mit y nach oben */
export function anchorOf(b: Box, k: number): Pt {
  const col = k % 3,
    row = Math.floor(k / 3);
  return { x: b.x0 + ((b.x1 - b.x0) * col) / 2, y: b.y1 - ((b.y1 - b.y0) * row) / 2 };
}

// ---------- Reihenfolge der Linien ----------

/**
 * Optimierte Reihenfolge: Innere Formen vor den umgebenden, sonst immer die nächstgelegene Form.
 * Geschlossene Formen beginnen am nächsten Knoten, offene am näheren Ende.
 */
function orderPolys(polys: Poly[], from: Pt): Poly[] {
  const n = polys.length;
  const boxes = polys.map((p) => {
    const b = emptyBox();
    for (const q of p.pts) addPt(b, q.x, q.y);
    return b;
  });
  // Für jede Form: wie viele noch ungeschnittene Formen liegen in ihr?
  const pending = new Int32Array(n);
  const containers: number[][] = polys.map(() => []);
  for (let i = 0; i < n; i++) {
    const bi = boxes[i];
    for (let j = 0; j < n; j++) {
      if (i === j || !polys[j].closed) continue;
      const bj = boxes[j];
      if (bi.x0 < bj.x0 || bi.y0 < bj.y0 || bi.x1 > bj.x1 || bi.y1 > bj.y1) continue;
      // gleich große Rahmen: nur eine Richtung zählen, sonst blockieren sich deckungsgleiche Formen
      if (bi.x0 === bj.x0 && bi.y0 === bj.y0 && bi.x1 === bj.x1 && bi.y1 === bj.y1 && i < j) continue;
      if (!pointInPoly(polys[i].pts[0], polys[j].pts) && !pointInPoly(midOf(bi), polys[j].pts)) continue;
      containers[i].push(j);
      pending[j]++;
    }
  }
  const done = new Uint8Array(n);
  const out: Poly[] = [];
  let cur = from;
  for (let k = 0; k < n; k++) {
    let best = -1,
      bestD = Infinity,
      bestIdx = 0,
      bestRev = false;
    for (let i = 0; i < n; i++) {
      if (done[i] || pending[i] > 0) continue;
      const b = boxes[i];
      // Untergrenze über den Rahmen: weiter entfernte Formen gar nicht erst durchsuchen
      const dx = Math.max(b.x0 - cur.x, 0, cur.x - b.x1),
        dy = Math.max(b.y0 - cur.y, 0, cur.y - b.y1);
      if (dx * dx + dy * dy >= bestD) continue;
      const p = polys[i];
      if (p.closed) {
        for (let j = 0; j < p.pts.length; j++) {
          const d = (p.pts[j].x - cur.x) ** 2 + (p.pts[j].y - cur.y) ** 2;
          if (d < bestD) [bestD, best, bestIdx, bestRev] = [d, i, j, false];
        }
      } else {
        const a = p.pts[0],
          e = p.pts[p.pts.length - 1];
        const da = (a.x - cur.x) ** 2 + (a.y - cur.y) ** 2,
          de = (e.x - cur.x) ** 2 + (e.y - cur.y) ** 2;
        if (da < bestD) [bestD, best, bestIdx, bestRev] = [da, i, 0, false];
        if (de < bestD) [bestD, best, bestIdx, bestRev] = [de, i, 0, true];
      }
    }
    if (best < 0) {
      // Zyklus (sollte nicht vorkommen): Rest in Dokumentreihenfolge
      for (let i = 0; i < n; i++) if (!done[i]) ((done[i] = 1), out.push(polys[i]));
      break;
    }
    done[best] = 1;
    for (const c of containers[best]) pending[c]--;
    const p = polys[best];
    let q = p.closed && bestIdx ? startAt(p, bestIdx) : p;
    if (bestRev) q = { pts: [...q.pts].reverse(), closed: false };
    out.push(q);
    const pts = q.pts;
    const last = p.closed ? pts[0] : pts[pts.length - 1];
    cur = last;
  }
  return out;
}
const midOf = (b: Box): Pt => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });

/** Geschlossene Form ab Punkt k beginnen lassen (Haltestege wandern mit) */
function startAt(p: Poly, k: number): Poly {
  const pts = p.pts.slice(k).concat(p.pts.slice(0, k));
  if (!p.off) return { pts, closed: p.closed };
  const off = new Uint8Array(p.off.length);
  off.set(p.off.subarray(k));
  off.set(p.off.subarray(0, k), p.off.length - k);
  return { pts, closed: p.closed, off };
}

// ---------- Kerf und Haltestege ----------

/** Clipper rechnet mit Ganzzahlen: 1 Einheit = 0,1 µm */
const KSCALE = 10000;

/**
 * Kerf-Versatz der geschlossenen Konturen eines Objekts: Fläche nach Gerade-Ungerade-Regel bilden,
 * dann um d versetzen. Positiv vergrößert Außenkonturen und verkleinert Löcher, sodass ausgeschnittene
 * Teile die gezeichneten Maße behalten. Runde Ecken entsprechen dem runden Laserfleck.
 */
export function kerfOffset(polys: Poly[], d: number): Poly[] {
  if (!polys.length || !d) return polys;
  const { Clipper, ClipperOffset, ClipType, PolyType, PolyFillType, JoinType, EndType } = ClipperLib;
  const paths = polys.map((p) => p.pts.map((q) => ({ X: Math.round(q.x * KSCALE), Y: Math.round(q.y * KSCALE) })));
  const c = new Clipper();
  c.AddPaths(paths, PolyType.ptSubject, true);
  const area: ClipperLib.Paths = [];
  c.Execute(ClipType.ctUnion, area, PolyFillType.pftEvenOdd, PolyFillType.pftEvenOdd);
  const co = new ClipperOffset(2, 0.002 * KSCALE);
  co.AddPaths(area, JoinType.jtRound, EndType.etClosedPolygon);
  const out: ClipperLib.Paths = [];
  co.Execute(out, d * KSCALE);
  return out.filter((p) => p.length > 2).map((p) => ({ pts: p.map((q) => ({ x: q.X / KSCALE, y: q.Y / KSCALE })), closed: true }));
}

/** Haltestege gleichmäßig über den Umfang einer geschlossenen Form verteilen */
export function addTabs(p: Poly, T: TabSettings): Poly {
  const P = p.pts,
    n = P.length;
  if (!p.closed || n < 3 || T.size <= 0) return p;
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const a = P[i],
      b = P[(i + 1) % n];
    cum[i + 1] = cum[i] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const total = cum[n];
  let k = T.useCount ? Math.round(T.count) : Math.max(1, Math.round(total / Math.max(0.1, T.spacing)));
  // Stege dürfen höchstens die Hälfte des Umfangs ausmachen
  while (k > 0 && T.size >= (total / k) * 0.5) k--;
  if (k < 1) return p;
  const step = total / k,
    half = T.size / 2;
  const cuts: number[] = [];
  for (let j = 0; j < k; j++) cuts.push(step * (j + 0.5) - half, step * (j + 0.5) + half);
  const inTab = (d: number) => Math.abs(d - step * (Math.floor(d / step) + 0.5)) < half;
  const pts: Pt[] = [],
    off: number[] = [];
  let b = 0;
  for (let i = 0; i < n; i++) {
    const a = P[i],
      e = P[(i + 1) % n];
    const d0 = cum[i],
      d1 = cum[i + 1],
      l = d1 - d0;
    pts.push(a);
    let last = d0;
    while (b < cuts.length && cuts[b] <= d0) b++;
    while (l > 1e-9 && b < cuts.length && cuts[b] < d1) {
      const t = (cuts[b] - d0) / l;
      off.push(inTab((last + cuts[b]) / 2) ? 1 : 0);
      pts.push({ x: a.x + (e.x - a.x) * t, y: a.y + (e.y - a.y) * t });
      last = cuts[b++];
    }
    off.push(inTab((last + d1) / 2) ? 1 : 0);
  }
  return { pts, closed: true, off: Uint8Array.from(off) };
}

/** Haltestege für alle geschlossenen Formen eines Layers; innere Formen auf Wunsch auslassen */
function withTabs(polys: Poly[], T: TabSettings): Poly[] {
  const boxes = polys.map((p) => {
    const b = emptyBox();
    for (const q of p.pts) addPt(b, q.x, q.y);
    return b;
  });
  const inner = (i: number) =>
    polys.some((o, j) => {
      if (j === i || !o.closed) return false;
      const a = boxes[i],
        c = boxes[j];
      if (a.x0 < c.x0 || a.y0 < c.y0 || a.x1 > c.x1 || a.y1 > c.y1) return false;
      return pointInPoly(polys[i].pts[0], o.pts);
    });
  return polys.map((p, i) => (p.closed && !(T.skipInner && inner(i)) ? addTabs(p, T) : p));
}

// ---------- Rasterzeilen ----------

/** Ein Lauf auf einer Zeile: von x0 nach x1 (x0 < x1) mit Leistung s (0 … 1) */
type Run = [x0: number, x1: number, s: number];

interface ScanOptions {
  speed: number;
  bidirectional: boolean;
  /** Überfahrweg in mm */
  overscan: number;
  layer: number;
  /** Zeilen liegen in einem um diesen Winkel (rad) gedrehten System */
  angle?: number;
}

/** Lücken bis zu dieser Länge fährt der Laser ausgeschaltet mit Arbeitsgeschwindigkeit durch */
const GAP_RAPID = 10;

function emitScanlines(out: Moves, lines: { y: number; runs: Run[] }[], o: ScanOptions, flip: { v: boolean }) {
  const { speed: F, overscan: ov, layer } = o;
  const rc = Math.cos(o.angle ?? 0),
    rs = Math.sin(o.angle ?? 0);
  const mv = o.angle
    ? { push: (x: number, y: number, f: number, s: number, l: number) => out.push(x * rc - y * rs, x * rs + y * rc, f, s, l) }
    : out;
  for (const ln of lines) {
    if (!ln.runs.length) continue;
    const rev = o.bidirectional && flip.v;
    flip.v = !flip.v;
    const runs = rev ? ln.runs.map(([a, b, s]) => [-b, -a, s] as Run).reverse() : ln.runs;
    const sx = rev ? -1 : 1;
    const y = ln.y;
    let first = true;
    let px = 0;
    for (const [a, b, s] of runs) {
      if (first) {
        mv.push(sx * (a - ov), y, 0, 0, layer);
        mv.push(sx * a, y, F, 0, layer);
        first = false;
      } else if (a - px > GAP_RAPID + 2 * ov) {
        mv.push(sx * (px + ov), y, F, 0, layer);
        mv.push(sx * (a - ov), y, 0, 0, layer);
        mv.push(sx * a, y, F, 0, layer);
      } else if (a > px) mv.push(sx * a, y, F, 0, layer);
      mv.push(sx * b, y, F, s, layer);
      px = b;
    }
    mv.push(sx * (px + ov), y, F, 0, layer);
  }
}

/** Füllen: Zeilen im Abstand interval über alle geschlossenen Formen (gerade-ungerade-Regel) */
function fillLines(polys: Poly[], interval: number, s: number): { y: number; runs: Run[] }[] {
  const edges: [number, number, number, number][] = []; // ymin, ymax, x bei ymin, dx/dy
  const b = emptyBox();
  for (const p of polys) {
    if (!p.closed) continue;
    const n = p.pts.length;
    for (let i = 0; i < n; i++) {
      const a = p.pts[i],
        c = p.pts[(i + 1) % n];
      addPt(b, a.x, a.y);
      if (a.y === c.y) continue;
      const [lo, hi] = a.y < c.y ? [a, c] : [c, a];
      edges.push([lo.y, hi.y, lo.x, (hi.x - lo.x) / (hi.y - lo.y)]);
    }
  }
  if (!edges.length) return [];
  edges.sort((e, f) => e[0] - f[0]);
  const out: { y: number; runs: Run[] }[] = [];
  let next = 0;
  let active: [number, number, number, number][] = [];
  // Zeilen ab der unteren Kante, um ein halbes Intervall versetzt
  for (let y = b.y0 + interval / 2; y < b.y1; y += interval) {
    while (next < edges.length && edges[next][0] <= y) active.push(edges[next++]);
    active = active.filter((e) => e[1] > y);
    const xs = active.map((e) => e[2] + (y - e[0]) * e[3]).sort((p, q) => p - q);
    const runs: Run[] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] < 1e-4) continue;
      const last = runs[runs.length - 1];
      if (last && xs[i] - last[1] < 1e-4) last[1] = xs[i + 1];
      else runs.push([xs[i], xs[i + 1], s]);
    }
    out.push({ y, runs });
  }
  return out;
}

/** Bildzeilen: Ausgabepunkte des geditherten Bildes je Zeile zu Läufen gleicher Leistung zusammenfassen */
function imageLines(shape: ImageShape, world: Mat, toOut: Mat, L: ImageLayer): { y: number; runs: Run[] }[] | null {
  const { cols, rows } = outputGrid(shape, world, L.interval);
  const v = processImage(shape, L, cols, rows);
  if (!v) return null;
  const M = mul(toOut, world); // lokal (mm) → Ausgabe
  const IM = inv(M);
  const b = emptyBox();
  for (const [x, y] of [[0, 0], [shape.w, 0], [shape.w, shape.h], [0, shape.h]]) {
    const q = apply(M, x, y);
    addPt(b, q.x, q.y);
  }
  // Achsparallel: genau ein Abtastpunkt pro Ausgabepunkt; gedreht: Raster im Zeilenabstand
  const aligned = Math.abs(M[1]) < 1e-9 && Math.abs(M[2]) < 1e-9;
  const stepX = aligned ? (b.x1 - b.x0) / cols : L.interval;
  const stepY = aligned ? (b.y1 - b.y0) / rows : L.interval;
  const nx = Math.max(1, Math.round((b.x1 - b.x0) / stepX)),
    ny = Math.max(1, Math.round((b.y1 - b.y0) / stepY));
  const gray = L.dither === 'grayscale';
  const pmax = L.power / 100,
    pmin = Math.min(L.minPower, L.power) / 100;
  const out: { y: number; runs: Run[] }[] = [];
  for (let j = 0; j < ny; j++) {
    const y = b.y0 + (j + 0.5) * stepY;
    const runs: Run[] = [];
    let cur: Run | null = null;
    for (let k = 0; k < nx; k++) {
      const x = b.x0 + (k + 0.5) * stepX;
      const q = apply(IM, x, y);
      const c = Math.floor((q.x / shape.w) * cols),
        r = Math.floor((q.y / shape.h) * rows);
      let s = 0;
      if (c >= 0 && c < cols && r >= 0 && r < rows) {
        const val = v[r * cols + c];
        if (gray) s = val >= 255 ? 0 : Math.round((pmin + (pmax - pmin) * (1 - val / 255)) * 1000) / 1000;
        else s = val < 128 ? pmax : 0;
      }
      const xa = b.x0 + k * stepX,
        xb = xa + stepX;
      if (cur && cur[2] === s && Math.abs(cur[1] - xa) < 1e-9) cur[1] = xb;
      else {
        if (cur && cur[2] > 0) runs.push(cur);
        cur = [xa, xb, s];
      }
    }
    if (cur && cur[2] > 0) runs.push(cur);
    out.push({ y, runs });
  }
  return out;
}

/** Formen um den Ursprung drehen (Winkel in rad) */
function rotatePolys(polys: Poly[], a: number): Poly[] {
  if (!a) return polys;
  const c = Math.cos(a),
    s = Math.sin(a);
  return polys.map((p) => ({ ...p, pts: p.pts.map((q) => ({ x: q.x * c - q.y * s, y: q.x * s + q.y * c })) }));
}

// ---------- Job berechnen ----------

const FLIP = (h: number): Mat => [1, 0, 0, -1, 0, h];

/** Aus dem Dokument einen Job berechnen. Texte werden mit ihren Schriftkonturen gelasert. */
export async function buildJob(inp: JobInput): Promise<Job> {
  const { doc, device } = inp;
  const layerOf = (i: number) => normalizeLayer(inp.layer(i));
  const warnings: string[] = [];
  const roots = inp.only ?? doc.objs;
  const toBed = FLIP(doc.bed.h);

  // 1. Geometrie je Layer sammeln (Bettkoordinaten, y nach oben)
  interface Bucket {
    polys: Poly[];
    images: { shape: ImageShape; world: Mat }[];
  }
  const buckets = new Map<number, Bucket>();
  const bucket = (i: number) => {
    let b = buckets.get(i);
    if (!b) buckets.set(i, (b = { polys: [], images: [] }));
    return b;
  };
  const bounds = emptyBox();
  let skippedOpen = 0;
  for (const [o, world] of visibleLeaves(roots)) {
    const L = layerOf(o.layer);
    if (!L.output) continue;
    const s = o.shape;
    if (s.kind === 'image') {
      bucket(o.layer).images.push({ shape: s, world });
      const M = mul(toBed, world);
      for (const [x, y] of [[0, 0], [s.w, 0], [s.w, s.h], [0, s.h]]) {
        const q = apply(M, x, y);
        addPt(bounds, q.x, q.y);
      }
      continue;
    }
    let subs: SubPath[];
    if (s.kind === 'text') {
      const f = await loadFont(s.font, s.bold, s.italic);
      subs = textToSubs(s, f.font);
    } else subs = shapeSubs(s);
    const M = mul(toBed, world);
    const own: Poly[] = [];
    for (const sp of subs) {
      if (sp.nodes.length < 2) continue;
      const p = flatten(sp, M);
      if (p.pts.length < 2) continue;
      if (L.mode === 'fill' && !p.closed) {
        skippedOpen++;
        continue;
      }
      own.push(p);
    }
    // Kerf je Objekt, damit sich benachbarte Objekte nicht zu einer Fläche verbinden
    const polys = L.kerf ? [...own.filter((p) => !p.closed), ...kerfOffset(own.filter((p) => p.closed), L.kerf)] : own;
    for (const p of polys) {
      bucket(o.layer).polys.push(p);
      for (const q of p.pts) addPt(bounds, q.x, q.y);
    }
  }
  if (skippedOpen) warnings.push(tn('{n} offene Linie auf Füll-Layern übersprungen (Füllen braucht geschlossene Formen).', '{n} offene Linien auf Füll-Layern übersprungen (Füllen braucht geschlossene Formen).', skippedOpen));

  // 2. Verschiebung nach „Starten ab“
  const jb = finite(bounds);
  let offset: Pt = { x: 0, y: 0 };
  if (jb && !inp.forPreview && device.startFrom !== 'absolute') {
    const a = anchorOf(jb, device.jobOrigin);
    const target = device.startFrom === 'current' && inp.position ? inp.position : { x: 0, y: 0 };
    offset = { x: target.x - a.x, y: target.y - a.y };
  }
  const toOut = mul([1, 0, 0, 1, offset.x, offset.y], toBed);
  if (offset.x || offset.y)
    for (const b of buckets.values())
      for (const p of b.polys)
        for (const q of p.pts) {
          q.x += offset.x;
          q.y += offset.y;
        }

  // 3. Bewegungen je Layer in Ausgabereihenfolge
  const start: Pt = device.startFrom === 'current' && inp.position && !inp.forPreview ? inp.position : { x: 0, y: 0 };
  const mv = new Moves(start.x, start.y);
  const order = [...buckets.keys()].sort((a, b) => (layerOf(a).priority ?? a) - (layerOf(b).priority ?? b) || a - b);
  for (const li of order) {
    const L = layerOf(li);
    const bk = buckets.get(li)!;
    const flip = { v: false };
    // Bilder zuerst (gravieren), dann Vektoren
    if (bk.images.length) {
      const IL = inp.imgLayer(li);
      const ov = (IL.overscan / 100) * (IL.speed / 60);
      for (const im of bk.images) {
        const lines = imageLines(im.shape, im.world, toOut, IL);
        if (!lines) {
          warnings.push(t('Bild „{name}“ ist noch nicht geladen und wurde übersprungen.', { name: im.shape.name ?? t('Bild') }));
          continue;
        }
        for (let p = 0; p < Math.max(1, IL.passes); p++) emitScanlines(mv, lines, { speed: IL.speed, bidirectional: IL.bidirectional, overscan: ov, layer: li }, flip);
      }
    }
    if (!bk.polys.length) continue;
    const s = L.power / 100;
    if (L.mode === 'fill') {
      // Zeilen im gedrehten System berechnen und beim Ausgeben zurückdrehen; Kreuzschraffur = zweite Richtung um 90° versetzt
      const angles = [L.angle, ...(L.crossHatch ? [L.angle + 90] : [])].map((a) => (a * Math.PI) / 180);
      const sets = angles.map((a) => ({ a, lines: fillLines(rotatePolys(bk.polys, -a), Math.max(0.01, L.interval), s) }));
      const ov = (Math.max(0, L.overscan) / 100) * (L.speed / 60);
      for (let p = 0; p < Math.max(1, L.passes); p++)
        for (const st of sets) emitScanlines(mv, st.lines, { speed: L.speed, bidirectional: L.bidirectional, overscan: ov, layer: li, angle: st.a }, flip);
      continue;
    }
    const cuts = L.tabs.enabled ? withTabs(bk.polys, L.tabs) : bk.polys;
    for (let p = 0; p < Math.max(1, L.passes); p++) {
      const polys = device.optimize ? orderPolys(cuts, { x: mv.lastX(), y: mv.lastY() }) : cuts;
      for (let poly of polys) {
        // Nicht in einem Steg beginnen, sonst fährt der Laser ihn zuerst ohne Leistung ab
        if (poly.off?.[0]) poly = startAt(poly, Math.max(0, poly.off.indexOf(0)));
        const pts = poly.pts,
          off = poly.off;
        mv.push(pts[0].x, pts[0].y, 0, 0, li);
        for (let i = 1; i < pts.length; i++) mv.push(pts[i].x, pts[i].y, L.speed, off?.[i - 1] ? 0 : s, li);
        // Endet die Form in einem Steg, braucht es die letzte Strecke nicht
        if (poly.closed && !off?.[pts.length - 1]) mv.push(pts[0].x, pts[0].y, L.speed, s, li);
      }
    }
  }
  if (mv.n && device.returnHome) mv.push(start.x, start.y, 0, 0, -1);

  // 4. Ausdehnung und Kontur
  const ob = jb ? { x0: jb.x0 + offset.x, y0: jb.y0 + offset.y, x1: jb.x1 + offset.x, y1: jb.y1 + offset.y } : null;
  const travel = emptyBox();
  const hullPts: Pt[] = [];
  let px = mv.x0,
    py = mv.y0;
  for (let i = 0; i < mv.n; i++) {
    if (mv.f[i] > 0) {
      addPt(travel, px, py);
      addPt(travel, mv.x[i], mv.y[i]);
      if (mv.s[i] > 0) hullPts.push({ x: px, y: py }, { x: mv.x[i], y: mv.y[i] });
    }
    px = mv.x[i];
    py = mv.y[i];
  }
  const air = order.filter((li) => layerOf(li).air);
  return { moves: mv, bounds: ob, travel: finite(travel), hull: convexHull(dedupe(hullPts)), warnings, offset, air };
}

function dedupe(pts: Pt[]): Pt[] {
  const seen = new Set<string>();
  const out: Pt[] = [];
  for (const p of pts) {
    const k = `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
    if (!seen.has(k)) (seen.add(k), out.push(p));
  }
  return out;
}

// ---------- Laufzeit ----------

export interface Estimate {
  /** Endzeit jeder Bewegung in Sekunden */
  t: Float64Array;
  total: number;
  cutLength: number;
  rapidLength: number;
}

/**
 * Laufzeitschätzung wie im Bahnplaner von GRBL/FluidNC: Übergangsgeschwindigkeit an Ecken
 * aus der Junction Deviation, Rückwärts- und Vorwärtsdurchlauf, Trapezprofil je Strecke.
 */
export function estimate(mv: Moves, d: Device): Estimate {
  const n = mv.n;
  const a = Math.max(1, d.accel);
  const rapid = Math.max(1, d.rapid) / 60;
  const len = new Float64Array(n),
    vmax = new Float64Array(n),
    vj = new Float64Array(n + 1);
  let px = mv.x0,
    py = mv.y0,
    ux = 0,
    uy = 0,
    cutLength = 0,
    rapidLength = 0;
  for (let i = 0; i < n; i++) {
    const dx = mv.x[i] - px,
      dy = mv.y[i] - py;
    const l = Math.hypot(dx, dy);
    len[i] = l;
    vmax[i] = mv.f[i] > 0 ? Math.min(mv.f[i] / 60, rapid) : rapid;
    if (mv.f[i] > 0 && mv.s[i] > 0) cutLength += l;
    else rapidLength += l;
    if (l > 1e-9) {
      const nx = dx / l,
        ny = dy / l;
      // Wechsel zwischen Eilgang und Vorschub: FluidNC plant beides, behandeln wie eine Ecke
      if (i === 0 || (ux === 0 && uy === 0)) vj[i] = 0;
      else {
        const cos = -(ux * nx + uy * ny);
        if (cos > 0.999999) vj[i] = 0;
        else if (cos < -0.999999) vj[i] = Infinity;
        else {
          const sh = Math.sqrt(0.5 * (1 - cos));
          vj[i] = Math.sqrt((a * d.junction * sh) / (1 - sh));
        }
      }
      ux = nx;
      uy = ny;
    } else vj[i] = Infinity;
    px = mv.x[i];
    py = mv.y[i];
  }
  // v[i] = Geschwindigkeit am Anfang von Strecke i
  const v = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) v[i] = Math.min(vj[i], vmax[i], i > 0 ? vmax[i - 1] : 0);
  v[n] = 0;
  for (let i = n - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * a * len[i]));
  for (let i = 0; i < n; i++) v[i + 1] = Math.min(v[i + 1], Math.sqrt(v[i] ** 2 + 2 * a * len[i]));
  const t = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const l = len[i];
    if (l > 1e-9) {
      const v0 = v[i],
        v1 = v[i + 1],
        vc = vmax[i];
      const d1 = (vc * vc - v0 * v0) / (2 * a),
        d2 = (vc * vc - v1 * v1) / (2 * a);
      if (d1 + d2 > l) {
        const vp = Math.sqrt(Math.max(0, (2 * a * l + v0 * v0 + v1 * v1) / 2));
        total += Math.max(0, (vp - v0) / a) + Math.max(0, (vp - v1) / a);
      } else total += (vc - v0) / a + (vc - v1) / a + (l - d1 - d2) / vc;
    }
    t[i] = total;
  }
  return { t, total, cutLength, rapidLength };
}

export function formatDuration(sec: number): string {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600),
    m = Math.floor((sec % 3600) / 60),
    s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} h` : `${m}:${String(s).padStart(2, '0')} min`;
}

// ---------- G-Code ----------

/** S-Wert für Leistung 0 … 1; bei kleiner Skala (Smoothieware 0 … 1) mit mehr Nachkommastellen */
const sValue = (p: number, d: Device) => {
  const k = d.sMax > 100 ? 10 : 1000;
  return Math.round(p * d.sMax * k) / k;
};

const num = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

export interface GCode {
  lines: string[];
  /** Geschätzte Zeit (s), zu der die Zeile fertig ist */
  times: Float64Array;
  total: number;
}

/**
 * G-Code für FluidNC/GRBL im Lasermodus: M4 (Leistung folgt der Geschwindigkeit), S je Bewegung,
 * unveränderte Werte (G1, X, Y, F, S) werden weggelassen. Air Assist wird je Layer mit M8/M7 ein-
 * und mit M9 ausgeschaltet.
 */
export function writeGCode(job: Job, d: Device, est: Estimate, name = 'Laserwerk'): GCode {
  const mv = job.moves;
  const lines: string[] = [];
  const times: number[] = [];
  const head = (l: string) => (lines.push(l), times.push(0));
  head(`; ${name}`);
  head(t('; Erzeugt von Laserwerk am {date}', { date: new Date().toLocaleString(locale) }));
  head(t('; Geschätzte Dauer: {total}', { total: formatDuration(est.total) }));
  if (job.bounds) head(t('; Bereich: X {x0} … {x1}, Y {y0} … {y1} mm', { x0: num(job.bounds.x0), x1: num(job.bounds.x1), y0: num(job.bounds.y0), y1: num(job.bounds.y1) }));
  const fw = FIRMWARES[d.fw];
  head(t('; Gerät: {name} ({label})', { name: d.name, label: fw.label }));
  head('G21');
  head('G90');
  fw.laserOn.forEach(head);
  let g = -1,
    cx = mv.x0,
    cy = mv.y0,
    cf = -1,
    cs = -1,
    known = false;
  const airLayers = new Set(job.air);
  let air = false;
  for (let i = 0; i < mv.n; i++) {
    const x = mv.x[i],
      y = mv.y[i];
    const wantAir = airLayers.has(mv.layer[i]);
    if (wantAir !== air) {
      air = wantAir;
      lines.push(air ? d.airCmd || 'M8' : 'M9');
      times.push(i ? est.t[i - 1] : 0);
    }
    const rapid = mv.f[i] === 0;
    const xs = num(x),
      ys = num(y);
    // Bewegungen ohne Ortswechsel (nach Rundung) fallen weg, ohne den modalen Zustand zu verändern
    if (known && xs === num(cx) && ys === num(cy)) continue;
    let l = '';
    if (rapid) {
      if (g !== 0) l += 'G0';
      g = 0;
    } else if (g !== 1) {
      l += 'G1';
      g = 1;
    }
    if (!known || xs !== num(cx)) l += `${l ? ' ' : ''}X${xs}`;
    if (!known || ys !== num(cy)) l += `${l ? ' ' : ''}Y${ys}`;
    known = true;
    if (!rapid) {
      const s = sValue(mv.s[i], d);
      if (s !== cs) l += ` S${s}`;
      cs = s;
      if (mv.f[i] !== cf) l += ` F${Math.round(mv.f[i])}`;
      cf = mv.f[i];
    }
    cx = x;
    cy = y;
    lines.push(l.trim());
    times.push(est.t[i]);
  }
  for (const l of [...(air ? ['M9'] : []), ...fw.footer]) {
    lines.push(l);
    times.push(est.total);
  }
  return { lines, times: Float64Array.from(times), total: est.total };
}

// ---------- Rahmen ----------

/** Rahmenfahrt um den Job: Rechteck oder Kontur (konvexe Hülle), wahlweise mit schwachem Laser */
export function frameGCode(job: Job, d: Device, contour: boolean): string[] | null {
  const b = job.bounds;
  if (!b) return null;
  let pts: Pt[] =
    contour && job.hull.length >= 3
      ? job.hull
      : [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
  pts = [...pts, pts[0]];
  const fw = FIRMWARES[d.fw];
  const s = d.frameLaser ? sValue(d.framePower / 100, d) : 0;
  const out = ['G21', 'G90', ...(d.frameLaser ? fw.frameOn : []), `G0 X${num(pts[0].x)} Y${num(pts[0].y)}`];
  for (let i = 1; i < pts.length; i++) out.push(`G1 X${num(pts[i].x)} Y${num(pts[i].y)}${i === 1 ? ` S${s} F${Math.round(d.frameSpeed)}` : ''}`);
  out.push(...fw.footer.filter((l) => l !== 'M2'));
  return out;
}
