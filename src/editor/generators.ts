// Editor: parametrische Bauteile aus Generatoren (Zahnrad …) einfügen, ändern und vor ungewollter Umwandlung schützen.
import { GenShape, leaves, newId, Obj, translate } from '../model';
import { genLabel } from '../generators';
import { t } from '../i18n';
import type { Editor } from '../editor';
import { RULER } from './shared';

/** Parametrische Bauteile unter den Objekten (auch in Gruppen) */
export const genLeaves = (objs: Obj[]): Obj[] => [...leaves(objs)].map(([l]) => l).filter((l) => l.shape.kind === 'gen');

export class EditorGenerators {
  selGens(this: Editor): Obj[] {
    return this.sel.filter((o) => o.shape.kind === 'gen');
  }
  /** Neues Bauteil mittig in der sichtbaren Fläche auf dem aktuellen Layer einfügen (lokaler Ursprung = Mitte) */
  addGen(this: Editor, shape: GenShape, layer = this.currentLayer): Obj {
    let c = this.toWorld(RULER + (this.w - RULER) / 2, RULER + (this.h - RULER) / 2);
    const bed = this.doc.bed;
    if (c.x < 0 || c.y < 0 || c.x > bed.w || c.y > bed.h) c = { x: bed.w / 2, y: bed.h / 2 };
    const o: Obj = { id: newId(), m: translate(c.x, c.y), layer, shape };
    this.placeNew([o], t('{name} eingefügt. Doppelklick öffnet die Parameter wieder.', { name: genLabel(shape) }));
    return o;
  }
  /** Parameter eines Bauteils ändern: Geometrie wird ersetzt, Lage und Drehung bleiben */
  updateGen(this: Editor, o: Obj, shape: GenShape) {
    if (o.shape.kind !== 'gen') return;
    this.snapshot(t('{name} ändern', { name: genLabel(o.shape) }));
    o.shape = shape;
    this.touch(o.shape);
    this.hint = t('{name}: Kontur neu berechnet.', { name: genLabel(shape) });
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
