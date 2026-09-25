"""
Physical constants — NIST CODATA 2022 (checked 2026-09-06).

The force-conversion factor is DERIVED from the two primary constants rather than
hard-coded, so the convention is internally consistent by construction.

  HARTREE_TO_EV                    = 27.211386245981   eV / Hartree
  BOHR_TO_ANGSTROM                 = 0.529177210544    Angstrom / Bohr
  HARTREE_PER_BOHR_TO_EV_PER_ANGSTROM = HARTREE_TO_EV / BOHR_TO_ANGSTROM
                                   = 51.42206751...    (eV/A) / (Ha/Bohr)

Note: a value of 51.42208619 appears in an earlier lab document; it differs from
the CODATA-2022-derived ratio by ~1.9e-5 absolute (~3.6e-7 relative), i.e.
numerically immaterial for force comparisons, but this package uses the derived
CODATA 2022 ratio as the single declared convention.
"""

HARTREE_TO_EV = 27.211386245981
BOHR_TO_ANGSTROM = 0.529177210544
HARTREE_PER_BOHR_TO_EV_PER_ANGSTROM = HARTREE_TO_EV / BOHR_TO_ANGSTROM

# Value found in an earlier lab readiness document, kept only for the
# internal-consistency test that flags the (immaterial) discrepancy.
LEGACY_FORCE_FACTOR = 51.42208619
