// build_page.js — builds lab/continuum/index.html from tools/continuum/page.template.html:
// pre-renders the equations with KaTeX (the page never loads katex.js), inserts the scale diagram, and writes the
// validation table from the machine-readable results in tools/continuum/results/ with the criteria parsed from
// tools/continuum/TOLERANCES.md (single source). Tests without a result are listed as NOT_RUN.
// Usage (repository root):  NODE_PATH=<dir with katex> node tools/continuum/build_page.js
'use strict';
const fs = require('fs'), path = require('path');
const katex = require('katex');
const ROOT = path.resolve(__dirname, '../..');
const VERSION = '2026.8';
const T = (f) => path.join(ROOT, 'tools/continuum', f);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(T(f), 'utf8')); } catch (e) { return null; } };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sci3 = (x) => { const [m, e] = x.toExponential(2).split('e'); return m + ' × 10' + String(Number(e)).split('').map((ch) => SUP[ch]).join(''); };
/* mesh table of every allowed size (lab/continuum/data/mesh-check.json): largest standard-vs-fine change of Q and largest chamber share */
const MESH = (() => {
  try {
    const e = Object.values(JSON.parse(fs.readFileSync(path.join(ROOT, 'lab/continuum/data/mesh-check.json'), 'utf8')).entries);
    return { n: e.length, maxRel: Math.max(...e.map((x) => x.rel)), maxChamber: Math.max(...e.map((x) => 1 - x.membraneShare20)) };
  } catch (err) { return null; }
})();

const EQ = {
  EQ_STOKES: String.raw`\nabla\cdot\mathbf u=0,\qquad -\nabla p+\mu\,\nabla^{2}\mathbf u=\mathbf 0\quad\text{in the feed and permeate chambers}`,
  EQ_INTERFACE: String.raw`\mathbf u_{\mathrm f}\cdot\mathbf n=\mathbf u_{\mathrm p}\cdot\mathbf n=J_c,\qquad \Pi_{\mathrm f}-\Pi_{\mathrm p}=R_{s,c}\,J_c,\qquad \Pi=-\mathbf n\cdot\boldsymbol\sigma\cdot\mathbf n,\quad \boldsymbol\sigma=-p\,\mathbf I+\mu\left(\nabla\mathbf u+\nabla\mathbf u^{\mathsf T}\right)`,
  EQ_PORELAW: String.raw`q_i=G_i\,\Delta\Pi_c,\qquad S_c=\sum_{i\in c}G_i,\qquad R_{s,c}=\frac{A_c}{S_c},\qquad J_c=\frac{S_c\,\Delta\Pi_c}{A_c},\qquad Q=\sum_c A_c\,J_c`,
  EQ_SCOPE: String.raw`G_i=G_0\,F_{\mathrm{membrane}}\,F_{\mathrm{patch}(c)}\,F_i`,
  EQ_ENERGY: String.raw`\Delta P\,Q=\Phi_{\mathrm v}+\sum_c A_c R_{s,c}J_c^{2},\qquad R_{\mathrm{ch}}=\frac{\Phi_{\mathrm v}}{Q^{2}},\qquad R_{\mathrm m}=\frac{\sum_c A_c R_{s,c}J_c^{2}}{Q^{2}}`,
  EQ_SENS: String.raw`\frac{\partial Q}{\partial S_c}=\frac{\Delta\Pi_c^{2}}{\Delta P}`,
  EQ_NET: String.raw`Q_{\mathrm{net}}=\frac{\Delta P}{R_{\mathrm{ch}}+R_{\mathrm{pore}}/N}`,
  EQ_CROSS: String.raw`q=\frac{m_{\mathrm w}\,\left(N_{\to}-N_{\leftarrow}\right)}{\rho_{\mathrm{ref}}\,\Delta t}`,
};

const DIAGRAM = `<svg class="cl-diagram" viewBox="0 0 860 250" role="img" aria-label="Information flow between the scales: the pore law and pore counts give face conductance sums; the continuum solver returns the local driving potential of each face, which gives the flow through one tube.">
  <defs><marker id="clArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#16324F"/></marker></defs>
  <g font-family="IBM Plex Sans, system-ui, sans-serif" font-size="13" fill="#243447">
    <rect x="10" y="40" width="230" height="130" rx="8" fill="#FFFFFF" stroke="#D9E2E8"/>
    <text x="125" y="64" text-anchor="middle" font-weight="600" fill="#16324F">One tube (molecular)</text>
    <text x="125" y="88" text-anchor="middle">(6,6) CNT, d = 0.814 nm, L = 2.46 nm</text>
    <text x="125" y="110" text-anchor="middle">pore law q = G ΔΠ</text>
    <text x="125" y="132" text-anchor="middle" fill="#9A5B00">G: declared scenario (illustrative)</text>
    <text x="125" y="154" text-anchor="middle" fill="#526477">future: calibrated from MD crossings</text>
    <rect x="315" y="40" width="230" height="130" rx="8" fill="#FFFFFF" stroke="#D9E2E8"/>
    <text x="430" y="64" text-anchor="middle" font-weight="600" fill="#16324F">Membrane map</text>
    <text x="430" y="88" text-anchor="middle">square lattice, pitch 10 nm</text>
    <text x="430" y="110" text-anchor="middle">exact pore count per face</text>
    <text x="430" y="132" text-anchor="middle">S_c = Σ G_i,  Rs_c = A_c / S_c</text>
    <text x="430" y="154" text-anchor="middle" fill="#526477">tube / patch / membrane factors</text>
    <rect x="620" y="40" width="230" height="130" rx="8" fill="#FFFFFF" stroke="#D9E2E8"/>
    <text x="735" y="64" text-anchor="middle" font-weight="600" fill="#16324F">Chambers (continuum)</text>
    <text x="735" y="88" text-anchor="middle">steady 3D Stokes, MAC grid</text>
    <text x="735" y="110" text-anchor="middle">J_c = ΔΠ_c / Rs_c in the solve</text>
    <text x="735" y="132" text-anchor="middle">blocked faces: J = 0 exactly</text>
    <text x="735" y="154" text-anchor="middle" fill="#526477">browser CFD solver (Float64)</text>
    <line x1="242" y1="92" x2="312" y2="92" stroke="#16324F" stroke-width="2" marker-end="url(#clArrow)"/>
    <text x="277" y="82" text-anchor="middle" font-size="12">G</text>
    <line x1="547" y1="92" x2="617" y2="92" stroke="#16324F" stroke-width="2" marker-end="url(#clArrow)"/>
    <text x="582" y="82" text-anchor="middle" font-size="12">S_c</text>
    <path d="M735 172 C735 225, 125 225, 125 172" fill="none" stroke="#006B62" stroke-width="2" stroke-dasharray="6 4" marker-end="url(#clArrow)"/>
    <text x="430" y="216" text-anchor="middle" font-size="12" fill="#006B62">ΔΠ_c of every face from the solved field → q_i = G_i ΔΠ_c for the selected tube</text>
    <text x="430" y="22" text-anchor="middle" font-size="12" fill="#526477">reference planes: the two membrane faces (normal traction); pore-scale losses inside G, chamber losses in the CFD</text>
  </g>
</svg>`;

/* reported convergence study (closed strip, 20/40/80 cells) from results/openfoam.json */
const CONV = (() => {
  const of = readJson('results/openfoam.json');
  const lv = of && of.convergence && of.convergence.levels ? of.convergence.levels.filter((c) => c.Q_browser != null) : [];
  if (lv.length < 3) return null;
  const ch = (x, y) => Math.abs(y / x - 1);
  return { lv, an: of.convergence.analysis || {}, dB: ch(lv[1].Q_browser, lv[2].Q_browser), dF: ch(lv[1].Q_openfoam, lv[2].Q_openfoam),
    dB1: ch(lv[0].Q_browser, lv[1].Q_browser), dF1: ch(lv[0].Q_openfoam, lv[1].Q_openfoam) };
})();
const pct = (x) => (100 * x).toPrecision(3) + ' %';   // 3 significant figures

/* what the three-level study can and cannot say: the statement written by compare_openfoam.py (single source) */
function convergenceVerdict(an) {
  return 'Grid convergence index: Roache, three grids, safety factor 1.25. Conclusion: ' + esc(an.statement || 'not available') + '.';
}

/* criteria from TOLERANCES.md table rows "| ID | name | criterion |" */
function criteria() {
  const md = fs.readFileSync(T('TOLERANCES.md'), 'utf8'), out = {};
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*([A-Z]\d+)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*$/);
    if (m) out[m[1]] = { name: m[2], criterion: m[3].replace(/\*\*/g, '') };
  }
  return out;
}

function validationHtml() {
  const crit = criteria();
  const groups = [
    { title: 'Network and core modules (Node)', short: 'core modules', ids: ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'N9'], res: readJson('results/t_core.json') },
    { title: 'Continuum solver (Node)', short: 'solver (analytic solutions, an independent SciPy assembly, conservation, energy closure)', ids: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12', 'S13', 'S14', 'S15'], res: readJson('results/t_solver.json') },
    { title: 'Decision rules (Node)', short: 'decision rules', ids: ['D1', 'D2', 'D3'], res: readJson('results/t_decision.json') },
    { title: 'Browser and regression (Chromium)', short: 'browser and regression', ids: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12', 'B13', 'B14', 'B15', 'B16', 'R1'], res: readJson('results/browser.json') },
    { title: 'Calibration and analysis tools', short: 'calibration tools', ids: ['A1', 'A2', 'A3', 'A4', 'A5'], res: readJson('results/t_tools.json') },
    { title: 'Native comparison (OpenFOAM v1912)', short: 'native OpenFOAM comparison', ids: ['F1', 'F2', 'F3', 'F4'], res: readJson('results/openfoam.json') },
  ];
  const amended = { N5: 'procedure amended after the first run failed (3.17 × 10⁻⁹ at N = 10¹⁰); criterion unchanged', S13: 'reference procedure corrected during development (equilibration and iterative refinement), after the reference found a sparse-matrix defect in the solver that was fixed', S14: 'criterion amended after the first official run failed: the frozen expectation −G ΔΠ_local ignored the chambers’ feedback (relative difference 6.51 × 10⁻⁶ > 10⁻⁶); now ΔS ΔΠ_c²/ΔP', B4: 'amended before the browser tests were run, as S14' };
  let html = '', total = 0, passed = 0, notrun = 0, failed = 0;
  const failIds = [], stats = [];
  for (const g of groups) {
    let gp = 0;
    html += '<h3>' + esc(g.title) + '</h3>\n<div class="cl-table-wrap"><table class="cl-table cl-tests"><thead><tr><th scope="col">#</th><th scope="col">Check</th><th scope="col">Acceptance criterion</th><th scope="col">Measured</th><th scope="col">Result</th></tr></thead><tbody>\n';
    for (const id of g.ids) {
      const c = crit[id] || { name: id, criterion: '' };
      const item = g.res && g.res.items ? g.res.items.find((x) => x.id === id) : null;
      const verdict = item ? item.verdict : 'NOT_RUN';
      total++; if (verdict === 'PASS') { passed++; gp++; } else if (verdict === 'NOT_RUN') notrun++; else { failed++; failIds.push(id); }
      const cls = verdict === 'PASS' ? 'cl-verdict-pass' : verdict === 'NOT_RUN' ? 'cl-verdict-notrun' : 'cl-verdict-fail';
      const label = verdict === 'PASS' && amended[id] ? 'PASS (amended)' : verdict.replace('_', ' ');
      html += '<tr><td>' + id + '</td><th scope="row">' + esc(c.name) + '</th><td>' + esc(c.criterion) + '</td><td>' + esc(item ? item.detail : (g.res && g.res.notRunReason) || 'not run in this release') + (amended[id] && item ? '. Amendment: ' + esc(amended[id]) : '') + '</td><td><span class="cl-verdict ' + cls + '">' + esc(label) + '</span></td></tr>\n';
    }
    html += '</tbody></table></div>\n';
    stats.push(g.short + ' ' + gp + ' of ' + g.ids.length);
    if (g.res && g.res.environment) html += '<p class="cl-small">' + esc(g.res.environment) + '</p>\n';
    if (g.title.indexOf('OpenFOAM') >= 0 && g.res && g.res.items) {
      const it = (id) => g.res.items.find((x) => x.id === id) || {};
      const fails = ['F2', 'F3', 'F4'].filter((id) => it(id).verdict === 'FAIL');
      if (fails.length) {
        const d = (id) => it(id).data || {};
        html += '<p>' + 'F1 (developed duct) agrees with OpenFOAM to rounding: on this grid both codes reduce to the same five-point operator over the cross-section. ' +
          fails.join(', ') + ' fail their frozen gates. These cases use a membrane resistance at which the chambers carry most of the resistance (Rs = 2.5 × 10⁴ Pa s m⁻¹; OpenFOAM’s explicit porous-baffle jump stalled at 1.0 × 10⁵ and above), so the result is dominated by the flow converging through the square ports, whose edges in the no-slip wall are singular' + (function () {
            const lv = (g.res.convergence && g.res.convergence.levels) || []; const a20 = lv.find((c) => c.N === 20), a40 = lv.find((c) => c.N === 40);
            return a20 && a40 && a20.Q_browser ? ': total flow changes by ' + pct(Math.abs(a40.Q_browser / a20.Q_browser - 1)) + ' (browser) and ' + pct(Math.abs(a40.Q_openfoam / a20.Q_openfoam - 1)) + ' (OpenFOAM) from 20 to 40 cells' : '';
          })() + ', and the codes differ by ' +
          ['F2', 'F3', 'F4'].map((id) => pct(d(id).Q_rel_diff || 0) + ' (' + id + ')').join(', ') + ' in Q and by ' + ['F2', 'F3', 'F4'].map((id) => pct(d(id).velocity_L2 || 0)).join(', ') + ' in velocity. ' + (CONV ? 'On the 80-cell grid the codes differ by ' + pct(CONV.lv[2].Q_rel_diff) + ' in Q (velocity L2 ' + pct(CONV.lv[2].velocity_L2) + '), and Q still changes by ' + pct(CONV.dB) + ' (browser) and ' + pct(CONV.dF) + ' (OpenFOAM) from 40 to 80 cells, so neither code is mesh-converged on these grids; the study is reported below. ' : '') + (MESH ? 'In the lab’s own pore-limited devices the chambers carry at most ' + sci3(MESH.maxChamber) + ' of the resistance and refining the mesh changes Q by at most ' + sci3(MESH.maxRel) + ' (mesh check, all ' + MESH.n + ' allowed sizes), so these discretisation differences do not reach the totals the lab reports; they do apply to the chamber velocity field near the ports.' : '') + '</p>\n';
      }
    }
    if (g.res && g.res.convergence && g.res.convergence.analysis && g.res.convergence.analysis.browser) {
      const cv = g.res.convergence, an = cv.analysis, f = (x) => x.toExponential(3);
      html += '<p class="cl-small">Reported mesh-convergence study (not a gate), closed-strip case: ' + cv.levels.map((c) => c.N + ' cells: Q ' + f(c.Q_browser) + ' (browser) and ' + f(c.Q_openfoam) + ' m³/s (OpenFOAM), difference ' + pct(c.Q_rel_diff) + ', velocity L2 ' + pct(c.velocity_L2)).join('; ') +
        '. Observed order ' + an.browser.observed_order.toFixed(2) + ' (browser) and ' + an.openfoam.observed_order.toFixed(2) + ' (OpenFOAM); Richardson-extrapolated Q ' + f(an.browser.Q_extrapolated_m3_s) + ' and ' + f(an.openfoam.Q_extrapolated_m3_s) + ' m³/s' + (an.extrapolated_rel_diff != null ? ' (difference ' + pct(an.extrapolated_rel_diff) + ')' : '') + '. ' + convergenceVerdict(an) + '</p>\n';
    }
  }
  const bench = readJson('results/benchmark.json');
  if (bench) {
    html += '<h3>Solve times</h3>\n<div class="cl-table-wrap"><table class="cl-table"><thead><tr><th scope="col">Case</th><th scope="col">Cells per chamber</th><th scope="col">Unknowns</th><th scope="col">Iterations</th><th scope="col">Worker (s)</th><th scope="col">Page round trip (s)</th></tr></thead><tbody>\n' +
      bench.rows.map((r) => '<tr><th scope="row">' + esc(r.case) + '</th><td>' + esc(r.cells) + '</td><td>' + r.unknowns.toLocaleString('en-US').replace(/,/g, ' ') + '</td><td>' + r.iterations + '</td><td>' + r.worker_s.toFixed(2) + '</td><td>' + r.roundTrip_s.toFixed(2) + '</td></tr>').join('\n') +
      '</tbody></table></div>\n<p class="cl-small">Measured in the page’s worker in headless Chromium ' + esc(bench.chromium) + ' on ' + esc(bench.cpu) + ' (' + bench.cores + ' cores). Your device will differ; a few seconds per small scenario is a target, not a promise.</p>\n';
  }
  const head = '<p><b>' + passed + ' of ' + total + ' checks pass</b>' + (failed ? ', ' + failed + ' fail' : '') + (notrun ? ', ' + notrun + ' not run' : '') + ': ' + stats.join('; ') + '.' +
    (failIds.length ? ' The failures are ' + failIds.join(', ') + ': the native comparison of a chamber-dominated case, reported as measured and discussed below.' : '') +
    ' The criteria were written in <code>tools/continuum/TOLERANCES.md</code> before the first evaluation; amendments are recorded there with their reasons and the original results are kept (for example <code>results/t_solver.run1-frozen.json</code>). Each test script exits with a failure status when a check fails. The solver tests run the same <code>core/*.js</code> files as this page.</p>\n';
  return head + html;
}

let html = fs.readFileSync(T('page.template.html'), 'utf8');
for (const [k, tex] of Object.entries(EQ)) html = html.split('{{' + k + '}}').join(katex.renderToString(tex, { displayMode: true, throwOnError: true, output: 'htmlAndMathml' }));
const limitPorts = CONV ? '<li>Flow converging through the square ports and around the edges of closed regions is resolved only approximately: in the chamber-dominated comparison case (closed strip, Rs = 2.5 × 10⁴ Pa s m⁻¹), Q changes by ' + pct(CONV.dB) + ' (browser) and ' + pct(CONV.dF) + ' (OpenFOAM) between 40 and 80 cells across the device' + (CONV.an.browser && isFinite(CONV.an.browser.observed_order) ? ' (observed order ' + CONV.an.browser.observed_order.toFixed(2) + ' and ' + CONV.an.openfoam.observed_order.toFixed(2) + ')' : '') + '. In the lab’s pore-limited devices the totals are unaffected (mesh check), but the velocity pattern near the ports is approximate.</li>' : '';
if (!CONV) console.warn('warning: no 80-cell convergence data in results/openfoam.json; the port limitation is omitted');
html = html.split('{{LIMIT_PORTS}}').join(limitPorts);
html = html.split('{{DIAGRAM}}').join(DIAGRAM).split('{{VALIDATION}}').join(validationHtml()).split('{{VERSION}}').join(VERSION);
const left = html.match(/\{\{[A-Z_]+\}\}/g);
if (left) throw new Error('unrendered tokens: ' + left.join(', '));
fs.writeFileSync(path.join(ROOT, 'lab/continuum/index.html'), html);
console.log('wrote lab/continuum/index.html (' + (html.length / 1024).toFixed(1) + ' kB)');
