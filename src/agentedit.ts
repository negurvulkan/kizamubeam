// Werkzeuge der Stufe „Entwerfen“ für KI-Agenten: Formen und Text anlegen, ändern, anordnen, Boolesche
// Operationen, Offset, Arrays, Biegeschnitte, Verbindungen, Layer, Import und Dateien. Jeder Aufruf ist ein
// Undo-Schritt (siehe Editor.batch in agent.ts). Koordinaten: Maschine, Ursprung unten links, y nach oben, mm.
import type { Editor } from './editor';
import { boundsOf, Box, segments, shapeSubs } from './geom';
import { about, apply, BarcodeShape, IDENT, Mat, mul, newId, Obj, QrLevel, rotate, scale, Shape, SubPath, TextShape, translate } from './model';
import { qrMatrix } from './barcode';
import { advanceVarText } from './vartext';
import { BoolOp, OffsetOptions } from './ops';
import { circularMatrices, DEFAULT_GRID, gridMatrices, GridOptions } from './arrays';
import { DEFAULT_HINGE, HingeKind, HingeOptions, suggestHinge } from './hinges';
import { DEFAULT_JOINT, EdgePick, isStraight, JointKind, JointOptions } from './joints';
import { importSvg, parsePathData, transformSubs } from './importers';
import { buildSvg, importBytesOrThrow } from './files';
import { t } from './i18n';
import { library, layerPatch } from './materials';
import { isTauri } from './machine';
import { Args, describe, findObj, flip, machineBox, pageList, r3, Tier, ToolDef, ToolError } from './agentutil';

// ---------- Eingaben prüfen ----------

function num(a: Args, key: string, opt: { def?: number; min?: number; max?: number; int?: boolean } = {}): number {
  const v = a[key];
  if (v === undefined || v === null) {
    if (opt.def !== undefined) return opt.def;
    throw new ToolError(`„${key}“ fehlt`);
  }
  const n = Number(v);
  if (!isFinite(n)) throw new ToolError(`„${key}“ ist keine Zahl`);
  if (opt.min !== undefined && n < opt.min) throw new ToolError(`„${key}“ muss mindestens ${opt.min} sein`);
  if (opt.max !== undefined && n > opt.max) throw new ToolError(`„${key}“ darf höchstens ${opt.max} sein`);
  return opt.int ? Math.round(n) : n;
}
const optNum = (a: Args, key: string, opt: { min?: number; max?: number; int?: boolean } = {}) =>
  a[key] === undefined || a[key] === null ? undefined : num(a, key, opt);
const bool = (a: Args, key: string, def: boolean) => (a[key] === undefined ? def : a[key] === true);
function oneOf<T extends string>(a: Args, key: string, values: readonly T[], def?: T): T {
  const v = a[key] ?? def;
  if (v === undefined) throw new ToolError(`„${key}“ fehlt`);
  if (!values.includes(v as T)) throw new ToolError(`„${key}“ muss einer von ${values.join(', ')} sein`);
  return v as T;
}
function ids(a: Args, key = 'ids'): number[] {
  const v = a[key];
  if (!Array.isArray(v) || !v.length) throw new ToolError(`„${key}“ braucht mindestens eine Objekt-id`);
  return v.map((x) => Number(x));
}
/** Seitennummer (ab 1) → Index */
function pageIndex(ed: Editor, a: Args, key: string): number {
  const n = num(a, key, { min: 1, int: true });
  if (n > ed.doc.pages.length) throw new ToolError(`Keine Seite ${n} (das Projekt hat ${ed.doc.pages.length})`);
  return n - 1;
}
const layerOf = (ed: Editor, a: Args) => num(a, 'layer', { def: ed.currentLayer, min: 0, max: 31, int: true });

/** Objekte der obersten Ebene zu ids (Objekte in Gruppen erst mit ungroup herauslösen) */
function topObjs(ed: Editor, list: number[]): Obj[] {
  return list.map((id) => {
    const o = ed.doc.objs.find((x) => x.id === id);
    if (o) return o;
    if (findObj(ed.doc.objs, id)) throw new ToolError(`Objekt ${id} liegt in einer Gruppe; erst die Gruppe auflösen (ungroup) oder die Gruppe verwenden`);
    throw new ToolError(`Kein Objekt mit id ${id}`);
  });
}

// ---------- Koordinaten ----------

/** Maschine → Welt (y nach unten) */
const W = (ed: Editor, x: number, y: number) => ({ x, y: ed.doc.bed.h - y });

/** Ergebnis eines ändernden Aufrufs: neue und entfernte Objekte, Hinweis des Editors */
function result(ed: Editor, before: Set<number>, extra: Record<string, unknown> = {}) {
  const now = new Set(ed.doc.objs.map((o) => o.id));
  const created = ed.doc.objs.filter((o) => !before.has(o.id)).map((o) => describe(ed, o, IDENT, false));
  const removed = [...before].filter((id) => !now.has(id));
  return {
    ...(created.length ? { created } : {}),
    ...(removed.length ? { removed } : {}),
    ...extra,
    ...(ed.hint ? { message: ed.hint } : {}),
  };
}
const snapshotIds = (ed: Editor) => new Set(ed.doc.objs.map((o) => o.id));

/** Neues Objekt anlegen, optional gedreht (Grad gegen den Uhrzeigersinn um die Mitte) */
function addObj(ed: Editor, shape: Shape, m: Mat, layer: number, rotation = 0): Obj {
  const o: Obj = { id: newId(), m, layer, shape };
  if (rotation) {
    const b = boundsOf([o])!;
    o.m = mul(about(rotate((-rotation * Math.PI) / 180), b.x + b.w / 2, b.y + b.h / 2), o.m);
  }
  ed.layer(layer);
  ed.doc.objs.push(o);
  ed.setSel([o]);
  ed.emit('doc');
  return o;
}

/** variable / variableOffset aus edit_object übernehmen */
function setVar(s: TextShape | BarcodeShape, a: Args) {
  if (a.variable === false) delete s.vt;
  else if (a.variable === true) s.vt ??= { offset: 0 };
  const off = optNum(a, 'variableOffset', { int: true });
  if (off !== undefined) {
    if (!s.vt) throw new ToolError('variableOffset braucht variable=true');
    s.vt.offset = off;
  }
}

const describeAll = (ed: Editor, objs: Obj[]) => objs.map((o) => describe(ed, o, IDENT, false));

// ---------- Schemas ----------

const IDS = { type: 'array', items: { type: 'integer' }, minItems: 1, description: 'Objekt-ids (oberste Ebene, aus get_document)' };
const LAYER = { type: 'integer', minimum: 0, maximum: 31, description: 'Layer 0–29 (Standard: aktueller Layer der Oberfläche)' };
const ROT = { type: 'number', description: 'Drehung in Grad gegen den Uhrzeigersinn um die Mitte' };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });

const LAYER_KEYS: Record<string, string> = {
  name: 'string', output: 'boolean', visible: 'boolean', mode: 'line|fill', speed: 'number', power: 'number', minPower: 'number',
  passes: 'integer', airAssist: 'boolean', kerf: 'number', interval: 'number', angle: 'number', crossHatch: 'boolean',
  bidirectional: 'boolean', overscan: 'number', locked: 'boolean',
};

const HINGE_KEYS = ['thickness', 'cutLength', 'bridge', 'spacing', 'margin', 'angle', 'waveAmp', 'waveLength', 'diamondAngle'] as const;
const JOINT_NUM_KEYS = [
  'thickness', 'fingerWidth', 'tenonCount', 'tenonWidth', 'slotOffset', 'lapCount', 'lapDepth', 'snapLip', 'snapLength', 'snapRelief',
  'hookLength', 'wedgeWidth', 'wedgePull', 'boltDia', 'nutWidth', 'nutHeight', 'boltLength', 'kerf', 'clearance',
] as const;

// ---------- Werkzeuge ----------

export const EDIT_TOOLS: ToolDef[] = [
  {
    name: 'create_shape',
    title: 'Form anlegen',
    description:
      'Legt eine Form an. rect: x/y = linke untere Ecke, width/height, cornerRadius. ellipse: cx/cy = Mitte, rx/ry. polygon: cx/cy, radius (Umkreis), sides, star, innerRatio. polyline: points [[x,y],…], closed. path: d = SVG-Pfad in Maschinenkoordinaten (mm, y nach oben). Gibt die neue id zurück.',
    tier: Tier.Edit,
    inputSchema: obj({
      type: { type: 'string', enum: ['rect', 'ellipse', 'polygon', 'polyline', 'path'] },
      x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, cornerRadius: { type: 'number' },
      cx: { type: 'number' }, cy: { type: 'number' }, rx: { type: 'number' }, ry: { type: 'number' },
      radius: { type: 'number' }, sides: { type: 'integer', minimum: 3, maximum: 200 }, star: { type: 'boolean' }, innerRatio: { type: 'number' },
      points: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } }, closed: { type: 'boolean' },
      d: { type: 'string' }, layer: LAYER, rotation: ROT,
    }, ['type']),
    run: (ed, a) => {
      const type = oneOf(a, 'type', ['rect', 'ellipse', 'polygon', 'polyline', 'path'] as const);
      const layer = layerOf(ed, a);
      const rot = num(a, 'rotation', { def: 0 });
      let o: Obj;
      if (type === 'rect') {
        const w = num(a, 'width', { min: 0.001 }), h = num(a, 'height', { min: 0.001 });
        const r = num(a, 'cornerRadius', { def: 0, min: 0, max: Math.min(w, h) / 2 });
        const p = W(ed, num(a, 'x'), num(a, 'y') + h);
        o = addObj(ed, { kind: 'rect', w, h, r }, translate(p.x, p.y), layer, rot);
      } else if (type === 'ellipse') {
        const rx = num(a, 'rx', { min: 0.001 });
        const ry = num(a, 'ry', { def: rx, min: 0.001 });
        const c = W(ed, num(a, 'cx'), num(a, 'cy'));
        o = addObj(ed, { kind: 'ellipse', rx, ry }, translate(c.x, c.y), layer, rot);
      } else if (type === 'polygon') {
        const c = W(ed, num(a, 'cx'), num(a, 'cy'));
        const shape: Shape = {
          kind: 'polygon', sides: num(a, 'sides', { def: 6, min: 3, max: 200, int: true }), r: num(a, 'radius', { min: 0.001 }),
          star: bool(a, 'star', false), inner: num(a, 'innerRatio', { def: 0.5, min: 0.05, max: 0.95 }),
        };
        o = addObj(ed, shape, translate(c.x, c.y), layer, rot);
      } else if (type === 'polyline') {
        const pts = a.points;
        if (!Array.isArray(pts) || pts.length < 2) throw new ToolError('„points“ braucht mindestens zwei Punkte [x, y]');
        const nodes = pts.map((p, i) => {
          if (!Array.isArray(p) || p.length !== 2 || !p.every((v) => isFinite(Number(v)))) throw new ToolError(`Punkt ${i} ist kein [x, y]`);
          return W(ed, Number(p[0]), Number(p[1]));
        });
        o = addObj(ed, { kind: 'path', subs: [{ nodes, closed: bool(a, 'closed', false) }] }, IDENT, layer, rot);
      } else {
        if (typeof a.d !== 'string' || !a.d.trim()) throw new ToolError('„d“ (SVG-Pfad) fehlt');
        const subs = transformSubs(parsePathData(a.d), flip(ed));
        if (!subs.some((sp) => sp.nodes.length > 1)) throw new ToolError('Der Pfad enthält keine Linien');
        o = addObj(ed, { kind: 'path', subs }, IDENT, layer, rot);
      }
      return { id: o.id, object: describe(ed, o, IDENT, false) };
    },
  },
  {
    name: 'create_text',
    title: 'Text anlegen',
    description:
      'Legt einen Text an. x/y = Anfang der Grundlinie der ersten Zeile (bei align center/right die Mitte bzw. das Ende). size = Schrifthöhe (Em) in mm. Zeilenumbrüche mit \\n. Schriften: list_fonts.',
    tier: Tier.Edit,
    inputSchema: obj({
      text: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, font: { type: 'string' }, size: { type: 'number' },
      bold: { type: 'boolean' }, italic: { type: 'boolean' }, upper: { type: 'boolean', description: 'In Großbuchstaben' },
      align: { type: 'string', enum: ['left', 'center', 'right'] }, letterSpacing: { type: 'number', description: 'Zusätzlicher Zeichenabstand (mm)' },
      lineSpacing: { type: 'number', description: 'Zusätzlicher Zeilenabstand (mm)' },
      weld: { type: 'boolean', description: 'Buchstaben schweißen: überlappende Zeichen zu einer Kontur verschmelzen' }, layer: LAYER, rotation: ROT,
    }, ['text', 'x', 'y']),
    run: (ed, a) => {
      if (typeof a.text !== 'string' || !a.text.trim()) throw new ToolError('„text“ ist leer');
      const d = ed.textDefaults;
      const shape: TextShape = {
        kind: 'text', text: a.text,
        font: typeof a.font === 'string' && a.font.trim() ? a.font.trim() : d.font,
        size: num(a, 'size', { def: d.size, min: 0.1, max: 2000 }),
        bold: bool(a, 'bold', false), italic: bool(a, 'italic', false), upper: bool(a, 'upper', false),
        align: oneOf(a, 'align', ['left', 'center', 'right'] as const, 'left'),
        hSpace: num(a, 'letterSpacing', { def: 0 }), vSpace: num(a, 'lineSpacing', { def: 0 }),
      };
      if (bool(a, 'weld', false)) shape.weld = true;
      const p = W(ed, num(a, 'x'), num(a, 'y'));
      const o = addObj(ed, shape, translate(p.x, p.y), layerOf(ed, a));
      const rot = num(a, 'rotation', { def: 0 });
      if (rot) o.m = mul(about(rotate((-rot * Math.PI) / 180), p.x, p.y), o.m);
      return { id: o.id, object: describe(ed, o, IDENT, false), note: 'Rahmen und Umriss stimmen erst, wenn die Schrift geladen ist; render_preview zeigt das Ergebnis.' };
    },
  },
  {
    name: 'create_qr_code',
    title: 'QR-Code anlegen',
    description:
      'Legt einen QR-Code an (Module als geschlossene Umrisse; auf einem Füll-Layer wird er graviert). x/y = Mitte, size = Kantenlänge in mm. errorCorrection L/M/Q/H (Standard M). invert: Hintergrund samt Ruhezone lasern statt der Module (für dunkle Materialien). variable: Platzhalter wie im variablen Text (%# Seriennummer, %0 CSV-Spalte, %Y Jahr …), variableOffset wird zur aktuellen Nummer addiert. WLAN: data "WIFI:T:WPA;S:<Name>;P:<Passwort>;;".',
    tier: Tier.Edit,
    inputSchema: obj({
      data: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, size: { type: 'number', description: 'Kantenlänge in mm (Standard 30)' },
      errorCorrection: { type: 'string', enum: ['L', 'M', 'Q', 'H'] }, invert: { type: 'boolean' },
      quietZone: { type: 'integer', minimum: 0, maximum: 10, description: 'Ruhezone in Modulen (nur bei invert gelasert, Standard 2)' },
      variable: { type: 'boolean' }, variableOffset: { type: 'integer' }, layer: LAYER, rotation: ROT,
    }, ['data', 'x', 'y']),
    run: (ed, a) => {
      if (typeof a.data !== 'string' || !a.data) throw new ToolError('„data“ ist leer');
      const size = num(a, 'size', { def: 30, min: 1, max: 2000 });
      const shape: BarcodeShape = {
        kind: 'barcode', type: 'qr', data: a.data, size,
        ec: oneOf(a, 'errorCorrection', ['L', 'M', 'Q', 'H'] as const, 'M'),
        invert: bool(a, 'invert', false), quiet: num(a, 'quietZone', { def: 2, min: 0, max: 10, int: true }),
      };
      if (bool(a, 'variable', false)) shape.vt = { offset: num(a, 'variableOffset', { def: 0, int: true }) };
      if (!shape.vt && !qrMatrix(shape.data, shape.ec)) throw new ToolError('Der Inhalt ist zu lang für einen QR-Code');
      const p = W(ed, num(a, 'x'), num(a, 'y'));
      const o = addObj(ed, shape, translate(p.x - size / 2, p.y - size / 2), layerOf(ed, a), num(a, 'rotation', { def: 0 }));
      return { id: o.id, object: describe(ed, o, IDENT, false) };
    },
  },
  {
    name: 'variable_text',
    title: 'Variabler Text: Nummer und Einstellungen',
    description:
      'Liest und ändert die projektweiten Einstellungen für variablen Text: current (aktuelle Nummer = Seriennummer und CSV-Zeile ab 1), start, end (danach wieder start), advance (Schrittweite), autoAdvance (nach jedem Job/G-Code weiterzählen). step zählt um so viele Schritte weiter (negativ = zurück). Ohne Angaben nur lesen. Texte werden mit edit_object variable=true variabel.',
    tier: Tier.Edit,
    inputSchema: obj({
      current: { type: 'integer' }, start: { type: 'integer' }, end: { type: 'integer' }, advance: { type: 'integer' },
      autoAdvance: { type: 'boolean' }, step: { type: 'integer' },
    }),
    run: (ed, a) => {
      const vt = ed.varText;
      const patch: Record<string, number | boolean> = {};
      for (const k of ['current', 'start', 'end', 'advance'] as const) {
        const v = optNum(a, k, { int: true });
        if (v !== undefined) patch[k] = v;
      }
      if (a.autoAdvance !== undefined) patch.autoAdvance = a.autoAdvance === true;
      if (Object.keys(patch).length) ed.setVarText(patch);
      const step = optNum(a, 'step', { int: true });
      if (step) {
        advanceVarText(vt, step);
        ed.setVarText({});
      }
      return {
        current: vt.current, start: vt.start, end: vt.end, advance: vt.advance, autoAdvance: vt.autoAdvance,
        csv: vt.csv ? { file: vt.csv.name, rows: vt.csv.rows.length, columns: vt.csv.header ?? null } : null,
        objects: ed.varTextObjs(false).map((o) => describe(ed, o, IDENT, false)),
      };
    },
  },
  {
    name: 'edit_object',
    title: 'Objekt ändern',
    description:
      'Ändert Eigenschaften eines Objekts (auch in Gruppen). Alle Typen: name (leer = Standardname), hidden (ausgeblendet: nicht gezeichnet und nicht gelasert), locked (auf der Arbeitsfläche nicht auswählbar; nur oberste Ebene). Text: text, font, size (mm auf dem Bett), bold, italic, upper, align, letterSpacing, lineSpacing, weld (Buchstaben schweißen); bei Text auf Pfad (apply_path_to_text) pathOffset (Verschiebung entlang der Kurve, mm), pathDistance (Abstand der Grundlinie, mm, positiv nach oben), pathFlip (andere Seite), removePath (wieder gerade), variable (variabler Text mit Platzhaltern, siehe variable_text), variableOffset, maxWidth (mm, breitere Zeilen werden gestaucht, 0 = aus). QR-Code: data, errorCorrection, qrSize (Kantenlänge mm), invert, quietZone, variable, variableOffset. Rechteck: cornerRadius. Vieleck: sides, star, innerRatio. Lage und Größe ändert transform.',
    tier: Tier.Edit,
    inputSchema: obj({
      id: { type: 'integer' }, name: { type: 'string' }, hidden: { type: 'boolean' }, locked: { type: 'boolean' }, text: { type: 'string' }, font: { type: 'string' }, size: { type: 'number' }, bold: { type: 'boolean' },
      italic: { type: 'boolean' }, upper: { type: 'boolean' }, align: { type: 'string', enum: ['left', 'center', 'right'] },
      letterSpacing: { type: 'number' }, lineSpacing: { type: 'number' }, weld: { type: 'boolean' }, pathOffset: { type: 'number' },
      pathDistance: { type: 'number' }, pathFlip: { type: 'boolean' }, removePath: { type: 'boolean' }, cornerRadius: { type: 'number' },
      sides: { type: 'integer', minimum: 3, maximum: 200 }, star: { type: 'boolean' }, innerRatio: { type: 'number' },
      variable: { type: 'boolean' }, variableOffset: { type: 'integer' }, maxWidth: { type: 'number' }, data: { type: 'string' },
      errorCorrection: { type: 'string', enum: ['L', 'M', 'Q', 'H'] }, qrSize: { type: 'number' }, invert: { type: 'boolean' }, quietZone: { type: 'integer' },
    }, ['id']),
    run: (ed, a) => {
      const hit = findObj(ed.doc.objs, num(a, 'id', { int: true }));
      if (!hit) throw new ToolError(`Kein Objekt mit id ${a.id}`);
      const [o, parent] = hit;
      const m = mul(parent, o.m);
      const s = o.shape;
      const props: { name?: string; hidden?: boolean; locked?: boolean } = {};
      if (typeof a.name === 'string') props.name = a.name;
      if (a.hidden !== undefined) props.hidden = a.hidden === true;
      if (a.locked !== undefined) {
        if (!ed.doc.objs.includes(o)) throw new ToolError('Sperren geht nur bei Objekten der obersten Ebene (nicht in Gruppen)');
        props.locked = a.locked === true;
      }
      const SHAPE_KEYS = [
        'text', 'font', 'size', 'bold', 'italic', 'upper', 'align', 'letterSpacing', 'lineSpacing', 'weld', 'pathOffset', 'pathDistance', 'pathFlip', 'removePath',
        'cornerRadius', 'sides', 'star', 'innerRatio', 'variable', 'variableOffset', 'maxWidth', 'data', 'errorCorrection', 'qrSize', 'invert', 'quietZone',
      ];
      const shapeChange = SHAPE_KEYS.some((k) => a[k] !== undefined);
      if (Object.keys(props).length) ed.setObjProps([o], props);
      if (!shapeChange) {
        if (!Object.keys(props).length) throw new ToolError('Keine Eigenschaft angegeben');
        return { object: describe(ed, o, parent, false) };
      }
      if (s.kind === 'text') {
        if (a.text !== undefined) {
          if (typeof a.text !== 'string' || !a.text.trim()) throw new ToolError('„text“ ist leer');
          s.text = a.text;
        }
        if (typeof a.font === 'string' && a.font.trim()) s.font = a.font.trim();
        const size = optNum(a, 'size', { min: 0.1 });
        if (size !== undefined) s.size = size / (Math.hypot(m[2], m[3]) || 1);
        if (a.bold !== undefined) s.bold = a.bold === true;
        if (a.italic !== undefined) s.italic = a.italic === true;
        if (a.upper !== undefined) s.upper = a.upper === true;
        if (a.align !== undefined) s.align = oneOf(a, 'align', ['left', 'center', 'right'] as const);
        s.hSpace = optNum(a, 'letterSpacing') ?? s.hSpace;
        s.vSpace = optNum(a, 'lineSpacing') ?? s.vSpace;
        if (a.weld !== undefined) s.weld = a.weld === true;
        if (a.removePath === true) delete s.path;
        const pathKeys = ['pathOffset', 'pathDistance', 'pathFlip'].filter((k) => a[k] !== undefined);
        if (pathKeys.length) {
          if (!s.path) throw new ToolError('Der Text liegt auf keinem Pfad; erst apply_path_to_text');
          s.path.offset = optNum(a, 'pathOffset') ?? s.path.offset;
          s.path.dist = optNum(a, 'pathDistance') ?? s.path.dist;
          if (a.pathFlip !== undefined) s.path.flip = a.pathFlip === true;
        }
        const mw = optNum(a, 'maxWidth', { min: 0 });
        if (mw !== undefined) s.maxW = mw / (Math.hypot(m[0], m[1]) || 1);
        setVar(s, a);
      } else if (s.kind === 'barcode') {
        if (a.data !== undefined) {
          if (typeof a.data !== 'string' || !a.data) throw new ToolError('„data“ ist leer');
          s.data = a.data;
          delete s.form;
        }
        if (a.errorCorrection !== undefined) s.ec = oneOf(a, 'errorCorrection', ['L', 'M', 'Q', 'H'] as const) as QrLevel;
        const qs = optNum(a, 'qrSize', { min: 1, max: 2000 });
        if (qs !== undefined) s.size = qs / (Math.hypot(m[0], m[1]) || 1);
        if (a.invert !== undefined) s.invert = a.invert === true;
        s.quiet = optNum(a, 'quietZone', { min: 0, max: 10, int: true }) ?? s.quiet;
        setVar(s, a);
      } else if (s.kind === 'rect') {
        const r = optNum(a, 'cornerRadius', { min: 0 });
        if (r !== undefined) s.r = Math.min(r / (Math.min(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3])) || 1), Math.min(s.w, s.h) / 2);
      } else if (s.kind === 'polygon') {
        s.sides = optNum(a, 'sides', { min: 3, max: 200, int: true }) ?? s.sides;
        if (a.star !== undefined) s.star = a.star === true;
        s.inner = optNum(a, 'innerRatio', { min: 0.05, max: 0.95 }) ?? s.inner;
      } else throw new ToolError(`Objekte vom Typ ${s.kind} haben hier nichts zu ändern; Lage und Größe: transform`);
      ed.touch(s);
      ed.emit('doc');
      ed.emit('sel');
      return { object: describe(ed, o, parent, false) };
    },
  },
  {
    name: 'transform',
    title: 'Verschieben, skalieren, drehen',
    description:
      'Transformiert Objekte gemeinsam (wie eine Auswahl), in dieser Reihenfolge: Größe (width/height oder scale), Drehung, Spiegeln, dann Lage (x/y oder dx/dy). x/y setzen die linke untere Ecke des gemeinsamen Rahmens, mit anchor "center" seine Mitte. Bei width/height bleibt die linke untere Ecke stehen; fehlt eines von beiden, bleibt das Seitenverhältnis erhalten.',
    tier: Tier.Edit,
    inputSchema: obj({
      ids: IDS, dx: { type: 'number' }, dy: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' },
      anchor: { type: 'string', enum: ['bottom-left', 'center'] }, width: { type: 'number' }, height: { type: 'number' },
      scale: { type: 'number', description: 'Faktor um die Mitte' }, rotate: ROT, mirror: { type: 'string', enum: ['horizontal', 'vertical'] },
    }, ['ids']),
    run: (ed, a) => {
      const objs = topObjs(ed, ids(a));
      ed.setSel(objs);
      const w = optNum(a, 'width', { min: 0.001 }), h = optNum(a, 'height', { min: 0.001 });
      // Linke untere Ecke bleibt stehen
      if (w !== undefined || h !== undefined) ed.setSelBox({ w, h }, 0, 1, w === undefined || h === undefined);
      const f = optNum(a, 'scale', { min: 0.0001 });
      if (f !== undefined && f !== 1) {
        const b = ed.selBounds()!;
        ed.transformSel(about(scale(f, f), b.x + b.w / 2, b.y + b.h / 2));
      }
      const rot = optNum(a, 'rotate');
      if (rot) ed.rotateBy(rot);
      if (a.mirror !== undefined) ed.mirror(oneOf(a, 'mirror', ['horizontal', 'vertical'] as const) === 'horizontal');
      const x = optNum(a, 'x'), y = optNum(a, 'y');
      if (x !== undefined || y !== undefined) {
        const center = oneOf(a, 'anchor', ['bottom-left', 'center'] as const, 'bottom-left') === 'center';
        ed.setSelBox({ x, y: y === undefined ? undefined : ed.doc.bed.h - y }, center ? 0.5 : 0, center ? 0.5 : 1, false);
      }
      const dx = num(a, 'dx', { def: 0 }), dy = num(a, 'dy', { def: 0 });
      if (dx || dy) ed.transformSel(translate(dx, -dy));
      return { objects: describeAll(ed, objs), bounds: machineBox(ed, ed.selBounds()) };
    },
  },
  {
    name: 'align',
    title: 'Ausrichten und verteilen',
    description:
      'Richtet Objekte aneinander aus (relative_to "selection", gemeinsamer Rahmen) oder am Bett ("bed"). how: left, right, top, bottom, hcenter (senkrechte Mittellinie), vcenter (waagerechte Mittellinie). distribute: horizontal/vertical verteilt die Mitten gleichmäßig (ab 3 Objekten).',
    tier: Tier.Edit,
    inputSchema: obj({
      ids: IDS, how: { type: 'string', enum: ['left', 'right', 'top', 'bottom', 'hcenter', 'vcenter'] },
      relative_to: { type: 'string', enum: ['selection', 'bed'] }, distribute: { type: 'string', enum: ['horizontal', 'vertical'] },
    }, ['ids']),
    run: (ed, a) => {
      const objs = topObjs(ed, ids(a));
      ed.setSel(objs);
      if (a.how !== undefined) {
        const how = oneOf(a, 'how', ['left', 'right', 'top', 'bottom', 'hcenter', 'vcenter'] as const);
        // Oben/unten in Maschinensicht = Welt oben/unten (die Welt hat y nach unten, die Anzeige auch)
        if (oneOf(a, 'relative_to', ['selection', 'bed'] as const, 'selection') === 'bed') {
          const B: Box = { x: 0, y: 0, w: ed.doc.bed.w, h: ed.doc.bed.h };
          for (const o of objs) {
            const b = boundsOf([o])!;
            const dx = how === 'left' ? B.x - b.x : how === 'right' ? B.w - (b.x + b.w) : how === 'hcenter' ? B.w / 2 - (b.x + b.w / 2) : 0;
            const dy = how === 'top' ? B.y - b.y : how === 'bottom' ? B.h - (b.y + b.h) : how === 'vcenter' ? B.h / 2 - (b.y + b.h / 2) : 0;
            o.m = mul(translate(dx, dy), o.m);
          }
          ed.emit('doc');
          ed.emit('sel');
        } else {
          if (objs.length < 2) throw new ToolError('Zum Ausrichten aneinander mindestens zwei Objekte angeben (oder relative_to "bed")');
          ed.align(how);
        }
      }
      if (a.distribute !== undefined) {
        if (objs.length < 3) throw new ToolError('Verteilen braucht mindestens drei Objekte');
        ed.distribute(oneOf(a, 'distribute', ['horizontal', 'vertical'] as const) === 'horizontal');
      }
      return { objects: describeAll(ed, objs) };
    },
  },
  {
    name: 'group',
    title: 'Gruppieren',
    description: 'Fasst Objekte zu einer Gruppe zusammen und gibt die id der Gruppe zurück.',
    tier: Tier.Edit,
    inputSchema: obj({ ids: { ...IDS, minItems: 2 } }, ['ids']),
    run: (ed, a) => {
      const before = snapshotIds(ed);
      const objs = topObjs(ed, ids(a));
      if (objs.length < 2) throw new ToolError('Mindestens zwei Objekte angeben');
      ed.setSel(objs);
      ed.group();
      return result(ed, before);
    },
  },
  {
    name: 'ungroup',
    title: 'Gruppe auflösen',
    description: 'Löst Gruppen auf; die Teile werden eigenständige Objekte (ids bleiben).',
    tier: Tier.Edit,
    inputSchema: obj({ ids: IDS }, ['ids']),
    run: (ed, a) => {
      const before = snapshotIds(ed);
      const objs = topObjs(ed, ids(a));
      if (!objs.some((o) => o.shape.kind === 'group')) throw new ToolError('Keine Gruppe unter den Objekten');
      ed.setSel(objs);
      ed.ungroup();
      return result(ed, before);
    },
  },
  {
    name: 'delete_objects',
    title: 'Löschen',
    description: 'Löscht Objekte (rückgängig machbar mit undo).',
    tier: Tier.Edit,
    inputSchema: obj({ ids: IDS }, ['ids']),
    run: (ed, a) => {
      const before = snapshotIds(ed);
      ed.setSel(topObjs(ed, ids(a)));
      ed.deleteSel();
      return result(ed, before);
    },
  },
  {
    name: 'duplicate',
    title: 'Duplizieren',
    description: 'Kopiert Objekte, optional um dx/dy verschoben.',
    tier: Tier.Edit,
    inputSchema: obj({ ids: IDS, dx: { type: 'number' }, dy: { type: 'number' } }, ['ids']),
    run: (ed, a) => {
      const before = snapshotIds(ed);
      ed.setSel(topObjs(ed, ids(a)));
      ed.duplicate();
      const dx = num(a, 'dx', { def: 0 }), dy = num(a, 'dy', { def: 0 });
      if (dx || dy) ed.transformSel(translate(dx, -dy));
      return result(ed, before);
    },
  },
  {
    name: 'assign_layer',
    title: 'Layer zuweisen',
    description: 'Legt Objekte (samt Gruppeninhalt) auf einen Layer.',
    tier: Tier.Edit,
    inputSchema: obj({ ids: IDS, layer: { ...LAYER, description: 'Layer 0–29' } }, ['ids', 'layer']),
    run: (ed, a) => {
      const objs = topObjs(ed, ids(a));
      ed.setSel(objs);
      ed.assignLayer(num(a, 'layer', { min: 0, max: 31, int: true }));
      return { objects: describeAll(ed, objs) };
    },
  },
  {
    name: 'select',
    title: 'Auswählen',
    description: 'Wählt Objekte in der Oberfläche aus, damit die Person sieht, worum es geht. Leere Liste hebt die Auswahl auf.',
    tier: Tier.Edit,
    ownUndo: true,
    inputSchema: obj({ ids: { type: 'array', items: { type: 'integer' } } }, ['ids']),
    run: (ed, a) => {
      const list = Array.isArray(a.ids) ? a.ids.map(Number) : [];
      ed.setSel(list.length ? topObjs(ed, list) : []);
      return { selection: ed.sel.map((o) => o.id) };
    },
  },
  {
    name: 'boolean',
    title: 'Boolesche Operation',
    description:
      'union (vereinen), subtract (von der Basis abziehen), intersect (Schnittmenge), xor. Basis: base "first" = erstes Objekt in ids, "back" = hinterstes, "front" = vorderstes. Texte werden über ihre Konturen verrechnet. Ergebnis: ein Pfad mit Bézierkurven; Originale werden ersetzt, außer keep_originals.',
    tier: Tier.Edit,
    inputSchema: obj({
      ids: { ...IDS, minItems: 2 }, op: { type: 'string', enum: ['union', 'subtract', 'intersect', 'xor'] },
      base: { type: 'string', enum: ['first', 'back', 'front'] }, keep_originals: { type: 'boolean' },
    }, ['ids', 'op']),
    run: async (ed, a) => {
      const before = snapshotIds(ed);
      const objs = topObjs(ed, ids(a));
      if (objs.length < 2) throw new ToolError('Mindestens zwei Objekte angeben');
      const op = oneOf(a, 'op', ['union', 'subtract', 'intersect', 'xor'] as const) as BoolOp;
      const base = oneOf(a, 'base', ['first', 'back', 'front'] as const, 'first');
      ed.setSel(objs);
      const keep = ed.boolKeep;
      ed.boolKeep = bool(a, 'keep_originals', false);
      try {
        await ed.booleanSel(op, base === 'first' ? 'selection' : base);
      } finally {
        ed.boolKeep = keep;
      }
      return result(ed, before);
    },
  },
  {
    name: 'offset',
    title: 'Offset',
    description: 'Neue Kontur im Abstand distance (mm) nach außen, innen oder beidseitig. Ecken: round, miter, square. Originale bleiben, außer keep_originals = false.',
    tier: Tier.Edit,
    inputSchema: obj({
      ids: IDS, distance: { type: 'number', exclusiveMinimum: 0 }, direction: { type: 'string', enum: ['outward', 'inward', 'both'] },
      join: { type: 'string', enum: ['round', 'miter', 'square'] }, keep_originals: { type: 'boolean' },
    }, ['ids', 'distance']),
    run: async (ed, a) => {
      const before = snapshotIds(ed);
      ed.setSel(topObjs(ed, ids(a)));
      const opt: OffsetOptions = {
        distance: num(a, 'distance', { min: 0.001, max: 1000 }),
        direction: oneOf(a, 'direction', ['outward', 'inward', 'both'] as const, 'outward'),
        join: oneOf(a, 'join', ['round', 'miter', 'square'] as const, 'round'),
      };
      await ed.offsetSel(opt, bool(a, 'keep_originals', true));
      return result(ed, before);
    },
  },
  {
    name: 'apply_path_to_text',
    title: 'Text auf Pfad',
    description:
      'Lässt einen Text einer Form folgen (Linie/Pfad, Rechteck, Ellipse, Polygon), wie „Apply Path to Text“ in LightBurn. Text und Form bleiben verknüpft: Wird die Form verschoben oder geändert, folgt der Text; wird nur der Text verschoben, wandert die Form mit. Die Form wird mitgelasert (auf Layer T1/T2 legen oder ausblenden, wenn nicht); wird sie gelöscht, behält der Text die letzte Kurve. Offene Kurven: Anfang/Mitte/Ende je nach align des Texts; geschlossene Formen: oberster Punkt. Feinjustieren mit edit_object (pathOffset, pathDistance, pathFlip).',
    tier: Tier.Edit,
    inputSchema: obj({ textId: { type: 'integer' }, shapeId: { type: 'integer' } }, ['textId', 'shapeId']),
    run: (ed, a) => {
      const [to, so] = topObjs(ed, [num(a, 'textId', { int: true }), num(a, 'shapeId', { int: true })]);
      if (to.shape.kind !== 'text') throw new ToolError(`Objekt ${to.id} ist kein Text`);
      if (!['path', 'rect', 'ellipse', 'polygon'].includes(so.shape.kind)) throw new ToolError(`Objekt ${so.id} (${so.shape.kind}) taugt nicht als Kurve`);
      ed.setSel([to, so]);
      if (!ed.applyPathToText()) throw new ToolError(ed.hint || 'Text auf Pfad nicht möglich');
      return { object: describe(ed, to, IDENT, false), note: 'Die Form ist mit dem Text verknüpft und wird mitgelasert, außer auf Layer T1/T2 oder ausgeblendet.' };
    },
  },
  {
    name: 'convert_to_path',
    title: 'In Pfad umwandeln',
    description: 'Wandelt Formen und Texte (über die Schriftkonturen) in Pfade um.',
    tier: Tier.Edit,
    inputSchema: obj({ ids: IDS }, ['ids']),
    run: async (ed, a) => {
      const objs = topObjs(ed, ids(a));
      ed.setSel(objs);
      await ed.convertSelToPath();
      return { objects: describeAll(ed, objs), message: ed.hint };
    },
  },
  {
    name: 'path_tool',
    title: 'Pfad-Werkzeuge',
    description:
      'Pfad-Werkzeuge wie in LightBurn. op "close": offene Pfade schließen, deren Anfang und Ende höchstens tolerance mm (Standard 0.5) auseinanderliegen; close_mode "line" fügt eine Gerade ein, "move" zieht die Enden zusammen. ' +
      'op "join": offene Pfade verbinden, deren Enden höchstens tolerance mm (Standard 0.05) auseinanderliegen (Auto-Join); beteiligte Objekte werden zu einem. ' +
      'op "break_apart": in einzelne Geraden und Kurven zerlegen (Texte über ihre Konturen). op "reverse": Laufrichtung umkehren. ' +
      'op "set_start": Startpunkt des Schnitts auf den Knoten legen, der x/y am nächsten liegt (ein Objekt in ids); reverse kehrt dabei die Richtung um, reset überlässt Startpunkt und Richtung wieder der Optimierung. Offene Pfade beginnen nur an einem Ende. ' +
      'op "trim": den Abschnitt der Kurve bei x/y bis zu den nächsten Schnittpunkten mit anderen Kurven entfernen (ids nicht nötig); ohne Schnittpunkt wird der ganze Pfad entfernt. Reste werden an den Schnittpunkten verbunden, außer no_join; keep_piece behält das entfernte Stück auf dem aktuellen Layer. ' +
      'Ergebnisse bleiben Bézierkurven; Grundformen werden dabei zu Pfaden.',
    tier: Tier.Edit,
    inputSchema: obj({
      op: { type: 'string', enum: ['close', 'join', 'break_apart', 'reverse', 'set_start', 'trim'] }, ids: IDS,
      tolerance: { type: 'number', exclusiveMinimum: 0 }, close_mode: { type: 'string', enum: ['line', 'move'] },
      x: { type: 'number' }, y: { type: 'number' }, reverse: { type: 'boolean' }, reset: { type: 'boolean' },
      keep_piece: { type: 'boolean' }, no_join: { type: 'boolean' },
    }, ['op']),
    run: async (ed, a) => {
      const before = snapshotIds(ed);
      const op = oneOf(a, 'op', ['close', 'join', 'break_apart', 'reverse', 'set_start', 'trim'] as const);
      ed.hint = '';
      if (op === 'trim') {
        const p = W(ed, num(a, 'x'), num(a, 'y'));
        if (!ed.trimAtPoint(p, num(a, 'tolerance', { def: 1, min: 0.001, max: 100 }), { keepCopy: bool(a, 'keep_piece', false), noJoin: bool(a, 'no_join', false) }))
          throw new ToolError('Keine trimmbare Kurve (Pfad, Rechteck, Ellipse, Polygon auf oberster Ebene) in der Nähe von x/y');
        return result(ed, before, { selection: ed.sel.map((o) => o.id) });
      }
      const objs = topObjs(ed, ids(a));
      ed.setSel(objs);
      if (op === 'close') {
        const st = ed.closeSel(num(a, 'tolerance', { def: 0.5, min: 0.001, max: 1000 }), oneOf(a, 'close_mode', ['line', 'move'] as const, 'line'));
        return result(ed, before, { open: st.open, closed: st.closed, objects: describeAll(ed, objs.filter((o) => ed.doc.objs.includes(o))) });
      }
      if (op === 'join') {
        const joins = ed.joinSel(num(a, 'tolerance', { def: 0.05, min: 0.0001, max: 100 }));
        return result(ed, before, { joins, objects: describeAll(ed, ed.sel) });
      }
      if (op === 'break_apart') {
        const n = await ed.breakApartSel();
        if (!n) throw new ToolError(ed.hint || 'Nichts zu zerlegen');
        return result(ed, before);
      }
      if (op === 'reverse') {
        ed.reverseSel();
        return result(ed, before, { objects: describeAll(ed, objs) });
      }
      if (objs.length !== 1) throw new ToolError('set_start braucht genau ein Objekt in ids');
      const o = objs[0];
      if (!['path', 'rect', 'ellipse', 'polygon'].includes(o.shape.kind)) throw new ToolError(`Objekt ${o.id} (${o.shape.kind}) hat keine Knoten`);
      const mode = bool(a, 'reset', false) ? 'reset' : bool(a, 'reverse', false) ? 'reverse' : 'set';
      if (!ed.startAtPoint(o, W(ed, num(a, 'x'), num(a, 'y')), mode)) throw new ToolError(ed.hint || 'Startpunkt nicht gesetzt');
      return result(ed, before, { object: describe(ed, o, IDENT, false) });
    },
  },
  {
    name: 'array_grid',
    title: 'Rasterarray',
    description:
      'Kopiert Objekte im Raster. dx/dy: Lücke zwischen den Kopien (spacing "gap") oder Mittenabstand ("center"). Richtung: dir_x 1 = nach rechts, dir_y 1 = nach oben. row_shift versetzt jede zweite Zeile waagerecht. group: alles gruppieren.',
    tier: Tier.Edit,
    inputSchema: obj({
      ids: IDS, columns: { type: 'integer', minimum: 1 }, rows: { type: 'integer', minimum: 1 }, dx: { type: 'number' }, dy: { type: 'number' },
      spacing: { type: 'string', enum: ['gap', 'center'] }, dir_x: { type: 'integer', enum: [1, -1] }, dir_y: { type: 'integer', enum: [1, -1] },
      row_shift: { type: 'number' }, col_shift: { type: 'number' }, mirror_cols: { type: 'boolean' }, mirror_rows: { type: 'boolean' }, group: { type: 'boolean' },
    }, ['ids', 'columns', 'rows']),
    run: (ed, a) => {
      const before = snapshotIds(ed);
      ed.setSel(topObjs(ed, ids(a)));
      const o: GridOptions = {
        ...DEFAULT_GRID,
        columns: num(a, 'columns', { min: 1, max: 1000, int: true }), rows: num(a, 'rows', { min: 1, max: 1000, int: true }),
        dx: num(a, 'dx', { def: DEFAULT_GRID.dx }), dy: num(a, 'dy', { def: DEFAULT_GRID.dy }),
        spacing: oneOf(a, 'spacing', ['gap', 'center'] as const, 'gap'),
        dirX: num(a, 'dir_x', { def: 1 }) < 0 ? -1 : 1, dirY: num(a, 'dir_y', { def: -1 }) < 0 ? -1 : 1,
        rowShift: num(a, 'row_shift', { def: 0 }), colShift: num(a, 'col_shift', { def: 0 }),
        mirrorCols: bool(a, 'mirror_cols', false), mirrorRows: bool(a, 'mirror_rows', false),
      };
      if (o.columns * o.rows < 2) throw new ToolError('Mindestens zwei Felder (columns × rows)');
      ed.applyArray(gridMatrices(ed.selBounds()!, o), bool(a, 'group', false), t('Rasterarray'));
      return result(ed, before);
    },
  },
  {
    name: 'array_circular',
    title: 'Kreisarray',
    description:
      'Kopiert Objekte auf einem Kreis um cx/cy (Standard: Mitte des Betts). count = Anzahl einschließlich Original, span = Winkelbereich in Grad (360 = gleichmäßig). rotate: Kopien mitdrehen.',
    tier: Tier.Edit,
    inputSchema: obj({
      ids: IDS, count: { type: 'integer', minimum: 2 }, cx: { type: 'number' }, cy: { type: 'number' }, span: { type: 'number' },
      ccw: { type: 'boolean' }, rotate: { type: 'boolean' }, group: { type: 'boolean' },
    }, ['ids', 'count']),
    run: (ed, a) => {
      const before = snapshotIds(ed);
      ed.setSel(topObjs(ed, ids(a)));
      const c = W(ed, num(a, 'cx', { def: ed.doc.bed.w / 2 }), num(a, 'cy', { def: ed.doc.bed.h / 2 }));
      const mats = circularMatrices(ed.selBounds()!, {
        count: num(a, 'count', { min: 2, max: 5000, int: true }), cx: c.x, cy: c.y, span: num(a, 'span', { def: 360 }),
        ccw: bool(a, 'ccw', true), rotate: bool(a, 'rotate', true),
      });
      ed.applyArray(mats, bool(a, 'group', false), t('Kreisarray'));
      return result(ed, before);
    },
  },
  {
    name: 'make_hinge',
    title: 'Biegeschnitte',
    description:
      'Füllt geschlossene Formen mit einem Biegemuster (Living Hinge). kind: straight, wave, diamond, honeycomb, triangle, cross, spiral. Mit thickness (Materialdicke) werden passende Startwerte gewählt; einzelne Werte (cutLength, bridge, spacing, margin, waveAmp, waveLength, diamondAngle in mm bzw. Grad) überschreiben sie. orient: auto, vertical, horizontal, angle (dann angle in Grad). keep_outline: Form behalten.',
    tier: Tier.Edit,
    inputSchema: obj({
      ids: IDS, kind: { type: 'string', enum: ['straight', 'wave', 'diamond', 'honeycomb', 'triangle', 'cross', 'spiral'] },
      orient: { type: 'string', enum: ['auto', 'vertical', 'horizontal', 'angle'] }, keep_outline: { type: 'boolean' },
      ...Object.fromEntries(HINGE_KEYS.map((k) => [k, { type: 'number' }])),
    }, ['ids']),
    run: (ed, a) => {
      const before = snapshotIds(ed);
      ed.setSel(topObjs(ed, ids(a)));
      if (!ed.hingeTargets().length) throw new ToolError('Keine geschlossene Form unter den Objekten (Bilder und Texte zählen nicht)');
      const th = optNum(a, 'thickness', { min: 0.1 });
      const opt: HingeOptions = { ...DEFAULT_HINGE, ...(th ? { thickness: th, ...suggestHinge(th) } : {}) };
      opt.kind = oneOf(a, 'kind', ['straight', 'wave', 'diamond', 'honeycomb', 'triangle', 'cross', 'spiral'] as const, 'straight') as HingeKind;
      opt.orient = oneOf(a, 'orient', ['auto', 'vertical', 'horizontal', 'angle'] as const, 'auto');
      opt.keepOutline = bool(a, 'keep_outline', false);
      for (const k of HINGE_KEYS) {
        const v = optNum(a, k, { min: k === 'angle' ? -360 : 0 });
        if (v !== undefined) opt[k] = v;
      }
      if (!ed.applyHinge(opt)) throw new ToolError(ed.hint);
      return result(ed, before);
    },
  },
  {
    name: 'list_edges',
    title: 'Gerade Kanten auflisten',
    description: 'Gerade Kanten eines Objekts (auch in Gruppen) mit sub/seg-Nummer, Anfang, Ende und Länge, für make_joint.',
    tier: Tier.Read,
    inputSchema: obj({ id: { type: 'integer' } }, ['id']),
    run: (ed, a) => {
      const hit = findObj(ed.doc.objs, num(a, 'id', { int: true }));
      if (!hit) throw new ToolError(`Kein Objekt mit id ${a.id}`);
      const [o, parent] = hit;
      if (o.shape.kind === 'group' || o.shape.kind === 'text' || o.shape.kind === 'image') throw new ToolError(`Objekte vom Typ ${o.shape.kind} haben keine Kanten; Gruppen erst auflösen, Text in Pfad umwandeln`);
      const m = mul(flip(ed), mul(parent, o.m));
      const edges: unknown[] = [];
      shapeSubs(o.shape).forEach((sp: SubPath, sub) =>
        segments(sp).forEach((s, seg) => {
          if (!isStraight(o, sub, seg)) return;
          const p = apply(m, s.a.x, s.a.y), q = apply(m, s.b.x, s.b.y);
          edges.push({ sub, seg, from: [r3(p.x), r3(p.y)], to: [r3(q.x), r3(q.y)], length: r3(Math.hypot(q.x - p.x, q.y - p.y)) });
        }),
      );
      return { id: o.id, edges };
    },
  },
  {
    name: 'make_joint',
    title: 'Holzverbindung',
    description:
      'Verbindung an geraden Kanten (Nummern aus list_edges). edges: erste Kante = Zinken/Zapfen, zweite = Gegenstück bzw. Linie für die Schlitze; eine Kante allein geht auch. kind: finger, tenon, lap, snap, hook, wedge, tslot. thickness = Materialdicke (mm). Weitere Werte wie im Dialog: fingerWidth, direction (in/out), swap, tenonCount, tenonWidth, slotOffset, lapCount, lapDepth, snapLip, snapLength, snapRelief, hookLength, hookFlip, wedgeWidth, wedgePull, boltDia, nutWidth, nutHeight, boltLength, kerf, clearance. Die Objekte werden zu Pfaden.',
    tier: Tier.Edit,
    inputSchema: obj({
      edges: {
        type: 'array', minItems: 1, maxItems: 2,
        items: obj({ id: { type: 'integer' }, sub: { type: 'integer' }, seg: { type: 'integer' } }, ['id', 'sub', 'seg']),
      },
      kind: { type: 'string', enum: ['finger', 'tenon', 'lap', 'snap', 'hook', 'wedge', 'tslot'] },
      direction: { type: 'string', enum: ['in', 'out'] }, swap: { type: 'boolean' }, hookFlip: { type: 'boolean' },
      ...Object.fromEntries(JOINT_NUM_KEYS.map((k) => [k, { type: 'number' }])),
    }, ['edges', 'kind', 'thickness']),
    run: (ed, a) => {
      const before = snapshotIds(ed);
      if (!Array.isArray(a.edges) || !a.edges.length || a.edges.length > 2) throw new ToolError('„edges“ braucht eine oder zwei Kanten');
      const picks: EdgePick[] = a.edges.map((e: Args, i: number) => {
        const hit = findObj(ed.doc.objs, Number(e?.id));
        if (!hit) throw new ToolError(`Kante ${i + 1}: kein Objekt mit id ${e?.id}`);
        const [o, parent] = hit;
        const sub = Number(e.sub), seg = Number(e.seg);
        if (!isStraight(o, sub, seg)) throw new ToolError(`Kante ${i + 1}: sub ${sub}/seg ${seg} ist keine gerade Kante von Objekt ${o.id} (siehe list_edges)`);
        return { obj: o, m: mul(parent, o.m), sub, seg };
      });
      const opt: JointOptions = { ...DEFAULT_JOINT, kind: oneOf(a, 'kind', ['finger', 'tenon', 'lap', 'snap', 'hook', 'wedge', 'tslot'] as const) as JointKind };
      for (const k of JOINT_NUM_KEYS) {
        const v = optNum(a, k);
        if (v !== undefined) opt[k] = v;
      }
      if (a.direction !== undefined) opt.direction = oneOf(a, 'direction', ['in', 'out'] as const);
      opt.swap = bool(a, 'swap', false);
      opt.hookFlip = bool(a, 'hookFlip', false);
      ed.jointPicks = picks;
      if (!ed.applyJoint(opt)) {
        ed.jointPicks = [];
        throw new ToolError(ed.hint);
      }
      return result(ed, before, { changed: [...new Set(picks.map((p) => p.obj.id))] });
    },
  },
  {
    name: 'set_layer',
    title: 'Layer einstellen',
    description: `Ändert die Einstellungen eines Layers. Felder: ${Object.entries(LAYER_KEYS).map(([k, v]) => `${k} (${v})`).join(', ')}. speed in mm/min, power/minPower in %, kerf/interval in mm, angle in Grad, overscan in %.`,
    tier: Tier.Edit,
    inputSchema: obj({
      layer: { ...LAYER, description: 'Layer 0–29' },
      ...Object.fromEntries(Object.entries(LAYER_KEYS).map(([k, v]) => [k, v === 'line|fill' ? { type: 'string', enum: ['line', 'fill'] } : { type: v }])),
    }, ['layer']),
    run: (ed, a) => {
      const i = num(a, 'layer', { min: 0, max: 31, int: true });
      const p: Record<string, unknown> = {};
      if (typeof a.name === 'string') p.name = a.name;
      if (a.output !== undefined) p.output = a.output === true;
      if (a.visible !== undefined) p.show = a.visible === true;
      if (a.locked !== undefined) p.locked = a.locked === true;
      if (a.mode !== undefined) p.mode = oneOf(a, 'mode', ['line', 'fill'] as const);
      const n = (k: string, opt: { min?: number; max?: number; int?: boolean }, as = k) => {
        const v = optNum(a, k, opt);
        if (v !== undefined) p[as] = v;
      };
      n('speed', { min: 1, max: 100000 });
      n('power', { min: 0, max: 100 });
      n('minPower', { min: 0, max: 100 });
      n('passes', { min: 1, max: 100, int: true });
      n('kerf', { min: -5, max: 5 });
      n('interval', { min: 0.01, max: 10 });
      n('angle', { min: -360, max: 360 });
      n('overscan', { min: 0, max: 50 });
      if (a.airAssist !== undefined) p.air = a.airAssist === true;
      if (a.crossHatch !== undefined) p.crossHatch = a.crossHatch === true;
      if (a.bidirectional !== undefined) p.bidirectional = a.bidirectional === true;
      if (!Object.keys(p).length) throw new ToolError('Keine Einstellung angegeben');
      // Eigene Werte lösen den Layer von einem Eintrag der Material-Bibliothek
      if (Object.keys(p).some((k) => !['name', 'output', 'show', 'locked'].includes(k))) p.material = undefined;
      ed.updateLayer(i, p);
      return { layer: i, changed: Object.keys(p).filter((k) => k !== 'material') };
    },
  },
  {
    name: 'apply_material',
    title: 'Material übernehmen',
    description: 'Übernimmt einen Eintrag der Material-Bibliothek (id aus list_materials) auf einen Layer.',
    tier: Tier.Edit,
    inputSchema: obj({ layer: { ...LAYER, description: 'Layer 0–29' }, material_id: { type: 'string' } }, ['layer', 'material_id']),
    run: (ed, a) => {
      const e = library.get(String(a.material_id));
      if (!e) throw new ToolError(`Kein Eintrag mit id ${a.material_id} (siehe list_materials)`);
      const i = num(a, 'layer', { min: 0, max: 31, int: true });
      ed.updateLayer(i, layerPatch(e));
      return { layer: i, material: { id: e.id, material: e.material, thickness: e.thickness, title: e.title } };
    },
  },
  {
    name: 'import_svg',
    title: 'SVG einfügen',
    description:
      'Fügt SVG-Inhalt (Text) ein, z. B. selbst erzeugte Zeichnungen. Einheiten wie im SVG (width/height in mm empfohlen, sonst 96 dpi). Die SVG-Koordinaten zählen von der linken oberen Bettecke; liegt das Ergebnis außerhalb, kommt es in die Bettmitte. Mit x/y wird die linke untere Ecke danach dorthin gesetzt. Farben werden Layern zugeordnet; Text in SVG wird nicht übernommen.',
    tier: Tier.Edit,
    inputSchema: obj({ svg: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, ['svg']),
    run: async (ed, a) => {
      if (typeof a.svg !== 'string' || !a.svg.includes('<svg')) throw new ToolError('„svg“ enthält kein <svg>-Element');
      const before = snapshotIds(ed);
      await ed.importVectors(importSvg(a.svg), 'SVG');
      return placeImported(ed, a, before);
    },
  },
  {
    name: 'import_file',
    title: 'Datei importieren',
    description: 'Importiert eine Datei vom Rechner (SVG, DXF, PNG, JPG, BMP, GIF, WebP) über ihren absoluten Pfad. Mit x/y wird die linke untere Ecke danach dorthin gesetzt.',
    tier: Tier.Edit,
    inputSchema: obj({ path: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, ['path']),
    run: async (ed, a) => {
      const path = String(a.path ?? '');
      if (!isTauri()) throw new ToolError('Nur in der Desktop-App');
      const { invoke } = await import('@tauri-apps/api/core');
      let buf: ArrayBuffer;
      try {
        buf = await invoke<ArrayBuffer>('read_file', { path });
      } catch (e) {
        throw new ToolError(`${path}: ${e}`);
      }
      const before = snapshotIds(ed);
      await importBytesOrThrow(ed, path.split(/[\\/]/).pop() ?? path, new Uint8Array(buf));
      return placeImported(ed, a, before);
    },
  },
  {
    name: 'switch_page',
    title: 'Seite wechseln',
    description: 'Wechselt zur Seite page (1 … n, siehe get_document). Bearbeitet, gelasert und exportiert wird immer die aktuelle Seite. Kein Undo-Schritt.',
    tier: Tier.Edit,
    ownUndo: true,
    inputSchema: obj({ page: { type: 'integer', minimum: 1 } }, ['page']),
    run: (ed, a) => {
      ed.setPage(pageIndex(ed, a, 'page'));
      return { pages: pageList(ed) };
    },
  },
  {
    name: 'edit_pages',
    title: 'Seiten bearbeiten',
    description:
      'Seiten des Projekts verwalten. action: "add" (neue leere Seite hinter der aktuellen, optional name; wechselt dorthin), "duplicate" (Seite page samt Objekten kopieren; wechselt zur Kopie), "delete" (Seite page löschen, die letzte Seite bleibt), "rename" (Seite page heißt name), "reorder" (Seite page an die Stelle to schieben). page: Standard aktuelle Seite. Layer-Einstellungen gelten für alle Seiten.',
    tier: Tier.Edit,
    inputSchema: obj(
      {
        action: { type: 'string', enum: ['add', 'duplicate', 'delete', 'rename', 'reorder'] },
        page: { type: 'integer', minimum: 1 },
        name: { type: 'string' },
        to: { type: 'integer', minimum: 1 },
      },
      ['action'],
    ),
    run: (ed, a) => {
      const action = oneOf(a, 'action', ['add', 'duplicate', 'delete', 'rename', 'reorder'] as const);
      const i = a.page === undefined ? ed.doc.page : pageIndex(ed, a, 'page');
      if (action === 'add') ed.addPage(typeof a.name === 'string' ? a.name : undefined);
      else if (action === 'duplicate') ed.duplicatePage(i);
      else if (action === 'delete') {
        if (ed.doc.pages.length < 2) throw new ToolError('Die einzige Seite lässt sich nicht löschen');
        ed.deletePage(i);
      } else if (action === 'rename') {
        const name = typeof a.name === 'string' ? a.name.trim() : '';
        if (!name) throw new ToolError('„name“ fehlt');
        ed.renamePage(i, name);
      } else ed.movePage(i, pageIndex(ed, a, 'to'));
      return { pages: pageList(ed) };
    },
  },
  {
    name: 'move_to_page',
    title: 'Auf andere Seite verschieben',
    description: 'Verschiebt Objekte der aktuellen Seite (oberste Ebene) auf die Seite page. Lage auf dem Bett und Layer bleiben gleich.',
    tier: Tier.Edit,
    inputSchema: obj({ ids: IDS, page: { type: 'integer', minimum: 1 } }, ['ids', 'page']),
    run: (ed, a) => {
      const objs = topObjs(ed, ids(a));
      const i = pageIndex(ed, a, 'page');
      if (i === ed.doc.page) throw new ToolError('Die Objekte liegen schon auf dieser Seite');
      ed.moveToPage(objs, i);
      return { moved: objs.map((o) => o.id), pages: pageList(ed) };
    },
  },
  {
    name: 'new_document',
    title: 'Neues Dokument',
    description: 'Neues leeres Projekt mit einer Seite (rückgängig machbar mit undo). Layer-Einstellungen werden zurückgesetzt.',
    tier: Tier.Edit,
    ownUndo: true,
    inputSchema: obj({}),
    run: (ed) => {
      ed.newDocument();
      return { ok: true };
    },
  },
  {
    name: 'open_document',
    title: 'Projekt öffnen',
    description: 'Öffnet eine Laserwerk-Projektdatei (.lwk) über ihren absoluten Pfad und ersetzt das Dokument (rückgängig machbar mit undo).',
    tier: Tier.Edit,
    ownUndo: true,
    inputSchema: obj({ path: { type: 'string' } }, ['path']),
    run: async (ed, a) => {
      const path = String(a.path ?? '');
      if (!/\.(lwk|json)$/i.test(path)) throw new ToolError('Nur .lwk-Dateien');
      if (!isTauri()) throw new ToolError('Nur in der Desktop-App');
      const { invoke } = await import('@tauri-apps/api/core');
      let buf: ArrayBuffer;
      try {
        buf = await invoke<ArrayBuffer>('read_file', { path });
      } catch (e) {
        throw new ToolError(`${path}: ${e}`);
      }
      try {
        ed.openDoc(new TextDecoder().decode(buf));
      } catch (e) {
        throw new ToolError((e as Error).message);
      }
      return { objectCount: ed.doc.objs.length, bed: ed.doc.bed, pages: pageList(ed) };
    },
  },
  {
    name: 'save_document',
    title: 'Speichern',
    description: 'Speichert das Projekt (.lwk, samt Bildern) oder eine SVG-Datei (.svg) unter einem absoluten Pfad. Eine vorhandene Datei wird nur mit overwrite überschrieben.',
    tier: Tier.Edit,
    ownUndo: true,
    inputSchema: obj({ path: { type: 'string' }, overwrite: { type: 'boolean' } }, ['path']),
    run: async (ed, a) => {
      const path = String(a.path ?? '');
      const svg = /\.svg$/i.test(path);
      if (!svg && !/\.lwk$/i.test(path)) throw new ToolError('Der Pfad muss auf .lwk oder .svg enden');
      if (!isTauri()) throw new ToolError('Nur in der Desktop-App');
      const { invoke } = await import('@tauri-apps/api/core');
      try {
        await invoke('agent_write_file', { path, contents: svg ? buildSvg(ed) : ed.serialize(), overwrite: bool(a, 'overwrite', false) });
      } catch (e) {
        throw new ToolError(String(e));
      }
      return { saved: path };
    },
  },
  {
    name: 'undo',
    title: 'Rückgängig',
    description: 'Macht den letzten Schritt rückgängig (auch Schritte der Person).',
    tier: Tier.Edit,
    ownUndo: true,
    inputSchema: obj({ steps: { type: 'integer', minimum: 1, maximum: 50 } }),
    run: (ed, a) => {
      const n = num(a, 'steps', { def: 1, min: 1, max: 50, int: true });
      for (let i = 0; i < n; i++) ed.doUndo();
      return { objectCount: ed.doc.objs.length };
    },
  },
  {
    name: 'redo',
    title: 'Wiederholen',
    description: 'Stellt rückgängig gemachte Schritte wieder her.',
    tier: Tier.Edit,
    ownUndo: true,
    inputSchema: obj({ steps: { type: 'integer', minimum: 1, maximum: 50 } }),
    run: (ed, a) => {
      const n = num(a, 'steps', { def: 1, min: 1, max: 50, int: true });
      for (let i = 0; i < n; i++) ed.doRedo();
      return { objectCount: ed.doc.objs.length };
    },
  },
];

/** Nach einem Import: neue Objekte melden und optional an x/y (linke untere Ecke) setzen */
function placeImported(ed: Editor, a: Args, before: Set<number>) {
  const added = ed.doc.objs.filter((o) => !before.has(o.id));
  if (!added.length) throw new ToolError(ed.hint || 'Nichts importiert');
  const x = optNum(a, 'x'), y = optNum(a, 'y');
  if (x !== undefined || y !== undefined) {
    ed.setSel(added);
    ed.setSelBox({ x, y: y === undefined ? undefined : ed.doc.bed.h - y }, 0, 1, false);
  }
  return result(ed, before);
}
