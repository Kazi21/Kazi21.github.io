#!/usr/bin/env python3
"""Acceptance tests A1-A5 for the calibration and analysis tools (criteria: tools/continuum/TOLERANCES.md).
Synthetic fixtures are generated into a temporary folder (labelled SYNTHETIC; never part of an evidence table).
Writes tools/continuum/results/t_tools.json; exit status 1 if a test fails. Usage: python3 t_tools.py"""
import json, math, os, shutil, subprocess, sys, tempfile, csv

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

    # A4 equilibrium gate: fixtures with the driven runs of 'good' and altered zero-drive runs
    for k in ('noeq', 'eqhot', 'recross'):
        run([PY, os.path.join(TOOLS, 'fixtures', 'make_synthetic_fixture.py'), '--kind', k, '--out', tmp], check=True)
    src = list(csv.reader(open(os.path.join(tmp, 'SYNTHETIC_good_crossings.csv'))))
    csv.writer(open(os.path.join(tmp, 'SYNTHETIC_eqone_crossings.csv'), 'w', newline='')).writerows(
        [src[0]] + [r for r in src[1:] if r[3] != 'zero' or r[0] == 'zero_r1'])
    gate = {'good': res['good']}
    for k in ('noeq', 'eqhot', 'eqone', 'recross'):
        out = os.path.join(tmp, 'res_%s.json' % k)
        man = os.path.join(tmp, 'SYNTHETIC_%s_manifest.json' % ('good' if k == 'eqone' else k))
        p = run([PY, os.path.join(TOOLS, 'analyze_pore_flux.py'), '--input', os.path.join(tmp, 'SYNTHETIC_%s_crossings.csv' % k), '--manifest', man, '--out', out])
        gate[k] = (p.returncode, json.load(open(out)) if os.path.exists(out) else {})

    def ext(k):
        r = gate[k][1]; e = r.get('low_pressure_extension', {}); si = r.get('supported_interval_Pa', [None, None])
        return bool(e.get('granted')), si[0], '; '.join(e.get('reasons', []))
    want = {'noeq': 'no crossing fluctuations', 'eqhot': 'disagrees with the driven slope', 'eqone': 'fewer than two'}
    g_ok = ext('good')[0] and ext('good')[1] is not None and ext('good')[1] <= 0
    r_ok = all((not ext(k)[0]) and ext(k)[1] == 5e7 and want[k] in ext(k)[2] and gate[k][0] == 0 and gate[k][1].get('law_candidate') is None for k in want)
    eg, rc = gate['good'][1]['tests']['equilibrium_consistency'], gate['recross'][1]['tests']['equilibrium_consistency']
    rec('A4', 'equilibrium gate (analyze_pore_flux.py)', g_ok and r_ok,
        'good: granted (G_eq %.4g, relative SE %.3f, z %.2f against G %.4g), interval starts at %.3g Pa; no zero-drive fluctuations: refused, starts at %.3g Pa (%s); '
        'zero-drive fluctuations x4: refused, starts at %.3g Pa (z %.2f); one zero-drive replica: refused, starts at %.3g Pa (%s); '
        'informative, not gated (see TOLERANCES): recrossing fixture %s (G_eq %.4g, z %.2f, offset C %.3f; single-block estimate %.4g)'
        % (eg['G_eq'], eg['rel_se_G_eq'], eg['z'], eg['G_driven'], ext('good')[1], ext('noeq')[1], ext('noeq')[2], ext('eqhot')[1],
           gate['eqhot'][1]['tests']['equilibrium_consistency']['z'], ext('eqone')[1], ext('eqone')[2],
           'granted' if ext('recross')[0] else 'refused', rc['G_eq'], rc['z'], rc['offset_C'], rc['single_block_G_eq']))

    # A5 equilibrium estimator, Monte Carlo on fresh seeds (criteria written before the first run)
    import importlib.util, random, statistics
    def load(name, path):
        sp = importlib.util.spec_from_file_location(name, path); m = importlib.util.module_from_spec(sp); sp.loader.exec_module(m); return m
    AP = load('apf_t', os.path.join(TOOLS, 'analyze_pore_flux.py')); FX = load('fx_t', os.path.join(TOOLS, 'fixtures', 'make_synthetic_fixture.py'))
    G0 = 1e-27; k0 = G0 * FX.KB * FX.T / FX.VW ** 2 * 1e-12
    mc = {}
    for tele in (False, True):
        ratio, rel, single, grant = [], [], [], 0
        for seed in range(2000, 2040):
            rng, zero = random.Random(seed), {}
            for rep in range(1, 5):
                tr = (0.5, random.Random(seed * 10 + rep)) if tele else None
                rows_ = FX.run_rows('zero', 0.0, rep, k0, k0, 20000.0, rng, telegraph=tr, planes=(('mid', 0.0),))
                s = [(r_[2], r_[7]) for r_ in rows_]
                zero['zero_r%d' % rep] = (s, s[0][0] + 100.0)
            gq = AP.equilibrium_gate(zero, 20.0, FX.VW, FX.T, G0, 0.035 * G0, 1.959964)
            ratio.append(gq['G_eq'] / G0); rel.append(gq['rel_se_G_eq']); single.append(gq['single_block_G_eq'] / G0); grant += 1 if gq['pass'] else 0
        n = len(ratio); m, sd = statistics.mean(ratio), statistics.stdev(ratio)
        mc[tele] = {'n': n, 'mean': m, 'sd': sd, 'sem': sd / math.sqrt(n), 'rel_se': statistics.mean(rel), 'single': statistics.mean(single), 'grant': grant / n}
    a, b = mc[False], mc[True]
    a5 = (all(abs(x['mean'] - 1) <= 3 * x['sem'] for x in (a, b)) and b['single'] > 2
          and all(1 / 1.5 <= x['rel_se'] / x['sd'] <= 1.5 for x in (a, b)))
    rec('A5', 'equilibrium estimator, Monte Carlo (analyze_pore_flux.py)', a5,
        '40 synthetic zero-drive data sets (4 x 20 ns, seeds 2000-2039): without recrossings mean G_eq/G = %.4f +/- %.4f (scatter %.4f, mean reported relative SE %.4f); '
        'with recrossings %.4f +/- %.4f (scatter %.4f, reported %.4f), mean single-block estimate %.3f G; gate would grant the extension in %.0f %% / %.0f %% of the data sets (not gated)'
        % (a['mean'], a['sem'], a['sd'], a['rel_se'], b['mean'], b['sem'], b['sd'], b['rel_se'], b['single'], 100 * a['grant'], 100 * b['grant']))
finally:
    shutil.rmtree(tmp, ignore_errors=True)

ok = all(i['verdict'] == 'PASS' for i in items)
os.makedirs(os.path.join(TOOLS, 'results'), exist_ok=True)
json.dump({'id': 'tools', 'name': 'Calibration and analysis tools A1-A5', 'verdict': 'PASS' if ok else 'FAIL', 'items': items,
           'environment': 'Python %s; synthetic fixtures generated with seed 20261018 (A5: seeds 2000-2039) and deleted after the run' % sys.version.split()[0]},
          open(os.path.join(TOOLS, 'results', 't_tools.json'), 'w'), indent=1)
print('tools:', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
