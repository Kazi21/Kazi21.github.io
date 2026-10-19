# Continuum Lab — audit before implementation (M0)

Written 18 October 2026, before any Continuum Lab code was written. It records what the site and this
workspace actually contain, which scientific data exist and how each may be used, and what is missing.

## 1. Baseline

| Item | Value |
|---|---|
| Live repository | github.com/Kazi21/Kazi21.github.io, commit `f16121b` (2026-10-18 17:19 +0900, "Website 2026.5.1 part 2") |
| Release | 2026.5.1 (`health.json` version "2026.5.1"); the working copy matches the live repository file for file (188 of 188 SHA-256 identical, no extra files) |
| `index.html` | sha256 `aa5f0406…2198fe8` |
| `tools/index.template.html` | sha256 `f3bc5b47…f1c45` |
| `lab/water/engine/lammps-water.wasm` | sha256 `68359cf0…389f86` (6 393 155 B), LAMMPS `stable_22Jul2025_update4`, commit 611ca3b7f8525ba802373b04f9e3d632d515f7e3, MOLECULE + KSPACE + RIGID, Emscripten 3.1.6 |
| `lab/water/engine/lammps-water.js` | sha256 `3679b161…59a5c3` |
| `lab/cnt/data/cnt_6_6.bin` | sha256 `b7f50624…8805b2` (matches its manifest) |
| `lab/cnt/data/manifest.json` | sha256 `a0dff853…8ff36e` |
| `assets/cv/Kazi_Ehsanul_Karim_CV.pdf` | sha256 `5790d417…89143c` (public CV, no referee details) |

The 2026.5 review corrections named in the build command (live confidence intervals, tether wording, RIGID in
replay instructions, engine-hash pointer, amendment wording) were already made and verified in release 2026.5.1;
nothing further is changed there.

## 2. Existing capabilities reused

- Site shell: light tokens (`styles/tokens.css`), header, phone menu (`js/nav.js`), footer, focus and reduced-motion rules.
- `lab/water/zip.js` (ZIP writer used by the Water Lab export) for the Continuum Lab download.
- Recorded CP2K trajectory of the (6,6) tube (`lab/cnt/data/cnt_6_6.bin` + manifest) for the labelled molecular view.
- LAMMPS (same release natively and in WebAssembly) for the molecular calibration package; the Water Lab engine files are not modified.
- Test patterns of `tools/water-lab/` (frozen tolerances, JSON results, failure exit codes, Playwright page checks).

## 3. Scientific data available and permitted uses

| Data | What it is | Permitted use in this lab | Not permitted |
|---|---|---|---|
| Recorded (6,6) CP2K trajectory | Periodic 2.4595 nm CNT segment, 240 C, 6 H2O, 1 Na+, 1 Cl-, cell 24.136 × 24.136 × 24.5951 Å; PBE-D3(BJ), DZVP-MOLOPT, NVT 300 K, dt 0.25 fs; 376 frames at 2 fs (0.75 ps) | Structural and visual provenance, labelled "recorded" | Pressure-flow calibration (no drive, ions present, 0.75 ps, periodic interior without reservoirs); replay implying response to pressure; removing ions and calling it pure SPC/E water |
| (7,7), (9,9), (11,11) recorded trajectories | Same method, wider tubes | Not used in the first release (one supported geometry) | Relabelling as sub-1-nm data |
| Owner pure-water pressure-flow measurement | None found (site files, project documents, MLIP package = synthetic-fixture methods demonstration) | — | — |
| Borg et al. (2018) MD outputs, DOI 10.7488/ds/2427 | Edinburgh DataShare item 10283/3171; record states CC BY 4.0; abstract: sub-2-nm CNT water flow used to calibrate a slip-modified Hagen–Poiseuille–Weissberg relation | Cited as a route for a future published reproduction | Not used: the file archive could not be downloaded or inspected from this workspace, and its water model and geometry are unverified here |

Diameter convention (checked from the recorded coordinates): the mean carbon radius about the tube axis is
4.068 Å in frame 0 (carbon-centre diameter 0.8136 nm), equal to the ideal (6,6) value 0.8138 nm for a C–C bond of
0.1420 nm; thermal breathing raises the mean radius to 4.10–4.13 Å in later frames. The manifest's
`diameter_nm` 0.824 is twice a time-averaged carbon radius from the converter. This lab uses the ideal
carbon-centre diameter d_C = 0.814 nm for the (6,6) preset and states the dynamic value separately.

## 4. Missing calibration information (blocks a predictive CNT claim, not the build)

No pressure-flow measurement exists for pure water in a (6,6) CNT membrane with declared reservoirs. The smallest
measurement that would replace the illustrative pore law is specified in `tools/continuum/md-calibration/README.md`:
net water crossings through the declared (6,6) membrane geometry, at three or more drives of both signs, with
independent replicas, at fixed temperature and mean pressure, with crossing counts at two planes.

## 5. Tools in this workspace

| Tool | Status |
|---|---|
| OpenFOAM | v1912 (OpenCFD), Ubuntu package `openfoam 1912.200626-2build3`, installed 18 Oct 2026; blockMesh, topoSet, createBaffles, simpleFoam run; `porousBafflePressure` present in `libturbulenceModels.so`; label 32-bit, scalar 64-bit |
| Native LAMMPS | 22 Jul 2025 (PyPI `lammps` 2025.7.22.4.0) with MOLECULE, KSPACE, RIGID, OPENMP, EXTRA-FIX |
| Python | 3.11.15, NumPy 2.4.4, SciPy 1.17.1, Matplotlib 3.10.9 |
| Node | 22.22.2 |
| Browser | Chromium 141.0.7390.37 headless shell (Playwright); no Safari, Firefox or real phones |
| Hardware | 2 CPU cores, 7 GB RAM, cloud container |

## 6. Fluid reference data (chambers)

NIST Chemistry WebBook (IAPWS-95, Wagner and Pruss 2002; viscosity Huber et al. 2009), water at 300 K:
density 996.557 kg/m³ at 0.101325 MPa and 1001.00 kg/m³ at 10.1013 MPa (change 0.446 %); viscosity
853.742 µPa·s at 0.101325 MPa and 852.986 µPa·s at 10.1013 MPa. Water molecular mass
m_w = 18.015268 g/mol / N_A = 2.991506 × 10⁻²⁶ kg.
