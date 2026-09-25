# Website integration guide

How to fold this package into the existing static GitHub Pages site. **Local assets and
relative paths only. Do not migrate the stack, do not deploy, do not change repository
visibility.** These are instructions for the site owner to apply manually.

## Navigation (unchanged preference)

`Research Projects → Research in Practice → Simulation Lab → Contact`
(these may remain sections of a single static page; the public CV stays a secondary PDF link).

## Assets to add (copy from this package)

| Destination (relative) | Source in package | Purpose |
|---|---|---|
| `assets/mlip/workflow.svg` | `website/workflow.svg` | workflow schematic (has embedded title/desc) |
| `assets/mlip/evidence_cards.json` | `website/evidence_cards.json` | data for the three cards |
| `content/mlip_project.md` | `website/MLIP_PROJECT.md` | project write-up (≈300 words) |
| `content/mlip_methods.md` | `METHODS.md` | methods detail (linked, not inlined) |
| `content/mlip_scope.md` | `MODEL_SCOPE.md` | validity envelope |
| `code/mlip_evidence/` | `mlip_evidence/` + `tests/` + `examples/` | runnable tooling (link to repo/zip) |

## Card order (Research in Practice)

1. **Reference-protocol checking** (`reference-checking`)
2. **Error-aware, per-species validation** (`error-diagnosis`)
3. **Computational decision prototype** (`computational-decisions`)

Render each card's `status` as a visible badge
(`EXECUTED_EXAMPLE` / `PROTOTYPE`). Show the `limitation` line — do not hide it.

## Provenance captions (use verbatim intent)

- Under the workflow SVG: *"Schematic of methods and status; solid = implemented,
  dashed = proposed. Not a data figure."*
- Under any synthetic plot: *"Synthetic software demonstration; not a DFT, MLIP-accuracy
  or transport result."*
- Near the tooling link: *"Analysis code drafted with AI assistance and checked against raw
  outputs; scientific decisions and validation design are the author's. See NOTICE.md."*
- Water box (Simulation Lab): the caption in `SIMULATION_LAB_HANDOFF.md`.

## Accessibility

- The SVG carries `role="img"` + `<title>`/`<desc>`; also link `workflow_alt.md` as a
  visible "text description" for screen-reader users.
- Ensure card badges have text labels, not colour alone.

## Do NOT publish

- Any campaign number (per-element RMSE, committee correlation, friction λ, coordination
  numbers, repair counts, deviations/temperatures).
- Model weights, trajectories, raw logs, the readiness plan, private review files.
- PINN code/results (excluded — source unavailable) and any private manuscript / thesis-summary content.
- Claims of MACE/NequIP/stress/polarization/GPU hands-on experience, or an "autonomous
  agent platform," or cost/time savings.

## Nature-inspired design section

Keep as a small **future-applications** note only; it is not evidence of the MLIP campaign.
