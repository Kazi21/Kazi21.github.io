#!/usr/bin/env node
// Run times of the ion experiment in headless Chromium (a release record, not an acceptance test).
// Usage: PLAYWRIGHT=<playwright or playwright-core> [CHROMIUM=<browser binary>] node tools/continuum/ions/bench_ions.js <base url> [runs per target, default 3]
// For each grid-convergence target: a fresh page load at 1440 x 1000 px, the target selected, Run experiment clicked; in the page, the time from the
// click to the first displayed current and to the end of the run (decision record available). Medians over the runs.
// Writes tools/continuum/results/benchmark_ions.json, which build_ions_page.js quotes on the page.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const base = process.argv[2] || 'http://127.0.0.1:8765/';
const N = Math.max(1, Number(process.argv[3] || 3));
const OUT = path.join(__dirname, '..', 'results', 'benchmark_ions.json');
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function once(b, target) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(base + 'lab/continuum/', { waitUntil: 'load' });
  await p.selectOption('#ion-target', target);
  const t = await p.evaluate(() => new Promise((resolve, reject) => {
    const root = document.getElementById('ion-lab');
    const I = document.getElementById('ion-I');
    const btn = document.querySelector('.ion-dl-decision');
    let first = null;
    const t0 = performance.now();
    const check = () => {
      const now = performance.now() - t0;
      if (first === null && /pA/.test(I.textContent)) first = now;
      if (first !== null && !btn.disabled) { obs.disconnect(); clearTimeout(timer); resolve({ first_ms: first, total_ms: now }); }
    };
    const obs = new MutationObserver(check);
    obs.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
    const timer = setTimeout(() => { obs.disconnect(); reject(new Error('run did not finish within 300 s')); }, 300000);
    document.querySelector('.ion-run').click();
  }));
  t.status = (await p.textContent('#ion-ctrl-chip')).trim();
  t.levels = await p.$$eval('#ion-ctrl table tbody tr', (r) => r.length);
  t.page_errors = errors.length;
  await ctx.close();
  return t;
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const rows = [];
  for (const [target, label] of [['standard', '0.5 %'], ['fine', '0.1 %']]) {
    const samples = [];
    for (let k = 0; k < N; k++) samples.push(await once(b, target));
    rows.push({
      target, label,
      first_result_s: +(median(samples.map((s) => s.first_ms)) / 1000).toFixed(3),
      whole_run_s: +(median(samples.map((s) => s.total_ms)) / 1000).toFixed(3),
      status: samples.map((s) => s.status), grid_levels_solved: samples.map((s) => s.levels), page_errors: samples.reduce((a, s) => a + s.page_errors, 0),
      samples_s: samples.map((s) => ({ first: +(s.first_ms / 1000).toFixed(3), whole: +(s.total_ms / 1000).toFixed(3) })),
    });
    console.log(target, JSON.stringify(rows[rows.length - 1]));
  }
  const cpu = os.cpus();
  const rec = {
    id: 'benchmark_ions',
    chromium: b.version(),
    cpu: cpu[0].model.replace(/\s+/g, ' ').trim(),
    cores: cpu.length,
    date: new Date().toISOString(),
    method: 'default experiment ((7,7), step 6, +100 mV, 0.100 M); each run on a fresh page load from a local static server, 1440 x 1000 px, headless Chromium with software WebGL (SwiftShader); time from the click on Run experiment to the first displayed current and to the end of the run (decision record available); median of ' + N + ' runs per target',
    rows,
  };
  fs.writeFileSync(OUT, JSON.stringify(rec, null, 1) + '\n');
  console.log('wrote', path.relative(process.cwd(), OUT));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
