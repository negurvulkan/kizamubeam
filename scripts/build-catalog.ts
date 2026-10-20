// Katalog der Erweiterungen bauen: prüft alle Pakete in packs/ und schreibt catalog.json samt Paketdateien in den
// Zielordner (beim Veröffentlichen der Website: website/catalog). Signiert wird danach mit sign-catalog.mjs.
// Aufruf: node scripts/run-ts.mjs scripts/build-catalog.ts website/catalog
import './core-fixtures-env';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { buildCatalog } = await import('../src/catalog');
// argv: node, run-ts.mjs, dieses Skript, Zielordner
const out = process.argv[3];
if (!out) throw new Error('Aufruf: node scripts/run-ts.mjs scripts/build-catalog.ts <Zielordner>');
const src = new URL('../packs/', import.meta.url).pathname;
const names = readdirSync(src).filter((f) => f.endsWith('.kzp'));
const json = await buildCatalog(names.map((n) => [n, readFileSync(join(src, n), 'utf8')]), new Date().toISOString());
mkdirSync(out, { recursive: true });
for (const n of names) copyFileSync(join(src, n), join(out, n));
writeFileSync(join(out, 'catalog.json'), json);
console.log(`Katalog mit ${names.length} Paket(en) in ${out}`);
