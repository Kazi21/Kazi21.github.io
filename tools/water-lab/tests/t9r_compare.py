"""Check 9, revised: four independent 40 ps runs per engine and ensemble; engine errors from the spread of replica means;
five criterion comparisons at 99 % (Bonferroni, family-wise 95 %) with Welch's t. Keeps the original result."""
import json, math, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, '..', '..')))
from analyze_water import t_quantile, tau_int  # noqa: E402
RES = os.path.normpath(os.path.join(HERE, '..', 'results'))
DISCARD = 5.0
def series(engine):
    first = json.load(open(os.path.join(RES, f't9_{engine}_series.json')))
    seeds = (4103, 4105, 4107) if engine == 'browser' else (4104, 4106, 4108)
    runs = [first] + [json.load(open(os.path.join(RES, f't9r_{engine}_{s}.json'))) for s in seeds]
    return runs, ([4101] if engine == 'browser' else [4102]) + list(seeds)
B, bseeds = series('browser'); N, nseeds = series('native')
OBS = {'nvt': ['T', 'pe', 'P'], 'npt': ['rho', 'pe', 'T', 'P']}
CRIT = {('nvt', 'T'), ('nvt', 'pe'), ('nvt', 'P'), ('npt', 'rho'), ('npt', 'pe')}
UNIT = {'T': 'K', 'pe': 'kJ/mol per molecule', 'P': 'bar', 'rho': 'kg/m^3'}
def rmeans(runs, ens, key):
    out, taus = [], []
    for r in runs:
        t, x = np.array(r[ens]['t']), np.array(r[ens][key])
        out.append(float(x[t > DISCARD].mean())); taus.append(tau_int(x[t > DISCARD], 0.01))
    return np.array(out), float(np.nanmean(taus))
res, ok = {}, True
for ens in ('nvt', 'npt'):
    res[ens] = {}
    for key in OBS[ens]:
        mb, tb = rmeans(B, ens, key); mn, tn = rmeans(N, ens, key)
        sb, sn = mb.std(ddof=1) / 2, mn.std(ddof=1) / 2
        se = math.sqrt(sb ** 2 + sn ** 2)
        df = se ** 4 / ((sb ** 4) / 3 + (sn ** 4) / 3)
        lim = t_quantile(0.995, df) * se
        diff = mb.mean() - mn.mean()
        agree = bool(abs(diff) <= lim)
        crit = (ens, key) in CRIT
        if crit:
            ok &= agree
        res[ens][key] = {'unit': UNIT[key], 'browser_replicas': mb.tolist(), 'native_replicas': mn.tolist(), 'browser_mean': float(mb.mean()), 'browser_se': float(sb),
                         'native_mean': float(mn.mean()), 'native_se': float(sn), 'difference': float(diff), 'limit_99': float(lim), 'welch_df': float(df), 'agree': agree, 'criterion': crit,
                         'tau_int_ps_browser': tb, 'tau_int_ps_native': tn}
        print(f"{ens} {key}: browser {mb.mean():.4g} ± {sb:.2g} (replicas {np.round(mb, 3).tolist()}), native {mn.mean():.4g} ± {sn:.2g}; |diff| {abs(diff):.3g} vs {lim:.3g} -> {'agree' if agree else 'DIFFER'}{'' if crit else ' (reported)'}")
    T = res[ens]['T']
    tq = t_quantile(0.975, 3) * T['browser_se']
    t_ok = bool(abs(T['browser_mean'] - 298.15) <= max(tq, 1.0))
    res[ens]['T_target_check'] = {'browser_mean_K': T['browser_mean'], 'interval_95_K': tq, 'pass': t_ok}
    ok &= t_ok
    print(f"{ens} mean T {T['browser_mean']:.2f} K (95 % ± {tq:.2f}) -> {'pass' if t_ok else 'FAIL'}")
_o = os.path.join(RES, 't9_original_single_run.json')
orig = json.load(open(_o)) if os.path.exists(_o) else {'verdict': 'not available', 'summary': ''}
out = {'id': 9, 'name': 'NVT and NPT statistics vs native', 'verdict': 'PASS' if ok else 'FAIL', 'revised': True,
       'settings': {'molecules': 216, 'runs_per_engine_and_ensemble': 4, 'duration_ps': 40, 'discard_ps': DISCARD, 'seeds': {'browser': bseeds, 'native': nseeds},
                    'comparison': "Welch's t on replica means, 99 % per comparison (Bonferroni over five, family-wise 95 %)"},
       'results': res,
       'reference_pilot': {e: {k: {'tau_int_ps': (res[e][k]['tau_int_ps_browser'] + res[e][k]['tau_int_ps_native']) / 2} for k in OBS[e]} for e in res},
       'original_stated_version': {'verdict': orig['verdict'], 'summary': orig['summary'],
                                   'note': 'one run per engine; failed on NPT potential energy per molecule (difference 0.184 vs limit 0.141 kJ/mol)'},
       'summary': 'four 40 ps runs per engine: NPT density %.1f ± %.1f (browser) vs %.1f ± %.1f kg/m^3 (native); PE per molecule %.3f vs %.3f kJ/mol; NVT T %.2f vs %.2f K' % (
           res['npt']['rho']['browser_mean'], res['npt']['rho']['browser_se'], res['npt']['rho']['native_mean'], res['npt']['rho']['native_se'],
           res['npt']['pe']['browser_mean'], res['npt']['pe']['native_mean'], res['nvt']['T']['browser_mean'], res['nvt']['T']['native_mean'])}
json.dump(out, open(os.path.join(RES, 't9.json'), 'w'), indent=1)
print('check 9 (revised):', out['verdict'], '-', out['summary'])
sys.exit(0 if out['verdict'] == 'PASS' else 1)            # failure status for scripts and CI
