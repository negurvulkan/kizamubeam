// Mitgelieferte Bibliothek bauen: zeichnet alle Motive und Designelemente aus scripts/library/*.ts und schreibt
// src/library/builtin.json (Pfade als kompakte SVG-Pfaddaten in mm). Mit --sheet DATEI.html zusätzlich eine
// Übersicht aller Einträge zum Prüfen. Aufruf: npm run build:library [-- --sheet /tmp/sheet.html]
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { finish } from './library/kit';
import { MOTIFS } from './library/motifs';
import { ELEMENTS } from './library/elements';
import { encodeSubs, GROUPS } from '../src/builtinFormat';
import type { Def } from './library/defs';

const args = process.argv.slice(2);
const sheetAt = args.indexOf('--sheet');
const only = args.indexOf('--only');
const filter = only >= 0 ? args[only + 1] : '';

const all: Def[] = [...MOTIFS, ...ELEMENTS];
const ids = new Set<string>();
const items: unknown[] = [];
const sheet: string[] = [];
let problems = 0;
for (const d of all) {
  if (ids.has(d.id)) throw new Error(`Doppelte Kennung ${d.id}`);
  ids.add(d.id);
  if (!GROUPS[d.group]) throw new Error(`${d.id}: unbekannte Gruppe ${d.group}`);
  if (filter && !filter.split(',').some((x) => d.id === x || d.group === x || (x.endsWith('*') && d.id.startsWith(x.slice(0, -1))))) continue;
  let r;
  try {
    r = finish(d.draw(), d.size ?? (d.cat === 'motif' ? 60 : 80));
  } catch (e) {
    console.log(`FEHLER ${d.id}: ${(e as Error).message}`);
    problems++;
    continue;
  }
  if (!r.subs.length || !isFinite(r.w)) {
    console.log(`LEER ${d.id}`);
    problems++;
    continue;
  }
  const dstr = encodeSubs(r.subs);
  const tags = (d.tags ?? []).map(([de, en]) => (de === en ? de : [de, en]));
  items.push({ id: d.id, c: d.cat === 'motif' ? 'm' : 'e', g: d.group, n: [d.de, d.en], ...(tags.length ? { t: tags } : {}), w: +r.w.toFixed(2), h: +r.h.toFixed(2), d: dstr });
  const vb = `${-1} ${-1} ${(r.w + 2).toFixed(1)} ${(r.h + 2).toFixed(1)}`;
  sheet.push(
    `<figure><svg viewBox="${vb}"><path d="${dstr}" fill="#222" fill-rule="evenodd"/></svg><figcaption>${d.id}<br>${d.de} · ${r.w.toFixed(0)}×${r.h.toFixed(0)}</figcaption></figure>`,
  );
}

if (!filter) {
  const out = resolve('src/library/builtin.json');
  const json = JSON.stringify({ v: 1, items });
  writeFileSync(out, json + '\n');
  const motifs = MOTIFS.length,
    elements = ELEMENTS.length;
  console.log(`${items.length} Einträge (${motifs} Motive, ${elements} Designelemente), ${(json.length / 1024).toFixed(0)} KB → ${out}`);
}
if (sheetAt >= 0) {
  const file = args[sheetAt + 1];
  writeFileSync(
    file,
    `<!doctype html><meta charset="utf-8"><style>body{font:11px sans-serif;margin:8px;display:grid;grid-template-columns:repeat(10,1fr);gap:6px;background:#fff}
figure{margin:0;border:1px solid #ddd;padding:4px;text-align:center}svg{width:100%;height:110px}figcaption{overflow:hidden;white-space:nowrap}</style>${sheet.join('')}`,
  );
  console.log(`Übersicht: ${file}`);
}
if (problems) process.exitCode = 1;
