// Anpassbare Funktionsleisten: Hauptleiste oben und Werkzeugleiste links bestehen aus Aktionen, deren
// Auswahl und Reihenfolge der Nutzer festlegt (Fenster → Funktionsleisten anpassen … oder Rechtsklick auf
// eine Leiste). Außerdem lassen sich alle Leisten (auch Eigenschaften, Palette, Statusleiste) ausblenden.
// Gespeichert wird je Nutzer im localStorage („kizamubeam.toolbars“).
import { ICONS } from './icons';
import { $, h } from './dom';
import { t } from './i18n';

export interface Action {
  id: string;
  /** Rubrik im Anpassen-Dialog */
  cat: string;
  /** Name in Listen und Tooltip (mit Tastenkürzel) */
  label: string;
  /** Symbol aus icons.ts; ohne Symbol zeigt die Leiste den Kurztext */
  icon?: string;
  short?: string;
  run: () => void;
  enabled?: () => boolean;
  /** Knopf als eingeschaltet zeigen (aktives Werkzeug) */
  on?: () => boolean;
  /** Symbol und Tooltip, die sich zur Laufzeit ändern */
  dyn?: () => { icon?: string; label?: string };
  /** Kleiner Knopf (Optionen zu einem Nachbarn) */
  small?: boolean;
}

export type BarId = 'main' | 'tools';
/** Leisten, die sich ausblenden lassen */
export type BarKey = BarId | 'numbar' | 'palette' | 'status';
type IconSize = 's' | 'm' | 'l';

interface Config {
  bars: Record<BarId, string[]>;
  size: Record<BarId, IconSize>;
  hidden: BarKey[];
}

const KEY = 'kizamubeam.toolbars';
export const SEP = '|';
const BAR_EL: Record<BarKey, string> = { main: '#toolbar', tools: '#tools', numbar: '#numbar', palette: '#palette', status: '#status' };

const actions = new Map<string, Action>();
let defaults: Record<BarId, string[]> = { main: [], tools: [] };
let cfg: Config;

export const barNames = (): Record<BarKey, string> => ({
  main: t('Hauptleiste'),
  tools: t('Werkzeugleiste'),
  numbar: t('Eigenschaftenleiste'),
  palette: t('Farbpalette'),
  status: t('Statusleiste'),
});

/** Aktionen und Standardbelegung festlegen, gespeicherte Anpassung laden und die Leisten aufbauen */
export function initToolbars(list: Action[], def: Record<BarId, string[]>) {
  list.forEach((a) => actions.set(a.id, a));
  defaults = def;
  cfg = load();
  for (const k of Object.keys(BAR_EL) as BarKey[]) applyHidden(k);
  renderBar('main');
  renderBar('tools');
  for (const id of ['main', 'tools'] as BarId[])
    $(BAR_EL[id]).addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      barMenu(id, e.clientX, e.clientY, btn?.dataset.action ?? null, btn ? [...$(BAR_EL[id]).children].indexOf(btn) : -1 /* jeder Eintrag ist genau ein Element */);
    });
}

/** Aktivierung und Zustand aller Knöpfe nachziehen (nach Auswahl- oder Werkzeugwechsel) */
export function refreshBars() {
  for (const id of ['main', 'tools'] as BarId[])
    for (const b of $(BAR_EL[id]).querySelectorAll<HTMLButtonElement>('[data-action]')) {
      const a = actions.get(b.dataset.action!)!;
      if (a.enabled) b.disabled = !a.enabled();
      if (a.on) b.classList.toggle('on', a.on());
      if (a.dyn) {
        const d = a.dyn();
        if (d.icon && b.dataset.icon !== d.icon) ((b.innerHTML = ICONS[d.icon]), (b.dataset.icon = d.icon));
        if (d.label) b.title = d.label;
      }
    }
}

export const isBarHidden = (k: BarKey) => cfg.hidden.includes(k);

export function toggleBar(k: BarKey) {
  cfg.hidden = isBarHidden(k) ? cfg.hidden.filter((x) => x !== k) : [...cfg.hidden, k];
  applyHidden(k);
  save();
}

/** Ein- und Ausblenden der Leisten im Menü Fenster zurücksetzen */
export function showAllBars() {
  cfg.hidden = [];
  for (const k of Object.keys(BAR_EL) as BarKey[]) applyHidden(k);
  save();
}

function applyHidden(k: BarKey) {
  $(BAR_EL[k]).hidden = isBarHidden(k);
}

function load(): Config {
  const c: Config = { bars: { main: [...defaults.main], tools: [...defaults.tools] }, size: { main: 'm', tools: 'm' }, hidden: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') {
      for (const id of ['main', 'tools'] as BarId[]) {
        if (Array.isArray(raw.bars?.[id])) c.bars[id] = raw.bars[id].filter((x: unknown) => x === SEP || actions.has(x as string));
        if (['s', 'm', 'l'].includes(raw.size?.[id])) c.size[id] = raw.size[id];
      }
      if (Array.isArray(raw.hidden)) c.hidden = raw.hidden.filter((x: unknown) => (x as string) in BAR_EL);
    }
  } catch {
    /* Speicher nicht verfügbar oder kaputt: Standard */
  }
  return c;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* Speicher nicht verfügbar */
  }
}

function renderBar(id: BarId) {
  const bar = $(BAR_EL[id]);
  bar.replaceChildren();
  bar.dataset.size = cfg.size[id];
  for (const x of cfg.bars[id]) {
    if (x === SEP) {
      bar.append(h('div', { class: 'sep' }));
      continue;
    }
    const a = actions.get(x)!;
    const b = h('button', { class: `ib${a.icon ? '' : ' text'}${a.small ? ' small' : ''}`, title: a.label, onclick: () => a.run() });
    if (a.icon) {
      b.innerHTML = ICONS[a.icon];
      b.dataset.icon = a.icon;
    } else b.textContent = a.short ?? a.label;
    b.dataset.action = a.id;
    bar.append(b);
  }
  if (!cfg.bars[id].length) bar.append(h('span', { class: 'muted bar-empty' }, t('Leer – Rechtsklick zum Anpassen')));
  refreshBars();
}

function setBar(id: BarId, list: string[]) {
  // Doppelte Trennlinien und solche am Rand weglassen
  const out: string[] = [];
  for (const x of list) if (x !== SEP || (out.length && out[out.length - 1] !== SEP)) out.push(x);
  while (out[out.length - 1] === SEP) out.pop();
  cfg.bars[id] = out;
  save();
  renderBar(id);
}

// ---------- Kontextmenü einer Leiste ----------

function barMenu(id: BarId, x: number, y: number, action: string | null, index: number) {
  document.querySelector('.ctx-menu')?.remove();
  const close = () => (menu.remove(), document.removeEventListener('mousedown', outside, true));
  const outside = (e: MouseEvent) => !menu.contains(e.target as Node) && close();
  const item = (label: string, f: () => void) => h('button', { onclick: () => (close(), f()) }, label);
  const a = action ? actions.get(action) : null;
  const menu = h(
    'div',
    { class: 'ctx-menu menu-items' },
    item(t('Funktionsleisten anpassen …'), () => openToolbarDialog(id)),
    a ? item(t('„{name}“ aus der Leiste entfernen', { name: a.label.replace(/ \(.*\)$/, '') }), () => setBar(id, cfg.bars[id].filter((_, i) => i !== index))) : null,
    h('hr'),
    item(t('{bar} ausblenden', { bar: barNames()[id] }), () => toggleBar(id)),
  );
  menu.style.left = `${Math.min(x, window.innerWidth - 260)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 120)}px`;
  document.body.append(menu);
  document.addEventListener('mousedown', outside, true);
}

// ---------- Anpassen-Dialog ----------

export function openToolbarDialog(start: BarId = 'main') {
  let bar: BarId = start;
  let selAvail: string | null = null;
  let selIdx = -1;
  let filter = '';
  const names = barNames();
  const barSel = h('select', { onchange: () => ((bar = barSel.value as BarId), (selIdx = -1), sync(), renderLists()) },
    h('option', { value: 'main' }, names.main),
    h('option', { value: 'tools' }, names.tools),
  ) as HTMLSelectElement;
  barSel.value = bar;
  const sizeSel = h('select', { onchange: () => ((cfg.size[bar] = sizeSel.value as IconSize), save(), renderBar(bar)) },
    h('option', { value: 's' }, t('Klein|Symbole')),
    h('option', { value: 'm' }, t('Normal|Symbole')),
    h('option', { value: 'l' }, t('Groß|Symbole')),
  ) as HTMLSelectElement;
  const shownChk = h('input', { type: 'checkbox', onchange: () => toggleBar(bar) }) as HTMLInputElement;
  const sync = () => {
    sizeSel.value = cfg.size[bar];
    shownChk.checked = !isBarHidden(bar);
  };
  const search = h('input', { type: 'search', placeholder: t('Suchen …'), oninput: () => ((filter = search.value.toLowerCase()), renderLists()) }) as HTMLInputElement;
  const avail = h('div', { class: 'tb-list' });
  const current = h('div', { class: 'tb-list' });

  const row = (a: Action | null, extra: Record<string, unknown>) =>
    h('div', { class: 'tb-row', ...extra },
      a ? h('span', { class: `tb-icon${a.icon ? '' : ' text'}`, html: a.icon ? ICONS[a.icon] : '' }, a.icon ? null : a.short ?? '') : h('span', { class: 'tb-icon' }),
      h('span', {}, a ? a.label : t('— Trennlinie —')),
    );

  const add = (id: string) => {
    const list = [...cfg.bars[bar]];
    const at = selIdx >= 0 ? selIdx + 1 : list.length;
    list.splice(at, 0, id);
    selIdx = at;
    setBar(bar, list);
    renderLists();
  };
  const removeSel = () => {
    if (selIdx < 0) return;
    const list = cfg.bars[bar].filter((_, i) => i !== selIdx);
    selIdx = Math.min(selIdx, list.length - 1);
    setBar(bar, list);
    renderLists();
  };
  const move = (d: number) => {
    const list = [...cfg.bars[bar]];
    const k = selIdx + d;
    if (selIdx < 0 || k < 0 || k >= list.length) return;
    [list[selIdx], list[k]] = [list[k], list[selIdx]];
    selIdx = k;
    setBar(bar, list);
    renderLists();
  };

  let dragFrom: { kind: 'avail'; id: string } | { kind: 'cur'; index: number } | null = null;
  const renderLists = () => {
    const used = new Set(cfg.bars[bar]);
    avail.replaceChildren();
    let cat = '';
    for (const a of actions.values()) {
      if (filter && !a.label.toLowerCase().includes(filter) && !a.cat.toLowerCase().includes(filter)) continue;
      if (a.cat !== cat) avail.append(h('div', { class: 'tb-cat' }, (cat = a.cat)));
      const r = row(a, {
        draggable: true,
        onclick: () => ((selAvail = a.id), renderLists()),
        ondblclick: () => add(a.id),
        ondragstart: () => (dragFrom = { kind: 'avail', id: a.id }),
      });
      r.classList.toggle('sel', selAvail === a.id);
      r.classList.toggle('used', used.has(a.id));
      avail.append(r);
    }
    current.replaceChildren();
    cfg.bars[bar].forEach((id, i) => {
      const r = row(id === SEP ? null : actions.get(id)!, {
        draggable: true,
        onclick: () => ((selIdx = i), renderLists()),
        ondblclick: () => ((selIdx = i), removeSel()),
        ondragstart: () => (dragFrom = { kind: 'cur', index: i }),
      });
      r.dataset.index = String(i);
      r.classList.toggle('sel', i === selIdx);
      current.append(r);
    });
    if (!cfg.bars[bar].length) current.append(h('div', { class: 'muted tb-hint' }, t('Aktionen hierher ziehen')));
  };
  // Ziehen: aus „Verfügbar“ einfügen oder in der Leiste umsortieren
  const dropIndex = (e: DragEvent) => {
    const r = (e.target as HTMLElement).closest<HTMLElement>('.tb-row');
    if (!r?.dataset.index) return cfg.bars[bar].length;
    const box = r.getBoundingClientRect();
    return Number(r.dataset.index) + (e.clientY > box.top + box.height / 2 ? 1 : 0);
  };
  current.addEventListener('dragover', (e) => {
    if (!dragFrom) return;
    e.preventDefault();
    current.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    const k = dropIndex(e);
    const rows = current.querySelectorAll('.tb-row');
    if (k < rows.length) rows[k].classList.add('drop-before');
    else rows[rows.length - 1]?.classList.add('drop-after');
  });
  current.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!dragFrom) return;
    const list = [...cfg.bars[bar]];
    let k = dropIndex(e);
    if (dragFrom.kind === 'avail') list.splice(k, 0, dragFrom.id);
    else {
      const [x] = list.splice(dragFrom.index, 1);
      if (k > dragFrom.index) k--;
      list.splice(k, 0, x);
    }
    selIdx = k;
    dragFrom = null;
    setBar(bar, list);
    renderLists();
  });
  avail.addEventListener('dragover', (e) => dragFrom?.kind === 'cur' && e.preventDefault());
  avail.addEventListener('drop', (e) => {
    e.preventDefault();
    if (dragFrom?.kind !== 'cur') return;
    selIdx = dragFrom.index;
    dragFrom = null;
    removeSel();
  });
  const btn = (label: string, title: string, f: () => void) => h('button', { class: 'btn', title, onclick: f }, label);
  const dlg = h(
    'dialog',
    { class: 'toolbar-dialog' },
    h('h3', {}, t('Funktionsleisten anpassen')),
    h('div', { class: 'tb-top' },
      h('label', {}, t('Leiste'), barSel),
      h('label', {}, t('Symbolgröße'), sizeSel),
      h('label', { class: 'check' }, shownChk, t('Anzeigen')),
    ),
    h('div', { class: 'tb-cols' },
      h('div', { class: 'tb-col' }, h('div', { class: 'tb-head' }, t('Verfügbare Aktionen')), search, avail),
      h('div', { class: 'tb-mid' },
        btn('→', t('Gewählte Aktion hinter der markierten Stelle einfügen'), () => selAvail && add(selAvail)),
        btn('←', t('Markierten Eintrag aus der Leiste entfernen'), removeSel),
      ),
      h('div', { class: 'tb-col' }, h('div', { class: 'tb-head' }, t('In der Leiste')), current,
        h('div', { class: 'tb-btns' },
          btn('↑', t('Nach oben bzw. links'), () => move(-1)),
          btn('↓', t('Nach unten bzw. rechts'), () => move(1)),
          btn(t('Trennlinie'), t('Trennlinie hinter der markierten Stelle einfügen'), () => add(SEP)),
        ),
      ),
    ),
    h('p', { class: 'note' }, t('Doppelklick fügt hinzu bzw. entfernt. Einträge lassen sich auch ziehen. Änderungen gelten sofort.')),
    h('div', { class: 'dialog-buttons' },
      btn(t('Standard wiederherstellen'), t('Diese Leiste auf die Standardbelegung zurücksetzen'), () => {
        selIdx = -1;
        cfg.size[bar] = 'm';
        setBar(bar, [...defaults[bar]]);
        sync();
        renderLists();
      }),
      h('button', { class: 'btn primary', onclick: () => dlg.close() }, t('Schließen')),
    ),
  );
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  sync();
  renderLists();
  dlg.showModal();
}
