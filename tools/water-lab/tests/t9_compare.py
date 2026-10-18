"""Check 9 (comparison): browser vs native NVT/NPT statistics with block averages; reference correlation times."""
import json, math, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, '..', '..')))
from analyze_water import t_quantile, tau_int  # noqa: E402
RES = os.path.normpath(os.path.join(HERE, '..', 'results'))
nat = json.load(open(os.path.join(RES, 't9_native_series.json')))
bro = json.load(open(os.path.join(RES, 't9_browser_series.json')))
DISCARD, BLOCK = 5.0, 2.5
OBS = {'nvt': ['T', 'pe', 'P'], 'npt': ['rho', 'pe', 'T', 'P']}
CRIT = {'nvt': ['T', 'pe', 'P'], 'npt': ['rho', 'pe']}
UNIT = {'T': 'K', 'pe': 'kJ/mol per molecule', 'P': 'bar', 'rho': 'kg/m^3'}

def blocks(rec, key):
    t, x = np.array(rec['t']), np.array(rec[key])
    keep = t > DISCARD
    t, x = t[keep], x[keep]
    nb = int(round((t[-1] - t[0] + 0.01) / BLOCK))
    m = np.array([x[(t > DISCARD + i * BLOCK) & (t <= DISCARD + (i + 1) * BLOCK)].mean() for i in range(nb)])
    return m, float(m.mean()), float(m.std(ddof=1) / math.sqrt(nb)), tau_int(x, 0.01)

out, ok = {}, True
for ens in ('nvt', 'npt'):
    out[ens] = {}
    for key in OBS[ens]:
        mb, b, seb, taub = blocks(bro[ens], key)
        mn, n, sen, taun = blocks(nat[ens], key)
        df = len(mb) + len(mn) - 2
        lim = t_quantile(0.975, df) * math.sqrt(seb ** 2 + sen ** 2)
        agree = abs(b - n) <= lim
        crit = key in CRIT[ens]
        if crit:
            ok &= agree
        out[ens][key] = {'unit': UNIT[key], 'browser_mean': b, 'browser_se': seb, 'native_mean': n, 'native_se': sen, 'difference': b - n,
                         'combined_95_limit': lim, 'agree': agree, 'criterion': crit, 'blocks': len(mb), 'tau_int_ps_browser': taub, 'tau_int_ps_native': taun}
        print(f"{ens} {key}: browser {b:.4g} ± {seb:.2g}, native {n:.4g} ± {sen:.2g}, |diff| {abs(b - n):.3g} vs {lim:.3g} -> {'agree' if agree else 'DIFFER'}{'' if crit else ' (reported)'}; tau_int {taub:.3g}/{taun:.3g} ps")
    Tb = out[ens]['T']
    tq = t_quantile(0.975, Tb['blocks'] - 1) * Tb['browser_se']
    t_ok = abs(Tb['browser_mean'] - 298.15) <= max(tq, 1.0)
    out[ens]['T_target_check'] = {'browser_mean_K': Tb['browser_mean'], 'interval_K': tq, 'pass': t_ok}
    ok &= t_ok
res = {'id': 9, 'name': 'NVT and NPT statistics vs native', 'verdict': 'PASS' if ok else 'FAIL',
       'settings': {'molecules': 216, 'duration_ps': 40, 'discard_ps': DISCARD, 'block_ps': BLOCK, 'seeds': {'browser': 4101, 'native': 4102}},
       'results': out,
       'reference_pilot': {k: {o: out[k][o]['tau_int_ps_native'] for o in OBS[k]} for k in out},
       'summary': 'NPT density browser %.1f ± %.1f vs native %.1f ± %.1f kg/m^3; PE per molecule %.3f vs %.3f kJ/mol; NVT T %.2f vs %.2f K' % (
           out['npt']['rho']['browser_mean'], out['npt']['rho']['browser_se'], out['npt']['rho']['native_mean'], out['npt']['rho']['native_se'],
           out['npt']['pe']['browser_mean'], out['npt']['pe']['native_mean'], out['nvt']['T']['browser_mean'], out['nvt']['T']['native_mean'])}
json.dump(res, open(os.path.join(RES, 't9.json'), 'w'), indent=1)
print('check 9:', res['verdict'], '-', res['summary'])
sys.exit(0 if res['verdict'] == 'PASS' else 1)            # failure status for scripts and CI
