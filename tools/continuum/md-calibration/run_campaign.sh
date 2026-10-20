#!/bin/sh
# Continuum Lab — (6,6) CNT pore-flow calibration campaign (native LAMMPS). Edit LMP, NPROC and the force list, then:
#   sh run_campaign.sh            (runs on this machine, one job after another; split the loop across nodes if you can)
# Output per run: log, thermo.<tag>.txt, cross.<tag>.dump, <tag>.csv (crossing counts) and finally pore_flux_result.json.
# The force per molecule fz that gives a target dP depends on <N_slab>: run the zero-drive equilibration first, read
# <N_slab> from thermo.equil.txt, and set fz = dP * Lx * Ly / (<N_slab> * 6.9477e-11 N) for each target (A^2 -> m^2).
set -e
LMP=${LMP:-lmp}
NPROC=${NPROC:-1}
STEPS=${STEPS:-20100000}          # 100 ps discarded + 20 ns production at 1 fs
cd "$(dirname "$0")"
[ -f membrane.data ] || python3 build_membrane.py --out membrane.data
# 1. equilibration (writes equil.final.restart); check the tube occupancy plateau in thermo.equil.txt before going on
[ -f equil.final.restart ] || mpirun -np $NPROC $LMP -in in.calibrate.lmp -var stage equil -var tag equil -var steps 300000 -log log.equil
# 2. production: condition id, force per molecule (kcal mol^-1 A^-1; fill from the mapping above); 4 replicas per drive,
#    8 at zero drive (the equilibrium gate of analyze_pore_flux.py needs G_eq to 10 %; see README)
for spec in "zero 0.0" "m100 FZ_M100" "p050 FZ_P050" "p100 FZ_P100" "p150 FZ_P150" "p200 FZ_P200"; do
  set -- $spec; cid=$1; fz=$2
  case $fz in FZ_*) echo "set the force for $cid in run_campaign.sh first"; exit 1;; esac
  reps="1 2 3 4"; [ "$cid" = zero ] && reps="1 2 3 4 5 6 7 8"
  for rep in $reps; do
    tag=${cid}_r${rep}
    [ -f $tag.csv ] && continue
    mpirun -np $NPROC $LMP -in in.calibrate.lmp -var stage drive -var fz $fz -var seed $((1000 + rep)) -var tag $tag -var steps $STEPS -var restart_in equil.final.restart -log log.$tag
    python3 crossings_from_dump.py --dump cross.$tag.dump --thermo thermo.$tag.txt --fz $fz --run $tag --replica $rep --condition $cid --discard-ps 100 --out $tag.csv
  done
done
# 3. analysis (exit 0 accepted, 1 failed acceptance, 2 insufficient data)
python3 ../analyze_pore_flux.py --input *_r?.csv --manifest calibration_manifest.json --out pore_flux_result.json
