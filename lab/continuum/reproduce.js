#!/usr/bin/env node
/* Continuum Lab — reproduce an exported experiment with Node.js (18 or newer).
   Usage: node reproduce.js [export-folder]   (default: the folder of this file)
   Recomputes the experiment in scenario.json with the solver files in core/ and data/manifest.json, and checks:
     Q against results.json within 1e-9 relative;
     if baseline_scenario.json exists: the baseline Q within 1e-9, and, when the browser computed the change with the
     change solve, the change dQ with the same change solve within 1e-6 relative.
   Exit status 1 if any check fails. Units: SI. */
'use strict';
const fs = require('fs'), path = require('path');
const dir = path.resolve(process.argv[2] || __dirname);
const pick = (...c) => c.find((p) => fs.existsSync(p));
const coreDir = pick(path.join(dir, 'core'), path.join(__dirname, 'core'));
const manifestFile = pick(path.join(dir, 'data', 'manifest.json'), path.join(__dirname, 'data', 'manifest.json'));
if (!coreDir || !manifestFile) { console.error('core/ or data/manifest.json not found next to the export'); process.exit(1); }
const E = require(path.join(coreDir, 'experiment.js'));
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const exp = read('scenario.json'), res = read('results.json');
const rel = (a, b) => (b === 0 ? Math.abs(a) : Math.abs(a - b) / Math.abs(b));
let fail = false;
const report = (name, ok, text) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + ': ' + text); if (!ok) fail = true; };

const t0 = Date.now();
const run = E.run(exp.scenario, manifest);
if (!run.ok) { report('scenario', false, 'unsupported: ' + run.reasons.join('; ')); process.exit(1); }
const Q = run.diag.Q_m3_s;
report('Q', res.Q_m3_s === 0 ? Q === 0 : rel(Q, res.Q_m3_s) <= 1e-9, 'recomputed ' + Q.toPrecision(12) + ' m^3/s, exported ' + res.Q_m3_s.toPrecision(12) + ' m^3/s, relative difference ' + rel(Q, res.Q_m3_s).toExponential(2) + ' (tolerance 1e-9)');
report('mass balance', run.diag.imbalance <= 1e-6, '|Q_in - Q_out|/Q = ' + run.diag.imbalance.toExponential(2));
if (fs.existsSync(path.join(dir, 'baseline_scenario.json'))) {
  const b = read('baseline_scenario.json');
  const rb = E.run(b.scenario, manifest);
  report('baseline Q', rel(rb.diag.Q_m3_s, b.Q_m3_s) <= 1e-9, 'recomputed ' + rb.diag.Q_m3_s.toPrecision(12) + ', exported ' + b.Q_m3_s.toPrecision(12) + ' m^3/s');
  if (res.baseline && res.baseline.exactChangeSolve && E.sameDevice(b.scenario, exp.scenario)) {
    const ch = E.runChange(rb, exp.scenario, manifest);
    const dQ = ch.change.dQ_m3_s, ref = res.baseline.dQ_m3_s;
    const ok = ref === 0 ? Math.abs(dQ) <= 1e-12 * Math.abs(Q) : rel(dQ, ref) <= 1e-6;
    report('change against the baseline', ok, 'recomputed dQ ' + dQ.toPrecision(10) + ', exported ' + ref.toPrecision(10) + ' m^3/s (tolerance 1e-6 relative)');
  } else if (res.baseline) {
    const dQ = Q - rb.diag.Q_m3_s;
    report('change against the baseline (difference of two solutions)', Math.abs(dQ - res.baseline.dQ_m3_s) <= 1e-9 * Math.abs(Q) + 1e-9 * Math.abs(dQ), 'recomputed ' + dQ.toPrecision(10) + ', exported ' + res.baseline.dQ_m3_s.toPrecision(10) + ' m^3/s');
  }
}
console.log('reproduction ' + (fail ? 'FAILED' : 'passed') + ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s (Node ' + process.version + ')');
process.exit(fail ? 1 : 0);
