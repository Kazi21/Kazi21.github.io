// build_ions_page.js — builds lab/continuum/index.html (the ion experiment) from tools/continuum/ions/page.template.html:
// pre-renders the equations with KaTeX (the page never loads katex.js), writes the model ladder and the tube presets from
// lab/continuum/ions/params.js, the CP2K table from lab/continuum/ions/data/hydration.json, the evidence table of the
// default experiment, the numbered references, and the validation tables from tools/continuum/results/t_ions.json and
// browser_ions.json with the criteria parsed from tools/continuum/ions/TOLERANCES.md (single source). Tests without a
// result are listed as NOT_RUN.
// Usage (repository root):  NODE_PATH=<dir with katex> node tools/continuum/ions/build_ions_page.js
'use strict';
const fs = require('fs'), path = require('path');
const katex = require('katex');
const ROOT = path.resolve(__dirname, '../../..');
const VERSION = '2026.9.1';
const Core = require(path.join(ROOT, 'lab/continuum/ions/core.js'));
const Pm = require(path.join(ROOT, 'lab/continuum/ions/params.js'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const f3 = (x) => Number(x).toPrecision(3);

const EQ = {
  EQ_NP: String.raw`\begin{gathered}J_i=-D_i(x)\,A(x)\left[\frac{dc_i}{dx}+c_i\,\frac{d\psi_i}{dx}\right]+c_i\,Q,\qquad \frac{dJ_i}{dx}=0\\ \psi_i=\frac{z_iF\phi}{RT}+\frac{\mu^{\mathrm{ex}}_i}{RT}\end{gathered}`,
  EQ_POISSON: String.raw`\frac{d}{dx}\!\left(\varepsilon_0\varepsilon_r\,A\,\frac{d\phi}{dx}\right)=-A\left(F\sum_i z_i c_i+\rho_{\mathrm{fix}}\right)`,
  EQ_MUEX: String.raw`\mu^{\mathrm{ex}}_i(x)=-RT\ln\!\Big(1-N_A d^{3}\sum_j c_j\Big)+\Delta G_i\,s(x)`,
  EQ_BORN: String.raw`\Delta G_i^{\mathrm{Born}}=\frac{N_A z_i^{2}e^{2}}{8\pi\varepsilon_0\,a_{B,i}}\left(\frac{1}{\varepsilon_p}-\frac{1}{\varepsilon_b}\right)`,
  EQ_DEHYD: String.raw`\begin{gathered}\Delta G_i^{\mathrm{dehyd}}=(1-\kappa_i)\,\frac{N_{\mathrm{lost},i}}{n_{\mathrm{ref},i}}\,\Delta G_{1,i}\\ \Delta G_{1,i}=\left|\Delta G_{\mathrm{hyd},i}\right|-\frac{N_A z_i^{2}e^{2}}{8\pi\varepsilon_0\,(r_{1,i}+r_w)}\left(1-\frac{1}{\varepsilon_b}\right)\end{gathered}`,
  EQ_ACCESS: String.raw`A(s)=\pi\left(a+\tfrac{4}{\pi}\,s\right)^{2}\ \Rightarrow\ R_{\mathrm{access}}=\frac{1}{4\kappa a}\ \text{per side},\qquad \kappa=\frac{F^{2}}{RT}\sum_i z_i^{2}D_i c_i`,
  EQ_FLOW: String.raw`\begin{gathered}Q\,r_h(x)=-\frac{dp}{dx}-\sum_i c_i\,\frac{d}{dx}\!\left(z_iF\phi+\mu^{\mathrm{ex}}_i\right)\\ r_h=\frac{8\mu}{\pi a^{4}\,(1+4b/a)}\ \text{in the pore},\qquad R=\frac{3\mu}{2a^{3}}\ \text{per access region}\end{gathered}`,
  EQ_GHK: String.raw`V_{\mathrm{rev}}=\frac{RT}{F}\ln\frac{P_{\mathrm{Na}}\,a^{\mathrm{perm}}+P_{\mathrm{Cl}}\,a^{\mathrm{feed}}}{P_{\mathrm{Na}}\,a^{\mathrm{feed}}+P_{\mathrm{Cl}}\,a^{\mathrm{perm}}}`,
};

/* references in order of first citation in the template; {{R:key}} becomes a numbered link */
const REFS = {
  goldman1943: 'Goldman, D. E. (1943). Potential, impedance, and rectification in membranes. <i>J. Gen. Physiol.</i> 27, 37–60. doi:10.1085/jgp.27.1.37',
  hodgkin1949: 'Hodgkin, A. L. & Katz, B. (1949). The effect of sodium ions on the electrical activity of the giant axon of the squid. <i>J. Physiol.</i> 108, 37–77. doi:10.1113/jphysiol.1949.sp004310',
  corry2000: 'Corry, B., Kuyucak, S. & Chung, S.-H. (2000). Tests of continuum theories as models of ion channels. II. Poisson–Nernst–Planck theory versus Brownian dynamics. <i>Biophys. J.</i> 78, 2364–2381. doi:10.1016/S0006-3495(00)76781-6',
  gross1968: 'Gross, R. J. & Osterle, J. F. (1968). Membrane transport characteristics of ultrafine capillaries. <i>J. Chem. Phys.</i> 49, 228.',
  imoto1988: 'Imoto, K. et al. (1988). Rings of negatively charged amino acids determine the acetylcholine receptor channel conductance. <i>Nature</i> 335, 645. doi:10.1038/335645a0',
  bikerman1942: 'Bikerman, J. J. (1942). Structure and capacity of electrical double layer. <i>Phil. Mag.</i> 33, 384.',
  borukhov1997: 'Borukhov, I., Andelman, D. & Orland, H. (1997). Steric effects in electrolytes: a modified Poisson–Boltzmann equation. <i>Phys. Rev. Lett.</i> 79, 435–438. doi:10.1103/PhysRevLett.79.435',
  kilic2007: 'Kilic, M. S., Bazant, M. Z. & Ajdari, A. (2007). Steric effects in the dynamics of electrolytes at large applied voltages. II. Modified Poisson–Nernst–Planck equations. <i>Phys. Rev. E</i> 75, 021503. doi:10.1103/PhysRevE.75.021503',
  gillespie2002: 'Gillespie, D., Nonner, W. & Eisenberg, R. S. (2002). Coupling Poisson–Nernst–Planck and density functional theory to calculate ion flux. <i>J. Phys.: Condens. Matter</i> 14, 12129–12145.',
  born1920: 'Born, M. (1920). Volumen und Hydratationswärme der Ionen. <i>Z. Phys.</i> 1, 45–48. doi:10.1007/BF01881023',
  bowen2002: 'Bowen, W. R. & Welfoot, J. S. (2002). Modelling the performance of membrane nanofiltration — critical assessment and model development. <i>Chem. Eng. Sci.</i> 57, 1121–1137. doi:10.1016/S0009-2509(01)00413-4',
  graf2004: 'Graf, P., Kurnikova, M. G., Coalson, R. D. & Nitzan, A. (2004). Comparison of dynamic lattice Monte Carlo simulations and the dielectric self-energy Poisson–Nernst–Planck continuum theory for model ion channels. <i>J. Phys. Chem. B</i> 108, 2006–2015. doi:10.1021/jp0355307',
  corry2003: 'Corry, B., Kuyucak, S. & Chung, S.-H. (2003). Dielectric self-energy in Poisson–Boltzmann and Poisson–Nernst–Planck models of ion channels. <i>Biophys. J.</i> 84, 3594–3606. doi:10.1016/S0006-3495(03)75091-7',
  zwolak2009: 'Zwolak, M., Lagerqvist, J. & Di Ventra, M. (2009). Quantized ionic conductance in nanopores. <i>Phys. Rev. Lett.</i> 103, 128102. doi:10.1103/PhysRevLett.103.128102',
  sahu2019: 'Sahu, S. & Zwolak, M. (2019). Colloquium: Ionic phenomena in nanoscale pores through 2D materials. <i>Rev. Mod. Phys.</i> 91, 021004. doi:10.1103/RevModPhys.91.021004',
  karniadakis2005: 'Karniadakis, G., Beskok, A. & Aluru, N. (2005). <i>Microflows and Nanoflows: Fundamentals and Simulation.</i> Springer, New York. doi:10.1007/0-387-28676-4',
  green2025: 'Green, Y. (2025). Goldman–Hodgkin–Katz equation, reverse electrodialysis, and everything in between. <i>Phys. Rev. E</i> 111, 064408. doi:10.1103/PhysRevE.111.064408',
  joly2004: 'Joly, L., Ybert, C., Trizac, E. & Bocquet, L. (2004). Hydrodynamics within the electric double layer on slipping surfaces. <i>Phys. Rev. Lett.</i> 93, 257805. doi:10.1103/PhysRevLett.93.257805',
  bhadauria2017: 'Bhadauria, R. & Aluru, N. R. (2017). Multiscale modeling of electroosmotic flow: effects of discrete ion, enhanced viscosity, and surface friction. <i>J. Chem. Phys.</i> 146, 184106.',
  yao2019: 'Yao, Y.-C., Taqieddin, A., Alibakhshi, M. A., Wanunu, M., Aluru, N. R. & Noy, A. (2019). Strong electroosmotic coupling dominates ion conductance of 1.5 nm diameter carbon nanotube porins. <i>ACS Nano</i> 13, 12851–12859. doi:10.1021/acsnano.9b05118',
  feng2016: 'Feng, J. et al. (2016). Observation of ionic Coulomb blockade in nanopores. <i>Nat. Mater.</i> 15, 850–855. doi:10.1038/nmat4607',
  kopfer2014: 'Köpfer, D. A. et al. (2014). Ion permeation in K⁺ channels occurs by direct Coulomb knock-on. <i>Science</i> 346, 352–355. doi:10.1126/science.1254840',
  lesnicki2020: 'Lesnicki, D., Gao, C. Y., Rotenberg, B. & Limmer, D. T. (2020). Field-dependent ionic conductivities from generalized fluctuation–dissipation relations. <i>Phys. Rev. Lett.</i> 124, 206001. doi:10.1103/PhysRevLett.124.206001',
  jain2015: 'Jain, T. et al. (2015). Heterogeneous sub-continuum ionic transport in statistically isolated graphene nanopores. <i>Nat. Nanotechnol.</i> 10, 1053. doi:10.1038/nnano.2015.222',
  epsztein2020: 'Epsztein, R., DuChanois, R. M., Ritt, C. L., Noy, A. & Elimelech, M. (2020). Towards single-species selectivity of membranes with subnanometre pores. <i>Nat. Nanotechnol.</i> 15, 426–436. doi:10.1038/s41565-020-0713-6',
  doyle1998: 'Doyle, D. A. et al. (1998). The structure of the potassium channel: molecular basis of K⁺ conduction and selectivity. <i>Science</i> 280, 69–77. doi:10.1126/science.280.5360.69',
  zhou2001: 'Zhou, Y., Morais-Cabral, J. H., Kaufman, A. & MacKinnon, R. (2001). Chemistry of ion coordination and hydration revealed by a K⁺ channel–Fab complex at 2.0 Å resolution. <i>Nature</i> 414, 43–48. doi:10.1038/35102009',
  dutzler2002: 'Dutzler, R., Campbell, E. B., Cadene, M., Chait, B. T. & MacKinnon, R. (2002). X-ray structure of a ClC chloride channel at 3.0 Å reveals the molecular basis of anion selectivity. <i>Nature</i> 415, 287–294. doi:10.1038/415287a',
  tunuguntla2017: 'Tunuguntla, R. H. et al. (2017). Enhanced water permeability and tunable ion selectivity in subnanometer carbon nanotube porins. <i>Science</i> 357, 792–796. doi:10.1126/science.aan2438',
  marcus1991: 'Marcus, Y. (1991). Thermodynamics of solvation of ions. Part 5. Gibbs free energy of hydration at 298.15 K. <i>J. Chem. Soc., Faraday Trans.</i> 87, 2995–2999. doi:10.1039/FT9918702995',
  hall1975: 'Hall, J. E. (1975). Access resistance of a small circular pore. <i>J. Gen. Physiol.</i> 66, 531–532. doi:10.1085/jgp.66.4.531',
  sampson1891: 'Sampson, R. A. (1891). On Stokes’s current function. <i>Phil. Trans. R. Soc. A</i> 182, 449.',
  scharfetter1969: 'Scharfetter, D. L. & Gummel, H. K. (1969). Large-signal analysis of a silicon Read diode oscillator. <i>IEEE Trans. Electron Devices</i> 16, 64–77. doi:10.1109/T-ED.1969.16566',
  li1974: 'Li, Y.-H. & Gregory, S. (1974). Diffusion of ions in sea water and in deep-sea sediments. <i>Geochim. Cosmochim. Acta</i> 38, 703–714.',
  malmberg1956: 'Malmberg, C. G. & Maryott, A. A. (1956). Dielectric constant of water from 0° to 100 °C. <i>J. Res. Natl. Bur. Stand.</i> 56, 1–8 (RP2641).',
  huber2009: 'Huber, M. L. et al. (2009). New international formulation for the viscosity of H₂O. <i>J. Phys. Chem. Ref. Data</i> 38, 101–125. doi:10.1063/1.3088050',
  bondi1964: 'Bondi, A. (1964). van der Waals volumes and radii. <i>J. Phys. Chem.</i> 68, 441–451. doi:10.1021/j100785a001',
  werder2003: 'Werder, T., Walther, J. H., Jaffe, R. L., Halicioglu, T. & Koumoutsakos, P. (2003). On the water–carbon interaction for use in molecular dynamics simulations of graphite and carbon nanotubes. <i>J. Phys. Chem. B</i> 107, 1345–1352. doi:10.1021/jp0268112',
};
// references cited only in the evidence table (in its source column) are appended after those cited in the text
const EVIDENCE_REFS = ['li1974', 'malmberg1956', 'huber2009', 'bondi1964', 'werder2003'];

function criteria(file) {
  const md = fs.readFileSync(file, 'utf8'), out = {};
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*([A-Z]{1,2}\d+)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*$/);
    if (m) out[m[1]] = { name: m[2], criterion: m[3].replace(/\*\*/g, '') };
  }
  return out;
}
function validationHtml() {
  const crit = criteria(path.join(ROOT, 'tools/continuum/ions/TOLERANCES.md'));
  const groups = [
    { title: 'Solver (Node)', short: 'solver', ids: ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9', 'I10', 'I11', 'I12', 'I13', 'I14', 'I15'], res: readJson(path.join(ROOT, 'tools/continuum/results/t_ions.json')), cmd: 'node tools/continuum/ions/t_ions.js' },
    { title: 'Browser (Chromium)', short: 'browser', ids: ['IB1', 'IB2', 'IB3', 'IB4', 'IB5', 'IB6', 'IB7', 'IB8', 'IB9', 'IB10'], res: readJson(path.join(ROOT, 'tools/continuum/results/browser_ions.json')), cmd: 'node tools/continuum/ions/browser_ions.js' },
  ];
  const amended = { I14: 'applied after run 2 to the displayed value, run 2 kept; since release 2026.9.1 the displayed status is also compared with an independent classification (beyond the display range, Nernst band, invalid)' };
  let html = '', total = 0, passed = 0, failed = 0, notrun = 0;
  const stats = [];
  for (const g of groups) {
    let gp = 0;
    html += '<h3>' + esc(g.title) + ' — <code>' + esc(g.cmd) + '</code></h3>\n<div class="cl-table-wrap"><table class="cl-table cl-tests"><thead><tr><th scope="col">#</th><th scope="col">Check</th><th scope="col">Acceptance criterion</th><th scope="col">Measured</th><th scope="col">Result</th></tr></thead><tbody>\n';
    for (const id of g.ids) {
      const c = crit[id] || { name: id, criterion: '' };
      const it = g.res && g.res.items ? g.res.items.find((x) => x.id === id) : null;
      const v = it ? it.verdict : 'NOT_RUN';
      total++; if (v === 'PASS') { passed++; gp++; } else if (v === 'NOT_RUN') notrun++; else failed++;
      const cls = v === 'PASS' ? 'cl-verdict-pass' : v === 'NOT_RUN' ? 'cl-verdict-notrun' : 'cl-verdict-fail';
      const label = v === 'PASS' && amended[id] ? 'PASS (applied as clarified)' : v.replace('_', ' ');
      html += '<tr><td>' + id + '</td><th scope="row">' + esc(c.name) + '</th><td>' + esc(c.criterion) + '</td><td>' + esc(it ? it.detail : 'not run in this build') + (amended[id] && it ? '. Note: ' + esc(amended[id]) : '') + '</td><td><span class="cl-verdict ' + cls + '">' + esc(label) + '</span></td></tr>\n';
    }
    html += '</tbody></table></div>\n';
    if (g.res && g.res.environment) html += '<p class="cl-small">' + esc(g.res.environment) + '</p>\n';
    stats.push(g.short + ' ' + gp + ' of ' + g.ids.length);
  }
  // scope of the independent-solver comparison, from the recorded I8 result (case b: rims, solvation, confined mobility)
  const i8 = (groups[0].res && groups[0].res.items || []).find((x) => x.id === 'I8');
  const mb = i8 && /b \+100 mV[^:]*: I [-\d.]+ vs [-\d.]+ pA \(([\d.e+-]+)\), Na⁺ ([\d.e+-]+), Cl⁻ ([\d.e+-]+)/.exec(i8.detail);
  const vals = mb ? [+mb[1], +mb[2], +mb[3]] : [], kmax = vals.indexOf(Math.max(...vals));
  const scope = mb ? 'Numerically verified against an independent solver and analytical limits. The SciPy comparison (I8) covers selected cases without the finite-size and electro-osmotic terms; its largest difference, ' + f3(100 * vals[kmax]) + ' % in ' + ['the total current', 'the Na⁺ part of the current', 'the small Cl⁻ part of the current'][kmax] + ', is a numerical comparison in those cases, not a guarantee of physical accuracy for every setting. ' : '';
  return '<p><b>' + passed + ' of ' + total + ' checks pass</b>' + (failed ? ', ' + failed + ' fail' : '') + (notrun ? ', ' + notrun + ' not run' : '') + ': ' + stats.join('; ') + '. ' + scope +
    'The criteria were written in <code>tools/continuum/ions/TOLERANCES.md</code> before the solver existed; I15 was added for release 2026.9.1 before it was run. Two earlier solver runs failed and are kept (<code>results/t_ions.run1.json</code>: I5, fixed by a change to the solver; <code>results/t_ions.run2.json</code>: I14, criterion applied to the displayed value as recorded in TOLERANCES.md). ' +
    'The solver tests run the same <code>ions/core.js</code> and <code>ions/params.js</code> as this page. The water experiment has its own validation on <a href="water.html#validation">its page</a>; none of its tests validates this electrolyte solver.</p>\n' + html;
}

function ladderHtml() {
  return Pm.STEPS.map((s) => '<label class="ion-step" data-step="' + s.n + '"><input type="radio" name="ion-step" value="' + s.n + '"' + (s.n === Pm.DEFAULTS.step ? ' checked' : '') + '><span class="ion-step-n">' + s.n + '</span><span class="ion-step-t">' + esc(s.label) + '<span class="ion-step-d">' + esc(s.adds) + '</span></span></label>').join('\n                ');
}
function presetHtml() {
  return Pm.PRESETS.map((p) => { const g = Pm.geometry(p); return '<option value="' + p.id + '"' + (p.id === Pm.DEFAULTS.preset ? ' selected' : '') + '>' + p.label + ' · d ' + p.dC.toFixed(3) + ' nm · a ' + f3(g.a) + ' nm' + (p.id === '6,6' ? ' · single file' : '') + '</option>'; }).join('');
}
function cp2kHtml() {
  const h = readJson(path.join(ROOT, 'lab/continuum/ions/data/hydration.json'));
  const rows = h.tubes.map((t) => {
    const na = t.ions['Na+'], cl = t.ions['Cl-'], rng = (x) => f3(Math.min(...x.block_means_5)) + '–' + f3(Math.max(...x.block_means_5));
    return '<tr><th scope="row">' + esc(t.label) + '</th><td>' + t.diameter_nm.toFixed(3) + '</td><td>' + t.n_water + '</td><td>' + na.n_ions + ' + ' + cl.n_ions + '</td><td>' + t.run_length_ps.toFixed(2) + '</td><td>' + f3(na.mean_count) + ' (' + rng(na) + ')</td><td>' + f3(cl.mean_count) + ' (' + rng(cl) + ')</td><td><code>' + t.file_sha256.slice(0, 12) + '…</code></td></tr>';
  }).join('\n');
  const table = '<div class="cl-table-wrap"><table class="cl-table"><thead><tr><th scope="col">Tube</th><th scope="col">Diameter (nm)</th><th scope="col">Waters</th><th scope="col">Na⁺ + Cl⁻</th><th scope="col">Run (ps)</th><th scope="col">Na⁺ first shell (block range)</th><th scope="col">Cl⁻ first shell (block range)</th><th scope="col">File SHA-256</th></tr></thead><tbody>\n' + rows + '\n</tbody></table></div>\n' +
    '<p class="cl-small">CP2K 2026.1, PBE with D3(BJ) dispersion, NVT at 300 K, 0.25 fs steps; frames stored every 2 fs. Counts: water oxygens within 0.32 nm of Na⁺ or 0.38 nm of Cl⁻ (minimum image), averaged over every stored frame and over the ions of each kind; computed by <code>tools/continuum/ions/make_hydration.py</code> from the public trajectory files of the <a href="../cnt/">CNT inspector</a>.</p>';
  const caveats = h.caveats.map((c) => '<li>' + esc(c) + '</li>').join('');
  return { table, caveats };
}
function registryHtml() {
  const rows = Pm.registry(Pm.DEFAULTS);
  return '<div class="cl-table-wrap"><table class="cl-table ion-evidence-table"><thead><tr><th scope="col">Input</th><th scope="col">Value</th><th scope="col">Units</th><th scope="col">Source</th><th scope="col">Conditions</th><th scope="col">Status</th></tr></thead><tbody>\n' +
    rows.map((r) => '<tr><th scope="row">' + esc(r.name) + '</th><td>' + esc(r.value) + '</td><td>' + esc(r.units) + '</td><td>' + esc(r.source) + '</td><td>' + esc(r.conditions) + '</td><td><span class="ion-status ' + ({ Literature: 'is-lit', Recorded: 'is-rec', Derived: 'is-der', Illustrative: 'is-ill', Setting: 'is-set' })[r.status] + '">' + esc(r.status === 'Recorded' ? 'Recorded (CP2K)' : r.status) + '</span></td></tr>').join('\n') +
    '\n</tbody></table></div>';
}

let html = fs.readFileSync(path.join(__dirname, 'page.template.html'), 'utf8');
for (const [k, tex] of Object.entries(EQ)) html = html.split('{{' + k + '}}').join(katex.renderToString(tex, { displayMode: true, throwOnError: true, output: 'htmlAndMathml' }));
const cp = cp2kHtml();
// computed at build time with the same solver files as the page (default settings, (7,7), +100 mV)
const closureCmp = (() => {
  const I = (st, sol) => Core.solve(Pm.build({ preset: '7,7', step: st, solvation: sol }).s).I * 1e12;
  const a4 = I(4, 'cp2k'), b4 = I(4, 'shell'), a6 = I(6, 'cp2k'), b6 = I(6, 'shell');
  return 'In the (7,7) tube at +100 mV, the closure with the recorded counts gives ' + f3(a4) + ' pA and the rigid-shell closure ' + f3(b4) + ' pA (a factor of ' + f3(a4 / b4) + '; with all six steps ' + f3(a6) + ' against ' + f3(b6) + ' pA): the recorded shell keeps more water inside the tube, so the assumed penalty is smaller. ' +
    'This factor is the sensitivity of the prediction to the closure, not a validation of either closure: the short AIMD runs record hydration structure, not the transport barrier or the current.';
})();
// recorded first-shell counts against the rigid-shell estimate, from the same data and formula as the page's chart
const shellRatio = (() => {
  const h = readJson(path.join(ROOT, 'lab/continuum/ions/data/hydration.json'));
  const r = (n) => { const t = h.tubes.find((x) => x.n === n), g = Pm.geometry(Pm.presetOf(n + ',' + n));
    return [t.ions['Na+'].mean_count / (Pm.REF.nNa * Pm.shellFraction(Pm.R_SHELL.Na, g.Rw)), t.ions['Cl-'].mean_count / (Pm.REF.nCl * Pm.shellFraction(Pm.R_SHELL.Cl, g.Rw))]; };
  const a = r(7), b = r(6);
  return 'In the (7,7) tube the recorded shells hold ' + f3(a[0]) + ' (Na⁺) and ' + f3(a[1]) + ' (Cl⁻) times the water the rigid shell allows, in the (6,6) tube ' + f3(b[0]) + ' and ' + f3(b[1]) + ' times: the waters rearrange along the axis instead of being cut off.';
})();
const P = Core.setup(Pm.build({}).s);
html = html.split('{{LADDER}}').join(ladderHtml()).split('{{PRESET_OPTIONS}}').join(presetHtml()).split('{{CP2K_TABLE}}').join(cp.table).split('{{CP2K_CAVEATS}}').join(cp.caveats)
  .split('{{REGISTRY_TABLE}}').join(registryHtml()).split('{{VALIDATION}}').join(validationHtml()).split('{{NODES}}').join(String(P.n)).split('{{C_FEED}}').join('the set concentration').split('{{CLOSURE_CMP}}').join(closureCmp).split('{{SHELL_RATIO}}').join(shellRatio).split('{{VERSION}}').join(VERSION);
// numbered references
const order = [];
html = html.replace(/\{\{R:([a-z0-9]+)\}\}/g, (m, key) => {
  if (!REFS[key]) throw new Error('unknown reference ' + key);
  if (!order.includes(key)) order.push(key);
  const n = order.indexOf(key) + 1;
  return '<sup class="ion-cite"><a href="#ref-' + key + '">[' + n + ']</a></sup>';
});
for (const k of EVIDENCE_REFS) if (!order.includes(k)) order.push(k);
const refsHtml = order.map((k) => {
  const t = REFS[k], doi = (t.match(/doi:(\S+)$/) || [])[1];
  return '<li id="ref-' + k + '">' + (doi ? t.replace(/doi:(\S+)$/, '<a href="https://doi.org/' + doi + '">doi:' + doi + '</a>') : t) + '</li>';
}).join('\n          ');
html = html.split('{{REFERENCES}}').join(refsHtml);
const left = html.match(/\{\{[A-Z_:a-z0-9]+\}\}/g);
if (left) throw new Error('unrendered tokens: ' + left.join(', '));
fs.writeFileSync(path.join(ROOT, 'lab/continuum/index.html'), html);
console.log('wrote lab/continuum/index.html (' + (html.length / 1024).toFixed(1) + ' kB), ' + order.length + ' references, ' + P.n + ' nodes');
