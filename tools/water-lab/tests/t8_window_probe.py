"""Diagnostic for check 8: drift estimated from 5 ps windows of a native 20 ps NVE run at 1 fs (same start)."""
import json, os
import numpy as np
from native_util import open_native, RES
lmp = open_native(216, 'nvt')
for c in ['unfix integ', 'fix integ all nve', 'timestep 1.0', 'thermo_style custom step temp pe ke etotal', 'thermo_modify temp tcom norm no', 'run 0 post no']:
    lmp.command(c)
t, e = [0.0], [lmp.get_thermo('etotal')]
for i in range(200):
    lmp.command('run 100 pre no post no'); t.append((i + 1) * 0.1); e.append(lmp.get_thermo('etotal'))
lmp.close()
t, e = np.array(t), np.array(e) * 4.184 / 216
out = {'series_t_ps': t.tolist(), 'series_E_kJ_mol_per_molecule': e.tolist(), 'windows': []}
for a in range(0, 20, 5):
    m = (t >= a) & (t <= a + 5)
    s = np.polyfit(t[m], e[m], 1)[0] * 1000
    out['windows'].append({'from_ps': a, 'to_ps': a + 5, 'drift_kJ_mol_ns_per_molecule': s})
    print(f'native window {a}-{a+5} ps: drift {s:.3f} kJ/mol/ns per molecule')
print('full 20 ps:', np.polyfit(t, e, 1)[0] * 1000)
json.dump(out, open(os.path.join(RES, 't8_native_windows.json'), 'w'))
