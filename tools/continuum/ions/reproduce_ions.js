#!/usr/bin/env node
/* Recompute a downloaded result of the ion experiment (Continuum Lab, "Download result (JSON)") from its inputs with
   the solver files of this repository, and compare every reported number (relative tolerance 10⁻¹² unless --tol).
   Since release 2026.10 it also repeats the numerical controller's solves and decisions (controller.js) and checks the
   decision record: schema; every level's decision, gate verdict, nodes, current, reversal potential and changes; the
   outcome; the top-ranked input and the calculation request with their sensitivity factor. A file holding only a decision record
   ("Decision record (JSON)") is checked the same way.
   Usage: node tools/continuum/ions/reproduce_ions.js result.json [--tol 1e-12] [--csv profiles.csv]
   Exit status 0 when everything reproduces, 1 otherwise. */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const SITE = path.resolve(__dirname, '..', '..', '..');
const Core = require(path.join(SITE, 'lab/continuum/ions/core.js'));
const Pm = require(path.join(SITE, 'lab/continuum/ions/params.js'));
const Ctl = require(path.join(SITE, 'lab/continuum/ions/controller.js'));
const args = process.argv.slice(2);
if (!args.length || args[0] === '--help') { console.log('usage: node reproduce_ions.js result.json [--tol 1e-12] [--csv profiles.csv]'); process.exit(args.length ? 0 : 2); }
const tol = args.includes('--tol') ? Number(args[args.indexOf('--tol') + 1]) : 1e-12;
const csvPath = args.includes('--csv') ? args[args.indexOf('--csv') + 1] : null;
const R0 = JSON.parse(fs.readFileSync(args[0], 'utf8'));
const checks = [];
const rel = (a, b) => (a === b ? 0 : (a === null || b === null) ? 1 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300));
const cmp = (name, a, b) => { const d = rel(a, b); checks.push({ name, page: a, node: b, rel: d, ok: d <= tol }); };
const same = (name, a, b) => checks.push({ name, page: a, node: b, rel: a === b ? 0 : 1, ok: a === b });

/* the controller's decision record: validate it, repeat the decisions from its query, compare */
function checkDecision(D, query) {
  const v = Ctl.validate(D);
  same('decision record schema', v.valid ? 'valid' : v.errors.slice(0, 3).join('; '), 'valid');
  const n = Ctl.run(query), rec = Ctl.record(n, n.outcome.status === 'refused' ? null : Ctl.ranking(query), { websiteVersion: D.website_version });
  same('decision status', D.outcome.status, rec.outcome.status);
  same('decision levels', D.levels.length, rec.levels.length);
  D.levels.forEach((e, i) => {
    const f = rec.levels[i]; if (!f) return;
    same('level ' + e.level + ' decision', e.decision + ' (rule ' + e.rule + ')', f.decision + ' (rule ' + f.rule + ')');
    same('level ' + e.level + ' gates', (e.gates_passed ? 'passed' : 'failed ' + e.failed_gate), (f.gates_passed ? 'passed' : 'failed ' + f.failed_gate));
    same('level ' + e.level + ' nodes', e.nodes, f.nodes);
    cmp('level ' + e.level + ' I', e.I_A, f.I_A); cmp('level ' + e.level + ' V_rev', e.V_rev_V, f.V_rev_V);
    if (e.change || f.change) {
      cmp('level ' + e.level + ' change in I', e.change && e.change.current_abs_A, f.change && f.change.current_abs_A);
      cmp('level ' + e.level + ' relative change in I', e.change && e.change.current_rel, f.change && f.change.current_rel);
      cmp('level ' + e.level + ' change in V_rev', e.change && e.change.V_rev_V, f.change && f.change.V_rev_V);
      same('level ' + e.level + ' within the target', e.change && e.change.within_target, f.change && f.change.within_target);
    }
  });
  same('reported level', D.outcome.reported_level, rec.outcome.reported_level);
  cmp('reported I', D.outcome.I_A, rec.outcome.I_A); cmp('reported V_rev', D.outcome.V_rev_V, rec.outcome.V_rev_V);
  same('outcome message', D.outcome.message, rec.outcome.message);
  const ti = (r) => (r.molecular_evidence && r.molecular_evidence.top_input) || null;
  same('top-ranked input', ti(D) && ti(D).id, ti(rec) && ti(rec).id);
  if (ti(D) || ti(rec)) cmp('top-ranked input factor', ti(D) && ti(D).factor, ti(rec) && ti(rec).factor);
  same('calculation request', D.request ? D.request.input_id + ' (' + D.request.execution_status + ')' : null, rec.request ? rec.request.input_id + ' (' + rec.request.execution_status + ')' : null);
  if (D.request || rec.request) cmp('request sensitivity factor', D.request && D.request.sensitivity_factor, rec.request && rec.request.sensitivity_factor);
}
const queryOf = (D) => { const q = D.query, o = { preset: q.preset, step: q.step, V: q.V_V, c: q.c_mol_m3, gradient: q.gradient, dp: q.dp_Pa, L: q.L_nm, solvation: q.solvation, lining: q.lining, epsP: q.epsP, rimN: q.rimN, rimW: q.rimW_nm, ionSize: q.ionSize_nm, Dratio: q.Dratio, slip: q.slip_nm, target: q.target }; return o; };
const finish = () => {
  const bad = checks.filter((c) => !c.ok);
  for (const c of checks) if (!c.ok || process.env.VERBOSE) console.log((c.ok ? 'ok   ' : 'FAIL ') + c.name + ': page ' + c.page + ', node ' + c.node + ', relative difference ' + Number(c.rel).toExponential(2));
  const nums = checks.filter((c) => typeof c.rel === 'number').map((c) => c.rel);
  console.log(checks.length + ' checks, ' + bad.length + ' failed; largest relative difference ' + Math.max(...nums).toExponential(2));
  process.exit(bad.length ? 1 : 0);
};
if (R0.schema === Ctl.SCHEMA) { checkDecision(R0, queryOf(R0)); finish(); }
const R = R0, o = R.inputs, VS = []; for (let v = -200; v <= 200; v += 25) VS.push(v / 1000);

// solver files: hashes as recorded by the page versus this repository
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(SITE, f))).digest('hex');
const files = (R.environment && R.environment.solver_files) || [];
for (const f of files) if (f.sha256) checks.push({ name: 'sha256 ' + f.path, page: f.sha256.slice(0, 16), node: sha(f.path).slice(0, 16), rel: f.sha256 === sha(f.path) ? 0 : 1, ok: f.sha256 === sha(f.path) });

const main = Core.solve(Pm.build(o).s);
cmp('I', R.results.I_A, main.I);
cmp('I Na', R.results.I_species_A[0], main.Ispecies[0]); cmp('I Cl', R.results.I_species_A[1], main.Ispecies[1]);
cmp('J Na', R.results.J_mol_s[0], main.J[0]); cmp('J Cl', R.results.J_mol_s[1], main.J[1]);
if (o.step >= 6) cmp('Q', R.results.Q_m3_s, main.Q);
cmp('ions in pore Na', R.results.n_in_pore[0], main.nInPore[0]); cmp('ions in pore Cl', R.results.n_in_pore[1], main.nInPore[1]);
for (const L of R.ladder || []) { const r = Core.solve(Pm.build(Object.assign({}, o, { step: L.step })).s); cmp('ladder step ' + L.step + ' I', L.I, r.I); }
if (R.iv) {
  const m = Core.ivCurve(Pm.build(o).s, VS), ref = Core.ivCurve(Pm.build(Object.assign({}, o, { step: 1 })).s, VS);
  R.iv.model_I_A.forEach((v, i) => cmp('IV model ' + Math.round(VS[i] * 1000) + ' mV', v, m[i].I));
  R.iv.reference_I_A.forEach((v, i) => cmp('IV reference ' + Math.round(VS[i] * 1000) + ' mV', v, ref[i].I));
}
if (R.selectivity) {
  const grad = { cL: o.c, cR: o.c / o.gradient };
  const rv = Core.reversal(Pm.build(Object.assign({}, o, grad)).s);
  cmp('V_rev model', R.selectivity.model.V_rev_V, rv.V);
  if (R.selectivity.model.ratio != null) {
    const sel = Pm.selectivity(o, rv.V);
    if (!sel.capped) cmp('GHK-equivalent P_Na/P_Cl', R.selectivity.model.ratio, sel.ratio);   // outside the display range the ratio is ill-conditioned
    checks.push({ name: 'GHK-equivalent ratio shown', page: R.selectivity.model.shown, node: sel.text, rel: R.selectivity.model.shown === sel.text ? 0 : 1, ok: R.selectivity.model.shown === sel.text });
    if (R.selectivity.model.status != null) checks.push({ name: 'GHK-equivalent status', page: R.selectivity.model.status, node: sel.status, rel: R.selectivity.model.status === sel.status ? 0 : 1, ok: R.selectivity.model.status === sel.status });
  }
}
if (R.profiles) {
  let worst = 0;
  R.profiles.c_mol_m3.forEach((a, i) => a.forEach((v, k) => { worst = Math.max(worst, rel(v, main.c[i][k])); }));
  R.profiles.phi_V.forEach((v, k) => { worst = Math.max(worst, Math.abs(v - main.phi[k]) / 0.025852); });
  checks.push({ name: 'profiles (c, φ; largest relative difference)', page: '', node: '', rel: worst, ok: worst <= tol });
}
if (csvPath) {
  const lines = fs.readFileSync(csvPath, 'utf8').split('\n').filter((l) => l && !l.startsWith('#') && !l.startsWith('x_nm'));
  let worst = 0;
  lines.forEach((l, k) => { const v = l.split(',').map(Number); worst = Math.max(worst, rel(v[2], main.c[0][k]), rel(v[3], main.c[1][k]), Math.abs(v[4] / 1000 - main.phi[k]) / 0.025852); });
  checks.push({ name: 'CSV profiles (shortest round-trip decimals)', page: '', node: '', rel: worst, ok: worst <= tol && lines.length === main.x.length });
}
if (R.decision) checkDecision(R.decision, Object.assign({}, R.inputs));
finish();
