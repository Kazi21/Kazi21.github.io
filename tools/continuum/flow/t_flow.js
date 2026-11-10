#!/usr/bin/env node
/* Flow benchmark — numerical verification (P1–P11), source-curve reproduction (PR1–PR6) and the reported agreement with
   molecular dynamics. Criteria: tools/continuum/flow/TOLERANCES.md (written before the first formal run).
   Usage: node tools/continuum/flow/t_flow.js [--out results/t_flow.json]
   Writes tools/continuum/results/t_flow.json; exit code 1 if any item fails. */
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const HERE = __dirname, ROOT = path.join(HERE, '..', '..', '..');
const F = require(path.join(ROOT, 'lab', 'continuum', 'flow', 'core.js'));
const CASES = JSON.parse(fs.readFileSync(path.join(ROOT, 'lab', 'continuum', 'flow', 'data', 'cases.json'), 'utf8'));
const OUT = process.argv.indexOf('--out') > 0 ? process.argv[process.argv.indexOf('--out') + 1] : path.join(HERE, '..', 'results', 't_flow.json');
const cs = CASES.cases.find((c) => c.id === 'pccp2024-water-cnt2020');
const items = [];
const rec = (id, name, pass, detail) => { items.push({ id, name, verdict: pass ? 'PASS' : 'FAIL', detail }); console.log((pass ? 'PASS ' : 'FAIL ') + id + ' ' + name + ' — ' + detail); };
const e = (x, n) => Number(x).toExponential(n === undefined ? 3 : n);
const rel = (a, b) => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)));
const PI = Math.PI;
const FAM = ['classical', 'slip_velocity'], BND = ['D', 'Dp'], VIS = ['interfacial', 'green_kubo', 'experimental'];
const combos = []; FAM.forEach((f) => BND.forEach((b) => VIS.forEach((v) => combos.push({ family: f, boundary: b, viscosity: v }))));
const radii = (R) => Array.from({ length: 201 }, (_, i) => R * i / 200);
function simpson(f, a, b, n) { const h = (b - a) / n; let s = f(a) + f(b); for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2); return s * h / 3; }
const base = F.specFromCase(cs, {});

// ---------------------------------------------------------------- numerical verification
{ const r = F.evaluate(Object.assign({}, base, { dP_Pa: 0, us_m_s: 0 }));
  const worst = Math.max(...radii(r.R_m).map((x) => Math.abs(r.u(x))));
  rec('P1', 'Zero drive', worst === 0 && r.Q_m3_s === 0, `largest |u| at 201 radii ${worst}; Q = ${r.Q_m3_s}`); }
{ const a = F.evaluate(base), b = F.evaluate(Object.assign({}, base, { dP_Pa: -base.dP_Pa, us_m_s: -base.us_m_s }));
  const w = Math.max(rel(a.Q_m3_s, -b.Q_m3_s), ...radii(a.R_m).map((x) => rel(a.u(x), -b.u(x))));
  rec('P2', 'Reversal', w <= 1e-12, `largest relative deviation of −u(r) and −Q under reversal ${e(w, 2)} (limit 1e-12)`); }
{ let w = 0; const d = [];
  BND.forEach((bd) => { const s = F.specFromCase(cs, { family: 'slip_velocity', boundary: bd }); s.us_m_s = 0; const r = F.evaluate(s);
    const u0 = s.R_m * s.R_m * (s.dP_Pa / s.L_m) / (4 * s.mu_Pa_s), q = PI * Math.pow(s.R_m, 4) * (s.dP_Pa / s.L_m) / (8 * s.mu_Pa_s);
    w = Math.max(w, rel(r.u(0), u0), rel(r.Q_m3_s, q)); d.push(`${bd}: u(0) = ${e(r.u(0), 6)} m/s, Q = ${e(r.Q_m3_s, 6)} m³/s`); });
  rec('P3', 'No-slip limit', w <= 1e-12, `${d.join('; ')}; largest relative deviation from Hagen–Poiseuille ${e(w, 2)} (limit 1e-12)`); }
{ let w4 = 0, w5 = 0;
  combos.forEach((c) => { const s = F.specFromCase(cs, c), r = F.evaluate(s);
    const q = simpson((x) => 2 * PI * x * r.u(x), 0, r.R_m, 2000);
    w4 = Math.max(w4, rel(q, r.Q_m3_s));
    w5 = Math.max(w5, rel(r.mean_velocity_m_s, s.us_m_s + s.R_m * s.R_m * (s.dP_Pa / s.L_m) / (8 * s.mu_Pa_s))); });
  rec('P4', 'Flow rate equals the integral of the profile', w4 <= 1e-9, `12 combinations; largest relative difference between Q and 2π∫u r dr (Simpson, 2000 intervals) ${e(w4, 2)} (limit 1e-9)`);
  rec('P5', 'Mean velocity', w5 <= 1e-12, `12 combinations; largest relative difference between Q/(πR²) and u_s + R²G/(8μ) ${e(w5, 2)} (limit 1e-12)`); }
{ const a = F.evaluate(base), Ls = a.equivalent_slip_length_m;
  const b = F.evaluate({ family: 'slip_length', R_m: base.R_m, L_m: base.L_m, dP_Pa: base.dP_Pa, mu_Pa_s: base.mu_Pa_s, Ls_m: Ls });
  const w = Math.max(rel(a.Q_m3_s, b.Q_m3_s), ...radii(a.R_m).map((x) => rel(a.u(x), b.u(x))));
  rec('P6', 'Equivalent slip length', w <= 1e-12, `L_s = 2μu_s/(GR) = ${(Ls * 1e9).toFixed(4)} nm; largest relative difference between the slip-length and slip-velocity forms ${e(w, 2)} (limit 1e-12)`); }
{ let w = 0; const d = [];
  [3, 1].forEach((c) => { const r0 = F.evaluate(base), r = F.evaluate(Object.assign({}, base, { ends: { c } }));
    const q = base.dP_Pa / (r.ends.R_ends + r.ends.R_tube), qi = simpson((x) => 2 * PI * x * r.u(x), 0, r.R_m, 2000);
    w = Math.max(w, rel(r.Q_m3_s, q), rel(r.ends.dP_interior_Pa + r.ends.dP_ends_Pa, base.dP_Pa), rel(qi, r.Q_m3_s), rel(r.Q_m3_s, r.ends.interior_fraction * r0.Q_m3_s), rel(r.gradient_Pa_m * base.L_m, r.ends.dP_interior_Pa));
    d.push(`c = ${c}: interior fraction ${r.ends.interior_fraction.toFixed(6)}, Q = ${e(r.Q_m3_s, 6)} m³/s`); });
  rec('P7', 'Entrance resistance without double counting', w <= 1e-9, `${d.join('; ')}; largest relative deviation among Q = ΔP/(R_ends + R_tube), the pressure-drop sum, the profile integral and the interior gradient ${e(w, 2)} (limit 1e-9)`); }
{ const U = F.units, xs = [0.0232, 1, 3.7e-9], w = Math.max(...xs.map((x) => Math.max(rel(U.m3s_to_pLs(U.pLs_to_m3s(x)), x), rel(U.Pa_per_m_to_MPa_per_nm(U.MPa_per_nm_to_Pa_per_m(x)), x))));
  const ok = U.pLs_to_m3s(1) === 1e-15 && U.MPa_per_nm_to_Pa_per_m(1) === 1e15;
  rec('P8', 'Units', ok && w <= 1e-15, `1 pL/s = ${e(U.pLs_to_m3s(1), 0)} m³/s; 1 MPa/nm = ${e(U.MPa_per_nm_to_Pa_per_m(1), 0)} Pa/m; largest round-trip deviation ${e(w, 2)} (limit 1e-15)`); }
// expected values for every combination (also used by the browser suite)
const expected = {};
['default', 'alt'].forEach((len) => combos.forEach((c) => [false, true].forEach((ends) => {
  const r = F.evaluate(F.specFromCase(cs, Object.assign({ length: len, ends }, c))), uQ = F.flowUncertainty(cs, Object.assign({ length: len }, c)).Q_m3_s, cmp = F.compare(cs, r, ends ? undefined : uQ);
  expected[[len, c.family, c.boundary, c.viscosity, ends ? 'ends' : 'no_ends'].join('|')] = {
    Q_m3_s: r.Q_m3_s, mean_velocity_m_s: r.mean_velocity_m_s, interior_fraction: r.ends ? r.ends.interior_fraction : 1,
    equivalent_slip_length_m: r.equivalent_slip_length_m, amplitude_m_s: r.amplitude_m_s, wall_velocity_m_s: r.wall_velocity_m_s,
    profile_m_s: cmp.profile.map((p) => p.model_m_s), Q_rel: cmp.Q_rel, Q_rel_u: cmp.Q_rel_u, Q_u_m3_s: ends ? null : uQ, profile_rms_rel: cmp.profile_rms_rel, profile_worst_rel: cmp.profile_worst_rel };
})));
let pyRec = null;
{ let py = null, err = '';
  const pyOut = path.join(HERE, '..', 'results', 'flow_python.json');
  try { cp.execFileSync('python3', [path.join(HERE, 'reference_flow.py'), path.join(ROOT, 'lab', 'continuum', 'flow', 'data', 'cases.json'), pyOut], { stdio: 'pipe' }); pyRec = JSON.parse(fs.readFileSync(pyOut, 'utf8')); py = pyRec.cases[cs.id]; }
  catch (x) { err = String(x.message || x).split('\n')[0]; }
  let w = 0, n = 0, where = '';
  if (py) Object.keys(expected).forEach((k) => { const a = expected[k], b = py[k]; if (!b) { w = Infinity; where = k + ' missing'; return; }
    const ds = [rel(a.Q_m3_s, b.Q_m3_s), rel(a.mean_velocity_m_s, b.mean_velocity_m_s), rel(a.interior_fraction, b.interior_fraction)]
      .concat(a.profile_m_s.map((v, i) => (v === null ? (b.profile_m_s[i] === null ? 0 : Infinity) : rel(v, b.profile_m_s[i]))));
    const m = Math.max(...ds); if (m > w) { w = m; where = k; } n += 1; });
  rec('P9', 'Independent implementation', !!py && n === Object.keys(expected).length && w <= 1e-9,
    py ? `${n} combinations (2 lengths × 2 families × 2 boundaries × 3 viscosities × with and without end resistance) compared with reference_flow.py (force balance and quadrature; ${pyRec.environment}): largest relative difference ${e(w, 2)} at ${where} (limit 1e-9)` : `reference_flow.py did not run: ${err}`); }
{ const probes = [
    ['radius 0', () => F.evaluate(Object.assign({}, base, { R_m: 0 }))], ['viscosity −1', () => F.evaluate(Object.assign({}, base, { mu_Pa_s: -1 }))],
    ['length 0', () => F.evaluate(Object.assign({}, base, { L_m: 0 }))], ['family "plug"', () => F.evaluate(Object.assign({}, base, { family: 'plug' }))],
    ['boundary "X"', () => F.specFromCase(cs, { boundary: 'X' })], ['viscosity "bulk"', () => F.specFromCase(cs, { viscosity: 'bulk' })],
    ['a case that is not enabled', () => F.specFromCase(CASES.cases.find((c) => !c.enabled), {})],
    ['end resistance at zero drive', () => F.evaluate(Object.assign({}, base, { dP_Pa: 0, ends: { c: 3 } }))]];
  const refused = probes.filter(([, f]) => { try { f(); return false; } catch (x) { return true; } }).map(([n]) => n);
  rec('P10', 'Guards', refused.length === probes.length, `${refused.length} of ${probes.length} probes refused (${probes.map(([n]) => n).join('; ')})`); }

{ // P11 (added before run 3): propagated uncertainty against central finite differences on each input
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let w = 0, where = '';
  combos.forEach((c) => {
    const inputs = [['drives', 0, 'dP_MPa'], ['viscosity_mPa_s', c.viscosity], ['slip_velocity_m_s', c.boundary], ['geometry', c.boundary === 'D' ? 'D_nm' : 'Dp_nm']];
    let s2 = 0;
    inputs.forEach((pth) => {
      const get = (o) => pth.reduce((a, k) => a[k], o);
      const q0 = get(cs); if (typeof q0.u !== 'number') return;
      const h1 = 1e-6 * q0.value, a = clone(cs), b = clone(cs); get(a).value = q0.value + h1; get(b).value = q0.value - h1;
      const dQ = (F.evaluate(F.specFromCase(a, c)).Q_m3_s - F.evaluate(F.specFromCase(b, c)).Q_m3_s) / (2 * h1);
      s2 += Math.pow(dQ * q0.u, 2);
    });
    const fd = Math.sqrt(s2), mod = F.flowUncertainty(cs, c).Q_m3_s, d = rel(fd, mod);
    if (d > w) { w = d; where = [c.family, c.boundary, c.viscosity].join('|'); }
  });
  const dflt = F.flowUncertainty(cs, {}).Q_m3_s * 1e15;
  rec('P11', 'Uncertainty propagation', w <= 1e-6, `12 combinations; largest relative difference between the module's first-order uncertainty of Q and central finite differences on ΔP, viscosity, slip velocity and D′ ${e(w, 2)}${where ? ' at ' + where : ''} (limit 1e-6); default combination u(Q) = ${dflt.toPrecision(3)} pL/s`); }

// ---------------------------------------------------------------- source-curve reproduction
const sc = cs.source_curves, g = cs.geometry, dPv = cs.drives[0].dP_MPa, vis = cs.viscosity_mPa_s, sv = cs.slip_velocity_m_s;
const VNAME = { interfacial: 'interfacial viscosity', green_kubo: 'Green–Kubo viscosity', experimental: 'experimental viscosity' };
const z = (model, uModel, source, uSource) => (model - source) / Math.sqrt(uModel * uModel + uSource * uSource);
const fmtz = (x) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2);
function reproduction(len) {
  const L = (len === 'alt' ? g.L_nm.alt : g.L_nm.value);
  const curv = (vk) => dPv.value * 1e6 / (4 * vis[vk].value * 1e-3 * L * 1e-9) * 1e-18;           // m/s per nm²
  const relPar = (vk) => Math.hypot(dPv.u / dPv.value, vis[vk].u / vis[vk].value);
  const cI = curv('interfacial'), uC = cI * relPar('interfacial');
  const flow = (bd, vk) => { const ch = { boundary: bd, viscosity: vk, length: len };
    return { q: F.evaluate(F.specFromCase(cs, ch)).Q_m3_s * 1e15, u: F.flowUncertainty(cs, ch).Q_m3_s * 1e15 }; };
  const D = sc.fig6a_D, Dp = sc.fig6a_Dp;
  const wallD = D.c0_m_s - D.c2_m_s_nm2 * D.r_end_nm * D.r_end_nm, wallDp = Dp.c0_m_s - Dp.c2_m_s_nm2 * Dp.r_end_nm * Dp.r_end_nm;
  const out = {};
  out.PR1 = [{ what: 'curvature', model: cI, uModel: uC, source: D.c2_m_s_nm2, uSource: D.u_c2, unit: 'm s⁻¹ nm⁻²' }];
  out.PR2 = [{ what: 'wall value', model: sv.D.value, uModel: sv.D.u, source: wallD, uSource: D.u_end_m_s, unit: 'm/s' }];
  out.PR3 = [{ what: 'curvature', model: cI, uModel: uC, source: Dp.c2_m_s_nm2, uSource: Dp.u_c2, unit: 'm s⁻¹ nm⁻²' },
             { what: 'end radius', model: 0.5 * g.Dp_nm.value, uModel: 0.5 * g.Dp_nm.u, source: Dp.r_end_nm, uSource: Dp.u_r_end_nm, unit: 'nm' },
             { what: 'wall value', model: sv.Dp.value, uModel: sv.Dp.u, source: wallDp, uSource: Dp.u_end_m_s, unit: 'm/s' }];
  const fl = (bd, vk, key) => { const m = flow(bd, vk), s = sc.flow_pL_s[key]; return { what: `${bd === 'D' ? 'D' : 'D′'}, ${VNAME[vk]}`, model: m.q, uModel: m.u, source: s.value, uSource: s.u, unit: 'pL/s' }; };
  out.PR4 = [fl('D', 'experimental', 'D_experimental')];
  out.PR5 = [fl('D', 'green_kubo', 'D_green_kubo'), fl('D', 'interfacial', 'D_interfacial')];
  out.PR6 = [fl('Dp', 'experimental', 'Dp_experimental')];
  Object.keys(out).forEach((k) => out[k].forEach((c) => { c.z = z(c.model, c.uModel, c.source, c.uSource); }));
  return out;
}
const NAMES = { PR1: 'Fig. 6a, curve at D: curvature', PR2: 'Fig. 6a, curve at D: wall value', PR3: 'Fig. 6a, curve at D′', PR4: 'Fig. 7a, Eq. 5 at D, experimental viscosity',
  PR5: 'Fig. 7c, Eq. 5 at D, Green–Kubo and interfacial viscosity', PR6: 'Fig. 7a, Eq. 5 at D′, experimental viscosity' };
const sig = (x, n) => { const s = Number(x).toPrecision(n || 3); return /e/.test(s) ? String(Number(s)) : s; };
const describe = (cmp) => cmp.map((c) => `${c.what}: model ${sig(c.model)} ± ${sig(c.uModel, 2)} ${c.unit}, published ${sig(c.source)} ± ${sig(c.uSource, 2)}, z = ${fmtz(c.z)}`).join('; ');
const repro = reproduction('default'), reproAlt = reproduction('alt');
Object.keys(repro).forEach((k) => rec(k, NAMES[k], repro[k].every((c) => Math.abs(c.z) <= 2), `${describe(repro[k])} (limit −2 ≤ z ≤ 2; tube length ${g.L_nm.value} nm)`));

// ---------------------------------------------------------------- reported, not judged
const def = F.evaluate(base), defCmp = F.compare(cs, def, F.flowUncertainty(cs, {}).Q_m3_s), defEnds = F.evaluate(Object.assign({}, base, { ends: { c: 3 } }));
const reported = {
  note: 'Retrospective differences between the model and the published molecular-dynamics points. Reported, not judged.',
  default_combination: 'slip-velocity form at the wall position D with the interfacial viscosity, tube length ' + g.L_nm.value + ' nm',
  flow_rate: { model_pL_s: def.Q_m3_s * 1e15, u_model_pL_s: F.flowUncertainty(cs, {}).Q_m3_s * 1e15, md_pL_s: cs.md.flow_pL_s.value, u_md_pL_s: cs.md.flow_pL_s.u, rel: defCmp.Q_rel, u_rel: defCmp.Q_rel_u },
  mean_velocity: { model_m_s: def.mean_velocity_m_s, md_m_s: defCmp.mean_velocity_md_m_s },
  profile: defCmp.profile, profile_rms_rel: defCmp.profile_rms_rel, profile_worst_rel: defCmp.profile_worst_rel,
  entrance_resistance_c3: { interior_fraction: defEnds.ends.interior_fraction, Q_pL_s: defEnds.Q_m3_s * 1e15, Q_rel_to_md: defEnds.Q_m3_s / (cs.md.flow_pL_s.value * 1e-15) - 1, equivalent_slip_length_nm: def.equivalent_slip_length_m * 1e9 },
  by_combination: combos.map((c) => { const k = ['default', c.family, c.boundary, c.viscosity, 'no_ends'].join('|'), x = expected[k];
    return Object.assign({}, c, { Q_pL_s: x.Q_m3_s * 1e15, u_Q_pL_s: x.Q_u_m3_s * 1e15, Q_rel: x.Q_rel, u_Q_rel: x.Q_rel_u, profile_rms_rel: x.profile_rms_rel, profile_worst_rel: x.profile_worst_rel, mean_velocity_m_s: x.mean_velocity_m_s }); }),
  alternative_length_reproduction: { length_nm: g.L_nm.alt, note: 'recorded for information, not judged', comparisons: Object.keys(reproAlt).map((k) => ({ id: k, text: describe(reproAlt[k]), z: reproAlt[k].map((c) => c.z) })) }
};
const n = { PASS: items.filter((i) => i.verdict === 'PASS').length, FAIL: items.filter((i) => i.verdict === 'FAIL').length };
const result = { suite: 'flow benchmark: numerical verification and source-curve reproduction', date: new Date().toISOString(),
  environment: `Node ${process.version} on ${process.platform}; ${pyRec ? pyRec.environment : 'Python reference not run'}; case file of release ${CASES.release}`, case: cs.id,
  items, counts: n, verdict: n.FAIL === 0 ? 'PASS' : 'FAIL', reproduction: repro, reported, expected };
fs.writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n');
console.log(`\n${n.PASS} PASS, ${n.FAIL} FAIL → ${path.relative(ROOT, OUT)}`);
console.log(`reported (not judged): flow rate ${(100 * defCmp.Q_rel).toFixed(1)} % from MD; profile rms ${(100 * defCmp.profile_rms_rel).toFixed(1)} %, worst ${(100 * defCmp.profile_worst_rel).toFixed(1)} %`);
process.exit(n.FAIL ? 1 : 0);
