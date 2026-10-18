"""Check 9 (native part): 40 ps NVT (298.15 K) and NPT (298.15 K, 1 bar) of preset 216 with new velocities (seed 4102)."""
import json, os, sys, time
import numpy as np
from native_util import open_native, RES

out = {}
for ens in ('nvt', 'npt'):
    t0 = time.time()
    lmp = open_native(216, ens)
    lmp.command('velocity all create 298.15 4102 dist gaussian mom yes rot no temp tcom')
    lmp.command('run 0 post no')
    rec = {'t': [], 'T': [], 'P': [], 'pe': [], 'rho': []}
    for i in range(4000):
        lmp.command('run 10 pre no post no')
        rec['t'].append((i + 1) * 0.01); rec['T'].append(lmp.get_thermo('temp')); rec['P'].append(lmp.get_thermo('press') * 1.01325)
        rec['pe'].append(lmp.get_thermo('pe') * 4.184 / 216); rec['rho'].append(lmp.get_thermo('density') * 1000)
    lmp.close()
    out[ens] = rec
    print(ens, 'done', time.time() - t0, 's', flush=True)
json.dump(out, open(os.path.join(RES, 't9_native_series.json'), 'w'))
