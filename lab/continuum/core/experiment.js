/* Continuum Lab — one experiment: scenario -> membrane map -> solver configuration -> solution -> diagnostics.
   Shared by the continuum worker and the Node tests so both run identical code. */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const U = node ? require('./units.js') : root.ContinuumUnits;
  const PL = node ? require('./pore-law.js') : root.ContinuumPoreLaw;
  const MM = node ? require('./membrane-map.js') : root.ContinuumMembrane;
  const SC = node ? require('./scenario.js') : root.ContinuumScenario;
  const SV = node ? require('./solver.js') : root.ContinuumSolver;

  function findLaw(manifest, lawId, extraLaws) {
    const all = manifest.laws.concat(extraLaws || []);
    const e = all.find((l) => l.lawId === lawId);
    if (!e) throw new Error('unknown pore law ' + lawId);
    return PL.buildPoreLaw(e);
  }

  /* Build solver configuration. sc.verification may override walls/ports/H for analytic cases. */
  function buildConfig(sc, manifest, law) {
    const dev = SC.deriveDevice(sc);
    const g = law.conductanceAt(sc.tubeLength_m);
    const G0 = g.ok ? g.G : NaN;
    const map = MM.buildMembraneMap({ W_m: sc.W_m, B_m: sc.B_m, pitch_m: sc.pitch_m }, { nx: dev.nx, ny: dev.ny }, G0, sc.mods, dev.patches);
    // scaling resistance: the present membrane (open faces); if every face is closed, the nominal membrane
    let Ssum = 0; for (let c = 0; c < map.S.length; c++) Ssum += map.S[c];
    const RsRef = Ssum > 0 ? (sc.W_m * sc.B_m) / Ssum : (map.total > 0 ? (sc.W_m * sc.B_m) / (G0 * map.total) : 1 / G0);
    const cfg = { device: dev, mode: 'device', walls: sc.walls, closure: sc.closure, mu: sc.mu, Rs: map.Rs, RsRef,
      pFeed: sc.dP_Pa, pPerm: 0 };                                     // gauge pressures (Pa) relative to the permeate port
    return { cfg, map, dev, G0 };
  }

  /* Diagnostics from a solved system (all SI). */
  function diagnose(sc, manifest, law, built, sol) {
    const f = sol.fields, dev = built.dev, map = built.map;
    const Q = f.Qmembrane, Qin = f.Qin, Qout = f.Qout;
    const imbalance = Math.max(Math.abs(Qin - Qout), Math.abs(Qin - Q)) / Math.max(Math.abs(Qin), 1e-300);
    const A = sc.W_m * sc.B_m;
    let openArea = 0, Jmax = 0, Jmin = Infinity, dPiMin = Infinity, dPiMax = -Infinity, passive = 0;
    for (let c = 0; c < map.S.length; c++) {
      if (!map.closed[c]) { openArea += map.areaFace; Jmax = Math.max(Jmax, f.J[c]); Jmin = Math.min(Jmin, f.J[c]); dPiMin = Math.min(dPiMin, f.dPi[c]); dPiMax = Math.max(dPiMax, f.dPi[c]); }
      passive += map.areaFace * f.J[c] * (map.closed[c] ? 0 : f.dPi[c]);
    }
    const dP = sc.dP_Pa;
    const Pext = f.powerExternal, Pv = f.dissViscous, Pm = f.dissMembrane;
    const energyClosure = Pext !== 0 ? (Pext - Pv - Pm) / Pext : 0;
    const Rch = Q !== 0 ? Pv / (Q * Q) : NaN, Rm = Q !== 0 ? Pm / (Q * Q) : NaN;
    const Uport = Math.abs(Qin) / dev.portArea, Re = sc.rho * Uport * dev.portSide / sc.mu;
    const lawEval = PL.evaluatePoreLaw(law, sc, dPiMax > -Infinity ? dPiMax : 0);
    const gates = manifest.device.gates;
    const drho = Math.abs(U.waterDensity300K(sc.pPerm_Pa + dP) - U.waterDensity300K(sc.pPerm_Pa)) / U.C.rhoRef;
    const scope = [];
    if (Re > gates.ReMax) scope.push('Reynolds number ' + U.fmt3(Re) + ' exceeds the creeping-flow gate ' + gates.ReMax);
    if (drho > gates.compressibilityMax) scope.push('density change exceeds 1 %');
    if (map.total > 0 && (dPiMax > law.domain.dPiMax_Pa * (1 + 1e-12) || dPiMin < (law.domain.dPiMin_Pa || 0) - 1e-9)) scope.push('local driving potential outside the law interval');
    return {
      Q_m3_s: Q, Qin_m3_s: Qin, Qout_m3_s: Qout, imbalance,
      area_m2: A, openArea_m2: openArea, Jmean_m_s: Q / A, JmeanOpen_m_s: openArea > 0 ? Q / openArea : 0, Jmax_m_s: Jmax, Jmin_m_s: Jmin === Infinity ? 0 : Jmin,
      dPiMin_Pa: dPiMin, dPiMax_Pa: dPiMax, passiveSum_W: passive,
      powerExternal_W: Pext, dissViscous_W: Pv, dissMembrane_W: Pm, energyClosure,
      R_chambers_Pa_s_m3: Rch, R_membrane_Pa_s_m3: Rm, membraneShare: Pext !== 0 ? Pm / Pext : NaN,
      Re, Uport_m_s: Uport, densityChange: drho,
      poresTotal: map.total, poresOpenEquivalent: map.total > 0 ? map.S.reduce((a, b) => a + b, 0) / built.G0 : 0,
      residual: { relTotal: sol.residual.relTotal, rowRel: sol.residual.rowRel, absMomentum: sol.residual.absMomentum, absContinuity: sol.residual.absContinuity },
      iterations: sol.info.iterations, converged: sol.info.converged, scopeReasons: scope, lawSupported: lawEval.supported,
    };
  }

  /* Run one experiment: generator form (yields solver progress; used by the worker for cancellation) and a
     synchronous form (Node tests). */
  function* runGen(sc, manifest, opt) {
    const law = findLaw(manifest, sc.lawId, opt && opt.extraLaws);
    const v = SC.validateScenario(sc, manifest, law);
    if (!v.ok && !(opt && opt.ignoreScope)) return { ok: false, unsupported: true, reasons: v.reasons, sc };
    const built = buildConfig(sc, manifest, law);
    if (sc.dP_Pa === 0 && !(opt && opt.forceSolve)) {
      // exact zero solution without iterating (linear problem with zero data)
      const sys = SV.assemble(built.cfg), x = new Float64Array(sys.N);
      const sol = { info: { iterations: 0, converged: true, reason: 'zero driving pressure' }, residual: SV.residuals(sys, x), fields: SV.fields(sys, x), sys, x, wallMs: 0 };
      return { ok: true, sc, built, sol, diag: diagnose(sc, manifest, law, built, sol), law, validation: v };
    }
    const sol = yield* SV.solveGen(built.cfg, opt && opt.solver);
    return { ok: true, sc, built, sol, diag: diagnose(sc, manifest, law, built, sol), law, validation: v };
  }
  function run(sc, manifest, opt) { return SV.drive(runGen(sc, manifest, opt)); }

  /* A changed experiment computed as a change of a solved baseline (same device, drive and law; only the membrane
     modifications differ), so that small changes keep full relative precision (SV.solveChange). Returns the new
     state with its diagnostics and the change with two network references:
       network_dQ   = sum_c dS_c dPi0_c            (local driving potential held at its baseline value)
       firstOrder_dQ = sum_c dS_c dPi0_c^2 / dP    (first-order response including chamber feedback; for a
                                                    reciprocal linear system dQ/dS_c = dPi_c^2 / dP exactly) */
  function* runChangeGen(base, sc1, manifest, opt) {
    const law = base.law;
    const v = SC.validateScenario(sc1, manifest, law);
    if (!v.ok && !(opt && opt.ignoreScope)) return { ok: false, unsupported: true, reasons: v.reasons, sc: sc1 };
    const built1 = buildConfig(sc1, manifest, law);
    const m0 = base.built.map, m1 = built1.map;
    if (base.sc && !sameDevice(base.sc, sc1)) throw new Error('runChange: only membrane modifications may differ from the baseline');
    const dS = MM.conductanceChange(m0, m1);
    const dRs = new Float64Array(dS.length);
    for (let c = 0; c < dS.length; c++) dRs[c] = m0.closed[c] || m1.closed[c] ? NaN : -m0.areaFace * dS[c] / (m0.S[c] * m1.S[c]);
    const sol = yield* SV.solveChangeGen(base.sol, built1.cfg, { dRs, solver: opt && opt.solver });
    built1.cfg = sol.sys.cfg;                                           // the baseline scaling is kept
    const diag = diagnose(sc1, manifest, law, built1, sol);
    const dPi0 = base.sol.fields.dPi, dP = sc1.dP_Pa;
    let net = 0, first = 0;
    for (let c = 0; c < dS.length; c++) { if (!dS[c]) continue; net += dS[c] * dPi0[c]; first += dP ? dS[c] * dPi0[c] * dPi0[c] / dP : 0; }
    return { ok: true, sc: sc1, built: built1, sol, diag, law, validation: v,
      change: { dQ_m3_s: sol.delta.Qmembrane, dJ_m_s: sol.delta.J, dPi_Pa: sol.delta.dPiChange, dS, network_dQ_m3_s: net, firstOrder_dQ_m3_s: first,
        affectedPores: MM.affectedPoreCount(m0, m1), changeResidual: sol.changeResidual.relTotal, changeIterations: sol.info.iterations } };
  }
  function runChange(base, sc1, manifest, opt) { return SV.drive(runChangeGen(base, sc1, manifest, opt)); }

  /* Can sc1 be computed as a change of the solved state base (same device, drive, law and numerics)? */
  function sameDevice(a, b) {
    return ['W_m', 'B_m', 'dP_Pa', 'pPerm_Pa', 'meshLevel', 'lawId', 'geometryId', 'tubeLength_m', 'pitch_m', 'walls', 'closure', 'ports', 'mu', 'rho', 'T_K', 'fluid']
      .every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
  }

  /* Total-flow resolution of one state: the same configuration solved at a second mesh level (10 cells across the
     shorter side for the standard mesh, 20 for a fine mesh) and compared with the run's Q. Only a comparison of the
     same configuration can PASS (a fine mesh on its own, or the intact-membrane table for a modified membrane, never
     certifies a result); zero flow on both levels is NOT_APPLICABLE. The check concerns total flow only: the local
     chamber field near the port edges converges more slowly (native comparison, tools/continuum/QA_REPORT.md). */
  const RESOLUTION_GATE = SC.RESOLUTION_GATE, refinementLevel = SC.refinementLevel, refinementVerdict = SC.refinementVerdict;
  function* refinementGen(sc, manifest, Qrun, opt) {
    const level = refinementLevel(sc), sc2 = Object.assign(JSON.parse(JSON.stringify(sc)), { meshLevel: level });
    const r = yield* runGen(sc2, manifest, opt);
    const base = { configId: SC.configHash(sc), comparisonConfigId: SC.configHash(sc2), levelRun: sc.meshLevel, levelComparison: level, gate: RESOLUTION_GATE };
    if (!r.ok || !r.diag.converged) return Object.assign(base, { ok: false, state: 'NOT_CHECKED', rel: null, zeroFlow: false, reasons: r.reasons || ['comparison did not converge'] });
    const v = refinementVerdict(Qrun, r.diag.Q_m3_s);
    return Object.assign(base, { ok: true, Q_run_m3_s: Qrun, Q_comparison_m3_s: r.diag.Q_m3_s, rel: v.rel, state: v.state, zeroFlow: v.zeroFlow,
      iterations: r.diag.iterations, relResidual: r.sol.residual.relTotal });
  }
  function refinement(sc, manifest, Qrun, opt) { return SV.drive(refinementGen(sc, manifest, Qrun, opt)); }
  const resolutionStatus = SC.resolutionStatus;

  /* The result message the worker sends to the page (also used by the Node export harness). */
  function payload(res, revision, purpose, extra) {
    const f = res.sol.fields, b = res.built, sys = res.sol.sys, map = b.map;
    const out = {
      type: 'result', revision, purpose: purpose || 'run',
      configId: SC.configHash(res.sc), geometryHash: SC.geometryHash(res.sc), lawId: res.sc.lawId, solverVersion: SV.SOLVER_VERSION,
      scenario: res.sc, diag: res.diag,
      device: { nx: b.dev.nx, ny: b.dev.ny, nz: b.dev.nz, dx: b.dev.dx, dy: b.dev.dy, dz: b.dev.dz, W: b.dev.W, B: b.dev.B, H: b.dev.H,
        port: b.dev.port, portSide: b.dev.portSide, portArea: b.dev.portArea, patches: b.dev.patches, patchCells: b.dev.patchCells },
      membrane: { J: f.J, dPi: f.dPi, S: map.S, closed: map.closed, counts: map.counts, total: map.total, Nx: map.Nx, Ny: map.Ny, areaFace: map.areaFace,
        G0: b.G0, patchFactor: map.patchFactor, tubes: map.tubes },
      chambers: f.chambers.map((ch) => ({ u: ch.u, v: ch.v, w: ch.w, p: ch.p, pRef: ch.pRef })),
      solver: { unknowns: sys.N, nonzeros: sys.K.rowPtr[sys.N], iterations: res.sol.info.iterations, restarts: res.sol.info.restarts,
        converged: res.sol.info.converged, reason: res.sol.info.reason, relResidual: res.sol.residual.relTotal, rowRelResidual: res.sol.residual.rowRel,
        wallMs: res.sol.wallMs, method: 'MINRES, block-diagonal preconditioner (symmetric Gauss–Seidel on velocities)', precision: 'Float64',
        RsRef: b.cfg.RsRef, U: sys.scales.U, eps: sys.scales.eps },
    };
    if (res.change) out.change = Object.assign({ refRevision: extra && extra.refRevision }, res.change);
    return Object.assign(out, extra || {});
  }

  const api = { findLaw, buildConfig, diagnose, runGen, run, runChangeGen, runChange, sameDevice, payload,
    RESOLUTION_GATE, refinementLevel, refinementVerdict, refinementGen, refinement, resolutionStatus };
  if (node) module.exports = api;
  else root.ContinuumExperiment = api;
})(typeof self !== 'undefined' ? self : this);
