/* Continuum Lab — steady Stokes flow in the feed and permeate chambers, coupled through the membrane interface law.
   Staggered (MAC) finite volumes on uniform Cartesian grids, rows scaled by control volumes so the system is
   symmetric, K = [A, G; G^T, 0] with A symmetric positive definite; MINRES with a block-diagonal SPD preconditioner.
   Float64 throughout. Model, boundary conditions and discretisation: tools/continuum/CONTRACTS.md §5.

   Units and scaling: lengths are divided by Lref = min(W, B); pressures are carried in pascals (scale 1 Pa) as a
   gauge relative to each chamber's own port pressure (p = p_port,c + p'), so the large pressure level never enters
   the unknowns; velocities are divided by U = (1 Pa) / (RsRef + mu / Lref). Then the scaled momentum equation is
   -grad p' + eps lap u = 0 with eps = mu / (Lref (RsRef + mu / Lref)), and the membrane law reads
   p_f - p_p = Rs* J with Rs* = Rs / (RsRef + mu / Lref). */
(function (root) {
  'use strict';
  const SOLVER_VERSION = 'continuum-mac-stokes-1.0.0';

  /* ---------------------------------------------------------------- sparse matrix (COO -> CSR) */
  function Coo(cap) { this.r = new Int32Array(cap); this.c = new Int32Array(cap); this.v = new Float64Array(cap); this.n = 0; }
  Coo.prototype.add = function (r, c, v) {
    if (v === 0) return;
    if (this.n === this.r.length) {
      const g = (a, T) => { const b = new T(a.length * 2); b.set(a); return b; };
      this.r = g(this.r, Int32Array); this.c = g(this.c, Int32Array); this.v = g(this.v, Float64Array);
    }
    this.r[this.n] = r; this.c[this.n] = c; this.v[this.n] = v; this.n++;
  };
  function toCsr(coo, n) {
    const cnt = new Int32Array(n + 1);
    for (let k = 0; k < coo.n; k++) cnt[coo.r[k] + 1]++;
    for (let i = 0; i < n; i++) cnt[i + 1] += cnt[i];
    const col = new Int32Array(coo.n), val = new Float64Array(coo.n), pos = cnt.slice(0, n);
    for (let k = 0; k < coo.n; k++) { const p = pos[coo.r[k]]++; col[p] = coo.c[k]; val[p] = coo.v[k]; }
    // sort each row by column and merge duplicates into separate output arrays (in-place compaction would overwrite
    // entries of the row that have not been read yet, because they are read in sorted, not stored, order)
    const rowPtr = new Int32Array(n + 1), oc = new Int32Array(coo.n), ov = new Float64Array(coo.n);
    let w = 0;
    for (let i = 0; i < n; i++) {
      const a = cnt[i], b = cnt[i + 1], idx = [];
      for (let p = a; p < b; p++) idx.push(p);
      idx.sort((x, y) => col[x] - col[y]);
      rowPtr[i] = w;
      let last = -1;
      for (const p of idx) {
        if (col[p] === last) { ov[w - 1] += val[p]; continue; }
        oc[w] = col[p]; ov[w] = val[p]; last = col[p]; w++;
      }
    }
    rowPtr[n] = w;
    return { n, rowPtr, col: oc.slice(0, w), val: ov.slice(0, w) };
  }
  function matvec(A, x, y) {
    const rp = A.rowPtr, ci = A.col, va = A.val;
    for (let i = 0; i < A.n; i++) { let s = 0; for (let p = rp[i]; p < rp[i + 1]; p++) s += va[p] * x[ci[p]]; y[i] = s; }
  }
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

  /* ---------------------------------------------------------------- system assembly */
  /* cfg: { device:{nx,ny,nz,dx,dy,dz,Lref,port:{i0,i1,j0,j1}}, mode:'device'|'duct', walls:'no-slip'|'free-slip',
            closure:'zero-tangential'|'continuous-tangential', mu, Rs:Float64Array (per membrane face, Pa s/m; Infinity = closed),
            RsRef, pFeed, pPerm (Pa, gauge; duct: pFeed at the top port, pPerm at the bottom port) } */
  function assemble(cfg) {
    const d = cfg.device, nx = d.nx, ny = d.ny, nz = d.nz, L = d.Lref;
    const duct = cfg.mode === 'duct', nch = duct ? 1 : 2;
    const mu = cfg.mu, RsRef = duct ? 0 : cfg.RsRef;
    const U = 1 / (RsRef + mu / L);                          // m/s per Pa
    const eps = mu * U / L;
    const dx = d.dx / L, dy = d.dy / L, dz = d.dz / L;
    const noslip = cfg.walls !== 'free-slip', contTan = cfg.closure === 'continuous-tangential';
    const inPort = (i, j) => i >= d.port.i0 && i < d.port.i1 && j >= d.port.j0 && j < d.port.j1;
    const open = (i, j) => !duct && Number.isFinite(cfg.Rs[j * nx + i]);

    // boundary description per chamber: c = 0 feed (upper; or the duct), c = 1 permeate (lower)
    const bc = [];
    if (duct) bc.push({ bottom: 'port', top: 'port', bottomFull: true, topFull: true, pBottom: cfg.pPerm, pTop: cfg.pFeed, pRef: cfg.pPerm });
    else {
      bc.push({ bottom: 'membrane', top: 'port', pTop: cfg.pFeed, pRef: cfg.pFeed });
      bc.push({ bottom: 'port', top: 'membrane', pBottom: cfg.pPerm, pRef: cfg.pPerm });
    }
    const portAt = (c, side, i, j) => bc[c][side] === 'port' && (bc[c][side + 'Full'] || inPort(i, j));

    // ---- unknown numbering
    let n = 0;
    const uI = [], vI = [], wI = [], pI = [];
    const mI = new Int32Array(nx * ny).fill(-1);
    for (let c = 0; c < nch; c++) {
      const u = new Int32Array((nx + 1) * ny * nz).fill(-1), v = new Int32Array(nx * (ny + 1) * nz).fill(-1), w = new Int32Array(nx * ny * (nz + 1)).fill(-1);
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 1; i < nx; i++) u[(k * ny + j) * (nx + 1) + i] = n++;
      for (let k = 0; k < nz; k++) for (let j = 1; j < ny; j++) for (let i = 0; i < nx; i++) v[(k * (ny + 1) + j) * nx + i] = n++;
      for (let kf = 0; kf <= nz; kf++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const id = (kf * ny + j) * nx + i;
        if (kf > 0 && kf < nz) { w[id] = n++; continue; }
        const side = kf === 0 ? 'bottom' : 'top';
        if (portAt(c, side, i, j)) w[id] = n++;
        else if (bc[c][side] === 'membrane' && open(i, j)) {
          if (mI[j * nx + i] < 0) mI[j * nx + i] = n++;
          w[id] = mI[j * nx + i];
        }
      }
      uI.push(u); vI.push(v); wI.push(w);
    }
    const nv = n;
    for (let c = 0; c < nch; c++) { const p = new Int32Array(nx * ny * nz); for (let q = 0; q < p.length; q++) p[q] = n++; pI.push(p); }
    const N = n;

    const coo = new Coo(N * 12), rhs = new Float64Array(N);
    const isMem = new Uint8Array(N), memFace = new Int32Array(N).fill(-1), memRs = new Float64Array(N);
    const uix = (c, i, j, k) => uI[c][(k * ny + j) * (nx + 1) + i];
    const vix = (c, i, j, k) => vI[c][(k * (ny + 1) + j) * nx + i];
    const wix = (c, i, j, kf) => wI[c][(kf * ny + j) * nx + i];
    const pix = (c, i, j, k) => pI[c][(k * ny + j) * nx + i];
    const sym = (a, b, val) => { coo.add(a, b, val); coo.add(b, a, val); };

    /* tangential neighbour across a top/bottom boundary for u (dir 'x') or v ('y') faces:
       returns { kind:'zero' } (u_t = 0 at the boundary), { kind:'free' }, or { kind:'couple', idx } */
    function tangentialAcross(c, side, comp, i, j) {
      const t = bc[c][side];
      if (t === 'port') {
        // comparison option 'outlet-free': zero tangential gradient on the outlet (lowest) port, as OpenFOAM's
        // pressureInletOutletVelocity does for outflow; the lab default keeps u_t = 0 on both ports
        if (cfg.portTangential === 'outlet-free' && side === 'bottom' && c === nch - 1) {
          const cells = comp === 'x' ? [[i - 1, j], [i, j]] : [[i, j - 1], [i, j]];
          if (cells.every(([ii, jj]) => ii >= 0 && jj >= 0 && ii < nx && jj < ny && (bc[c].bottomFull || inPort(ii, jj)))) return { kind: 'free' };
        }
        return { kind: 'zero' };
      }
      if (t === 'wall') return noslip ? { kind: 'zero' } : { kind: 'free' };
      // membrane
      if (!contTan) return { kind: 'zero' };
      const a = comp === 'x' ? [[i - 1, j], [i, j]] : [[i, j - 1], [i, j]];
      if (!a.every(([ii, jj]) => ii >= 0 && jj >= 0 && ii < nx && jj < ny && open(ii, jj))) return { kind: 'zero' };
      const oc = c === 0 ? 1 : 0, ok = c === 0 ? nz - 1 : 0;
      return { kind: 'couple', idx: comp === 'x' ? uix(oc, i, j, ok) : vix(oc, i, j, ok) };
    }

    for (let c = 0; c < nch; c++) {
      const pRef = bc[c].pRef;
      // ---- u faces
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 1; i < nx; i++) {
        const r = uix(c, i, j, k), cx = dy * dz / dx, cy = dx * dz / dy, cz = dx * dy / dz;
        let diag = 0;
        for (const di of [-1, 1]) { const ni = i + di; if (ni >= 1 && ni <= nx - 1) coo.add(r, uix(c, ni, j, k), -eps * cx); diag += eps * cx; }
        for (const dj of [-1, 1]) {
          const nj = j + dj;
          if (nj >= 0 && nj < ny) { coo.add(r, uix(c, i, nj, k), -eps * cy); diag += eps * cy; } else if (noslip) diag += 2 * eps * cy;
        }
        for (const dk of [-1, 1]) {
          const nk = k + dk;
          if (nk >= 0 && nk < nz) { coo.add(r, uix(c, i, j, nk), -eps * cz); diag += eps * cz; continue; }
          const t = tangentialAcross(c, nk < 0 ? 'bottom' : 'top', 'x', i, j);
          if (t.kind === 'zero') diag += 2 * eps * cz; else if (t.kind === 'couple') { coo.add(r, t.idx, -eps * cz); diag += eps * cz; }
        }
        coo.add(r, r, diag);
        sym(r, pix(c, i, j, k), dy * dz); sym(r, pix(c, i - 1, j, k), -dy * dz);
      }
      // ---- v faces
      for (let k = 0; k < nz; k++) for (let j = 1; j < ny; j++) for (let i = 0; i < nx; i++) {
        const r = vix(c, i, j, k), cx = dy * dz / dx, cy = dx * dz / dy, cz = dx * dy / dz;
        let diag = 0;
        for (const dj of [-1, 1]) { const nj = j + dj; if (nj >= 1 && nj <= ny - 1) coo.add(r, vix(c, i, nj, k), -eps * cy); diag += eps * cy; }
        for (const di of [-1, 1]) {
          const ni = i + di;
          if (ni >= 0 && ni < nx) { coo.add(r, vix(c, ni, j, k), -eps * cx); diag += eps * cx; } else if (noslip) diag += 2 * eps * cx;
        }
        for (const dk of [-1, 1]) {
          const nk = k + dk;
          if (nk >= 0 && nk < nz) { coo.add(r, vix(c, i, j, nk), -eps * cz); diag += eps * cz; continue; }
          const t = tangentialAcross(c, nk < 0 ? 'bottom' : 'top', 'y', i, j);
          if (t.kind === 'zero') diag += 2 * eps * cz; else if (t.kind === 'couple') { coo.add(r, t.idx, -eps * cz); diag += eps * cz; }
        }
        coo.add(r, r, diag);
        sym(r, pix(c, i, j, k), dx * dz); sym(r, pix(c, i, j - 1, k), -dx * dz);
      }
      // ---- w faces (interior, port faces; membrane faces handled once below)
      for (let kf = 0; kf <= nz; kf++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const r = wix(c, i, j, kf);
        if (r < 0) continue;
        const boundary = kf === 0 || kf === nz;
        const side = kf === 0 ? 'bottom' : 'top';
        if (boundary && bc[c][side] === 'membrane') continue;              // membrane unknown: assembled separately
        const h = boundary ? 0.5 : 1;                                       // half control volume at a port
        const cx = dy * dz * h / dx, cy = dx * dz * h / dy, cz = dx * dy / dz;
        let diag = 0;
        // lateral neighbours (same kf): for boundary faces the neighbour may be a wall face (w = 0)
        for (const [di, dj, cc] of [[-1, 0, cx], [1, 0, cx], [0, -1, cy], [0, 1, cy]]) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || ni >= nx || nj < 0 || nj >= ny) { if (noslip) diag += 2 * eps * cc; continue; }
          const q = wix(c, ni, nj, kf);
          if (q >= 0) coo.add(r, q, -eps * cc);
          diag += eps * cc;
        }
        // vertical neighbours
        for (const dk of [-1, 1]) {
          const nk = kf + dk;
          if (nk < 0 || nk > nz) continue;                                   // outward from a port: zero normal viscous stress
          const q = wix(c, i, j, nk);
          if (q >= 0) coo.add(r, q, -eps * cz);
          diag += eps * cz;                                                   // unknown neighbour or a Dirichlet zero (wall / closed face)
        }
        coo.add(r, r, diag);
        if (!boundary) { sym(r, pix(c, i, j, kf), dx * dy); sym(r, pix(c, i, j, kf - 1), -dx * dy); }
        else if (kf === nz) { sym(r, pix(c, i, j, nz - 1), -dx * dy); rhs[r] = -((side === 'top' ? bc[c].pTop : bc[c].pBottom) - pRef) * dx * dy; }
        else { sym(r, pix(c, i, j, 0), dx * dy); rhs[r] = ((bc[c].pBottom) - pRef) * dx * dy; }
      }
    }

    // ---- membrane faces: one unknown per open face, control volume across the two adjacent half cells
    if (!duct) {
      const RsScale = 1 / (RsRef + mu / L);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const r = mI[j * nx + i];
        if (r < 0) continue;
        const cx = dy * dz / dx, cy = dx * dz / dy, cz = dx * dy / dz;
        let diag = 0;
        for (const [di, dj, cc] of [[-1, 0, cx], [1, 0, cx], [0, -1, cy], [0, 1, cy]]) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || ni >= nx || nj < 0 || nj >= ny) { if (noslip) diag += 2 * eps * cc; continue; }
          const q = mI[nj * nx + ni];
          if (q >= 0) coo.add(r, q, -eps * cc);
          diag += eps * cc;
        }
        const above = wix(0, i, j, 1), below = wix(1, i, j, nz - 1);
        if (above >= 0) coo.add(r, above, -eps * cz); diag += eps * cz;
        if (below >= 0) coo.add(r, below, -eps * cz); diag += eps * cz;
        const RsStar = cfg.Rs[j * nx + i] * RsScale;
        diag += RsStar * dx * dy;
        coo.add(r, r, diag);
        sym(r, pix(0, i, j, 0), dx * dy); sym(r, pix(1, i, j, nz - 1), -dx * dy);
        rhs[r] = -(bc[0].pRef - bc[1].pRef) * dx * dy;
        isMem[r] = 1; memFace[r] = j * nx + i; memRs[r] = RsStar * dx * dy;
      }
    }

    const K = toCsr(coo, N);
    const diagK = new Float64Array(N);
    for (let i = 0; i < N; i++) for (let p = K.rowPtr[i]; p < K.rowPtr[i + 1]; p++) if (K.col[p] === i) diagK[i] = K.val[p];
    const vol = dx * dy * dz;
    return { N, nv, K, rhs, diagK, isMem, memFace, memRs, uI, vI, wI, pI, mI, bc, nch, duct,
      scales: { L, U, eps, mu, RsRef, dx, dy, dz, vol }, dims: { nx, ny, nz }, cfg };
  }

  /* ---------------------------------------------------------------- preconditioned MINRES (Paige–Saunders) */
  function makePreconditioner(sys, kind) {
    const N = sys.N, nv = sys.nv, inv = new Float64Array(N), eps = sys.scales.eps, vol = sys.scales.vol;
    for (let i = 0; i < nv; i++) inv[i] = 1 / sys.diagK[i];
    for (let i = nv; i < N; i++) inv[i] = eps / vol;                     // pressure: (cell volume / eps)^-1
    if (kind !== 'ssor') return { apply: (r, z) => { for (let i = 0; i < N; i++) z[i] = r[i] * inv[i]; }, kind: 'jacobi' };
    // symmetric Gauss–Seidel on the velocity block (velocity rows only couple velocities among themselves in A)
    const K = sys.K, rp = K.rowPtr, ci = K.col, va = K.val, d = sys.diagK;
    return {
      kind: 'ssor',
      apply: (r, z) => {
        for (let i = 0; i < nv; i++) {                                     // forward sweep: (D + L) y = r
          let s = r[i];
          for (let p = rp[i]; p < rp[i + 1]; p++) { const j = ci[p]; if (j < i) s -= va[p] * z[j]; }
          z[i] = s / d[i];
        }
        for (let i = 0; i < nv; i++) z[i] *= d[i];                         // D y
        for (let i = nv - 1; i >= 0; i--) {                                // backward sweep: (D + U) z = D y
          let s = z[i];
          for (let p = rp[i]; p < rp[i + 1]; p++) { const j = ci[p]; if (j > i && j < nv) s -= va[p] * z[j]; }
          z[i] = s / d[i];
        }
        for (let i = nv; i < N; i++) z[i] = r[i] * inv[i];
      },
    };
  }

  /* Generator form so a caller can interleave other work (cancellation) between blocks of iterations. */
  function* minresGen(K, b, x, M, opt) {
    const N = b.length, rtol = opt.rtol, atol = opt.atol || 0, maxit = opt.maxit, every = opt.every || 50;
    const r1 = new Float64Array(N), y = new Float64Array(N), tmp = new Float64Array(N);
    matvec(K, x, tmp);
    for (let i = 0; i < N; i++) r1[i] = b[i] - tmp[i];
    M.apply(r1, y);
    let beta1 = dot(r1, y);
    const zb = new Float64Array(N); M.apply(b, zb);
    const bnormM = Math.sqrt(Math.max(dot(b, zb), 0));
    if (beta1 < 0) throw new Error('preconditioner is not positive definite');
    beta1 = Math.sqrt(beta1);
    const info = { iterations: 0, converged: beta1 === 0 || beta1 <= atol * bnormM, beta1, bnormM, phibar: beta1, reason: '' };
    if (info.converged) { info.reason = 'initial residual below tolerance'; return info; }
    let oldb = 0, beta = beta1, dbar = 0, epsln = 0, phibar = beta1, cs = -1, sn = 0;
    const w = new Float64Array(N), w1 = new Float64Array(N), w2 = new Float64Array(N), r2 = r1.slice(), v = new Float64Array(N);
    const target = Math.max(rtol * beta1, atol * bnormM);
    for (let itn = 1; itn <= maxit; itn++) {
      const s = 1 / beta;
      for (let i = 0; i < N; i++) v[i] = s * y[i];
      matvec(K, v, y);
      if (itn >= 2) { const f = beta / oldb; for (let i = 0; i < N; i++) y[i] -= f * r1[i]; }
      const alfa = dot(v, y);
      { const f = alfa / beta; for (let i = 0; i < N; i++) y[i] -= f * r2[i]; }
      r1.set(r2); r2.set(y);
      M.apply(r2, y);
      oldb = beta;
      beta = dot(r2, y);
      if (beta < 0) throw new Error('preconditioner is not positive definite');
      beta = Math.sqrt(beta);
      const oldeps = epsln, delta = cs * dbar + sn * alfa, gbar = sn * dbar - cs * alfa;
      epsln = sn * beta; dbar = -cs * beta;
      const gamma = Math.max(Math.hypot(gbar, beta), 1e-300);
      cs = gbar / gamma; sn = beta / gamma;
      const phi = cs * phibar; phibar = sn * phibar;
      const den = 1 / gamma;
      for (let i = 0; i < N; i++) {
        const w1i = w2[i], w2i = w[i];
        const wi = (v[i] - oldeps * w1i - delta * w2i) * den;
        w1[i] = w1i; w2[i] = w2i; w[i] = wi;
        x[i] += phi * wi;
      }
      info.iterations = itn; info.phibar = phibar;
      if (phibar <= target) { info.converged = true; info.reason = 'preconditioned residual below tolerance'; return info; }
      if (itn % every === 0) yield info;
    }
    info.reason = 'iteration budget reached';
    return info;
  }

  /* MINRES stops on its preconditioned residual; the true residual ||b - Kx|| / ||b|| can lag behind it when the
     preconditioner weights rows very differently, so the solve restarts from the current iterate until the true
     residual meets trueTol (or maxRestarts is used up). */
  function trueRelResidual(sys, x) {
    const r = new Float64Array(sys.N); matvec(sys.K, x, r);
    let a = 0, b = 0; for (let i = 0; i < sys.N; i++) { const e = sys.rhs[i] - r[i]; a += e * e; b += sys.rhs[i] * sys.rhs[i]; }
    return b > 0 ? Math.sqrt(a / b) : Math.sqrt(a);
  }
  /* Generator form (yields progress between blocks of iterations, so a worker can cancel); solveSystem drives it. */
  function* solveSystemGen(sys, opt) {
    const o = Object.assign({ rtol: 1e-12, atol: 1e-15, maxit: 20000, precond: 'ssor', trueTol: 1e-10, maxRestarts: 4 }, opt || {});
    const x = o.x0 ? Float64Array.from(o.x0) : new Float64Array(sys.N);
    const M = makePreconditioner(sys, o.precond);
    let total = 0, info = null, restarts = 0, rel = Infinity;
    for (;;) {
      const g = minresGen(sys.K, sys.rhs, x, M, Object.assign({}, o, { maxit: o.maxit - total }));
      let r = g.next();
      while (!r.done) { yield { iterations: total + r.value.iterations, restarts, estimate: r.value.phibar / Math.max(r.value.beta1, 1e-300) }; r = g.next(); }
      info = r.value; total += info.iterations;
      rel = trueRelResidual(sys, x);
      if (rel <= o.trueTol || restarts >= o.maxRestarts || total >= o.maxit || info.iterations === 0) break;
      restarts++;
    }
    info.iterations = total; info.restarts = restarts; info.trueRelResidual = rel;
    info.converged = rel <= o.trueTol;
    if (!info.converged && !info.reason.startsWith('iteration')) info.reason = 'true residual above tolerance after restarts';
    return { x, info };
  }
  function drive(gen) { let r = gen.next(); while (!r.done) r = gen.next(); return r.value; }
  function solveSystem(sys, opt) { return drive(solveSystemGen(sys, opt)); }

  /* ---------------------------------------------------------------- residuals and fields */
  /* Residual norms. relTotal = ||b - Kx|| / ||b|| (dominated by the membrane rows, whose entries are largest);
     rowRel = max_i |r_i| / (sum_j |K_ij x_j| + |b_i|), which also controls the weakly weighted chamber rows. */
  function residuals(sys, x) {
    const N = sys.N, r = new Float64Array(N), K = sys.K;
    matvec(K, x, r);
    let rm = 0, rc = 0, rt = 0, bt = 0, rowRel = 0;
    for (let i = 0; i < N; i++) {
      const e = sys.rhs[i] - r[i];
      r[i] = e;
      rt += e * e; bt += sys.rhs[i] * sys.rhs[i];
      if (i < sys.nv) rm += e * e; else rc += e * e;
      let mag = Math.abs(sys.rhs[i]);
      for (let p = K.rowPtr[i]; p < K.rowPtr[i + 1]; p++) mag += Math.abs(K.val[p] * x[K.col[p]]);
      if (mag > 0) rowRel = Math.max(rowRel, Math.abs(e) / mag);
    }
    return { relTotal: bt > 0 ? Math.sqrt(rt / bt) : Math.sqrt(rt), rowRel, absMomentum: Math.sqrt(rm), absContinuity: Math.sqrt(rc), normB: Math.sqrt(bt), vector: r };
  }

  /* Physical fields and integrated quantities from a scaled solution. delta = true: x is a change of a solution
     (pressures without the port reference, no external power). */
  function fields(sys, x, delta) {
    const { nx, ny, nz } = sys.dims, S = sys.scales, cfg = sys.cfg, U = S.U, L = S.L;
    const dxp = cfg.device.dx, dyp = cfg.device.dy, Af = dxp * dyp;
    const ch = [];
    for (let c = 0; c < sys.nch; c++) {
      const u = new Float64Array((nx + 1) * ny * nz), v = new Float64Array(nx * (ny + 1) * nz), w = new Float64Array(nx * ny * (nz + 1)), p = new Float64Array(nx * ny * nz);
      for (let q = 0; q < u.length; q++) { const id = sys.uI[c][q]; u[q] = id >= 0 ? x[id] * U : 0; }
      for (let q = 0; q < v.length; q++) { const id = sys.vI[c][q]; v[q] = id >= 0 ? x[id] * U : 0; }
      for (let q = 0; q < w.length; q++) { const id = sys.wI[c][q]; w[q] = id >= 0 ? x[id] * U : 0; }
      const pr = delta ? 0 : sys.bc[c].pRef;
      for (let q = 0; q < p.length; q++) p[q] = pr + x[sys.pI[c][q]];                         // Pa (gauge, 1 Pa scale)
      ch.push({ u, v, w, p, pRef: pr });
    }
    const out = { chambers: ch, dims: { nx, ny, nz }, device: cfg.device };
    // port flows (m^3/s): inflow positive at the upper port, outflow positive at the lower port
    let Qtop = 0, Qbot = 0;
    const top = ch[0], bot = ch[sys.nch - 1];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      Qtop += -top.w[(nz * ny + j) * nx + i] * Af;
      Qbot += -bot.w[(0 * ny + j) * nx + i] * Af;
    }
    out.Qin = Qtop; out.Qout = Qbot;
    if (!sys.duct) {
      const J = new Float64Array(nx * ny), dPi = new Float64Array(nx * ny);
      let Qm = 0, Pm = 0;
      for (let c = 0; c < nx * ny; c++) {
        const id = sys.mI[c], i = c % nx, j = (c - i) / nx;
        const pf = ch[0].p[(0 * ny + j) * nx + i], pp = ch[1].p[((nz - 1) * ny + j) * nx + i];
        if (id >= 0) { J[c] = -x[id] * U; dPi[c] = cfg.Rs[c] * J[c]; Qm += J[c] * Af; Pm += Af * cfg.Rs[c] * J[c] * J[c]; }
        else { J[c] = 0; dPi[c] = pf - pp; }
      }
      out.J = J; out.dPi = dPi; out.Qmembrane = Qm; out.dissMembrane = Pm;
    }
    // viscous dissipation from the velocity block quadratic form minus the membrane resistance term (physical, W)
    const K = sys.K; let quad = 0, memq = 0;
    for (let i = 0; i < sys.nv; i++) {
      let s = 0; for (let p = K.rowPtr[i]; p < K.rowPtr[i + 1]; p++) if (K.col[p] < sys.nv) s += K.val[p] * x[K.col[p]];
      quad += x[i] * s;
      if (sys.isMem[i]) memq += sys.memRs[i] * x[i] * x[i];
    }
    // scaled quadratic form * (Pa * U * L^2) gives watts (force scale Pa*L^2, velocity scale U)
    out.dissViscous = delta ? NaN : (quad - memq) * U * L * L;
    out.powerExternal = delta ? NaN : (cfg.pFeed - cfg.pPerm) * (sys.duct ? Qtop : out.Qmembrane);
    return out;
  }

  /* Change of a solved state when membrane face resistances change (scoped changes, closures, restorations).
     The change dx = x1 - x0 solves K1 dx = d, with d assembled from the change itself rather than by differencing:
       face open in both states, Rs changed:  d_m = -dK_mm x0_m with dK_mm = dRs* dx dy (dRs passed in exactly);
       face closed in the new state:          its coupling K0[i, m] x0_m moves to the right-hand side of each row i;
       face opened in the new state:          d_m = b1_m - (K1 x0)_m (a new row).
     The baseline residual r0 is held fixed, so dx carries the solver's relative accuracy in the change itself. A
     one-tube change in a 10^10-pore membrane (1e-10 of Q) is therefore resolved, although two full solutions cannot be
     differenced to that precision. x1 = x0 + dx is the new solution; its residual is r0 plus the change residual.
     cfg1 must differ from the baseline only in Rs; the baseline scaling (RsRef) is kept. */
  function* solveChangeGen(base, cfg1, opt) {
    const o = opt || {};
    const s0 = base.sys, x0 = base.x;
    const s1 = assemble(Object.assign({}, cfg1, { RsRef: s0.cfg.RsRef }));
    const nF = s0.dims.nx * s0.dims.ny, a = s0.scales.dx * s0.scales.dy, U = s0.scales.U;
    if (s1.dims.nx !== s0.dims.nx || s1.dims.ny !== s0.dims.ny || s1.dims.nz !== s0.dims.nz || s0.duct) throw new Error('solveChange: geometry differs');
    // index of every baseline unknown in the new system (-1: removed, i.e. a membrane face closed in the new state)
    const map01 = new Int32Array(s0.N).fill(-1);
    const link = (a0, a1) => { for (let q = 0; q < a0.length; q++) if (a0[q] >= 0 && a1[q] >= 0) map01[a0[q]] = a1[q]; };
    for (let c = 0; c < s0.nch; c++) { link(s0.uI[c], s1.uI[c]); link(s0.vI[c], s1.vI[c]); link(s0.wI[c], s1.wI[c]); link(s0.pI[c], s1.pI[c]); }
    link(s0.mI, s1.mI);
    const x0m = new Float64Array(s1.N), isNew = new Uint8Array(s1.N).fill(1);
    for (let i = 0; i < s0.N; i++) { const j = map01[i]; if (j >= 0) { x0m[j] = x0[i]; isNew[j] = 0; } }
    const d = new Float64Array(s1.N), K0 = s0.K, K1 = s1.K;
    let changed = 0;
    for (let i = 0; i < s0.N; i++) {                                    // removed unknowns (K symmetric: column = row)
      if (map01[i] >= 0) continue;
      changed++;
      for (let p = K0.rowPtr[i]; p < K0.rowPtr[i + 1]; p++) {
        const r = K0.col[p]; if (r === i) continue;
        const r1 = map01[r]; if (r1 >= 0) d[r1] += K0.val[p] * x0[i];
      }
    }
    for (let c = 0; c < nF; c++) {                                      // faces open in both states
      const i0 = s0.mI[c], i1 = s1.mI[c];
      if (i0 < 0 || i1 < 0) continue;
      const dRs = o.dRs ? o.dRs[c] : cfg1.Rs[c] - s0.cfg.Rs[c];
      if (dRs !== 0) { d[i1] -= dRs * U * a * x0[i0]; changed++; }
    }
    for (let i = 0; i < s1.N; i++) {                                    // new rows (faces opened in the new state)
      if (!isNew[i]) continue;
      changed++;
      let s = s1.rhs[i];
      for (let p = K1.rowPtr[i]; p < K1.rowPtr[i + 1]; p++) s -= K1.val[p] * x0m[K1.col[p]];
      d[i] = s;
    }
    const t0 = Date.now();
    const sd = Object.assign({}, s1, { rhs: d });
    const sv = yield* solveSystemGen(sd, Object.assign({}, o.solver || {}, { x0: undefined }));
    const dx = sv.x, x1 = new Float64Array(s1.N);
    for (let i = 0; i < s1.N; i++) x1[i] = x0m[i] + dx[i];
    const residual = residuals(s1, x1), changeResidual = residuals(sd, dx);
    const f1 = fields(s1, x1), df = fields(s1, dx, true);
    // change of the face flux, including faces closed in the new state (J1 = 0, so dJ = -J0), and dQ from dJ alone
    const dPiChange = new Float64Array(nF).fill(NaN);
    let dQ = 0;
    for (let c = 0; c < nF; c++) {
      const i0 = s0.mI[c], i1 = s1.mI[c];
      if (i1 < 0 && i0 >= 0) df.J[c] = x0[i0] * U;
      else if (i1 < 0) df.J[c] = 0;
      if (i0 >= 0 && i1 >= 0) {
        const dRs = o.dRs ? o.dRs[c] : cfg1.Rs[c] - s0.cfg.Rs[c];
        dPiChange[c] = cfg1.Rs[c] * df.J[c] + dRs * (-x0[i0] * U);
      }
      dQ += df.J[c] * cfg1.device.dx * cfg1.device.dy;
    }
    df.Qmembrane = dQ; df.dPiChange = dPiChange;
    sv.info.changedRows = changed;
    return { sys: s1, x: x1, dx, info: sv.info, residual, changeResidual, fields: f1, delta: df, wallMs: Date.now() - t0, solverVersion: SOLVER_VERSION };
  }
  function solveChange(base, cfg1, opt) { return drive(solveChangeGen(base, cfg1, opt)); }

  /* Convenience: assemble, solve, check, extract (generator and synchronous forms). */
  function* solveGen(cfg, opt) {
    const sys = assemble(cfg);
    const t0 = Date.now();
    const s = yield* solveSystemGen(sys, opt);
    const res = residuals(sys, s.x);
    const f = fields(sys, s.x);
    return { sys, x: s.x, info: s.info, residual: res, fields: f, wallMs: Date.now() - t0, solverVersion: SOLVER_VERSION };
  }
  function solve(cfg, opt) { return drive(solveGen(cfg, opt)); }

  const api = { SOLVER_VERSION, assemble, makePreconditioner, minresGen, solveSystemGen, solveSystem, residuals, fields, solveGen, solve,
    solveChangeGen, solveChange, drive, matvec, toCsr, Coo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ContinuumSolver = api;
})(typeof self !== 'undefined' ? self : this);
