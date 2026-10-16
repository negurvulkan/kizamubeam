// Kamera-Oberfläche: Tab im Laser-Panel, Kamerabild auf der Arbeitsfläche und Kalibrier-Assistent.
import type { Editor } from './editor';
import { h, numInput } from './dom';
import { ICONS } from './icons';
import { saveText } from './files';
import { defaultLayer, loadDoc, Obj, Pt, translate } from './model';
import { buildJob, estimate, writeGCode } from './gcode';
import { machine } from './machine';
import { device } from './laser';
import {
  bedToPixel, buildRemap, calibFits, calibrate, CameraCalib, cameraError, CameraSettings, CameraStream, DEFAULT_CAMERA,
  markPositions, MarkSettings, Remap, warp,
} from './camera';
import { dec, t, tn } from './i18n';

// ---------- Einstellungen je Gerät ----------

const STORE_KEY = 'laserwerk.camera';
let store: Record<string, CameraSettings> = {};
try {
  store = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
} catch {
  /* leer */
}
/** Kamera-Einstellungen des gewählten Geräts (Kalibrierung gehört zur Maschine, an der die Kamera hängt) */
function cfg(): CameraSettings {
  const id = device.id;
  const s = store[id];
  if (!s) return (store[id] = structuredClone(DEFAULT_CAMERA));
  if (!s.marks) s.marks = { ...DEFAULT_CAMERA.marks };
  return s;
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* nicht speicherbar */
  }
}

const RESOLUTIONS: [number, number][] = [
  [1280, 720],
  [1920, 1080],
  [2592, 1944],
  [3264, 2448],
  [3840, 2160],
];

// ---------- Kamerabild auf dem Bett ----------

const cam = new CameraStream();
const overlay = document.createElement('canvas');
let overlayReady = false;
let remap: Remap | null = null;
let remapKey = '';
let liveTimer = 0;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

function currentRemap(ed: Editor): Remap | null {
  const c = cfg().calib;
  const w = cam.width,
    hh = cam.height;
  if (!c || !w || !hh || !calibFits(c, w, hh)) return null;
  const { w: bw, h: bh } = ed.doc.bed;
  const key = `${c.date}|${w}x${hh}|${bw}x${bh}`;
  if (key !== remapKey) {
    remap = buildRemap(c, w, hh, bw, bh);
    remapKey = key;
  }
  return remap;
}

/** Neues Kamerabild holen und entzerrt auf das Bett legen */
function updateOverlay(ed: Editor): boolean {
  const frame = cam.grab();
  const r = currentRemap(ed);
  if (!frame || !r) return false;
  const src = frame.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, frame.width, frame.height);
  if (overlay.width !== r.w || overlay.height !== r.h) ((overlay.width = r.w), (overlay.height = r.h));
  const octx = overlay.getContext('2d')!;
  const out = octx.createImageData(r.w, r.h);
  warp(src, r, out);
  octx.putImageData(out, 0, 0);
  overlayReady = true;
  ed.redraw();
  return true;
}

function setLive(ed: Editor) {
  clearInterval(liveTimer);
  liveTimer = 0;
  const s = cfg();
  if (s.live && s.show && cam.open) liveTimer = window.setInterval(() => updateOverlay(ed), 500);
}

async function connect(ed: Editor) {
  const s = cfg();
  await cam.start(s.cam, s.width, s.height);
  // Gewählte Kamera merken (deviceId kann nach der ersten Freigabe erst feststehen)
  s.cam = cam.deviceId || s.cam;
  s.label = cam.label || s.label;
  save();
  // Belichtung braucht einen Moment
  setTimeout(() => updateOverlay(ed), 600);
  setLive(ed);
}

function disconnect(ed: Editor) {
  clearInterval(liveTimer);
  liveTimer = 0;
  cam.stop();
  overlayReady = false;
  ed.redraw();
}

// ---------- Tab im Laser-Panel ----------

export function cameraTab(ed: Editor): HTMLElement {
  ed.background = (ctx) => {
    const s = cfg();
    if (!s.show || !overlayReady || !s.calib) return;
    ctx.globalAlpha = s.opacity;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(overlay, 0, 0, ed.doc.bed.w, ed.doc.bed.h);
    ctx.globalAlpha = 1;
  };

  const root = h('div', { class: 'camera-tab' });
  const camSel = h('select', { title: t('Kamera') }) as HTMLSelectElement;
  const resSel = h('select', { title: t('Gewünschte Auflösung (die Kamera nimmt die nächstmögliche)') }) as HTMLSelectElement;
  const connBtn = h('button', { class: 'btn' }, t('Verbinden')) as HTMLButtonElement;
  const dot = h('span', { class: 'dot' });
  const stTxt = h('span', {});
  const calTxt = h('div', { class: 'note' });
  const msg = h('div', { class: 'note' });
  const preview = h('div', { class: 'camera-preview' });
  preview.append(cam.video);
  const show = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const live = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const opacity = h('input', { type: 'range', min: '0.1', max: '1', step: '0.05' }) as HTMLInputElement;
  const updBtn = h('button', { class: 'btn', title: t('Neues Kamerabild auf die Arbeitsfläche legen') }, t('Bild aktualisieren')) as HTMLButtonElement;
  const calBtn = h('button', { class: 'btn', title: t('Linse und Lage der Kamera mit gelaserten Markierungen bestimmen') }, t('Kalibrieren …')) as HTMLButtonElement;
  const insBtn = h('button', { class: 'btn', title: t('Entzerrtes Kamerabild als Bildobjekt einfügen, z. B. zum Nachzeichnen') }, t('Als Bild einfügen')) as HTMLButtonElement;

  const say = (t: string, error = false) => {
    msg.textContent = t;
    msg.classList.toggle('error', error);
  };

  const loadCams = async () => {
    const s = cfg();
    let list: MediaDeviceInfo[] = [];
    try {
      list = await CameraStream.list();
    } catch {
      /* keine Liste */
    }
    camSel.textContent = '';
    if (!list.length) camSel.append(h('option', { value: s.cam }, s.label || t('Standardkamera')));
    list.forEach((d, i) =>
      camSel.append(h('option', { value: d.deviceId, selected: d.deviceId === s.cam || (!!s.label && d.label === s.label) }, d.label || t('Kamera {i}', { i: i + 1 }))),
    );
  };
  RESOLUTIONS.forEach(([w, hh]) => resSel.append(h('option', { value: `${w}x${hh}` }, `${w} × ${hh}`)));

  const refresh = () => {
    const s = cfg();
    resSel.value = `${s.width}x${s.height}`;
    show.checked = s.show;
    live.checked = s.live;
    opacity.value = String(s.opacity);
    connBtn.textContent = cam.open ? t('Trennen') : t('Verbinden');
    dot.className = `dot ${cam.open ? 'ok' : ''}`;
    stTxt.textContent = cam.open ? t('Verbunden, {width} × {height}', { width: cam.width, height: cam.height }) : t('Nicht verbunden');
    preview.hidden = !cam.open;
    const c = s.calib;
    if (!c) calTxt.textContent = t('Nicht kalibriert. Ohne Kalibrierung erscheint das Bild nicht auf der Arbeitsfläche.');
    else if (cam.open && !calibFits(c, cam.width, cam.height))
      calTxt.textContent = t('Kalibriert für {w} × {h}, die Kamera liefert {width} × {height}. Bitte dieselbe Auflösung wählen oder neu kalibrieren.', { w: c.w, h: c.h, width: cam.width, height: cam.height });
    else
      calTxt.textContent = t('Kalibriert und ausgerichtet (Restfehler ⌀ {err} mm, max. {maxErr} mm).', { err: dec(c.err.toFixed(2)), maxErr: dec(c.maxErr.toFixed(2)) });
    updBtn.disabled = insBtn.disabled = !cam.open || !c;
    calBtn.disabled = !cam.open;
  };
  listeners.add(refresh);

  camSel.addEventListener('change', async () => {
    const s = cfg();
    s.cam = camSel.value;
    s.label = camSel.selectedOptions[0]?.textContent ?? '';
    save();
    if (cam.open) await reconnect();
  });
  resSel.addEventListener('change', async () => {
    const [w, hh] = resSel.value.split('x').map(Number);
    const s = cfg();
    s.width = w;
    s.height = hh;
    save();
    if (cam.open) await reconnect();
  });
  const reconnect = async () => {
    say(t('Verbinde …'));
    try {
      await connect(ed);
      say('');
      await loadCams();
    } catch (e) {
      disconnect(ed);
      say(cameraError(e), true);
    }
    changed();
  };
  connBtn.addEventListener('click', async () => {
    if (cam.open) {
      disconnect(ed);
      changed();
    } else await reconnect();
  });
  show.addEventListener('change', () => {
    cfg().show = show.checked;
    save();
    setLive(ed);
    ed.redraw();
  });
  live.addEventListener('change', () => {
    cfg().live = live.checked;
    save();
    setLive(ed);
  });
  opacity.addEventListener('input', () => {
    cfg().opacity = Number(opacity.value);
    save();
    ed.redraw();
  });
  updBtn.addEventListener('click', () => {
    if (!updateOverlay(ed)) say(t('Kein Bild: Kamera verbunden und kalibriert?'), true);
    else if (!cfg().show) say(t('Das Kamerabild ist ausgeblendet („Auf der Arbeitsfläche zeigen“).'));
    else say('');
  });
  calBtn.addEventListener('click', () => openCalibration(ed));
  insBtn.addEventListener('click', async () => {
    if (!updateOverlay(ed)) return;
    const { w, h: bh } = ed.doc.bed;
    // Auf den Werkzeug-Layer T1: wird nicht gelasert
    await ed.importImageAt(overlay.toDataURL('image/png'), 0, 0, w, bh, t('Kamerabild'),
      t('Kamerabild auf Layer T1 eingefügt (wird nicht gelasert). Zum Nachzeichnen: Werkzeuge › Bild nachzeichnen (Alt+T).'), 30);
  });

  root.append(
    h('div', { class: 'laser-status' }, h('span', {}, dot, stTxt)),
    h('div', { class: 'form' },
      h('label', {}, t('Kamera')), h('div', { class: 'conn-row' }, camSel, h('button', { class: 'ib small', title: t('Kameras neu suchen'), html: ICONS.refresh, onclick: () => loadCams() })),
      h('label', {}, t('Auflösung')), resSel,
    ),
    h('div', { class: 'conn-row' }, connBtn, calBtn),
    preview,
    calTxt,
    h('div', { class: 'form' },
      h('label', { class: 'check' }, show, t('Auf der Arbeitsfläche zeigen')),
      h('label', {}, t('Deckkraft')), opacity,
      h('label', { class: 'check', title: t('Zweimal pro Sekunde ein neues Bild holen') }, live, t('Laufend aktualisieren')),
    ),
    h('div', { class: 'conn-row' }, updBtn, insBtn),
    msg,
  );
  loadCams();
  refresh();
  return root;
}

// ---------- Markierungen zum Kalibrieren ----------

/** Markierungen als Objekte (Weltkoordinaten): Kreis mit Kreuz, die erste mit zweitem Ring zum Wiedererkennen */
function markObjects(m: MarkSettings, bedW: number, bedH: number): Obj[] {
  const r = m.size / 2;
  const objs: Obj[] = [];
  markPositions(m, bedW, bedH).forEach((p, i) => {
    const at = translate(p.x, bedH - p.y);
    const ring = (rr: number): Obj => ({ id: 0, m: at, layer: 1, shape: { kind: 'ellipse', rx: rr, ry: rr } });
    objs.push(ring(r));
    if (i === 0) objs.push(ring(r * 0.55));
    objs.push({
      id: 0, m: at, layer: 1,
      shape: {
        kind: 'path',
        subs: [
          { nodes: [{ x: -r * 1.4, y: 0 }, { x: r * 1.4, y: 0 }], closed: false },
          { nodes: [{ x: 0, y: -r * 1.4 }, { x: 0, y: r * 1.4 }], closed: false },
        ],
      },
    });
  });
  return objs;
}

async function markGCode(ed: Editor, m: MarkSettings) {
  const { w, h: bh } = ed.doc.bed;
  const layer = { ...defaultLayer(1), mode: 'line' as const, speed: m.speed, power: m.power, passes: 1 };
  // Absolut zum Maschinennullpunkt, unabhängig von „Starten ab“: die Kalibrierung gilt für Bettkoordinaten
  const dev = { ...device, startFrom: 'absolute' as const, cutSelected: false };
  const job = await buildJob({
    doc: loadDoc({ bed: { w, h: bh }, objs: markObjects(m, w, bh), layers: { 1: layer } }),
    layer: () => layer,
    imgLayer: (i) => ed.imgLayer(i),
    device: dev,
  });
  return writeGCode(job, dev, estimate(job.moves, dev), t('Laserwerk Kamera-Markierungen'));
}

// ---------- Kalibrier-Assistent ----------

function openCalibration(ed: Editor) {
  const s = cfg();
  const m: MarkSettings = { ...s.marks };
  const { w: bedW, h: bedH } = ed.doc.bed;
  let targets = markPositions(m, bedW, bedH);
  /** Angeklickte Bildpunkte je Markierung (null = übersprungen / noch offen) */
  let clicks: (Pt | null)[] = targets.map(() => null);
  let cur = 0;
  let frame: HTMLCanvasElement | null = null;
  let lens = true;
  let result: CameraCalib | null = null;
  let mode: 'marks' | 'click' | 'check' = 'marks';

  const sketch = h('canvas', { class: 'cal-sketch', width: 220, height: 220 }) as HTMLCanvasElement;
  const view = h('canvas', { class: 'cal-view' }) as HTMLCanvasElement;
  const info = h('div', { class: 'note' });
  const resTxt = h('div', { class: 'cal-result' });

  // --- Schritt 1: Markierungen ---
  const nSel = h('select', {}, ...[[2, t('2 × 2 (nur Ausrichtung)')], [3, '3 × 3'], [4, t('4 × 4 (genauer)')], [5, '5 × 5']].map(([v, label]) =>
    h('option', { value: String(v), selected: v === m.n }, String(label)))) as HTMLSelectElement;
  const numField = (val: number, set: (v: number) => void) => {
    const el = numInput('', (v) => {
      if (v > 0) set(v);
      remark();
    });
    el.value = String(val);
    return el;
  };
  const remark = () => {
    targets = markPositions(m, bedW, bedH);
    clicks = targets.map(() => null);
    cur = 0;
    result = null;
    draw();
  };
  nSel.addEventListener('change', () => ((m.n = Number(nSel.value)), remark()));
  const burnBtn = h('button', { class: 'btn primary', title: t('Markierungen mit dem verbundenen Laser auf das Material lasern') }, t('Markierungen lasern')) as HTMLButtonElement;
  burnBtn.disabled = !machine.connected;
  burnBtn.addEventListener('click', async () => {
    if (!machine.connected || machine.busy) return void (info.textContent = machine.busy ? t('Es läuft bereits ein Auftrag.') : t('Nicht verbunden.'));
    const g = await markGCode(ed, m);
    info.textContent = t('Markierungen werden gelasert. Danach „Weiter“.');
    await machine.runJob(g.lines, g.times);
  });
  const saveBtn = h('button', { class: 'btn', title: t('Markierungen als G-Code-Datei speichern') }, t('Als G-Code speichern'));
  saveBtn.addEventListener('click', async () => {
    const g = await markGCode(ed, m);
    await saveText('kamera-markierungen.gcode', 'G-Code', 'gcode', 'text/plain', g.lines.join('\n') + '\n');
  });
  const step1 = h('div', { class: 'cal-step' },
    h('div', { class: 'form-title' }, t('1. Markierungen lasern')),
    h('p', { class: 'note' }, t('Ein flaches Stück Pappe oder Sperrholz auf das ganze Bett legen und den Laser fokussieren. Die Kamera muss fest montiert sein und darf sich nach der Kalibrierung nicht mehr bewegen.')),
    h('div', { class: 'form' },
      h('label', {}, t('Raster')), nSel,
      h('label', {}, t('Abstand zum Rand (mm)')), numField(m.margin, (v) => (m.margin = Math.min(v, Math.min(bedW, bedH) / 2 - 5))),
      h('label', {}, t('Durchmesser (mm)')), numField(m.size, (v) => (m.size = v)),
      h('label', {}, t('Geschwindigkeit (mm/min)')), numField(m.speed, (v) => (m.speed = v)),
      h('label', {}, t('Leistung (%)')), numField(m.power, (v) => (m.power = Math.min(100, v))),
    ),
    h('div', { class: 'conn-row' }, burnBtn, saveBtn),
    h('p', { class: 'note' }, t('Die Markierungen liegen an festen Bettpositionen (absolut zum Maschinennullpunkt). Markierung 1 hat einen zweiten Ring.')),
  );

  // --- Schritt 2: Anklicken ---
  const shotBtn = h('button', { class: 'btn primary' }, t('Foto aufnehmen')) as HTMLButtonElement;
  const skipBtn = h('button', { class: 'btn', title: t('Diese Markierung auslassen (z. B. verdeckt)') }, t('Überspringen')) as HTMLButtonElement;
  const backBtn = h('button', { class: 'btn', title: t('Zur vorigen Markierung') }, t('Zurück')) as HTMLButtonElement;
  const lensBox = h('input', { type: 'checkbox', checked: lens }) as HTMLInputElement;
  lensBox.addEventListener('change', () => ((lens = lensBox.checked), compute()));
  const checkBtn = h('button', { class: 'btn', title: t('Entzerrtes Bild mit den Sollpositionen der Markierungen zeigen') }, t('Prüfen')) as HTMLButtonElement;
  shotBtn.addEventListener('click', () => {
    const g = cam.grab();
    if (!g) return void (info.textContent = t('Kein Kamerabild.'));
    frame = document.createElement('canvas');
    frame.width = g.width;
    frame.height = g.height;
    frame.getContext('2d')!.drawImage(g, 0, 0);
    mode = 'click';
    fitView();
    compute();
  });
  skipBtn.addEventListener('click', () => {
    clicks[cur] = null;
    cur = Math.min(cur + 1, targets.length);
    compute();
  });
  backBtn.addEventListener('click', () => {
    cur = Math.max(0, cur - 1);
    draw();
  });
  checkBtn.addEventListener('click', () => {
    mode = mode === 'check' ? 'click' : 'check';
    fitView();
    draw();
  });
  const step2 = h('div', { class: 'cal-step' },
    h('div', { class: 'form-title' }, t('2. Markierungen anklicken')),
    h('p', { class: 'note' }, t('Foto aufnehmen, dann die Mitte jeder Markierung in der angezeigten Reihenfolge anklicken. Mausrad zoomt, rechte Maustaste verschiebt das Bild, gesetzte Punkte lassen sich ziehen.')),
    h('div', { class: 'conn-row' }, shotBtn, backBtn, skipBtn),
    h('label', { class: 'check' }, lensBox, t('Linsenverzeichnung korrigieren (ab 3 × 3)')),
    resTxt,
    h('div', { class: 'conn-row' }, checkBtn),
  );

  const saveCal = h('button', { class: 'btn primary', disabled: true }, t('Übernehmen')) as HTMLButtonElement;
  saveCal.addEventListener('click', () => {
    if (!result) return;
    s.calib = result;
    s.marks = { ...m };
    save();
    remapKey = '';
    updateOverlay(ed);
    setLive(ed);
    changed();
    dlg.close();
  });

  const dlg = h('dialog', { class: 'camera-dialog' },
    h('h3', {}, t('Kamera kalibrieren und ausrichten')),
    h('div', { class: 'cal-body' },
      h('div', { class: 'cal-left' }, sketch, step1, step2, info),
      h('div', { class: 'cal-right' }, view),
    ),
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      saveCal,
    ),
  );

  // --- Ansicht des Fotos: Zoom und Verschieben ---
  const vw = { z: 1, ox: 0, oy: 0 };
  let dragPt = -1;
  let pan: { x: number; y: number; ox: number; oy: number } | null = null;
  let mouse: Pt | null = null;
  const src = () => (mode === 'check' && result ? checkCanvas() : frame);
  const fitView = () => {
    const f = src();
    const r = view.getBoundingClientRect();
    if (!f || !r.width) return;
    vw.z = Math.min(r.width / f.width, r.height / f.height);
    vw.ox = (r.width - f.width * vw.z) / 2;
    vw.oy = (r.height - f.height * vw.z) / 2;
  };
  const toImg = (e: MouseEvent): Pt => {
    const r = view.getBoundingClientRect();
    return { x: (e.clientX - r.left - vw.ox) / vw.z, y: (e.clientY - r.top - vw.oy) / vw.z };
  };
  const toScr = (p: Pt): Pt => ({ x: p.x * vw.z + vw.ox, y: p.y * vw.z + vw.oy });

  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = view.getBoundingClientRect();
    const sx = e.clientX - r.left,
      sy = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * 0.0015);
    const z = Math.max(0.05, Math.min(40, vw.z * f));
    vw.ox = sx - ((sx - vw.ox) * z) / vw.z;
    vw.oy = sy - ((sy - vw.oy) * z) / vw.z;
    vw.z = z;
    draw();
  }, { passive: false });
  view.addEventListener('contextmenu', (e) => e.preventDefault());
  view.addEventListener('pointerdown', (e) => {
    if (!src()) return;
    view.setPointerCapture(e.pointerId);
    if (e.button === 2 || e.button === 1) {
      pan = { x: e.clientX, y: e.clientY, ox: vw.ox, oy: vw.oy };
      return;
    }
    if (mode !== 'click' || e.button !== 0) return;
    const p = toImg(e);
    // Vorhandenen Punkt greifen?
    const hit = clicks.findIndex((c) => c && Math.hypot((c.x - p.x) * vw.z, (c.y - p.y) * vw.z) < 8);
    if (hit >= 0) {
      dragPt = hit;
      return;
    }
    if (cur >= targets.length) return;
    clicks[cur] = p;
    dragPt = cur;
    cur++;
    while (cur < targets.length && clicks[cur]) cur++;
    compute();
  });
  view.addEventListener('pointermove', (e) => {
    mouse = toImg(e);
    if (pan) {
      vw.ox = pan.ox + e.clientX - pan.x;
      vw.oy = pan.oy + e.clientY - pan.y;
    } else if (dragPt >= 0) clicks[dragPt] = mouse;
    draw();
  });
  view.addEventListener('pointerup', () => {
    if (dragPt >= 0) compute();
    dragPt = -1;
    pan = null;
  });
  view.addEventListener('pointerleave', () => ((mouse = null), draw()));

  // --- Berechnung ---
  function compute() {
    const bed: Pt[] = [],
      img: Pt[] = [];
    clicks.forEach((c, i) => c && (bed.push(targets[i]), img.push(c)));
    result = frame && bed.length >= 4 ? calibrate(bed, img, frame.width, frame.height, lens, bedW, bedH) : null;
    checkCache = null;
    saveCal.disabled = !result;
    checkBtn.disabled = !result;
    if (!frame) resTxt.textContent = '';
    else if (bed.length < 4) resTxt.textContent = tn('Noch {n} Markierung bis zur ersten Berechnung.', 'Noch {n} Markierungen bis zur ersten Berechnung.', 4 - bed.length);
    else if (!result) resTxt.textContent = t('Keine Lösung: Reihenfolge der Punkte prüfen.');
    else {
      const f = (v: number) => dec(v.toFixed(2));
      const bad = result.maxErr > 1.5;
      resTxt.textContent = t('{n} Markierungen: Restfehler ⌀ {err} mm, max. {maxErr} mm.', { n: bed.length, err: f(result.err), maxErr: f(result.maxErr) }) +
        (bad ? t(' Ein Punkt liegt deutlich daneben: Reihenfolge und Klick prüfen.') : '');
      resTxt.classList.toggle('error', bad);
    }
    draw();
  }
  let checkCache: HTMLCanvasElement | null = null;
  function checkCanvas(): HTMLCanvasElement | null {
    if (checkCache) return checkCache;
    if (!frame || !result) return null;
    const r = buildRemap(result, frame.width, frame.height, bedW, bedH, 1000);
    const c = document.createElement('canvas');
    c.width = r.w;
    c.height = r.h;
    const ctx = c.getContext('2d')!;
    const out = ctx.createImageData(r.w, r.h);
    warp(frame.getContext('2d')!.getImageData(0, 0, frame.width, frame.height), r, out);
    ctx.putImageData(out, 0, 0);
    // Sollpositionen und Bettraster einzeichnen
    const k = r.w / bedW;
    ctx.strokeStyle = 'rgba(0,160,255,0.6)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= bedW; x += 50) (ctx.beginPath(), ctx.moveTo(x * k, 0), ctx.lineTo(x * k, r.h), ctx.stroke());
    for (let y = 0; y <= bedH; y += 50) (ctx.beginPath(), ctx.moveTo(0, r.h - y * k), ctx.lineTo(r.w, r.h - y * k), ctx.stroke());
    ctx.strokeStyle = '#ff2020';
    ctx.lineWidth = 2;
    for (const t of targets) {
      ctx.beginPath();
      ctx.arc(t.x * k, (bedH - t.y) * k, (m.size / 2) * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    return (checkCache = c);
  }

  // --- Zeichnen ---
  function drawSketch() {
    const c = sketch.getContext('2d')!;
    const W = sketch.width,
      H = sketch.height;
    const k = Math.min((W - 20) / bedW, (H - 20) / bedH);
    const ox = (W - bedW * k) / 2,
      oy = (H - bedH * k) / 2;
    c.clearRect(0, 0, W, H);
    const css = getComputedStyle(dlg);
    c.fillStyle = css.getPropertyValue('--surface-2') || '#eee';
    c.fillRect(ox, oy, bedW * k, bedH * k);
    c.strokeStyle = css.getPropertyValue('--line') || '#888';
    c.strokeRect(ox, oy, bedW * k, bedH * k);
    c.font = '10px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    targets.forEach((t, i) => {
      const x = ox + t.x * k,
        y = oy + (bedH - t.y) * k;
      const done = !!clicks[i],
        now = mode === 'click' && i === cur;
      c.beginPath();
      c.arc(x, y, now ? 9 : 7, 0, Math.PI * 2);
      c.fillStyle = now ? '#ff6020' : done ? '#20a040' : '#8890a0';
      c.fill();
      c.fillStyle = '#fff';
      c.fillText(String(i + 1), x, y + 0.5);
    });
    // Maschinennullpunkt
    c.fillStyle = '#e02020';
    c.fillRect(ox - 3, oy + bedH * k - 3, 6, 6);
  }

  function draw() {
    drawSketch();
    const r = view.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (view.width !== Math.round(r.width * dpr) || view.height !== Math.round(r.height * dpr)) {
      view.width = Math.round(r.width * dpr);
      view.height = Math.round(r.height * dpr);
    }
    const c = view.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, r.width, r.height);
    const f = src();
    if (!f) {
      c.fillStyle = getComputedStyle(dlg).getPropertyValue('--muted') || '#888';
      c.font = '13px sans-serif';
      c.textAlign = 'center';
      c.fillText(cam.open ? t('Nach dem Lasern „Foto aufnehmen“.') : t('Kamera nicht verbunden.'), r.width / 2, r.height / 2);
      skipBtn.disabled = backBtn.disabled = true;
      return;
    }
    c.imageSmoothingEnabled = vw.z < 2;
    c.drawImage(f, vw.ox, vw.oy, f.width * vw.z, f.height * vw.z);
    skipBtn.disabled = mode !== 'click' || cur >= targets.length;
    backBtn.disabled = mode !== 'click' || cur === 0;
    if (mode === 'check') {
      info.textContent = t('Entzerrtes Bild: Die roten Kreise sollten genau auf den gelaserten Markierungen liegen. „Prüfen“ schaltet zurück.');
      return;
    }
    info.textContent = cur < targets.length ? t('Markierung {cur} von {targets} anklicken.', { cur: cur + 1, targets: targets.length }) : t('Alle Markierungen gesetzt.');
    // Gesetzte Punkte
    clicks.forEach((p, i) => {
      if (!p) return;
      const q = toScr(p);
      c.strokeStyle = '#20e060';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(q.x - 7, q.y);
      c.lineTo(q.x + 7, q.y);
      c.moveTo(q.x, q.y - 7);
      c.lineTo(q.x, q.y + 7);
      c.stroke();
      c.fillStyle = '#20e060';
      c.font = 'bold 12px sans-serif';
      c.fillText(String(i + 1), q.x + 6, q.y - 6);
    });
    // Wo das Modell die Markierungen erwartet (nach der ersten Berechnung)
    if (result) {
      c.strokeStyle = 'rgba(255,60,30,0.9)';
      c.lineWidth = 1;
      targets.forEach((t) => {
        const q = toScr(bedToPixel(result!, t.x, t.y, f.width, f.height));
        c.beginPath();
        c.arc(q.x, q.y, 5, 0, Math.PI * 2);
        c.stroke();
      });
    }
    // Lupe
    if (mouse && !pan) {
      const L = 140,
        Z = Math.max(4, vw.z * 3);
      const lx = r.width - L - 10,
        ly = 10;
      c.save();
      c.beginPath();
      c.rect(lx, ly, L, L);
      c.clip();
      c.imageSmoothingEnabled = false;
      c.drawImage(f, mouse.x - L / 2 / Z, mouse.y - L / 2 / Z, L / Z, L / Z, lx, ly, L, L);
      c.strokeStyle = '#ff2020';
      c.beginPath();
      c.moveTo(lx + L / 2, ly);
      c.lineTo(lx + L / 2, ly + L);
      c.moveTo(lx, ly + L / 2);
      c.lineTo(lx + L, ly + L / 2);
      c.stroke();
      c.restore();
      c.strokeStyle = '#888';
      c.strokeRect(lx, ly, L, L);
    }
  }

  const ro = new ResizeObserver(() => {
    if (!vw.z || vw.z === 1) fitView();
    draw();
  });
  ro.observe(view);
  dlg.addEventListener('close', () => (ro.disconnect(), dlg.remove()));
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
  if (s.calib) info.textContent = t('Die Kamera ist schon kalibriert. Eine neue Kalibrierung ersetzt die alte erst mit „Übernehmen“.');
  draw();
}
