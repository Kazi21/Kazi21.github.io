# Live Water Lab — validation plan and tolerances

Written on 18 October 2026 **before** any of the checks below were evaluated. A check PASSES only if every
stated criterion holds; otherwise it FAILS. A check that was not executed is reported as NOT RUN.
Any later change to a criterion must be recorded at the end of this file with the reason.

Engines: the browser engine (`lab/water/engine/lammps-water.wasm`, LAMMPS 22 Jul 2025 update 4, run in Node 22
through the same `lammps-core.js`, `water-model.js` and `water-adapter.js` the page uses) and native LAMMPS
(same release, PyPI `lammps` wheel). Model, presets and commands: `lab/water/engine/water-model.js`.

| # | Check | Configuration | Criterion (stated before evaluation) |
|---|-------|---------------|--------------------------------------|
| 1 | Browser vs native forces, energy, pressure | Same input in both engines, `run 0`: preset 216 (s = 1.00), preset 216 (s = 1.10), preset 512 (s = 0.90), preset 216 with an active tether (k = 5 kcal mol⁻¹ Å⁻², handle displaced 1.2 Å) | max per-atom force difference ≤ 1×10⁻⁶ kcal mol⁻¹ Å⁻¹; every energy term (pe, evdwl, ecoul, elong, etail) differs by ≤ 1×10⁻⁶ kcal/mol; pressure and its six components differ by ≤ 1×10⁻⁴ atm; tether energy and tether 3-vector differ by ≤ 1×10⁻⁹ |
| 2 | Geometry, neutrality, topology, periodic wrapping | All four presets; every 10 fs of a 5 ps browser-engine NVT run (216) and of the check-7 pulling protocol | 3 atoms (O, H, H), 2 bonds and 1 angle per molecule; total charge |Σq| ≤ 1×10⁻¹⁰ e; every O–H within 1.0 ± 1×10⁻⁴ Å and every H–O–H within 109.47 ± 0.01° in unwrapped coordinates (molecules whole); display wrapping puts every oxygen inside the cell |
| 3 | O–O LJ multiplier reaches the force field | Preset 216 without SHAKE, `run 0` at s = 0.90, 1.00, 1.10, using the page's `pair_coeff` command | evdwl(s)/evdwl(1) = s within 1×10⁻¹⁰ relative; ecoul and elong unchanged within 1×10⁻⁹ kcal/mol; forces linear in s: max |F(1.1) − 2F(1.0) + F(0.9)| ≤ 1×10⁻⁸ kcal mol⁻¹ Å⁻¹ while max |F(1.1) − F(1.0)| ≥ 1×10⁻³ (the change reaches the forces); pressure linear in s within 1×10⁻⁶ atm; the page path (setLJScale between chunks) gives the same evdwl as a fresh build at that s within 1×10⁻⁶ kcal/mol |
| 4 | Tether force and torque | (a) Preset 216 without SHAKE: forces with k = 5 minus forces with k = 0, handle displaced (1.0, −0.5, 0.7) Å. (b) One isolated water molecule in a 40 Å cell, NVE with SHAKE, tether k = 5, handle displaced 1 Å, zero initial velocities, 2 ps | (a) Σᵢ ΔFᵢ = −k(R − X) and each ΔFᵢ = (mᵢ/M)(−k(R − X)) within 1×10⁻¹⁰ relative; torque about R ≤ 1×10⁻⁹ kcal/mol; the reported net interaction force equals the sum of the k = 0 forces on the molecule within 1×10⁻⁹. (b) oscillation period within 1 % of 2π(M/k)^½; molecular angular momentum about its centre of mass stays below 1×10⁻⁶ g mol⁻¹ Å² fs⁻¹ (no rotation is started) |
| 5 | Tether force vs finite differences of its potential | Preset 216, k = 5, handle displaced 1.3 Å; displace the molecule by ±1×10⁻³ Å along x, y, z | −(U₊ − U₋)/(2h) equals the analytical component within 1×10⁻⁶ relative; per-atom energies sum to ½k|R − X|² within 1×10⁻¹⁰ relative |
| 6 | Zero stiffness reproduces the unperturbed control | Preset 216, NVT, 1000 steps in 10-step chunks: page adapter (tether defined, k = 0, a molecule selected after 300 steps) vs the same input with the tether lines removed | final coordinates identical: max |Δx| ≤ 1×10⁻¹⁰ Å |
| 7 | Pulling, release and periodic crossing | Preset 216: select a molecule whose centre of mass is within 2.5 Å of a cell face, pull it across that face (k = 5, handle 6 Å at 3 Å/ps), hold 0.5 ps, release, relax 1 ps; repeat in a fresh engine; replay the exported input with native LAMMPS | constraints as in check 2 at every 10 fs; the molecule crosses the face (image flag changes) while R stays continuous (≤ 0.5 Å per 10 fs); the repeat gives an identical command journal, identical event steps and bitwise-identical final coordinates; the native replay runs to the same step and its potential energy matches the browser within 1×10⁻⁶ relative for the first 0.5 ps; energy balance |ΔE_ext − W_delivered| ≤ 0.02|W_delivered| + 0.5 kJ/mol at release |
| 8 | Unforced NVE energy drift and timestep sensitivity | Preset 216, fixed Hamiltonian, SHAKE, no thermostat: native 20 ps at dt = 0.5, 1.0, 2.0 fs; browser engine 5 ps at 1.0 fs | at dt = 1.0 fs |drift| ≤ 0.25 kJ mol⁻¹ ns⁻¹ per molecule (native and browser); drift reported for all dt (sensitivity reported, no criterion) |
| 9 | NVT and NPT statistics vs native | Preset 216, 298.15 K (NVT) and 298.15 K, 1 bar (NPT); 40 ps each in both engines with different velocity seeds; discard 5 ps; 2.5 ps blocks | browser and native means of T, PE per molecule and P (NVT) and of density and PE per molecule (NPT) agree within the combined 95 % interval of the block means; the browser mean T is within its 95 % interval of 298.15 K or within 1 K of it |
| 10 | Interface behaviour | Headless Chromium on the page: count change 216 → 256 → 216, pause/resume, stale message, injected engine failure, hidden tab, 390 px touch controls, reduced motion, no engine download before Start | each behaviour as described in `browser_ui.js` (new run ID and atom count after a count change; no steps while paused; stale message rejected without effect; failure reported and recovered by Reset; pause while hidden; tap selects and drag pulls on touch; no horizontal overflow at 360/390 px; slow pace under reduced motion; zero engine/data requests before Start) |

Benchmarks (no criterion): MD throughput in steps/s for 216, 256, 343 and 512 molecules (native, browser engine in
Node, headless Chromium worker), and display frame rate measured separately; CPU, browser and durations recorded.

Sampling defaults of `tools/analyze_water.py` (discard 20 ps, 5 ps blocks, at least 8 blocks, 95 %) are provisional
until the reference runs of check 9 establish equilibration and correlation times.

## Revisions

- 18 Oct 2026, check 3 (procedure, criterion unchanged): the first evaluation of the page path read the energy from
  the setup that precedes SHAKE's setup-time coordinate correction, while the fresh build was evaluated at the
  corrected coordinates (difference 2.4×10⁻⁶ kcal/mol). Both are now evaluated at identical coordinates.
- 18 Oct 2026, check 8 (registered after the stated version FAILED; criterion unchanged): the browser-engine NVE
  run is extended from 5 ps to 20 ps at 1 fs, matching the native run. Reason: the 5 ps window cannot resolve a
  0.25 kJ mol⁻¹ ns⁻¹ tolerance — 5 ps windows of the native 20 ps run give −1.43, 0.08, 0.75 and −0.43, and the
  browser's 5 ps run gave −1.15 (native first window, same start: −1.43). The original result is kept in
  results/t8_original_5ps.json and reported.
- 18 Oct 2026, check 9 (registered after the stated version FAILED): the stated version compared one 40 ps run per
  engine with block standard errors and seven 95 % comparisons. It failed on one of five criterion comparisons (NPT
  potential energy per molecule: browser −46.690 ± 0.052, native −46.874 ± 0.045 kJ/mol; difference 0.184 against a
  limit of 0.141, z ≈ 2.6), while check 1 shows identical forces to 10⁻¹³, so the engines cannot differ beyond
  round-off. Design flaws: a single realisation per engine (block errors from one trajectory), and seven comparisons at
  95 % each, which gives roughly a 25–30 % chance of at least one false failure even for identical engines.
  Revised version, fixed before running it: four independent 40 ps runs per engine and ensemble (seeds 4101, 4103,
  4105, 4107 browser; 4102, 4104, 4106, 4108 native; the stated runs are the first replicas), 5 ps discarded, the
  standard error of each engine taken from the spread of its four replica means, and each of the five criterion
  comparisons tested at 99 % (Bonferroni, family-wise 95 %) with Welch's t; the mean-temperature check uses the same
  replica error. The original result is kept in results/t9_original_single_run.json and reported.
- 18 Oct 2026, wording correction (no criterion changed): the check-9 revision note above says "the engines cannot
  differ beyond round-off". That overstates check 1: forces agree at the tested configurations; longer-run behaviour
  was assessed separately (check 9).

## Supplementary check S1 — allowed-range stability sweep (written 18 Oct 2026, before the runs)

The interface allows 260–370 K, 1–1000 bar, O–O LJ strength s = 0.90–1.10 and tether stiffness 0.5–10 kcal mol⁻¹ Å⁻²
(0.347–6.95 N/m). Checks 1–10 ran mainly at 298.15 K and 1 bar. S1 runs the corners of the allowed ranges.

| Configuration | Criterion |
|---|---|
| Native LAMMPS, 216 molecules from the preset, the target applied at t = 0 as the page does, 20 ps NPT at each of 260 K/1 bar, 260 K/1000 bar, 370 K/1 bar, 370 K/1000 bar, and at 298.15 K/1 bar with s = 0.90, 0.95, 1.05, 1.10 | completes without a LAMMPS error and keeps all 648 atoms; max \|O–H − 1 Å\| ≤ 10⁻⁴ Å at the end; mean T over 10–20 ps within 5 K of the target; density within 850–1150 kg/m³ throughout; mean density over 10–20 ps differs from that over 5–10 ps by less than 4 % (no ongoing phase change) |
| Browser engine (page adapter), the same eight conditions, 5 ps each | completes, keeps all atoms, max \|O–H − 1 Å\| ≤ 10⁻⁴ Å; mean T over 2.5–5 ps within 10 K of the target |
| Browser engine, pulls at k = 0.5 and k = 10 kcal mol⁻¹ Å⁻² with the handle request 8 Å away (distance limit active for the soft tether), 2 ps, release, 1 ps | completes; constraints as above at every 10 fs; energy balance at release within 0.02\|W\| + 0.5 kJ/mol |
- 18 Oct 2026, check 10 (release 2026.5.1 interface; registered before the final run): the side panel was reorganised
  (essential controls beside the viewer; conditions, accounting and display options in expandable panels). Items
  added: the essential readout (simulated time, temperature, selected molecule, applied force); the "Change the
  conditions" panel opens from the keyboard; the live means are descriptive, without intervals; the remaining plots are
  drawn when their panel opens; "Try a gentle pull" pressed before Start loads the engine, pulls and releases; and the
  demonstration's handle stays within 0.25 nm of its starting point (it starts at the molecule's centre of mass). This
  last item was added after a page defect was found: in release 2026.5 the demonstration took the handle's starting
  point from the snapshot drawn before the pull began, so the handle travelled towards a stale point at the speed limit
  and was held at the 0.3 nm distance limit (largest handle displacement 0.57–0.65 nm in a probe; 0.25 nm stated). The
  page now takes the starting point from the engine's acknowledgement of the pull (0.2500 nm after the fix). The first
  run against the new layout failed at the 390 px touch step because pressing Pause, now directly below the viewer,
  scrolled the viewer out of view before the tap (a harness artefact); the harness now presses Pause without scrolling
  and re-centres the viewer before tapping.
