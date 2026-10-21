// Browser tests IB1–IB10 for the ion experiment (/lab/continuum/; criteria: tools/continuum/ions/TOLERANCES.md, written
// before the page existed). WebGL runs on SwiftShader in headless Chromium. Numbers are compared with the Node solver
// (lab/continuum/ions/core.js, params.js) run on the same inputs; the page state is read through window.__ionLab.
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
const URL0 = BASE + 'lab/continuum/', URLW = BASE + 'lab/continuum/water.html';
const GL = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const items = [];
const rec = (id, name, pass, detail) => { items.push({ id, name, verdict: pass ? 'PASS' : 'FAIL', detail }); console.log((pass ? 'PASS ' : 'FAIL ') + id + ' ' + name + ' — ' + detail); };
const rel = (a, b) => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)));
const e2 = (x) => Number(x).toExponential(2);
const f3pA = (I) => { const v = I * 1e12; return (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? null : Number(v.toPrecision(3)).toString()) + ' pA'; };
const SOLVER = /ions\/(core|params|worker|charts|ions3d)\.js|ions\/data\/hydration\.json|vendor\/three/;

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
  await p.goto(URL0, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const before = reqs.filter((r) => SOLVER.test(r.url)).map((r) => r.url.replace(BASE, ''));
  const tStart = Date.now();
  await p.click('.ion-poster-run');
  await runDone(p, 0);
  await p.waitForFunction(() => window.__ionLab.view() && window.__ionLab.view().stats().frames > 2, null, { timeout: 60000 });
  const after = [...new Set(reqs.filter((r) => SOLVER.test(r.url) && r.t >= tStart).map((r) => r.url.replace(BASE, '')))];
  const need = ['ions/core.js', 'ions/params.js', 'ions/worker.js', 'ions/charts.js', 'ions/ions3d.js', 'vendor/three.module.min.js'];
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
  const switchesOK = sw1.length === 2 && sw1[1].cur === 'page' && sw2.length === 2 && sw2[0].cur === 'page' && atIon && atWater;
  rec('IB10', 'Water experiment', wQ > 0 && switchesOK && external.length === 0 && ew.length === 0, `water.html converged, Q = ${e2(wQ)} m³ s⁻¹; switch on the water page marks it current and leads to the ion page: ${atIon}; switch on the ion page leads back: ${atWater}; external requests from both pages: ${external.length ? external.join(', ') : 'none'}; page errors ${ew.length}`);

  await browser.close();
  const order = ['IB1', 'IB2', 'IB3', 'IB4', 'IB5', 'IB6', 'IB7', 'IB8', 'IB9', 'IB10'];
  items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const pass = items.length === order.length && items.every((i) => i.verdict === 'PASS') && allErrors.length === 0;
  const res = { id: 'browser_ions', name: 'Ion experiment browser tests IB1–IB10', verdict: pass ? 'PASS' : 'FAIL', chromium: version, items, pageErrors: allErrors,
    environment: 'Chromium ' + version + ' (headless shell, Playwright, SwiftShader WebGL) on ' + os.cpus()[0].model + ' (' + os.cpus().length + ' cores); local static server; no Safari, Firefox, real phones or GPUs', date: new Date().toISOString() };
  fs.writeFileSync(process.env.OUT || path.join(SITE, 'tools/continuum/results/browser_ions.json'), JSON.stringify(res, null, 1) + '\n');
  console.log('verdict', res.verdict, allErrors.length ? 'page errors: ' + allErrors.join(' | ') : '');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
