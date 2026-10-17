// Dialoge für QR-Codes und variablen Text.
import { Editor } from './editor';
import { check, numField, select } from './arrayDialogs';
import { h } from './dom';
import { BarcodeShape, Obj, QrLevel } from './model';
import { barcodeData, cellOutlines, qrMatrix, vcardData, wifiData } from './barcode';
import { fillTemplate, scopeOf } from './params';
import { subsToPath2D } from './geom';
import { CODES, shownText } from './vartext';
import { openText } from './files';
import { dec, t, tn } from './i18n';

type Kind = 'text' | 'wifi' | 'vcard';
const LEVELS: [QrLevel, string][] = [
  ['L', t('L – 7 % (kleinster Code)')],
  ['M', t('M – 15 %')],
  ['Q', t('Q – 25 %')],
  ['H', t('H – 30 % (robustester Code)')],
];
const LAST_KEY = 'kizamubeam.qr';

function lastSettings(): Pick<BarcodeShape, 'ec' | 'size' | 'invert' | 'quiet'> {
  const d = { ec: 'M' as QrLevel, size: 30, invert: false, quiet: 2 };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') };
  } catch {
    return d;
  }
}

/** QR-Code erstellen (ohne o) oder bearbeiten */
export function openQrDialog(ed: Editor, o?: Obj) {
  const old = o?.shape.kind === 'barcode' ? o.shape : null;
  const st: BarcodeShape = old
    ? structuredClone(old)
    : { kind: 'barcode', type: 'qr', data: 'https://', ...lastSettings() };
  const form: Record<string, string> = { kind: 'text', ...st.form };
  if (!old) form.text = st.data;
  else if (!st.form) form.text = st.data;
  let variable = !!st.vt;
  let offset = st.vt?.offset ?? 0;

  const field = (key: string, placeholder = '', type = 'text') => {
    const el = h('input', { type, id: `qr-${key}`, value: form[key] ?? '', placeholder, oninput: () => ((form[key] = el.value), update()) }) as HTMLInputElement;
    return el;
  };
  const area = h('textarea', { id: 'qr-text', rows: 3, placeholder: t('Text oder Internetadresse'), oninput: () => ((form.text = area.value), update()) }) as HTMLTextAreaElement;
  area.value = form.text ?? '';
  const groups: Record<Kind, HTMLElement[]> = {
    text: [h('label', { for: 'qr-text' }, t('Inhalt')), area],
    wifi: [
      h('label', { for: 'qr-ssid' }, t('WLAN-Name (SSID)')), field('ssid'),
      h('label', { for: 'qr-pass' }, t('Passwort')), field('pass'),
      h('label', { for: 'qr-auth' }, t('Verschlüsselung')),
      select('qr-auth', (form.auth as 'WPA') ?? 'WPA', [['WPA', 'WPA/WPA2/WPA3'], ['WEP', 'WEP'], ['nopass', t('Keine')]], (v) => ((form.auth = v), update())),
      h('span'), check(form.hidden === '1', (v) => ((form.hidden = v ? '1' : ''), update()), t('Verstecktes Netz')),
    ],
    vcard: [
      h('label', { for: 'qr-name' }, t('Name')), field('name', t('Vorname Nachname')),
      h('label', { for: 'qr-org' }, t('Firma')), field('org'),
      h('label', { for: 'qr-phone' }, t('Telefon')), field('phone', '', 'tel'),
      h('label', { for: 'qr-email' }, t('E-Mail')), field('email', '', 'email'),
      h('label', { for: 'qr-url' }, t('Internetseite')), field('url', 'https://'),
    ],
  };
  const dataOf = (): string => {
    if (form.kind === 'wifi') return wifiData(form.ssid ?? '', form.pass ?? '', form.auth ?? 'WPA', form.hidden === '1');
    if (form.kind === 'vcard') return vcardData({ name: form.name ?? '', org: form.org ?? '', phone: form.phone ?? '', email: form.email ?? '', url: form.url ?? '' });
    return form.text ?? '';
  };

  const canvas = h('canvas', { class: 'qr-preview', width: 160, height: 160 }) as HTMLCanvasElement;
  const info = h('div', { class: 'note' }, ' ');
  const offRow = [h('label', { for: 'qr-offset' }, t('Versatz der Nummer')), numField('qr-offset', offset, (v) => ((offset = Math.round(v)), update()), t('Wird zur aktuellen Nummer addiert'))];
  let ok = false;

  const update = () => {
    for (const [k, els] of Object.entries(groups)) els.forEach((el) => (el.hidden = k !== form.kind));
    offRow.forEach((el) => (el.hidden = !variable));
    st.data = dataOf();
    const filled = fillTemplate(st.data, scopeOf(), true);
    const shown = variable ? ed.previewVarText(filled, offset) : filled;
    const m = qrMatrix(shown, st.ec);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ok = !!m;
    if (!m) {
      info.textContent = shown ? t('Der Inhalt ist zu lang für einen QR-Code.') : t('Bitte einen Inhalt eingeben.');
      info.classList.add('error');
      return;
    }
    const q = Math.max(0, Math.round(st.quiet));
    const N = m.n + 2 * q;
    const k = canvas.width / N;
    ctx.fillStyle = '#000';
    ctx.setTransform(k, 0, 0, k, q * k, q * k);
    const subs = st.invert
      ? cellOutlines(N, N, (x, y) => x < q || y < q || x >= m.n + q || y >= m.n + q || !m.dark(y - q, x - q), 1, -q, -q)
      : cellOutlines(m.n, m.n, (x, y) => m.dark(y, x), 1);
    ctx.fill(subsToPath2D(subs), 'evenodd');
    const mod = st.size / m.n;
    const notes = [t('{n} × {n} Module, je {mod} mm.', { n: m.n, mod: dec(mod.toFixed(2)) })];
    if (mod < 0.5) notes.push(t('Sehr kleine Module: größer machen oder weniger Fehlerkorrektur wählen, sonst lässt sich der Code schwer lesen.'));
    if (variable) notes.push(t('Vorschau mit Nummer {n}: {text}', { n: ed.varText.current + offset, text: shown.length > 60 ? shown.slice(0, 59) + '…' : shown }));
    info.textContent = notes.join(' ');
    info.classList.toggle('error', mod < 0.5);
  };

  const body = [
    h('label', { for: 'qr-kind' }, t('Art')),
    select('qr-kind', form.kind as Kind, [['text', t('Text / Internetadresse')], ['wifi', t('WLAN-Zugang')], ['vcard', t('Kontakt (vCard)')]], (v) => ((form.kind = v), update())),
    ...groups.text, ...groups.wifi, ...groups.vcard,
    h('label', { for: 'qr-ec' }, t('Fehlerkorrektur')),
    select('qr-ec', st.ec, LEVELS, (v) => ((st.ec = v), update())),
    h('label', { for: 'qr-size' }, t('Größe (mm)')),
    numField('qr-size', st.size, (v) => ((st.size = Math.max(1, v)), update())),
    h('span'), check(st.invert, (v) => ((st.invert = v), update()), t('Negativ: Hintergrund lasern (für dunkle Materialien)')),
    h('label', { for: 'qr-quiet' }, t('Ruhezone (Module)')),
    numField('qr-quiet', st.quiet, (v) => ((st.quiet = Math.max(0, Math.round(v))), update()), t('Freier Rand um den Code; wird nur bei Negativ gelasert')),
    h('span'), check(variable, (v) => ((variable = v), update()), t('Variabler Text (Platzhalter wie %# oder %0, siehe „Variabler Text …“)')),
    ...offRow,
  ];
  const dlg = h(
    'dialog',
    { class: 'offset-dialog qr-dialog' },
    h('h3', {}, old ? t('QR-Code bearbeiten') : t('QR-Code erstellen')),
    h('div', { class: 'qr-layout' }, h('div', { class: 'form' }, ...body), canvas),
    info,
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          if (!ok) return;
          st.form = { ...form };
          st.vt = variable ? { offset } : undefined;
          if (!variable) delete st.vt;
          try {
            localStorage.setItem(LAST_KEY, JSON.stringify({ ec: st.ec, size: st.size, invert: st.invert, quiet: st.quiet }));
          } catch {
            /* Speicher nicht verfügbar */
          }
          if (o && old) ed.updateBarcode(o, { data: st.data, ec: st.ec, size: st.size, invert: st.invert, quiet: st.quiet, form: st.form, vt: st.vt });
          else ed.addBarcode(st);
          dlg.close();
        },
      }, old ? t('Übernehmen') : t('Erstellen')),
    ),
  );
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  update();
}

/** Fenster „Variabler Text“: Nummer, Bereich, Schrittweite, CSV-Datei und Übersicht der Platzhalter */
export function openVarTextDialog(ed: Editor) {
  const vt = ed.varText;
  const cur = h('input', { type: 'text', id: 'vt-current', class: 'small' }) as HTMLInputElement;
  const num = (id: string, key: 'start' | 'end' | 'advance', title?: string) =>
    numField(id, vt[key], (v) => ed.setVarText({ [key]: Math.round(v) }), title);
  const csvInfo = h('span', { class: 'muted' });
  const preview = h('div', { class: 'vt-preview' });
  let header = vt.csv ? vt.csv.header !== null : true;

  const refresh = () => {
    if (document.activeElement !== cur) cur.value = String(vt.current);
    const c = vt.csv;
    csvInfo.textContent = c ? tn('{name}: {n} Zeile', '{name}: {n} Zeilen', c.rows.length, { name: c.name }) : t('Keine CSV-Datei geladen');
    clearBtn.hidden = !c;
    preview.replaceChildren();
    const objs = ed.varTextObjs(false);
    if (!objs.length) preview.append(h('div', { class: 'muted' }, t('Auf dieser Seite gibt es noch keinen variablen Text. Text auswählen und in der Textleiste „Variabel“ einschalten.')));
    for (const o of objs.slice(0, 8)) {
      const s = o.shape;
      if (s.kind !== 'text' && s.kind !== 'barcode') continue;
      const tpl = s.kind === 'text' ? s.text : s.data;
      const out = s.kind === 'text' ? shownText(s) : barcodeData(s);
      preview.append(h('div', {}, h('code', {}, tpl.split('\n')[0]), ' → ', h('b', {}, out.split('\n')[0] || ' ')));
    }
  };
  cur.addEventListener('change', () => {
    const v = parseInt(cur.value, 10);
    if (Number.isFinite(v)) ed.setVarText({ current: v });
    refresh();
  });
  const step = (n: number) => (ed.stepVarText(n), refresh());
  const clearBtn = h('button', { class: 'btn', onclick: () => (ed.clearCsv(), refresh()) }, t('Entfernen'));
  const loadCsv = async () => {
    const f = await openText(t('CSV-Datei'), ['csv', 'txt', 'tsv']);
    if (!f) return;
    const n = ed.loadCsv(f[0], f[1], header);
    ed.hint = tn('CSV-Datei geladen: {n} Zeile. Die Nummer läuft jetzt von 1 bis {n}.', 'CSV-Datei geladen: {n} Zeilen. Die Nummer läuft jetzt von 1 bis {n}.', n);
    ed.emit('tool');
    dlg.querySelectorAll<HTMLInputElement>('#vt-start, #vt-end').forEach((el) => (el.value = String(el.id === 'vt-start' ? vt.start : vt.end)));
    refresh();
  };

  const codes = h('div', { class: 'vt-codes' }, ...CODES.map(([c, d]) => h('div', {}, h('code', {}, c), ' ', d)));
  const dlg = h(
    'dialog',
    { class: 'offset-dialog vt-dialog' },
    h('h3', {}, t('Variabler Text')),
    h(
      'div',
      { class: 'form' },
      h('label', { for: 'vt-current' }, t('Aktuelle Nummer')),
      h('span', { class: 'vt-inline' },
        h('button', { class: 'btn', title: t('Eine Nummer zurück'), onclick: () => step(-1) }, '◀'), cur,
        h('button', { class: 'btn', title: t('Eine Nummer weiter'), onclick: () => step(1) }, '▶'),
        h('button', { class: 'btn', title: t('Auf den Startwert setzen'), onclick: () => (ed.setVarText({ current: vt.start }), refresh()) }, t('Zurücksetzen'))),
      h('label', { for: 'vt-start' }, t('Start')), num('vt-start', 'start'),
      h('label', { for: 'vt-end' }, t('Ende')), num('vt-end', 'end', t('Nach dem Ende geht es wieder beim Start weiter')),
      h('label', { for: 'vt-advance' }, t('Schrittweite')), num('vt-advance', 'advance'),
      h('span'), check(vt.autoAdvance, (v) => ed.setVarText({ autoAdvance: v }), t('Nach jedem Job und jeder gespeicherten G-Code-Datei weiterzählen')),
      h('label', {}, t('CSV-Datei')),
      h('span', { class: 'vt-inline' }, h('button', { class: 'btn', onclick: () => void loadCsv() }, t('Laden …')), clearBtn, csvInfo),
      h('span'), check(header, (v) => (header = v), t('Erste Zeile enthält Überschriften')),
    ),
    h('div', { class: 'note' }, t('Die Nummer ist die Seriennummer und zugleich die Zeile der CSV-Datei (erste Datenzeile = 1). Jedes Objekt kann einen eigenen Versatz haben, z. B. für mehrere Schilder in einem Job.')),
    h('h4', {}, t('Diese Seite mit der aktuellen Nummer')),
    preview,
    h('details', {}, h('summary', {}, t('Platzhalter')), codes),
    h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn primary', onclick: () => dlg.close() }, t('Schließen'))),
  );
  dlg.addEventListener('input', () => setTimeout(refresh, 0));
  dlg.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && e.target === cur) cur.dispatchEvent(new Event('change'));
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  refresh();
}
