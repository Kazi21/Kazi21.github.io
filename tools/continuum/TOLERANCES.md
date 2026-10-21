# Continuum Lab — acceptance tests and tolerances (frozen before evaluation)

Written on 18 October 2026 **before** any acceptance test was run. A test PASSES only if every stated criterion holds;
otherwise it FAILS. A test that was not executed is NOT_RUN; a configuration outside the declared scope is
UNSUPPORTED. Each required test script exits with a non-zero status on FAIL. Any later change to a criterion is
recorded under "Amendments" with its reason, and the original result is kept.

Default device used below ("default device"): W = B = 2 µm, H = 1 µm per chamber, ports 0.4 µm square, no-slip walls,
pitch 10 nm (40 000 pores), law `illustrative-cnt66-v1`, ΔP = 1 MPa, permeate port at 0.101325 MPa, mesh 20 × 20
cells laterally and 10 cells per chamber height. "Patch" = one cell of the 5 × 5 patch grid over the membrane.
(Definition amended before any solver test was run; see Amendments.)

## Network and core modules (Node; `tools/continuum/tests/t_core.js`)

| # | Test | Criterion |
|---|---|---|
| N1 | Unit conversions | 10 000 random round trips per conversion (nm, µm, mm, MPa, bar, LMH, LMH/bar, molecules/ns): relative error ≤ 1 × 10⁻¹⁴ |
| N2 | Counting | W = B = 1 µm, s = 10 nm → 10 000; W = B = 1 mm → 10¹⁰ exactly; per-face counts sum to the total for every allowed W, B and mesh levels 10, 20 and the fine level; every face of an intact membrane holds the same count on levels 20 and fine |
| N3 | Zero drive | Network with ΔΠ = 0: q = J = Q = 0 exactly; every diagnostic finite |
| N4 | Parallel law | 1000 tubes with random G_i spread over 16 faces, equal local ΔΠ: Q = Σ G_i ΔΠ within 1 × 10⁻¹² relative |
| N5 | Single-tube scope | Blocking one of N identical tubes at equal local ΔΠ changes Q by −Q/N within 1 × 10⁻¹² relative of the expected change, for N = 10⁴ and N = 10¹⁰ |
| N6 | Area scaling | Doubling W at fixed s and local ΔΠ doubles Q (1 × 10⁻¹² relative) and leaves J unchanged (1 × 10⁻¹²) |
| N7 | Length treatment | Illustrative law rejects any L ≠ 2.4595 nm; HPW reference: 1/G equals R_entry + r_interior L + R_exit within 1 × 10⁻¹² at three lengths |
| N8 | Data scope | validateScenario rejects a wrong diameter preset, temperature, fluid, drive outside the interval, reference-plane convention, W/B outside the list, aspect ratio > 4; accepts the default device |
| N9 | Shared uncertainty | With G ± 20 % shared, the relative half-width of Q equals 20 % within 1 × 10⁻¹² for N = 10², 10⁴ and 10¹⁰ (membrane-only network) |

## Continuum solver (Node; `tools/continuum/tests/t_solver.js`)

| # | Test | Criterion |
|---|---|---|
| S1 | Developed duct | Single chamber, square cross-section 24 × 24 cells, length 12 cells, no-slip side walls, full-face pressure ports: Q within 1 % of the series solution; velocity at mid-length within 1 % normalised L2 |
| S2 | Duct refinement | 12, 24 and 48 cells across: Q error decreases monotonically; observed order reported |
| S3 | Exact membrane | Free-slip side walls, full-face ports, uniform membrane: J = ΔP/Rs within 1 × 10⁻¹⁰ relative and chamber pressures within 1 × 10⁻¹⁰ (relative to ΔP) of their port values, for chamber-to-membrane resistance ratios from 1 to 10⁻¹² |
| S4 | Steady mass balance | Default device, uniform and with one closed patch: |Q_in − Q_out| / Q_in ≤ 1 × 10⁻⁶, and port flow equals membrane flow to the same tolerance |
| S5 | Interface conservation | Sum of the feed-chamber divergence rows equals port inflow minus membrane outflow, and the permeate rows the reverse, within 1 × 10⁻¹⁴ relative (shared unknown) |
| S6 | Closed regions | J = 0 exactly on closed faces; the closed-patch field satisfies S12 and its chamber velocity differs from the uniform field by > 10⁻³ in relative L2 (a solved field, not a painted one) |
| S7 | Reversal | ΔP → −ΔP reverses every J_c with magnitude preserved within 1 × 10⁻⁶ relative |
| S8 | Passive dissipation | Σ A_c J_c ΔΠ_c ≥ −1 × 10⁻¹² |ΔP Q| and viscous dissipation ≥ 0 |
| S9 | Pressure bookkeeping | S3 case: ΔΠ = ΔP within 1 × 10⁻¹⁰; default device: |ΔP Q − Φ_visc − Φ_m| / (ΔP Q) ≤ 1 × 10⁻⁸ |
| S10 | Mesh refinement | Default device with one closed patch at 10, 20 and 40 cells across W: |Q₄₀ − Q₂₀| / Q₄₀ ≤ 2 %; a velocity-profile norm between levels is reported |
| S11 | Zero drive and disconnection | ΔP = 0 gives exactly zero fields; all membrane faces closed at ΔP = 1 MPa solves, Q = 0 exactly, chamber pressures equal their port values within 1 × 10⁻¹⁰ relative |
| S12 | Algebraic residual | Every accepted solution: ‖b − Kx‖ / ‖b‖ ≤ 1 × 10⁻⁹, momentum and continuity blocks reported separately |
| S13 | Independent algebraic reference | Python (SciPy sparse direct solve of an independently assembled system) on the 10-cell mesh for the uniform device, a closed patch and a modified tube: Q within 1 × 10⁻⁸ relative; max velocity difference ≤ 1 × 10⁻⁶ of max velocity |
| S14 | Single tube in the CFD | Closing one tube in the default device changes Q by −G ΔΠ_local within 1 × 10⁻⁶ relative of that expected change. **Amended 19 Oct 2026 (see Amendments):** by ΔS_c ΔΠ_c² / ΔP = −G ΔΠ_c (ΔΠ_c / ΔP) within 1 × 10⁻⁶ relative, ΔQ from the change solve |

Addition (19 Oct 2026, written before the test was run):

| # | Test | Criterion |
|---|---|---|
| S15 | Change solve at 10¹⁰ pores | W = B = 1 mm (10¹⁰ pores), mesh 20, ΔP = 1 MPa, closing one tube: the change solve gives ΔQ within 1 × 10⁻⁶ relative of ΔS_c ΔΠ_c² / ΔP (ΔQ / Q ≈ 10⁻¹⁰, below the precision of differencing two full solutions); restoring the tube returns the baseline face fluxes within 1 × 10⁻¹² relative of max J |

## Native comparison (OpenFOAM v1912; `tools/continuum/openfoam/`)

Same physical case, same tangential treatment (browser comparison closure for cyclic baffles).

| # | Test | Criterion |
|---|---|---|
| F1 | Developed duct | Q within 2 % and mid-length velocity normalised L2 within 5 % between browser solver and OpenFOAM |
| F2 | Uniform resistance interface (porousBafflePressure) | Q within 2 %, velocity normalised L2 within 5 % |
| F3 | Closed strip | Q within 2 %, velocity normalised L2 within 5 % |
| F4 | Refined mesh | F3 on the refined mesh: Q within 2 %; interpolation and mesh differences reported |

## Browser and regression (Playwright, Chromium; `tools/continuum/tests/browser_continuum.js`)

| # | Test | Criterion |
|---|---|---|
| B1 | Lazy start | No continuum worker or solver script requested before "Run experiment" |
| B2 | Run | Converged result; Q equals the Node solver for the same scenario within 1 × 10⁻⁹ relative |
| B3 | Pressure change | Q scales with ΔP within 1 × 10⁻⁹ relative |
| B4 | Scopes | One tube closed: ΔQ = −G ΔΠ_local within 1 × 10⁻⁶; patch closed: J = 0 on its faces; whole membrane ×2: Q doubles within 1 × 10⁻⁶. **Amended 19 Oct 2026, before any browser test was run:** one tube closed: ΔQ = −G ΔΠ_c² / ΔP within 1 × 10⁻⁶ (as S14); whole membrane ×2: the browser Q equals the Node solver within 1 × 10⁻⁹ and lies between Q and 2Q (it doubles only when the chambers carry no resistance) |
| B5 | Restore | Restoring returns Q to the baseline value within 1 × 10⁻¹² relative |
| B6 | Baseline comparison | ΔQ, ΔJ and affected pore count shown and equal to the computed values |
| B7 | Export | ZIP contains scenario.json, pore_law.json, results.json, field files, probes.csv, events.json, environment.json, README.md; the Node reproduction recomputes Q within 1 × 10⁻⁹ |
| B8 | Keyboard and touch | All primary controls operable by keyboard; tabs and selection work by touch at 390 px |
| B9 | Stale results | Ten input changes within 200 ms: the displayed result belongs to the final revision |
| B10 | Layout | No horizontal overflow at 360, 390, 768 and 1440 px; no uncaught page errors; reduced motion disables camera animation |
| R1 | Regression | Home page, CV link, Water Lab start, CNT inspector playback and evidence page load without page errors |

Addition (19 Oct 2026, presentation review; written before the code change and before these tests were run):

| # | Test | Criterion |
|---|---|---|
| B11 | Fixed visual scale | With the colour and tracer scale fixed to a 1 MPa baseline, a change to 4 MPa leaves the flow-legend range and the tracer time factor equal to the baseline's (relative 1 × 10⁻¹²) while the computed maximum speed is 4 × the legend maximum (relative 1 × 10⁻⁹), and the legend states that the range is fixed and that values above it are saturated; switching to Automatic sets the legend maximum to the result's own maximum and the tracer time factor to the result's own |
| B12 | Guided path | The guided experiment (Run → ΔP 1 → 4 MPa → block the centre patch → compare with the baseline → tube, patch and whole membrane explained with the tube zoom) completes at 1280 px and at 390 px with touch, without page errors: after the pressure step Q is 4 × the first result (relative 1 × 10⁻⁹); after the block J = 0 on the patch faces; the comparison table shows a ΔQ equal to the computed value; the zoom shows tubes of the selected patch |
| B13 | Resolution status in the page | For the default device and for its closed-patch state, the decision panel shows a total-flow two-level check of the displayed configuration (same configuration identifier) with status PASS; at ΔP = 0 it shows NOT APPLICABLE; the panel states that the check concerns total flow, not the local field near the ports |

Addition (20 Oct 2026, release 2026.7: 3D pore view; written before the code change and before these tests were run):

| # | Test | Criterion |
|---|---|---|
| B14 | 3D pore view | Opening "Pores in 3D" after a run requests the 3D library only then (no request for it before the view is opened) and draws a non-blank WebGL frame; the scene holds exactly the tubes of its reported window (rendered tube count = reported count) at their real lattice positions (10 nm pitch, 0.814 nm diameter, 2.46 nm length, no enlargement); each tube's drift speed equals its single-pore flow q_i = G_i ΔΠ_c from the current solution (the same values as the membrane zoom) times one factor common to all tubes (relative 1 × 10⁻¹²); with the scale fixed to a 1 MPa baseline the factor is unchanged at 4 MPa, so every speed is 4 × its baseline value (relative 1 × 10⁻⁹); a blocked tube has speed 0 and carries a blocked marker; under reduced motion the molecules do not move until Play is pressed; no page errors at 1280 px and at 390 px with touch |
| B15 | WebGL fallback | With WebGL unavailable (browser started with WebGL disabled), opening "Pores in 3D" shows a text fallback that names the missing capability, the experiment still runs to a converged result, and there are no page errors |

Addition (20 Oct 2026, release 2026.8: composition and wording of the 3D view after an external review; written
before the code change and before the test was run):

| # | Test | Criterion |
|---|---|---|
| B16 | 3D view: camera presets, openings, provenance and caption | The view opens on "Focus pore" (camera target within 2 nm of the selected tube, camera distance below 10 nm, 1 nm scale bar shown) and "Array context" moves the camera back (distance above 15 nm, 5 nm bar shown) without changing the tube count, positions, drift speeds or speed factor (relative 1 × 10⁻¹²); the membrane faces have real openings, one per drawn tube (for a 5 × 5 window: 20 holes and 5 half-openings at the cut edge, on both faces); the viewport carries the badge "Continuum-driven schematic" and the molecule panel the tag "Recorded CP2K AIMD"; the camera buttons, Pause and Reset come before the caption in document order; the caption's selected-pore throughput equals q_sel / v_w in molecules per ns (to its 3 displayed significant figures), its total flow equals the result's Q and its open-pore count is 40 000 of 40 000 for the default device and 39 999 of 40 000 with one tube closed; no page text contains "stands still"; the drawn molecules use O–H 0.1000 nm and H–O–H 109.47° (SPC/E); the sixth guided step shows "Array context"; no page errors at 1280 px and at 390 px with touch |

Clarification of B16 (20 Oct 2026, after its first two runs, before release). "No page text" was implemented as the
whole page, including the Validation section, which reproduces every criterion and recorded result verbatim. Run 1
failed only on that check because the section still carried the 2026.7 record of the guided path, which quotes the
old sentence; run 2 failed only on it because the section now quotes this criterion itself and run 1's detail. The
check is self-referential there, so it applies to the page outside the Validation section; every other part of B16
passed in both runs, unchanged. Both runs are kept (`results/browser.2026.8-run1.json`, `results/browser.2026.8-run2.json`).

## Calibration and analysis tools (`tools/continuum/tests/t_tools.sh`)

| # | Test | Criterion |
|---|---|---|
| A1 | analyze_pore_flux.py | `--help` works; on the labelled synthetic fixture with known G the estimate's interval contains G; a too-short series reports insufficient data; failed acceptance exits non-zero |
| A2 | check_conservation.py | Passes on an exported result; exits non-zero on a deliberately corrupted copy |
| A3 | compare_openfoam.py | Exits non-zero when a comparison exceeds its gate |

Addition (20 Oct 2026, release 2026.8; written before the code change and before the test was run). An external
review showed that `analyze_pore_flux.py` computed the equilibrium linear response only as a diagnostic, although
`md-calibration/README.md` makes its agreement with the driven slope the condition for covering the lab's 0–10 MPa
range: the supported interval always reached zero drive. A4 makes the README's rule executable.

| # | Test | Criterion |
|---|---|---|
| A4 | Equilibrium gate (analyze_pore_flux.py) | The low-pressure extension (supported interval reaching zero drive) is granted only when (a) at least two zero-drive replicas show crossing fluctuations and the equilibrium conductance G_eq has a relative standard error ≤ 10 % (so that a 30 % disagreement would be detected with about 85 % probability); (b) the pooled block variance of the zero-drive crossing counts grows linearly with block length over at least three block lengths (χ² test at the analysis confidence level; a constant offset is allowed for rapid recrossings of the counting plane), with D_N > 0; (c) \|G_eq − G\| ≤ z √(SE_eq² + SE_G²). Synthetic fixtures sharing the driven data of A1: unchanged zero-drive data → granted, interval starts at or below 0; zero-drive crossing fluctuations removed → refused; zero-drive fluctuations four times the fluctuation–dissipation value → refused; a single zero-drive replica → refused. Every refusal names its reason and starts the supported interval at the lowest positive driven condition (50 MPa), so no lab drive (0–10 MPa) lies inside it |
| A5 | Equilibrium estimator, Monte Carlo (analyze_pore_flux.py) | 40 independent synthetic data sets of the zero-drive design (4 replicas × 20 ns, declared G = 1.00 × 10⁻²⁷ m³ Pa⁻¹ s⁻¹, seeds 2000–2039, not used before this criterion was written), each analysed without and with rapid recrossings of the counting plane (two-state term switching 0.5 times per ps: variance offset 0.5, long-time D_N unchanged): the mean of G_eq/G lies within 3 standard errors of 1 in both cases; with recrossings the mean single-block estimate exceeds 2 G (the bias the variance slope removes); the mean reported relative standard error lies within a factor 1.5 of the observed scatter of G_eq/G in both cases. Reported but not gated: the fraction of data sets for which the gate grants the extension, taking the driven slope as the declared G with a 3.5 % standard error |

Revision of A4 before release (20 Oct 2026, after a pilot run; disclosed here and in the QA report). As first written,
A4 also required that a sixth fixture, 'recross' (the 'good' zero-drive data plus rapid recrossings), be granted. The
pilot refused it: G_eq = 1.153 × 10⁻²⁷ against the driven slope 9.684 × 10⁻²⁸, z = 2.36 > 1.96, offset C = 0.496
recovered, single-block estimate 3.83 × 10⁻²⁷. That sub-criterion was ill-posed: it fixed the outcome of a 95 % test
on one random realization (such a test refuses about one consistent data set in twenty), and the realization reuses
the zero-drive draws of 'good', which already lie at z = 1.86. The gate did what the README rule says on the data it
was given. The sub-criterion was removed from A4 and replaced by A5, which tests the property it was meant to test
(no bias from recrossings) on fresh seeds. A pilot Monte Carlo with seeds 1000–1039, run before A5 was written, gave
mean G_eq/G = 1.011 (scatter 0.060, mean reported relative standard error 0.068) without and 1.019 (0.099, 0.088)
with recrossings, and a mean single-block estimate of 3.73 G with recrossings. The `recross` fixture stays in
`fixtures/` for inspection; its gate decision is reported in the A4 detail as measured.

## Decision rules (Node; `tools/continuum/tests/t_decision.js`)

Added 19 Oct 2026 (presentation review), written before the code change and before the tests were run. They concern
the "Numerical resolution" row of the page's decision panel, whose first version could report PASS from a fine mesh
alone and from the intact-membrane table for a modified membrane.

| # | Test | Criterion |
|---|---|---|
| D1 | State-matched resolution status | Every run result carries a total-flow comparison computed for its own configuration at a second mesh level (10 cells for the standard mesh, 20 for a fine mesh): the comparison scenario equals the run scenario in every field except the mesh level; the default device, the default device with the centre patch closed, and a 20 µm × 5 µm device give |ΔQ|/Q ≤ 2 % and status PASS |
| D2 | No certification by proxy | The status function returns PASS only from a comparison of the same configuration: a fine mesh without a comparison, and a modified membrane with only the intact-membrane table, give NOT_CHECKED (never PASS); a comparison with |ΔQ|/Q = 0.03 gives FAIL and one with 0.01 gives PASS |
| D3 | Zero flow | ΔP = 0, and all membrane faces closed at ΔP = 1 MPa: both levels give Q = 0 exactly and the status is NOT_APPLICABLE (neither FAIL nor PASS); all reported numbers are finite |

## Amendments

- 18 Oct 2026, default device and mesh levels (before any solver acceptance test was run): mesh 16 × 16 × 8 → 20 × 20 × 10,
  port side 0.5 → 0.4 µm, patch grid 4 × 4 → 5 × 5, refinement levels 8/16/32 → 10/20/40, S13 mesh 8 → 10. Reason: a
  development probe showed that a 16-cell grid aliases the 10 nm lattice (12.5 pitches per face: 144/156/169 pores per
  face, a ±8 % striped flux map). Criteria unchanged; N2 extended to check equal face counts.

- 18 Oct 2026, N5 (procedure amended after the first run FAILED; criterion unchanged): the first run differenced two
  rebuilt face conductance sums. At N = 10¹⁰ each face holds about 3.9 × 10⁷ pores, so Float64 rounding of each sum
  (half an ulp, ≈ 4 × 10⁻⁹ G₀) left the one-tube change with a relative error of 3.17 × 10⁻⁹ (N = 10⁴: 5.45 × 10⁻¹⁵,
  passing). The membrane map now computes conductance changes from the modifications themselves
  (`conductanceChange`), which the interface also uses for its network reference. The original numbers are kept in
  `results/t_core.json`. Consequence for the solver: a Q difference between two full solutions cannot resolve a
  one-tube change in a 10¹⁰-pore membrane beyond about six significant digits in Float64; such changes are reported
  with that stated precision and with the network reference.

- 19 Oct 2026, S13 (reference procedure corrected during development runs, before the first official run; criterion
  unchanged): development runs of S13 found (i) a defect in the browser solver's sparse-matrix compaction (`toCsr`
  overwrote not-yet-read entries while merging duplicates: 8 corrupted entries at chamber corners, velocity differences
  of 0.4 %), now fixed — the two independently assembled matrices agree entry by entry (27 716 entries, none
  differing); (ii) after the fix, velocity differences of 5.17 × 10⁻⁶ of max remained because the unscaled SciPy LU
  solve of the SI-unit system leaves row-relative residuals of 3.15 × 10⁻³ in chamber continuity rows (its 2-norm
  residual is nevertheless ~10⁻¹⁵, dominated by the membrane rows). The reference now applies symmetric diagonal
  equilibration and three steps of iterative refinement (row-relative residual 2.5 × 10⁻¹⁶); the browser solution
  differs from it by 1.84 × 10⁻¹³ of max velocity. The solver now also reports the row-relative residual.

- 19 Oct 2026, S14 (criterion amended after the first official run FAILED): the frozen criterion compared the change
  with −G ΔΠ_local, which assumes that the local driving potential does not respond to the closure. In the coupled
  model the chambers respond. For a reciprocal linear system (the assembled matrix is symmetric) the first-order
  sensitivity is exactly ∂Q/∂S_c = ΔΠ_c² / ΔP (adjoint/Tellegen identity), so closing one tube changes Q by
  ΔS_c ΔΠ_c² / ΔP = −G ΔΠ_c (ΔΠ_c / ΔP); the second-order remainder is about (G / S_c) × (local chamber share)
  ≈ 10⁻⁷ relative here. Official run 1 (kept unchanged in `results/t_solver.run1-frozen.json`): ΔQ = −9.99986977 ×
  10⁻²² m³/s against −G ΔΠ_local = −9.99993485 × 10⁻²² m³/s, relative difference 6.51 × 10⁻⁶ > 10⁻⁶: **FAIL**; the
  difference is the local share of the pressure drop outside the membrane (global chamber share 6.72 × 10⁻⁶).
  Amended procedure: ΔQ is computed by the change solve (`solveChange`: the difference of the two states solved
  directly, so a one-tube change keeps full relative precision at any pore count) and compared with ΔS_c ΔΠ_c² / ΔP;
  the full-solution difference and the original criterion are reported alongside. B4 (not yet run) is amended in the
  same way; its "Q doubles" clause is replaced because doubling holds only without chamber resistance.

- 19 Oct 2026, F2–F4 case parameter (fixed before any native comparison was evaluated; criteria unchanged): the
  comparison membrane has Rs = 2.5 × 10⁴ Pa s m⁻¹ with ΔP = 1 Pa (creeping flow in both codes). OpenFOAM v1912
  evaluates the porousBafflePressure jump explicitly from the previous flux and offers no relaxation for it; in
  development runs SIMPLE stalled (initial residuals 0.1–0.8 after 1500–6000 iterations) for the first choice
  Rs = 6.7 × 10⁵ Pa s m⁻¹ (membrane and chambers sharing the resistance) and for 1.0 × 10⁵ and 2.5 × 10⁵, and SIMPLEC
  diverged at every value tried; Rs = 2.5 × 10⁴ (about 3 μ/Δz on the 20-cell mesh) converged in about 250
  under-relaxed SIMPLE iterations. With this resistance the chambers carry most of the resistance and the flux is
  strongly non-uniform, so the comparison tests the coupled field; the browser's implicit interface is verified for
  any resistance ratio by S3.

- 19 Oct 2026, reported convergence study (added after F2–F4 had been evaluated and failed; not a gate; criteria and
  verdicts of F1–F4 unchanged): the closed-strip case F3 is also run on 80 × 80 × 40 cells per chamber in both codes
  (`F5_strip_80`), so that `compare_openfoam.py` can report three levels (20, 40, 80 cells), the observed order of each
  code, Richardson-extrapolated Q and the grid convergence index of the finest level (Roache, three grids, safety
  factor 1.25), with a statement of what they show. The OpenFOAM run of this case uses looser inner-solver settings
  than F1–F4 (GAMG tolerance 10⁻¹³, relTol 0.01, maxIter 100; residualControl p 10⁻¹⁰; a write every 250 iterations):
  with the F1–F4 settings the pressure solver reached its 200-iteration limit in every outer iteration once the
  residual approached 10⁻¹⁰ (about 12 s per iteration); that first attempt was stopped after 1787 iterations without a
  result. The run's iteration count and final residual are recorded in `results/openfoam.json`.

- 21 Oct 2026 (release 2026.9; written before the run): the water-flow experiment moved from `lab/continuum/` to
  `lab/continuum/water.html`, because the ion experiment now opens at `lab/continuum/`. The browser and regression
  tests B1–B16 and R1 run at the new address; the page gained an experiment switch and a link to the ion experiment.
  No criterion changed. The 2026.8 record is kept as `results/browser.2026.8-run3.json`. Run 1 at the new address:
  17 of 17 PASS (`results/browser.2026.9-run1.json`). After run 1 a shared stylesheet changed (the outlook panel of
  the home page, which R1 loads, no longer overflows on a phone), so the suite was run again for the released files:
  run 2, 17 of 17 PASS (`results/browser.2026.9-run2.json`). After run 2 one sentence of the home page changed (text
  only), so the suite was run a third time: run 3, 17 of 17 PASS (`results/browser.json`).

- 21 Oct 2026 (release 2026.9.1; written before the run): the status label of the water page reads "Numerically
  converged"; the home page changed (defense date, Lab card wording). No criterion changed. The 2026.9 record is kept
  as `results/browser.2026.9-run3.json`; run 1 of 2026.9.1: 17 of 17 PASS (`results/browser.json`).
