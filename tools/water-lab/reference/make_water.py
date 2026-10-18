"""Write a LAMMPS data file (atom_style full) of N rigid SPC/E water molecules on a cubic grid with random
orientations, at a target density. Geometry from the LAMMPS SPC/E reference: O-H 1.0 Å, H-O-H 109.47°.
Usage: python make_water.py N density_g_cm3 seed out.data"""
import math, sys
import numpy as np

N, rho, seed, out = int(sys.argv[1]), float(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
mO, mH = 15.9994, 1.008
qO, qH = -0.8476, 0.4238
NA = 6.02214076e23
L = (N * (mO + 2 * mH) / NA / rho) ** (1 / 3) * 1e8          # Å
n = math.ceil(N ** (1 / 3))
a = L / n
rng = np.random.default_rng(seed)
theta = math.radians(109.47)
# molecule frame: O at origin, H in the xz plane symmetric about z
h1 = np.array([math.sin(theta / 2), 0.0, math.cos(theta / 2)])
h2 = np.array([-math.sin(theta / 2), 0.0, math.cos(theta / 2)])

def rand_rot():
    q = rng.normal(size=4); q /= np.linalg.norm(q)
    w, x, y, z = q
    return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                     [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                     [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])

sites = [(i, j, k) for i in range(n) for j in range(n) for k in range(n)]
rng.shuffle(sites)
atoms, bonds, angles = [], [], []
for m in range(N):
    i, j, k = sites[m]
    O = (np.array([i, j, k]) + 0.5) * a
    R = rand_rot()
    H1, H2 = O + R @ h1, O + R @ h2
    base = 3 * m
    atoms += [(base + 1, m + 1, 1, qO, *O), (base + 2, m + 1, 2, qH, *H1), (base + 3, m + 1, 2, qH, *H2)]
    bonds += [(2 * m + 1, 1, base + 1, base + 2), (2 * m + 2, 1, base + 1, base + 3)]
    angles += [(m + 1, 1, base + 2, base + 1, base + 3)]

with open(out, "w") as f:
    f.write(f"SPC/E water, {N} molecules, density {rho} g/cm3, seed {seed}\n\n")
    f.write(f"{len(atoms)} atoms\n{len(bonds)} bonds\n{len(angles)} angles\n\n2 atom types\n1 bond types\n1 angle types\n\n")
    f.write(f"0.0 {L:.10f} xlo xhi\n0.0 {L:.10f} ylo yhi\n0.0 {L:.10f} zlo zhi\n\n")
    f.write(f"Masses\n\n1 {mO}\n2 {mH}\n\nAtoms # full\n\n")
    for a_ in atoms:
        x, y, z = (c % L for c in a_[4:])
        f.write(f"{a_[0]} {a_[1]} {a_[2]} {a_[3]} {x:.10f} {y:.10f} {z:.10f}\n")
    f.write("\nBonds\n\n" + "".join(f"{b[0]} {b[1]} {b[2]} {b[3]}\n" for b in bonds))
    f.write("\nAngles\n\n" + "".join(f"{g[0]} {g[1]} {g[2]} {g[3]} {g[4]}\n" for g in angles))
print(f"wrote {out}: {N} molecules, L = {L:.4f} Å")
