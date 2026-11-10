#!/usr/bin/env python3
"""Flow benchmark: independent reference implementation (check P9 of tools/continuum/flow/TOLERANCES.md).

It does not use the closed-form profile or flow-rate formulas of lab/continuum/flow/core.js. It starts from the force
balance on a coaxial cylinder of liquid, tau(r) = G r / 2, with Newtonian stress mu du/dr = -tau, and integrates
numerically: the profile from the boundary value inward, and the flow rate as 2 pi int u r dr. The wall value is either a
given slip velocity or the Navier condition u(R) = L_s |du/dr|(R). The entrance-resistance sensitivity is computed from
resistances obtained numerically (R_tube = dP / Q at the given slip length) plus the series term c mu / R^3.

Usage: python3 reference_flow.py [cases.json] [out.json]
"""
import json
import os
import sys
from math import pi

import scipy
from scipy.integrate import quad

HERE = os.path.dirname(os.path.abspath(__file__))
CASES = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', '..', 'lab', 'continuum', 'flow', 'data', 'cases.json')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, '..', 'results', 'flow_python.json')


def shear_rate(r, G, mu):
    """|du/dr| at radius r from the force balance."""
    return G * r / (2.0 * mu)


def velocity(r, R, G, mu, wall):
    """u(r) = u(R) + int_r^R |du/dr| ds, by quadrature."""
    inc, _ = quad(shear_rate, r, R, args=(G, mu), epsabs=0, epsrel=1e-13)
    return wall + inc


def flow_rate(R, G, mu, wall):
    val, _ = quad(lambda r: 2.0 * pi * r * velocity(r, R, G, mu, wall), 0.0, R, epsabs=0, epsrel=1e-12)
    return val


def solve(family, R, L, dP, mu, us, ends_c=None):
    G0 = dP / L
    wall0 = us if family == 'slip_velocity' else 0.0
    fraction = 1.0
    if ends_c is not None:
        # slip length that gives the wall value at the undisturbed gradient (Navier condition), then resistances in series
        Ls = wall0 / shear_rate(R, G0, mu)
        q_unit = flow_rate(R, 1.0, mu, Ls * shear_rate(R, 1.0, mu))      # flow per unit gradient at that slip length
        r_tube = L / q_unit
        r_ends = ends_c * mu / R ** 3
        fraction = r_tube / (r_tube + r_ends)
    G = fraction * G0
    wall = fraction * wall0
    Q = flow_rate(R, G, mu, wall)
    return {'Q_m3_s': Q, 'mean_velocity_m_s': Q / (pi * R * R), 'interior_fraction': fraction,
            'wall_velocity_m_s': wall, 'gradient_Pa_m': G, '_args': (R, G, mu, wall)}


def main():
    cases = json.load(open(CASES, encoding='utf-8'))
    out = {'program': 'reference_flow.py', 'method': 'force balance and numerical quadrature (scipy.integrate.quad)',
           'environment': 'Python %d.%d.%d, SciPy %s' % (sys.version_info[0], sys.version_info[1], sys.version_info[2], scipy.__version__), 'cases': {}}
    for cs in cases['cases']:
        if not cs.get('enabled'):
            continue
        rec = {}
        dP = cs['drives'][0]['dP_MPa']['value'] * 1e6
        for length in ('default', 'alt'):
            L = (cs['geometry']['L_nm']['value'] if length == 'default' else cs['geometry']['L_nm']['alt']) * 1e-9
            for family in ('classical', 'slip_velocity'):
                for boundary in ('D', 'Dp'):
                    R = 0.5 * cs['geometry'][boundary + '_nm']['value'] * 1e-9
                    us = cs['slip_velocity_m_s'][boundary]['value'] if family == 'slip_velocity' else 0.0
                    for vkey, v in cs['viscosity_mPa_s'].items():
                        mu = v['value'] * 1e-3
                        for ends in (None, 3.0):
                            s = solve(family, R, L, dP, mu, us, ends)
                            prof = [velocity(r * 1e-9, *s['_args']) if r * 1e-9 <= R else None
                                    for r in cs['md']['profile']['r_nm']]
                            key = '|'.join([length, family, boundary, vkey, 'ends' if ends else 'no_ends'])
                            rec[key] = {'Q_m3_s': s['Q_m3_s'], 'mean_velocity_m_s': s['mean_velocity_m_s'],
                                        'interior_fraction': s['interior_fraction'], 'profile_m_s': prof}
        out['cases'][cs['id']] = rec
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, indent=1)
        fh.write('\n')
    print('wrote', os.path.normpath(OUT), 'with', sum(len(v) for v in out['cases'].values()), 'combinations')


if __name__ == '__main__':
    main()
