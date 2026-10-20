# The Continuum Lab — from one nanotube to membrane flow

Website page: `lab/continuum/` (release 2026.6; 3D pore view added in 2026.7 and recomposed in 2026.8). Status: **live 3D continuum solver with an illustrative pore
conductance**. The continuum calculation is verified; the pore law is a declared input scenario, so no number on the page is a
calibrated prediction for water in real (6,6) carbon nanotubes (`INSUFFICIENT_EVIDENCE` in the page's decision panel).

## What the experiment does

1. **One tube.** A pore law gives the flow q through one (6,6) CNT (carbon-centre diameter 0.814 nm, length
   2.46 nm) for a driving potential ΔΠ across it: q = G ΔΠ with the declared G = 1.00 × 10⁻²⁷ m³ Pa⁻¹ s⁻¹
   (`illustrative-cnt66-v1`, source kind `declared_scenario`, assessment `unassessed`). The molecular panel shows the
   author's recorded CP2K trajectory of a (6,6) segment (6 H₂O, Na⁺, Cl⁻; structure only, labelled "Recorded").
2. **Membrane map.** Pores on a square lattice of 10 nm pitch are counted exactly (integer nanometres) into the faces
   of the continuum grid: S_c = Σ G_i, Rs_c = A_c / S_c. Selected tube, selected patch and whole membrane each scale a
   different factor; a tube change alters one term of one sum; closed faces have J = 0 exactly.
3. **Chambers.** Steady 3D Stokes flow of water (300 K, NIST properties) in a feed and a permeate chamber
   (W × B × min(W, B)/2 each, square ports of side min(W, B)/5), coupled through the membrane by one shared flux
   unknown per open face inside the same linear solve (normal-traction difference = Rs J; zero tangential velocity on
   the membrane faces). Pressures are outlet-referenced (0.101325 MPa at the permeate port, ΔP = 0–10 MPa).

The page reports total flow Q, the flux map J, the single-pore flow of the selected tube (q_i = G_i ΔΠ_c with ΔΠ_c
from the solved field), conservation, a fixed-baseline comparison with "Why did this change?", the power split of
"Where is the resistance?" (ΔP Q = Φ_viscous + Σ A Rs J², to rounding), and a deterministic decision panel. The
download is reproducible with `node reproduce.js` in the unzipped folder.

**Reading the page in one minute.** A guided experiment runs the default device at 1 MPa (the baseline), raises the
pressure to 4 MPa, makes that state the baseline and closes the centre patch (1 600 tubes, Q −4.00 %), opens the
comparison, and finally closes one tube instead (Q falls by one part in 40 000). Colours and tracer speeds stay fixed
to the baseline's range, so a change of pressure or conductance changes the picture in proportion to the computed
field (values above the range are shown in the top colour and the legend says so); "Automatic" rescales each result
and is labelled as such. Every run is followed by a total-flow resolution check of the same configuration at a second
mesh level (10 cells across the shorter side for the standard mesh, 20 for a fine mesh; pass if |ΔQ|/Q ≤ 2 %). Only a
check of the displayed configuration can certify it; zero flow is reported as not applicable. The check concerns the
total flow: the chamber velocity near the port edges converges more slowly (native comparison, F2–F4).

**Pores in 3D (release 2026.7, recomposed in 2026.8).** A cutaway block of the 5 × 5 tubes at the selected tube's
corner, drawn at true geometry ((6,6) tubes, 0.814 nm carbon-centre diameter, 2.46 nm long, 10 nm pitch; nothing
enlarged; the selected tube with its carbon lattice), labelled in the viewport as a **continuum-driven schematic**. It
opens on **Focus pore** (the selected tube close up, 1 nm scale bar); **Array context** shows its row and neighbours
(5 nm bar). Both membrane faces have real openings, one per tube, and the tube walls are dark inside. The water in each
tube is a single-file chain (one molecule per 0.27 nm, SPC/E geometry O–H 0.100 nm and H–O–H 109.47°, each molecule
donating a hydrogen bond to the next) that drifts at the tube's single-pore flow q_i = G_i ΔΠ_c from the current
solution; one speed factor serves all tubes and is fixed to the baseline (two molecular spacings per second at the
baseline's largest single-pore flow; 1 s on screen = 60.0 ns at 1 MPa), so 4 MPa runs four times faster. Only net
transport is drawn: thermal motion and back-and-forth crossings are omitted, so a blocked pore shows zero net
transport. The caption reports the selected pore's throughput (0.0333 molecules per ns at 1 MPa), the total flow and
the open-pore count; "How this illustration works" gives the conventions. Two of them matter for a reader from
molecular simulation. (i) The drawn chain advances at 8.99 × 10⁻³ m/s at 1 MPa, 899 × the superficial velocity
J = 1.00 × 10⁻⁵ m/s: the ratio is the membrane area per pore (100 nm²) over the chain's effective cross-section
v_w/ℓ = 0.111 nm², so it depends on the assumed spacing ℓ = 0.27 nm (the carbon-centre opening, 0.520 nm², would
give 192). Release 2026.7 attributed it to the open-area fraction; that was wrong and is corrected. (ii) The same pore
law implies an equilibrium collective diffusion of the crossing count D_N = G k_B T / v_w² = 4.60 ns⁻¹: in 1 ns the
count wanders by about 3.03 molecules against a net drift of 0.0333, which is why molecular dynamics measures G from
fluctuations or at 50–200 MPa (see the calibration package). The feed and permeate water are drawn as continuous
volumes (the calculation treats them as a continuum). Uses three.js 0.160.0 (MIT), loaded only when the view is
opened; without WebGL the view shows a text fallback.

## Numerical method

MAC finite volumes on uniform cubic cells; rows scaled by control volume so that K = [A, Gᵀ; G, 0] is symmetric;
length, velocity and pressure scaling with a per-chamber pressure gauge (the 0.1–10 MPa levels never enter the
unknowns); MINRES with a block-diagonal preconditioner (symmetric Gauss–Seidel on velocities), Float64, restarted
until ‖b − Kx‖/‖b‖ ≤ 10⁻¹⁰; run in a Web Worker with cancellation every 50 iterations and revision-checked results.
Membrane-only changes are solved as changes of a stored state (K₁ Δx = d with d assembled from the change itself),
which resolves a one-tube change exactly even in a 10¹⁰-pore membrane (test S15: ΔQ/Q = 10⁻¹⁰).

## Files

| Path | Content |
|---|---|
| `lab/continuum/index.html` | Page (built from `tools/continuum/page.template.html` by `tools/continuum/build_page.js`) |
| `lab/continuum/app.js`, `view.js`, `continuum.css` | Controller, views (device flow, membrane map and tube zoom, recorded molecule, pore-law chart), layout |
| `lab/continuum/pores3d.js`, `vendor/three.module.min.js`, `vendor/THREE_LICENSE.txt` | 3D pore view (loaded on demand) and the three.js 0.160.0 module build with its MIT licence |
| `lab/continuum/worker.js` | Continuum worker protocol |
| `lab/continuum/core/*.js` | Units, pore law, membrane map, scenario and gates, solver, experiment, field sampling (shared by page, worker and tests) |
| `lab/continuum/export.js`, `reproduce.js` | Download builder and Node reproduction |
| `lab/continuum/data/manifest.json`, `reference-law.json`, `mesh-check.json` | Source-qualified presets, analytic verification law, standard-vs-fine mesh table for all 26 allowed sizes |
| `tools/continuum/AUDIT.md`, `CONTRACTS.md`, `TOLERANCES.md` | Baseline audit, units/geometry/source contracts, frozen acceptance tests with amendments |
| `tools/continuum/tests/` | `t_core.js` (N1–N9), `t_solver.js` (S1–S15), `t_decision.js` (D1–D3), `browser_continuum.js` (B1–B16, R1), `t_tools.sh` (A1–A5), `bench_browser.js`, `make_export.js` |
| `tools/continuum/reference_solver.py` | Independent Python/SciPy assembly and direct solve (S13) |
| `tools/continuum/openfoam/` | OpenFOAM v1912 cases (F1–F4, plus a reported 80-cell case), browser counterparts, `compare_openfoam.py`, `run_all.sh` |
| `tools/continuum/md-calibration/` | Molecular calibration package (builder, LAMMPS input, crossing counter, manifest template, campaign script, README with the smallest missing measurement) |
| `tools/continuum/analyze_pore_flux.py`, `check_conservation.py`, `plot_validation.py`, `fixtures/` | Statistics and acceptance of a pore law (since 2026.8 the supported interval reaches zero drive, and so the lab's 0–10 MPa range, only if the zero-drive equilibrium conductance agrees with the driven slope; tests A4, A5), export conservation check, figures, labelled synthetic fixtures |
| `tools/continuum/results/` | Machine-readable results of every test run (original failing runs kept) |

## Reproduce the checks

```
node tools/continuum/tests/t_core.js                    # N1-N9
node tools/continuum/tests/t_solver.js                  # S1-S15 (about 40 s; calls reference_solver.py)
sh tools/continuum/tests/t_tools.sh                     # A1-A5 (A5 runs a Monte Carlo, about 2 minutes)
node tools/continuum/tests/t_decision.js                # D1-D3
python3 -m http.server 8765 &                           # from the repository root, then:
node tools/continuum/tests/browser_continuum.js         # B1-B16, R1 (needs Playwright + Chromium; WebGL via SwiftShader)
sh tools/continuum/openfoam/run_all.sh                  # F1-F4 (needs OpenFOAM v1912)
NODE_PATH=<katex> node tools/continuum/build_page.js    # rebuild the page with the current results
```

<!-- BEGIN:results (written by tools/continuum/make_qa_report.py --readme) -->
## Results of this release (generated)

50 PASS, 3 FAIL, 0 NOT_RUN of 53 acceptance checks; every number and verdict is in `tools/continuum/QA_REPORT.md` and `tools/continuum/results/`.

- F1 Developed duct: **PASS** — relative Q difference 4.07 × 10⁻¹¹, velocity normalised L2 4.30 × 10⁻¹¹.
- F2 Uniform resistance interface (porousBafflePressure): **FAIL** — relative Q difference 0.0212, velocity normalised L2 0.0843.
- F3 Closed strip: **FAIL** — relative Q difference 0.0197, velocity normalised L2 0.0844.
- F4 Refined mesh: **FAIL** — relative Q difference 0.0284, velocity normalised L2 0.0501.
- Reported convergence study (closed strip, 20/40/80 cells; not a gate): Q difference 1.97 %, 2.84 %, 2.12 %; observed order 0.96 (browser) and 0.73 (OpenFOAM); inconclusive at these resolutions — the codes differ by 2.12 % on the 80-cell grid, within their estimated discretisation uncertainties (grid convergence index 10.8 % browser, 17.0 % OpenFOAM), but these are far larger than the 2 % the comparison needs; the velocity-field difference between the codes decreases with refinement (8.44 %, 5.01 %, 2.90 %).
- Mesh check, all 26 allowed sizes (pore-limited devices): refining the mesh changes Q by at most 5.73 × 10⁻⁶ (relative); the chambers carry at most 2.69 × 10⁻⁵ of the resistance.
- Solve times in the page worker (headless Chromium, build machine): 2 µm × 2 µm, standard mesh (first solve) 0.75 s; same device, one patch closed (change solve) 0.79 s; 2 µm × 2 µm, fine mesh 12.74 s; 1 mm × 1 mm (10¹⁰ pores), standard mesh 0.77 s; 20 µm × 5 µm (aspect 4), standard mesh 5.98 s.
- Molecular pilot (functionality only): 2.73–3.06 ns/day on one core; tube occupancy 0.42 molecules averaged over 10–36 ps from an empty start (not filled; see `md-calibration/README.md`).
<!-- END:results -->

## Known limitations

- The pore law is illustrative; the calibration package defines the missing molecular measurement.
- One geometry, one length, one temperature, pure water; steady creeping flow; idealised boxes and ports.
- In these pore-limited devices the chambers carry at most 2.69 × 10⁻⁵ of the resistance (all 26 allowed sizes), so Q
  follows the pore law and the number of open pores, and refining the mesh changes Q by at most 5.73 × 10⁻⁶. The chamber flow near
  the square ports and the edges of closed regions converges slowly: in the chamber-dominated comparison case Q changes
  by 7.49 % (browser) and 8.17 % (OpenFOAM) between 40 and 80 cells (observed orders 0.96 and 0.73), so the native
  comparison is inconclusive at the 2 % level (F2–F4 FAIL; see the QA report).
- No pore-to-pore variability or conductance uncertainty yet; a scoped change is a deterministic what-if.

## Licences and attribution

Page code: MIT (Kazi Ehsanul Karim; code drafted with AI assistance and checked by the tests). The recorded trajectory
is the author's CP2K calculation. OpenFOAM (OpenCFD, GPL-3.0) and LAMMPS (GPL-2.0) are used only offline; no code of
either is part of the page.
