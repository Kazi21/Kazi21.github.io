#!/usr/bin/env python3
"""
Focused tests for mlip_evidence — each targets a concrete risk named in the task.
Run: python tests/test_mlip_evidence.py   (from the public/ root)
Also works under pytest.
"""
import os
import sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from mlip_evidence.constants import (
    HARTREE_TO_EV, BOHR_TO_ANGSTROM, HARTREE_PER_BOHR_TO_EV_PER_ANGSTROM, LEGACY_FORCE_FACTOR)
from mlip_evidence.frame_mapping import validate_frame_mapping, detect_duplicate_frames
from mlip_evidence.metrics import force_metrics
from mlip_evidence.uncertainty import estimate_metric_interval
from mlip_evidence.decision import recommend_next_action, DEFAULT_POLICY
from mlip_evidence.release import build_public_release


def test_units_internally_consistent():
    assert abs(HARTREE_PER_BOHR_TO_EV_PER_ANGSTROM - HARTREE_TO_EV / BOHR_TO_ANGSTROM) < 1e-12
    # derived ratio differs from the legacy doc value only immaterially
    assert abs(HARTREE_PER_BOHR_TO_EV_PER_ANGSTROM - LEGACY_FORCE_FACTOR) < 1e-3
    assert abs(HARTREE_PER_BOHR_TO_EV_PER_ANGSTROM - LEGACY_FORCE_FACTOR) > 1e-6  # but not identical


def test_frame_mapping_restores_with_ids():
    types = np.array([1, 2, 3, 2])
    ids = np.array([10, 11, 12, 13])
    perm = np.array([2, 0, 3, 1])
    out = validate_frame_mapping(
        {"types": types, "ids": ids},
        {"types": types[perm], "ids": ids[perm]})
    assert out["ok"] and out["restored"], out


def test_frame_mapping_rejects_ambiguous_without_ids():
    out = validate_frame_mapping(
        {"types": np.array([1, 2, 3])},
        {"types": np.array([2, 1, 3])})   # reordered, no ids
    assert not out["ok"] and "refusing" in out["reason"].lower(), out


def test_known_force_offset_metrics():
    # constant +0.3 on Fx only -> component RMSE = sqrt(0.3^2/3); vector RMSE = 0.3
    ref = np.zeros((100, 3))
    pred = ref.copy(); pred[:, 0] = 0.3
    m = force_metrics(ref, pred, species=["X"] * 100)
    assert abs(m["overall"]["component_rmse"] - np.sqrt(0.3 ** 2 / 3)) < 1e-9, m
    assert abs(m["overall"]["vector_rmse"] - 0.3) < 1e-9, m


def test_weak_channel_visible_despite_low_aggregate():
    rng = np.random.default_rng(0)
    ref = rng.normal(0, 1, (1000, 3)); pred = ref + rng.normal(0, 0.1, (1000, 3))
    species = np.array(["C"] * 980 + ["Na"] * 20)
    pred[species == "Na"] += rng.normal(0, 1.0, (20, 3))   # weak minority
    m = force_metrics(ref, pred, species)
    assert m["overall"]["component_rmse"] < 0.3            # aggregate looks fine
    assert m["per_species"]["Na"]["component_rmse"] > 0.7  # but Na is exposed


def test_missing_species_reported_not_zero():
    ref = np.zeros((10, 3)); pred = ref.copy()
    m = force_metrics(ref, pred, ["C"] * 10, expected_species=["C", "Na"])
    assert m["missing_species"] == ["Na"], m
    assert "Na" not in m["per_species"]


def test_duplicate_frames_flagged():
    a = np.random.default_rng(1).normal(0, 1, (5, 8, 3))
    b = a[[2, 4]].copy()                       # exact duplicates of a
    out = detect_duplicate_frames({"coords": a}, {"coords": b})
    assert out["n_duplicates"] == 2, out


def test_interval_reproducible_and_unavailable():
    recs = [{"m": 0.1 + 0.01 * i, "group": f"r{i}"} for i in range(5)
            for _ in range(4)]
    a = estimate_metric_interval(recs, "m", group_key="group")
    b = estimate_metric_interval(recs, "m", group_key="group")
    assert a["status"] == "OK" and a["ci_low"] == b["ci_low"] == b["ci_low"]
    # too few groups -> unavailable, not fabricated
    few = [{"m": 0.1, "group": "r0"}, {"m": 0.2, "group": "r1"}]
    u = estimate_metric_interval(few, "m", group_key="group")
    assert u["status"] == "CI_UNAVAILABLE", u


def test_controller_missing_evidence():
    ev = {"reference_compatible": None, "frame_mapping_ok": True}
    out = recommend_next_action(ev, DEFAULT_POLICY)
    assert out["action"] == "INSUFFICIENT_EVIDENCE" and out["unresolved"], out


def test_controller_refuses_efield():
    ev = {"reference_compatible": True, "frame_mapping_ok": True,
          "requested_deployment": "efield", "per_species_error": {}}
    out = recommend_next_action(ev, DEFAULT_POLICY)
    assert out["action"] == "REVIEW_MODEL_SCOPE", out


def test_controller_blind_weak_channel_after_repair():
    ev = {"reference_compatible": True, "frame_mapping_ok": True,
          "requested_deployment": "wall_friction",
          "per_species_error": {"C": 0.09, "Na": 1.1},
          "uncertainty_error_correlation": 0.07,
          "targeted_repair_done": True, "targeted_repair_improved": False}
    out = recommend_next_action(ev, DEFAULT_POLICY)
    assert out["action"] == "REVIEW_MODEL_SCOPE", out


def test_controller_stop_within_scope():
    ev = {"reference_compatible": True, "frame_mapping_ok": True,
          "requested_deployment": "wall_friction",
          "per_species_error": {"C": 0.09, "O": 0.25, "Cl": 0.11},
          "uncertainty_error_correlation": 0.8,
          "metric_interval_status": "OK"}
    out = recommend_next_action(ev, DEFAULT_POLICY)
    assert out["action"] == "STOP_WITHIN_TESTED_SCOPE", out


def test_release_rejects_restricted_and_escape(tmp_path=None):
    import tempfile, json
    d = tempfile.mkdtemp()
    pub = os.path.join(d, "public"); os.makedirs(pub)
    with open(os.path.join(pub, "ok.txt"), "w") as fh:
        fh.write("public")
    # restricted entry must be rejected
    man = os.path.join(d, "man.json")
    json.dump({"files": [{"public_path": "ok.txt"},
                         {"public_path": "secret.txt", "restricted": True}]},
              open(man, "w"))
    try:
        build_public_release(man, pub, os.path.join(d, "out.zip"))
        raise AssertionError("should have rejected restricted entry")
    except ValueError as e:
        assert "restricted" in str(e)
    # traversal must be rejected
    json.dump({"files": [{"public_path": "../escape.txt"}]}, open(man, "w"))
    try:
        build_public_release(man, pub, os.path.join(d, "out.zip"))
        raise AssertionError("should have rejected traversal")
    except ValueError as e:
        assert "invalid public_path" in str(e) or "escape" in str(e)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    p = f = 0
    for fn in fns:
        try:
            fn(); print(f"PASS {fn.__name__}"); p += 1
        except Exception as e:
            print(f"FAIL {fn.__name__}: {e}"); f += 1
    print(f"\n{p} passed, {f} failed")
    sys.exit(1 if f else 0)
