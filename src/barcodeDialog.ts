// Dialog für Strichcodes (1D-Barcodes): Code 128, EAN-13, EAN-8, UPC-A, Code 39, ITF.
import { Editor } from './editor';
import { check, numField, select } from './arrayDialogs';
import { h } from './dom';
import { BarcodeShape, LinearType, Obj } from './model';
import { BARCODE_FONT, barcodeOutline } from './barcode';
import { encodeLinear, LINEAR_NAMES, LINEAR_TYPES, minQuiet } from './barcode1d';
import { fillTemplate, scopeOf } from './params';
import { loadFont } from './fonts';
import { dec, t } from './i18n';

const LAST_KEY = 'kizamubeam.barcode';

/** Beispielinhalt je Art (für neue Codes und als Platzhalter) */
const SAMPLE: Record<LinearType, string> = {
  code128: 'KizamuBeam-001',
  ean13: '400638133393',
  ean8: '9638507',
  upca: '03600029145',
  code39: 'CODE-39',
  itf: '1234567890',
};

const HELP: Record<LinearType, string> = {
  code128: t('Buchstaben, Ziffern und Zeichen (ASCII). Kompakt, für Seriennummern, Inventar und Versand.'),
  ean13: t('12 Ziffern, die Prüfziffer wird angehängt (13 Ziffern werden geprüft). Artikelnummern im Handel.'),
  ean8: t('7 Ziffern, die Prüfziffer wird angehängt. Für kleine Verpackungen.'),
  upca: t('11 Ziffern, die Prüfziffer wird angehängt. Artikelnummern in Nordamerika.'),
  code39: t('Großbuchstaben, Ziffern und - . $ / + % Leerzeichen. Einfach, aber breit; in Industrie und Behörden verbreitet.'),
  itf: t('Nur Ziffern, paarweise kodiert (ungerade Anzahl bekommt eine führende 0). Kartons und Paletten (ITF-14).'),
};

type Settings = Pick<BarcodeShape, 'size' | 'height' | 'text' | 'check' | 'bwr' | 'invert' | 'quiet'> & { type: LinearType };

function lastSettings(): Settings {
  const d: Settings = { type: 'code128', size: 40, height: 15, text: true, check: false, bwr: 0, invert: false, quiet: 10 };
  try {
    const v = { ...d, ...JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') };
    if (!LINEAR_TYPES.includes(v.type)) v.type = d.type;
    return v;
  } catch {
    return d;
  }
}

/** Strichcode erstellen (ohne o) oder bearbeiten */
export function openBarcodeDialog(ed: Editor, o?: Obj) {
  const old = o?.shape.kind === 'barcode' && o.shape.type !== 'qr' ? o.shape : null;
  const st: BarcodeShape = old
    ? structuredClone(old)
    : (() => {
        const s = lastSettings();
        return { kind: 'barcode', ec: 'M', data: SAMPLE[s.type], ...s };
      })();
  let variable = !!st.vt;
  let offset = st.vt?.offset ?? 0;
  const type = () => st.type as LinearType;

  const input = h('input', { type: 'text', id: 'bc-data', value: st.data, oninput: () => ((st.data = input.value), update()) }) as HTMLInputElement;
  const help = h('div', { class: 'muted bc-help' });
  const checkRow = [h('span'), check(!!st.check, (v) => ((st.check = v), update()), t('Prüfziffer anhängen'))];
  const offRow = [h('label', { for: 'bc-offset' }, t('Versatz der Nummer')), numField('bc-offset', offset, (v) => ((offset = Math.round(v)), update()), t('Wird zur aktuellen Nummer addiert'))];
  const canvas = h('canvas', { class: 'bc-preview', width: 480, height: 200 }) as HTMLCanvasElement;
  const info = h('div', { class: 'note' }, ' ');
  let ok = false;

  const update = () => {
    if (!dlg.open && dlg.isConnected) return;
    input.placeholder = SAMPLE[type()];
    help.textContent = HELP[type()];
    checkRow.forEach((el) => (el.hidden = type() !== 'code39' && type() !== 'itf'));
    offRow.forEach((el) => (el.hidden = !variable));
    const filled = fillTemplate(st.data, scopeOf(), true);
    const shown = variable ? ed.previewVarText(filled, offset) : filled;
    const r = encodeLinear(type(), shown, st.check);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ok = r.ok;
    if (!r.ok) {
      info.textContent = r.error;
      info.classList.add('error');
      return;
    }
    // Vorschau mit dem eingesetzten Inhalt (ohne variablen Text, der sonst die aktuelle Nummer nähme)
    const shape: BarcodeShape = { ...st, data: shown.replace(/[{}]/g, (c) => c + c) };
    delete shape.vt;
    const ol = barcodeOutline(shape);
    const e = ol.ext;
    const pad = 8;
    const k = Math.min((canvas.width - 2 * pad) / (e.x1 - e.x0), (canvas.height - 2 * pad) / (e.y1 - e.y0));
    const ox = (canvas.width - (e.x1 - e.x0) * k) / 2 - e.x0 * k,
      oy = (canvas.height - (e.y1 - e.y0) * k) / 2 - e.y0 * k;
    ctx.setTransform(k, 0, 0, k, ox, oy);
    ctx.fillStyle = '#000';
    ctx.fill(ol.path, 'evenodd');

    const mod = st.size / r.code.total;
    const notes = [t('{n} Module, je {mod} mm.', { n: r.code.total, mod: dec(mod.toFixed(3)) })];
    if (r.code.value !== shown.replace(/[\s-]/g, '') && type() !== 'code128' && type() !== 'code39')
      notes.push(t('Kodiert wird {v}.', { v: r.code.value }));
    else if (type() === 'code39' && st.check) notes.push(t('Kodiert wird {v}.', { v: r.code.value }));
    if (mod < 0.2) notes.push(t('Sehr schmale Striche: breiter machen, sonst laufen sie beim Lasern ineinander und der Code lässt sich schwer lesen.'));
    if (st.invert && st.quiet < minQuiet(type())) notes.push(t('Die Ruhezone ist schmaler als empfohlen ({n} Module).', { n: minQuiet(type()) }));
    if (variable) notes.push(t('Vorschau mit Nummer {n}: {text}', { n: ed.varText.current + offset, text: shown.length > 60 ? shown.slice(0, 59) + '…' : shown }));
    info.textContent = notes.join(' ');
    info.classList.toggle('error', mod < 0.2);
  };

  const body = [
    h('label', { for: 'bc-type' }, t('Art')),
    select('bc-type', type(), LINEAR_TYPES.map((v) => [v, LINEAR_NAMES[v]] as [LinearType, string]), (v) => {
      // Passt der bisherige Inhalt nicht zur neuen Art, das Beispiel einsetzen
      const was = type();
      st.type = v;
      if (st.data === SAMPLE[was] || (!encodeLinear(v, st.data, st.check).ok && !variable && !/[%{]/.test(st.data))) input.value = st.data = SAMPLE[v];
      update();
    }),
    h('label', { for: 'bc-data' }, t('Inhalt')), input,
    h('span'), help,
    ...checkRow,
    h('label', { for: 'bc-size' }, t('Breite (mm)')),
    numField('bc-size', st.size, (v) => ((st.size = Math.max(1, v)), update()), t('Breite der Striche ohne Ruhezone')),
    h('label', { for: 'bc-height' }, t('Höhe (mm)')),
    numField('bc-height', st.height ?? 15, (v) => ((st.height = Math.max(1, v)), update()), t('Höhe der Striche ohne Klartext')),
    h('span'), check(!!st.text, (v) => ((st.text = v), update()), t('Klartext unter den Strichen')),
    h('label', { for: 'bc-bwr' }, t('Strichbreitenkorrektur (mm)')),
    numField('bc-bwr', st.bwr ?? 0, (v) => ((st.bwr = Math.max(0, v)), update()), t('Gelaserte Elemente werden um diesen Betrag schmaler, weil der Laserstrahl breiter brennt (etwa die halbe bis ganze Strahlbreite, z. B. 0,08)')),
    h('span'), check(st.invert, (v) => ((st.invert = v), update()), t('Negativ: Hintergrund lasern (für dunkle Materialien)')),
    h('label', { for: 'bc-quiet' }, t('Ruhezone (Module)')),
    numField('bc-quiet', st.quiet, (v) => ((st.quiet = Math.max(0, Math.round(v))), update()), t('Freier Rand links und rechts; wird nur bei Negativ gelasert')),
    h('span'), check(variable, (v) => ((variable = v), update()), t('Variabler Text (Platzhalter wie %# oder %0, siehe „Variabler Text …“)')),
    ...offRow,
  ];
  const dlg = h(
    'dialog',
    { class: 'offset-dialog qr-dialog bc-dialog' },
    h('h3', {}, old ? t('Strichcode bearbeiten') : t('Strichcode erstellen')),
    h('div', { class: 'form' }, ...body),
    canvas,
    info,
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          if (!ok) return;
          st.vt = variable ? { offset } : undefined;
          if (!variable) delete st.vt;
          const keep: Settings = { type: type(), size: st.size, height: st.height, text: st.text, check: st.check, bwr: st.bwr, invert: st.invert, quiet: st.quiet };
          try {
            localStorage.setItem(LAST_KEY, JSON.stringify(keep));
          } catch {
            /* Speicher nicht verfügbar */
          }
          if (o && old) ed.updateBarcode(o, { data: st.data, ...keep, vt: st.vt });
          else ed.addBarcode(st);
          dlg.close();
        },
      }, old ? t('Übernehmen') : t('Erstellen')),
    ),
  );
  dlg.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && e.target === input) (dlg.querySelector('.btn.primary') as HTMLButtonElement).click();
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  update();
  // Klartext erscheint, sobald die Schrift geladen ist
  void loadFont(BARCODE_FONT, false, false).then(() => dlg.open && update());
}
