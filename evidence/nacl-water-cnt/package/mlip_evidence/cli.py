"""
Command-line interface for mlip_evidence.

Subcommands (all write to explicit --out paths; none touch campaign artifacts):
  summarize-protocol  parse a CP2K input -> protocol JSON
  compare-protocol    compare two protocol JSONs
  force-metrics       per-species force metrics from a synthetic .npz fixture
  interval            group-aware bootstrap CI from a synthetic records JSON
  decide              run the workflow-controller on an evidence JSON
  figures             render validation figures from a metrics JSON
  demo                run the full synthetic pipeline end to end

All numeric inputs are synthetic fixtures unless a real, cleared file is supplied.
"""
import argparse
import json
import os
import numpy as np

from . import (summarize_reference_protocol, compare_reference_protocols,
               force_metrics, estimate_metric_interval, recommend_next_action,
               write_validation_figures)
from .decision import DEFAULT_POLICY


def _load_npz(path):
    d = np.load(path, allow_pickle=False)   # never unpickle
    return {k: d[k] for k in d.files}


def _dump(obj, out):
    if out:
        os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
        with open(out, "w") as fh:
            json.dump(obj, fh, indent=2)
    print(json.dumps(obj, indent=2))


def main(argv=None):
    ap = argparse.ArgumentParser(prog="mlip_evidence", description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("summarize-protocol"); p.add_argument("input"); p.add_argument("--out")
    p = sub.add_parser("compare-protocol")
    p.add_argument("training"); p.add_argument("validation"); p.add_argument("--out")
    p = sub.add_parser("force-metrics")
    p.add_argument("npz"); p.add_argument("--out")
    p = sub.add_parser("interval")
    p.add_argument("records"); p.add_argument("--metric", required=True)
    p.add_argument("--group-key", default="group"); p.add_argument("--block-ps", type=float)
    p.add_argument("--confidence", type=float, default=0.95)
    p.add_argument("--n-bootstrap", type=int, default=2000)
    p.add_argument("--seed", type=int, default=20260906); p.add_argument("--out")
    p = sub.add_parser("decide"); p.add_argument("evidence"); p.add_argument("--out")
    p = sub.add_parser("figures")
    p.add_argument("metrics"); p.add_argument("--out-dir", required=True)
    p = sub.add_parser("demo"); p.add_argument("--out-dir", required=True)

    a = ap.parse_args(argv)

    if a.cmd == "summarize-protocol":
        _dump(summarize_reference_protocol(a.input, a.out), None)
    elif a.cmd == "compare-protocol":
        t = json.load(open(a.training)); v = json.load(open(a.validation))
        _dump(compare_reference_protocols(t, v), a.out)
    elif a.cmd == "force-metrics":
        d = _load_npz(a.npz)
        rep = force_metrics(d["reference"], d["prediction"], d["species"],
                            frame_ids=d.get("frame_ids"),
                            expected_species=d.get("expected_species"))
        _dump(rep, a.out)
    elif a.cmd == "interval":
        records = json.load(open(a.records))
        _dump(estimate_metric_interval(records, a.metric, group_key=a.group_key,
                                       block_ps=a.block_ps, confidence=a.confidence,
                                       n_bootstrap=a.n_bootstrap, seed=a.seed), a.out)
    elif a.cmd == "decide":
        ev = json.load(open(a.evidence))
        _dump(recommend_next_action(ev, DEFAULT_POLICY), a.out)
    elif a.cmd == "figures":
        rep = json.load(open(a.metrics))
        paths = write_validation_figures(rep, a.out_dir)
        _dump({"figures": paths}, None)
    elif a.cmd == "demo":
        from examples.synthetic.make_fixture import run_demo
        run_demo(a.out_dir)


if __name__ == "__main__":
    main()
