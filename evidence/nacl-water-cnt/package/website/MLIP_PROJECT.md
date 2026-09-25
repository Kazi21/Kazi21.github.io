# Error-Aware MLIPs for Confined Electrolytes

**The problem.** Ions and water inside carbon nanotubes behave nothing like bulk
solution — hydration shells are stripped, and wall friction sets the ultimate limit on
transport. Ab-initio molecular dynamics is accurate enough to capture this but far too
expensive for the timescales transport needs. Machine-learned interatomic potentials
(MLIPs) can bridge that gap, but only if their errors are understood channel by channel
rather than hidden behind a single average.

**What I built.** An end-to-end, energy-and-force MLIP workflow for NaCl–water in CNTs:
CP2K reference calculations (PBE-D3(BJ), MOLOPT/GTH, with the Fermi-smearing SCF strategy
that metallic armchair tubes require), DP-GEN active learning with a model committee,
DeePMD training, and stability-gated LAMMPS deployment. The emphasis is not "it trained"
but **error-aware validation**: a leak-free, freshly-labelled holdout scored per element,
so the framework, water, and chloride channels are certified separately from a weaker
sodium channel — and the model's committee uncertainty is checked against true error
instead of being trusted blindly.

**The honest result.** When one ionic channel proved weak, I ran a single targeted
repair, saw no improvement on the untouched holdout, and **scoped that channel out** —
routing those quantities to direct DFT and classical methods — rather than averaging the
problem away. Documenting where a model *should not* be used is part of the contribution.

**Inspectable evidence.** This site ships runnable tooling (with synthetic fixtures) for
reference-protocol checking, per-species force metrics with explicit definitions,
group-aware bootstrap uncertainty that returns "unavailable" when the data can't support
a confidence interval, and a transparent rules-based decision prototype that recommends
the next computational action from stated evidence. Everything is unit-tested; the
figures are labelled synthetic; no restricted results are exposed.

**Next experiment (scoped).** Extend the reference protocol to stress labels and add a
virial term to the loss, gated behind a composition-disjoint validation set — the concrete
step toward variable-cell deployment the current energy-and-force model does not support.

*Status: methods and tooling — EXECUTED_EXAMPLE / PROTOTYPE. Ph.D. completion ~February
2027. See MODEL_SCOPE.md for the validity envelope.*
