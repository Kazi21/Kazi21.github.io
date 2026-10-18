// SPDX-License-Identifier: GPL-2.0-only (linked into the LAMMPS WebAssembly engine)
// Live Water Lab — thin bridge on top of the LAMMPS C library interface (library.h).
// All physics is done by LAMMPS; these helpers only copy per-atom data into caller-provided
// buffers ordered by atom ID, so the JavaScript side can render and analyse without per-atom calls.
#include "library.h"
#include <cstdlib>
#include <cstring>

extern "C" {

// Positions unwrapped with image flags (orthogonal box), velocities and forces, each 3*natoms doubles,
// ordered by atom ID 1..natoms. Returns natoms, or -1 on error.
int wl_gather_xvf(void *lmp, double *xu, double *v, double *f) {
  int n = (int) lammps_get_natoms(lmp);
  if (n <= 0) return -1;
  int *img = (int *) malloc(sizeof(int) * 3 * n);
  lammps_gather_atoms(lmp, (char *) "x", 1, 3, xu);
  lammps_gather_atoms(lmp, (char *) "image", 0, 3, img);
  if (v) lammps_gather_atoms(lmp, (char *) "v", 1, 3, v);
  if (f) lammps_gather_atoms(lmp, (char *) "f", 1, 3, f);
  double lo[3], hi[3], xy, yz, xz; int pflags[3], boxflag;
  lammps_extract_box(lmp, lo, hi, &xy, &yz, &xz, pflags, &boxflag);
  double L[3] = { hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2] };
  for (int i = 0; i < n; i++)
    for (int d = 0; d < 3; d++) xu[3 * i + d] += img[3 * i + d] * L[d];
  free(img);
  return n;
}

// Box: lo[3], hi[3] into out[6].
void wl_box(void *lmp, double *out) {
  double lo[3], hi[3], xy, yz, xz; int pflags[3], boxflag;
  lammps_extract_box(lmp, lo, hi, &xy, &yz, &xz, pflags, &boxflag);
  for (int d = 0; d < 3; d++) { out[d] = lo[d]; out[3 + d] = hi[d]; }
}

// Global scalar of a compute (style global, type scalar); NaN if unavailable.
double wl_compute_scalar(void *lmp, const char *id) {
  double *p = (double *) lammps_extract_compute(lmp, id, LMP_STYLE_GLOBAL, LMP_TYPE_SCALAR);
  return p ? *p : __builtin_nan("");
}

// Element i of a global compute vector; NaN if unavailable.
double wl_compute_vector(void *lmp, const char *id, int i) {
  double *p = (double *) lammps_extract_compute(lmp, id, LMP_STYLE_GLOBAL, LMP_TYPE_VECTOR);
  return p ? p[i] : __builtin_nan("");
}

// Value of an equal-style variable; NaN if unavailable.
double wl_variable(void *lmp, const char *name) {
  double *p = (double *) lammps_extract_variable(lmp, name, nullptr);
  if (!p) return __builtin_nan("");
  double v = *p;
  lammps_free(p);
  return v;
}

// Global scalar of a fix; NaN if unavailable.
double wl_fix_scalar(void *lmp, const char *id) {
  double *p = (double *) lammps_extract_fix(lmp, id, LMP_STYLE_GLOBAL, LMP_TYPE_SCALAR, 0, 0);
  if (!p) return __builtin_nan("");
  double v = *p;
  lammps_free(p);
  return v;
}

// Element i of a fix's global vector; NaN if unavailable.
double wl_fix_vector(void *lmp, const char *id, int i) {
  double *p = (double *) lammps_extract_fix(lmp, id, LMP_STYLE_GLOBAL, LMP_TYPE_VECTOR, i, 0);
  if (!p) return __builtin_nan("");
  double v = *p;
  lammps_free(p);
  return v;
}

int wl_step(void *lmp) {
  void *p = lammps_extract_global(lmp, "ntimestep");
  return p ? (int) *((int64_t *) p) : -1;
}
}
