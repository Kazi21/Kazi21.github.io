// Node harness for the Live Water Lab checks: loads the same engine, core, model and adapter files the page serves.
'use strict';
const fs = require('fs');
const path = require('path');
const SITE = path.resolve(__dirname, '../../../lab/water');
const RESULTS = path.resolve(__dirname, '../results');
const { LammpsCore } = require(path.join(SITE, 'engine/lammps-core.js'));
const W = require(path.join(SITE, 'engine/water-model.js'));
const { WaterAdapter, COLUMNS } = require(path.join(SITE, 'engine/water-adapter.js'));
const EXP = require(path.join(SITE, 'engine/water-export.js'));
const createLammpsModule = require(path.join(SITE, 'engine/lammps-water.js'));
const wasmBinary = fs.readFileSync(path.join(SITE, 'engine/lammps-water.wasm'));

async function openCore() {
  const M = await createLammpsModule({ wasmBinary, print: () => {}, printErr: () => {} });
  return new LammpsCore(M).open();
}
function presetText(N) { return fs.readFileSync(path.join(SITE, 'data', `preset_water${N}.data`), 'utf8'); }
async function newAdapter(cfg = {}) {
  const N = cfg.molecules || 216;
  const core = await openCore();
  const A = new WaterAdapter(core, W);
  const snap = A.initialize(Object.assign({ runId: 1, presetId: `spce-${N}-298K-1bar-v2`, molecules: N, T: 298.15, Pbar: 1,
    ljScale: 1.0, ensemble: 'npt' }, cfg, { dataText: cfg.dataText || presetText(N) }));
  return { A, core, snap };
}
/* Builds an engine from the page's initialisation commands, optionally editing them. */
async function buildCore(N, opts = {}) {
  const core = await openCore();
  core.writeFile('/start.data', opts.dataText || presetText(N));
  let cmds = W.initCommands({ dataFile: 'start.data', T: opts.T || 298.15, Pbar: opts.Pbar || 1, ljScale: opts.ljScale || 1.0, ensemble: opts.ensemble || 'nvt' });
  if (opts.edit) cmds = opts.edit(cmds);
  core.commands(cmds.join('\n'));
  return { core, cmds };
}
function withoutShake(cmds) { return cmds.filter((c) => !/^fix\s+cons\s/.test(c)); }
function withoutTether(cmds) {
  return cmds.filter((c) => !/^(group\s+sel|variable\s+(K|X|Y|Z|msel|rcx|rcy|rcz|tdx|tdy|tdz|tfx|tfy|tfz|tue)\s|fix\s+tether\s)/.test(c));
}
function centralMolecule(x, box, topo) {
  const c = [0, 1, 2].map((d) => (box.lo[d] + box.hi[d]) / 2), L = [0, 1, 2].map((d) => box.hi[d] - box.lo[d]);
  let best = 1, bd = Infinity;
  for (let m = 0; m < topo.nmol; m++) {
    const o = topo.molAtoms[3 * m]; let d2 = 0;
    for (let k = 0; k < 3; k++) { let d = x[3 * o + k] - c[k]; d -= L[k] * Math.round(d / L[k]); d2 += d * d; }
    if (d2 < bd) { bd = d2; best = m + 1; }
  }
  return best;
}
/* Rigid-geometry check on unwrapped coordinates (molecules whole). */
function geometry(x, topo) {
  let maxdr = 0, maxdth = 0, maxOH = 0;
  for (let m = 0; m < topo.nmol; m++) {
    const o = topo.molAtoms[3 * m], h1 = topo.molAtoms[3 * m + 1], h2 = topo.molAtoms[3 * m + 2];
    const v1 = [0, 1, 2].map((k) => x[3 * h1 + k] - x[3 * o + k]), v2 = [0, 1, 2].map((k) => x[3 * h2 + k] - x[3 * o + k]);
    const r1 = Math.hypot(...v1), r2 = Math.hypot(...v2);
    const th = Math.acos((v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / (r1 * r2)) * 180 / Math.PI;
    maxdr = Math.max(maxdr, Math.abs(r1 - 1), Math.abs(r2 - 1)); maxdth = Math.max(maxdth, Math.abs(th - 109.47)); maxOH = Math.max(maxOH, r1, r2);
  }
  return { maxdr, maxdth, maxOH };
}
function save(name, obj) {
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, name), JSON.stringify(obj, null, 1) + '\n');
}
function maxAbsDiff(a, b) { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; }
module.exports = { SITE, RESULTS, W, WaterAdapter, COLUMNS, EXP, openCore, presetText, newAdapter, buildCore, withoutShake, withoutTether,
  centralMolecule, geometry, save, maxAbsDiff, fs, path };
