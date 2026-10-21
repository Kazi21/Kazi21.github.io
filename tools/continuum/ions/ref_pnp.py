#!/usr/bin/env python3
"""Independent reference for the ion experiment (criterion I8 in tools/continuum/ions/TOLERANCES.md).

Solves the steady, area-averaged Poisson-Nernst-Planck equations of the ion experiment (without electro-osmosis and
without the finite-size term) as a two-point boundary-value problem with SciPy's collocation solver solve_bvp. No code
is shared with lab/continuum/ions/core.js: this program reads only physical parameters (numbers) from a JSON file
written by the Node test, builds its own mesh and its own initial guess, and integrates the continuous equations

    dphi/dx = Phi / (lam2 A),          dPhi/dx = -A (sum_i z_i c_i + q_fix(x)),
    dc_i/dx = -J_i / (D_i(x) A) - c_i (z_i dphi/dx + dmu_i/dx),

with the species fluxes J_i as unknown parameters and Dirichlet conditions (phi, c_i) at both reservoirs. Units:
length 1 nm, concentration 1 M, potential RT/F, diffusivity 1e-9 m^2/s.

Usage: python3 ref_pnp.py cases.json out.json
"""
import json
import math
import sys
import time

import numpy as np
from scipy.integrate import solve_bvp

F, R, NA, EPS0 = 96485.33212, 8.314462618, 6.02214076e23, 8.8541878128e-12
_trapz = getattr(np, "trapezoid", None) or getattr(np, "trapz")


def tanh_step(x, x0, d):
    return 0.5 * (1.0 + np.tanh((x - x0) / d))


def dtanh_step(x, x0, d):
    t = np.tanh((x - x0) / d)
    return 0.5 * (1.0 - t * t) / d


class Case:
    def __init__(self, c):
        self.c = c
        T = c['T']
        self.VT = R * T / F
        self.lam2 = EPS0 * c['epsR'] * self.VT / (F * 1000.0 * 1e-18)
        self.a = c['a_nm']
        self.L = c['L_nm']
        self.half = self.L / 2.0
        self.alpha = c['cone_slope']
        self.smax = c['smax_nm']
        self.x0, self.x1 = -(self.half + self.smax), self.half + self.smax
        self.z = np.array([1.0, -1.0])
        self.D = np.array([c['D_Na'], c['D_Cl']]) / 1e-9
        self.cb = c['c_res_M']
        self.v = c['V'] / self.VT
        self.dG = np.array(c.get('dG_RT', [0.0, 0.0]))
        self.dmu = c.get('profile_width_nm', 0.15)
        self.Dratio = np.array(c.get('Dratio', [1.0, 1.0]))
        self.rim = c.get('rim')
        self.scale = 1.0                                      # continuation factor on fixed charge and excess energy
        if self.rim:
            # normalisation of each rim window: integral of w(x) A(x) dx (fine trapezoid; independent of the mesh)
            xs = np.linspace(-self.half - 3.0, self.half + 3.0, 600001)
            self.rim_norm = []
            for m in (-self.half, self.half):
                w = self.window(xs, m)
                self.rim_norm.append(_trapz(w * self.area(xs), xs))

    def radius(self, x):
        d = np.abs(x) - self.half
        return np.where(d > 0, self.a + self.alpha * d, self.a)

    def area(self, x):
        r = self.radius(x)
        return math.pi * r * r

    def inside(self, x):
        return tanh_step(x, -self.half, self.dmu) - tanh_step(x, self.half, self.dmu)

    def dinside(self, x):
        return dtanh_step(x, -self.half, self.dmu) - dtanh_step(x, self.half, self.dmu)

    def window(self, x, m):
        w, d = self.rim['w_nm'], self.rim['edge_nm']
        return tanh_step(x, m - w / 2, d) - tanh_step(x, m + w / 2, d)

    def qfix(self, x):
        if not self.rim:
            return np.zeros_like(x)
        unit = 1.0 / (NA * 1000.0 * 1e-27)                    # one elementary charge in units of F c0 nm^3
        q = np.zeros_like(x)
        for m, nrm in zip((-self.half, self.half), self.rim_norm):
            q += -self.rim['n'] * unit * self.window(x, m) / nrm
        return self.scale * q

    def Dx(self, x, i):
        return self.D[i] * (1.0 - self.inside(x) * (1.0 - self.Dratio[i]))

    def fun(self, x, y, p):
        A = self.area(x)
        phi_x = y[1] / (self.lam2 * A)
        rho = self.z[0] * y[2] + self.z[1] * y[3] + self.qfix(x)
        out = np.empty_like(y)
        out[0] = phi_x
        out[1] = -A * rho
        for i in range(2):
            mu_x = self.scale * self.dG[i] * self.dinside(x)
            out[2 + i] = -p[i] / (self.Dx(x, i) * A) - y[2 + i] * (self.z[i] * phi_x + mu_x)
        return out

    def bc(self, ya, yb, p):
        return np.array([ya[0] - self.v, yb[0], ya[2] - self.cb, ya[3] - self.cb, yb[2] - self.cb, yb[3] - self.cb])

    def mesh(self):
        # own mesh: uniform 0.02 nm in the pore and within 1 nm of each mouth, geometric growth (1.15) outside
        inner = np.arange(-self.half - 1.0, self.half + 1.0 + 1e-9, 0.02)
        out, s, h = [], 1.0, 0.02
        while s < self.smax:
            h *= 1.15
            s = min(self.smax, s + h)
            out.append(s)
        right = self.half + np.array(out)
        x = np.concatenate([-right[::-1], inner, right])
        x[0], x[-1] = self.x0, self.x1
        return np.unique(x)

    def guess(self, x):
        # Ohmic guess: potential divided in proportion to the resistance integral, uniform concentrations
        A = self.area(x)
        rint = np.concatenate([[0.0], np.cumsum(0.5 * (1 / A[1:] + 1 / A[:-1]) * np.diff(x))])
        frac = rint / rint[-1]
        phi = self.v * (1.0 - frac)
        y = np.zeros((4, x.size))
        y[0] = phi
        y[1] = self.lam2 * A * np.gradient(phi, x)
        y[2] = self.cb
        y[3] = self.cb
        G = self.cb / rint[-1]
        p = np.array([self.D[0] * G * self.v, -self.D[1] * G * self.v])
        return y, p


def solve_case(c, tol=1e-7):
    k = Case(c)
    x = k.mesh()
    y, p = k.guess(x)
    sol = None
    steps = [0.0, 0.1, 0.25, 0.45, 0.7, 1.0] if (k.rim or np.any(k.dG != 0)) else [1.0]
    for s in steps:
        k.scale = s
        sol = solve_bvp(k.fun, k.bc, x, y, p=p, tol=tol, max_nodes=400000, verbose=0)
        if not sol.success:
            raise RuntimeError('solve_bvp failed at continuation %.2f: %s' % (s, sol.message))
        x, y, p = sol.x, sol.y, sol.p
    J = sol.p * 1e-9 * 1e-9 * 1000.0                          # mol/s
    I = F * (J[0] - J[1])
    return {'J_Na': J[0], 'J_Cl': J[1], 'I': I, 'I_Na': F * J[0], 'I_Cl': -F * J[1], 'nodes': int(sol.x.size),
            'max_rms_residual': float(np.max(sol.rms_residuals)), 'message': sol.message}


def main():
    cases = json.load(open(sys.argv[1]))
    out = {'program': 'tools/continuum/ions/ref_pnp.py', 'method': 'scipy.integrate.solve_bvp (collocation), tol 1e-7',
           'numpy': np.__version__, 'results': []}
    import scipy
    out['scipy'] = scipy.__version__
    for c in cases:
        t0 = time.time()
        r = solve_case(c)
        r['id'] = c['id']
        r['seconds'] = round(time.time() - t0, 2)
        out['results'].append(r)
        print(c['id'], 'I = %.6e A' % r['I'], 'I_Na = %.6e' % r['I_Na'], 'I_Cl = %.6e' % r['I_Cl'], 'nodes', r['nodes'], '%.1f s' % r['seconds'])
    json.dump(out, open(sys.argv[2], 'w'), indent=1)


if __name__ == '__main__':
    main()
