# Flow benchmark — acceptance criteria (release 2026.12)

Written on 10 November 2026, before the first formal run of `t_flow.js`, `reference_flow.py` and `browser_flow.js`.
Rules as for the other Continuum Lab experiments: criteria are fixed before evaluation, failing runs are kept, a FAIL is
never turned into a PASS, and nothing here is described as verified against OpenFOAM.

**What had been seen before these criteria were written.** While the plan was prepared (10 November 2026), values were
extracted from the published figures and compared with hand calculations. The reproduction criterion below (PR) was
therefore not preregistered for those values; it is the generic rule "within twice the combined extraction uncertainty",
and every record reports the normalised deviation z so that the margin is visible. The numerical criteria (P) do not
depend on any figure value.

**Three separate reports.**

1. *Numerical verification* (P): does the code solve the stated equations? Pass/fail.
2. *Source-curve reproduction* (PR): with the parameters read from the source paper, does the code return the model
   values the paper plots? Pass/fail within the extraction uncertainty. Parameters are taken from their own figures
   (Figs. 5a, 8a–c), never from the curve that is being compared.
3. *Agreement with molecular dynamics*: retrospective differences between the model and the published MD points.
   They are reported as numbers and carry no PASS or FAIL. No case is called a qualified prediction until an
   intended-use accuracy requirement has been written down and tested on an independent condition; no published case
   provides such a condition yet.

## Case under test

`pccp2024-water-cnt2020` in `lab/continuum/flow/data/cases.json`: water in a (20,20) tube, Phys. Chem. Chem. Phys. 26,
19069 (2024). Declared configuration: tube length 6.4 nm, gradient ΔP/L, slip-velocity form (Eqs. 3 and 5). Extraction
uncertainties are 2.5 px on the figure axis, taken as one standard uncertainty u.

Normalised deviation: z = (model − source) / sqrt(u_model² + u_source²), where u_model propagates the uncertainties of the
inputs (ΔP, viscosity, slip velocity, D′) to first order and u_source is the extraction uncertainty of the plotted value.

## Numerical verification (Node, `node tools/continuum/flow/t_flow.js`)

| # | Check | Criterion |
|---|---|---|
| P1 | Zero drive | With ΔP = 0 and zero slip velocity the profile is exactly 0 at 201 radii and Q = 0 exactly |
| P2 | Reversal | Reversing ΔP and the slip velocity reverses u(r) at 201 radii and Q; largest relative deviation ≤ 1 × 10⁻¹² |
| P3 | No-slip limit | The slip-velocity form with zero slip equals Hagen–Poiseuille: u(0) = R²G/(4μ) and Q = πR⁴G/(8μ) within 1 × 10⁻¹² (relative), at D and at D′ |
| P4 | Flow rate equals the integral of the profile | Q against 2π∫u r dr by composite Simpson quadrature (2000 intervals) within 1 × 10⁻⁹ (relative), for both families, both boundaries and three viscosities (12 combinations) |
| P5 | Mean velocity | Q/(πR²) equals u_s + R²G/(8μ) within 1 × 10⁻¹² (relative) for the same 12 combinations |
| P6 | Equivalent slip length | The slip-length form with L_s = 2μu_s/(GR) returns the slip-velocity profile at 201 radii and the flow rate within 1 × 10⁻¹² (relative) |
| P7 | Entrance resistance without double counting | With a series resistance cμ/R³: Q = ΔP/(R_ends + R_tube); interior and end pressure drops sum to ΔP; the profile computed with the interior gradient integrates to Q; all within 1 × 10⁻⁹ (relative), for c = 3 and c = 1 |
| P8 | Units | 1 pL/s = 1 × 10⁻¹⁵ m³/s and 1 MPa/nm = 1 × 10¹⁵ Pa/m; conversions there and back within 1 × 10⁻¹⁵ (relative) |
| P9 | Independent implementation | `reference_flow.py` (separate Python code, quadrature for the flow rate) agrees with the JavaScript module for every enabled combination: profile at the MD radii, flow rate, mean velocity and the entrance-resistance fraction, within 1 × 10⁻⁹ (relative) |
| P10 | Guards | Non-positive radius, viscosity or length, an unknown model family, boundary or viscosity, a disabled case and an entrance-resistance request at zero drive are each refused with an error (8 probes, 8 refusals) |
| P11 | Uncertainty propagation | The module's first-order standard uncertainty of Q (from the extraction uncertainties of ΔP, viscosity, slip velocity and D′) equals a propagation by central finite differences on each of those inputs, combined in quadrature, within 1 × 10⁻⁶ (relative), for the 12 combinations. Added on 10 November 2026 before run 3; see the record of runs |

## Source-curve reproduction (Node, same program)

| # | Check | Criterion |
|---|---|---|
| PR1 | Fig. 6a, curve at D: curvature | Model ΔP/(4μL) with the interfacial viscosity against the fitted curvature of the published curve; −2 ≤ z ≤ 2 |
| PR2 | Fig. 6a, curve at D: wall value | Slip velocity at D (Fig. 5a) against the end value of the published curve; −2 ≤ z ≤ 2 |
| PR3 | Fig. 6a, curve at D′ | Curvature, end radius (D′/2 from Fig. 8a) and wall value (slip velocity at D′, Fig. 5a) against the published curve; each −2 ≤ z ≤ 2 |
| PR4 | Fig. 7a, Eq. 5 at D, experimental viscosity | Model flow rate against the plotted value; −2 ≤ z ≤ 2 |
| PR5 | Fig. 7c, Eq. 5 at D, Green–Kubo and interfacial viscosity | Model flow rates against the two plotted values; each −2 ≤ z ≤ 2 |
| PR6 | Fig. 7a, Eq. 5 at D′, experimental viscosity | Model flow rate against the plotted value; −2 ≤ z ≤ 2 |

The same six comparisons with the alternative tube length of 6.0 nm are recorded for information and are not judged.

## Browser (Chromium, `node tools/continuum/flow/browser_flow.js`)

| # | Check | Criterion |
|---|---|---|
| PB1 | Load | `lab/continuum/flow.html` returns HTTP 200; no page error; no request outside the site; footer shows version 2026.12 |
| PB2 | Default state | The (20,20) case with the slip-velocity form at D and the interfacial viscosity is selected; flow rate, mean velocity and difference from MD in the page state equal the Node record within 1 × 10⁻¹² (relative), and the displayed text shows them to three significant figures; evidence label "Reconstruction" |
| PB3 | Plot | Six MD points, one classical curve and one model curve are drawn; the boundary band is absent; the model values at the six MD radii in the page state equal the Node record within 1 × 10⁻¹² (relative) |
| PB4 | Model choices | For all 12 combinations of family, boundary and viscosity selected through the page controls, flow rate and mean velocity equal the Node record within 1 × 10⁻¹² (relative) |
| PB5 | Boundary comparison | Off on load; switching it on draws the second curve and a band labelled "Boundary-choice sensitivity"; switching it off removes both |
| PB6 | Entrance-resistance sensitivity | Off on load; switching it on shows the remaining flow fraction equal to the Node record within 1 × 10⁻¹² (relative), names the assumption c = 3, and the flow rate equals fraction × the value without end resistance |
| PB7 | Cases not yet enabled | The four other cases are listed with their reasons, cannot be selected, and the page state stays on the enabled case |
| PB8 | Layout, keyboard and motion | No horizontal scrolling at 360, 390, 768 and 1440 px; every control is reached by Tab and shows a focus outline; with reduced motion the tracers do not move (two frames 600 ms apart are identical) and without it they do |
| PB9 | Experiment switch | The switch has three entries on the benchmark, ion and water pages; each page marks itself current; from the benchmark the links open the ion page and the water page |

## Record of runs

- **Run 1 (10 Nov 2026): 16 PASS** (P1–P10, PR1–PR6; `../results/t_flow.2026.12-run1.json`, with the Python side in
  `../results/flow_python.2026.12-run1.json`). First formal run, with the criteria above.
- **Run 2 (10 Nov 2026): 16 PASS**, every number as in run 1 (`../results/t_flow.2026.12-run2.json`). Only the wording
  of the detail texts changed (three significant figures, the viscosity names, the Python and SciPy versions in the
  record).
- **Written before run 3 (10 Nov 2026).** Two changes, no change of a criterion or threshold:
  1. *Correction.* In runs 1 and 2 the test program propagated the uncertainty of D′ into the two terms of Eq. 5 as if
     they were independent. Both terms contain the same radius, so their contributions add before squaring. This
     affects the model uncertainty of PR6 only (the one flow comparison at D′). The propagation now lives in the
     module (`flowUncertainty` in `lab/continuum/flow/core.js`), because the page also shows the uncertainty of the
     flow-rate difference, and the test program uses it for PR4–PR6.
  2. *Addition.* P11 checks that propagation against central finite differences. It was written before it was run.
- **Run 3 (10 Nov 2026): 17 PASS** (P1–P11, PR1–PR6; `../results/t_flow.2026.12-run3.json`). The
  correction changes one number: the model uncertainty of PR6 from 0.000512 to 0.000517 pL/s, and its z from +1.32 to
  +1.31. P11: largest relative difference from the finite-difference propagation 3.2 × 10⁻¹¹. Every other number as in
  runs 1 and 2. Largest |z| of the reproduction checks: 1.31 (PR6); the next is 1.01 (PR2).
- **Run 4 (10 Nov 2026): 17 PASS**, every verdict and detail text identical to run 3 (`../results/t_flow.json`,
  `../results/flow_python.json`). Only the record changed: it now also lists the z values of the comparisons with the
  alternative tube length as numbers, which the page prints. Kept as `../results/t_flow.2026.12-run4.json`.
- **Written before run 5 (10 Nov 2026): three readings corrected; no criterion or threshold changed.** A check of the
  case sheet against the figure images showed that three values had been read from triangle markers as the centroid of
  the marker area. The plotting program places the value at the centre of the marker's bounding box, 2.4–2.8 px
  higher. The (6,6) point of Fig. 7a decides between the two: Eq. 5 gives +0.00005 pL/s there; the centroid reads
  −0.00020 pL/s and the bounding-box centre +0.00004 pL/s. Re-read by bounding-box centre:
  - Green–Kubo viscosity, Fig. 8c (an input): 0.640 → 0.648 mPa·s;
  - Eq. 5 at D with Green–Kubo viscosity, Fig. 7c (the published value of PR5): 0.0231 → 0.0233 pL/s;
  - Eq. 5 at D′ with experimental viscosity, Fig. 7a (the published value of PR6): 0.0112 → 0.0114 pL/s.
  Every other value of the case sheet was read from a circle, a square, an asterisk or a curve, for which the two
  centres coincide. The second published value of the default combination (Fig. 9b, a triangle; not used by a check)
  is now recorded as 0.0244 instead of 0.0241 pL/s, and the molecular-dynamics flow rate of Fig. 9b is flagged as read
  from a partly covered marker. The corrections move PR5 and PR6 towards agreement. Both passed before (z = +0.48 and
  +1.31), so no verdict depends on them. `digitize_fig.py` gained the option `centre='bbox'`.
- **Run 5 (10 Nov 2026): 17 PASS** (P1–P11, PR1–PR6; `../results/t_flow.json`, `../results/flow_python.json`), with the
  corrected readings. PR5: z = +0.24 (Green–Kubo, was +0.48) and +0.32 (interfacial, unchanged); PR6: z = +0.95 (was
  +1.31). Largest |z| of the reproduction checks: 1.01 (PR2). The numerical checks and the reported agreement of the
  default combination are unchanged (flow rate +16.0 %, profile rms 32.5 %). The record for the released files.

### Browser checks

- **Browser run 1 (10 Nov 2026): 9 PASS** (PB1–PB9; `../results/browser_flow.2026.12-run1.json`), the first formal run,
  Chromium 141.0.7390.37 (headless shell). Page and Node record agree exactly for the default state, the six profile
  values, all 12 combinations, the second boundary and the entrance-resistance fraction (largest relative difference 0).
- **Written before run 2.** After run 1, files that the page loads changed, without any change of a criterion: the
  page's check records (`validation.json` now carries the browser record), `flow/app.js` (a linked panel is scrolled to
  once the page has been filled; the Pause button changes its label only), `flow/flow.css` (spacing of two notes),
  `flow.html` (one sentence on the bulk viscosity) and, for PB9, the ion and water pages, which were rebuilt with their
  own new records.
- **Browser run 2 (10 Nov 2026): 9 PASS** on the final files (`../results/browser_flow.json`). Every detail text as in
  run 1; `validation.json`, written again from this record, is byte-identical to the file the run used. The record for
  the released files.

## Records

- `tools/continuum/results/t_flow.json` (P, PR and the reported agreement with MD), `flow_python.json` (the Python
  side of P9) and `browser_flow.json` (PB). Superseded records are kept beside them with the release and run number.
- `lab/continuum/flow/data/validation.json` is written from those records by `make_flow_validation.js` after the runs;
  the page reads it. The page's code is not rebuilt after the runs.
