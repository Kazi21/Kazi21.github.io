// Check 3: the O-O LJ multiplier reaches the force field (forces, energy, pressure) through the page's command.
'use strict';
const H = require('./harness.js');
(async () => {
  const { core } = await H.buildCore(216, { ensemble: 'nvt', edit: H.withoutShake });
  const eval0 = (s) => {
    core.commands([H.W.ljCommand(s), 'thermo_style custom step temp pe evdwl ecoul elong etail press', 'thermo_modify temp tcom norm no', 'run 0 post no'].join('\n'));
    return { s, evdwl: core.thermo('evdwl'), etail: core.thermo('etail'), ecoul: core.thermo('ecoul'), elong: core.thermo('elong'), press: core.thermo('press'), f: core.gather(false, true).f };
  };
  const r1 = eval0(1.0), r09 = eval0(0.9), r11 = eval0(1.1);
  core.close();
  const ratio09 = r09.evdwl / r1.evdwl, ratio11 = r11.evdwl / r1.evdwl;
  let lin = 0, change = 0;
  for (let i = 0; i < r1.f.length; i++) { lin = Math.max(lin, Math.abs(r11.f[i] - 2 * r1.f[i] + r09.f[i])); change = Math.max(change, Math.abs(r11.f[i] - r1.f[i])); }
  const dCoul = Math.max(Math.abs(r09.ecoul - r1.ecoul), Math.abs(r11.ecoul - r1.ecoul), Math.abs(r09.elong - r1.elong), Math.abs(r11.elong - r1.elong));
  const pLin = Math.abs(r11.press - 2 * r1.press + r09.press);
  // page path: setLJScale between chunks vs a fresh build at that s, same configuration
  const { A } = await H.newAdapter({ molecules: 216, ensemble: 'nvt' });
  for (let i = 0; i < 20; i++) A.runSteps(10);
  A.setLJScale(1.1);
  // test-only evaluation: the first setup applies SHAKE's coordinate correction after computing the energy, so the
  // energy is read from a second setup, i.e. at exactly the coordinates written to the data file below
  A.L.command('run 0 post no');
  A.L.command('run 0 post no');
  const eA = A.L.thermo('evdwl');
  A.L.command('write_data /cfg.data');
  const cfg = A.L.readFile('/cfg.data');
  A.dispose();
  const { core: c2 } = await H.buildCore(216, { ensemble: 'nvt', ljScale: 1.1, dataText: cfg });
  const eB = c2.thermo('evdwl');
  c2.close();
  const tol = { ratio_rel: 1e-10, coul_kcal: 1e-9, force_lin: 1e-8, force_change_min: 1e-3, press_lin_atm: 1e-6, page_path_kcal: 1e-6 };
  const checks = {
    ratio09: Math.abs(ratio09 / 0.9 - 1), ratio11: Math.abs(ratio11 / 1.1 - 1), dCoul, lin, change, pLin, pagePath: Math.abs(eA - eB),
  };
  const ok = checks.ratio09 <= tol.ratio_rel && checks.ratio11 <= tol.ratio_rel && dCoul <= tol.coul_kcal && lin <= tol.force_lin && change >= tol.force_change_min && pLin <= tol.press_lin_atm && checks.pagePath <= tol.page_path_kcal;
  const res = { id: 3, name: 'O-O LJ multiplier reaches the force field', verdict: ok ? 'PASS' : 'FAIL', tolerances: tol,
    measured: { evdwl_kcal_mol: { 's0.90': r09.evdwl, 's1.00': r1.evdwl, 's1.10': r11.evdwl }, etail_kcal_mol: { 's0.90': r09.etail, 's1.00': r1.etail, 's1.10': r11.etail },
      press_atm: { 's0.90': r09.press, 's1.00': r1.press, 's1.10': r11.press }, ratio_rel_err_0_90: checks.ratio09, ratio_rel_err_1_10: checks.ratio11,
      max_coulomb_change_kcal_mol: dCoul, force_nonlinearity: lin, max_force_change_kcal_mol_A: change, pressure_nonlinearity_atm: pLin,
      page_path_evdwl_kcal_mol: eA, fresh_build_evdwl_kcal_mol: eB, page_path_diff: checks.pagePath },
    summary: `evdwl scales with s to ${Math.max(checks.ratio09, checks.ratio11).toExponential(1)} relative; Coulomb unchanged (${dCoul.toExponential(1)}); forces linear in s (${lin.toExponential(1)}) and change by up to ${change.toPrecision(3)} kcal/mol/A for s 1.00 to 1.10` };
  H.save('t3.json', res);
  console.log('check 3:', res.verdict, '-', res.summary, '| page path diff', checks.pagePath.toExponential(2));
  if (res.verdict !== 'PASS') process.exit(1);                 // failure status for scripts and CI
})().catch((e) => { console.error(e); process.exit(1); });
