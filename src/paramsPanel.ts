// Fenster „Parameter“: Zahlen, Texte und Ja/Nein-Werte des Projekts anlegen und ändern. Texte und QR-Codes
// setzen sie mit {Name} ein, Felder parametrischer Bauteile über Formeln. Jede Änderung rechnet sofort neu.
import type { Editor } from './editor';
import { h } from './dom';
import { t, tn } from './i18n';
import { dockWindow, isShown, onWindowShow, setBadge } from './dock';
import { check, select } from './arrayDialogs';
import { evalNumber, formatNumber, nameError, ParamType, PARAM_HELP, ProjectParam } from './params';
import { objLabel } from './objectsPanel';

const TYPES = (): [ParamType, string][] => [
  ['number', t('Zahl')],
  ['text', t('Text')],
  ['bool', t('Ja/Nein')],
];
const UNITS = (): [string, string][] => [
  ['', t('ohne')],
  ['mm', 'mm'],
  ['°', '°'],
  ['%', '%'],
];

export function buildParamsPanel(ed: Editor) {
  const body = dockWindow('params', t('Parameter'), { near: 'history' });
  const add = (type: ParamType) => {
    const p = ed.addParam(type);
    openParamDialog(ed, p, true);
  };
  const bar = h('div', { class: 'hist-bar' },
    h('button', { class: 'small', onclick: () => add('number'), title: t('Neuer Zahl-Parameter') }, t('+ Zahl')),
    h('button', { class: 'small', onclick: () => add('text'), title: t('Neuer Text-Parameter') }, t('+ Text')),
    h('button', { class: 'small', onclick: () => add('bool'), title: t('Neuer Ja/Nein-Parameter') }, t('+ Ja/Nein')),
  );
  const list = h('div', { class: 'param-list' });
  const problems = h('div', { class: 'param-problems' });
  body.append(bar, list, problems);

  let lastKey = '';
  /** Steuerelemente der Werte, damit nur die Werte aktualisiert werden, solange sich der Aufbau nicht ändert */
  const setters = new Map<ProjectParam, () => void>();

  const valueControl = (p: ProjectParam): HTMLElement => {
    // Ein Undo-Schritt je Bearbeitung: beim ersten Ändern nach dem Fokussieren
    let snapped = false;
    const begin = () => (snapped = false);
    const set = (v: unknown) => {
      ed.setParamValue(p, v, !snapped);
      snapped = true;
    };
    if (p.type === 'bool') {
      const el = check(!!p.value, (v) => ed.setParamValue(p, v), p.value ? t('ja') : t('nein'));
      const cb = el.querySelector('input')!;
      setters.set(p, () => {
        cb.checked = !!p.value;
        el.lastChild!.textContent = p.value ? t('ja') : t('nein');
      });
      return el;
    }
    if (p.type === 'text') {
      const el = h('input', { type: 'text', value: String(p.value), class: 'param-value' }) as HTMLInputElement;
      el.addEventListener('focus', begin);
      el.addEventListener('input', () => set(el.value));
      el.addEventListener('keydown', (e) => e.key === 'Enter' && el.blur());
      setters.set(p, () => document.activeElement !== el && (el.value = String(p.value)));
      return el;
    }
    const n = Number(p.value);
    const el = h('input', { type: 'text', value: formatNumber(n), class: 'param-value num' }) as HTMLInputElement;
    const wrap = h('div', { class: 'param-num' }, el);
    el.addEventListener('focus', () => (begin(), el.select()));
    el.addEventListener('input', () => {
      const v = evalNumber(el.value);
      el.classList.toggle('invalid', v === null);
      if (v !== null) set(v);
    });
    el.addEventListener('blur', () => (el.value = formatNumber(Number(p.value)), el.classList.remove('invalid')));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') el.blur();
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const step = (p.step || 1) * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
      set(Number(p.value) + (e.key === 'ArrowUp' ? step : -step));
      el.value = formatNumber(Number(p.value));
    });
    let slider: HTMLInputElement | null = null;
    if (p.min !== undefined && p.max !== undefined && p.max > p.min) {
      slider = h('input', { type: 'range', min: p.min, max: p.max, step: p.step || 'any', value: n, class: 'param-slider' }) as HTMLInputElement;
      slider.addEventListener('pointerdown', begin);
      slider.addEventListener('keydown', begin);
      slider.addEventListener('input', () => set(Number(slider!.value)));
      wrap.prepend(slider);
    }
    if (p.unit) wrap.append(h('span', { class: 'muted' }, p.unit));
    setters.set(p, () => {
      if (document.activeElement !== el) el.value = formatNumber(Number(p.value));
      if (slider && document.activeElement !== slider) slider.value = String(p.value);
    });
    return wrap;
  };

  const render = () => {
    const params = ed.paramList();
    setBadge('params', params.length ? String(params.length) : '');
    if (!isShown('params')) return;
    // Neu aufbauen nur, wenn sich Namen, Arten oder Bereiche geändert haben; sonst nur Werte setzen
    const key = JSON.stringify(params.map((p) => [p.name, p.type, p.min, p.max, p.step, p.unit, p.note]));
    if (key !== lastKey || params.some((p) => !setters.has(p))) {
      lastKey = key;
      setters.clear();
      list.replaceChildren(
        ...params.map((p, i) => {
          const users = ed.paramUsers(p).length;
          return h('div', { class: 'param-row', title: p.note ?? '' },
            h('button', {
              class: 'param-name',
              title: t('Parameter bearbeiten (Name, Art, Bereich)'),
              onclick: () => openParamDialog(ed, p),
            }, p.name),
            valueControl(p),
            h('span', { class: 'param-uses muted', title: t('So oft im Projekt benutzt') }, users ? `×${users}` : ''),
            h('span', { class: 'param-move' },
              h('button', { class: 'small', title: t('Nach oben'), disabled: i === 0, onclick: () => ed.moveParam(p, i - 1) }, '↑'),
              h('button', { class: 'small', title: t('Nach unten'), disabled: i === params.length - 1, onclick: () => ed.moveParam(p, i + 1) }, '↓'),
            ),
          );
        }),
      );
      if (!params.length)
        list.append(h('div', { class: 'empty' },
          h('p', {}, t('Parameter sind Werte, die du überall im Projekt benutzen kannst. Ändert sich ein Wert, passt sich alles an. So wird ein Projekt zur Vorlage.')),
          h('p', {}, PARAM_HELP()),
          h('p', {}, t('In Generator-Feldern (z. B. der Materialdicke einer Box) statt einer Zahl den Namen oder eine Formel eintragen.')),
        ));
    } else setters.forEach((f) => f());
    // Formeln, die sich nicht auswerten lassen
    const probs = ed.paramProblems.filter((x) => x.issues.some((i) => i.level === 'error'));
    problems.replaceChildren(
      ...probs.slice(0, 6).map(({ obj, issues }) =>
        h('div', { class: 'error' },
          h('b', {}, objLabel(obj)), ': ',
          issues.filter((i) => i.level === 'error').map((i) => i.msg).join('; '))),
    );
  };
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => ((queued = false), render()));
  };
  ed.on((what) => what === 'doc' && schedule());
  onWindowShow('params', () => {
    lastKey = '';
    render();
  });
  schedule();
}

/** Dialog für Name, Art, Bereich und Einheit eines Parameters. isNew: Abbrechen entfernt ihn wieder. */
export function openParamDialog(ed: Editor, p: ProjectParam, isNew = false) {
  const draft = { name: p.name, type: p.type, min: p.min, max: p.max, step: p.step, unit: p.unit ?? '', note: p.note ?? '' };
  const err = h('div', { class: 'error' });
  const numRows: HTMLElement[] = [];
  const name = h('input', { type: 'text', id: 'param-name', value: p.name }) as HTMLInputElement;
  const optNum = (id: string, v: number | undefined, setv: (n: number | undefined) => void) => {
    const el = h('input', { type: 'text', id, value: v === undefined ? '' : formatNumber(v), placeholder: t('frei') }) as HTMLInputElement;
    el.addEventListener('input', () => {
      const n = el.value.trim() ? evalNumber(el.value, new Map()) : undefined;
      el.classList.toggle('invalid', n === null);
      if (n !== null) setv(n);
      check_();
    });
    return el;
  };
  const row = (label: string, id: string, el: HTMLElement, num = false) => {
    const els = [h('label', { for: id }, label), el];
    if (num) numRows.push(...els);
    return els;
  };
  const users = ed.paramUsers(p);
  const typeSel = select('param-type', draft.type, TYPES(), (v) => ((draft.type = v), check_()));
  const unitSel = select('param-unit', draft.unit, UNITS(), (v) => (draft.unit = v));
  const note = h('input', { type: 'text', id: 'param-note', value: draft.note }) as HTMLInputElement;
  note.addEventListener('input', () => (draft.note = note.value));
  name.addEventListener('input', () => ((draft.name = name.value.trim()), check_()));

  const ok = h('button', { class: 'btn primary' }, isNew ? t('Anlegen') : t('Übernehmen')) as HTMLButtonElement;
  const check_ = () => {
    numRows.forEach((el) => (el.hidden = draft.type !== 'number'));
    let msg = nameError(draft.name, ed.paramList(), p);
    if (!msg && draft.type === 'number' && draft.min !== undefined && draft.max !== undefined && draft.min >= draft.max) msg = t('Min muss kleiner als Max sein.');
    err.textContent = msg ?? '';
    ok.disabled = !!msg;
  };
  let done = false;
  ok.onclick = () => {
    try {
      // Neu angelegt: Anlegen und Einstellen sind ein Undo-Schritt
      ed.editParam(p, {
        name: draft.name, type: draft.type, min: draft.min, max: draft.max, step: draft.step, unit: draft.unit, note: draft.note.trim(),
        value: draft.type === p.type ? p.value : draft.type === 'number' ? 10 : draft.type === 'bool' ? true : String(p.value),
      }, !isNew);
      if (isNew) ed.history.relabel(t('Parameter „{name}“ anlegen', { name: p.name }));
      done = true;
      dlg.close();
    } catch (e) {
      err.textContent = e instanceof Error ? e.message : String(e);
    }
  };
  const del = h('button', {
    class: 'btn',
    onclick: () => {
      if (!isNew && users.length && !confirm(tn(
        '„{name}“ wird in {n} Objekt benutzt. Platzhalter bleiben dann als Text stehen, Bauteile behalten ihren letzten Wert. Trotzdem löschen?',
        '„{name}“ wird in {n} Objekten benutzt. Platzhalter bleiben dann als Text stehen, Bauteile behalten ihren letzten Wert. Trotzdem löschen?',
        users.length, { name: p.name }))) return;
      ed.removeParam(p);
      done = true;
      dlg.close();
    },
  }, t('Löschen'));
  const dlg = h('dialog', { class: 'offset-dialog param-dialog' },
    h('h3', {}, isNew ? t('Neuer Parameter') : t('Parameter bearbeiten')),
    h('div', { class: 'form' },
      ...row(t('Name'), 'param-name', name),
      ...row(t('Art'), 'param-type', typeSel),
      ...row(t('Einheit'), 'param-unit', unitSel, true),
      ...row(t('Min'), 'param-min', optNum('param-min', draft.min, (n) => (draft.min = n)), true),
      ...row(t('Max'), 'param-max', optNum('param-max', draft.max, (n) => (draft.max = n)), true),
      ...row(t('Schrittweite'), 'param-step', optNum('param-step', draft.step, (n) => (draft.step = n)), true),
      ...row(t('Erklärung'), 'param-note', note),
    ),
    h('div', { class: 'note' }, t('Mit Min und Max zeigt das Fenster einen Schieberegler. Der Name wird in Texten und Formeln mit umbenannt.')),
    users.length && !isNew
      ? h('div', { class: 'note' }, t('Benutzt in: {list}', { list: users.slice(0, 5).map(objLabel).join(', ') + (users.length > 5 ? ' …' : '') }))
      : null,
    err,
    h('div', { class: 'dialog-buttons' },
      del,
      h('span', { class: 'param-spacer' }),
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      ok,
    ),
  );
  dlg.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && !ok.disabled) {
      e.preventDefault();
      ok.click();
    }
  });
  dlg.addEventListener('close', () => {
    dlg.remove();
    // Abbrechen beim Anlegen: den neuen Parameter wieder entfernen, ohne Spur im Verlauf
    if (isNew && !done) {
      ed.doc.params = ed.paramList().filter((x) => x !== p);
      if (!ed.doc.params.length) delete ed.doc.params;
      ed.dropSnapshot();
      ed.emit('doc');
    }
  });
  document.body.append(dlg);
  dlg.showModal();
  name.select();
  check_();
}
