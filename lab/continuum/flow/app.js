/* Continuum Lab — flow benchmark page.
   Reads flow/data/cases.json and flow/data/validation.json, evaluates the model with flow/core.js (ContinuumFlow) and
   draws the cutaway, the velocity plot and the tables. No third-party code; the only requests are those two files.
   Test hook: window.__flowLab.state(). */
(function () {
  'use strict';
  var F = window.ContinuumFlow, root = document.getElementById('flow-lab');
  if (!F || !root) return;
  var $ = function (id) { return document.getElementById(id); };
  var NS = 'http://www.w3.org/2000/svg', MINUS = '−', PI = Math.PI;
  var FAMILY = { classical: 'classical model, no slip', slip_velocity: 'slip-velocity form' };
  var FAMILY_CAP = { classical: 'Classical model, no slip', slip_velocity: 'Slip-velocity form' };
  var BOUNDARY = { D: 'the wall position D', Dp: 'the first density peak D′' };
  var BSHORT = { D: 'D', Dp: 'D′' };
  var VIS = { interfacial: 'interfacial viscosity', green_kubo: 'Green–Kubo viscosity', experimental: 'experimental viscosity' };
  var DEFAULT = { family: 'slip_velocity', boundary: 'D', viscosity: 'interfacial' };
  var COL = { classical: '#8590A0', model: '#006B62', md: '#16324F', grid: '#E6ECF0', axis: '#718096', text: '#243447', muted: '#526477' };
  var TIME_SCALE = 0.4;                       // nanoseconds of flow per second on screen
  var reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var S = { data: null, validation: null, validationError: null, cs: null, drive: null,
            choice: { family: DEFAULT.family, boundary: DEFAULT.boundary, viscosity: DEFAULT.viscosity },
            compare: false, ends: false, out: null, playing: !reduceQuery.matches, message: '' };
  var CUT = { t: 0, last: 0, raf: 0, frames: 0, tracers: [], visible: true };

  // ------------------------------------------------------------------ formatting
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  /* three significant figures, plain decimals in the ranges used on this page */
  function f3(x) {
    if (x === null || x === undefined || !isFinite(x)) return '–';
    if (x === 0) return '0';
    var s = Number(x).toPrecision(3);
    if (/e/.test(s)) s = String(Number(s));
    return s.replace('-', MINUS);
  }
  function fu(x) { var s = Number(x).toPrecision(2); if (/e/.test(s)) s = String(Number(s)); return s; }     // an uncertainty: two figures
  /* a value as given in the case sheet, with its extraction uncertainty when one is stated */
  function given(q, unit) {
    var hasU = typeof q.u === 'number', dec = hasU ? (String(q.u).split('.')[1] || '').length : 0;
    return (hasU ? Number(q.value).toFixed(dec) + ' ± ' + q.u : String(q.value)) + (unit ? ' ' + unit : '');
  }
  function pct(x) { if (x === null || x === undefined || !isFinite(x)) return '–'; var v = 100 * x; return (v < 0 ? MINUS : '+') + Math.abs(v).toFixed(1) + ' %'; }
  function pctU(x) { return (100 * x).toFixed(1) + ' %'; }
  /* a signed difference with its standard uncertainty, both in per cent */
  function pctPM(x, u) { return u === null || u === undefined ? pct(x) : pct(x).replace(' %', '') + ' ± ' + pctU(u); }
  function svg(tag, attrs, text) {
    var e = document.createElementNS(NS, tag), k;
    for (k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ------------------------------------------------------------------ model
  function baseChoice() { return { family: S.choice.family, boundary: S.choice.boundary, viscosity: S.choice.viscosity, drive: S.drive }; }
  function withEnds(ch) { var o = {}, k; for (k in ch) o[k] = ch[k]; o.ends = true; o.c = 3; return o; }
  function compute() {
    var cs = S.cs, ch = baseChoice();
    var spec = F.specFromCase(cs, ch), noEnds = F.evaluate(spec);
    var uQ = F.flowUncertainty(cs, ch).Q_m3_s;
    var res = S.ends ? F.evaluate(F.specFromCase(cs, withEnds(ch))) : noEnds;
    var classical = F.evaluate(F.specFromCase(cs, { family: 'classical', boundary: ch.boundary, viscosity: ch.viscosity, drive: S.drive }));
    var other = null, ob = ch.boundary === 'D' ? 'Dp' : 'D';
    if (S.compare) {
      var och = { family: ch.family, boundary: ob, viscosity: ch.viscosity, drive: S.drive };
      other = F.evaluate(F.specFromCase(cs, S.ends ? withEnds(och) : och));
    }
    S.out = { spec: spec, noEnds: noEnds, res: res, cmp: F.compare(cs, res, S.ends ? undefined : uQ), uQ: S.ends ? null : uQ,
              classical: classical, other: other, otherBoundary: ob };
  }
  function describe() {
    return FAMILY_CAP[S.choice.family] + ' at ' + BOUNDARY[S.choice.boundary] + ' with the ' + VIS[S.choice.viscosity] +
      (S.ends ? ', with end resistance (c = 3, assumed)' : '');
  }

  // ------------------------------------------------------------------ controls
  function fillControls() {
    var sel = $('fb-case'), dsel = $('fb-drive'), cs = S.cs, g = cs.geometry, v = cs.viscosity_mPa_s;
    sel.innerHTML = S.data.cases.map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (c.enabled ? '' : ' disabled') + (c.id === cs.id ? ' selected' : '') + '>' + esc(c.short) + (c.enabled ? '' : ' (not yet enabled)') + '</option>';
    }).join('');
    dsel.innerHTML = cs.drives.map(function (d) { return '<option value="' + esc(d.id) + '">' + esc(d.label) + '</option>'; }).join('');
    $('fb-evidence').textContent = cs.evidence;
    $('fb-evidence-note').textContent = cs.evidence_short || cs.evidence_note;
    $('fb-lab-D').innerHTML = 'Wall position <i>D</i> = ' + esc(g.D_nm.value) + ' nm (carbon centres)';
    $('fb-lab-Dp').innerHTML = 'First density peak <i>D</i>′ = ' + f3(g.Dp_nm.value) + ' nm';
    ['interfacial', 'green_kubo', 'experimental'].forEach(function (k) {
      $('fb-lab-' + k).textContent = v[k].label.replace(' viscosity', '') + ', ' + f3(v[k].value) + ' mPa·s';
    });
  }
  function syncInputs() {
    ['family', 'boundary', 'viscosity'].forEach(function (k) {
      Array.prototype.forEach.call(document.querySelectorAll('input[name="fb-' + k + '"]'), function (i) { i.checked = i.value === S.choice[k]; });
    });
    $('fb-compare').checked = S.compare; $('fb-ends').checked = S.ends;
    $('fb-case').value = S.cs.id; $('fb-drive').value = S.drive;
  }

  // ------------------------------------------------------------------ results
  function renderTiles() {
    var o = S.out, cs = S.cs, md = cs.md, cmp = o.cmp, n = cmp.points_compared;
    $('fb-q').textContent = f3(o.res.Q_m3_s * 1e15) + ' pL/s';
    $('fb-q-s').textContent = (o.uQ !== null ? '± ' + fu(o.uQ * 1e15) + ' pL/s from reading the figures · ' : 'with end resistance · ') +
      'molecular dynamics ' + given(md.flow_pL_s, 'pL/s');
    $('fb-v').textContent = f3(o.res.mean_velocity_m_s) + ' m/s';
    $('fb-v-s').textContent = S.choice.boundary === 'D'
      ? 'molecular dynamics ' + f3(cmp.mean_velocity_md_m_s) + ' m/s · flow rate over the cross-section at the wall position'
      : 'over the cross-section at D′ · molecular dynamics ' + f3(cmp.mean_velocity_md_m_s) + ' m/s over the cross-section at the wall position';
    $('fb-d').textContent = pct(cmp.Q_rel);
    $('fb-d-s').textContent = (cmp.Q_rel_u !== null ? '± ' + pctU(cmp.Q_rel_u) + ' from reading the figures · ' : '') +
      'profile: rms ' + pctU(cmp.profile_rms_rel) + ', largest ' + pct(cmp.profile_worst_rel) + ' at ' + n + ' points · reported, not judged';
    var twice = S.choice.family === DEFAULT.family && S.choice.boundary === DEFAULT.boundary && S.choice.viscosity === DEFAULT.viscosity && !S.ends ? sourceTwice() : null;
    $('fb-state').textContent = describe() + ': ' + f3(o.res.Q_m3_s * 1e15) + ' pL/s, ' + pct(cmp.Q_rel) + ' from molecular dynamics.' +
      (twice ? ' The source’s own figures put this combination at ' + pct(twice.relA) + ' (Fig. 7c) and ' + pct(twice.relB) + ' (Fig. 9b).' : '') + (S.message ? ' ' + S.message : '');
  }
  function renderParams() {
    var o = S.out, cs = S.cs, sp = o.spec, r = o.noEnds, d = cs.drives[0], v = cs.viscosity_mPa_s[S.choice.viscosity], sv = cs.slip_velocity_m_s[S.choice.boundary];
    var rows = [
      ['Radius <i>R</i> = ' + (S.choice.boundary === 'D' ? '<i>D</i>/2' : '<i>D</i>′/2'), f3(sp.R_m * 1e9) + ' nm'],
      ['Tube length <i>L</i>', f3(sp.L_m * 1e9) + ' nm'],
      ['Pressure drop Δ<i>P</i>', given(d.dP_MPa, 'MPa')],
      ['Gradient <i>G</i> = Δ<i>P</i>/<i>L</i>', f3(F.units.Pa_per_m_to_MPa_per_nm(r.gradient_Pa_m)) + ' MPa/nm'],
      ['Viscosity <i>μ</i>', given(v, 'mPa·s')],
      ['Slip velocity <i>u</i><sub>s</sub>', S.choice.family === 'slip_velocity' ? given(sv, 'm/s') : 'not used (no slip)'],
      ['Parabolic part on the axis, <i>R</i>²<i>G</i>/4<i>μ</i>', f3(r.amplitude_m_s) + ' m/s'],
      ['Equivalent slip length 2<i>μu</i><sub>s</sub>/(<i>GR</i>)', S.choice.family === 'slip_velocity' ? f3(r.equivalent_slip_length_m * 1e9) + ' nm' : '0']
    ];
    $('fb-params').innerHTML = rows.map(function (x) { return '<div><dt>' + x[0] + '</dt><dd>' + esc(x[1]) + '</dd></div>'; }).join('');
  }
  function renderSensitivities() {
    var o = S.out, co = $('fb-compare-out'), eo = $('fb-ends-out');
    if (S.compare && o.other) {
      var a = o.res.Q_m3_s * 1e15, b = o.other.Q_m3_s * 1e15;
      co.hidden = false;
      co.textContent = 'Flow rate at ' + BOUNDARY[S.choice.boundary] + ': ' + f3(a) + ' pL/s; at ' + BOUNDARY[o.otherBoundary] + ': ' + f3(b) + ' pL/s. The definition moves the flow rate by ' + pct(b / a - 1) + '.';
    } else { co.hidden = true; co.textContent = ''; }
    if (S.ends && o.res.ends) {
      var e = o.res.ends, dPmd = e.R_ends * o.cmp.Q_md_m3_s, dP = o.spec.dP_Pa;
      eo.hidden = false;
      eo.innerHTML = '<dl class="cl-tube-readout fb-params">' +
        '<div><dt>Equivalent slip length of the wall</dt><dd>' + f3(o.res.equivalent_slip_length_m * 1e9) + ' nm</dd></div>' +
        '<div><dt>End resistance over tube resistance</dt><dd>' + f3(e.R_ends / e.R_tube) + '</dd></div>' +
        '<div><dt>Share of Δ<i>P</i> inside the tube</dt><dd>' + pctU(e.interior_fraction) + '</dd></div>' +
        '<div><dt>Flow rate with end resistance</dt><dd>' + f3(o.res.Q_m3_s * 1e15) + ' pL/s, ' + pctU(e.interior_fraction) + ' of ' + f3(o.noEnds.Q_m3_s * 1e15) + ' pL/s</dd></div>' +
        '</dl>' +
        '<p class="cl-small" id="fb-ends-note">With <i>c</i> = 3, the molecular-dynamics flow rate would need ' + f3(dPmd / 1e6) + ' MPa across the two ends alone, ' +
        (dPmd > dP ? 'more than' : 'out of') + ' the ' + given(S.cs.drives[0].dP_MPa, 'MPa') + ' applied. ' +
        (dPmd > dP ? 'With this viscosity and radius, <i>c</i> = 3 therefore overstates the end loss of this simulation. Read the result as an upper-end sensitivity, not as an estimate.' : 'The value of <i>c</i> for this simulation is not known.') + '</p>';
    } else { eo.hidden = true; eo.innerHTML = ''; }
  }

  // ------------------------------------------------------------------ velocity plot (SVG)
  var PLOT = { W: 560, H: 340, L: 56, R: 16, T: 28, B: 46, xmax: 1.4, ymax: 6 };
  function px(r) { return PLOT.L + (PLOT.W - PLOT.L - PLOT.R) * r / PLOT.xmax; }
  function py(u) { return PLOT.H - PLOT.B - (PLOT.H - PLOT.T - PLOT.B) * u / PLOT.ymax; }
  /* model velocity at a radius given in nm; the last sample of a curve is placed on the boundary itself */
  function uAt(res, rnm) { return res.u(Math.min(Math.abs(rnm) * 1e-9, res.R_m)); }
  function curvePath(res, n) {
    var R = res.R_m * 1e9, d = '', i, r;
    for (i = 0; i <= n; i++) { r = R * i / n; d += (i ? 'L' : 'M') + px(r).toFixed(2) + ' ' + py(uAt(res, r)).toFixed(2); }
    return d;
  }
  /* the plot is drawn at the width it is shown at, so that its lettering keeps its size on a phone */
  function sizePlot() {
    var wrap = $('fb-plot-wrap'), w = Math.max(300, Math.min(560, Math.round((wrap ? wrap.clientWidth : 560) - 10)));
    var changed = w !== PLOT.W;
    PLOT.W = w; PLOT.H = w >= 480 ? 340 : Math.round(0.84 * w); PLOT.L = w >= 480 ? 56 : 46; PLOT.R = w >= 480 ? 16 : 12;
    return changed;
  }
  function renderPlot() {
    var el = $('fb-plot'), o = S.out, cs = S.cs, g = cs.geometry, i;
    sizePlot();
    el.setAttribute('viewBox', '0 0 ' + PLOT.W + ' ' + PLOT.H);
    while (el.firstChild) el.removeChild(el.firstChild);
    var x0 = px(0), x1 = px(PLOT.xmax), y0 = py(0), y1 = py(PLOT.ymax);
    var gGrid = svg('g', { 'class': 'fb-grid' }), gAx = svg('g', { 'class': 'fb-axis' });
    for (i = 0; i <= 6; i++) {
      if (i) gGrid.appendChild(svg('line', { x1: x0, x2: x1, y1: py(i), y2: py(i), stroke: COL.grid, 'stroke-width': 1 }));
      gAx.appendChild(svg('text', { x: x0 - 8, y: py(i) + 4, 'text-anchor': 'end', 'class': 'fb-tick' }, String(i)));
    }
    for (i = 0; i <= 7; i++) {
      var xv = 0.2 * i;
      gAx.appendChild(svg('line', { x1: px(xv), x2: px(xv), y1: y0, y2: y0 + 5, stroke: COL.axis, 'stroke-width': 1 }));
      gAx.appendChild(svg('text', { x: px(xv), y: y0 + 18, 'text-anchor': 'middle', 'class': 'fb-tick' }, xv === 0 ? '0' : xv.toFixed(1)));
    }
    gAx.appendChild(svg('line', { x1: x0, x2: x1, y1: y0, y2: y0, stroke: COL.axis, 'stroke-width': 1 }));
    gAx.appendChild(svg('line', { x1: x0, x2: x0, y1: y0, y2: y1, stroke: COL.axis, 'stroke-width': 1 }));
    gAx.appendChild(svg('text', { x: (x0 + x1) / 2, y: PLOT.H - 8, 'text-anchor': 'middle', 'class': 'fb-axis-title' }, 'distance from the tube axis, r (nm)'));
    gAx.appendChild(svg('text', { x: 14, y: (y0 + y1) / 2, 'text-anchor': 'middle', transform: 'rotate(-90 14 ' + ((y0 + y1) / 2) + ')', 'class': 'fb-axis-title' }, 'axial velocity, u (m/s)'));
    el.appendChild(gGrid);

    // the two boundary positions
    var gB = svg('g', { 'class': 'fb-bounds' });
    [['Dp', 0.5 * g.Dp_nm.value, 'D′/2'], ['D', 0.5 * g.D_nm.value, 'D/2']].forEach(function (b) {
      var sel = b[0] === S.choice.boundary;
      gB.appendChild(svg('line', { x1: px(b[1]), x2: px(b[1]), y1: y0, y2: y1 - 4, stroke: sel ? COL.muted : '#B8C4CE', 'stroke-width': 1, 'data-boundary': b[0] }));
      gB.appendChild(svg('text', { x: px(b[1]), y: y1 - 9, 'text-anchor': 'middle', 'class': 'fb-bound-label' + (sel ? ' is-sel' : '') }, b[2]));
    });
    el.appendChild(gB);

    // boundary-choice sensitivity: the same model at the other boundary, and the band between the two curves
    var gS = svg('g', { 'class': 'fb-series' });
    if (S.compare && o.other) {
      var Rm = Math.min(o.res.R_m, o.other.R_m) * 1e9, n = 60, d = '', r;
      for (i = 0; i <= n; i++) { r = Rm * i / n; d += (i ? 'L' : 'M') + px(r).toFixed(2) + ' ' + py(uAt(o.res, r)).toFixed(2); }
      for (i = n; i >= 0; i--) { r = Rm * i / n; d += 'L' + px(r).toFixed(2) + ' ' + py(uAt(o.other, r)).toFixed(2); }
      gS.appendChild(svg('path', { d: d + 'Z', fill: COL.model, 'fill-opacity': 0.13, stroke: 'none', id: 'fb-band', 'data-label': 'Boundary-choice sensitivity' }));
      gS.appendChild(svg('path', { d: curvePath(o.other, 80), fill: 'none', stroke: COL.model, 'stroke-width': 1.6, 'stroke-dasharray': '2 4', 'stroke-linecap': 'round', id: 'fb-curve-other' }));
      var rm = 0.66 * Rm, ym = 0.5 * (uAt(o.res, rm) + uAt(o.other, rm));
      if (Math.abs(py(uAt(o.res, rm)) - py(uAt(o.other, rm))) >= 26)      // a thin band is named by the legend only
        gS.appendChild(svg('text', { x: px(rm), y: py(ym) + 4, 'text-anchor': 'middle', 'class': 'fb-band-label', id: 'fb-band-label' }, 'Boundary-choice sensitivity'));
    }
    var same = S.choice.family === 'classical' && !S.ends;
    if (!same) gS.appendChild(svg('path', { d: curvePath(o.classical, 80), fill: 'none', stroke: COL.classical, 'stroke-width': 2, 'stroke-dasharray': '7 5', id: 'fb-curve-classical' }));
    gS.appendChild(svg('path', { d: curvePath(o.res, 80), fill: 'none', stroke: COL.model, 'stroke-width': 2.5, 'stroke-linecap': 'round', id: 'fb-curve-model' }));
    // molecular-dynamics points: a surface ring keeps them readable where they meet a curve
    cs.md.profile.r_nm.forEach(function (r, k) {
      gS.appendChild(svg('circle', { cx: px(r), cy: py(cs.md.profile.u_m_s[k]), r: 4.6, fill: COL.md, stroke: '#FFFFFF', 'stroke-width': 2, 'class': 'fb-md', 'data-r': r, 'data-u': cs.md.profile.u_m_s[k] }));
    });
    // selective direct labels at the axis end of each curve: of two model curves the upper is labelled above and the
    // lower below; the classical label moves, or is left to the legend, if it would touch another label
    var ySel = py(o.res.u(0)), yOth = S.compare && o.other ? py(o.other.u(0)) : null, selAbove = yOth === null || ySel <= yOth;
    var yLabSel = selAbove ? ySel - 9 : ySel + 16, yLabOth = yOth === null ? null : (selAbove ? yOth + 16 : yOth - 9);
    var yCla = py(o.classical.u(0)), yLabCla = same ? null : yCla - 9;
    function touches(y) { return [yLabSel, yLabOth].some(function (q) { return q !== null && Math.abs(q - y) < 15; }); }
    if (yLabCla !== null && touches(yLabCla)) yLabCla = (y0 - yCla > 34 && !touches(yCla + 16)) ? yCla + 16 : null;
    if (yLabCla !== null && yOth !== null && (Math.abs(yCla - yOth) < 40 || Math.abs(yCla - ySel) < 40)) yLabCla = null;   // three curves close together: the legend names it
    gS.appendChild(svg('text', { x: px(0.03), y: yLabSel, 'class': 'fb-direct', id: 'fb-label-model' }, same ? 'classical, no slip (selected)' : (S.choice.family === 'classical' ? 'classical' : 'slip-velocity form') + ' at ' + BSHORT[S.choice.boundary] + (S.ends ? ', with end resistance' : '')));
    if (yLabOth !== null) gS.appendChild(svg('text', { x: px(0.03), y: yLabOth, 'class': 'fb-direct', id: 'fb-label-other' }, 'same model at ' + BSHORT[o.otherBoundary]));
    if (yLabCla !== null) gS.appendChild(svg('text', { x: px(0.03), y: yLabCla, 'class': 'fb-direct', id: 'fb-label-classical' }, 'classical, no slip'));
    var mdMin = Math.min.apply(null, cs.md.profile.u_m_s);
    gS.appendChild(svg('text', { x: px(cs.md.profile.r_nm[1]), y: py(mdMin) + 20, 'text-anchor': 'middle', 'class': 'fb-direct' }, 'molecular dynamics'));
    el.appendChild(gS);
    el.appendChild(gAx);
    // hover layer
    el.appendChild(svg('line', { id: 'fb-cross', x1: 0, x2: 0, y1: y0, y2: y1, stroke: COL.muted, 'stroke-width': 1, visibility: 'hidden' }));
    el.appendChild(svg('rect', { id: 'fb-hit', x: x0, y: y1, width: x1 - x0, height: y0 - y1, fill: 'transparent' }));
    el.setAttribute('aria-label', 'Velocity profile across the tube. ' + describe() + '. Model on the axis ' + f3(o.res.u(0)) + ' m/s, at the boundary ' + f3(o.res.wall_velocity_m_s) + ' m/s; molecular dynamics between ' + f3(mdMin) + ' and ' + f3(Math.max.apply(null, cs.md.profile.u_m_s)) + ' m/s.');
    renderLegend(same);
    hideTip();
  }
  function renderLegend(same) {
    var items = [];
    items.push('<li><span class="fb-key fb-key-model" aria-hidden="true"></span>Selected model: ' + esc(FAMILY[S.choice.family]) + ' at ' + esc(BSHORT[S.choice.boundary]) + (S.ends ? ', with end resistance' : '') + '</li>');
    if (!same) items.push('<li><span class="fb-key fb-key-classical" aria-hidden="true"></span>Classical, no slip (Eqs. 1–2)</li>');
    items.push('<li><span class="fb-key fb-key-md" aria-hidden="true"></span>Molecular dynamics, Fig. 6a of the source (read from the figure, ±' + S.cs.md.profile.u_u_m_s + ' m/s)</li>');
    if (S.compare && S.out.other) {
      items.push('<li><span class="fb-key fb-key-other" aria-hidden="true"></span>Same model at ' + esc(BSHORT[S.out.otherBoundary]) + '</li>');
      items.push('<li><span class="fb-key fb-key-band" aria-hidden="true"></span>Boundary-choice sensitivity (not an uncertainty)</li>');
    }
    items.push('<li class="fb-legend-hint" id="fb-plot-help">Point at the plot, or focus it and press the arrow keys, to read values.</li>');
    $('fb-legend').innerHTML = items.join('');
  }
  var tipIndex = -1;
  function showTip(r) {
    var o = S.out, cs = S.cs, el = $('fb-plot'), tip = $('fb-tip'), wrap = $('fb-plot-wrap'), cross = $('fb-cross');
    r = Math.max(0, Math.min(PLOT.xmax, r));
    var lines = ['<b>r = ' + r.toFixed(2) + ' nm</b>'], near = -1, best = 0.05, i;
    for (i = 0; i < cs.md.profile.r_nm.length; i++) if (Math.abs(cs.md.profile.r_nm[i] - r) < best) { best = Math.abs(cs.md.profile.r_nm[i] - r); near = i; }
    lines.push('<span class="fb-key fb-key-model" aria-hidden="true"></span>model ' + (r * 1e-9 <= o.res.R_m ? f3(o.res.u(r * 1e-9)) + ' m/s' : 'outside its boundary'));
    if (!(S.choice.family === 'classical' && !S.ends)) lines.push('<span class="fb-key fb-key-classical" aria-hidden="true"></span>classical ' + (r * 1e-9 <= o.classical.R_m ? f3(o.classical.u(r * 1e-9)) + ' m/s' : 'outside its boundary'));
    if (S.compare && o.other) lines.push('<span class="fb-key fb-key-other" aria-hidden="true"></span>at ' + BSHORT[o.otherBoundary] + ' ' + (r * 1e-9 <= o.other.R_m ? f3(o.other.u(r * 1e-9)) + ' m/s' : 'outside its boundary'));
    if (near >= 0) lines.push('<span class="fb-key fb-key-md" aria-hidden="true"></span>molecular dynamics ' + f3(cs.md.profile.u_m_s[near]) + ' m/s at ' + cs.md.profile.r_nm[near] + ' nm');
    tip.innerHTML = lines.join('<br>');
    tip.hidden = false;
    cross.setAttribute('x1', px(r)); cross.setAttribute('x2', px(r)); cross.setAttribute('visibility', 'visible');
    var box = el.getBoundingClientRect(), wb = wrap.getBoundingClientRect(), k = box.width / PLOT.W;
    var left = box.left - wb.left + px(r) * k + 10, tw = tip.offsetWidth;
    if (left + tw > wb.width - 4) left = box.left - wb.left + px(r) * k - tw - 10;
    tip.style.left = Math.max(4, left) + 'px';
    tip.style.top = (box.top - wb.top + py(PLOT.ymax) * k + 6) + 'px';
  }
  function hideTip() { var t = $('fb-tip'), c = $('fb-cross'); if (t) t.hidden = true; if (c) c.setAttribute('visibility', 'hidden'); tipIndex = -1; }
  function plotEvents() {
    var el = $('fb-plot');
    el.addEventListener('pointermove', function (ev) {
      var box = el.getBoundingClientRect(), x = (ev.clientX - box.left) * PLOT.W / box.width, y = (ev.clientY - box.top) * PLOT.H / box.height;
      if (x < px(0) || x > px(PLOT.xmax) || y < py(PLOT.ymax) || y > py(0)) { hideTip(); return; }
      showTip((x - px(0)) / (px(PLOT.xmax) - px(0)) * PLOT.xmax);
    });
    el.addEventListener('pointerleave', hideTip);
    el.addEventListener('blur', hideTip);
    el.addEventListener('keydown', function (ev) {
      var rs = S.cs.md.profile.r_nm;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
        tipIndex = tipIndex < 0 ? (ev.key === 'ArrowRight' ? 0 : rs.length - 1) : Math.max(0, Math.min(rs.length - 1, tipIndex + (ev.key === 'ArrowRight' ? 1 : -1)));
        var keepIndex = tipIndex; showTip(rs[tipIndex]); tipIndex = keepIndex; ev.preventDefault();
      } else if (ev.key === 'Escape') hideTip();
    });
  }

  // ------------------------------------------------------------------ cutaway (canvas)
  function initTracers() {
    var n = 84, golden = 0.6180339887498949, i;
    CUT.tracers = [];
    for (i = 0; i < n; i++) CUT.tracers.push({ y: ((i + 0.5) / n) * 2 - 1, x0: (i * golden) % 1 });
  }
  function drawCutaway() {
    var cv = $('fb-canvas'), o = S.out; if (!cv || !o) return;
    var box = cv.getBoundingClientRect(), w = Math.max(1, box.width), h = Math.max(1, box.height), dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    var c = cv.getContext('2d'); if (!c) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    var cs = S.cs, Lnm = o.spec.L_m * 1e9, RD = 0.5 * cs.geometry.D_nm.value, RP = 0.5 * cs.geometry.Dp_nm.value, Rsel = o.res.R_m * 1e9;
    var small = w < 420, padX = small ? 14 : 28, font = small ? 11 : 12.5;
    var sc = Math.min((w - 2 * padX) / Lnm, (h - (small ? 104 : 124)) / (2 * RD));
    var xL = (w - Lnm * sc) / 2, xR = xL + Lnm * sc, yc = h / 2 + 2;
    var TXT = '#E9EEF3', MUT = '#A7B6C6', ACC = '#62D6C2';
    c.font = '500 ' + font + 'px "IBM Plex Sans", system-ui, sans-serif'; c.textBaseline = 'alphabetic';
    // liquid inside the selected boundary
    c.fillStyle = 'rgba(98, 214, 194, 0.07)'; c.fillRect(xL, yc - Rsel * sc, xR - xL, 2 * Rsel * sc);
    if (S.choice.boundary === 'Dp') {                                  // the layer between D′ and the wall lies outside the model
      c.fillStyle = 'rgba(167, 182, 198, 0.10)';
      c.fillRect(xL, yc - RD * sc, xR - xL, (RD - RP) * sc); c.fillRect(xL, yc + RP * sc, xR - xL, (RD - RP) * sc);
    }
    // axis
    c.strokeStyle = 'rgba(233, 238, 243, 0.22)'; c.lineWidth = 1; c.setLineDash([10, 4, 2, 4]);
    c.beginPath(); c.moveTo(xL, yc); c.lineTo(xR, yc); c.stroke();
    // first density peak
    c.setLineDash([5, 5]); c.strokeStyle = MUT; c.lineWidth = 1.2;
    [-1, 1].forEach(function (s) { c.beginPath(); c.moveTo(xL, yc + s * RP * sc); c.lineTo(xR, yc + s * RP * sc); c.stroke(); });
    c.setLineDash([]);
    // carbon wall: one dot per half unit cell of the armchair tube (0.123 nm), schematic
    c.fillStyle = '#C3CFDA';
    var step = 0.123 * sc, nAt = Math.floor((xR - xL) / step), k;
    [-1, 1].forEach(function (s) { for (k = 0; k <= nAt; k++) { c.beginPath(); c.arc(xL + k * step, yc + s * RD * sc, small ? 1.6 : 2.2, 0, 2 * PI); c.fill(); } });
    // tracers of the selected model
    c.save(); c.beginPath(); c.rect(xL, yc - Rsel * sc, xR - xL, 2 * Rsel * sc); c.clip();
    c.lineCap = 'round';
    CUT.tracers.forEach(function (tr) {
      var r = Math.abs(tr.y) * Rsel, u = o.res.u(r * 1e-9), len = Math.max(1.5, Math.abs(u) * (small ? 4 : 6));
      var x = ((tr.x0 * Lnm + u * TIME_SCALE * CUT.t) % Lnm + Lnm) % Lnm, X = xL + x * sc, Y = yc + tr.y * Rsel * sc * 0.985, dir = u >= 0 ? 1 : -1, j;
      for (j = -1; j <= 1; j++) {                                      // draw the wrapped copies so that a streak crossing an end stays whole
        var Xj = X + j * Lnm * sc; if (Xj < xL - len - 4 || Xj > xR + len + 4) continue;
        c.strokeStyle = 'rgba(98, 214, 194, 0.45)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(Xj - dir * len, Y); c.lineTo(Xj, Y); c.stroke();
        c.fillStyle = ACC; c.beginPath(); c.arc(Xj, Y, 2.1, 0, 2 * PI); c.fill();
      }
    });
    c.restore();
    // labels; those inside the tube get a backing so that tracers do not strike through them
    function tag(text, x, y, align, colour) {
      var tw = c.measureText(text).width, x0 = align === 'right' ? x - tw : x;
      c.fillStyle = 'rgba(13, 27, 42, 0.86)'; c.fillRect(x0 - 5, y - font, tw + 10, font + 6);
      c.fillStyle = colour; c.textAlign = align; c.fillText(text, x, y);
    }
    c.fillStyle = TXT; c.textAlign = 'left';
    c.fillText('carbon wall, D = ' + cs.geometry.D_nm.value + ' nm', xL, yc - RD * sc - 12);
    tag('first density peak, D′ = ' + f3(cs.geometry.Dp_nm.value) + ' nm', xR - 8, yc - RP * sc - 8, 'right', MUT);
    if (S.choice.boundary === 'Dp') tag('outside the model', xL + 8, yc + RP * sc + (RD - RP) * sc / 2 + 4, 'left', MUT);
    // drive and direction
    var yb = yc + RD * sc + 26;
    c.fillStyle = TXT; c.textAlign = 'left';
    c.fillText('ΔP = ' + cs.drives[0].dP_MPa.value + ' MPa over L = ' + f3(Lnm) + ' nm', xL, yb);
    c.strokeStyle = ACC; c.fillStyle = ACC; c.lineWidth = 1.6;
    var ax0 = xR - (small ? 62 : 84), ax1 = xR - 4;
    c.beginPath(); c.moveTo(ax0, yb - 4); c.lineTo(ax1, yb - 4); c.stroke();
    c.beginPath(); c.moveTo(ax1, yb - 4); c.lineTo(ax1 - 8, yb - 8.5); c.lineTo(ax1 - 8, yb + 0.5); c.closePath(); c.fill();
    c.textAlign = 'right'; c.fillStyle = TXT; c.fillText('flow', ax0 - 6, yb);
    // scale bar and clock
    var yS = h - 14;
    c.strokeStyle = TXT; c.lineWidth = 1.5; c.beginPath(); c.moveTo(xL, yS - 4); c.lineTo(xL + sc, yS - 4); c.moveTo(xL, yS - 8); c.lineTo(xL, yS); c.moveTo(xL + sc, yS - 8); c.lineTo(xL + sc, yS); c.stroke();
    c.fillStyle = MUT; c.textAlign = 'left'; c.fillText('1 nm', xL + sc + 8, yS);
    c.textAlign = 'right'; c.fillText('1 s on screen = ' + TIME_SCALE + ' ns', xR, yS);
    CUT.frames += 1;
  }
  function tick(now) {
    CUT.raf = 0;
    if (!S.playing || !CUT.visible || document.hidden) { CUT.last = 0; return; }
    if (CUT.last) CUT.t += Math.min(0.1, (now - CUT.last) / 1000);
    CUT.last = now;
    drawCutaway();
    CUT.raf = window.requestAnimationFrame(tick);
  }
  function startLoop() { if (!CUT.raf && S.playing && CUT.visible && !document.hidden) { CUT.last = 0; CUT.raf = window.requestAnimationFrame(tick); } }
  function setPlaying(on) {
    S.playing = !!on;
    $('fb-play').textContent = S.playing ? 'Pause' : 'Play';
    $('fb-cutaway-note').textContent = 'Cutaway along the tube axis. The tracers move with the selected model; they are not molecules.' +
      (reduceQuery.matches && !S.playing ? ' Motion is off because your system asks for reduced motion; Play starts it.' : '');
    if (S.playing) startLoop(); else drawCutaway();
  }

  // ------------------------------------------------------------------ tables
  /* the two published values of the default combination, when the case sheet has both */
  function sourceTwice() {
    var fl = S.cs.source_curves && S.cs.source_curves.flow_pL_s, md = S.cs.md.flow_pL_s.value;
    if (!fl || !fl.D_interfacial || !fl.D_interfacial_fig9b) return null;
    return { a: fl.D_interfacial, b: fl.D_interfacial_fig9b, relA: fl.D_interfacial.value / md - 1, relB: fl.D_interfacial_fig9b.value / md - 1 };
  }
  function renderAgreement() {
    var o = S.out, cs = S.cs, cmp = o.cmp, h = '';
    h += '<p>Differences between the model and the published molecular-dynamics values of the same simulation. They are reported as numbers and carry no PASS or FAIL: no accuracy requirement has been defined for a stated use, and this case is a reconstruction (<a href="#status">status</a>).</p>';
    h += '<h3>Selected combination: ' + esc(describe().charAt(0).toLowerCase() + describe().slice(1)) + '</h3>';
    h += '<div class="cl-table-wrap"><table class="cl-table" id="fb-agree-table"><thead><tr><th scope="col">r (nm)</th><th scope="col">Molecular dynamics (m/s)</th><th scope="col">Model (m/s)</th><th scope="col">Difference</th></tr></thead><tbody>';
    cmp.profile.forEach(function (p) {
      h += '<tr><th scope="row">' + p.r_nm + '</th><td>' + f3(p.md_m_s) + '</td><td>' + (p.model_m_s === null ? 'outside the model boundary' : f3(p.model_m_s)) + '</td><td>' + (p.rel === null ? '–' : pct(p.rel)) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<p class="cl-small">Profile: root-mean-square difference ' + pctU(cmp.profile_rms_rel) + ', largest ' + pct(cmp.profile_worst_rel) + ', at ' + cmp.points_compared + ' of ' + cs.md.profile.r_nm.length + ' points. Flow rate: model ' + f3(o.res.Q_m3_s * 1e15) +
      (o.uQ !== null ? ' ± ' + fu(o.uQ * 1e15) : '') + ' pL/s, molecular dynamics ' + given(cs.md.flow_pL_s, 'pL/s') + ', difference ' + pctPM(cmp.Q_rel, cmp.Q_rel_u) +
      '. The ± values are extraction uncertainties (one standard uncertainty), not statistical uncertainties of the simulation. The points were read with ±' + cs.md.profile.u_r_nm + ' nm and ±' + cs.md.profile.u_u_m_s + ' m/s.</p>';
    var isDefault = S.choice.family === DEFAULT.family && S.choice.boundary === DEFAULT.boundary && S.choice.viscosity === DEFAULT.viscosity && !S.ends;
    var twice = sourceTwice();
    if (isDefault && twice) h += '<p class="cl-small" id="fb-source-twice">The source plots this combination twice: at ' + esc(given(twice.a, 'pL/s')) + ' in Fig. 7c and at ' + esc(given(twice.b, 'pL/s')) + ' in Fig. 9b, that is ' + pct(twice.relA) + ' and ' + pct(twice.relB) +
      ' from its molecular-dynamics value. The model returns ' + f3(o.res.Q_m3_s * 1e15) + ' pL/s from the published inputs, which reproduces Fig. 7c. Which figure matches the simulation is an open item of the case sheet.</p>';
    h += '<h3>All twelve combinations, without end resistance</h3>';
    h += '<div class="cl-table-wrap"><table class="cl-table" id="fb-combo-table"><thead><tr><th scope="col">Model</th><th scope="col">Boundary</th><th scope="col">Viscosity</th><th scope="col">Flow rate (pL/s)</th><th scope="col">Difference from MD</th><th scope="col">Profile, rms</th><th scope="col">Profile, largest</th></tr></thead><tbody>';
    ['slip_velocity', 'classical'].forEach(function (fam) { ['D', 'Dp'].forEach(function (bd) { ['interfacial', 'green_kubo', 'experimental'].forEach(function (vk) {
      var ch = { family: fam, boundary: bd, viscosity: vk, drive: S.drive }, r = F.evaluate(F.specFromCase(cs, ch)), u = F.flowUncertainty(cs, ch).Q_m3_s, cp = F.compare(cs, r, u);
      var cur = fam === S.choice.family && bd === S.choice.boundary && vk === S.choice.viscosity, dfl = fam === DEFAULT.family && bd === DEFAULT.boundary && vk === DEFAULT.viscosity;
      h += '<tr' + (cur ? ' class="is-current"' : '') + '><th scope="row">' + (fam === 'classical' ? 'Classical' : 'Slip velocity') + (dfl ? ' (default)' : '') + '</th><td>' + BSHORT[bd] + '</td><td>' + esc(VIS[vk].replace(' viscosity', '')) + '</td><td>' +
        f3(r.Q_m3_s * 1e15) + ' ± ' + fu(u * 1e15) + '</td><td>' + pctPM(cp.Q_rel, cp.Q_rel_u) + '</td><td>' + pctU(cp.profile_rms_rel) + '</td><td>' + pct(cp.profile_worst_rel) + '</td></tr>';
    }); }); });
    h += '</tbody></table></div>';
    h += '<p class="cl-small">The default was fixed by rule before the comparison. The other rows are listed so that the choice can be seen; selecting a combination because it agrees better would be tuning to this one run. At <i>D</i>′ only the ' + F.compare(cs, F.evaluate(F.specFromCase(cs, { boundary: 'Dp' }))).points_compared + ' points inside that boundary enter the profile figures.</p>';
    $('fb-agreement').innerHTML = h;
  }
  function row(k, v, s) { return '<tr><th scope="row">' + k + '</th><td>' + v + '</td><td>' + (s === undefined ? '' : esc(s)) + '</td></tr>'; }
  function renderCaseSheet() {
    var cs = S.cs, g = cs.geometry, d = cs.drives[0], v = cs.viscosity_mPa_s, sv = cs.slip_velocity_m_s, md = cs.md, sc = cs.source_curves, ex = S.data.extraction, h = '';
    h += '<p><b>' + esc(cs.label) + '.</b> ' + esc(cs.source.citation) + '. <a href="https://doi.org/' + esc(cs.source.doi) + '">doi:' + esc(cs.source.doi) + '</a>. Equations used: ' + esc(cs.source.equations) + '.</p>';
    h += '<p><b>System.</b> ' + esc(cs.system) + '.</p>';
    h += '<p><b>Evidence status: ' + esc(cs.evidence) + '.</b> ' + esc(cs.evidence_note) + '</p>';
    h += '<h3>Inputs</h3><div class="cl-table-wrap"><table class="cl-table"><thead><tr><th scope="col">Quantity</th><th scope="col">Value</th><th scope="col">Source</th></tr></thead><tbody>';
    h += row('Tube diameter <i>D</i>, carbon centres', esc(given(g.D_nm, 'nm')), g.D_nm.source);
    h += row('(<i>D</i> − <i>D</i>′)/<i>D</i>', esc(given(g.Dp_ratio)), g.Dp_ratio.source);
    h += row('First density peak <i>D</i>′', esc(given(g.Dp_nm, 'nm')), g.Dp_nm.source);
    h += row('Tube length <i>L</i>', esc(Number(g.L_nm.value).toFixed(1) + ' nm (alternative ' + Number(g.L_nm.alt).toFixed(1) + ' nm)'), g.L_nm.source);
    h += row('Pressure drop Δ<i>P</i>', esc(given(d.dP_MPa, 'MPa')), d.dP_MPa.source);
    h += row('Pressure planes', esc(d.planes), '');
    h += row('Pressure gradient', esc(d.gradient), '');
    ['interfacial', 'green_kubo', 'experimental'].forEach(function (k) { h += row(esc(v[k].label), esc(given(v[k], 'mPa·s')), v[k].source); });
    h += row('Slip velocity at <i>D</i>', esc(given(sv.D, 'm/s')), sv.D.source);
    h += row('Slip velocity at <i>D</i>′', esc(given(sv.Dp, 'm/s')), sv.Dp.source);
    h += '</tbody></table></div>';
    h += '<h3>Reference: molecular dynamics</h3><div class="cl-table-wrap"><table class="cl-table"><thead><tr><th scope="col">Quantity</th><th scope="col">Value</th><th scope="col">Source</th></tr></thead><tbody>';
    h += row('Velocity profile, <i>r</i> (nm)', esc(md.profile.r_nm.join(', ') + ' (±' + md.profile.u_r_nm + ')'), md.profile.source);
    h += row('Velocity profile, <i>u</i> (m/s)', esc(md.profile.u_m_s.join(', ') + ' (±' + md.profile.u_u_m_s + ')'), md.profile.source);
    h += row('Flow rate', esc(given(md.flow_pL_s, 'pL/s')), md.flow_pL_s.source + '; defined as ' + md.flow_pL_s.definition);
    h += '</tbody></table></div>';
    h += '<h3>Published model values used for the reproduction check</h3><div class="cl-table-wrap"><table class="cl-table"><thead><tr><th scope="col">Quantity</th><th scope="col">Value</th><th scope="col">Source</th></tr></thead><tbody>';
    [['fig6a_D', 'Model curve at <i>D</i>'], ['fig6a_Dp', 'Model curve at <i>D</i>′']].forEach(function (x) {
      var q = sc[x[0]];
      h += row(x[1], '<i>u</i> = ' + q.c0_m_s + ' − ' + q.c2_m_s_nm2 + ' <i>r</i>² (m/s, <i>r</i> in nm), to <i>r</i> = ' + q.r_end_nm + ' nm', q.source + '; parabola through ' + q.samples + ' samples, rms ' + q.rms_m_s + ' m/s');
    });
    [['D_experimental', 'Flow rate, Eq. 5 at <i>D</i>, experimental viscosity'], ['D_green_kubo', 'Flow rate, Eq. 5 at <i>D</i>, Green–Kubo viscosity'], ['D_interfacial', 'Flow rate, Eq. 5 at <i>D</i>, interfacial viscosity'], ['D_interfacial_fig9b', 'The same combination in a second figure'], ['Dp_experimental', 'Flow rate, Eq. 5 at <i>D</i>′, experimental viscosity']].forEach(function (x) {
      var q = sc.flow_pL_s[x[0]]; if (q) h += row(x[1], esc(given(q, 'pL/s')), q.source);
    });
    h += '</tbody></table></div>';
    h += '<h3>Unresolved</h3><ul>' + cs.unresolved.map(function (u) { return '<li>' + esc(u) + '</li>'; }).join('') + '</ul>';
    h += '<h3>How the values were read</h3><p>' + esc(ex.method) + '</p><p>' + esc(ex.uncertainty) + ' ' + esc(ex.checks) + '</p>';
    h += '<p class="cl-small">Machine-readable case sheet: <a href="flow/data/cases.json">flow/data/cases.json</a> (read on ' + esc(S.data.extracted) + '; script <code>' + esc(ex.script) + '</code> in the site repository).</p>';
    $('fb-case-sheet').innerHTML = h;
  }
  function chip(v) { return '<span class="cl-verdict ' + (v === 'PASS' ? 'cl-verdict-pass' : v === 'FAIL' ? 'cl-verdict-fail' : 'cl-verdict-notrun') + '">' + esc(v) + '</span>'; }
  function tally(c) { return c.PASS + ' of ' + (c.PASS + c.FAIL) + ' pass' + (c.FAIL ? ', ' + c.FAIL + ' fail' : ''); }
  function itemsTable(items) {
    return '<div class="cl-table-wrap"><table class="cl-table"><thead><tr><th scope="col">#</th><th scope="col">Check</th><th scope="col">Result</th><th scope="col">Measured</th></tr></thead><tbody>' +
      items.map(function (i) { return '<tr><th scope="row">' + esc(i.id) + '</th><td>' + esc(i.name) + '</td><td>' + chip(i.verdict) + '</td><td>' + esc(i.detail) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function renderChecks() {
    var V = S.validation, h = '';
    if (!V) { $('fb-checks').innerHTML = '<p>The check records could not be loaded' + (S.validationError ? ' (' + esc(S.validationError) + ')' : '') + '. They are in <a href="flow/data/validation.json">flow/data/validation.json</a>.</p>'; return; }
    h += '<p>Records of release ' + esc(V.release) + '. The criteria are in <code>' + esc(V.criteria) + '</code> of the site repository; they were fixed before the first formal run, and failing runs are kept.</p>';
    h += '<h3 id="fb-checks-num">1. Numerical verification: ' + tally(V.numerical.counts) + '</h3><p class="cl-small">Does the code solve the stated equations? <code>' + esc(V.numerical.command) + '</code>, ' + esc(V.numerical.date) + '; ' + esc(V.numerical.environment) + '.</p>' + itemsTable(V.numerical.items);
    h += '<h3 id="fb-checks-rep">2. Source-curve reproduction: ' + tally(V.reproduction.counts) + '</h3><p class="cl-small">With the parameters read from their own figures, does the code return the model values that the source plots? The criterion is −2 ≤ z ≤ 2, with z the difference divided by the combined extraction uncertainty. The published values had already been read when this criterion was written, so it is the generic rule and z shows the margin.</p>';
    h += '<div class="cl-table-wrap"><table class="cl-table" id="fb-rep-table"><thead><tr><th scope="col">#</th><th scope="col">Compared with</th><th scope="col">Quantity</th><th scope="col">Model</th><th scope="col">Published</th><th scope="col">z</th><th scope="col">Result</th></tr></thead><tbody>';
    V.reproduction.items.forEach(function (it) {
      it.comparisons.forEach(function (c, k) {
        h += '<tr>' + (k === 0 ? '<th scope="row" rowspan="' + it.comparisons.length + '">' + esc(it.id) + '</th><td rowspan="' + it.comparisons.length + '">' + esc(it.name) + '</td>' : '') +
          '<td>' + esc(c.what) + '</td><td>' + f3(c.model) + ' ± ' + fu(c.u_model) + ' ' + esc(c.unit) + '</td><td>' + f3(c.published) + ' ± ' + fu(c.u_published) + '</td><td>' + (c.z < 0 ? MINUS : '+') + Math.abs(c.z).toFixed(2) + '</td>' +
          (k === 0 ? '<td rowspan="' + it.comparisons.length + '">' + chip(it.verdict) + '</td>' : '') + '</tr>';
      });
    });
    h += '</tbody></table></div>';
    h += '<p class="cl-small">Tube length ' + Number(S.cs.geometry.L_nm.value).toFixed(1) + ' nm. With the alternative length of ' + Number(V.reproduction.alternative_length.length_nm).toFixed(1) + ' nm the same comparisons are ' + esc(V.reproduction.alternative_length.note) + ': ' +
      V.reproduction.alternative_length.comparisons.map(function (c) { return esc(c.id) + ' z = ' + c.z.map(function (z) { return (z < 0 ? MINUS : '+') + Math.abs(z).toFixed(2); }).join(', '); }).join('; ') + '.</p>';
    h += '<h3 id="fb-checks-web">3. This page in a browser: ' + (V.browser ? tally(V.browser.counts) : 'not yet recorded') + '</h3>';
    h += V.browser ? '<p class="cl-small"><code>' + esc(V.browser.command) + '</code>, ' + esc(V.browser.date) + '; ' + esc(V.browser.environment) + '.</p>' + itemsTable(V.browser.items) : '<p class="cl-small">The browser checks of this release have not been recorded in this file.</p>';
    h += '<p>The agreement with molecular dynamics has no verdict; it is <a href="#agreement">reported as numbers</a>.</p>';
    $('fb-checks').innerHTML = h;
  }
  function renderDisabled() {
    var off = S.data.cases.filter(function (c) { return !c.enabled; });
    $('fb-disabled').innerHTML = '<ul class="fb-disabled-list">' + off.map(function (c) { return '<li data-case="' + esc(c.id) + '"><b>' + esc(c.label) + '.</b> ' + esc(c.reason) + '</li>'; }).join('') + '</ul>';
  }

  // ------------------------------------------------------------------ update cycle
  function update() {
    compute(); syncInputs(); renderTiles(); renderParams(); renderSensitivities(); renderPlot(); renderAgreement(); drawCutaway();
  }
  function fail(msg) {
    $('fb-state').textContent = msg;
    ['fb-agreement', 'fb-case-sheet', 'fb-disabled'].forEach(function (id) { $(id).innerHTML = '<p>' + esc(msg) + '</p>'; });
    S.message = msg;
  }
  function selectCase(id) {
    var c = null, i;
    for (i = 0; i < S.data.cases.length; i++) if (S.data.cases[i].id === id) c = S.data.cases[i];
    if (!c || !c.enabled) {                                            // a case without a completed sheet cannot be selected
      S.message = c ? c.label + ' is not yet enabled: ' + c.reason.replace(/^Not yet enabled[^:]*: /, '') : 'Unknown case.';
      syncInputs(); renderTiles(); return false;
    }
    S.cs = c; S.drive = c.drives[0].id; S.message = '';
    fillControls(); renderCaseSheet(); renderDisabled(); update();
    return true;
  }
  function bind() {
    ['family', 'boundary', 'viscosity'].forEach(function (k) {
      Array.prototype.forEach.call(document.querySelectorAll('input[name="fb-' + k + '"]'), function (i) {
        i.addEventListener('change', function () { if (i.checked) { S.choice[k] = i.value; S.message = ''; update(); } });
      });
    });
    $('fb-compare').addEventListener('change', function () { S.compare = this.checked; update(); });
    $('fb-ends').addEventListener('change', function () { S.ends = this.checked; update(); });
    $('fb-case').addEventListener('change', function () { selectCase(this.value); });
    $('fb-drive').addEventListener('change', function () { S.drive = this.value; update(); });
    $('fb-play').addEventListener('click', function () { setPlaying(!S.playing); });
    plotEvents();
    window.addEventListener('resize', drawCutaway);
    document.addEventListener('visibilitychange', startLoop);
    if (window.IntersectionObserver) new window.IntersectionObserver(function (en) { CUT.visible = en[0].isIntersecting; startLoop(); }).observe($('fb-canvas'));
    if (window.ResizeObserver) {
      new window.ResizeObserver(drawCutaway).observe($('fb-canvas'));
      new window.ResizeObserver(function () { if (S.out && sizePlot()) renderPlot(); }).observe($('fb-plot-wrap'));
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawCutaway);
    // a link to a closed panel opens it
    function openTarget() { var t = location.hash ? document.getElementById(location.hash.slice(1)) : null; if (t && t.tagName === 'DETAILS') t.open = true; }
    window.addEventListener('hashchange', openTarget); openTarget();
  }
  function getJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(url + ': HTTP ' + r.status); return r.json(); });
  }

  window.__flowLab = {
    state: function () {
      var o = S.out;
      return {
        ready: !!o, caseId: S.cs ? S.cs.id : null, evidence: S.cs ? S.cs.evidence : null, drive: S.drive,
        choice: { family: S.choice.family, boundary: S.choice.boundary, viscosity: S.choice.viscosity }, compare: S.compare, ends: S.ends,
        message: S.message, playing: S.playing, reducedMotion: reduceQuery.matches,
        result: o ? { Q_m3_s: o.res.Q_m3_s, mean_velocity_m_s: o.res.mean_velocity_m_s, Q_rel: o.cmp.Q_rel, Q_rel_u: o.cmp.Q_rel_u, Q_u_m3_s: o.uQ,
                      interior_fraction: o.res.ends ? o.res.ends.interior_fraction : 1, Q_no_ends_m3_s: o.noEnds.Q_m3_s,
                      equivalent_slip_length_m: o.res.equivalent_slip_length_m, profile_m_s: o.cmp.profile.map(function (p) { return p.model_m_s; }),
                      profile_rms_rel: o.cmp.profile_rms_rel, profile_worst_rel: o.cmp.profile_worst_rel,
                      other_Q_m3_s: o.other ? o.other.Q_m3_s : null } : null,
        cutaway: { t: CUT.t, frames: CUT.frames, tracers: CUT.tracers.length },
        validation: S.validation ? { release: S.validation.release, browser: !!S.validation.browser } : null
      };
    }
  };

  initTracers();
  getJson('flow/data/cases.json').then(function (data) {
    S.data = data;
    var first = null, i;
    for (i = 0; i < data.cases.length; i++) if (data.cases[i].enabled && !first) first = data.cases[i];
    if (!first) { fail('No case is enabled in the case sheet.'); return; }
    bind();
    selectCase(first.id);
    setPlaying(S.playing);
    var linked = location.hash ? document.getElementById(location.hash.slice(1)) : null;
    var toLinked = function () { if (linked) linked.scrollIntoView({ block: 'start', behavior: 'instant' }); };   // the page grows while it is filled
    toLinked();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(toLinked);
    return getJson('flow/data/validation.json').then(function (v) { S.validation = v; }, function (e) { S.validationError = e.message; }).then(renderChecks).then(toLinked);
  }).catch(function (e) { fail('The case sheet could not be loaded (' + e.message + ').'); });
})();
