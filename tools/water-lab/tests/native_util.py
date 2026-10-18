"""Helpers for native-LAMMPS reference runs that use the page's own initialisation commands."""
import json, os, subprocess, tempfile
from lammps import lammps

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'lab', 'water'))
RES = os.path.normpath(os.path.join(HERE, '..', 'results'))

def init_commands(N, ensemble, s=1.0):
    out = subprocess.run(['node', os.path.join(HERE, 'dump_init.js'), str(N), ensemble, str(s)], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)['commands']

def open_native(N, ensemble, s=1.0, log='none'):
    tmp = tempfile.mkdtemp()
    with open(os.path.join(tmp, 'start.data'), 'w') as f:
        f.write(open(os.path.join(SITE, 'data', f'preset_water{N}.data')).read())
    cwd = os.getcwd(); os.chdir(tmp)
    lmp = lammps(cmdargs=['-log', log, '-screen', 'none', '-nocite'])
    for c in init_commands(N, ensemble, s):
        lmp.command(c)
    os.chdir(cwd)
    return lmp
