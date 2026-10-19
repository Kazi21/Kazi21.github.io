#!/usr/bin/env python3
"""Check source/sink/interface flux balance of an exported Continuum Lab experiment (unzipped "Download experiment").

Recomputes, from the exported raw data (SI units):
  Q_in   = - sum of the MAC normal velocities on the inlet port faces x face area     (fields/mac_boundaries.json)
  Q_out  = - sum on the outlet port faces x face area                                  (flow is in -z)
  Q_mem  = sum over membrane faces of J_c A_c                                          (membrane.csv)
and checks: |Q_in - Q_out| / Q_in, |Q_in - Q_mem| / Q_in and |Q_mem - Q(results.json)| / Q all <= --tol (default 1e-6);
J = 0 exactly on closed faces; J consistent between membrane.csv and mac_boundaries.json; passive membrane
dissipation sum A_c J_c dPi_c >= -1e-12 |dP Q|. At zero flow the absolute balance must be below 1e-30 m^3/s.
Exit status 1 if any check fails (the report lists them).

Usage: python3 check_conservation.py EXPORT_DIR [--tol 1e-6]
"""
import argparse, csv, json, os, sys


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('export', help='unzipped export folder')
    ap.add_argument('--tol', type=float, default=1e-6, help='relative tolerance for the flow balances (default 1e-6)')
    a = ap.parse_args()
    d = a.export
    res = json.load(open(os.path.join(d, 'results.json')))
    mac = json.load(open(os.path.join(d, 'fields', 'mac_boundaries.json')))
    sc = json.load(open(os.path.join(d, 'scenario.json')))['scenario']
    A = mac['faceArea_m2']
    qin = -sum(mac['inletW_m_s']) * A
    qout = -sum(mac['outletW_m_s']) * A
    rows = list(csv.DictReader(open(os.path.join(d, 'membrane.csv'))))
    qmem = sum(float(r['J_m_s']) * float(r['face_area_m2']) for r in rows)
    passive = sum(float(r['J_m_s']) * float(r['face_area_m2']) * (0.0 if r['closed'] in ('1', 'True', 'true') else float(r['dPi_Pa'])) for r in rows)
    closed_bad = [(r['i'], r['j'], r['J_m_s']) for r in rows if r['closed'] in ('1', 'True', 'true') and float(r['J_m_s']) != 0.0]
    jdiff = max(abs(float(r['J_m_s']) - mac['membraneJ_m_s'][k]) for k, r in enumerate(rows)) if rows else 0.0
    Q = res['Q_m3_s']
    checks = []
    def rel(x, y):
        return abs(x - y) / abs(y) if y != 0 else abs(x - y)
    if Q == 0 and qin == 0:
        checks.append(('zero flow: absolute balance', abs(qin - qout) <= 1e-30 and abs(qmem) <= 1e-30, '|Q_in - Q_out| = %.3e m^3/s' % abs(qin - qout)))
    else:
        checks.append(('|Q_in - Q_out| / Q_in', rel(qout, qin) <= a.tol, '%.3e' % rel(qout, qin)))
        checks.append(('|Q_in - Q_membrane| / Q_in', rel(qmem, qin) <= a.tol, '%.3e' % rel(qmem, qin)))
        checks.append(('|Q_membrane - Q(results.json)| / Q', rel(qmem, Q) <= a.tol, '%.3e' % rel(qmem, Q)))
    checks.append(('J = 0 on closed faces', not closed_bad, '%d closed faces with non-zero J' % len(closed_bad)))
    checks.append(('J in membrane.csv equals the raw MAC flux', jdiff <= 1e-12 * max(abs(float(r['J_m_s'])) for r in rows) if rows else True, 'max difference %.3e m/s' % jdiff))
    checks.append(('passive membrane dissipation sum A J dPi >= 0', passive >= -1e-12 * abs(sc['dP_Pa'] * Q), '%.4e W' % passive))
    ok = all(c[1] for c in checks)
    for name, p, det in checks:
        print(('PASS ' if p else 'FAIL ') + name + ': ' + det)
    print('Q_in %.10e, Q_out %.10e, Q_membrane %.10e, results.json %.10e m^3/s' % (qin, qout, qmem, Q))
    print('conservation: ' + ('PASS' if ok else 'FAIL'))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
