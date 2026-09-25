"""
Per-species force error metrics with explicit definitions.

Two force-RMSE definitions are reported side by side and never mixed:
  - component RMSE = sqrt( sum((Fp-Fr)**2) / (3*N) )   over 3N scalar components
  - vector RMSE    = sqrt( mean( sum((Fp-Fr)**2, axis=-1) ) )  over N vectors
Also reported per species: component MAE and the vector-error median/p95/max, plus
per-frame breakdown so a large system or dominant species cannot hide a weak
channel. A species with zero matched observations is reported as MISSING evidence,
never as zero error.

Inputs are matched reference/prediction arrays of shape (M,3), with per-row species
labels and frame ids of length M. Non-finite values, shape mismatches, and empty
input are rejected.
"""
import numpy as np


def _validate(reference, prediction):
    r = np.asarray(reference, dtype=float)
    p = np.asarray(prediction, dtype=float)
    if r.shape != p.shape:
        raise ValueError(f"reference {r.shape} and prediction {p.shape} must match")
    if r.ndim != 2 or r.shape[1] != 3:
        raise ValueError(f"force arrays must be (M,3), got {r.shape}")
    if r.shape[0] == 0:
        raise ValueError("no matched force vectors supplied")
    if not (np.all(np.isfinite(r)) and np.all(np.isfinite(p))):
        raise ValueError("non-finite values in force arrays")
    return r, p


def _species_block(dr):
    """dr = (n,3) error vectors for one species -> metric dict."""
    n = dr.shape[0]
    comp = dr.reshape(-1)
    vec_mag = np.sqrt(np.sum(dr ** 2, axis=1))
    return {
        "n_vectors": int(n),
        "component_rmse": float(np.sqrt(np.mean(comp ** 2))),
        "component_mae": float(np.mean(np.abs(comp))),
        "vector_rmse": float(np.sqrt(np.mean(vec_mag ** 2))),
        "vector_median": float(np.median(vec_mag)),
        "vector_p95": float(np.percentile(vec_mag, 95)),
        "vector_max": float(np.max(vec_mag)),
    }


def force_metrics(reference, prediction, species, frame_ids=None, expected_species=None):
    """Per-species and overall force metrics.

    reference, prediction : (M,3) matched force vectors
    species               : length-M labels (str/int)
    frame_ids             : length-M frame ids (optional; enables per-frame table)
    expected_species      : iterable of species that SHOULD be present; any with
                            no observations are listed under 'missing_species'.
    """
    r, p = _validate(reference, prediction)
    species = np.asarray(species)
    if species.shape[0] != r.shape[0]:
        raise ValueError("species length must equal number of force vectors")
    dr = p - r

    per_species = {}
    for s in sorted(set(species.tolist()), key=str):
        per_species[str(s)] = _species_block(dr[species == s])

    result = {
        "definitions": {
            "component_rmse": "sqrt(sum((Fp-Fr)**2)/(3N))",
            "vector_rmse": "sqrt(mean(sum((Fp-Fr)**2, axis=-1)))",
        },
        "overall": _species_block(dr),
        "per_species": per_species,
    }

    if expected_species is not None:
        missing = [str(s) for s in expected_species if str(s) not in per_species]
        result["missing_species"] = missing  # missing evidence, NOT zero error

    if frame_ids is not None:
        frame_ids = np.asarray(frame_ids)
        if frame_ids.shape[0] != r.shape[0]:
            raise ValueError("frame_ids length must equal number of force vectors")
        per_frame = {}
        for f in sorted(set(frame_ids.tolist()), key=str):
            per_frame[str(f)] = _species_block(dr[frame_ids == f])
        result["per_frame"] = per_frame

    return result
