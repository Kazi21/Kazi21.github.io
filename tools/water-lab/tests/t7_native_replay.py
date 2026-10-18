"""Check 7 (native part): replays the exported browser experiment in native LAMMPS, command by command, and
compares the potential energy with the browser's thermo.csv. Writes results/t7.json (combined verdict)."""
import csv, json, os, shutil, sys, tempfile
from lammps import lammps

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.normpath(os.path.join(HERE, '..', 'results'))
src = os.path.join(RES, 't7_export')
work = tempfile.mkdtemp()
for f in ('in.water_lab.lmp', 'start.data'):
    shutil.copy(os.path.join(src, f), work)
browser = {}
with open(os.path.join(src, 'thermo.csv')) as f:
    for row in csv.DictReader(f):
        browser[int(row['step'])] = float(row['PE_kJ_mol'])
cwd = os.getcwd(); os.chdir(work)
lmp = lammps(cmdargs=['-log', 'none', '-screen', 'none', '-nocite'])
native, ncmd = {}, 0
for line in open('in.water_lab.lmp'):
    line = line.strip()
    if not line or line.startswith('#'):
        continue
    lmp.command(line); ncmd += 1
    if line.startswith('run'):
        step = int(lmp.get_thermo('step'))
        if step % 10 == 0:
            native[step] = lmp.get_thermo('pe') * 4.184
final_step = int(lmp.get_thermo('step'))
version = lmp.version()
lmp.close(); os.chdir(cwd)
common = sorted(set(browser) & set(native))
def maxrel(tmax):
    v = [abs(native[s] - browser[s]) / abs(browser[s]) for s in common if s * 1e-3 <= tmax]
    return max(v) if v else None
part = json.load(open(os.path.join(RES, 't7_browser.json')))
profile = {f'{t:g} ps': maxrel(t) for t in (0.5, 1.0, 2.0, 3.0, final_step / 1000)}
early = maxrel(0.5)
replay_ok = final_step == part['steps'] and early is not None and early <= 1e-6
ok = part['browser_pass'] and replay_ok
res = {'id': 7, 'name': 'Pulling, release and periodic crossing', 'verdict': 'PASS' if ok else 'FAIL',
       'tolerances': {'OH_A': 1e-4, 'angle_deg': 0.01, 'com_step_A': 0.5, 'replay_pe_rel_first_0.5ps': 1e-6, 'energy_balance': '0.02|W| + 0.5 kJ/mol'},
       'browser': part, 'native_replay': {'engine': f'native LAMMPS {version}', 'commands_executed': ncmd, 'final_step': final_step,
       'max_pe_rel_diff_by_time': profile, 'pass': replay_ok},
       'summary': 'pulled across the cell face (%d crossings), constraints within %.1e A; repeat identical; native replay matches PE to %.1e (first 0.5 ps), %.1e by %g ps; energy balance %.2f of %.1f kJ/mol' % (
           part['face_crossings'], part['constraints']['max_OH_dev_A'], early, profile[f'{final_step/1000:g} ps'], final_step / 1000, part['energy_balance_error_kJ_mol'], part['release']['delivered_work_kJ_mol'])}
json.dump(res, open(os.path.join(RES, 't7.json'), 'w'), indent=1)
print(json.dumps(res['native_replay'], indent=1))
print('check 7:', res['verdict'], '-', res['summary'])
sys.exit(0 if res['verdict'] == 'PASS' else 1)            # failure status for scripts and CI
