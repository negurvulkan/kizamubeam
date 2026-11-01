// Auswahl des Material-Aussehens (Layer-Dialog und 3D-Ansicht): Vorlagen nach Gruppen und eine eigene Farbe.
import { h } from '../dom';
import { t } from '../i18n';
import { lookName, LookPreset, lookPreset, LOOKS, LOOK_GROUPS, MaterialLook } from './looks';

/**
 * Liste der Vorlagen; auto: Beschriftung des Eintrags „ohne eigenes Aussehen“ (Wert '').
 * onChange liefert die ID der Vorlage bzw. '' für automatisch.
 */
export function lookSelect(value: string, onChange: (id: string) => void, auto?: string): HTMLSelectElement {
  const opt = (p: LookPreset) => h('option', { value: p.id, selected: p.id === value }, lookName(p));
  return h(
    'select',
    { onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) },
    ...(auto !== undefined ? [h('option', { value: '', selected: !value }, auto)] : []),
    ...LOOK_GROUPS.map((g) => h('optgroup', { label: t(g.name) }, ...LOOKS.filter((p) => p.group === g.id).map(opt))),
  ) as HTMLSelectElement;
}

/**
 * Vorlage plus Farbfeld; get/set arbeiten auf dem gespeicherten Aussehen (undefined = automatisch, nur mit auto).
 * Das Farbfeld zeigt die Farbe der Vorlage; eine geänderte Farbe wird gespeichert, „×“ nimmt sie zurück.
 */
export function lookEditor(get: () => MaterialLook | undefined, set: (v: MaterialLook | undefined) => void, auto?: string): HTMLElement {
  const box = h('span', { class: 'look-edit' });
  const render = () => {
    const cur = get();
    const p = lookPreset(cur?.id);
    const color = h('input', {
      type: 'color',
      value: cur?.color ?? p?.color ?? '#cccccc',
      title: t('Eigene Farbe des Materials'),
      disabled: !p,
      oninput: (e: Event) => {
        const v = (e.target as HTMLInputElement).value.toLowerCase();
        if (cur) set({ id: cur.id, ...(v !== p?.color ? { color: v } : {}) });
      },
      onchange: render,
    });
    const reset = h('button', {
      class: 'small',
      type: 'button',
      title: t('Farbe der Vorlage verwenden'),
      hidden: !cur?.color,
      onclick: () => {
        if (cur) set({ id: cur.id });
        render();
      },
    }, '×');
    box.replaceChildren(
      lookSelect(cur?.id ?? '', (id) => {
        set(id ? { id } : undefined);
        render();
      }, auto),
      color,
      reset,
    );
  };
  render();
  return box;
}
