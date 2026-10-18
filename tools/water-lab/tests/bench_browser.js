// Benchmark: the page in headless Chromium. Simulation throughput (worker) is measured separately from the display
// frame rate (requestAnimationFrame on the page). Pace "fast"; 20 s per molecule count.
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const { chromium } = require('playwright');
const BASE = (process.argv[2] || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
const EXE = process.env.CHROMIUM || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const out = { browser: 'Chromium ' + browser.version() + ' (headless shell)', cpu: os.cpus()[0].model, cores: os.cpus().length, viewport: '1440x1000, DPR 1', pace: 'fast', results: [] };
  for (const N of [216, 256, 343, 512]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const p = await ctx.newPage();
    await p.goto(BASE + 'lab/water/?test=1', { waitUntil: 'networkidle' });
    await p.click('#wl-display summary');
    await p.selectOption('#wl-pace', 'fast');
    if (N !== 216) {
      await p.click('#wl-conditions summary');
      await p.selectOption('#wl-molecules', String(N));
    }
    await p.click('.wl-start-big');
    await p.waitForFunction(() => window.__waterLab && window.__waterLab.ready && window.__waterLab.snap, null, { timeout: 90000 });
    if (N !== 216) {
      const r = await p.evaluate(() => window.__waterLab.runId);
      await p.click('.wl-apply');
      await p.waitForFunction((rr) => window.__waterLab.ready && window.__waterLab.runId !== rr && window.__waterLab.snap, r, { timeout: 90000 });
    }
    await p.waitForTimeout(3000);
    const r = await p.evaluate(async () => {
      const L = window.__waterLab, s0 = L.snap.step, t0 = performance.now();
      let frames = 0, run = true;
      const f = () => { frames++; if (run) requestAnimationFrame(f); };
      requestAnimationFrame(f);
      await new Promise((res) => setTimeout(res, 20000));
      run = false;
      const dt = (performance.now() - t0) / 1000;
      return { steps: L.snap.step - s0, seconds: dt, fps: frames / dt, natoms: L.natoms() };
    });
    out.results.push({ molecules: N, atoms: r.natoms, duration_s: r.seconds, steps: r.steps, steps_per_s: r.steps / r.seconds, ps_per_s: r.steps / r.seconds / 1000, display_fps: r.fps });
    console.log(`browser ${N}: ${(r.steps / r.seconds).toFixed(0)} steps/s (${(r.steps / r.seconds / 1000).toFixed(3)} ps/s), display ${r.fps.toFixed(1)} fps`);
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.resolve(__dirname, '../results/bench_browser.json'), JSON.stringify(out, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
