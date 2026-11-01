// Editor: mehrere Projekte als Tabs. Das aktive Projekt liegt wie bisher in doc, history und view;
// die übrigen Tabs halten ihren Stand (Dokument, Auswahl, Rückgängig-Verlauf, Ansicht) in ProjectTab.
import { allObjs, bumpIds, Doc, loadDoc, newDoc, Obj } from '../model';
import { History } from '../history';
import { restoreAssets } from '../images';
import { t } from '../i18n';
import type { Editor } from '../editor';

const TABS_KEY = 'kizamubeam.tabs';

export interface ProjectTab {
  id: number;
  /** Dateiname ohne Endung; null = noch nie gespeichert oder geöffnet */
  name: string | null;
  /** Stand beim letzten Öffnen/Speichern (ohne Seitenindex), um ungespeicherte Änderungen zu erkennen */
  saved: string;
  /** Ungespeicherte Änderungen (wird verzögert mit der automatischen Sicherung bestimmt) */
  changed: boolean;
  // Nur für inaktive Tabs aktuell; der aktive Tab lebt in Editor.doc, .sel, .history und .view
  doc: Doc;
  sel: number[];
  history: History;
  view: { zoom: number; ox: number; oy: number } | null;
  /** JSON des Dokuments eines inaktiven Tabs für die automatische Sicherung */
  json?: string;
}

let nextTabId = 1;

/** Vergleichsschlüssel eines Dokuments: Seitenwechsel allein zählt nicht als Änderung */
export const docKey = (d: Doc) => JSON.stringify({ ...d, page: 0 });

export const makeTab = (doc: Doc, name: string | null = null, changed = false): ProjectTab => ({
  id: nextTabId++,
  name,
  saved: changed ? '' : docKey(doc),
  changed,
  doc,
  sel: [],
  history: new History(),
  view: null,
});

/** Dateiname ohne Ordner und Endung */
export const tabNameFromPath = (path: string) => (path.split(/[\\/]/).pop() ?? path).replace(/\.(kzb|kzt|lwk|json|lbrn2?)$/i, '');

export class EditorTabs {
  /** Angezeigter Name eines Tabs */
  tabTitle(this: Editor, tab: ProjectTab): string {
    return tab.name ?? tab.doc.template?.title ?? t('Unbenannt');
  }
  /** Leerer, unveränderter Tab ohne Verlauf: Öffnen und Vorlagen benutzen ihn statt eines neuen */
  tabIsBlank(this: Editor, tab: ProjectTab = this.tab): boolean {
    const doc = tab === this.tab ? this.doc : tab.doc;
    const hist = tab === this.tab ? this.history : tab.history;
    return !tab.name && !hist.canUndo && !hist.canRedo && allObjs(doc).length === 0;
  }
  /** Stand des aktiven Tabs in sein ProjectTab-Objekt übernehmen */
  stashTab(this: Editor) {
    const tab = this.tab;
    tab.doc = this.doc;
    tab.sel = this.sel.map((o) => o.id);
    tab.history = this.history;
    tab.view = { ...this.view };
    tab.json = JSON.stringify(this.doc);
  }
  /** Tab i anzeigen (ohne vorher den aktiven Tab zu sichern) */
  showTab(this: Editor, i: number) {
    this.clearPageState();
    this.tabIndex = i;
    const tab = this.tab;
    this.doc = tab.doc;
    this.history = tab.history;
    delete tab.json;
    const ids = new Set(tab.sel);
    this.sel = this.doc.objs.filter((o) => ids.has(o.id));
    this.checkIssues = [];
    this.checkActive = null;
    this.touchVarText();
    if (tab.view) {
      Object.assign(this.view, tab.view);
      this.emit('view');
    } else this.zoomPage();
    this.emit('doc');
    this.emit('sel');
    this.onTabsChange?.();
  }
  switchTab(this: Editor, i: number) {
    if (i < 0 || i >= this.tabs.length || i === this.tabIndex) return;
    this.updateChanged();
    this.stashTab();
    this.showTab(i);
    this.saveNow();
  }
  /** Neuer Tab hinter dem aktiven; ohne doc ein leeres Projekt mit dem Bett des aktuellen Geräts */
  newTab(this: Editor, doc?: Doc, name: string | null = null): ProjectTab {
    if (!doc) {
      doc = newDoc();
      doc.bed = { ...this.doc.bed };
    }
    const tab = makeTab(doc, name);
    this.updateChanged();
    this.stashTab();
    this.tabs.splice(this.tabIndex + 1, 0, tab);
    this.showTab(this.tabIndex + 1);
    this.saveNow();
    return tab;
  }
  /** Tab i schließen (Rückfrage bei ungespeicherten Änderungen macht die Oberfläche). Der letzte Tab wird geleert. */
  closeTab(this: Editor, i = this.tabIndex) {
    if (i < 0 || i >= this.tabs.length) return;
    if (this.tabs.length === 1) {
      const doc = newDoc();
      doc.bed = { ...this.doc.bed };
      this.tabs[0] = makeTab(doc);
      this.showTab(0);
    } else if (i === this.tabIndex) {
      this.tabs.splice(i, 1);
      this.showTab(Math.min(i, this.tabs.length - 1));
    } else {
      this.tabs.splice(i, 1);
      if (i < this.tabIndex) this.tabIndex--;
      this.onTabsChange?.();
    }
    this.saveNow();
  }
  /** Tab from an die Stelle to schieben (Index nach dem Herausnehmen) */
  moveTab(this: Editor, from: number, to: number) {
    const n = this.tabs.length;
    if (from === to || from < 0 || from >= n || to < 0 || to >= n) return;
    const cur = this.tab;
    const [tab] = this.tabs.splice(from, 1);
    this.tabs.splice(to, 0, tab);
    this.tabIndex = this.tabs.indexOf(cur);
    this.onTabsChange?.();
    this.saveNow();
  }
  /** Projektdatei in einem Tab öffnen: im aktiven, wenn er leer ist, sonst in einem neuen */
  openInTab(this: Editor, json: string, name: string | null) {
    const doc = this.parseProject(json);
    if (this.tabIsBlank()) {
      this.clearPageState();
      this.tab.name = name;
      this.doc = this.tab.doc = doc;
      this.sel = [];
      this.zoomPage();
      this.markSaved(name);
      this.emit('doc');
      this.emit('sel');
    } else {
      this.newTab(doc, name);
      this.markSaved(name);
    }
  }
  /** Aktiver Tab entspricht der Datei name (nach Öffnen oder Speichern) */
  markSaved(this: Editor, name: string | null) {
    const tab = this.tab;
    if (name) tab.name = name;
    tab.saved = docKey(this.doc);
    tab.changed = false;
    this.onTabsChange?.();
    this.scheduleSave();
  }
  /** Vergleichsschlüssel des aktiven Dokuments (für markSaved nach einem Dialog) */
  tabKey(this: Editor): string {
    return docKey(this.doc);
  }
  /** Ungespeicherte Änderungen des aktiven Tabs neu bestimmen */
  updateChanged(this: Editor) {
    const tab = this.tab;
    const changed = docKey(this.doc) !== tab.saved;
    if (changed === tab.changed) return;
    tab.changed = changed;
    this.onTabsChange?.();
  }
  /** Alle Tabs für die automatische Sicherung */
  tabsJson(this: Editor, activeJson: string): string {
    return JSON.stringify({
      active: this.tabIndex,
      tabs: this.tabs.map((tab, i) => ({
        name: tab.name,
        changed: tab.changed,
        doc: i === this.tabIndex ? '@' : (tab.json ??= JSON.stringify(tab.doc)),
      })),
    }).replace('"doc":"@"', () => `"doc":${JSON.stringify(activeJson)}`);
  }
  /** Tabs aus der automatischen Sicherung; false, wenn keine da ist */
  restoreTabs(this: Editor, migrate: (objs: Obj[]) => void): boolean {
    let st: { active?: number; tabs?: { name?: string | null; changed?: boolean; doc: string }[] };
    try {
      st = JSON.parse(localStorage.getItem(TABS_KEY) ?? 'null');
    } catch {
      return false;
    }
    if (!st || !Array.isArray(st.tabs) || !st.tabs.length) return false;
    const tabs: ProjectTab[] = [];
    for (const raw of st.tabs) {
      try {
        const doc = loadDoc(JSON.parse(raw.doc));
        bumpIds(allObjs(doc));
        migrate(allObjs(doc));
        restoreAssets(this.assetIds(allObjs(doc)));
        tabs.push(makeTab(doc, typeof raw.name === 'string' ? raw.name : null, !!raw.changed));
      } catch {
        /* beschädigter Tab: weglassen */
      }
    }
    if (!tabs.length) return false;
    this.tabs = tabs;
    this.tabIndex = Math.max(0, Math.min(tabs.length - 1, st.active ?? 0));
    this.doc = this.tab.doc;
    this.history = this.tab.history;
    return true;
  }
  saveTabs(this: Editor, activeJson: string) {
    try {
      localStorage.setItem(TABS_KEY, this.tabsJson(activeJson));
    } catch {
      // Zu groß für den Speicher: wenigstens das aktive Projekt bleibt unter dem alten Schlüssel erhalten
      try {
        localStorage.removeItem(TABS_KEY);
      } catch {
        /* nicht verfügbar */
      }
    }
  }
}
