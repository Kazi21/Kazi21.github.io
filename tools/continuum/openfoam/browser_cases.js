// browser_cases.js — the browser CFD solver (lab/continuum/core/solver.js) on the same physical cases as the native
// OpenFOAM runs (make_cases.py). Writes, per case, cell-centred velocities in OpenFOAM's cell order (x fastest, then y,
// then z upward; device: permeate cells first), the port flow and the membrane face fluxes. Comparison options that
// match OpenFOAM's boundary treatment: tangential velocity continuous across the cyclic baffles ('continuous-tangential')
// and zero tangential gradient on the outflow port ('outlet-free', as pressureInletOutletVelocity on outflow).
// Usage: node browser_cases.js [--out DIR] [--only NAME,NAME]   (default: ../results/openfoam_browser, all cases)
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../../..');
const SV = require(path.join(ROOT, 'lab/continuum/core/solver.js'));
const FS = require(path.join(ROOT, 'lab/continuum/core/field-sample.js'));
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? path.resolve(process.argv[outArg + 1]) : path.join(__dirname, '../results/openfoam_browser');
fs.mkdirSync(OUT, { recursive: true });
const MU = 853.742e-6;
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'));
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > 0 ? process.argv[onlyArg + 1].split(',') : null;

for (const [name, c] of Object.entries(cases)) {
  if (only && !only.includes(name)) continue;
  let cfg, dev, H = 0;
  if (c.kind === 'duct') {
    const N = c.N, W = c.W;
    dev = { nx: N, ny: N, nz: c.nzc, dx: W / N, dy: W / N, dz: W / N, Lref: W, port: { i0: 0, i1: N, j0: 0, j1: N } };
    cfg = { device: dev, mode: 'duct', walls: 'no-slip', closure: 'zero-tangential', portTangential: 'outlet-free', mu: MU, pFeed: c.dP, pPerm: 0 };
  } else {
    const N = c.N, W = c.W, B = c.B, Lmin = Math.min(W, B), nx = Math.round(N * W / Lmin), ny = Math.round(N * B / Lmin);
    H = 0.5 * Lmin; const nz = Math.round(N * H / Lmin), half = N / 10;
    dev = { nx, ny, nz, dx: W / nx, dy: B / ny, dz: H / nz, Lref: Lmin, port: { i0: nx / 2 - half, i1: nx / 2 + half, j0: ny / 2 - half, j1: ny / 2 + half } };
    const Rs = new Float64Array(nx * ny).fill(c.Rs);
    if (c.closedCols) for (let j = 0; j < ny; j++) for (let i = c.closedCols[0]; i < c.closedCols[1]; i++) Rs[j * nx + i] = Infinity;
    cfg = { device: dev, mode: 'device', walls: 'no-slip', closure: 'continuous-tangential', portTangential: 'outlet-free', mu: MU, Rs, RsRef: c.Rs, pFeed: c.dP, pPerm: 0 };
  }
  const t0 = Date.now();
  const r = SV.solve(cfg);
  const f = r.fields, cells = [];
  const chambers = c.kind === 'duct' ? [[0, 0]] : [[1, -H], [0, 0]];      // [chamber index, z origin], bottom first
  for (const [ci, z0] of chambers) {
    const cc = FS.cellCentres(f.chambers[ci], { nx: dev.nx, ny: dev.ny, nz: dev.nz });
    for (let k = 0; k < dev.nz; k++) for (let j = 0; j < dev.ny; j++) for (let i = 0; i < dev.nx; i++) {
      const q = (k * dev.ny + j) * dev.nx + i;
      cells.push([(i + 0.5) * dev.dx, (j + 0.5) * dev.dy, z0 + (k + 0.5) * dev.dz, cc.vel[3 * q], cc.vel[3 * q + 1], cc.vel[3 * q + 2]]);
    }
  }
  const out = { name, case: c, solverVersion: SV.SOLVER_VERSION, closure: cfg.closure, portTangential: cfg.portTangential, unknowns: r.sys.N, iterations: r.info.iterations, relResidual: r.residual.relTotal,
    wall_s: (Date.now() - t0) / 1000, Q_m3_s: f.Qout, Qin_m3_s: f.Qin, Qmembrane_m3_s: f.Qmembrane == null ? null : f.Qmembrane,
    J_m_s: f.J ? Array.from(f.J) : null, grid: { nx: dev.nx, ny: dev.ny, nz: dev.nz, dx: dev.dx, dy: dev.dy, dz: dev.dz, H }, cells };
  fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(out));
  console.log(name + ': Q = ' + f.Qout.toExponential(6) + ' m^3/s, ' + r.info.iterations + ' iterations, residual ' + r.residual.relTotal.toExponential(2) + ', ' + out.wall_s.toFixed(1) + ' s');
}
