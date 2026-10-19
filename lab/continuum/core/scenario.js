/* Continuum Lab — scenario definition, device geometry, scope gates and hashes (tools/continuum/CONTRACTS.md §2, §3, §9).
   A scenario holds every input of one experiment; deriveDevice turns it into chamber sizes and the computational grid. */
(function (root) {
  'use strict';
  const U = (typeof module !== 'undefined' && module.exports) ? require('./units.js') : root.ContinuumUnits;
  const PL = (typeof module !== 'undefined' && module.exports) ? require('./pore-law.js') : root.ContinuumPoreLaw;

  const SCENARIO_FORMAT = 'continuum-scenario-1';
  const REFERENCE_PLANES = 'membrane-faces-normal-traction';

  /* A complete scenario from the manifest defaults plus overrides. */
  function makeScenario(manifest, over) {
    const d = manifest.defaultScenario, g = manifest.geometries.find((x) => x.geometryId === (over && over.geometryId || d.geometryId));
    const sc = {
      format: SCENARIO_FORMAT,
      fluid: manifest.fluid.id, T_K: manifest.fluid.T_K, rho: manifest.fluid.rho_kg_m3, mu: manifest.fluid.mu_Pa_s,
      geometryId: g.geometryId, tubeLength_m: g.tubeLength_m, pitch_m: g.pitch_m, referencePlanes: REFERENCE_PLANES,
      W_m: d.W_um * 1e-6, B_m: d.B_um * 1e-6,
      dP_Pa: d.dP_Pa, pPerm_Pa: U.C.pAmbient,
      lawId: d.lawId,
      mods: { membraneFactor: 1, patchFactors: {}, tubeFactors: {} },
      meshLevel: d.meshLevel, closure: 'zero-tangential', walls: 'no-slip', ports: 'quarter',
    };
    return Object.assign(sc, over || {});
  }

  /* Chamber sizes and grid. Cells are cubes of side min(W, B) / meshLevel; ports and patches are squares of side
     min(W, B) / 5, so with meshLevel a multiple of 10 both align with cell edges, and the centre patch lies under each
     port. A meshLevel that divides min(W, B) / pitch gives every face a whole number of lattice rows (no aliasing). */
  function deriveDevice(sc) {
    const Lmin = Math.min(sc.W_m, sc.B_m), N = sc.meshLevel;
    const nx = Math.round(N * sc.W_m / Lmin), ny = Math.round(N * sc.B_m / Lmin);
    const H = sc.H_m || 0.5 * Lmin;
    const nz = sc.nz || Math.max(2, Math.round(N * H / Lmin));
    const dev = { W: sc.W_m, B: sc.B_m, H, Lref: Lmin, nx, ny, nz, dx: sc.W_m / nx, dy: sc.B_m / ny, dz: H / nz };
    dev.patchCells = N / 5;
    dev.patches = { px: Math.round(5 * sc.W_m / Lmin), py: Math.round(5 * sc.B_m / Lmin) };
    if (sc.ports === 'full') dev.port = { i0: 0, i1: nx, j0: 0, j1: ny };
    else {
      const half = N / 10;
      dev.port = { i0: nx / 2 - half, i1: nx / 2 + half, j0: ny / 2 - half, j1: ny / 2 + half };
    }
    dev.aligned = [dev.port.i0, dev.port.i1, dev.port.j0, dev.port.j1, dev.patchCells].every(Number.isInteger) && Number.isInteger(nx) && Number.isInteger(ny);
    dev.portArea = (dev.port.i1 - dev.port.i0) * dev.dx * (dev.port.j1 - dev.port.j0) * dev.dy;
    dev.portSide = Math.sqrt(dev.portArea);
    return dev;
  }
  /* Fine mesh level for a geometry: 40 cells across the shorter side if each face then holds whole lattice rows, else 50. */
  function fineLevel(sc) {
    const rows = Math.round(Math.min(sc.W_m, sc.B_m) / sc.pitch_m);
    return rows % 40 === 0 ? 40 : 50;
  }

  /* FNV-1a over a canonical JSON string (53-bit safe), as hex. */
  function hashString(s) {
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
    }
    return ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8);
  }
  function canonical(o) {
    if (Array.isArray(o)) return '[' + o.map(canonical).join(',') + ']';
    if (o && typeof o === 'object') return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
    return JSON.stringify(o);
  }
  function geometryHash(sc) {
    return hashString(canonical({ W: sc.W_m, B: sc.B_m, H: sc.H_m || null, nz: sc.nz || null, pitch: sc.pitch_m, L: sc.tubeLength_m, g: sc.geometryId,
      mesh: sc.meshLevel, walls: sc.walls, ports: sc.ports, closure: sc.closure }));
  }
  function configHash(sc) { return hashString(canonical(sc)); }

  /* Scope gates that do not need a solution (CONTRACTS §9). Solution-dependent gates (Re, local drive) are in diagnostics. */
  function validateScenario(sc, manifest, law) {
    const reasons = [], warnings = [];
    const dv = manifest.device;
    if (sc.format !== SCENARIO_FORMAT) reasons.push('unknown scenario format');
    if (sc.fluid !== manifest.fluid.id || Math.abs(sc.T_K - manifest.fluid.T_K) > 1e-9) reasons.push('fluid or temperature differs from the declared chamber fluid (water, 300 K)');
    const g = manifest.geometries.find((x) => x.geometryId === sc.geometryId);
    if (!g) reasons.push('pore geometry "' + sc.geometryId + '" is not a supported preset');
    else {
      if (Math.abs(sc.tubeLength_m - g.tubeLength_m) > 1e-6 * g.tubeLength_m) reasons.push('tube length differs from the preset (' + g.tubeLength_m + ' m)');
      if (Math.abs(sc.pitch_m - g.pitch_m) > 1e-6 * g.pitch_m) reasons.push('pitch differs from the preset (' + g.pitch_m + ' m)');
    }
    if (sc.referencePlanes !== REFERENCE_PLANES) reasons.push('reference-plane convention must be "' + REFERENCE_PLANES + '"');
    const okSize = (v) => dv.allowedSizes_um.some((s) => Math.abs(s * 1e-6 - v) <= 1e-12 * s);
    if (!sc.verification) {
      if (!okSize(sc.W_m) || !okSize(sc.B_m)) reasons.push('width and depth must be one of ' + dv.allowedSizes_um.join(', ') + ' µm');
      const asp = Math.max(sc.W_m, sc.B_m) / Math.min(sc.W_m, sc.B_m);
      if (!dv.allowedAspects.some((a) => Math.abs(a - asp) < 1e-9)) reasons.push('aspect ratio W:B must be 1, 2 or 4');
      if (!(sc.dP_Pa >= dv.pressure.dPmin_Pa && sc.dP_Pa <= dv.pressure.dPmax_Pa)) reasons.push('pressure difference outside ' + dv.pressure.dPmin_Pa / 1e6 + '–' + dv.pressure.dPmax_Pa / 1e6 + ' MPa');
      if (dv.meshLevels.indexOf(sc.meshLevel) < 0) reasons.push('mesh level must be one of ' + dv.meshLevels.join(', '));
      const rows = Math.round(Math.min(sc.W_m, sc.B_m) / sc.pitch_m);
      if (rows % sc.meshLevel !== 0) reasons.push('mesh level ' + sc.meshLevel + ' would split lattice rows between faces (use ' + fineLevel(sc) + ')');
    }
    try { const dev = deriveDevice(sc); if (!dev.aligned) reasons.push('ports or patches do not align with the grid'); } catch (e) { reasons.push(e.message); }
    if (Math.abs(sc.pPerm_Pa - U.C.pAmbient) > 1e-6) warnings.push('permeate reference pressure differs from 0.101325 MPa');
    const pFeed = sc.pPerm_Pa + sc.dP_Pa;
    const drho = Math.abs(U.waterDensity300K(pFeed) - U.waterDensity300K(sc.pPerm_Pa)) / U.C.rhoRef;
    if (drho > dv.gates.compressibilityMax) reasons.push('density change ' + (100 * drho).toFixed(2) + ' % exceeds the 1 % incompressibility gate');
    if (Math.min(pFeed, sc.pPerm_Pa) < 0) reasons.push('negative absolute pressure (tensile state) is not supported');
    if (law) PL.lawScopeReasons(law, sc).forEach((r) => reasons.push(r));
    return { ok: reasons.length === 0, reasons, warnings, densityChange: drho };
  }

  /* Total-flow resolution rules (used by core/experiment.js refinementGen in the worker and by the page's decision
     panel): the comparison level is 10 cells for the standard mesh and 20 for a fine mesh; only a comparison of the
     same configuration can PASS; zero flow on both levels is NOT_APPLICABLE. */
  const RESOLUTION_GATE = 0.02;
  function refinementLevel(sc) { return sc.meshLevel === 20 ? 10 : 20; }
  function refinementVerdict(Qrun, Qcmp, gate) {
    const g = gate == null ? RESOLUTION_GATE : gate;
    if (!Number.isFinite(Qrun) || !Number.isFinite(Qcmp)) return { state: 'NOT_CHECKED', rel: null, zeroFlow: false };
    if (Qrun === 0 && Qcmp === 0) return { state: 'NOT_APPLICABLE', rel: 0, zeroFlow: true };
    const rel = Math.abs(Qrun - Qcmp) / Math.max(Math.abs(Qrun), Math.abs(Qcmp));
    return { state: rel <= g ? 'PASS' : 'FAIL', rel, zeroFlow: false };
  }
  /* Status of the page's "Numerical resolution" row for the displayed configuration: a manual fine-mesh comparison of
     this configuration first, then the automatic comparison of this configuration, otherwise NOT_CHECKED. */
  function resolutionStatus(configId, auto, manual) {
    if (manual && manual.configId === configId) {
      const v = refinementVerdict(manual.Q_run_m3_s, manual.Q_comparison_m3_s);
      return Object.assign({}, manual, { state: v.state, rel: v.rel, zeroFlow: v.zeroFlow, source: 'manual' });
    }
    if (auto && auto.configId === configId && auto.state && auto.state !== 'NOT_CHECKED') return Object.assign({}, auto, { source: 'auto' });
    return { state: 'NOT_CHECKED', source: null, configId };
  }


  const api = { SCENARIO_FORMAT, REFERENCE_PLANES, makeScenario, deriveDevice, fineLevel, geometryHash, configHash, hashString, canonical, validateScenario,
    RESOLUTION_GATE, refinementLevel, refinementVerdict, resolutionStatus };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ContinuumScenario = api;
})(typeof self !== 'undefined' ? self : this);
