#!/usr/bin/env bash
# Rebuilds the Live Water Lab engine (lab/water/engine/lammps-water.{js,wasm}) from source.
# Requirements: git, CMake >= 3.16, Emscripten 3.1.6 (emcc/em++/emcmake/emmake on PATH; Debian/Ubuntu: apt install emscripten).
# Output: build/dist/lammps-water.js and build/dist/lammps-water.wasm (copy them to lab/water/engine/).
# The engine is LAMMPS (GPL-2.0), single-threaded, packages MOLECULE, KSPACE, RIGID, KISS FFT, no MPI/OpenMP.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK:-$HERE/build}"
TAG=stable_22Jul2025_update4          # LAMMPS release (commit 611ca3b7f8525ba802373b04f9e3d632d515f7e3)
mkdir -p "$WORK" && cd "$WORK"
[ -d lammps-src ] || git clone --depth 1 --branch "$TAG" https://github.com/lammps/lammps.git lammps-src
git -C lammps-src log -1 --format='LAMMPS source %H %cd'
mkdir -p build-wasm && cd build-wasm
emcmake cmake ../lammps-src/cmake \
  -D CMAKE_BUILD_TYPE=Release \
  -D CMAKE_CXX_FLAGS_RELEASE="-O3 -DNDEBUG -fwasm-exceptions" \
  -D CMAKE_C_FLAGS_RELEASE="-O3 -DNDEBUG -fwasm-exceptions" \
  -D BUILD_MPI=off -D BUILD_OMP=off -D BUILD_SHARED_LIBS=off -D BUILD_TOOLS=off -D BUILD_LAMMPS_SHELL=off \
  -D LAMMPS_SIZES=smallbig -D FFT=KISS -D FFT_SINGLE=off \
  -D WITH_JPEG=off -D WITH_PNG=off -D WITH_GZIP=off -D WITH_FFMPEG=off -D WITH_CURL=off \
  -D PKG_MOLECULE=on -D PKG_KSPACE=on -D PKG_RIGID=on \
  -D LAMMPS_MACHINE=wasm > cmake.log 2>&1
emmake make -j"${JOBS:-2}" lammps > make.log 2>&1
cd "$WORK" && mkdir -p dist
FUNCS='["_lammps_open_no_mpi","_lammps_close","_lammps_command","_lammps_commands_string","_lammps_get_natoms","_lammps_extract_global","_lammps_extract_setting","_lammps_get_thermo","_lammps_has_error","_lammps_get_last_error_message","_lammps_version","_lammps_free","_lammps_config_has_package","_wl_gather_xvf","_wl_box","_wl_compute_scalar","_wl_compute_vector","_wl_variable","_wl_fix_scalar","_wl_fix_vector","_wl_step","_malloc","_free"]'
em++ -O3 -fwasm-exceptions -std=c++17 -I lammps-src/src "$HERE/wl_bridge.cpp" build-wasm/liblammps_wasm.a \
  -o dist/lammps-water.js \
  -sMODULARIZE=1 -sEXPORT_NAME=createLammpsModule -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sTOTAL_STACK=1048576 \
  -sFORCE_FILESYSTEM=1 -sEXIT_RUNTIME=0 -sINVOKE_RUN=0 \
  -sEXPORTED_FUNCTIONS="$FUNCS" \
  -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","lengthBytesUTF8","getValue","setValue","FS"]'
ls -la dist && sha256sum dist/lammps-water.wasm
