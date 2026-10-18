"""Check 8 (native part): unforced NVE energy drift at dt = 0.5, 1.0, 2.0 fs, 20 ps each, preset 216."""
import json, os, time
import numpy as np
from native_util import open_native, RES

N, out = 216, {}
for dt in (0.5, 1.0, 2.0):
    t0 = time.time()
    lmp = open_native(N, 'nvt')
    for c in ['unfix integ', 'fix integ all nve', f'timestep {dt}', 'thermo_style custom step temp pe ke etotal',
              'thermo_modify temp tcom norm no', 'run 0 post no']:
        lmp.command(c)
    per = int(round(100 / dt))                     # record every 100 fs
    t, e = [0.0], [lmp.get_thermo('etotal')]
    for i in range(200):                            # 20 ps
        lmp.command(f'run {per} pre no post no')
        t.append((i + 1) * 0.1); e.append(lmp.get_thermo('etotal'))
    lmp.close()
    t, e = np.array(t), np.array(e) * 4.184 / N      # ps, kJ/mol per molecule
    slope, icpt = np.polyfit(t, e, 1)
    resid = e - (slope * t + icpt)
    out[str(dt)] = {'dt_fs': dt, 'duration_ps': 20.0, 'drift_kJ_mol_ns_per_molecule': slope * 1000, 'rms_fluct_kJ_mol_per_molecule': float(np.std(resid)),
                    'start_kJ_mol_per_molecule': float(e[0]), 'wall_s': time.time() - t0}
    print(dt, out[str(dt)])
json.dump(out, open(os.path.join(RES, 't8_native.json'), 'w'), indent=1)
