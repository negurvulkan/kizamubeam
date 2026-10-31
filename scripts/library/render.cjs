// Übersicht als PNG: node scripts/library/render.mjs in.html out.png
const { chromium } = require('playwright');
(async () => { const [, , inp, out] = process.argv;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
await p.goto('file://' + inp);
await p.screenshot({ path: out, fullPage: true });
await b.close(); })();
