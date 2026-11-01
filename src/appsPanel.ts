// Fenster „Werkzeugkasten“: alle Generatoren und Spezialwerkzeuge als Kacheln, nach Gruppen geordnet, mit
// Suche und Filter. Ein Klick ruft dieselbe Aktion auf wie Menü oder Funktionsleiste. Welche Kacheln es gibt,
// steht in apps.ts; Symbol, Aufruf und Verfügbarkeit kommen von der Aktion (toolbars.ts).
// Gemerkt werden Filter und zugeklappte Gruppen („kizamubeam.apps“).
import type { Editor } from './editor';
import { h } from './dom';
import { t, tn } from './i18n';
import { ICONS } from './icons';
import { dockWindow, isNewWindow } from './dock';
import { getAction } from './toolbars';
import { AppGroup, appGroups, AppInfo, appList, searchApps } from './apps';

const KEY = 'kizamubeam.apps';

interface State {
  /** Gewählter Filter; leer = alle Gruppen */
  filter: AppGroup | '';
  collapsed: AppGroup[];
}

function load(): State {
  const st: State = { filter: '', collapsed: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    const ids = appGroups().map((g) => g.id) as string[];
    if (raw && typeof raw === 'object') {
      if (ids.includes(raw.filter)) st.filter = raw.filter;
      if (Array.isArray(raw.collapsed)) st.collapsed = raw.collapsed.filter((x: unknown) => ids.includes(x as string));
    }
  } catch {
    /* Speicher nicht verfügbar */
  }
  return st;
}

function save(st: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(st));
  } catch {
    /* Speicher nicht verfügbar */
  }
}

function hint(ed: Editor, msg: string) {
  ed.hint = msg;
  ed.emit('tool');
}

/** Kachel anklicken: Aktion ausführen oder sagen, was fehlt */
function runApp(ed: Editor, app: AppInfo) {
  const a = getAction(app.id);
  if (!a) return;
  if (a.enabled && !a.enabled()) {
    hint(ed, app.group === 'image' ? t('„{name}“: erst ein Bild auswählen.', { name: app.name }) : t('„{name}“: erst passende Objekte auswählen.', { name: app.name }));
    return;
  }
  a.run();
}

export function buildAppsPanel(ed: Editor) {
  const body = dockWindow('apps', t('Werkzeugkasten'), { left: true });
  const st = load();
  const apps = appList().filter((a) => getAction(a.id));
  const groups = appGroups();

  const search = h('input', { type: 'search', class: 'apps-search', placeholder: t('Werkzeuge suchen …'), 'aria-label': t('Werkzeuge suchen') }) as HTMLInputElement;
  const chips = h('div', { class: 'apps-chips' });
  const list = h('div', { class: 'apps-list' });
  body.append(h('div', { class: 'apps-top' }, h('label', { class: 'apps-searchbox' }, h('span', { class: 'apps-sicon', html: ICONS.search }), search), chips), list);

  const tile = (app: AppInfo) => {
    const a = getAction(app.id)!;
    return h('button', { class: 'app-tile', 'data-g': app.group, title: `${app.name}\n${app.desc}`, onclick: () => runApp(ed, app) },
      h('span', { class: 'app-art', html: ICONS[a.icon ?? ''] ?? '' }),
      h('span', { class: 'app-name' }, app.name),
    );
  };

  const renderChips = () => {
    const chip = (id: AppGroup | '', label: string) =>
      h('button', {
        class: `apps-chip${st.filter === id ? ' on' : ''}`,
        onclick: () => {
          st.filter = id;
          save(st);
          render();
        },
      }, label);
    chips.replaceChildren(chip('', t('Alle|Werkzeugkasten')), ...groups.map((g) => chip(g.id, g.chip)));
  };

  const render = () => {
    renderChips();
    const q = search.value.trim();
    const inFilter = apps.filter((a) => !st.filter || a.group === st.filter);
    if (q) {
      const hits = searchApps(inFilter, q);
      list.replaceChildren(
        h('div', { class: 'apps-hits' }, hits.length ? tn('{n} Treffer|eins', '{n} Treffer', hits.length) : t('Nichts gefunden. Andere Wörter versuchen oder den Filter auf „Alle“ stellen.')),
        h('div', { class: 'apps-grid' }, ...hits.map(tile)),
      );
      return;
    }
    list.replaceChildren(
      ...groups
        .filter((g) => !st.filter || g.id === st.filter)
        .map((g) => {
          const items = inFilter.filter((a) => a.group === g.id);
          const closed = st.collapsed.includes(g.id) && !st.filter;
          const head = h('button', {
            class: 'apps-head',
            'aria-expanded': String(!closed),
            onclick: () => {
              if (st.filter) return;
              st.collapsed = closed ? st.collapsed.filter((x) => x !== g.id) : [...st.collapsed, g.id];
              save(st);
              render();
            },
          },
            h('span', { class: 'apps-gicon', 'data-g': g.id, html: ICONS[g.icon] }),
            h('span', { class: 'apps-gname' }, g.label),
            h('span', { class: 'apps-count' }, String(items.length)),
            st.filter ? null : h('span', { class: 'apps-chev', html: closed ? ICONS.chevdown : ICONS.chevup }),
          );
          return h('section', { class: 'apps-sec' }, head, closed ? null : h('div', { class: 'apps-grid' }, ...items.map(tile)));
        }),
    );
  };

  search.addEventListener('input', render);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && search.value) {
      e.stopPropagation();
      search.value = '';
      render();
    } else if (e.key === 'Enter') {
      const first = searchApps(apps.filter((a) => !st.filter || a.group === st.filter), search.value.trim())[0];
      if (first) runApp(ed, first);
    }
  });
  render();

  // Bestehende Nutzer: einmal auf das neue Fenster hinweisen (es startet bei ihnen ausgeblendet)
  setTimeout(() => {
    if (isNewWindow('apps')) hint(ed, t('Neu: der Werkzeugkasten mit allen Generatoren und Werkzeugen. Einblenden über Fenster → Werkzeugkasten oder den Knopf in der Werkzeugleiste.'));
  }, 1500);
}
