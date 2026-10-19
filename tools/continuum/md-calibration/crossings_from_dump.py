#!/usr/bin/env python3
"""Convert a LAMMPS crossing dump (in.calibrate.lmp: oxygens near the tube, every 100 fs) into the crossing-count CSV
read by analyze_pore_flux.py.

A crossing of plane z_p is counted between consecutive frames for every molecule present in both: +1 when it moves
from z < z_p to z >= z_p (along +z, the drive direction), -1 for the reverse. Planes lie inside the tube, where the
window region holds every molecule that can cross them; the dump interval (0.1 ps) is far shorter than the time a
molecule needs to cross the 4 A margin of the window, so no crossing is missed.
The drive is dP = <N_slab> fz / A with fz in kcal mol^-1 A^-1 (1 kcal mol^-1 A^-1 = 6.9477e-11 N), <N_slab> from the
ave/time file of the run and A = Lx Ly from the dump box; the mean reservoir pressure is the time average of the bulk
pressure diagnostic (atm -> Pa). Units out: time in ps, drive and pressure in Pa, temperature in K.

Usage: python3 crossings_from_dump.py --dump cross.TAG.dump --thermo thermo.TAG.txt --fz 0.010 --run TAG --replica 1
       --condition p100 [--planes mid=12.30,entrance=3.00] [--dt-fs 1.0] [--discard-ps 0] --out TAG.csv
"""
import argparse, csv, sys

KCALMOLA_TO_N = 6.9477e-11
ATM = 101325.0


def frames(path):
    with open(path) as f:
        while True:
            line = f.readline()
            if not line: return
            if not line.startswith('ITEM: TIMESTEP'): continue
            step = int(f.readline()); f.readline(); n = int(f.readline())
            f.readline(); bx = [list(map(float, f.readline().split()[:2])) for _ in range(3)]
            cols = f.readline().split()[2:]
            iid, iz = cols.index('id'), cols.index('z')
            zs = {}
            for _ in range(n):
                p = f.readline().split(); zs[int(p[iid])] = float(p[iz])
            yield step, bx, zs


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dump', required=True); ap.add_argument('--thermo', required=True)
    ap.add_argument('--fz', type=float, required=True, help='force per molecule in the slab, kcal mol^-1 A^-1')
    ap.add_argument('--run', required=True); ap.add_argument('--replica', required=True); ap.add_argument('--condition', required=True)
    ap.add_argument('--planes', default='mid=12.30,entrance=3.00', help='name=z_A pairs (default mid=12.30,entrance=3.00)')
    ap.add_argument('--dt-fs', type=float, default=1.0, help='MD time step, fs (default 1.0)')
    ap.add_argument('--discard-ps', type=float, default=0.0, help='ignored at the start for the drive and pressure averages, ps')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    planes = [(kv.split('=')[0], float(kv.split('=')[1])) for kv in a.planes.split(',')]
    # thermo averages (ave/time file: TimeStep v_nslab v_ntube v_pbulk c_tw c_txy)
    ns, pb, tw, tx = [], [], [], []
    for line in open(a.thermo):
        if line.startswith('#') or not line.strip(): continue
        v = line.split()
        if float(v[0]) * a.dt_fs / 1000 < a.discard_ps: continue
        ns.append(float(v[1])); pb.append(float(v[3])); tw.append(float(v[4])); tx.append(float(v[5]))
    if not ns: sys.exit('no thermo samples after the discarded period')
    rows, prev, counts, area = [], None, {p[0]: 0 for p in planes}, None
    for step, bx, zs in frames(a.dump):
        if area is None: area = (bx[0][1] - bx[0][0]) * (bx[1][1] - bx[1][0]) * 1e-20
        if prev is not None:
            for mid in zs.keys() & prev.keys():
                z0, z1 = prev[mid], zs[mid]
                for name, zp in planes:
                    if z0 < zp <= z1: counts[name] += 1
                    elif z1 < zp <= z0: counts[name] -= 1
        prev = zs
        t = step * a.dt_fs / 1000.0
        rows.append((t, dict(counts)))
    nslab = sum(ns) / len(ns)
    drive = nslab * a.fz * KCALMOLA_TO_N / area
    pmean = sum(pb) / len(pb) * ATM
    temp = sum(tx) / len(tx) if a.fz != 0 else sum(tw) / len(tw)
    with open(a.out, 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['run_id', 'replica_id', 'time_ps', 'condition_id', 'drive_Pa', 'mean_pressure_Pa', 'temperature_K', 'cumulative_crossings', 'sampling_plane_id'])
        t0 = rows[0][0] if rows else 0.0
        for t, c in rows:
            for name, _ in planes:
                w.writerow([a.run, a.replica, '%.3f' % (t - t0), a.condition, '%.6e' % drive, '%.6e' % pmean, '%.3f' % temp, c[name], name])
    print('%s: %d frames, drive %.4g MPa (<N_slab> = %.2f, A = %.4g m^2), mean reservoir pressure %.4g MPa, T %.2f K, net crossings %s'
          % (a.run, len(rows), drive / 1e6, nslab, area, pmean / 1e6, temp, {k: v for k, v in counts.items()}))


if __name__ == '__main__':
    main()
