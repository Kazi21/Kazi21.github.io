# Live Water Lab engine

`lammps-water.js` and `lammps-water.wasm` are LAMMPS compiled to WebAssembly for the Live Water Lab.

- LAMMPS release `stable_22Jul2025_update4` (commit 611ca3b7f8525ba802373b04f9e3d632d515f7e3), unmodified, built as
  a single-threaded library with the MOLECULE, KSPACE and RIGID packages and KISS FFT (no MPI, no OpenMP, no threads).
- Compiled with Emscripten 3.1.6 (`-O3 -fwasm-exceptions`, modular build `createLammpsModule`).
- Linked with a small bridge (`tools/water-lab/engine/wl_bridge.cpp`) that copies positions, the box and global values
  out of LAMMPS through its C library interface. All physics is LAMMPS.
- SHA-256 of `lammps-water.wasm`: see `tools/water-lab/results/summary.json` (`engine_sha256`).

Licences: LAMMPS is distributed under the GNU General Public License, version 2 (`LICENSE-LAMMPS-GPL-2.0.txt`);
these two engine files are therefore distributed under GPL-2.0. The corresponding source is the LAMMPS release named
above plus `tools/water-lab/engine/` in this repository (`build_engine.sh` rebuilds both files). The Emscripten
runtime code inside `lammps-water.js` is available under the MIT licence (Emscripten project).

`lammps-core.js`, `water-model.js`, `water-adapter.js` and `water-export.js` are this website's own code (MIT).
LAMMPS: https://www.lammps.org — A. P. Thompson et al., Comp. Phys. Comm. 271, 108171 (2022).
