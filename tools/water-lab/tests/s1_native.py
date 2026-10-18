"""Supplementary check S1 (native part): 20 ps NPT at the corners of the allowed ranges, 216 molecules."""
import json, os, sys, time
import numpy as np
from native_util import open_native, RES
CASES = [('260K_1bar', 260, 1, 1.0), ('260K_1000bar', 260, 1000, 1.0), ('370K_1bar', 370, 1, 1.0), ('370K_1000bar', 370, 1000, 1.0),
         ('s0.90', 298.15, 1, 0.90), ('s0.95', 298.15, 1, 0.95), ('s1.05', 298.15, 1, 1.05), ('s1.10', 298.15, 1, 1.10)]
out = {}
for name, T, P, s in CASES:
    t0 = time.time()
    try:
        lmp = open_native(216, 'npt', s)
        Patm = P / 1.01325
        for c in ['unfix integ', f'fix integ all npt temp {T} {T} 100.0 iso {Patm} {Patm} 1000.0', 'fix_modify integ temp tcom', 'run 0 post no']:
            lmp.command(c)
        t, Tl, rho = [], [], []
        for i in range(2000):                          # 20 ps, record every 10 fs
            lmp.command('run 10 pre no post no')
            t.append((i + 1) * 0.01); Tl.append(lmp.get_thermo('temp')); rho.append(lmp.get_thermo('density') * 1000)
        natoms = lmp.get_natoms()
        x = np.array(lmp.gather_atoms('x', 1, 3)).reshape(-1, 3); img = np.array(lmp.gather_atoms('image', 0, 3)).reshape(-1, 3)
        L = lmp.extract_box()[1][0] - lmp.extract_box()[0][0]
        xu = x + img * L
        dOH = max(abs(np.linalg.norm(xu[3 * m + h] - xu[3 * m]) - 1.0) for m in range(216) for h in (1, 2))
        lmp.close()
        t, Tl, rho = map(np.array, (t, Tl, rho))
        Tm = float(Tl[t > 10].mean()); r1 = float(rho[(t > 5) & (t <= 10)].mean()); r2 = float(rho[t > 10].mean())
        ok = natoms == 648 and dOH <= 1e-4 and abs(Tm - T) <= 5 and rho.min() >= 850 and rho.max() <= 1150 and abs(r2 - r1) / r2 < 0.04
        out[name] = {'T_target_K': T, 'P_target_bar': P, 'lj_scale': s, 'atoms': natoms, 'max_OH_dev_A': dOH, 'mean_T_10_20ps_K': Tm,
                     'density_min_kg_m3': float(rho.min()), 'density_max_kg_m3': float(rho.max()), 'density_5_10ps': r1, 'density_10_20ps': r2,
                     'density_drift_rel': abs(r2 - r1) / r2, 'pass': bool(ok), 'wall_s': time.time() - t0}
    except Exception as e:
        out[name] = {'T_target_K': T, 'P_target_bar': P, 'lj_scale': s, 'error': str(e), 'pass': False}
    print(name, json.dumps(out[name]), flush=True)
json.dump(out, open(os.path.join(RES, 's1_native.json'), 'w'), indent=1)
sys.exit(0 if all(v['pass'] for v in out.values()) else 1)
