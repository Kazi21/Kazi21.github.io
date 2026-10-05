#!/usr/bin/env python3
"""Build the public evidence pages for the NaCl–water–CNT MLIP methods package.

Reads  evidence/nacl-water-cnt/package/   (the package files, verbatim)
       evidence/nacl-water-cnt/executed/  (outputs of the documented example runs)
Writes evidence/nacl-water-cnt/index.html and evidence/nacl-water-cnt/source.html

Requires pandoc (Markdown → HTML). Run from the repository root:
    python3 tools/build-evidence.py
Nothing here computes a scientific result; the page only presents the package
and the outputs of its own synthetic examples, labelled as such.
"""
import html
import json
import os
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EV = os.path.join(ROOT, "evidence", "nacl-water-cnt")
PKG = os.path.join(EV, "package")
EXE = os.path.join(EV, "executed")

EXECUTED_ON = "30 September 2026"
ENV = "Python 3.11.15, NumPy 2.4.4, Matplotlib 3.10.9 (Linux)"
DOWNLOAD = "../../assets/downloads/NaCl_Water_CNT_Website_Evidence_v0.1.1.zip"
PACKAGE_VERSION = "0.1.1"

SYNTHETIC = "Synthetic software demonstration; not a DFT, MLIP-accuracy or transport result."
PROVENANCE = ("Analysis code drafted with AI assistance and checked against raw outputs; "
              "scientific decisions and validation design are the author's. See NOTICE.")


def md(path):
    out = subprocess.run(["pandoc", "-f", "gfm", "-t", "html5", "--no-highlight", path],
                         check=True, capture_output=True, text=True).stdout
    # ids that start with a digit (pandoc's GitHub-style slugs) get an "s" prefix
    return re.sub(r'id="(\d)', r'id="s\1', out)


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


HEAD = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta name="robots" content="index,follow">
<link rel="icon" type="image/svg+xml" href="../../assets/icons/favicon.svg">
<meta name="theme-color" content="#0d1b2a">
<link rel="stylesheet" href="../../styles/tokens.css">
<link rel="stylesheet" href="../../styles/layout.css">
<link rel="stylesheet" href="../../styles/components.css">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="container">
    <a class="brand" href="../../index.html">Kazi Ehsanul Karim</a>
    <nav class="site-nav" aria-label="Sections">
      <a href="../../index.html#projects">Research Projects</a>
      <a href="../../index.html#practice">Research in Practice</a>
      <a href="../../index.html#lab">Simulation Lab</a>
      <a href="../../index.html#contact">Contact</a>
    </nav>
  </div>
</header>
<main id="main">
"""

FOOT = """</main>
<footer class="site-footer">
  <div class="container footer-grid">
    <div><p class="version">Evidence pages built from NaCl_Water_CNT_Website_Evidence v0.1.1 (complete package). Website version 2026.1.</p></div>
    <div><p>Tooling in the package: MIT. Package documentation and this page: © Kazi Ehsanul Karim; see the package NOTICE.</p></div>
    <div><p>This page makes no third-party requests, sets no cookies and runs no analytics.</p></div>
  </div>
</footer>
</body>
</html>
"""

SRC_FILES = [
    "mlip_evidence/__init__.py", "mlip_evidence/constants.py", "mlip_evidence/reference_protocol.py",
    "mlip_evidence/frame_mapping.py", "mlip_evidence/metrics.py", "mlip_evidence/uncertainty.py",
    "mlip_evidence/decision.py", "mlip_evidence/figures.py", "mlip_evidence/release.py",
    "mlip_evidence/cli.py", "tests/test_mlip_evidence.py", "examples/synthetic/make_fixture.py",
    "examples/synthetic/example_evidence.json", "examples/synthetic/example_cp2k.inp",
    "website/evidence_cards.json", "MANIFEST.json", "LICENSE",
]


def anchor(path):
    return path.replace("/", "-").replace(".", "-")


def build_index():
    cards = json.load(open(os.path.join(PKG, "website", "evidence_cards.json")))
    summary = json.load(open(os.path.join(EXE, "SUMMARY.json")))
    decision = json.load(open(os.path.join(EXE, "decide_example_evidence.json")))   # `cli decide` on example_evidence.json
    interval = json.load(open(os.path.join(EXE, "interval.json")))
    proto = json.load(open(os.path.join(EXE, "summarize_protocol_example_cp2k.json")))   # `cli summarize-protocol` on example_cp2k.inp
    comp = json.load(open(os.path.join(EXE, "compare_protocol_demo.json")))   # `cli compare-protocol`: sample vs a copy with CUTOFF 300

    link_map = {
        "../METHODS.md#1-reference-protocol-compatibility-cp2k": ("#s1-reference-protocol-compatibility-cp2k", "Methods §1"),
        "../METHODS.md#3-per-species-force-metrics-explicit-definitions": ("#s3-per-species-force-metrics-explicit-definitions", "Methods §3"),
        "../METHODS.md#6-decision-logic-workflow-controller-prototype": ("#s6-decision-logic-workflow-controller-prototype", "Methods §6"),
        "../mlip_evidence/reference_protocol.py": ("source.html#" + anchor("mlip_evidence/reference_protocol.py"), "reference_protocol.py"),
        "../mlip_evidence/metrics.py": ("source.html#" + anchor("mlip_evidence/metrics.py"), "metrics.py"),
        "../mlip_evidence/uncertainty.py": ("source.html#" + anchor("mlip_evidence/uncertainty.py"), "uncertainty.py"),
        "../mlip_evidence/decision.py": ("source.html#" + anchor("mlip_evidence/decision.py"), "decision.py"),
        "../examples/synthetic/example_evidence.json": ("source.html#" + anchor("examples/synthetic/example_evidence.json"), "example_evidence.json"),
        "../examples/synthetic/example_cp2k.inp": ("source.html#" + anchor("examples/synthetic/example_cp2k.inp"), "example_cp2k.inp"),
    }

    card_html = []
    for c in cards["cards"]:
        badge_cls = "badge badge-exec" if c["status"] == "EXECUTED_EXAMPLE" else "badge badge-proto"
        links = []
        for l in c["evidence_links"]:
            href, label = link_map.get(l, (None, l))
            links.append(f'<a href="{href}">{html.escape(label)}</a>' if href else f'<span class="pending">{html.escape(label)}</span>')
        card_html.append(f"""
      <article class="ecard" id="{c['id']}">
        <p class="project-kicker">{html.escape(c['title'])}</p>
        <h3>{html.escape(c['question'])}</h3>
        <p><span class="{badge_cls}">{html.escape(c['status'])}</span></p>
        <dl class="project-dl">
          <dt>What the tooling does</dt><dd>{html.escape(c['contribution'])}</dd>
          <dt>Data origin</dt><dd>{html.escape(c['data_origin'])}</dd>
          <dt>What was executed</dt><dd>{html.escape(c['what_was_executed'])}</dd>
          <dt>Limitation</dt><dd class="limitation">{html.escape(c['limitation'])}</dd>
          <dt>Next step</dt><dd>{html.escape(c['next_step'])}</dd>
          <dt>Inspect</dt><dd>{' · '.join(links)}</dd>
        </dl>
      </article>""")

    weak = summary["weak_channel_visible"]
    weak_rows = "".join(f"<tr><td>{html.escape(s)}</td><td>{v:.3f}</td></tr>" for s, v in weak.items())
    reasons = "".join(f"<li>{html.escape(r)}</li>" for r in decision["reasons"])

    body = f"""
<section class="section" id="top">
  <div class="container">
    <p class="project-kicker">Research in Practice · evidence</p>
    <h1 class="evidence-title">Error-aware MLIPs for confined electrolytes: methods and software demonstration</h1>
    <p class="statement">Runnable tooling and synthetic fixtures that show how the CNT-confined NaCl–water MLIP work checks its references, exposes per-species errors and chooses the next calculation.</p>
    <p><span class="badge badge-label">Methods and software demonstration · synthetic example data</span></p>
    <p class="section-intro">{html.escape(cards['disclaimer'])}</p>
    <p class="section-intro">{html.escape(PROVENANCE)}</p>
    <ul class="links">
      <li><a href="{DOWNLOAD}" download>Download the package (zip, 29 files)</a></li>
      <li><a href="source.html">Browse the source</a></li>
      <li><a href="package/README.md">README</a></li>
      <li><a href="package/NOTICE.md">NOTICE</a></li>
      <li><a href="package/LICENSE">LICENSE</a></li>
      <li><a href="package/MANIFEST.json">MANIFEST</a></li>
    </ul>
    <p class="agent-note">Complete package, version {PACKAGE_VERSION}: the 28 files listed in MANIFEST.json plus the manifest itself, identical to the download. Version {PACKAGE_VERSION} (30 September 2026) revises the synthetic example fixtures and adds the sample CP2K input, the workflow schematic and the licence file; the tooling code is unchanged apart from its version string.</p>
  </div>
</section>

<section class="section section-band" id="executed">
  <div class="container">
    <h2>What was executed for this page</h2>
    <p class="section-intro">The package's documented commands were run on {EXECUTED_ON} in a clean environment ({ENV}). Every number below comes from the package's synthetic fixtures. {html.escape(SYNTHETIC)}</p>
    <table class="runtable">
      <thead><tr><th>Command (from the package README)</th><th>Outcome</th></tr></thead>
      <tbody>
        <tr><td><code>python tests/test_mlip_evidence.py</code></td><td><span class="badge badge-exec">13 passed, 0 failed</span> (the count the README specifies)</td></tr>
        <tr><td><code>python -m examples.synthetic.make_fixture demo_out</code></td><td>Wrote metrics.json, interval.json, decision.json, SUMMARY.json and two figures. Aggregate component RMSE {summary['overall_component_rmse']:.3f} (synthetic values) while the deliberately weak synthetic channel <code>X</code> shows {weak['X']:.2f}; bootstrap interval status <code>{interval['status']}</code> over {interval['n_groups']} synthetic replicas; decision <code>{summary['decision_action']}</code>.</td></tr>
        <tr><td><code>python -m mlip_evidence.cli decide examples/synthetic/example_evidence.json</code></td><td>Action <code>{decision['action']}</code>, policy <code>{decision['policy_version']}</code>; reasons listed below.</td></tr>
        <tr><td><code>python -m mlip_evidence.cli summarize-protocol examples/synthetic/example_cp2k.inp</code></td><td><span class="badge badge-exec">parsed</span> Run type <code>{proto['run_type']}</code>; {proto['xc_functional']} with {proto['vdw_type']}; grid cutoff {proto['cutoff_Ry']:.0f} Ry, relative cutoff {proto['rel_cutoff_Ry']:.0f} Ry; {proto['smear_method'].replace('_', '–').title()} smearing at {proto['electronic_temperature_K']:.0f} K with {proto['added_mos']} added orbitals; {proto['stress_tensor'].lower()} stress; periodic {proto['poisson_periodic']}. Raw output: <a href="executed/summarize_protocol_example_cp2k.json">summarize_protocol_example_cp2k.json</a>. The input is a real protocol template with placeholder cell and coordinates, not a campaign data file.</td></tr>
        <tr><td><code>python -m mlip_evidence.cli compare-protocol</code> on the sample's summary and on a copy with the grid cutoff lowered to 300 Ry (also run for this page)</td><td><span class="badge badge-exec">compatible: {str(comp['compatible']).lower()}</span> The 400 Ry versus 300 Ry grid cutoff is flagged as a material mismatch; {comp['n_matched']} other parameters match. Raw output: <a href="executed/compare_protocol_demo.json">compare_protocol_demo.json</a>.</td></tr>
      </tbody>
    </table>
    <div class="grid-2" style="margin-top: var(--space-4)">
      <div>
        <h3>Per-channel component RMSE, synthetic fixture</h3>
        <table class="runtable"><thead><tr><th>Channel (generic label)</th><th>component RMSE (synthetic)</th></tr></thead><tbody>{weak_rows}</tbody></table>
        <p class="agent-note">The aggregate looks acceptable; the per-species table exposes the weak minority channel. Raw outputs of the demo: <a href="executed/SUMMARY.json">SUMMARY.json</a> · <a href="executed/metrics.json">metrics.json</a> · <a href="executed/interval.json">interval.json</a> · <a href="executed/decision.json">decision.json</a>; of the <code>decide</code> command: <a href="executed/decide_example_evidence.json">decide_example_evidence.json</a>.</p>
      </div>
      <div>
        <h3>Decision returned for the example evidence</h3>
        <p><code>{decision['action']}</code></p>
        <ul>{reasons}</ul>
        <p class="agent-note">A rules-based prototype: it maps stated evidence and declared thresholds to one action and its reasons. It launches nothing and makes no cost or time-savings claim.</p>
      </div>
    </div>
    <div class="grid-2" style="margin-top: var(--space-4)">
      <figure class="evfig"><img src="executed/validation_component_rmse.png" alt="Bar chart of per-species component force RMSE from the synthetic fixture (generic channels A, B and X, not chemical elements); the X bar is highlighted as the weak channel." loading="lazy"><figcaption>{html.escape(SYNTHETIC)}</figcaption></figure>
      <figure class="evfig"><img src="executed/validation_vector_p95.png" alt="Bar chart of per-species 95th-percentile vector force error from the synthetic fixture; the X bar is highlighted." loading="lazy"><figcaption>{html.escape(SYNTHETIC)}</figcaption></figure>
    </div>
  </div>
</section>

<section class="section" id="cards">
  <div class="container">
    <h2>Three entry points</h2>
    <p class="section-intro">The same three steps that the Research in Practice walkthrough describes, each with its status, its limitation and the code to inspect.</p>
    <div class="projects">{''.join(card_html)}
    </div>
  </div>
</section>

<section class="section section-band" id="workflow">
  <div class="container">
    <h2>Workflow and status</h2>
    <p class="section-intro">The package's workflow schematic and its text description. Solid boxes are implemented, dashed boxes are proposed. A schematic of methods and status, not a data figure.</p>
    <figure class="evfig evfig-wide"><img src="package/website/workflow.svg" width="960" height="460" alt="Workflow schematic of the error-aware MLIP methods: implemented pipeline stages, the decision loop back to targeted labelling, and two proposed extensions. The full text description follows." loading="lazy"><figcaption>Schematic of methods and status; no data values. <a href="package/website/workflow.svg">Open the SVG</a>.</figcaption></figure>
    <div class="doc">{md(os.path.join(PKG, 'website', 'workflow_alt.md'))}</div>
  </div>
</section>

<section class="section" id="project">
  <div class="container">
    <h2>Project write-up</h2>
    <p class="section-intro">The package's own project description. Statements about the private campaign are the author's account; no campaign numbers or models are published, and the four AIMD position trajectories are shown separately in the <a href="../../lab/cnt/">Simulation Lab</a>.</p>
    <div class="doc">{md(os.path.join(PKG, 'website', 'MLIP_PROJECT.md'))}</div>
  </div>
</section>

<section class="section section-band" id="docs">
  <div class="container">
    <h2>Methods, scope, walkthrough and provenance</h2>
    <details class="disclosure" open><summary>Methods (METHODS.md)</summary><div class="disclosure-body doc">{md(os.path.join(PKG, 'METHODS.md'))}</div></details>
    <details class="disclosure"><summary>Model scope (MODEL_SCOPE.md)</summary><div class="disclosure-body doc">{md(os.path.join(PKG, 'MODEL_SCOPE.md'))}</div></details>
    <details class="disclosure"><summary>Two-minute reviewer walkthrough (PI_WALKTHROUGH.md)</summary><div class="disclosure-body doc">{md(os.path.join(PKG, 'PI_WALKTHROUGH.md'))}</div></details>
    <details class="disclosure"><summary>Package README</summary><div class="disclosure-body doc">{md(os.path.join(PKG, 'README.md'))}</div></details>
    <details class="disclosure"><summary>Attribution and provenance (NOTICE.md)</summary><div class="disclosure-body doc">{md(os.path.join(PKG, 'NOTICE.md'))}</div></details>
  </div>
</section>
"""
    page = HEAD.format(title="Error-aware MLIPs: methods and software demonstration — Kazi Ehsanul Karim",
                       desc="Runnable methods tooling with synthetic fixtures for the CNT-confined NaCl–water MLIP work of Kazi Ehsanul Karim: reference-protocol checking, per-species force diagnostics, group-aware uncertainty and a rules-based decision prototype. Synthetic example data; no campaign results.") + body + FOOT
    with open(os.path.join(EV, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(page)


def build_source():
    blocks = []
    toc = []
    for rel in SRC_FILES:
        p = os.path.join(PKG, rel)
        code = html.escape(read(p))
        a = anchor(rel)
        toc.append(f'<li><a href="#{a}">{html.escape(rel)}</a></li>')
        blocks.append(f"""
    <article class="srcfile" id="{a}">
      <h2>{html.escape(rel)} <a class="rawlink" href="package/{html.escape(rel)}">raw</a></h2>
      <pre class="contract srccode">{code}</pre>
    </article>""")
    body = f"""
<section class="section" id="top">
  <div class="container">
    <p class="project-kicker">Research in Practice · evidence · source</p>
    <h1 class="evidence-title">Source of the methods package</h1>
    <p class="section-intro">The package's Python modules, tests and fixtures, shown verbatim for inspection. Tooling is MIT-licensed; {html.escape(PROVENANCE)} <a href="index.html">Back to the evidence overview</a>.</p>
    <ul class="links">{''.join(toc)}</ul>
  </div>
</section>
<section class="section section-band">
  <div class="container">{''.join(blocks)}
  </div>
</section>
"""
    page = HEAD.format(title="Methods package source — Kazi Ehsanul Karim",
                       desc="Verbatim source of the mlip_evidence methods package: reference-protocol parser, frame-mapping and leakage checks, per-species force metrics, group-aware bootstrap, rules-based decision prototype, release builder, tests and synthetic fixtures.") + body + FOOT
    with open(os.path.join(EV, "source.html"), "w", encoding="utf-8") as fh:
        fh.write(page)


if __name__ == "__main__":
    build_index()
    build_source()
    print("wrote evidence/nacl-water-cnt/index.html and source.html")
