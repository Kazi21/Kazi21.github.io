#!/usr/bin/env python3
"""Independent algebraic reference for the Continuum Lab solver (acceptance test S13).

Assembles the staggered (MAC) Stokes system of tools/continuum/CONTRACTS.md §5 in physical SI units, written
separately from lab/continuum/core/solver.js, and solves it with a SciPy sparse direct solver. Agreement with the
browser solver checks the assembly and the iterative solution; it is not an independent discretisation (OpenFOAM
cases in tools/continuum/openfoam/ provide that).

Usage:
  python3 reference_solver.py --case case.json --out result.json [--compare]

case.json (written by tools/continuum/tests/t_solver.js): device {nx, ny, nz, dx, dy, dz, port{i0,i1,j0,j1}}, walls,
closure, mu, Rs (per membrane face, Pa s/m; null = closed), pFeed, pPerm (Pa, gauge), and the browser solution
(Q, J, face velocities) under "browser". Exit status 1 if --compare is given and a gate of S13 fails.
"""
import argparse, json, sys, time
import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla


def assemble(case):
    d = case['device']; nx, ny, nz = d['nx'], d['ny'], d['nz']
    dx, dy, dz = d['dx'], d['dy'], d['dz']; mu = case['mu']
    port = d['port']; noslip = case['walls'] != 'free-slip'; cont = case['closure'] == 'continuous-tangential'
    Rs = [None if r is None else float(r) for r in case['Rs']]
    isopen = lambda i, j: Rs[j * nx + i] is not None
    in_port = lambda i, j: port['i0'] <= i < port['i1'] and port['j0'] <= j < port['j1']
    # chamber 0 = feed (top port at pFeed, bottom membrane); chamber 1 = permeate (bottom port at pPerm, top membrane)
    pref = [case['pFeed'], case['pPerm']]
    idx = {}
    def new(key):
        idx[key] = len(idx); return idx[key]
    # unknowns: ('u',c,i,j,k) i=1..nx-1; ('v',c,i,j,k) j=1..ny-1; ('w',c,i,j,kf) interior and port faces; ('m',i,j); ('p',c,i,j,k)
    for c in (0, 1):
        for k in range(nz):
            for j in range(ny):
                for i in range(1, nx): new(('u', c, i, j, k))
            for j in range(1, ny):
                for i in range(nx): new(('v', c, i, j, k))
        for kf in range(nz + 1):
            for j in range(ny):
                for i in range(nx):
                    if 0 < kf < nz: new(('w', c, i, j, kf))
                    elif (c == 0 and kf == nz and in_port(i, j)) or (c == 1 and kf == 0 and in_port(i, j)): new(('w', c, i, j, kf))
    for j in range(ny):
        for i in range(nx):
            if isopen(i, j): new(('m', i, j))
    nvel = len(idx)
    for c in (0, 1):
        for k in range(nz):
            for j in range(ny):
                for i in range(nx): new(('p', c, i, j, k))
    N = len(idx)

    def wkey(c, i, j, kf):
        """Key of the unknown at z-face kf of chamber c, or None for a wall / closed face (w = 0)."""
        if (c == 0 and kf == 0) or (c == 1 and kf == nz):
            return ('m', i, j) if isopen(i, j) else None
        k = ('w', c, i, j, kf)
        return k if k in idx else None

    rows, cols, vals = [], [], []
    b = np.zeros(N)
    def add(r, c, v):
        rows.append(idx[r]); cols.append(idx[c]); vals.append(v)

    def lap(rkey, terms):
        """terms: list of (neighbour key or None for a Dirichlet zero / 'ghost2' / 'free', coefficient mu*a/d)."""
        diag = 0.0
        for nb, cf in terms:
            if nb == 'ghost2': diag += 2 * cf
            elif nb == 'free': pass
            elif nb is None: diag += cf
            else: add(rkey, nb, -cf); diag += cf
        add(rkey, rkey, diag)

    def tang_boundary(c, side, comp, i, j):
        """Neighbour across a top or bottom boundary for a tangential velocity."""
        t = ('port' if side == 'top' else 'membrane') if c == 0 else ('membrane' if side == 'top' else 'port')
        if t == 'port': return 'ghost2'
        if not cont: return 'ghost2'
        cells = [(i - 1, j), (i, j)] if comp == 'u' else [(i, j - 1), (i, j)]
        if not all(0 <= a < nx and 0 <= bb < ny and isopen(a, bb) for a, bb in cells): return 'ghost2'
        oc, ok = (1, nz - 1) if c == 0 else (0, 0)
        return (comp, oc, i, j, ok)

    for c in (0, 1):
        for k in range(nz):
            for j in range(ny):
                for i in range(1, nx):
                    r = ('u', c, i, j, k); ax, ay, az = mu * dy * dz / dx, mu * dx * dz / dy, mu * dx * dy / dz
                    t = []
                    for ni in (i - 1, i + 1): t.append(((('u', c, ni, j, k)) if 1 <= ni <= nx - 1 else None, ax))
                    for nj in (j - 1, j + 1): t.append((('u', c, i, nj, k) if 0 <= nj < ny else ('ghost2' if noslip else 'free'), ay))
                    for nk in (k - 1, k + 1):
                        t.append((('u', c, i, j, nk) if 0 <= nk < nz else tang_boundary(c, 'bottom' if nk < 0 else 'top', 'u', i, j), az))
                    lap(r, t)
                    add(r, ('p', c, i, j, k), dy * dz); add(('p', c, i, j, k), r, dy * dz)
                    add(r, ('p', c, i - 1, j, k), -dy * dz); add(('p', c, i - 1, j, k), r, -dy * dz)
            for j in range(1, ny):
                for i in range(nx):
                    r = ('v', c, i, j, k); ax, ay, az = mu * dy * dz / dx, mu * dx * dz / dy, mu * dx * dy / dz
                    t = []
                    for nj in (j - 1, j + 1): t.append((('v', c, i, nj, k) if 1 <= nj <= ny - 1 else None, ay))
                    for ni in (i - 1, i + 1): t.append((('v', c, ni, j, k) if 0 <= ni < nx else ('ghost2' if noslip else 'free'), ax))
                    for nk in (k - 1, k + 1):
                        t.append((('v', c, i, j, nk) if 0 <= nk < nz else tang_boundary(c, 'bottom' if nk < 0 else 'top', 'v', i, j), az))
                    lap(r, t)
                    add(r, ('p', c, i, j, k), dx * dz); add(('p', c, i, j, k), r, dx * dz)
                    add(r, ('p', c, i, j - 1, k), -dx * dz); add(('p', c, i, j - 1, k), r, -dx * dz)
        for kf in range(nz + 1):
            for j in range(ny):
                for i in range(nx):
                    r = ('w', c, i, j, kf)
                    if r not in idx: continue
                    bnd = kf in (0, nz); h = 0.5 if bnd else 1.0
                    ax, ay, az = mu * dy * dz * h / dx, mu * dx * dz * h / dy, mu * dx * dy / dz
                    t = []
                    for ni, nj, a in ((i - 1, j, ax), (i + 1, j, ax), (i, j - 1, ay), (i, j + 1, ay)):
                        if not (0 <= ni < nx and 0 <= nj < ny): t.append(('ghost2' if noslip else 'free', a))
                        else: t.append((wkey(c, ni, nj, kf), a))
                    for nk in (kf - 1, kf + 1):
                        if 0 <= nk <= nz: t.append((wkey(c, i, j, nk), az))
                    lap(r, t)
                    if not bnd:
                        add(r, ('p', c, i, j, kf), dx * dy); add(('p', c, i, j, kf), r, dx * dy)
                        add(r, ('p', c, i, j, kf - 1), -dx * dy); add(('p', c, i, j, kf - 1), r, -dx * dy)
                    elif kf == nz:      # feed top port: (p_cell - p_port) A on the half volume
                        add(r, ('p', c, i, j, nz - 1), -dx * dy); add(('p', c, i, j, nz - 1), r, -dx * dy)
                        b[idx[r]] = -(case['pFeed'] - pref[c]) * dx * dy
                    else:               # permeate bottom port
                        add(r, ('p', c, i, j, 0), dx * dy); add(('p', c, i, j, 0), r, dx * dy)
                        b[idx[r]] = (case['pPerm'] - pref[c]) * dx * dy
    for j in range(ny):
        for i in range(nx):
            if not isopen(i, j): continue
            r = ('m', i, j); ax, ay, az = mu * dy * dz / dx, mu * dx * dz / dy, mu * dx * dy / dz
            t = []
            for ni, nj, a in ((i - 1, j, ax), (i + 1, j, ax), (i, j - 1, ay), (i, j + 1, ay)):
                if not (0 <= ni < nx and 0 <= nj < ny): t.append(('ghost2' if noslip else 'free', a))
                else: t.append((('m', ni, nj) if isopen(ni, nj) else None, a))
            t.append((wkey(0, i, j, 1), az)); t.append((wkey(1, i, j, nz - 1), az))
            lap(r, t)
            add(r, r, Rs[j * nx + i] * dx * dy)
            add(r, ('p', 0, i, j, 0), dx * dy); add(('p', 0, i, j, 0), r, dx * dy)
            add(r, ('p', 1, i, j, nz - 1), -dx * dy); add(('p', 1, i, j, nz - 1), r, -dx * dy)
            b[idx[r]] = -(pref[0] - pref[1]) * dx * dy
    K = sp.csr_matrix((vals, (rows, cols)), shape=(N, N))
    return K, b, idx, nvel, pref


def solve(case):
    """Direct solve with symmetric diagonal equilibration and iterative refinement. In SI units the matrix mixes
    entries from ~1e-14 (areas) to ~1e-3 (membrane resistance x area); an unscaled LU solve then leaves row-relative
    residuals near 1e-3 in the chamber rows although the 2-norm residual is ~1e-15, so the system is scaled first."""
    t0 = time.time()
    K, b, idx, nvel, pref = assemble(case)
    asym = abs(K - K.T).max() / abs(K).max()
    dg = np.abs(K.diagonal())
    rowmax = np.asarray(abs(K).max(axis=1).todense()).ravel()
    s = np.where(dg > 0, 1 / np.sqrt(np.where(dg > 0, dg, 1)), 1 / np.sqrt(np.where(rowmax > 0, rowmax, 1)))
    Sd = sp.diags(s)
    Ks = (Sd @ K @ Sd).tocsc()
    lu = spla.splu(Ks)
    y = lu.solve(s * b)
    for _ in range(3):                                   # iterative refinement on the scaled system
        y = y + lu.solve(s * b - Ks @ y)
    x = s * y
    d = case['device']; nx, ny, nz = d['nx'], d['ny'], d['nz']; A = d['dx'] * d['dy']
    J = np.zeros(nx * ny)
    for j in range(ny):
        for i in range(nx):
            k = ('m', i, j)
            J[j * nx + i] = -x[idx[k]] if k in idx else 0.0
    Qin = sum(-x[idx[('w', 0, i, j, nz)]] * A for j in range(ny) for i in range(nx) if ('w', 0, i, j, nz) in idx)
    Qout = sum(-x[idx[('w', 1, i, j, 0)]] * A for j in range(ny) for i in range(nx) if ('w', 1, i, j, 0) in idx)
    vel = {}
    for k, v in idx.items():
        if k[0] in ('u', 'v', 'w', 'm'): vel[k] = x[v]
    r = b - K @ x
    res = np.linalg.norm(r) / max(np.linalg.norm(b), 1e-300)
    mag = abs(K) @ np.abs(x) + np.abs(b)
    rowrel = float(np.max(np.abs(r) / np.maximum(mag, 1e-300)))
    return {'N': int(K.shape[0]), 'asymmetry': float(asym), 'Q': float(J.sum() * A), 'Qin': float(Qin), 'Qout': float(Qout),
            'J': J.tolist(), 'relResidual': float(res), 'rowRelResidual': rowrel, 'seconds': time.time() - t0, '_vel': vel}


def compare(case, ref):
    br = case['browser']
    qerr = abs(ref['Q'] - br['Q']) / abs(ref['Q']) if ref['Q'] != 0 else abs(br['Q'])
    # velocities: browser exports u,v,w per chamber on the full face arrays plus J
    d = case['device']; nx, ny, nz = d['nx'], d['ny'], d['nz']
    vmax, dmax = 0.0, 0.0
    for (key, val) in ref['_vel'].items():
        t = key[0]
        if t == 'm':
            bv = -br['J'][key[2] * nx + key[1]]
        elif t == 'u':
            c, i, j, k = key[1:]; bv = br['chambers'][c]['u'][(k * ny + j) * (nx + 1) + i]
        elif t == 'v':
            c, i, j, k = key[1:]; bv = br['chambers'][c]['v'][(k * (ny + 1) + j) * nx + i]
        else:
            c, i, j, kf = key[1:]; bv = br['chambers'][c]['w'][(kf * ny + j) * nx + i]
        vmax = max(vmax, abs(val)); dmax = max(dmax, abs(val - bv))
    vrel = float(dmax / vmax if vmax > 0 else dmax)
    return {'Q_rel_diff': float(qerr), 'max_vel_diff_rel': vrel, 'pass': bool(qerr <= 1e-8 and vrel <= 1e-6)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--case', required=True, help='case JSON written by t_solver.js (SI units)')
    ap.add_argument('--out', required=True, help='result JSON')
    ap.add_argument('--compare', action='store_true', help='compare with the browser solution stored in the case; exit 1 on failure')
    a = ap.parse_args()
    case = json.load(open(a.case))
    ref = solve(case)
    out = {k: v for k, v in ref.items() if not k.startswith('_')}
    ok = True
    if a.compare:
        out['comparison'] = compare(case, ref); ok = out['comparison']['pass']
    json.dump(out, open(a.out, 'w'), indent=1)
    print(json.dumps({k: out[k] for k in ('N', 'asymmetry', 'Q', 'relResidual', 'rowRelResidual', 'seconds')}), json.dumps(out.get('comparison', {})))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
