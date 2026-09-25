"""
mlip_evidence — reproducible tooling for error-aware MLIP evidence.

Public, self-contained tooling that demonstrates the *methods* used in a
CNT-confined NaCl-water machine-learned interatomic potential (MLIP) campaign:
reference-protocol checking, leakage/frame-mapping checks, per-species force
metrics with honest uncertainty, and a transparent rules-based decision
prototype.

IMPORTANT SCOPE: this package ships with SYNTHETIC fixtures only. Running it does
NOT perform DFT, does NOT train or evaluate an MLIP, and produces NO physical
transport result. It demonstrates the analysis tooling, not scientific findings.
Real campaign numbers, models, and trajectories are intentionally not included.

Provenance: the analysis logic mirrors functions from the author's campaign
tooling (drafted with AI assistance, checked against raw outputs). This public
copy is re-implemented for synthetic inputs. See NOTICE.md.
"""
__version__ = "0.1.0"

from .constants import (
    HARTREE_TO_EV, BOHR_TO_ANGSTROM, HARTREE_PER_BOHR_TO_EV_PER_ANGSTROM,
)
from .reference_protocol import summarize_reference_protocol, compare_reference_protocols
from .frame_mapping import validate_frame_mapping
from .metrics import force_metrics
from .uncertainty import estimate_metric_interval
from .decision import recommend_next_action
from .figures import write_validation_figures
from .release import build_public_release

__all__ = [
    "HARTREE_TO_EV", "BOHR_TO_ANGSTROM", "HARTREE_PER_BOHR_TO_EV_PER_ANGSTROM",
    "summarize_reference_protocol", "compare_reference_protocols",
    "validate_frame_mapping", "force_metrics", "estimate_metric_interval",
    "recommend_next_action", "write_validation_figures", "build_public_release",
]
