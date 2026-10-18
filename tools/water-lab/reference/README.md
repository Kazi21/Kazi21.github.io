# Native reference inputs (Live Water Lab presets)

The four starting states served by the page (`lab/water/data/preset_water{216,256,343,512}.data`) were made with
native LAMMPS 22 Jul 2025 (update 4) using these files, in this order:

1. `python make_water.py N 0.997 <seed> raw_waterN.data` — N rigid SPC/E molecules on a cubic grid with random
   orientations (seed 1000 + N was used for velocities in step 2).
2. `lmp -in equil.lmp -var N <N> -var seed <1000+N>` — 5 ps NVT at 0.5 fs, then 60 ps NPT at 298.15 K and 1 bar.
3. `lmp -in finalize_presets.lmp -var N <N>` — 40 ps NPT with the page's settings (SHAKE 1e-5); the mean volume is
   measured and the first later configuration within 0.1 % of that volume and within 2 K of 298.15 K is saved.

`model_spce.lmp` and `coeffs_spce.lmp` hold the same model as `lab/water/engine/water-model.js`.

Results (mean density over 40 ps NPT; saved configuration):

| Molecules | mean density (kg/m³) | saved temperature (K) | cell edge (nm) |
|---:|---:|---:|---:|
| 216 | 997.5 | 299.7 | 1.864 |
| 256 | 995.5 | 296.8 | 1.974 |
| 343 | 998.5 | 296.4 | 2.174 |
| 512 | 996.9 | 296.5 | 2.486 |
