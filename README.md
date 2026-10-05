# Kazi21.github.io

Research website of Kazi Ehsanul Karim: molecular simulation, statistical mechanics and multiscale fluid mechanics.
Live at <https://kazi21.github.io> once GitHub Pages is enabled for this repository.

## What the site contains (version 2026.1)

- Hero: who I am (Ph.D. candidate, University of Ulsan), the headline "From molecular dynamics to physics-informed models of nanoscale transport", the publication record (three first-author articles in PRE and PCCP: two published, one accepted), availability (target start early 2027; defense planned November 2026; conferral expected February 2027), a primary button to the trajectory inspector, contact, one ab initio MD snapshot and the at-a-glance panel.
- Research Projects: (1) molecular structure, boundary conditions and nanoscale transport — peer-reviewed research (two published articles and one accepted in PCCP, 2026); (2) error-aware MLIPs for CNT-confined NaCl–water — current research; (3) physics-informed structure–friction–flow closure — current research. Each card states question → contribution → available evidence → next development.
- Future vision: "Can a simulation identify what to compute next?" — a research direction, with the selection rule behind an optional disclosure.
- Research in Practice: an explanatory walkthrough of the proposed workflow (define the target → check the reference → expose model errors → choose the next calculation), with steps 2–4 linked to the methods-and-software demonstration under `evidence/nacl-water-cnt/` (complete package v0.1.1; synthetic example data; tests executed; workflow schematic; source browsable; package downloadable from `assets/downloads/`). It documents methods, not DFT/MLIP accuracy or transport results.
- Simulation Lab: stage 1 is available, a trajectory inspector at `lab/cnt/` for the four CNT ab initio seed runs ((6,6), (7,7), (9,9), (11,11); CP2K, PBE-D3(BJ), NVT 300 K): rotate, zoom, play, click an atom for its distance from the axis, orientation (H–O–H bisector) angle, hydrogen bonds or hydration count, colour water by orientation, and three guided observations (water reorienting at ions, thinner hydration shells in the narrowest tube, single file versus shells). Stage 2 (molecular interaction in one tube) and stage 3 (reference-guided learning) are planned. The main page shows a same-scale preview of the four tubes rendered by the inspector (`assets/figures/inspector-four-tubes-axial.png`). The inspector replays stored trajectories; nothing on the site runs a simulation. (`tools/water-illustration.py` generated an earlier SPC/E illustration that is no longer shown.)
- What I can contribute, current work and next outputs with explicit status, an additional (proposed) nature-inspired research direction, publications, education, toolchain and contact.
- Project 2 ab initio MD snapshots (three still images, CP2K 2026.1, PBE-D3(BJ)) under `assets/figures/`; facts and provenance kept privately by the owner.
- Public CV (PDF) under `assets/cv/`.
- Evidence pages: `evidence/nacl-water-cnt/index.html` (overview, executed outcomes, three cards, methods, scope, walkthrough, provenance) and `source.html` (verbatim source); the package files under `evidence/nacl-water-cnt/package/`; outputs of the documented example runs under `evidence/nacl-water-cnt/executed/`.

## Evidence policy

Every item carries one of: published (with DOI), accepted (DOI added only once the publisher assigns it), in progress, in development, planned, or research aim / proposed.
No unpublished numerical results, pending-manuscript conclusions, unmeasured performance numbers or referee contact details appear on the site or in the public CV. The one exception, by the owner's decision, is the atomic positions of the four short ab initio seed runs shown in the trajectory inspector (positions only, one frame every 2 fs; no energies, forces or model outputs).

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
tools/water-illustration.py  generator for the Simulation Lab illustration (not needed by visitors)
tools/build-evidence.py      builds the evidence pages from the package (needs pandoc; not needed by visitors)
tools/build-lab.py           builds lab/cnt/index.html from lab/cnt/data/manifest.json (not needed by visitors)
tools/convert-cnt-trajectories.py  converts the exported AIMD positions into lab/cnt/data/ (not needed by visitors)
lab/cnt/              trajectory inspector: index.html, inspector.js, inspector.css, data/ (manifest.json + one .bin per tube)
assets/               cv/Kazi_Ehsanul_Karim_CV.pdf, icons/ (favicon, social image)
vendor/katex/         KaTeX CSS + fonts (MIT)
vendor/fonts/         IBM Plex Sans/Mono (OFL)
tools/                template and pre-render script (not needed by visitors)
```

## Licence

Website code, including the trajectory inspector: MIT (`LICENSE`). Text, CV, scientific graphics and the trajectory data in `lab/cnt/data/`: all rights reserved (`NOTICE.md`). The `mlip_evidence` package under `evidence/nacl-water-cnt/package/` carries its own MIT licence (`LICENSE`) and NOTICE.
