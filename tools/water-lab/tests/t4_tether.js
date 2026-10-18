// Check 4: (a) the tether adds exactly F_i = (m_i/M)(-k(R - X)) with no torque about R, and the reported net
// interaction force is the engine's sum of the other forces; (b) an isolated tethered molecule oscillates at
// omega = (k/M)^1/2 and is not set rotating.
'use strict';
const H = require('./harness.js');
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
(async () => {
  const k = 5, d = [1.0, -0.5, 0.7];
  // ---- (a) full box, no SHAKE: forces with k minus forces with k = 0
  const { core } = await H.buildCore(216, { ensemble: 'nvt', edit: H.withoutShake });
  const topo = H.W.parseTopology(H.presetText(216));
  const x0 = core.gather(false, false).x;
  const mol = H.centralMolecule(x0, core.box(), topo);
  core.commands(`group sel clear\ngroup sel molecule ${mol}\nrun 0 post no`);
  const F0 = core.gather(false, true).f;
  const R = [core.variable('rcx'), core.variable('rcy'), core.variable('rcz')];
  const X = R.map((r, i) => r + d[i]);
  core.commands([`variable X equal ${H.W.fmt(X[0])}`, `variable Y equal ${H.W.fmt(X[1])}`, `variable Z equal ${H.W.fmt(X[2])}`, `variable K equal ${k}`, 'run 0 post no'].join('\n'));
  const s1 = core.gather(false, true), F1 = s1.f, xu = s1.x;
  const Fint = [0, 1, 2].map((i) => core.fixVector('tether', i));
  const U = core.fixScalar('tether');
  core.close();
  const Fpull = R.map((r, i) => -k * (r - X[i]));
  const atoms = [0, 1, 2].map((j) => topo.molAtoms[3 * (mol - 1) + j]);
  const masses = atoms.map((i) => (topo.type[i] === 1 ? H.W.MODEL.massO : H.W.MODEL.massH)), M = masses.reduce((a, b) => a + b, 0);
  let maxAtomErr = 0, maxOther = 0;
  const sum = [0, 0, 0], torque = [0, 0, 0], sumF0 = [0, 0, 0];
  for (let i = 0; i < topo.natoms; i++) {
    const dF = [0, 1, 2].map((c) => F1[3 * i + c] - F0[3 * i + c]);
    const j = atoms.indexOf(i);
    if (j < 0) { maxOther = Math.max(maxOther, ...dF.map(Math.abs)); continue; }
    const want = Fpull.map((f) => f * masses[j] / M);
    maxAtomErr = Math.max(maxAtomErr, ...dF.map((v, c) => Math.abs(v - want[c]) / Math.hypot(...Fpull)));
    for (let c = 0; c < 3; c++) { sum[c] += dF[c]; sumF0[c] += F0[3 * i + c]; }
    const t = cross([0, 1, 2].map((c) => xu[3 * i + c] - R[c]), dF);
    for (let c = 0; c < 3; c++) torque[c] += t[c];
  }
  const sumErr = Math.hypot(...sum.map((v, c) => v - Fpull[c])) / Math.hypot(...Fpull);
  const tq = Math.hypot(...torque);
  const fintErr = Math.hypot(...Fint.map((v, c) => v - sumF0[c]));
  const Uerr = Math.abs(U - 0.5 * k * (d[0] ** 2 + d[1] ** 2 + d[2] ** 2)) / U;
  const passA = sumErr <= 1e-10 && maxAtomErr <= 1e-10 && maxOther === 0 && tq <= 1e-9 && fintErr <= 1e-9;
  console.log(`(a) molecule ${mol}: |sum dF - F|/|F| ${sumErr.toExponential(2)}, per-atom ${maxAtomErr.toExponential(2)}, other atoms ${maxOther}, torque ${tq.toExponential(2)} kcal/mol, Fint vs sum ${fintErr.toExponential(2)}, U rel ${Uerr.toExponential(2)}`);

  // ---- (b) one isolated molecule, no other interactions, NVE + SHAKE
  const text = H.presetText(216).split('\n');
  const atomsLines = [], b = 40.0;
  let sec = '';
  const rows = {};
  for (const ln of text) {
    const t = ln.trim(); if (!t) continue;
    if (/^[A-Z][A-Za-z ]+(#.*)?$/.test(t)) { sec = t.split('#')[0].trim(); continue; }
    if (sec === 'Atoms') { const p = t.split(/\s+/); if (p[1] === '1') rows[p[0]] = p; }
  }
  const ids = ['1', '2', '3'];
  const L0 = (() => { const m = H.presetText(216).match(/^\s*(\S+)\s+(\S+)\s+xlo xhi/m); return parseFloat(m[2]) - parseFloat(m[1]); })();
  const pos = ids.map((id) => { const p = rows[id]; return [0, 1, 2].map((c) => parseFloat(p[4 + c]) + parseInt(p[7 + c], 10) * L0); });
  const shift = [0, 1, 2].map((c) => b / 2 - pos[0][c]);
  const data = [
    'Isolated SPC/E water molecule (check 4b)', '', '3 atoms', '2 bonds', '1 angles', '', '2 atom types', '1 bond types', '1 angle types', '',
    `0.0 ${b} xlo xhi`, `0.0 ${b} ylo yhi`, `0.0 ${b} zlo zhi`, '', 'Masses', '', '1 15.9994', '2 1.008', '', 'Atoms # full', '',
    ...ids.map((id, j) => `${id} 1 ${j === 0 ? 1 : 2} ${j === 0 ? -0.8476 : 0.4238} ${pos[j].map((v, c) => (v + shift[c]).toFixed(12)).join(' ')} 0 0 0`),
    '', 'Velocities', '', '1 0 0 0', '2 0 0 0', '3 0 0 0', '', 'Bonds', '', '1 1 1 2', '2 1 1 3', '', 'Angles', '', '1 1 2 1 3', '',
  ].join('\n');
  const edit = (cmds) => cmds.filter((c) => !/^(pair_modify|kspace_style|pair_coeff)/.test(c))
    .map((c) => c.replace(/^pair_style.*/, 'pair_style      zero 8.5').replace(/^fix\s+integ.*/, 'fix             integ all nve'))
    .filter((c) => !/^fix_modify\s+integ/.test(c))
    .flatMap((c) => (/^read_data/.test(c) ? [c, 'pair_coeff * *'] : [c]));
  const { core: c2 } = await H.buildCore(216, { dataText: data, edit });
  const R0 = [c2.variable('rcx'), c2.variable('rcy'), c2.variable('rcz')];
  const db = [1.0, 0, 0];
  const Xb = R0.map((r, i) => r + db[i]);
  c2.commands([`variable X equal ${H.W.fmt(Xb[0])}`, `variable Y equal ${H.W.fmt(Xb[1])}`, `variable Z equal ${H.W.fmt(Xb[2])}`, `variable K equal ${k}`].join('\n'));
  const mass = [15.9994, 1.008, 1.008], Mb = 18.0154;
  const tr = [], ang = [];
  let pre = 'yes';
  for (let i = 0; i <= 200; i++) {
    if (i > 0) { c2.command(`run 10 pre ${pre} post no`); pre = 'no'; }
    const s = c2.gather(true, false);
    const Rn = [c2.variable('rcx'), c2.variable('rcy'), c2.variable('rcz')];
    const V = [0, 1, 2].map((c) => (mass[0] * s.v[c] + mass[1] * s.v[3 + c] + mass[2] * s.v[6 + c]) / Mb);
    const Lm = [0, 0, 0];
    for (let a = 0; a < 3; a++) { const l = cross([0, 1, 2].map((c) => s.x[3 * a + c] - Rn[c]), [0, 1, 2].map((c) => s.v[3 * a + c] - V[c])); for (let c = 0; c < 3; c++) Lm[c] += mass[a] * l[c]; }
    tr.push({ t: i * 10, u: Rn[0] - Xb[0] }); ang.push(Math.hypot(...Lm));
  }
  c2.close();
  const zc = [];
  for (let i = 1; i < tr.length; i++) if (tr[i - 1].u * tr[i].u < 0) zc.push(tr[i - 1].t + (tr[i].t - tr[i - 1].t) * tr[i - 1].u / (tr[i - 1].u - tr[i].u));
  const halfs = []; for (let i = 1; i < zc.length; i++) halfs.push(zc[i] - zc[i - 1]);
  const period = 2 * halfs.reduce((a, b2) => a + b2, 0) / halfs.length;
  const expected = 2 * Math.PI * Math.sqrt(Mb / (k / H.W.U.mvv2e));
  const maxL = Math.max(...ang);
  const passB = Math.abs(period / expected - 1) <= 0.01 && maxL <= 1e-6;
  console.log(`(b) period ${period.toFixed(2)} fs vs ${expected.toFixed(2)} fs (${((period / expected - 1) * 100).toFixed(4)} %), max |L| ${maxL.toExponential(2)} g/mol A^2/fs, amplitude ${Math.max(...tr.map((p) => Math.abs(p.u))).toFixed(4)} A`);
  const res = { id: 4, name: 'Tether force and torque', verdict: passA && passB ? 'PASS' : 'FAIL',
    tolerances: { relative_force: 1e-10, torque_kcal_mol: 1e-9, net_interaction_force: 1e-9, period_rel: 0.01, angular_momentum: 1e-6 },
    a: { molecule: mol, k_kcal_mol_A2: k, handle_offset_A: d, sum_rel_err: sumErr, per_atom_rel_err: maxAtomErr, other_atoms_max_change: maxOther, torque_kcal_mol: tq,
      net_interaction_force_vs_sum: fintErr, tether_energy_rel_err: Uerr, pass: passA },
    b: { model: 'one SPC/E molecule in a 40 A cell with no pair or Coulomb interactions (the tether is the only external force), SHAKE, NVE, zero initial velocities',
      period_fs: period, expected_period_fs: expected, period_rel_err: period / expected - 1, max_angular_momentum: maxL, half_periods_measured: halfs.length, pass: passB },
    summary: `tether force exact per atom (${maxAtomErr.toExponential(1)}), torque ${tq.toExponential(1)} kcal/mol; isolated molecule period ${period.toFixed(1)} fs vs ${expected.toFixed(1)} fs, angular momentum ${maxL.toExponential(1)}` };
  H.save('t4.json', res);
  console.log('check 4:', res.verdict, '-', res.summary);
  if (res.verdict !== 'PASS') process.exit(1);                 // failure status for scripts and CI
})().catch((e) => { console.error(e); process.exit(1); });
