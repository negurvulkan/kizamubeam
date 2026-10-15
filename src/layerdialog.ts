// Layer-Einstellungen (wie der Cut Settings Editor in LightBurn): öffnet per Doppelklick auf einen Layer.
// Bearbeitet wird eine Kopie; „Übernehmen“ schreibt alles als einen Undo-Schritt zurück.
import type { Editor } from './editor';
import { h, numInput } from './dom';
import { CutSettings, cutSettings, defaultCutSettings, LayerMode, layerLabel, PALETTE } from './model';

export function openLayerDialog(ed: Editor, i: number) {
  const L = ed.layer(i);
  const c: CutSettings = cutSettings(L);
  let name = L.name;
  let output = L.output;

  const num = (get: () => number, set: (v: number) => void, min: number, max: number, int = false, title?: string) => {
    const el = numInput('', (v) => {
      set(Math.max(min, Math.min(max, int ? Math.round(v) : v)));
      el.value = String(get());
    }, title);
    el.value = String(get());
    return el;
  };
  const check = (label: string, get: () => boolean, set: (v: boolean) => void, title?: string, after?: () => void) =>
    h('label', { class: 'check', title }, h('input', { type: 'checkbox', checked: get(), onchange: (e: Event) => (set((e.target as HTMLInputElement).checked), after?.()) }), label);
  const row = (label: string, el: HTMLElement, title?: string) => [h('label', { title }, label), el];

  const general = h('div', { class: 'form' });
  const modeBox = h('div');
  const render = () => {
    const modeSel = h('select', {
      onchange: (e: Event) => {
        c.mode = (e.target as HTMLSelectElement).value as LayerMode;
        render();
      },
    },
      h('option', { value: 'line', selected: c.mode === 'line' }, 'Linie'),
      h('option', { value: 'fill', selected: c.mode === 'fill' }, 'Füllen'),
    );
    general.replaceChildren(
      ...row('Name', h('input', { type: 'text', value: name, oninput: (e: Event) => (name = (e.target as HTMLInputElement).value) })),
      ...row('Modus', modeSel),
      ...row('Geschwindigkeit (mm/min)', num(() => c.speed, (v) => (c.speed = v), 1, 100000)),
      ...row('Max. Leistung (%)', num(() => c.power, (v) => (c.power = v), 0, 100)),
      ...row('Min. Leistung (%)', num(() => c.minPower, (v) => (c.minPower = v), 0, 100)),
      ...row('Durchgänge', num(() => c.passes, (v) => (c.passes = v), 1, 100, true)),
      ...row('Kerf-Versatz (mm)', num(() => c.kerf, (v) => (c.kerf = v), -5, 5, false, 'Positiv: Außenkonturen wandern nach außen, Löcher nach innen. Etwa die halbe Schnittbreite eintragen, damit Teile maßhaltig werden.')),
      h('span', { class: 'checks' },
        check('Air Assist', () => c.air, (v) => (c.air = v), 'Luftunterstützung während dieses Layers einschalten (M8/M7, aus mit M9). Gilt auch für Bilder auf diesem Layer.'),
        check('Ausgabe', () => output, (v) => (output = v), 'Layer beim Lasern ausgeben'),
      ),
    );
    modeBox.replaceChildren(c.mode === 'line' ? lineSection() : fillSection());
  };

  const lineSection = () => {
    const T = c.tabs;
    const box = h('div', { class: 'form' });
    const fill = () => {
      box.replaceChildren(
        h('span', { class: 'checks' }, check('Haltestege (Tabs) setzen', () => T.enabled, (v) => (T.enabled = v), 'An diesen Stellen bleibt der Laser aus, damit ausgeschnittene Teile nicht herausfallen', fill)),
        ...(T.enabled
          ? [
              ...row('Steglänge (mm)', num(() => T.size, (v) => (T.size = v), 0.05, 50)),
              h('label', {}, 'Verteilung'),
              h('span', { class: 'radios' },
                h('label', {}, h('input', { type: 'radio', name: `tabs-${i}`, checked: T.useCount, onchange: () => ((T.useCount = true), fill()) }), 'Anzahl'),
                h('label', {}, h('input', { type: 'radio', name: `tabs-${i}`, checked: !T.useCount, onchange: () => ((T.useCount = false), fill()) }), 'Abstand'),
              ),
              ...(T.useCount
                ? row('Stege je Form', num(() => T.count, (v) => (T.count = v), 1, 100, true))
                : row('Abstand (mm)', num(() => T.spacing, (v) => (T.spacing = v), 1, 10000))),
              h('span', { class: 'checks' }, check('Innere Formen auslassen', () => T.skipInner, (v) => (T.skipInner = v), 'Löcher und Formen innerhalb anderer Formen fallen heraus und brauchen keine Stege')),
            ]
          : []),
      );
    };
    fill();
    return h('div', {}, h('div', { class: 'form-title' }, 'Linie'), box);
  };

  const fillSection = () => {
    const interval = num(() => c.interval, (v) => ((c.interval = v), (lpi.value = String(Math.round(25.4 / v)))), 0.01, 5, false, 'Abstand der Füllzeilen in mm');
    const lpi = num(() => Math.round(25.4 / c.interval), (v) => ((c.interval = Math.round((25.4 / v) * 10000) / 10000), (interval.value = String(c.interval))), 5, 2540, false, 'Zeilen pro Zoll');
    return h('div', {},
      h('div', { class: 'form-title' }, 'Füllen'),
      h('div', { class: 'form' },
        ...row('Zeilenabstand (mm)', interval),
        ...row('Zeilen pro Zoll', lpi),
        ...row('Scanwinkel (°)', num(() => c.angle, (v) => (c.angle = v), -180, 180, false, '0° = waagerechte Zeilen, 90° = senkrechte')),
        ...row('Überfahrweg (%)', num(() => c.overscan, (v) => (c.overscan = v), 0, 50, false, 'Anlauf- und Auslaufweg in % der Geschwindigkeit, damit der Rand gleichmäßig wird')),
        h('span', { class: 'checks' },
          check('Bidirektional', () => c.bidirectional, (v) => (c.bidirectional = v), 'In beide Richtungen lasern (schneller)'),
          check('Kreuzschraffur', () => c.crossHatch, (v) => (c.crossHatch = v), 'Zweiter Durchgang um 90° gedreht'),
        ),
      ),
    );
  };

  let applied = false;
  const dlg = h(
    'dialog',
    { class: 'layer-dialog' },
    h('h3', {}, h('span', { class: 'swatch', style: `background:${PALETTE[i]}` }, layerLabel(i)), ' Layer-Einstellungen'),
    general,
    modeBox,
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', {
        class: 'btn',
        title: 'Standardwerte für den gewählten Modus',
        onclick: () => {
          Object.assign(c, defaultCutSettings(c.mode));
          render();
        },
      }, 'Standardwerte'),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn', onclick: () => dlg.close() }, 'Abbrechen'),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          applied = true;
          dlg.close();
        },
      }, 'Übernehmen'),
    ),
  );
  render();
  dlg.addEventListener('close', () => {
    // Felder schreiben ihre Werte beim Verlassen; der Klick auf „Übernehmen“ kommt danach
    if (applied) {
      const before = JSON.stringify({ ...cutSettings(L), name: L.name, output: L.output });
      const after = { ...c, name: name.trim() || L.name, output };
      if (JSON.stringify(after) !== before) ed.updateLayer(i, after);
    }
    dlg.remove();
  });
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
}
