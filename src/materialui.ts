// Reiter „Material“ im Laser-Panel: Material-Bibliothek ansehen, Einträge aus Layern anlegen,
// auf Layer übernehmen (wie „Assign“ in LightBurn), importieren und exportieren.
import type { Editor } from './editor';
import { h } from './dom';
import { openText, saveText } from './files';
import { layerLabel, PALETTE } from './model';
import {
  differsFrom, entryFromLayer, entryLabel, layerPatch, library, MaterialEntry, parseLibrary, settingsSummary, thicknessLabel,
} from './materials';
import { openMaterialTestDialog } from './materialtest';

type EntryDraft = Omit<MaterialEntry, 'id'>;

/** Dialog für Material, Dicke, Titel und Beschreibung eines Eintrags */
export function openEntryDialog(init: EntryDraft, onSave: (e: EntryDraft) => void, opt: { heading?: string; imgChoice?: boolean } = {}) {
  const e = structuredClone(init);
  let withImg = !!e.img;
  const listId = `mat-list-${Math.random().toString(36).slice(2, 7)}`;
  const material = h('input', { type: 'text', value: e.material, list: listId, placeholder: 'z. B. Sperrholz Pappel' }) as HTMLInputElement;
  const thick = h('input', { type: 'text', value: e.thickness === null ? '' : String(e.thickness).replace('.', ','), placeholder: 'leer = ohne Dicke' }) as HTMLInputElement;
  const title = h('input', { type: 'text', value: e.title, placeholder: 'z. B. Schneiden, Gravieren' }) as HTMLInputElement;
  const desc = h('textarea', { rows: 3, placeholder: 'Notizen, z. B. Fokus, Abdeckband, Gerät' }) as HTMLTextAreaElement;
  desc.value = e.desc;
  const err = h('div', { class: 'warn' });
  const dlg = h('dialog', { class: 'material-dialog' },
    h('h3', {}, opt.heading ?? 'Material-Eintrag'),
    h('datalist', { id: listId }, ...library.materials().map((m) => h('option', { value: m }))),
    h('div', { class: 'form' },
      h('label', {}, 'Material'), material,
      h('label', {}, 'Dicke (mm)'), thick,
      h('label', {}, 'Titel'), title,
      h('label', {}, 'Beschreibung'), desc,
      opt.imgChoice
        ? h('span', { class: 'checks' }, h('label', { class: 'check', title: 'Auch Geschwindigkeit, Leistung, Dithering usw. für Bilder speichern' },
            h('input', { type: 'checkbox', checked: withImg, onchange: (ev: Event) => (withImg = (ev.target as HTMLInputElement).checked) }), 'Bild-Einstellungen mitspeichern'))
        : null,
    ),
    h('div', { class: 'note' }, `Einstellungen: ${settingsSummary(e.settings)}${e.img ? `; Bilder: ${e.img.speed} mm/min, ${e.img.power} %` : ''}.`),
    err,
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, 'Abbrechen'),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          const m = material.value.trim();
          const t = thick.value.trim().replace(',', '.');
          const tv = t === '' ? null : Number(t);
          if (!m) return void err.replaceChildren('Bitte ein Material angeben.');
          if (tv !== null && !(tv > 0 && isFinite(tv))) return void err.replaceChildren('Die Dicke muss eine positive Zahl sein oder leer bleiben.');
          onSave({ ...e, material: m, thickness: tv, title: title.value.trim(), desc: desc.value, img: withImg ? e.img : undefined });
          dlg.close();
        },
      }, 'Speichern'),
    ),
  );
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('keydown', (ev) => ev.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
  material.focus();
}

export function materialTab(ed: Editor): HTMLElement {
  const root = h('div', { class: 'material-tab' });
  let selected: string | null = null;
  let filter = '';
  const target = () => ed.activeLayer ?? ed.currentLayer;
  const hasImages = (i: number) => ed.layerParts(i).img;

  const assign = (e: MaterialEntry) => {
    const i = target();
    ed.updateLayer(i, layerPatch(e));
    ed.hint = `Layer ${layerLabel(i)} nutzt jetzt „${entryLabel(e)}“.`;
    ed.emit('tool');
  };
  const createFromLayer = () => {
    const i = target();
    const L = ed.layer(i);
    const imgs = hasImages(i);
    const cur = library.get(L.material);
    openEntryDialog(
      { material: cur?.material ?? '', thickness: cur?.thickness ?? null, title: cur ? cur.title : L.mode === 'fill' ? 'Gravieren' : 'Schneiden', desc: '', ...entryFromLayer(L, imgs) },
      (d) => {
        const n = library.add(d);
        selected = n.id;
        // Der Layer gehört jetzt zu diesem Eintrag
        ed.updateLayer(i, { material: n.id });
      },
      { heading: `Neuer Eintrag aus Layer ${layerLabel(i)}`, imgChoice: imgs },
    );
  };
  const updateFromLayer = (e: MaterialEntry) => {
    const i = target();
    const L = ed.layer(i);
    if (!confirm(`„${entryLabel(e)}“ mit den Einstellungen von Layer ${layerLabel(i)} überschreiben?\n\n${settingsSummary(L)}`)) return;
    library.update(e.id, entryFromLayer(L, !!e.img || hasImages(i)));
    if (L.material !== e.id) ed.updateLayer(i, { material: e.id });
  };
  const doImport = async () => {
    const f = await openText('Materialbibliothek', ['lwm', 'clb', 'json']);
    if (!f) return;
    try {
      const list = parseLibrary(f[1]);
      const r = library.merge(list);
      alert(`${f[0]}: ${r.added} Einträge hinzugefügt${r.replaced ? `, ${r.replaced} ersetzt` : ''}.`);
    } catch (e) {
      alert(`${f[0]} konnte nicht gelesen werden: ${(e as Error).message}`);
    }
  };
  const doExport = () => saveText('materialien.lwm', 'Laserwerk-Materialbibliothek', 'lwm', 'application/json', library.serialize());

  const render = () => {
    const i = target();
    const L = ed.layer(i);
    const cur = library.get(L.material);
    const sel = library.get(selected ?? undefined) ?? null;
    if (!sel) selected = null;
    const status = h('div', { class: 'mat-status' },
      h('span', { class: 'swatch', style: `background:${PALETTE[i]}` }, layerLabel(i)),
      cur
        ? h('span', {}, entryLabel(cur), differsFrom(L, cur) ? h('span', { class: 'muted', title: 'Die Layer-Einstellungen weichen vom Eintrag ab' }, ' (geändert)') : null)
        : h('span', { class: 'muted' }, 'eigene Einstellungen'),
    );
    const search = h('input', {
      type: 'search', class: 'mat-search', placeholder: 'Suchen …', value: filter,
      oninput: (ev: Event) => ((filter = (ev.target as HTMLInputElement).value), renderList()),
    });
    const list = h('div', { class: 'mat-list' });
    const renderList = () => {
      const q = filter.trim().toLowerCase();
      const entries = library.entries.filter((e) => !q || `${entryLabel(e)} ${e.desc}`.toLowerCase().includes(q));
      list.replaceChildren();
      if (!library.entries.length) {
        list.append(h('div', { class: 'empty' }, 'Noch keine Materialien. Stelle einen Layer ein (zum Beispiel nach einem Materialtest) und speichere ihn mit „Neu aus Layer“. Vorhandene Bibliotheken (.lwm, LightBurn .clb) lassen sich importieren.'));
        return;
      }
      if (!entries.length) {
        list.append(h('div', { class: 'empty' }, 'Nichts gefunden.'));
        return;
      }
      const byMat = new Map<string, MaterialEntry[]>();
      for (const e of entries) byMat.set(e.material, [...(byMat.get(e.material) ?? []), e]);
      for (const m of [...byMat.keys()].sort((a, b) => a.localeCompare(b, 'de'))) {
        list.append(h('div', { class: 'mat-group' }, m));
        const ms = byMat.get(m)!.sort((a, b) => (a.thickness ?? Infinity) - (b.thickness ?? Infinity) || a.title.localeCompare(b.title, 'de'));
        let lastT: number | null | undefined;
        for (const e of ms) {
          if (e.thickness !== lastT) list.append(h('div', { class: 'mat-thick' }, thicknessLabel(e.thickness)));
          lastT = e.thickness;
          const row = h('div', {
            class: `mat-entry${e.id === selected ? ' sel' : ''}${e.id === L.material ? ' cur' : ''}`,
            title: `${e.desc ? e.desc + '\n' : ''}Doppelklick: auf Layer ${layerLabel(i)} übernehmen`,
          },
            h('span', {}, e.title || '(ohne Titel)', e.img ? h('span', { class: 'muted' }, ' + Bild') : null),
            h('span', { class: 'muted' }, settingsSummary(e.settings)),
          );
          row.addEventListener('click', () => ((selected = e.id), render()));
          row.addEventListener('dblclick', () => assign(e));
          list.append(row);
        }
      }
    };
    renderList();
    const btn = (label: string, title: string, f: () => void, enabled = true) =>
      h('button', { class: 'btn', title, disabled: !enabled, onclick: f }, label);
    root.replaceChildren(
      status,
      search,
      list,
      h('div', { class: 'mat-buttons' },
        btn('Übernehmen', `Einstellungen des gewählten Eintrags auf Layer ${layerLabel(i)} übertragen (Doppelklick)`, () => sel && assign(sel), !!sel),
        btn('Aus Layer aktualisieren', `Eintrag mit den Einstellungen von Layer ${layerLabel(i)} überschreiben`, () => sel && updateFromLayer(sel), !!sel),
        btn('Bearbeiten …', 'Material, Dicke, Titel und Beschreibung ändern', () => sel && openEntryDialog(sel, (d) => library.update(sel.id, d)), !!sel),
        btn('Duplizieren', 'Kopie des Eintrags anlegen', () => {
          if (!sel) return;
          const { id: _id, ...rest } = sel;
          selected = library.add({ ...rest, title: `${rest.title} (Kopie)`.trim() }).id;
        }, !!sel),
        btn('Löschen', 'Eintrag aus der Bibliothek entfernen', () => sel && confirm(`„${entryLabel(sel)}“ löschen?`) && library.remove(sel.id), !!sel),
      ),
      h('div', { class: 'mat-buttons' },
        btn('Neu aus Layer …', `Einstellungen von Layer ${layerLabel(i)} als neuen Eintrag speichern`, createFromLayer),
        btn('Importieren …', 'Einträge aus einer .lwm- oder LightBurn-.clb-Datei hinzufügen', doImport),
        btn('Exportieren …', 'Ganze Bibliothek als .lwm-Datei speichern', doExport, library.entries.length > 0),
        btn('Materialtest …', 'Testraster mit gestufter Geschwindigkeit und Leistung lasern', () => openMaterialTestDialog(ed)),
      ),
    );
  };

  library.on(render);
  let pending = false;
  ed.on((w) => {
    if (w === 'view' || pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (!root.contains(document.activeElement) || document.activeElement?.tagName !== 'INPUT') render();
    });
  });
  render();
  return root;
}
