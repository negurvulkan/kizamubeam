// Verbindung zur Maschine (FluidNC/GRBL). Die eigentliche Kommunikation läuft im Rust-Kern (src-tauri/src/machine.rs);
// hier liegen Zustand, Statusauswertung und die Befehle für die Oberfläche.
import { Device, FIRMWARES, PreparedGCode } from './gcode';
import { t, tBackend } from './i18n';

export const isTauri = () => '__TAURI_INTERNALS__' in window;

export interface MachineStatus {
  /** Idle, Run, Hold, Jog, Alarm, Door, Home, Check, Sleep */
  state: string;
  /** Maschinenposition */
  mpos: [number, number, number] | null;
  /** Werkstückposition (Maschinenposition minus Werkstück-Nullpunkt) */
  wpos: [number, number, number] | null;
  feed: number;
  power: number;
}

export interface Progress {
  sent: number;
  acked: number;
  total: number;
  errors: number;
}

export type MachineEvent =
  | { type: 'line'; line: string; dir: 'in' | 'out' | 'info' | 'error' }
  | { type: 'status' }
  | { type: 'connection' }
  | { type: 'progress' }
  | { type: 'done'; ok: boolean; message: string };

export interface PortInfo {
  name: string;
  description: string;
}

/** Klartext für FluidNC-/GRBL-Alarme und häufige Fehler */
const ALARMS: Record<string, string> = {
  '1': t('Endschalter ausgelöst, Position unsicher. Neu referenzieren (Home).'),
  '2': t('Ziel außerhalb des Arbeitsbereichs (Soft-Limit).'),
  '3': t('Zurückgesetzt während der Bewegung, Position unsicher. Neu referenzieren.'),
  '4': t('Sonde nicht im erwarteten Zustand.'),
  '5': t('Sonde hat nicht ausgelöst.'),
  '6': t('Referenzfahrt abgebrochen.'),
  '7': t('Referenzfahrt: Tür geöffnet.'),
  '8': t('Referenzfahrt: Endschalter nicht freigefahren.'),
  '9': t('Referenzfahrt: Endschalter nicht gefunden.'),
  '10': t('Referenzfahrt: Endschalter doppelt ausgelöst.'),
};
const ERRORS: Record<string, string> = {
  '1': t('Befehl ohne Buchstaben'),
  '2': t('Zahl fehlt oder ist ungültig'),
  '3': t('Unbekannter $-Befehl'),
  '9': t('Gesperrt (Alarm). Mit $X entsperren oder Home fahren.'),
  '15': t('Fahrweg außerhalb des Arbeitsbereichs'),
  '20': t('Nicht unterstützter G-Code-Befehl'),
  '22': t('Vorschub fehlt'),
  '24': t('Zwei G-Code-Befehle derselben Gruppe in einer Zeile'),
  '33': t('Ziel ungültig'),
};

export function explain(line: string): string | null {
  let m = /^ALARM:(\d+)/i.exec(line);
  if (m) return ALARMS[m[1]] ?? null;
  m = /^error:(\d+)/i.exec(line);
  if (m) return ERRORS[m[1]] ?? null;
  return null;
}

/** Statusbericht auswerten, z. B. <Idle|MPos:1.000,2.000,0.000|FS:0,0|WCO:0.000,0.000,0.000> */
export function parseStatus(line: string, prev: MachineStatus, wco: number[]): MachineStatus {
  const body = line.replace(/^<|>$/g, '').split('|');
  const st: MachineStatus = { ...prev, state: body[0].split(':')[0] };
  const vec = (s: string) => {
    const v = s.split(',').map(Number);
    return [v[0] || 0, v[1] || 0, v[2] || 0] as [number, number, number];
  };
  let mpos: [number, number, number] | null = null,
    wpos: [number, number, number] | null = null;
  for (const f of body.slice(1)) {
    const [k, v] = f.split(':');
    if (k === 'MPos') mpos = vec(v);
    else if (k === 'WPos') wpos = vec(v);
    else if (k === 'WCO') {
      const w = vec(v);
      wco[0] = w[0];
      wco[1] = w[1];
      wco[2] = w[2];
    } else if (k === 'FS' || k === 'F') {
      const p = v.split(',').map(Number);
      st.feed = p[0] || 0;
      st.power = p[1] || 0;
    }
  }
  if (mpos) {
    st.mpos = mpos;
    st.wpos = [mpos[0] - wco[0], mpos[1] - wco[1], mpos[2] - wco[2]];
  } else if (wpos) {
    st.wpos = wpos;
    st.mpos = [wpos[0] + wco[0], wpos[1] + wco[1], wpos[2] + wco[2]];
  }
  return st;
}

type Unlisten = () => void;

class Machine {
  connected = false;
  connecting = false;
  /** Beschreibung der Verbindung, z. B. „COM3“ oder „fluidnc.local:23“ */
  where = '';
  status: MachineStatus = { state: '', mpos: null, wpos: null, feed: 0, power: 0 };
  progress: Progress | null = null;
  /** Geschätzte Zeiten je Zeile des laufenden Jobs */
  jobTimes: Float64Array | null = null;
  jobStarted = 0;
  /** Laufender Auftrag ist eine Rahmenfahrt (keine Fortschrittsanzeige) */
  jobIsFrame = false;
  private wco = [0, 0, 0];
  /** Firmware der aktuellen Verbindung */
  fw = FIRMWARES.fluidnc;
  private listeners = new Set<(e: MachineEvent) => void>();
  private unlisten: Unlisten[] = [];

  on(fn: (e: MachineEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(e: MachineEvent) {
    this.listeners.forEach((f) => f(e));
  }
  log(line: string, dir: 'in' | 'out' | 'info' | 'error' = 'info') {
    this.emit({ type: 'line', line, dir });
  }

  get busy() {
    return !!this.progress;
  }

  async ports(): Promise<PortInfo[]> {
    if (!isTauri()) return [];
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<PortInfo[]>('machine_ports');
  }

  private async listen() {
    if (this.unlisten.length) return;
    const { listen } = await import('@tauri-apps/api/event');
    this.unlisten.push(
      await listen<string>('machine-line', (e) => this.onLine(e.payload)),
      await listen<Progress>('machine-progress', (e) => {
        this.progress = e.payload;
        this.emit({ type: 'progress' });
      }),
      await listen<{ ok: boolean; message: string }>('machine-done', (e) => {
        const frame = this.jobIsFrame;
        this.progress = null;
        this.jobTimes = null;
        this.jobIsFrame = false;
        this.emit({ type: 'progress' });
        if (!frame || !e.payload.ok) this.emit({ type: 'done', ok: e.payload.ok, message: tBackend(e.payload.message) });
      }),
      await listen<string>('machine-closed', (e) => {
        this.connected = false;
        this.progress = null;
        this.status = { state: '', mpos: null, wpos: null, feed: 0, power: 0 };
        if (e.payload) this.log(tBackend(e.payload), 'error');
        this.log(t('Verbindung getrennt.'));
        this.emit({ type: 'connection' });
      }),
    );
  }

  private onLine(line: string) {
    // Marlin: Antwort auf M114 („X:10.00 Y:20.00 Z:0.00 E:0.00 Count …“)
    const m114 = /^X:(-?[\d.]+)\s*Y:(-?[\d.]+)(?:\s*Z:(-?[\d.]+))?/.exec(line);
    if (m114) {
      const p: [number, number, number] = [+m114[1], +m114[2], +(m114[3] ?? 0)];
      this.status = { ...this.status, mpos: p, wpos: p };
      this.emit({ type: 'status' });
      return;
    }
    if (line.startsWith('<')) {
      this.status = parseStatus(line, this.status, this.wco);
      this.emit({ type: 'status' });
      return;
    }
    const isErr = /^(error|alarm)/i.test(line);
    const why = explain(line);
    this.log(why ? `${line}  (${why})` : line, isErr ? 'error' : 'in');
  }

  /** Verbinden; `home` = danach referenzieren (Standard: Einstellung des Geräts) */
  async connect(d: Device, home = d.homeOnConnect) {
    if (!isTauri()) {
      this.log(t('Die Maschinenanbindung gibt es nur in der Desktop-App.'), 'error');
      return;
    }
    if (this.connected || this.connecting) return;
    this.connecting = true;
    this.emit({ type: 'connection' });
    try {
      await this.listen();
      const { invoke } = await import('@tauri-apps/api/core');
      const netPort = d.conn === 'ws' ? d.wsPort : d.tcpPort;
      const where = d.conn === 'serial' ? d.port : `${d.conn === 'ws' ? 'ws://' : ''}${d.host}:${netPort}`;
      this.log(t('Verbinde mit {where} …', { where }));
      const fw = FIRMWARES[d.fw];
      this.fw = fw;
      await invoke('machine_connect', {
        kind: d.conn, port: d.port, baud: d.baud, host: d.host, tcpPort: netPort,
        sync: fw.sync, realtime: fw.realtime, poll: fw.poll,
      });
      this.connected = true;
      this.where = where;
      this.log(t('Verbunden mit {where}.', { where }));
      if (home) await this.send(fw.home);
    } catch (e) {
      this.log(t('Verbindung fehlgeschlagen: {error}', { error: tBackend(String(e)) }), 'error');
    } finally {
      this.connecting = false;
      this.emit({ type: 'connection' });
    }
  }

  async disconnect() {
    if (!isTauri()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('machine_disconnect');
  }

  /** Eine Zeile senden (Konsole, Bewegen, Home …). Wird abgelehnt, solange ein Job läuft. */
  async send(line: string) {
    if (!this.connected) return this.log(t('Nicht verbunden.'), 'error');
    const { invoke } = await import('@tauri-apps/api/core');
    this.log(line, 'out');
    try {
      await invoke('machine_send', { line });
    } catch (e) {
      this.log(tBackend(String(e)), 'error');
    }
  }

  /** Echtzeitbefehl: ? Status, ! Halt, ~ Weiter, 0x18 Reset, 0x85 Jog abbrechen */
  async realtime(byte: number) {
    if (!this.connected) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('machine_realtime', { byte });
  }

  /** Auftrag senden: fertige Zeilen oder G-Code, den der Rust-Kern schon vorbereitet hat (prepareGCode) */
  async runJob(lines: string[], times: Float64Array | null, frame = false) {
    return this.startJob(lines.length, times, frame, { cmd: 'machine_job', args: { lines } });
  }
  async runPrepared(g: PreparedGCode) {
    if (g.lines) return this.runJob(g.lines, g.times);
    return this.startJob(g.count, g.times, false, { cmd: 'machine_job_prepared', args: { id: g.id } });
  }
  private async startJob(total: number, times: Float64Array | null, frame: boolean, call: { cmd: string; args: Record<string, unknown> }) {
    if (!this.connected) return this.log(t('Nicht verbunden.'), 'error');
    if (this.busy) return this.log(t('Es läuft bereits ein Auftrag.'), 'error');
    const { invoke } = await import('@tauri-apps/api/core');
    this.jobTimes = times;
    this.jobIsFrame = frame;
    this.jobStarted = performance.now();
    this.progress = { sent: 0, acked: 0, total, errors: 0 };
    this.emit({ type: 'progress' });
    try {
      await invoke(call.cmd, call.args);
    } catch (e) {
      this.progress = null;
      this.jobTimes = null;
      this.emit({ type: 'progress' });
      this.log(tBackend(String(e)), 'error');
    }
  }

  /** Anhalten: GRBL-Familie per Echtzeitbefehl !, Marlin durch Zurückhalten weiterer Zeilen (im Rust-Kern) */
  async pause() {
    if (!this.connected) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('machine_pause');
  }
  async resume() {
    if (!this.connected) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('machine_resume');
  }
  async stop() {
    if (!this.connected) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('machine_stop');
    this.log(t('Gestoppt.'), 'info');
  }

  /** Geschätzte Restzeit des laufenden Jobs in Sekunden */
  remaining(): number | null {
    const p = this.progress,
      t = this.jobTimes;
    if (!p || !t || !t.length) return null;
    const i = Math.min(t.length - 1, Math.max(0, p.acked - 1));
    return Math.max(0, t[t.length - 1] - (p.acked ? t[i] : 0));
  }
}

export const machine = new Machine();
