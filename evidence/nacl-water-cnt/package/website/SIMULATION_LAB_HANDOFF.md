# Simulation Lab — handoff (third website section)

The **Simulation Lab** is the site's third navigation section
(Research Projects → Research in Practice → **Simulation Lab** → Contact). Keep the
existing **water-box** demo here as the intuitive, secondary demonstration.

## What the water box is — and is not

- **Mode: browser demonstration of classical MD intuition** (live/interactive if the
  existing kernel is wired, otherwise a recorded/looped clip — label whichever is true).
- It illustrates **classical molecular dynamics** of a simple water model (e.g. SPC/E).
- It is **NOT** evidence that a quantum (DFT) calculation, MLIP training, or MLIP
  inference ran in the browser, and it is **not** connected to the CNT MLIP campaign.

Display caption (verbatim suggestion):

> *Interactive classical water-box (SPC/E) — an intuition demo of molecular dynamics.
> Not a quantum calculation, not an MLIP, not a transport result.*

## Placement relative to the MLIP evidence

- The **MLIP evidence** (project page, three evidence cards, workflow diagram, runnable
  tooling) is the primary technical content and lives in Research Projects / Research in
  Practice.
- The water box stays in Simulation Lab as a friendly on-ramp. Make the distinction
  explicit so a reviewer never conflates the browser demo with the DFT/MLIP work.

## What to show for the observable

- State the **actual water model and the observable** the box displays (e.g. instantaneous
  configuration / a simple radial distribution), not a derived transport coefficient.
- Do not present any campaign number (friction, coordination, RMSE) in this section.

## Kept separate (do not bundle here)

- Any browser-kernel / WASM development for the demo is a separate track from this evidence
  package; this handoff only specifies how to *label and place* the existing demo.
