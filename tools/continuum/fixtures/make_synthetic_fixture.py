#!/usr/bin/env python3
"""SYNTHETIC crossing-count fixtures for testing analyze_pore_flux.py. NOT scientific evidence: these numbers are
generated from a declared conductance and must never enter an evidence table or become a pore law.

Model: independent forward and backward crossings (Poisson) of one pore. At zero drive each direction occurs at the
rate k0 = G k_B T / v_w^2, so the zero-drive fluctuations obey the same fluctuation-dissipation relation the analysis
checks; at drive dP the net rate is j = G dP / v_w, split as k_f = j/2 + sqrt(j^2/4 + k0^2), k_b = k_f - j.
The second plane sees the same crossings with a random delay of up to 2 ps (single-file transit), so the long-time
fluxes agree. Units: SI for G and dP; time in ps.

  python3 make_synthetic_fixture.py --kind good    --out DIR  # should be accepted; its interval should contain G
  python3 make_synthetic_fixture.py --kind short   --out DIR  # too short: insufficient data (exit 2 expected)
  python3 make_synthetic_fixture.py --kind offset  --out DIR  # non-zero intercept: acceptance must fail (exit 1)

Equilibrium-gate fixtures (test A4). They contain exactly the driven runs of 'good'; only the zero-drive runs differ:
  --kind noeq     zero-drive counts held at zero (no equilibrium crossing fluctuations)
  --kind eqhot    zero-drive crossings at four times the fluctuation-dissipation rate
  --kind recross  'good' zero-drive crossings plus rapid back-and-forth recrossings of the counting planes (a two-state
                  telegraph term switching 0.5 times per ps: block-variance offset 0.5, long-time D_N unchanged)
"""
import argparse, csv, json, math, os, random

M_W, KB, RHO, T = 2.991506e-26, 1.380649e-23, 996.557, 300.0
VW = M_W / RHO
CONDS = [('zero', 0.0, 'zero'), ('m100', -100e6, 'fit'), ('p050', 50e6, 'fit'), ('p100', 100e6, 'fit'), ('p150', 150e6, 'fit'), ('p200', 200e6, 'heldout')]
PLANES = (('mid', 0.0), ('entrance', 2.0))


def poisson_times(rate_per_ps, t_end, rng):
    t, out = 0.0, []
    if rate_per_ps <= 0: return out
    while True:
        t += rng.expovariate(rate_per_ps)
        if t > t_end: return out
        out.append(t)


def run_rows(cid, dP, rep, kf, kb, dur, rng, telegraph=None, planes=PLANES):
    """Sampled cumulative counts (one sample per ps) at both planes for one run; telegraph = (rate, rng) adds a
    bounded two-state term s(t) - s(0) per plane (rapid recrossings that do not change the long-time flux)."""
    fw, bw = poisson_times(kf, dur, rng), poisson_times(kb, dur, rng)
    events = sorted([(t, 1) for t in fw] + [(t, -1) for t in bw])
    out = []
    for plane, delay in planes:
        ev = sorted((t + rng.uniform(0, delay), s) for t, s in events)
        n, k, run = 0, 0, '%s_r%d' % (cid, rep)
        s0 = s = 0; flips = poisson_times(telegraph[0], dur, telegraph[1]) if telegraph else []; f = 0
        if telegraph: s0 = s = telegraph[1].randint(0, 1)
        for step in range(int(dur) + 1):
            t = float(step)
            while k < len(ev) and ev[k][0] <= t: n += ev[k][1]; k += 1
            while f < len(flips) and flips[f] <= t: s = 1 - s; f += 1
            out.append([run, rep, t, cid, dP, 101325.0, T, n + (s - s0), plane])
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--kind', choices=['good', 'short', 'offset', 'noeq', 'eqhot', 'recross'], default='good')
    ap.add_argument('--G', type=float, default=1.0e-27, help='declared conductance, m^3 Pa^-1 s^-1 (default 1e-27)')
    ap.add_argument('--out', required=True, help='output directory')
    ap.add_argument('--seed', type=int, default=20261018)
    a = ap.parse_args()
    base = a.kind if a.kind in ('good', 'short', 'offset') else 'good'      # the gate fixtures reuse the 'good' draws
    rng = random.Random(a.seed + {'good': 0, 'short': 1, 'offset': 2}[base])
    alt = random.Random(a.seed + 100 + ['noeq', 'eqhot', 'recross'].index(a.kind)) if base != a.kind else None
    os.makedirs(a.out, exist_ok=True)
    k0 = a.G * KB * T / VW ** 2 * 1e-12                       # per ps
    dur = 300.0 if a.kind == 'short' else 20000.0            # ps per run
    offset = 0.6 if a.kind == 'offset' else 0.0              # extra net crossings per ns, independent of drive
    rows = []
    for cid, dP, role in CONDS:
        for rep in range(1, 5):
            j = a.G * dP / VW * 1e-12 + offset * 1e-3
            kf = j / 2 + math.sqrt(j * j / 4 + k0 * k0); kb = kf - j
            r = run_rows(cid, dP, rep, kf, kb, dur, rng)        # always drawn, so the driven runs are identical to 'good'
            if dP == 0 and alt is not None:
                if a.kind == 'noeq':
                    for row in r: row[7] = 0
                elif a.kind == 'eqhot':
                    r = run_rows(cid, dP, rep, 4 * k0, 4 * k0, dur, alt)
                elif a.kind == 'recross':
                    tele = run_rows(cid, dP, rep, 0.0, 0.0, dur, alt, telegraph=(0.5, alt))
                    for row, tr in zip(r, tele): row[7] += tr[7]
            rows += r
    path = os.path.join(a.out, 'SYNTHETIC_%s_crossings.csv' % a.kind)
    with open(path, 'w', newline='') as f:
        w = csv.writer(f); w.writerow(['run_id', 'replica_id', 'time_ps', 'condition_id', 'drive_Pa', 'mean_pressure_Pa', 'temperature_K', 'cumulative_crossings', 'sampling_plane_id']); w.writerows(rows)
    man = {'label': 'SYNTHETIC FIXTURE - not scientific evidence', 'synthetic': True, 'declaredG_m3_Pa_s': a.G, 'kind': a.kind,
           'referenceDensity_kg_m3': RHO, 'temperature_K': T, 'planes': [{'id': 'mid', 'z_A': 12.3}, {'id': 'entrance', 'z_A': 3.0}],
           'conditions': [{'condition_id': c, 'drive_Pa': d, 'role': r} for c, d, r in CONDS], 'lawId': 'synthetic-not-a-law', 'sourceKind': 'synthetic_fixture'}
    json.dump(man, open(os.path.join(a.out, 'SYNTHETIC_%s_manifest.json' % a.kind), 'w'), indent=1)
    print('wrote', path, '(%d rows); zero-drive crossing rate per direction %.3f per ns' % (len(rows), (4 if a.kind == 'eqhot' else 0 if a.kind == 'noeq' else 1) * k0 * 1e3))


if __name__ == '__main__':
    main()
