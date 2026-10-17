// Editor: Projekt-Parameter anlegen, ändern, umbenennen und löschen. Nach jeder Änderung werden Texte und
// QR-Codes mit Platzhaltern und Bauteile mit Formeln (GenShape.bind) auf allen Seiten neu berechnet.
import { allObjs, GenShape, leaves, Obj } from '../model';
import { buildGen, getGenerator, resolveBinds } from '../generators';
import type { Issue } from '../generators';
import {
  coerce, defaultValue, hasPlaceholders, nameError, ParamType, ProjectParam, renameInExpr, renameInTemplate, scopeOf, usesName,
} from '../params';
import { t } from '../i18n';
import type { Editor } from '../editor';

export class EditorParams {
  /** Parameter des Projekts (leer, wenn es keine gibt) */
  paramList(this: Editor): ProjectParam[] {
    return this.doc.params ?? [];
  }
  findParam(this: Editor, name: string): ProjectParam | undefined {
    const k = name.toLowerCase();
    return this.paramList().find((p) => p.name.toLowerCase() === k);
  }
  /** Neuer Parameter; ohne Namen „Zahl1“, „Text1“ … */
  addParam(this: Editor, type: ParamType, init: Partial<ProjectParam> = {}): ProjectParam {
    const base = init.name || { number: t('Zahl'), text: t('Text'), bool: t('Schalter') }[type];
    let name = base;
    if (!init.name) for (let i = 1; this.findParam(name) || nameError(name, this.paramList()); i++) name = `${base}${i}`;
    const err = nameError(name, this.paramList());
    if (err) throw new Error(err);
    const p: ProjectParam = { ...init, name, type, value: defaultValue(type) };
    p.value = coerce(p, init.value ?? p.value);
    this.snapshot(t('Parameter „{name}“ anlegen', { name }));
    (this.doc.params ??= []).push(p);
    this.emit('doc');
    return p;
  }
  /**
   * Eigenschaften ändern (Name, Bereich, Einheit …). Ein neuer Name wird in allen Platzhaltern und Formeln
   * des Projekts mit umbenannt.
   */
  editParam(this: Editor, p: ProjectParam, patch: Partial<ProjectParam>, undo = true) {
    if (patch.name !== undefined && patch.name !== p.name) {
      const err = nameError(patch.name, this.paramList(), p);
      if (err) throw new Error(err);
    }
    if (undo) this.snapshot(t('Parameter „{name}“ ändern', { name: p.name }));
    const from = p.name;
    Object.assign(p, patch);
    for (const k of ['min', 'max', 'step', 'unit', 'note'] as const) if (p[k] === undefined || p[k] === '') delete p[k];
    if (p.type !== 'number') for (const k of ['min', 'max', 'step', 'unit'] as const) delete p[k];
    p.value = coerce(p, patch.value ?? p.value);
    if (p.name !== from) this.renameParamRefs(from, p.name);
    this.applyParams();
  }
  /** Wert setzen. undo = false: ohne eigenen Schritt (z. B. während der Schieberegler gezogen wird) */
  setParamValue(this: Editor, p: ProjectParam, v: unknown, undo = true) {
    const nv = coerce(p, v);
    if (nv === p.value) return;
    if (undo) this.snapshot(t('Parameter „{name}“ ändern', { name: p.name }));
    p.value = nv;
    this.applyParams();
  }
  /** Mehrere Werte auf einmal (ein Schritt), z. B. von einem KI-Agenten */
  setParamValues(this: Editor, values: Record<string, unknown>) {
    const list = Object.entries(values).map(([k, v]) => {
      const p = this.findParam(k);
      if (!p) throw new Error(t('Unbekannter Parameter „{name}“', { name: k }));
      return [p, coerce(p, v)] as const;
    });
    if (list.every(([p, v]) => p.value === v)) return;
    this.snapshot(t('Parameter ändern'));
    for (const [p, v] of list) p.value = v;
    this.applyParams();
  }
  /** Löschen: Platzhalter bleiben als Text stehen, Formeln an Bauteilen werden zu ihrem letzten Wert */
  removeParam(this: Editor, p: ProjectParam) {
    this.snapshot(t('Parameter „{name}“ löschen', { name: p.name }));
    this.doc.params = this.paramList().filter((x) => x !== p);
    if (!this.doc.params.length) delete this.doc.params;
    for (const [o] of leaves(allObjs(this.doc))) {
      const s = o.shape;
      if (s.kind !== 'gen' || !s.bind) continue;
      for (const [k, src] of Object.entries(s.bind)) if (usesName(src, p.name, false)) delete s.bind[k];
      if (!Object.keys(s.bind).length) delete s.bind;
    }
    this.applyParams();
  }
  moveParam(this: Editor, p: ProjectParam, to: number) {
    const list = this.paramList();
    const from = list.indexOf(p);
    if (from < 0 || to === from || to < 0 || to >= list.length) return;
    this.snapshot(t('Parameter „{name}“ verschieben', { name: p.name }));
    list.splice(from, 1);
    list.splice(to, 0, p);
    this.emit('doc');
  }
  renameParamRefs(this: Editor, from: string, to: string) {
    for (const [o] of leaves(allObjs(this.doc))) {
      const s = o.shape;
      if (s.kind === 'text') s.text = renameInTemplate(s.text, from, to);
      else if (s.kind === 'barcode') s.data = renameInTemplate(s.data, from, to);
      else if (s.kind === 'gen' && s.bind) for (const k of Object.keys(s.bind)) s.bind[k] = renameInExpr(s.bind[k], from, to);
    }
  }
  /** Wo wird der Parameter benutzt? (Objekte auf allen Seiten) */
  paramUsers(this: Editor, p: ProjectParam): Obj[] {
    const out: Obj[] = [];
    for (const [o] of leaves(allObjs(this.doc))) {
      const s = o.shape;
      const used =
        s.kind === 'text' ? usesName(s.text, p.name, true)
        : s.kind === 'barcode' ? usesName(s.data, p.name, true)
        : s.kind === 'gen' && s.bind ? Object.values(s.bind).some((src) => usesName(src, p.name, false))
        : false;
      if (used) out.push(o);
    }
    return out;
  }
  /**
   * Alles neu berechnen, was von Parametern abhängt: Texte und QR-Codes mit Platzhaltern zeichnen neu,
   * Bauteile mit Formeln bekommen neue Geometrie (Baugruppen einmal je Baugruppe). Gibt die Probleme zurück.
   */
  applyParams(this: Editor): { obj: Obj; issues: Issue[] }[] {
    const scope = scopeOf(this.paramList());
    const problems: { obj: Obj; issues: Issue[] }[] = [];
    const doneAsm = new Set<string>();
    // Erst sammeln: Neu berechnete Baugruppen können Teile entfernen oder hinzufügen
    for (const [o] of [...leaves(allObjs(this.doc))]) {
      const s = o.shape;
      if ((s.kind === 'text' && hasPlaceholders(s.text)) || (s.kind === 'barcode' && hasPlaceholders(s.data))) this.touch(s);
      if (s.kind !== 'gen' || !s.bind) continue;
      if (s.asm) {
        if (doneAsm.has(s.asm)) continue;
        doneAsm.add(s.asm);
      }
      const g = getGenerator(s.gen);
      if (!g) continue;
      const { params, issues } = resolveBinds(g, s.params, s.bind, scope);
      const changed = g.schema.some((x) => params[x.key] !== s.params[x.key]);
      if (changed) {
        const r = buildGen(g, params);
        for (const pt of r.parts) pt.shape.bind = { ...s.bind };
        if (r.parts.length) this.updateGen(o, r, true);
        issues.push(...r.issues.filter((i) => i.level === 'error'));
      }
      if (issues.length) problems.push({ obj: o, issues });
    }
    this.paramProblems = problems;
    this.emit('doc');
    this.emit('sel');
    return problems;
  }
  /** Formeln eines Bauteils setzen (leere Formel = Feld wieder fest) und neu berechnen */
  setGenBinds(this: Editor, o: Obj, bind: Record<string, string>) {
    if (o.shape.kind !== 'gen') return;
    const s = o.shape as GenShape;
    const next = { ...s.bind };
    for (const [k, v] of Object.entries(bind)) {
      if (v.trim()) next[k] = v.trim();
      else delete next[k];
    }
    const members = s.asm ? this.asmMembers(s.asm).map((m) => m.o) : [o];
    for (const m of members) {
      const ms = m.shape as GenShape;
      if (Object.keys(next).length) ms.bind = { ...next };
      else delete ms.bind;
    }
  }
}
