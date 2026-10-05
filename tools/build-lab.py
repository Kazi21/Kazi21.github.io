#!/usr/bin/env python3
"""Build lab/cnt/index.html (Simulation Lab, stage 1: CNT trajectory inspector) from lab/cnt/data/manifest.json.
Usage (from the repository root): python3 tools/build-lab.py
The system table and the method line are filled from the manifest, so the page reads fully without JavaScript."""
import json, os, html

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAB = os.path.join(ROOT, "lab", "cnt")
WEBSITE_VERSION = "2026.1"

man = json.load(open(os.path.join(LAB, "data", "manifest.json")))
tubes = man["tubes"]
m0 = tubes[0]["method"]
for t in tubes[1:]:
    assert t["method"] == m0, "method settings differ between tubes; the page states one method line"


def fmt_ps(x):
    return f"{x:.2f}".rstrip("0").rstrip(".") if x < 1 else f"{x:.3g}"


def sig3(x):
    return f"{x:#.3g}"


rows = "\n".join(
    f"          <tr><td>{t['label']}</td><td>{sig3(t['diameter_nm'])}</td><td>{t['n_water']}</td><td>{t['n_na']}</td>"
    f"<td>{t['n_cl']}</td><td>{t['n_c']}</td><td>{sig3(t['run_length_ps'])}</td><td>{t['n_frames']}</td></tr>"
    for t in tubes)
run_lengths = sorted({t["run_length_ps"] for t in tubes})
run_span = f"{fmt_ps(run_lengths[0])}–{fmt_ps(run_lengths[-1])} ps" if len(run_lengths) > 1 else f"{fmt_ps(run_lengths[0])} ps"
spacing = sorted({t["frame_spacing_fs"] for t in tubes})
spacing_txt = f"{spacing[0]:g} fs" if len(spacing) == 1 else "/".join(f"{s:g}" for s in spacing) + " fs"
basis = (" and ".join(m0["basis"]) + (" basis sets" if len(m0["basis"]) > 1 else " basis")) if m0["basis"] else "MOLOPT basis"
pp = "GTH pseudopotentials" if all(p.startswith("GTH") for p in m0["pseudopotentials"]) else ", ".join(m0["pseudopotentials"])
disp = m0["dispersion"].replace("DFTD3(BJ)", "D3(BJ)").replace("DFTD3", "D3")
method = (f"{html.escape(m0['code'])} (Quickstep, GPW): {m0['xc']} with {disp} dispersion, {basis}, {pp}, "
          f"{m0['cutoff_Ry']} Ry cutoff ({m0['rel_cutoff_Ry']} Ry relative), {m0['ensemble']} at {m0['T_K']:g} K "
          f"with a {m0['dt_fs']:g} fs time step.")
length_nm = tubes[0]["length_nm"]
vac = sorted({round(t["cell_A"][0] - t["diameter_nm"] * 10, 1) for t in tubes})
vac_txt = f"about {vac[0] / 10:.3g} nm" if vac[-1] - vac[0] < 0.2 else f"{vac[0] / 10:.3g}–{vac[-1] / 10:.3g} nm"
stretch = [t for t in tubes if t.get("frames_with_irregular_water")]
stretch_txt = " ".join(
    f"In {t['frames_with_irregular_water']} frames of the {t['label']} run one O–H bond briefly stretches to {t['max_oh_nm']:.3g} nm; it is shown as recorded."
    for t in stretch)
banner = ('<p class="insp-test-banner">TEST DATA: synthetic placeholder trajectories, not simulation results. Do not publish.</p>\n    '
          if man.get("synthetic") else "")
if banner:
    print("WARNING: synthetic test data; this page must not be published")

page = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CNT trajectory inspector — Kazi Ehsanul Karim</title>
<meta name="description" content="Interactive viewer of ab initio molecular dynamics of NaCl–water inside four armchair carbon nanotubes, (6,6) to (11,11): rotate, play and inspect atoms. Simulation Lab, stage 1, by Kazi Ehsanul Karim.">
<meta name="robots" content="index,follow">
<meta property="og:title" content="CNT trajectory inspector — Kazi Ehsanul Karim">
<meta property="og:description" content="Rotate, play and inspect ab initio MD of NaCl–water in four carbon nanotubes.">
<meta property="og:image" content="../../assets/icons/og-image.png">
<link rel="icon" type="image/svg+xml" href="../../assets/icons/favicon.svg">
<meta name="theme-color" content="#0d1b2a">
<link rel="stylesheet" href="../../styles/tokens.css">
<link rel="stylesheet" href="../../styles/layout.css">
<link rel="stylesheet" href="../../styles/components.css">
<link rel="stylesheet" href="inspector.css">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="container">
    <a class="brand" href="../../index.html">Kazi Ehsanul Karim</a>
    <nav class="site-nav" aria-label="Sections">
      <a href="../../index.html#projects">Research Projects</a>
      <a href="../../index.html#practice">Research in Practice</a>
      <a href="../../index.html#lab" aria-current="true">Simulation Lab</a>
      <a href="../../index.html#contact">Contact</a>
    </nav>
  </div>
</header>
<main id="main">

<section class="section insp-top" id="top">
  <div class="container">
    {banner}<p class="project-kicker">Simulation Lab · stage 1 (available) · ab initio MD (CP2K)</p>
    <h1 class="evidence-title insp-title">Four confined electrolytes, atom by atom</h1>
    <p class="insp-lede">Rotate, play and inspect NaCl–water inside four armchair carbon nanotubes; click any atom to read where it sits and how it is bonded.</p>

    <div id="inspector" class="inspector" data-src="data/" data-default="cnt_11_11">
      <div class="insp-stage">
        <canvas class="insp-canvas" tabindex="0" role="img" aria-label="Molecular view of a carbon nanotube trajectory"></canvas>
        <p class="insp-status" role="status">Loading…</p>
        <noscript><p class="insp-noscript">The inspector needs JavaScript. The table below lists the four systems.</p></noscript>
        <ul class="insp-legend">
          <li><i style="background:#8c8c8c"></i>Carbon</li>
          <li><i style="background:#e03030"></i>Oxygen</li>
          <li><i style="background:#f2f4f7"></i>Hydrogen</li>
          <li><i style="background:#a05cc8"></i>Na⁺</li>
          <li><i style="background:#2ecc40"></i>Cl⁻</li>
        </ul>
        <p class="insp-help">Drag to rotate · scroll or pinch to zoom · click an atom to inspect it · Space plays or pauses, ← and → step one frame.</p>
        <section class="insp-tour" aria-labelledby="insp-tour-h">
          <h2 id="insp-tour-h" class="insp-tour-h">What to look for</h2>
          <ul>
            <li><b>Water reorients at each ion.</b> In the narrow tubes, water on either side of an ion points opposite ways: hydrogens towards Cl⁻, away from Na⁺.
              <span class="insp-tour-btns"><button type="button" class="btn btn-small" data-preset='{{"tube":"cnt_7_7","view":"side","dip":true,"hb":false,"pbc":false}}'>Show in (7,7)</button></span></li>
            <li><b>Confinement thins the hydration shell.</b> Fewer water molecules fit around an ion in the narrowest tube. Compare the hydration count of Na⁺:
              <span class="insp-tour-btns"><button type="button" class="btn btn-small" data-preset='{{"tube":"cnt_6_6","view":"side","dip":false,"hb":false,"pbc":false,"select":"N"}}'>Na⁺ in (6,6)</button><button type="button" class="btn btn-small" data-preset='{{"tube":"cnt_11_11","view":"side","dip":false,"hb":false,"pbc":false,"select":"N"}}'>Na⁺ in (11,11)</button></span></li>
            <li><b>From a single file to shells.</b> Looking down the axis, water forms a single file in (6,6) and a shell along the wall with a core on the axis in (11,11).
              <span class="insp-tour-btns"><button type="button" class="btn btn-small" data-preset='{{"tube":"cnt_6_6","view":"axial","dip":false,"hb":false,"pbc":false}}'>(6,6) down the axis</button><button type="button" class="btn btn-small" data-preset='{{"tube":"cnt_11_11","view":"axial","dip":false,"hb":false,"pbc":false}}'>(11,11) down the axis</button></span></li>
          </ul>
        </section>
      </div>

      <div class="insp-panel">
        <div class="insp-tubes" role="group" aria-label="Nanotube"></div>
        <dl class="insp-facts"></dl>
        <div class="insp-transport">
          <button class="btn btn-primary btn-small insp-play" type="button">Play</button>
          <label class="visually-hidden" for="insp-frame">Frame</label>
          <input id="insp-frame" class="insp-slider" type="range" min="0" max="0" value="0" step="1">
          <output class="insp-time" for="insp-frame">t = 0 fs</output>
          <label class="visually-hidden" for="insp-speed">Playback speed</label>
          <select id="insp-speed" class="insp-speed">
            <option value="0.25">¼×</option><option value="0.5">½×</option><option value="1" selected>1×</option><option value="2">2×</option>
          </select>
        </div>
        <div class="insp-views" role="group" aria-label="View">
          <span class="insp-views-label">View</span>
          <button type="button" class="btn btn-small insp-view-side">Side</button>
          <button type="button" class="btn btn-small insp-view-axial">Down the axis</button>
          <button type="button" class="btn btn-small insp-view-reset">Reset</button>
        </div>
        <fieldset class="insp-options">
          <legend>Show</legend>
          <label><input type="checkbox" id="insp-cut" checked> Cut away the front wall</label>
          <label><input type="checkbox" id="insp-hb"> Hydrogen bonds</label>
          <label><input type="checkbox" id="insp-dip"> Colour water by orientation</label>
          <label><input type="checkbox" id="insp-pbc"> Periodic copies along the axis</label>
        </fieldset>
        <div class="insp-dipole-legend" hidden>
          <div class="insp-dipole-bar"></div>
          <p class="insp-dipole-title">H–O–H bisector relative to the tube axis</p>
          <div class="insp-dipole-labels"><span>along −axis</span><span>perpendicular</span><span>along +axis</span></div>
        </div>
        <section class="insp-info" aria-live="polite" aria-labelledby="insp-info-h">
          <h2 id="insp-info-h" class="insp-info-h">Selected atom</h2>
          <div class="insp-info-body"><p>Click any atom to inspect it.</p></div>
          <button type="button" class="btn-link insp-clear" hidden>Clear selection</button>
        </section>
      </div>
    </div>
  </div>
</section>

<section class="section section-band" id="about">
  <div class="container">
    <h2>What you are looking at</h2>
    <p class="section-intro">Each system is a periodic {length_nm:.3g} nm segment of an armchair carbon nanotube holding water and one or two Na⁺–Cl⁻ pairs. The trajectories are the short ab initio runs ({run_span}) that started the machine-learned-potential campaign of Project 2. They show local structure, hydration and thermal motion; they are too short for diffusion or transport, and no machine-learned model is involved.</p>
    <div class="insp-table-wrap">
      <table class="runtable insp-table">
        <caption class="visually-hidden">The four simulated systems</caption>
        <thead><tr><th>Tube</th><th>Diameter (nm)</th><th>Water</th><th>Na⁺</th><th>Cl⁻</th><th>Carbon atoms</th><th>Run length (ps)</th><th>Frames shown</th></tr></thead>
        <tbody>
{rows}
        </tbody>
      </table>
    </div>
    <p class="agent-note">Method: {method} The cell is periodic in all three directions, with {vac_txt} of vacuum between the walls of neighbouring tube images. Positions are shown every {spacing_txt}. For display, each tube is centred, every water is made whole across the periodic boundary, and the view is orthographic. Diameters are twice the mean carbon distance from the axis over the frames shown. {stretch_txt}</p>

    <h3 class="insp-h3" id="readouts">How the readouts are computed</h3>
    <ul class="insp-defs">
      <li><b>Distance from the axis</b> radial distance from the line through the carbon centroid of the tube.</li>
      <li><b>Orientation</b> angle between the H–O–H bisector (the vector from O to the midpoint of its two H) and the tube axis; 0° points along +axis. This is a geometric orientation, not the electronic dipole, which would require the electron density.</li>
      <li><b>Hydrogen bond</b> O···O distance below 0.35 nm and H–O···O angle below 30°, a common geometric criterion.</li>
      <li><b>Hydration count</b> water oxygens within 0.32 nm of Na⁺ or 0.38 nm of Cl⁻, approximate first-shell radii from bulk solution.</li>
      <li><b>Nearest wall carbon</b> shortest distance to any carbon of the tube, using the periodic image along the axis.</li>
    </ul>
  </div>
</section>

<section class="section" id="next">
  <div class="container">
    <h2>Next stages</h2>
    <ul class="worklist">
      <li><span class="status status-proposed">Planned</span><span><b>Molecular interaction in one tube.</b> Move or rotate a molecule and see which neighbours' forces change, then watch the liquid respond.</span></li>
      <li><span class="status status-proposed">Planned</span><span><b>Reference-guided learning.</b> A learned model checked against reference calculations, with errors resolved by species and environment and each next calculation chosen for a stated reason.</span></li>
    </ul>
    <p><a href="../../index.html#lab">Back to the Simulation Lab</a></p>
    <p class="agent-note">Trajectory data © Kazi Ehsanul Karim, shown for viewing and not licensed for reuse. The viewer code is MIT-licensed, like the rest of the website code.</p>
  </div>
</section>
</main>
<footer class="site-footer">
  <div class="container footer-grid">
    <div><p class="version">Simulation Lab, stage 1. Website version {WEBSITE_VERSION}.</p></div>
    <div><p>Viewer code: MIT. Trajectory data and text: © Kazi Ehsanul Karim; see NOTICE.md in the repository.</p></div>
    <div><p>This page makes no third-party requests, sets no cookies and runs no analytics. It loads only its own data files.</p></div>
  </div>
</footer>
<script src="inspector.js"></script>
</body>
</html>
"""
open(os.path.join(LAB, "index.html"), "w").write(page)
print("wrote lab/cnt/index.html")
