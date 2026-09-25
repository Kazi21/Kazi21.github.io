# MODEL SCOPE (public)

Validity envelope of the confined-electrolyte MLIP, at the level of *what it is for*
and *what it must not be used for*. This is a scope statement, not a results sheet —
no restricted campaign numbers appear here.

## What the model is

- **Architecture:** standard **local** DeePMD potential (`se_e2_a` descriptor). Coulomb
  interactions are represented only implicitly, within the descriptor cutoff. It is **not**
  a long-range / charge-aware model (not DPLR), and it is **not** an equivariant model
  (not MACE/NequIP).
- **Training labels:** **energy and force only.** Stress/virial is **not** in the training
  objective, so variable-cell/NPT behaviour is untrained.
- **Committee:** a small multi-model committee (shared warm-start lineage) used for an
  active-learning acquisition signal; committee spread is not a calibrated error on its own.

## Tested / supported use (EXECUTED_EXAMPLE)

- Equilibrium molecular dynamics of the **same periodic CNT + water + dilute-NaCl cells**
  it was trained on, at temperatures inside the trained range (~300–350 K), for:
  confined-water structure, ion hydration/coordination of the well-represented channels,
  and wall-friction analysis.
- Deployment uses a **rigid-wall** convention and passes short-timescale stability gates;
  one narrow chirality is metastable with flexible walls and is run rigid.

## Known weakness (carried into every claim)

- One ionic channel is **not accurately represented** by this local model and its
  quantities are taken from **direct DFT/AIMD** (and its transport from classical methods),
  never from the MLIP. This is stated wherever those quantities appear.

## PROHIBITED without new validation (PROPOSED extensions only)

- External **electric fields** or thermal gradients (no field response in an energy/force PES).
- **Open-reservoir / membrane / CNT-mouth** geometries (only periodic tube cells are tested).
- **Concentrations or tube lengths** materially outside the trained cells (no universal
  transferability claim).
- **Stress / NPT / variable-cell** simulation (virial untrained).
- Any reliance on **explicit long-range electrostatics** (the model has none).

The `mlip_evidence` decision policy encodes this envelope: a request outside the tested
deployment set returns `REVIEW_MODEL_SCOPE` (refused) rather than a green light.
