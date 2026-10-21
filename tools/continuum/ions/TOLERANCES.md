# Ion experiment (Continuum Lab, releases 2026.9 and 2026.9.1): acceptance criteria

Written on 21 Oct 2026 before the solver, the page or any test existed. The water-flow experiment keeps its own
criteria (`../TOLERANCES.md`); none of its tests validates this electrolyte solver.

Model under test (`lab/continuum/ions/core.js`): steady one-dimensional, area-averaged Poisson–Nernst–Planck
equations for Na⁺ and Cl⁻ along the axis of a cylindrical pore of radius a and length L between two reservoirs, with
access regions whose cross-section grows as a cone of slope 4/π (which reproduces Hall's access resistance in the
Ohmic limit), optional fixed charge at the pore rims, an excess chemical potential μ_ex,i(x) that contains no
mean-field electrostatic term (finite ion size, solvation), position-dependent diffusivities, and an optional
electro-osmotic flow Q obtained from the area-averaged Stokes equation with wall slip and the thermodynamically
consistent body force −Σ c_i dμ̃_i^ext/dx (electric and excess forces on the ions). Scharfetter–Gummel fluxes,
Newton's method, Float64.

## Solver (Node; `tools/continuum/ions/t_ions.js`)

| # | Test | Criterion |
|---|---|---|
| I1 | Equilibrium | For every model step (1–6) and every geometry preset at V = 0, Δp = 0 and equal reservoirs (0.100 M): each species flux and the flow Q are zero to 10⁻¹² of their values at V = 100 mV, and every node satisfies the Boltzmann relation c_i e^{ψ_i} = constant (ψ_i = z_iFφ/RT + μ_ex,i/RT, finite-size and solvation terms included) to relative 10⁻¹⁰, also where the fixed charge and the excess energy make the profiles strongly non-uniform |
| I2 | Homogeneous Ohmic limit | Neutral uniform pore without access regions, classical model, 0.100 M, V = 1 mV: conductance within relative 10⁻⁴ of (F²/RT)(D_Na + D_Cl) c πa²/L |
| I3 | Hall access resistance | Neutral pore with access regions, classical model, 0.100 M, V = 1 mV: resistance within 0.5 % of (1/κ)[L/(πa²) + 1/(2a)], κ = (F²/RT)(D_Na + D_Cl)c (Hall 1975), for all four presets |
| I4 | Voltage reversal | Symmetric device (equal rims, symmetric excess energy), equal reservoirs, every step: I(−V) = −I(V) and Q(−V) = −Q(V) to relative 10⁻⁹ at 50, 100 and 200 mV |
| I5 | Flux conservation | In every converged solution, each species flux evaluated independently at every cell face equals its mean to relative 10⁻⁹, and the reported current equals F Σ z_i J_i |
| I6 | Positivity and convergence | All concentrations positive and finite and the packing fraction below 1 for every step × preset × V ∈ {−200, −100, 0, 100, 200} mV × {equal reservoirs, 10:1 gradient}; Newton residual ≤ 10⁻¹⁰ (scaled) in every case |
| I7 | Mesh convergence | Halving every cell (grid level 1 → 2) changes the current at 100 mV by at most 0.5 % and the reversal potential under the 10:1 gradient by at most 0.2 mV, for every step with the (7,7) preset |
| I8 | Independent reference | A separate Python program (SciPy `solve_bvp`, collocation; no code shared) solving the same equations without electro-osmosis and finite size reproduces the current and its Na⁺/Cl⁻ split at ±100 mV within 1 % for (a) the classical (7,7) pore and (b) the (9,9) pore with charged rims, molecular solvation and confined mobility |
| I9 | Goldman (GHK) limit | Dilute reservoirs (1.00 × 10⁻⁴ M left, 1.00 × 10⁻⁵ M right; Debye length ≫ L), uniform neutral pore without access regions, sharp excess-energy steps of 1 RT (Na⁺) and 2 RT (Cl⁻): reversal potential within 0.5 mV, and current at +50 mV within 1 %, of the GHK equations with P_i = D_i e^{−ΔG_i/RT}/L |
| I10 | Donnan limit | Uniform pore 100 nm long (a = 0.581 nm), uniform fixed charge −0.500 M, reservoirs 0.0100 M, V = 0: at the pore centre c₊c₋ = c_b² and c₊ − c₋ = 0.500 M within 1 % |
| I11 | Electro-osmosis | (a) Q = 0 at equilibrium for every step (part of I1); (b) Onsager reciprocity: charged (9,9) pore with slip b = 10 nm, equal reservoirs 0.100 M: (I/Δp) at V = 0 equals (Q/V) at Δp = 0 within 1 % (Δp = 1 kPa, V = 0.1 mV); (c) van 't Hoff osmosis: neutral pore excluding both ions by 15 RT, reservoirs 0.100 / 0.0100 M, V = 0, Δp = 0: Q equals 2RT(c_L − c_R)/R_h within 2 %, directed towards the concentrated side; (d) hydraulics: with ions absent from the force balance (ΔG = 0, no charge), Q/Δp equals 1/R_h with R_h = 8µL/[πa⁴(1 + 4b/a)] + 2 × 3µ/(2a³) within 10⁻⁶ |
| I12 | Conventions and parameters | Born radii reproduce the hydration free energies they are derived from (Marcus 1991) to relative 10⁻¹²; the dielectric-exclusion and dehydration energies equal their closed forms to 10⁻¹²; with fixed charge on and solvation off the excess energy is identically zero (no mean-field electrostatics in μ_ex); the two solvation closures are never active together |
| I13 | Model-domain flags | The (6,6) preset is flagged single-file; solutions with fewer than one ion in the pore on average, a packing fraction above 0.5, or a Debye length above the pore radius carry the corresponding flag |
| I14 | Reported selectivity | The reported P_Na/P_Cl equals the GHK inversion of the computed reversal potential, and |I(V_rev)| ≤ 10⁻⁶ |I(±50 mV)| |
| I15 | Selectivity classification (added 21 Oct 2026, release 2026.9.1, before it was run) | For the default settings at step 6 (finite size on) and step 2 (finite size off): reversal potentials 10 µV inside, exactly at, 0.5 nV beyond and 10 µV beyond the Na⁺ and the Cl⁻ Nernst potential of the reservoir activities, the probes −70 mV and +70 mV, a missing reversal potential, and the computed V_rev of the classical (7,7) pore. Inside a limit the status is the positive beyond-range class (> 10⁴ or < 10⁻⁴) with a positive ratio; at a limit and within 1 nV of it, the Nernst class of that ion; 10 µV beyond and at ±70 mV, invalid, shown as "outside GHK range" with the raw (negative) ratio kept; no reversal potential, not_found; the classical case finite, with the displayed ratio equal to an independent inversion to 10⁻¹². No invalid inversion is displayed as "> 10⁴" or "< 10⁻⁴" |

## Browser (`tools/continuum/ions/browser_ions.js`; Chromium headless, software WebGL)

| # | Test | Criterion |
|---|---|---|
| IB1 | Lazy start | No solver, worker or 3D library is requested before the visitor starts; after Start they are |
| IB2 | Run | The default experiment converges in the page; its current at the displayed voltage equals the Node solver's for the same inputs to relative 10⁻¹² |
| IB3 | Model ladder | Each of the six steps changes the current model, the reference stays the classical model on the same axes, and the one-sentence explanation quotes the computed currents of both |
| IB4 | Geometry presets | The four CP2K tube presets give four different results; the recorded-hydration chart highlights the selected tube |
| IB5 | Evidence | The evidence drawer lists every model input with value, units, source, conditions and status; no input is labelled MD-informed |
| IB6 | What to compute next | The panel ranks the illustrative inputs by computed sensitivity and states that the recommendation is rule-based |
| IB7 | 3D view | three.js is requested only when the view is shown; the frame is non-blank; one overlay at a time with a legend; at positive voltage the drawn Na⁺ markers drift towards the permeate and Cl⁻ towards the feed; under reduced motion nothing moves until Play; without WebGL a text fallback appears and the experiment still works |
| IB8 | Keyboard, touch, layout | All controls work by keyboard and touch; no horizontal page overflow at 360, 390, 768 and 1440 px; no page errors |
| IB9 | Export | The downloaded result (JSON and CSV) reproduces with the Node solver to relative 10⁻¹² |
| IB10 | Water experiment | The water-flow experiment runs at its new address, both experiment switches link correctly, and no page makes an external request |

## How the criteria are applied (written before the first test run, 21 Oct 2026)
Development runs of the solver preceded these notes; no criterion value was changed.
- **I4** is evaluated for all four geometry presets, not only one.
- **I5** is evaluated on every driven solution of the I6 sweep. At equilibrium (V = 0, equal reservoirs) the net flux is
  zero, so a deviation relative to it is undefined; those cases are covered by I1.
- **I11(b)** "charged (9,9) pore with slip b = 10 nm" is run twice and both must pass: the full model (step 6) and the
  charged rims with flow only. **I11(c)** uses the (7,7) radius, L = 5 nm and slip 10 nm. **I11(d)** "ions absent from
  the force balance" means a uniform, uncharged electrolyte with no excess energy, for which the force on the ions
  vanishes identically.
- **I12** also checks that the tube presets carry exactly the counts in `lab/continuum/ions/data/hydration.json`.
- **I13** is checked on every solution of the I6 sweep.

## Record of runs
- **Run 1 (21 Oct 2026): 13 PASS, 1 FAIL** (`../results/t_ions.run1.json`). I5 failed: with electro-osmosis the
  net flux of the excluded Cl⁻ (about 10⁻⁹ of the Na⁺ flux) was computed at faces far from the pore as a small
  difference between advection and back-diffusion, and its face-to-mean deviation reached 1.4 × 10⁻⁷. The solver
  was changed, not the criterion: the Slotboom variable now includes the Péclet term (u = c e^{ψ − χ},
  χ = Q∫dx/(D A)), so a species without net flux has a constant variable also under flow. The run also showed that
  the reported P_Na/P_Cl was negative where the reversal potential lay at the Nernst limit of the reservoir
  activities (finite-size term on); the GHK inversion now uses reservoir activities, as stated in the page.
- **Run 2 (21 Oct 2026): 13 PASS, 1 FAIL** (`../results/t_ions.run2.json`). I5 passed (4.05 × 10⁻¹¹). I14 failed:
  for (7,7) with confined mobility the reversal potential lies 0.4 µV from the Nernst limit and the GHK ratio
  (5.4 × 10⁵) is ill-conditioned, so two evaluations of the same formula differed by 1.86 × 10⁻¹¹. The page does not
  show that number: it shows "> 10⁴" for any ratio above 10⁴ or at the Nernst limit. **Clarification after run 2:** I14
  compares what the page displays — numbers at 10⁻¹², and for "> 10⁴" that the independent inversion also exceeds
  10⁴. All displayed numbers agreed to 1.3 × 10⁻¹⁴ in run 2.
- **Run 3 (21 Oct 2026): 14 PASS** (`../results/t_ions.run3.json`). After run 3 the solver files changed before
  release: the reversal-potential search in `core.js` was tightened (Brent tolerances from 10⁻⁹ to 10⁻¹³ relative in
  the current and from 10⁻¹⁰ V to 4 × 10⁻¹⁴ V), so that the page and Node reach the same root from different starting
  states, and `params.js` and `worker.js` were edited for the page. No criterion changed. Run 4 is therefore the
  record for the released files.
- **Run 4 (21 Oct 2026): 14 PASS** (`../results/t_ions.run4.json`). With the tighter search, |I(V_rev)| fell from
  2.66 × 10⁻⁸ to 1.04 × 10⁻¹² of the smaller current at ±50 mV (I14). After run 4 one sentence in `params.js`
  changed (the note of the bare-carbon lining shown in the evidence table; no number changed), so the suite was run
  again.
- **Run 5 (21 Oct 2026): 14 PASS** (`../results/t_ions.json`), the record for the released files.
- **Browser checks IB1–IB10:** development runs preceded the recorded runs; no criterion changed.
- **Browser run 1 (21 Oct 2026): 10 PASS** (`../results/browser_ions.run1.json`). After run 1 the page changed, not
  the solver: the charts are drawn at the width of their card, so axis text keeps its size on a phone; on a phone the
  ranking and the evidence list appear as cards instead of wide tables; the guided experiment is one compact row
  until it is started; the opening text is shorter, so the controls start higher on the first screen; and the list of
  model-domain checks is labelled by a visually hidden paragraph instead of an `aria-label` (HTML validity). Run 2 is
  the record for the released page.
- **Browser run 2 (21 Oct 2026): 10 PASS** (`../results/browser_ions.run2.json`). After run 2 only text changed: the
  limitations and the sixth guided step count the first-shell radii among the recorded inputs, the run-cost sentence in
  the numerics section states measured times, and the bare-carbon note in `params.js` was reworded.
- **Browser run 3 (21 Oct 2026): 10 PASS** (`../results/browser_ions.run3.json`). After run 3 one sentence under the
  hydration chart was corrected: "two to three times more water" was wrong for Cl⁻ in (7,7) and for (6,6); the
  sentence now gives the ratios, computed at build time from the same data (2.82 and 4.72 in (7,7), 8.08 and 9.24 in
  (6,6)).
- **Browser run 4 (21 Oct 2026): 10 PASS** (`../results/browser_ions.json`), on the released page.

## Release 2026.9.1 (21 Oct 2026; written before the runs of this release)
- A review found that the selectivity helper displayed negative (invalid) GHK inversions as "> 10⁴". `params.js` now
  classifies the inversion (finite, beyond the display range, within 1 nV of a Nernst potential, invalid, not found)
  and keeps the raw ratio and the status in the export. Criterion I15 was added for this, before it was run. None of
  the 24 reported cases of I14 was affected: every computed reversal potential lies inside both Nernst potentials.
- I14's test code now classifies its independent inversion with the corrected rule instead of treating every
  non-positive ratio as "> 10⁴". The criterion is unchanged.
- The page labels the ratio "GHK-equivalent Na⁺/Cl⁻ selectivity" and shows the reversal potential first; the lining
  labels in `params.js` now read as illustrative motifs. No number of the solver changed.
- Solver run 1 of 2026.9.1 (21 Oct 2026): 15 PASS (`../results/t_ions.2026.9.1-run1.json`). After it the I15 probe
  labels in the test output were corrected, the lining labels in `params.js` and the occupancy flag text in `core.js`
  were reworded (no number changed), so the suite was run again: run 2, 15 PASS (`../results/t_ions.json`), the record
  for the released files.
- Browser checks of 2026.9.1: the 2026.9 record is kept as `../results/browser_ions.run4.json`; the page now opens on a
  labelled preview image, shows the reversal potential first and orders the controls differently on a phone. No
  criterion changed; run 1 of 2026.9.1: 10 PASS (`../results/browser_ions.json`), on the released page.
