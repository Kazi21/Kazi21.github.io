/* Continuum Lab — ion experiment: small SVG charts (no library). Every chart has numeric axes, units and a legend;
   colours are paired with distinct dash patterns so they do not carry meaning alone. */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const C = { model: '#16324F', ref: '#8A99A8', na: '#6A3D9A', cl: '#1B7837', grid: '#E6ECF0', axis: '#526477', text: '#243447', band: 'rgba(0, 107, 98, 0.07)', mark: '#B3261E' };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function niceTicks(lo, hi, n) {
    if (!(hi > lo)) { hi = lo + 1; }
    const span = hi - lo, raw = span / Math.max(1, n), mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag, out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return out;
  }
  function fmt(v) {
    const a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1e4 || a < 1e-2) { const e = Math.floor(Math.log10(a)), m = v / Math.pow(10, e); return (Math.abs(m - Math.round(m)) < 1e-9 ? Math.round(m) : m.toPrecision(2)) + '×10' + sup(e); }
    return String(Number(v.toPrecision(4)));
  }
  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  const sup = (e) => String(e).split('').map((ch) => SUP[ch] || ch).join('');

  /* line chart. spec: { w, h, x: {lo, hi, label, ticks?}, y: {lo, hi, label, log?}, series: [{pts: [[x, y]...], color, dash, width, name}],
     bands: [{x0, x1, label}], vlines: [{x, label}], point: {x, y, label}, aria } */
  function lineChart(spec) {
    const W = spec.w || 560, H = spec.h || 300, m = { l: 62, r: 14, t: 14, b: 46 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const ylog = !!spec.y.log, ty = (v) => (ylog ? Math.log10(Math.max(v, 1e-300)) : v);
    let ylo = spec.y.lo, yhi = spec.y.hi;
    if (ylog) { ylo = Math.floor(Math.log10(ylo)); yhi = Math.ceil(Math.log10(yhi)); }
    const X = (v) => m.l + (v - spec.x.lo) / (spec.x.hi - spec.x.lo) * pw;
    const Y = (v) => m.t + ph - (ty(v) - ylo) / (yhi - ylo) * ph;
    let s = '<svg class="ion-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(spec.aria || '') + '" xmlns="' + NS + '">';
    for (const b of spec.bands || []) s += '<rect x="' + X(Math.max(b.x0, spec.x.lo)).toFixed(1) + '" y="' + m.t + '" width="' + (X(Math.min(b.x1, spec.x.hi)) - X(Math.max(b.x0, spec.x.lo))).toFixed(1) + '" height="' + ph + '" fill="' + C.band + '"/>' +
      (b.label ? '<text x="' + ((X(Math.max(b.x0, spec.x.lo)) + X(Math.min(b.x1, spec.x.hi))) / 2).toFixed(1) + '" y="' + (m.t + 12) + '" text-anchor="middle" class="ion-ax-t">' + esc(b.label) + '</text>' : '');
    const xt = spec.x.ticks || niceTicks(spec.x.lo, spec.x.hi, 6);
    const yt = ylog ? (() => { const a = []; for (let e = ylo; e <= yhi; e++) a.push(e); return a; })() : niceTicks(ylo, yhi, 5);
    for (const v of yt) { const yy = ylog ? m.t + ph - (v - ylo) / (yhi - ylo) * ph : Y(v); s += '<line x1="' + m.l + '" x2="' + (m.l + pw) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '" stroke="' + C.grid + '"/><text x="' + (m.l - 6) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end" class="ion-ax">' + (ylog ? '10' + sup(v) : fmt(v)) + '</text>'; }
    for (const v of xt) s += '<line x1="' + X(v).toFixed(1) + '" x2="' + X(v).toFixed(1) + '" y1="' + m.t + '" y2="' + (m.t + ph) + '" stroke="' + C.grid + '"/><text x="' + X(v).toFixed(1) + '" y="' + (m.t + ph + 16) + '" text-anchor="middle" class="ion-ax">' + fmt(v) + '</text>';
    if (!ylog && ylo < 0 && yhi > 0) s += '<line x1="' + m.l + '" x2="' + (m.l + pw) + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '" stroke="' + C.axis + '" stroke-width="1"/>';
    if (spec.x.lo < 0 && spec.x.hi > 0 && spec.zeroX !== false) s += '<line x1="' + X(0).toFixed(1) + '" x2="' + X(0).toFixed(1) + '" y1="' + m.t + '" y2="' + (m.t + ph) + '" stroke="' + C.axis + '" stroke-width="0.8" stroke-dasharray="2 3"/>';
    s += '<rect x="' + m.l + '" y="' + m.t + '" width="' + pw + '" height="' + ph + '" fill="none" stroke="' + C.axis + '" stroke-width="0.8"/>';
    s += '<clipPath id="' + (spec.id || 'c') + '-clip"><rect x="' + m.l + '" y="' + m.t + '" width="' + pw + '" height="' + ph + '"/></clipPath><g clip-path="url(#' + (spec.id || 'c') + '-clip)">';
    for (const v of spec.vlines || []) s += '<line x1="' + X(v.x).toFixed(1) + '" x2="' + X(v.x).toFixed(1) + '" y1="' + m.t + '" y2="' + (m.t + ph) + '" stroke="' + (v.color || C.axis) + '" stroke-dasharray="4 3"/>';
    for (const se of spec.series) {
      const pts = se.pts.filter((p) => isFinite(p[0]) && isFinite(p[1]) && (!ylog || p[1] > 0));
      if (!pts.length) continue;
      s += '<polyline fill="none" stroke="' + se.color + '" stroke-width="' + (se.width || 2) + '"' + (se.dash ? ' stroke-dasharray="' + se.dash + '"' : '') + ' stroke-linejoin="round" points="' + pts.map((p) => X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' ') + '"/>';
      if (se.dots) for (const p of pts) s += '<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="2.4" fill="' + se.color + '"/>';
    }
    if (spec.point && isFinite(spec.point.y)) s += '<circle cx="' + X(spec.point.x).toFixed(1) + '" cy="' + Y(spec.point.y).toFixed(1) + '" r="5" fill="#FFFFFF" stroke="' + C.mark + '" stroke-width="2"/>';
    s += '</g>';
    s += '<text x="' + (m.l + pw / 2) + '" y="' + (H - 8) + '" text-anchor="middle" class="ion-ax-t">' + esc(spec.x.label) + '</text>';
    s += '<text transform="translate(14 ' + (m.t + ph / 2) + ') rotate(-90)" text-anchor="middle" class="ion-ax-t">' + esc(spec.y.label) + '</text>';
    return s + '</svg>';
  }

  function legend(items) {
    return '<p class="ion-legend">' + items.map((it) => '<span class="ion-leg"><svg width="28" height="10" aria-hidden="true"><line x1="1" x2="27" y1="5" y2="5" stroke="' + it.color + '" stroke-width="' + (it.width || 2) + '"' + (it.dash ? ' stroke-dasharray="' + it.dash + '"' : '') + '/>' + (it.marker ? '<circle cx="14" cy="5" r="3.5" fill="#fff" stroke="' + it.color + '" stroke-width="2"/>' : '') + '</svg>' + esc(it.name) + '</span>').join('') + '</p>';
  }

  /* recorded first-shell counts (CP2K) and the rigid-shell estimate for the four tubes */
  function hydrationChart(spec) {
    const W = spec.w || 560, H = spec.h || 260, m = { l: 52, r: 14, t: 14, b: 50 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    const tubes = spec.tubes, n = tubes.length, ymax = 8;
    const X = (i) => m.l + (i + 0.5) / n * pw, Y = (v) => m.t + ph - v / ymax * ph;
    let s = '<svg class="ion-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(spec.aria || '') + '" xmlns="' + NS + '">';
    tubes.forEach((t, i) => { if (t.id === spec.selected) s += '<rect x="' + (X(i) - pw / n / 2 + 3).toFixed(1) + '" y="' + m.t + '" width="' + (pw / n - 6).toFixed(1) + '" height="' + ph + '" fill="' + C.band + '" stroke="#006B62" stroke-width="1"/>'; });
    for (const v of [0, 2, 4, 6, 8]) s += '<line x1="' + m.l + '" x2="' + (m.l + pw) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" stroke="' + C.grid + '"/><text x="' + (m.l - 6) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end" class="ion-ax">' + v + '</text>';
    s += '<rect x="' + m.l + '" y="' + m.t + '" width="' + pw + '" height="' + ph + '" fill="none" stroke="' + C.axis + '" stroke-width="0.8"/>';
    tubes.forEach((t, i) => {
      const x = X(i);
      s += '<text x="' + x.toFixed(1) + '" y="' + (m.t + ph + 16) + '" text-anchor="middle" class="ion-ax">' + esc(t.label) + '</text><text x="' + x.toFixed(1) + '" y="' + (m.t + ph + 30) + '" text-anchor="middle" class="ion-ax-s">' + esc(t.sub) + '</text>';
      const pt = (dx, v, lo, hi, color, shape, filled) => {
        const cx = x + dx, cy = Y(v);
        let g = '';
        if (lo != null) g += '<line x1="' + cx.toFixed(1) + '" x2="' + cx.toFixed(1) + '" y1="' + Y(lo).toFixed(1) + '" y2="' + Y(hi).toFixed(1) + '" stroke="' + color + '" stroke-width="1.5"/>';
        if (shape === 'c') g += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="5" fill="' + (filled ? color : '#fff') + '" stroke="' + color + '" stroke-width="2"/>';
        else g += '<rect x="' + (cx - 4.5).toFixed(1) + '" y="' + (cy - 4.5).toFixed(1) + '" width="9" height="9" fill="' + (filled ? color : '#fff') + '" stroke="' + color + '" stroke-width="2"/>';
        return g;
      };
      s += pt(-21, t.na.rec, t.na.lo, t.na.hi, C.na, 'c', true) + pt(-7, t.na.shell, null, null, C.na, 'c', false);
      s += pt(7, t.cl.rec, t.cl.lo, t.cl.hi, C.cl, 's', true) + pt(21, t.cl.shell, null, null, C.cl, 's', false);
    });
    s += '<text transform="translate(14 ' + (m.t + ph / 2) + ') rotate(-90)" text-anchor="middle" class="ion-ax-t">first-shell waters</text>';
    return s + '</svg>';
  }

  root.IonCharts = { lineChart, legend, hydrationChart, niceTicks, fmt, COLORS: C };
})(typeof window !== 'undefined' ? window : globalThis);
