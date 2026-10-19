// make_export.js — write the "Download experiment" files for one experiment from Node, with the same code the page
// uses (core/*.js, experiment.payload, export.assemble). Used by the tool tests (A2) and for offline reproduction.
// Usage: node make_export.js OUTDIR [--change patch|tube|none]   (default: a closed patch against an intact baseline)
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '../../..');
const C = (f) => require(path.join(ROOT, 'lab/continuum/core', f));
const E = C('experiment.js'), SC = C('scenario.js'), MM = C('membrane-map.js');
const X = require(path.join(ROOT, 'lab/continuum/export.js'));
const out = path.resolve(process.argv[2] || 'export');
const kind = process.argv.includes('--change') ? process.argv[process.argv.indexOf('--change') + 1] : 'patch';
const manifestText = fs.readFileSync(path.join(ROOT, 'lab/continuum/data/manifest.json'), 'utf8');
const manifest = JSON.parse(manifestText);

const sc0 = SC.makeScenario(manifest);
const r0 = E.run(sc0, manifest);
const base = E.payload(r0, 1, 'run', { mode: 'full' });
let res = r0, pay = base, rev = 1;
if (kind !== 'none') {
  const scope = kind === 'tube' ? { kind: 'tube', ti: 100, tj: 100 } : { kind: 'patch', pi: 2, pj: 2 };
  const sc1 = Object.assign({}, sc0, { mods: MM.applyScopedChange(MM.emptyModifications(), scope, 0) });
  res = E.runChange(r0, sc1, manifest); rev = 2;
  pay = E.payload(res, rev, 'run', { mode: 'change', refRevision: 1 });
}
const snap = { revision: 1, scenario: base.scenario, Q: base.diag.Q_m3_s, J: base.membrane.J, configId: base.configId };
const S = { result: pay, baseline: kind === 'none' ? null : snap, manifest, sel: { scope: 'tube', tube: { ti: 100, tj: 100 }, patch: { pi: 2, pj: 2 } },
  events: [{ revision: 1, type: 'run' }].concat(kind === 'none' ? [] : [{ revision: 2, type: 'scope-change', detail: kind }]), decision: null };
const core = {}, hashes = {};
for (const f of ['units.js', 'pore-law.js', 'membrane-map.js', 'scenario.js', 'solver.js', 'experiment.js', 'field-sample.js']) {
  core[f] = fs.readFileSync(path.join(ROOT, 'lab/continuum/core', f), 'utf8');
  hashes['core/' + f] = crypto.createHash('sha256').update(core[f]).digest('hex');
}
hashes['data/manifest.json'] = crypto.createHash('sha256').update(manifestText).digest('hex');
const files = X.assemble(S, { version: 'node-harness' }, { core, hashes, manifestText, reproduce: fs.readFileSync(path.join(ROOT, 'lab/continuum/reproduce.js'), 'utf8') });
for (const [name, text] of Object.entries(files)) {
  const p = path.join(out, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text);
}
console.log('wrote ' + Object.keys(files).length + ' files to ' + out + ' (Q = ' + pay.diag.Q_m3_s.toExponential(6) + ' m^3/s)');
