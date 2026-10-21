/* Continuum Lab — "Download experiment": the files of one experiment (loaded on demand, with ../water/zip.js).
   scenario.json, pore_law.json, results.json, fields/*.vti (VTK XML image data, cell-centred), fields/mac_boundaries.json,
   membrane.csv, probes.csv, events.json, environment.json, README.md, and a Node reproduction (reproduce.js + core/ +
   data/manifest.json) that recomputes the result from scenario.json and checks it against results.json. */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const U = node ? require('./core/units.js') : root.ContinuumUnits;
  const FS = node ? require('./core/field-sample.js') : root.ContinuumSample;
  const MMx = node ? require('./core/membrane-map.js') : root.ContinuumMembrane;
  const CORE = ['units.js', 'pore-law.js', 'membrane-map.js', 'scenario.js', 'solver.js', 'experiment.js', 'field-sample.js'];
  const j = (o) => JSON.stringify(o, (k, v) => (v instanceof Float64Array || v instanceof Uint8Array ? Array.from(v) : (typeof v === 'number' && !Number.isFinite(v) ? null : v)), 1) + '\n';
  const num = (v) => (Number.isFinite(v) ? (v === 0 ? '0' : v.toExponential(11)) : 'nan');

  async function sha256(text) {
    if (!(root.crypto && root.crypto.subtle)) return null;
    const h = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  function vti(name, ch, dev, z0, pAbsOffset) {
    const cc = FS.cellCentres(ch, { nx: dev.nx, ny: dev.ny, nz: dev.nz }), n = dev.nx * dev.ny * dev.nz;
    const vel = [], p = [], sp = [];
    for (let c = 0; c < n; c++) { vel.push(num(cc.vel[3 * c]) + ' ' + num(cc.vel[3 * c + 1]) + ' ' + num(cc.vel[3 * c + 2])); p.push(num(ch.p[c] + pAbsOffset)); sp.push(num(cc.speed[c])); }
    return '<?xml version="1.0"?>\n<!-- Continuum Lab, ' + name + ' chamber: cell-centred velocity (average of the two MAC face values, m/s), absolute pressure (Pa), speed (m/s). Coordinates in metres, membrane at z = 0. -->\n' +
      '<VTKFile type="ImageData" version="0.1" byte_order="LittleEndian">\n <ImageData WholeExtent="0 ' + dev.nx + ' 0 ' + dev.ny + ' 0 ' + dev.nz + '" Origin="0 0 ' + num(z0) + '" Spacing="' + num(dev.dx) + ' ' + num(dev.dy) + ' ' + num(dev.dz) + '">\n' +
      '  <Piece Extent="0 ' + dev.nx + ' 0 ' + dev.ny + ' 0 ' + dev.nz + '">\n   <CellData Vectors="velocity_m_s" Scalars="pressure_Pa">\n' +
      '    <DataArray type="Float64" Name="velocity_m_s" NumberOfComponents="3" format="ascii">\n' + vel.join('\n') + '\n    </DataArray>\n' +
      '    <DataArray type="Float64" Name="pressure_Pa" format="ascii">\n' + p.join('\n') + '\n    </DataArray>\n' +
      '    <DataArray type="Float64" Name="speed_m_s" format="ascii">\n' + sp.join('\n') + '\n    </DataArray>\n   </CellData>\n  </Piece>\n </ImageData>\n</VTKFile>\n';
  }

  /* browser: fetch the solver files (for the reproduction and their hashes), then assemble */
  async function build(S, opt) {
    const core = {}, hashes = {};
    for (const f of CORE) { core[f] = await (await fetch('core/' + f)).text(); hashes['core/' + f] = await sha256(core[f]); }
    const manifestText = await (await fetch('data/manifest.json')).text();
    hashes['data/manifest.json'] = await sha256(manifestText);
    const reproduce = await (await fetch('reproduce.js')).text();
    return assemble(S, opt, { core, hashes, manifestText, reproduce });
  }

  /* the files of one experiment from the page state S (also used by the Node test harness) */
  function assemble(S, opt, res) {
    const r = S.result, sc = r.scenario, dev = r.device, m = r.membrane, d = r.diag, files = {};
    const core = res.core, hashes = res.hashes, manifestText = res.manifestText, reproduce = res.reproduce;
    const law = S.manifest.laws.find((x) => x.lawId === sc.lawId);
    const closedFaces = []; for (let k = 0; k < m.closed.length; k++) if (m.closed[k]) closedFaces.push([k % dev.nx, Math.floor(k / dev.nx)]);
    const cmpB = S.baseline, ch = r.change && cmpB && r.change.refRevision === cmpB.revision ? r.change : null;

    files['scenario.json'] = j({
      format: 'continuum-lab-export-1', revision: r.revision, configId: r.configId, geometryHash: r.geometryHash,
      scenario: sc,
      units: { lengths: 'm', pressure: 'Pa (dP_Pa: difference; pPerm_Pa: absolute at the permeate port face)', viscosity: 'Pa s', density: 'kg/m^3', conductance: 'm^3/(Pa s)' },
      derived: { cells_per_chamber: [dev.nx, dev.ny, dev.nz], cell_m: [dev.dx, dev.dy, dev.dz], chamber_m: [dev.W, dev.B, dev.H], port_cells: dev.port, port_side_m: dev.portSide,
        patches: dev.patches, patch_cells: dev.patchCells, pores_total: m.total, lattice: [m.Nx, m.Ny] },
      controls: { dP_MPa: sc.dP_Pa / 1e6, W_um: sc.W_m * 1e6, B_um: sc.B_m * 1e6, meshLevel: sc.meshLevel, scopeSelection: S.sel },
      blockage: { closedFaces, note: 'face indices (i, j) with zero normal flux (Dirichlet), from the membrane modifications in scenario.mods' },
      numerical: { solver: r.solverVersion, method: r.solver.method, precision: r.solver.precision, tolerances: { minres_rtol: 1e-12, trueRelResidual: 1e-10, maxIterations: 20000, maxRestarts: 4 }, computation: r.mode },
    });
    files['pore_law.json'] = j({ law, usedConductance_m3_Pa_s: m.G0, coupling: 'S_c = sum of G_i over the tubes of face c; Rs_c = A_c / S_c; closed faces have J = 0 exactly',
      drovesCFD: true, note: 'A declared input scenario is not a measured property of water in a (6,6) carbon nanotube.' });
    // pressures (absolute) and ranges
    const pr = (c) => { let lo = Infinity, hi = -Infinity; const p = r.chambers[c].p; for (let q = 0; q < p.length; q++) { lo = Math.min(lo, p[q]); hi = Math.max(hi, p[q]); } return [lo + sc.pPerm_Pa, hi + sc.pPerm_Pa]; };
    const t = S.sel.tube, tf = t ? (() => { const MMv = MMx, f = MMv.faceOfTube({ W_m: sc.W_m, B_m: sc.B_m, pitch_m: sc.pitch_m }, { nx: dev.nx, ny: dev.ny }, t.ti, t.tj), c = f.fj * dev.nx + f.fi; return { tube: t, face: [f.fi, f.fj], dPi_Pa: m.dPi[c], closed: !!m.closed[c] }; })() : null;
    files['results.json'] = j({
      revision: r.revision, configId: r.configId, lawId: r.lawId, solverVersion: r.solverVersion,
      Q_m3_s: d.Q_m3_s, Qin_m3_s: d.Qin_m3_s, Qout_m3_s: d.Qout_m3_s, massImbalance: d.imbalance,
      J: { mean_m_s: d.Jmean_m_s, meanOpen_m_s: d.JmeanOpen_m_s, min_m_s: d.Jmin_m_s, max_m_s: d.Jmax_m_s },
      pressures_abs_Pa: { feedPort: sc.pPerm_Pa + sc.dP_Pa, permeatePort: sc.pPerm_Pa, feedChamberRange: pr(0), permeateChamberRange: pr(1), localDrivingPotentialRange: [d.dPiMin_Pa, d.dPiMax_Pa] },
      energy: { externalPower_W: d.powerExternal_W, viscous_W: d.dissViscous_W, membrane_W: d.dissMembrane_W, closure: d.energyClosure, R_chambers_Pa_s_m3: d.R_chambers_Pa_s_m3, R_membrane_Pa_s_m3: d.R_membrane_Pa_s_m3, membraneShare: d.membraneShare },
      residuals: { relTotal: r.solver.relResidual, rowRelative: r.solver.rowRelResidual, iterations: r.solver.iterations, restarts: r.solver.restarts, converged: r.solver.converged },
      scope: { Re: d.Re, ReGate: 0.1, densityChange: d.densityChange, reasons: d.scopeReasons, lawSupported: d.lawSupported },
      uncertainty: { status: 'not available', reason: 'the illustrative pore law is a declared scenario without uncertainty; with a calibrated law the shared-G interval is propagated by endpoint solves (CONTRACTS.md, uncertainty)' },
      decision: S.decision || null,
      resolution: { automatic: (S.refinements && S.refinements[r.configId]) || null, manualFineMesh: (S.meshChecks && S.meshChecks[r.configId]) || null,
        rule: 'the same configuration at a second mesh level (10 cells for the standard mesh, 20 for a fine mesh); PASS when |dQ|/Q <= 0.02; total flow only, not the local field near the ports' },
      selectedTube: tf ? Object.assign(tf, { q_m3_s: tf.closed ? 0 : m.G0 * (function () { const mm = sc.mods; const pf = mm.patchFactors[Math.floor(tf.face[0] / dev.patchCells) + ',' + Math.floor(tf.face[1] / dev.patchCells)], f1 = mm.tubeFactors[t.ti + ',' + t.tj]; return mm.membraneFactor * (pf == null ? 1 : pf) * (f1 == null ? 1 : f1); })() * tf.dPi_Pa }) : null,
      baseline: cmpB ? { revision: cmpB.revision, Q_m3_s: cmpB.Q, dQ_m3_s: ch ? ch.dQ_m3_s : d.Q_m3_s - cmpB.Q, exactChangeSolve: !!ch, network_dQ_m3_s: ch ? ch.network_dQ_m3_s : null, firstOrder_dQ_m3_s: ch ? ch.firstOrder_dQ_m3_s : null, affectedPores: ch ? ch.affectedPores : null } : null,
      molecularDisplay: { kind: 'recorded', engine: 'CP2K (ab initio MD, PBE-D3(BJ), NVT 300 K)', respondsToPressure: false, system: '(6,6) CNT segment with 6 H2O, Na+ and Cl-', file: S.manifest.geometries[0].recordedTrajectory.file, sha256: S.manifest.geometries[0].recordedTrajectory.sha256 },
      clocks: { physicalTime: 'steady state (no physical time)', numericalIterations: r.solver.iterations, wallTime_s: r.solver.wallMs / 1000 },
    });
    if (cmpB) files['baseline_scenario.json'] = j({ revision: cmpB.revision, scenario: cmpB.scenario, Q_m3_s: cmpB.Q });
    files['fields/feed.vti'] = vti('feed', r.chambers[0], dev, 0, sc.pPerm_Pa);
    files['fields/permeate.vti'] = vti('permeate', r.chambers[1], dev, -dev.H, sc.pPerm_Pa);
    const portW = (c, kf) => { const out = []; for (let jj = dev.port.j0; jj < dev.port.j1; jj++) for (let i = dev.port.i0; i < dev.port.i1; i++) out.push(r.chambers[c].w[(kf * dev.ny + jj) * dev.nx + i]); return out; };
    files['fields/mac_boundaries.json'] = j({ note: 'MAC normal velocities (m/s, positive upward) on the port faces, row by row (i fastest), and the membrane flux J (m/s, positive feed to permeate) per face (i fastest)',
      faceArea_m2: dev.dx * dev.dy, port: dev.port, inletW_m_s: portW(0, dev.nz), outletW_m_s: portW(1, 0), membraneJ_m_s: m.J, closed: m.closed });
    const rows = ['i,j,x_center_m,y_center_m,patch_i,patch_j,pores,conductance_sum_m3_Pa_s,Rs_Pa_s_m,closed,J_m_s,dPi_Pa,face_area_m2' + (S.baseline ? ',dJ_vs_baseline_m_s' : '')];
    let dJ = null;
    if (S.baseline && S.baseline.J.length === m.J.length) dJ = ch ? ch.dJ_m_s : m.J.map((v, k) => v - S.baseline.J[k]);
    for (let k = 0; k < m.J.length; k++) {
      const i = k % dev.nx, jj = Math.floor(k / dev.nx);
      rows.push([i, jj, num((i + 0.5) * dev.dx), num((jj + 0.5) * dev.dy), Math.floor(i / dev.patchCells), Math.floor(jj / dev.patchCells), m.counts[k], num(m.S[k]), m.closed[k] ? 'inf' : num(m.areaFace / m.S[k]), m.closed[k], num(m.J[k]), num(m.dPi[k]), num(m.areaFace)].concat(S.baseline ? [dJ ? num(dJ[k]) : 'nan'] : []).join(','));
    }
    files['membrane.csv'] = rows.join('\n') + '\n';
    // probes
    const smp = r.chambers.map((c) => FS.makeSampler(c, { nx: dev.nx, ny: dev.ny, nz: dev.nz }, { dx: dev.dx, dy: dev.dy, dz: dev.dz }, 'no-slip'));
    const probe = (name, c, x, y, zl) => {
      const v = smp[c](x, y, zl, [0, 0, 0]), i = Math.min(dev.nx - 1, Math.floor(x / dev.dx)), jj = Math.min(dev.ny - 1, Math.floor(y / dev.dy)), kk = Math.min(dev.nz - 1, Math.floor(zl / dev.dz));
      return [name, c === 0 ? 'feed' : 'permeate', num(x), num(y), num(c === 0 ? zl : zl - dev.H), num(v[0]), num(v[1]), num(v[2]), num(Math.hypot(v[0], v[1], v[2])), num(r.chambers[c].p[(kk * dev.ny + jj) * dev.nx + i] + sc.pPerm_Pa)].join(',');
    };
    const W = dev.W, B = dev.B, H = dev.H, dz = dev.dz;
    files['probes.csv'] = ['name,chamber,x_m,y_m,z_m,u_m_s,v_m_s,w_m_s,speed_m_s,p_abs_Pa_nearest_cell',
      probe('inlet port centre (half a cell below)', 0, W / 2, B / 2, H - dz / 2), probe('feed chamber centre', 0, W / 2, B / 2, H / 2), probe('feed, half a cell above the membrane centre', 0, W / 2, B / 2, dz / 2),
      probe('feed corner region', 0, W / 10, B / 10, H / 2), probe('permeate, half a cell below the membrane centre', 1, W / 2, B / 2, H - dz / 2), probe('permeate chamber centre', 1, W / 2, B / 2, H / 2),
      probe('outlet port centre (half a cell above)', 1, W / 2, B / 2, dz / 2)].join('\n') + '\n';
    files['events.json'] = j({ note: 'ordered input changes; revision = the page revision after the change', events: S.events });
    files['environment.json'] = j({
      page: 'lab/continuum/water.html', websiteVersion: opt && opt.version, solverVersion: r.solverVersion, generated_utc: new Date().toISOString(),
      browser: typeof navigator !== 'undefined' ? { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency || null } : { node: typeof process !== 'undefined' ? process.version : null }, sha256: hashes,
      computation: { mode: r.mode, iterations: r.solver.iterations, wall_s: r.solver.wallMs / 1000, unknowns: r.solver.unknowns },
      randomSeeds: 'none: the solver is deterministic; tracer phases are fixed fractions', molecularDisplay: 'recorded CP2K trajectory (not live MD)', drivingLaw: sc.lawId,
    });
    files['reproduce.js'] = reproduce;
    CORE.forEach((f) => { files['core/' + f] = core[f]; });
    files['data/manifest.json'] = manifestText;
    files['README.md'] = readme(r, S, ch);
    return files;
  }

  function readme(r, S, ch) {
    const sc = r.scenario, d = r.diag, f3 = U.fmt3;
    return '# Continuum Lab experiment, revision ' + r.revision + '\n\n' +
      'Exported from https://kazi21.github.io/lab/continuum/water.html (browser CFD solver ' + r.solverVersion + ').\n\n' +
      '## What was computed\n\nSteady 3D Stokes flow of water (300 K, ' + sc.mu + ' Pa s) in a feed and a permeate chamber of ' + (sc.W_m * 1e6) + ' µm × ' + (sc.B_m * 1e6) + ' µm, coupled through a membrane of ' + d.poresTotal + ' (6,6) CNT pores at 10 nm pitch. ' +
      'Pressure difference ' + (sc.dP_Pa / 1e6) + ' MPa (permeate port face at 0.101325 MPa). Pore law: ' + sc.lawId + ' (declared input scenario, q = G ΔΠ, G = 1.0e-27 m^3 Pa^-1 s^-1; not a measured CNT property).\n\n' +
      'Total flow Q = ' + d.Q_m3_s.toPrecision(10) + ' m^3/s; |Q_in − Q_out|/Q = ' + f3(d.imbalance) + '; residual ' + f3(r.solver.relResidual) + '.\n\n' +
      '## Files\n\n| File | Content |\n|---|---|\n| scenario.json | every input (SI), derived grid, blockage map, numerical settings |\n| pore_law.json | the law that drove the CFD, its source kind, assessment and domain |\n' +
      '| results.json | Q, J, pressures, residuals, conservation, energy, scope, uncertainty status, decision, baseline comparison |\n| fields/feed.vti, fields/permeate.vti | cell-centred velocity, absolute pressure and speed (VTK XML image data; open in ParaView) |\n' +
      '| fields/mac_boundaries.json | exact MAC normal velocities on the ports and the membrane flux (for conservation checks) |\n| membrane.csv | per continuum face: pores, conductance sum, resistance, closed flag, J, ΔΠ' + (S.baseline ? ', change against the baseline' : '') + ' |\n' +
      '| probes.csv | velocity and pressure at fixed points |\n| events.json | ordered input changes with revision numbers |\n| environment.json | versions, SHA-256 of the solver files, browser, wall time |\n' +
      (S.baseline ? '| baseline_scenario.json | the fixed baseline the comparison refers to |\n' : '') + '| reproduce.js, core/, data/manifest.json | Node reproduction |\n\n' +
      '## Reproduce\n\nWith Node.js 18 or newer, in this folder:\n\n    node reproduce.js\n\n' +
      'It recomputes the experiment from scenario.json with the same solver files (core/) and checks Q against results.json (relative tolerance 1e-9)' +
      (S.baseline ? '; it also recomputes the baseline and the change against it' + (ch ? ' with the same change solve (relative tolerance 1e-6)' : '') : '') + '. It exits with status 1 if a check fails.\n\n' +
      '## Clocks\n\nThe solution is steady: there is no physical time. Iterations are numerical; the wall time is in environment.json. The molecular panel showed a recorded CP2K trajectory, which does not respond to the pressure set here.\n';
  }

  const api = { build, assemble };
  if (node) module.exports = api; else root.ContinuumExport = api;
})(typeof self !== 'undefined' ? self : this);
