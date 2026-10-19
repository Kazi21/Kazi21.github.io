// mesh_check.js — standard (20 cells across the shorter side) vs fine (40 or 50) mesh for every allowed membrane size
// with an intact membrane, ΔP = 1 MPa (Q is proportional to ΔP, so the relative difference holds for any ΔP).
// Writes lab/continuum/data/mesh-check.json, read by the page's decision panel. Usage: node tools/continuum/mesh_check.js
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.resolve(__dirname, '../..');
const C = (f) => require(path.join(ROOT, 'lab/continuum/core', f));
const E = C('experiment.js'), SC = C('scenario.js'), SV = C('solver.js');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'lab/continuum/data/manifest.json'), 'utf8'));
const OUT = path.join(ROOT, 'lab/continuum/data/mesh-check.json');
const sizes = manifest.device.allowedSizes_um, aspects = manifest.device.allowedAspects;
const configs = [];
for (const W of sizes) for (const B of sizes) {
  const a = Math.max(W, B) / Math.min(W, B);
  if (aspects.some((x) => Math.abs(x - a) < 1e-9)) configs.push([W, B]);
}
configs.sort((p, q) => p[0] * p[1] / Math.min(...p) ** 2 - q[0] * q[1] / Math.min(...q) ** 2 || p[0] - q[0] || p[1] - q[1]);
const out = { format: 'continuum-mesh-check-1', generated: new Date().toISOString(), solverVersion: SV.SOLVER_VERSION, node: process.version, cpu: os.cpus()[0].model,
  definition: 'intact membrane, dP = 1 MPa; rel = |Q_fine - Q_20| / Q_fine; gate 0.02 (TOLERANCES S10)', entries: {} };
for (const [W, B] of configs) {
  const base = SC.makeScenario(manifest, { W_m: W * 1e-6, B_m: B * 1e-6 });
  const lvl = SC.fineLevel(base);
  const t0 = Date.now(); const r20 = E.run(base, manifest); const t1 = Date.now();
  const rf = E.run(Object.assign({}, base, { meshLevel: lvl }), manifest); const t2 = Date.now();
  const rel = Math.abs(rf.diag.Q_m3_s - r20.diag.Q_m3_s) / Math.abs(rf.diag.Q_m3_s);
  out.entries[W + 'x' + B] = { W_um: W, B_um: B, fineLevel: lvl, Q20_m3_s: r20.diag.Q_m3_s, Qfine_m3_s: rf.diag.Q_m3_s, rel, pass: rel <= 0.02,
    unknowns20: r20.sol.sys.N, unknownsFine: rf.sol.sys.N, wall20_s: (t1 - t0) / 1000, wallFine_s: (t2 - t1) / 1000,
    residual20: r20.sol.residual.relTotal, residualFine: rf.sol.residual.relTotal, membraneShare20: r20.diag.membraneShare, Re20: r20.diag.Re };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(W + ' x ' + B + ' um: fine ' + lvl + ', rel ' + rel.toExponential(2) + ', unknowns ' + r20.sol.sys.N + ' / ' + rf.sol.sys.N + ', ' + ((t2 - t0) / 1000).toFixed(1) + ' s');
}
const fails = Object.values(out.entries).filter((e) => !e.pass);
console.log('mesh check: ' + (fails.length ? 'FAIL' : 'PASS') + ' (' + Object.keys(out.entries).length + ' sizes)');
process.exit(fails.length ? 1 : 0);
