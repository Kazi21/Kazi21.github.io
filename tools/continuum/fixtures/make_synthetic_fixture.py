#!/usr/bin/env python3
"""SYNTHETIC crossing-count fixtures for testing analyze_pore_flux.py. NOT scientific evidence: these numbers are
generated from a declared conductance and must never enter an evidence table or become a pore law.

Model: independent forward and backward crossings (Poisson) of one pore. At zero drive each direction occurs at the
rate k0 = G k_B T / v_w^2, so the zero-drive fluctuations obey the same fluctuation-dissipation relation the analysis
checks; at drive dP the net rate is j = G dP / v_w, split as k_f = j/2 + sqrt(j^2/4 + k0^2), k_b = k_f - j.
The second plane sees the same crossings with a random delay of up to 2 ps (single-file transit), so the long-time
fluxes agree. Units: SI for G and dP; time in ps.

  python3 make_synthetic_fixture.py --kind good   --out DIR   # should be accepted; its interval should contain G
  python3 make_synthetic_fixture.py --kind short  --out DIR   # too short: insufficient data (exit 2 expected)
  python3 make_synthetic_fixture.py --kind offset --out DIR   # non-zero intercept: acceptance must fail (exit 1)
"""
import argparse, csv, json, math, os, random

M_W, KB, RHO, T = 2.991506e-26, 1.380649e-23, 996.557, 300.0
VW = M_W / RHO


def poisson_times(rate_per_ps, t_end, rng):
    t, out = 0.0, []
    if rate_per_ps <= 0: return out
    while True:
        t += rng.expovariate(rate_per_ps)
        if t > t_end: return out
        out.append(t)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--kind', choices=['good', 'short', 'offset'], default='good')
    ap.add_argument('--G', type=float, default=1.0e-27, help='declared conductance, m^3 Pa^-1 s^-1 (default 1e-27)')
    ap.add_argument('--out', required=True, help='output directory')
    ap.add_argument('--seed', type=int, default=20261018)
    a = ap.parse_args()
    rng = random.Random(a.seed + {'good': 0, 'short': 1, 'offset': 2}[a.kind])
    os.makedirs(a.out, exist_ok=True)
    k0 = a.G * KB * T / VW ** 2 * 1e-12                       # per ps
    dur = 300.0 if a.kind == 'short' else 20000.0            # ps per run
    conds = [('zero', 0.0, 'zero'), ('m100', -100e6, 'fit'), ('p050', 50e6, 'fit'), ('p100', 100e6, 'fit'), ('p150', 150e6, 'fit'), ('p200', 200e6, 'heldout')]
    offset = 0.6 if a.kind == 'offset' else 0.0              # extra net crossings per ns, independent of drive
    rows = []
    for cid, dP, role in conds:
        for rep in range(1, 5):
            j = a.G * dP / VW * 1e-12 + offset * 1e-3
            kf = j / 2 + math.sqrt(j * j / 4 + k0 * k0); kb = kf - j
            fw, bw = poisson_times(kf, dur, rng), poisson_times(kb, dur, rng)
            events = sorted([(t, 1) for t in fw] + [(t, -1) for t in bw])
            for plane, delay in (('mid', 0.0), ('entrance', 2.0)):
                ev = sorted((t + rng.uniform(0, delay), s) for t, s in events)
                n, k, run = 0, 0, '%s_r%d' % (cid, rep)
                for step in range(int(dur) + 1):                # one sample per ps
                    t = float(step)
                    while k < len(ev) and ev[k][0] <= t: n += ev[k][1]; k += 1
                    rows.append([run, rep, t, cid, dP, 101325.0, T, n, plane])
    path = os.path.join(a.out, 'SYNTHETIC_%s_crossings.csv' % a.kind)
    with open(path, 'w', newline='') as f:
        w = csv.writer(f); w.writerow(['run_id', 'replica_id', 'time_ps', 'condition_id', 'drive_Pa', 'mean_pressure_Pa', 'temperature_K', 'cumulative_crossings', 'sampling_plane_id']); w.writerows(rows)
    man = {'label': 'SYNTHETIC FIXTURE - not scientific evidence', 'synthetic': True, 'declaredG_m3_Pa_s': a.G, 'kind': a.kind,
           'referenceDensity_kg_m3': RHO, 'temperature_K': T, 'planes': [{'id': 'mid', 'z_A': 12.3}, {'id': 'entrance', 'z_A': 3.0}],
           'conditions': [{'condition_id': c, 'drive_Pa': d, 'role': r} for c, d, r in conds], 'lawId': 'synthetic-not-a-law', 'sourceKind': 'synthetic_fixture'}
    json.dump(man, open(os.path.join(a.out, 'SYNTHETIC_%s_manifest.json' % a.kind), 'w'), indent=1)
    print('wrote', path, '(%d rows); zero-drive crossing rate per direction %.3f per ns' % (len(rows), k0 * 1e3))


if __name__ == '__main__':
    main()
