#!/usr/bin/env python3
"""Estimate a single-pore water conductance G (m^3 Pa^-1 s^-1) from molecular-dynamics crossing counts, with the
statistics and acceptance tests the Continuum Lab requires before a pore law may replace the illustrative one.

Input (--input, one or more CSV files) with one row per sample:
  run_id, replica_id, time_ps, condition_id, drive_Pa, mean_pressure_Pa, temperature_K, cumulative_crossings,
  sampling_plane_id [, occupancy]
cumulative_crossings is the signed net number of water molecules that crossed the plane (+ along the drive) since
the start of the run. Each run belongs to one condition and one replica; independent replicas are separate runs.
--manifest (JSON) declares the system, the planes (primary plane first), the reference density, the conditions with
their roles ('fit', 'heldout', 'zero') and whether the data are a synthetic fixture.

Analysis, in order:
  1. Discard --discard-ps after the start of every run (relaxation after switching the drive on).
  2. Cut the rest into blocks of --block-ps; block flux = net crossings / block length. A run needs --min-blocks.
  3. Correlation check: standard error from blocks of 1x, 2x and 4x the block length; if it still grows by more than
     30 % the block length does not resolve the correlation and the run's uncertainty is unsupported.
  4. Two-plane mass balance: net fluxes at the planes must agree within 3 combined standard errors.
  5. Replica level: one mean per replica; condition mean and a percentile bootstrap interval over replicas
     (--bootstrap draws, --confidence, --seed). Overlapping windows are never treated as independent.
  6. Fit q = G dP + q0 by weighted least squares over 'fit' conditions (intercept diagnostic first), then the
     origin-constrained q = G dP with a bootstrap interval for G (replicas resampled within each condition).
  7. Tests: zero drive consistent with zero flux; intercept consistent with zero; linearity (reduced chi-square);
     symmetry for +/- drive pairs when present; prediction of every 'heldout' condition within its interval.
  8. Equilibrium linear response from the zero-drive runs: D_N = Var(block crossings) / (2 tau) and
     G_eq = v_w^2 D_N / (k_B T), with v_w = m_w / rho_ref (Einstein relation for the net crossing count); reported as
     a consistency diagnostic against the driven slope.
Volume flow: q = m_w (net crossings per s) / rho_ref with m_w = 2.991506e-26 kg and rho_ref from the manifest.
Insufficient data are reported as such; no interval is invented. Synthetic fixtures are labelled and their result
can never become a pore law.

Output (--out JSON): parameters, input hashes, per-run blocks, per-condition summaries, fits with covariance,
bootstrap samples of G, intervals, tests, diagnostics, assumptions and the resulting assessment status.
Exit status: 0 accepted (supported in scope), 1 an acceptance test failed, 2 insufficient data.
"""
import argparse, csv, hashlib, json, math, os, random, sys
from collections import defaultdict

M_W = 2.991506e-26          # kg per water molecule (18.015268 g/mol / N_A)
KB = 1.380649e-23           # J/K


def tq(p, df):
    """Two-sided Student-t quantile t_{p, df} (p e.g. 0.975) by bisection on the regularized incomplete beta."""
    from math import lgamma, exp, log
    def betacf(a, b, x):
        qab, qap, qam = a + b, a + 1, a - 1
        c, d = 1.0, 1 - qab * x / qap
        d = 1 / (d if abs(d) > 1e-300 else 1e-300); h = d
        for m in range(1, 300):
            m2 = 2 * m
            aa = m * (b - m) * x / ((qam + m2) * (a + m2)); d = 1 + aa * d; d = 1 / (d if abs(d) > 1e-300 else 1e-300); c = 1 + aa / c; h *= d * c
            aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2)); d = 1 + aa * d; d = 1 / (d if abs(d) > 1e-300 else 1e-300); c = 1 + aa / c; de = d * c; h *= de
            if abs(de - 1) < 1e-14: break
        return h
    def ibeta(a, b, x):
        if x <= 0: return 0.0
        if x >= 1: return 1.0
        bt = exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * log(x) + b * log(1 - x))
        return bt * betacf(a, b, x) / a if x < (a + 1) / (a + b + 2) else 1 - bt * betacf(b, a, 1 - x) / b
    def cdf(t):
        x = df / (df + t * t); return 1 - 0.5 * ibeta(df / 2, 0.5, x) if t > 0 else 0.5 * ibeta(df / 2, 0.5, x)
    lo, hi = 0.0, 1000.0
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if cdf(mid) < p: lo = mid
        else: hi = mid
    return 0.5 * (lo + hi)


def zq(p):
    return tq(p, 1e7)


def wls(x, y, s, intercept=True):
    """Weighted least squares y = G x (+ q0); returns params, covariance, chi2, dof."""
    w = [1 / (si * si) for si in s]
    if intercept:
        S, Sx, Sy, Sxx, Sxy = sum(w), sum(wi * xi for wi, xi in zip(w, x)), sum(wi * yi for wi, yi in zip(w, y)), sum(wi * xi * xi for wi, xi in zip(w, x)), sum(wi * xi * yi for wi, xi, yi in zip(w, x, y))
        D = S * Sxx - Sx * Sx
        G, q0 = (S * Sxy - Sx * Sy) / D, (Sxx * Sy - Sx * Sxy) / D
        cov = [[S / D, -Sx / D], [-Sx / D, Sxx / D]]
        chi2 = sum(wi * (yi - G * xi - q0) ** 2 for wi, xi, yi in zip(w, x, y))
        return {'G': G, 'q0': q0, 'cov': cov, 'chi2': chi2, 'dof': len(x) - 2}
    Sxx, Sxy = sum(wi * xi * xi for wi, xi in zip(w, x)), sum(wi * xi * yi for wi, xi, yi in zip(w, x, y))
    G = Sxy / Sxx
    chi2 = sum(wi * (yi - G * xi) ** 2 for wi, xi, yi in zip(w, x, y))
    return {'G': G, 'varG': 1 / Sxx, 'chi2': chi2, 'dof': len(x) - 1}


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def blocks_of(series, t0, block):
    """Net crossings in consecutive blocks of length `block` (ps) after t0, from (time, cumulative) samples."""
    pts = [(t, n) for t, n in series if t >= t0 - 1e-9]
    if len(pts) < 2: return []
    out, start, k = [], pts[0][0], 0
    # cumulative count at an arbitrary time: last sample at or before it (counts change only at crossings)
    times = [p[0] for p in pts]
    import bisect
    def at(t):
        i = bisect.bisect_right(times, t + 1e-9) - 1
        return pts[max(i, 0)][1]
    end = pts[-1][0]
    while start + (k + 1) * block <= end + 1e-9:
        a, b = start + k * block, start + (k + 1) * block
        out.append(at(b) - at(a)); k += 1
    return out


def se_of(blocks, block):
    n = len(blocks)
    if n < 2: return float('nan')
    m = sum(blocks) / n
    var = sum((x - m) ** 2 for x in blocks) / (n - 1)
    return math.sqrt(var / n) / block            # SE of the mean rate (molecules per ps)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--input', nargs='+', required=True, help='crossing-count CSV file(s)')
    ap.add_argument('--manifest', required=True, help='calibration manifest (JSON)')
    ap.add_argument('--discard-ps', type=float, default=100.0, help='discarded at the start of each run, ps (default 100)')
    ap.add_argument('--block-ps', type=float, default=20.0, help='block length, ps (default 20)')
    ap.add_argument('--min-blocks', type=int, default=20, help='minimum blocks per run (default 20)')
    ap.add_argument('--bootstrap', type=int, default=2000, help='bootstrap draws (default 2000)')
    ap.add_argument('--confidence', type=float, default=0.95, help='confidence level (default 0.95)')
    ap.add_argument('--seed', type=int, default=20261018, help='random seed (default 20261018)')
    ap.add_argument('--out', default='pore_flux_result.json', help='output JSON (default pore_flux_result.json)')
    a = ap.parse_args()
    man = json.load(open(a.manifest))
    rng = random.Random(a.seed)
    alpha = 1 - a.confidence
    rho = float(man['referenceDensity_kg_m3']); T = float(man['temperature_K'])
    vw = M_W / rho
    to_q = lambda r_per_ps: r_per_ps * 1e12 * vw          # molecules/ps -> m^3/s
    planes = man['planes']; primary = planes[0]['id']
    roles = {c['condition_id']: c for c in man['conditions']}
    synthetic = bool(man.get('synthetic', False))

    rows = defaultdict(list); meta = {}
    for path in a.input:
        with open(path, newline='') as f:
            for r in csv.DictReader(f):
                key = (r['run_id'], r['sampling_plane_id'])
                rows[key].append((float(r['time_ps']), float(r['cumulative_crossings'])))
                meta[r['run_id']] = {'replica': r['replica_id'], 'condition': r['condition_id'], 'drive_Pa': float(r['drive_Pa']),
                                     'mean_pressure_Pa': float(r['mean_pressure_Pa']), 'temperature_K': float(r['temperature_K'])}
    result = {'tool': 'analyze_pore_flux.py', 'synthetic': synthetic, 'label': 'SYNTHETIC FIXTURE - not scientific evidence' if synthetic else man.get('label', ''),
              'parameters': {k: getattr(a, k) for k in ('discard_ps', 'block_ps', 'min_blocks', 'bootstrap', 'confidence', 'seed')},
              'inputs': {p: sha256(p) for p in a.input}, 'manifest': {'file': a.manifest, 'sha256': sha256(a.manifest)},
              'units': {'q': 'm^3/s', 'G': 'm^3 Pa^-1 s^-1', 'drive': 'Pa', 'rate': 'molecules per ps'},
              'constants': {'m_w_kg': M_W, 'rho_ref_kg_m3': rho, 'v_w_m3': vw, 'T_K': T},
              'runs': {}, 'conditions': {}, 'tests': {}, 'diagnostics': {}, 'assumptions': [
                  'net crossings of the declared planes measure the pore flow; the membrane is impermeable elsewhere',
                  'replicas are independent (separate initial conditions); windows within a run are not',
                  'the drive is the declared pressure difference between the reference planes of the manifest',
                  'blocks of --block-ps are long compared with the flux correlation time (checked in test 3)']}
    insufficient, failed = [], []
    # ---- per run
    per_cond = defaultdict(lambda: defaultdict(dict))
    for (run, plane), series in sorted(rows.items()):
        series.sort()
        t0 = series[0][0] + a.discard_ps
        b1 = blocks_of(series, t0, a.block_ps)
        info = {'plane': plane, 'blocks': len(b1), 'block_crossings': b1}
        if len(b1) < a.min_blocks:
            info['status'] = 'insufficient data: %d blocks < %d' % (len(b1), a.min_blocks)
            insufficient.append('%s/%s: %s' % (run, plane, info['status']))
        else:
            dur = len(b1) * a.block_ps
            rate = sum(b1) / dur
            se = [se_of(b1, a.block_ps), se_of(blocks_of(series, t0, 2 * a.block_ps), 2 * a.block_ps), se_of(blocks_of(series, t0, 4 * a.block_ps), 4 * a.block_ps)]
            grow = se[2] / se[0] if se[0] > 0 and math.isfinite(se[2]) else float('nan')
            info.update({'rate_per_ps': rate, 'se_per_ps': se[0], 'se_block_scaling': se, 'se_growth_4x': grow,
                         'correlation_resolved': not (math.isfinite(grow) and grow > 1.3), 'duration_ps': dur})
            if not info['correlation_resolved']:
                failed.append('%s/%s: standard error grows %.2f times from 1x to 4x blocks (correlation not resolved)' % (run, plane, grow))
            per_cond[meta[run]['condition']][meta[run]['replica']][plane] = info
        result['runs'].setdefault(run, {'meta': meta[run], 'planes': {}})['planes'][plane] = info
    # ---- two-plane balance
    bal = []
    for run, rr in result['runs'].items():
        ps = [p for p in rr['planes'].values() if 'rate_per_ps' in p]
        for i in range(1, len(ps)):
            d = abs(ps[i]['rate_per_ps'] - ps[0]['rate_per_ps']); s = math.hypot(ps[i]['se_per_ps'], ps[0]['se_per_ps'])
            ok = d <= 3 * s if s > 0 else d == 0
            bal.append({'run': run, 'planes': [ps[0]['plane'], ps[i]['plane']], 'difference_per_ps': d, 'combined_se': s, 'pass': ok})
            if not ok: failed.append('two-plane balance failed in run %s' % run)
    result['tests']['two_plane_balance'] = {'pass': all(b['pass'] for b in bal) if bal else None, 'details': bal}
    # ---- condition level (primary plane), replica bootstrap
    summ = {}
    for cid, reps in per_cond.items():
        rates = [reps[r][primary]['rate_per_ps'] for r in sorted(reps) if primary in reps[r]]
        if not rates: continue
        drive = [meta[run]['drive_Pa'] for run in meta if meta[run]['condition'] == cid][0]
        R = len(rates); mean = sum(rates) / R
        if R >= 2:
            s = math.sqrt(sum((x - mean) ** 2 for x in rates) / (R - 1)); se = s / math.sqrt(R)
            boots = sorted(sum(rng.choice(rates) for _ in range(R)) / R for _ in range(a.bootstrap))
            lo, hi = boots[int(alpha / 2 * a.bootstrap)], boots[min(a.bootstrap - 1, int((1 - alpha / 2) * a.bootstrap))]
            how = 'replica bootstrap (%d replicas)' % R
        else:
            only = [reps[r][primary] for r in reps][0]
            se = only['se_per_ps']; t = tq(1 - alpha / 2, max(only['blocks'] - 1, 1)); lo, hi = mean - t * se, mean + t * se
            how = 'single replica: interval from blocks within one run'
        summ[cid] = {'role': roles.get(cid, {}).get('role', 'fit'), 'drive_Pa': drive, 'replicas': R, 'rate_per_ps': mean, 'se_per_ps': se,
                     'interval_per_ps': [lo, hi], 'interval_method': how, 'q_m3_s': to_q(mean), 'q_se_m3_s': to_q(se), 'q_interval_m3_s': [to_q(lo), to_q(hi)],
                     'replica_rates_per_ps': rates}
    result['conditions'] = summ
    fit = [c for c in summ.values() if c['role'] == 'fit' and c['drive_Pa'] != 0]
    if len(fit) < 2:
        insufficient.append('fewer than two fit conditions with non-zero drive')
    if insufficient:
        result['status'] = 'insufficient_data'; result['reasons'] = insufficient
        json.dump(result, open(a.out, 'w'), indent=1)
        short = insufficient if len(insufficient) <= 4 else insufficient[:3] + ['... and %d more' % (len(insufficient) - 3)]
        print('INSUFFICIENT DATA: ' + '; '.join(short)); sys.exit(2)
    x = [c['drive_Pa'] for c in fit]; y = [c['q_m3_s'] for c in fit]; s = [max(c['q_se_m3_s'], 1e-300) for c in fit]
    free = wls(x, y, s, True); con = wls(x, y, s, False)
    z = zq(1 - alpha / 2)
    se_q0 = math.sqrt(free['cov'][1][1])
    t_int = {'q0_m3_s': free['q0'], 'se_m3_s': se_q0, 'z': free['q0'] / se_q0 if se_q0 > 0 else float('inf')}
    t_int['pass'] = abs(t_int['z']) <= z
    result['tests']['intercept_zero'] = t_int
    if not t_int['pass']: failed.append('intercept %.3e m^3/s differs from zero (z = %.2f)' % (free['q0'], t_int['z']))
    # linearity: reduced chi-square of the origin-constrained fit against the chi-square quantile
    dof = con['dof']
    lin = {'chi2': con['chi2'], 'dof': dof}
    if dof >= 1:
        crit = dof * (1 - 2 / (9 * dof) + z * math.sqrt(2 / (9 * dof))) ** 3      # Wilson-Hilferty chi-square quantile
        lin['critical'] = crit; lin['pass'] = con['chi2'] <= crit
        if not lin['pass']: failed.append('linear law rejected (chi2 %.2f > %.2f with %d dof)' % (con['chi2'], crit, dof))
    else:
        lin['pass'] = None; lin['note'] = 'not testable with this number of fit conditions'
    result['tests']['linearity'] = lin
    # bootstrap of G over replicas within conditions
    Gs = []
    for _ in range(a.bootstrap):
        yb = []
        for c in fit:
            rr = c['replica_rates_per_ps']; yb.append(to_q(sum(rng.choice(rr) for _ in range(len(rr))) / len(rr)))
        Gs.append(wls(x, yb, s, False)['G'])
    Gs.sort()
    b_lo, b_hi = Gs[int(alpha / 2 * a.bootstrap)], Gs[min(a.bootstrap - 1, int((1 - alpha / 2) * a.bootstrap))]
    # with few replicas a percentile bootstrap under-covers: report the wider of it and a Student-t interval with
    # nu = min(R) - 1 degrees of freedom on the weighted-fit standard error
    nu = max(1, min(c['replicas'] for c in fit) - 1)
    t_half = tq(1 - alpha / 2, nu) * math.sqrt(con['varG'])
    G_lo, G_hi = min(b_lo, con['G'] - t_half), max(b_hi, con['G'] + t_half)
    result['fit'] = {'with_intercept': {'G': free['G'], 'q0_m3_s': free['q0'], 'covariance': free['cov'], 'chi2': free['chi2'], 'dof': free['dof']},
                     'through_origin': {'G': con['G'], 'se_G': math.sqrt(con['varG']), 'interval_G': [G_lo, G_hi],
                                        'interval_method': 'wider of the replica bootstrap (%d draws) and Student-t (nu = %d) intervals' % (a.bootstrap, nu),
                                        'interval_bootstrap': [b_lo, b_hi], 'interval_t': [con['G'] - t_half, con['G'] + t_half], 'chi2': con['chi2'], 'dof': con['dof']},
                     'bootstrap_G_samples': Gs, 'fit_conditions': [c for c in summ if summ[c]['role'] == 'fit' and summ[c]['drive_Pa'] != 0]}
    G, seG = con['G'], math.sqrt(con['varG'])
    # zero drive
    zero = [c for c in summ.values() if c['drive_Pa'] == 0]
    if zero:
        zt = [{'rate_per_ps': c['rate_per_ps'], 'se_per_ps': c['se_per_ps'], 'pass': abs(c['rate_per_ps']) <= z * c['se_per_ps']} for c in zero]
        result['tests']['zero_drive'] = {'pass': all(t['pass'] for t in zt), 'details': zt}
        if not all(t['pass'] for t in zt): failed.append('zero-drive flux differs from zero')
    else:
        result['tests']['zero_drive'] = {'pass': None, 'note': 'no zero-drive condition'}
        failed.append('no zero-drive condition (required)')
    # symmetry
    sym = []
    for c in summ.values():
        if c['drive_Pa'] <= 0: continue
        for d in summ.values():
            if d['drive_Pa'] < 0 and abs(abs(d['drive_Pa']) - c['drive_Pa']) <= 0.01 * c['drive_Pa']:
                diff = c['q_m3_s'] + d['q_m3_s']; sd = math.hypot(c['q_se_m3_s'], d['q_se_m3_s'])
                sym.append({'drive_Pa': c['drive_Pa'], 'q_plus': c['q_m3_s'], 'q_minus': d['q_m3_s'], 'z': diff / sd if sd > 0 else float('inf'), 'pass': abs(diff) <= z * sd})
    result['tests']['symmetry'] = {'pass': all(t['pass'] for t in sym) if sym else None, 'details': sym,
                                   'note': '' if sym else 'no +/- drive pair: the supported interval is restricted to non-negative drive'}
    if sym and not all(t['pass'] for t in sym): failed.append('response is not antisymmetric')
    # held-out
    ho = []
    for cid, c in summ.items():
        if c['role'] != 'heldout': continue
        pred = G * c['drive_Pa']; sd = math.sqrt(c['q_se_m3_s'] ** 2 + (c['drive_Pa'] * seG) ** 2)
        ho.append({'condition': cid, 'drive_Pa': c['drive_Pa'], 'observed_m3_s': c['q_m3_s'], 'predicted_m3_s': pred, 'z': (c['q_m3_s'] - pred) / sd if sd > 0 else float('inf'), 'pass': abs(c['q_m3_s'] - pred) <= z * sd})
    result['tests']['held_out'] = {'pass': all(t['pass'] for t in ho) if ho else None, 'details': ho}
    if not ho: failed.append('no held-out condition (required)')
    elif not all(t['pass'] for t in ho): failed.append('held-out prediction failed')
    # equilibrium linear response from the zero-drive runs
    eq = []
    for run, rr in result['runs'].items():
        if rr['meta']['drive_Pa'] != 0 or primary not in rr['planes']: continue
        b = rr['planes'][primary]['block_crossings']
        if len(b) >= 2:
            m = sum(b) / len(b); var = sum((v - m) ** 2 for v in b) / (len(b) - 1)
            eq.append(var / (2 * a.block_ps * 1e-12))           # D_N in 1/s
    if eq:
        DN = sum(eq) / len(eq); Geq = vw * vw * DN / (KB * T)
        boots = sorted(vw * vw * (sum(rng.choice(eq) for _ in eq) / len(eq)) / (KB * T) for _ in range(a.bootstrap)) if len(eq) >= 2 else [Geq]
        result['diagnostics']['equilibrium_linear_response'] = {'D_N_per_s': DN, 'G_eq': Geq, 'interval_G_eq': [boots[int(alpha / 2 * len(boots))], boots[min(len(boots) - 1, int((1 - alpha / 2) * len(boots)))]],
            'ratio_to_driven_G': Geq / G if G else None, 'method': 'Einstein relation for the net crossing count: G_eq = v_w^2 D_N / (k_B T), D_N = Var(block crossings) / (2 tau)'}
    # ---- verdict
    lo_d = min(c['drive_Pa'] for c in summ.values()); hi_d = max(c['drive_Pa'] for c in summ.values())
    result['supported_interval_Pa'] = [lo_d if sym else max(0.0, lo_d), hi_d]
    result['status'] = 'failed' if failed else 'supported_in_scope'
    result['reasons'] = failed
    result['law_candidate'] = None if synthetic or failed else {
        'lawId': man.get('lawId', 'transport-cnt66-v1'), 'sourceKind': man.get('sourceKind', 'owner_measurement'), 'assessmentStatus': 'supported_in_scope',
        'form': 'linear-constant', 'G_m3_Pa_s': G, 'uncertainty': {'interval': [G_lo, G_hi], 'level': a.confidence, 'relHalfWidth': (G_hi - G_lo) / (2 * G)},
        'domain': {'dPiMin_Pa': result['supported_interval_Pa'][0], 'dPiMax_Pa': result['supported_interval_Pa'][1]}}
    json.dump(result, open(a.out, 'w'), indent=1)
    print('G = %.4e m^3 Pa^-1 s^-1, %g %% interval [%.4e, %.4e]; status %s%s' % (G, 100 * a.confidence, G_lo, G_hi, result['status'], ('; ' + '; '.join(failed)) if failed else ''))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
