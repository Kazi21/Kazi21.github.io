"""
Deterministic SYNTHETIC fixtures for mlip_evidence.

Builds a multi-species matched force set (reference + prediction) in which one
minority channel ("X") is deliberately weak, so the tooling can demonstrate that
a poor minority species stays visible despite a low aggregate metric. Also builds
group-structured records for the bootstrap and an evidence dict for the decision
controller.

NOTHING here is a physical result. Forces are drawn from Gaussians; the "X" error is
inflated by construction. Channel labels (A, B, X) are generic placeholders, not chemical elements, and the
error levels are arbitrary; do not interpret any number as DFT/MLIP accuracy.
"""
import json
import os
import numpy as np

SEED = 20260906
# species: (n_atoms_per_frame, reference sigma, prediction-error sigma)
SPEC = {
    "A":  (60, 1.5, 0.16),   # majority channel (generic label)
    "B":  (18, 1.2, 0.06),   # second channel (generic label)
    "X":  (3,  1.2, 1.30),   # <-- intentionally WEAK minority channel
}
N_FRAMES = 20
EXPECTED_SPECIES = ["A", "B", "X"]


def build_force_fixture(seed=SEED):
    rng = np.random.default_rng(seed)
    ref, pred, species, frames = [], [], [], []
    for f in range(N_FRAMES):
        for s, (n, sig_ref, sig_err) in SPEC.items():
            r = rng.normal(0.0, sig_ref, size=(n, 3))
            p = r + rng.normal(0.0, sig_err, size=(n, 3))
            ref.append(r); pred.append(p)
            species.extend([s] * n); frames.extend([f] * n)
    return {
        "reference": np.vstack(ref),
        "prediction": np.vstack(pred),
        "species": np.array(species),
        "frame_ids": np.array(frames),
        "expected_species": np.array(EXPECTED_SPECIES),
    }


def build_interval_records(seed=SEED, n_replicas=5):
    """Per-replica scalar records for the group bootstrap (synthetic)."""
    rng = np.random.default_rng(seed + 1)
    recs = []
    for rep in range(n_replicas):
        base = rng.normal(0.16, 0.01)          # synthetic per-replica A-channel RMSE
        for _ in range(6):
            recs.append({"a_component_rmse": float(abs(base + rng.normal(0, 0.005))),
                         "group": f"replica_{rep}"})
    return recs


def save_fixture(out_dir, seed=SEED):
    os.makedirs(out_dir, exist_ok=True)
    fx = build_force_fixture(seed)
    npz = os.path.join(out_dir, "synthetic_forces.npz")
    np.savez(npz, **fx)
    recs = build_interval_records(seed)
    with open(os.path.join(out_dir, "synthetic_interval_records.json"), "w") as fh:
        json.dump(recs, fh, indent=2)
    return npz


def run_demo(out_dir):
    """Full synthetic pipeline: metrics -> figures -> interval -> decision."""
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    from mlip_evidence import (force_metrics, estimate_metric_interval,
                               recommend_next_action, write_validation_figures)
    from mlip_evidence.decision import DEFAULT_POLICY

    os.makedirs(out_dir, exist_ok=True)
    fx = build_force_fixture()

    metrics = force_metrics(fx["reference"], fx["prediction"], fx["species"],
                            frame_ids=fx["frame_ids"],
                            expected_species=fx["expected_species"].tolist())
    with open(os.path.join(out_dir, "metrics.json"), "w") as fh:
        json.dump(metrics, fh, indent=2)

    figs = write_validation_figures(metrics, out_dir)

    recs = build_interval_records()
    interval = estimate_metric_interval(recs, "a_component_rmse", group_key="group")
    with open(os.path.join(out_dir, "interval.json"), "w") as fh:
        json.dump(interval, fh, indent=2)

    # evidence assembled from the synthetic metrics; committee corr set low for "X"
    per_species_err = {s: metrics["per_species"][s]["component_rmse"]
                       for s in metrics["per_species"]}
    evidence = {
        "reference_compatible": True,
        "frame_mapping_ok": True,
        "requested_deployment": "wall_friction",
        "per_species_error": per_species_err,
        "uncertainty_error_correlation": 0.20,   # synthetic: committee blind to weak channel
        "targeted_repair_done": True,
        "targeted_repair_improved": False,
        "metric_interval_status": interval["status"],
        "provenance": "synthetic demo fixture",
    }
    decision = recommend_next_action(evidence, DEFAULT_POLICY)
    with open(os.path.join(out_dir, "decision.json"), "w") as fh:
        json.dump(decision, fh, indent=2)

    summary = {
        "note": "SYNTHETIC demonstration only — not DFT/MLIP/transport results",
        "overall_component_rmse": metrics["overall"]["component_rmse"],
        "weak_channel_visible": {
            s: round(metrics["per_species"][s]["component_rmse"], 3)
            for s in metrics["per_species"]},
        "interval_status": interval["status"],
        "decision_action": decision["action"],
        "figures": figs,
    }
    with open(os.path.join(out_dir, "SUMMARY.json"), "w") as fh:
        json.dump(summary, fh, indent=2)
    print(json.dumps(summary, indent=2))
    return summary


if __name__ == "__main__":
    import sys
    run_demo(sys.argv[1] if len(sys.argv) > 1 else "demo_out")
