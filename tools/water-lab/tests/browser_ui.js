// Check 10: interface behaviour of /lab/water/ in headless Chromium (Playwright).
// Usage: node browser_ui.js [base URL]   e.g. http://127.0.0.1:8765/   (serve the repository root first)
// Writes ../results/t10.json. Uses the page's ?test=1 hooks (window.__waterLab), which are inert without the flag.
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const BASE = (process.argv[2] || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
const EXE = process.env.CHROMIUM || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const RESULTS = path.resolve(__dirname, '../results');
const items = [];
function record(name, pass, detail) { items.push({ name, pass: !!pass, detail }); console.log((pass ? 'PASS ' : 'FAIL ') + name + ' — ' + detail); }
const wait = (p, ms) => p.waitForTimeout(ms);
async function step(p) { return p.evaluate(() => (window.__waterLab.snap ? window.__waterLab.snap.step : -1)); }
async function waitReady(p, runIdBefore) {
  await p.waitForFunction((r) => window.__waterLab && window.__waterLab.ready && window.__waterLab.runId !== r && window.__waterLab.snap, runIdBefore, { timeout: 90000 });
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const version = browser.version();
  // ---------------------------------------------------------------- desktop
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const reqs = [];
  p.on('request', (r) => reqs.push(r.url()));
  await p.goto(BASE + 'lab/water/?test=1', { waitUntil: 'networkidle' });
  await wait(p, 2000);
  const early = reqs.filter((u) => /lammps-water|preset_water|worker\.js/.test(u));
  record('No engine or data download before Start', early.length === 0, early.length ? early.join(', ') : 'no engine, worker or preset requests after page load + 2 s');

  await p.click('.wl-start-big');
  await waitReady(p, 0);
  await wait(p, 2500);
  const s1 = await step(p);
  record('Start builds and runs the system', s1 > 0, `step ${s1} after 2.5 s; ${await p.evaluate(() => window.__waterLab.natoms())} atoms`);

  // pause / resume
  await p.click('.wl-pause');
  await wait(p, 600);
  const a = await step(p); await wait(p, 2000); const b = await step(p);
  await p.click('.wl-pause');
  await wait(p, 2000); const c = await step(p);
  record('Pause stops and Resume continues the dynamics', a === b && c > b, `paused at step ${a}, still ${b} after 2 s; resumed to ${c}`);

  // stale message for a previous run ID
  const selBefore = await p.evaluate(() => window.__waterLab.state.sel);
  const stale = await p.evaluate(() => window.__waterLab.staleTest());
  await wait(p, 300);
  const selAfter = await p.evaluate(() => window.__waterLab.state.sel);
  record('Message with an old run ID is rejected without effect', /stale/.test(String(stale)) && selBefore === selAfter, `reply: ${stale}; selection ${selBefore} -> ${selAfter}`);

  // keyboard: select, pull, release
  await p.focus('.wl-canvas');
  await p.keyboard.press('n');
  await wait(p, 600);
  for (let i = 0; i < 4; i++) { await p.keyboard.press('ArrowRight'); await wait(p, 120); }
  await wait(p, 1500);
  const kb = await p.evaluate(() => ({ sel: window.__waterLab.state.sel, pulling: window.__waterLab.snap.pulling, ens: window.__waterLab.snap.ensemble }));
  await p.keyboard.press('Escape');
  await wait(p, 800);
  const kb2 = await p.evaluate(() => ({ pulling: window.__waterLab.snap.pulling, phase: window.__waterLab.snap.phase }));
  record('Keyboard: N selects, arrows pull, Escape releases', kb.sel > 0 && kb.pulling && kb.ens === 'nvt' && !kb2.pulling && kb2.phase === 'relaxation',
    `molecule ${kb.sel}, pulling ${kb.pulling} in ${kb.ens}; after Escape pulling ${kb2.pulling}, phase ${kb2.phase}`);

  // scripted demonstration
  await p.click('.wl-demo');
  await p.waitForFunction(() => window.__waterLab.snap.pulling, null, { timeout: 15000 });
  const t0 = await p.evaluate(() => window.__waterLab.snap.time_ps);
  // the handle starts at the molecule's centre of mass and moves 0.25 nm: sample it until release
  const X0 = await p.evaluate(() => window.__waterLab.events.filter((e) => e.type === 'pull_begin').pop().anchor_nm.map((v) => v * 10));
  let maxHandle = 0;
  for (let i = 0; i < 600; i++) {
    const s = await p.evaluate(() => ({ pulling: window.__waterLab.snap.pulling, X: window.__waterLab.snap.X }));
    if (!s.pulling) break;
    maxHandle = Math.max(maxHandle, Math.hypot(s.X[0] - X0[0], s.X[1] - X0[1], s.X[2] - X0[2]));
    await wait(p, 100);
  }
  await p.waitForFunction(() => !window.__waterLab.snap.pulling, null, { timeout: 60000 });
  const t1 = await p.evaluate(() => window.__waterLab.snap.time_ps);
  const demoEv = await p.evaluate(() => window.__waterLab.events.filter((e) => e.type === 'release').length);
  record('"Try a gentle pull" runs the stated protocol (handle 0.25 nm from its start, 2 ps) and releases', t1 - t0 >= 1.9 && demoEv >= 2 && maxHandle <= 2.5 + 1e-6 && maxHandle > 1.0,
    `pull held for ${(t1 - t0).toFixed(2)} ps of simulated time, then released; largest handle displacement from its start ${(maxHandle / 10).toFixed(4)} nm`);

  // essential readout beside the viewer
  const ro = await p.evaluate(() => [...document.querySelectorAll('.wl-readout dt')].map((d) => d.textContent.trim()));
  record('Essential readout: simulated time, temperature, selected molecule, applied force',
    ['Simulated time', 'Temperature', 'Selected molecule', 'Applied force'].every((x) => ro.includes(x)), ro.join(' | '));

  // download experiment (button in the side panel)
  await p.click('.wl-download-panel');
  await p.waitForFunction(() => window.__lastExport, null, { timeout: 30000 });
  const ex = await p.evaluate(() => ({ files: Object.keys(window.__lastExport.files), size: window.__lastExport.size, lines: window.__lastExport.files['in.water_lab.lmp'].split('\n').length }));
  record('Download experiment produces the reproducible bundle', ['in.water_lab.lmp', 'start.data', 'final.data', 'thermo.csv', 'events.json', 'model.json', 'README.md', 'analyze_water.py'].every((f) => ex.files.includes(f)),
    `${ex.files.length} files, ${(ex.size / 1024).toFixed(0)} kB zip, ${ex.lines}-line LAMMPS input`);

  // expandable panels open from the keyboard
  await p.focus('#wl-conditions summary');
  await p.keyboard.press('Enter');
  await wait(p, 300);
  const opened = await p.evaluate(() => ({ cond: document.getElementById('wl-conditions').open, applyVisible: !!document.querySelector('.wl-apply').offsetParent }));
  record('"Change the conditions" panel opens from the keyboard', opened.cond && opened.applyVisible, `open ${opened.cond}; Apply button visible ${opened.applyVisible}`);

  // count change 216 -> 256 -> 216 (new run IDs, stale snapshots ignored)
  const r0 = await p.evaluate(() => window.__waterLab.runId);
  await p.selectOption('#wl-molecules', '256');
  await p.click('.wl-apply');
  await waitReady(p, r0);
  await wait(p, 1500);
  const c1 = await p.evaluate(() => ({ run: window.__waterLab.runId, n: window.__waterLab.natoms(), x: window.__waterLab.snap && window.__waterLab.snap.step }));
  await p.selectOption('#wl-molecules', '216');
  await p.click('.wl-apply');
  await waitReady(p, c1.run);
  await wait(p, 1500);
  const c2 = await p.evaluate(() => ({ run: window.__waterLab.runId, n: window.__waterLab.natoms(), events: window.__waterLab.events.map((e) => e.type) }));
  record('Molecule-count change rebuilds with a new run ID', c1.run > r0 && c1.n === 768 && c2.run > c1.run && c2.n === 648 && c2.events[0] === 'start',
    `run IDs ${r0} -> ${c1.run} (768 atoms) -> ${c2.run} (648 atoms); event history restarted`);

  // conditions experiment applies NPT targets
  await p.fill('#wl-T', '320'); await p.fill('#wl-P', '500'); await p.selectOption('#wl-lj', '1.05');
  await p.click('.wl-apply');
  await wait(p, 2500);
  const cond = await p.evaluate(() => ({ T: window.__waterLab.snap.T_target, P: window.__waterLab.snap.P_target, s: window.__waterLab.snap.ljScale, ens: window.__waterLab.snap.ensemble,
    label: document.querySelector('.wl-lj-label').textContent }));
  record('Apply conditions sets T, P and s at a safe boundary', cond.T === 320 && cond.P === 500 && Math.abs(cond.s - 1.05) < 1e-9 && cond.ens === 'npt' && /Modified SPC\/E/.test(cond.label),
    `targets ${cond.T} K, ${cond.P} bar, s = ${cond.s} (${cond.ens}); label "${cond.label}"`);
  await p.click('.wl-restore');
  await wait(p, 1200);
  const rest = await p.evaluate(() => ({ s: window.__waterLab.snap.ljScale, label: document.querySelector('.wl-lj-label').textContent }));
  record('Restore reference parameters returns to s = 1', Math.abs(rest.s - 1) < 1e-9 && rest.label === 'Reference SPC/E parameters', `s = ${rest.s}, "${rest.label}"`);

  // measurements: descriptive means only; the extra plots draw when their panel opens
  await wait(p, 1200);
  const meas = await p.evaluate(() => ({ head: document.querySelector('#wl-table thead').textContent, body: document.querySelector('#wl-table tbody').textContent,
    note: document.querySelector('.wl-avg-note').textContent }));
  record('Live means are descriptive (no intervals)', /descriptive/i.test(meas.head) && !/±|interval/.test(meas.body) && /analyze_water\.py/.test(meas.note),
    `table header "${meas.head.replace(/\s+/g, ' ').trim()}"; no ± or interval in the body`);
  await p.click('#wl-all-measurements summary');
  await wait(p, 1500);
  const extra = await p.evaluate(() => [...document.querySelectorAll('.wl-plots-more canvas')].map((c) => {
    const g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data; let ink = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) ink++;
    return { w: c.width, ink };
  }));
  record('"All measurements and plots" draws the remaining plots when opened', extra.length === 6 && extra.every((e) => e.w > 50 && e.ink > 50),
    extra.map((e) => e.w + ' px/' + e.ink).join(', '));

  // hidden tab
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await wait(p, 800);
  const h1 = await step(p); await wait(p, 1500); const h2 = await step(p);
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await wait(p, 1500); const h3 = await step(p);
  record('Computation pauses while the tab is hidden', h1 === h2 && h3 > h2, `hidden: step ${h1} -> ${h2}; visible again: ${h3}`);

  // injected engine failure and recovery
  await p.evaluate(() => window.__waterLab.send('testFail').catch(() => {}));
  await wait(p, 800);
  const f1 = await p.evaluate(() => ({ ready: window.__waterLab.ready, status: document.querySelector('.wl-status').textContent, err: document.querySelector('.wl-status').classList.contains('is-error') }));
  await p.click('.wl-reset');
  await p.waitForFunction(() => window.__waterLab.ready && window.__waterLab.running, null, { timeout: 90000 });
  await wait(p, 1500);
  const f2 = await step(p);
  record('Engine failure is reported and Reset recovers', !f1.ready && f1.err && /stopped/.test(f1.status) && f2 > 0, `message: "${f1.status.slice(0, 90)}…"; after Reset step ${f2}`);
  record('No uncaught page errors (desktop)', errors.length === 0, errors.length ? errors.join(' | ') : 'none');
  await ctx.close();

  // ---------------------------------------------------------------- mobile, touch
  for (const w of [360, 390]) {
    const m = await browser.newContext({ viewport: { width: w, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const q = await m.newPage();
    const errs = [];
    q.on('pageerror', (e) => errs.push(e.message));
    await q.goto(BASE + 'lab/water/?test=1', { waitUntil: 'networkidle' });
    const over0 = await q.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await q.tap('.wl-start-big');
    await waitReady(q, 0);
    await wait(q, 2500);
    const over1 = await q.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    record(`${w} px: no horizontal overflow`, over0 <= 0 && over1 <= 0, `scrollWidth - clientWidth = ${over0} before, ${over1} after Start`);
    if (w === 390) {
      // the Pause button sits below the viewer on phones: press it without scrolling, then bring the viewer back into view
      const centre = async () => { await q.evaluate(() => document.querySelector('.wl-canvas').scrollIntoView({ block: 'center', behavior: 'instant' })); await wait(q, 300); };
      const pressPause = () => q.evaluate(() => document.querySelector('.wl-pause').click());
      await pressPause(); await wait(q, 600);                              // freeze positions while aiming the tap
      await centre();
      const mol = await q.evaluate(() => window.__waterLab.frontMolecule());
      const pos = await q.evaluate((mm) => window.__waterLab.screenOf(mm), mol);
      await q.touchscreen.tap(pos.x, pos.y);
      await wait(q, 700);
      const tapSel = await q.evaluate(() => window.__waterLab.state.sel);
      await pressPause(); await wait(q, 400);
      await centre();
      const cdp = await m.newCDPSession(q);
      const p0 = await q.evaluate((mm) => window.__waterLab.screenOf(mm), tapSel || mol);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p0.x, y: p0.y }] });
      for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p0.x + 5 * i, y: p0.y }] }); await wait(q, 60); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await wait(q, 2000);
      const pull = await q.evaluate(() => ({ pulling: window.__waterLab.snap.pulling, X: window.__waterLab.snap.X, R: window.__waterLab.snap.R, Xreq: window.__waterLab.snap.Xreq }));
      const moved = pull.Xreq ? Math.hypot(pull.Xreq[0] - pull.R[0], pull.Xreq[1] - pull.R[1], pull.Xreq[2] - pull.R[2]) : 0;
      record('390 px touch: tap selects, drag pulls', tapSel === mol && pull.pulling && moved > 0.5, `tapped molecule ${mol} -> selected ${tapSel}; after drag pulling ${pull.pulling}, requested handle ${moved.toFixed(2)} Å from the centre of mass`);
      await q.tap('.wl-release'); await wait(q, 600);
      const rel = await q.evaluate(() => window.__waterLab.snap.pulling);
      record('390 px touch: Release button', rel === false, `pulling ${rel} after tapping Release`);
    }
    record(`No uncaught page errors (${w} px)`, errs.length === 0, errs.length ? errs.join(' | ') : 'none');
    await m.close();
  }

  // ---------------------------------------------------------------- one click: "Try a gentle pull" before Start
  {
    const oc = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const o = await oc.newPage();
    const oerr = [];
    o.on('pageerror', (e) => oerr.push(e.message));
    await o.goto(BASE + 'lab/water/?test=1', { waitUntil: 'networkidle' });
    const enabled = await o.evaluate(() => !document.querySelector('.wl-demo').disabled);
    await o.click('.wl-demo');
    await waitReady(o, 0);
    await o.waitForFunction(() => window.__waterLab.snap && window.__waterLab.snap.pulling, null, { timeout: 30000 });
    await o.waitForFunction(() => window.__waterLab.events.some((e) => e.type === 'release'), null, { timeout: 90000 });
    const ev = await o.evaluate(() => window.__waterLab.events.map((e) => e.type).filter((t) => t !== 'anchor'));
    record('"Try a gentle pull" before Start loads the engine, pulls and releases', enabled && ev[0] === 'start' && ev.includes('pull_begin') && ev.includes('release') && !oerr.length,
      `button enabled before Start ${enabled}; events ${ev.join(' → ')}${oerr.length ? '; errors ' + oerr.join(' | ') : ''}`);
    await oc.close();
  }

  // ---------------------------------------------------------------- reduced motion
  const rm = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const r = await rm.newPage();
  await r.goto(BASE + 'lab/water/?test=1', { waitUntil: 'networkidle' });
  const pace = await r.$eval('#wl-pace', (e) => e.value);
  record('Reduced motion: slow display pace by default, nothing starts automatically', pace === 'slow' && !(await r.evaluate(() => window.__waterLab.ready)), `pace "${pace}", engine not started`);
  await rm.close();
  await browser.close();

  const pass = items.every((i) => i.pass);
  const res = { id: 10, name: 'Interface behaviour', verdict: pass ? 'PASS' : 'FAIL', browser: 'Chromium ' + version + ' (headless shell, Playwright)', items,
    summary: `${items.filter((i) => i.pass).length} of ${items.length} interface checks passed` };
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, 't10.json'), JSON.stringify(res, null, 1) + '\n');
  console.log('check 10:', res.verdict, '-', res.summary);
  if (res.verdict !== 'PASS') process.exit(1);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
