# Kazi21.github.io

Research website of Kazi Ehsanul Karim: molecular simulation, statistical mechanics and multiscale fluid mechanics.
Live at <https://kazi21.github.io> once GitHub Pages is enabled for this repository.

## What the site contains (version 2026.5.1)

- Release 2026.5.1 (refinement of 2026.5): shorter hero ("Molecular physics for nanoscale transport", publication record, Explore research and Try Live Water Lab, CV · Contact links) with a compact menu on phones; the Live Water Lab shows the essential controls beside the viewer (Try a gentle pull, stiffness, release, time, temperature, selected molecule, applied force) and keeps conditions, work and energy accounting, display options, the full measurement table, the remaining plots and the event history in labelled expandable panels; live means are descriptive (no live intervals); tether-limit, replay-package (RIGID) and validation wording corrected; supplementary allowed-range check S1 added; every check script exits with a failure status when its check fails.

- Design (release 2026.5): a light reading theme (page #F8FAFC, cards #FFFFFF, headings #16324F, body text #243447, links and primary buttons #006B62) with the dark navy (#0D1B2A) kept only for molecular viewers; IBM Plex Sans, monospace only for numbers and code; underlined links; visible two-colour focus rings. Colours are defined once in `styles/tokens.css`; data colours (Okabe-Ito series with distinct line styles; ColorBrewer BrBG for the signed orientation map) are kept separate from interface colours.
- Page order, arranged for a short PI visit: hero (research headline, publication record, a CNT trajectory still; "Explore research" and "Try Live Water Lab" actions, CV and Contact as text links) → compact research map (reference physics → interactions → molecular transport → closure or pore response → continuum prediction, each with its status and project) → three research projects (established transport research; error-aware MLIPs for CNT-confined NaCl–water; PINN closure for wall friction and flow, with adaptive MD–CFD (OpenFOAM) as a planned direction) → Simulation Lab → Methods and code → what I can contribute → research outlook (optional panels: the adaptive-simulation direction, "Why I think across scales" and the nature-inspired map) → publications (with the seven-study thesis overview) and contact. Details sit in expandable panels.
- Simulation Lab:
  - `lab/cnt/` — trajectory inspector for the four CNT ab initio seed runs ((6,6), (7,7), (9,9), (11,11); CP2K, PBE-D3(BJ), NVT 300 K). Nothing is downloaded or drawn until the visitor opens the viewer; then rotate, zoom, play, inspect atoms, colour water by orientation, and follow three guided observations. It replays stored trajectories.
  - `lab/water/` — Live Water Lab: rigid SPC/E water simulated live in the visitor's browser by LAMMPS (22 Jul 2025, update 4) compiled to WebAssembly and run in a Web Worker. Two experiments: change the conditions (molecule number, temperature, pressure, O–O Lennard-Jones strength) and pull and release (a centre-of-mass harmonic tether at fixed volume, with forces, work, energy and drift shown). Measurements, plots, event history and a reproducible export (LAMMPS input that replays every command, configurations, measurements, events, model and units, analysis script). Engine and presets load only after Start. Validation checks 1–10, the allowed-range check S1 and throughput are reported on the page ("Model and validation") and produced by `tools/water-lab/` (`tests/run_all.sh` exits with a failure status if a required check fails).
- Research projects, contribution, current work and next outputs, publications, education, toolchain and contact, each with explicit status.
- Doctoral thesis overview (top of Publications, `#thesis`): seven studies in three parts, each with its system and status.
- Project 2 ab initio MD snapshots under `assets/figures/`; public CV (PDF) under `assets/cv/`.
- Evidence pages: `evidence/nacl-water-cnt/index.html` and `source.html` (methods-and-software package v0.1.1, synthetic example data, executed outputs).

## Evidence policy

Every item carries one of: published (with DOI), accepted (DOI added only once the publisher assigns it), in submission, in preparation, in progress, in development, planned, or research aim / proposed.
No unpublished numerical results, pending-manuscript conclusions, unmeasured performance numbers or referee contact details appear on the site or in the public CV. The one exception, by the owner's decision, is the atomic positions of the four short ab initio seed runs shown in the trajectory inspector (positions only, one frame every 2 fs; no energies, forces or model outputs).
The Live Water Lab computes its results live from the public SPC/E model; the validation checks and throughput it reports were measured with the scripts in `tools/water-lab/` and concern the engine and the model, not thesis results.

## Deployment (no build step)

GitHub Pages serves the repository root of branch `main`. Upload the files and the site is live; nothing needs to be built.
Equations are pre-rendered (HTML + MathML). To change one, edit `tools/index.template.html` and `tools/prerender-math.js`, then run
`npm install katex@0.16.11 && node tools/prerender-math.js`, which rewrites `index.html`. Visitors never load KaTeX JavaScript.

## Layout

```
index.html            rendered page (generated from tools/index.template.html)
.nojekyll             disables Jekyll processing on GitHub Pages
health.json           version and status probe
styles/               tokens.css, layout.css, components.css
js/app.js             presentation only: nav state, reduced motion, copy email, mechanism-map and workflow-step helpers, self-check
evidence/             nacl-water-cnt/: index.html, source.html, package/ (verbatim package files), executed/ (example-run outputs)
assets/downloads/     NaCl_Water_CNT_Website_Evidence_v0.1.1.zip (built with the package's own release builder; the older file name serves the same zip)
tools/water-illustration.py  generator for the earlier Simulation Lab illustration (not needed by visitors)
tools/scales-figures.py      writes the SVG sources of the research-question figures; the PNGs were rendered from them with the site font (not needed by visitors)
tools/build-evidence.py      builds the evidence pages from the package (needs pandoc; not needed by visitors)
tools/build-lab.py           builds lab/cnt/index.html from lab/cnt/data/manifest.json (not needed by visitors)
tools/convert-cnt-trajectories.py  converts the exported AIMD positions into lab/cnt/data/ (not needed by visitors)
lab/cnt/              trajectory inspector: index.html, inspector.js, inspector.css, data/ (manifest.json + one .bin per tube)
lab/water/            Live Water Lab: index.html, water.js, water.css, worker.js, zip.js, data/ (four equilibrated presets),
                      engine/ (lammps-water.js/.wasm = LAMMPS, GPL-2.0; lammps-core.js, water-model.js, water-adapter.js, water-export.js)
tools/water-lab/      engine build (engine/), native reference inputs (reference/), checks 1-10 (tests/, TOLERANCES.md), results/,
                      build_validation.py (fills the page's validation table), make_preview.js (main-page preview image)
tools/analyze_water.py  block-averaging analysis of an exported Live Water Lab experiment (NumPy only)
assets/               cv/Kazi_Ehsanul_Karim_CV.pdf, icons/ (favicon, social image)
vendor/katex/         KaTeX CSS + fonts (MIT)
vendor/fonts/         IBM Plex Sans/Mono (OFL)
tools/                template and pre-render script (not needed by visitors)
```

## Licence

Website code, including the trajectory inspector and the Live Water Lab page code: MIT (`LICENSE`). The Live Water Lab engine files `lab/water/engine/lammps-water.js` and `.wasm` are LAMMPS compiled to WebAssembly and are distributed under GPL-2.0 (`lab/water/engine/LICENSE-LAMMPS-GPL-2.0.txt`; corresponding source: LAMMPS stable_22Jul2025_update4 plus `tools/water-lab/engine/`). Text, CV, scientific graphics and the trajectory data in `lab/cnt/data/`: all rights reserved (`NOTICE.md`). The `mlip_evidence` package under `evidence/nacl-water-cnt/package/` carries its own MIT licence (`LICENSE`) and NOTICE.
