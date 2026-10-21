/* Continuum Lab — ion experiment, numerical core (no rendering, no DOM).

   Steady one-dimensional, area-averaged Poisson–Nernst–Planck equations for a 1:1 electrolyte (Na⁺, Cl⁻) along the
   axis x of a cylindrical pore (radius a, length L) between two reservoirs:

     J_i = −D_i(x) A(x) [dc_i/dx + c_i dψ_i/dx] + c_i Q,      dJ_i/dx = 0,
     d/dx(ε0 εr A dφ/dx) = −A F Σ z_i c_i − ρ_fix A,
     ψ_i = z_i F φ / RT + μ_ex,i(x) / RT.

   μ_ex contains only non-mean-field terms (finite ion size, solvation); the mean-field electrostatics of the fixed
   and mobile charges is in Poisson's equation, so nothing is counted twice. Access regions: the cross-section grows
   as a cone r = a + (4/π) s with distance s from the mouth, which gives Hall's access resistance 1/(4κa) per side
   in the Ohmic limit. Electro-osmosis: area-averaged Stokes flow with Navier slip b in the pore,
     Q r_h(x) = −dp/dx + g(x),  g = −Σ_i c_i dμ̃_i^ext/dx = −F ρ_mob dφ/dx − Σ_i c_i dμ_ex,i/dx,
   integrated over the domain with the identity −c_i dψ_i/dx = (J_i − c_i Q)/(D_i A) + dc_i/dx, so that Q = 0
   exactly at equilibrium and van 't Hoff osmosis follows for an ion-excluding pore. Access hydraulic resistance is
   matched to Sampson's orifice formula (3µ/(2a³) per side).

   Discretisation: finite volumes on a non-uniform grid, Scharfetter–Gummel fluxes (exact for Boltzmann profiles),
   Newton's method with a block-tridiagonal solver bordered by the flow unknown, positivity-preserving damping and
   continuation. Unknowns: δφ = φ − φ_res (the reservoir potential on the node's side of the pore centre) and, for
   each species, the Slotboom variable u = c e^{ψ − χ} relative to its reservoir value, w = u − u_res, where
   χ_i = Q ∫dx/(D_i A) accounts for advection. A species that carries no net flux has constant u, so w ≡ 0 at
   equilibrium; fluxes are computed from differences of w, so the small net flux of an excluded (minority) species is
   obtained without cancellation between large numbers, with or without flow. With the finite-size term ψ contains −ln(1 − ṽ Σc), and c
   follows from (φ, w) in closed form: c_i = a_i/(1 + ṽ Σ_j a_j), a_i = u_i e^{−z_iφ − μ_i}.
   Dimensionless internally: length ℓ = 1 nm, concentration c0 = 1 M, potential RT/F, D0 = 10⁻⁹ m² s⁻¹. Float64.
   UMD: self.IonCore in the browser and the worker, require() in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IonCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const K = { F: 96485.33212, R: 8.314462618, NA: 6.02214076e23, e: 1.602176634e-19, eps0: 8.8541878128e-12 };
  const ELL = 1e-9, C0 = 1000, D0 = 1e-9;                          // scales: m, mol m⁻³, m² s⁻¹
  const ALPHA = 4 / Math.PI;                                         // cone slope reproducing Hall's access resistance
  const CH = 9 / 4;                                                  // access hydraulic factor reproducing Sampson (3µ/(2a³) per side)

  /* Bernoulli function B(x) = x/(eˣ − 1) and its derivative, stable for all x. B(−x) = B(x) eˣ. */
  function bern(x) {
    const ax = Math.abs(x);
    if (ax < 1e-4) return 1 - x / 2 + x * x / 12;
    if (x > 700) return x * Math.exp(-x);
    if (x < -700) return -x;
    return x / Math.expm1(x);
  }
  function dbern(x) {
    const ax = Math.abs(x);
    if (ax < 1e-4) return -0.5 + x / 6;
    if (x > 700) return Math.exp(-x) * (1 - x);
    if (x < -700) return -1;
    const em = Math.expm1(x), ex = em + 1;
    return (em - x * ex) / (em * em);
  }

  /* ------------------------------------------------------------------ grid and geometry */
  function buildGrid(g, level) {
    const L = g.L / ELL, a = g.a / ELL, access = g.access !== false, sMax = (g.sMax || 300e-9) / ELL;
    const hMouth = (g.hMouth || 0.0125e-9) / ELL, hPore = (g.hPore || 0.025e-9) / ELL, zone = 0.6, growth = 1.08;
    const xs = [];
    // pore: fine near both mouths, coarser in the middle; nodes exactly at ±L/2 and 0. The left half is built and
    // mirrored, so a symmetric device has an exactly symmetric discretisation.
    const half = L / 2, left = [-half];
    let x = -half;
    while (x < -1e-12) {
      let h = (x + half) < zone - 1e-12 ? hMouth : hPore;
      if (x + h > -0.25 * h) h = -x;
      x += h; left.push(x > -1e-12 ? 0 : x);
    }
    left[left.length - 1] = 0;
    const pts = left.concat(left.slice(0, -1).reverse().map((v) => -v));
    if (access) {
      const out = []; let s = 0, h = hMouth;
      while (s < sMax - 1e-12) { s += h; out.push(Math.min(s, sMax)); h *= growth; }
      if (out[out.length - 1] < sMax) out.push(sMax);
      for (let i = out.length - 1; i >= 0; i--) xs.push(-half - out[i]);
      for (const p of pts) xs.push(p);
      for (const s2 of out) xs.push(half + s2);
    } else for (const p of pts) xs.push(p);
    let X = xs;
    for (let l = 1; l < (level || 1); l++) {                       // level n: every cell halved n − 1 times
      const y = [];
      for (let i = 0; i < X.length - 1; i++) { y.push(X[i]); y.push(0.5 * (X[i] + X[i + 1])); }
      y.push(X[X.length - 1]); X = y;
    }
    const n = X.length, r = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const d = Math.abs(X[k]) - half;
      r[k] = access && d > 0 ? a + ALPHA * d : a;
    }
    return { x: Float64Array.from(X), r, a, L, half, access };
  }

  const tanhStep = (x, x0, d) => 0.5 * (1 + Math.tanh((x - x0) / d));

  /* ------------------------------------------------------------------ problem setup (dimensionless arrays) */
  function setup(s) {
    const T = s.T || 300, RT = K.R * T, VT = RT / K.F;
    const G = buildGrid(s.geom, (s.grid && s.grid.level) || 1);
    const n = G.x.length, nf = n - 1, sp = s.species, ns = sp.length;
    const lam2 = K.eps0 * s.epsR * VT / (K.F * C0 * ELL * ELL);
    const h = new Float64Array(nf), Af = new Float64Array(nf), rf = new Float64Array(nf), xm = new Float64Array(nf), Vf = new Float64Array(nf);
    const segVol = (r0, r1, len) => Math.PI * len * (r0 * r0 + r0 * r1 + r1 * r1) / 3;
    for (let f = 0; f < nf; f++) {
      h[f] = G.x[f + 1] - G.x[f]; Af[f] = Math.PI * G.r[f] * G.r[f + 1]; rf[f] = Math.sqrt(G.r[f] * G.r[f + 1]);
      xm[f] = 0.5 * (G.x[f] + G.x[f + 1]); Vf[f] = segVol(G.r[f], G.r[f + 1], h[f]);
    }
    const Vn = new Float64Array(n);                                  // control volumes (exact for cones and cylinders)
    for (let f = 0; f < nf; f++) {
      const rm = 0.5 * (G.r[f] + G.r[f + 1]);
      Vn[f] += segVol(G.r[f], rm, h[f] / 2); Vn[f + 1] += segVol(rm, G.r[f + 1], h[f] / 2);
    }
    // pore indicator for the excess energy and the confined diffusivity
    const solv = s.solv || { mode: 'none' }, delta = (solv.delta || 0.15e-9) / ELL;
    const inside = (x) => {
      if (solv.shape === 'step') return Math.abs(x) < G.half - 1e-9 ? 1 : 0;
      return tanhStep(x, -G.half, delta) - tanhStep(x, G.half, delta);
    };
    const spore = new Float64Array(n), sporef = new Float64Array(nf);
    for (let k = 0; k < n; k++) spore[k] = inside(G.x[k]);
    for (let f = 0; f < nf; f++) sporef[f] = inside(xm[f]);
    const dG = solv.mode && solv.mode !== 'none' ? solv.dG.map((v) => v / RT) : sp.map(() => 0);
    const mu0 = sp.map((_, i) => { const a = new Float64Array(n); for (let k = 0; k < n; k++) a[k] = dG[i] * spore[k]; return a; });
    const Dp = s.Dpore && s.Dpore.on ? s.Dpore.ratio : sp.map(() => 1);
    const DAf = sp.map((spc, i) => {
      const a = new Float64Array(nf), d0 = spc.D / D0, dr = Dp[i];
      for (let f = 0; f < nf; f++) a[f] = d0 * (1 - sporef[f] * (1 - dr)) * Af[f];
      return a;
    });
    // fixed charge per node (units F c0 ℓ³; one elementary charge = 1/(N_A c0 ℓ³))
    const qf = new Float64Array(n), unitQ = 1 / (K.NA * C0 * ELL * ELL * ELL);
    if (s.rim && s.rim.n) {
      const w = (s.rim.w || 0.5e-9) / ELL, df = (s.rim.delta || 0.05e-9) / ELL;
      for (const m of [-G.half, G.half]) {
        const wk = new Float64Array(n); let sum = 0;
        for (let k = 0; k < n; k++) { wk[k] = tanhStep(G.x[k], m - w / 2, df) - tanhStep(G.x[k], m + w / 2, df); sum += wk[k] * Vn[k]; }
        for (let k = 0; k < n; k++) qf[k] += -s.rim.n * unitQ * wk[k] * Vn[k] / sum * (s.rim.sign || 1);
      }
    }
    if (s.fixedUniform) {                                            // uniform fixed charge in the pore (mol m⁻³, signed)
      const X = s.fixedUniform / C0;
      for (let k = 0; k < n; k++) qf[k] += X * Vn[k] * spore[k];
    }
    const vt = s.steric && s.steric.on ? K.NA * Math.pow(s.steric.size, 3) * C0 : 0;   // Bikerman: ψ_ster = −ln(1 − ṽΣc̃)
    // electro-osmosis: hydraulic resistance per face (dimensionless), slip in the pore only
    const eof = !!(s.eof && s.eof.on);
    let rh = null, Rh = 0;
    if (s.eof) {
      const mu = s.eof.mu, b = s.eof.b || 0, scale = D0 * ELL / (C0 * RT);   // R̃ = R D0 ℓ / (c0 RT)
      rh = new Float64Array(nf);
      for (let f = 0; f < nf; f++) {
        const r0 = G.r[f] * ELL, r1 = G.r[f + 1] * ELL, hf = h[f] * ELL;
        let R;
        if (Math.abs(xm[f]) < G.half) { const af = rf[f] * ELL; R = 8 * mu * hf / (Math.PI * Math.pow(af, 4) * (1 + 4 * b / af)); }
        else R = CH * 8 * mu / Math.PI * hf * (r0 * r0 + r0 * r1 + r1 * r1) / (3 * r0 * r0 * r0 * r1 * r1 * r1);
        rh[f] = R * scale; Rh += rh[f];
      }
    }
    const side = new Uint8Array(n);
    for (let k = 0; k < n; k++) side[k] = G.x[k] < 0 ? 0 : 1;
    const cL = s.cL.map((v) => v / C0), cR = s.cR.map((v) => v / C0);
    let zref = 0, zl = 0, zr = 0;
    for (let i = 0; i < ns; i++) { zref += Math.abs(sp[i].z) * (cL[i] + cR[i]); zl += sp[i].z * cL[i]; zr += sp[i].z * cR[i]; }
    if (Math.abs(zl) > 1e-12 * zref || Math.abs(zr) > 1e-12 * zref) throw new Error('reservoirs must be electroneutral');
    const SL = cL.reduce((p, q) => p + q, 0), SR = cR.reduce((p, q) => p + q, 0);
    // Péclet integrals X_i(x) = ∫ dx/(D_i A) from the left reservoir (χ_i = Q X_i): with flow, the Slotboom variable is
    // u = c e^{ψ − χ}, constant along x when a species carries no net flux even though it is advected
    const X = sp.map((_, i) => { const a = new Float64Array(n); if (eof) for (let f = 0; f < nf; f++) a[f + 1] = a[f] + h[f] / DAf[i][f]; return a; });
    return { s, T, RT, VT, G, n, nf, ns, sp, z: sp.map((q) => q.z), lam2, h, Af, xm, Vn, Vf, spore, mu0, DAf, qf, vt, eof, rh, Rh, X,
      side, cL, cR, stL: vt ? -Math.log(1 - vt * SL) : 0, stR: vt ? -Math.log(1 - vt * SR) : 0, Vt: s.V / VT, dpt: (s.dp || 0) / (C0 * RT), dG };
  }

  /* ------------------------------------------------------------------ state */
  // reservoir Slotboom values u_res = c e^{ψ_res}, ψ_res = z φ_res + ψ_ster,res (no excess energy in the reservoirs)
  function uRes(P, st) {
    return P.z.map((z, i) => [P.cL[i] * Math.exp(z * P.Vt * st.lamV + P.stL), P.cR[i] * Math.exp(P.stR - st.Q * P.X[i][P.n - 1])]);
  }
  const phiRef = (P, st, k) => (P.side[k] === 0 ? P.Vt * st.lamV : 0);

  /* node quantities: full potential, concentrations, ψ, and the partial derivatives used by the Jacobian */
  function nodes(P, st) {
    const { n, ns, z } = P, U = uRes(P, st);
    const phi = new Float64Array(n), Dn = new Float64Array(n), rho = new Float64Array(n);
    const c = [], psi = [], E = [], u = [], aQ = [];
    for (let i = 0; i < ns; i++) { c.push(new Float64Array(n)); psi.push(new Float64Array(n)); E.push(new Float64Array(n)); u.push(new Float64Array(n)); aQ.push(new Float64Array(n)); }
    for (let k = 0; k < n; k++) {
      phi[k] = phiRef(P, st, k) + st.dphi[k];
      let sa = 0;
      for (let i = 0; i < ns; i++) {
        const e = Math.exp(-z[i] * phi[k] - st.lamE * P.mu0[i][k] + st.Q * P.X[i][k]);   // e^{−(ψ − χ)} without the finite-size part
        const uu = U[i][P.side[k]] + st.w[i][k];
        E[i][k] = e; u[i][k] = uu; c[i][k] = uu * e; sa += uu * e;
        // ∂a_i/∂Q, a_i = u_i e: through χ = Q X and, right of the centre, through u_res = c_R e^{… − Q X(end)}
        aQ[i][k] = uu * e * P.X[i][k] - (P.side[k] === 1 ? e * U[i][1] * P.X[i][n - 1] : 0);
      }
      const D = 1 + P.vt * sa; Dn[k] = D;
      let r = 0;
      for (let i = 0; i < ns; i++) { c[i][k] /= D; r += z[i] * c[i][k]; psi[i][k] = z[i] * phi[k] + st.lamE * P.mu0[i][k] + Math.log(D); }
      rho[k] = r;
    }
    return { phi, c, psi, E, u, Dn, rho, U, aQ };
  }

  /* ------------------------------------------------------------------ face fluxes */
  function faces(P, st, N) {
    const { nf, ns, h, DAf, side } = P;
    const dphiF = new Float64Array(nf);
    for (let f = 0; f < nf; f++) dphiF[f] = (phiRef(P, st, f + 1) - phiRef(P, st, f)) + (st.dphi[f + 1] - st.dphi[f]);
    const out = { J: [], G: [], B1: [], B2: [], dphiF };
    for (let i = 0; i < ns; i++) {
      const J = new Float64Array(nf), Gd = new Float64Array(nf), b1 = new Float64Array(nf), b2 = new Float64Array(nf);
      const ps = N.psi[i], c = N.c[i], w = st.w[i];
      for (let f = 0; f < nf; f++) {
        const g = DAf[i][f] / h[f], q = P.eof ? st.Q * h[f] / DAf[i][f] : 0;
        const D = (ps[f + 1] - ps[f]) - q, bp = bern(D), bm = bern(-D);
        // Slotboom form of the Scharfetter–Gummel flux, Δ = Δψ − Δχ: J = g B(Δ) e^{−(ψ_k − χ_k)} [u_k − u_{k+1}]
        const ek = N.E[i][f] / N.Dn[f];                                // e^{−(ψ_k − χ_k)}
        const br = side[f] === side[f + 1] ? w[f] - w[f + 1] : N.u[i][f] - N.u[i][f + 1];
        J[f] = g * bp * ek * br;
        Gd[f] = g * (dbern(D) * c[f] + dbern(-D) * c[f + 1]);         // ∂J/∂Δ (concentration form)
        b1[f] = g * bp; b2[f] = g * bm;
      }
      out.J.push(J); out.G.push(Gd); out.B1.push(b1); out.B2.push(b2);
    }
    return out;
  }

  /* ------------------------------------------------------------------ residual and Jacobian */
  /* Block-tridiagonal Jacobian in flat arrays: block k of Lb/Db/Ub starts at k·m², row-major m×m (m = 1 + species);
     Lb couples node k to k−1, Ub to k+1. Unknown 0 is δφ, unknown 1 + j is w_j. */
  function assemble(P, st) {
    const { n, nf, ns, h, Af, Vn, lam2, z, qf } = P, m = ns + 1, mm = m * m, N = n * m;
    const Nd = nodes(P, st), Fx = faces(P, st, Nd), c = Nd.c;
    const R = new Float64Array(N + (P.eof ? 1 : 0));
    const Lb = new Float64Array(n * mm), Db = new Float64Array(n * mm), Ub = new Float64Array(n * mm);
    const colQ = P.eof ? new Float64Array(N) : null, rowQ = P.eof ? new Float64Array(N) : null;
    let dQQ = 0, qGross = 0;
    // node derivatives: dc[(i·m + v)·n + k] = ∂c_i/∂(unknown v), dps[(i·m + v)·n + k] = ∂ψ_i/∂(unknown v)
    const dc = new Float64Array(ns * m * n), dps = new Float64Array(ns * m * n);
    for (let k = 0; k < n; k++) {
      const rk = Nd.rho[k], Dk = Nd.Dn[k];
      for (let i = 0; i < ns; i++) {
        const ci = c[i][k];
        dc[(i * m) * n + k] = ci * (-z[i] + P.vt * rk);
        dps[(i * m) * n + k] = z[i] - P.vt * rk;
        for (let j = 0; j < ns; j++) {
          const Ej = Nd.E[j][k] / Dk;
          dc[(i * m + 1 + j) * n + k] = ((i === j ? 1 : 0) - P.vt * ci) * Ej;
          dps[(i * m + 1 + j) * n + k] = P.vt * Ej;
        }
      }
    }
    // derivatives with respect to the flow Q (through χ = Q X and the right-hand reservoir value of u)
    const dcQ = new Float64Array(ns * n), dpsQ = new Float64Array(n);
    if (P.eof) for (let k = 0; k < n; k++) {
      let sQ = 0; for (let j = 0; j < ns; j++) sQ += Nd.aQ[j][k];
      dpsQ[k] = P.vt * sQ / Nd.Dn[k];
      for (let i = 0; i < ns; i++) dcQ[i * n + k] = (Nd.aQ[i][k] - P.vt * c[i][k] * sQ) / Nd.Dn[k];
    }
    // face derivatives: dJL[(i·m + v)·nf + f] = ∂J_if/∂(unknown v at node f), dJR at node f + 1, dJQ = ∂J_if/∂Q
    const dJL = new Float64Array(ns * m * nf), dJR = new Float64Array(ns * m * nf), dJQ = new Float64Array(ns * nf);
    if (P.eof) for (let i = 0; i < ns; i++) for (let f = 0; f < nf; f++)
      dJQ[i * nf + f] = Fx.B1[i][f] * dcQ[i * n + f] - Fx.B2[i][f] * dcQ[i * n + f + 1] + Fx.G[i][f] * (dpsQ[f + 1] - dpsQ[f] - h[f] / P.DAf[i][f]);
    for (let i = 0; i < ns; i++) {
      const B1 = Fx.B1[i], B2 = Fx.B2[i], G = Fx.G[i];
      for (let v = 0; v < m; v++) {
        const o = (i * m + v) * n, of = (i * m + v) * nf;
        for (let f = 0; f < nf; f++) {
          dJL[of + f] = B1[f] * dc[o + f] - G[f] * dps[o + f];
          dJR[of + f] = -B2[f] * dc[o + f + 1] + G[f] * dps[o + f + 1];
        }
      }
    }
    for (let k = 0; k < n; k++) {
      const base = k * m, bo = k * mm;
      if (k === 0 || k === n - 1) {                                  // Dirichlet rows: reservoir state
        R[base] = st.dphi[k];
        for (let i = 0; i < ns; i++) R[base + 1 + i] = st.w[i][k];
        for (let v = 0; v < m; v++) Db[bo + v * m + v] = 1;
        continue;
      }
      const kl = lam2 * Af[k - 1] / h[k - 1], kr = lam2 * Af[k] / h[k];
      R[base] = kr * Fx.dphiF[k] - kl * Fx.dphiF[k - 1] + Vn[k] * Nd.rho[k] + qf[k] * st.lamQ;
      Lb[bo] = kl; Ub[bo] = kr;
      if (P.eof) { let s = 0; for (let i = 0; i < ns; i++) s += z[i] * dcQ[i * n + k]; colQ[base] = Vn[k] * s; }
      for (let v = 0; v < m; v++) {
        let s = v === 0 ? -kr - kl : 0;
        for (let i = 0; i < ns; i++) s += Vn[k] * z[i] * dc[(i * m + v) * n + k];
        Db[bo + v] = s;
      }
      for (let i = 0; i < ns; i++) {
        const row = bo + (1 + i) * m, fr = k, fl = k - 1;
        R[base + 1 + i] = Fx.J[i][fr] - Fx.J[i][fl];
        for (let v = 0; v < m; v++) {
          const of = (i * m + v) * nf;
          Db[row + v] += dJL[of + fr] - dJR[of + fl];
          Ub[row + v] += dJR[of + fr];
          Lb[row + v] -= dJL[of + fl];
        }
        if (P.eof) colQ[base + 1 + i] = dJQ[i * nf + fr] - dJQ[i * nf + fl];
      }
    }
    if (P.eof) {
      // R_Q = Q R̃h − Δp̃ − Σ_i [ Σ_f (J_if − ĉ_if Q) h_f/(DA)_if + (c_i,R − c_i,L) ]   (Σ_f Δc telescoped exactly)
      let rq = st.Q * P.Rh - P.dpt * st.lamV, qg = Math.abs(st.Q * P.Rh) + Math.abs(P.dpt * st.lamV);
      dQQ = P.Rh;
      for (let i = 0; i < ns; i++) {
        const dcRL = P.cR[i] - P.cL[i];
        rq -= dcRL; qg += Math.abs(dcRL);
        for (let f = 0; f < nf; f++) {
          const wh = h[f] / P.DAf[i][f], ch = 0.5 * (c[i][f] + c[i][f + 1]);
          rq -= (Fx.J[i][f] - ch * st.Q) * wh;
          qg += (Fx.B1[i][f] * c[i][f] + Fx.B2[i][f] * c[i][f + 1] + Math.abs(ch * st.Q)) * wh;
          for (let v = 0; v < m; v++) {
            const o = (i * m + v) * n, of = (i * m + v) * nf;
            rowQ[f * m + v] += -wh * (dJL[of + f] - 0.5 * st.Q * dc[o + f]);
            rowQ[(f + 1) * m + v] += -wh * (dJR[of + f] - 0.5 * st.Q * dc[o + f + 1]);
          }
          dQQ -= (dJQ[i * nf + f] - ch - 0.5 * st.Q * (dcQ[i * n + f] + dcQ[i * n + f + 1])) * wh;
        }
      }
      R[N] = rq; qGross = qg;
    }
    return { R, Lb, Db, Ub, colQ, rowQ, dQQ, Fx, Nd, m, N, qGross };
  }

  /* ------------------------------------------------------------------ block-tridiagonal solve (bordered) */
  function lu3(A, o, m, piv, po) {                                   // in-place LU with partial pivoting of the m×m block at A[o]
    for (let j = 0; j < m; j++) {
      let p = j, mx = Math.abs(A[o + j * m + j]);
      for (let i = j + 1; i < m; i++) { const v = Math.abs(A[o + i * m + j]); if (v > mx) { mx = v; p = i; } }
      piv[po + j] = p;
      if (p !== j) for (let cc = 0; cc < m; cc++) { const t = A[o + j * m + cc]; A[o + j * m + cc] = A[o + p * m + cc]; A[o + p * m + cc] = t; }
      const d = A[o + j * m + j];
      if (d === 0 || !isFinite(d)) throw new Error('singular block');
      for (let i = j + 1; i < m; i++) { const f = A[o + i * m + j] / d; A[o + i * m + j] = f; for (let cc = j + 1; cc < m; cc++) A[o + i * m + cc] -= f * A[o + j * m + cc]; }
    }
  }
  function lusolve(A, o, m, piv, po, b, bo) {
    for (let j = 0; j < m; j++) { const p = piv[po + j]; if (p !== j) { const t = b[bo + j]; b[bo + j] = b[bo + p]; b[bo + p] = t; } }
    for (let i = 1; i < m; i++) { let s = b[bo + i]; for (let cc = 0; cc < i; cc++) s -= A[o + i * m + cc] * b[bo + cc]; b[bo + i] = s; }
    for (let i = m - 1; i >= 0; i--) { let s = b[bo + i]; for (let cc = i + 1; cc < m; cc++) s -= A[o + i * m + cc] * b[bo + cc]; b[bo + i] = s / A[o + i * m + i]; }
  }
  function blockFactor(Lb, Db, Ub, n, m) {
    const mm = m * m, D = Float64Array.from(Db), W = new Float64Array(n * mm), piv = new Int32Array(n * m), col = new Float64Array(m);
    for (let k = 0; k < n; k++) {
      const o = k * mm;
      if (k > 0) {
        const op = (k - 1) * mm;
        for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) { let s = 0; for (let q = 0; q < m; q++) s += Lb[o + i * m + q] * W[op + q * m + j]; D[o + i * m + j] -= s; }
      }
      lu3(D, o, m, piv, k * m);
      for (let j = 0; j < m; j++) {
        for (let i = 0; i < m; i++) col[i] = Ub[o + i * m + j];
        lusolve(D, o, m, piv, k * m, col, 0);
        for (let i = 0; i < m; i++) W[o + i * m + j] = col[i];
      }
    }
    return { D, piv, W, Lb, n, m };
  }
  function blockSolve(Fz, rhs) {
    const { D, piv, W, Lb, n, m } = Fz, mm = m * m, y = Float64Array.from(rhs.subarray(0, n * m));
    for (let k = 0; k < n; k++) {
      const o = k * mm, b = k * m;
      if (k > 0) for (let i = 0; i < m; i++) { let s = 0; for (let q = 0; q < m; q++) s += Lb[o + i * m + q] * y[b - m + q]; y[b + i] -= s; }
      lusolve(D, o, m, piv, b, y, b);
    }
    for (let k = n - 2; k >= 0; k--) {
      const o = k * mm, b = k * m;
      for (let i = 0; i < m; i++) { let s = 0; for (let q = 0; q < m; q++) s += W[o + i * m + q] * y[b + m + q]; y[b + i] -= s; }
    }
    return y;
  }

  /* ------------------------------------------------------------------ Newton with positivity-preserving damping */
  /* Scaled residual: every equation divided by the sum of the magnitudes of the terms it balances (Poisson: the two
     displacement fluxes, the mobile and the fixed charge; species: the four one-sided Scharfetter–Gummel terms; flow:
     the hydraulic, pressure and force terms; boundary rows: thermal voltage and reservoir Slotboom value). */
  function residualNorm(P, A, st) {
    const { n, ns, z } = P, m = ns + 1, R = A.R, Fx = A.Fx, c = A.Nd.c;
    let mx = 0;
    for (const k of [0, n - 1]) {
      mx = Math.max(mx, Math.abs(R[k * m]) / (1 + Math.abs(P.Vt)));
      for (let i = 0; i < ns; i++) mx = Math.max(mx, Math.abs(R[k * m + 1 + i]) / A.Nd.U[i][P.side[k]]);
    }
    for (let k = 1; k < n - 1; k++) {
      const kl = P.lam2 * P.Af[k - 1] / P.h[k - 1], kr = P.lam2 * P.Af[k] / P.h[k];
      let qs = kr * Math.abs(Fx.dphiF[k]) + kl * Math.abs(Fx.dphiF[k - 1]) + Math.abs(P.qf[k] * st.lamQ);
      for (let i = 0; i < ns; i++) qs += P.Vn[k] * Math.abs(z[i]) * c[i][k];
      mx = Math.max(mx, Math.abs(R[k * m]) / (qs + 1e-300));
      for (let i = 0; i < ns; i++) {
        const gs = Fx.B1[i][k] * c[i][k] + Fx.B2[i][k] * c[i][k + 1] + Fx.B1[i][k - 1] * c[i][k - 1] + Fx.B2[i][k - 1] * c[i][k];
        mx = Math.max(mx, Math.abs(R[k * m + 1 + i]) / (gs + 1e-300));
      }
    }
    if (P.eof) mx = Math.max(mx, Math.abs(R[n * m]) / (A.qGross + 1e-300));
    return mx;
  }
  function newton(P, st, opts) {
    const maxIt = (opts && opts.maxIt) || 60, tol = (opts && opts.tol) || 1e-12;
    const { n, ns } = P, m = ns + 1;
    let it = 0, res = Infinity, A = null, polish = 0, last = Infinity;
    for (; it < maxIt; it++) {
      A = assemble(P, st);
      res = residualNorm(P, A, st);
      if (!isFinite(res)) break;
      // converged: a few more steps while the residual still falls, so the solution reaches the floating-point floor
      if (res < tol) { if (res < 1e-22 || polish >= 4 || res > 0.5 * last) break; polish++; }
      last = res;
      const Fz = blockFactor(A.Lb, A.Db, A.Ub, n, m);
      const y = blockSolve(Fz, A.R);
      let dQ = 0, du = y;
      if (P.eof) {
        const zc = blockSolve(Fz, A.colQ);
        let ry = 0, rz = 0; for (let q = 0; q < A.N; q++) { ry += A.rowQ[q] * y[q]; rz += A.rowQ[q] * zc[q]; }
        dQ = (A.R[A.N] - ry) / (A.dQQ - rz);
        du = new Float64Array(A.N); for (let q = 0; q < A.N; q++) du[q] = y[q] - zc[q] * dQ;
      }
      // damping: Slotboom values stay above 5 % of their current value, |δφ| ≤ 2 thermal units per step
      let lam = 1;
      for (let k = 0; k < n; k++) {
        const dp = du[k * m]; if (Math.abs(dp) * lam > 2) lam = 2 / Math.abs(dp);
        for (let i = 0; i < ns; i++) { const uu = A.Nd.u[i][k], d = du[k * m + 1 + i]; if (uu - lam * d < 0.05 * uu) lam = Math.min(lam, 0.95 * uu / d); }
      }
      for (let k = 0; k < n; k++) { st.dphi[k] -= lam * du[k * m]; for (let i = 0; i < ns; i++) st.w[i][k] -= lam * du[k * m + 1 + i]; }
      if (P.eof) st.Q -= lam * dQ;
    }
    return { it, res, A };
  }

  /* ------------------------------------------------------------------ states, continuation and solve */
  // state from full fields (dimensionless φ, c) at given continuation parameters
  function stateFrom(P, phi, c, Q, lam) {
    const st = { dphi: new Float64Array(P.n), w: [], Q: P.eof ? (Q || 0) : 0, lamE: lam.E, lamQ: lam.Q, lamV: lam.V };
    const U = uRes(P, st);
    for (let k = 0; k < P.n; k++) st.dphi[k] = phi[k] - phiRef(P, st, k);
    for (let i = 0; i < P.ns; i++) st.w.push(new Float64Array(P.n));
    for (let k = 0; k < P.n; k++) {
      let S = 0; for (let i = 0; i < P.ns; i++) S += c[i][k];
      const ster = P.vt ? -Math.log(1 - P.vt * S) : 0;
      for (let i = 0; i < P.ns; i++) st.w[i][k] = c[i][k] * Math.exp(P.z[i] * phi[k] + lam.E * P.mu0[i][k] + ster - st.Q * P.X[i][k]) - U[i][P.side[k]];
    }
    for (let i = 0; i < P.ns; i++) { st.w[i][0] = 0; st.w[i][P.n - 1] = 0; }
    st.dphi[0] = 0; st.dphi[P.n - 1] = 0;
    return st;
  }
  function initialState(P) {
    // drive-free start: potential zero, concentrations interpolated logarithmically, weighted by resistance
    const { n, ns } = P, w = new Float64Array(n);
    let tot = 0; for (let f = 0; f < P.nf; f++) tot += P.h[f] / P.Af[f];
    let acc = 0; for (let f = 0; f < P.nf; f++) { acc += P.h[f] / P.Af[f]; w[f + 1] = acc / tot; }
    const c = [];
    for (let i = 0; i < ns; i++) {
      const a = new Float64Array(n);
      for (let k = 0; k < n; k++) a[k] = Math.exp(Math.log(P.cL[i]) * (1 - w[k]) + Math.log(P.cR[i]) * w[k]);
      c.push(a);
    }
    return stateFrom(P, new Float64Array(n), c, 0, { E: 0, Q: 0, V: 0 });
  }
  function setLam(P, st, lam) {                                      // change continuation parameters keeping φ and c
    const Nd = nodes(P, st);
    return stateFrom(P, Nd.phi, Nd.c, st.Q, { E: lam, Q: lam, V: lam });
  }

  function solve(s, opts) {
    opts = opts || {};
    const tol = opts.tol || 1e-12;
    const P = setup(s);
    let st = null, info = null, ok = false, steps = 0;
    if (opts.prev && opts.prev.phi && opts.prev.phi.length === P.n) {
      st = stateFrom(P, opts.prev.phi, opts.prev.c, opts.prev.Q, { E: 1, Q: 1, V: 1 });
      info = newton(P, st, opts);
      ok = info.res < tol * 10;
    }
    if (!ok) {                                                       // continuation in (excess energy, fixed charge, drive)
      st = initialState(P);
      info = newton(P, st, { maxIt: 60, tol });
      let lam = 0, dl = 0.25;
      while (lam < 1 && steps < 200) {
        const next = Math.min(1, lam + dl), trial = setLam(P, st, next);
        info = newton(P, trial, { maxIt: 40, tol });
        steps++;
        if (info.res < 1e-9 && isFinite(info.res)) { st = trial; lam = next; dl = Math.min(0.5, dl * 1.5); }
        else { dl /= 2; if (dl < 1e-4) break; }
      }
      if (lam < 1) st = setLam(P, st, 1);
      info = newton(P, st, { maxIt: 60, tol });
      ok = info.res < tol * 10;
    }
    return finish(P, st, info, ok, steps);
  }

  function finish(P, st, info, ok, steps) {
    const A = assemble(P, st), { ns, nf, n } = P, Nd = A.Nd, c = Nd.c;
    const J = [], Jdev = [];
    for (let i = 0; i < ns; i++) {
      let mean = 0; for (let f = 0; f < nf; f++) mean += A.Fx.J[i][f]; mean /= nf;
      let dev = 0; for (let f = 0; f < nf; f++) dev = Math.max(dev, Math.abs(A.Fx.J[i][f] - mean));
      J.push(mean); Jdev.push(dev);
    }
    const Jsi = J.map((v) => v * D0 * ELL * C0);                     // mol s⁻¹
    let I = 0; for (let i = 0; i < ns; i++) I += K.F * P.z[i] * Jsi[i];
    const Qsi = P.eof ? st.Q * D0 * ELL : 0;                          // m³ s⁻¹
    const nIn = [];                                                  // ions in the pore: cell volumes × mean concentration
    for (let i = 0; i < ns; i++) {
      let s = 0;
      for (let f = 0; f < nf; f++) if (Math.abs(P.xm[f]) < P.G.half) s += 0.5 * (c[i][f] + c[i][f + 1]) * P.Vf[f];
      nIn.push(s * C0 * ELL * ELL * ELL * K.NA);
    }
    let pack = 0;
    if (P.vt) for (let k = 0; k < n; k++) { let S = 0; for (let i = 0; i < ns; i++) S += c[i][k]; pack = Math.max(pack, P.vt * S); }
    const cbulk = Math.max(...P.s.cL, ...P.s.cR);
    const lD = Math.sqrt(K.eps0 * P.s.epsR * P.RT / (2 * K.F * K.F * cbulk));
    const muEx = P.mu0.map((mu, i) => Array.from(mu, (v, k) => (Nd.psi[i][k] - P.z[i] * Nd.phi[k]) * P.RT));
    return {
      ok, iterations: info ? info.it : 0, residual: info ? info.res : NaN, continuationSteps: steps,
      x: Array.from(P.G.x, (v) => v * ELL), r: Array.from(P.G.r, (v) => v * ELL), half: P.G.half * ELL,
      phi: Array.from(Nd.phi, (v) => v * P.VT), c: c.map((a) => Array.from(a, (v) => v * C0)), muEx,
      J: Jsi, Jdev: Jdev.map((v, i) => (J[i] !== 0 ? v / Math.abs(J[i]) : v)), Jfaces: A.Fx.J.map((a) => Array.from(a, (v) => v * D0 * ELL * C0)),
      I, Ispecies: Jsi.map((j, i) => K.F * P.z[i] * j), Q: Qsi, Rh: P.eof ? P.Rh * C0 * P.RT / (D0 * ELL) : null,
      nInPore: nIn, packingMax: pack, debyeLength: lD, poreRadius: P.G.a * ELL,
      state: { phi: Array.from(Nd.phi), c: c.map((a) => Array.from(a)), Q: st.Q },
      flags: flagsFor(P, nIn, pack, lD), T: P.T, VT: P.VT,
    };
  }

  function flagsFor(P, nIn, pack, lD) {
    const f = [], rc = P.s.geom.rCarbon, sigCO = 0.319e-9;
    if (rc && rc - sigCO < 0.14e-9) f.push({ id: 'single-file', level: 'outside', text: 'Water forms a single file in this tube: the continuum description is outside its domain; the result is shown for comparison only.' });
    if (nIn.reduce((a, b) => a + b, 0) < 1) f.push({ id: 'occupancy', level: 'caution', text: 'Fewer than one ion in the pore on average: the mean-field result averages over rare, discrete occupancy. Discrete or correlated transport should be examined; this alone does not show that Coulomb blockade or knock-on conduction occurs, and neither is represented.' });
    if (pack > 0.5) f.push({ id: 'packing', level: 'caution', text: 'The finite-size term is strongly engaged (packing fraction ' + pack.toFixed(2) + '): ions crowd at the charged rims.' });
    if (lD > P.G.a * ELL) f.push({ id: 'overlap', level: 'info', text: 'The Debye length (' + (lD * 1e9).toFixed(2) + ' nm) exceeds the pore radius: the double layers overlap, which is the regime the one-dimensional model assumes.' });
    return f;
  }

  /* ------------------------------------------------------------------ derived experiments */
  function withV(s, V) { const t = JSON.parse(JSON.stringify(s)); t.V = V; return t; }
  function ivCurve(s, Vs, opts) {
    // sweep outwards from the voltage closest to 0, reusing the neighbouring solution as the initial guess
    const order = Vs.map((v, i) => i).sort((p, q) => Math.abs(Vs[p]) - Math.abs(Vs[q]));
    const out = new Array(Vs.length); let prevPos = null, prevNeg = null;
    for (const i of order) {
      const V = Vs[i], prev = (V >= 0 ? prevPos : prevNeg) || prevPos || prevNeg;
      const r = solve(withV(s, V), Object.assign({}, opts, { prev }));
      out[i] = { V, I: r.I, Ispecies: r.Ispecies, Q: r.Q, ok: r.ok };
      if (V >= 0) prevPos = r.state; if (V <= 0) prevNeg = r.state;
    }
    return out;
  }
  function reversal(s, opts) {
    // zero-current potential: bracket on [−0.12, 0.12] V (widened if needed), then Brent's method
    let a = -0.12, b = 0.12, ra = solve(withV(s, a), opts), rb = solve(withV(s, b), Object.assign({}, opts, { prev: ra.state }));
    let it = 0;
    while (ra.I * rb.I > 0 && it < 4) { a *= 1.6; b *= 1.6; ra = solve(withV(s, a), opts); rb = solve(withV(s, b), opts); it++; }
    if (ra.I * rb.I > 0) return { V: NaN, ok: false };
    let fa = ra.I, fb = rb.I, prev = rb.state;
    // tight tolerances: the root is resolved to the rounding level of I(V), so the result does not depend on the path
    const ftol = 1e-13 * Math.max(Math.abs(fa), Math.abs(fb)), xtol = 4e-14;
    if (Math.abs(fa) < Math.abs(fb)) { [a, b] = [b, a]; [fa, fb] = [fb, fa]; prev = ra.state; }
    let cc = a, fc = fa, d = b - a, mflag = true, evals = 0;
    const done = () => { const r = solve(withV(s, b), Object.assign({}, opts, { prev })); return { V: b, I: r.I, ok: r.ok, result: r, iterations: evals + 1 }; };
    for (let k = 0; k < 100; k++) {
      if (Math.abs(fb) <= ftol || Math.abs(b - a) < xtol) return done();
      let x;
      if (fa !== fc && fb !== fc) x = a * fb * fc / ((fa - fb) * (fa - fc)) + b * fa * fc / ((fb - fa) * (fb - fc)) + cc * fa * fb / ((fc - fa) * (fc - fb));
      else x = b - fb * (b - a) / (fb - fa);
      const lo = Math.min((3 * a + b) / 4, b), hi = Math.max((3 * a + b) / 4, b);
      if (!(x > lo && x < hi) || (mflag && Math.abs(x - b) >= Math.abs(b - cc) / 2) || (!mflag && Math.abs(x - b) >= Math.abs(cc - d) / 2) ||
          (mflag && Math.abs(b - cc) < xtol) || (!mflag && Math.abs(cc - d) < xtol)) { x = (a + b) / 2; mflag = true; } else mflag = false;
      const r = solve(withV(s, x), Object.assign({}, opts, { prev })); evals++;
      prev = r.state;
      d = cc; cc = b; fc = fb;
      if (fa * r.I < 0) { b = x; fb = r.I; } else { a = x; fa = r.I; }
      if (Math.abs(fa) < Math.abs(fb)) { [a, b] = [b, a]; [fa, fb] = [fb, fa]; }
    }
    return { V: NaN, ok: false };
  }
  /* GHK permeability ratio P₊/P₋ of a 1:1 salt from a reversal potential (V = φ_left − φ_right; left concentration cL,
     right cR). gL, gR: activity coefficients of the salt in each reservoir (1 for ideal solutions; with the finite-size
     term both ions have γ = 1/(1 − ṽ Σc) in a reservoir, so the inversion uses activities a = γc). */
  function ghkRatio(Vrev, cL, cR, T, gL, gR) {
    const u = Math.exp(K.F * Vrev / (K.R * (T || 300))), aL = cL * (gL || 1), aR = cR * (gR || 1);
    return (aL - u * aR) / (u * aL - aR);
  }

  return { K, ALPHA, CH, bern, dbern, buildGrid, setup, solve, ivCurve, reversal, ghkRatio, withV, scales: { ELL, C0, D0 } };
});
