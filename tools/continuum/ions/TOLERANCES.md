# Ion experiment (Continuum Lab, releases 2026.9, 2026.9.1 and 2026.10): acceptance criteria

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
| I16 | Numerical controller (added 22 Oct 2026, release 2026.10, before it was run) | Rules 1–6 of the controller section below, on the shared `lab/continuum/ions/controller.js`. (a) Default experiment ((7,7), step 6, +100 mV, 0.100 M): with the standard target the status is "tolerance reached", reported level 1, after exactly one comparison; with the fine and strict targets the statuses, levels and reported values follow rules 4–6 from the computed changes. (b) For the default experiment at all three targets, every logged current, reversal potential, node count and residual equals an independent solve at that level to relative 10⁻¹², every logged change equals the change recomputed from the logged values, and every decision equals that of an independent implementation of rules 1–6 in the test. (c) All four tubes × six steps × V ∈ {−200, 0, +100} mV at the standard target, and the four tubes × steps {1, 4, 6} at +100 mV at the fine and strict targets: every record follows rules 1–6, no record states "tolerance reached" with a last change above its target, and at V = 0 the absolute current floor is applied. (d) Queries outside the domain (V = 0.3 V, an unknown tube, c = 5000 mol m⁻³, an unknown target, an unknown closure) are refused with reason codes and without any solve. (e) The same query gives the same record twice, except for timing fields. (f) With an injected solver that fails at level 2, the status is "not converged", no result is certified and no calculation request is issued |
| I17 | Decision record, calculation request and closure contract (added 22 Oct 2026, release 2026.10, before it was run) | (a) Every record produced in I16 validates against the strict schema of `controller.js` (unknown fields rejected; refused ⇒ no levels; not converged or check failed ⇒ no certified result and no request; tolerance reached ⇒ last change within the target; budget exhausted ⇒ last level 3 and last change above the target), and a deliberately corrupted copy of each kind is rejected. (b) A calculation request is issued exactly when rule 7 says so; it names the top-ranked input of an independent recomputation of the one-at-a-time ranking, and states execution status not run, human approval required, nothing submitted, no expected variance reduction and no language model. (c) The published closure contract `lab/continuum/ions/data/closure-illustrative.json` gives every closure input with the same value as `params.js` and `data/hydration.json` (relative 10⁻¹²) and the SHA-256 of `hydration.json`; the proposed molecular-closure template `closure-molecular-template.json` is reported by the validator as blocked, with its required values null, and is never accepted as a calibrated closure |
| I18 | Controller guards against invalid diagnostics and incomplete molecular records (added 23 Oct 2026, release 2026.10.1, before it was run in this repository) | Nine deterministic probes of `controller.js` in `tools/continuum/ions/probe_controller_guards.js` (taken from the external review of 22 Oct 2026, which ran them on a copy): (a) for the default query with a solver that returns a non-finite packing fraction, a non-finite flux deviation, a non-finite current, or a non-finite packing fraction in the reversal-potential solve, the status is "check failed", no current is reported and no request is issued (four probes); (b) an almost empty record with evidence status "validated", an estimated uncertainty and a passed physical validation is not usable as a calibrated closure; (c) the default query at V = 0 still ends with "tolerance reached"; (d) the published illustrative contract is reported as illustrative and the molecular template as blocked, neither usable as calibrated (two probes); (e) a valid record whose level-1 packing fraction is replaced by null is rejected by the validator. All nine must hold. The same probes are run first on the unpatched 2026.10 controller and kept as `../results/controller.guards-2026.10-original.json` |

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
| IB11 | Controller in the page (added 22 Oct 2026, release 2026.10, before it was run) | After Start with the default settings the status chip reads "Numerical tolerance reached" and the controller panel lists levels 1 and 2 with the same currents, reversal potentials and decisions as the Node controller for the same inputs (relative 10⁻¹²); choosing the 0.1 % and the 0.02 % target reruns the experiment and the page shows the Node controller's status, levels and reported values for each; the calculation request names the same input as the Node ranking and states that it was not run and that nothing is submitted; the hydration card is labelled as recorded data, not recalculated at the selected voltage; the downloaded result contains the decision record, which validates against the schema and which `reproduce_ions.js` recomputes (numbers to relative 10⁻¹², identical decisions); the target control works by keyboard; no page errors and no external requests |
| IB12 | Failed-run display (added 23 Oct 2026, release 2026.10.1, before it was run) | After a default run, the page receives the controller's messages for a failed run through its worker message handler: the numerical record and the decision record are computed in Node with `controller.js` and a solver forced to fail gate G1 at grid level 2. The status chips read "Not converged"; the numerics message names gate G1; the current and conductance tiles are marked "not certified"; no calculation request is shown; the "Decision record (JSON)" download validates against the schema with status "not converged", no certified result and no request; no page errors |

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

## Release 2026.10: numerical controller (written 22 Oct 2026, before the controller, its page panel or its tests existed)
The controller (`lab/continuum/ions/controller.js`, shared by the page's worker, the Node tests and `reproduce_ions.js`)
is a fixed rule set: no learning, no language model, nothing submitted anywhere. It decides how much computation the
displayed result needs, runs it in the browser and records every solve and decision.

- **Observables.** The current I at the set voltage (equal reservoirs) and the reversal potential V_rev under the 10:1
  gradient, both for the selected model.
- **Accuracy targets** (chosen by the visitor; standard is the default and equals the I7 criterion). The change between
  grid levels ℓ − 1 and ℓ must satisfy |I_ℓ − I_ℓ₋₁| ≤ t |I_ℓ| and |V_rev,ℓ − V_rev,ℓ₋₁| ≤ 40 mV × t, with
  t = 5 × 10⁻³ (standard: 0.5 %, 0.2 mV), 1 × 10⁻³ (fine: 0.1 %, 0.04 mV) or 2 × 10⁻⁴ (strict: 0.02 %, 0.008 mV).
  When |I_ℓ| and |I_ℓ₋₁| are both below 1 × 10⁻¹⁶ A (equilibrium at V = 0), the current criterion is
  |I_ℓ − I_ℓ₋₁| ≤ 1 × 10⁻¹⁶ A.
- **Budget.** Grid levels 1 to 3 (level ℓ halves every cell ℓ − 1 times). Level 1 is the screening grid of every panel
  on the page. Level 4 is outside the budget: in development the default pore stopped at a scaled residual of
  2.9 × 10⁻¹¹ there, above the solver's own convergence criterion of 10⁻¹¹.
- **Gates**, for the current solve and the reversal-potential solve at every level: (G1) Newton converged by the
  solver's own criterion; (G2) each species flux equals its mean at every face to relative 10⁻⁹ (as I5), not applied to
  the current solve at V = 0 with equal reservoirs, where the net flux is zero; (G3) all concentrations positive and
  finite and the packing fraction below 1; (G4) a reversal potential is found at every level of the record, or at none.
- **Rules**, applied in this order:
  1. Domain: a query outside the supported domain is refused with reason codes and nothing is solved. Supported: the
     four tubes; steps 1–6; |V| ≤ 0.2 V; c ∈ {10, 100, 1000} mol m⁻³ with the 10:1 gradient; the three closures, three
     linings, pore permittivities {10, 20, 30, 50}, rim charges {1, 2, 3}, diffusivity ratios {0.2, 0.5, 0.8, 1} and slip
     lengths {0, 1, 10, 100} nm of the page; Δp = 0; L = 5 nm; 300 K; the three targets.
  2. Level 1 is solved. If G1 fails: stop, "not converged". If G2, G3 or G4 fails: stop, "check failed".
  3. Level ℓ + 1 is solved, with the same gates and stops as in rule 2 (at least one comparison is always made).
  4. If the changes from level ℓ to ℓ + 1 satisfy the target: stop, "tolerance reached". The reported result is level
     ℓ, certified by its change to level ℓ + 1.
  5. Otherwise, if ℓ + 1 < 3: refine (ℓ ← ℓ + 1) and return to rule 3.
  6. Otherwise: stop, "budget exhausted". The reported result is level 3 with its last change; it is not certified to
     the target.
  7. Molecular evidence, after the numerics: if the status is "tolerance reached" or "budget exhausted", the step has
     illustrative inputs (steps 2–6), and the largest factor F of the one-at-a-time sensitivity ranking satisfies
     F − 1 ≥ 10 × the last relative change of the current, the record carries one calculation request for the
     top-ranked input (its range, F and the molecular calculation that could constrain it), with execution status
     "not run", human approval required and nothing submitted. The ranking basis is one-at-a-time sensitivity, not
     expected information gain; no cost and no expected variance reduction are stated. Otherwise there is no request:
     at step 1 every input is a literature value or a setting, and failed numerics come before any molecular request.
  8. Physical validation is recorded as not run: no matched molecular transport comparison exists for this pore.
- **Display.** The status chip reads "Numerical tolerance reached", "Refinement budget exhausted", "Not converged",
  "Numerical check failed" or "Refused: outside the supported domain". The model ladder, the current–voltage curves and
  the sensitivity ranking stay at level 1 and are labelled as screening results; when the reported level is not 1, the
  current and reversal-potential tiles show the reported values and say so.

### Amendment of gates G1 and G2 (22 Oct 2026, after a development run of the controller, before any official run of I16, I17 or IB11)
The first development run of the controller stopped the default experiment at grid level 2 with "check failed" (G2).
A sweep of the four tubes × six steps × levels 1–3 (`../results/controller.gates-development-2026-10-22.json`, kept)
showed why. Neither effect concerns the accuracy of I or V_rev; both are the floating-point floor of a single solve:
- **G2 on the reversal-potential solve.** At V_rev the net salt flux (1.3 × 10⁻²² mol s⁻¹ for the default pore) is a
  small difference of large drift and diffusion terms. Its relative face-to-mean deviation rises with the cell count:
  8.6 × 10⁻¹⁰, 1.8 × 10⁻⁹ and 4.6 × 10⁻⁹ at levels 1–3 for the default pore, and up to 6.8 × 10⁻⁷ over the sweep.
  The current solves stayed at or below 6.2 × 10⁻¹¹ at every level. I5 was established on driven solutions, never at
  V_rev, so applying it to the reversal solve was a specification error.
- **G1 with the solver's internal flag.** The flag requires a scaled residual below 10⁻¹¹. It is a stopping target
  for Newton's polishing steps, not the project's acceptance level. The level-3 reversal solves stopped at
  1.15–2.10 × 10⁻¹¹ in 5 of 24 cases; all current solves stayed at or below 1.0 × 10⁻¹¹.

Amended rules (they replace G1 and G2 above; the original text stays above for the record):
- **(G1)** the scaled Newton residual is at most 10⁻¹⁰, the acceptance criterion of test I6, for the current solve
  and the reversal-potential solve. The record also keeps the solver's internal flag.
- **(G2)** each species flux equals its mean at every face to relative 10⁻⁹ (as I5), for the current solve at V ≠ 0.
  For the reversal-potential solve the deviation is recorded but not gated: there, each node's flux balance is
  already gated by G1, because the scaled residual of a species equation is the imbalance of its face fluxes divided by
  their gross Scharfetter–Gummel terms.
- **Budget.** Unchanged (levels 1–3). Its reason is restated, because the earlier reason referred to the internal
  flag: in Node on the build machine the reversal potential of the default pore takes about 3 s at level 3 and
  about 7 s at level 4.

No criterion of the tests I16, I17 or IB11 was changed.

### Browser procedure for release 2026.10 (written before the first browser run of 2026.10)
- The browser runs of 2026.10 use Chromium 131 (headless, SwiftShader WebGL) from the npm package
  `@sparticuz/chromium`, driven by Playwright 1.48.0. The earlier records used Chromium 141.
- **IB1, procedure.** In this Chromium build the page's `request` event does not report the script of a dedicated
  worker. A run of the unchanged suite on the deployed 2026.9.1 page failed IB1 for this reason alone
  (`../results/browser_ions.2026-10-22-baseline.json`, kept; IB2–IB10 passed). The procedure now also records workers
  through Playwright's `worker` event. The new file `ions/controller.js` is added to the files that must not load before
  Start and must load after it. The criterion is unchanged.

### Corrections and clarifications after an independent review (22 Oct 2026, before run 2 of I1–I17 and IB1–IB11)
No criterion, target, gate threshold or decision rule changed; the wording above is kept as written.
- **Rule 7, the reason given for step 1.** "At step 1 every input is a literature value or a setting" is wrong: the
  classical model also uses derived values (diffusivities, accessible radius, access cones), the recorded tube radius
  and the illustrative 5 nm pore length. The rule is unchanged: step 1 has no input with a stated range in the
  sensitivity ranking (the ranking covers the inputs added by steps 2–6), so no request is issued. The record's
  `molecular_evidence.inputs_status` for step 1 is now `no_ranked_inputs` (was `literature_and_settings_only`; never
  published) and the panel chip reads "No ranked inputs".
- **G3 on the reversal-potential solve.** G3 applies to both solves, as written above, but `controller.js` checked the
  packing fraction for the current solve only. It now checks both; the record's reversal entry gains `packing_max`. The
  packing fraction is below 1 by construction of `core.js`, so no decision can change.
- **Cases rule 7 left undefined, now stated (code unchanged).** The ranking counts as complete when every perturbed
  solve meets the solver's own stopping criterion (scaled residual below 10⁻¹¹); otherwise no request is issued. The
  ranking is computed at +100 mV whatever the set voltage; the last relative change is that of the current at the set
  voltage. At V = 0 the last change is judged on the absolute floor and recorded as a relative change of 0, so the
  ten-times condition holds. The perturbed solves at the ends of the stated ranges may lie outside the option domain of
  rule 1 (for example rim charges 0 or 4, slip lengths up to 1000 nm); they are screening solves and are not gated.
- **Rule 1, stated in full (code unchanged).** Queries that set inputs the page does not offer (rim width, ion size,
  grid level, unknown keys) are refused as well.
- **Amendment of G1 and G2, measurement restated.** "Rises with the cell count" holds for the default pore. Over the
  development sweep the reversal-solve deviation exceeded 10⁻⁹ in 13 of 72 cases: from level 1 in the (6,6) tube
  (steps 4–6, up to 6.8 × 10⁻⁷) and from level 2 in the (7,7) tube (steps 4 and 6). The page states it this way.
- **Display.** A failed gate is reported as "gate Gn failed (…)" rather than by the gate's description, and the tiles
  then mark the screening values as not certified. The ranking card states that it is a screening result (level 1), as
  the display rule above requires. The visitor's control is labelled "Grid-convergence target".
- **Test and reproduction code.** The independent rules of I16 now apply G3's packing condition to the reversal solve
  too, as written above. `reproduce_ions.js` now also compares gate verdicts, relative changes, the outcome message, the
  top-ranked input and the request's sensitivity factor.

## Release 2026.10.1 (23 Oct 2026; written before the controller change and before any run of I18 or IB12)
An external review of the 2026.10 package (22 Oct 2026) injected faults into the controller and found two gaps; the
normal calculations were not affected (I16 and IB11 passed):
- `num()` turns a non-finite number into null, and JavaScript evaluates `null < 1` as true, so a non-finite packing
  fraction passed G3; a null flux deviation skipped G2; a non-finite current was not checked at all. Each of these
  injected cases ended with "tolerance reached".
- `checkClosure()` accepted an almost empty record carrying the labels "validated", an estimated uncertainty and a
  passed physical validation as a calibrated closure, because its null check walks only the fields that exist.

**Amendment of gates G2 and G3 (finite values; no threshold changes).** They replace G2 and G3 as amended above; the
earlier wording stays for the record:
- **(G2)** at V ≠ 0 the current solve's face-to-mean flux deviation must be finite, non-negative and at most 10⁻⁹; a
  missing or non-finite value fails G2. At V = 0 and in the reversal-potential solve the deviation is recorded, not gated,
  as before.
- **(G3)** the current I, and V_rev where a reversal potential is found, must be finite; all concentrations positive and
  finite; the packing fraction finite and in [0, 1), for both solves.
- **Record check.** The validator also rejects a level that claims passed gates while its recorded diagnostics fail them.

**Closure contracts, structural minimum.** A record with evidence status `molecular_estimated` or `validated` can be
usable as calibrated only if it also carries: a strictly increasing axial coordinate (m) with at least two points, a
positive accessible-area profile (m²) of the same length and an area convention; the conditions temperature (K, > 0),
reservoir concentration (mol m⁻³, > 0), reference voltage (V) and pressure difference (Pa), the four identifiers
(geometry, chemistry, molecular ensemble, molecular boundary conditions) and a continuum boundary-condition type; and
exactly one Na⁺ (valence +1) and one Cl⁻ (valence −1) entry with an excess free-energy profile (J mol⁻¹) and a positive
axial-diffusivity profile (m² s⁻¹) on that coordinate. This is a structural minimum, not evidence of calibration.

**Display (no criterion).** The panel's lead becomes one sentence; the statements on learning, language models and
submission and the detailed thresholds move into one disclosure under the panel; the status chips, the "Rule-based"
badge and every "not run" label stay visible.

### Record of runs, release 2026.10
- **Solver and controller run 1 (22 Oct 2026): 17 PASS** (`../results/t_ions.2026.10-run1.json`, I1–I17). Highlights: I16(a) standard target tolerance reached at level 1 after one comparison (0.134 % in the
  current, 0.00132 mV in V_rev); fine target refined to level 3 and reported level 2 (0.0336 %); strict target budget
  exhausted at level 3. I16(c) sweep: 72 of 72 standard-target records reached the target; fine 12 of 12; strict 8
  reached and 4 budget exhausted. I17: 106 records valid, 27 of 27 corrupted copies rejected, requests issued in 79
  records as rule 7 says, 126 contract values equal to `params.js` and `hydration.json`.
  The 2026.9.1 records are kept as `../results/t_ions.2026.9.1-run2.json` and `../results/browser_ions.2026.9.1-run1.json`.
- **Browser run 1 of 2026.10 (22 Oct 2026): 11 PASS** (`../results/browser_ions.2026.10-run1.json`, IB1–IB11, IB1 with
  the amended procedure above). After run 1 the panel's position on the page (CSS order), the controller's wording on
  the page and the run-time sentence changed, and after the review above `controller.js`, `app.js` and the page text
  changed, so both suites are run again.
- **Solver and controller run 2 (22 Oct 2026): 17 PASS** (`../results/t_ions.json`, I1–I17, 76.6 s), after the
  corrections above; the record for the released files. I17(c) now counts 13 required values null in the template (the
  conditions section is checked as well) and finds the contract values within 4.8 × 10⁻¹⁵ of the solver's (the files
  are written with 15 significant digits).
- **Browser run 2 of 2026.10 (22 Oct 2026): 11 PASS** (`../results/browser_ions.json`, IB1–IB11), on the released page;
  `reproduce_ions.js` reported 0 failed checks on the downloaded result (82 checks in IB9, 81 in IB11).

### Record of runs, release 2026.10.1
- **Guard probes on the unpatched 2026.10 controller (23 Oct 2026): 3 of 9 hold** (`../results/controller.guards-2026.10-original.json`):
  the four non-finite injections ended with "tolerance reached", the almost empty "validated" record was reported as
  calibrated, and the tampered record was accepted; equilibrium and the two published contracts behaved as required.
  The 2026.10 records are kept as `../results/t_ions.2026.10-run2.json` and `../results/browser_ions.2026.10-run2.json`.
- **Solver and controller run 1 of 2026.10.1 (23 Oct 2026): 18 PASS** (`../results/t_ions.json`, I1–I18, 140.3 s on a
  slower build machine than the 2026.10 runs). I18: 9 of 9 probes hold (`../results/controller.guards.json`); I16 and
  I17 unchanged in outcome.
- **Browser run 1 of 2026.10.1 (23 Oct 2026): 12 PASS** (`../results/browser_ions.json`, IB1–IB12), on the released page;
  `reproduce_ions.js` reported 0 failed checks (82 in IB9, 81 in IB11); IB12 showed "Not converged", gate G1 named,
  both tiles marked not certified, no request, and a valid not-converged decision record.

