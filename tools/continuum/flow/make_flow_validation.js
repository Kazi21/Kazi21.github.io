#!/usr/bin/env node
/* Flow benchmark — write lab/continuum/flow/data/validation.json from the check records (no number is typed by hand).
   The page reads that file for its "Checks" panel. Only verdicts, details and run dates are copied, so that the file
   does not change between two runs that return the same results.
   Usage: node tools/continuum/flow/make_flow_validation.js */
'use strict';
const fs = require('fs'), path = require('path');
const HERE = __dirname, ROOT = path.join(HERE, '..', '..', '..');
const read = (f) => { const p = path.join(HERE, '..', 'results', f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const cases = JSON.parse(fs.readFileSync(path.join(ROOT, 'lab', 'continuum', 'flow', 'data', 'cases.json'), 'utf8'));
const t = read('t_flow.json'), b = read('browser_flow.json');
if (!t) { console.error('tools/continuum/results/t_flow.json is missing: run t_flow.js first'); process.exit(1); }
const count = (items) => ({ PASS: items.filter((i) => i.verdict === 'PASS').length, FAIL: items.filter((i) => i.verdict === 'FAIL').length });
const pick = (items, re) => items.filter((i) => re.test(i.id)).map((i) => ({ id: i.id, name: i.name, verdict: i.verdict, detail: i.detail }));
const round = (x) => Number(Number(x).toPrecision(6));
const num = pick(t.items, /^P\d+$/), rep = pick(t.items, /^PR\d+$/);
rep.forEach((r) => { r.comparisons = t.reproduction[r.id].map((c) => ({ what: c.what, unit: c.unit, model: round(c.model), u_model: round(c.uModel), published: round(c.source), u_published: round(c.uSource), z: round(c.z) })); });
const out = {
  schema: 'continuum-lab-flow-validation/1', release: cases.release, case: t.case,
  criteria: 'tools/continuum/flow/TOLERANCES.md',
  numerical: { command: 'node tools/continuum/flow/t_flow.js', date: t.date.slice(0, 10), environment: t.environment, counts: count(num), items: num },
  reproduction: { command: 'node tools/continuum/flow/t_flow.js', date: t.date.slice(0, 10), counts: count(rep), items: rep,
    alternative_length: { length_nm: t.reported.alternative_length_reproduction.length_nm, note: t.reported.alternative_length_reproduction.note, comparisons: t.reported.alternative_length_reproduction.comparisons.map((c) => ({ id: c.id, z: c.z.map(round) })) } },
  browser: b ? { command: 'node tools/continuum/flow/browser_flow.js', date: b.date.slice(0, 10), environment: b.environment, counts: count(b.items), items: pick(b.items, /^PB\d+$/) } : null
};
const file = path.join(ROOT, 'lab', 'continuum', 'flow', 'data', 'validation.json');
const text = JSON.stringify(out, null, 1) + '\n';
const same = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text;
fs.writeFileSync(file, text);
console.log((same ? 'unchanged ' : 'wrote ') + path.relative(ROOT, file) + ': numerical ' + JSON.stringify(out.numerical.counts) + ', reproduction ' + JSON.stringify(out.reproduction.counts) + ', browser ' + (out.browser ? JSON.stringify(out.browser.counts) : 'not run'));
