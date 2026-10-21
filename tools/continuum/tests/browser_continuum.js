// Browser and regression tests B1-B16 and R1 for /lab/continuum/ (criteria: tools/continuum/TOLERANCES.md; B11-B13
// added 19 Oct 2026, B14-B15 and B16 on 20 Oct 2026, each before it was run). WebGL runs on SwiftShader in headless Chromium.
// Usage: node browser_continuum.js [base URL]   (serve the repository root first, e.g. python3 -m http.server 8765)
// Writes tools/continuum/results/browser.json; exits 1 if any test fails. Reads the page state through the read-only
// hook window.__continuumState. Numbers are compared with the Node solver run on the same scenario (core/*.js).
'use strict';
const path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = (process.argv[2] || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
const EXE = process.env.CHROMIUM || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const ROOT = path.resolve(__dirname, '../../..');
const C = (f) => require(path.join(ROOT, 'lab/continuum/core', f));
const E = C('experiment.js'), SC = C('scenario.js'), MM = C('membrane-map.js'), U = C('units.js');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'lab/continuum/data/manifest.json'), 'utf8'));
const items = [];
const rec = (id, name, pass, detail) => { items.push({ id, name, verdict: pass ? 'PASS' : 'FAIL', detail }); console.log((pass ? 'PASS ' : 'FAIL ') + id + ' ' + name + ' — ' + detail); };
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const URL0 = BASE + 'lab/continuum/water.html';

async function converged(p, timeout) {
  await p.waitForFunction(() => { const S = window.__continuumState; return S && S.status === 'converged' && S.result && S.result.revision === S.revision; }, null, { timeout: timeout || 120000 });
  await p.waitForTimeout(150);
}
const st = (p) => p.evaluate(() => { const S = window.__continuumState; return { rev: S.revision, res: S.result && { rev: S.result.revision, Q: S.result.diag.Q_m3_s, dP: S.result.scenario.dP_Pa, mode: S.result.mode, change: S.result.change ? { dQ: S.result.change.dQ_m3_s, ref: S.result.change.refRevision, pores: S.result.change.affectedPores } : null }, base: S.baseline && { rev: S.baseline.revision, Q: S.baseline.Q }, status: S.status, sel: S.sel, stale: S.staleDiscarded }; });
async function setDp(p, mpa) { await p.evaluate((v) => { const r = document.getElementById('cl-dp'); r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true })); }, mpa); }

(async () => {
  const GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];     // software WebGL for the 3D pore view
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: GL_ARGS });
  const version = browser.version();
  const allErrors = [];
  // ======================================================== desktop session: B1-B7, B9
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => allErrors.push('desktop: ' + e.message));
  const reqs = []; p.on('request', (r) => reqs.push({ url: r.url(), t: Date.now() }));
  await p.goto(URL0, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const early = reqs.filter((r) => /worker\.js|core\/solver\.js|core\/experiment\.js/.test(r.url)).map((r) => r.url.replace(BASE, ''));
  const tRun = Date.now();
  await p.click('.cl-poster-run');
  await converged(p);
  const after = reqs.filter((r) => r.t >= tRun && /worker\.js|core\/solver\.js|core\/experiment\.js/.test(r.url)).map((r) => r.url.replace(BASE, ''));
  rec('B1', 'Lazy start', early.length === 0 && after.length >= 1, early.length ? 'requested before Run: ' + early.join(', ') : 'no worker or solver script requested during load + 1.5 s; after Run: ' + after.join(', '));

  // B2 converged and equal to the Node solver
  const sc0 = SC.makeScenario(manifest), node0 = E.run(sc0, manifest);
  let s = await st(p);
  rec('B2', 'Run', s.res && rel(s.res.Q, node0.diag.Q_m3_s) <= 1e-9, `browser Q = ${s.res.Q.toExponential(12)} m³/s, Node ${node0.diag.Q_m3_s.toExponential(12)} m³/s, relative difference ${rel(s.res.Q, node0.diag.Q_m3_s).toExponential(2)}`);
  const Q1 = s.res.Q;

  // B3 pressure change: 1 -> 4 MPa
  await setDp(p, 4); await converged(p);
  s = await st(p);
  rec('B3', 'Pressure change', rel(s.res.Q / Q1, 4) <= 1e-9 && s.res.dP === 4e6, `Q(4 MPa) / Q(1 MPa) = ${(s.res.Q / Q1).toPrecision(13)}, relative difference from 4: ${rel(s.res.Q / Q1, 4).toExponential(2)} (${s.res.mode})`);
  const Q4 = s.res.Q;

  // baseline at 4 MPa, intact membrane
  await p.click('.cl-set-baseline'); await p.waitForTimeout(200);
  const baseRev = (await st(p)).base.rev;
  // B4a one tube closed (the default selected tube at the membrane centre)
  await p.check('input[name="cl-scope"][value="tube"]');
  await p.selectOption('#cl-factor', '0'); await p.click('.cl-apply'); await converged(p);
  s = await st(p);
  const t = s.sel.tube;
  const sc4 = Object.assign(SC.makeScenario(manifest), { dP_Pa: 4e6 }), n4 = E.run(sc4, manifest);
  const dev = SC.deriveDevice(sc4), f = MM.faceOfTube({ W_m: sc4.W_m, B_m: sc4.B_m, pitch_m: sc4.pitch_m }, { nx: dev.nx, ny: dev.ny }, t.ti, t.tj);
  const dPi = n4.sol.fields.dPi[f.fj * dev.nx + f.fi], expTube = -n4.built.G0 * dPi * dPi / 4e6;
  const tubeOk = s.res.change && s.res.change.ref === baseRev && rel(s.res.change.dQ, expTube) <= 1e-6;
  const tubeDetail = `tube (${t.ti}, ${t.tj}): ΔQ = ${s.res.change ? s.res.change.dQ.toExponential(9) : 'n/a'} m³/s, −G ΔΠ_c²/ΔP = ${expTube.toExponential(9)} m³/s, relative difference ${s.res.change ? rel(s.res.change.dQ, expTube).toExponential(2) : 'n/a'}`;
  // B5 restore returns the baseline
  await p.click('.cl-restore-all'); await converged(p);
  s = await st(p);
  const restoreRel = rel(s.res.Q, Q4);
  // B4b patch closed: J = 0 on its faces
  await p.click('.cl-block'); await converged(p);
  const patch = await p.evaluate(() => { const S = window.__continuumState, r = S.result, d = r.device, pp = S.sel.patch; let mx = 0, n = 0;
    for (let j = pp.pj * d.patchCells; j < (pp.pj + 1) * d.patchCells; j++) for (let i = pp.pi * d.patchCells; i < (pp.pi + 1) * d.patchCells; i++) { mx = Math.max(mx, Math.abs(r.membrane.J[j * d.nx + i])); n++; }
    return { mx, n, pp }; });
  // B6 comparison panel shows the computed values
  const shown = await p.evaluate(() => {
    const S = window.__continuumState, r = S.result, U = window.ContinuumUnits, c = r.change;
    let maxOpen = 0, jRef = 0; for (let k = 0; k < c.dJ_m_s.length; k++) if (!r.membrane.closed[k] && !S.baseline.closed[k]) { maxOpen = Math.max(maxOpen, Math.abs(c.dJ_m_s[k])); jRef = Math.max(jRef, Math.abs(S.baseline.J[k])); }
    const rows = Array.from(document.querySelectorAll('#cl-compare-body tbody tr')).map((tr) => Array.from(tr.children).map((x) => x.textContent));
    const find = (k) => rows.find((x) => x[0].indexOf(k) === 0);
    return { dQ: c.dQ_m3_s, pores: c.affectedPores, maxOpen, rowQ: find('Total flow'), rowP: find('Affected physical pores'), rowJ: find('Largest |ΔJ|'),
      expQ: (c.dQ_m3_s >= 0 ? '+' : '') + U.fmt3(c.dQ_m3_s), expP: U.fmtInt(c.affectedPores), expJ: U.fmt3(maxOpen), stripQ: document.getElementById('cl-Q').textContent, expStrip: U.fmt3(r.diag.Q_m3_s) + ' m³/s' };
  });
  const b6 = shown.rowQ && shown.rowQ[3].indexOf(shown.expQ) === 0 && shown.rowP && shown.rowP[3] === shown.expP && shown.rowJ && shown.rowJ[3].indexOf(shown.expJ) === 0 && shown.stripQ === shown.expStrip && shown.pores === 1600;
  rec('B6', 'Baseline comparison', b6, `table: ΔQ “${shown.rowQ && shown.rowQ[3]}” (computed ${shown.expQ}), affected pores “${shown.rowP && shown.rowP[3]}” (computed ${shown.expP}), largest |ΔJ| “${shown.rowJ && shown.rowJ[3]}” (computed ${shown.expJ}); strip Q “${shown.stripQ}”`);
  await p.click('.cl-restore-all'); await converged(p);
  // B4c whole membrane x2
  await p.check('input[name="cl-scope"][value="membrane"]'); await p.selectOption('#cl-factor', '2'); await p.click('.cl-apply'); await converged(p);
  s = await st(p);
  const sc4m = Object.assign(SC.makeScenario(manifest), { dP_Pa: 4e6, mods: MM.applyScopedChange(MM.emptyModifications(), { kind: 'membrane' }, 2) }), n4m = E.run(sc4m, manifest);
  const memOk = rel(s.res.Q, n4m.diag.Q_m3_s) <= 1e-9 && s.res.Q > Q4 && s.res.Q < 2 * Q4;
  rec('B4', 'Scopes', tubeOk && patch.mx === 0 && patch.n > 0 && memOk,
    `${tubeDetail}; patch (${patch.pp.pi}, ${patch.pp.pj}) closed: max |J| on its ${patch.n} faces = ${patch.mx}; whole membrane × 2: Q = ${s.res.Q.toExponential(9)} vs Node ${n4m.diag.Q_m3_s.toExponential(9)} (relative ${rel(s.res.Q, n4m.diag.Q_m3_s).toExponential(2)}), Q/Q_base = ${(s.res.Q / Q4).toPrecision(9)} (between 1 and 2)`);
  await p.click('.cl-restore-all'); await converged(p);
  s = await st(p);
  rec('B5', 'Restore', restoreRel <= 1e-12 && rel(s.res.Q, Q4) <= 1e-12, `after restoring one tube: |Q − Q_base|/Q_base = ${restoreRel.toExponential(2)}; after restoring the whole membrane: ${rel(s.res.Q, Q4).toExponential(2)}`);

  // B7 export and Node reproduction (with a closed patch against the baseline)
  await p.click('.cl-block'); await converged(p);
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click('.cl-download')]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'continuum-export-'));
  const zp = path.join(tmp, 'export.zip'); await dl.saveAs(zp);
  cp.execFileSync('python3', ['-c', 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zp, path.join(tmp, 'x')]);
  const need = ['scenario.json', 'pore_law.json', 'results.json', 'fields/feed.vti', 'fields/permeate.vti', 'probes.csv', 'events.json', 'environment.json', 'README.md', 'membrane.csv', 'reproduce.js'];
  const missing = need.filter((n) => !fs.existsSync(path.join(tmp, 'x', n)));
  const rp = cp.spawnSync('node', [path.join(tmp, 'x', 'reproduce.js'), path.join(tmp, 'x')], { encoding: 'utf8' });
  const qline = (rp.stdout.split('\n').find((l) => l.indexOf(' Q:') >= 0) || '').trim();
  rec('B7', 'Export', missing.length === 0 && rp.status === 0, `${fs.statSync(zp).size} bytes; ${missing.length ? 'missing: ' + missing.join(', ') : 'all required files present'}; node reproduce.js exit ${rp.status}: ${qline}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  await p.click('.cl-restore-all'); await converged(p);

  // B9 ten input changes within 200 ms
  const t0 = Date.now();
  await p.evaluate(async () => { const r = document.getElementById('cl-dp'); const vals = [1.5, 2.2, 3.1, 6.4, 0.7, 9.3, 5.5, 2.8, 7.7, 3.3];
    for (const v of vals) { r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((res) => setTimeout(res, 15)); } });
  const span = Date.now() - t0;
  await converged(p);
  s = await st(p);
  const disp = await p.evaluate(() => ({ q: document.getElementById('cl-Q').textContent, exp: window.ContinuumUnits.fmt3(window.__continuumState.result.diag.Q_m3_s) + ' m³/s', dp: document.getElementById('cl-dp-out').textContent }));
  rec('B9', 'Stale results', s.res.rev === s.rev && s.res.dP === 3.3e6 && disp.q === disp.exp, `10 changes in ${span} ms; displayed result revision ${s.res.rev} = current revision ${s.rev}, ΔP ${s.res.dP / 1e6} MPa (last input 3.3 MPa); strip “${disp.q}”; stale results discarded: ${s.stale}`);
  await ctx.close();

  // ======================================================== B8 keyboard (desktop) and touch (390 px)
  const kctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const k = await kctx.newPage(); k.on('pageerror', (e) => allErrors.push('keyboard: ' + e.message));
  await k.goto(URL0, { waitUntil: 'networkidle' });
  const kres = [];
  await k.focus('.cl-run'); await k.keyboard.press('Enter'); await converged(k); kres.push('Enter on Run: converged');
  await k.focus('#cl-dp'); await k.keyboard.press('ArrowRight'); await converged(k);
  let ks = await st(k); kres.push('ArrowRight on ΔP: ' + ks.res.dP / 1e6 + ' MPa');
  await k.focus('input[name="cl-scope"][value="tube"]'); await k.keyboard.press('ArrowRight'); await k.waitForTimeout(100);
  ks = await st(k); kres.push('arrow key in the scope group: ' + ks.sel.scope);
  await k.focus('.cl-apply'); await k.keyboard.press('Enter'); await converged(k);
  const closedK = await k.evaluate(() => Object.keys(window.__continuumState.sc.mods.patchFactors).length); kres.push('Enter on Apply: ' + closedK + ' patch blocked');
  await k.focus('.cl-viewbar [data-view="membrane"]'); await k.keyboard.press('Enter');
  // wait for the map to appear (it follows a 650 ms camera animation) instead of a fixed delay: one loaded run in
  // 2026.7 pressed the keys before the map was visible
  await k.waitForFunction(() => { const e = document.getElementById('cl-pane-membrane'); return e && !e.hidden && e.offsetParent !== null; }, null, { timeout: 15000 }); await k.waitForTimeout(200);
  const before = (await st(k)).sel.patch; await k.focus('.cl-mem-canvas'); await k.keyboard.press('ArrowLeft'); await k.waitForTimeout(100);
  const afterP = (await st(k)).sel.patch; kres.push('ArrowLeft on the map: patch (' + before.pi + ', ' + before.pj + ') → (' + afterP.pi + ', ' + afterP.pj + ')');
  await k.keyboard.press('Enter'); await k.waitForTimeout(200); const mm = await k.evaluate(() => window.__continuumState.memMode); kres.push('Enter on the map: ' + mm);
  await k.keyboard.press('Escape'); await k.waitForTimeout(100);
  await k.focus('.cl-restore-all'); await k.keyboard.press('Enter'); await converged(k);
  const modsK = await k.evaluate(() => Object.keys(window.__continuumState.sc.mods.patchFactors).length); kres.push('Enter on Restore all: ' + modsK + ' changes left');
  const [dlk] = await Promise.all([k.waitForEvent('download', { timeout: 60000 }), (async () => { await k.focus('.cl-download'); await k.keyboard.press('Enter'); })()]);
  kres.push('Enter on Download: ' + dlk.suggestedFilename());
  const kbOk = ks.sel.scope === 'patch' && closedK === 1 && (afterP.pi !== before.pi) && mm === 'zoom' && modsK === 0;
  await kctx.close();
  const tctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const tp = await tctx.newPage(); tp.on('pageerror', (e) => allErrors.push('touch: ' + e.message));
  await tp.goto(URL0, { waitUntil: 'networkidle' });
  const tres = [];
  await tp.tap('.cl-poster-run'); await converged(tp); tres.push('tap Run: converged');
  const vis = (sel) => tp.evaluate((q) => { const e = document.querySelector(q); return !!e && !e.hidden && e.offsetParent !== null; }, sel);
  await tp.tap('#cl-tab-membrane'); await tp.waitForTimeout(300);
  const m1 = await vis('#cl-pane-membrane'), sel1 = await tp.getAttribute('#cl-tab-membrane', 'aria-selected');
  const pBefore = (await st(tp)).sel.patch; const box = await (await tp.$('.cl-mem-canvas')).boundingBox();
  await tp.tap('.cl-mem-canvas', { position: { x: box.width * 0.2, y: box.height * 0.2 } }); await tp.waitForTimeout(200);
  const pAfter = (await st(tp)).sel.patch;
  await tp.tap('#cl-tab-molecule'); await tp.waitForTimeout(300); const m2 = await vis('#cl-pane-molecule'), m2b = !(await vis('#cl-pane-membrane'));
  await tp.tap('#cl-tab-flow'); await tp.waitForTimeout(300); const m3 = await vis('#cl-pane-flow');
  tres.push(`Membrane tab: visible ${m1}, aria-selected ${sel1}; tap on the map: patch (${pBefore.pi}, ${pBefore.pj}) → (${pAfter.pi}, ${pAfter.pj}); Molecule tab: visible ${m2} (map hidden ${m2b}); Flow tab: visible ${m3}`);
  const touchOk = m1 && sel1 === 'true' && (pAfter.pi !== pBefore.pi || pAfter.pj !== pBefore.pj) && m2 && m2b && m3;
  await tctx.close();
  rec('B8', 'Keyboard and touch', kbOk && touchOk, 'keyboard: ' + kres.join('; ') + '. Touch at 390 px: ' + tres.join('; '));

  // ======================================================== B10 layout, errors, reduced motion
  const lay = [];
  for (const w of [360, 390, 768, 1440]) {
    const c2 = await browser.newContext({ viewport: { width: w, height: 900 } }); const q = await c2.newPage();
    q.on('pageerror', (e) => allErrors.push(w + ' px: ' + e.message));
    await q.goto(URL0, { waitUntil: 'networkidle' });
    const o1 = await q.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await q.click('.cl-poster-run'); await converged(q);
    await q.evaluate(() => { document.querySelectorAll('details').forEach((d) => { d.open = true; }); });
    await q.waitForTimeout(300);
    const o2 = await q.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    lay.push({ w, before: o1, after: o2 }); await c2.close();
  }
  const rm = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' }); const r = await rm.newPage();
  r.on('pageerror', (e) => allErrors.push('reduced motion: ' + e.message));
  await r.goto(URL0, { waitUntil: 'networkidle' }); await r.click('.cl-poster-run'); await converged(r); await r.waitForTimeout(800);
  const t1 = Date.now(); await r.click('.cl-viewbar [data-view="membrane"]');
  await r.waitForFunction(() => window.__continuumState.view === 'membrane', null, { timeout: 5000 }); const switchMs = Date.now() - t1;
  const rmState = await r.evaluate(() => ({ rm: window.ContinuumView.reduceMotion, tracers: document.getElementById('cl-tracers').disabled, play: document.querySelector('.cl-mol-play').textContent }));
  await rm.close();
  const layOk = lay.every((x) => x.before <= 0 && x.after <= 0);
  rec('B10', 'Layout', layOk && allErrors.length === 0 && rmState.rm && rmState.tracers && rmState.play === 'Play' && switchMs < 400,
    'horizontal overflow (px) before/after a run with all panels open: ' + lay.map((x) => x.w + ' px ' + x.before + '/' + x.after).join(', ') + `; uncaught page errors: ${allErrors.length ? allErrors.join(' | ') : 'none'}; reduced motion: tracers disabled ${rmState.tracers}, molecule not auto-playing (${rmState.play}), view switch without camera animation in ${switchMs} ms`);

  // ======================================================== B11 fixed visual scale (colour range and tracer clock)
  const vctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const v = await vctx.newPage(); v.on('pageerror', (e) => allErrors.push('scale: ' + e.message));
  await v.goto(URL0, { waitUntil: 'networkidle' });
  await v.click('.cl-poster-run'); await converged(v);
  const d1 = await v.evaluate(() => Object.assign({}, window.__continuumState.display, { ref: window.__continuumState.scaleRef && { vmax: window.__continuumState.scaleRef.vmax, m: window.__continuumState.scaleRef.multiplier } }));
  await setDp(v, 4); await converged(v);
  const d4 = await v.evaluate(() => Object.assign({}, window.__continuumState.display, { note: document.getElementById('cl-flow-legend').textContent }));
  await v.uncheck('#cl-fixscale'); await v.waitForTimeout(300);
  const da = await v.evaluate(() => Object.assign({}, window.__continuumState.display, { note: document.getElementById('cl-flow-legend').textContent }));
  await vctx.close();
  const b11fixed = d4.flowFixed && rel(d4.flowScaleMax, d1.ref.vmax) <= 1e-12 && rel(d4.tracerFactor, d1.ref.m) <= 1e-12 && rel(d4.flowMaxNow / d4.flowScaleMax, 4) <= 1e-9 &&
    /fixed to the baseline/.test(d4.note) && /shown in the top colour/.test(d4.note);
  const b11auto = !da.flowFixed && rel(da.flowScaleMax, da.flowMaxNow) <= 1e-12 && da.tracerFactor === da.tracerFactorAuto && /Automatic range/.test(da.note);
  rec('B11', 'Fixed visual scale', b11fixed && b11auto,
    `baseline at 1 MPa: legend maximum ${d1.ref.vmax.toExponential(6)} m/s, tracer time factor ${d1.ref.m.toExponential(6)}; at 4 MPa fixed: legend maximum ${d4.flowScaleMax.toExponential(6)} (relative ${rel(d4.flowScaleMax, d1.ref.vmax).toExponential(2)}), tracer factor ${d4.tracerFactor.toExponential(6)}, computed maximum / legend maximum = ${(d4.flowMaxNow / d4.flowScaleMax).toPrecision(10)}, legend states fixed range and saturation: ${/fixed to the baseline/.test(d4.note) && /shown in the top colour/.test(d4.note)}; Automatic: legend maximum ${da.flowScaleMax.toExponential(6)} = result maximum ${da.flowMaxNow.toExponential(6)}, tracer factor ${da.tracerFactor.toExponential(6)} (the result's own; ${(d1.ref.m / da.tracerFactor).toPrecision(4)} × faster than at 1 MPa)`);

  // ======================================================== B12 guided path at 1280 px and at 390 px with touch
  async function guided(page, touch) {
    const press = async () => {
      await page.waitForFunction(() => !document.querySelector('.cl-guide-do').disabled, null, { timeout: 120000 });
      if (touch) await page.tap('.cl-guide-do'); else await page.click('.cl-guide-do');
      await page.waitForTimeout(150);
    };
    await press(); await converged(page);
    const q1 = (await st(page)).res.Q;
    await press(); await converged(page);
    const q4 = (await st(page)).res.Q;
    await press(); await converged(page);
    const pj = await page.evaluate(() => { const S = window.__continuumState, r = S.result, d = r.device, pp = S.sel.patch; let mx = 0, n = 0;
      for (let j = pp.pj * d.patchCells; j < (pp.pj + 1) * d.patchCells; j++) for (let i = pp.pi * d.patchCells; i < (pp.pi + 1) * d.patchCells; i++) { mx = Math.max(mx, Math.abs(r.membrane.J[j * d.nx + i])); n++; }
      return { mx, n }; });
    await press(); await page.waitForTimeout(400);
    const cmp = await page.evaluate(() => { const S = window.__continuumState, U = window.ContinuumUnits, c = S.result.change;
      const row = Array.from(document.querySelectorAll('#cl-compare-body tbody tr')).map((tr) => Array.from(tr.children).map((x) => x.textContent)).find((x) => x[0].indexOf('Total flow') === 0);
      return { shown: row && row[3], exp: c ? (c.dQ_m3_s >= 0 ? '+' : '') + U.fmt3(c.dQ_m3_s) : null, compare: S.compare }; });
    await press(); await converged(page); await page.waitForTimeout(300);
    const z = await page.evaluate(() => { const S = window.__continuumState, d = S.result.device, t = S.sel.tube, p = S.sel.patch;
      const info = document.querySelector('.cl-mem-info').textContent, pane = document.getElementById('cl-pane-membrane');
      const s = S.result.scenario.pitch_m, fi = Math.floor((t.ti + 0.5) * s / d.dx), fj = Math.floor((t.tj + 0.5) * s / d.dy);
      return { final: document.getElementById('cl-guide-text').textContent, mode: S.memMode, step: S.guide.step, inPatch: Math.floor(fi / d.patchCells) === p.pi && Math.floor(fj / d.patchCells) === p.pj, drawn: /tubes of the patch are drawn|window of real lattice positions/.test(info), visible: !pane.hidden && pane.offsetParent !== null, tubes: Object.keys(S.sc.mods.tubeFactors).length }; });
    const ok = rel(q4 / q1, 4) <= 1e-9 && pj.mx === 0 && pj.n > 0 && cmp.shown && cmp.exp && cmp.shown.indexOf(cmp.exp) === 0 && cmp.compare && z.mode === 'zoom' && z.step === 5 && z.inPatch && z.drawn && z.visible && z.tubes === 1;
    return { ok, text: `Q(4 MPa)/Q(1 MPa) = ${(q4 / q1).toPrecision(13)}; patch J max ${pj.mx} on ${pj.n} faces; comparison ΔQ “${cmp.shown}” (computed ${cmp.exp}); membrane view ${z.mode === 'zoom' ? 'tube zoom' : z.mode}, drawn tubes belong to the selected patch ${z.drawn && z.inPatch}, one tube blocked ${z.tubes === 1}, guide finished ${z.step === 5} (closing text: “${z.final}”)` };
  }
  const gerr = [];
  const gctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const gp = await gctx.newPage(); gp.on('pageerror', (e) => gerr.push('guided desktop: ' + e.message));
  await gp.goto(URL0, { waitUntil: 'networkidle' });
  const gd = await guided(gp, false); await gctx.close();
  const gmctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const gm = await gmctx.newPage(); gm.on('pageerror', (e) => gerr.push('guided phone: ' + e.message));
  await gm.goto(URL0, { waitUntil: 'networkidle' });
  const gpm = await guided(gm, true); await gmctx.close();
  allErrors.push(...gerr);
  rec('B12', 'Guided path', gd.ok && gpm.ok && gerr.length === 0, '1280 px: ' + gd.text + '. 390 px touch: ' + gpm.text + `; page errors: ${gerr.length ? gerr.join(' | ') : 'none'}`);

  // ======================================================== B13 resolution status shown for the displayed configuration
  const rctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const rp13 = await rctx.newPage(); rp13.on('pageerror', (e) => allErrors.push('resolution: ' + e.message));
  await rp13.goto(URL0, { waitUntil: 'networkidle' });
  const resolutionNow = async () => {
    await rp13.waitForFunction(() => { const S = window.__continuumState; return S.result && S.refinements[S.result.configId]; }, null, { timeout: 120000 });
    await rp13.waitForTimeout(150);
    return rp13.evaluate(() => { const S = window.__continuumState, ref = S.refinements[S.result.configId];
      const row = Array.from(document.querySelectorAll('#cl-decision-body .cl-checks li')).map((li) => li.textContent).find((x) => x.indexOf('Numerical resolution of the total flow') >= 0) || '';
      const note = (document.querySelector('#cl-decision-body .cl-resolution-note') || {}).textContent || '';
      return { state: ref.state, same: ref.configId === S.result.configId, rel: ref.rel, levels: [ref.levelComparison, ref.levelRun], row, note }; });
  };
  await rp13.click('.cl-poster-run'); await converged(rp13);
  const r1 = await resolutionNow();
  await rp13.click('.cl-block'); await converged(rp13);
  const r2 = await resolutionNow();
  await setDp(rp13, 0); await converged(rp13);
  const r0 = await resolutionNow();
  await rctx.close();
  const b13 = r1.state === 'PASS' && r1.same && /^PASS/.test(r1.row) && r2.state === 'PASS' && r2.same && /^PASS/.test(r2.row) && r0.state === 'NOT_APPLICABLE' && /^NOT APPLICABLE/.test(r0.row) && /total flow/.test(r1.note) && /port edges/.test(r1.note);
  rec('B13', 'Resolution status in the page', b13,
    `default device: ${r1.state} (levels ${r1.levels.join(' vs ')}, |ΔQ|/Q = ${r1.rel.toExponential(2)}, same configuration ${r1.same}); closed patch: ${r2.state} (|ΔQ|/Q = ${r2.rel.toExponential(2)}, same configuration ${r2.same}); ΔP = 0: ${r0.state}; panel note: “${r1.note.trim()}”`);

  // ======================================================== B14 3D pore view
  async function poresCheck(page, opts) {
    const reqs3 = []; page.on('request', (r) => { if (/vendor\/three\.module\.min\.js|pores3d\.js/.test(r.url())) reqs3.push(r.url()); });
    await page.goto(URL0, { waitUntil: 'networkidle' });
    if (opts.touch) await page.tap('.cl-poster-run'); else await page.click('.cl-poster-run');
    await converged(page);
    const beforeOpen = reqs3.length;
    if (opts.touch) await page.tap('#cl-tab-pores'); else await page.click('.cl-viewbar [data-view="pores"]');
    await page.waitForFunction(() => ['ready', 'failed'].includes(window.__continuumState.poresState), null, { timeout: 60000 });
    await page.waitForTimeout(1200);
    const look = () => page.evaluate(() => {
      const S = window.__continuumState, v = S.pores, c = document.querySelector('.cl-p3-canvas');
      let px = null;
      if (c) {                                                       // non-blank frame: count distinct colours of the drawn image
        const t = document.createElement('canvas'); t.width = 160; t.height = Math.round(160 * c.height / c.width);
        const g = t.getContext('2d'); g.drawImage(c, 0, 0, t.width, t.height);
        const d = g.getImageData(0, 0, t.width, t.height).data, set = new Set(); let nonBg = 0;
        for (let i = 0; i < d.length; i += 4) { set.add((d[i] >> 3) + ',' + (d[i + 1] >> 3) + ',' + (d[i + 2] >> 3)); if (Math.abs(d[i] - 13) + Math.abs(d[i + 1] - 27) + Math.abs(d[i + 2] - 42) > 24) nonBg++; }
        px = { colours: set.size, nonBgFrac: nonBg / (d.length / 4) };
      }
      return { state: S.poresState, stats: v ? v.stats() : null, d3: S.display3d, px, sel: S.sel.tube, rev: S.result.revision };
    });
    const a = await look();
    return { reqs3, beforeOpen, a, look };
  }
  function speedCheck(a) {
    const d3 = a.d3, st3 = a.stats; let worst = 0, ok = true;
    d3.tubes.forEach((t, i) => {
      const expect = t.blocked ? 0 : t.q * d3.factor;
      const e = expect === 0 ? Math.abs(t.speed) : rel(t.speed, expect); worst = Math.max(worst, e);
      if (e > 1e-12 || Math.abs(st3.speeds[i] - (t.blocked ? 0 : t.speed)) > 0) ok = false;
    });
    return { ok, worst };
  }
  function geomCheck(a) {
    const g = a.stats.geometry, sel = a.sel;
    const posOk = a.stats.positions.every((p) => Math.abs(p[2] - (p[0] - sel.ti) * 10) < 1e-9 && Math.abs(p[3] + (p[1] - sel.tj) * 10) < 1e-9);
    return posOk && Math.abs(g.pitch_nm - 10) < 1e-9 && Math.abs(g.L_nm - 2.4595) < 1e-9 && Math.abs(g.R_nm - 0.4069) < 1e-9;
  }
  const g3 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p3 = await g3.newPage(); const e3 = []; p3.on('pageerror', (e) => e3.push('3D desktop: ' + e.message));
  const r3 = await poresCheck(p3, {});
  const s1 = speedCheck(r3.a), geo1 = geomCheck(r3.a);
  await setDp(p3, 4); await converged(p3); await p3.waitForTimeout(400);
  const a4 = await r3.look();
  const s4 = speedCheck(a4);
  const ratio = a4.d3.tubes.map((t, i) => t.speed / r3.a.d3.tubes[i].speed);
  const ratioOk = ratio.every((x) => rel(x, 4) <= 1e-9) && rel(a4.d3.factor, r3.a.d3.factor) <= 1e-12 && a4.d3.fixed;
  await p3.click('.cl-block'); await converged(p3); await p3.waitForTimeout(400);
  const ab = await r3.look();
  const blockedOk = ab.d3.tubes.every((t) => t.blocked && t.speed === 0) && ab.stats.speeds.every((x) => x === 0) && ab.stats.markers.blocked === ab.stats.tubes;
  await g3.close();
  // reduced motion: molecules wait for Play
  const g3r = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const p3r = await g3r.newPage(); p3r.on('pageerror', (e) => e3.push('3D reduced motion: ' + e.message));
  const rr = await poresCheck(p3r, {});
  const ph0 = rr.a.stats.phase.slice(); await p3r.waitForTimeout(1000); const ph1 = (await rr.look()).stats.phase;
  const stillBefore = rr.a.stats.playing === false && ph0.every((x, i) => x === ph1[i]);
  await p3r.click('.cl-p3-play'); await p3r.waitForTimeout(1200); const ph2 = (await rr.look()).stats.phase;
  const movesAfter = ph2.some((x, i) => x !== ph1[i]);
  await g3r.close();
  // phone, touch
  const g3m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p3m = await g3m.newPage(); p3m.on('pageerror', (e) => e3.push('3D phone: ' + e.message));
  const rm3 = await poresCheck(p3m, { touch: true });
  const sm = speedCheck(rm3.a);
  await g3m.close();
  allErrors.push(...e3);
  const lazyOk = r3.beforeOpen === 0 && r3.reqs3.length >= 2 && rm3.beforeOpen === 0;
  const frameOk = (x) => x.a.px && x.a.px.colours > 40 && x.a.px.nonBgFrac > 0.15;
  const countOk = (x) => x.a.stats.renderedTubes === x.a.stats.tubes && x.a.stats.tubes === x.a.d3.tubes.length && x.a.stats.tubes === 25;
  const b14 = lazyOk && r3.a.state === 'ready' && rm3.a.state === 'ready' && frameOk(r3) && frameOk(rm3) && countOk(r3) && countOk(rm3) && geo1 && s1.ok && s4.ok && sm.ok && ratioOk && blockedOk && stillBefore && movesAfter && e3.length === 0;
  rec('B14', '3D pore view', b14,
    `3D library requested before the view was opened: ${r3.beforeOpen} (after: ${r3.reqs3.map((u) => u.replace(BASE, '')).join(', ')}); frame: ${r3.a.px.colours} colour classes, ${(100 * r3.a.px.nonBgFrac).toFixed(1)} % non-background (phone ${rm3.a.px.colours}, ${(100 * rm3.a.px.nonBgFrac).toFixed(1)} %); tubes reported ${r3.a.d3.tubes.length}, rendered ${r3.a.stats.renderedTubes}; true geometry and lattice positions ${geo1} (pitch ${r3.a.stats.geometry.pitch_nm.toPrecision(4)} nm, length ${r3.a.stats.geometry.L_nm.toPrecision(5)} nm, carbon-centre radius ${r3.a.stats.geometry.R_nm.toPrecision(4)} nm); speed = q_i × factor, worst relative deviation ${s1.worst.toExponential(2)} (factor ${r3.a.d3.factor.toExponential(6)} nm s⁻¹ per m³ s⁻¹, 1 s shown = ${r3.a.d3.T_ns.toFixed(3)} ns); at 4 MPa factor unchanged ${rel(a4.d3.factor, r3.a.d3.factor) <= 1e-12}, speed ratios ${Math.min(...ratio).toPrecision(12)}–${Math.max(...ratio).toPrecision(12)}; patch closed: ${ab.stats.markers.blocked} blocked markers on ${ab.stats.tubes} tubes, all speeds 0 ${blockedOk}; reduced motion: still before Play ${stillBefore}, moving after Play ${movesAfter}; page errors: ${e3.length ? e3.join(' | ') : 'none'}`);

  // ======================================================== B15 WebGL fallback
  const nogl = await chromium.launch({ executablePath: EXE, headless: true, args: ['--disable-webgl', '--disable-webgl2', '--disable-3d-apis'] });
  const g5 = await nogl.newContext({ viewport: { width: 1280, height: 900 } });
  const p5 = await g5.newPage(); const e5 = []; p5.on('pageerror', (e) => e5.push(e.message));
  await p5.goto(URL0, { waitUntil: 'networkidle' });
  await p5.click('.cl-poster-run'); await converged(p5);
  await p5.click('.cl-viewbar [data-view="pores"]');
  await p5.waitForFunction(() => ['ready', 'failed'].includes(window.__continuumState.poresState), null, { timeout: 60000 });
  const f5 = await p5.evaluate(() => ({ state: window.__continuumState.poresState, msg: document.querySelector('.cl-p3-msg').textContent, posterShown: !document.querySelector('.cl-p3-poster').hidden, status: window.__continuumState.status }));
  await nogl.close();
  const b15 = f5.state === 'failed' && /WebGL/.test(f5.msg) && f5.posterShown && f5.status === 'converged' && e5.length === 0;
  rec('B15', 'WebGL fallback', b15, `WebGL disabled: view state ${f5.state}; message shown ${f5.posterShown}: “${f5.msg}”; experiment status ${f5.status}; page errors: ${e5.length ? e5.join(' | ') : 'none'}`);

  // ======================================================== B16 3D view: presets, openings, provenance, caption (2026.8)
  const e16 = [];
  const settle = (page) => page.waitForFunction(() => { const v = window.__continuumState.pores; return v && !v.stats().animating; }, null, { timeout: 20000 }).then(() => page.waitForTimeout(250));
  const view16 = (page) => page.evaluate(() => {
    const S = window.__continuumState, U = window.ContinuumUnits, v = S.pores, s = v.stats(), d3 = S.display3d;
    const tiles = Array.from(document.querySelectorAll('#cl-p3-legend .cl-p3-tile')).map((t) => ({ k: t.querySelector('.cl-tile-k').textContent, v: t.querySelector('.cl-p3-v').textContent }));
    const sel = d3.tubes.find((t) => t.selected);
    const legend = document.getElementById('cl-p3-legend');
    const before = (q) => { const n = document.querySelector(q); return !!n && !!(n.compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_FOLLOWING); };
    const clone = document.body.cloneNode(true); const vsec = clone.querySelector('#validation'); if (vsec) vsec.remove();   // the Validation section quotes criteria and records verbatim
    return { s, factor: d3.factor, speeds: d3.tubes.map((t) => t.speed), q: d3.tubes.map((t) => t.q), blockedSel: sel.blocked, tiles,
      expSel: sel.blocked ? 'Blocked: no net flow' : U.fmt3(sel.q * U.C.rhoRef / U.C.mWater * 1e-9) + ' molecules/ns', expQ: U.fmt3(S.result.diag.Q_m3_s) + ' m³/s',
      expOpen: U.fmtInt(d3.openPores) + ' of ' + U.fmtInt(d3.poresTotal), openPores: d3.openPores, poresTotal: d3.poresTotal,
      badge: (document.querySelector('.cl-viewport-pores .cl-vbadge') || {}).textContent, tag: (document.querySelector('.cl-pane-molecule .cl-source-tag') || {}).textContent,
      order: ['.cl-p3-focus', '.cl-p3-array', '.cl-p3-play', '.cl-p3-reset'].every(before), standsStill: /stands still/.test(clone.textContent),
      pressed: { focus: document.querySelector('.cl-p3-focus').getAttribute('aria-pressed'), array: document.querySelector('.cl-p3-array').getAttribute('aria-pressed') } };
  });
  const g16 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p16 = await g16.newPage(); p16.on('pageerror', (e) => e16.push('B16 desktop: ' + e.message));
  await p16.goto(URL0, { waitUntil: 'networkidle' });
  await p16.click('.cl-poster-run'); await converged(p16);
  await p16.click('.cl-viewbar [data-view="pores"]');
  await p16.waitForFunction(() => window.__continuumState.poresState === 'ready', null, { timeout: 60000 }); await settle(p16);
  const f16 = await view16(p16);
  await p16.click('.cl-p3-array'); await settle(p16);
  const a16 = await view16(p16);
  await p16.selectOption('#cl-factor', '0'); await p16.click('.cl-apply'); await converged(p16); await p16.waitForTimeout(400);
  const c16 = await view16(p16);
  await g16.close();
  // guided path to its sixth step
  const g16g = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p16g = await g16g.newPage(); p16g.on('pageerror', (e) => e16.push('B16 guided: ' + e.message));
  await p16g.goto(URL0, { waitUntil: 'networkidle' });
  for (let k = 0; k < 6; k++) {
    await p16g.waitForFunction(() => !document.querySelector('.cl-guide-do').disabled, null, { timeout: 120000 });
    await p16g.click('.cl-guide-do'); await p16g.waitForTimeout(150); await converged(p16g);
  }
  await p16g.waitForFunction(() => window.__continuumState.poresState === 'ready', null, { timeout: 60000 }); await settle(p16g);
  const gg16 = await p16g.evaluate(() => ({ preset: window.__continuumState.pores.stats().preset, pressed: document.querySelector('.cl-p3-array').getAttribute('aria-pressed'), visible: !document.getElementById('cl-pane-pores').hidden, text: document.getElementById('cl-guide-text').textContent }));
  await g16g.close();
  // phone, touch
  const g16m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p16m = await g16m.newPage(); p16m.on('pageerror', (e) => e16.push('B16 phone: ' + e.message));
  await p16m.goto(URL0, { waitUntil: 'networkidle' });
  await p16m.tap('.cl-poster-run'); await converged(p16m);
  await p16m.tap('#cl-tab-pores');
  await p16m.waitForFunction(() => window.__continuumState.poresState === 'ready', null, { timeout: 60000 }); await settle(p16m);
  const m16 = await view16(p16m);
  await p16m.tap('.cl-p3-array'); await settle(p16m);
  const ma16 = await view16(p16m);
  await g16m.close();
  allErrors.push(...e16);
  const focusOk = (x) => x.s.preset === 'focus' && x.s.targetToSelected_nm < 2 && x.s.orbit.dist < 10 && x.s.scaleBar === '1 nm';
  const arrayOk = (x) => x.s.preset === 'array' && x.s.orbit.dist > 15 && x.s.scaleBar === '5 nm';
  const same = (x, y) => x.s.tubes === y.s.tubes && JSON.stringify(x.s.positions) === JSON.stringify(y.s.positions) && rel(x.factor, y.factor) <= 1e-12 && x.speeds.every((v, i) => (v === 0 ? y.speeds[i] === 0 : rel(v, y.speeds[i]) <= 1e-12));
  const openOk = (x) => x.s.openings && x.s.openings.holes === 20 && x.s.openings.notches === 5 && x.s.openings.faces === 2;
  const capOk = (x, nOpen) => x.tiles.length === 3 && x.tiles[0].v === x.expSel && x.tiles[1].v === x.expQ && x.tiles[2].v === x.expOpen && x.openPores === nOpen && x.poresTotal === 40000;
  const waterOk = Math.abs(f16.s.water.dOH_nm - 0.1) < 1e-12 && Math.abs(f16.s.water.angleHOH_deg - 109.47) < 1e-9;
  const b16 = focusOk(f16) && arrayOk(a16) && same(f16, a16) && openOk(f16) && f16.badge === 'Continuum-driven schematic' && f16.tag === 'Recorded CP2K AIMD' && f16.order &&
    capOk(f16, 40000) && capOk(c16, 39999) && c16.blockedSel && !f16.standsStill && !c16.standsStill && waterOk && a16.pressed.array === 'true' && a16.pressed.focus === 'false' &&
    gg16.preset === 'array' && gg16.pressed === 'true' && gg16.visible && !/stands still/.test(gg16.text) && focusOk(m16) && arrayOk(ma16) && same(m16, ma16) && e16.length === 0;
  rec('B16', '3D view: presets, openings, provenance, caption', b16,
    `opens on ${f16.s.preset} (target ${f16.s.targetToSelected_nm.toFixed(2)} nm from the selected tube, camera distance ${f16.s.orbit.dist.toFixed(2)} nm, bar ${f16.s.scaleBar}); Array context: distance ${a16.s.orbit.dist.toFixed(2)} nm, bar ${a16.s.scaleBar}, tubes, positions, speeds and factor unchanged ${same(f16, a16)}; openings ${JSON.stringify(f16.s.openings)}; badge “${f16.badge}”, molecule tag “${f16.tag}”; controls before the caption ${f16.order}; ` +
    `caption: “${f16.tiles.map((t) => t.k + ': ' + t.v).join('; ')}” (expected ${f16.expSel}, ${f16.expQ}, ${f16.expOpen}); one tube closed: “${c16.tiles.map((t) => t.k + ': ' + t.v).join('; ')}”; 2026.7 blocked-water wording outside the Validation section ${f16.standsStill || c16.standsStill}; water O–H ${f16.s.water.dOH_nm} nm, H–O–H ${f16.s.water.angleHOH_deg}°; ` +
    `guided step 6: preset ${gg16.preset}, Array context pressed ${gg16.pressed}; phone: opens on ${m16.s.preset} (distance ${m16.s.orbit.dist.toFixed(2)} nm, bar ${m16.s.scaleBar}), Array context ${ma16.s.orbit.dist.toFixed(2)} nm (${ma16.s.scaleBar}); page errors: ${e16.length ? e16.join(' | ') : 'none'}`);

  // ======================================================== R1 regression
  const rg = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const g = await rg.newPage();
  const rerr = []; g.on('pageerror', (e) => rerr.push(e.message));
  await g.goto(BASE + 'index.html', { waitUntil: 'networkidle' });
  const cvHref = await g.getAttribute('a[href$="Kazi_Ehsanul_Karim_CV.pdf"]', 'href');
  const cv = await g.request.get(BASE + cvHref);
  const contLink = await g.$('a[href="lab/continuum/"]');
  await g.goto(BASE + 'lab/water/?test=1', { waitUntil: 'networkidle' });
  await g.click('.wl-start-big');
  await g.waitForFunction(() => window.__waterLab && window.__waterLab.ready && window.__waterLab.snap && window.__waterLab.snap.step > 0, null, { timeout: 120000 });
  const wstep = await g.evaluate(() => window.__waterLab.snap.step);
  await g.goto(BASE + 'lab/cnt/', { waitUntil: 'networkidle' });
  await g.click('.insp-start'); await g.waitForTimeout(1500);
  const tA = await g.textContent('.insp-time'); await g.click('.insp-play'); await g.waitForTimeout(1500); const tB = await g.textContent('.insp-time');
  await g.goto(BASE + 'evidence/nacl-water-cnt/index.html', { waitUntil: 'networkidle' });
  const evTitle = await g.title();
  await rg.close();
  rec('R1', 'Regression', rerr.length === 0 && cv.status() === 200 && /pdf/.test(cv.headers()['content-type'] || '') && wstep > 0 && tA !== tB && !!contLink,
    `home page and Continuum Lab link ${contLink ? 'present' : 'MISSING'}; CV ${cvHref} HTTP ${cv.status()} (${cv.headers()['content-type']}); Water Lab ran to step ${wstep}; CNT inspector time ${tA} → ${tB} after Play; evidence page “${evTitle}”; page errors: ${rerr.length ? rerr.join(' | ') : 'none'}`);

  await browser.close();
  const pass = items.every((i) => i.verdict === 'PASS');
  const res = { id: 'browser', name: 'Browser and regression B1-B16, R1', verdict: pass ? 'PASS' : 'FAIL', chromium: version, items,
    environment: 'Chromium ' + version + ' (headless shell, Playwright) on ' + os.cpus()[0].model + ' (' + os.cpus().length + ' cores); local static server; no Safari, Firefox or real phones' };
  fs.writeFileSync(path.join(ROOT, 'tools/continuum/results/browser.json'), JSON.stringify(res, null, 1) + '\n');
  console.log('browser:', res.verdict, '-', items.filter((i) => i.verdict === 'PASS').length, 'of', items.length, 'passed');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
