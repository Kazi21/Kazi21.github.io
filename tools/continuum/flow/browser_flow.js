// Browser checks PB1–PB9 for the flow benchmark (/lab/continuum/flow.html). Criteria: tools/continuum/flow/TOLERANCES.md,
// written before the page existed. Numbers are compared with the Node record tools/continuum/results/t_flow.json
// (block "expected", written by t_flow.js from lab/continuum/flow/core.js); the page state is read through
// window.__flowLab.state().
// Usage: node tools/continuum/flow/browser_flow.js [base URL]   (serve the repository root first; run t_flow.js first)
// Writes tools/continuum/results/browser_flow.json; exits 1 if any check fails.
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = (process.argv[2] || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
const EXE = process.env.CHROMIUM || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const SITE = path.resolve(__dirname, '../../..');
const T = JSON.parse(fs.readFileSync(path.join(SITE, 'tools/continuum/results/t_flow.json'), 'utf8'));
const CASES = JSON.parse(fs.readFileSync(path.join(SITE, 'lab/continuum/flow/data/cases.json'), 'utf8'));
const EXP = T.expected, CASE = T.case, VERSION = CASES.release;
const URLF = BASE + 'lab/continuum/flow.html', URLI = BASE + 'lab/continuum/', URLW = BASE + 'lab/continuum/water.html';
const items = [];
// detail: text without run-to-run timing values (the page shows it); data: measured values of this run
const rec = (id, name, pass, detail, data) => { items.push(Object.assign({ id, name, verdict: pass ? 'PASS' : 'FAIL', detail }, data ? { data } : {})); console.log((pass ? 'PASS ' : 'FAIL ') + id + ' ' + name + ' — ' + detail + (data ? ' ' + JSON.stringify(data) : '')); };
const rel = (a, b) => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)));
const e2 = (x) => Number(x).toExponential(2);
const key = (c, ends) => ['default', c.family, c.boundary, c.viscosity, ends ? 'ends' : 'no_ends'].join('|');
const DEFAULT = { family: 'slip_velocity', boundary: 'D', viscosity: 'interfacial' };
const s3 = (x) => { const s = Number(x).toPrecision(3); return /e/.test(s) ? String(Number(s)) : s; };
const state = (p) => p.evaluate(() => window.__flowLab.state());
const ready = (p) => p.waitForFunction(() => window.__flowLab && window.__flowLab.state().ready && window.__flowLab.state().validation, null, { timeout: 20000 });
const text = (p, id) => p.evaluate((i) => document.getElementById(i).textContent, id);

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const version = browser.version();
  const allErrors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => allErrors.push('desktop: ' + e.message));
  const reqs = []; p.on('request', (r) => reqs.push(r.url()));

  // ===================================================== PB1 load
  const resp = await p.goto(URLF, { waitUntil: 'networkidle' });
  await ready(p);
  const external = [...new Set(reqs.filter((u) => !u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')))];
  const footer = await p.evaluate(() => document.querySelector('.site-footer .version').textContent);
  const dataVersion = await p.evaluate(() => document.getElementById('flow-lab').getAttribute('data-version'));
  rec('PB1', 'Load', resp.status() === 200 && allErrors.length === 0 && external.length === 0 && footer.includes('Website version ' + VERSION + '.') && dataVersion === VERSION,
    `HTTP ${resp.status()}; page errors ${allErrors.length}; ${reqs.length} requests, outside the site: ${external.length ? external.join(', ') : 'none'}; footer “${footer.trim()}”`);

  // ===================================================== PB2 default state
  const s0 = await state(p), x0 = EXP[key(DEFAULT, false)];
  const dq = rel(s0.result.Q_m3_s, x0.Q_m3_s), dv = rel(s0.result.mean_velocity_m_s, x0.mean_velocity_m_s), dr = rel(s0.result.Q_rel, x0.Q_rel);
  const tq = await text(p, 'fb-q'), tv = await text(p, 'fb-v'), td = await text(p, 'fb-d'), tev = await text(p, 'fb-evidence');
  const wantQ = s3(x0.Q_m3_s * 1e15) + ' pL/s', wantV = s3(x0.mean_velocity_m_s) + ' m/s', wantD = (x0.Q_rel < 0 ? '−' : '+') + s3(Math.abs(100 * x0.Q_rel)) + ' %';
  const isDefault = s0.caseId === CASE && s0.choice.family === DEFAULT.family && s0.choice.boundary === DEFAULT.boundary && s0.choice.viscosity === DEFAULT.viscosity && !s0.compare && !s0.ends;
  rec('PB2', 'Default state', isDefault && Math.max(dq, dv, dr) <= 1e-12 && tq === wantQ && tv === wantV && td === wantD && tev === 'Reconstruction' && s0.evidence === 'Reconstruction',
    `case ${s0.caseId}, ${s0.choice.family} at ${s0.choice.boundary} with ${s0.choice.viscosity} viscosity; largest relative difference from the Node record (flow rate, mean velocity, difference from MD) ${e2(Math.max(dq, dv, dr))} (limit 1e-12); shown “${tq}”, “${tv}”, “${td}” (expected “${wantQ}”, “${wantV}”, “${wantD}”); evidence label “${tev}”`);

  // ===================================================== PB3 plot
  const plot = () => p.evaluate(() => ({ md: document.querySelectorAll('#fb-plot circle.fb-md').length, classical: document.querySelectorAll('#fb-plot #fb-curve-classical').length,
    model: document.querySelectorAll('#fb-plot #fb-curve-model').length, other: document.querySelectorAll('#fb-plot #fb-curve-other').length, band: document.querySelectorAll('#fb-plot #fb-band').length,
    bandLabel: (document.querySelector('#fb-plot #fb-band') || { getAttribute: () => null }).getAttribute('data-label'), legend: document.getElementById('fb-legend').textContent,
    finite: [...document.querySelectorAll('#fb-plot path')].every((q) => !/NaN/.test(q.getAttribute('d'))) }));
  const g0 = await plot();
  const dp = Math.max(...s0.result.profile_m_s.map((v, i) => rel(v, x0.profile_m_s[i])));
  rec('PB3', 'Plot', g0.md === 6 && g0.classical === 1 && g0.model === 1 && g0.band === 0 && g0.other === 0 && g0.finite && s0.result.profile_m_s.length === 6 && dp <= 1e-12,
    `${g0.md} molecular-dynamics points, ${g0.classical} classical curve, ${g0.model} model curve, boundary band ${g0.band ? 'present' : 'absent'}; model at the six radii against the Node record: largest relative difference ${e2(dp)} (limit 1e-12)`);

  // ===================================================== PB4 the 12 combinations through the controls
  await p.evaluate(() => { document.getElementById('fb-choices').open = true; });
  let worst4 = 0, where4 = '', n4 = 0, bad4 = [];
  for (const family of ['classical', 'slip_velocity']) for (const boundary of ['D', 'Dp']) for (const viscosity of ['interfacial', 'green_kubo', 'experimental']) {
    await p.check(`input[name="fb-family"][value="${family}"]`); await p.check(`input[name="fb-boundary"][value="${boundary}"]`); await p.check(`input[name="fb-viscosity"][value="${viscosity}"]`);
    const s = await state(p), x = EXP[key({ family, boundary, viscosity }, false)];
    const okChoice = s.choice.family === family && s.choice.boundary === boundary && s.choice.viscosity === viscosity;
    const d = Math.max(rel(s.result.Q_m3_s, x.Q_m3_s), rel(s.result.mean_velocity_m_s, x.mean_velocity_m_s));
    if (!okChoice || !(d <= 1e-12)) bad4.push([family, boundary, viscosity].join('|'));
    if (d > worst4) { worst4 = d; where4 = [family, boundary, viscosity].join('|'); }
    n4 += 1;
  }
  const g4 = await plot();
  rec('PB4', 'Model choices', n4 === 12 && bad4.length === 0 && g4.finite, `${n4} combinations selected through the radio buttons; flow rate and mean velocity against the Node record: largest relative difference ${e2(worst4)}${where4 ? ' at ' + where4 : ''} (limit 1e-12)${bad4.length ? '; not matching: ' + bad4.join(', ') : ''}`);
  await p.check('input[name="fb-family"][value="slip_velocity"]'); await p.check('input[name="fb-boundary"][value="D"]'); await p.check('input[name="fb-viscosity"][value="interfacial"]');

  // ===================================================== PB5 boundary comparison
  const c0 = await p.isChecked('#fb-compare');
  await p.check('#fb-compare'); const g5 = await plot(), s5 = await state(p);
  const xo = EXP[key({ family: 'slip_velocity', boundary: 'Dp', viscosity: 'interfacial' }, false)];
  await p.uncheck('#fb-compare'); const g5b = await plot();
  const on5 = g5.other === 1 && g5.band === 1 && g5.bandLabel === 'Boundary-choice sensitivity' && /Boundary-choice sensitivity/.test(g5.legend) && rel(s5.result.other_Q_m3_s, xo.Q_m3_s) <= 1e-12;
  rec('PB5', 'Boundary comparison', !c0 && on5 && g5b.other === 0 && g5b.band === 0 && !/Boundary-choice sensitivity/.test(g5b.legend),
    `off on load: ${!c0}; on: ${g5.other} second curve (its flow rate against the Node record at D′: ${e2(rel(s5.result.other_Q_m3_s, xo.Q_m3_s))}), ${g5.band} band labelled “${g5.bandLabel}”, named in the legend: ${/Boundary-choice sensitivity/.test(g5.legend)}; off again: ${g5b.other} second curve, ${g5b.band} band`);

  // ===================================================== PB6 entrance-resistance sensitivity
  const e0 = await p.isChecked('#fb-ends');
  await p.check('#fb-ends'); const s6 = await state(p), xe = EXP[key(DEFAULT, true)];
  const label6 = await p.evaluate(() => document.getElementById('fb-ends').closest('label').textContent.trim()), out6 = await text(p, 'fb-ends-out');
  const df = rel(s6.result.interior_fraction, xe.interior_fraction), dprod = rel(s6.result.Q_m3_s, s6.result.interior_fraction * s6.result.Q_no_ends_m3_s), dqe = rel(s6.result.Q_m3_s, xe.Q_m3_s);
  const shown6 = out6.includes((100 * xe.interior_fraction).toFixed(1) + ' %');
  await p.uncheck('#fb-ends'); const s6b = await state(p);
  rec('PB6', 'Entrance-resistance sensitivity', !e0 && s6.ends && Math.max(df, dprod, dqe) <= 1e-12 && /c = 3/.test(label6) && shown6 && !s6b.ends && rel(s6b.result.Q_m3_s, x0.Q_m3_s) <= 1e-12,
    `off on load: ${!e0}; on: remaining fraction ${s6.result.interior_fraction.toFixed(6)} against the Node record ${e2(df)}, flow rate against fraction × the value without end resistance ${e2(dprod)}, against the Node record ${e2(dqe)} (limit 1e-12); label “${label6}”; fraction shown as ${(100 * xe.interior_fraction).toFixed(1)} %: ${shown6}; off again restores the default flow rate`);

  // ===================================================== PB7 cases not yet enabled
  const off = CASES.cases.filter((c) => !c.enabled).map((c) => c.id);
  const listed = await p.evaluate(() => [...document.querySelectorAll('#fb-disabled li[data-case]')].map((li) => ({ id: li.getAttribute('data-case'), text: li.textContent.trim() })));
  const opts = await p.evaluate(() => [...document.getElementById('fb-case').options].map((o) => ({ value: o.value, disabled: o.disabled })));
  const tried = [];
  for (const id of off) {
    tried.push(await p.evaluate((cid) => { const sel = document.getElementById('fb-case'); sel.value = cid; sel.dispatchEvent(new Event('change', { bubbles: true })); const s = window.__flowLab.state(); return { caseId: s.caseId, shown: sel.value, message: s.message }; }, id));
  }
  const listedOk = off.every((id) => { const l = listed.find((q) => q.id === id); return l && /Not yet enabled/.test(l.text) && l.text.length > 40; }) && listed.length === off.length;
  const optsOk = off.every((id) => { const o = opts.find((q) => q.value === id); return o && o.disabled; }) && opts.filter((o) => !o.disabled).length === 1;
  const stayOk = tried.every((t) => t.caseId === CASE && t.shown === CASE && /not yet enabled/.test(t.message));
  const s7 = await state(p);
  rec('PB7', 'Cases not yet enabled', off.length === 4 && listedOk && optsOk && stayOk && rel(s7.result.Q_m3_s, x0.Q_m3_s) <= 1e-12,
    `${listed.length} cases listed with their reasons; ${opts.filter((o) => o.disabled).length} of ${opts.length} options disabled; selecting each of them from a script leaves the page on ${[...new Set(tried.map((t) => t.caseId))].join(', ')} with the message “${tried[0] ? tried[0].message : ''}”`);

  // ===================================================== PB8 layout, keyboard and motion
  const lay = [];
  for (const w of [360, 390, 768, 1440]) {
    const c = await browser.newContext({ viewport: { width: w, height: 900 } }); const q = await c.newPage(); q.on('pageerror', (e) => allErrors.push(w + ' px: ' + e.message));
    await q.goto(URLF, { waitUntil: 'networkidle' }); await ready(q);
    const m = () => q.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const before = await m();
    await q.evaluate(() => { document.querySelectorAll('details').forEach((d) => { d.open = true; }); document.getElementById('fb-compare').click(); document.getElementById('fb-ends').click(); });
    await q.waitForTimeout(250);
    lay.push({ w, before, after: await m() });
    await c.close();
  }
  const layOk = lay.every((l) => l.before <= 0 && l.after <= 0);
  // keyboard: Tab through the experiment with the panel open; every control must take focus and show an outline
  await p.evaluate(() => { document.getElementById('fb-choices').open = true; window.scrollTo(0, 0); document.activeElement && document.activeElement.blur(); });
  const need = ['#fb-case', '#fb-drive', '#fb-play', '#fb-plot', '#fb-choices > summary', 'input[name="fb-family"]', 'input[name="fb-boundary"]', 'input[name="fb-viscosity"]', '#fb-compare', '#fb-ends'];
  const seen = {}; let steps = 0, noOutline = [];
  await p.focus('.skip-link');
  for (; steps < 80; steps++) {
    await p.keyboard.press('Tab');
    const f = await p.evaluate((sels) => { const a = document.activeElement; if (!a || a === document.body) return null; const cs = getComputedStyle(a);
      return { hit: sels.filter((s) => a.matches(s)), inApp: !!a.closest('#flow-lab'), outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0, tag: a.tagName.toLowerCase() + (a.id ? '#' + a.id : ''), afterApp: !!a.closest('#details') }; }, need);
    if (!f) continue;
    f.hit.forEach((h) => { seen[h] = true; });
    if (f.inApp && !f.outline) noOutline.push(f.tag);
    if (f.afterApp) break;
  }
  const missing = need.filter((n) => !seen[n]);
  // motion: reduced motion keeps the tracers still; the default moves them
  const frames = async (reducedMotion) => {
    const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion }); const q = await c.newPage(); q.on('pageerror', (e) => allErrors.push('motion ' + reducedMotion + ': ' + e.message));
    await q.goto(URLF, { waitUntil: 'networkidle' }); await ready(q); await q.waitForTimeout(400);
    const grab = () => q.evaluate(() => ({ url: document.getElementById('fb-canvas').toDataURL(), t: window.__flowLab.state().cutaway.t, playing: window.__flowLab.state().playing, button: document.getElementById('fb-play').textContent }));
    const a = await grab(); await q.waitForTimeout(600); const b = await grab();
    await c.close();
    return { same: a.url === b.url, dt: b.t - a.t, playing: a.playing, button: a.button, size: a.url.length };
  };
  const still = await frames('reduce'), moving = await frames('no-preference');
  const motionOk = still.same && still.dt === 0 && !still.playing && still.button === 'Play' && still.size > 5000 && !moving.same && moving.dt > 0.3 && moving.playing;
  rec('PB8', 'Layout, keyboard and motion', layOk && missing.length === 0 && noOutline.length === 0 && motionOk,
    `horizontal overflow (px) on load / with every panel open and both sensitivities on: ${lay.map((l) => l.w + ' px ' + l.before + '/' + l.after).join(', ')}; Tab reached ${need.length - missing.length} of ${need.length} controls in ${steps + 1} steps${missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''}, focused elements without an outline: ${noOutline.length ? noOutline.join(', ') : 'none'}; reduced motion: two frames 600 ms apart identical ${still.same}, clock advance ${still.dt} s, button “${still.button}”; default: frames differ ${!moving.same}, clock advances ${moving.dt > 0.3 ? 'by more than 0.3 s' : 'by ' + moving.dt.toFixed(2) + ' s'}`,
    { clock_advance_s: Number(moving.dt.toFixed(3)), tab_steps: steps + 1 });

  // ===================================================== PB9 experiment switch on the three pages
  const sw = (q) => q.evaluate(() => [...document.querySelectorAll('.ion-switch a')].map((a) => ({ href: a.getAttribute('href'), cur: a.getAttribute('aria-current'), text: a.textContent.trim() })));
  const c9 = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const q9 = await c9.newPage(); const e9 = []; q9.on('pageerror', (e) => e9.push(e.message));
  await q9.goto(URLF, { waitUntil: 'networkidle' }); await ready(q9); const swF = await sw(q9);
  await q9.click('.ion-switch a[href="./"]'); await q9.waitForLoadState('networkidle');
  const atIon = q9.url().replace(/#.*$/, '') === URLI && (await q9.$('#ion-lab')) !== null; const swI = await sw(q9);
  await q9.click('.ion-switch a[href="flow.html"]'); await q9.waitForLoadState('networkidle'); const backF = q9.url() === URLF && (await q9.$('#flow-lab')) !== null;
  await q9.click('.ion-switch a[href="water.html"]'); await q9.waitForLoadState('networkidle');
  const atWater = q9.url() === URLW && (await q9.$('#continuum-lab')) !== null; const swW = await sw(q9);
  await q9.click('.ion-switch a[href="flow.html"]'); await q9.waitForLoadState('networkidle'); const backF2 = q9.url() === URLF;
  await c9.close();
  const one = (s, i) => s.length === 3 && s[i].cur === 'page' && s.filter((a) => a.cur).length === 1 && s[0].href === 'flow.html' && s[1].href === './' && s[2].href === 'water.html';
  rec('PB9', 'Experiment switch', one(swF, 0) && one(swI, 1) && one(swW, 2) && atIon && atWater && backF && backF2 && e9.length === 0,
    `entries on the benchmark, ion and water pages: ${swF.length}, ${swI.length}, ${swW.length} (${swF.map((a) => a.text).join(' | ')}); current entry: ${[swF, swI, swW].map((s) => s.findIndex((a) => a.cur === 'page') + 1).join(', ')}; from the benchmark the links open the ion page ${atIon} and the water page ${atWater}; both lead back ${backF && backF2}; page errors ${e9.length}`);

  await browser.close();
  const order = ['PB1', 'PB2', 'PB3', 'PB4', 'PB5', 'PB6', 'PB7', 'PB8', 'PB9'];
  const pass = items.length === order.length && items.every((i) => i.verdict === 'PASS') && allErrors.length === 0;
  const res = { id: 'browser_flow', name: 'Flow benchmark browser checks PB1–PB9', verdict: pass ? 'PASS' : 'FAIL', chromium: version, items, pageErrors: allErrors,
    environment: 'Chromium ' + version + ' (headless shell, Playwright) on ' + os.cpus()[0].model + ' (' + os.cpus().length + ' cores); local static server; no Safari, Firefox, real phones or screen readers', date: new Date().toISOString() };
  fs.writeFileSync(process.env.OUT || path.join(SITE, 'tools/continuum/results/browser_flow.json'), JSON.stringify(res, null, 1) + '\n');
  console.log('verdict', res.verdict, allErrors.length ? 'page errors: ' + allErrors.join(' | ') : '');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
