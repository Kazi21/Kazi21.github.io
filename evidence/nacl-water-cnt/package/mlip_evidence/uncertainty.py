"""
Group-aware bootstrap confidence intervals.

The sampling unit is an INDEPENDENT group (e.g. an independent replica) or a
justified time block — never a force component, atom, adjacent frame, or committee
member. The estimand is the mean of `metric` over observations; each bootstrap
draw resamples GROUPS with replacement and pools their observations.

If fewer than `min_groups` independent groups are available (or block metadata is
missing when a block bootstrap is requested), the function returns status
'CI_UNAVAILABLE' with a reason rather than fabricating an interval.

Defaults are reproducible: confidence 0.95, 2000 draws, seed 20260906. Block
duration is NOT assigned a universal default; it must come from supplied
`time_ps` metadata and a caller-chosen `block_ps`.
"""
import numpy as np


def _grouped(records, metric, group_key):
    groups = {}
    for rec in records:
        if metric not in rec:
            raise ValueError(f"record missing metric '{metric}': {rec}")
        if group_key not in rec:
            raise ValueError(f"record missing group_key '{group_key}': {rec}")
        v = float(rec[metric])
        if not np.isfinite(v):
            raise ValueError(f"non-finite metric value: {rec}")
        groups.setdefault(rec[group_key], []).append(v)
    return {g: np.asarray(vs, dtype=float) for g, vs in groups.items()}


def _block_groups(records, metric, block_ps):
    for rec in records:
        if "time_ps" not in rec:
            raise ValueError("block bootstrap requires 'time_ps' in every record")
    groups = {}
    for rec in records:
        b = int(np.floor(float(rec["time_ps"]) / block_ps))
        groups.setdefault(b, []).append(float(rec[metric]))
    return {g: np.asarray(vs, dtype=float) for g, vs in groups.items()}


def estimate_metric_interval(records, metric, *, group_key="group",
                             block_ps=None, confidence=0.95,
                             n_bootstrap=2000, seed=20260906, min_groups=3):
    """Bootstrap CI for the mean of `metric`, resampling independent groups.

    Returns a dict with either the interval or status 'CI_UNAVAILABLE'.
    """
    if not records:
        return {"status": "CI_UNAVAILABLE", "reason": "no records supplied"}

    if block_ps is not None:
        groups = _block_groups(records, metric, block_ps)
        unit = f"time block ({block_ps} ps)"
    else:
        groups = _grouped(records, metric, group_key)
        unit = f"group '{group_key}'"

    labels = list(groups.keys())
    n_groups = len(labels)
    if n_groups < min_groups:
        return {"status": "CI_UNAVAILABLE",
                "reason": f"only {n_groups} independent {unit} unit(s); need >= {min_groups}",
                "n_groups": n_groups, "sampling_unit": unit,
                "estimand": f"mean of {metric}"}

    all_vals = np.concatenate([groups[l] for l in labels])
    point = float(np.mean(all_vals))

    rng = np.random.default_rng(seed)
    idx = np.arange(n_groups)
    draws = np.empty(n_bootstrap)
    for b in range(n_bootstrap):
        pick = rng.choice(idx, size=n_groups, replace=True)
        pooled = np.concatenate([groups[labels[i]] for i in pick])
        draws[b] = np.mean(pooled)
    alpha = 1.0 - confidence
    lo = float(np.percentile(draws, 100 * alpha / 2))
    hi = float(np.percentile(draws, 100 * (1 - alpha / 2)))

    return {
        "status": "OK",
        "estimand": f"mean of {metric}",
        "sampling_unit": unit,
        "point": point,
        "ci_low": lo,
        "ci_high": hi,
        "confidence": confidence,
        "n_groups": n_groups,
        "n_bootstrap": n_bootstrap,
        "seed": seed,
        "method": "group/block nonparametric bootstrap (resample units with replacement)",
        "note": ("interval reflects between-unit variability only; it assumes the "
                 "supplied units are genuinely independent"),
    }
