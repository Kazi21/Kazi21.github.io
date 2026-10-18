// Demonstration of the complete visitor path on the real page (headless Chromium):
// open lab -> start -> pause/resume -> Try a gentle pull (automatic release) -> manual drag pull -> release -> measurements
// -> change temperature/pressure (conditions experiment) -> export reproducible files -> reset.
// Usage: node demo_path.js <base URL> <output dir>. Saves step screenshots, the exported zip and demo_path.json.
'use strict';
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const BASE = (process.argv[2] || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
const OUT = path.resolve(process.argv[3] || 'demo_out');
const EXE = process.env.CHROMIUM || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const note = (step, detail) => { log.push({ step, detail }); console.log(step + ': ' + JSON.stringify(detail)); };
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const snap = () => p.evaluate(() => { const s = window.__waterLab.snap; return s && { t_ps: +s.time_ps.toFixed(3), state: s.phase, ensemble: s.ensemble, T: +s.T.toFixed(1), P_bar: +s.P_bar.toFixed(0),
    sel: s.sel, pulling: s.pulling, k_N_m: +(s.k * 0.69477).toFixed(3), tether_pN: +(Math.hypot(...s.Ftether) * 69.477).toFixed(0), interaction_pN: +(Math.hypot(...s.Fint) * 69.477).toFixed(0),
    handle_to_com_nm: s.pulling ? +(Math.hypot(s.X[0] - s.R[0], s.X[1] - s.R[1], s.X[2] - s.R[2]) / 10).toFixed(3) : null,
    request_to_com_nm: s.Xreq ? +(Math.hypot(s.Xreq[0] - s.R[0], s.Xreq[1] - s.R[1], s.Xreq[2] - s.R[2]) / 10).toFixed(3) : null,
    Wprot_kJ_mol: +(s.Wprot * 4.184).toFixed(2), Wdel_kJ_mol: +(s.Wdel * 4.184).toFixed(2) }; });
  const shot = async (name) => { await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()); await p.locator('.wl-app').screenshot({ path: path.join(OUT, name) }); };
  const k = async (idx) => p.$eval('#wl-k', (e, i) => { e.value = String(i); e.dispatchEvent(new Event('input', { bubbles: true })); }, idx);
  async function drag(dxCss, steps) {
    const sel = await p.evaluate(() => window.__waterLab.state.sel);
    const a = await p.evaluate((m) => window.__waterLab.screenOf(m), sel);
    await p.mouse.move(a.x, a.y); await p.mouse.down();
    for (let i = 1; i <= steps; i++) { await p.mouse.move(a.x + dxCss * i / steps, a.y); await p.waitForTimeout(40); }
    await p.mouse.up();
  }

  const stepNow = () => p.evaluate(() => (window.__waterLab.snap ? window.__waterLab.snap.step : -1));
  await p.goto(BASE + 'lab/water/?test=1', { waitUntil: 'networkidle' });
  await p.addStyleTag({ content: '.site-header{position:static !important} .wl-stage{position:static !important}' });
  await shot('1-open.png'); note('1 open lab', { engine_requests_before_start: 0 });

  await p.click('.wl-start-big');
  await p.waitForFunction(() => window.__waterLab && window.__waterLab.ready && window.__waterLab.snap, null, { timeout: 90000 });
  await p.waitForTimeout(2500);
  await shot('2-start.png'); note('2 start', await snap());

  await p.click('.wl-pause'); await p.waitForTimeout(600);
  const s0 = await stepNow(); await p.waitForTimeout(1500); const s1 = await stepNow();
  await p.click('.wl-pause'); await p.waitForTimeout(1500); const s2 = await stepNow();
  note('3 pause and resume', { paused_step: s0, after_1_5_s: s1, resumed_step: s2, ok: s0 === s1 && s2 > s1 });

  await p.click('.wl-demo');                        // "Try a gentle pull": 0.695 N/m, handle 0.25 nm over 1 ps, hold 1 ps, release
  await p.waitForFunction(() => window.__waterLab.snap.pulling, null, { timeout: 15000 });
  await p.waitForFunction(() => { const s = window.__waterLab.snap; return s.pulling && Math.hypot(s.X[0] - s.R[0], s.X[1] - s.R[1], s.X[2] - s.R[2]) > 1.0; }, null, { timeout: 30000 }).catch(() => {});
  await shot('4-gentle-pull.png'); note('4 gentle pull (Try a gentle pull, k = 0.695 N/m)', await snap());
  await p.waitForFunction(() => window.__waterLab.events.some((e) => e.type === 'release'), null, { timeout: 60000 });
  await p.waitForTimeout(1500);
  await shot('5-release.png'); note('5 automatic release and relaxation', await snap());

  await p.click('.wl-select-central');
  await p.waitForTimeout(800);
  await k(4);                                       // firm: 6.95 N/m, drag past the 0.3 nm bound
  await drag(110, 16);
  await p.waitForTimeout(2200);
  await shot('6-stronger-pull.png'); note('6 manual pull by dragging (k = 6.95 N/m; handle reset to within 0.3 nm at each command update)', await snap());
  await p.click('.wl-release');
  await p.waitForTimeout(2000);
  note('7 release button', await snap());

  await p.click('#wl-all-measurements summary');
  await p.locator('#measurements').scrollIntoViewIfNeeded();
  await p.waitForTimeout(1500);
  await p.locator('#measurements').screenshot({ path: path.join(OUT, '8-measurements.png') });
  note('8 inspect measurements', await p.evaluate(() => [...document.querySelectorAll('#wl-table tbody tr')].map((r) => r.innerText.replace(/\s+/g, ' ').trim())));

  await p.click('#wl-conditions summary');
  await p.fill('#wl-T', '330'); await p.fill('#wl-P', '500');
  await p.click('.wl-apply');
  await p.waitForTimeout(3500);
  await shot('9-conditions.png'); note('9 change conditions (330 K, 500 bar, NPT)', await snap());

  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click('.wl-download-panel')]);
  const zipPath = path.join(OUT, await dl.suggestedFilename());
  await dl.saveAs(zipPath);
  note('10 export (panel button)', { file: path.basename(zipPath), bytes: fs.statSync(zipPath).size, events: await p.evaluate(() => window.__waterLab.events.map((e) => e.type)) });

  const run0 = await p.evaluate(() => window.__waterLab.runId);
  await p.click('.wl-reset');
  await p.waitForFunction((r) => window.__waterLab.ready && window.__waterLab.runId !== r && window.__waterLab.snap && window.__waterLab.snap.step > 0, run0, { timeout: 90000 });
  note('11 reset', await p.evaluate(() => ({ runId: window.__waterLab.runId, events: window.__waterLab.events.map((e) => e.type), T_target: window.__waterLab.snap.T_target })));
  fs.writeFileSync(path.join(OUT, 'demo_path.json'), JSON.stringify({ browser: 'Chromium ' + browser.version(), steps: log }, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
