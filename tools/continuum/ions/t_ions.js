#!/usr/bin/env node
/* Ion experiment (Continuum Lab 2026.10.1): solver and controller tests I1–I18 against the criteria frozen in TOLERANCES.md
   (I15 added for release 2026.9.1; I16 and I17, the numerical controller, for release 2026.10; I18, the controller's guards
   against invalid diagnostics and incomplete molecular records, for release 2026.10.1).
   Usage: node tools/continuum/ions/t_ions.js [--quick]
   Writes tools/continuum/results/t_ions.json. I8 runs the independent SciPy program ref_pnp.py (python3 with numpy and
   scipy must be available); if it cannot run, I8 is reported NOT_RUN, never PASS. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const SITE = path.resolve(__dirname, '..', '..', '..');
const Core = require(path.join(SITE, 'lab/continuum/ions/core.js'));
const Pm = require(path.join(SITE, 'lab/continuum/ions/params.js'));
const K = Core.K, RT = K.R * 300, VT = RT / K.F;
const PRESETS = Pm.PRESETS.map((p) => p.id), STEPS = [1, 2, 3, 4, 5, 6];
const items = [];
const t0 = Date.now();
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
const e2 = (x) => Number(x).toExponential(2), f3 = (x) => Number(x).toPrecision(3);
function record(id, name, pass, detail) { items.push({ id, name, verdict: pass === null ? 'NOT_RUN' : (pass ? 'PASS' : 'FAIL'), detail }); console.log(id, pass === null ? 'NOT_RUN' : (pass ? 'PASS' : 'FAIL'), detail.slice(0, 400)); }

/* ---------------------------------------------------------------- I1 equilibrium (and I11a) */
{
  let worstJ = 0, worstQ = 0, worstB = 0, okAll = true, where = '', n = 0;
  for (const pr of PRESETS) for (const st of STEPS) {
    const b0 = Pm.build({ preset: pr, step: st, V: 0, c: 100 }), b1 = Pm.build({ preset: pr, step: st, V: 0.1, c: 100 });
    const r0 = Core.solve(b0.s), r1 = Core.solve(b1.s); n++;
    okAll = okAll && r0.ok && r1.ok;
    for (let i = 0; i < 2; i++) { const q = Math.abs(r0.J[i]) / Math.abs(r1.J[i]); if (q > worstJ) { worstJ = q; where = pr + ' step ' + st + ' species ' + i; } }
    if (st === 6) worstQ = Math.max(worstQ, Math.abs(r0.Q) / Math.abs(r1.Q));
    else if (r0.Q !== 0) worstQ = Infinity;
    // Boltzmann: c_i e^{ψ_i} constant, ψ_i = zφ/V_T + μ_ex/RT (finite size and solvation included)
    for (let i = 0; i < 2; i++) {
      const z = i === 0 ? 1 : -1, u0 = r0.c[i][0] * Math.exp(z * r0.phi[0] / r0.VT + r0.muEx[i][0] / RT);
      for (let k = 0; k < r0.x.length; k++) {
        const u = r0.c[i][k] * Math.exp(z * r0.phi[k] / r0.VT + r0.muEx[i][k] / RT);
        worstB = Math.max(worstB, Math.abs(u / u0 - 1));
      }
    }
  }
  const pass = okAll && worstJ <= 1e-12 && worstQ <= 1e-12 && worstB <= 1e-10;
  record('I1', 'Equilibrium', pass, n + ' cases (4 presets × 6 steps): largest |J_i(0)|/|J_i(100 mV)| = ' + e2(worstJ) + ' (' + where + '); largest |Q(0)|/|Q(100 mV)| = ' + e2(worstQ) +
    ' (step 6; Q ≡ 0 without electro-osmosis); largest deviation from the Boltzmann relation c_i e^{ψ_i} = constant: ' + e2(worstB) + '; all converged: ' + okAll);
}

/* ---------------------------------------------------------------- I2 homogeneous Ohmic limit */
{
  const a = 0.3095e-9, L = 5e-9, c = 100;
  const s = { T: 300, epsR: Pm.EPS_T, species: [{ name: 'Na+', z: 1, D: Pm.DT.Na }, { name: 'Cl-', z: -1, D: Pm.DT.Cl }], geom: { a, L, access: false }, cL: [c, c], cR: [c, c], V: 0.001 };
  const r = Core.solve(s), kap = (K.F * K.F / RT) * (Pm.DT.Na + Pm.DT.Cl) * c, G0 = kap * Math.PI * a * a / L, G = r.I / 0.001;
  record('I2', 'Homogeneous Ohmic limit', r.ok && rel(G, G0) <= 1e-4, 'G = ' + (G * 1e12).toPrecision(8) + ' pS, (F²/RT)(D₊ + D₋)c πa²/L = ' + (G0 * 1e12).toPrecision(8) + ' pS, relative difference ' + e2(rel(G, G0)));
}

/* ---------------------------------------------------------------- I3 Hall access resistance */
{
  const parts = []; let pass = true;
  for (const pr of PRESETS) {
    const b = Pm.build({ preset: pr, step: 1, V: 0.001, c: 100 }), r = Core.solve(b.s);
    const a = b.s.geom.a, L = b.s.geom.L, kap = (K.F * K.F / RT) * (Pm.DT.Na + Pm.DT.Cl) * 100;
    const Rth = (1 / kap) * (L / (Math.PI * a * a) + 1 / (2 * a)), Rn = 0.001 / r.I, d = rel(Rn, Rth);
    pass = pass && r.ok && d <= 5e-3;
    parts.push(b.preset.label + ': ' + (Rn / 1e9).toPrecision(6) + ' GΩ vs ' + (Rth / 1e9).toPrecision(6) + ' GΩ (' + (100 * d).toFixed(3) + ' %)');
  }
  record('I3', 'Hall access resistance', pass, parts.join('; '));
}

/* ---------------------------------------------------------------- I4 voltage reversal */
{
  let worstI = 0, worstQ = 0, okAll = true, where = '';
  for (const pr of PRESETS) for (const st of STEPS) for (const V of [0.05, 0.1, 0.2]) {
    const rp = Core.solve(Pm.build({ preset: pr, step: st, V, c: 100 }).s), rm = Core.solve(Pm.build({ preset: pr, step: st, V: -V, c: 100 }).s);
    okAll = okAll && rp.ok && rm.ok;
    const dI = Math.abs(rp.I + rm.I) / Math.abs(rp.I); if (dI > worstI) { worstI = dI; where = pr + ' step ' + st + ' ' + V * 1000 + ' mV'; }
    if (st === 6) worstQ = Math.max(worstQ, Math.abs(rp.Q + rm.Q) / Math.abs(rp.Q));
  }
  record('I4', 'Voltage reversal', okAll && worstI <= 1e-9 && worstQ <= 1e-9, '4 presets × 6 steps × {50, 100, 200} mV: largest |I(V) + I(−V)|/|I(V)| = ' + e2(worstI) + ' (' + where + '), largest |Q(V) + Q(−V)|/|Q(V)| = ' + e2(worstQ) + '; all converged: ' + okAll);
}

/* ---------------------------------------------------------------- I6 sweep (also used by I5, I13) */
const sweep = [];
{
  for (const pr of PRESETS) for (const st of STEPS) for (const grad of [false, true]) {
    let prev = null;
    for (const V of [0, 0.1, 0.2, -0.1, -0.2]) {
      if (V === -0.1) prev = null;
      const b = Pm.build({ preset: pr, step: st, V, c: 100, cR: grad ? 10 : 100 });
      const r = Core.solve(b.s);
      sweep.push({ pr, st, grad, V, r });
    }
  }
  let ok = true, worstRes = 0, minC = Infinity, maxPack = 0, finite = true;
  for (const q of sweep) {
    ok = ok && q.r.ok; worstRes = Math.max(worstRes, q.r.residual); maxPack = Math.max(maxPack, q.r.packingMax);
    for (const a of q.r.c) for (const v of a) { if (!isFinite(v)) finite = false; minC = Math.min(minC, v); }
  }
  record('I6', 'Positivity and convergence', ok && finite && minC > 0 && maxPack < 1 && worstRes <= 1e-10,
    sweep.length + ' solutions (6 steps × 4 presets × 5 voltages × 2 reservoir conditions): smallest concentration ' + e2(minC) + ' mol m⁻³, all finite: ' + finite +
    ', largest packing fraction ' + f3(maxPack) + ', largest scaled Newton residual ' + e2(worstRes) + ', all converged: ' + ok);
}

/* ---------------------------------------------------------------- I5 flux conservation */
{
  let worst = 0, worstCur = 0, where = '', n = 0;
  for (const q of sweep) {
    if (q.V === 0 && !q.grad) continue;                       // equilibrium: zero net flux, covered by I1
    n++;
    for (let i = 0; i < 2; i++) {
      const Jf = q.r.Jfaces[i], mean = Jf.reduce((p, v) => p + v, 0) / Jf.length;
      let dev = 0; for (const v of Jf) dev = Math.max(dev, Math.abs(v - mean));
      const d = dev / Math.abs(mean); if (d > worst) { worst = d; where = q.pr + ' step ' + q.st + (q.grad ? ' gradient ' : ' equal ') + q.V * 1000 + ' mV species ' + i; }
    }
    const Icalc = K.F * (q.r.J[0] - q.r.J[1]); worstCur = Math.max(worstCur, rel(q.r.I, Icalc));
  }
  record('I5', 'Flux conservation', worst <= 1e-9 && worstCur <= 1e-14, n + ' driven solutions of the I6 sweep (equilibrium cases excluded: zero net flux, see I1): largest face-to-mean deviation ' + e2(worst) + ' (' + where + '); reported current vs F Σ z_i J_i: ' + e2(worstCur));
}

/* ---------------------------------------------------------------- I7 mesh convergence */
{
  let worstI = 0, worstV = 0, parts = [], ok = true;
  for (const st of STEPS) {
    const r1 = Core.solve(Pm.build({ preset: '7,7', step: st, V: 0.1, c: 100, level: 1 }).s), r2 = Core.solve(Pm.build({ preset: '7,7', step: st, V: 0.1, c: 100, level: 2 }).s);
    const v1 = Core.reversal(Pm.build({ preset: '7,7', step: st, c: 100, cR: 10, level: 1 }).s), v2 = Core.reversal(Pm.build({ preset: '7,7', step: st, c: 100, cR: 10, level: 2 }).s);
    ok = ok && r1.ok && r2.ok && v1.ok && v2.ok;
    const dI = rel(r1.I, r2.I), dV = Math.abs(v1.V - v2.V) * 1000;
    worstI = Math.max(worstI, dI); worstV = Math.max(worstV, dV);
    parts.push('step ' + st + ': ' + (100 * dI).toFixed(4) + ' %, ' + dV.toFixed(4) + ' mV');
  }
  record('I7', 'Mesh convergence', ok && worstI <= 5e-3 && worstV <= 0.2, '(7,7), grid level 1 → 2 (every cell halved): change in I(100 mV) and in V_rev (10:1 gradient): ' + parts.join('; '));
}

/* ---------------------------------------------------------------- I8 independent reference (SciPy) */
{
  const cases = [], js = [];
  const add = (id, opts) => {
    const b = Pm.build(opts), s = b.s;
    cases.push({ id, T: s.T, epsR: s.epsR, D_Na: s.species[0].D, D_Cl: s.species[1].D, a_nm: s.geom.a * 1e9, L_nm: s.geom.L * 1e9, cone_slope: Core.ALPHA, smax_nm: 300,
      c_res_M: s.cL[0] / 1000, V: s.V, dG_RT: s.solv ? s.solv.dG.map((v) => v / RT) : [0, 0], profile_width_nm: 0.15,
      Dratio: s.Dpore ? s.Dpore.ratio : [1, 1], rim: s.rim ? { n: s.rim.n, w_nm: 0.5, edge_nm: 0.05 } : null });
    const s2 = JSON.parse(JSON.stringify(s)); delete s2.steric; s2.eof = { on: false, mu: s.eof.mu, b: s.eof.b };
    const r = Core.solve(s2);
    js.push({ id, I: r.I, INa: r.Ispecies[0], ICl: r.Ispecies[1], ok: r.ok });
  };
  add('a +100 mV (classical (7,7))', { preset: '7,7', step: 1, V: 0.1 });
  add('a −100 mV (classical (7,7))', { preset: '7,7', step: 1, V: -0.1 });
  add('b +100 mV ((9,9), rims + molecular solvation + confined mobility)', { preset: '9,9', step: 5, V: 0.1, solvation: 'cp2k' });
  add('b −100 mV ((9,9), rims + molecular solvation + confined mobility)', { preset: '9,9', step: 5, V: -0.1, solvation: 'cp2k' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ions-ref-')), inF = path.join(tmp, 'cases.json'), outF = path.join(tmp, 'out.json');
  fs.writeFileSync(inF, JSON.stringify(cases, null, 1));
  let py = null, err = '';
  try { cp.execFileSync('python3', [path.join(__dirname, 'ref_pnp.py'), inF, outF], { stdio: 'pipe', timeout: 600000 }); py = JSON.parse(fs.readFileSync(outF, 'utf8')); }
  catch (e) { err = String(e.message || e).slice(0, 300); }
  if (!py) record('I8', 'Independent reference', null, 'ref_pnp.py could not run: ' + err);
  else {
    let worst = 0; const parts = [];
    for (const j of js) {
      const p = py.results.find((q) => q.id === j.id);
      const d = [rel(j.I, p.I), rel(j.INa, p.I_Na), rel(j.ICl, p.I_Cl)];
      worst = Math.max(worst, ...d);
      parts.push(j.id + ': I ' + (j.I * 1e12).toPrecision(6) + ' vs ' + (p.I * 1e12).toPrecision(6) + ' pA (' + e2(d[0]) + '), Na⁺ ' + e2(d[1]) + ', Cl⁻ ' + e2(d[2]));
    }
    record('I8', 'Independent reference', js.every((j) => j.ok) && worst <= 0.01, parts.join('; ') + ' (SciPy ' + py.scipy + ' solve_bvp, tol 1e-7)');
  }
}

/* ---------------------------------------------------------------- I9 Goldman (GHK) limit */
{
  const a = 0.3095e-9, L = 5e-9, cL = 0.1, cR = 0.01, dG = [1, 2];
  const s = { T: 300, epsR: Pm.EPS_T, species: [{ name: 'Na+', z: 1, D: Pm.DT.Na }, { name: 'Cl-', z: -1, D: Pm.DT.Cl }], geom: { a, L, access: false },
    cL: [cL, cL], cR: [cR, cR], V: 0.05, solv: { mode: 'fixed', shape: 'step', dG: dG.map((g) => g * RT) } };
  const P = [Pm.DT.Na * Math.exp(-dG[0]) / L, Pm.DT.Cl * Math.exp(-dG[1]) / L], A = Math.PI * a * a;
  const ghkI = (V) => { const v = V / VT; let I = 0; [1, -1].forEach((z, i) => { I += z * K.F * A * P[i] * z * v * (cL - cR * Math.exp(-z * v)) / (1 - Math.exp(-z * v)); }); return I; };
  const Vrev0 = VT * Math.log((P[0] * cR + P[1] * cL) / (P[0] * cL + P[1] * cR));
  const r = Core.solve(s), rv = Core.reversal(s);
  const dV = Math.abs(rv.V - Vrev0) * 1000, dI = rel(r.I, ghkI(0.05));
  record('I9', 'Goldman (GHK) limit', r.ok && rv.ok && dV <= 0.5 && dI <= 0.01, 'V_rev ' + (rv.V * 1000).toFixed(4) + ' mV vs GHK ' + (Vrev0 * 1000).toFixed(4) + ' mV (' + dV.toFixed(4) + ' mV); I(+50 mV) ' + e2(r.I) + ' A vs GHK ' + e2(ghkI(0.05)) + ' A (' + (100 * dI).toFixed(4) + ' %)');
}

/* ---------------------------------------------------------------- I10 Donnan limit */
{
  const s = { T: 300, epsR: Pm.EPS_T, species: [{ name: 'Na+', z: 1, D: Pm.DT.Na }, { name: 'Cl-', z: -1, D: Pm.DT.Cl }], geom: { a: 0.581e-9, L: 100e-9, access: false },
    cL: [10, 10], cR: [10, 10], V: 0, fixedUniform: -500 };
  const r = Core.solve(s), k = r.x.findIndex((x) => Math.abs(x) < 1e-15);
  const cp_ = r.c[0][k], cm = r.c[1][k], prod = cp_ * cm / 100, diff = (cp_ - cm) / 500;
  record('I10', 'Donnan limit', r.ok && Math.abs(prod - 1) <= 0.01 && Math.abs(diff - 1) <= 0.01, 'pore centre: c₊ = ' + f3(cp_ / 1000) + ' M, c₋ = ' + e2(cm / 1000) + ' M; c₊c₋/c_b² = ' + prod.toPrecision(6) + ', (c₊ − c₋)/0.500 M = ' + diff.toPrecision(6) + ' (' + r.x.length + ' nodes)');
}

/* ---------------------------------------------------------------- I11 electro-osmosis */
{
  // (b) Onsager reciprocity, charged (9,9) with slip 10 nm: full model (step 6) and rims + flow only
  const onsager = (extra) => {
    const bP = Pm.build(Object.assign({ preset: '9,9', step: 6, V: 0, c: 100, dp: 1000, slip: 10 }, extra));
    const bV = Pm.build(Object.assign({ preset: '9,9', step: 6, V: 1e-4, c: 100, dp: 0, slip: 10 }, extra));
    const tweak = (b) => { if (extra && extra.rimsOnly) { delete b.s.steric; delete b.s.solv; delete b.s.Dpore; } return b.s; };
    const rP = Core.solve(tweak(bP)), rV = Core.solve(tweak(bV));
    return { L12: rP.I / 1000, L21: rV.Q / 1e-4, ok: rP.ok && rV.ok };
  };
  const full = onsager({}), rims = onsager({ rimsOnly: true });
  const dFull = rel(full.L12, full.L21), dRims = rel(rims.L12, rims.L21);
  // (c) van 't Hoff osmosis: neutral (7,7) pore excluding both ions by 15 RT, 0.100 | 0.0100 M
  const sv = { T: 300, epsR: Pm.EPS_T, species: [{ name: 'Na+', z: 1, D: Pm.DT.Na }, { name: 'Cl-', z: -1, D: Pm.DT.Cl }], geom: { a: 0.3095e-9, L: 5e-9, access: true },
    cL: [100, 100], cR: [10, 10], V: 0, dp: 0, solv: { mode: 'fixed', dG: [15 * RT, 15 * RT] }, eof: { on: true, mu: Pm.ETA_T, b: 10e-9 } };
  const rv = Core.solve(sv), Qvh = -2 * RT * (100 - 10) / rv.Rh, dVH = rel(rv.Q, Qvh);
  // (d) hydraulics with no force on the ions (uniform neutral electrolyte)
  const a = 0.3095e-9, L = 5e-9, b = 10e-9, mu = Pm.ETA_T;
  const sh = { T: 300, epsR: Pm.EPS_T, species: [{ name: 'Na+', z: 1, D: Pm.DT.Na }, { name: 'Cl-', z: -1, D: Pm.DT.Cl }], geom: { a, L, access: true },
    cL: [100, 100], cR: [100, 100], V: 0, dp: 1e5, eof: { on: true, mu, b } };
  const rh = Core.solve(sh), Rh0 = 8 * mu * L / (Math.PI * Math.pow(a, 4) * (1 + 4 * b / a)) + 2 * 3 * mu / (2 * a * a * a), dH = rel(rh.Q / 1e5, 1 / Rh0);
  const pass = full.ok && rims.ok && dFull <= 0.01 && dRims <= 0.01 && rv.ok && rv.Q < 0 && dVH <= 0.02 && rh.ok && dH <= 1e-6;
  record('I11', 'Electro-osmosis', pass, '(a) see I1; (b) Onsager, charged (9,9), b = 10 nm: I/Δp = ' + e2(full.L12) + ' A Pa⁻¹ vs Q/V = ' + e2(full.L21) + ' m³ s⁻¹ V⁻¹ (' + (100 * dFull).toFixed(3) + ' %, full model); rims and flow only ' + (100 * dRims).toFixed(3) + ' %' +
    '; (c) van ’t Hoff: Q = ' + e2(rv.Q) + ' m³ s⁻¹ vs −2RTΔc/R_h = ' + e2(Qvh) + ' (' + (100 * dVH).toFixed(3) + ' %, towards the concentrated side: ' + (rv.Q < 0) + ')' +
    '; (d) hydraulics: Q/Δp vs 1/R_h relative difference ' + e2(dH));
}

/* ---------------------------------------------------------------- I12 conventions and parameters */
{
  // independent recomputation of the constants (not taken from params.js)
  const NA = 6.02214076e23, e = 1.602176634e-19, eps0 = 8.8541878128e-12;
  const born0 = NA * e * e / (8 * Math.PI * eps0) * 1e6;          // kJ nm/mol
  const epsMM = (t) => 87.740 - 0.40008 * t + 9.398e-4 * t * t - 1.410e-6 * t * t * t;
  const e25 = epsMM(25), e300 = epsMM(26.85);
  const checks = [];
  // Born radii reproduce the Marcus energies
  for (const [ion, G] of [['Na', -365], ['Cl', -340]]) checks.push(['Born ' + ion, rel(-born0 * (1 - 1 / e25) / Pm.R_BORN[ion], G)]);
  // dielectric exclusion closed form
  for (const pr of PRESETS) for (const epsP of [10, 30, 60]) {
    const sv = Pm.solvation(Object.assign({}, Pm.DEFAULTS, { preset: pr, solvation: 'born', epsP }));
    checks.push(['exclusion ' + pr + ' ε=' + epsP + ' Na', rel(sv.Na, born0 / Pm.R_BORN.Na * (1 / epsP - 1 / e300))]);
    checks.push(['exclusion ' + pr + ' ε=' + epsP + ' Cl', rel(sv.Cl, born0 / Pm.R_BORN.Cl * (1 / epsP - 1 / e300))]);
  }
  // dehydration closed form with recorded counts (and the rigid-shell estimate)
  const hyd = JSON.parse(fs.readFileSync(path.join(SITE, 'lab/continuum/ions/data/hydration.json'), 'utf8'));
  const cnt = {}; hyd.tubes.forEach((t) => { cnt[t.n + ',' + t.n] = { Na: t.ions['Na+'].mean_count, Cl: t.ions['Cl-'].mean_count }; });
  let hydMatch = true;
  for (const p of Pm.PRESETS) if (p.nNa !== cnt[p.id].Na || p.nCl !== cnt[p.id].Cl) hydMatch = false;
  const g1 = { Na: 365 - born0 * (1 - 1 / e25) / (0.24 + 0.14), Cl: 340 - born0 * (1 - 1 / e25) / (0.32 + 0.14) };
  for (const pr of PRESETS) for (const lin of Object.keys(Pm.LININGS)) {
    const o = Object.assign({}, Pm.DEFAULTS, { preset: pr, solvation: 'cp2k', lining: lin }), sv = Pm.solvation(o), L_ = Pm.LININGS[lin];
    const ref = cnt['11,11'];
    for (const ion of ['Na', 'Cl']) {
      const k = ion === 'Na' ? L_.kNa : L_.kCl, lost = Math.max(0, ref[ion] - cnt[pr][ion]);
      const want = (1 - k) * lost / ref[ion] * g1[ion];
      checks.push(['dehydration ' + pr + ' ' + lin + ' ' + ion, want === 0 ? Math.abs(sv[ion]) : rel(sv[ion], want)]);
    }
  }
  // fixed charge on, solvation off: excess energy identically zero (step 2) / only the finite-size term (step 3)
  let zeroMax = 0, sterMax = 0;
  for (const pr of PRESETS) {
    const r2 = Core.solve(Pm.build({ preset: pr, step: 2, V: 0.1 }).s);
    for (const a of r2.muEx) for (const v of a) zeroMax = Math.max(zeroMax, Math.abs(v));
    const b3 = Pm.build({ preset: pr, step: 3, V: 0.1 }), r3 = Core.solve(b3.s), vt = NA * Math.pow(b3.s.steric.size, 3) * 1000;
    for (let k = 0; k < r3.x.length; k++) {
      const S = (r3.c[0][k] + r3.c[1][k]) / 1000, want = -Math.log(1 - vt * S) * RT;
      for (let i = 0; i < 2; i++) sterMax = Math.max(sterMax, Math.abs(r3.muEx[i][k] - want) / Math.max(want, 1e-300));
    }
  }
  // one closure at a time
  let oneClosure = true;
  for (const mode of ['cp2k', 'shell', 'born']) {
    const b = Pm.build({ preset: '7,7', step: 4, solvation: mode }), sv = Pm.solvation(Object.assign({}, Pm.DEFAULTS, { preset: '7,7', solvation: mode }));
    if (b.s.solv.mode !== mode || b.s.solv.dG.length !== 2 || rel(b.s.solv.dG[0], sv.Na * 1000) > 1e-15 || rel(b.s.solv.dG[1], sv.Cl * 1000) > 1e-15) oneClosure = false;
  }
  const worst = checks.reduce((p, c) => (c[1] > p[1] ? c : p), ['', 0]);
  const pass = worst[1] <= 1e-12 && zeroMax === 0 && sterMax <= 1e-12 && oneClosure && hydMatch;
  record('I12', 'Conventions and parameters', pass, checks.length + ' closed-form checks, largest relative difference ' + e2(worst[1]) + ' (' + worst[0] + '); with fixed charge on and solvation off, max |μ_ex| = ' + zeroMax +
    ' J mol⁻¹ (step 2) and μ_ex equals the finite-size term to ' + e2(sterMax) + ' (step 3); one solvation closure at a time: ' + oneClosure + '; preset counts equal data/hydration.json: ' + hydMatch);
}

/* ---------------------------------------------------------------- I13 model-domain flags */
{
  let ok = true, nFlag = { 'single-file': 0, occupancy: 0, packing: 0, overlap: 0 }, bad = '';
  for (const q of sweep) {
    const ids = q.r.flags.map((f) => f.id), nIn = q.r.nInPore[0] + q.r.nInPore[1];
    const want = { 'single-file': q.pr === '6,6', occupancy: nIn < 1, packing: q.r.packingMax > 0.5, overlap: q.r.debyeLength > q.r.poreRadius };
    for (const k of Object.keys(want)) { const has = ids.includes(k); if (has !== want[k]) { ok = false; bad = q.pr + ' step ' + q.st + ' ' + k; } if (has) nFlag[k]++; }
  }
  record('I13', 'Model-domain flags', ok, 'flags agree with the computed quantities in all ' + sweep.length + ' solutions of the I6 sweep' + (ok ? '' : ' — mismatch: ' + bad) + '; counts: single-file ' + nFlag['single-file'] + ', occupancy < 1 ' + nFlag.occupancy + ', packing > 0.5 ' + nFlag.packing + ', Debye length > radius ' + nFlag.overlap);
}

/* ---------------------------------------------------------------- I14 reported selectivity */
// independent classification of a GHK inversion (same contract as the page, written separately): Nernst potentials of
// the reservoir activities, a 1 nV band at each, invalid beyond them, display range 10⁻⁴ … 10⁴
function classify(V, gL, gR) {
  const nNa = VT * Math.log((0.01 * gR) / (0.1 * gL)), nCl = -nNa, lo = Math.min(nNa, nCl), hi = Math.max(nNa, nCl);
  const u = Math.exp(V / VT), r = (0.1 * gL - u * 0.01 * gR) / (u * 0.1 * gL - 0.01 * gR);
  let st;
  if (!isFinite(V)) st = 'not_found';
  else if (Math.abs(V - nNa) <= 1e-9) st = 'nernst_na';
  else if (Math.abs(V - nCl) <= 1e-9) st = 'nernst_cl';
  else if (V < lo || V > hi || !(r > 0)) st = 'invalid';
  else if (r > 1e4) st = 'above_limit';
  else if (r < 1e-4) st = 'below_limit';
  else st = 'finite';
  const text = { finite: Number(r).toPrecision(3), above_limit: '> 10⁴', nernst_na: '> 10⁴', below_limit: '< 10⁻⁴', nernst_cl: '< 10⁻⁴', invalid: 'outside GHK range', not_found: '–' }[st];
  return { r, st, text, nNa, nCl };
}
const gammas = (st) => { const vv = st >= 3 ? 6.02214076e23 * Math.pow(0.45e-9, 3) * 1000 : 0; return [1 / (1 - vv * 0.2), 1 / (1 - vv * 0.02)]; };
{
  let ok = true, worstG = 0, worstI = 0, nCapped = 0; const parts = [], counts = {};
  for (const pr of PRESETS) for (const st of STEPS) {
    const bg = Pm.build({ preset: pr, step: st, c: 100, cR: 10 }), rv = Core.reversal(bg.s);
    const sel = Pm.selectivity({ preset: pr, step: st, c: 100 }, rv.V);          // what the page reports
    const [gL, gR] = gammas(st), ind = classify(rv.V, gL, gR);
    const ip = Core.solve(Core.withV(bg.s, 0.05)).I, im = Core.solve(Core.withV(bg.s, -0.05)).I;
    const qI = Math.abs(rv.I) / Math.min(Math.abs(ip), Math.abs(im));
    ok = ok && rv.ok && sel.status === ind.st && sel.text === ind.text; worstI = Math.max(worstI, qI);
    counts[sel.status] = (counts[sel.status] || 0) + 1;
    if (sel.status !== 'finite') nCapped++; else worstG = Math.max(worstG, rel(sel.ratio, ind.r));
    if (pr === '7,7') parts.push('step ' + st + ': V_rev ' + (rv.V * 1000).toFixed(2) + ' mV, GHK-equivalent ' + sel.text);
  }
  record('I14', 'Reported selectivity', ok && worstG <= 1e-12 && worstI <= 1e-6, '24 cases: displayed values agree with an independent GHK inversion (reservoir activities) to ' + e2(worstG) + ' (' + (24 - nCapped) + ' numbers); statuses ' + JSON.stringify(counts) + ', each equal to an independent classification (Nernst potentials, 1 nV band, display range); no reversal potential lies outside the Nernst potentials; largest |I(V_rev)|/min|I(±50 mV)| = ' + e2(worstI) + '; (7,7): ' + parts.join('; '));
}

/* ---------------------------------------------------------------- I15 selectivity classification (release 2026.9.1) */
{
  let ok = true; const lines = [];
  const check = (label, o, V, want, extra) => {
    const sel = Pm.selectivity(o, V);
    let pass = sel.status === want;
    if (want === 'above_limit' || want === 'below_limit') pass = pass && sel.ratio > 0;
    if (want === 'invalid') pass = pass && sel.text === 'outside GHK range' && sel.ratio < 0;
    if (extra) pass = pass && extra(sel);
    if (sel.status === 'invalid' && (sel.text === '> 10⁴' || sel.text === '< 10⁻⁴')) pass = false;
    ok = ok && pass;
    lines.push(label + ' → ' + sel.status + (pass ? '' : ' (expected ' + want + ')'));
    return sel;
  };
  for (const st of [6, 2]) {
    const o = Object.assign({}, Pm.DEFAULTS, { step: st }), [gL, gR] = gammas(st), base = classify(0, gL, gR);
    const nNa = base.nNa, nCl = base.nCl, tag = 'step ' + st + ' ';
    check(tag + '10 µV inside the Na⁺ limit', o, nNa + 10e-6, 'above_limit');
    check(tag + 'at the Na⁺ limit', o, nNa, 'nernst_na');
    check(tag + '0.5 nV beyond the Na⁺ limit', o, nNa - 0.5e-9, 'nernst_na');
    check(tag + '10 µV beyond the Na⁺ limit', o, nNa - 10e-6, 'invalid');
    check(tag + '10 µV inside the Cl⁻ limit', o, nCl - 10e-6, 'below_limit');
    check(tag + 'at the Cl⁻ limit', o, nCl, 'nernst_cl');
    check(tag + '0.5 nV beyond the Cl⁻ limit', o, nCl + 0.5e-9, 'nernst_cl');
    check(tag + '10 µV beyond the Cl⁻ limit', o, nCl + 10e-6, 'invalid');
  }
  const o6 = Object.assign({}, Pm.DEFAULTS, { step: 6 });
  const m70 = check('step 6 at −70 mV', o6, -0.070, 'invalid'), p70 = check('step 6 at +70 mV', o6, 0.070, 'invalid');
  check('no reversal potential', o6, NaN, 'not_found', (s) => s.text === '–');
  const oc = { preset: '7,7', step: 1, c: 100 }, rv = Core.reversal(Pm.build(Object.assign({}, oc, { cR: 10 })).s);
  const ind = classify(rv.V, 1, 1);
  const cls = check('classical (7,7) V_rev ' + (rv.V * 1000).toFixed(2) + ' mV', oc, rv.V, 'finite', (s) => rel(s.ratio, ind.r) <= 1e-12 && s.text === ind.text);
  record('I15', 'Selectivity classification', ok, lines.length + ' probes: ' + lines.join('; ') + '; raw ratios kept: −70 mV ' + m70.ratio.toPrecision(4) + ', +70 mV ' + p70.ratio.toPrecision(4) + '; classical ratio ' + cls.text + ' (independent ' + Number(ind.r).toPrecision(6) + ', relative difference ' + e2(rel(cls.ratio, ind.r)) + ')');
}

/* ---------------------------------------------------------------- I16 numerical controller, I17 record, request, contract (release 2026.10) */
const Ctl = require(path.join(SITE, 'lab/continuum/ions/controller.js'));
const crypto = require('crypto');
const TGT = { standard: 5e-3, fine: 1e-3, strict: 2e-4 };
const noMs = (rec) => JSON.parse(JSON.stringify(rec, (k, v) => (k === 'ms' ? undefined : v)));
/* independent implementation of rules 2–6 and the amended gates, applied to the logged numbers */
function rules(levels, target, V) {
  const T = TGT[target], tolV = 0.04 * T, floor = 1e-16, dec = [];
  let status = null, reported = null;
  const found1 = levels.length ? levels[0].reversal.found : null;
  for (let i = 0; i < levels.length; i++) {
    const e = levels[i], c = e.current, v = e.reversal;
    const g1 = c.residual !== null && c.residual <= 1e-10 && (!v.found || (v.residual !== null && v.residual <= 1e-10));
    const g2 = V === 0 ? c.conservation_max_rel === null : c.conservation_max_rel !== null && c.conservation_max_rel <= 1e-9;
    const g3 = c.positive && c.packing_max < 1 && (!v.found || (v.positive && v.packing_max < 1));
    const g4 = v.found === found1;
    if (!g1) { dec.push('stop'); status = 'not_converged'; break; }
    if (!(g2 && g3 && g4)) { dec.push('stop'); status = 'check_failed'; break; }
    if (i === 0) { dec.push('compare'); continue; }
    const a = levels[i - 1], dI = Math.abs(e.I_A - a.I_A), small = Math.abs(a.I_A) < floor && Math.abs(e.I_A) < floor;
    const okI = small ? dI <= floor : e.I_A !== 0 && dI / Math.abs(e.I_A) <= T;
    const dV = a.V_rev_V !== null && e.V_rev_V !== null ? Math.abs(e.V_rev_V - a.V_rev_V) : null;
    const okV = dV === null || dV <= tolV;
    if (okI && okV) { dec.push('stop'); status = 'tolerance_reached'; reported = e.level - 1; break; }
    if (e.level < 3) { dec.push('refine'); continue; }
    dec.push('stop'); status = 'budget_exhausted'; reported = 3; break;
  }
  return { dec, status, reported };
}
function followsRules(n, target, V) {
  const want = rules(n.levels, target, V), got = n.levels.map((e) => e.decision);
  const sameDec = want.dec.length === got.length && want.dec.every((d, i) => d === got[i]);
  const last = n.levels[n.levels.length - 1];
  const changesOk = n.levels.every((e, i) => {
    if (!e.change) return i === 0 || !e.gates_passed;
    const a = n.levels[i - 1], dI = Math.abs(e.I_A - a.I_A);
    const relOk = e.change.mode === 'absolute_floor' ? e.change.current_rel === null : rel(e.change.current_rel, dI / Math.abs(e.I_A)) <= 1e-12;
    const dVok = e.change.V_rev_V === null ? (a.V_rev_V === null || e.V_rev_V === null) : rel(e.change.V_rev_V, Math.abs(e.V_rev_V - a.V_rev_V)) <= 1e-12;
    return relOk && dVok && rel(e.change.current_abs_A, dI) <= 1e-12;
  });
  const noFalseReach = !(n.outcome.status === 'tolerance_reached' && last && last.change && !(last.change.mode === 'absolute_floor' ? last.change.current_abs_A <= 1e-16 : last.change.current_rel <= TGT[target]));
  return { ok: sameDec && want.status === n.outcome.status && want.reported === n.outcome.reported_level && changesOk && noFalseReach, want, sameDec, changesOk, noFalseReach };
}
/* memoising solver for the sweeps: each (query, level) is solved once; the values are those of the real solver */
function memoSolver() {
  const base = Ctl.defaultSolver(), cache = new Map(); let calls = 0;
  const key = (kind, o, level) => kind + '|' + level + '|' + JSON.stringify(['preset', 'step', 'V', 'c', 'solvation', 'lining', 'epsP', 'rimN', 'Dratio', 'slip'].map((k) => (kind === 'rev' && k === 'V' ? 0 : o[k])));
  const get = (kind, o, level) => { const k = key(kind, o, level); if (!cache.has(k)) { calls++; cache.set(k, kind === 'cur' ? base.current(o, level) : base.reversal(o, level)); } return cache.get(k); };
  return { current: (o, l) => get('cur', o, l), reversal: (o, l) => get('rev', o, l), calls: () => calls };
}
/* independent one-at-a-time ranking (same procedure as the page, written here again) */
function indepRanking(o0) {
  const o = Object.assign({}, Pm.DEFAULTS, o0, { level: 1 });
  const base = Core.solve(Pm.build(Object.assign({}, o, { V: 0.1 })).s);
  return Pm.sensitivityInputs(o).map((inp) => {
    const lo = Core.solve(Pm.build(Object.assign({}, o, inp.lo, { V: 0.1 })).s, { prev: base.state }), hi = Core.solve(Pm.build(Object.assign({}, o, inp.hi, { V: 0.1 })).s, { prev: base.state });
    return { id: inp.id, ok: lo.ok && hi.ok, factor: Math.max(Math.abs(hi.I), Math.abs(lo.I)) / Math.min(Math.abs(hi.I), Math.abs(lo.I)) };
  }).sort((a, b) => b.factor - a.factor);
}
const records = [];                                                    // every full record built in I16, for I17
{
  const det = [], okParts = {};
  // (a) and (b): default experiment, three targets, fresh solves; independent solves at every logged level
  const D = { preset: '7,7', step: 6, V: 0.1, c: 100 }, rankD = Ctl.ranking(D);
  let bOk = true, aOk = true; const aTxt = [];
  for (const target of ['standard', 'fine', 'strict']) {
    const n = Ctl.run(Object.assign({}, D, { target }));
    records.push({ tag: 'default ' + target, rec: Ctl.record(n, rankD, { websiteVersion: 'test' }), V: D.V, step: 6, query: Object.assign({}, D, { target }) });
    const fr = followsRules(n, target, D.V);
    for (const e of n.levels) {
      const o = Object.assign({}, Pm.DEFAULTS, D, { level: e.level });
      const r = Core.solve(Pm.build(o).s), rv = Core.reversal(Pm.build(Object.assign({}, o, { cL: o.c, cR: o.c / o.gradient })).s);
      bOk = bOk && rel(e.I_A, r.I) <= 1e-12 && rel(e.V_rev_V, rv.V) <= 1e-12 && e.nodes === r.x.length && rel(e.current.residual, r.residual) <= 1e-12 && rel(e.reversal.residual, rv.result.residual) <= 1e-12;
    }
    bOk = bOk && fr.ok;
    if (target === 'standard') aOk = aOk && n.outcome.status === 'tolerance_reached' && n.outcome.reported_level === 1 && n.levels.length === 2;
    aTxt.push(target + ': ' + n.outcome.status + ', reported level ' + n.outcome.reported_level + ', levels ' + n.levels.map((e) => e.level + ' ' + e.decision + (e.change ? ' (' + (e.change.mode === 'absolute_floor' ? 'abs ' + e2(e.change.current_abs_A) : (100 * e.change.current_rel).toPrecision(3) + ' %') + ', ' + (e.change.V_rev_V === null ? '–' : (1e3 * e.change.V_rev_V).toPrecision(3) + ' mV') + ')' : '')).join(', '));
  }
  okParts.a = aOk; okParts.b = bOk;
  det.push('(a) ' + aTxt.join('; ')); det.push('(b) logged I, V_rev, nodes and residuals equal independent solves to 10⁻¹², logged changes recomputed, decisions equal the independent rules: ' + bOk);
  // (c) sweeps with a memoising solver
  const solver = memoSolver(), rankCache = new Map();
  const rankFor = (pr, st) => { const k = pr + '|' + st; if (!rankCache.has(k)) rankCache.set(k, Ctl.ranking({ preset: pr, step: st })); return rankCache.get(k); };
  let cOk = true, nC = 0, floorUsed = 0, floorCases = 0; const statusCount = {};
  const sweep = [];
  for (const pr of PRESETS) for (const st of STEPS) for (const V of [-0.2, 0, 0.1]) sweep.push({ preset: pr, step: st, V, target: 'standard' });
  for (const target of ['fine', 'strict']) for (const pr of PRESETS) for (const st of [1, 4, 6]) sweep.push({ preset: pr, step: st, V: 0.1, target });
  for (const q of sweep) {
    const n = Ctl.run(q, { solver }), fr = followsRules(n, q.target, q.V); nC++;
    statusCount[q.target + ' ' + n.outcome.status] = (statusCount[q.target + ' ' + n.outcome.status] || 0) + 1;
    if (q.V === 0) { floorCases++; const L = n.levels[1]; if (L && L.change && L.change.mode === 'absolute_floor') floorUsed++; }
    cOk = cOk && fr.ok;
    if (!fr.ok) det.push('rule mismatch: ' + JSON.stringify(q) + ' got ' + n.outcome.status + ' want ' + fr.want.status);
    records.push({ tag: JSON.stringify(q), rec: Ctl.record(n, rankFor(q.preset, q.step), { websiteVersion: 'test' }), V: q.V, step: q.step, query: q });
  }
  okParts.c = cOk && floorUsed === floorCases;
  det.push('(c) ' + nC + ' records (72 at the standard target, 24 at the fine and strict targets): every record follows rules 1–6 and none states tolerance reached above its target: ' + cOk + '; statuses ' + JSON.stringify(statusCount) + '; absolute current floor at V = 0 in ' + floorUsed + ' of ' + floorCases);
  // (d) refusals without any solve
  const counting = { n: 0, current: () => { counting.n++; throw new Error('solved'); }, reversal: () => { counting.n++; throw new Error('solved'); } };
  const bad = [[{ V: 0.3 }, 'VOLTAGE_OUT_OF_RANGE'], [{ preset: '8,8' }, 'TUBE_UNSUPPORTED'], [{ c: 5000 }, 'CONCENTRATION_UNSUPPORTED'], [{ target: 'extreme' }, 'TARGET_UNKNOWN'], [{ solvation: 'pmf' }, 'CLOSURE_UNKNOWN']];
  let dOk = true; const dTxt = [];
  for (const [q, code] of bad) {
    const n = Ctl.run(q, { solver: counting });
    const ok = n.outcome.status === 'refused' && n.domain.reasons.includes(code) && n.levels.length === 0;
    dOk = dOk && ok; dTxt.push(JSON.stringify(q) + ' → ' + n.outcome.status + ' [' + n.domain.reasons.join(', ') + ']');
    records.push({ tag: 'refused ' + JSON.stringify(q), rec: Ctl.record(n, null, { websiteVersion: 'test' }), V: q.V, step: 6, query: q });
  }
  okParts.d = dOk && counting.n === 0;
  det.push('(d) ' + dTxt.join('; ') + '; solves attempted: ' + counting.n);
  // (e) determinism
  const r1 = noMs(Ctl.record(Ctl.run(D), rankD, { websiteVersion: 'test' })), r2 = noMs(Ctl.record(Ctl.run(D), Ctl.ranking(D), { websiteVersion: 'test' }));
  okParts.e = JSON.stringify(r1) === JSON.stringify(r2);
  det.push('(e) same query twice gives the same record apart from timing: ' + okParts.e);
  // (f) an injected solver that fails at level 2
  const real = Ctl.defaultSolver();
  const failing = { current: (o, l) => { const r = real.current(o, l); return l === 2 ? Object.assign({}, r, { ok: false, residual: 1e-6 }) : r; }, reversal: (o, l) => real.reversal(o, l) };
  const nf = Ctl.run(D, { solver: failing }), rf = Ctl.record(nf, rankD, { websiteVersion: 'test' });
  okParts.f = nf.outcome.status === 'not_converged' && nf.outcome.reported_level === null && nf.outcome.I_A === null && rf.request === null;
  records.push({ tag: 'injected failure at level 2', rec: rf, V: D.V, step: 6, query: D });
  det.push('(f) injected solver failing at level 2 → ' + nf.outcome.status + ', certified result ' + nf.outcome.reported_level + ', request ' + rf.request);
  // a check-failed record for I17 (gate G2 forced at level 2)
  const g2 = { current: (o, l) => { const r = real.current(o, l); return l === 2 ? Object.assign({}, r, { Jdev: [1e-6, 1e-6] }) : r; }, reversal: (o, l) => real.reversal(o, l) };
  const ng = Ctl.run(D, { solver: g2 });
  records.push({ tag: 'injected conservation failure at level 2', rec: Ctl.record(ng, rankD, { websiteVersion: 'test' }), V: D.V, step: 6, query: D, kind: ng.outcome.status });
  record('I16', 'Numerical controller', Object.values(okParts).every(Boolean), det.join('; ') + '; solver calls in the sweeps (memoised): ' + solver.calls());
}
{
  const det = [], okParts = {};
  // (a) schema and consistency of every record, and rejection of corrupted copies
  const invalid = records.filter((r) => !Ctl.validate(r.rec).valid);
  const kinds = {}; records.forEach((r) => { kinds[r.rec.outcome.status] = kinds[r.rec.outcome.status] || r.rec; });
  const corrupt = [];
  const mut = (rec, f, name) => { const c = JSON.parse(JSON.stringify(rec)); f(c); corrupt.push({ name, rejected: !Ctl.validate(c).valid }); };
  for (const [st, rec] of Object.entries(kinds)) {
    mut(rec, (c) => { c.extra_field = 1; }, st + ': unknown top-level field');
    mut(rec, (c) => { c.policy.language_model_used = true; }, st + ': language model claimed');
    mut(rec, (c) => { c.outcome.status = st === 'tolerance_reached' ? 'budget_exhausted' : 'tolerance_reached'; }, st + ': status changed');
    if (rec.levels.length) mut(rec, (c) => { c.levels[0].unknown = 0; }, st + ': unknown level field');
    if (st === 'refused') mut(rec, (c) => { c.levels.push(JSON.parse(JSON.stringify(kinds.tolerance_reached.levels[0]))); }, 'refused: a level added');
    if (st === 'not_converged' || st === 'check_failed') mut(rec, (c) => { c.outcome.reported_level = 1; c.outcome.I_A = c.levels[0].I_A; }, st + ': a certified result added');
    if (st === 'tolerance_reached' && rec.levels.length > 2) mut(rec, (c) => { c.levels[1].decision = 'stop'; }, st + ': stop before the last level');
  }
  const withReq = records.find((r) => r.rec.request);
  if (withReq) {
    mut(withReq.rec, (c) => { c.request.submitted = true; }, 'request marked submitted');
    mut(withReq.rec, (c) => { c.request.execution_status = 'completed'; }, 'request marked completed');
    mut(withReq.rec, (c) => { c.request.expected_variance_reduction = 0.5; }, 'variance reduction claimed');
    mut(withReq.rec, (c) => { c.request.input_id = 'slip'; }, 'request names another input');
  }
  const budget = records.find((r) => r.rec.outcome.status === 'budget_exhausted');
  if (budget) mut(budget.rec, (c) => { c.outcome.status = 'tolerance_reached'; c.outcome.certified_by_level = 3; c.outcome.reported_level = 2; }, 'budget exhausted relabelled as reached');
  okParts.a = invalid.length === 0 && corrupt.every((c) => c.rejected) && ['tolerance_reached', 'budget_exhausted', 'not_converged', 'check_failed', 'refused'].every((k) => kinds[k]);
  det.push('(a) ' + records.length + ' records validate: ' + (invalid.length === 0) + (invalid.length ? ' (' + invalid.map((r) => r.tag + ': ' + Ctl.validate(r.rec).errors.slice(0, 2).join('; ')).slice(0, 3).join(' | ') + ')' : '') + '; statuses present: ' + Object.keys(kinds).join(', ') + '; ' + corrupt.filter((c) => c.rejected).length + ' of ' + corrupt.length + ' corrupted copies rejected' + (corrupt.every((c) => c.rejected) ? '' : ' (accepted: ' + corrupt.filter((c) => !c.rejected).map((c) => c.name).join(', ') + ')'));
  // (b) rule 7 against an independent ranking
  const indep = new Map(); let bOk = true, issued = 0, notIssued = 0; const bad = [];
  for (const r of records) {
    const rec = r.rec, q = rec.query, st = rec.outcome.status;
    if (st === 'refused') { if (rec.request !== null) { bOk = false; bad.push(r.tag); } notIssued++; continue; }
    const k = q.preset + '|' + q.step;
    if (!indep.has(k)) indep.set(k, indepRanking({ preset: q.preset, step: q.step }));
    const rows = indep.get(k), top = rows[0];
    const L = rec.levels[rec.levels.length - 1], last = L && L.change ? (L.change.mode === 'absolute_floor' ? 0 : L.change.current_rel) : null;
    const want = ['tolerance_reached', 'budget_exhausted'].includes(st) && q.step >= 2 && !!top && rows.every((x) => x.ok) && last !== null && top.factor - 1 >= 10 * last;
    const got = rec.request !== null;
    const fieldsOk = !got || (rec.request.input_id === top.id && rel(rec.request.sensitivity_factor, top.factor) <= 1e-9 && rec.request.execution_status === 'not_run' && rec.request.human_approval_required === true && rec.request.approved === false && rec.request.submitted === false && rec.request.expected_variance_reduction === null && rec.request.cost_estimate === null && rec.policy.language_model_used === false);
    if (want !== got || !fieldsOk) { bOk = false; bad.push(r.tag); }
    if (got) issued++; else notIssued++;
  }
  okParts.b = bOk;
  const dReq = records.find((r) => r.tag === 'default standard').rec.request;
  det.push('(b) requests issued in ' + issued + ' records and withheld in ' + notIssued + ', each as rule 7 says against an independent ranking: ' + bOk + (bad.length ? ' (mismatch: ' + bad.slice(0, 3).join(' | ') + ')' : '') + '; default experiment: ' + (dReq ? dReq.input_id + ' ×' + dReq.sensitivity_factor.toPrecision(3) + ', not run, approval required, not submitted' : 'none'));
  // (c) closure contracts
  const dataDir = path.join(SITE, 'lab/continuum/ions/data');
  const ill = JSON.parse(fs.readFileSync(path.join(dataDir, 'closure-illustrative.json'), 'utf8')), tpl = JSON.parse(fs.readFileSync(path.join(dataDir, 'closure-molecular-template.json'), 'utf8'));
  const hydBytes = fs.readFileSync(path.join(dataDir, 'hydration.json')), hyd = JSON.parse(hydBytes);
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  let worst = 0, n = 0; const cmpv = (a, b) => { n++; worst = Math.max(worst, rel(a, b)); };
  for (const [sp, key, hk] of [[ill.species[0], 'Na', 'Na+'], [ill.species[1], 'Cl', 'Cl-']]) {
    cmpv(sp.hydration_gibbs_energy.value, Pm.MARCUS[key] * 1000); cmpv(sp.born_radius.value, Pm.R_BORN[key] * 1e-9); cmpv(sp.first_shell_radius.value, Pm.R_SHELL[key] * 1e-9);
    cmpv(sp.first_shell_share_of_hydration_energy.value, Pm.G1[key] * 1000); cmpv(sp.reference_shell_count.value, Pm.REF['n' + key]); cmpv(sp.bulk_diffusivity.value, Pm.DT[key]);
    for (const p of Pm.PRESETS) {
      cmpv(sp.first_shell_count.values[p.id], p['n' + key]); cmpv(sp.first_shell_count.values[p.id], hyd.tubes.find((t) => t.n === p.n).ions[hk].mean_count);
      for (const l of Object.keys(Pm.LININGS)) { cmpv(sp.excess_free_energy_in_pore.dehydration_recorded_shells[p.id][l], Pm.solvation({ preset: p.id, solvation: 'cp2k', lining: l })[key] * 1000); cmpv(sp.excess_free_energy_in_pore.dehydration_rigid_shell[p.id][l], Pm.solvation({ preset: p.id, solvation: 'shell', lining: l })[key] * 1000); }
      for (const e of [10, 20, 30, 50]) cmpv(sp.excess_free_energy_in_pore.born_exclusion[p.id]['epsP_' + e], Pm.solvation({ preset: p.id, solvation: 'born', epsP: e })[key] * 1000);
    }
    for (const l of Object.keys(Pm.LININGS)) cmpv(sp.wall_recovery_kappa.values[l], Pm.LININGS[l]['k' + key]);
  }
  for (const t of ill.geometry.tubes) { const g = Pm.geometry(Pm.presetOf(t.id)); cmpv(t.carbon_centre_radius.value, g.Rc * 1e-9); cmpv(t.ion_accessible_radius.value, g.a * 1e-9); cmpv(t.water_accessible_radius.value, g.Rw * 1e-9); }
  const hydSha = ill.provenance.source_artifacts[0].sha256 === sha(hydBytes);
  const trajSha = ill.provenance.source_artifacts.slice(1).every((a) => fs.existsSync(path.join(SITE, a.path)) && sha(fs.readFileSync(path.join(SITE, a.path))) === a.sha256);
  const ci = Ctl.checkClosure(ill), ct = Ctl.checkClosure(tpl);
  const tplNull = tpl.species.every((x) => x.excess_free_energy.values === null && x.axial_diffusivity.values === null) && tpl.geometry.axial_coordinate.values === null && tpl.geometry.accessible_area.values === null;
  let regen = 0; try { cp.execFileSync('node', [path.join(__dirname, 'make_closures.js'), '--check'], { encoding: 'utf8' }); } catch (e) { regen = e.status || 1; }
  okParts.c = worst <= 1e-12 && hydSha && trajSha && ct.status === 'blocked' && !ct.usable_as_calibrated && tplNull && !ci.usable_as_calibrated && regen === 0;
  det.push('(c) ' + n + ' contract values against params.js and hydration.json: largest relative difference ' + e2(worst) + '; SHA-256 of hydration.json ' + (hydSha ? 'matches' : 'differs') + ', of the four trajectories ' + (trajSha ? 'match' : 'differ') + '; template: ' + ct.status + ' with ' + ct.null_paths.length + ' required values null, usable as calibrated ' + ct.usable_as_calibrated + '; illustrative contract: ' + ci.status + ', usable as calibrated ' + ci.usable_as_calibrated + '; make_closures.js --check exit ' + regen);
  record('I17', 'Decision record, calculation request and closure contract', Object.values(okParts).every(Boolean), det.join('; '));
}

/* ---------------------------------------------------------------- I18 controller guards (release 2026.10.1): the nine probes of
   probe_controller_guards.js, run as a separate process on this repository; its report is kept in results/controller.guards.json */
{
  const outFile = path.join(SITE, 'tools/continuum/results/controller.guards.json');
  let code = 0;
  try { cp.execFileSync('node', [path.join(__dirname, 'probe_controller_guards.js'), '--site', SITE, '--out', outFile], { encoding: 'utf8' }); } catch (e) { code = e.status || 1; }
  let rep = null; try { rep = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch (e) { rep = null; }
  const rows = rep ? rep.rows : [];
  const ok = code === 0 && !!rep && rep.pass === true && rows.length === 9 && rows.every((r) => r.pass);
  record('I18', 'Controller guards', ok, (rep ? rep.passed + ' of ' + rep.total + ' probes hold: ' : 'no report; ') + rows.map((r) => r.id + ' → ' + r.observed + (r.gate ? ' (' + r.gate + ')' : '') + (r.pass ? '' : ' FAIL')).join('; ') + '; exit ' + code);
}

const order = ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9', 'I10', 'I11', 'I12', 'I13', 'I14', 'I15', 'I16', 'I17', 'I18'];
items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
const verdict = items.every((i) => i.verdict === 'PASS') ? 'PASS' : (items.some((i) => i.verdict === 'FAIL') ? 'FAIL' : 'INCOMPLETE');
const out = { id: 'ions', name: 'Ion experiment solver and controller I1–I18', verdict, items, environment: 'Node ' + process.version + ', ' + os.platform() + ' ' + os.arch() + ', ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s', date: new Date().toISOString() };
fs.writeFileSync(path.join(SITE, 'tools/continuum/results/t_ions.json'), JSON.stringify(out, null, 1) + '\n');
console.log('verdict', verdict, out.environment);
process.exit(verdict === 'PASS' ? 0 : 1);
