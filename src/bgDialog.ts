// Dialog „Hintergrund entfernen“: Vorschau mit Schachbrett für transparente Stellen, Klick ins Bild wählt die
// Hintergrundfarbe (Shift+Klick fügt eine hinzu). Rechnet lokal; die Vorschau auf höchstens 0,25 Megapixel.
import { Editor } from './editor';
import { select } from './arrayDialogs';
import { backgroundAlpha, BgOptions, DEFAULT_BG, edgeColors } from './bgremove';
import { dec, t } from './i18n';
import { h } from './dom';

let state: BgOptions & { trim: boolean } = { ...DEFAULT_BG, trim: false };

function slider(label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void) {
  const fmt = (v: number) => dec(String(Math.round(v * 100) / 100));
  const out = h('span', { class: 'slider-val' }, fmt(value));
  const inp = h('input', { type: 'range', min, max, step, value: String(value) }) as HTMLInputElement;
  inp.addEventListener('input', () => {
    out.textContent = fmt(+inp.value);
    onInput(+inp.value);
  });
  return [h('label', {}, label), h('span', { class: 'slider' }, inp, out)];
}

const hex = ([r, g, b]: number[]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

export function openBackgroundDialog(ed: Editor) {
  const o = ed.selImages()[0];
  const px = o && ed.imagePixels(o, 250_000);
  if (!o || !px) {
    ed.hint = o ? t('Das Bild ist noch nicht geladen.') : t('Erst ein Bild auswählen.');
    ed.emit('tool');
    return;
  }
  // Ausgewählte Farben gelten nur für dieses Bild; die übrigen Einstellungen merkt sich der Dialog
  const st = { ...state, colors: [] as [number, number, number][] };
  const auto = edgeColors(px.rgba, px.w, px.h);
  const canvas = h('canvas', { class: 'bg-preview', width: px.w, height: px.h, title: t('Klick: Hintergrundfarbe wählen, Shift+Klick: weitere Farbe hinzufügen') }) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const swatches = h('span', { class: 'bg-swatches' });
  const info = h('div', { class: 'note' }, ' ');
  let timer = 0;
  const preview = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const t0 = performance.now();
      // weiche Kante im Verhältnis zur verkleinerten Vorschau
      const alpha = backgroundAlpha(px.rgba, px.w, px.h, { ...st, feather: st.feather * px.scale });
      const out = new Uint8ClampedArray(px.rgba);
      let removed = 0;
      for (let p = 0; p < alpha.length; p++) {
        out[p * 4 + 3] = Math.min(out[p * 4 + 3], alpha[p]);
        if (alpha[p] < 128) removed++;
      }
      ctx.clearRect(0, 0, px.w, px.h);
      ctx.putImageData(new ImageData(out, px.w, px.h), 0, 0);
      info.textContent = t('{pct} % transparent ({ms} ms). Transparentes wird nicht gelasert.', { pct: Math.round((removed / alpha.length) * 100), ms: Math.round(performance.now() - t0) });
    }, 60);
  };
  const showColors = () => {
    const list = st.colors.length ? st.colors : auto;
    swatches.replaceChildren(
      ...list.map((c) => h('span', { class: 'bg-swatch', style: `background:${hex(c)}`, title: hex(c) })),
      h('span', { class: 'muted' }, st.colors.length ? t('gewählt') : t('automatisch vom Bildrand')),
    );
    autoBtn.disabled = !st.colors.length;
  };
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.min(px.w - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * px.w)));
    const y = Math.min(px.h - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * px.h)));
    const i = (y * px.w + x) * 4;
    const c: [number, number, number] = [px.rgba[i], px.rgba[i + 1], px.rgba[i + 2]];
    st.colors = e.shiftKey ? [...st.colors, c].slice(-6) : [c];
    showColors();
    preview();
  });
  const autoBtn = h('button', { class: 'btn', onclick: () => ((st.colors = []), showColors(), preview()) }, t('Automatisch')) as HTMLButtonElement;
  const trim = h('input', { type: 'checkbox', checked: st.trim, onchange: (e: Event) => (st.trim = (e.target as HTMLInputElement).checked) });
  let applied = false;
  const dlg = h(
    'dialog',
    { class: 'offset-dialog trace-dialog bg-dialog' },
    h('h3', {}, t('Hintergrund entfernen')),
    h('div', { class: 'bg-checker' }, canvas),
    h('div', { class: 'bg-colors' }, h('span', {}, t('Hintergrund:')), swatches, autoBtn),
    h(
      'div',
      { class: 'form' },
      h('label', { for: 'bg-mode' }, t('Bereich')),
      select('bg-mode', st.mode, [['edge', t('Vom Rand aus zusammenhängend')], ['all', t('Überall im Bild')]], (v) => ((st.mode = v), preview())),
      ...slider(t('Toleranz'), 1, 80, 1, st.tolerance, (v) => ((st.tolerance = v), preview())),
      ...slider(t('Bereinigen (‰)'), 0, 5, 0.1, st.cleanup, (v) => ((st.cleanup = v), preview())),
      ...slider(t('Weiche Kante (px)'), 0, 6, 1, st.feather, (v) => ((st.feather = v), preview())),
      h('span', {}),
      h('span', { class: 'checks' }, h('label', { class: 'check' }, trim, t('Auf das Motiv zuschneiden'))),
    ),
    h('div', { class: 'note' }, t('Klick in die Vorschau wählt die Hintergrundfarbe, Shift+Klick fügt eine weitere hinzu. „Bereinigen“ entfernt kleine Flecken und füllt kleine Löcher im Motiv. Alles wird lokal berechnet.')),
    info,
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', { class: 'btn primary', onclick: () => ((applied = true), dlg.close()) }, t('Übernehmen')),
    ),
  );
  dlg.addEventListener('close', () => {
    clearTimeout(timer);
    if (applied) {
      state = { ...st, colors: [] };
      void ed.removeBackground(o, st, st.trim);
    }
    dlg.remove();
  });
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
  showColors();
  preview();
}
