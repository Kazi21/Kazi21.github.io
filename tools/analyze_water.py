#!/usr/bin/env python3
"""Live Water Lab — analysis of an exported experiment (thermo.csv + events.json).

Usage:
  python tools/analyze_water.py --input thermo.csv --events events.json --discard-ps 20 --block-ps 5 \
      --min-blocks 8 --confidence 0.95 --seed 20261017 --out analysis

What it does
  * Splits the run at every event that changes the Hamiltonian, the ensemble, the targets or the tether
    (start, conditions, lj_scale, ensemble, pull_begin, release, drift_removed).
  * Segments with an active tether ("driven") are summarised separately (work, forces, energy balance) and never
    enter equilibrium averages.
  * In every other segment the first --discard-ps are dropped; the rest is cut into blocks of --block-ps.
    Block means give the mean and a Student-t interval at --confidence, reported only when at least
    --min-blocks blocks exist; otherwise the result is "insufficient data". A percentile bootstrap over the block
    means (--seed) is reported as a cross-check.
  * The integrated autocorrelation time of each observable is estimated (Sokal window); a warning is issued when
    a block is shorter than five integrated autocorrelation times, because block means would then be correlated.

The defaults are provisional: they should be set from reference runs that establish equilibration and correlation
times for the system studied. Elapsed time alone never certifies equilibrium; this script reports what the data
support. Needs Python 3.8+ and NumPy only.
"""
import argparse, csv, json, math, os, sys

import numpy as np

SPLIT_EVENTS = {'start', 'conditions', 'lj_scale', 'ensemble', 'pull_begin', 'release', 'drift_removed'}
OBSERVABLES = [('T_K', 'Temperature', 'K'), ('P_bar', 'Pressure', 'bar'), ('density_kg_m3', 'Density', 'kg/m^3'),
               ('PE_per_molecule', 'Potential energy per molecule', 'kJ/mol')]


# ---------------------------------------------------------------- Student t quantile (no SciPy needed)
def _betacf(a, b, x, itmax=300, eps=3e-16):
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c, d = 1.0, 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) > 1e-300 else 1e-300)
    h = d
    for m in range(1, itmax + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d; d = 1.0 / (d if abs(d) > 1e-300 else 1e-300)
        c = 1.0 + aa / c if abs(c) > 1e-300 else 1e300
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d; d = 1.0 / (d if abs(d) > 1e-300 else 1e-300)
        c = 1.0 + aa / c if abs(c) > 1e-300 else 1e300
        de = d * c; h *= de
        if abs(de - 1.0) < eps:
            break
    return h


def _betainc(a, b, x):
    if x <= 0: return 0.0
    if x >= 1: return 1.0
    lb = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1 - x)
    if x < (a + 1) / (a + b + 2):
        return math.exp(lb) * _betacf(a, b, x) / a
    return 1.0 - math.exp(lb) * _betacf(b, a, 1 - x) / b


def t_cdf(t, df):
    x = df / (df + t * t)
    p = 0.5 * _betainc(df / 2.0, 0.5, x)
    return 1.0 - p if t > 0 else p


def t_quantile(q, df):
    lo, hi = 0.0, 1e3
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if t_cdf(mid, df) < q: lo = mid
        else: hi = mid
    return 0.5 * (lo + hi)


# ---------------------------------------------------------------- statistics
def tau_int(x, dt):
    """Integrated autocorrelation time (same units as dt) with Sokal's automatic window (c = 5)."""
    x = np.asarray(x, float); n = len(x)
    if n < 16 or np.std(x) == 0:
        return float('nan')
    y = x - x.mean()
    f = np.fft.rfft(y, n=2 * n)
    acf = np.fft.irfft(f * np.conjugate(f))[:n]
    acf /= acf[0]
    tau = 0.5
    for w in range(1, n):
        tau += acf[w]
        if w >= 5 * tau:
            break
    return tau * dt                     # (0.5 + sum of rho) samples, in time units


def block_stats(t, x, block_ps, min_blocks, conf, rng, n_boot=4000):
    t = np.asarray(t, float); x = np.asarray(x, float)
    ok = np.isfinite(x)
    t, x = t[ok], x[ok]
    if len(t) < 2:
        return {'status': 'insufficient data', 'n_samples': int(len(t)), 'n_blocks': 0, 'reason': 'fewer than 2 samples after the discard'}
    nb = int(math.floor((t[-1] - t[0] + 1e-9) / block_ps))
    res = {'n_samples': int(len(t)), 'span_ps': float(t[-1] - t[0]), 'n_blocks': nb, 'mean_all_samples': float(x.mean())}
    if nb < min_blocks:
        res['status'] = 'insufficient data'
        res['reason'] = f'{nb} blocks of {block_ps:g} ps; at least {min_blocks} required'
        return res
    edges = t[0] + block_ps * np.arange(nb + 1)
    means = np.array([x[(t >= edges[i]) & (t < edges[i + 1])].mean() for i in range(nb)])
    m, se = float(means.mean()), float(means.std(ddof=1) / math.sqrt(nb))
    half = t_quantile(0.5 + conf / 2, nb - 1) * se
    boot = np.array([rng.choice(means, nb, replace=True).mean() for _ in range(n_boot)])
    lo, hi = np.percentile(boot, [100 * (0.5 - conf / 2), 100 * (0.5 + conf / 2)])
    dt = float(np.median(np.diff(t)))
    tau = tau_int(x, dt)
    res.update({'status': 'ok', 'mean': m, 'standard_error': se, 'interval_half_width': half, 'confidence': conf,
                'bootstrap_interval': [float(lo), float(hi)], 'tau_int_ps': tau,
                'block_vs_tau_warning': bool(np.isfinite(tau) and block_ps < 5 * tau)})
    return res


# ---------------------------------------------------------------- I/O
def load_csv(path):
    with open(path, newline='') as f:
        rows = list(csv.DictReader(f))
    if not rows:
        sys.exit('no records in ' + path)
    cols = {}
    for k in rows[0]:
        vals = [r[k] for r in rows]
        try:
            cols[k] = np.array([float(v) if v != '' else np.nan for v in vals])
        except ValueError:
            cols[k] = np.array(vals, dtype=object)
    return cols


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--input', required=True, help='thermo.csv from the Live Water Lab export')
    ap.add_argument('--events', required=True, help='events.json from the same export')
    ap.add_argument('--discard-ps', type=float, default=20.0, help='time dropped after each change (provisional default)')
    ap.add_argument('--block-ps', type=float, default=5.0, help='block length (provisional default)')
    ap.add_argument('--min-blocks', type=int, default=8)
    ap.add_argument('--confidence', type=float, default=0.95)
    ap.add_argument('--seed', type=int, default=20261017, help='seed of the bootstrap cross-check')
    ap.add_argument('--out', default='analysis')
    a = ap.parse_args(argv)
    rng = np.random.default_rng(a.seed)
    d = load_csv(a.input)
    ev = json.load(open(a.events))
    meta, events = ev.get('meta', {}), ev.get('events', [])
    nmol = meta.get('molecules') or next((e.get('molecules') for e in events if e.get('type') == 'start'), None)
    if not nmol:
        sys.exit('molecule count not found in events.json')
    d['PE_per_molecule'] = d['PE_kJ_mol'] / nmol
    t = d['time_ps']
    cuts = sorted({float(e['time_ps']) for e in events if e.get('type') in SPLIT_EVENTS} | {float(t[0])})
    cuts = [c for c in cuts if c < float(t[-1])] + [float(t[-1])]
    segments = []
    for i in range(len(cuts) - 1):
        t0, t1 = cuts[i], cuts[i + 1]
        # a record taken at an event's step describes the state before the event, so it closes the previous segment
        sel = ((t >= t0 - 1e-9) if i == 0 else (t > t0 + 1e-9)) & (t <= t1 + 1e-9)
        if sel.sum() < 2:
            continue
        states = set(d['state'][sel])
        driven = 'driven' in states
        seg = {'index': len(segments), 't_start_ps': t0, 't_end_ps': float(t[sel][-1]), 'n_records': int(sel.sum()),
               'kind': 'driven' if driven else 'free', 'ensemble': str(d['ensemble'][sel][-1]),
               'T_target_K': float(d['T_target_K'][sel][-1]), 'P_target_bar': (None if not np.isfinite(d['P_target_bar'][sel][-1]) else float(d['P_target_bar'][sel][-1])),
               'lj_scale': float(d['lj_scale'][sel][-1])}
        if driven:
            ts = t[sel]
            ft = np.sqrt(d['Ftether_x_pN'][sel] ** 2 + d['Ftether_y_pN'][sel] ** 2 + d['Ftether_z_pN'][sel] ** 2)
            dE = float(d['Eext_kJ_mol'][sel][-1] - d['Eext_kJ_mol'][sel][0])
            dW = float(d['Wdelivered_kJ_mol'][sel][-1] - d['Wdelivered_kJ_mol'][sel][0])
            seg['driven_summary'] = {'duration_ps': float(ts[-1] - ts[0]), 'max_tether_force_pN': float(np.nanmax(ft)),
                                     'protocol_work_kJ_mol': float(d['Wprotocol_kJ_mol'][sel][-1] - d['Wprotocol_kJ_mol'][sel][0]),
                                     'delivered_work_kJ_mol': dW, 'energy_change_kJ_mol': dE, 'energy_balance_residual_kJ_mol': dE - dW,
                                     'mean_T_K_during_drive': float(np.nanmean(d['T_K'][sel])),
                                     'note': 'driven transient: not an equilibrium average'}
        else:
            keep = sel & (t > t0 + a.discard_ps - 1e-9)
            seg['discarded_ps'] = a.discard_ps
            seg['observables'] = {}
            for key, name, unit in OBSERVABLES:
                if key in d:
                    st = block_stats(t[keep], d[key][keep], a.block_ps, a.min_blocks, a.confidence, rng)
                    st['name'], st['unit'] = name, unit
                    seg['observables'][key] = st
        segments.append(seg)
    os.makedirs(a.out, exist_ok=True)
    summary = {'input': os.path.abspath(a.input), 'events': os.path.abspath(a.events), 'molecules': nmol,
               'settings': {'discard_ps': a.discard_ps, 'block_ps': a.block_ps, 'min_blocks': a.min_blocks, 'confidence': a.confidence, 'seed': a.seed},
               'note': 'Sampling defaults are provisional. Intervals describe block means of the retained data; they do not certify equilibrium.',
               'segments': segments}
    with open(os.path.join(a.out, 'summary.json'), 'w') as f:
        json.dump(summary, f, indent=1)
    lines = ['# Live Water Lab analysis', '', f"{nmol} molecules. Discard {a.discard_ps:g} ps after each change; blocks of {a.block_ps:g} ps; "
             f"at least {a.min_blocks} blocks; {100 * a.confidence:g} % intervals (Student t); bootstrap seed {a.seed}.", '']
    for s in segments:
        head = f"## Segment {s['index']}: {s['t_start_ps']:.2f}-{s['t_end_ps']:.2f} ps, {s['kind']}, {s['ensemble'].upper()}, T target {s['T_target_K']:g} K"
        if s['P_target_bar'] is not None: head += f", P target {s['P_target_bar']:g} bar"
        head += f", s = {s['lj_scale']:.2f}"
        lines += [head, '']
        if s['kind'] == 'driven':
            ds = s['driven_summary']
            lines += [f"Driven transient (not averaged): {ds['duration_ps']:.2f} ps, max tether force {ds['max_tether_force_pN']:.3g} pN, "
                      f"protocol work {ds['protocol_work_kJ_mol']:.3g} kJ/mol, delivered {ds['delivered_work_kJ_mol']:.3g} kJ/mol, "
                      f"energy change {ds['energy_change_kJ_mol']:.3g} kJ/mol.", '']
            continue
        lines += ['| Observable | Result | Blocks | tau_int (ps) |', '|---|---|---|---|']
        for key, st in s['observables'].items():
            if st.get('status') == 'ok':
                r = f"{st['mean']:.4g} ± {st['interval_half_width']:.2g} {st['unit']}" + (' (block < 5 tau_int)' if st['block_vs_tau_warning'] else '')
                lines.append(f"| {st['name']} | {r} | {st['n_blocks']} | {st['tau_int_ps']:.3g} |")
            else:
                lines.append(f"| {st['name']} | insufficient data ({st.get('reason', '')}) | {st.get('n_blocks', 0)} | – |")
        lines.append('')
    with open(os.path.join(a.out, 'summary.md'), 'w') as f:
        f.write('\n'.join(lines) + '\n')
    print('\n'.join(lines))
    return summary


if __name__ == '__main__':
    main()
