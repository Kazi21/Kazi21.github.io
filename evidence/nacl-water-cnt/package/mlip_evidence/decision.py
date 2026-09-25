"""
Workflow-controller prototype (transparent, rules-based).

recommend_next_action(evidence, policy) maps explicit evidence + declared
thresholds to ONE next action, with the reasons, the evidence it still needs, the
policy version, and input provenance. It is a fixed rule dispatcher — NOT a learned
or autonomous scientist. It launches nothing and claims no cost/time savings.

Actions:
  REVIEW_REFERENCE         reference protocols incompatible on a material parameter
  CHECK_LABEL_MAPPING      atom/frame correspondence failed
  REQUEST_TARGETED_LABELS  a weak channel whose committee uncertainty is blind to it
  REQUEST_MORE_SAMPLING    a weak channel the uncertainty tracks, or CI not yet resolvable
  REVIEW_MODEL_SCOPE       requested deployment is outside tested scope, OR a targeted
                           repair already failed for a weak channel (route out of scope)
  STOP_WITHIN_TESTED_SCOPE all required checks pass inside the tested scope
  INSUFFICIENT_EVIDENCE    required evidence missing / problem unclassified

Design rule: no numerical score overrides missing physics evidence. If a required
input is absent the controller returns INSUFFICIENT_EVIDENCE (unresolved), never a
green light.
"""

DEFAULT_POLICY = {
    "version": "decision-policy-0.1",
    "component_rmse_weak_eVA": 0.5,     # channel is "weak" above this component RMSE
    "uncertainty_blind_corr": 0.3,      # committee "blind" if corr(spread,error) < this
    "tested_deployments": ["equilibrium_md", "structure", "wall_friction"],
    "required_evidence": ["reference_compatible", "frame_mapping_ok"],
}


def _provenance(evidence):
    return {
        "inputs_present": sorted(k for k in evidence if evidence[k] is not None),
        "inputs_absent": sorted(k for k in evidence if evidence.get(k) is None),
        "source": evidence.get("provenance", "unspecified"),
    }


def recommend_next_action(evidence, policy=None):
    """Return the single recommended next action with full justification."""
    policy = policy or DEFAULT_POLICY
    reasons, missing = [], []

    # 1. required evidence must be present (physics gate, not overridable)
    for key in policy["required_evidence"]:
        if evidence.get(key) is None:
            missing.append(key)
    if missing:
        return {
            "action": "INSUFFICIENT_EVIDENCE",
            "reasons": [f"required evidence missing: {', '.join(missing)}"],
            "missing_evidence": missing,
            "policy_version": policy["version"],
            "provenance": _provenance(evidence),
            "unresolved": True,
        }

    # 2. reference compatibility
    if evidence.get("reference_compatible") is False:
        reasons.append("training/validation reference protocols differ on a material parameter")
        return _emit("REVIEW_REFERENCE", reasons, policy, evidence)

    # 3. frame/atom mapping
    if evidence.get("frame_mapping_ok") is False:
        reasons.append("atom/frame correspondence check failed")
        return _emit("CHECK_LABEL_MAPPING", reasons, policy, evidence)

    # 4. requested deployment must be inside tested scope (refuse extrapolation)
    dep = evidence.get("requested_deployment")
    if dep is not None and dep not in policy["tested_deployments"]:
        reasons.append(f"requested deployment '{dep}' is outside tested scope "
                       f"{policy['tested_deployments']} — refuse without new validation")
        return _emit("REVIEW_MODEL_SCOPE", reasons, policy, evidence)

    # 5. weak-channel handling
    per_species = evidence.get("per_species_error") or {}
    weak = {s: e for s, e in per_species.items()
            if e is not None and e > policy["component_rmse_weak_eVA"]}
    if weak:
        worst = max(weak, key=weak.get)
        reasons.append(f"weak channel '{worst}' component RMSE {weak[worst]:.3f} "
                       f"> {policy['component_rmse_weak_eVA']} eV/A")
        corr = evidence.get("uncertainty_error_correlation")
        if corr is None:
            missing.append("uncertainty_error_correlation")
            reasons.append("cannot tell if acquisition signal sees this channel")
            return _emit("INSUFFICIENT_EVIDENCE", reasons, policy, evidence,
                         missing=missing, unresolved=True)
        if corr < policy["uncertainty_blind_corr"]:
            reasons.append(f"committee uncertainty blind to it (corr {corr:.2f} "
                           f"< {policy['uncertainty_blind_corr']})")
            if evidence.get("targeted_repair_done") and evidence.get("targeted_repair_improved") is False:
                reasons.append("a targeted direct-label repair already ran without improvement "
                               "(narrow negative result) — route this channel out of scope, "
                               "do not claim a proven root cause")
                return _emit("REVIEW_MODEL_SCOPE", reasons, policy, evidence)
            reasons.append("acquisition is blind, so add direct targeted labels (not more AL)")
            return _emit("REQUEST_TARGETED_LABELS", reasons, policy, evidence)
        reasons.append(f"uncertainty tracks the error (corr {corr:.2f}) — more sampling should surface it")
        return _emit("REQUEST_MORE_SAMPLING", reasons, policy, evidence)

    # 6. all channels acceptable; check the interval is resolvable
    if evidence.get("metric_interval_status") == "CI_UNAVAILABLE":
        reasons.append("no weak channel, but confidence interval not resolvable "
                       "(too few independent units) — gather more replicas/blocks")
        return _emit("REQUEST_MORE_SAMPLING", reasons, policy, evidence)

    reasons.append("references compatible, mapping ok, deployment in tested scope, "
                   "no weak channel — proceed within the tested scope only")
    return _emit("STOP_WITHIN_TESTED_SCOPE", reasons, policy, evidence)


def _emit(action, reasons, policy, evidence, missing=None, unresolved=False):
    return {
        "action": action,
        "reasons": reasons,
        "missing_evidence": missing or [],
        "policy_version": policy["version"],
        "provenance": _provenance(evidence),
        "unresolved": unresolved,
    }
