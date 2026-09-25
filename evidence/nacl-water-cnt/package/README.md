# Error-Aware MLIPs for Confined Electrolytes — evidence tooling

Reproducible, self-contained tooling that demonstrates the **methods** behind a
machine-learned interatomic potential (MLIP) campaign for NaCl–water inside carbon
nanotubes: CP2K reference-protocol checking → error-aware per-species validation →
group-aware uncertainty → a transparent decision prototype → LAMMPS deployment scope.

**Author role.** Kazi Ehsanul Karim designed the reference protocol, the validation
and holdout strategy, the active-learning and stability gates, and every scientific
go/no-go decision, and executed the calculations on his workstation. Analysis code
was drafted with AI assistance and checked against raw outputs. See `NOTICE.md`.

## What this package is — and is not

- **Is:** runnable tooling + **synthetic** fixtures that exercise the analysis and
  decision logic, plus methods/scope documentation.
- **Is not:** it runs **no DFT**, trains/evaluates **no MLIP**, and produces **no
  physical result**. Every number it prints comes from clearly-labelled synthetic
  fixtures. Real campaign results, models, and trajectories are intentionally excluded.

## Status labels used throughout

`PUBLISHED` · `EXECUTED_EXAMPLE` · `PROTOTYPE` · `IN_DEVELOPMENT` · `PROPOSED`.
Synthetic figures are stamped *"Synthetic software demonstration; not a DFT,
MLIP-accuracy or transport result."*

## Prerequisites

- Python ≥ 3.10, NumPy, Matplotlib (report/figure regeneration).
- No DFT/MLIP engine is required to run anything here.
- Tested with: python 3.12, numpy 2.3, matplotlib 3.10.

## Runnable examples (from this `public/` directory)

```bash
# 1. focused tests (should print "13 passed, 0 failed")
python tests/test_mlip_evidence.py

# 2. full synthetic pipeline: metrics -> figures -> bootstrap CI -> decision
python -m examples.synthetic.make_fixture demo_out
#   writes demo_out/{metrics.json, interval.json, decision.json, SUMMARY.json,
#   validation_component_rmse.png, validation_vector_p95.png}

# 3. parse a CP2K input into a protocol summary (works on any CP2K .inp)
python -m mlip_evidence.cli summarize-protocol examples/synthetic/example_cp2k.inp

# 4. run the decision controller on an evidence file
python -m mlip_evidence.cli decide examples/synthetic/example_evidence.json
```

## Package layout

```
mlip_evidence/        reference_protocol, frame_mapping, metrics, uncertainty,
                      decision (workflow-controller), figures, release, cli, constants
tests/                focused tests (one per named risk)
examples/synthetic/   deterministic fixtures + end-to-end demo (SYNTHETIC ONLY)
README.md METHODS.md MODEL_SCOPE.md    docs
website/              site copy, evidence cards, workflow.svg, integration notes
PI_WALKTHROUGH.md     two-minute reviewer script
LICENSE NOTICE.md     licensing + attribution
```

## Limits (read before citing)

- Synthetic fixtures demonstrate tooling, not accuracy or transport.
- The MLIP is **energy-and-force** only; stress/virial and variable-cell are not trained.
- The model is **local** (no explicit long-range electrostatics); prohibited deployments
  are listed in `MODEL_SCOPE.md`.
- The decision component is a **rules-based prototype**, not an autonomous agent.
- See `METHODS.md` for definitions and `MODEL_SCOPE.md` for the validity envelope.
