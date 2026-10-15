// Layer-Einstellungen (wie der Cut Settings Editor in LightBurn): öffnet per Doppelklick auf einen Layer.
// Bearbeitet wird eine Kopie; „Übernehmen“ schreibt alles als einen Undo-Schritt zurück.
import type { Editor } from './editor';
import { h, numInput } from './dom';
import { CutSettings, cutSettings, defaultCutSettings, LayerMode, layerLabel, PALETTE } from './model';
import { t } from './i18n';

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
      h('option', { value: 'line', selected: c.mode === 'line' }, t('Linie')),
      h('option', { value: 'fill', selected: c.mode === 'fill' }, t('Füllen')),
    );
    general.replaceChildren(
      ...row(t('Name'), h('input', { type: 'text', value: name, oninput: (e: Event) => (name = (e.target as HTMLInputElement).value) })),
      ...row(t('Modus'), modeSel),
      ...row(t('Geschwindigkeit (mm/min)'), num(() => c.speed, (v) => (c.speed = v), 1, 100000)),
      ...row(t('Max. Leistung (%)'), num(() => c.power, (v) => (c.power = v), 0, 100)),
      ...row(t('Min. Leistung (%)'), num(() => c.minPower, (v) => (c.minPower = v), 0, 100)),
      ...row(t('Durchgänge'), num(() => c.passes, (v) => (c.passes = v), 1, 100, true)),
      ...row(t('Kerf-Versatz (mm)'), num(() => c.kerf, (v) => (c.kerf = v), -5, 5, false, t('Positiv: Außenkonturen wandern nach außen, Löcher nach innen. Etwa die halbe Schnittbreite eintragen, damit Teile maßhaltig werden.'))),
      h('span', { class: 'checks' },
        check(t('Air Assist'), () => c.air, (v) => (c.air = v), t('Luftunterstützung während dieses Layers einschalten (M8/M7, aus mit M9). Gilt auch für Bilder auf diesem Layer.')),
        check(t('Ausgabe'), () => output, (v) => (output = v), t('Layer beim Lasern ausgeben')),
      ),
    );
    modeBox.replaceChildren(c.mode === 'line' ? lineSection() : fillSection());
  };

  const lineSection = () => {
    const T = c.tabs;
    const box = h('div', { class: 'form' });
    const fill = () => {
      box.replaceChildren(
        h('span', { class: 'checks' }, check(t('Haltestege (Tabs) setzen'), () => T.enabled, (v) => (T.enabled = v), t('An diesen Stellen bleibt der Laser aus, damit ausgeschnittene Teile nicht herausfallen'), fill)),
        ...(T.enabled
          ? [
              ...row(t('Steglänge (mm)'), num(() => T.size, (v) => (T.size = v), 0.05, 50)),
              h('label', {}, t('Verteilung')),
              h('span', { class: 'radios' },
                h('label', {}, h('input', { type: 'radio', name: `tabs-${i}`, checked: T.useCount, onchange: () => ((T.useCount = true), fill()) }), t('Anzahl')),
                h('label', {}, h('input', { type: 'radio', name: `tabs-${i}`, checked: !T.useCount, onchange: () => ((T.useCount = false), fill()) }), t('Abstand')),
              ),
              ...(T.useCount
                ? row(t('Stege je Form'), num(() => T.count, (v) => (T.count = v), 1, 100, true))
                : row(t('Abstand (mm)'), num(() => T.spacing, (v) => (T.spacing = v), 1, 10000))),
              h('span', { class: 'checks' }, check(t('Innere Formen auslassen'), () => T.skipInner, (v) => (T.skipInner = v), t('Löcher und Formen innerhalb anderer Formen fallen heraus und brauchen keine Stege'))),
            ]
          : []),
      );
    };
    fill();
    return h('div', {}, h('div', { class: 'form-title' }, t('Linie')), box);
  };

  const fillSection = () => {
    const interval = num(() => c.interval, (v) => ((c.interval = v), (lpi.value = String(Math.round(25.4 / v)))), 0.01, 5, false, t('Abstand der Füllzeilen in mm'));
    const lpi = num(() => Math.round(25.4 / c.interval), (v) => ((c.interval = Math.round((25.4 / v) * 10000) / 10000), (interval.value = String(c.interval))), 5, 2540, false, t('Zeilen pro Zoll'));
    return h('div', {},
      h('div', { class: 'form-title' }, t('Füllen')),
      h('div', { class: 'form' },
        ...row(t('Zeilenabstand (mm)'), interval),
        ...row(t('Zeilen pro Zoll'), lpi),
        ...row(t('Scanwinkel (°)'), num(() => c.angle, (v) => (c.angle = v), -180, 180, false, t('0° = waagerechte Zeilen, 90° = senkrechte'))),
        ...row(t('Überfahrweg (%)'), num(() => c.overscan, (v) => (c.overscan = v), 0, 50, false, t('Anlauf- und Auslaufweg in % der Geschwindigkeit, damit der Rand gleichmäßig wird'))),
        h('span', { class: 'checks' },
          check(t('Bidirektional'), () => c.bidirectional, (v) => (c.bidirectional = v), t('In beide Richtungen lasern (schneller)')),
          check(t('Kreuzschraffur'), () => c.crossHatch, (v) => (c.crossHatch = v), t('Zweiter Durchgang um 90° gedreht')),
        ),
      ),
    );
  };

  let applied = false;
  const dlg = h(
    'dialog',
    { class: 'layer-dialog' },
    h('h3', {}, h('span', { class: 'swatch', style: `background:${PALETTE[i]}` }, layerLabel(i)), ' ', t('Layer-Einstellungen')),
    general,
    modeBox,
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', {
        class: 'btn',
        title: t('Standardwerte für den gewählten Modus'),
        onclick: () => {
          Object.assign(c, defaultCutSettings(c.mode));
          render();
        },
      }, t('Standardwerte')),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          applied = true;
          dlg.close();
        },
      }, t('Übernehmen')),
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
