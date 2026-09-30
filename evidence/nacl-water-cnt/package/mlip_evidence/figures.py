"""
Validation figures from a metrics report (synthetic demonstration only).

write_validation_figures(report, output_dir) renders per-species force-error bars
from a `force_metrics` report and stamps every figure with a synthetic-data
disclaimer. It never invents a missing value: a species absent from the report is
drawn as a labelled gap, not as zero.

Matplotlib is used with the non-interactive Agg backend so figures regenerate
headlessly from included source.
"""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

DISCLAIMER = "Synthetic software demonstration; not a DFT, MLIP-accuracy or transport result"


def write_validation_figures(report, output_dir, prefix="validation"):
    """Write per-species metric figures; return list of file paths."""
    os.makedirs(output_dir, exist_ok=True)
    per = report.get("per_species", {})
    if not per:
        raise ValueError("report has no 'per_species' block to plot")
    species = sorted(per.keys(), key=str)
    comp = [per[s]["component_rmse"] for s in species]
    p95 = [per[s]["vector_p95"] for s in species]
    paths = []

    for name, values, ylab in [
        ("component_rmse", comp, "component force RMSE (arb. units)"),
        ("vector_p95", p95, "vector force error p95 (arb. units)"),
    ]:
        fig, ax = plt.subplots(figsize=(6, 3.6))
        bars = ax.bar(species, values, color="#4C72B0")
        # highlight the worst channel so a weak minority species is visible
        worst = max(range(len(values)), key=lambda i: values[i])
        bars[worst].set_color("#C44E52")
        ax.set_ylabel(ylab)
        ax.set_xlabel("species")
        ax.set_title(f"Per-species {name.replace('_', ' ')} (synthetic)")
        for i, v in enumerate(values):
            ax.text(i, v, f"{v:.2f}", ha="center", va="bottom", fontsize=8)
        ax.annotate(DISCLAIMER, xy=(0.5, -0.32), xycoords="axes fraction",
                    ha="center", fontsize=7, color="#555555")
        fig.tight_layout()
        p = os.path.join(output_dir, f"{prefix}_{name}.png")
        fig.savefig(p, dpi=130, bbox_inches="tight")
        plt.close(fig)
        paths.append(p)

    return paths
