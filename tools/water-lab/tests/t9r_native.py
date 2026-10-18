"""Check 9, revised (native part): extra independent 40 ps NVT and NPT replicas. Usage: python t9r_native.py 4104 4106 4108"""
import json, os, sys, time
from native_util import open_native, RES
for seed in map(int, sys.argv[1:]):
    out = {}
    for ens in ('nvt', 'npt'):
        t0 = time.time()
        lmp = open_native(216, ens)
        lmp.command(f'velocity all create 298.15 {seed} dist gaussian mom yes rot no temp tcom')
        lmp.command('run 0 post no')
        rec = {'t': [], 'T': [], 'P': [], 'pe': [], 'rho': []}
        for i in range(4000):
            lmp.command('run 10 pre no post no')
            rec['t'].append((i + 1) * 0.01); rec['T'].append(lmp.get_thermo('temp')); rec['P'].append(lmp.get_thermo('press') * 1.01325)
            rec['pe'].append(lmp.get_thermo('pe') * 4.184 / 216); rec['rho'].append(lmp.get_thermo('density') * 1000)
        lmp.close()
        out[ens] = rec
        print('native seed', seed, ens, 'done', round(time.time() - t0, 1), 's', flush=True)
    json.dump(out, open(os.path.join(RES, f't9r_native_{seed}.json'), 'w'))
