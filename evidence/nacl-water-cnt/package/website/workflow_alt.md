# workflow.svg — text equivalent (accessibility)

A left-to-right pipeline with a feedback loop. Solid boxes are implemented; dashed
boxes are proposed (not yet done); the red box is out of MLIP scope.

**Implemented pipeline (top row):**
1. **CP2K reference** — PBE-D3(BJ) reference calculations; reference-protocol check. →
2. **Data mapping** — id-sorting and leakage/duplicate check. →
3. **DP-GEN + DeePMD** — committee training via active learning. →
4. **Per-species validation** — error-aware validation on a leak-free fresh-DFT holdout. →
5. **Uncertainty** — group-aware bootstrap confidence intervals (or "unavailable").

**Decision + deployment (second row):**
6. Uncertainty feeds a **rules-based decision controller (prototype)**, which either
   emits **LAMMPS deployment** (stability-gated, tested scope only) or routes back to the
7. **Acquisition loop** (request targeted labels / more sampling) → re-label / retrain
   at the CP2K and training stages.

**Out of MLIP scope:** one **weak ion channel** is routed to **direct DFT / classical
methods** rather than trusted from the potential.

**Proposed extensions (dashed, not yet done):**
- **Stress/virial labels + a virial loss term** → enables variable-cell deployment.
- **A learned action selector** → would replace the rules-based controller (requires
  separate benchmarking before any autonomy claim).

The diagram shows methods and their status; it contains no data values and is not a
scientific-result figure.
