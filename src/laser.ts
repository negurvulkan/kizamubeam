// Laser-Panel (Laser, Verschieben, Konsole), Geräteeinstellungen, Vorschau und G-Code-Ausgabe.
import type { Editor } from './editor';
import { $, h, numInput } from './dom';
import { ICONS } from './icons';
import { saveText } from './files';
import {
  anchorOf, buildJob, Device, estimate, Firmware, FIRMWARES, formatDuration, frameGCode, Job, loadDevices, newDevice, PRESETS,
  saveDevices, StartFrom, writeGCode,
} from './gcode';
import { isTauri, machine, PortInfo } from './machine';
import type { Doc, ImageLayer, Layer } from './model';
import { materialTab } from './materialui';
import { cameraTab } from './cameraui';

const store = loadDevices();
/** Das gewählte Gerät (live gebunden: wechselt mit der Auswahl) */
export let device: Device = store.devices.find((d) => d.id === store.current) ?? store.devices[0];
const deviceListeners = new Set<() => void>();
function deviceChanged() {
  saveDevices(store);
  deviceListeners.forEach((f) => f());
}
const fw = () => FIRMWARES[device.fw];

/** Arbeitsfläche an das Bett des gewählten Geräts anpassen */
function applyBed(ed: Editor) {
  if (ed.doc.bed.w === device.bedW && ed.doc.bed.h === device.bedH) return;
  ed.doc.bed.w = device.bedW;
  ed.doc.bed.h = device.bedH;
  ed.emit('doc');
  ed.zoomPage();
}

function selectDevice(ed: Editor, id: string) {
  const d = store.devices.find((x) => x.id === id);
  if (!d || d === device) return;
  if (machine.connected || machine.connecting) {
    notify('Zum Wechseln des Geräts erst die Verbindung trennen.', true);
    deviceChanged();
    return;
  }
  device = d;
  store.current = id;
  applyBed(ed);
  deviceChanged();
}

/** Kurze Meldung im Laser-Panel (und in der Konsole) */
let notify: (msg: string, error?: boolean) => void = (m) => machine.log(m);

// ---------- Job ----------

/**
 * Woher ein Job kommt: normalerweise das Dokument im Editor, beim Materialtest ein eigenes Testdokument
 * mit eigenen Layern, das nie auf der Arbeitsfläche erscheint.
 */
export interface JobSource {
  doc: Doc;
  layer: (i: number) => Layer;
  imgLayer: (i: number) => ImageLayer;
  /** Name in der G-Code-Datei und Vorschlag für den Dateinamen */
  name: string;
  /** Farbe je Layer in der Vorschau */
  color: (i: number) => string;
}

async function makeJob(ed: Editor, forPreview: boolean, src?: JobSource): Promise<Job> {
  const pos = machine.status.wpos;
  return buildJob({
    doc: src?.doc ?? ed.doc,
    layer: src?.layer ?? ((i) => ed.layer(i)),
    imgLayer: src?.imgLayer ?? ((i) => ed.imgLayer(i)),
    device,
    only: !src && device.cutSelected ? ed.sel : null,
    position: pos ? { x: pos[0], y: pos[1] } : null,
    forPreview,
  });
}

function nothingToDo(job: Job): boolean {
  if (job.moves.n) return false;
  notify(device.cutSelected ? 'Nichts zu lasern: Die Auswahl ist leer oder liegt nur auf Layern ohne Ausgabe.' : 'Nichts zu lasern: Keine Objekte auf Layern mit Ausgabe.', true);
  return true;
}

/** Liegt der Job (inkl. Überfahrwegen) im Arbeitsbereich? Sonst nachfragen. */
function boundsOk(ed: Editor, job: Job): boolean {
  const t = job.travel;
  if (!t) return true;
  const { w, h: bh } = ed.doc.bed;
  if (device.startFrom === 'user') return true; // Lage hängt vom gesetzten Ursprung ab
  const e = 0.01;
  if (t.x0 >= -e && t.y0 >= -e && t.x1 <= w + e && t.y1 <= bh + e) return true;
  return confirm(
    `Der Job reicht über den Arbeitsbereich (${w} × ${bh} mm) hinaus:\n` +
      `X ${t.x0.toFixed(1)} … ${t.x1.toFixed(1)}, Y ${t.y0.toFixed(1)} … ${t.y1.toFixed(1)} mm (inkl. Überfahrweg).\n\nTrotzdem starten?`,
  );
}

function canRun(): boolean {
  if (!machine.connected) {
    notify('Nicht verbunden.', true);
    return false;
  }
  if (machine.busy) {
    notify('Es läuft bereits ein Auftrag.', true);
    return false;
  }
  if (machine.status.state.startsWith('Alarm')) {
    notify(`Die Maschine ist im Alarmzustand. Erst referenzieren (Home)${fw().unlock ? ` oder entsperren (${fw().unlock})` : ''}.`, true);
    return false;
  }
  if (device.startFrom === 'current' && !machine.status.wpos) {
    notify('Die aktuelle Position ist noch nicht bekannt.', true);
    return false;
  }
  return true;
}

export async function startJob(ed: Editor, src?: JobSource) {
  if (!canRun()) return;
  const job = await makeJob(ed, false, src);
  if (nothingToDo(job) || !boundsOk(ed, job)) return;
  job.warnings.forEach((w) => notify(w));
  const est = estimate(job.moves, device);
  const g = writeGCode(job, device, est, src?.name);
  notify(`Job gestartet, geschätzt ${formatDuration(est.total)}.`);
  await machine.runJob(g.lines, g.times);
}

export async function frameJob(ed: Editor, contour: boolean, src?: JobSource) {
  if (!canRun()) return;
  const job = await makeJob(ed, false, src);
  const lines = frameGCode(job, device, contour);
  if (!lines) return void nothingToDo(job);
  if (!boundsOk(ed, job)) return;
  await machine.runJob(lines, null, true);
}

export async function saveGCode(ed: Editor, src?: JobSource) {
  const job = await makeJob(ed, false, src);
  if (nothingToDo(job)) return;
  if (device.startFrom === 'current') notify('Hinweis: Die Datei enthält die aktuelle Laserposition als Startpunkt.');
  const g = writeGCode(job, device, estimate(job.moves, device), src?.name);
  await saveText(src ? `${src.name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-')}.gcode` : 'projekt.gcode', 'G-Code', 'gcode', 'text/plain', g.lines.join('\n') + '\n');
}

// ---------- Laser-Panel ----------

export function buildLaser(ed: Editor) {
  const panel = $('#laser-panel');
  const title = panel.querySelector('.panel-title') as HTMLElement;
  const body = $('#laser');
  applyBed(ed);
  const tabs: [string, HTMLElement][] = [
    ['Laser', laserTab(ed)],
    ['Verschieben', moveTab(ed)],
    ['Konsole', consoleTab()],
    ['Material', materialTab(ed)],
    ['Kamera', cameraTab(ed)],
  ];
  title.textContent = '';
  title.classList.add('tabs');
  tabs.forEach(([name, el], i) => {
    const b = h('button', { class: i === 0 ? 'cur' : '' }, name);
    b.addEventListener('click', () => {
      title.querySelectorAll('button').forEach((x) => x.classList.toggle('cur', x === b));
      tabs.forEach(([, e]) => (e.hidden = e !== el));
      if (name === 'Konsole') el.querySelector('input')?.focus();
    });
    title.append(b);
    el.hidden = i !== 0;
    body.append(el);
  });
  // Laserkopf auf der Arbeitsfläche
  machine.on((e) => {
    if (e.type !== 'status' && e.type !== 'connection') return;
    const p = machine.connected ? machine.status.wpos : null;
    const old = ed.laserPos;
    if (!p) {
      if (old) ((ed.laserPos = null), ed.redraw());
    } else if (!old || Math.abs(old.x - p[0]) > 1e-3 || Math.abs(old.y - p[1]) > 1e-3) {
      ed.laserPos = { x: p[0], y: p[1] };
      ed.redraw();
    }
  });
  window.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
    if (e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      openPreview(ed);
    }
  });
}

function stateText(): [string, string] {
  if (machine.connecting) return ['Verbinde …', 'busy'];
  if (!machine.connected) return ['Nicht verbunden', ''];
  const s = machine.status.state;
  const names: Record<string, string> = {
    Idle: 'Bereit', Run: 'Läuft', Hold: 'Angehalten', Jog: 'Fährt', Alarm: 'Alarm', Door: 'Tür offen', Home: 'Referenzfahrt', Check: 'Prüfmodus', Sleep: 'Ruhezustand',
  };
  const t = names[s] ?? (s || 'Verbunden');
  return [t, s === 'Alarm' || s === 'Door' ? 'error' : s === 'Idle' || !s ? 'ok' : 'busy'];
}

function laserTab(ed: Editor): HTMLElement {
  const root = h('div', { class: 'laser-tab' });
  const big = (icon: string, label: string, title: string, onclick: () => void) =>
    h('button', { class: 'btn', title, onclick }, h('span', { html: ICONS[icon] }), label);
  const dot = h('span', { class: 'dot' });
  const stTxt = h('span', {});
  const posTxt = h('span', { class: 'pos' });
  const portSel = h('select', { class: 'port', title: 'Schnittstelle oder Netzwerk' }) as HTMLSelectElement;
  const refreshBtn = h('button', { class: 'ib small', title: 'Schnittstellen neu suchen', html: ICONS.refresh, onclick: () => loadPorts() });
  const connBtn = h('button', { class: 'btn' }, 'Verbinden') as HTMLButtonElement;
  connBtn.addEventListener('click', async () => {
    if (machine.connected) return machine.disconnect();
    applyPortChoice();
    await machine.connect(device);
  });
  const startB = big('play', 'Start', 'Job starten', () => startJob(ed));
  const pauseB = big('pause', 'Pause', 'Anhalten / fortsetzen', () => (machine.status.state.startsWith('Hold') ? machine.resume() : machine.pause()));
  const stopB = big('stop', 'Stopp', 'Job abbrechen', () => machine.stop());
  const frameB = big('frame', 'Rahmen', 'Rechteck um den Job abfahren', () => frameJob(ed, false));
  const contourB = big('contour', 'Kontur', 'Umriss des Jobs abfahren (Gummiband)', () => frameJob(ed, true));
  const homeB = big('home', 'Home', 'Referenzfahrt', () => machine.send(fw().home));
  const originB = big('origin', 'Ursprung', 'Zum Nullpunkt fahren', () => machine.send('G0 X0 Y0'));
  const previewB = big('preview', 'Vorschau', 'Vorschau mit Zeitschätzung (Alt+P)', () => openPreview(ed));
  const saveB = big('gcode', 'G-Code', 'G-Code speichern', () => saveGCode(ed));
  const bar = h('div', { class: 'progress' }, h('div', { class: 'fill' }));
  const progTxt = h('div', { class: 'progress-text' });
  const msg = h('div', { class: 'note laser-msg' });
  const startFrom = h('select', { onchange: (e: Event) => ((device.startFrom = (e.target as HTMLSelectElement).value as StartFrom), deviceChanged()) },
    h('option', { value: 'absolute' }, 'Absolute Koordinaten'),
    h('option', { value: 'user' }, 'Benutzer-Ursprung'),
    h('option', { value: 'current' }, 'Aktuelle Position'),
  ) as HTMLSelectElement;
  const originGrid = h('div', { class: 'origin-grid', title: 'Job-Ursprung: dieser Punkt des Jobs liegt am Startpunkt' });
  const originBtns = Array.from({ length: 9 }, (_, k) => {
    const b = h('button', { onclick: () => ((device.jobOrigin = k), deviceChanged()) });
    originGrid.append(b);
    return b;
  });
  const check = (label: string, title: string, get: () => boolean, set: (v: boolean) => void) => {
    const c = h('input', { type: 'checkbox', onchange: (e: Event) => (set((e.target as HTMLInputElement).checked), deviceChanged()) }) as HTMLInputElement;
    deviceListeners.add(() => (c.checked = get()));
    c.checked = get();
    return h('label', { class: 'check', title }, c, label);
  };
  const devSel = h('select', { class: 'port', title: 'Gerät', onchange: (e: Event) => selectDevice(ed, (e.target as HTMLSelectElement).value) }) as HTMLSelectElement;
  const fillDevices = () => {
    devSel.textContent = '';
    for (const d of store.devices) devSel.append(h('option', { value: d.id }, `${d.name} (${FIRMWARES[d.fw].label})`));
    devSel.value = device.id;
  };
  root.append(
    h('div', { class: 'conn-row' }, devSel, h('button', { class: 'btn', title: 'Geräte hinzufügen, bearbeiten, löschen', onclick: () => openDevicesDialog(ed) }, 'Geräte …')),
    h('div', { class: 'laser-status' }, h('span', {}, dot, stTxt), posTxt),
    h('div', { class: 'conn-row' }, portSel, refreshBtn, connBtn),
    h('div', { class: 'laser-grid' }, startB, pauseB, stopB, frameB, contourB, homeB, originB, previewB, saveB),
    bar,
    progTxt,
    h('div', { class: 'form' },
      h('label', {}, 'Starten ab'), startFrom,
      h('label', {}, 'Job-Ursprung'), originGrid,
    ),
    h('div', { class: 'checks' },
      check('Nur Auswahl', 'Nur die ausgewählten Objekte lasern', () => device.cutSelected, (v) => (device.cutSelected = v)),
      check('Pfad optimieren', 'Innere Formen zuerst, kurze Leerwege', () => device.optimize, (v) => (device.optimize = v)),
    ),
    h('div', { class: 'conn-row' },
      h('button', { class: 'btn', onclick: () => openDeviceDialog(ed) }, h('span', { html: ICONS.settings }), 'Geräteeinstellungen'),
    ),
    msg,
  );
  let msgTimer = 0;
  notify = (m, error = false) => {
    machine.log(m, error ? 'error' : 'info');
    msg.textContent = m;
    msg.classList.toggle('error', error);
    clearTimeout(msgTimer);
    msgTimer = window.setTimeout(() => (msg.textContent = ''), 12000);
  };

  let ports: PortInfo[] = [];
  const NET = '__net__';
  const fillPorts = () => {
    portSel.textContent = '';
    const names = ports.map((p) => p.name);
    if (device.port && !names.includes(device.port)) names.unshift(device.port);
    for (const n of names) {
      const p = ports.find((x) => x.name === n);
      portSel.append(h('option', { value: n }, p?.description ? `${n} (${p.description})` : n));
    }
    if (!names.length) portSel.append(h('option', { value: '', disabled: true }, 'Keine serielle Schnittstelle gefunden'));
    portSel.append(h('option', { value: NET }, `WLAN: ${device.host}:${device.tcpPort}`));
    portSel.value = device.conn === 'tcp' ? NET : device.port || names[0] || NET;
  };
  const applyPortChoice = () => {
    if (portSel.value === NET) device.conn = 'tcp';
    else if (portSel.value) ((device.conn = 'serial'), (device.port = portSel.value));
    deviceChanged();
  };
  portSel.addEventListener('change', applyPortChoice);
  const loadPorts = async () => {
    try {
      ports = await machine.ports();
    } catch (e) {
      notify(`Schnittstellen konnten nicht gelesen werden: ${e}`, true);
    }
    fillPorts();
  };
  if (isTauri()) loadPorts();
  else fillPorts();

  const refresh = () => {
    const [t, cls] = stateText();
    stTxt.textContent = t + (machine.connected ? ` · ${machine.where}` : '');
    dot.className = `dot ${cls}`;
    const p = machine.connected ? machine.status.wpos : null;
    posTxt.textContent = p ? `X ${p[0].toFixed(2)}  Y ${p[1].toFixed(2)}` : '';
    devSel.disabled = machine.connected || machine.connecting;
    const on = machine.connected,
      busy = machine.busy;
    connBtn.textContent = on ? 'Trennen' : machine.connecting ? 'Verbinde …' : 'Verbinden';
    connBtn.disabled = machine.connecting || (!isTauri() && !on);
    portSel.disabled = on || machine.connecting || !isTauri();
    refreshBtn.disabled = portSel.disabled;
    for (const b of [startB, frameB, contourB, homeB, originB]) b.disabled = !on || busy;
    pauseB.disabled = !on;
    stopB.disabled = !on;
    const hold = machine.status.state.startsWith('Hold');
    pauseB.lastChild!.textContent = hold ? 'Weiter' : 'Pause';
    (pauseB.firstChild as HTMLElement).innerHTML = hold ? ICONS.play : ICONS.pause;
    const pr = machine.progress;
    const showProg = !!pr && !machine.jobIsFrame;
    bar.hidden = progTxt.hidden = !showProg;
    if (pr && showProg) {
      const f = pr.total ? pr.acked / pr.total : 0;
      (bar.firstChild as HTMLElement).style.width = `${(f * 100).toFixed(1)}%`;
      const rest = machine.remaining();
      const el = (performance.now() - machine.jobStarted) / 1000;
      progTxt.textContent = `${Math.floor(f * 100)} % · ${formatDuration(el)} vergangen${rest !== null ? ` · noch etwa ${formatDuration(rest)}` : ''}${pr.errors ? ` · ${pr.errors} Fehler` : ''}`;
    }
    startFrom.value = device.startFrom;
    originBtns.forEach((b, k) => b.classList.toggle('cur', k === device.jobOrigin));
    originGrid.classList.toggle('disabled', device.startFrom === 'absolute');
  };
  machine.on((e) => {
    if (e.type === 'done') notify(e.message, !e.ok);
    if (e.type !== 'line') refresh();
  });
  deviceListeners.add(() => (fillDevices(), fillPorts(), refresh()));
  fillDevices();
  // Fortschrittstext auch ohne neue Ereignisse aktualisieren (vergangene Zeit)
  setInterval(() => machine.progress && refresh(), 1000);
  refresh();
  return root;
}

// ---------- Verschieben ----------

function moveTab(ed: Editor): HTMLElement {
  const root = h('div', { class: 'move-tab' });
  const st = { step: 10, speed: 3000 };
  const jog = (dx: number, dy: number) => {
    if (!machine.connected) return notify('Nicht verbunden.', true);
    for (const l of fw().jog(dx * st.step, dy * st.step, st.speed)) machine.send(l);
  };
  const pad = h('div', { class: 'jog' });
  const arrows: [number, number, string][] = [
    [-1, 1, '↖'], [0, 1, '↑'], [1, 1, '↗'],
    [-1, 0, '←'], [0, 0, '⌖'], [1, 0, '→'],
    [-1, -1, '↙'], [0, -1, '↓'], [1, -1, '↘'],
  ];
  for (const [dx, dy, label] of arrows)
    pad.append(
      h('button', {
        class: 'btn',
        title: dx || dy ? `${st.step} mm verfahren` : 'Zum Nullpunkt fahren',
        onclick: () => (dx || dy ? jog(dx, dy) : machine.send('G0 X0 Y0')),
      }, label),
    );
  const stepSel = h('select', { onchange: (e: Event) => (st.step = Number((e.target as HTMLSelectElement).value)) },
    ...[0.1, 1, 5, 10, 50, 100].map((v) => h('option', { value: String(v), selected: v === st.step }, `${String(v).replace('.', ',')} mm`)),
  );
  const speed = numInput('', (v) => v > 0 && (st.speed = v), 'Geschwindigkeit in mm/min');
  speed.value = String(st.speed);
  const pos = h('div', { class: 'move-pos' });
  const toSelection = () => {
    const b = ed.selBounds();
    if (!b) return notify('Keine Auswahl.', true);
    const box = { x0: b.x, y0: ed.doc.bed.h - b.y - b.h, x1: b.x + b.w, y1: ed.doc.bed.h - b.y };
    const a = anchorOf(box, device.jobOrigin);
    machine.send(`G0 X${a.x.toFixed(3)} Y${a.y.toFixed(3)}`);
  };
  const setO = h('button', { class: 'btn', title: 'Werkstück-Nullpunkt an die aktuelle Position legen', onclick: () => machine.send(fw().setOrigin) }, 'Ursprung hier setzen') as HTMLButtonElement;
  const clearO = h('button', { class: 'btn', title: 'Werkstück-Nullpunkt auf den Maschinen-Nullpunkt zurücksetzen', onclick: () => fw().clearOrigin && machine.send(fw().clearOrigin!) }, 'Ursprung löschen') as HTMLButtonElement;
  const unlock = h('button', { class: 'btn', title: 'Alarm aufheben', onclick: () => fw().unlock && machine.send(fw().unlock!) }, 'Entsperren') as HTMLButtonElement;
  root.append(
    pos,
    h('div', { class: 'move-row' }, pad,
      h('div', { class: 'form move-form' },
        h('label', {}, 'Schritt'), stepSel,
        h('label', {}, 'mm/min'), speed,
      ),
    ),
    h('div', { class: 'move-buttons' },
      setO,
      clearO,
      h('button', { class: 'btn', title: 'Laser zum Job-Ursprung der Auswahl fahren (absolute Koordinaten)', onclick: toSelection }, 'Laser zur Auswahl'),
      unlock,
    ),
  );
  const refresh = () => {
    const s = machine.status;
    pos.textContent = machine.connected && s.wpos
      ? `Position X ${s.wpos[0].toFixed(2)}  Y ${s.wpos[1].toFixed(2)} mm` + (s.mpos && (Math.abs(s.mpos[0] - s.wpos[0]) > 1e-3 || Math.abs(s.mpos[1] - s.wpos[1]) > 1e-3) ? ` (Maschine ${s.mpos[0].toFixed(2)} / ${s.mpos[1].toFixed(2)})` : '')
      : 'Nicht verbunden';
    root.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = !machine.connected || machine.busy));
    if (!fw().clearOrigin) clearO.disabled = true;
    if (!fw().unlock) unlock.disabled = true;
  };
  machine.on((e) => e.type !== 'line' && refresh());
  deviceListeners.add(refresh);
  refresh();
  return root;
}

// ---------- Konsole ----------

function consoleTab(): HTMLElement {
  const root = h('div', { class: 'console-tab' });
  const log = h('div', { class: 'console-log' });
  const input = h('input', { type: 'text', placeholder: 'Befehl, z. B. $I oder G0 X10', spellcheck: false }) as HTMLInputElement;
  const history: string[] = [];
  let hi = 0;
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && input.value.trim()) {
      const v = input.value.trim();
      history.push(v);
      hi = history.length;
      input.value = '';
      if (v === '?' && fw().realtime) machine.realtime(0x3f);
      else machine.send(v);
    } else if (e.key === 'ArrowUp' && hi > 0) {
      e.preventDefault();
      input.value = history[--hi];
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      hi = Math.min(history.length, hi + 1);
      input.value = history[hi] ?? '';
    }
  });
  const quick = (label: string, cmd: string, title: string) => h('button', { class: 'btn', title, onclick: () => machine.send(cmd) }, label);
  const quickRow = h('div', { class: 'console-quick' });
  // Schnellknöpfe passend zur Firmware des gewählten Geräts
  const fillQuick = () => {
    quickRow.textContent = '';
    const f = fw();
    if (device.fw === 'marlin') quickRow.append(quick('M115', 'M115', 'Firmware-Version'), quick('M114', 'M114', 'Position'), quick('M503', 'M503', 'Einstellungen anzeigen'));
    else {
      if (f.unlock) quickRow.append(quick(f.unlock, f.unlock, 'Entsperren'));
      quickRow.append(quick(f.home, f.home, 'Referenzfahrt'));
      if (device.fw !== 'smoothie') quickRow.append(quick('$I', '$I', 'Version und Gerät'), quick('$$', '$$', 'Einstellungen anzeigen'));
    }
    quickRow.append(h('button', { class: 'btn', title: 'Konsole leeren', onclick: () => (log.textContent = '') }, 'Leeren'));
  };
  fillQuick();
  deviceListeners.add(fillQuick);
  root.append(log, h('div', { class: 'console-input' }, input), quickRow);
  machine.on((e) => {
    if (e.type !== 'line') return;
    const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
    log.append(h('div', { class: `ln ${e.dir}` }, e.dir === 'out' ? `> ${e.line}` : e.line));
    while (log.childElementCount > 1000) log.firstChild!.remove();
    if (atEnd) log.scrollTop = log.scrollHeight;
  });
  if (!isTauri()) machine.log('Im Browser gibt es keine Maschinenanbindung. Vorschau und G-Code speichern funktionieren.');
  return root;
}

// ---------- Geräteeinstellungen ----------

/** Einstellungen eines Geräts bearbeiten (ohne Angabe: das gewählte) */
export function openDeviceDialog(ed: Editor, target: Device = device, onDone?: () => void) {
  const d = { ...target };
  const bed = { w: d.bedW, h: d.bedH };
  const isCurrent = target === device;
  const rows: (HTMLElement | string)[] = [];
  const num = (label: string, get: () => number, set: (v: number) => void, title?: string) => {
    const el = numInput('', (v) => v > 0 && set(v), title);
    el.value = String(get());
    rows.push(h('label', { title }, label), el);
    return el;
  };
  const text = (label: string, get: () => string, set: (v: string) => void) => {
    const el = h('input', { type: 'text', value: get(), oninput: (e: Event) => set((e.target as HTMLInputElement).value) }) as HTMLInputElement;
    rows.push(h('label', {}, label), el);
  };
  const bool = (label: string, get: () => boolean, set: (v: boolean) => void, title?: string) => {
    const el = h('input', { type: 'checkbox', checked: get(), onchange: (e: Event) => set((e.target as HTMLInputElement).checked) });
    rows.push(h('label', { title }, label), h('span', {}, el));
  };
  const head = (t: string) => rows.push(h('div', { class: 'sub' }, t));
  head('Gerät');
  text('Name', () => d.name, (v) => (d.name = v));
  const sMaxRef: { el?: HTMLInputElement } = {};
  const fwSel = h('select', {
    onchange: (e: Event) => {
      const old = FIRMWARES[d.fw];
      d.fw = (e.target as HTMLSelectElement).value as Firmware;
      // Leistungsskala mitziehen, wenn sie noch dem Standard der alten Firmware entsprach
      if (d.sMax === old.sMax && sMaxRef.el) ((d.sMax = FIRMWARES[d.fw].sMax), (sMaxRef.el.value = String(d.sMax)));
      readBtn.disabled = !canRead();
    },
  }, ...(Object.keys(FIRMWARES) as Firmware[]).map((k) => h('option', { value: k, selected: k === d.fw }, FIRMWARES[k].label))) as HTMLSelectElement;
  rows.push(h('label', {}, 'Steuerung (Firmware)'), fwSel);
  const bw = num('Breite (mm)', () => bed.w, (v) => (bed.w = v), 'Arbeitsbereich X');
  const bh = num('Höhe (mm)', () => bed.h, (v) => (bed.h = v), 'Arbeitsbereich Y');
  sMaxRef.el = num('S-Wert für 100 %', () => d.sMax, (v) => (d.sMax = v), 'GRBL $30 bzw. FluidNC speed_map (meist 1000), Marlin meist 255, Smoothieware 1');
  head('Verbindung');
  rows.push(h('label', {}, 'Anschluss'), h('select', { onchange: (e: Event) => (d.conn = (e.target as HTMLSelectElement).value as Device['conn']) },
    h('option', { value: 'serial', selected: d.conn === 'serial' }, 'USB (seriell)'),
    h('option', { value: 'tcp', selected: d.conn === 'tcp' }, 'WLAN (Telnet)'),
  ));
  // Schnittstelle frei eintragbar (z. B. COM3, /dev/ttyUSB0), erkannte Schnittstellen als Vorschlag
  const portList = h('datalist', { id: `ports-${Math.random().toString(36).slice(2)}` });
  const portIn = h('input', { type: 'text', value: d.port, placeholder: 'z. B. COM3 oder /dev/ttyUSB0', oninput: (e: Event) => (d.port = (e.target as HTMLInputElement).value.trim()) });
  portIn.setAttribute('list', portList.id);
  rows.push(h('label', { title: 'Feste USB-Schnittstelle dieses Geräts' }, 'USB-Schnittstelle'), portIn, portList);
  machine.ports().then((ps) => ps.forEach((p) => portList.append(h('option', { value: p.name }, p.description || p.name)))).catch(() => {});
  const baud = h('select', { onchange: (e: Event) => (d.baud = Number((e.target as HTMLSelectElement).value)) },
    ...[57600, 115200, 230400, 250000, 460800, 921600].map((b) => h('option', { value: String(b), selected: b === d.baud }, String(b))),
  );
  rows.push(h('label', {}, 'Baudrate'), baud);
  text('WLAN-Adresse', () => d.host, (v) => (d.host = v.trim()));
  num('Telnet-Port', () => d.tcpPort, (v) => (d.tcpPort = Math.round(v)));
  bool('Beim Verbinden referenzieren', () => d.homeOnConnect, (v) => (d.homeOnConnect = v), 'Nach dem Verbinden eine Referenzfahrt starten');
  head('Bewegung (für die Zeitschätzung)');
  const rapid = num('Eilgang (mm/min)', () => d.rapid, (v) => (d.rapid = v));
  const accel = num('Beschleunigung (mm/s²)', () => d.accel, (v) => (d.accel = v));
  bool('Nach dem Job zurück zum Start', () => d.returnHome, (v) => (d.returnHome = v));
  head('Rahmen');
  num('Geschwindigkeit (mm/min)', () => d.frameSpeed, (v) => (d.frameSpeed = v));
  bool('Mit Laser (schwach)', () => d.frameLaser, (v) => (d.frameLaser = v), 'Rahmen mit niedriger Leistung sichtbar machen');
  num('Leistung (%)', () => d.framePower, (v) => (d.framePower = Math.min(100, v)));
  head('Air Assist');
  rows.push(h('label', { title: 'Wird auf Layern mit „Air Assist“ vor dem Lasern gesendet, ausgeschaltet wird mit M9' }, 'Einschalten mit'), h('select', { onchange: (e: Event) => (d.airCmd = (e.target as HTMLSelectElement).value as Device['airCmd']) },
    h('option', { value: 'M8', selected: d.airCmd !== 'M7' }, 'M8 (Flood, üblich)'),
    h('option', { value: 'M7', selected: d.airCmd === 'M7' }, 'M7 (Mist)'),
  ));
  const readNote = h('div', { class: 'note' });
  // Lesen nur vom verbundenen Gerät und nur bei FluidNC und GRBL-artigen Steuerungen
  const canRead = () => isCurrent && machine.connected && !machine.busy && FIRMWARES[d.fw].read !== null;
  const readBtn: HTMLButtonElement = h('button', {
    class: 'btn',
    disabled: !canRead(),
    title: 'Arbeitsbereich, Eilgang, Beschleunigung und Leistungsskala aus der Steuerung lesen (FluidNC, GRBL, grblHAL)',
    onclick: () => {
      readNote.textContent = 'Lese Einstellungen …';
      const got: Record<string, number> = {};
      const off = machine.on((e) => {
        if (e.type !== 'line') return;
        // FluidNC: $/axes/x/max_travel_mm=400.000 · GRBL: $130=400.000
        let m = /\/axes\/([xy])\/(max_travel_mm|max_rate_mm_per_min|acceleration_mm_per_sec2)\s*[=:]\s*([\d.]+)/i.exec(e.line);
        if (m) got[`${m[1].toLowerCase()}.${m[2]}`] = Number(m[3]);
        m = /^\$(30|11[01]|12[01]|13[01])=([\d.]+)/.exec(e.line);
        if (m) {
          const key: Record<string, string> = { '30': 'smax', '110': 'x.max_rate_mm_per_min', '111': 'y.max_rate_mm_per_min', '120': 'x.acceleration_mm_per_sec2', '121': 'y.acceleration_mm_per_sec2', '130': 'x.max_travel_mm', '131': 'y.max_travel_mm' };
          got[key[m[1]]] = Number(m[2]);
        }
      });
      if (FIRMWARES[d.fw].read === 'fluidnc') {
        for (const ax of ['x', 'y']) for (const k of ['max_travel_mm', 'max_rate_mm_per_min', 'acceleration_mm_per_sec2']) machine.send(`$/axes/${ax}/${k}`);
      } else machine.send('$$');
      setTimeout(() => {
        off();
        const found: string[] = [];
        if (got['x.max_travel_mm'] && got['y.max_travel_mm']) {
          bed.w = got['x.max_travel_mm'];
          bed.h = got['y.max_travel_mm'];
          bw.value = String(bed.w);
          bh.value = String(bed.h);
          found.push(`Arbeitsbereich ${bed.w} × ${bed.h} mm`);
        }
        const r = Math.min(got['x.max_rate_mm_per_min'] || Infinity, got['y.max_rate_mm_per_min'] || Infinity);
        if (isFinite(r)) ((d.rapid = r), (rapid.value = String(r)), found.push(`Eilgang ${r} mm/min`));
        const a = Math.min(got['x.acceleration_mm_per_sec2'] || Infinity, got['y.acceleration_mm_per_sec2'] || Infinity);
        if (isFinite(a)) ((d.accel = a), (accel.value = String(a)), found.push(`Beschleunigung ${a} mm/s²`));
        if (got.smax && sMaxRef.el) ((d.sMax = got.smax), (sMaxRef.el.value = String(got.smax)), found.push(`S-Wert für 100 % ${got.smax}`));
        readNote.textContent = found.length ? `Gelesen: ${found.join(', ')}. Mit „Übernehmen“ speichern.` : 'Keine Werte erhalten. Details stehen in der Konsole.';
      }, 2500);
    },
  }, 'Von der Maschine lesen');
  const dlg = h('dialog', { class: 'device-dialog' },
    h('h3', {}, `Geräteeinstellungen: ${target.name}`),
    h('div', { class: 'form' }, ...rows),
    h('div', { class: 'conn-row' }, readBtn),
    readNote,
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, 'Abbrechen'),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          // Felder, die noch den Fokus haben, zuerst übernehmen
          (document.activeElement as HTMLElement | null)?.blur();
          Object.assign(target, d, { bedW: bed.w, bedH: bed.h });
          if (isCurrent) applyBed(ed);
          deviceChanged();
          dlg.close();
          onDone?.();
        },
      }, 'Übernehmen'),
    ),
  );
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
}

// ---------- Geräteliste ----------

/** Geräte verwalten: aus Vorlagen anlegen, bearbeiten, kopieren, löschen, auswählen */
export function openDevicesDialog(ed: Editor) {
  const list = h('table', { class: 'devices' });
  const fill = () => {
    list.textContent = '';
    list.append(h('tr', {}, h('th', {}), h('th', {}, 'Name'), h('th', {}, 'Steuerung'), h('th', {}, 'Bereich (mm)'), h('th', {})));
    for (const d of store.devices) {
      const radio = h('input', {
        type: 'radio', name: 'cur-device', checked: d === device, title: 'Dieses Gerät verwenden',
        disabled: machine.connected || machine.connecting,
        onchange: () => (selectDevice(ed, d.id), fill()),
      });
      const btn = (label: string, title: string, f: () => void, disabled = false) => h('button', { class: 'btn', title, disabled, onclick: f }, label);
      list.append(h('tr', { class: d === device ? 'active' : '' },
        h('td', {}, radio),
        h('td', {}, d.name),
        h('td', {}, FIRMWARES[d.fw].label),
        h('td', {}, `${d.bedW} × ${d.bedH}`),
        h('td', {}, h('div', { class: 'actions' },
          btn('Bearbeiten', 'Einstellungen dieses Geräts', () => openDeviceDialog(ed, d, fill)),
          btn('Kopieren', 'Als neues Gerät kopieren', () => {
            store.devices.push({ ...d, id: newDevice(d).id, name: `${d.name} (Kopie)` });
            deviceChanged();
            fill();
          }),
          btn('Löschen', store.devices.length < 2 ? 'Das letzte Gerät kann nicht gelöscht werden' : 'Gerät löschen', () => {
            if (!confirm(`Gerät „${d.name}“ löschen?`)) return;
            store.devices = store.devices.filter((x) => x !== d);
            if (d === device) selectDevice(ed, store.devices[0].id);
            deviceChanged();
            fill();
          }, store.devices.length < 2 || (d === device && (machine.connected || machine.connecting))),
        )),
      ));
    }
  };
  const presetSel = h('select', {},
    ...PRESETS.map((p, i) => h('option', { value: String(i) }, `${p.name} · ${FIRMWARES[p.fw].label}`)),
  ) as HTMLSelectElement;
  const add = () => {
    const d = newDevice(PRESETS[Number(presetSel.value)]);
    store.devices.push(d);
    deviceChanged();
    fill();
    openDeviceDialog(ed, d, fill);
  };
  const dlg = h('dialog', { class: 'devices-dialog' },
    h('h3', {}, 'Geräte'),
    list,
    h('div', { class: 'conn-row' }, h('label', {}, 'Neues Gerät aus Vorlage'), presetSel, h('button', { class: 'btn primary', onclick: add }, 'Hinzufügen')),
    h('div', { class: 'note' }, 'Die Maße der Vorlagen stammen aus den Herstellerangaben. Bitte vor dem ersten Job prüfen, am einfachsten mit „Von der Maschine lesen“ in den Geräteeinstellungen (FluidNC, GRBL, grblHAL).'),
    h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => dlg.close() }, 'Schließen')),
  );
  fill();
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
}

// ---------- Vorschau ----------

export async function openPreview(ed: Editor, src?: JobSource) {
  const job = await makeJob(ed, true, src);
  if (nothingToDo(job)) return;
  const est = estimate(job.moves, device);
  const mv = job.moves;
  const bed = ed.doc.bed;
  const cv = h('canvas', { class: 'preview-canvas' }) as HTMLCanvasElement;
  const acc = document.createElement('canvas');
  const slider = h('input', { type: 'range', min: '0', max: '1000', value: '1000', step: '1' }) as HTMLInputElement;
  const timeTxt = h('span', { class: 'preview-time' });
  const playBtn = h('button', { class: 'btn', title: 'Abspielen' }, h('span', { html: ICONS.play }));
  const speedSel = h('select', { title: 'Abspielgeschwindigkeit' },
    ...[1, 2, 5, 10, 20, 50, 100, 200].map((v) => h('option', { value: String(v), selected: v === 10 }, `${v}×`)),
  ) as HTMLSelectElement;
  const rapidChk = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  const shadeChk = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  const stat = (k: string, v: string) => [h('dt', {}, k), h('dd', {}, v)];
  const b = job.bounds!;
  const info = h('dl', { class: 'preview-stats' },
    ...stat('Geschätzte Dauer', formatDuration(est.total)),
    ...stat('Laserweg', `${(est.cutLength / 1000).toFixed(2)} m`),
    ...stat('Leerweg', `${(est.rapidLength / 1000).toFixed(2)} m`),
    ...stat('Bereich', `${(b.x1 - b.x0).toFixed(1)} × ${(b.y1 - b.y0).toFixed(1)} mm`),
    ...stat('Bewegungen', mv.n.toLocaleString('de-DE')),
  );
  const warn = h('div', { class: 'note' }, ...job.warnings.map((w) => h('div', {}, w)));
  const dlg = h('dialog', { class: 'preview-dialog' },
    h('div', { class: 'preview-main' },
      cv,
      h('div', { class: 'preview-side' },
        h('h3', {}, 'Vorschau'),
        info,
        h('label', { class: 'check' }, rapidChk, 'Leerwege zeigen'),
        h('label', { class: 'check' }, shadeChk, 'Nach Leistung schattieren'),
        warn,
        h('div', { class: 'note' }, 'Mausrad zoomt, Ziehen verschiebt, Doppelklick passt ein. Die Zeit ist eine Schätzung aus Eilgang und Beschleunigung in den Geräteeinstellungen.'),
        h('div', { class: 'dialog-buttons' },
          h('button', { class: 'btn', onclick: () => saveGCode(ed, src) }, 'G-Code speichern'),
          h('button', { class: 'btn primary', onclick: () => dlg.close() }, 'Schließen'),
        ),
      ),
    ),
    h('div', { class: 'preview-bar' }, playBtn, slider, timeTxt, speedSel),
  );
  document.body.append(dlg);
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  dlg.showModal();

  // Ansicht: mm → Pixel, y nach oben
  let view = { z: 1, ox: 0, oy: 0 };
  let W = 0,
    H = 0,
    dpr = 1;
  const fit = () => {
    const r = cv.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    cv.width = acc.width = W * dpr;
    cv.height = acc.height = H * dpr;
    const bx0 = Math.min(0, job.travel?.x0 ?? 0),
      by0 = Math.min(0, job.travel?.y0 ?? 0),
      bx1 = Math.max(bed.w, job.travel?.x1 ?? 0),
      by1 = Math.max(bed.h, job.travel?.y1 ?? 0);
    const z = Math.min((W - 30) / (bx1 - bx0), (H - 30) / (by1 - by0));
    view = { z, ox: (W - (bx1 - bx0) * z) / 2 - bx0 * z, oy: (H + (by1 - by0) * z) / 2 + by0 * z };
    accN = 0;
  };
  const sx = (x: number) => x * view.z + view.ox;
  const sy = (y: number) => view.oy - y * view.z;

  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const css = getComputedStyle(document.documentElement);
  const bedColor = css.getPropertyValue('--surface').trim() || '#fff';
  const lineColor = css.getPropertyValue('--line').trim() || '#ccc';
  const colorOf = (layer: number) => (layer < 0 ? '#888' : src ? src.color(layer) : ed.layerDrawColor(layer));

  // Schattierung relativ zur höchsten Leistung des Layers, damit Graustufenbilder auch bei wenig Leistung lesbar sind
  const maxS = new Map<number, number>();
  for (let i = 0; i < mv.n; i++) if (mv.s[i] > (maxS.get(mv.layer[i]) ?? 0)) maxS.set(mv.layer[i], mv.s[i]);

  /** Bewegungen bis Index n (ausschließlich) in den Zwischenspeicher zeichnen, ab dem bereits gezeichneten Stand */
  let accN = 0;
  const drawUpTo = (n: number) => {
    const c = acc.getContext('2d')!;
    if (n < accN || accN === 0) {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = dark ? '#15171b' : '#d9dce1';
      c.fillRect(0, 0, W, H);
      c.fillStyle = bedColor;
      c.fillRect(sx(0), sy(bed.h), bed.w * view.z, bed.h * view.z);
      c.strokeStyle = lineColor;
      c.lineWidth = 1;
      c.strokeRect(sx(0), sy(bed.h), bed.w * view.z, bed.h * view.z);
      accN = 0;
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.lineWidth = Math.max(1, Math.min(3, view.z * 0.1));
    const batches = new Map<string, Path2D>();
    const rapids = new Path2D();
    let px = accN ? mv.x[accN - 1] : mv.x0,
      py = accN ? mv.y[accN - 1] : mv.y0;
    for (let i = accN; i < n; i++) {
      const x = mv.x[i],
        y = mv.y[i];
      if (mv.f[i] === 0 || mv.s[i] === 0) {
        if (mv.f[i] === 0 && rapidChk.checked) {
          rapids.moveTo(sx(px), sy(py));
          rapids.lineTo(sx(x), sy(y));
        }
      } else {
        const lvl = shadeChk.checked ? Math.max(1, Math.round((mv.s[i] / (maxS.get(mv.layer[i]) || 1)) * 16)) : 16;
        const key = `${mv.layer[i]}|${lvl}`;
        let p = batches.get(key);
        if (!p) batches.set(key, (p = new Path2D()));
        p.moveTo(sx(px), sy(py));
        p.lineTo(sx(x), sy(y));
      }
      px = x;
      py = y;
    }
    for (const [key, p] of batches) {
      const [layer, lvl] = key.split('|').map(Number);
      c.strokeStyle = colorOf(layer);
      c.globalAlpha = 0.1 + (0.9 * lvl) / 16;
      c.stroke(p);
    }
    c.globalAlpha = 1;
    if (rapidChk.checked) {
      c.strokeStyle = 'rgba(230,60,40,0.55)';
      c.lineWidth = 1;
      c.setLineDash([3, 3]);
      c.stroke(rapids);
      c.setLineDash([]);
    }
    accN = n;
  };

  let time = est.total;
  const indexAt = (t: number) => {
    let lo = 0,
      hi = mv.n;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (est.t[m] < t) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  const render = () => {
    const i = indexAt(time);
    drawUpTo(Math.min(i, mv.n));
    const c = cv.getContext('2d')!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(acc, 0, 0);
    // Laserkopf mit Teilstück der aktuellen Bewegung
    let hx = mv.x0,
      hy = mv.y0;
    if (i < mv.n) {
      const t0 = i ? est.t[i - 1] : 0,
        t1 = est.t[i];
      const f = t1 > t0 ? Math.min(1, Math.max(0, (time - t0) / (t1 - t0))) : 1;
      const ax = i ? mv.x[i - 1] : mv.x0,
        ay = i ? mv.y[i - 1] : mv.y0;
      hx = ax + (mv.x[i] - ax) * f;
      hy = ay + (mv.y[i] - ay) * f;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (mv.f[i] > 0 && mv.s[i] > 0) {
        c.strokeStyle = colorOf(mv.layer[i]);
        c.lineWidth = Math.max(1, Math.min(3, view.z * 0.1));
        c.beginPath();
        c.moveTo(sx(ax), sy(ay));
        c.lineTo(sx(hx), sy(hy));
        c.stroke();
      }
    } else if (mv.n) {
      hx = mv.x[mv.n - 1];
      hy = mv.y[mv.n - 1];
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.strokeStyle = '#e02020';
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(sx(hx), sy(hy), 5, 0, Math.PI * 2);
    c.stroke();
    timeTxt.textContent = `${formatDuration(time)} / ${formatDuration(est.total)}`;
    slider.value = String(est.total ? Math.round((time / est.total) * 1000) : 1000);
  };

  let playing = false,
    last = 0;
  const step = (now: number) => {
    if (!playing || !dlg.open) return;
    time = Math.min(est.total, time + ((now - last) / 1000) * Number(speedSel.value));
    last = now;
    render();
    if (time >= est.total) return setPlaying(false);
    requestAnimationFrame(step);
  };
  const setPlaying = (p: boolean) => {
    playing = p;
    playBtn.innerHTML = p ? ICONS.pause : ICONS.play;
    if (p) {
      if (time >= est.total) time = 0;
      last = performance.now();
      requestAnimationFrame(step);
    }
  };
  playBtn.addEventListener('click', () => setPlaying(!playing));
  slider.addEventListener('input', () => {
    time = (Number(slider.value) / 1000) * est.total;
    render();
  });
  const redrawAll = () => ((accN = 0), render());
  rapidChk.addEventListener('change', redrawAll);
  shadeChk.addEventListener('change', redrawAll);

  // Zoomen und Verschieben
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    const mx = e.clientX - r.left,
      my = e.clientY - r.top;
    const k = e.deltaY < 0 ? 1.25 : 0.8;
    view.ox = mx - (mx - view.ox) * k;
    view.oy = my - (my - view.oy) * k;
    view.z *= k;
    redrawAll();
  }, { passive: false });
  let drag: { x: number; y: number } | null = null;
  cv.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    view.ox += e.clientX - drag.x;
    view.oy += e.clientY - drag.y;
    drag = { x: e.clientX, y: e.clientY };
    redrawAll();
  });
  cv.addEventListener('pointerup', () => (drag = null));
  cv.addEventListener('dblclick', () => (fit(), render()));
  const ro = new ResizeObserver(() => (fit(), render()));
  ro.observe(cv);
  dlg.addEventListener('close', () => {
    playing = false;
    ro.disconnect();
    dlg.remove();
  });
}
