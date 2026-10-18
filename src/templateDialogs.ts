// Dialoge für Vorlagen: „Als Vorlage speichern …“ (Titel, Beschreibung, gefragte Parameter), „Neu aus
// Vorlage …“ (Vorlagen-Ordner) und das Ausfüllen mit Vorschau.
import type { Editor } from './editor';
import { h } from './dom';
import { t } from './i18n';
import { buildSvg, openText, saveText } from './files';
import { loadDoc } from './model';
import { BuiltinTemplate, builtinTemplates } from './builtinTemplates';
import { parseCsv } from './vartext';
import type { ProjectParam } from './params';
import { paramControl } from './paramsPanel';
import {
  canSlide, defaultTemplate, deleteTemplate, guessColumns, hasTemplateFolder, tableRows, LibraryEntry, listTemplates, normalizeTemplate, openTemplateFolder, readTemplate,
  TEMPLATE_EXT, TemplateField, TemplateInfo, templateFields, templateFileName, templateJson, writeTemplate,
} from './templates';

const FILTER = () => t('KizamuBeam-Vorlage');
const svgUrl = (svg: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function hint(ed: Editor, msg: string) {
  ed.hint = msg;
  ed.emit('tool');
}

function showDialog(dlg: HTMLDialogElement, onClose: () => void) {
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  dlg.addEventListener('close', () => (dlg.remove(), onClose()));
  document.body.append(dlg);
  dlg.showModal();
}

// ---------- Als Vorlage speichern ----------

interface Row {
  p: ProjectParam;
  shown: boolean;
  label: string;
  slider: boolean;
}

export function openSaveTemplateDialog(ed: Editor) {
  const params = ed.paramList();
  const cur = ed.doc.template ? normalizeTemplate(ed.doc.template, params) : defaultTemplate(ed.doc);
  // Gezeigte Parameter in der Reihenfolge der Vorlage, danach die übrigen
  const rows: Row[] = [
    ...cur.fields.map((f) => ({ p: params.find((p) => p.name === f.name)!, shown: true, label: f.label ?? '', slider: !!f.slider })),
    ...params.filter((p) => !cur.fields.some((f) => f.name === p.name)).map((p) => ({ p, shown: false, label: '', slider: canSlide(p) })),
  ];
  const title = h('input', { type: 'text', id: 'tpl-title', value: ed.doc.template ? cur.title : '' , placeholder: cur.title }) as HTMLInputElement;
  const desc = h('textarea', { id: 'tpl-desc', rows: 2, placeholder: t('Wofür ist die Vorlage? (optional)') }, cur.description ?? '') as HTMLTextAreaElement;
  const err = h('div', { class: 'error' });
  const list = h('div', { class: 'tpl-fields' });

  const renderRows = () => {
    list.replaceChildren(
      ...rows.map((r, i) => {
        const shown = h('input', { type: 'checkbox', checked: r.shown, title: t('Beim Ausfüllen fragen') }) as HTMLInputElement;
        const label = h('input', { type: 'text', value: r.label, placeholder: r.p.name, disabled: !r.shown, title: t('Beschriftung im Ausfüll-Dialog') }) as HTMLInputElement;
        const slider = h('input', { type: 'checkbox', checked: r.slider, disabled: !r.shown || !canSlide(r.p) }) as HTMLInputElement;
        shown.onchange = () => ((r.shown = shown.checked), renderRows());
        label.oninput = () => (r.label = label.value);
        slider.onchange = () => (r.slider = slider.checked);
        const move = (to: number) => {
          rows.splice(to, 0, ...rows.splice(i, 1));
          renderRows();
        };
        return h('div', { class: 'tpl-field' + (r.shown ? '' : ' off') },
          h('label', { class: 'check', title: r.p.note ?? '' }, shown, r.p.name),
          label,
          h('label', { class: 'check', title: canSlide(r.p) ? '' : t('Nur bei Zahlen mit Min und Max') }, slider, t('Schieberegler')),
          h('span', { class: 'param-move' },
            h('button', { class: 'small', title: t('Nach oben'), disabled: i === 0, onclick: () => move(i - 1) }, '↑'),
            h('button', { class: 'small', title: t('Nach unten'), disabled: i === rows.length - 1, onclick: () => move(i + 1) }, '↓'),
          ),
        );
      }),
    );
  };
  renderRows();

  const info = (): TemplateInfo => ({
    title: title.value.trim() || cur.title,
    description: desc.value.trim() || undefined,
    fields: rows.filter((r) => r.shown).map((r): TemplateField => ({ name: r.p.name, label: r.label.trim() || undefined, slider: r.slider || undefined })),
  });
  /** Angaben ins Projekt übernehmen und den Inhalt der Vorlagen-Datei liefern */
  const contents = () => {
    const i = info();
    ed.setTemplate(i);
    return templateJson(ed.serialize(), i, buildSvg(ed, { preview: true }));
  };
  const toLibrary = async () => {
    try {
      const json = contents();
      const file = templateFileName(info().title);
      const exists = (await listTemplates()).some((e) => e.file.toLowerCase() === file.toLowerCase());
      if (exists && !confirm(t('Es gibt schon eine Vorlage „{name}“. Ersetzen?', { name: info().title }))) return;
      await writeTemplate(file, json, true);
      hint(ed, t('Vorlage „{name}“ gespeichert. Datei → Neu aus Vorlage … legt Projekte damit an.', { name: info().title }));
      dlg.close();
    } catch (e) {
      err.textContent = errText(e);
    }
  };
  const toFile = async () => {
    try {
      if (await saveText(templateFileName(info().title), FILTER(), TEMPLATE_EXT, 'application/json', contents())) dlg.close();
    } catch (e) {
      err.textContent = errText(e);
    }
  };

  const dlg = h('dialog', { class: 'tpl-dialog' },
    h('h3', {}, t('Als Vorlage speichern')),
    h('div', { class: 'tpl-head' },
      h('div', { class: 'form' },
        h('label', { for: 'tpl-title' }, t('Titel')), title,
        h('label', { for: 'tpl-desc' }, t('Beschreibung')), desc,
      ),
      h('img', { class: 'tpl-thumb', src: svgUrl(buildSvg(ed, { preview: true })), alt: '' }),
    ),
    h('h4', {}, t('Beim Ausfüllen fragen')),
    params.length
      ? list
      : h('p', { class: 'note' }, t('Das Projekt hat noch keine Parameter. Lege im Fenster „Parameter“ die Werte an, die beim Ausfüllen gefragt werden sollen (z. B. einen Namen oder eine Breite).')),
    params.length ? h('p', { class: 'note' }, t('Nicht gefragte Parameter behalten ihren Wert. Die Reihenfolge hier gilt im Ausfüll-Dialog.')) : null,
    err,
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', { class: 'btn', onclick: toFile }, t('Als Datei …')),
      h('button', { class: 'btn primary', onclick: toLibrary }, t('In Vorlagen speichern')),
    ),
  ) as HTMLDialogElement;
  showDialog(dlg, () => {});
  title.focus();
}

// ---------- Neu aus Vorlage ----------

export async function openTemplateLibrary(ed: Editor) {
  const grid = h('div', { class: 'tpl-grid' });
  const err = h('div', { class: 'error' });
  const use = async (file: string) => {
    try {
      const json = await readTemplate(file);
      dlg.close();
      startFromTemplate(ed, json);
    } catch (e) {
      err.textContent = errText(e);
    }
  };
  const card = (e: LibraryEntry) =>
    h('div', { class: 'tpl-card' + (e.broken ? ' broken' : ''), title: e.file },
      h('button', { class: 'tpl-pick', disabled: e.broken, onclick: () => use(e.file) },
        e.info.preview ? h('img', { src: svgUrl(e.info.preview), alt: '' }) : h('div', { class: 'tpl-noimg' }, '?'),
        h('b', {}, e.info.title),
        e.broken ? h('span', { class: 'error' }, t('Datei lässt sich nicht lesen')) : e.info.description ? h('span', { class: 'muted' }, e.info.description) : null,
      ),
      h('button', {
        class: 'small tpl-del',
        title: t('Vorlage löschen'),
        onclick: async () => {
          if (!confirm(t('Vorlage „{name}“ löschen?', { name: e.info.title }))) return;
          try {
            await deleteTemplate(e.file);
            await refresh();
          } catch (x) {
            err.textContent = errText(x);
          }
        },
      }, '×'),
    );
  const builtin = (b: BuiltinTemplate) =>
    h('div', { class: 'tpl-card' },
      h('button', { class: 'tpl-pick', onclick: () => (dlg.close(), startFromTemplate(ed, b.json())) },
        b.info.preview ? h('img', { src: svgUrl(b.info.preview), alt: '' }) : h('div', { class: 'tpl-noimg' }, '?'),
        h('b', {}, b.info.title),
        b.info.description ? h('span', { class: 'muted' }, b.info.description) : null,
      ),
    );
  const builtins = h('div', { class: 'tpl-grid' }, ...builtinTemplates().map(builtin));
  const refresh = async () => {
    try {
      const all = await listTemplates();
      grid.replaceChildren(...all.map(card));
      if (!all.length)
        grid.append(h('p', { class: 'note' }, t('Noch keine eigenen Vorlagen. Lege ein Projekt mit Parametern an und speichere es über Datei → Als Vorlage speichern … Vorlagen-Dateien (.kzt) kannst du auch über „Aus Datei …“ hinzufügen.')));
    } catch (e) {
      err.textContent = errText(e);
    }
  };
  const fromFile = async () => {
    const r = await openText(FILTER(), [TEMPLATE_EXT]);
    if (!r) return;
    dlg.close();
    await useTemplateFile(ed, r[0], r[1]);
  };
  const dlg = h('dialog', { class: 'tpl-dialog tpl-library' },
    h('h3', {}, t('Neu aus Vorlage')),
    h('h4', {}, t('Eigene Vorlagen')),
    grid,
    h('h4', {}, t('Mitgeliefert')),
    builtins,
    err,
    h('div', { class: 'dialog-buttons' },
      hasTemplateFolder() ? h('button', { class: 'btn', onclick: () => openTemplateFolder().catch((e) => (err.textContent = errText(e))) }, t('Ordner zeigen')) : null,
      h('button', { class: 'btn', onclick: fromFile }, t('Aus Datei …')),
      h('span', { class: 'param-spacer' }),
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
    ),
  ) as HTMLDialogElement;
  showDialog(dlg, () => {});
  await refresh();
}

/** Vorlagen-Datei (z. B. hineingezogen) in den Vorlagen-Ordner übernehmen und damit ein Projekt anlegen */
export async function useTemplateFile(ed: Editor, name: string, json: string) {
  try {
    loadDoc(JSON.parse(json));
  } catch (e) {
    alert(t('Datei konnte nicht geöffnet werden: {message}', { message: errText(e) }));
    return;
  }
  try {
    const have = await listTemplates();
    let file = name.replace(/^.*[\\/]/, '');
    if (!file.toLowerCase().endsWith('.' + TEMPLATE_EXT)) file += '.' + TEMPLATE_EXT;
    const taken = (f: string) => have.some((e) => e.file.toLowerCase() === f.toLowerCase());
    const same = taken(file) && (await readTemplate(have.find((e) => e.file.toLowerCase() === file.toLowerCase())!.file)) === json;
    if (!same) {
      const base = file.slice(0, -TEMPLATE_EXT.length - 1);
      for (let i = 2; taken(file); i++) file = `${base} (${i}).${TEMPLATE_EXT}`;
      await writeTemplate(file, json, false);
    }
  } catch {
    // Ordner nicht erreichbar oder Speicher voll: Die Vorlage lässt sich trotzdem benutzen
  }
  startFromTemplate(ed, json);
}

/** Vorlage als neues Projekt öffnen und den Ausfüll-Dialog zeigen; Abbrechen stellt das alte Projekt wieder her */
export function startFromTemplate(ed: Editor, json: string) {
  const before = ed.state();
  const redo = ed.history.saveRedo();
  try {
    ed.openTemplate(json);
  } catch (e) {
    alert(t('Datei konnte nicht geöffnet werden: {message}', { message: errText(e) }));
    return;
  }
  openFillDialog(ed, { before, redo });
}

// ---------- Ausfüllen ----------

/**
 * Ausfüll-Dialog: die Parameter der Vorlage mit Vorschau. fresh: gerade aus einer Vorlage angelegt
 * (Abbrechen stellt den Stand davor wieder her); sonst wird das aktuelle Projekt ausgefüllt.
 */
export function openFillDialog(ed: Editor, fresh?: { before: string; redo: ReturnType<Editor['history']['saveRedo']> }) {
  const fields = templateFields(ed.doc);
  if (!fields.length) {
    hint(ed, fresh ? t('Die Vorlage hat keine Werte zum Ausfüllen.') : t('Das Projekt hat keine Werte zum Ausfüllen. Parameter legst du im Fenster „Parameter“ an.'));
    return;
  }
  const before = fresh?.before ?? ed.state();
  const redo = fresh?.redo ?? ed.history.saveRedo();
  if (!fresh) ed.snapshot(t('Vorlage ausfüllen'));
  const info = ed.doc.template ? normalizeTemplate(ed.doc.template, ed.paramList()) : defaultTemplate(ed.doc);

  const preview = h('div', { class: 'tpl-preview' });
  const problems = h('div', { class: 'param-problems' });
  const refreshers: (() => void)[] = [];
  const form = h('div', { class: 'form tpl-form' },
    ...fields.flatMap(([p, f], i) => {
      const c = paramControl(p, (v) => ed.setParamValue(p, v, false), !!f.slider);
      refreshers.push(c.refresh);
      const id = `tpl-f${i}`;
      c.el.id = id;
      return [
        h('label', { for: id, title: p.note ?? '' }, f.label || p.name),
        h('div', {}, c.el, p.note ? h('div', { class: 'muted tpl-note' }, p.note) : null),
      ];
    }),
  );
  let queued = false;
  const render = () => {
    queued = false;
    preview.innerHTML = buildSvg(ed, { preview: true });
    refreshers.forEach((f) => f());
    problems.replaceChildren(
      ...ed.paramProblems
        .flatMap((x) => x.issues.filter((i) => i.level === 'error').map((i) => i.msg))
        .slice(0, 4)
        .map((m) => h('div', { class: 'error' }, m)),
    );
  };
  const listen = (what: string) => what === 'doc' && !queued && ((queued = true), requestAnimationFrame(render));
  ed.on(listen);

  let done = false;
  const ok = h('button', {
    class: 'btn primary',
    onclick: () => {
      done = true;
      // Nichts geändert: kein leerer Schritt im Verlauf
      if (!fresh && ed.state() === before) {
        ed.history.drop();
        ed.history.restoreRedo(redo);
        ed.emit('doc');
      }
      dlg.close();
    },
  }, fresh ? t('Anlegen') : t('Übernehmen'));
  const dlg = h('dialog', { class: 'tpl-dialog tpl-fill' },
    h('h3', {}, info.title),
    info.description ? h('p', { class: 'note' }, info.description) : null,
    h('div', { class: 'tpl-fill-body' }, preview, h('div', {}, form, problems)),
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      ok,
    ),
  ) as HTMLDialogElement;
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
  });
  showDialog(dlg, () => {
    ed.off(listen);
    if (done) return;
    // Abbrechen: Stand von vorher, ohne Spur im Verlauf
    ed.clearPageState();
    ed.load(before);
    ed.touchVarText();
    ed.history.drop();
    ed.history.restoreRedo(redo);
    if (fresh) ed.zoomPage();
    ed.emit('doc');
    ed.emit('sel');
  });
  render();
  (form.querySelector('input:not([type=range])') as HTMLInputElement | null)?.focus();
}

// ---------- Serie aus Tabelle ----------

/** Serie aus einer CSV-Tabelle: je Zeile eine feste Kopie der aktuellen Seite mit den Werten der Zeile */
export function openSeriesDialog(ed: Editor) {
  const params = ed.paramList();
  if (!params.length) {
    hint(ed, t('Für eine Serie braucht das Projekt Parameter. Lege sie im Fenster „Parameter“ an oder nimm eine Vorlage.'));
    return;
  }
  const fields = templateFields(ed.doc).map(([, f]) => f);
  const vtCsv = ed.doc.vt?.csv;
  const area = h('textarea', {
    id: 'series-csv', rows: 5, spellcheck: false,
    placeholder: params.slice(0, 2).map((p) => p.name).join(';') + '\n…',
  }, vtCsv?.header ? [vtCsv.header, ...vtCsv.rows].map((r) => r.join(';')).join('\n') : '') as HTMLTextAreaElement;
  const status = h('div', { class: 'note' });
  const mapBox = h('div', { class: 'form series-map' });
  const err = h('div', { class: 'error' });
  const map: Record<string, number> = {};
  let table: string[][] = [];
  let layout: 'pages' | 'grid' = 'grid';
  let gap = 3;

  const ok = h('button', { class: 'btn primary' }, t('Serie anlegen')) as HTMLButtonElement;
  const update = (guess: boolean) => {
    table = parseCsv(area.value);
    const header = table[0] ?? [];
    if (guess) {
      for (const k of Object.keys(map)) delete map[k];
      Object.assign(map, guessColumns(header, params, fields));
    }
    const n = Math.max(0, table.length - 1);
    status.textContent = table.length
      ? t('{n} Zeilen, Spalten: {cols}', { n, cols: header.join(', ') })
      : t('Tabelle aus einer CSV-Datei laden oder hier einfügen. Die erste Zeile enthält die Spaltennamen.');
    mapBox.replaceChildren(
      ...params.flatMap((p) => {
        const sel = h('select', { id: `series-${p.name}` },
          h('option', { value: '-1' }, t('— Wert bleibt —')),
          ...header.map((c, i) => h('option', { value: String(i), selected: map[p.name] === i }, c || t('Spalte {n}', { n: i + 1 }))),
        ) as HTMLSelectElement;
        sel.onchange = () => {
          const v = Number(sel.value);
          if (v < 0) delete map[p.name];
          else map[p.name] = v;
          check_();
        };
        return [h('label', { for: sel.id }, fields.find((f) => f.name === p.name)?.label || p.name), sel];
      }),
    );
    check_();
  };
  const check_ = () => {
    const n = table.length - 1;
    ok.disabled = n < 1 || !Object.keys(map).length;
    err.textContent = n >= 1 && !Object.keys(map).length ? t('Mindestens einem Parameter eine Spalte zuordnen.') : '';
  };
  area.addEventListener('input', () => update(true));
  const fromFile = async () => {
    const r = await openText(t('CSV-Tabelle'), ['csv', 'txt', 'tsv']);
    if (!r) return;
    area.value = r[1];
    update(true);
  };
  const radio = (v: 'pages' | 'grid', label: string) =>
    h('label', {}, h('input', { type: 'radio', name: 'series-layout', checked: layout === v, onchange: () => (layout = v) }), label);
  const gapIn = h('input', { type: 'number', id: 'series-gap', value: gap, min: 0, step: 0.5, class: 'num' }) as HTMLInputElement;
  gapIn.oninput = () => (gap = Math.max(0, Number(gapIn.value) || 0));

  ok.onclick = () => {
    try {
      const rows = tableRows(table.slice(1), map, params);
      ed.makeSeries(rows, { layout, gap });
      dlg.close();
    } catch (e) {
      err.textContent = errText(e);
    }
  };
  const dlg = h('dialog', { class: 'tpl-dialog series-dialog' },
    h('h3', {}, t('Serie aus Tabelle')),
    h('p', { class: 'note' }, t('Für jede Zeile entsteht eine feste Kopie der aktuellen Seite mit den Werten der Zeile, z. B. Namensschilder für eine ganze Liste. Die Vorlage selbst bleibt unverändert.')),
    h('div', { class: 'series-src' }, h('button', { class: 'btn', onclick: fromFile }, t('CSV-Datei wählen …'))),
    area,
    status,
    h('h4', {}, t('Spalten zuordnen')),
    mapBox,
    h('h4', {}, t('Anordnung')),
    h('div', { class: 'radios column' },
      radio('grid', t('Raster: so viele wie aufs Bett passen, dann weitere Seiten')),
      radio('pages', t('Eine Seite je Zeile, an derselben Stelle')),
    ),
    h('div', { class: 'form series-gap' }, h('label', { for: 'series-gap' }, t('Abstand (mm)')), gapIn),
    err,
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      ok,
    ),
  ) as HTMLDialogElement;
  showDialog(dlg, () => {});
  update(true);
}
