// Supplementary check S1 (browser part): 5 ps at the eight corner conditions and pulls at the softest and stiffest
// tether, with the page adapter; then combines with s1_native.json into s1.json. Exits 1 on FAIL.
'use strict';
const H = require('./harness.js');
const CASES = [['260K_1bar', 260, 1, 1.0], ['260K_1000bar', 260, 1000, 1.0], ['370K_1bar', 370, 1, 1.0], ['370K_1000bar', 370, 1000, 1.0],
  ['s0.90', 298.15, 1, 0.90], ['s0.95', 298.15, 1, 0.95], ['s1.05', 298.15, 1, 1.05], ['s1.10', 298.15, 1, 1.10]];
(async () => {
  const browser = {}, pulls = {};
  let ok = true;
  for (const [name, T, P, s] of CASES) {
    const { A } = await H.newAdapter({ molecules: 216, ensemble: 'npt' });
    A.setConditions({ T, Pbar: P, ensemble: 'npt' });
    if (Math.abs(s - 1) > 1e-9) A.setLJScale(s);
    const Ts = []; let g = { maxdr: 0 }, err = null, last;
    try {
      for (let i = 0; i < 500; i++) { last = A.runSteps(10, i % 50 === 49); if (i >= 250) Ts.push(last.T); if (last.x) g = H.geometry(last.x, A.topo); }
    } catch (e) { err = e.message; }
    const Tm = Ts.reduce((a, b) => a + b, 0) / Ts.length;
    const pass = !err && A.topo.natoms === 648 && g.maxdr <= 1e-4 && Math.abs(Tm - T) <= 10;
    ok = ok && pass;
    browser[name] = { T_target_K: T, P_target_bar: P, lj_scale: s, mean_T_2_5_5ps_K: Tm, max_OH_dev_A: g.maxdr, density_kg_m3_end: last && last.density, error: err, pass };
    console.log('browser', name, JSON.stringify(browser[name]));
    A.dispose();
  }
  for (const k of [0.5, 10]) {
    const { A } = await H.newAdapter({ molecules: 216, ensemble: 'nvt' });
    for (let i = 0; i < 10; i++) A.runSteps(10);
    const mol = H.centralMolecule(A.L.gather(false, false).x, A.L.box(), A.topo);
    A.beginPull(mol, { k });
    const X0 = A.st.X.slice();
    let geo = 0, maxSep = 0, err = null;
    try {
      for (let i = 0; i < 200; i++) { A.updatePullTarget([X0[0] + 8, X0[1], X0[2]]); const s = A.runSteps(10); geo = Math.max(geo, H.geometry(s.x, A.topo).maxdr); maxSep = Math.max(maxSep, Math.hypot(s.X[0] - s.R[0], s.X[1] - s.R[1], s.X[2] - s.R[2])); }
      A.releasePull();
      for (let i = 0; i < 100; i++) { const s = A.runSteps(10); geo = Math.max(geo, H.geometry(s.x, A.topo).maxdr); }
    } catch (e) { err = e.message; }
    const rel = A.events.find((e) => e.type === 'release');
    const bal = rel ? Math.abs(rel.energy_change_kJ_mol - rel.delivered_work_kJ_mol) : Infinity, tol = rel ? 0.02 * Math.abs(rel.delivered_work_kJ_mol) + 0.5 : 0;
    const pass = !err && geo <= 1e-4 && bal <= tol;
    ok = ok && pass;
    pulls['k' + k] = { k_kcal_mol_A2: k, k_N_m: k * H.W.U.kcalA2_Nm, max_OH_dev_A: geo, max_handle_com_separation_A: maxSep, delivered_work_kJ_mol: rel && rel.delivered_work_kJ_mol,
      energy_balance_error_kJ_mol: bal, energy_balance_tolerance_kJ_mol: tol, error: err, pass };
    console.log('pull', k, JSON.stringify(pulls['k' + k]));
    A.dispose();
  }
  let native = null;
  try { native = JSON.parse(H.fs.readFileSync(H.path.join(H.RESULTS, 's1_native.json'), 'utf8')); } catch (e) { /* run s1_native.py first */ }
  const nativeOK = native && Object.keys(native).length === 8 && Object.values(native).every((v) => v.pass);
  const verdict = ok && nativeOK ? 'PASS' : native ? 'FAIL' : 'NOT RUN';
  const dens = native ? Object.entries(native).map(([n, v]) => `${n} ${v.density_10_20ps ? v.density_10_20ps.toFixed(0) : 'error'}`).join(', ') : '';
  const res = { id: 'S1', name: 'Allowed-range stability sweep', verdict, native, browser, pulls,
    summary: `eight corner conditions stable for 20 ps (native) and 5 ps (browser engine); mean density over 10–20 ps (kg/m^3): ${dens}; soft and stiff tether pulls kept the constraints, largest handle separation ${pulls['k0.5'] ? pulls['k0.5'].max_handle_com_separation_A.toFixed(3) : '?'} A at k = 0.347 N/m` };
  H.save('s1.json', res);
  console.log('check S1:', verdict, '-', res.summary);
  if (verdict !== 'PASS') process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
