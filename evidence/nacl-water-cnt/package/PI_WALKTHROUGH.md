# Two-minute PI walkthrough

A reviewer-facing script showing one shareable input, a raw output/fixture, regenerated
analysis, a personal decision, a limitation, and the next check. Everything shown is
either a methods artifact or a labelled synthetic fixture — no restricted results.

## 0:00 — Framing (15 s)
"I build energy-and-force MLIPs for ions and water confined in carbon nanotubes. What I
want to show isn't that a model trained — it's how I make its errors *legible* and let
that drive the next computational action."

## 0:15 — One shareable input (20 s)
Open `examples/synthetic/example_cp2k.inp` and run:
```bash
python -m mlip_evidence.cli summarize-protocol examples/synthetic/example_cp2k.inp
```
"This parses a CP2K reference input into a protocol summary — functional, dispersion,
grid cutoffs, the Fermi-smearing SCF strategy metallic armchair tubes need, periodicity,
and whether stress was even requested. I compare training vs validation protocols so a
reference mismatch is caught *before* I blame the model."

## 0:35 — Raw fixture → regenerated analysis (35 s)
```bash
python -m examples.synthetic.make_fixture demo_out
```
"On a synthetic multi-species set with one deliberately weak channel, the aggregate force
RMSE looks fine — but the per-species table and figure expose the weak channel anyway. A
species with no data is reported as *missing*, not zero. Uncertainty uses a group-aware
bootstrap over independent replicas and returns 'unavailable' when the data can't support
a confidence interval, instead of inventing one."

## 1:10 — A personal decision (30 s)
```bash
python -m mlip_evidence.cli decide examples/synthetic/example_evidence.json
```
"The controller reads the evidence and recommends the next action. Here it returns
`REVIEW_MODEL_SCOPE`: the weak channel's committee uncertainty was blind to it, and a
targeted repair had already failed — so the honest move is to scope that channel out and
route it to direct DFT, not to keep grinding. In the real campaign that is exactly the
decision I made."

## 1:40 — Limitation + next check (20 s)
"Limitations I state up front: this potential is local — no explicit long-range
electrostatics — and it's energy-and-force only, so no stress or variable-cell. The next
concrete step is stress labels plus a virial loss term, gated behind a composition-disjoint
validation set. That's the smallest experiment that would extend the validated scope."

*Note: this walkthrough is the public artifact. The private readiness plan is not shown to
reviewers and is not part of this package.*
