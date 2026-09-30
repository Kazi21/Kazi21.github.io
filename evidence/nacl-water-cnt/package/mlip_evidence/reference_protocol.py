"""
Reference-protocol summary + comparison for CP2K reference inputs.

summarize_reference_protocol(input_path) parses a CP2K input and extracts the
parameters that determine reference compatibility for MLIP training/validation:
run type, functional, dispersion, basis sets, pseudopotentials, density-grid
cutoffs, SCF threshold/algorithm, smearing, charge, cell, periodicity, and
whether the stress tensor was requested.

compare_reference_protocols(training, validation) flags any parameter that
differs between two protocol summaries, so that an unexplained reference
mismatch is classified BEFORE a model error is interpreted.

The parser is deliberately conservative: it records what it finds and marks
anything it cannot determine as None, rather than guessing.
"""
import json
import re

# keyword -> (regex, caster). Values are matched case-insensitively on their line.
_SCALAR_KEYS = {
    "run_type": (r"^\s*RUN_TYPE\s+(\S+)", str),
    "cutoff_Ry": (r"^\s*CUTOFF\s+(\d+\.?\d*)", float),
    "rel_cutoff_Ry": (r"^\s*REL_CUTOFF\s+(\d+\.?\d*)", float),
    "ngrids": (r"^\s*NGRIDS\s+(\d+)", int),
    "eps_scf": (r"^\s*EPS_SCF\s+(\S+)", float),
    "max_scf": (r"^\s*MAX_SCF\s+(\d+)", int),
    "charge": (r"^\s*CHARGE\s+([+-]?\d+)", int),
    "added_mos": (r"^\s*ADDED_MOS\s+(\d+)", int),
    "smear_method": (r"^\s*METHOD\s+(FERMI_DIRAC|GAUSSIAN)", str),
    "electronic_temperature_K": (r"ELECTRONIC_TEMPERATURE\s*(?:\[K\])?\s*(\d+\.?\d*)", float),
    "xc_functional": (r"^\s*&XC_FUNCTIONAL\s+(\S+)", str),
    "vdw_type": (r"^\s*TYPE\s+(DFTD3\(BJ\)|DFTD3|DFTD2)", str),
    "mixing_method": (r"^\s*METHOD\s+(BROYDEN_MIXING|PULAY_MIXING|DIRECT_P_MIXING)", str),
}
_FLAG_SECTIONS = {
    "stress_tensor": r"STRESS_TENSOR\s+(ANALYTICAL|NUMERICAL)",
    "smearing_on": r"&SMEAR\s+ON",
    "outer_scf_on": r"&OUTER_SCF\s+ON",
    "forces_on": r"&FORCES\s+ON",
}


def _read_text(input_path):
    with open(input_path, "r") as fh:
        return fh.read()


def summarize_reference_protocol(input_path, output_path=None):
    """Parse a CP2K input file into a protocol summary dict."""
    text = _read_text(input_path)
    lines = text.splitlines()
    out = {"source": str(input_path)}

    for key, (pat, cast) in _SCALAR_KEYS.items():
        val = None
        rx = re.compile(pat, re.IGNORECASE)
        for ln in lines:
            m = rx.search(ln)
            if m:
                try:
                    val = cast(m.group(1))
                except (ValueError, IndexError):
                    val = m.group(1)
                break
        out[key] = val

    for key, pat in _FLAG_SECTIONS.items():
        m = re.search(pat, text, re.IGNORECASE)
        out[key] = (m.group(1) if (m and m.groups()) else bool(m)) if m else (False if key.endswith("_on") else None)

    # per-KIND basis + potential
    kinds = {}
    for km in re.finditer(r"&KIND\s+(\S+)(.*?)&END\s+KIND", text, re.IGNORECASE | re.DOTALL):
        name = km.group(1).strip()
        body = km.group(2)
        b = re.search(r"BASIS_SET\s+(\S+)", body, re.IGNORECASE)
        p = re.search(r"POTENTIAL\s+(\S+)", body, re.IGNORECASE)
        kinds[name] = {"basis_set": b.group(1) if b else None,
                       "potential": p.group(1) if p else None}
    out["kinds"] = kinds

    # cell + periodicity
    abc = re.search(r"^\s*ABC\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)", text, re.IGNORECASE | re.MULTILINE)
    out["cell_abc_A"] = [float(abc.group(i)) for i in (1, 2, 3)] if abc else None
    cell_vec = re.search(r"^\s*A\s+[\d.\-]+\s+[\d.\-]+\s+[\d.\-]+", text, re.IGNORECASE | re.MULTILINE)
    out["cell_uses_vectors"] = bool(cell_vec)
    per = re.search(r"&POISSON.*?PERIODIC\s+(\S+)", text, re.IGNORECASE | re.DOTALL)
    out["poisson_periodic"] = per.group(1) if per else None

    if output_path:
        with open(output_path, "w") as fh:
            json.dump(out, fh, indent=2)
    return out


# parameters whose mismatch between train/validation is scientifically material
_MATERIAL = [
    "xc_functional", "vdw_type", "cutoff_Ry", "rel_cutoff_Ry", "eps_scf",
    "charge", "smear_method", "electronic_temperature_K", "poisson_periodic",
    "run_type", "kinds",
]


def compare_reference_protocols(training, validation):
    """Compare two protocol summaries; return matched/mismatched/only-in-one.

    A mismatch on a MATERIAL parameter is flagged compatible=False, meaning a
    model error computed against `validation` cannot be cleanly attributed to the
    model until the reference difference is explained.
    """
    keys = sorted(set(training) | set(validation))
    matched, mismatched = {}, {}
    for k in keys:
        if k in ("source",):
            continue
        tv, vv = training.get(k, "<absent>"), validation.get(k, "<absent>")
        if tv == vv:
            matched[k] = tv
        else:
            mismatched[k] = {"training": tv, "validation": vv,
                             "material": k in _MATERIAL}
    compatible = not any(v["material"] for v in mismatched.values())
    return {
        "compatible": compatible,
        "n_matched": len(matched),
        "n_mismatched": len(mismatched),
        "mismatched": mismatched,
        "note": ("references compatible on all material parameters"
                 if compatible else
                 "MATERIAL reference mismatch — classify before interpreting model error"),
    }
