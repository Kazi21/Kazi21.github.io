// Browser checks PB1–PB14 for the Continuum Lab (/lab/continuum/flow.html). Criteria: tools/continuum/flow/TOLERANCES.md,
// written before the page existed and amended before each release's first run (release 2026.12.2: PB9 and PB12 replaced,
// PB13 and PB14 added). Numbers are compared with the Node record tools/continuum/results/t_flow.json
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
const LABEL = 'Published-case reconstruction';                     // evidence label named by PB2 (from release 2026.12.1)
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
  const failed = []; p.on('response', (r) => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url()); });
  p.on('requestfailed', (r) => failed.push('failed ' + r.url()));

  // ===================================================== PB1 load
  const resp = await p.goto(URLF, { waitUntil: 'networkidle' });
  await ready(p);
  const external = [...new Set(reqs.filter((u) => !u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')))];
  const footer = await p.evaluate(() => document.querySelector('.site-footer .version').textContent);
  const dataVersion = await p.evaluate(() => document.getElementById('flow-lab').getAttribute('data-version'));
  rec('PB1', 'Load', resp.status() === 200 && allErrors.length === 0 && external.length === 0 && failed.length === 0 && footer.includes('Website version ' + VERSION + '.') && dataVersion === VERSION,
    `HTTP ${resp.status()}; page errors ${allErrors.length}; ${reqs.length} requests, outside the site: ${external.length ? external.join(', ') : 'none'}, failed: ${failed.length ? failed.join(', ') : 'none'}; footer “${footer.trim()}”`);

  // ===================================================== PB2 default state
  const s0 = await state(p), x0 = EXP[key(DEFAULT, false)];
  const dq = rel(s0.result.Q_m3_s, x0.Q_m3_s), dv = rel(s0.result.mean_velocity_m_s, x0.mean_velocity_m_s), dr = rel(s0.result.Q_rel, x0.Q_rel);
  const tq = await text(p, 'fb-q'), tv = await text(p, 'fb-v'), td = await text(p, 'fb-d'), tev = await text(p, 'fb-evidence');
  const wantQ = s3(x0.Q_m3_s * 1e15) + ' pL/s', wantV = s3(x0.mean_velocity_m_s) + ' m/s', wantD = (x0.Q_rel < 0 ? '−' : '+') + s3(Math.abs(100 * x0.Q_rel)) + ' %';
  const isDefault = s0.caseId === CASE && s0.choice.family === DEFAULT.family && s0.choice.boundary === DEFAULT.boundary && s0.choice.viscosity === DEFAULT.viscosity && !s0.compare && !s0.ends;
  rec('PB2', 'Default state', isDefault && Math.max(dq, dv, dr) <= 1e-12 && tq === wantQ && tv === wantV && td === wantD && tev === LABEL && s0.evidence === LABEL,
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
  const BAND = 'Boundary-convention sensitivity';                // from release 2026.12.2
  const on5 = g5.other === 1 && g5.band === 1 && g5.bandLabel === BAND && g5.legend.includes(BAND) && rel(s5.result.other_Q_m3_s, xo.Q_m3_s) <= 1e-12;
  rec('PB5', 'Boundary comparison', !c0 && on5 && g5b.other === 0 && g5b.band === 0 && !g5b.legend.includes(BAND),
    `off on load: ${!c0}; on: ${g5.other} second curve (its flow rate against the Node record at D′: ${e2(rel(s5.result.other_Q_m3_s, xo.Q_m3_s))}), ${g5.band} band labelled “${g5.bandLabel}”, named in the legend: ${g5.legend.includes(BAND)}; off again: ${g5b.other} second curve, ${g5b.band} band`);

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
  // release 2026.12.1: the case and pressure selectors are hidden while one case and one drive are available
  // release 2026.12.2: the selected view tab is in the Tab order (the others are reached with the arrow keys)
  const need = ['[role="tab"][aria-selected="true"]', '#fb-play', '#fb-plot', '#fb-choices > summary', 'input[name="fb-family"]', 'input[name="fb-boundary"]', 'input[name="fb-viscosity"]', '#fb-compare', '#fb-ends'];
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

  // ===================================================== PB9 retired addresses (from release 2026.12.2)
  const c9 = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const q9 = await c9.newPage(); const e9 = [], f9 = [];
  q9.on('pageerror', (e) => e9.push(e.message)); q9.on('response', (r) => { if (r.status() >= 400) f9.push(r.status() + ' ' + r.url()); });
  const notices = [];
  for (const url of [URLI, URLW]) {
    const r = await q9.goto(url, { waitUntil: 'networkidle' });
    const n = await q9.evaluate(() => ({ h1: (document.querySelector('h1') || { textContent: '' }).textContent.trim(), robots: (document.querySelector('meta[name="robots"]') || { content: '' }).content,
      link: [...document.querySelectorAll('a')].filter((a) => a.textContent.trim() === 'Open the Continuum Lab').map((a) => a.href) }));
    let lands = false;
    if (n.link.length === 1) { await q9.click('a:text-is("Open the Continuum Lab")'); await q9.waitForLoadState('networkidle'); await ready(q9); lands = q9.url() === URLF; }
    notices.push({ url: url.replace(BASE, ''), status: r.status(), retired: /has been retired/.test(n.h1), noindex: /noindex/.test(n.robots), links: n.link.length, lands });
  }
  const gone = ['lab/continuum/ions/app.js', 'lab/continuum/worker.js', 'lab/continuum/continuum.css', 'lab/continuum/core/solver.js', 'tools/continuum/ions/t_ions.js', 'tools/continuum/openfoam/run_all.sh'];
  const goneStatus = [];
  for (const g of gone) { const r = await q9.request.get(BASE + g); goneStatus.push(r.status()); }
  const RETIRED = [BASE + 'lab/continuum/', BASE + 'lab/continuum/index.html', BASE + 'lab/continuum/water.html'];
  const scanned = [], stale = [];
  for (const pg of ['index.html', 'lab/continuum/flow.html', 'evidence/models/', 'lab/cnt/', 'lab/water/', 'evidence/nacl-water-cnt/index.html', 'evidence/nacl-water-cnt/source.html']) {
    await q9.goto(BASE + pg, { waitUntil: 'domcontentloaded' });
    const hrefs = await q9.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.href.replace(/#.*$/, '')));
    scanned.push(pg + ' ' + hrefs.length); hrefs.filter((h) => RETIRED.includes(h)).forEach((h) => stale.push(pg + ' → ' + h.replace(BASE, '')));
  }
  await c9.close();
  const ok9 = notices.every((n) => n.status === 200 && n.retired && n.noindex && n.links === 1 && n.lands) && goneStatus.every((x) => x === 404) && stale.length === 0 && e9.length === 0 &&
    f9.filter((x) => !gone.some((g) => x.endsWith(g))).length === 0;
  rec('PB9', 'Retired addresses', ok9,
    `${notices.map((n) => `${n.url}: HTTP ${n.status}, retired notice ${n.retired}, noindex ${n.noindex}, link “Open the Continuum Lab” ${n.links}, opens the Continuum Lab ${n.lands}`).join('; ')}; excluded files answer ${goneStatus.join(', ')} (${gone.length} sampled); links to a retired address on ${scanned.length} pages: ${stale.length ? stale.join(', ') : 'none'}; page errors ${e9.length}, failed requests ${f9.filter((x) => !gone.some((g) => x.endsWith(g))).length}`);

  // ===================================================== PB10 both error measures, readable at desktop and phone width
  const xp = EXP[key(DEFAULT, false)];
  const wantDiff = (xp.Q_rel < 0 ? '−' : '+') + s3(Math.abs(100 * xp.Q_rel)) + ' %', wantRms = s3(100 * xp.profile_rms_rel) + ' %';
  const read10 = [];
  for (const [w, hgt] of [[1440, 1000], [390, 844]]) {
    const c = await browser.newContext({ viewport: { width: w, height: hgt } }); const q = await c.newPage(); q.on('pageerror', (e) => allErrors.push('PB10 ' + w + ' px: ' + e.message));
    await q.goto(URLF, { waitUntil: 'networkidle' }); await ready(q);
    read10.push(Object.assign({ w }, await q.evaluate(() => {
      const el = (id) => document.getElementById(id), tiles = [...document.querySelectorAll('.fb-strip .cl-tile')];
      const dTile = el('fb-d').closest('.cl-tile'), pTile = el('fb-p').closest('.cl-tile'), both = el('fb-both'), strip = document.querySelector('.fb-strip');
      const texts = [el('fb-evidence'), ...dTile.querySelectorAll('p'), ...pTile.querySelectorAll('p'), both];
      const size = (e) => parseFloat(getComputedStyle(e).fontSize);
      const svg = el('fb-plot'), k = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
      return { d: el('fb-d').textContent, p: el('fb-p').textContent, separate: dTile !== pTile && tiles.includes(dTile) && tiles.includes(pTile), sentence: both.textContent,
        below: strip.nextElementSibling === both && both.getBoundingClientRect().top >= pTile.getBoundingClientRect().bottom,
        minText: Math.min(...texts.map(size)), plotMin: Math.min(...[...svg.querySelectorAll('text')].map((t) => size(t) * k)),
        clipped: texts.filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().width === 0).map((e) => e.id || e.className) };
    })));
    await c.close();
  }
  const ok10 = read10.every((r) => r.d === wantDiff && r.p === wantRms && r.separate && r.below && r.sentence.startsWith('Agreement in total flow does not establish agreement in the local velocity profile.') &&
    r.minText >= 12 && r.plotMin >= 10 && r.clipped.length === 0);
  rec('PB10', 'Both error measures', ok10, read10.map((r) => `${r.w} px: flow-rate difference “${r.d}” and velocity-profile difference “${r.p}” (Node record ${wantDiff} and ${wantRms}), separate entries ${r.separate}, sentence directly below ${r.below}, smallest result or label text ${r.minText.toFixed(1)} px, smallest plot text ${r.plotMin.toFixed(1)} px, clipped: ${r.clipped.length ? r.clipped.join(', ') : 'none'}`).join('; '));

  // ===================================================== PB11 controls beside the plot, accessible names, case description
  const c11 = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); const q11 = await c11.newPage(); q11.on('pageerror', (e) => allErrors.push('PB11: ' + e.message));
  await q11.goto(URLF, { waitUntil: 'networkidle' }); await ready(q11);
  const group = q11.getByRole('group', { name: 'Model', exact: true });
  const rSlip = group.getByRole('radio', { name: 'Slip-velocity form', exact: true }), rCla = group.getByRole('radio', { name: 'Classical, no slip', exact: true });
  const cmpBox = q11.getByRole('checkbox', { name: 'Compare boundary definitions', exact: true });
  const n11 = { group: await group.count(), slip: await rSlip.count(), cla: await rCla.count(), cmp: await cmpBox.count() };
  const inFig = await q11.evaluate(() => { const fig = document.getElementById('fb-plot').closest('figure');
    return ['input[name="fb-family"][value="slip_velocity"]', 'input[name="fb-family"][value="classical"]', '#fb-compare'].every((s) => fig.contains(document.querySelector(s))); });
  const d11 = await q11.evaluate(() => ({ text: document.getElementById('fb-case-desc').closest('.fb-case').textContent.replace(/\s+/g, ' ').trim(),
    caseShown: !!document.getElementById('fb-case').offsetParent, driveShown: !!document.getElementById('fb-drive').offsetParent }));
  await rCla.check(); const s11a = await state(q11); await rSlip.check(); await cmpBox.check(); const s11b = await state(q11); await cmpBox.uncheck(); const s11c = await state(q11);
  await c11.close();
  const enabled = CASES.cases.filter((c) => c.enabled), single = enabled.length === 1 && enabled[0].drives.length === 1;
  const descOk = /\(20,20\)/.test(d11.text) && /300 K/.test(d11.text) && /3\.25 ± 0\.21 MPa/.test(d11.text);
  rec('PB11', 'Controls beside the plot', n11.group === 1 && n11.slip === 1 && n11.cla === 1 && n11.cmp === 1 && inFig && single && !d11.caseShown && !d11.driveShown && descOk &&
    s11a.choice.family === 'classical' && s11b.choice.family === 'slip_velocity' && s11b.compare === true && s11c.compare === false,
    `group “Model” ${n11.group}, radios “Slip-velocity form” ${n11.slip} and “Classical, no slip” ${n11.cla}, checkbox “Compare boundary definitions” ${n11.cmp}, all inside the plot's figure ${inFig}; selected through their accessible names: classical → ${s11a.choice.family}, slip → ${s11b.choice.family}, comparison on → ${s11b.compare}, off → ${s11c.compare}; one enabled case with one drive ${single}, case selector shown ${d11.caseShown}, pressure selector shown ${d11.driveShown}; case description names the tube, temperature and pressure drop ${descOk} (“${d11.text.slice(0, 120)}…”)`);

  // ===================================================== PB12 main links from the home page
  const URLH = BASE + 'index.html';
  const c12 = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const q12 = await c12.newPage(); const e12 = []; q12.on('pageerror', (e) => e12.push(e.message));
  await q12.goto(URLH, { waitUntil: 'networkidle' });
  const hero = q12.locator('.hero-actions a', { hasText: 'Compare molecular and continuum flow' }); const nHero = await hero.count();
  await hero.first().click(); await q12.waitForLoadState('networkidle'); await ready(q12); const heroLands = q12.url() === URLF;
  await q12.goto(URLH, { waitUntil: 'networkidle' });
  const order12 = await q12.evaluate(() => { const cards = [...document.querySelectorAll('#lab .lab-card')];
    return { water: cards.findIndex((c) => c.querySelector('a[href="lab/water/"]')), cnt: cards.findIndex((c) => c.querySelector('a[href="lab/cnt/"]')), cont: cards.findIndex((c) => c.classList.contains('lab-card-feature')) }; });
  const prim = q12.locator('.lab-card-feature .lab-cta a.btn-primary'); const primText = (await prim.textContent()).trim();
  const card12 = await q12.evaluate(() => { const c = document.querySelector('.lab-card-feature'); return { further: c.querySelectorAll('details').length, actions: c.querySelectorAll('.lab-cta a').length }; });
  await prim.click(); await q12.waitForLoadState('networkidle'); await ready(q12); const primLands = q12.url() === URLF;
  await c12.close();
  const before12 = order12.water >= 0 && order12.cnt >= 0 && order12.cont > order12.water && order12.cont > order12.cnt;
  rec('PB12', 'Main links', nHero === 1 && heroLands && primText === 'Open the flow comparison' && primLands && before12 && card12.further === 0 && card12.actions === 1 && e12.length === 0,
    `hero link “Compare molecular and continuum flow” ${nHero}, opens the Continuum Lab ${heroLands}; card's primary link “${primText}” opens it ${primLands}; card order Live Water Lab ${order12.water + 1}, inspector ${order12.cnt + 1}, Continuum Lab ${order12.cont + 1}; actions in the card ${card12.actions}, “Further experiments” sections ${card12.further}; page errors ${e12.length}`);

  // ===================================================== PB13 three views of one case (release 2026.12.2)
  const c13 = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); const q13 = await c13.newPage(); const e13 = []; q13.on('pageerror', (e) => e13.push(e.message));
  await q13.goto(URLF, { waitUntil: 'networkidle' }); await ready(q13);
  const tl = q13.getByRole('tablist', { name: 'Views of this case', exact: true });
  const tabs = { profile: tl.getByRole('tab', { name: 'Velocity profile', exact: true }), boundary: tl.getByRole('tab', { name: 'Boundary sensitivity', exact: true }), evidence: tl.getByRole('tab', { name: 'Flow rate & evidence', exact: true }) };
  const n13 = { list: await tl.count(), profile: await tabs.profile.count(), boundary: await tabs.boundary.count(), evidence: await tabs.evidence.count() };
  const vis = () => q13.evaluate(() => ({ sel: [...document.querySelectorAll('[role="tab"]')].filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.id),
    shown: ['profile', 'boundary', 'evidence'].filter((v) => !document.getElementById('view-' + v).hidden && document.getElementById('view-' + v).offsetParent !== null),
    compare: window.__flowLab.state().compare, view: window.__flowLab.state().view, focus: document.activeElement && document.activeElement.id }));
  const v0 = await vis();
  const load13 = v0.sel.length === 1 && v0.sel[0] === 'tab-profile' && v0.shown.join() === 'profile' && !v0.compare;
  await tabs.boundary.click(); const v1 = await vis(), sB = await state(q13);
  const bnd = await q13.evaluate(() => [...document.querySelectorAll('#fb-bnd-table tbody tr')].map((tr) => ({ bd: tr.getAttribute('data-boundary'),
    R: tr.querySelector('[data-q="R"]').textContent, us: tr.querySelector('[data-q="us"]').textContent, Q: tr.querySelector('[data-q="Q"]').textContent })));
  const bcap = await q13.evaluate(() => document.getElementById('fb-bnd-cap').textContent);
  const g = CASES.cases.find((c) => c.id === CASE).geometry, sv = CASES.cases.find((c) => c.id === CASE).slip_velocity_m_s, mdQ = CASES.cases.find((c) => c.id === CASE).md.flow_pL_s;
  const r3 = (x) => (Math.round(x * 1000) / 1000).toFixed(3);
  const wantB = { D: { R: r3(g.D_nm.value / 2) + ' nm', us: sv.D.value.toFixed(2) + ' ± ' + sv.D.u + ' m/s', Q: s3(EXP[key({ family: 'slip_velocity', boundary: 'D', viscosity: 'interfacial' }, false)].Q_m3_s * 1e15) + ' pL/s' },
                  Dp: { R: r3(g.Dp_nm.value / 2) + ' nm', us: sv.Dp.value.toFixed(2) + ' ± ' + sv.Dp.u + ' m/s', Q: s3(EXP[key({ family: 'slip_velocity', boundary: 'Dp', viscosity: 'interfacial' }, false)].Q_m3_s * 1e15) + ' pL/s' } };
  const bndOk = bnd.length === 2 && bnd.every((b) => wantB[b.bd] && b.R === wantB[b.bd].R && b.us === wantB[b.bd].us && b.Q === wantB[b.bd].Q) &&
    bcap.includes(mdQ.value + ' ± ' + mdQ.u + ' pL/s in both rows');
  const boundary13 = v1.sel.join() === 'tab-boundary' && v1.shown.join() === 'boundary' && v1.compare && rel(sB.result.Q_m3_s, x0.Q_m3_s) <= 1e-12 && bndOk;
  await tabs.boundary.focus(); await q13.keyboard.press('ArrowRight'); const v2 = await vis();
  const ev = await q13.evaluate(() => { const t = (k) => { const e = document.querySelector('#fb-ev-table [data-q="' + k + '"]'); return e ? e.textContent : null; };
    const c = (k) => { const e = document.querySelector('#fb-ev-checks [data-q="' + k + '"]'); return e ? e.textContent : null; };
    return { Q: t('Q'), Qmd: t('Qmd'), dQ: t('dQ'), rms: t('rms'), num: c('num'), rep: c('rep'), web: c('web'), indep: c('indep') }; });
  const V = JSON.parse(fs.readFileSync(path.join(SITE, 'lab/continuum/flow/data/validation.json'), 'utf8'));
  const tallyN = (cn) => cn.PASS + ' of ' + (cn.PASS + cn.FAIL) + ' pass' + (cn.FAIL ? ', ' + cn.FAIL + ' fail' : '');
  const pmU = (x0.Q_rel < 0 ? '−' : '+') + (100 * Math.abs(x0.Q_rel)).toFixed(1) + ' ± ' + (100 * x0.Q_rel_u).toFixed(1) + ' %';
  const evOk = ev.Q && ev.Q.startsWith(s3(x0.Q_m3_s * 1e15) + ' ± ') && ev.Qmd === mdQ.value + ' ± ' + mdQ.u + ' pL/s' && ev.dQ === pmU && ev.rms === s3(100 * x0.profile_rms_rel) + ' %' &&
    ev.num === tallyN(V.numerical.counts) && ev.rep === tallyN(V.reproduction.counts) && (V.browser ? ev.web === tallyN(V.browser.counts) : true) && ev.indep === 'not established';
  const evidence13 = v2.sel.join() === 'tab-evidence' && v2.shown.join() === 'evidence' && v2.focus === 'tab-evidence' && evOk;
  // shared state: the model choice survives a change of view
  await tabs.profile.click(); const v3 = await vis();
  await q13.check('input[name="fb-family"][value="classical"]'); await tabs.evidence.click(); const sC = await state(q13);
  const xc = EXP[key({ family: 'classical', boundary: 'D', viscosity: 'interfacial' }, false)];
  const qC = await q13.evaluate(() => document.querySelector('#fb-ev-table [data-q="Q"]').textContent);
  const shared13 = sC.choice.family === 'classical' && rel(sC.result.Q_m3_s, xc.Q_m3_s) <= 1e-12 && qC.startsWith(s3(xc.Q_m3_s * 1e15) + ' ');
  const profile13 = v3.sel.join() === 'tab-profile' && v3.shown.join() === 'profile' && !v3.compare;
  await c13.close();
  rec('PB13', 'Three views of one case', n13.list === 1 && n13.profile === 1 && n13.boundary === 1 && n13.evidence === 1 && load13 && boundary13 && evidence13 && shared13 && profile13 && e13.length === 0,
    `tab list ${n13.list} with tabs ${n13.profile}/${n13.boundary}/${n13.evidence}; on load selected ${v0.sel.join()}, shown ${v0.shown.join()}, comparison ${v0.compare}; “Boundary sensitivity” (click): shown ${v1.shown.join()}, comparison ${v1.compare}, table ${bnd.map((b) => b.bd + ' R ' + b.R + ', u_s ' + b.us + ', Q ' + b.Q).join('; ')} (expected D ${wantB.D.R}, ${wantB.D.us}, ${wantB.D.Q}; D′ ${wantB.Dp.R}, ${wantB.Dp.us}, ${wantB.Dp.Q}), same MD flow rate in both rows ${bcap.includes(mdQ.value + ' ± ' + mdQ.u + ' pL/s in both rows')}; ArrowRight: selected ${v2.sel.join()}, focus ${v2.focus}, evidence table Q “${ev.Q}”, MD “${ev.Qmd}”, difference “${ev.dQ}” (expected “${pmU}”), rms “${ev.rms}”; checks “${ev.num}”, “${ev.rep}”, “${ev.web}”, independent validation “${ev.indep}”; “Velocity profile”: comparison ${v3.compare}; classical kept across views ${shared13} (shown “${qC}”); page errors ${e13.length}`);

  // ===================================================== PB14 phone hierarchy, compact case (release 2026.12.2)
  const c14 = await browser.newContext({ viewport: { width: 390, height: 844 } }); const q14 = await c14.newPage(); const e14 = []; q14.on('pageerror', (e) => e14.push(e.message));
  await q14.goto(URLF, { waitUntil: 'networkidle' }); await ready(q14);
  const ph = await q14.evaluate(() => { const top = (el) => el.getBoundingClientRect().top + window.scrollY;
    const plot = document.getElementById('fb-plot'), model = document.querySelector('.fb-seg'), cut = document.getElementById('fb-canvas');
    return { plotTop: Math.round(top(plot)), modelBottom: Math.round(model.getBoundingClientRect().bottom + window.scrollY), cutTop: Math.round(top(cut)) }; });
  await c14.close();
  const c14b = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); const q14b = await c14b.newPage(); q14b.on('pageerror', (e) => e14.push(e.message));
  await q14b.goto(URLF, { waitUntil: 'networkidle' }); await ready(q14b);
  const dk = await q14b.evaluate(() => { const lines = (el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
    return { l1: lines(document.querySelector('.fb-case-line')), l2: lines(document.querySelector('.fb-case-meta')), badges: document.querySelectorAll('.fb-chip').length,
      label: [...document.querySelectorAll('.fb-chip')].map((b) => b.textContent.trim()).join('|') }; });
  await c14b.close();
  const ok14 = ph.plotTop < 844 && ph.modelBottom < 844 && ph.cutTop > ph.plotTop && dk.l1 === 1 && dk.l2 === 1 && dk.badges === 1 && dk.label === LABEL && e14.length === 0;
  rec('PB14', 'Phone hierarchy, compact case', ok14,
    `390 × 844 px: model choice ends ${ph.modelBottom} px and the plot starts ${ph.plotTop} px below the top of the page (first screen 844 px); cutaway at ${ph.cutTop} px, after the plot ${ph.cutTop > ph.plotTop}; 1440 × 1000 px: case lines ${dk.l1} and ${dk.l2} line box each, evidence badges ${dk.badges} (“${dk.label}”); page errors ${e14.length}`);

  await browser.close();
  const order = ['PB1', 'PB2', 'PB3', 'PB4', 'PB5', 'PB6', 'PB7', 'PB8', 'PB9', 'PB10', 'PB11', 'PB12', 'PB13', 'PB14'];
  const pass = items.length === order.length && items.every((i) => i.verdict === 'PASS') && allErrors.length === 0;
  const res = { id: 'browser_flow', name: 'Continuum Lab browser checks PB1–PB14', verdict: pass ? 'PASS' : 'FAIL', chromium: version, items, pageErrors: allErrors,
    environment: 'Chromium ' + version + ' (headless shell, Playwright) on ' + os.cpus()[0].model + ' (' + os.cpus().length + ' cores); local static server; no Safari, Firefox, real phones or screen readers', date: new Date().toISOString() };
  fs.writeFileSync(process.env.OUT || path.join(SITE, 'tools/continuum/results/browser_flow.json'), JSON.stringify(res, null, 1) + '\n');
  console.log('verdict', res.verdict, allErrors.length ? 'page errors: ' + allErrors.join(' | ') : '');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
