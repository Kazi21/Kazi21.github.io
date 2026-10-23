#!/usr/bin/env node
'use strict';
/* Regression probes of the ion experiment's numerical controller (test I18; criteria in tools/continuum/ions/TOLERANCES.md).
   Taken from the external review of release 2026.10 (22 Oct 2026), which ran them on a copy of the site; kept here with the
   reviewer's cases unchanged. Deterministic: each probe injects one invalid value or record and checks the controller's
   answer; no statistical confidence interval applies. The probes read the site's files and modify nothing.
   Usage (repository root): node tools/continuum/ions/probe_controller_guards.js [--site .] [--out report.json]
   Exit status 0 when all nine probes hold, 1 otherwise. */
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const site = path.resolve(opt('--site', process.cwd()));
const C = require(path.join(site, 'lab/continuum/ions/controller.js'));
const P = require(path.join(site, 'lab/continuum/ions/params.js'));
const base = C.defaultSolver(), rows = [];

// (a) non-finite diagnostics injected into the solver's output: the run must stop with "check failed"
const tweaks = [
  ['nonfinite_packing', (r) => ({ ...r, packingMax: NaN }), null],
  ['nonfinite_flux_diagnostic', (r) => ({ ...r, Jdev: [NaN, NaN] }), null],
  ['nonfinite_current', (r) => ({ ...r, I: NaN }), null],
  ['nonfinite_reversal_packing', (r) => r, (rv) => ({ ...rv, result: { ...rv.result, packingMax: NaN } })],
];
for (const [id, current, reversal] of tweaks) {
  const s = {
    current: (o, l) => current(base.current(o, l)),
    reversal: (o, l) => { const rv = base.reversal(o, l); return reversal ? reversal(rv) : rv; },
  };
  const n = C.run(P.DEFAULTS, { solver: s });
  const rec = C.record(n, null, { websiteVersion: 'probe' });
  rows.push({ id, pass: n.outcome.status === 'check_failed' && n.outcome.I_A === null && rec.request === null,
    observed: n.outcome.status, gate: n.levels[0].failed_gate, record_valid: C.validate(rec).valid });
}
// (b) an almost empty record with favourable labels must not be usable as calibrated
const empty = { artifact_kind: 'transport_closure', evidence_status: 'validated', uncertainty: { status: 'estimated' }, validation: { physical_status: 'passed' } };
const ec = C.checkClosure(empty);
rows.push({ id: 'empty_molecular_contract', pass: !ec.usable_as_calibrated, observed: ec.status, reasons: ec.reasons });
// (c) equilibrium (V = 0) still supported
const q = C.run({ ...P.DEFAULTS, V: 0 });
rows.push({ id: 'zero_voltage_remains_supported', pass: q.outcome.status === 'tolerance_reached', observed: q.outcome.status });
// (d) the published contracts keep their status
for (const f of ['closure-illustrative.json', 'closure-molecular-template.json']) {
  const d = JSON.parse(fs.readFileSync(path.join(site, 'lab/continuum/ions/data', f), 'utf8'));
  const r = C.checkClosure(d);
  const expected = f.includes('template') ? 'blocked' : 'illustrative';
  rows.push({ id: f, pass: r.status === expected && !r.usable_as_calibrated, observed: r.status });
}
// (e) a passed record whose diagnostics were tampered with must be rejected
const valid = C.record(C.run(P.DEFAULTS), null, { websiteVersion: 'probe' });
valid.levels[0].current.packing_max = null;
const v = C.validate(valid);
rows.push({ id: 'tampered_passed_record', pass: !v.valid, observed: v.valid ? 'accepted' : 'rejected' });

const report = { id: 'controller_guards', site: path.relative(process.cwd(), site) || '.', node: process.version, deterministic: true,
  pass: rows.every((r) => r.pass), passed: rows.filter((r) => r.pass).length, total: rows.length, rows, date: new Date().toISOString() };
const json = JSON.stringify(report, null, 1) + '\n';
if (opt('--out', null)) fs.writeFileSync(path.resolve(opt('--out')), json);
console.log(json);
process.exit(report.pass ? 0 : 1);
