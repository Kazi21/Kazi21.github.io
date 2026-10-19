#!/usr/bin/env python3
"""Compare the browser CFD solver with native OpenFOAM v1912 on the same physical cases (TOLERANCES.md F1-F4).

Reads the OpenFOAM cases (latest time: U and phi on the outlet and on the membrane baffles; cell centres from
constant/polyMesh) and the browser results written by browser_cases.js. The two grids are identical, so cells are
matched by their centres and no interpolation is needed; differences are discretisation differences between the
staggered (MAC) browser scheme and OpenFOAM's collocated finite volumes, plus solver tolerances.

Metrics (SI): Q = outlet volume flow (OpenFOAM: sum of phi on the outlet patch, m^3/s);
normalised L2 = sqrt(sum |u_b - u_f|^2 / sum |u_f|^2) over all cells (F1: the mid-length cell layer).
Gates (frozen in TOLERANCES.md): F1-F3 Q within 2 % and L2 within 5 %; F4 Q within 2 %.
Exit status 1 if any gate fails or a case is missing (NOT_RUN counts as a failure of the required comparison).

Usage: python3 compare_openfoam.py [--cases DIR] [--browser DIR] [--out FILE] [--q-gate 0.02] [--l2-gate 0.05]
"""
import argparse, json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def latest_time(case):
    ts = []
    for d in os.listdir(case):
        try:
            v = float(d)
        except ValueError:
            continue
        if v > 0 and os.path.isdir(os.path.join(case, d)):
            ts.append((v, d))
    if not ts:
        raise FileNotFoundError('no solution time directory in ' + case)
    return sorted(ts)[-1][1]


def read_internal(path):
    """internalField of an ASCII OpenFOAM field: list of floats or of 3-tuples."""
    txt = open(path).read()
    m = re.search(r'internalField\s+nonuniform\s+List<(scalar|vector)>\s*(\d+)\s*\(', txt)
    if not m:
        raise ValueError('nonuniform internalField not found in ' + path)
    kind, n = m.group(1), int(m.group(2))
    body = txt[m.end():]
    if kind == 'vector':
        vals = re.findall(r'\(\s*([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s*\)', body[: body.index('\n)\n') + 2] if '\n)\n' in body else body)
        vals = [tuple(map(float, v)) for v in vals[:n]]
    else:
        end = body.index(')')
        vals = list(map(float, body[:end].split()))[:n]
    if len(vals) != n:
        raise ValueError(f'expected {n} values in {path}, read {len(vals)}')
    return vals


def _list_block(txt, start):
    """Parse an OpenFOAM ASCII list beginning at index start (count then parenthesised items)."""
    m = re.compile(r'(\d+)\s*\(').search(txt, start)
    n, i = int(m.group(1)), m.end()
    return n, i


def cell_centres(case):
    """Cell centres from constant/polyMesh (average of each cell's vertices; exact for the hexahedral grids here)."""
    pm = os.path.join(case, 'constant', 'polyMesh')
    def body(name):
        t = open(os.path.join(pm, name)).read()
        return t[t.index('FoamFile'):].split('}', 1)[1]
    t = body('points'); n, i = _list_block(t, 0)
    pts = [tuple(map(float, v)) for v in re.findall(r'\(\s*([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s*\)', t[i:])[:n]]
    t = body('faces'); n, i = _list_block(t, 0)
    faces = [list(map(int, f.split())) for f in re.findall(r'\d+\(([\d\s]+)\)', t[i:])[:n]]
    def labels(name):
        t = body(name); n, i = _list_block(t, 0)
        return list(map(int, t[i:t.index(')', i)].split()))[:n]
    own, nei = labels('owner'), labels('neighbour')
    ncell = max(own) + 1
    cp = [set() for _ in range(ncell)]
    for f, c in enumerate(own):
        cp[c].update(faces[f])
    for f, c in enumerate(nei):
        cp[c].update(faces[f])
    out = []
    for s in cp:
        x = y = z = 0.0
        for p in s:
            x += pts[p][0]; y += pts[p][1]; z += pts[p][2]
        k = len(s); out.append((x / k, y / k, z / k))
    return out


def read_patch_values(path, patch):
    """value list of one patch in the boundaryField of an ASCII field (scalars), or None."""
    txt = open(path).read()
    i = txt.find('boundaryField')
    m = re.search(r'\n\s*' + re.escape(patch) + r'\s*\n\s*\{', txt[i:])
    if not m:
        return None
    sub = txt[i + m.end():]
    sub = sub[: sub.index('}')]
    mv = re.search(r'value\s+nonuniform\s+List<scalar>\s*(\d+)\s*\(([^)]*)\)', sub)
    if mv:
        return list(map(float, mv.group(2).split()))
    mu = re.search(r'value\s+uniform\s+([-+0-9.eE]+)', sub)
    return [float(mu.group(1))] if mu else None


def final_residuals(case):
    log = os.path.join(case, 'log.simpleFoam')
    if not os.path.exists(log):
        return None
    last, it = {}, None
    for line in open(log):
        if line.startswith('Time = '):
            it = int(float(line.split()[2]))
        m = re.search(r'Solving for (\w+), Initial residual = ([-+0-9.eE]+)', line)
        if m:
            last[m.group(1)] = float(m.group(2))
    return {'iterations': it, 'initialResiduals': last}


def compare(name, case, bfile, qgate, l2gate, layer=None):
    b = json.load(open(bfile))
    t = latest_time(case)
    U = read_internal(os.path.join(case, t, 'U'))
    C = cell_centres(case)
    phi_out = read_patch_values(os.path.join(case, t, 'phi'), 'outlet')
    Qf = sum(phi_out)           # phi is positive for outflow (outward patch normal)
    g = b['grid']
    idx = {}
    for n, (x, y, z) in enumerate(C):
        i, j, k = int(math.floor(x / g['dx'])), int(math.floor(y / g['dy'])), int(math.floor((z + g['H']) / g['dz']))
        idx[(i, j, k)] = n
    num = den = 0.0
    used = 0
    nzt = g['nz'] * (2 if g['H'] > 0 else 1)
    for cell in b['cells']:
        x, y, z, u, v, w_ = cell
        i, j, k = int(math.floor(x / g['dx'])), int(math.floor(y / g['dy'])), int(math.floor((z + g['H']) / g['dz']))
        if layer is not None and k != layer:
            continue
        n = idx.get((i, j, k))
        if n is None:
            raise ValueError(f'cell {(i, j, k)} not found in the OpenFOAM mesh')
        uf = U[n]
        num += (u - uf[0]) ** 2 + (v - uf[1]) ** 2 + (w_ - uf[2]) ** 2
        den += uf[0] ** 2 + uf[1] ** 2 + uf[2] ** 2
        used += 1
    l2 = math.sqrt(num / den) if den > 0 else float('nan')
    Qb = b['Q_m3_s']
    qrel = abs(Qb - Qf) / abs(Qf)
    out = {'name': name, 'Q_browser_m3_s': Qb, 'Q_openfoam_m3_s': Qf, 'Q_rel_diff': qrel, 'velocity_L2': l2, 'cells_compared': used,
           'openfoam': final_residuals(case), 'browser': {'iterations': b['iterations'], 'relResidual': b['relResidual'], 'unknowns': b['unknowns'], 'closure': b['closure']},
           'time': t, 'interpolation': 'none (identical grids, cells matched by centre)'}
    # membrane face flux comparison (device cases): OpenFOAM phi on the master baffle patches vs browser J A
    if b.get('J_m_s'):
        area = g['dx'] * g['dy']
        flux_f = 0.0
        for patch in ('open_master', 'openA_master', 'openB_master'):
            vals = read_patch_values(os.path.join(case, t, 'phi'), patch)
            if vals:
                flux_f += abs(sum(vals))
        out['membrane_flow_openfoam_m3_s'] = flux_f
        out['membrane_flow_browser_m3_s'] = sum(b['J_m_s']) * area
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--cases', default=os.path.join(HERE, 'cases'), help='OpenFOAM case directory (default ./cases)')
    ap.add_argument('--browser', default=os.path.join(HERE, '..', 'results', 'openfoam_browser'), help='browser results (default ../results/openfoam_browser)')
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'results', 'openfoam.json'), help='output JSON (default ../results/openfoam.json)')
    ap.add_argument('--q-gate', type=float, default=0.02, help='relative Q gate (default 0.02)')
    ap.add_argument('--l2-gate', type=float, default=0.05, help='normalised velocity L2 gate (default 0.05)')
    a = ap.parse_args()
    items, ok_all = [], True
    spec = [('F1', 'F1_duct', 'Developed duct', True), ('F2', 'F2_uniform', 'Uniform resistance interface (porousBafflePressure)', True),
            ('F3', 'F3_strip', 'Closed strip', True), ('F4', 'F4_strip_fine', 'Refined mesh', False)]
    res = {}
    for fid, cname, title, l2req in spec:
        case, bfile = os.path.join(a.cases, cname), os.path.join(a.browser, cname + '.json')
        try:
            layer = None
            if fid == 'F1':
                g = json.load(open(bfile))['grid']; layer = g['nz'] // 2
            r = compare(cname, case, bfile, a.q_gate, a.l2_gate, layer)
        except Exception as e:  # missing case or result: not run
            items.append({'id': fid, 'name': title, 'verdict': 'NOT_RUN', 'detail': 'not run: ' + str(e)})
            ok_all = False
            continue
        res[fid] = r
        ok = r['Q_rel_diff'] <= a.q_gate and (not l2req or r['velocity_L2'] <= a.l2_gate)
        det = f"Q browser {r['Q_browser_m3_s']:.6e} vs OpenFOAM {r['Q_openfoam_m3_s']:.6e} m^3/s (difference {100 * r['Q_rel_diff']:.3f} %); velocity normalised L2 {100 * r['velocity_L2']:.3f} %" + (' (mid-length layer)' if fid == 'F1' else ' (all cells)')
        if 'membrane_flow_openfoam_m3_s' in r:
            det += f"; membrane flow {r['membrane_flow_browser_m3_s']:.6e} vs {r['membrane_flow_openfoam_m3_s']:.6e} m^3/s"
        of = r['openfoam'] or {}
        det += f"; OpenFOAM {of.get('iterations')} SIMPLE iterations, final initial residual p {of.get('initialResiduals', {}).get('p', float('nan')):.1e}"
        if fid == 'F4' and 'F3' in res:
            det += f"; mesh change 20 to 40 cells: browser Q {100 * abs(r['Q_browser_m3_s'] / res['F3']['Q_browser_m3_s'] - 1):.3f} %, OpenFOAM Q {100 * abs(r['Q_openfoam_m3_s'] / res['F3']['Q_openfoam_m3_s'] - 1):.3f} %; velocity L2 {100 * r['velocity_L2']:.3f} % (reported)"
        items.append({'id': fid, 'name': title, 'verdict': 'PASS' if ok else 'FAIL', 'detail': det, 'data': r})
        ok_all = ok_all and ok
        print(('PASS ' if ok else 'FAIL ') + fid + ' ' + title + ': ' + det)
    # reported only (not a gate): the closed-strip case on 20, 40 and 80 cells in both codes, with the observed order
    # and a Richardson extrapolation of Q from the three levels (assumes the asymptotic range)
    conv = []
    for N, cname in ((20, 'F3_strip'), (40, 'F4_strip_fine'), (80, 'F5_strip_80')):
        try:
            r = res.get({20: 'F3', 40: 'F4'}.get(N)) or compare(cname, os.path.join(a.cases, cname), os.path.join(a.browser, cname + '.json'), a.q_gate, a.l2_gate)
            conv.append({'N': N, 'Q_browser': r['Q_browser_m3_s'], 'Q_openfoam': r['Q_openfoam_m3_s'], 'Q_rel_diff': r['Q_rel_diff'], 'velocity_L2': r['velocity_L2'],
                         'openfoam_iterations': (r['openfoam'] or {}).get('iterations'),
                         'openfoam_final_initial_residuals': (r['openfoam'] or {}).get('initialResiduals'),
                         'browser_iterations': r['browser']['iterations'], 'browser_relResidual': r['browser']['relResidual']})
        except Exception as e:
            conv.append({'N': N, 'error': str(e)})
    extra = {}
    if all('Q_browser' in c for c in conv):
        for code in ('browser', 'openfoam'):
            q20, q40, q80 = (c['Q_' + code] for c in conv)
            ratio = (q20 - q40) / (q40 - q80) if q40 != q80 else float('nan')
            order = math.log(ratio, 2) if ratio > 0 else float('nan')
            qinf = q80 + (q80 - q40) / (2 ** order - 1) if math.isfinite(order) and order > 0 else float('nan')
            # grid convergence index of the finest level (Roache; three grids, safety factor 1.25), relative to Q80
            gci = 1.25 * abs((q80 - q40) / q80) / (2 ** order - 1) if math.isfinite(order) and order > 0 else float('nan')
            extra[code] = {'observed_order': order, 'Q_extrapolated_m3_s': qinf, 'gci_fine': gci}
        if all(math.isfinite(extra[k]['Q_extrapolated_m3_s']) for k in extra):
            extra['extrapolated_rel_diff'] = abs(extra['browser']['Q_extrapolated_m3_s'] - extra['openfoam']['Q_extrapolated_m3_s']) / abs(extra['openfoam']['Q_extrapolated_m3_s'])
        # what the study can say: the codes' difference on the finest grid against their discretisation uncertainties
        d80, gb, gf = conv[-1]['Q_rel_diff'], extra['browser']['gci_fine'], extra['openfoam']['gci_fine']
        if not (math.isfinite(gb) and math.isfinite(gf)):
            st = 'no observed order for both codes; no uncertainty estimate'
        elif d80 <= gb + gf and max(gb, gf) > 0.02:
            st = ('inconclusive at these resolutions — the codes differ by %.2f %% on the 80-cell grid, within their estimated discretisation uncertainties '
                  '(grid convergence index %.1f %% browser, %.1f %% OpenFOAM), but these are far larger than the 2 %% the comparison needs' % (100 * d80, 100 * gb, 100 * gf))
        elif d80 <= gb + gf:
            st = 'agreement within the estimated discretisation uncertainties (difference %.2f %%; GCI %.2f %% and %.2f %%)' % (100 * d80, 100 * gb, 100 * gf)
        else:
            st = ('the codes differ by %.2f %% on the 80-cell grid, more than their estimated discretisation uncertainties (GCI %.2f %% and %.2f %%): '
                  'a difference in the continuum problems solved, not only discretisation' % (100 * d80, 100 * gb, 100 * gf))
        l2 = [c['velocity_L2'] for c in conv]
        st += ('; the velocity-field difference between the codes decreases with refinement (%s)' if all(x > y for x, y in zip(l2, l2[1:]))
               else '; the velocity-field difference between the codes does not decrease monotonically (%s)') % ', '.join('%.2f %%' % (100 * x) for x in l2)
        extra['statement'] = st
        last = conv[-1]
        print('convergence (reported): ' + '; '.join('%d cells: browser %.6e, OpenFOAM %.6e (%.3f %%, L2 %.2f %%)' % (c['N'], c['Q_browser'], c['Q_openfoam'], 100 * c['Q_rel_diff'], 100 * c['velocity_L2']) for c in conv) +
              '; observed order browser %.2f, OpenFOAM %.2f; extrapolated Q %.6e vs %.6e (%.2f %%); %s' % (extra['browser']['observed_order'], extra['openfoam']['observed_order'],
              extra['browser']['Q_extrapolated_m3_s'], extra['openfoam']['Q_extrapolated_m3_s'], 100 * extra.get('extrapolated_rel_diff', float('nan')), extra['statement']))
    out_conv = {'levels': conv, 'analysis': extra, 'note': 'reported only, not a gate (added after F2-F4 were evaluated): closed-strip case at 20, 40 and 80 cells across W; observed order, Richardson extrapolation and grid convergence index (Roache, safety factor 1.25) from the three levels'}
    out = {'id': 'openfoam', 'name': 'Native comparison F1-F4', 'verdict': 'PASS' if ok_all else 'FAIL', 'foamVersion': 'OpenFOAM v1912 (OpenCFD), simpleFoam laminar', 'convergence': out_conv,
           'environment': 'OpenFOAM v1912 (OpenCFD, Ubuntu package 1912.200626) simpleFoam, laminar; same grids as the browser solver; interpolation none.', 'items': items}
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    json.dump(out, open(a.out, 'w'), indent=1)
    print('openfoam comparison:', out['verdict'])
    sys.exit(0 if ok_all else 1)


if __name__ == '__main__':
    main()
