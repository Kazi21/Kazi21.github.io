# The Continuum Lab

Since release 2026.12.2 the public Continuum Lab is **one published case in three views**: water flow in a (20,20)
carbon nanotube, described by a continuum model with molecular boundary inputs and compared with published molecular
dynamics (`lab/continuum/flow.html`, "The Continuum Lab: Molecular boundaries and nanoscale flow").

The two earlier experiments were retired from the public site in the same release:

- **Ion transport through one nanotube pore** (`lab/continuum/`, releases 2026.9 to 2026.12);
- **Water flow through a nanotube membrane** (`lab/continuum/water.html`, releases 2026.6 to 2026.12).

Their addresses show a short notice (`noindex`) that points to the flow comparison. Their source, criteria and complete
records are kept in a development archive outside the deployment (`continuum-development-archive-2026.12.1.zip`, a
byte-identical snapshot of release 2026.12.1 with a SHA-256 manifest) and in the public history of this repository
(commit eb698af and earlier). Their last results: ion transport 32 of 32 checks passed; membrane flow 50 of 53, with the
three comparisons with OpenFOAM (F2–F4) failing and recorded as failures. Retiring them from the site does not make
that history private.

## Status

**One case enabled, labelled "Published-case reconstruction"; no case is called a prediction.** Every input was read
from the figures of a published article with a stated extraction uncertainty; nothing unpublished enters the page.
Independent physical validation is not established: it needs boundary inputs obtained independently of the driven run
and an accuracy requirement written down for a stated use before the comparison.

## What the page does

- **Case.** Water (SPC/E, 300 K) in a (20,20) carbon nanotube, K. E. Karim, M. Barisik, C. Bakli and B. Kim,
  Phys. Chem. Chem. Phys. 26, 19069–19082 (2024), doi:10.1039/D4CP01068J. Four further cases are listed in the case
  file as not yet enabled, each with its reason ((9,9), (6,6) and (12,12) water; liquid argon, Phys. Rev. E 103,
  053115, 2021). A case is enabled when its sheet names source, units, parameters, pressure planes, flow definition and
  unresolved items, and when its source-curve reproduction passes. The case is described in two lines above the plot,
  with one evidence badge; a case or pressure selector appears only when there is a choice.
- **Three views, one state.** A tab list switches between "Velocity profile", "Boundary sensitivity" and "Flow rate &
  evidence". The plot, the cutaway, the four results and every control are shared. "Velocity profile" switches the
  boundary comparison off; "Boundary sensitivity" switches it on and tabulates both conventions; "Flow rate & evidence"
  keeps the current settings and lists the flow rates, both differences with their definitions and sources, and what
  has been checked.
- **Model** (`lab/continuum/flow/core.js`, pure functions, SI units): classical Hagen–Poiseuille flow (source Eqs. 1–2)
  and the slip-velocity form (Eqs. 3 and 5), u(r) = (R²G/4μ)(1 − r²/R²) + u_s and Q = πR⁴G/(8μ) + πR²u_s, with the
  gradient G = ΔP/L of the source (ΔP between the bulk regions of the two reservoirs) and one of three viscosities
  (interfacial, Green–Kubo, experimental).
- **Boundary conventions.** The carbon-centre boundary (R = D/2) and the first-density-peak boundary (R = D′/2) are two
  continuum conventions for the same molecular system. Each comes with its own slip velocity, measured at that position
  in the same driven run, so changing the convention changes two model inputs, the effective radius and the slip
  velocity; the molecular-dynamics reference does not change. The band drawn by "Compare boundary definitions" is
  labelled "Boundary-convention sensitivity": a sensitivity to the convention, not an uncertainty or a confidence
  interval.
- **Default.** Slip-velocity form at the carbon-centre boundary with the interfacial viscosity. It follows a rule set
  while the case was planned (10 November 2026): the one combination for which the source shows both the profile
  (Fig. 6a) and the flow rate (Fig. 7c). The published differences of several combinations were already known then; the
  default is not the combination that agrees best, and the page lists all twelve.
- **Entrance-resistance sensitivity** (in "More settings", off on load): cμ/R³ with an assumed c = 3 (Sampson; the
  source's Eq. 7 gives no value) in series with the tube, using the slip length equivalent to the measured slip
  velocity; the profile is computed with the interior pressure drop only. A model sensitivity, not part of the
  comparison.
- **Uncertainty.** `flowUncertainty` propagates the extraction uncertainties of ΔP, viscosity, slip velocity and D′ to
  the flow rate (first order). These are reading uncertainties (2.5 px on the figure axis, one standard uncertainty),
  not statistical uncertainties of the simulation.
- **Four kinds of statement, kept apart.** Numerical verification (P1–P11) and source-curve reproduction (PR1–PR6) are
  judged against criteria; the agreement with molecular dynamics is reported as calculated, without a pass or fail,
  because no accuracy requirement exists; independent physical validation is not established.
- **Timing of the criteria.** The criteria in `tools/continuum/flow/TOLERANCES.md` were written on 10 November 2026,
  before the first formal run but after the values had been read from the figures; the reproduction criterion is
  therefore the generic rule |z| ≤ 2 and every record reports z. Later checks were written before their first run.

## Files

```
lab/continuum/flow.html              the page (static; version number in its footer and data-version)
lab/continuum/flow/core.js           model, comparison with the reference, uncertainty propagation (ContinuumFlow)
lab/continuum/flow/app.js            page logic, three views, velocity plot (SVG), cutaway (canvas); test hook window.__flowLab
lab/continuum/flow/lab.css           base styles taken over from the retired experiments' stylesheets (unchanged rules)
lab/continuum/flow/flow.css          page styles
lab/continuum/flow/data/cases.json   case sheets: inputs, uncertainties, sources, unresolved items
lab/continuum/flow/data/validation.json  check records shown on the page (written by make_flow_validation.js)
lab/continuum/index.html             notice: the ion-transport experiment was retired (noindex)
lab/continuum/water.html             notice: the membrane-flow experiment was retired (noindex)
tools/continuum/flow/TOLERANCES.md   criteria and the record of runs
tools/continuum/flow/t_flow.js       P1–P11, PR1–PR6 and the reported agreement (Node)
tools/continuum/flow/reference_flow.py   independent implementation for P9 (force balance and quadrature; SciPy)
tools/continuum/flow/browser_flow.js PB1–PB14 (Chromium through Playwright)
tools/continuum/flow/make_flow_validation.js   writes validation.json from the records
tools/continuum/flow/preview.html    draws the home-page card image (assets/figures/flow-comparison-preview.png);
                                     tools/continuum/flow/make_preview.js renders it
tools/continuum/flow/digitize_fig.py figure-reading functions (needs the article's figure images, which are not
                                     redistributed here)
tools/continuum/make_qa_report.py    writes tools/continuum/QA_REPORT.md and the results block below
tools/continuum/results/             t_flow, flow_python and browser_flow records, with the superseded runs
```

## Reproduce the checks

```
node tools/continuum/flow/t_flow.js                      # P1-P11, PR1-PR6 (runs reference_flow.py; needs Python 3 with SciPy)
python3 -m http.server 8765 &                            # from the repository root, then:
node tools/continuum/flow/browser_flow.js                # PB1-PB14 (needs Playwright + Chromium)
node tools/continuum/flow/make_flow_validation.js        # rewrite the page's check records
python3 tools/continuum/make_qa_report.py --readme       # QA report and the results block below
```

A new release changes the version in `flow.html` (footer and `data-version`) and `cases.json` (`release`); PB1 checks
the footer.

<!-- BEGIN:results (written by tools/continuum/make_qa_report.py --readme) -->
## Results of this release (generated)

31 PASS, 0 FAIL, 0 NOT_RUN of 31 acceptance checks for the public Continuum Lab; every number and verdict is in `tools/continuum/QA_REPORT.md` and `tools/continuum/results/`.

- Numerical verification P1–P11 11 of 11 PASS, source-curve reproduction PR1–PR6 6 of 6 PASS, browser PB1–PB14 14 of 14 PASS. Reported without a pass or fail: flow rate of the default combination +16.0 ± 4.2 % from the published molecular dynamics (extraction uncertainty), profile rms 32.5 %. Independent physical validation: not established.
- Retired, in the development archive: Ion transport through one nanotube pore (`lab/continuum/`), I1–I19, IB1–IB13: 32 of 32 PASS.
- Retired, in the development archive: Water flow through a nanotube membrane (`lab/continuum/water.html`), N1–N9, S1–S15, D1–D3, F1–F4, B1–B16, R1, A1–A5: 50 of 53 PASS; **F2, F3 and F4 FAIL** (comparisons with OpenFOAM), kept as failures.
<!-- END:results -->

## Known limitations

- One tube, one pressure drop, one temperature, one published simulation.
- Inputs read from figures; the unresolved items are listed in the case sheet (tube length 6.4 or 6.0 nm, slip
  velocity at D, the molecular volume in the flow definition, a second profile in Fig. 4a, the Fig. 9b point).
- Slip-length forms (source Eqs. 4, 6 and 7 as published) are not enabled; the end-loss coefficient c is assumed.
- Headless Chromium only; no Safari, Firefox, real phones or screen readers.

## Licences and attribution

Page code: MIT (Kazi Ehsanul Karim; code drafted with AI assistance and checked by the tests). The data are values read
from the figures of the cited article; the figures themselves are not reproduced.
