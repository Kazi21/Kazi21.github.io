#!/bin/sh
# Continuum Lab — native OpenFOAM v1912 reference runs and comparison with the browser solver (TOLERANCES.md F1-F4).
# Requires OpenFOAM v1912 (OpenCFD) on PATH (e.g. `source /usr/share/openfoam/etc/bashrc`), Python 3 and Node.js.
# Usage: sh run_all.sh        Exit status: that of compare_openfoam.py (1 if a gate fails or a case is missing).
#        RUN_F5=1 sh run_all.sh   also reruns the 80-cell case F5_strip_80 of the reported convergence study (not a gate;
#                                 about 30 min on one core, 512 000 cells); without it the existing F5 result is used.
set -e
cd "$(dirname "$0")"
python3 make_cases.py
python3 -c "import json, make_cases as m; json.dump(m.CASES, open('cases.json', 'w'), indent=1)"
for c in F1_duct F2_uniform F3_strip F4_strip_fine; do
  echo "== $c"; (cd cases/$c && rm -rf [1-9]* && ./Allrun)
done
if [ "${RUN_F5:-0}" = 1 ]; then echo "== F5_strip_80"; (cd cases/F5_strip_80 && rm -rf [1-9]* && ./Allrun); fi
node browser_cases.js
python3 compare_openfoam.py
