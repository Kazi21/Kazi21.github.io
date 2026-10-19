#!/usr/bin/env python3
"""Build the LAMMPS data file for the (6,6) CNT membrane calibration (Continuum Lab pore law).

Geometry (all lengths in angstrom in the data file; SI in the manifest):
  - (6,6) armchair CNT, carbon-centre radius a*sqrt(n^2+nm+m^2)/(2 pi) with a = sqrt(3)*1.42 A (= 4.068 A),
    length 10 armchair unit cells = 24.595 A, axis along z through the centre of the x-y cell;
  - two graphene sheets sealing the membrane at the tube ends, with a hole of radius R + 1.4 A around the tube
    (no water path except the tube interior);
  - rectangular graphene cell: Lx = 12 * 2.4595 A, Ly = 7 * 4.26 A (about 2.95 nm x 2.98 nm; the MD lateral cell
    is recorded in the manifest because it sets the pore density of the calibration system);
  - one periodic water region of thickness --water (default 40 A) outside the membrane; z periodic, so the two
    membrane faces see the two ends of the same reservoir and a force slab inside it drives the flow.
Water: rigid SPC/E (O-H 1.0 A, H-O-H 109.47 deg, q_O = -0.8476 e), placed on a lattice with random orientations at
--density g/cm^3 of the accessible volume (1.5 A excluded next to each sheet). The tube starts empty: it fills during
equilibration, which must be verified (count of molecules inside the tube vs time) before production; filling a
sub-nanometre tube by bulk-density arithmetic is not done.
Carbon: fixed positions (not integrated), carbon-carbon interactions excluded; water-carbon LJ on O only
(Werder et al. 2003: eps_CO = 0.3913 kJ/mol = 0.09352 kcal/mol, sigma_CO = 3.190 A); see in.calibrate.lmp.

Usage: python3 build_membrane.py [--water 40] [--density 0.997] [--seed 20261018] [--out membrane.data]
Writes the data file and a JSON summary (geometry, counts, SHA-256) next to it.
"""
import argparse, hashlib, json, math, random

B_CC = 1.42                      # A, C-C bond
A_LAT = math.sqrt(3) * B_CC      # A, graphene lattice constant
N_CHIR = 6
N_CELLS = 10
R_TUBE = A_LAT * math.sqrt(3 * N_CHIR ** 2) / (2 * math.pi)   # (n,n): n^2 + n^2 + n^2 = 3 n^2
L_TUBE = N_CELLS * A_LAT
LX, LY = 12 * A_LAT, 7 * math.sqrt(3) * A_LAT
M_O, M_H, M_C = 15.9994, 1.008, 12.011
Q_O, Q_H = -0.8476, 0.4238


def cnt_atoms():
    """(n,n) armchair tube by rolling graphene: lattice a1 = (a, 0), a2 = (a/2, 1.5 b), basis (0,0), (0,b)."""
    a1, a2, basis = (A_LAT, 0.0), (A_LAT / 2, 1.5 * B_CC), [(0.0, 0.0), (0.0, B_CC)]
    ch = (N_CHIR * a1[0] + N_CHIR * a2[0], N_CHIR * a1[1] + N_CHIR * a2[1])
    lch = math.hypot(*ch)
    t = (a2[0] - a1[0], a2[1] - a1[1]); lt = math.hypot(*t)
    u, v = (ch[0] / lch, ch[1] / lch), (t[0] / lt, t[1] / lt)
    out = []
    for i in range(-40, 41):
        for j in range(-40, 41):
            for bx, by in basis:
                px, py = i * a1[0] + j * a2[0] + bx, i * a1[1] + j * a2[1] + by
                s, h = px * u[0] + py * u[1], px * v[0] + py * v[1]
                if -1e-6 <= s < lch - 1e-6 and -1e-6 <= h < N_CELLS * lt - 1e-6:
                    th = 2 * math.pi * s / lch
                    out.append((R_TUBE * math.cos(th), R_TUBE * math.sin(th), h))
    assert len(out) == 4 * N_CHIR * N_CELLS, len(out)
    return out


def sheet_atoms(z, hole):
    """Graphene sheet in the rectangular cell (a, sqrt(3) a, 4 atoms), centred hole of radius `hole` around (0,0)."""
    cell = [(0.0, 0.0), (0.0, B_CC), (A_LAT / 2, 1.5 * B_CC), (A_LAT / 2, 2.5 * B_CC)]   # cell (a, 3b), each atom 3-coordinated
    out = []
    nx, ny = round(LX / A_LAT), round(LY / (3 * B_CC))
    for i in range(nx):
        for j in range(ny):
            for cx, cy in cell:
                x, y = i * A_LAT + cx - LX / 2, j * 3 * B_CC + cy - LY / 2
                if math.hypot(x, y) > hole:
                    out.append((x, y, z))
    return out


def water_molecule(rng):
    """Rigid SPC/E geometry with a random orientation (uniform rotation)."""
    th = math.radians(109.47) / 2
    h1, h2 = (math.sin(th), 0.0, math.cos(th)), (-math.sin(th), 0.0, math.cos(th))
    q = [rng.gauss(0, 1) for _ in range(4)]; nq = math.sqrt(sum(x * x for x in q)); w, x, y, z = (c / nq for c in q)
    R = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    rot = lambda p: tuple(sum(R[r][c] * p[c] for c in range(3)) for r in range(3))
    return rot(h1), rot(h2)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--water', type=float, default=40.0, help='water region thickness along z, A (default 40)')
    ap.add_argument('--density', type=float, default=0.997, help='water density in the accessible volume, g/cm^3 (default 0.997)')
    ap.add_argument('--seed', type=int, default=20261018, help='random seed for orientations (default 20261018)')
    ap.add_argument('--out', default='membrane.data', help='LAMMPS data file to write (default membrane.data)')
    a = ap.parse_args()
    rng = random.Random(a.seed)
    z1, z2 = 0.0, L_TUBE
    carbons = cnt_atoms() + sheet_atoms(z1, R_TUBE + 1.4) + sheet_atoms(z2, R_TUBE + 1.4)
    gap = 3.2                                         # A between a sheet and the first water layer
    lz = L_TUBE + 2 * gap + a.water
    zw0, zw1 = z2 + gap, z2 + gap + a.water           # water region (above the upper sheet, wrapping to below the lower)
    acc = LX * LY * (a.water + 2 * gap - 2 * 1.5)     # accessible volume (A^3): 1.5 A excluded next to each sheet
    nwat = int(round(a.density * 6.02214076e23 * acc * 1e-24 / 18.015268))
    # lattice positions in the water slab
    nxw = max(1, round(LX / 3.1)); nyw = max(1, round(LY / 3.1))
    nzw = math.ceil(nwat / (nxw * nyw))
    dzw = a.water / nzw
    sites = [((i + 0.5) * LX / nxw - LX / 2, (j + 0.5) * LY / nyw - LY / 2, zw0 + (k + 0.5) * dzw) for k in range(nzw) for j in range(nyw) for i in range(nxw)]
    rng.shuffle(sites); sites = sorted(sites[:nwat], key=lambda p: (p[2], p[1], p[0]))
    atoms, bonds, angles = [], [], []
    for x, y, z in carbons:
        atoms.append((1, 3, 0.0, x, y, z))            # molecule 1 = membrane carbon, type 3
    mol = 1
    for (x, y, z) in sites:
        mol += 1
        h1, h2 = water_molecule(rng)
        io = len(atoms) + 1
        atoms.append((mol, 1, Q_O, x, y, z))
        atoms.append((mol, 2, Q_H, x + h1[0], y + h1[1], z + h1[2]))
        atoms.append((mol, 2, Q_H, x + h2[0], y + h2[1], z + h2[2]))
        bonds.append((1, io, io + 1)); bonds.append((1, io, io + 2)); angles.append((1, io + 1, io, io + 2))
    zlo = zw1 - lz                                    # box [z1 - gap, zw1): lower gap, membrane, upper gap, water
    zhi = zlo + lz
    lines = ['LAMMPS data file: (6,6) CNT membrane with SPC/E water, Continuum Lab calibration package (build_membrane.py)', '',
             f'{len(atoms)} atoms', f'{len(bonds)} bonds', f'{len(angles)} angles', '', '3 atom types', '1 bond types', '1 angle types', '',
             f'{-LX / 2:.6f} {LX / 2:.6f} xlo xhi', f'{-LY / 2:.6f} {LY / 2:.6f} ylo yhi', f'{zlo:.6f} {zhi:.6f} zlo zhi', '',
             'Masses', '', f'1 {M_O}  # water O', f'2 {M_H}  # water H', f'3 {M_C}  # carbon', '', 'Atoms  # full', '']
    for k, (m, t, q, x, y, z) in enumerate(atoms, 1):
        zz = z
        while zz < zlo: zz += lz
        while zz >= zhi: zz -= lz
        lines.append(f'{k} {m} {t} {q:.4f} {x:.6f} {y:.6f} {zz:.6f}')
    lines += ['', 'Bonds', ''] + [f'{k} {b[0]} {b[1]} {b[2]}' for k, b in enumerate(bonds, 1)]
    lines += ['', 'Angles', ''] + [f'{k} {g[0]} {g[1]} {g[2]} {g[3]}' for k, g in enumerate(angles, 1)]
    text = '\n'.join(lines) + '\n'
    open(a.out, 'w').write(text)
    summary = {
        'file': a.out, 'sha256': hashlib.sha256(text.encode()).hexdigest(), 'seed': a.seed,
        'chirality': [N_CHIR, N_CHIR], 'carbonCentreRadius_A': R_TUBE, 'tubeLength_A': L_TUBE, 'tubeAxis': [0.0, 0.0],
        'tubeZ_A': [z1, z2], 'sheetHoleRadius_A': R_TUBE + 1.4, 'cell_A': [LX, LY, lz], 'lateralCellArea_m2': LX * LY * 1e-20,
        'equivalentPitch_m': math.sqrt(LX * LY) * 1e-10, 'carbons': len(carbons), 'waters': nwat, 'atoms': len(atoms),
        'waterRegion_A': [zw0, zw1], 'accessibleVolume_A3': acc, 'density_g_cm3': a.density,
        'note': 'the tube starts empty and must fill during equilibration; carbon atoms are fixed',
    }
    json.dump(summary, open(a.out.rsplit('.', 1)[0] + '.json', 'w'), indent=1)
    print(json.dumps({k: summary[k] for k in ('atoms', 'waters', 'carbons', 'cell_A', 'carbonCentreRadius_A', 'tubeLength_A')}))


if __name__ == '__main__':
    main()
