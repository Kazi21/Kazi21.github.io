#!/usr/bin/env python3
"""Acceptance tests A1-A3 for the calibration and analysis tools (criteria: tools/continuum/TOLERANCES.md).
Synthetic fixtures are generated into a temporary folder (labelled SYNTHETIC; never part of an evidence table).
Writes tools/continuum/results/t_tools.json; exit status 1 if a test fails. Usage: python3 t_tools.py"""
import json, os, shutil, subprocess, sys, tempfile, csv

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(TOOLS))
PY = sys.executable
items = []


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def rec(i, name, ok, detail):
    items.append({'id': i, 'name': name, 'verdict': 'PASS' if ok else 'FAIL', 'detail': detail})
    print(('PASS ' if ok else 'FAIL ') + i + ' ' + name + ' - ' + detail)


tmp = tempfile.mkdtemp(prefix='continuum-tools-')
try:
    # A1 analyze_pore_flux.py
    h = run([PY, os.path.join(TOOLS, 'analyze_pore_flux.py'), '--help'])
    for k in ('good', 'short', 'offset'):
        run([PY, os.path.join(TOOLS, 'fixtures', 'make_synthetic_fixture.py'), '--kind', k, '--out', tmp], check=True)
    res = {}
    for k in ('good', 'short', 'offset'):
        out = os.path.join(tmp, 'res_%s.json' % k)
        p = run([PY, os.path.join(TOOLS, 'analyze_pore_flux.py'), '--input', os.path.join(tmp, 'SYNTHETIC_%s_crossings.csv' % k), '--manifest', os.path.join(tmp, 'SYNTHETIC_%s_manifest.json' % k), '--out', out])
        res[k] = (p.returncode, json.load(open(out)) if os.path.exists(out) else {})
    g = res['good'][1]; lo, hi = g['fit']['through_origin']['interval_G'] if g.get('fit') else (None, None)
    a1 = (h.returncode == 0 and 'usage' in h.stdout.lower() and res['good'][0] == 0 and lo is not None and lo <= 1e-27 <= hi and g.get('law_candidate') is None
          and res['short'][0] == 2 and res['short'][1].get('status') == 'insufficient_data' and res['offset'][0] == 1 and res['offset'][1].get('status') == 'failed')
    eq = g.get('diagnostics', {}).get('equilibrium_linear_response', {})
    rec('A1', 'analyze_pore_flux.py', a1, '--help exit %d; SYNTHETIC fixture with declared G = 1.00e-27: estimate %.4g m^3 Pa^-1 s^-1, 95 %% interval [%.4g, %.4g] (contains G), exit %d, no law produced from synthetic data; equilibrium (zero-drive) estimate %.4g; too-short series: exit %d, status %s; fixture with a drive-independent offset: exit %d, status %s (%s)'
        % (h.returncode, g['fit']['through_origin']['G'] if g.get('fit') else float('nan'), lo or float('nan'), hi or float('nan'), res['good'][0], eq.get('G_eq', float('nan')),
           res['short'][0], res['short'][1].get('status'), res['offset'][0], res['offset'][1].get('status'), '; '.join(res['offset'][1].get('reasons', []))))
    # A2 check_conservation.py
    exp = os.path.join(tmp, 'export')
    run(['node', os.path.join(HERE, 'make_export.js'), exp], check=True)
    p_ok = run([PY, os.path.join(TOOLS, 'check_conservation.py'), exp])
    bad = os.path.join(tmp, 'export-corrupted'); shutil.copytree(exp, bad)
    rows = list(csv.reader(open(os.path.join(bad, 'membrane.csv'))))
    k = rows[0].index('J_m_s'); rows[51][k] = repr(float(rows[51][k]) * 1.01)
    csv.writer(open(os.path.join(bad, 'membrane.csv'), 'w', newline='')).writerows(rows)
    p_bad = run([PY, os.path.join(TOOLS, 'check_conservation.py'), bad])
    hc = run([PY, os.path.join(TOOLS, 'check_conservation.py'), '--help'])
    rec('A2', 'check_conservation.py', p_ok.returncode == 0 and p_bad.returncode == 1 and hc.returncode == 0,
        'exported closed-patch experiment: exit %d (%s); copy with one face flux changed by 1 %%: exit %d (%s)'
        % (p_ok.returncode, p_ok.stdout.strip().splitlines()[-1], p_bad.returncode, ', '.join(l[5:].split(':')[0] for l in p_bad.stdout.splitlines() if l.startswith('FAIL'))))
    # A3 compare_openfoam.py: a gate that cannot be met, and a missing case, must both give a non-zero exit
    of = os.path.join(TOOLS, 'openfoam')
    g1 = run([PY, os.path.join(of, 'compare_openfoam.py'), '--q-gate', '1e-12', '--l2-gate', '1e-12', '--out', os.path.join(tmp, 'of1.json')])
    g2 = run([PY, os.path.join(of, 'compare_openfoam.py'), '--cases', os.path.join(tmp, 'no-such-dir'), '--out', os.path.join(tmp, 'of2.json')])
    hh = run([PY, os.path.join(of, 'compare_openfoam.py'), '--help'])
    rec('A3', 'compare_openfoam.py', g1.returncode == 1 and g2.returncode == 1 and hh.returncode == 0,
        'gates of 1e-12: exit %d; missing case folder (NOT_RUN): exit %d; --help exit %d' % (g1.returncode, g2.returncode, hh.returncode))
finally:
    shutil.rmtree(tmp, ignore_errors=True)

ok = all(i['verdict'] == 'PASS' for i in items)
os.makedirs(os.path.join(TOOLS, 'results'), exist_ok=True)
json.dump({'id': 'tools', 'name': 'Calibration and analysis tools A1-A3', 'verdict': 'PASS' if ok else 'FAIL', 'items': items,
           'environment': 'Python %s; synthetic fixtures generated with seed 20261018 and deleted after the run' % sys.version.split()[0]},
          open(os.path.join(TOOLS, 'results', 't_tools.json'), 'w'), indent=1)
print('tools:', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
