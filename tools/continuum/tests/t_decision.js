// Continuum Lab acceptance tests D1–D3 (decision rules of the "Numerical resolution" row).
// Criteria: tools/continuum/TOLERANCES.md (added 19 Oct 2026 before the code change). Writes
// tools/continuum/results/t_decision.json; exits 1 on any FAIL.
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = path.resolve(__dirname, '../../..');
const SC = require(path.join(ROOT, 'lab/continuum/core/scenario.js'));
const MM = require(path.join(ROOT, 'lab/continuum/core/membrane-map.js'));
const E = require(path.join(ROOT, 'lab/continuum/core/experiment.js'));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'lab/continuum/data/manifest.json'), 'utf8'));
const meshTable = JSON.parse(fs.readFileSync(path.join(ROOT, 'lab/continuum/data/mesh-check.json'), 'utf8'));
const items = [];
const rec = (id, name, pass, detail) => { items.push({ id, name, verdict: pass ? 'PASS' : 'FAIL', detail }); console.log((pass ? 'PASS ' : 'FAIL ') + id + ' ' + name + ' — ' + detail); };
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const scen = (over) => Object.assign(SC.makeScenario(manifest), over || {});
const centrePatch = (sc) => { const dev = SC.deriveDevice(sc); return MM.applyScopedChange(MM.emptyModifications(), { kind: 'patch', pi: Math.floor(dev.patches.px / 2), pj: Math.floor(dev.patches.py / 2) }, 0); };
/* the comparison scenario differs from the run scenario only in the mesh level */
function onlyMeshDiffers(sc, level) {
  const a = JSON.parse(JSON.stringify(sc)), b = Object.assign(JSON.parse(JSON.stringify(sc)), { meshLevel: level });
  const keys = new Set(Object.keys(a).concat(Object.keys(b)));
  return [...keys].every((k) => k === 'meshLevel' || JSON.stringify(a[k]) === JSON.stringify(b[k])) && b.meshLevel === level;
}

// D1 state-matched resolution status
{
  const cases = [['default device', scen()], ['centre patch closed', null], ['20 µm × 5 µm', scen({ W_m: 20e-6, B_m: 5e-6 })]];
  cases[1][1] = scen(); cases[1][1].mods = centrePatch(cases[1][1]);
  let ok = true; const out = [];
  for (const [name, sc] of cases) {
    const run = E.run(sc, manifest), ref = E.refinement(sc, manifest, run.diag.Q_m3_s);
    const matched = ref.configId === SC.configHash(sc) && ref.comparisonConfigId === SC.configHash(Object.assign(JSON.parse(JSON.stringify(sc)), { meshLevel: ref.levelComparison }));
    const shape = onlyMeshDiffers(sc, ref.levelComparison) && ref.levelRun === 20 && ref.levelComparison === 10;
    const status = SC.resolutionStatus(SC.configHash(sc), ref, null);
    const pass = matched && shape && ref.ok && ref.rel <= 0.02 && ref.state === 'PASS' && status.state === 'PASS' && run.diag.converged;
    ok = ok && pass;
    out.push(`${name}: levels ${ref.levelComparison} vs ${ref.levelRun}, Q ${ref.Q_comparison_m3_s.toExponential(6)} vs ${ref.Q_run_m3_s.toExponential(6)} m³/s, |ΔQ|/Q = ${ref.rel.toExponential(2)}, same configuration ${matched && shape}, status ${status.state}`);
  }
  // a fine-mesh run is compared with level 20
  const fine = scen({ meshLevel: SC.fineLevel(scen()) });
  const lvlOk = E.refinementLevel(fine) === 20 && E.refinementLevel(scen()) === 10;
  // level 10 is a valid, aligned comparison level for every allowed size
  let alignedAll = true, nSizes = 0;
  for (const W of manifest.device.allowedSizes_um) for (const B of manifest.device.allowedSizes_um) {
    const a = Math.max(W, B) / Math.min(W, B); if (![1, 2, 4].some((x) => Math.abs(x - a) < 1e-9)) continue;
    const sc = scen({ W_m: W * 1e-6, B_m: B * 1e-6, meshLevel: 10 }); nSizes++;
    if (!SC.validateScenario(sc, manifest, null).ok) alignedAll = false;
  }
  ok = ok && lvlOk && alignedAll;
  out.push(`comparison level: standard → ${E.refinementLevel(scen())}, fine (${fine.meshLevel}) → ${E.refinementLevel(fine)}; level 10 valid and aligned for ${nSizes} allowed sizes: ${alignedAll}`);
  rec('D1', 'State-matched resolution status', ok, out.join('; '));
}

// D2 no certification by proxy
{
  const sc = scen(); sc.mods = centrePatch(sc);
  const id = SC.configHash(sc), key = Math.round(sc.W_m * 1e6) + 'x' + Math.round(sc.B_m * 1e6);
  const tableEntry = meshTable.entries[key];
  const noCheck = SC.resolutionStatus(id, null, null);                                   // modified membrane, only the table exists
  const fineAlone = SC.resolutionStatus(SC.configHash(scen({ meshLevel: SC.fineLevel(scen()) })), null, null);
  const otherConfig = SC.resolutionStatus(id, { configId: SC.configHash(scen()), state: 'PASS', rel: 1e-6 }, null);   // a check of the intact membrane
  const fail = SC.refinementVerdict(1.00, 0.97), pass = SC.refinementVerdict(1.00, 0.99);
  const manualFail = SC.resolutionStatus(id, { configId: id, state: 'PASS', rel: 1e-6 }, { configId: id, Q_run_m3_s: 1, Q_comparison_m3_s: 0.97, level: 40 });
  const ok = !!tableEntry && noCheck.state === 'NOT_CHECKED' && fineAlone.state === 'NOT_CHECKED' && otherConfig.state === 'NOT_CHECKED' &&
    fail.state === 'FAIL' && pass.state === 'PASS' && Math.abs(fail.rel - 0.03) < 1e-12 && Math.abs(pass.rel - 0.01) < 1e-12 && manualFail.state === 'FAIL';
  rec('D2', 'No certification by proxy', ok, `modified membrane with only the intact-membrane table entry (|ΔQ|/Q = ${tableEntry ? tableEntry.rel.toExponential(2) : 'missing'}): ${noCheck.state}; fine mesh without a comparison: ${fineAlone.state}; a PASS of a different configuration: ${otherConfig.state}; |ΔQ|/Q = ${fail.rel.toFixed(3)}: ${fail.state}; ${pass.rel.toFixed(3)}: ${pass.state}; a failing manual fine-mesh check overrides an automatic PASS: ${manualFail.state}`);
}

// D3 zero flow
{
  const out = []; let ok = true;
  const a = scen({ dP_Pa: 0 });
  const b = scen(); b.mods = MM.applyScopedChange(MM.emptyModifications(), { kind: 'membrane' }, 0);
  for (const [name, sc] of [['ΔP = 0', a], ['all faces closed at 1 MPa', b]]) {
    const run = E.run(sc, manifest), ref = E.refinement(sc, manifest, run.diag.Q_m3_s);
    const status = SC.resolutionStatus(SC.configHash(sc), ref, null);
    const finite = [run.diag.Q_m3_s, ref.Q_run_m3_s, ref.Q_comparison_m3_s, ref.rel].every(fin);
    const pass = run.diag.Q_m3_s === 0 && ref.Q_comparison_m3_s === 0 && ref.state === 'NOT_APPLICABLE' && status.state === 'NOT_APPLICABLE' && ref.zeroFlow === true && finite;
    ok = ok && pass;
    out.push(`${name}: Q = ${run.diag.Q_m3_s} and ${ref.Q_comparison_m3_s} m³/s on levels ${ref.levelRun} and ${ref.levelComparison}; status ${status.state}; numbers finite ${finite}`);
  }
  rec('D3', 'Zero flow', ok, out.join('; '));
}

const passAll = items.every((i) => i.verdict === 'PASS');
const res = { id: 'decision', name: 'Decision rules D1–D3', verdict: passAll ? 'PASS' : 'FAIL', items, summary: `${items.filter((i) => i.verdict === 'PASS').length} of ${items.length} passed`,
  environment: 'Node ' + process.version + '; same core/*.js files as the page and its worker' };
fs.mkdirSync(path.join(ROOT, 'tools/continuum/results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'tools/continuum/results/t_decision.json'), JSON.stringify(res, null, 1) + '\n');
console.log('decision:', res.verdict, '-', res.summary);
if (!passAll) process.exit(1);
