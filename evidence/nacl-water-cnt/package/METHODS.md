# METHODS

Method-level description of the workflow the tooling supports. No restricted
campaign numbers appear here; all illustrative figures are synthetic.

## 1. Reference-protocol compatibility (CP2K)

MLIP accuracy is only meaningful against a fixed DFT reference. `summarize_reference_protocol`
extracts the parameters that determine compatibility from a CP2K input: run type,
functional and dispersion, basis sets and pseudopotentials, density-grid cutoffs
(`CUTOFF`/`REL_CUTOFF`), SCF threshold/algorithm, smearing and added MOs (needed for
metallic armchair CNTs), total charge, cell, and Poisson periodicity — and whether the
stress tensor was requested. `compare_reference_protocols` flags any **material**
mismatch between the training and validation references, so a difference is classified
*before* a model error is attributed to the model.

Caveat: a two-cutoff comparison demonstrates a convergence check; it does not establish
convergence of every property. Basis, density-grid, and SCF convergence are distinct.

## 2. Data mapping and leakage

`validate_frame_mapping` verifies atom/frame correspondence between reference and
prediction. With atom IDs it restores order via the unique permutation; without IDs it
accepts only an already-identical order and **refuses to guess** an ambiguous reorder.
`detect_duplicate_frames` flags exact-duplicate geometries between two sets. Zero exact
collisions establishes only the absence of exact duplicates — not statistical
independence or the absence of near-duplicates. Held-out data should be separated by
trajectory/generation, and a holdout that informed repair or model selection is
development validation, not untouched final testing.

## 3. Per-species force metrics (explicit definitions)

Two force-RMSE definitions are reported side by side and never mixed:

- component RMSE = `sqrt( sum((Fp−Fr)**2) / (3N) )`
- vector RMSE = `sqrt( mean( sum((Fp−Fr)**2, axis=−1) ) )`

`force_metrics` also reports component MAE and vector-error median/p95/max **per
species**, with per-frame breakdowns, so a dominant species or large system cannot
conceal a weak minority channel. A species with no matched observations is reported as
**missing evidence**, never as zero error.

## 4. Uncertainty (group-aware bootstrap)

`estimate_metric_interval` resamples **independent units** — independent replicas, or
justified time blocks — with replacement (defaults: 95%, 2000 draws, seed 20260906).
Force components, atoms, adjacent frames, and committee members are **not** treated as
independent replicates. If too few independent units exist, or block metadata is
missing, it returns `CI_UNAVAILABLE` with a reason rather than fabricating an interval.
Committee spread is an acquisition signal; comparing it to reference error on matched
observations is a diagnostic, and a single correlation is not full calibration.

## 5. Dynamics gates

Short stable NVT trajectories and low NVE energy drift are **limited numerical checks**
of a deployment. They do not certify force accuracy, correct chemistry, or converged
transport. A transport coefficient (e.g. a Green–Kubo friction) is only quoted when its
correlation-integral plateau is resolved and cross-checked; otherwise no value is reported.

## 6. Decision logic (workflow-controller prototype)

`recommend_next_action` maps explicit evidence + declared thresholds to one next action
(`REVIEW_REFERENCE`, `CHECK_LABEL_MAPPING`, `REQUEST_TARGETED_LABELS`,
`REQUEST_MORE_SAMPLING`, `REVIEW_MODEL_SCOPE`, `STOP_WITHIN_TESTED_SCOPE`,
`INSUFFICIENT_EVIDENCE`). It is a transparent rule dispatcher: it emits the action,
the reasons, the missing evidence, the policy version, and input provenance. No numerical
score overrides missing physics evidence; an unsupported deployment (e.g. an external
electric field) is refused by the scope policy. It is **not** a learned or autonomous
system and launches nothing.

## Units

Force conversion is derived from NIST CODATA 2022 constants
(`HARTREE_TO_EV / BOHR_TO_ANGSTROM = 51.42206751 (eV/Å)/(Ha/Bohr)`), used as the single
declared convention throughout the tooling.
