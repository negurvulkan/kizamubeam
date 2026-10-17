// Fenster „3D-Ansicht“: zeigt Baugruppen aus Generatoren (Box, Schublade, Einsatz, Regal, Zahnradpaar)
// zusammengesteckt, markiert Durchdringungen und lässt die Teile auseinanderziehen. Andere Konturen auf
// Schnitt-Layern liegen flach mit der eingestellten Materialdicke dort, wo sie auf der Arbeitsfläche sind.
// Gezeigt wird die Auswahl (eine gewählte Baugruppe immer ganz), ohne Auswahl alles auf der Seite.
import type { Editor } from '../editor';
import type { GenShape, Obj } from '../model';
import { leaves, visibleLeaves } from '../model';
import { boundsOf } from '../geom';
import { region } from '../ops';
import ClipperLib from 'clipper-lib';
import { Path, Paths, SCALE } from '../clip';
import { h } from '../dom';
import { t } from '../i18n';
import { dockWindow, isShown, onWindowShow } from '../dock';
import { objLabel } from '../objectsPanel';
import { genLabel } from '../generators';
import { asmSolids, findOverlaps, Overlap, Solid, solidBounds } from './solids';
import { flatPose, genThickness } from './poses';
import type { Scene3D, Viewer3D, ViewPreset, ViewSolid } from './viewer';

const KEY = 'kizamubeam.view3d';
const fmt = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: d });

interface Settings {
  th: number;
  overlaps: boolean;
}

function loadSettings(): Settings {
  const d: Settings = { th: 3, overlaps: true };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (s.th > 0 && s.th <= 50) d.th = Number(s.th);
    if (typeof s.overlaps === 'boolean') d.overlaps = s.overlaps;
  } catch {
    /* Speicher nicht verfügbar */
  }
  return d;
}

/** Teile für die Ansicht sammeln; liefert auch einen Schlüssel, der sich nur ändert, wenn andere Objekte gezeigt werden */
export function collectScene(ed: Editor, th: number): { scene: Scene3D; key: string; asms: number } {
  const roots = ed.sel.length ? ed.sel : ed.doc.objs.filter((o) => !o.hidden);
  const solids: ViewSolid[] = [];
  const ids: (number | string)[] = [];
  const asmDone = new Set<string>();
  let asms = 0;
  // Flache Konturen je Dicke sammeln: Ineinanderliegende Konturen sind wie beim Lasern Löcher
  const flats = new Map<number, { paths: Paths; names: { label: string; box: number[] }[] }>();
  const flat = (o: Obj, m: Obj['m'], thick: number) => {
    const L = ed.layer(o.layer);
    if (L.mode !== 'line' || o.shape.kind === 'text' || o.shape.kind === 'image') return;
    const paths = region({ ...o, m });
    if (!paths.length) return;
    const f = flats.get(thick) ?? { paths: [], names: [] };
    flats.set(thick, f);
    f.paths.push(...paths);
    f.names.push({ label: o.shape.kind === 'gen' ? genLabel(o.shape) : objLabel(o), box: pathBox(paths) });
    ids.push(o.id);
  };
  // Eine Auswahl zeigt auch ausgeblendete Objekte, die ganze Seite nur sichtbare
  const all = ed.sel.length ? leaves(roots) : visibleLeaves(roots);
  for (const [o, m] of all) {
    const s = o.shape;
    if (s.kind === 'gen' && s.asm) {
      if (asmDone.has(s.asm)) continue;
      const members = ed.asmMembers(s.asm);
      const keys = new Set(members.map((x) => (x.o.shape as GenShape).part ?? 'main'));
      const parts = asmSolids(s.gen, s.params, th, keys);
      if (!parts) {
        // Ohne räumlichen Aufbau (oder mit fehlerhaften Parametern): flach zeigen wie andere Konturen
        flat(o, m, genThickness(s.params, th));
        continue;
      }
      asmDone.add(s.asm);
      asms++;
      placeAssembly(parts, members.map((x) => x.o).filter((x) => onPage(ed, x)));
      for (const p of parts) solids.push({ ...p, key: `${s.asm}:${p.key}`, group: s.asm });
      ids.push(s.asm);
    } else if (s.kind === 'gen') flat(o, m, genThickness(s.params, th));
    else flat(o, m, th);
  }
  let n = 0;
  for (const [thick, f] of flats)
    for (const { outer, holes } of islands(f.paths)) {
      const box = pathBox([outer]);
      // Name des Objekts, dessen Umriss die Insel ist, sonst durchnummeriert
      const named = f.names.find((x) => x.box.every((v, i) => Math.abs(v - box[i]) < 10));
      const polys = [outer, ...holes].map((p) => p.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE })));
      n++;
      solids.push({ key: `f${n}`, label: named?.label ?? t('Teil {n}', { n }), polys, pose: flatPose(), th: thick, group: `f${n}` });
    }
  const overlaps = findOverlaps(solids);
  return { scene: { solids, overlaps }, key: `${th}|${ids.join(',')}`, asms };
}

/** Ausdehnung von Clipper-Pfaden (µm): [x0, y0, x1, y1] */
function pathBox(paths: Paths): number[] {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of paths)
    for (const q of p) {
      b[0] = Math.min(b[0], q.X);
      b[1] = Math.min(b[1], q.Y);
      b[2] = Math.max(b[2], q.X);
      b[3] = Math.max(b[3], q.Y);
    }
  return b;
}

/** Konturen nach Gerade-Ungerade-Regel in zusammenhängende Flächen mit ihren Löchern zerlegen */
function islands(paths: Paths): { outer: Path; holes: Path[] }[] {
  const c = new ClipperLib.Clipper();
  c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(ClipperLib.ClipType.ctUnion, tree, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
  const out: { outer: Path; holes: Path[] }[] = [];
  const walk = (node: ClipperLib.PolyNode) => {
    for (const ch of node.Childs()) {
      if (ch.IsHole()) continue;
      out.push({ outer: ch.Contour(), holes: ch.Childs().map((x) => x.Contour()) });
      for (const hole of ch.Childs()) walk(hole);
    }
  };
  walk(tree);
  return out;
}

const onPage = (ed: Editor, o: Obj) => [...leaves(ed.doc.objs)].some(([l]) => l === o);

/** Baugruppe so legen, dass ihre Mitte unter der Mitte ihrer Teile auf der Arbeitsfläche liegt (Boden auf Z = 0) */
function placeAssembly(parts: Solid[], onCanvas: Obj[]) {
  const b = parts.map(solidBounds);
  const min = [0, 1, 2].map((k) => Math.min(...b.map((x) => x.min[k])));
  const max = [0, 1, 2].map((k) => Math.max(...b.map((x) => x.max[k])));
  const c = boundsOf(onCanvas);
  const tx = c ? c.x + c.w / 2 : 0,
    ty = c ? -(c.y + c.h / 2) : 0;
  const d = [tx - (min[0] + max[0]) / 2, ty - (min[1] + max[1]) / 2, -min[2]];
  for (const p of parts) p.pose = { ...p.pose, o: [p.pose.o[0] + d[0], p.pose.o[1] + d[1], p.pose.o[2] + d[2]] };
}

function overlapText(list: Overlap[], solids: ViewSolid[]): string {
  if (!list.length) return t('Keine Überschneidungen');
  const name = (k: string) => {
    const s = solids.find((x) => x.key === k);
    // Bei Baugruppen nur den Teil nennen („Box …: Boden“ → „Boden“)
    return s ? (s.label.includes(': ') ? s.label.slice(s.label.lastIndexOf(': ') + 2) : s.label) : k;
  };
  const vol = list.reduce((s, o) => s + o.volume, 0);
  const worst = [...list].sort((a, b) => b.volume - a.volume).slice(0, 3);
  return (
    t('Überschneidungen: {n}, zusammen {v} mm³', { n: list.length, v: fmt(vol) }) +
    ': ' +
    worst.map((o) => `${name(o.a)} / ${name(o.b)}`).join(', ') +
    (list.length > 3 ? ' …' : '')
  );
}

export function buildView3dPanel(ed: Editor) {
  const body = dockWindow('view3d', t('3D-Ansicht'), { float: { w: 640, h: 500 } });
  const set = loadSettings();
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(set));
    } catch {
      /* Speicher nicht verfügbar */
    }
  };
  const host = h('div', { class: 'v3d-canvas' });
  const status = h('div', { class: 'v3d-status' });
  const hint = h('div', { class: 'v3d-empty' }, t('Wähle eine Baugruppe (z. B. eine Box) oder Teile aus. Ohne Auswahl zeigt die Ansicht alle Schnitte der Seite.'));
  const explode = h('input', { type: 'range', min: '0', max: '1.5', step: '0.01', value: '0', title: t('Teile auseinanderziehen') }) as HTMLInputElement;
  const spinBox = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const spinLbl = h('label', { class: 'v3d-check', title: t('Zahnräder drehen') }, spinBox, t('Drehen'));
  const ovBox = h('input', { type: 'checkbox', checked: set.overlaps }) as HTMLInputElement;
  const thIn = h('input', { type: 'number', min: '0.3', max: '50', step: '0.1', value: String(set.th), class: 'v3d-th' }) as HTMLInputElement;
  const view = (p: ViewPreset) => viewer?.view(p);
  const bar = h(
    'div',
    { class: 'v3d-bar' },
    h('button', { class: 'small', title: t('Schräg von vorne'), onclick: () => view('iso') }, t('3D')),
    h('button', { class: 'small', title: t('Von oben'), onclick: () => view('top') }, t('Oben|3D')),
    h('button', { class: 'small', title: t('Von vorne'), onclick: () => view('front') }, t('Vorne|3D')),
    h('label', { class: 'v3d-range', title: t('Teile auseinanderziehen') }, t('Explosion'), explode),
    spinLbl,
    h('label', { class: 'v3d-check', title: t('Bereiche, in denen sich Teile durchdringen, rot zeigen') }, ovBox, t('Überschneidungen')),
    h('label', { class: 'v3d-th-lbl', title: t('Für Teile ohne eigene Materialdicke (z. B. Zahnräder und gezeichnete Formen)') }, t('Dicke'), thIn, 'mm'),
  );
  body.append(bar, h('div', { class: 'v3d-stage' }, host, hint), status);

  let viewer: Viewer3D | null = null;
  let loading: Promise<void> | null = null;
  let lastKey = '';
  let info = '';
  let queued = 0;

  const update = () => {
    queued = 0;
    if (!viewer || !isShown('view3d')) return;
    const { scene, key, asms } = collectScene(ed, set.th);
    hint.hidden = scene.solids.length > 0;
    viewer.setScene(scene, key !== lastKey);
    lastKey = key;
    spinLbl.hidden = !scene.solids.some((s) => s.spin);
    if (spinLbl.hidden && spinBox.checked) {
      spinBox.checked = false;
      viewer.setSpin(false);
    }
    const parts = scene.solids.length
      ? t('Teile: {n}', { n: scene.solids.length }) + (asms ? ` (${t('Baugruppen: {n}', { n: asms })})` : '')
      : '';
    info = parts ? `${parts} · ${set.overlaps ? overlapText(scene.overlaps, scene.solids) : ''}` : '';
    status.textContent = info;
    status.classList.toggle('v3d-bad', set.overlaps && scene.overlaps.length > 0);
  };
  const schedule = () => {
    if (!queued) queued = window.setTimeout(update, 150);
  };

  const open = () => {
    if (!loading)
      loading = import('./viewer')
        .then(({ Viewer3D }) => {
          try {
            viewer = new Viewer3D(host);
          } catch (e) {
            hint.hidden = false;
            hint.textContent = t('3D-Darstellung nicht möglich: {msg}', { msg: e instanceof Error ? e.message : String(e) });
            return;
          }
          viewer.onHover = (label) => (status.textContent = label ?? info);
          viewer.isVisible = () => isShown('view3d');
          viewer.setExplode(Number(explode.value));
          viewer.setShowOverlaps(set.overlaps);
          lastKey = '';
          update();
          viewer.setActive(isShown('view3d'));
        })
        .catch((e) => {
          hint.hidden = false;
          hint.textContent = t('3D-Darstellung nicht möglich: {msg}', { msg: String(e) });
        });
    else if (viewer) {
      update();
      viewer.setActive(true);
    }
  };
  onWindowShow('view3d', open);
  explode.addEventListener('input', () => viewer?.setExplode(Number(explode.value)));
  spinBox.addEventListener('change', () => viewer?.setSpin(spinBox.checked));
  ovBox.addEventListener('change', () => {
    set.overlaps = ovBox.checked;
    save();
    viewer?.setShowOverlaps(set.overlaps);
    update();
  });
  thIn.addEventListener('change', () => {
    const v = Number(thIn.value.replace(',', '.'));
    if (v >= 0.3 && v <= 50) set.th = v;
    thIn.value = String(set.th);
    save();
    update();
  });
  ed.on((what) => {
    if (what !== 'doc' && what !== 'sel') return;
    if (isShown('view3d')) schedule();
  });
}
