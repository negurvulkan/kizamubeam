// Ein TypeScript-Skript mit esbuild bündeln und in Node ausführen: node scripts/run-ts.mjs scripts/gcode-test.ts
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const entry = process.argv[2];
if (!entry) throw new Error('Aufruf: node scripts/run-ts.mjs <datei.ts>');
const dir = mkdtempSync(join(tmpdir(), 'laserwerk-'));
const out = join(dir, 'run.mjs');
await build({
  entryPoints: [resolve(entry)],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  loader: { '.woff': 'empty', '.woff2': 'empty' },
  define: { 'import.meta.url': JSON.stringify(pathToFileURL(resolve(entry)).href) },
  logLevel: 'error',
});
try {
  await import(pathToFileURL(out).href);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
