/* Continuum Lab — sampling the staggered (MAC) velocity field at arbitrary points of a chamber, for probes, profiles
   and streamlines. Trilinear interpolation between face values; tangential components use the no-slip ghost value
   (-u) beyond walls, ports and membrane faces, so interpolated velocities vanish there as in the solved model. */
(function (root) {
  'use strict';

  /* ch: { u, v, w } physical face arrays of one chamber; dims {nx, ny, nz}; geometry {dx, dy, dz}; walls: 'no-slip'|'free-slip' */
  function makeSampler(ch, dims, g, walls) {
    const nx = dims.nx, ny = dims.ny, nz = dims.nz, sgn = walls === 'free-slip' ? 1 : -1;
    const U = (i, j, k) => {                              // x-faces i = 0..nx
      if (i < 0 || i > nx) return 0;
      let s = 1;
      if (j < 0) { j = 0; s *= sgn; } else if (j >= ny) { j = ny - 1; s *= sgn; }
      if (k < 0) { k = 0; s *= -1; } else if (k >= nz) { k = nz - 1; s *= -1; }
      return s * ch.u[(k * ny + j) * (nx + 1) + i];
    };
    const V = (i, j, k) => {                              // y-faces j = 0..ny
      if (j < 0 || j > ny) return 0;
      let s = 1;
      if (i < 0) { i = 0; s *= sgn; } else if (i >= nx) { i = nx - 1; s *= sgn; }
      if (k < 0) { k = 0; s *= -1; } else if (k >= nz) { k = nz - 1; s *= -1; }
      return s * ch.v[(k * (ny + 1) + j) * nx + i];
    };
    const Wf = (i, j, k) => {                             // z-faces k = 0..nz
      if (k < 0 || k > nz) return 0;
      let s = 1;
      if (i < 0) { i = 0; s *= sgn; } else if (i >= nx) { i = nx - 1; s *= sgn; }
      if (j < 0) { j = 0; s *= sgn; } else if (j >= ny) { j = ny - 1; s *= sgn; }
      return s * ch.w[(k * ny + j) * nx + i];
    };
    function tri(F, fx, fy, fz) {
      const i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz), tx = fx - i0, ty = fy - j0, tz = fz - k0;
      let s = 0;
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
        const wgt = (a ? tx : 1 - tx) * (b ? ty : 1 - ty) * (c ? tz : 1 - tz);
        if (wgt) s += wgt * F(i0 + a, j0 + b, k0 + c);
      }
      return s;
    }
    /* local coordinates of the chamber: x in [0, W], y in [0, B], z in [0, H] (z = 0 at the chamber's bottom face) */
    return function sample(x, y, z, out) {
      const fx = x / g.dx, fy = y / g.dy, fz = z / g.dz;
      out = out || [0, 0, 0];
      out[0] = tri(U, fx, fy - 0.5, fz - 0.5);
      out[1] = tri(V, fx - 0.5, fy, fz - 0.5);
      out[2] = tri(Wf, fx - 0.5, fy - 0.5, fz);
      return out;
    };
  }

  /* Cell-centre speed and pressure grids of one chamber (for slices and colour maps). */
  function cellCentres(ch, dims) {
    const nx = dims.nx, ny = dims.ny, nz = dims.nz, sp = new Float64Array(nx * ny * nz), vel = new Float64Array(3 * nx * ny * nz);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = (k * ny + j) * nx + i;
      const u = 0.5 * (ch.u[(k * ny + j) * (nx + 1) + i] + ch.u[(k * ny + j) * (nx + 1) + i + 1]);
      const v = 0.5 * (ch.v[(k * (ny + 1) + j) * nx + i] + ch.v[(k * (ny + 1) + j + 1) * nx + i]);
      const w = 0.5 * (ch.w[(k * ny + j) * nx + i] + ch.w[((k + 1) * ny + j) * nx + i]);
      vel[3 * c] = u; vel[3 * c + 1] = v; vel[3 * c + 2] = w; sp[c] = Math.hypot(u, v, w);
    }
    return { speed: sp, vel };
  }

  const api = { makeSampler, cellCentres };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ContinuumSample = api;
})(typeof self !== 'undefined' ? self : this);
