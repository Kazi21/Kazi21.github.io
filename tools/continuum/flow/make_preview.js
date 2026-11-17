#!/usr/bin/env node
/* Writes assets/figures/flow-comparison-preview.png (1200 × 1200), the home-page card image of the flow benchmark,
   by rendering tools/continuum/flow/preview.html, which draws from lab/continuum/flow/core.js and cases.json.
   Usage: serve the repository root, then node tools/continuum/flow/make_preview.js [base URL] */
'use strict';
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = (process.argv[2] || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
const EXE = process.env.CHROMIUM || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT = path.resolve(__dirname, '../../../assets/figures/flow-comparison-preview.png');
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const p = await (await b.newContext({ viewport: { width: 1200, height: 1200 }, deviceScaleFactor: 1 })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + 'tools/continuum/flow/preview.html', { waitUntil: 'networkidle' });
  await p.waitForSelector('body[data-ready="1"]', { timeout: 15000 });
  await (await p.$('#c')).screenshot({ path: OUT });
  await b.close();
  if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
  console.log('wrote ' + path.relative(path.resolve(__dirname, '../../..'), OUT));
})().catch((e) => { console.error(e); process.exit(1); });
