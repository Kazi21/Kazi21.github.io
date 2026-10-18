// Check 8 (browser part): unforced NVE drift at dt = 1.0 fs over 20 ps (revised from 5 ps, see TOLERANCES.md), preset 216;
// then combines with t8_native.json and keeps the original 5 ps result.
'use strict';
const H = require('./harness.js');
(async () => {
  const N = 216;
  const { core } = await H.buildCore(N, { ensemble: 'nvt' });
  core.commands(['unfix integ', 'fix integ all nve', 'timestep 1.0', 'thermo_style custom step temp pe ke etotal', 'thermo_modify temp tcom norm no', 'run 0 post no'].join('\n'));
  const t = [0], e = [core.thermo('etotal') * 4.184 / N];
  const t0 = Date.now();
  for (let i = 0; i < 200; i++) { core.command('run 100 pre no post no'); t.push((i + 1) * 0.1); e.push(core.thermo('etotal') * 4.184 / N); }
  core.close();
  const n = t.length, mt = t.reduce((a, b) => a + b) / n, me = e.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (t[i] - mt) * (e[i] - me); sxx += (t[i] - mt) ** 2; }
  const slope = sxy / sxx, resid = e.map((v, i) => v - (me + slope * (t[i] - mt)));
  const rms = Math.sqrt(resid.reduce((a, b) => a + b * b, 0) / n);
  const browser = { dt_fs: 1.0, duration_ps: 20.0, drift_kJ_mol_ns_per_molecule: slope * 1000, rms_fluct_kJ_mol_per_molecule: rms, wall_s: (Date.now() - t0) / 1000 };
  const native = JSON.parse(H.fs.readFileSync(H.path.join(H.RESULTS, 't8_native.json'), 'utf8'));
  const tol = 0.25;
  const ok = Math.abs(native['1.0'].drift_kJ_mol_ns_per_molecule) <= tol && Math.abs(browser.drift_kJ_mol_ns_per_molecule) <= tol;
  const opt = (f) => { try { return JSON.parse(H.fs.readFileSync(H.path.join(H.RESULTS, f), 'utf8')); } catch (e) { return null; } };
  const orig = opt('t8_original_5ps.json') || { verdict: 'not available', browser: { drift_kJ_mol_ns_per_molecule: NaN } };
  const windows = (opt('t8_native_windows.json') || { windows: [] }).windows;
  const res = { id: 8, name: 'Unforced NVE energy drift and timestep sensitivity', verdict: ok ? 'PASS' : 'FAIL', revised: true, tolerances: { drift_at_1fs_kJ_mol_ns_per_molecule: tol },
    native, browser,
    original_stated_version: { verdict: orig.verdict, browser_5ps: orig.browser, note: 'FAILED: a 5 ps window cannot resolve the tolerance (native 5 ps windows: ' + windows.map((w) => w.drift_kJ_mol_ns_per_molecule.toFixed(2)).join(', ') + ' kJ/mol/ns per molecule)' },
    summary: `drift at 1 fs: native ${native['1.0'].drift_kJ_mol_ns_per_molecule.toFixed(3)}, browser ${browser.drift_kJ_mol_ns_per_molecule.toFixed(3)} kJ/mol/ns per molecule; native at 0.5 / 2 fs: ${native['0.5'].drift_kJ_mol_ns_per_molecule.toFixed(3)} / ${native['2.0'].drift_kJ_mol_ns_per_molecule.toFixed(3)}` };
  H.save('t8.json', res);
  console.log('check 8:', res.verdict, '-', res.summary, '| rms', rms.toExponential(2));
  if (res.verdict !== 'PASS') process.exit(1);                 // failure status for scripts and CI
})().catch((e) => { console.error(e); process.exit(1); });
