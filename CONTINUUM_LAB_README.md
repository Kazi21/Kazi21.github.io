# The Continuum Lab

Two experiments since release 2026.9, with a switch between them:

- **Ion transport** (`lab/continuum/`, the main page): "Why does a pore pass one ion and resist another?" — described in
  the first part of this file.
- **Water flow through a nanotube membrane** (`lab/continuum/water.html`; release 2026.6, 3D pore view 2026.7–2026.8):
  described in the second part, unchanged in substance.

# Part 1. Bioinspired ion transport (`lab/continuum/`, release 2026.9)

Status: **live one-dimensional Poisson–Nernst–Planck solver; tube radii, first-shell radii and first-shell water counts
recorded with CP2K; every other molecular input a literature value or a stated example.** No input is presented as MD-informed.

## What the experiment does

One carbon-nanotube pore (the (6,6), (7,7), (9,9) or (11,11) tube of the recorded CP2K runs; pore radius = tube radius −
0.170 nm; length 5.00 nm) separates two NaCl reservoirs. The steady, area-averaged Poisson–Nernst–Planck equations for
Na⁺ and Cl⁻ are solved along the axis, with access regions whose cross-section grows as a cone of slope 4/π (exactly
Hall's access resistance in the Ohmic limit). A **model ladder** adds one ingredient per step, each compared with the
classical result on common axes:

1. classical PNP (bulk diffusivities, point ions, neutral pore);
2. charged rims (ionised carboxylates, fixed charge in Poisson's equation);
3. finite ion size (Bikerman lattice gas);
4. solvation, one closure at a time: dehydration with the **recorded CP2K first-shell counts**, dehydration with a
   rigid-shell geometry, or Born dielectric exclusion; two illustrative lining motifs inspired by coordination
   chemistry (carbonyl-lined, as in K⁺ channels; N–H / O–H donor-lined, as in CLC) change the illustrative fraction κ
   of the shell energy the wall gives back (a bioinspired synthetic pore, not a model of a protein channel);
5. confined mobility;
6. electro-osmosis with Navier slip (area-averaged Stokes flow driven by the force on the ions).

The excess chemical potential contains only crowding and solvation; mean-field electrostatics stays in Poisson's
equation, so nothing is counted twice. The page reports the current and its Na⁺/Cl⁻ split, conductance, the water flow,
the reversal potential under a 10:1 gradient with its GHK-equivalent Na⁺/Cl⁻ selectivity (constant-field inversion with
reservoir activities: an effective, model-dependent descriptor; statuses finite, beyond the display range, Nernst limit,
invalid when V_rev lies beyond a Nernst potential, since 2026.9.1), profiles of concentration, potential and excess free energy,
all six steps at the set voltage, model-domain flags (single file, fewer than one ion in the pore, crowding, overlapping
double layers), a rule-based ranking of sensitivity to stated input ranges with the molecular calculations that could
constrain each input (one-at-a-time sensitivity, not an optimal decision), an evidence drawer (value, units, source, conditions, status of every input), a 3D cutaway
(three.js, loaded with the view) and a reproducible download (JSON and CSV; `node tools/continuum/ions/reproduce_ions.js`).

Since release 2026.10 a **numerical controller** (`lab/continuum/ions/controller.js`; deterministic rules frozen in
`tools/continuum/ions/TOLERANCES.md`) checks the current and the reversal potential of every run on finer grids: it
compares the screening grid (level 1) with a twice-finer grid, refines up to level 3 when the visitor's grid-convergence
target (0.5 %, 0.1 % or 0.02 %) asks for it, and stops with "Numerical tolerance reached", "Refinement budget exhausted",
"Not converged" or "Numerical check failed" (queries outside the supported domain are refused). After the numerics it may
name one molecular calculation as a request (not run, nothing submitted) for the top input of the one-at-a-time
ranking. Every solve and decision of the controller is recorded ("Decision record (JSON)") and reproduced by
`reproduce_ions.js`. The ladder, the current–voltage curves, the profiles and the ranking stay on the screening grid.

## Numerics

Finite volumes (447 nodes; 0.0125 nm at the mouths, 0.025 nm in the pore, growth 1.08 out to 300 nm), Scharfetter–Gummel
fluxes in Slotboom form with the Péclet term (u = c e^{ψ−χ}, χ = Q∫dx/(DA)), so an excluded ion's tiny flux is computed
without cancellation; Newton's method on a block-tridiagonal system bordered by the flow unknown; continuation in the
drives; Brent's method for the reversal potential; Float64 in a Web Worker. Units: SI internally scaled by 1 nm, 1 M,
RT/F and 10⁻⁹ m² s⁻¹.

## Files (ion experiment)

| Path | Content |
|---|---|
| `lab/continuum/index.html` | Page (built from `tools/continuum/ions/page.template.html` by `tools/continuum/ions/build_ions_page.js`) |
| `lab/continuum/ions/core.js` | Solver (UMD: page worker and Node tests) |
| `lab/continuum/ions/params.js` | Parameter registry with sources and statuses, tube presets, closures, scenario builder, rule-based sensitivity inputs |
| `lab/continuum/ions/controller.js` | Numerical controller (release 2026.10): domain check, grid comparison and refinement within levels 1–3, stop rules, one-at-a-time ranking, decision record with its strict schema, calculation request, closure-contract check (UMD: page worker, Node tests, reproduce script) |
| `lab/continuum/ions/data/closure-illustrative.json`, `closure-molecular-template.json` | Closure contracts: the illustrative solvation closure in use, and the proposed molecular closure (null values; blocked) |
| `lab/continuum/ions/worker.js`, `app.js`, `charts.js`, `ions3d.js`, `ions.css` | Worker protocol, page logic, SVG charts, 3D view, layout |
| `lab/continuum/ions/data/hydration.json` | First-shell counts of the four CP2K runs with caveats and file hashes |
| `tools/continuum/ions/TOLERANCES.md` | Acceptance criteria I1–I18 and IB1–IB12 (frozen before evaluation; I15 added for 2026.9.1; I16, I17, IB11 and the controller rules for 2026.10, with the one amendment of the controller's gates before the first official run), I18, IB12 and the finite-value amendment of gates G2 and G3 for 2026.10.1; how they are applied, record of runs |
| `tools/continuum/ions/t_ions.js`, `browser_ions.js` | Solver tests (Node) and browser tests (Chromium) |
| `tools/continuum/ions/ref_pnp.py` | Independent SciPy (solve_bvp) reference for I8; no shared code |
| `tools/continuum/ions/make_hydration.py` | Recomputes the first-shell counts from the public trajectories (`--check` verifies the JSON) |
| `tools/continuum/ions/reproduce_ions.js` | Recomputes a downloaded result and repeats the controller's decisions (also accepts a decision record alone) |
| `tools/continuum/ions/make_closures.js` | Writes the two closure contracts from `params.js` and `hydration.json` (`--check` verifies the files) |
| `tools/continuum/ions/probe_controller_guards.js` | Nine regression probes of the controller (test I18): non-finite diagnostics, an almost empty "validated" closure, equilibrium, the published contracts, a tampered record |
| `tools/continuum/ions/bench_ions.js` | Run times of the default experiment in headless Chromium (a record, not a test); writes `tools/continuum/results/benchmark_ions.json`, which the page quotes |

## Reproduce the ion checks

```
python3 tools/continuum/ions/make_hydration.py --check   # first-shell counts from lab/cnt/data
node tools/continuum/ions/make_closures.js --check        # closure contracts reproduce from params.js and hydration.json
node tools/continuum/ions/t_ions.js                       # I1-I18 (about 75 s; I8 calls ref_pnp.py: numpy, scipy)
python3 -m http.server 8765 &                             # from the repository root, then:
node tools/continuum/ions/browser_ions.js                 # IB1-IB12 (Playwright + Chromium; WebGL via SwiftShader)
node tools/continuum/ions/probe_controller_guards.js --site .   # the nine guard probes alone (also run inside I18)
node tools/continuum/ions/bench_ions.js http://127.0.0.1:8765/   # run times (three fresh page loads per target), quoted on the page
NODE_PATH=<katex> node tools/continuum/ions/build_ions_page.js
```

## Known limitations (ion experiment)

- Mean field in pores that usually hold less than one ion; no Coulomb blockade, knock-on or ion pairing.
- The (6,6) tube holds single-file water: outside the continuum domain, shown for comparison only.
- One-dimensional, area-averaged; one permittivity in Poisson's equation; no charge regulation.
- The first-shell counts come from 0.50–0.75 ps runs and are not converged; κ, ε in the pore, D in the pore, slip,
  ion size, rim charge and pore length are stated examples.
- NaCl only.
- The numerical controller checks grid convergence only, of two numbers (the current and the reversal potential): the
  change to a finer grid indicates the discretisation error but does not bound it, the access-region length and the
  solver tolerances are not varied, and nothing about the physical validity of the model follows from it. Its
  calculation request ranks one-at-a-time sensitivity, not expected information gain or cost.

# Part 2. Water flow through a nanotube membrane (`lab/continuum/water.html`)

Page moved from `lab/continuum/` in release 2026.9 (release 2026.6; 3D pore view added in 2026.7 and recomposed in 2026.8). Status: **live 3D continuum solver with an illustrative pore
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
| `lab/continuum/water.html` | Page (built from `tools/continuum/page.template.html` by `tools/continuum/build_page.js`; at `lab/continuum/index.html` until 2026.8) |
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

80 PASS, 3 FAIL, 0 NOT_RUN of 83 acceptance checks (both experiments); every number and verdict is in `tools/continuum/QA_REPORT.md` and `tools/continuum/results/`.

- Ion experiment: solver I1–I18 18 of 18 PASS, browser IB1–IB12 12 of 12 PASS; independent SciPy reference: b +100 mV ((9,9), rims + molecular solvation + confined mobility): I 7.87565 vs 7.87904 pA (4.30e-4), Na⁺ 5.06e-4, Cl⁻ 2.07e-3. Earlier failing runs kept (`results/t_ions.run1.json`: I5; `results/t_ions.run2.json`: I14; `results/browser_ions.2026-10-22-baseline.json`: IB1, the unchanged suite under Chromium 131, before the procedure amendment).
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
