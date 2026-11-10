// Browser tests IB1–IB13 for the ion experiment (/lab/continuum/; criteria: tools/continuum/ions/TOLERANCES.md, written
// before the page existed; IB11, the numerical controller, added for release 2026.10, IB12, the failed-run display, for
// release 2026.10.1 and IB13, the recorded shell motion, for release 2026.10.2, each before it was run).
// IB1 procedure amended for release 2026.10 (criterion unchanged): a dedicated worker is also counted through
// Playwright's 'worker' event, because the 'request' event of the Chromium build used for 2026.10 does not report it. WebGL runs on SwiftShader in headless Chromium. Numbers are compared with the Node solver
// (lab/continuum/ions/core.js, params.js) run on the same inputs; the page state is read through window.__ionLab.
// IB10 fixture for release 2026.12 (criterion unchanged): the experiment switch has three entries, the flow benchmark first.
// Usage: node tools/continuum/ions/browser_ions.js [base URL]   (serve the repository root first)
// Writes tools/continuum/results/browser_ions.json; exits 1 if any test fails.
'use strict';
const path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = (process.argv[2] || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
const EXE = process.env.CHROMIUM || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const SITE = path.resolve(__dirname, '../../..');
const Core = require(path.join(SITE, 'lab/continuum/ions/core.js'));
const Pm = require(path.join(SITE, 'lab/continuum/ions/params.js'));
const Ctl = require(path.join(SITE, 'lab/continuum/ions/controller.js'));
const URL0 = BASE + 'lab/continuum/', URLW = BASE + 'lab/continuum/water.html';
const GL = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const items = [];
const rec = (id, name, pass, detail) => { items.push({ id, name, verdict: pass ? 'PASS' : 'FAIL', detail }); console.log((pass ? 'PASS ' : 'FAIL ') + id + ' ' + name + ' — ' + detail); };
const rel = (a, b) => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)));
const e2 = (x) => Number(x).toExponential(2);
const f3pA = (I) => { const v = I * 1e12; return (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? null : Number(v.toPrecision(3)).toString()) + ' pA'; };
const SOLVER = /ions\/(core|params|controller|worker|charts|ions3d)\.js|ions\/data\/hydration\.json|vendor\/three/;   // controller.js added in 2026.10

const state = (p) => p.evaluate(() => { const S = window.__ionLab.state(); return { req: S.req, done: !!S.res.done, opts: S.res.main && S.res.main.opts, I: S.res.main && S.res.main.model.I, ok: S.res.main && S.res.main.model.ok }; });
async function runDone(p, req0, timeout) {
  await p.waitForFunction((r0) => { const S = window.__ionLab && window.__ionLab.state(); return S && S.req > r0 && S.res && S.res.done; }, req0, { timeout: timeout || 120000 });
  await p.waitForTimeout(200);
}
const req = (p) => p.evaluate(() => (window.__ionLab ? window.__ionLab.state().req : 0));

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: GL });
  const version = browser.version();
  const allErrors = [];

  // ===================================================== IB1 lazy start, IB2 run, IB7 (first part: three.js only with the view)
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => allErrors.push('desktop: ' + e.message));
  const reqs = []; p.on('request', (r) => reqs.push({ url: r.url(), t: Date.now() }));
  p.on('worker', (w) => reqs.push({ url: w.url(), t: Date.now(), worker: true }));   // IB1 procedure, release 2026.10
  await p.goto(URL0, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const before = reqs.filter((r) => SOLVER.test(r.url)).map((r) => r.url.replace(BASE, ''));
  const tStart = Date.now();
  await p.click('.ion-poster-run');
  await runDone(p, 0);
  await p.waitForFunction(() => window.__ionLab.view() && window.__ionLab.view().stats().frames > 2, null, { timeout: 60000 });
  const after = [...new Set(reqs.filter((r) => SOLVER.test(r.url) && r.t >= tStart).map((r) => r.url.replace(BASE, '')))];
  const need = ['ions/core.js', 'ions/params.js', 'ions/controller.js', 'ions/worker.js', 'ions/charts.js', 'ions/ions3d.js', 'vendor/three.module.min.js'];
  const ib1 = before.length === 0 && need.every((n) => after.some((u) => u.endsWith(n)));
  rec('IB1', 'Lazy start', ib1, `requested during load + 1.5 s: ${before.length ? before.join(', ') : 'none of the solver, worker, chart, data or 3D files'}; after Start: ${after.map((u) => u.split('/').slice(-2).join('/')).join(', ')}`);

  const s2 = await state(p);
  const node2 = Core.solve(Pm.build(s2.opts).s);
  const d2 = rel(s2.I, node2.I);
  rec('IB2', 'Run', s2.ok && node2.ok && d2 <= 1e-12, `default experiment (${s2.opts.preset}, step ${s2.opts.step}, ${Math.round(s2.opts.V * 1000)} mV): page I = ${e2(s2.I)} A, Node ${e2(node2.I)} A, relative difference ${e2(d2)}; converged in the page: ${s2.ok}`);

  // ===================================================== IB3 model ladder
  const ladder = [];
  let ib3 = true; const det3 = [];
  for (let step = 1; step <= 6; step++) {
    const r0 = await req(p);
    await p.click(`input[name="ion-step"][value="${step}"]`);
    await runDone(p, r0);
    const pg = await p.evaluate(() => { const S = window.__ionLab.state(); return { opts: S.res.main.opts, I: S.res.main.model.I, why: document.getElementById('ion-why').textContent, ivRef: S.res.iv.reference.map((q) => q.I), ivModel: S.res.iv.model.map((q) => q.I), lad: S.res.main.ladder.map((q) => q.I) }; });
    const nm = Core.solve(Pm.build(pg.opts).s), VS = []; for (let v = -200; v <= 200; v += 25) VS.push(v / 1000);
    const refIV = Core.ivCurve(Pm.build(Object.assign({}, pg.opts, { step: 1 })).s, VS);
    const refOK = pg.ivRef.every((v, i) => rel(v, refIV[i].I) <= 1e-12);
    const stepOK = pg.opts.step === step && rel(pg.I, nm.I) <= 1e-12;
    const quotesCur = pg.why.includes(f3pA(pg.I)), quotesPrev = step === 1 ? true : pg.why.includes(f3pA(pg.lad[step - 2]));
    ladder.push(pg.I);
    const ok = stepOK && refOK && quotesCur && quotesPrev;
    ib3 = ib3 && ok;
    det3.push(`step ${step}: I ${f3pA(pg.I)}${step > 1 ? ' (sentence quotes ' + f3pA(pg.lad[step - 2]) + ' → ' + f3pA(pg.I) + ': ' + (quotesCur && quotesPrev) + ')' : ' (sentence quotes it: ' + quotesCur + ')'}, classical reference curve equals Node step 1: ${refOK}`);
  }
  const distinct = new Set(ladder.map((v) => v.toPrecision(12))).size === 6;
  rec('IB3', 'Model ladder', ib3 && distinct, det3.join('; ') + `; six different currents: ${distinct}`);

  // ===================================================== IB4 geometry presets
  const presetRes = []; let ib4 = true; const det4 = [];
  for (const pr of ['6,6', '7,7', '9,9', '11,11']) {
    const r0 = await req(p);
    await p.selectOption('#ion-preset', pr);
    await runDone(p, r0);
    const g = await p.evaluate(() => { const S = window.__ionLab.state(); const svg = document.querySelector('#ion-hyd svg'); return { opts: S.res.main.opts, I: S.res.main.model.I, aria: svg ? svg.getAttribute('aria-label') : '', flags: S.res.main.model.flags.map((f) => f.id) }; });
    const label = Pm.presetOf(pr).label, hl = g.aria.includes('In the ' + label + ' tube');
    const nI = Core.solve(Pm.build(g.opts).s).I;
    ib4 = ib4 && hl && rel(g.I, nI) <= 1e-12 && g.opts.preset === pr;
    presetRes.push(g.I);
    det4.push(`${label}: I ${f3pA(g.I)} (Node agrees: ${rel(g.I, nI) <= 1e-12}), chart highlights it: ${hl}${g.flags.includes('single-file') ? ', flagged single-file' : ''}`);
  }
  const distinct4 = new Set(presetRes.map((v) => v.toPrecision(12))).size === 4;
  rec('IB4', 'Geometry presets', ib4 && distinct4, det4.join('; ') + `; four different results: ${distinct4}`);
  { const r0 = await req(p); await p.selectOption('#ion-preset', '7,7'); await runDone(p, r0); }

  // ===================================================== IB5 evidence
  await p.click('#ion-evidence-drawer summary');
  const ev = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#ion-evidence tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent.trim()));
    return { rows, open: document.getElementById('ion-evidence-drawer').open, md: /MD-informed/.test(document.querySelector('#ion-evidence tbody').textContent), opts: window.__ionLab.state().res.main.opts };
  });
  const allowed = ['Literature', 'Recorded (CP2K)', 'Derived', 'Illustrative', 'Setting'];
  const complete = ev.rows.every((r) => r.length === 6 && r.slice(0, 5).every((x) => x.length > 0) && allowed.includes(r[5]));
  const reg = Pm.registry(ev.opts);
  const counts = {}; ev.rows.forEach((r) => { counts[r[5]] = (counts[r[5]] || 0) + 1; });
  rec('IB5', 'Evidence', ev.open && complete && !ev.md && ev.rows.length === reg.length, `${ev.rows.length} inputs (registry ${reg.length}), each with value, units, source, conditions and status: ${complete}; statuses ${JSON.stringify(counts)}; “MD-informed” used: ${ev.md}`);

  // ===================================================== IB6 what to compute next
  const nx = await p.evaluate(() => { const S = window.__ionLab.state(); return { rows: S.res.sens.rows.map((r) => ({ id: r.id, factor: r.factor, Ilo: r.Ilo, Ihi: r.Ihi })), text: document.querySelector('.ion-next-card').textContent, opts: S.res.main.opts }; });
  const base = Core.solve(Pm.build(Object.assign({}, nx.opts, { V: 0.1 })).s);
  const nodeRows = Pm.sensitivityInputs(nx.opts).map((inp) => {
    const lo = Core.solve(Pm.build(Object.assign({}, nx.opts, inp.lo, { V: 0.1 })).s, { prev: base.state }), hi = Core.solve(Pm.build(Object.assign({}, nx.opts, inp.hi, { V: 0.1 })).s, { prev: base.state });
    return { id: inp.id, factor: Math.max(Math.abs(hi.I), Math.abs(lo.I)) / Math.min(Math.abs(hi.I), Math.abs(lo.I)) };
  }).sort((a, b) => b.factor - a.factor);
  const sameOrder = nx.rows.map((r) => r.id).join() === nodeRows.map((r) => r.id).join();
  const sorted = nx.rows.every((r, i) => i === 0 || nx.rows[i - 1].factor >= r.factor);
  const fac = Math.max(...nx.rows.map((r, i) => rel(r.factor, nodeRows[i].factor)));
  const ruleBased = /Rule-based/.test(nx.text) && /No learning is involved/.test(nx.text);
  rec('IB6', 'What to compute next', sameOrder && sorted && fac <= 1e-9 && ruleBased, `ranking ${nx.rows.map((r) => r.id + ' ×' + r.factor.toPrecision(3)).join(', ')}; same order as Node: ${sameOrder}; factors agree to ${e2(fac)}; sorted by computed effect: ${sorted}; states that it is rule-based: ${ruleBased}`);

  // ===================================================== IB7 3D view
  const r7 = await req(p);
  await p.click('input[name="ion-step"][value="1"]'); await runDone(p, r7);
  await p.waitForTimeout(400);
  const px = await p.evaluate(() => {
    const c = document.querySelector('.ion-3d-canvas'), w = c.width, h = c.height, g = document.createElement('canvas'); g.width = 160; g.height = 110;
    const x = g.getContext('2d'); x.drawImage(c, 0, 0, 160, 110); const d = x.getImageData(0, 0, 160, 110).data; let n = 0, lum = new Set();
    for (let i = 0; i < d.length; i += 4) { if (Math.abs(d[i] - 13) + Math.abs(d[i + 1] - 27) + Math.abs(d[i + 2] - 42) > 30) n++; lum.add((d[i] >> 4) + '-' + (d[i + 1] >> 4) + '-' + (d[i + 2] >> 4)); }
    return { frac: n / (160 * 110), colours: lum.size, w, h };
  });
  const overlays = [];
  for (const ov of ['phi', 'flux', 'conc']) {
    await p.click(`[data-overlay="${ov}"]`); await p.waitForTimeout(150);
    overlays.push(await p.evaluate(() => ({ pressed: [...document.querySelectorAll('[data-overlay]')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('data-overlay')), legend: document.querySelector('#ion-legend .cl-legend-title') ? document.querySelector('#ion-legend .cl-legend-title').textContent : '', ticks: document.querySelectorAll('#ion-legend .cl-legend-ticks span').length, view: window.__ionLab.view().stats().overlay })));
  }
  const oneAtATime = overlays.every((o, i) => o.pressed.length === 1 && o.pressed[0] === ['phi', 'flux', 'conc'][i] && o.view === o.pressed[0] && o.legend.length > 0 && o.ticks >= 2);
  // drift at +100 mV (classical model: both ions carry current)
  const d0 = await p.evaluate(() => window.__ionLab.view().stats().displacement_nm);
  await p.waitForTimeout(2000);
  const d1 = await p.evaluate(() => ({ disp: window.__ionLab.view().stats().displacement_nm, V: window.__ionLab.state().res.main.opts.V, J: window.__ionLab.state().res.main.model.J }));
  const dNa = d1.disp[0] - d0[0], dCl = d1.disp[1] - d0[1];
  const driftOK = d1.V > 0 && dNa > 0 && dCl < 0;
  // reduced motion
  const rm = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const pr = await rm.newPage(); const er = []; pr.on('pageerror', (e) => er.push(e.message));
  await pr.goto(URL0, { waitUntil: 'networkidle' });
  await pr.click('input[name="ion-step"][value="1"]');
  await pr.click('.ion-poster-run'); await runDone(pr, 0);
  await pr.waitForFunction(() => window.__ionLab.view() && window.__ionLab.view().stats().frames > 0, null, { timeout: 60000 });
  const m0 = await pr.evaluate(() => window.__ionLab.view().stats()); await pr.waitForTimeout(1500);
  const m1 = await pr.evaluate(() => window.__ionLab.view().stats());
  await pr.click('.ion-play'); await pr.waitForTimeout(1500);
  const m2 = await pr.evaluate(() => window.__ionLab.view().stats());
  await rm.close();
  const still = !m0.playing && m1.displacement_nm[0] === m0.displacement_nm[0] && m1.displacement_nm[1] === m0.displacement_nm[1];
  const movesAfterPlay = m2.playing && m2.displacement_nm[0] !== m1.displacement_nm[0];
  // no WebGL
  const nogl = await chromium.launch({ executablePath: EXE, headless: true, args: ['--disable-webgl', '--disable-webgl2', '--disable-3d-apis'] });
  const gctx = await nogl.newContext({ viewport: { width: 1280, height: 900 } }); const pg = await gctx.newPage(); const eg = []; pg.on('pageerror', (e) => eg.push(e.message));
  const greq = []; pg.on('request', (r) => greq.push(r.url()));
  await pg.goto(URL0, { waitUntil: 'networkidle' }); await pg.click('.ion-poster-run'); await runDone(pg, 0);
  const fb = await pg.evaluate(() => ({ shown: !document.querySelector('.ion-3d-fallback').hidden, text: document.querySelector('.ion-3d-fallback').textContent, ok: window.__ionLab.state().res.main.model.ok, I: document.getElementById('ion-I').textContent }));
  await nogl.close();
  const threeNoGL = greq.some((u) => /three\.module/.test(u));
  const ib7 = px.frac > 0.2 && px.colours > 40 && oneAtATime && driftOK && still && movesAfterPlay && fb.shown && /WebGL/.test(fb.text) && fb.ok && !threeNoGL && eg.length === 0 && er.length === 0;
  rec('IB7', '3D view', ib7, `three.js requested only after Start (IB1); frame non-blank: ${(100 * px.frac).toFixed(1)} % non-background pixels, ${px.colours} colour classes; overlays one at a time with a legend: ${oneAtATime} (${overlays.map((o) => o.view + ': “' + o.legend + '”').join('; ')}); at ${Math.round(d1.V * 1000)} mV markers moved ${dNa.toFixed(2)} nm (Na⁺, towards the permeate) and ${dCl.toFixed(2)} nm (Cl⁻, towards the feed) in 2 s; reduced motion: still before Play ${still}, moving after Play ${movesAfterPlay}; without WebGL: fallback shown ${fb.shown} (“${fb.text.trim().slice(0, 70)}…”), result ${fb.I} converged ${fb.ok}, three.js requested ${threeNoGL}; page errors ${eg.length + er.length}`);

  // ===================================================== IB8 keyboard, touch, layout
  const kb = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const pk = await kb.newPage(); const ek = []; pk.on('pageerror', (e) => ek.push(e.message));
  await pk.goto(URL0, { waitUntil: 'networkidle' });
  await pk.focus('.ion-poster-run'); await pk.keyboard.press('Enter'); await runDone(pk, 0);
  let r8 = await req(pk);
  await pk.focus('#ion-V'); await pk.keyboard.press('ArrowRight'); await runDone(pk, r8);
  const kV = (await state(pk)).opts.V;
  r8 = await req(pk);
  await pk.focus('input[name="ion-step"][value="6"]'); await pk.keyboard.press('ArrowUp'); await runDone(pk, r8);
  const kStep = (await state(pk)).opts.step;
  r8 = await req(pk);
  await pk.focus('#ion-preset'); await pk.keyboard.press('ArrowDown'); await runDone(pk, r8);
  const kPreset = (await state(pk)).opts.preset;
  await pk.focus('[data-prof="phi"]'); await pk.keyboard.press('Enter'); await pk.waitForTimeout(100);
  const kProf = await pk.evaluate(() => document.querySelector('[data-prof="phi"]').getAttribute('aria-pressed'));
  await kb.close();
  const keyboardOK = Math.abs(kV - 0.105) < 1e-12 && kStep === 5 && kPreset === '9,9' && kProf === 'true';
  const tc = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const pt = await tc.newPage(); const et = []; pt.on('pageerror', (e) => et.push(e.message));
  await pt.goto(URL0, { waitUntil: 'networkidle' });
  await pt.tap('.ion-poster-run'); await runDone(pt, 0);
  let r8t = await req(pt);
  await pt.tap('.ion-step[data-step="2"]'); await runDone(pt, r8t);
  const tStep = (await state(pt)).opts.step;
  await pt.tap('[data-overlay="phi"]'); await pt.waitForTimeout(150);
  const tOv = await pt.evaluate(() => document.querySelector('[data-overlay="phi"]').getAttribute('aria-pressed'));
  await tc.close();
  const touchOK = tStep === 2 && tOv === 'true';
  const widths = [360, 390, 768, 1440], over = [];
  for (const w of widths) {
    const c = await browser.newContext({ viewport: { width: w, height: 900 }, isMobile: w < 800, hasTouch: w < 800 }); const q = await c.newPage(); const eq = []; q.on('pageerror', (e) => eq.push(e.message));
    await q.goto(URL0, { waitUntil: 'networkidle' }); await q.click('.ion-poster-run'); await runDone(q, 0);
    await q.evaluate(() => { document.querySelectorAll('details').forEach((d) => { d.open = true; }); }); await q.waitForTimeout(300);
    over.push({ w, o: await q.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), e: eq.length });
    await c.close();
  }
  const layoutOK = over.every((o) => o.o <= 0 && o.e === 0);
  rec('IB8', 'Keyboard, touch, layout', keyboardOK && touchOK && layoutOK && ek.length === 0 && et.length === 0, `keyboard: Enter on Start, → on the voltage slider (now ${Math.round(kV * 1000)} mV), ↑ on the model ladder (step ${kStep}), ↓ on the tube preset (${kPreset}), Enter on a profile button (pressed ${kProf}); touch at 390 px: tap Start, tap step 2 (step ${tStep}), tap Potential (pressed ${tOv}); horizontal overflow with all sections open: ${over.map((o) => o.w + ' px ' + o.o).join(', ')}; page errors ${ek.length + et.length + over.reduce((a, o) => a + o.e, 0)}`);

  // ===================================================== IB9 export
  const r9 = await req(p);
  await p.click('input[name="ion-step"][value="6"]'); await runDone(p, r9);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ions-dl-'));
  const [dj] = await Promise.all([p.waitForEvent('download'), p.click('.ion-dl-json')]);
  const fj = path.join(tmp, dj.suggestedFilename()); await dj.saveAs(fj);
  const [dc] = await Promise.all([p.waitForEvent('download'), p.click('.ion-dl-csv')]);
  const fc = path.join(tmp, dc.suggestedFilename()); await dc.saveAs(fc);
  let out9 = '', code9 = 0;
  try { out9 = cp.execFileSync('node', [path.join(__dirname, 'reproduce_ions.js'), fj, '--csv', fc], { encoding: 'utf8' }); } catch (e) { code9 = e.status || 1; out9 = String(e.stdout || '') + String(e.stderr || ''); }
  const j9 = JSON.parse(fs.readFileSync(fj, 'utf8'));
  const hashes = (j9.environment && j9.environment.solver_files || []).every((f) => /^[0-9a-f]{64}$/.test(f.sha256 || ''));
  rec('IB9', 'Export', code9 === 0 && hashes, `${path.basename(fj)} and ${path.basename(fc)} downloaded; solver-file hashes recorded: ${hashes}; reproduce_ions.js: ${out9.trim().split('\n').slice(-1)[0]} (exit ${code9})`);

  // ===================================================== IB10 water experiment, switches, external requests
  const wc = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const pw = await wc.newPage(); const ew = []; pw.on('pageerror', (e) => ew.push(e.message));
  const wreq = []; pw.on('request', (r) => wreq.push(r.url()));
  await pw.goto(URLW, { waitUntil: 'networkidle' });
  await pw.click('.cl-poster-run');
  await pw.waitForFunction(() => { const S = window.__continuumState; return S && S.status === 'converged' && S.result && S.result.revision === S.revision; }, null, { timeout: 120000 });
  const wQ = await pw.evaluate(() => window.__continuumState.result.diag.Q_m3_s);
  const sw1 = await pw.evaluate(() => [...document.querySelectorAll('.ion-switch a')].map((a) => ({ href: a.href, cur: a.getAttribute('aria-current') })));
  await pw.click('.ion-switch a[href="./"]'); await pw.waitForLoadState('networkidle');
  const atIon = pw.url().replace(/#.*$/, '') === URL0 && (await pw.$('#ion-lab')) !== null;
  const sw2 = await pw.evaluate(() => [...document.querySelectorAll('.ion-switch a')].map((a) => ({ href: a.href, cur: a.getAttribute('aria-current') })));
  await pw.click('.ion-switch a[href="water.html"]'); await pw.waitForLoadState('networkidle');
  const atWater = pw.url() === URLW && (await pw.$('#continuum-lab')) !== null;
  await wc.close();
  const allReq = reqs.map((r) => r.url).concat(wreq);
  const external = [...new Set(allReq.filter((u) => !u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')))];
  // release 2026.12: the switch has three entries (flow benchmark, ion transport, water flow); criterion unchanged
  const one = (sw, i) => sw.length === 3 && sw[i].cur === 'page' && sw.filter((a) => a.cur).length === 1 && /\/lab\/continuum\/flow\.html$/.test(sw[0].href);
  const switchesOK = one(sw1, 2) && one(sw2, 1) && atIon && atWater;
  rec('IB10', 'Water experiment', wQ > 0 && switchesOK && external.length === 0 && ew.length === 0, `water.html converged, Q = ${e2(wQ)} m³ s⁻¹; switches with ${sw1.length} and ${sw2.length} entries, the flow benchmark first: ${/flow\.html$/.test((sw1[0] || {}).href || '') && /flow\.html$/.test((sw2[0] || {}).href || '')}; switch on the water page marks it current and leads to the ion page: ${atIon}; switch on the ion page marks it current and leads back: ${atWater}; external requests from both pages: ${external.length ? external.join(', ') : 'none'}; page errors ${ew.length}`);

  // ===================================================== IB11 the numerical controller in the page (release 2026.10)
  {
    const cc = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const pc = await cc.newPage(); const ec = [], creq = [];
    pc.on('pageerror', (e) => ec.push(e.message)); pc.on('request', (r) => creq.push(r.url()));
    await pc.goto(URL0, { waitUntil: 'networkidle' });
    await pc.click('.ion-poster-run'); await runDone(pc, 0);
    const read = () => pc.evaluate(() => { const S = window.__ionLab.state(); return { opts: S.res.opts, n: S.res.ctrl && S.res.ctrl.numerical, rec: S.res.decision && S.res.decision.record, chip: document.getElementById('ion-state').textContent, ctrlChip: document.getElementById('ion-ctrl-chip').textContent, rows: document.querySelectorAll('.ion-ctrl-table tbody tr').length, tile: document.getElementById('ion-I').textContent, ptile: document.getElementById('ion-P').textContent, request: document.getElementById('ion-request').textContent, hyd: [...document.querySelectorAll('.ion-mode-badge')].map((b) => b.closest('section') && b.closest('section').querySelector('#ion-hyd') ? b.textContent : '').join('') }; });
    const det = []; let ok = true;
    const compare = (pg, target) => {
      const q = Object.assign({}, pg.opts), node = Ctl.run(q), out = node.outcome;
      const levelsOk = pg.n.levels.length === node.levels.length && pg.n.levels.every((e, i) => e.decision === node.levels[i].decision && e.rule === node.levels[i].rule && rel(e.I_A, node.levels[i].I_A) <= 1e-12 && rel(e.V_rev_V, node.levels[i].V_rev_V) <= 1e-12);
      const statusOk = pg.n.outcome.status === out.status && pg.chip === Ctl.STATUS_TEXT[out.status] && pg.ctrlChip === Ctl.STATUS_TEXT[out.status];
      const repOk = pg.n.outcome.reported_level === out.reported_level && rel(pg.n.outcome.I_A, out.I_A) <= 1e-12 && rel(pg.n.outcome.V_rev_V, out.V_rev_V) <= 1e-12;
      const tileOk = out.I_A === null || pg.tile.includes(Number((out.I_A * 1e12).toPrecision(3)).toString());
      const rowsOk = pg.rows === node.levels.length;
      det.push(target + ': page “' + pg.chip + '”, levels ' + pg.n.levels.map((e) => e.level + ' ' + e.decision).join(', ') + ', reported level ' + pg.n.outcome.reported_level + ' (' + pg.tile + '); Node ' + out.status + ', reported level ' + out.reported_level + '; levels and decisions equal: ' + levelsOk + ', status and chips: ' + statusOk + ', reported values: ' + repOk + ', tile: ' + tileOk + ', table rows: ' + rowsOk);
      return levelsOk && statusOk && repOk && tileOk && rowsOk;
    };
    const p0 = await read();
    ok = ok && p0.chip === 'Numerical tolerance reached' && p0.n.levels.length === 2 && compare(p0, '0.5 %');
    // calculation request against an independent ranking (same procedure as IB6)
    const base = Core.solve(Pm.build(Object.assign({}, p0.opts, { V: 0.1 })).s);
    const top = Pm.sensitivityInputs(p0.opts).map((inp) => { const lo = Core.solve(Pm.build(Object.assign({}, p0.opts, inp.lo, { V: 0.1 })).s, { prev: base.state }), hi = Core.solve(Pm.build(Object.assign({}, p0.opts, inp.hi, { V: 0.1 })).s, { prev: base.state }); return { id: inp.id, name: inp.name, f: Math.max(Math.abs(hi.I), Math.abs(lo.I)) / Math.min(Math.abs(hi.I), Math.abs(lo.I)) }; }).sort((a, b) => b.f - a.f)[0];
    const reqOk = !!p0.rec.request && p0.rec.request.input_id === top.id && p0.request.includes(top.name) && /not run/.test(p0.request) && /nothing is submitted/.test(p0.request);
    det.push('request names ' + (p0.rec.request ? p0.rec.request.input_id : 'none') + ' (independent ranking: ' + top.id + ' ×' + top.f.toPrecision(3) + '), states not run and nothing submitted: ' + reqOk);
    const hydOk = /Recorded CP2K data/.test(p0.hyd) && /not recalculated at the selected voltage/.test(p0.hyd);
    det.push('hydration card label: “' + p0.hyd.trim() + '”');
    // download: the decision record inside the result validates and reproduces
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ions-ctl-'));
    const [dl] = await Promise.all([pc.waitForEvent('download'), pc.click('.ion-dl-json')]);
    const fj = path.join(tmp, dl.suggestedFilename()); await dl.saveAs(fj);
    const j = JSON.parse(fs.readFileSync(fj, 'utf8')), vrec = j.decision ? Ctl.validate(j.decision) : { valid: false, errors: ['no decision record'] };
    let outR = '', codeR = 0;
    try { outR = cp.execFileSync('node', [path.join(__dirname, 'reproduce_ions.js'), fj], { encoding: 'utf8' }); } catch (e) { codeR = e.status || 1; outR = String(e.stdout || '') + String(e.stderr || ''); }
    det.push('download: decision record present and valid: ' + vrec.valid + '; reproduce_ions.js: ' + outR.trim().split('\n').slice(-1)[0] + ' (exit ' + codeR + ')');
    // the two other targets, chosen in the select
    let tOk = true;
    for (const [val, label] of [['fine', '0.1 %'], ['strict', '0.02 %']]) {
      const r0 = await req(pc); await pc.selectOption('#ion-target', val); await runDone(pc, r0);
      const pg = await read(); tOk = tOk && pg.opts.target === val && compare(pg, label);
    }
    // keyboard: focus the target control and press ArrowUp (strict → fine)
    const r1 = await req(pc); await pc.focus('#ion-target'); await pc.keyboard.press('ArrowUp'); await runDone(pc, r1);
    const kb = await read(); const kbOk = kb.opts.target === 'fine' && compare(kb, 'keyboard ↑ (0.1 %)');
    await cc.close();
    const external = [...new Set(creq.filter((u) => !u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')))];
    det.push('target control by keyboard: ' + kbOk + '; external requests: ' + (external.length ? external.join(', ') : 'none') + '; page errors ' + ec.length);
    ok = ok && reqOk && hydOk && vrec.valid && codeR === 0 && tOk && kbOk && external.length === 0 && ec.length === 0;
    rec('IB11', 'Controller in the page', ok, det.join('; '));
  }

  // ===================================================== IB12 failed-run display (release 2026.10.1)
  // The controller's messages for a failed run are computed here in Node with controller.js and a solver forced to fail
  // gate G1 at grid level 2, then delivered to the page through its own worker message handler (nothing is changed in
  // the page's files).
  {
    const cf = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const pf = await cf.newPage(); const ef = [];
    pf.on('pageerror', (e) => ef.push(e.message));
    await pf.goto(URL0, { waitUntil: 'networkidle' });
    await pf.click('.ion-poster-run'); await runDone(pf, 0);
    const pg0 = await pf.evaluate(() => { const S = window.__ionLab.state(); return { opts: S.res.opts, version: S.res.decision && S.res.decision.record.website_version }; });
    const real = Ctl.defaultSolver();
    const failing = { current: (o, l) => { const r = real.current(o, l); return l === 2 ? Object.assign({}, r, { ok: false, residual: 1e-6 }) : r; }, reversal: (o, l) => real.reversal(o, l) };
    const nF = Ctl.run(pg0.opts, { solver: failing });
    const rF = Ctl.record(nF, Ctl.ranking(pg0.opts), { websiteVersion: pg0.version || '' });
    await pf.evaluate(([num, recd]) => {
      const S = window.__ionLab.state(), id = S.req;
      S.worker.onmessage({ data: { id, stage: 'ctrl', data: { numerical: num, ms: 0 } } });
      S.worker.onmessage({ data: { id, stage: 'decision', data: { record: recd } } });
    }, [nF, rF]);
    await pf.waitForTimeout(300);
    const v = await pf.evaluate(() => ({
      chip: document.getElementById('ion-ctrl-chip').textContent, state: document.getElementById('ion-state').textContent,
      msg: (document.querySelector('#ion-ctrl .ion-ctrl-msg') || {}).textContent || '', Is: document.getElementById('ion-I-s').textContent,
      Gs: document.getElementById('ion-G-s').textContent, reqText: document.getElementById('ion-request').textContent, reqBox: !!document.querySelector('#ion-request .ion-request'),
    }));
    const tmpF = fs.mkdtempSync(path.join(os.tmpdir(), 'ions-fail-'));
    const [dlF] = await Promise.all([pf.waitForEvent('download'), pf.click('.ion-dl-decision')]);
    const fF = path.join(tmpF, dlF.suggestedFilename()); await dlF.saveAs(fF);
    const dF = JSON.parse(fs.readFileSync(fF, 'utf8')), vF = Ctl.validate(dF);
    const chipsOk = v.chip === 'Not converged' && v.state === 'Not converged', msgOk = /gate G1/.test(v.msg), tilesOk = /not certified/.test(v.Is) && /not certified/.test(v.Gs);
    const recOk = vF.valid && dF.outcome.status === 'not_converged' && dF.outcome.reported_level === null && dF.outcome.I_A === null && dF.request === null;
    rec('IB12', 'Failed-run display', chipsOk && msgOk && tilesOk && !v.reqBox && recOk && ef.length === 0,
      'Node record: ' + nF.outcome.status + ', levels ' + nF.levels.map((e) => e.level + ' ' + (e.failed_gate ? 'failed ' + e.failed_gate : 'passed')).join(', ') + '; chips “' + v.chip + '” / “' + v.state + '”: ' + chipsOk +
      '; message “' + v.msg.trim() + '”: names G1 ' + msgOk + '; tiles “' + v.Is.trim() + '” and “' + v.Gs.trim() + '”: ' + tilesOk + '; request box shown: ' + v.reqBox + ' (“' + v.reqText.trim().slice(0, 80) + '”)' +
      '; download ' + dlF.suggestedFilename() + ': valid ' + vF.valid + ', status ' + dF.outcome.status + ', certified result ' + dF.outcome.reported_level + ', request ' + dF.request + '; page errors ' + ef.length);
    await cf.close();
  }

  // ===================================================== IB13 recorded shell motion in the 3D view (release 2026.10.2)
  // The drawn shells are compared with the stored CP2K positions, decoded here independently of the page.
  {
    const det = [], okp = {};
    const IDX = JSON.parse(fs.readFileSync(path.join(SITE, 'lab/continuum/ions/data/shells.json'), 'utf8'));
    const HYD = JSON.parse(fs.readFileSync(path.join(SITE, 'lab/continuum/ions/data/hydration.json'), 'utf8'));
    const hydCount = (n, s) => HYD.tubes.find((t) => t.n === n).ions[s === 0 ? 'Na+' : 'Cl-'].mean_count;
    const decode = (n) => {
      const t = IDX.tubes.find((u) => u.n === n), b = fs.readFileSync(path.join(SITE, 'lab/continuum/ions/data', t.file)), ions = [[], []];
      for (const io of t.ions) {
        const W = io.n_waters, F = t.frames, o0 = io.offset_bytes, wb = o0 + F * 4;
        ions[io.species === 'Na+' ? 0 : 1].push({ W, yz: (f, c) => b.readInt16LE(o0 + (f * 2 + c) * 2) / 10000, w: (f, k, at, c) => b.readInt16LE(wb + (((f * W + k) * 3 + at) * 3 + c) * 2) / 10000 });
      }
      return { F: t.frames, dt: t.frame_spacing_fs, D: (t.frames - 1) * t.frame_spacing_fs, ions };
    };
    const TB = { 7: decode(7), 11: decode(11) };
    const pp = (tau, D) => { const u = tau % (2 * D); return u <= D ? u : 2 * D - u; };
    const at = (tb, t) => { const fi = t / tb.dt, i0 = Math.min(tb.F - 2, Math.floor(fi)); return [i0, fi - i0]; };
    const op = (v, flip, phi) => { let x = v[0], y = v[1]; const z = v[2]; if (flip < 0) { x = -x; y = -y; } const c = Math.cos(phi), sn = Math.sin(phi); return [x, y * c - z * sn, y * sn + z * c]; };
    const md = (u, v) => Math.max(Math.abs(u[0] - v[0]), Math.abs(u[1] - v[1]), Math.abs(u[2] - v[2]));
    // (b) and (c) on one probe; counts: [inside count, outside count] per species
    function checkProbe(P, counts) {
      const r = { nIn: 0, nOut: 0, worstPos: 0, worstIon: 0, worstT: 0, incomplete: 0, worstSum: 0, worstCount: 0, markers: P.markers.length };
      for (const mk of P.markers) {
        let sum = 0; for (const w of mk.waters) sum += w.w;
        r.worstSum = Math.max(r.worstSum, Math.abs(sum - mk.m));
        const inside = mk.win === 1, outside = mk.win === 0;
        if (inside) r.worstCount = Math.max(r.worstCount, Math.abs(mk.m - counts[mk.s][0]));
        if (outside) r.worstCount = Math.max(r.worstCount, Math.abs(mk.m - counts[mk.s][1]));
        if (!(inside && r.nIn < 3) && !(outside && r.nOut < 3)) continue;
        if (inside) r.nIn++; else r.nOut++;
        const src = inside ? mk.inside : mk.outside, tb = TB[src.tube], rec = tb.ions[mk.s][src.ion], t = pp(mk.tau, tb.D);
        r.worstT = Math.max(r.worstT, Math.abs(t - (inside ? mk.tIn : mk.tOut)));
        const ws = mk.waters.filter((w) => w.src === (inside ? 'in' : 'out'));
        if (ws.length !== rec.W || mk.waters.length !== rec.W) r.incomplete++;
        const [i0, f] = at(tb, t);
        for (const w of ws) {
          const exp = [0, 1, 2].map((a) => op([0, 1, 2].map((c) => (1 - f) * rec.w(i0, w.idx, a, c) + f * rec.w(i0 + 1, w.idx, a, c)), src.flip, src.phi));
          r.worstPos = Math.max(r.worstPos, md(exp[0], w.O), md(exp[1], w.H1), md(exp[2], w.H2));
        }
        if (inside) {
          const y = (1 - f) * rec.yz(i0, 0) + f * rec.yz(i0 + 1, 0), z = (1 - f) * rec.yz(i0, 1) + f * rec.yz(i0 + 1, 1), e = op([0, y, z], src.flip, src.phi);
          const shiftOk = mk.shift === 0 || (e[2] < 0.02 && Math.abs(mk.ion[2] - 0.02) < 1e-12);
          r.worstIon = Math.max(r.worstIon, Math.abs(mk.ion[1] - e[1]), Math.abs(mk.ion[2] - (e[2] + mk.shift)), shiftOk ? 0 : 1);
        }
      }
      return r;
    }
    const fmt = (r) => r.markers + ' markers; inside ' + r.nIn + ', outside ' + r.nOut + ' compared: largest water position difference ' + e2(r.worstPos) + ' nm, ion ' + e2(r.worstIon) +
      ' nm, replay time ' + e2(r.worstT) + ' fs, incomplete sources ' + r.incomplete + '; weight sums within ' + e2(r.worstSum) + ' of the count, counts within ' + e2(r.worstCount) + ' of the closure';
    const probeOk = (r) => r.nIn >= 1 && r.nOut >= 1 && r.worstPos <= 1e-6 && r.worstIon <= 1e-6 && r.worstT <= 1e-9 && r.incomplete === 0 && r.worstSum <= 1e-6 && r.worstCount <= 1e-9;
    const probe = (pg) => pg.evaluate(() => window.__ionLab.view().shellProbe());
    // In the default experiment ions rarely sit in the pore (Cl⁻ hardly enters the charged (7,7) pore): if no marker of a
    // species is wholly inside, the test moves that species' first marker to the pore centre (x = 0) and reports it.
    const probePlaced = (pg) => pg.evaluate(() => {
      const v = window.__ionLab.view(), moved = [];
      for (let s = 0; s < 2; s++) { const ps = v.particles[s]; if (ps.length && !ps.some((m) => v.insideWeight(m.x) === 1)) { ps[0].x = 0; moved.push(s === 0 ? 'Na⁺' : 'Cl⁻'); } }
      v.placeMarkers(); v.needs = true;
      const P = v.shellProbe(); P.moved = moved; return P;
    });
    const waitReady = (pg) => pg.waitForFunction(() => { const v = window.__ionLab.view(); return v && v.stats().shellReplay.ready && v.shellProbe(1).markers.length > 0; }, null, { timeout: 60000 });
    const clickRadio = (pg, sel) => pg.evaluate((q) => document.querySelector(q).click(), sel);

    const c13 = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const q = await c13.newPage(); const e13 = []; q.on('pageerror', (e) => e13.push(e.message));
    const sreq = []; q.on('request', (r) => { if (/ions\/data\/shells/.test(r.url())) sreq.push({ url: r.url().replace(BASE, ''), t: Date.now() }); });
    await q.goto(URL0, { waitUntil: 'networkidle' }); await q.waitForTimeout(1500);
    const nBefore = sreq.length, tS = Date.now();
    await q.click('.ion-poster-run'); await runDone(q, 0); await waitReady(q);
    const o13 = await q.evaluate(() => { const o = window.__ionLab.state().res.main.opts; return { preset: o.preset, step: o.step, solvation: o.solvation }; });
    // (a)
    const after = [...new Set(sreq.filter((r) => r.t >= tS).map((r) => r.url))];
    okp.a = nBefore === 0 && ['shells.json', 'shells-7-7.bin', 'shells-11-11.bin'].every((n) => after.some((u) => u.endsWith('ions/data/' + n))) && after.every((u) => /ions\/data\/(shells\.json|shells-7-7\.bin|shells-11-11\.bin)$/.test(u));
    det.push('default experiment ' + o13.preset + ', step ' + o13.step + ', closure ' + o13.solvation + '; (a) shell files before Start: ' + nBefore + ', after: ' + after.map((u) => u.split('/').pop()).join(', '));
    // (b), (c) recorded-CP2K closure
    const P1 = await probePlaced(q);
    const cp2k = [[hydCount(7, 0), hydCount(11, 0)], [hydCount(7, 1), hydCount(11, 1)]];
    const r1 = checkProbe(P1, cp2k);
    okp.b1 = probeOk(r1);
    det.push('(b, c) recorded-CP2K closure (moved to the pore centre by the test: ' + (P1.moved.length ? P1.moved.join(', ') : 'none') + '): ' + fmt(r1));
    // (d), (e) motion and clock over at least 1 s of playing time
    await q.waitForFunction((t) => window.__ionLab.view().stats().playTime_s >= t + 1.0, P1.playTime_s, { timeout: 90000 });
    const P2 = await probe(q);
    const dt = P2.playTime_s - P1.playTime_s, byId = new Map(P2.markers.map((m) => [m.id, m]));
    let sO = 0, sH = 0, nO = 0, nHh = 0, nMk = 0, worstClock = 0;
    for (const m1 of P1.markers) {
      const m2 = byId.get(m1.id); if (!m2) continue;
      worstClock = Math.max(worstClock, Math.abs((m2.tau - m1.tau) / dt - 100));
      if (!((m1.win === 1 && m2.win === 1) || (m1.win === 0 && m2.win === 0))) continue;
      nMk++;
      const w2 = new Map(m2.waters.map((w) => [w.src + w.idx, w]));
      for (const a of m1.waters) {
        const b = w2.get(a.src + a.idx); if (!b || a.w <= 0.5 || b.w <= 0.5) continue;
        sO += (a.O[0] - b.O[0]) ** 2 + (a.O[1] - b.O[1]) ** 2 + (a.O[2] - b.O[2]) ** 2; nO++;
        for (const h of ['H1', 'H2']) { sH += (a[h][0] - b[h][0]) ** 2 + (a[h][1] - b[h][1]) ** 2 + (a[h][2] - b[h][2]) ** 2; nHh++; }
      }
    }
    const rmsO = nO ? Math.sqrt(sO / nO) : 0, rmsH = nHh ? Math.sqrt(sH / nHh) : 0;
    okp.d = nO > 0 && rmsO >= 0.005 && rmsH >= 0.005;
    // the measured magnitudes are not published (they are statistics of the trajectories; website evidence policy)
    det.push('(d) over ' + dt.toFixed(2) + ' s of playing (' + (100 * dt).toFixed(0) + ' fs of the run), ' + nMk + ' markers, ' + nO + ' waters: RMS change of the ion-relative oxygen positions at least 0.005 nm ' + (rmsO >= 0.005) + ', of the hydrogen positions at least 0.005 nm ' + (rmsH >= 0.005));
    // pause
    await q.click('.ion-play');
    const Pa = await probe(q); await q.waitForTimeout(1000); const Pb = await probe(q);
    const byB = new Map(Pb.markers.map((m) => [m.id, m]));
    const pausedOk = Pa.playTime_s === Pb.playTime_s && Pa.markers.length > 0 && Pa.markers.every((m) => byB.has(m.id) && byB.get(m.id).tau === m.tau);
    // rigid-shell closure (still paused): counts of that closure
    const r0 = await req(q); await clickRadio(q, 'input[name="ion-closure"][value="shell"]'); await runDone(q, r0); await waitReady(q);
    const oS = await q.evaluate(() => window.__ionLab.state().res.main.opts);
    const svS = Pm.build(oS).solvation.detail;
    const PS = await probePlaced(q), rS = checkProbe(PS, [[svS.nNa, Pm.REF.nNa], [svS.nCl, Pm.REF.nCl]]);
    okp.b2 = oS.solvation === 'shell' && probeOk(rS);
    det.push('(b, c) rigid-shell closure (inside ' + svS.nNa.toFixed(4) + ' Na⁺, ' + svS.nCl.toFixed(4) + ' Cl⁻; moved: ' + (PS.moved.length ? PS.moved.join(', ') : 'none') + '): ' + fmt(rS));
    // (f) Born closure and step 3
    const r1b = await req(q); await clickRadio(q, 'input[name="ion-closure"][value="born"]'); await runDone(q, r1b); await q.waitForTimeout(500);
    const fB = await q.evaluate(() => { const v = window.__ionLab.view(), st = v.stats(); return { waters: st.shellWaters, on: st.shellReplay.on, n: v.shellProbe().markers.length, solv: window.__ionLab.state().res.main.opts.solvation }; });
    const r3 = await req(q); await q.click('input[name="ion-step"][value="3"]'); await runDone(q, r3); await q.waitForTimeout(500);
    const f3 = await q.evaluate(() => { const v = window.__ionLab.view(), st = v.stats(); return { waters: st.shellWaters, on: st.shellReplay.on, n: v.shellProbe().markers.length, step: window.__ionLab.state().res.main.opts.step }; });
    okp.f = fB.solv === 'born' && fB.waters === 0 && !fB.on && fB.n === 0 && f3.step === 3 && f3.waters === 0 && !f3.on && f3.n === 0;
    det.push('(f) Born closure: ' + fB.waters + ' shell waters drawn; step 3: ' + f3.waters);
    await c13.close();
    // reduced motion
    const crm = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const qr = await crm.newPage(); qr.on('pageerror', (e) => e13.push('reduced motion: ' + e.message));
    await qr.goto(URL0, { waitUntil: 'networkidle' }); await qr.click('.ion-poster-run'); await runDone(qr, 0); await waitReady(qr);
    const R1 = await probe(qr); await qr.waitForTimeout(1500); const R2 = await probe(qr);
    const byR = new Map(R2.markers.map((m) => [m.id, m]));
    const stillOk = R1.playTime_s === 0 && R2.playTime_s === 0 && R1.markers.length > 0 && R1.markers.every((m) => byR.has(m.id) && byR.get(m.id).tau === m.tau);
    await qr.click('.ion-play');
    await qr.waitForFunction(() => window.__ionLab.view().stats().playTime_s >= 0.5, null, { timeout: 90000 });
    const R3 = await probe(qr), byR3 = new Map(R3.markers.map((m) => [m.id, m]));
    let rmClock = 0, rmN = 0;
    for (const m of R1.markers) { const m3 = byR3.get(m.id); if (!m3) continue; rmN++; rmClock = Math.max(rmClock, Math.abs((m3.tau - m.tau) / R3.playTime_s - 100)); }
    await crm.close();
    okp.e = worstClock <= 1e-6 && pausedOk && stillOk && rmN > 0 && rmClock <= 1e-6;
    det.push('(e) replay clock: largest deviation from 100 fs per second of playing ' + e2(Math.max(worstClock, rmClock)) + ' fs s⁻¹; paused: no advance ' + pausedOk + '; reduced motion: no advance before Play ' + stillOk + ', advances after Play (' + rmN + ' markers)');
    okp.g = e13.length === 0;
    det.push('(g) page errors ' + e13.length + (e13.length ? ' (' + e13.join(' | ') + ')' : ''));
    rec('IB13', 'Recorded shell motion in the 3D view', okp.a && okp.b1 && okp.b2 && okp.d && okp.e && okp.f && okp.g, det.join('; '));
  }

  await browser.close();
  const order = ['IB1', 'IB2', 'IB3', 'IB4', 'IB5', 'IB6', 'IB7', 'IB8', 'IB9', 'IB10', 'IB11', 'IB12', 'IB13'];
  items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const pass = items.length === order.length && items.every((i) => i.verdict === 'PASS') && allErrors.length === 0;
  const res = { id: 'browser_ions', name: 'Ion experiment browser tests IB1–IB13', verdict: pass ? 'PASS' : 'FAIL', chromium: version, items, pageErrors: allErrors,
    environment: 'Chromium ' + version + ' (headless shell, Playwright, SwiftShader WebGL) on ' + os.cpus()[0].model + ' (' + os.cpus().length + ' cores); local static server; no Safari, Firefox, real phones or GPUs', date: new Date().toISOString() };
  fs.writeFileSync(process.env.OUT || path.join(SITE, 'tools/continuum/results/browser_ions.json'), JSON.stringify(res, null, 1) + '\n');
  console.log('verdict', res.verdict, allErrors.length ? 'page errors: ' + allErrors.join(' | ') : '');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
