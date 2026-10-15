// Werkzeuge für KI-Agenten (MCP). Der Rust-Teil (src-tauri/src/agent.rs) nimmt die Aufrufe entgegen, prüft Token
// und Stufe und reicht sie als Ereignis „agent-request“ hierher; hier werden sie mit dem Editor ausgeführt.
// Koordinaten nach außen sind Maschinenkoordinaten wie in der Oberfläche (Ursprung unten links, y nach oben).
import type { Editor } from './editor';
import { boundsOf, Box, shapeSubs, subsToD, textOutline } from './geom';
import { IDENT, layerLabel, Mat, mul, Obj } from './model';
import { library } from './materials';
import { systemFonts } from './fonts';
import { isTauri, machine } from './machine';
import { deviceList, jobInfo } from './laser';

/** Stufen, wie im Rust-Teil: 1 Lesen, 2 Entwerfen, 3 G-Code, 4 Maschine */
export const enum Tier {
  Read = 1,
  Edit = 2,
  GCode = 3,
  Machine = 4,
}

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
type Args = Record<string, unknown>;

interface ToolDef {
  name: string;
  title: string;
  description: string;
  tier: Tier;
  inputSchema: Record<string, unknown>;
  run: (ed: Editor, args: Args) => Promise<Content[] | object> | Content[] | object;
}

/** Fehler, die der Agent als Werkzeugergebnis sieht (statt als Protokollfehler) */
class ToolError extends Error {}

// ---------- Protokoll der Aufrufe ----------

export interface LogEntry {
  time: Date;
  tool: string;
  summary: string;
  ok: boolean;
}
export const agentLog: LogEntry[] = [];
const logListeners = new Set<() => void>();
export const onAgentLog = (f: () => void) => (logListeners.add(f), () => logListeners.delete(f));
function log(e: LogEntry) {
  agentLog.push(e);
  if (agentLog.length > 200) agentLog.shift();
  logListeners.forEach((f) => f());
}

// ---------- Hilfen ----------

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Rahmen in Maschinenkoordinaten (x, y = linke untere Ecke) */
function machineBox(ed: Editor, b: Box | null) {
  if (!b) return null;
  return { x: r3(b.x), y: r3(ed.doc.bed.h - b.y - b.h), w: r3(b.w), h: r3(b.h) };
}

/** Welt (y nach unten) → Maschine (y nach oben) */
const flip = (ed: Editor): Mat => [1, 0, 0, -1, 0, ed.doc.bed.h];

/** Drehung in Grad gegen den Uhrzeigersinn, wie sie in der Oberfläche erscheint */
const rotationOf = (m: Mat) => r3((-Math.atan2(m[1], m[0]) * 180) / Math.PI);

function describe(ed: Editor, o: Obj, parent: Mat, detail: boolean): Record<string, unknown> {
  const m = mul(parent, o.m);
  const s = o.shape;
  const out: Record<string, unknown> = {
    id: o.id,
    type: s.kind,
    layer: o.layer,
    bounds: machineBox(ed, boundsOf([o], parent)),
  };
  const rot = rotationOf(m);
  if (rot) out.rotation = rot;
  // Maße werden nach der Skalierung angegeben, also so groß, wie das Objekt auf dem Bett ist
  const sx = Math.hypot(m[0], m[1]),
    sy = Math.hypot(m[2], m[3]);
  if (Math.abs(sx - 1) > 1e-6 || Math.abs(sy - 1) > 1e-6) out.scale = { x: r3(sx), y: r3(sy) };
  switch (s.kind) {
    case 'rect':
      Object.assign(out, { width: r3(s.w * sx), height: r3(s.h * sy), cornerRadius: r3(s.r * Math.min(sx, sy)) });
      break;
    case 'ellipse':
      Object.assign(out, { rx: r3(s.rx * sx), ry: r3(s.ry * sy) });
      break;
    case 'polygon':
      // Bei ungleichmäßiger Skalierung gilt der Radius vor der Skalierung (siehe scale)
      Object.assign(out, { sides: s.sides, radius: r3(Math.abs(sx - sy) < 1e-6 ? s.r * sx : s.r), star: s.star, ...(s.star ? { innerRatio: s.inner } : {}) });
      break;
    case 'path':
      Object.assign(out, { subpaths: s.subs.length, nodes: s.subs.reduce((n, sp) => n + sp.nodes.length, 0), closed: s.subs.every((sp) => sp.closed) });
      break;
    case 'text':
      Object.assign(out, { text: s.text, font: s.font, size: r3(s.size * sy), bold: s.bold, italic: s.italic, align: s.align });
      break;
    case 'image':
      Object.assign(out, { name: s.name ?? null, pixels: `${s.pxW}×${s.pxH}` });
      break;
    case 'group':
      out.children = s.children.map((c) => describe(ed, c, m, detail));
      break;
  }
  if (detail && s.kind !== 'group' && s.kind !== 'image') {
    const subs = s.kind === 'text' ? textOutline(s)?.subs ?? null : shapeSubs(s);
    // Umriss als SVG-Pfad in Maschinenkoordinaten
    if (subs) out.svgPath = subsToD(subs, mul(flip(ed), m));
  }
  return out;
}

function findObj(objs: Obj[], id: number, parent: Mat = IDENT): [Obj, Mat] | null {
  for (const o of objs) {
    if (o.id === id) return [o, parent];
    if (o.shape.kind === 'group') {
      const r = findObj(o.shape.children, id, mul(parent, o.m));
      if (r) return r;
    }
  }
  return null;
}

function layerInfo(ed: Editor, i: number) {
  const L = ed.layer(i);
  const parts = ed.layerParts(i);
  const out: Record<string, unknown> = {
    index: i,
    label: layerLabel(i),
    name: L.name,
    color: ed.layerDrawColor(i),
    output: L.output,
    visible: L.show,
    contains: [parts.vec && 'vectors', parts.img && 'images'].filter(Boolean),
    mode: L.mode,
    speed: L.speed,
    power: L.power,
    minPower: L.minPower,
    passes: L.passes,
    airAssist: L.air,
  };
  if (L.mode === 'line') {
    out.kerf = L.kerf;
    out.tabs = L.tabs.enabled ? L.tabs : false;
  } else {
    Object.assign(out, { interval: L.interval, angle: L.angle, crossHatch: L.crossHatch, bidirectional: L.bidirectional, overscan: L.overscan });
  }
  if (parts.img) out.image = ed.imgLayer(i);
  if (L.material) {
    const e = library.get(L.material);
    if (e) out.material = { id: e.id, material: e.material, thickness: e.thickness, title: e.title };
  }
  return out;
}

const json = (v: unknown): Content[] => [{ type: 'text', text: JSON.stringify(v, null, 1) }];

// ---------- Werkzeuge ----------

const TOOLS: ToolDef[] = [
  {
    name: 'get_document',
    title: 'Dokument lesen',
    description:
      'Überblick über das geöffnete Dokument: Bettgröße, alle Objekte (id, Typ, Layer, Rahmen in mm, Drehung, Text usw.), die Auswahl der Person und die benutzten Layer mit ihren Laser-Einstellungen. Rahmen: x/y = linke untere Ecke in Maschinenkoordinaten.',
    tier: Tier.Read,
    inputSchema: {
      type: 'object',
      properties: { include_paths: { type: 'boolean', description: 'Umrisse jedes Objekts als SVG-Pfad mitliefern (kann groß werden). Standard: false.' } },
    },
    run: (ed, a) => {
      const detail = a.include_paths === true;
      return json({
        units: 'mm',
        coordinates: 'machine: origin bottom-left, x right, y up',
        bed: ed.doc.bed,
        bounds: machineBox(ed, boundsOf(ed.doc.objs)),
        objectCount: ed.doc.objs.length,
        objects: ed.doc.objs.map((o) => describe(ed, o, IDENT, detail)),
        selection: ed.sel.map((o) => o.id),
        layers: ed.usedLayers().map((i) => layerInfo(ed, i)),
      });
    },
  },
  {
    name: 'get_object',
    title: 'Objekt lesen',
    description: 'Ein Objekt (auch innerhalb von Gruppen) mit allen Angaben und seinem Umriss als SVG-Pfad in Maschinenkoordinaten (mm).',
    tier: Tier.Read,
    inputSchema: { type: 'object', properties: { id: { type: 'integer', description: 'Objekt-id aus get_document' } }, required: ['id'] },
    run: (ed, a) => {
      const hit = findObj(ed.doc.objs, Number(a.id));
      if (!hit) throw new ToolError(`Kein Objekt mit id ${a.id}`);
      return json(describe(ed, hit[0], hit[1], true));
    },
  },
  {
    name: 'list_layers',
    title: 'Layer auflisten',
    description: 'Laser-Einstellungen der Layer (Modus Linie/Füllen, Geschwindigkeit mm/min, Leistung %, Durchgänge, Kerf, Haltestege, Air Assist, Bild-Einstellungen, Material). Standard: nur benutzte Layer.',
    tier: Tier.Read,
    inputSchema: { type: 'object', properties: { all: { type: 'boolean', description: 'Alle 30 Farb-Layer statt nur der benutzten' } } },
    run: (ed, a) => {
      const idx = a.all === true ? Array.from({ length: 30 }, (_, i) => i) : ed.usedLayers();
      return json(idx.map((i) => layerInfo(ed, i)));
    },
  },
  {
    name: 'list_materials',
    title: 'Material-Bibliothek lesen',
    description: 'Einträge der Material-Bibliothek: Material, Dicke (mm), Titel (z. B. Schneiden, Gravieren) und die Layer-Einstellungen.',
    tier: Tier.Read,
    inputSchema: { type: 'object', properties: { material: { type: 'string', description: 'Nur Einträge, deren Material diesen Text enthält' } } },
    run: (_ed, a) => {
      const q = typeof a.material === 'string' ? a.material.toLowerCase() : '';
      return json(library.entries.filter((e) => !q || e.material.toLowerCase().includes(q)));
    },
  },
  {
    name: 'list_devices',
    title: 'Geräte auflisten',
    description: 'Eingerichtete Lasergeräte (Name, Firmware, Arbeitsbereich, Startposition, Job-Ursprung) und welches gewählt ist.',
    tier: Tier.Read,
    inputSchema: { type: 'object', properties: {} },
    run: () => {
      const { devices, current } = deviceList();
      return json({
        current,
        devices: devices.map((d) => ({
          id: d.id, name: d.name, firmware: d.fw, bed: { w: d.bedW, h: d.bedH }, connection: d.conn,
          startFrom: d.startFrom, jobOrigin: d.jobOrigin, cutSelectedOnly: d.cutSelected, airAssistCommand: d.airCmd,
        })),
      });
    },
  },
  {
    name: 'list_fonts',
    title: 'Schriften auflisten',
    description: 'Auf dem Rechner installierte Schriftfamilien (für Text).',
    tier: Tier.Read,
    inputSchema: { type: 'object', properties: { contains: { type: 'string', description: 'Nur Namen, die diesen Text enthalten' } } },
    run: async (_ed, a) => {
      const all = (await systemFonts()) ?? [];
      const q = typeof a.contains === 'string' ? a.contains.toLowerCase() : '';
      return json(all.filter((f) => !q || f.toLowerCase().includes(q)));
    },
  },
  {
    name: 'render_preview',
    title: 'Arbeitsfläche als Bild',
    description:
      'PNG der Arbeitsfläche mit Linealen in mm, so wie die Person sie sieht (Farben = Layer). Bereich: ganzes Bett, alle Objekte oder die Auswahl.',
    tier: Tier.Read,
    inputSchema: {
      type: 'object',
      properties: {
        area: { type: 'string', enum: ['bed', 'objects', 'selection'], description: 'Standard: bed' },
        size: { type: 'integer', minimum: 200, maximum: 2048, description: 'Längere Bildseite in Pixeln, Standard 1024' },
      },
    },
    run: (ed, a) => {
      const area = (a.area as string) || 'bed';
      const size = Math.max(200, Math.min(2048, Math.round(Number(a.size) || 1024)));
      let box: Box | null = { x: 0, y: 0, w: ed.doc.bed.w, h: ed.doc.bed.h };
      if (area === 'objects') box = boundsOf(ed.doc.objs);
      else if (area === 'selection') box = ed.selBounds();
      if (!box) throw new ToolError(area === 'selection' ? 'Nichts ausgewählt' : 'Das Dokument ist leer');
      const m = Math.max(box.w, box.h) * 0.04 + 1;
      if (area !== 'bed') box = { x: box.x - m, y: box.y - m, w: box.w + 2 * m, h: box.h + 2 * m };
      const url = ed.renderImage(box, size);
      return [{ type: 'image', data: url.slice(url.indexOf(',') + 1), mimeType: 'image/png' }];
    },
  },
  {
    name: 'estimate_job',
    title: 'Job abschätzen',
    description: 'Schätzt den Laser-Job des Dokuments mit dem gewählten Gerät: Dauer, Laserweg, Leerweg, Bereich auf dem Bett, Warnungen. Sendet nichts an die Maschine.',
    tier: Tier.Read,
    inputSchema: { type: 'object', properties: {} },
    run: async (ed) => {
      const { job, est, device } = await jobInfo(ed);
      if (!est) return json({ empty: true, note: device.cutSelected ? 'Nur Auswahl lasern ist an, und die Auswahl ist leer.' : 'Keine Objekte auf Layern mit Ausgabe.' });
      const b = job.bounds!;
      const bed = ed.doc.bed;
      const tb = job.travel;
      return json({
        device: device.name,
        durationSeconds: Math.round(est.total),
        laserPathMeters: r3(est.cutLength / 1000),
        travelMeters: r3(est.rapidLength / 1000),
        area: { x: r3(b.x0), y: r3(b.y0), w: r3(b.x1 - b.x0), h: r3(b.y1 - b.y0) },
        insideBed: !tb || device.startFrom === 'user' || (tb.x0 >= -0.01 && tb.y0 >= -0.01 && tb.x1 <= bed.w + 0.01 && tb.y1 <= bed.h + 0.01),
        startFrom: device.startFrom,
        cutSelectedOnly: device.cutSelected,
        airAssistLayers: job.air,
        warnings: job.warnings,
      });
    },
  },
  {
    name: 'machine_status',
    title: 'Maschinenstatus',
    description: 'Ob ein Laser verbunden ist, sein Zustand (Idle, Run, Hold, Alarm …), Position und ob gerade ein Job läuft. Nur lesend.',
    tier: Tier.Read,
    inputSchema: { type: 'object', properties: {} },
    run: () => {
      const st = machine.status;
      const p = machine.progress;
      return json({
        connected: machine.connected,
        where: machine.where || null,
        state: st.state || null,
        workPosition: st.wpos,
        machinePosition: st.mpos,
        jobRunning: machine.busy,
        progress: p ? { acked: p.acked, total: p.total, errors: p.errors } : null,
        remainingSeconds: machine.remaining(),
      });
    },
  },
];

// ---------- Anbindung an den Rust-Teil ----------

interface RpcRequest {
  id: number;
  method: string;
  params: { name?: string; arguments?: Args };
}

function summarize(args: Args): string {
  const s = JSON.stringify(args ?? {});
  return s === '{}' ? '' : s.length > 120 ? s.slice(0, 117) + '…' : s;
}

async function handle(ed: Editor, req: RpcRequest): Promise<object> {
  if (req.method === 'tools/list') {
    return {
      result: {
        tools: TOOLS.map((d) => ({
          name: d.name,
          title: d.title,
          description: d.description,
          inputSchema: d.inputSchema,
          annotations: { title: d.title, readOnlyHint: d.tier === Tier.Read, destructiveHint: false, openWorldHint: false },
          _tier: d.tier,
        })),
      },
    };
  }
  if (req.method === 'tools/call') {
    const name = req.params.name ?? '';
    const args = req.params.arguments ?? {};
    const def = TOOLS.find((d) => d.name === name);
    if (!def) return { error: { code: -32602, message: `Unbekanntes Werkzeug: ${name}` } };
    try {
      const r = await def.run(ed, args);
      log({ time: new Date(), tool: name, summary: summarize(args), ok: true });
      return { result: { content: Array.isArray(r) ? r : json(r) } };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log({ time: new Date(), tool: name, summary: `${summarize(args)} → ${msg}`, ok: false });
      return { result: { content: [{ type: 'text', text: msg }], isError: true } };
    }
  }
  return { error: { code: -32601, message: `Method not found: ${req.method}` } };
}

/** Beim Start der Oberfläche: Aufrufe des Agenten-Servers annehmen */
export async function startAgentBridge(ed: Editor) {
  if (!isTauri()) return;
  const { listen } = await import('@tauri-apps/api/event');
  const { invoke } = await import('@tauri-apps/api/core');
  await listen<RpcRequest>('agent-request', async (e) => {
    let response: object;
    try {
      response = await handle(ed, e.payload);
    } catch (err) {
      response = { error: { code: -32603, message: String(err) } };
    }
    await invoke('agent_respond', { id: e.payload.id, response });
  });
}

/** Für die Einstellungsseite: Namen und Stufen aller Werkzeuge */
export const toolOverview = () => TOOLS.map((d) => ({ name: d.name, title: d.title, tier: d.tier }));
