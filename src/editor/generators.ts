// Editor: parametrische Bauteile und Baugruppen aus Generatoren (Zahnrad, Box …) einfügen, ändern und vor
// ungewollter Umwandlung schützen.
import { GenShape, leaves, mul, newAsmId, newId, Obj, translate } from '../model';
import { boundsOf } from '../geom';
import { BuildResult, GenPart, genLabel, getGenerator, normalizeParams } from '../generators';
import { t } from '../i18n';
import type { Editor } from '../editor';
import { RULER } from './shared';

/** Parametrische Bauteile unter den Objekten (auch in Gruppen) */
export const genLeaves = (objs: Obj[]): Obj[] => [...leaves(objs)].map(([l]) => l).filter((l) => l.shape.kind === 'gen');

/** Name der ganzen Baugruppe (ohne Teil) bzw. des Bauteils */
const groupLabel = (s: GenShape) => genLabel({ ...s, part: undefined });

interface Member {
  o: Obj;
  /** Liste, in der das Objekt steht (Seite oder Gruppe) */
  list: Obj[];
}

export class EditorGenerators {
  selGens(this: Editor): Obj[] {
    return this.sel.filter((o) => o.shape.kind === 'gen');
  }
  /** Alle Teile einer Baugruppe auf allen Seiten, auch in Gruppen */
  asmMembers(this: Editor, asm: string): Member[] {
    const out: Member[] = [];
    const walk = (list: Obj[]) => {
      for (const o of list) {
        if (o.shape.kind === 'group') walk(o.shape.children);
        else if (o.shape.kind === 'gen' && o.shape.asm === asm) out.push({ o, list });
      }
    };
    for (const pg of this.doc.pages) walk(pg.objs);
    return out;
  }
  /**
   * Erzeugte Teile mittig in der sichtbaren Fläche auf dem aktuellen Layer einfügen (lokaler Ursprung = Teilmitte).
   * Teile einer Baugruppe werden einzelne Objekte mit gemeinsamer Kennung, damit sie zusammen neu berechnet werden.
   */
  addGen(this: Editor, r: BuildResult, layer = this.currentLayer, center?: { x: number; y: number }): Obj[] {
    if (!r.parts.length) return [];
    let c = center ?? this.toWorld(RULER + (this.w - RULER) / 2, RULER + (this.h - RULER) / 2);
    const bed = this.doc.bed;
    if (!center && (c.x < 0 || c.y < 0 || c.x > bed.w || c.y > bed.h)) c = { x: bed.w / 2, y: bed.h / 2 };
    const asm = r.parts.some((p) => p.shape.part) ? newAsmId() : undefined;
    const objs: Obj[] = r.parts.map((p) => ({
      id: newId(), m: translate(c.x + p.at.x, c.y + p.at.y), layer, shape: asm ? { ...p.shape, asm } : p.shape,
    }));
    // Ragt die Baugruppe über das Bett, kommt sie in die Bettmitte
    const b = boundsOf(objs);
    if (!center && b && (b.x < -1e-6 || b.y < -1e-6 || b.x + b.w > bed.w + 1e-6 || b.y + b.h > bed.h + 1e-6))
      for (const o of objs) o.m = mul(translate(bed.w / 2 - (b.x + b.w / 2), bed.h / 2 - (b.y + b.h / 2)), o.m);
    this.snapshot(t('Objekt hinzufügen'));
    this.layer(layer);
    this.doc.objs.push(...objs);
    if (!this.agentCall) this.setTool('select');
    this.setSel(objs);
    const name = groupLabel(objs[0].shape as GenShape);
    this.hint = asm
      ? t('{name} eingefügt ({n} Teile). Doppelklick auf ein Teil öffnet die Parameter der ganzen Baugruppe.', { name, n: objs.length })
      : t('{name} eingefügt. Doppelklick öffnet die Parameter wieder.', { name });
    this.emit('doc');
    return objs;
  }
  /**
   * Parameter ändern: Die Geometrie wird ersetzt, Lage und Drehung bleiben. Bei Baugruppen werden alle Teile
   * (auf allen Seiten) neu berechnet; Teile, die die neuen Parameter nicht mehr ergeben, fallen weg, neu
   * hinzukommende (z. B. ein Deckel) kommen an ihren Platz in der Anordnung. Teile, die der Nutzer gelöscht
   * hat, bleiben gelöscht.
   */
  updateGen(this: Editor, o: Obj, r: BuildResult) {
    if (o.shape.kind !== 'gen' || !r.parts.length) return;
    const old = o.shape;
    this.snapshot(t('{name} ändern', { name: groupLabel(old) }));
    const g = getGenerator(old.gen);
    if (!old.asm || !g) {
      o.shape = { ...r.parts[0].shape };
      this.touch(o.shape);
    } else {
      const asm = old.asm;
      const members = this.asmMembers(asm);
      const byKey = new Map(r.parts.map((p) => [p.shape.part, p]));
      let oldParts: GenPart[] = [];
      try {
        oldParts = g.generate(normalizeParams(g, old.params)).parts;
      } catch {
        /* alte Parameter nicht mehr erzeugbar: Teile bleiben, wo sie sind */
      }
      const oldAt = new Map(oldParts.map((p) => [p.key, p.at]));
      const oldKeys = new Set(oldParts.map((p) => p.key));
      // Ursprung der Anordnung (at = 0) in Weltkoordinaten, abgeleitet vom bearbeiteten Teil
      const worldOf = (x: Obj) => [...leaves(this.doc.objs)].find(([l]) => l === x)?.[1] ?? null;
      const at0 = oldAt.get(old.part!) ?? { x: 0, y: 0 };
      const origin = mul(worldOf(o) ?? o.m, translate(-at0.x, -at0.y));
      // Liegen noch alle Teile so, wie der Generator sie angeordnet hat? Dann wird die Anordnung mit den neuen
      // Maßen neu gelegt, damit größer gewordene Teile sich nicht überdecken. Sonst bleibt jedes Teil, wo es ist.
      const placed = (x: Obj, at: { x: number; y: number }) => {
        const want = mul(origin, translate(at.x, at.y));
        return x.m.every((v, i) => Math.abs(v - want[i]) < 1e-6);
      };
      const relayout = members.every((m) => m.list === this.doc.objs && placed(m.o, oldAt.get((m.o.shape as GenShape).part!) ?? { x: NaN, y: NaN }));
      const present = new Set<string | undefined>();
      for (const m of members) {
        const key = (m.o.shape as GenShape).part;
        present.add(key);
        const np = byKey.get(key);
        if (np) {
          m.o.shape = { ...np.shape, asm };
          this.touch(m.o.shape);
          if (relayout) m.o.m = mul(origin, translate(np.at.x, np.at.y));
        } else m.list.splice(m.list.indexOf(m.o), 1);
      }
      // Neu hinzukommende Teile (z. B. Deckel) an ihren Platz in der Anordnung; vom Nutzer gelöschte nicht wiederholen
      const added: Obj[] = [];
      for (const p of r.parts) {
        if (present.has(p.shape.part) || oldKeys.has(p.shape.part!)) continue;
        added.push({ id: newId(), m: mul(origin, translate(p.at.x, p.at.y)), layer: o.layer, shape: { ...p.shape, asm } });
      }
      this.doc.objs.push(...added);
      const alive = new Set(this.doc.objs);
      this.setSel([...this.sel.filter((x) => alive.has(x)), ...added]);
    }
    const n = r.parts.length;
    this.hint = n > 1
      ? t('{name}: {n} Teile neu berechnet.', { name: groupLabel(r.parts[0].shape), n })
      : t('{name}: Kontur neu berechnet.', { name: genLabel(r.parts[0].shape) });
    this.emit('doc');
    this.emit('sel');
  }
  /** Fehlermeldung für KI-Agenten, die ein parametrisches Bauteil skalieren oder umbauen wollen */
  genChangeError(this: Editor, objs: Obj[]): string {
    const g = genLeaves(objs)[0];
    return t('{name} (id {id}) ist ein parametrisches Bauteil: Parameter mit edit_generator ändern oder erst mit convert_to_path in Pfade umwandeln.', {
      name: g ? genLabel(g.shape as GenShape) : '', id: g?.id ?? '',
    });
  }
  /**
   * Vor Änderungen, die ein parametrisches Bauteil in gewöhnliche Pfade verwandeln (Skalieren, Knoten bearbeiten,
   * Boolesche Operationen …): fragen und bei Zustimmung umwandeln. false = Aktion abbrechen.
   * Ohne Oberfläche (Tests) wird umgewandelt; KI-Agenten bekommen einen Fehler und nutzen edit_generator bzw. convert_to_path.
   */
  async guardGen(this: Editor, objs: Obj[], action: string): Promise<boolean> {
    const gens = genLeaves(objs);
    if (!gens.length) return true;
    if (this.agentCall) throw new Error(this.genChangeError(gens));
    const answer = this.onGenGuard ? await this.onGenGuard(gens, action) : 'convert';
    if (answer === 'edit') {
      this.onGenEdit?.(gens[0]);
      return false;
    }
    if (answer !== 'convert') return false;
    this.snapshot(t('In Pfad umwandeln'));
    for (const g of gens) {
      this.convertObjToPath(g);
      this.touch(g.shape);
    }
    this.emit('doc');
    this.emit('sel');
    return true;
  }
}
