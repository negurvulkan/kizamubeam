// Dialog „Fokustest“: Rampe (schräges Material, für jeden Laser) oder Z-Reihe (motorische Z-Achse).
// Vorschau, Rahmen, G-Code und Start laufen wie beim Materialtest über ein eigenes Testdokument.
import type { Editor } from './editor';
import { h, numInput } from './dom';
import { device, frameJob, JobSource, openPreview, saveGCode, startJob } from './laser';
import { machine } from './machine';
import { FIRMWARES, rotaryOn } from './gcode';
import { defaultImageLayer, layerLabel } from './model';
import {
  buildFocusDoc, cleanFocusOptions, FocusOptions, MAX_Z_LINES, rampHeight, rampResult, rampTicks, signed, zMoveFor, zResult, zValues,
} from './focustest';
import { dec, t } from './i18n';

const KEY = 'kizamubeam.focustest';

function load(): FocusOptions {
  try {
    return cleanFocusOptions(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return cleanFocusOptions(null);
  }
}
function save(o: FocusOptions) {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* nicht speicherbar */
  }
}

/** Kann dieses Gerät den Fokus selbst verstellen? */
const zReady = () => device.zAxis && !(rotaryOn(device) && device.rotary.axis === 'Z');

export function openFocusTestDialog(ed: Editor) {
  const o = load();
  if (o.method === 'z' && !device.zAxis) o.method = 'ramp';
  const font = ed.textDefaults.font;
  /** Rampe: gewählte Stelle in mm entlang der Linie; Z-Reihe: Index der gewählten Linie */
  let picked: number | null = null;

  const num = (get: () => number, set: (v: number) => void, min: number, max: number, int = false, title?: string) => {
    const el = numInput('', (v) => {
      set(Math.max(min, Math.min(max, int ? Math.round(v) : v)));
      el.value = String(get());
      update();
    }, title);
    el.value = String(get());
    return el;
  };
  const row = (label: string, el: HTMLElement, title?: string) => [h('label', { title }, label), el];
  const check = (label: string, get: () => boolean, set: (v: boolean) => void, rerender = false) =>
    h('span', { class: 'checks' }, h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: get(), onchange: (e: Event) => (set((e.target as HTMLInputElement).checked), rerender ? render() : update()) }), label));

  const form = h('div', { class: 'form' });
  const svgBox = h('div', { class: 'mt-preview ft-preview' });
  const steps = h('ol', { class: 'ft-steps' });
  const info = h('div', { class: 'note' });
  const pickBox = h('div', { class: 'mt-pick' });
  const startBtn = h('button', { class: 'btn primary', title: t('Test an den verbundenen Laser senden'), onclick: () => startJob(ed, source()) }, t('Starten')) as HTMLButtonElement;

  const render = () => {
    picked = null;
    form.replaceChildren(
      ...row(t('Verfahren'), h('select', {
        onchange: (e: Event) => ((o.method = (e.target as HTMLSelectElement).value as FocusOptions['method']), render()),
      },
        h('option', { value: 'ramp', selected: o.method === 'ramp' }, t('Rampe (schräges Material)')),
        h('option', { value: 'z', selected: o.method === 'z' }, t('Z-Reihe (motorische Z-Achse)')),
      )),
      h('div', { class: 'form-title sub' }, t('Laser')),
      ...row(t('Geschwindigkeit (mm/min)'), num(() => o.speed, (v) => (o.speed = v), 1, 100000)),
      ...row(t('Leistung (%)'), num(() => o.power, (v) => (o.power = v), 0, 100, false, t('So wenig, dass die Linie gerade sichtbar markiert: Dann fällt der Unterschied zwischen scharf und unscharf am meisten auf.'))),
      check(t('Air Assist'), () => o.air, (v) => (o.air = v)),
      ...(o.method === 'ramp'
        ? [
            h('div', { class: 'form-title sub' }, t('Rampe')),
            ...row(t('Linienlänge (mm)'), num(() => o.rampLength, (v) => (o.rampLength = v), 10, 2000)),
            ...row(t('Unterlage am hohen Ende (mm)'), num(() => o.rampRise, (v) => (o.rampRise = v), 0.5, 200, false, t('Wie hoch das Material am Ende der Linie über dem tiefen Ende liegt, z. B. Dicke eines untergelegten Holzstücks'))),
            ...row(t('Markierung alle (mm)'), num(() => o.tickEvery, (v) => (o.tickEvery = v), 1, 500)),
          ]
        : [
            h('div', { class: 'form-title sub' }, t('Z-Reihe')),
            ...row(t('Z-Versatz von (mm)'), num(() => o.zFrom, (v) => (o.zFrom = v), -50, 50, false, t('Positiv = Fokus tiefer ins Material, bezogen auf die Höhe beim Start'))),
            ...row(t('Z-Versatz bis (mm)'), num(() => o.zTo, (v) => (o.zTo = v), -50, 50)),
            ...row(t('Linien'), num(() => o.zCount, (v) => (o.zCount = v), 2, MAX_Z_LINES, true)),
            ...row(t('Linienlänge (mm)'), num(() => o.lineLength, (v) => (o.lineLength = v), 2, 200)),
            ...row(t('Linienabstand (mm)'), num(() => o.lineGap, (v) => (o.lineGap = v), 0.5, 100)),
          ]),
      h('div', { class: 'form-title sub' }, t('Lage')),
      ...row(t('Position X (mm)'), num(() => o.x, (v) => (o.x = v), -10000, 10000), t('Untere linke Ecke des Tests inkl. Beschriftung, in Maschinenkoordinaten. Gilt bei „Starten ab: Absolut“; sonst bestimmt die Startposition die Lage.')),
      ...row(t('Position Y (mm)'), num(() => o.y, (v) => (o.y = v), -10000, 10000)),
      h('div', { class: 'form-title sub' }, t('Beschriftung')),
      check(t('Werte beschriften'), () => o.labels, (v) => (o.labels = v), true),
      ...(o.labels
        ? [
            ...row(t('Schrifthöhe (mm)'), num(() => o.labelSize, (v) => (o.labelSize = v), 0.5, 50)),
            ...row(t('Geschwindigkeit (mm/min)'), num(() => o.labelSpeed, (v) => (o.labelSpeed = v), 1, 100000)),
            ...row(t('Leistung (%)'), num(() => o.labelPower, (v) => (o.labelPower = v), 0, 100)),
          ]
        : []),
    );
    steps.replaceChildren(...(o.method === 'ramp'
      ? [
          t('Fokus wie gewohnt einstellen, am späteren tiefen Ende (links, Anfang der Linie).'),
          t('Material schräg legen: Anfang der Linie flach auf dem Bett, Ende um die eingestellte Höhe unterlegt. Mit „Rahmen“ prüfen, wo die Linie liegt.'),
          t('Test lasern und die Stelle suchen, an der die Linie am dünnsten und schärfsten ist.'),
          t('Diese Stelle unten im Schaubild anklicken: Das Ergebnis sagt, um wie viel der Fokus abweicht.'),
        ]
      : [
          t('Material flach auflegen und den Fokus wie gewohnt einstellen.'),
          t('Test lasern: Jede Linie läuft bei einem anderen Z-Versatz, danach fährt Z auf die Starthöhe zurück.'),
          t('Die dünnste, schärfste Linie unten im Schaubild anklicken.'),
        ]).map((s) => h('li', {}, s)));
    update();
  };

  const ns = 'http://www.w3.org/2000/svg';
  /** Schaubild: Rampe von der Seite mit Höhenskala, bzw. die Linien der Z-Reihe. Klick wählt die schärfste Stelle. */
  const drawPreview = () => {
    const svg = document.createElementNS(ns, 'svg');
    const el = (tag: string, attrs: Record<string, string | number>, text?: string) => {
      const e = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      if (text) e.textContent = text;
      svg.append(e);
      return e;
    };
    const W = 340;
    if (o.method === 'ramp') {
      const pad = 14,
        H = 110,
        base = 80;
      const sx = (W - pad * 2) / o.rampLength;
      // Überhöht gezeichnet, damit die Schräge sichtbar ist
      const rise = Math.min(50, Math.max(14, o.rampRise * sx * 3));
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('width', String(W));
      el('line', { x1: 4, y1: base + 6, x2: W - 4, y2: base + 6, class: 'ft-bed' });
      el('polygon', { points: `${pad},${base} ${W - pad},${base - rise} ${W - pad},${base - rise + 6} ${pad},${base + 6}`, class: 'ft-material' });
      el('rect', { x: W - pad - 8, y: base - rise + 6, width: 8, height: rise, class: 'ft-shim' });
      el('text', { x: W - pad - 10, y: base - rise / 2 + 6, 'text-anchor': 'end', class: 'mt-val' }, `${dec(String(o.rampRise))} mm`);
      for (const s of rampTicks(o)) {
        const x = pad + s * sx,
          y = base - (rise * s) / o.rampLength;
        el('line', { x1: x, y1: y, x2: x, y2: y - 5, class: 'ft-tick' });
        el('text', { x, y: y - 8, 'text-anchor': 'middle', class: 'mt-val' }, dec(String(rampHeight(o, s))));
      }
      el('text', { x: pad, y: base + 20, class: 'mt-val' }, t('tiefes Ende (Fokus hier einstellen)'));
      if (picked !== null) {
        const x = pad + picked * sx,
          y = base - (rise * picked) / o.rampLength;
        el('circle', { cx: x, cy: y, r: 4, class: 'ft-pick' });
      }
      const hit = el('rect', { x: pad - 4, y: 0, width: W - pad * 2 + 8, height: H, class: 'ft-hit' });
      const title = document.createElementNS(ns, 'title');
      title.textContent = t('Stelle anklicken, an der die Linie am schärfsten ist');
      hit.append(title);
      hit.addEventListener('click', (ev) => {
        const r = svg.getBoundingClientRect();
        const x = ((ev as MouseEvent).clientX - r.left) * (W / r.width);
        const s = Math.max(0, Math.min(o.rampLength, (x - pad) / sx));
        picked = Math.round(s * 2) / 2;
        update();
      });
    } else {
      const zs = zValues(o);
      const pad = 16,
        top = 8,
        len = 60,
        H = top + len + 34;
      const gap = Math.min(28, (W - pad * 2) / Math.max(1, zs.length - 1));
      const w = pad * 2 + gap * (zs.length - 1);
      svg.setAttribute('viewBox', `0 0 ${w} ${H}`);
      svg.setAttribute('width', String(w));
      const zmax = Math.max(...zs.map(Math.abs), 0.01);
      zs.forEach((z, i) => {
        const x = pad + i * gap;
        // Strichstärke als Andeutung: je weiter weg von 0, desto breiter (nur Schaubild, nicht das Ergebnis)
        el('line', { x1: x, y1: top, x2: x, y2: top + len, class: picked === i ? 'ft-zline picked' : 'ft-zline', 'stroke-width': 1.2 + (Math.abs(z) / zmax) * 2.5 });
        el('text', { x, y: top + len + 12, 'text-anchor': 'middle', class: 'mt-val' }, signed(z));
        const hit = el('rect', { x: x - gap / 2, y: 0, width: gap, height: H, class: 'ft-hit' });
        const title = document.createElementNS(ns, 'title');
        title.textContent = t('Z-Versatz {z} mm', { z: signed(z) });
        hit.append(title);
        hit.addEventListener('click', () => ((picked = i), update()));
      });
      el('text', { x: w / 2, y: H - 4, 'text-anchor': 'middle', class: 'mt-axis' }, t('Z-Versatz (mm)'));
    }
    svgBox.replaceChildren(svg);
  };

  const update = () => {
    save(o);
    drawPreview();
    const test = buildFocusDoc(o, ed.doc.bed, font);
    const b = test.bounds;
    const x0 = b.x,
      y1 = ed.doc.bed.h - b.y;
    const outside = x0 < -0.01 || b.y < -0.01 || x0 + b.w > ed.doc.bed.w + 0.01 || b.y + b.h > ed.doc.bed.h + 0.01;
    const noZ = o.method === 'z' && !zReady();
    startBtn.disabled = noZ;
    info.replaceChildren(
      t('Etwa {w} × {h} mm (X {x0} … {x1}, Y {y0} … {y1}). Gerät: {device}.', {
        w: b.w.toFixed(0), h: b.h.toFixed(0), x0: x0.toFixed(0), x1: (x0 + b.w).toFixed(0), y0: (y1 - b.h).toFixed(0), y1: y1.toFixed(0), device: device.name,
      }),
      ...(outside ? [h('div', { class: 'warn' }, t('Der Test ragt über das Bett hinaus.'))] : []),
      ...(noZ
        ? [h('div', { class: 'warn' }, device.zAxis
            ? t('Die Z-Achse ist als Drehachse eingestellt. Für die Z-Reihe die Drehachse ausschalten oder die Rampe nehmen.')
            : t('Für dieses Gerät ist keine motorische Z-Achse eingestellt (Geräteeinstellungen). Ohne Z-Achse die Rampe nehmen.'))]
        : []),
    );
    if (picked === null) {
      pickBox.replaceChildren(h('span', { class: 'muted' }, o.method === 'ramp'
        ? t('Nach dem Lasern die schärfste Stelle der Linie im Schaubild anklicken.')
        : t('Nach dem Lasern die schärfste Linie im Schaubild anklicken.')));
      return;
    }
    if (o.method === 'ramp') {
      const s = picked;
      pickBox.replaceChildren(
        h('div', {}, h('b', {}, t('Schärfste Stelle bei {s} mm, Höhe {h} mm.', { s: dec(String(s)), h: dec(String(rampHeight(o, s))) })), ' ', rampResult(o, s)),
      );
      return;
    }
    const z = zValues(o)[picked];
    const L = ed.activeLayer ?? ed.currentLayer;
    const dz = zMoveFor(z, device.zFlip);
    pickBox.replaceChildren(
      h('div', {}, zResult(z)),
      h('button', {
        class: 'btn', title: t('Z-Versatz {z} mm im Layer eintragen; der Fokus bleibt am Gerät, wie er ist', { z: signed(z) }),
        onclick: () => {
          ed.updateLayer(L, { zOffset: z });
          ed.hint = t('Z-Versatz {z} mm auf Layer {layer} eingetragen.', { z: signed(z), layer: layerLabel(L) });
          ed.emit('tool');
        },
      }, t('Als Z-Versatz auf Layer {layer}', { layer: layerLabel(L) })),
      ...(Math.abs(dz) > 0.001 && zReady()
        ? [h('button', {
            class: 'btn', disabled: !machine.connected,
            title: machine.connected ? t('Kopf jetzt auf die Höhe der schärfsten Linie fahren; danach gilt sie als neue Fokushöhe') : t('Nicht verbunden.'),
            onclick: () => {
              for (const l of FIRMWARES[device.fw].jog(0, dz, 300, 'Z')) machine.send(l);
            },
          }, t('Z jetzt um {dz} mm fahren', { dz: signed(dz) }))]
        : []),
    );
  };

  const source = (): JobSource => {
    const test = buildFocusDoc(o, ed.doc.bed, font);
    const n = o.method === 'ramp' ? 1 : zValues(o).length;
    return {
      doc: test.doc,
      layer: (i) => test.doc.layers[i],
      imgLayer: () => defaultImageLayer(),
      name: t('Fokustest'),
      color: (i) => (i >= n ? '#3070d0' : '#d05020'),
    };
  };

  const dlg = h('dialog', { class: 'mt-dialog' },
    h('h3', {}, t('Fokustest')),
    h('div', { class: 'mt-body' },
      h('div', { class: 'mt-left' }, form),
      h('div', { class: 'mt-right' }, steps, svgBox, pickBox, info),
    ),
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'btn', title: t('Ablauf und Dauer ansehen'), onclick: () => openPreview(ed, source()) }, t('Vorschau')),
      h('button', { class: 'btn', title: t('Umriss des Tests abfahren'), onclick: () => frameJob(ed, false, source()) }, t('Rahmen')),
      h('button', { class: 'btn', onclick: () => saveGCode(ed, source()) }, t('G-Code speichern')),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Schließen')),
      startBtn,
    ),
  );
  render();
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
}
