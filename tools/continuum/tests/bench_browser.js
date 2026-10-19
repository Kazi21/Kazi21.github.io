// Solve-time benchmark of the Continuum Lab in Chromium (the page's own worker), for the validation section.
// Usage: node bench_browser.js [base URL]. Writes tools/continuum/results/benchmark.json. Reports measurements only.
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = (process.argv[2] || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
const EXE = process.env.CHROMIUM || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const ROOT = path.resolve(__dirname, '../../..');

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(BASE + 'lab/continuum/', { waitUntil: 'networkidle' });
  const conv = () => p.waitForFunction(() => { const S = window.__continuumState; return S && S.status === 'converged' && S.result && S.result.revision === S.revision; }, null, { timeout: 600000 });
  const take = (label) => p.evaluate((l) => { const r = window.__continuumState.result; return { case: l, cells: r.device.nx + ' × ' + r.device.ny + ' × ' + r.device.nz, unknowns: r.solver.unknowns, iterations: r.solver.iterations, mode: r.mode, worker_s: r.solver.wallMs / 1000, roundTrip_s: r.receivedMs / 1000, Q: r.diag.Q_m3_s }; }, label);
  const rows = [];
  await p.click('.cl-poster-run'); await conv(); rows.push(await take('2 µm × 2 µm, standard mesh (first solve)'));
  await p.click('.cl-block'); await conv(); rows.push(await take('same device, one patch closed (change solve)'));
  await p.click('.cl-restore-all'); await conv();
  await p.evaluate(() => { document.querySelector('.cl-settings').open = true; });   // mesh choice sits in the Settings panel
  await p.selectOption('#cl-mesh', 'fine'); await conv(); rows.push(await take('2 µm × 2 µm, fine mesh'));
  await p.selectOption('#cl-mesh', 'std'); await conv();
  await p.selectOption('#cl-W', '1000'); await p.selectOption('#cl-B', '1000'); await conv(); rows.push(await take('1 mm × 1 mm (10¹⁰ pores), standard mesh'));
  await p.selectOption('#cl-W', '20'); await p.selectOption('#cl-B', '5'); await conv(); rows.push(await take('20 µm × 5 µm (aspect 4), standard mesh'));
  const version = browser.version();
  await browser.close();
  const out = { id: 'benchmark', chromium: version, cpu: os.cpus()[0].model, cores: os.cpus().length, date: new Date().toISOString(), rows,
    note: 'Wall times measured in the page worker of headless Chromium on the build machine; your device will differ.' };
  fs.writeFileSync(path.join(ROOT, 'tools/continuum/results/benchmark.json'), JSON.stringify(out, null, 1) + '\n');
  rows.forEach((r) => console.log(r.case + ': ' + r.cells + ', ' + r.unknowns + ' unknowns, ' + r.iterations + ' iterations, worker ' + r.worker_s.toFixed(2) + ' s, round trip ' + r.roundTrip_s.toFixed(2) + ' s (' + r.mode + ')'));
})().catch((e) => { console.error(e); process.exit(1); });
