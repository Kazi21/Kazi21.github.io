"""Benchmark: native LAMMPS (PyPI wheel, 1 MPI rank), same commands as the page, NVT, 1000 steps in chunks of 10."""
import json, os, platform, time
from native_util import open_native, RES
out = {'cpu': platform.processor() or platform.machine(), 'results': []}
try:
    out['cpu'] = [l.split(':', 1)[1].strip() for l in open('/proc/cpuinfo') if l.startswith('model name')][0]
except Exception:
    pass
for N in (216, 256, 343, 512):
    lmp = open_native(N, 'nvt')
    for i in range(10):
        lmp.command('run 10 pre no post no')
    t0 = time.perf_counter()
    for i in range(100):
        lmp.command('run 10 pre no post no')
        lmp.get_thermo('temp'); lmp.get_thermo('pe')
    dt = time.perf_counter() - t0
    out['engine'] = f'native LAMMPS {lmp.version()}'
    lmp.close()
    out['results'].append({'molecules': N, 'steps': 1000, 'wall_s': dt, 'ms_per_step': dt, 'steps_per_s': 1000 / dt, 'ps_per_s': 1 / dt})
    print(f'native {N}: {dt:.3f} ms/step, {1000/dt:.0f} steps/s')
json.dump(out, open(os.path.join(RES, 'bench_native.json'), 'w'), indent=1)
