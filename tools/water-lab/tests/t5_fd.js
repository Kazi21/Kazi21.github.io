// Check 5: analytical tether force vs central finite differences of the tether energy reported by LAMMPS.
'use strict';
const H = require('./harness.js');
(async () => {
  const k = 5, d = [0.9, 0.7, -0.6], h = 1e-3;
  const { core } = await H.buildCore(216, { ensemble: 'nvt', edit: H.withoutShake });
  const topo = H.W.parseTopology(H.presetText(216));
  const mol = H.centralMolecule(core.gather(false, false).x, core.box(), topo);
  core.commands(`group sel clear\ngroup sel molecule ${mol}`);
  const R = [core.variable('rcx'), core.variable('rcy'), core.variable('rcz')];
  const X = R.map((r, i) => r + d[i]);
  core.commands([`variable X equal ${H.W.fmt(X[0])}`, `variable Y equal ${H.W.fmt(X[1])}`, `variable Z equal ${H.W.fmt(X[2])}`, `variable K equal ${k}`, 'run 0 post no'].join('\n'));
  const U0 = core.fixScalar('tether');
  const Uan = 0.5 * k * (d[0] ** 2 + d[1] ** 2 + d[2] ** 2);
  const comps = [];
  const ax = ['x', 'y', 'z'];
  for (let c = 0; c < 3; c++) {
    const mv = (s) => [0, 1, 2].map((j) => (j === c ? s : 0)).join(' ');
    core.commands(`displace_atoms sel move ${mv(h)} units box\nrun 0 post no`);
    const Up = core.fixScalar('tether');
    core.commands(`displace_atoms sel move ${mv(-2 * h)} units box\nrun 0 post no`);
    const Um = core.fixScalar('tether');
    core.commands(`displace_atoms sel move ${mv(h)} units box`);
    const fd = -(Up - Um) / (2 * h), an = -k * (R[c] - X[c]);
    comps.push({ axis: ax[c], finite_difference: fd, analytical: an, rel_err: Math.abs(fd - an) / Math.abs(an) });
  }
  core.close();
  const maxRel = Math.max(...comps.map((q) => q.rel_err));
  const sumErr = Math.abs(U0 - Uan) / Uan;
  const ok = maxRel <= 1e-6 && sumErr <= 1e-10;
  const res = { id: 5, name: 'Tether force vs finite differences', verdict: ok ? 'PASS' : 'FAIL', tolerances: { fd_rel: 1e-6, energy_sum_rel: 1e-10 },
    molecule: mol, k_kcal_mol_A2: k, handle_offset_A: d, h_A: h, components: comps, tether_energy_kcal_mol: U0, analytical_energy_kcal_mol: Uan, energy_sum_rel_err: sumErr,
    summary: `max relative difference ${maxRel.toExponential(1)} (h = 0.001 A); per-atom energies sum to 0.5 k|R-X|^2 within ${sumErr.toExponential(1)}` };
  H.save('t5.json', res);
  console.log('check 5:', res.verdict, '-', res.summary);
  if (res.verdict !== 'PASS') process.exit(1);                 // failure status for scripts and CI
})().catch((e) => { console.error(e); process.exit(1); });
