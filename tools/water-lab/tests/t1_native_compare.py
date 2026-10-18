"""Check 1 (native part): runs the commands recorded by t1_browser.js in native LAMMPS and compares.
Usage: python t1_native_compare.py   (needs the PyPI `lammps` module, same LAMMPS release)"""
import json, os, sys, tempfile
import numpy as np
from lammps import lammps, LMP_STYLE_GLOBAL, LMP_TYPE_SCALAR, LMP_TYPE_VECTOR

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'lab', 'water'))
RES = os.path.normpath(os.path.join(HERE, '..', 'results'))
data = json.load(open(os.path.join(RES, 't1_browser.json')))
KEYS = ['pe', 'evdwl', 'ecoul', 'elong', 'etail', 'press', 'pxx', 'pyy', 'pzz', 'pxy', 'pxz', 'pyz']
TOL = {'force': 1e-6, 'energy': 1e-6, 'pressure': 1e-4, 'tether': 1e-9}
rows, ok_all = [], True
for c in data['cases']:
    tmp = tempfile.mkdtemp()
    with open(os.path.join(tmp, 'start.data'), 'w') as f:
        f.write(open(os.path.join(SITE, 'data', f"preset_water{c['N']}.data")).read())
    cwd = os.getcwd(); os.chdir(tmp)
    lmp = lammps(cmdargs=['-log', 'none', '-screen', 'none', '-nocite'])
    for cmd in c['commands']:
        lmp.command(cmd)
    nat = {k: lmp.get_thermo(k) for k in KEYS}
    nat['tether_energy'] = lmp.extract_fix('tether', LMP_STYLE_GLOBAL, LMP_TYPE_SCALAR)
    nat['tether_vector'] = [lmp.extract_fix('tether', LMP_STYLE_GLOBAL, LMP_TYPE_VECTOR, i) for i in range(3)]
    fn = np.array(lmp.gather_atoms('f', 1, 3), dtype=float)
    version = lmp.version()
    lmp.close(); os.chdir(cwd)
    fb = np.array(c['forces'])
    dF = float(np.max(np.abs(fb - fn)))
    dE = max(abs(c['browser'][k] - nat[k]) for k in ['pe', 'evdwl', 'ecoul', 'elong', 'etail'])
    dP = max(abs(c['browser'][k] - nat[k]) for k in ['press', 'pxx', 'pyy', 'pzz', 'pxy', 'pxz', 'pyz'])
    dT = max([abs(c['browser']['tether_energy'] - nat['tether_energy'])] + [abs(a - b) for a, b in zip(c['browser']['tether_vector'], nat['tether_vector'])])
    ok = dF <= TOL['force'] and dE <= TOL['energy'] and dP <= TOL['pressure'] and dT <= TOL['tether']
    ok_all &= ok
    rows.append({'case': c['id'], 'max_force_diff_kcal_mol_A': dF, 'max_energy_diff_kcal_mol': dE, 'max_pressure_diff_atm': dP,
                 'max_tether_diff': dT, 'pe_kcal_mol': nat['pe'], 'press_atm': nat['press'], 'max_force_kcal_mol_A': float(np.max(np.abs(fn))), 'pass': ok})
    print(f"{c['id']}: dF={dF:.3e} dE={dE:.3e} dP={dP:.3e} dTether={dT:.3e} -> {'PASS' if ok else 'FAIL'}")
res = {'id': 1, 'name': 'Browser vs native forces, energy and pressure', 'verdict': 'PASS' if ok_all else 'FAIL',
       'tolerances': TOL, 'browser_engine': data['engine'], 'native_engine': f'native LAMMPS {version} (PyPI lammps)', 'cases': rows,
       'summary': 'max force difference %.2e kcal/mol/A, energy %.2e kcal/mol, pressure %.2e atm over %d configurations' % (
           max(r['max_force_diff_kcal_mol_A'] for r in rows), max(r['max_energy_diff_kcal_mol'] for r in rows), max(r['max_pressure_diff_atm'] for r in rows), len(rows))}
json.dump(res, open(os.path.join(RES, 't1.json'), 'w'), indent=1)
print('check 1:', res['verdict'], '-', res['summary'])
sys.exit(0 if res['verdict'] == 'PASS' else 1)            # failure status for scripts and CI
