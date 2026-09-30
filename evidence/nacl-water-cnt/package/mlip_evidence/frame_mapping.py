"""
Frame / atom-mapping and duplicate (leakage) checks.

validate_frame_mapping(reference, prediction) verifies that a prediction's atoms
correspond to the reference's atoms. If atom IDs are present it restores order via
the unique ID permutation; without IDs it accepts only an already-identical type
order and REJECTS an ambiguous reorder rather than guessing a permutation.

detect_duplicate_frames(set_a, set_b) flags exact-duplicate geometries between two
frame sets by rounded-coordinate hashing. A zero-collision result exposes exact
duplication only; it does NOT establish statistical independence or absence of
near-duplicates (documented limitation, per the reference guidance).

Inputs are plain dicts of NumPy arrays. Arrays are validated for shape, finite
values, and consistent atom counts; violations raise ValueError.
"""
import hashlib
import numpy as np


def _as_types(d):
    t = np.asarray(d["types"])
    if t.ndim != 1:
        raise ValueError(f"types must be 1-D (N,), got shape {t.shape}")
    return t


def _as_coords(d):
    c = np.asarray(d["coords"], dtype=float)
    if c.ndim == 2:
        c = c[None, :, :]
    if c.ndim != 3 or c.shape[-1] != 3:
        raise ValueError(f"coords must be (N,3) or (F,N,3), got shape {c.shape}")
    if not np.all(np.isfinite(c)):
        raise ValueError("coords contain non-finite values")
    return c


def validate_frame_mapping(reference, prediction):
    """Return {'ok', 'restored', 'permutation', 'reason'} for atom correspondence."""
    rt, pt = _as_types(reference), _as_types(prediction)
    if rt.shape[0] != pt.shape[0]:
        return {"ok": False, "restored": False, "permutation": None,
                "reason": f"atom count mismatch: reference {rt.shape[0]} vs prediction {pt.shape[0]}"}
    if sorted(rt.tolist()) != sorted(pt.tolist()):
        return {"ok": False, "restored": False, "permutation": None,
                "reason": "type multisets differ — not the same system"}

    r_ids = reference.get("ids")
    p_ids = prediction.get("ids")
    if r_ids is not None and p_ids is not None:
        r_ids = np.asarray(r_ids); p_ids = np.asarray(p_ids)
        if len(set(r_ids.tolist())) != r_ids.size or len(set(p_ids.tolist())) != p_ids.size:
            return {"ok": False, "restored": False, "permutation": None,
                    "reason": "atom IDs not unique — cannot form an unambiguous permutation"}
        if set(r_ids.tolist()) != set(p_ids.tolist()):
            return {"ok": False, "restored": False, "permutation": None,
                    "reason": "atom ID sets differ — different atoms"}
        # permutation that reorders prediction into reference ID order
        order = {i: k for k, i in enumerate(p_ids.tolist())}
        perm = np.array([order[i] for i in r_ids.tolist()])
        restored = not np.array_equal(perm, np.arange(perm.size))
        if not np.array_equal(pt[perm], rt):
            return {"ok": False, "restored": False, "permutation": None,
                    "reason": "ID permutation does not align atom types — inconsistent metadata"}
        return {"ok": True, "restored": bool(restored), "permutation": perm.tolist(),
                "reason": "restored via unique atom-ID permutation" if restored
                          else "already aligned"}

    # no IDs: accept only identity
    if np.array_equal(rt, pt):
        return {"ok": True, "restored": False, "permutation": None,
                "reason": "type order already identical (no IDs needed)"}
    return {"ok": False, "restored": False, "permutation": None,
            "reason": "atoms need reordering but no IDs supplied — refusing to guess a permutation"}


def _frame_hash(coords_frame, decimals):
    q = np.round(np.asarray(coords_frame, dtype=float), decimals)
    return hashlib.sha256(np.ascontiguousarray(q).tobytes()).hexdigest()


def detect_duplicate_frames(set_a, set_b, decimals=4):
    """Flag exact-duplicate geometries between two frame sets (leakage check).

    Returns {'n_a','n_b','n_duplicates','duplicate_pairs','note'}.
    Zero duplicates != independence (see module docstring).
    """
    ca, cb = _as_coords(set_a), _as_coords(set_b)
    if ca.shape[1] != cb.shape[1]:
        raise ValueError("frame sets have different atom counts")
    ha = {_frame_hash(f, decimals): i for i, f in enumerate(ca)}
    dup = []
    for j, f in enumerate(cb):
        h = _frame_hash(f, decimals)
        if h in ha:
            dup.append((ha[h], j))
    return {
        "n_a": int(ca.shape[0]), "n_b": int(cb.shape[0]),
        "n_duplicates": len(dup), "duplicate_pairs": dup,
        "note": ("exact-duplicate hashing only; zero collisions does not prove "
                 "statistical independence or absence of near-duplicates"),
    }
