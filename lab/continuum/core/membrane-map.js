/* Continuum Lab — membrane map: pore counting, conductance aggregation per continuum face, scoped changes and
   closures. Pores sit on a square lattice of pitch s with centres at ((i + 1/2) s, (j + 1/2) s); a pore belongs to the
   face containing its centre (half-open intervals). Counting uses exact integer arithmetic in nanometres
   (tools/continuum/CONTRACTS.md §2, §4). Conductance sum of face c:
     S_c = G0 * F_membrane * F_patch(c) * [N_c - k_c + sum over modified tubes t in c of F_t]. */
(function (root) {
  'use strict';

  function toIntNm(m, what) {
    const v = m * 1e9, r = Math.round(v);
    if (Math.abs(v - r) > 1e-6) throw new Error(what + ' must be a whole number of nanometres');
    return r;
  }
  const ceilDiv = (a, b) => -Math.floor(-a / b);                      // b > 0, exact for |a| < 2^53
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  /* Number of lattice centres (i + 1/2) s inside [k L / n, (k + 1) L / n) for k = 0..n-1 (integers in nm). */
  function axisCounts(Lnm, snm, n) {
    const Np = Math.floor(Lnm / snm), out = new Array(n);
    const firstIndexAtOrAbove = (k) => clamp(ceilDiv(2 * k * Lnm - n * snm, 2 * n * snm), 0, Np);   // first i with (i+1/2)s >= kL/n
    for (let k = 0; k < n; k++) out[k] = firstIndexAtOrAbove(k + 1) - firstIndexAtOrAbove(k);
    return { counts: out, total: Np };
  }

  /* Geometry: { W_m, B_m, pitch_m }, mesh: { nx, ny }, patchGrid: patches per side. */
  function countPores(geom, mesh) {
    const Wn = toIntNm(geom.W_m, 'W'), Bn = toIntNm(geom.B_m, 'B'), sn = toIntNm(geom.pitch_m, 'pitch');
    const ax = axisCounts(Wn, sn, mesh.nx), ay = axisCounts(Bn, sn, mesh.ny);
    const counts = new Float64Array(mesh.nx * mesh.ny);
    for (let j = 0; j < mesh.ny; j++) for (let i = 0; i < mesh.nx; i++) counts[j * mesh.nx + i] = ax.counts[i] * ay.counts[j];
    return { counts, Nx: ax.total, Ny: ay.total, total: ax.total * ay.total, Wn, Bn, sn };
  }

  /* Face containing tube (ti, tj): floor(((ti + 1/2) s) / (W / nx)), exactly in integers. */
  function faceOfTube(geom, mesh, ti, tj) {
    const Wn = toIntNm(geom.W_m, 'W'), Bn = toIntNm(geom.B_m, 'B'), sn = toIntNm(geom.pitch_m, 'pitch');
    return { fi: Math.floor((2 * ti + 1) * sn * mesh.nx / (2 * Wn)), fj: Math.floor((2 * tj + 1) * sn * mesh.ny / (2 * Bn)) };
  }
  /* patches = { px, py } patches along x and y (an integer number of faces each). */
  function patchOfFace(mesh, fi, fj, patches) {
    const px = typeof patches === 'number' ? patches : patches.px, py = typeof patches === 'number' ? patches : patches.py;
    return { pi: Math.floor(fi * px / mesh.nx), pj: Math.floor(fj * py / mesh.ny) };
  }

  function emptyModifications() { return { membraneFactor: 1, patchFactors: {}, tubeFactors: {} }; }
  function cloneMods(m) { return { membraneFactor: m.membraneFactor, patchFactors: Object.assign({}, m.patchFactors), tubeFactors: Object.assign({}, m.tubeFactors) }; }

  /* Scoped change: scope = {kind:'tube', ti, tj} | {kind:'patch', pi, pj} | {kind:'membrane'}; factor multiplies G0
     for that scope (0 closes it; 1 restores it). Returns new modifications (inputs are not mutated). */
  function applyScopedChange(mods, scope, factor) {
    if (!(factor >= 0) || !Number.isFinite(factor)) throw new Error('factor must be finite and >= 0');
    const m = cloneMods(mods);
    if (scope.kind === 'membrane') m.membraneFactor = factor;
    else if (scope.kind === 'patch') { const k = scope.pi + ',' + scope.pj; if (factor === 1) delete m.patchFactors[k]; else m.patchFactors[k] = factor; }
    else if (scope.kind === 'tube') { const k = scope.ti + ',' + scope.tj; if (factor === 1) delete m.tubeFactors[k]; else m.tubeFactors[k] = factor; }
    else throw new Error('unknown scope ' + scope.kind);
    return m;
  }

  /* Build the per-face map: counts, areas, conductance sums S_c (m^3/(Pa s)), closed flags, resistance per area.
     patches: { px, py } (or one number for both). */
  function buildMembraneMap(geom, mesh, G0, mods, patches) {
    const pg = patches || 4;
    const pc = countPores(geom, mesh);
    const nF = mesh.nx * mesh.ny, dx = geom.W_m / mesh.nx, dy = geom.B_m / mesh.ny, Af = dx * dy;
    const k = new Float64Array(nF), sumT = new Float64Array(nF), patchF = new Float64Array(nF);
    for (let j = 0; j < mesh.ny; j++) for (let i = 0; i < mesh.nx; i++) {
      const p = patchOfFace(mesh, i, j, pg), f = mods.patchFactors[p.pi + ',' + p.pj];
      patchF[j * mesh.nx + i] = f == null ? 1 : f;
    }
    const tubes = [];
    for (const key of Object.keys(mods.tubeFactors)) {
      const [ti, tj] = key.split(',').map(Number);
      if (!(ti >= 0 && ti < pc.Nx && tj >= 0 && tj < pc.Ny)) throw new Error('tube ' + key + ' is outside the lattice');
      const f = faceOfTube(geom, mesh, ti, tj), c = f.fj * mesh.nx + f.fi;
      k[c] += 1; sumT[c] += mods.tubeFactors[key]; tubes.push({ ti, tj, face: c, factor: mods.tubeFactors[key] });
    }
    const S = new Float64Array(nF), Rs = new Float64Array(nF), closed = new Uint8Array(nF);
    for (let c = 0; c < nF; c++) {
      S[c] = G0 * mods.membraneFactor * patchF[c] * (pc.counts[c] - k[c] + sumT[c]);
      if (!(S[c] > 0)) { S[c] = 0; closed[c] = 1; Rs[c] = Infinity; } else Rs[c] = Af / S[c];
    }
    return { geom, mesh, patches: pg, G0, mods: cloneMods(mods), counts: pc.counts, total: pc.total, Nx: pc.Nx, Ny: pc.Ny,
      areaFace: Af, dx, dy, S, Rs, closed, patchFactor: patchF, tubes };
  }

  /* Effective conductance factor of every pore class, for counting how many physical pores two maps treat differently. */
  function affectedPoreCount(a, b) {
    if (a.mesh.nx !== b.mesh.nx || a.mesh.ny !== b.mesh.ny || a.total !== b.total) return NaN;
    let n = 0;
    const tubesA = {}, tubesB = {};
    a.tubes.forEach((t) => { tubesA[t.ti + ',' + t.tj] = t; });
    b.tubes.forEach((t) => { tubesB[t.ti + ',' + t.tj] = t; });
    const keys = new Set(Object.keys(tubesA).concat(Object.keys(tubesB)));
    const kA = new Float64Array(a.counts.length), kB = new Float64Array(a.counts.length);
    for (const key of keys) {
      const ta = tubesA[key], tb = tubesB[key], c = (ta || tb).face;
      const fa = a.mods.membraneFactor * a.patchFactor[c] * (ta ? ta.factor : 1);
      const fb = b.mods.membraneFactor * b.patchFactor[c] * (tb ? tb.factor : 1);
      if (fa !== fb) n += 1;
      kA[c] += 1; kB[c] += 1;                      // counted individually; excluded from the nominal class below
    }
    for (let c = 0; c < a.counts.length; c++) {
      const fa = a.mods.membraneFactor * a.patchFactor[c], fb = b.mods.membraneFactor * b.patchFactor[c];
      if (fa !== fb) n += a.counts[c] - kA[c];
    }
    return n;
  }

  /* Algebraic network reference: with prescribed local driving potential per face (Pa), q, J and Q follow directly. */
  function networkFlow(map, dPiPerFace) {
    let Q = 0, A = 0;
    const J = new Float64Array(map.S.length);
    for (let c = 0; c < map.S.length; c++) {
      const d = typeof dPiPerFace === 'number' ? dPiPerFace : dPiPerFace[c];
      J[c] = map.S[c] * d / map.areaFace; Q += map.S[c] * d; A += map.areaFace;
    }
    return { Q, J, area: A, Jmean: Q / A };
  }

  /* Change of the per-face conductance sums between two maps of the same geometry, computed from the modifications
     themselves: dS_c = G0 [(P' - P) N_c + P' A'_c - P A_c] with P = F_membrane F_patch(c) and A_c = sum_t (F_t - 1).
     Differencing two rebuilt sums of ~10^7 pores per face would leave only ~1e-9 relative accuracy in a one-tube
     change (Float64 rounding of each sum); this form keeps the change exact to rounding of the change itself. */
  function conductanceChange(a, b) {
    if (a.mesh.nx !== b.mesh.nx || a.mesh.ny !== b.mesh.ny || a.total !== b.total || a.G0 !== b.G0) throw new Error('maps differ in geometry');
    const n = a.S.length, Aa = new Float64Array(n), Ab = new Float64Array(n), dS = new Float64Array(n);
    a.tubes.forEach((t) => { Aa[t.face] += t.factor - 1; });
    b.tubes.forEach((t) => { Ab[t.face] += t.factor - 1; });
    for (let c = 0; c < n; c++) {
      const Pa = a.mods.membraneFactor * a.patchFactor[c], Pb = b.mods.membraneFactor * b.patchFactor[c];
      dS[c] = a.G0 * ((Pb - Pa) * a.counts[c] + Pb * Ab[c] - Pa * Aa[c]);
    }
    return dS;
  }
  function networkDelta(a, b, dPiPerFace) {
    const dS = conductanceChange(a, b);
    let dQ = 0;
    for (let c = 0; c < dS.length; c++) dQ += dS[c] * (typeof dPiPerFace === 'number' ? dPiPerFace : dPiPerFace[c]);
    return { dQ, dS };
  }

  const api = { countPores, axisCounts, faceOfTube, patchOfFace, emptyModifications, applyScopedChange, buildMembraneMap, affectedPoreCount, networkFlow, conductanceChange, networkDelta };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ContinuumMembrane = api;
})(typeof self !== 'undefined' ? self : this);
