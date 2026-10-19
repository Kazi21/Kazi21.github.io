/* Continuum Lab — views. Canvas 2D and SVG, no libraries.
   FlowView: 3D projection of the solved chamber fields (speed on a vertical section, the membrane coloured by its
   flux, streamlines and optional tracers). MembraneView: flux map of the membrane faces, patch selection, and a
   zoom to the tubes of one patch. MoleculeView: the recorded CP2K (6,6) trajectory. LawChart: the pore-flow relation.
   Every colour has a numeric legend; nothing here computes physics except interpolation of the solved field. */
(function (root) {
  'use strict';
  const Ufmt = root.ContinuumUnits;
  const fmt3 = Ufmt.fmt3, fmtInt = Ufmt.fmtInt;
  const reduceMotion = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  /* ---------------------------------------------------------------- colour maps */
  // viridis (perceptually ordered, sequential) and ColorBrewer RdBu without its two darkest classes (diverging,
  // centred on zero; negative blue, positive red), both colour-blind safe
  const VIRIDIS = [[68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142], [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37]];
  const RDBU = [[33, 102, 172], [67, 147, 195], [146, 197, 222], [209, 229, 240], [247, 247, 247], [253, 219, 199], [244, 165, 130], [214, 96, 77], [178, 24, 43]];
  function interp(stops, t) {
    t = clamp(t, 0, 1) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(t)), f = t - i, a = stops[i], b = stops[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  const css = (c, a) => 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (a == null ? 1 : a) + ')';
  const seq = (t) => interp(VIRIDIS, t);
  const div = (t) => interp(RDBU, (t + 1) / 2);
  const HATCH_BG = '#2A3644', HATCH_FG = '#8E9EAF', VIEW_TEXT = '#E9EEF3', VIEW_MUTED = '#A7B6C6', VIEW_LINE = 'rgba(233,238,243,0.28)', ACCENT = '#62D6C2';

  /* Scales: {kind:'linear', min, max} | {kind:'log', min, max} | {kind:'div', max}; value -> t in [0,1] or [-1,1] */
  function scaleT(sc, v) {
    if (sc.kind === 'log') return (Math.log10(Math.max(v, sc.min)) - Math.log10(sc.min)) / (Math.log10(sc.max) - Math.log10(sc.min));
    if (sc.kind === 'div') return sc.max > 0 ? clamp(v / sc.max, -1, 1) : 0;
    return sc.max > sc.min ? (v - sc.min) / (sc.max - sc.min) : 0;
  }
  function colourOf(sc, v) { return sc.kind === 'div' ? div(scaleT(sc, v)) : seq(scaleT(sc, v)); }

  /* HTML legend: a colour bar with numeric ticks and units */
  /* exact decade tick of a logarithmic legend, written 10⁻⁶ */
  function decade(v) { return '10' + String(Math.round(Math.log10(v))).replace('-', '⁻').replace(/[0-9]/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]); }
  function legend(el, sc, title, unit, note) {
    if (!el) return;
    let ticks, decades = false;
    if (sc.kind === 'log') {
      ticks = [];
      for (let e = Math.ceil(Math.log10(sc.min) - 1e-9); e <= Math.floor(Math.log10(sc.max) + 1e-9); e++) ticks.push(Math.pow(10, e));
      decades = ticks.length >= 2;
      if (!decades) ticks = [sc.min, sc.max];
    } else if (sc.kind === 'div') ticks = [-sc.max, -sc.max / 2, 0, sc.max / 2, sc.max];
    else ticks = [sc.min, sc.min + (sc.max - sc.min) / 2, sc.max];
    const stops = [];
    for (let k = 0; k <= 16; k++) {
      const t = k / 16, c = sc.kind === 'div' ? div(2 * t - 1) : seq(t);
      stops.push(css(c) + ' ' + (100 * t).toFixed(1) + '%');
    }
    const pos = (v) => (sc.kind === 'div' ? (scaleT(sc, v) + 1) / 2 : scaleT(sc, v)) * 100;
    el.innerHTML = '<p class="cl-legend-title">' + title + (unit ? ' <span class="cl-legend-unit">(' + unit + ')</span>' : '') + '</p>' +
      '<div class="cl-legend-bar" style="background:linear-gradient(90deg,' + stops.join(',') + ')"></div>' +
      '<div class="cl-legend-ticks">' + ticks.map((v) => '<span style="left:' + clamp(pos(v), 0, 100).toFixed(2) + '%">' + (decades ? decade(v) : fmt3(v)) + '</span>').join('') + '</div>' +
      (note ? '<p class="cl-legend-note">' + note + '</p>' : '');
  }

  function fitCanvas(c) {
    const dpr = Math.min(root.devicePixelRatio || 1, 2), w = c.clientWidth || 300, h = c.clientHeight || 200;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, h, dpr };
  }
  function hatch(g, pts, step) {
    g.save(); g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath();
    g.fillStyle = HATCH_BG; g.fill(); g.clip();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    pts.forEach((p) => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
    g.strokeStyle = HATCH_FG; g.lineWidth = 1; g.beginPath();
    for (let s = x0 - (y1 - y0); s < x1; s += step) { g.moveTo(s, y1); g.lineTo(s + (y1 - y0), y0); }
    g.stroke(); g.restore();
  }
  function niceLength(L) { const e = Math.pow(10, Math.floor(Math.log10(L))), m = L / e; return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * e; }
  function lengthLabel(m) {
    if (m >= 1e-3) return fmt3(m * 1e3) + ' mm';
    if (m >= 1e-6) return fmt3(m * 1e6) + ' µm';
    return fmt3(m * 1e9) + ' nm';
  }

  /* ================================================================ FlowView (3D device) */
  function FlowView(canvas, hooks) {
    this.c = canvas; this.hooks = hooks || {};
    this.yaw = -0.62; this.pitch = 0.40; this.zoom = 1;
    this.geom = null; this.data = null; this.selection = null;
    this.staticLayer = document.createElement('canvas');
    this.dirty = true; this.lines = []; this.tracerOn = !reduceMotion; this.multiplier = 0;
    this.sliceOn = true; this.raf = 0; this.visible = true; this.transition = null;
    this.bind();
  }
  FlowView.prototype.bind = function () {
    const c = this.c, self = this;
    let drag = null, pinch = null;
    const pts = new Map();
    c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, yaw: self.yaw, pitch: self.pitch }; else drag = null; });
    c.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) {
        const [a, b] = Array.from(pts.values()), d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (!pinch) pinch = { d, zoom: self.zoom }; else { self.zoom = clamp(pinch.zoom * d / pinch.d, 0.5, 3); self.invalidate(); }
        return;
      }
      if (!drag) return;
      self.yaw = drag.yaw + (e.clientX - drag.x) * 0.008;
      self.pitch = clamp(drag.pitch + (e.clientY - drag.y) * 0.006, 0.05, 1.45);
      self.invalidate();
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (pts.size === 0) drag = null; };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => { e.preventDefault(); self.zoom = clamp(self.zoom * Math.exp(-e.deltaY * 0.0015), 0.5, 3); self.invalidate(); }, { passive: false });
    c.addEventListener('dblclick', () => self.resetView());
    c.addEventListener('keydown', (e) => {
      const k = e.key; let used = true;
      if (k === 'ArrowLeft') self.yaw -= 0.1; else if (k === 'ArrowRight') self.yaw += 0.1;
      else if (k === 'ArrowUp') self.pitch = clamp(self.pitch + 0.08, 0.05, 1.45); else if (k === 'ArrowDown') self.pitch = clamp(self.pitch - 0.08, 0.05, 1.45);
      else if (k === '+' || k === '=') self.zoom = clamp(self.zoom * 1.15, 0.5, 3); else if (k === '-') self.zoom = clamp(self.zoom / 1.15, 0.5, 3);
      else if (k === 'r' || k === 'R') self.resetView(); else used = false;
      if (used) { e.preventDefault(); self.invalidate(); }
    });
    if (root.ResizeObserver) new root.ResizeObserver(() => self.invalidate()).observe(c);
  };
  FlowView.prototype.resetView = function () { this.yaw = -0.62; this.pitch = 0.40; this.zoom = 1; this.invalidate(); };
  FlowView.prototype.invalidate = function () { this.dirty = true; this.schedule(); };
  FlowView.prototype.schedule = function () { if (!this.raf) this.raf = root.requestAnimationFrame((t) => { this.raf = 0; this.frame(t); }); };
  FlowView.prototype.setVisible = function (v) { this.visible = v; if (v) this.invalidate(); };
  /* geometry only (before a solve): device sizes and port */
  FlowView.prototype.setGeometry = function (dev) { this.geom = dev; this.invalidate(); };
  FlowView.prototype.setSelection = function (sel) { this.selection = sel; this.invalidate(); };

  /* A solved result: compute section speeds, membrane colours, streamlines and the tracer clock. With a reference
     { vmax, multiplier } (the baseline's), the colour range and the tracer clock stay fixed, so a change of pressure
     changes colours and tracer speeds in proportion to the computed field; without it both adapt to this result. */
  FlowView.prototype.setResult = function (res, ref) {
    const dev = res.device, FS = root.ContinuumSample;
    this.geom = dev; this.data = res;
    const dims = { nx: dev.nx, ny: dev.ny, nz: dev.nz }, g = { dx: dev.dx, dy: dev.dy, dz: dev.dz };
    const samplers = res.chambers.map((ch) => FS.makeSampler(ch, dims, g, 'no-slip'));
    this.samplers = samplers;
    // vertical section through the ports (y = B/2): speed at cell centres
    const ySec = dev.B / 2, sec = [[], []], out = [0, 0, 0];
    let vmax = 0;
    for (let c = 0; c < 2; c++) for (let k = 0; k < dev.nz; k++) for (let i = 0; i < dev.nx; i++) {
      samplers[c]((i + 0.5) * dev.dx, ySec, (k + 0.5) * dev.dz, out);
      const s = Math.hypot(out[0], out[1], out[2]); sec[c].push(s); vmax = Math.max(vmax, s);
    }
    const J = res.membrane.J;
    for (let q = 0; q < J.length; q++) vmax = Math.max(vmax, Math.abs(J[q]));
    // port speeds (face velocities at the ports)
    const top = res.chambers[0].w, bot = res.chambers[1].w, nx = dev.nx, ny = dev.ny, nz = dev.nz;
    for (let j = dev.port.j0; j < dev.port.j1; j++) for (let i = dev.port.i0; i < dev.port.i1; i++) {
      vmax = Math.max(vmax, Math.abs(top[(nz * ny + j) * nx + i]), Math.abs(bot[(0 * ny + j) * nx + i]));
    }
    this.section = sec;
    this.vmaxNow = vmax;
    this.scaleAuto = vmax > 0 ? { kind: 'log', min: vmax * 1e-3, max: vmax } : { kind: 'log', min: 1e-3, max: 1 };
    this.ref = ref && ref.vmax > 0 ? ref : null;
    this.scale = this.ref ? { kind: 'log', min: this.ref.vmax * 1e-3, max: this.ref.vmax, fixed: true } : Object.assign({ fixed: false }, this.scaleAuto);
    this.computeStreamlines();
    this.multiplier = this.ref && this.ref.multiplier > 0 ? this.ref.multiplier : this.multiplierAuto;
    this.invalidate();
    return this.scale;
  };

  /* Streamlines by RK4 through the interpolated chamber fields, from a uniform grid of seeds on the inlet port.
     Across the membrane a line continues at the same (x, y): the flow passes through the pores of that face, which
     are not resolved. Time along each line (s) is the physical travel time in the computed field. */
  FlowView.prototype.computeStreamlines = function () {
    const dev = this.geom, S = this.samplers, H = dev.H, lines = [];
    const h = 0.3 * Math.min(dev.dx, dev.dy, dev.dz), v = [0, 0, 0], k1 = [0, 0, 0], k2 = [0, 0, 0], k3 = [0, 0, 0], k4 = [0, 0, 0];
    const vmax = this.vmaxNow > 0 ? this.vmaxNow : this.scale.max;   // stagnation threshold from this result's own field
    const n = 6, x0 = dev.port.i0 * dev.dx, x1 = dev.port.i1 * dev.dx, y0 = dev.port.j0 * dev.dy, y1 = dev.port.j1 * dev.dy;
    const closed = this.data.membrane.closed;
    const dir = (s, p, out) => { s(p[0], p[1], p[2], v); const m = Math.hypot(v[0], v[1], v[2]); if (!(m > vmax * 1e-7)) return 0; out[0] = v[0] / m; out[1] = v[1] / m; out[2] = v[2] / m; return m; };
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const pts = [], tt = [];
      let p = [x0 + (a + 0.5) * (x1 - x0) / n, y0 + (b + 0.5) * (y1 - y0) / n, H - 0.02 * dev.dz], c = 0, t = 0, ok = true;
      pts.push([p[0], p[1], p[2]]); tt.push(0);
      for (let step = 0; step < 6000; step++) {
        const s = S[c];
        const m1 = dir(s, p, k1); if (!m1) { ok = c === 1 && p[2] < 0.1 * dev.dz; break; }
        dir(s, [p[0] + 0.5 * h * k1[0], p[1] + 0.5 * h * k1[1], p[2] + 0.5 * h * k1[2]], k2);
        dir(s, [p[0] + 0.5 * h * k2[0], p[1] + 0.5 * h * k2[1], p[2] + 0.5 * h * k2[2]], k3);
        dir(s, [p[0] + h * k3[0], p[1] + h * k3[1], p[2] + h * k3[2]], k4);
        const q = [0, 1, 2].map((d) => p[d] + h * (k1[d] + 2 * k2[d] + 2 * k3[d] + k4[d]) / 6);
        q[0] = clamp(q[0], 1e-9 * dev.W, dev.W * (1 - 1e-9)); q[1] = clamp(q[1], 1e-9 * dev.B, dev.B * (1 - 1e-9));
        const m2 = dir(s, q, k2) || m1;
        t += 2 * h / (m1 + m2);
        if (q[2] <= 0.002 * dev.dz) {
          if (c === 1) { pts.push([q[0], q[1], -H]); tt.push(t); break; }     // left through the outlet port
          const fi = Math.min(dev.nx - 1, Math.floor(q[0] / dev.dx)), fj = Math.min(dev.ny - 1, Math.floor(q[1] / dev.dy));
          if (closed[fj * dev.nx + fi]) { ok = false; break; }
          pts.push([q[0], q[1], 0]); tt.push(t);
          c = 1; p = [q[0], q[1], H - 0.002 * dev.dz];                        // continue below the same face
          continue;
        }
        p = q;
        pts.push([p[0], p[1], c === 0 ? p[2] : p[2] - H]); tt.push(t);
      }
      if (ok && pts.length > 4 && c === 1) lines.push({ pts, t: tt, T: tt[tt.length - 1] });
    }
    this.lines = lines;
    const Ts = lines.map((l) => l.T).sort((x, y) => x - y);
    const Tmed = Ts.length ? Ts[Ts.length >> 1] : 0;
    this.multiplierAuto = Tmed > 0 ? Tmed / 9 : 0;                            // automatic: median transit shown in about 9 s
    this.tracers = [];
    lines.forEach((l, i) => { for (let k = 0; k < 3; k++) this.tracers.push({ line: i, phase: (k + 0.37 * i) / 3 }); });
  };

  FlowView.prototype.projector = function (w, h) {
    const dev = this.geom, L = Math.max(dev.W, dev.B, 2 * dev.H), cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const s = Math.min(w, h * 1.15) * 0.62 * this.zoom / L, ox = w / 2, oy = h / 2 + 6;
    return (x, y, z) => {
      const X = x - dev.W / 2, Y = y - dev.B / 2;
      const x1 = X * cy - Y * sy, y1 = X * sy + Y * cy;
      const depth = y1 * cp - z * sp, up = y1 * sp + z * cp;
      return [ox + s * x1, oy - s * up, depth];
    };
  };

  FlowView.prototype.renderStatic = function () {
    const c = this.staticLayer, d = fitCanvas(this.c);
    c.width = this.c.width; c.height = this.c.height;
    const g = c.getContext('2d'); g.setTransform(d.dpr, 0, 0, d.dpr, 0, 0);
    const w = d.w, h = d.h, dev = this.geom;
    g.fillStyle = '#0D1B2A'; g.fillRect(0, 0, w, h);
    if (!dev) return;
    const P = this.projector(w, h), H = dev.H, W = dev.W, B = dev.B;
    // box edges (drawn first, dim; quads overdraw hidden parts)
    const edge = (a, b, col, lw) => { const p = P(a[0], a[1], a[2]), q = P(b[0], b[1], b[2]); g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); };
    const boxEdges = (z0, z1) => {
      const C = [[0, 0], [W, 0], [W, B], [0, B]];
      const out = [];
      for (let i = 0; i < 4; i++) { const a = C[i], b = C[(i + 1) % 4]; out.push([[a[0], a[1], z0], [b[0], b[1], z0]], [[a[0], a[1], z1], [b[0], b[1], z1]], [[a[0], a[1], z0], [a[0], a[1], z1]]); }
      return out;
    };
    const edges = boxEdges(0, H).concat(boxEdges(-H, 0));
    edges.forEach((e) => edge(e[0], e[1], 'rgba(167,182,198,0.35)', 1));
    // quads: membrane faces, section cells, ports
    const quads = [], res = this.data;
    const sc = this.scale || { kind: 'log', min: 1e-3, max: 1 };
    if (res) {
      const mem = res.membrane;
      for (let j = 0; j < dev.ny; j++) for (let i = 0; i < dev.nx; i++) {
        const k = j * dev.nx + i, x0 = i * dev.dx, x1 = (i + 1) * dev.dx, y0 = j * dev.dy, y1 = (j + 1) * dev.dy;
        quads.push({ p: [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]], col: mem.closed[k] ? null : css(colourOf(sc, Math.abs(mem.J[k]))), hatch: !!mem.closed[k], kind: 'm' });
      }
      if (this.sliceOn) {
        const y = B / 2;
        for (let c2 = 0; c2 < 2; c2++) for (let k = 0; k < dev.nz; k++) for (let i = 0; i < dev.nx; i++) {
          const z0 = c2 === 0 ? k * dev.dz : k * dev.dz - H, z1 = z0 + dev.dz, x0 = i * dev.dx, x1 = x0 + dev.dx;
          quads.push({ p: [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], col: css(colourOf(sc, this.section[c2][k * dev.nx + i])), kind: 's' });
        }
      }
    } else {
      // geometry preview: plain membrane plane
      quads.push({ p: [[0, 0, 0], [W, 0, 0], [W, B, 0], [0, B, 0]], col: 'rgba(98,214,194,0.18)', kind: 'm' });
    }
    const px0 = dev.port.i0 * dev.dx, px1 = dev.port.i1 * dev.dx, py0 = dev.port.j0 * dev.dy, py1 = dev.port.j1 * dev.dy;
    quads.push({ p: [[px0, py0, H], [px1, py0, H], [px1, py1, H], [px0, py1, H]], col: 'rgba(233,238,243,0.16)', stroke: VIEW_TEXT, kind: 'p' });
    quads.push({ p: [[px0, py0, -H], [px1, py0, -H], [px1, py1, -H], [px0, py1, -H]], col: 'rgba(233,238,243,0.16)', stroke: VIEW_TEXT, kind: 'p' });
    quads.forEach((q) => { q.s = q.p.map((v) => P(v[0], v[1], v[2])); q.d = (q.s[0][2] + q.s[1][2] + q.s[2][2] + q.s[3][2]) / 4; });
    quads.sort((a, b) => b.d - a.d);
    for (const q of quads) {
      const pts = q.s.map((v) => [v[0], v[1]]);
      if (q.hatch) { hatch(g, pts, 5); continue; }
      g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath();
      g.fillStyle = q.col; g.fill();
      if (q.kind === 's' || q.kind === 'm') { g.strokeStyle = q.col; g.lineWidth = 0.6; g.stroke(); }
      if (q.stroke) { g.strokeStyle = q.stroke; g.lineWidth = 1.5; g.stroke(); }
    }
    // patch grid on the membrane and the selected patch / tube
    if (res) {
      const pc = dev.patchCells;
      for (let i = 0; i <= dev.nx; i += pc) edge([i * dev.dx, 0, 0], [i * dev.dx, B, 0], 'rgba(233,238,243,0.18)', 1);
      for (let j = 0; j <= dev.ny; j += pc) edge([0, j * dev.dy, 0], [W, j * dev.dy, 0], 'rgba(233,238,243,0.18)', 1);
    }
    const sel = this.selection;
    if (sel && sel.patch) {
      const pc = dev.patchCells, x0 = sel.patch.pi * pc * dev.dx, y0 = sel.patch.pj * pc * dev.dy, x1 = x0 + pc * dev.dx, y1 = y0 + pc * dev.dy;
      const sides = [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]];
      sides.forEach((e) => edge([e[0], e[1], 0], [e[2], e[3], 0], 'rgba(13,27,42,0.85)', 5));   // dark halo for contrast on any colour
      sides.forEach((e) => edge([e[0], e[1], 0], [e[2], e[3], 0], ACCENT, 2.2));
    }
    if (sel && sel.tubeXY) {
      const p = P(sel.tubeXY[0], sel.tubeXY[1], 0);
      g.strokeStyle = '#FFFFFF'; g.lineWidth = 2; g.beginPath(); g.arc(p[0], p[1], 6, 0, 2 * Math.PI); g.stroke();
      g.strokeStyle = '#0D1B2A'; g.lineWidth = 1; g.beginPath(); g.arc(p[0], p[1], 8, 0, 2 * Math.PI); g.stroke();
    }
    // streamlines with direction marks
    if (res && this.lines.length) {
      g.lineWidth = 1.2; g.strokeStyle = 'rgba(233,238,243,0.55)';
      for (const l of this.lines) {
        g.beginPath();
        l.pts.forEach((p, i) => { const s = P(p[0], p[1], p[2]); if (i) g.lineTo(s[0], s[1]); else g.moveTo(s[0], s[1]); });
        g.stroke();
        const m = Math.floor(l.pts.length * 0.3), a = P.apply(null, l.pts[m]), b = P.apply(null, l.pts[Math.min(l.pts.length - 1, m + 3)]);
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        g.fillStyle = 'rgba(233,238,243,0.8)'; g.beginPath();
        g.moveTo(b[0], b[1]); g.lineTo(b[0] - 7 * Math.cos(ang - 0.45), b[1] - 7 * Math.sin(ang - 0.45)); g.lineTo(b[0] - 7 * Math.cos(ang + 0.45), b[1] - 7 * Math.sin(ang + 0.45)); g.closePath(); g.fill();
      }
    }
    // front edges again, brighter
    edges.forEach((e) => { const a = P(e[0][0], e[0][1], e[0][2]), b = P(e[1][0], e[1][1], e[1][2]); if ((a[2] + b[2]) / 2 < 0) edge(e[0], e[1], 'rgba(233,238,243,0.55)', 1.2); });
    // labels and scale bar
    g.font = '600 12px "IBM Plex Sans", system-ui, sans-serif'; g.fillStyle = VIEW_TEXT; g.textBaseline = 'middle';
    const lab = (txt, x, y, z, dx, dy, col) => { const p = P(x, y, z); g.fillStyle = col || VIEW_TEXT; g.fillText(txt, p[0] + (dx || 0), p[1] + (dy || 0)); };
    lab('Feed inlet', (px0 + px1) / 2, (py0 + py1) / 2, H, 12, -14);
    lab('Permeate outlet', (px0 + px1) / 2, (py0 + py1) / 2, -H, 12, 16);
    g.font = '12px "IBM Plex Sans", system-ui, sans-serif';
    const side = (txt, z, col) => {                          // beside the right-most corner, or the left-most if it would not fit
      let r = null, l = null;
      [[0, 0], [W, 0], [W, B], [0, B]].forEach((c) => { const p = P(c[0], c[1], z); if (!r || p[0] > r[0]) r = p; if (!l || p[0] < l[0]) l = p; });
      const tw = g.measureText(txt).width;
      let x = r[0] + 10, y = r[1];
      if (x + tw > w - 6) { x = l[0] - 10 - tw; y = l[1]; }
      x = clamp(x, 6, w - tw - 6);
      g.fillStyle = col; g.fillText(txt, x, y);
    };
    side('Feed chamber', H * 0.5, VIEW_MUTED); side('Membrane', 0, ACCENT); side('Permeate chamber', -H * 0.5, VIEW_MUTED);
    const sb = niceLength(W / 3), a = P(0, 0, -H), b = P(sb, 0, -H);
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), nxv = -Math.sin(ang) * 14, nyv = Math.cos(ang) * 14;
    g.strokeStyle = VIEW_TEXT; g.lineWidth = 2; g.beginPath(); g.moveTo(a[0] + nxv, a[1] + nyv); g.lineTo(b[0] + nxv, b[1] + nyv); g.stroke();
    g.beginPath(); g.moveTo(a[0] + nxv * 0.7, a[1] + nyv * 0.7); g.lineTo(a[0] + nxv * 1.3, a[1] + nyv * 1.3); g.moveTo(b[0] + nxv * 0.7, b[1] + nyv * 0.7); g.lineTo(b[0] + nxv * 1.3, b[1] + nyv * 1.3); g.stroke();
    g.fillStyle = VIEW_TEXT; g.textAlign = 'center'; g.fillText(lengthLabel(sb), (a[0] + b[0]) / 2 + nxv * 2.1, (a[1] + b[1]) / 2 + nyv * 2.1); g.textAlign = 'start';
  };

  FlowView.prototype.frame = function (now) {
    if (!this.visible) return;
    if (this.dirty) { this.renderStatic(); this.dirty = false; }
    const d = fitCanvas(this.c), g = d.g;
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(this.staticLayer, 0, 0); g.setTransform(d.dpr, 0, 0, d.dpr, 0, 0);
    if (this.data && this.tracerOn && this.lines.length && this.multiplier > 0) {
      const P = this.projector(d.w, d.h), tPhys = (now || 0) / 1000 * this.multiplier;
      g.fillStyle = '#FFFFFF';
      for (const tr of this.tracers) {
        const l = this.lines[tr.line], t = (tPhys + tr.phase * l.T) % l.T;
        let lo = 0, hi = l.t.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (l.t[mid] <= t) lo = mid; else hi = mid; }
        const f = (t - l.t[lo]) / Math.max(l.t[hi] - l.t[lo], 1e-300), a = l.pts[lo], b = l.pts[hi];
        const s = P(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
        g.beginPath(); g.arc(s[0], s[1], 2.2, 0, 2 * Math.PI); g.fill();
      }
      this.schedule();
    }
    if (this.transition) this.schedule();
  };
  FlowView.prototype.setTracers = function (on) { this.tracerOn = on && !reduceMotion; this.invalidate(); };
  /* camera move toward a top view of the membrane (visual explanation only); resolves when finished */
  FlowView.prototype.flyToMembrane = function () {
    const self = this;
    if (reduceMotion) return Promise.resolve();
    return new Promise((resolve) => {
      const y0 = self.yaw, p0 = self.pitch, z0 = self.zoom, t0 = root.performance.now(), T = 650;
      const step = (now) => {
        const u = clamp((now - t0) / T, 0, 1), e = u * u * (3 - 2 * u);
        self.yaw = y0 + (0 - y0) * e; self.pitch = p0 + (1.45 - p0) * e; self.zoom = z0 + (1.25 - z0) * e;
        self.dirty = true; self.frame(now);
        if (u < 1) root.requestAnimationFrame(step); else { resolve(); setTimeout(() => self.resetView(), 50); }
      };
      root.requestAnimationFrame(step);
    });
  };

  /* ================================================================ MembraneView (map and patch zoom) */
  function MembraneView(canvas, hooks) {
    this.c = canvas; this.hooks = hooks || {};
    this.res = null; this.geom = null; this.mode = 'map'; this.show = 'J'; this.change = null;
    this.selection = { patch: null, tube: null }; this.layout = null; this.zoomWin = null;
    this.bind();
  }
  MembraneView.prototype.bind = function () {
    const self = this, c = this.c;
    c.addEventListener('click', (e) => {
      const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const hit = self.hitTest(x, y);
      if (hit && self.hooks.onPick) self.hooks.onPick(hit);
    });
    c.addEventListener('dblclick', (e) => {
      const r = c.getBoundingClientRect(), hit = self.hitTest(e.clientX - r.left, e.clientY - r.top);
      if (hit && hit.patch && self.mode === 'map' && self.hooks.onZoom) self.hooks.onZoom(hit.patch);
    });
    c.addEventListener('keydown', (e) => { if (self.hooks.onKey && self.hooks.onKey(e)) e.preventDefault(); });
    if (root.ResizeObserver) new root.ResizeObserver(() => self.render()).observe(c);
  };
  MembraneView.prototype.setGeometry = function (geom) { this.geom = geom; this.render(); };
  MembraneView.prototype.setResult = function (res, change, ref) { this.res = res; this.geom = res.device; this.change = change || null; this.ref = ref && ref.jmax > 0 ? ref : null; this.render(); };
  MembraneView.prototype.setSelection = function (sel) { this.selection = sel; this.render(); };
  MembraneView.prototype.setMode = function (mode) { this.mode = mode; this.render(); };
  MembraneView.prototype.setShow = function (show) { this.show = show; this.render(); };

  /* the J scale starts at zero, so a uniform flux looks uniform; the change scale is symmetric about zero and is set
     by the largest change on faces that are open in both states (closed faces are hatched and stated in numbers) */
  MembraneView.prototype.scales = function () {
    const r = this.res; if (!r) return null;
    const m = r.membrane; let jmax = 0;
    for (let k = 0; k < m.J.length; k++) if (!m.closed[k]) jmax = Math.max(jmax, Math.abs(m.J[k]));
    this.jmaxNow = jmax;
    const out = { J: this.ref ? { kind: 'linear', min: 0, max: this.ref.jmax, fixed: true } : { kind: 'linear', min: 0, max: jmax || 1, fixed: false } };
    if (this.change && this.change.dJ) {
      let dmax = 0; const dj = this.change.dJ, both = this.change.openBoth;
      for (let k = 0; k < dj.length; k++) if (both[k]) dmax = Math.max(dmax, Math.abs(dj[k]));
      out.dJ = { kind: 'div', max: dmax };
    }
    return out;
  };

  MembraneView.prototype.render = function () {
    const d = fitCanvas(this.c), g = d.g, w = d.w, h = d.h;
    g.fillStyle = '#0D1B2A'; g.fillRect(0, 0, w, h);
    const dev = this.geom; if (!dev) return;
    if (this.mode === 'zoom' && this.res && this.selection.patch) return this.renderZoom(g, w, h);
    const ml = 52, mr = 14, mt = 14, mb = 34, aw = w - ml - mr, ah = h - mt - mb;
    const s = Math.min(aw / dev.W, ah / dev.B), pw = dev.W * s, ph = dev.B * s, ox = ml + (aw - pw) / 2, oy = mt + (ah - ph) / 2;
    this.layout = { ox, oy, s, pw, ph };
    const X = (x) => ox + x * s, Y = (y) => oy + ph - y * s;              // y up
    const r = this.res, sc = this.scales();
    if (r) {
      const m = r.membrane, showD = this.show === 'dJ' && sc.dJ;
      for (let j = 0; j < dev.ny; j++) for (let i = 0; i < dev.nx; i++) {
        const k = j * dev.nx + i, x0 = X(i * dev.dx), x1 = X((i + 1) * dev.dx), y0 = Y((j + 1) * dev.dy), y1 = Y(j * dev.dy);
        const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        const closedNow = m.closed[k], closedBoth = showD && !this.change.openBoth[k];
        if (closedNow && (!showD || closedBoth)) { hatch(g, pts, 6); continue; }
        if (showD && closedBoth) { hatch(g, pts, 6); continue; }
        g.fillStyle = css(showD ? colourOf(sc.dJ, this.change.dJ[k]) : colourOf(sc.J, Math.abs(m.J[k])));
        g.fillRect(x0, y0, x1 - x0 + 0.5, y1 - y0 + 0.5);
      }
      // patch grid
      g.strokeStyle = 'rgba(233,238,243,0.28)'; g.lineWidth = 1; g.beginPath();
      for (let i = 0; i <= dev.nx; i += dev.patchCells) { g.moveTo(X(i * dev.dx), Y(0)); g.lineTo(X(i * dev.dx), Y(dev.B)); }
      for (let j = 0; j <= dev.ny; j += dev.patchCells) { g.moveTo(X(0), Y(j * dev.dy)); g.lineTo(X(dev.W), Y(j * dev.dy)); }
      g.stroke();
    } else {
      g.fillStyle = 'rgba(98,214,194,0.15)'; g.fillRect(ox, oy, pw, ph);
    }
    // inlet footprint (above the membrane)
    g.save(); g.setLineDash([4, 4]); g.strokeStyle = VIEW_TEXT; g.lineWidth = 1.2;
    g.strokeRect(X(dev.port.i0 * dev.dx), Y(dev.port.j1 * dev.dy), (dev.port.i1 - dev.port.i0) * dev.dx * s, (dev.port.j1 - dev.port.j0) * dev.dy * s);
    g.restore();
    const sel = this.selection;
    if (sel.patch) {
      const pc = dev.patchCells, x0 = X(sel.patch.pi * pc * dev.dx), y0 = Y((sel.patch.pj + 1) * pc * dev.dy);
      g.strokeStyle = 'rgba(13,27,42,0.85)'; g.lineWidth = 6; g.strokeRect(x0, y0, pc * dev.dx * s, pc * dev.dy * s);   // dark halo
      g.strokeStyle = ACCENT; g.lineWidth = 3; g.strokeRect(x0, y0, pc * dev.dx * s, pc * dev.dy * s);
    }
    if (sel.tubeXY) {
      const x = X(sel.tubeXY[0]), y = Y(sel.tubeXY[1]);
      g.strokeStyle = '#FFFFFF'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 6, 0, 2 * Math.PI); g.stroke();
      g.strokeStyle = '#0D1B2A'; g.lineWidth = 1; g.beginPath(); g.arc(x, y, 8, 0, 2 * Math.PI); g.stroke();
    }
    // axes
    g.fillStyle = VIEW_MUTED; g.font = '11px "IBM Plex Sans", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
    const unit = dev.W >= 1e-3 ? 1e-3 : 1e-6, un = unit === 1e-3 ? 'mm' : 'µm';
    for (let k = 0; k <= 4; k++) {
      const xv = dev.W * k / 4; g.fillText(fmt3(xv / unit), X(xv), oy + ph + 4);
    }
    g.fillText('x (' + un + ')', ox + pw / 2, oy + ph + 18);
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let k = 0; k <= 4; k++) { const yv = dev.B * k / 4; g.fillText(fmt3(yv / unit), ox - 6, Y(yv)); }
    g.save(); g.translate(12, oy + ph / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText('y (' + un + ')', 0, 0); g.restore();
    g.textAlign = 'start';
  };

  /* Zoom: the tubes of the selected patch. All tubes are drawn when a patch holds at most 48 × 48 of them; otherwise a
     40 × 40 window of real lattice positions (around the selected tube when it lies in the patch). Symbols are
     enlarged: drawn to scale a 0.814 nm tube on a 10 nm pitch would be under a pixel. */
  MembraneView.prototype.zoomWindow = function () {
    const r = this.res, dev = r.device, m = r.membrane, sel = this.selection, sc = r.scenario;
    const s = sc.pitch_m, pc = dev.patchCells;
    const xa = sel.patch.pi * pc * dev.dx, xb = xa + pc * dev.dx, ya = sel.patch.pj * pc * dev.dy, yb = ya + pc * dev.dy;
    const ti0 = Math.ceil(xa / s - 0.5 - 1e-9), ti1 = Math.min(m.Nx, Math.ceil(xb / s - 0.5 - 1e-9)), tj0 = Math.ceil(ya / s - 0.5 - 1e-9), tj1 = Math.min(m.Ny, Math.ceil(yb / s - 0.5 - 1e-9));
    const nX = ti1 - ti0, nY = tj1 - tj0, full = nX <= 48 && nY <= 48, n = 40;
    let a0 = ti0, b0 = tj0, nx = nX, ny = nY;
    if (!full) {
      let cx = Math.floor((ti0 + ti1) / 2), cy = Math.floor((tj0 + tj1) / 2);
      if (sel.tube && sel.tube.ti >= ti0 && sel.tube.ti < ti1 && sel.tube.tj >= tj0 && sel.tube.tj < tj1) { cx = sel.tube.ti; cy = sel.tube.tj; }
      a0 = clamp(cx - n / 2, ti0, ti1 - n); b0 = clamp(cy - n / 2, tj0, tj1 - n); nx = Math.min(n, nX); ny = Math.min(n, nY);
    }
    return { ti0: a0, tj0: b0, nx, ny, full, patchTubes: nX * nY, nX, nY, xa, ya, xb, yb };
  };
  MembraneView.prototype.tubeFactor = function (ti, tj) {
    const r = this.res, dev = r.device, mods = r.scenario.mods, s = r.scenario.pitch_m;
    const fi = Math.min(dev.nx - 1, Math.floor((ti + 0.5) * s / dev.dx)), fj = Math.min(dev.ny - 1, Math.floor((tj + 0.5) * s / dev.dy));
    const pi = Math.floor(fi / dev.patchCells), pj = Math.floor(fj / dev.patchCells);
    const pf = mods.patchFactors[pi + ',' + pj], tf = mods.tubeFactors[ti + ',' + tj];
    return { f: mods.membraneFactor * (pf == null ? 1 : pf) * (tf == null ? 1 : tf), face: fj * dev.nx + fi, fi, fj, pi, pj, own: tf == null ? 1 : tf };
  };
  MembraneView.prototype.renderZoom = function (g, w, h) {
    const r = this.res, dev = r.device, m = r.membrane, sc = r.scenario, s = sc.pitch_m, win = this.zoomWin = this.zoomWindow();
    const ml = 52, mr = 14, mt = 14, mb = 34, aw = w - ml - mr, ah = h - mt - mb;
    const spanX = win.nx * s, spanY = win.ny * s, x0w = win.ti0 * s, y0w = win.tj0 * s;
    const k = Math.min(aw / spanX, ah / spanY), pw = spanX * k, ph = spanY * k, ox = ml + (aw - pw) / 2, oy = mt + (ah - ph) / 2;
    this.layout = { ox, oy, k, pw, ph, x0w, y0w };
    const X = (x) => ox + (x - x0w) * k, Y = (y) => oy + ph - (y - y0w) * k;
    // continuum faces inside the window
    g.strokeStyle = 'rgba(233,238,243,0.30)'; g.lineWidth = 1; g.beginPath();
    for (let i = Math.ceil(x0w / dev.dx); i * dev.dx <= x0w + spanX + 1e-15; i++) { g.moveTo(X(i * dev.dx), Y(y0w)); g.lineTo(X(i * dev.dx), Y(y0w + spanY)); }
    for (let j = Math.ceil(y0w / dev.dy); j * dev.dy <= y0w + spanY + 1e-15; j++) { g.moveTo(X(x0w), Y(j * dev.dy)); g.lineTo(X(x0w + spanX), Y(j * dev.dy)); }
    g.stroke();
    // tube flows q_i = G_i dPi_c
    let qmax = 0;
    const tubes = [];
    for (let b = 0; b < win.ny; b++) for (let a = 0; a < win.nx; a++) {
      const ti = win.ti0 + a, tj = win.tj0 + b, tf = this.tubeFactor(ti, tj);
      const q = m.closed[tf.face] ? 0 : r.membrane.G0 * tf.f * m.dPi[tf.face];
      tubes.push({ ti, tj, q, f: tf.f }); qmax = Math.max(qmax, Math.abs(q));
    }
    this.qmaxNow = qmax;
    this.qScale = this.ref && this.ref.qmax > 0 ? { kind: 'linear', min: 0, max: this.ref.qmax, empty: qmax === 0, fixed: true } : { kind: 'linear', min: 0, max: qmax || 1, empty: qmax === 0, fixed: false };
    const rad = Math.max(1.5, Math.min(0.27 * s * k, 8));
    for (const t of tubes) {
      const x = X((t.ti + 0.5) * s), y = Y((t.tj + 0.5) * s);
      g.beginPath(); g.arc(x, y, rad, 0, 2 * Math.PI);
      if (t.f === 0) { g.strokeStyle = HATCH_FG; g.lineWidth = 1; g.stroke(); g.beginPath(); g.moveTo(x - rad * 0.7, y - rad * 0.7); g.lineTo(x + rad * 0.7, y + rad * 0.7); g.stroke(); }
      else { g.fillStyle = css(colourOf(this.qScale, Math.abs(t.q))); g.fill(); if (t.f !== 1) { g.strokeStyle = '#FFFFFF'; g.lineWidth = 1.2; g.stroke(); } }
    }
    this.zoomTubes = { rad, X, Y };
    const st = this.selection.tube;
    if (st && st.ti >= win.ti0 && st.ti < win.ti0 + win.nx && st.tj >= win.tj0 && st.tj < win.tj0 + win.ny) {
      const x = X((st.ti + 0.5) * s), y = Y((st.tj + 0.5) * s);
      g.strokeStyle = ACCENT; g.lineWidth = 2.5; g.beginPath(); g.arc(x, y, rad + 4, 0, 2 * Math.PI); g.stroke();
    }
    // axes: absolute position, in µm when the window lies beyond 1 µm, else nm
    const unit = Math.max(x0w + spanX, y0w + spanY) >= 1e-6 ? 1e-6 : 1e-9, un = unit === 1e-6 ? 'µm' : 'nm';
    g.fillStyle = VIEW_MUTED; g.font = '11px "IBM Plex Sans", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
    for (let q = 0; q <= 4; q++) { const xv = x0w + spanX * q / 4; g.fillText(fmt3(xv / unit), X(xv), oy + ph + 4); }
    g.fillText('x (' + un + ')', ox + pw / 2, oy + ph + 18);
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let q = 0; q <= 4; q++) { const yv = y0w + spanY * q / 4; g.fillText(fmt3(yv / unit), ox - 6, Y(yv)); }
    g.save(); g.translate(12, oy + ph / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText('y (' + un + ')', 0, 0); g.restore();
    g.textAlign = 'start';
  };
  MembraneView.prototype.hitTest = function (x, y) {
    const L = this.layout, dev = this.geom; if (!L || !dev) return null;
    if (this.mode === 'zoom' && this.zoomWin && this.res) {
      const s = this.res.scenario.pitch_m, xm = L.x0w + (x - L.ox) / L.k, ym = L.y0w + (L.oy + L.ph - y) / L.k;
      const ti = Math.floor(xm / s), tj = Math.floor(ym / s), win = this.zoomWin;
      if (ti < win.ti0 || ti >= win.ti0 + win.nx || tj < win.tj0 || tj >= win.tj0 + win.ny) return null;
      return { tube: { ti, tj } };
    }
    const xm = (x - L.ox) / L.s, ym = (L.oy + L.ph - y) / L.s;
    if (xm < 0 || ym < 0 || xm >= dev.W || ym >= dev.B) return null;
    const fi = Math.floor(xm / dev.dx), fj = Math.floor(ym / dev.dy);
    return { patch: { pi: Math.floor(fi / dev.patchCells), pj: Math.floor(fj / dev.patchCells) }, face: { fi, fj }, xy: [xm, ym] };
  };

  /* ================================================================ MoleculeView (recorded CP2K trajectory) */
  const SPECIES = { C: { col: [140, 140, 140], r: 0.30 }, O: { col: [224, 48, 48], r: 0.55 }, H: { col: [242, 244, 247], r: 0.30 }, N: { col: [160, 92, 200], r: 0.85 }, L: { col: [46, 204, 64], r: 1.00 } };
  function sphereSprite(rgb, dim) {
    const S = 64, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), r = S / 2 - 2, base = dim ? rgb.map((v, i) => v * 0.55 + [13, 27, 42][i] * 0.45) : rgb;
    const gr = g.createRadialGradient(S / 2 - r * 0.35, S / 2 - r * 0.35, r * 0.08, S / 2, S / 2, r);
    gr.addColorStop(0, css(base.map((v) => v + (255 - v) * 0.55))); gr.addColorStop(0.45, css(base)); gr.addColorStop(1, css(base.map((v) => v * 0.5)));
    g.fillStyle = gr; g.beginPath(); g.arc(S / 2, S / 2, r, 0, 2 * Math.PI); g.fill();
    g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,0.45)'; g.stroke();
    return c;
  }
  function MoleculeView(canvas, hooks) {
    this.c = canvas; this.hooks = hooks || {}; this.data = null; this.frameIdx = 0; this.playing = false; this.last = 0; this.acc = 0;
    this.sprites = {}; Object.keys(SPECIES).forEach((k) => { this.sprites[k] = sphereSprite(SPECIES[k].col, false); this.sprites[k + '_d'] = sphereSprite(SPECIES[k].col, true); });
    this.tilt = 0.32; this.raf = 0;
    const self = this;
    if (root.ResizeObserver) new root.ResizeObserver(() => self.draw()).observe(canvas);
  }
  MoleculeView.prototype.load = function (binUrl, manUrl, id) {
    const self = this;
    return Promise.all([fetch(manUrl).then((r) => r.json()), fetch(binUrl).then((r) => r.arrayBuffer())]).then(([man, buf]) => {
      const t = man.tubes.find((x) => x.id === id), nf = t.n_frames, na = t.n_atoms;
      const pos = new Int16Array(buf, 0, nf * na * 3), sp = t.species.split('');
      const nH = sp.filter((s) => s === 'H').length, owner = new Int16Array(buf, nf * na * 3 * 2, nf * nH);
      // carbon-carbon bonds from the first frame (within 0.165 nm, not across the periodic boundary)
      const bonds = [], C = sp.map((s, i) => (s === 'C' ? i : -1)).filter((i) => i >= 0);
      for (let a = 0; a < C.length; a++) for (let b = a + 1; b < C.length; b++) {
        const i = C[a] * 3, k = C[b] * 3, dx = (pos[i] - pos[k]) / 1000, dy = (pos[i + 1] - pos[k + 1]) / 1000, dz = (pos[i + 2] - pos[k + 2]) / 1000;
        if (dx * dx + dy * dy + dz * dz < 1.65 * 1.65) bonds.push([C[a], C[b]]);
      }
      self.data = { t, nf, na, pos, sp, nH, owner, bonds, hIdx: sp.map((s, i) => (s === 'H' ? i : -1)).filter((i) => i >= 0) };
      self.frameIdx = 0; self.draw();
      return self.data;
    });
  };
  MoleculeView.prototype.play = function (on) {
    this.playing = on; const self = this;
    if (on && !this.raf) { this.last = 0; const step = (now) => { self.raf = 0; if (!self.playing) return; if (self.last) { self.acc += (now - self.last) / 1000 * 30; const n = Math.floor(self.acc); if (n) { self.acc -= n; self.frameIdx = (self.frameIdx + n) % self.data.nf; self.draw(); } } self.last = now; self.raf = root.requestAnimationFrame(step); }; this.raf = root.requestAnimationFrame(step); }
  };
  MoleculeView.prototype.draw = function () {
    const d = fitCanvas(this.c), g = d.g, w = d.w, h = d.h;
    g.fillStyle = '#0D1B2A'; g.fillRect(0, 0, w, h);
    if (!this.data) return;
    const D = this.data, t = D.t, f = this.frameIdx, Lz = t.cell_A[2], ca = Math.cos(this.tilt), sa = Math.sin(this.tilt);
    const scale = Math.min((w - 40) / Lz, (h - 50) / 11.5), ox = w / 2, oy = h / 2 - 6;
    const atoms = [];
    for (let i = 0; i < D.na; i++) {
      const o = (f * D.na + i) * 3, x = D.pos[o] / 1000, y = D.pos[o + 1] / 1000, z = D.pos[o + 2] / 1000;
      const yy = y * ca - x * sa, depth = y * sa + x * ca;                  // tube axis along screen x
      const s = D.sp[i];
      if (s === 'C' && depth < -0.4) continue;                              // cut away the near half of the wall
      atoms.push({ s, X: ox + z * scale, Y: oy - yy * scale, depth, i });
    }
    // carbon framework of the far half (the near half is cut away)
    const byIdx = {}; atoms.forEach((a) => { byIdx[a.i] = a; });
    g.strokeStyle = 'rgba(150,160,172,0.55)'; g.lineWidth = Math.max(1, 0.07 * scale); g.beginPath();
    for (const bd of D.bonds) { const a = byIdx[bd[0]], b = byIdx[bd[1]]; if (a && b && Math.abs(a.X - b.X) < 2 * scale) { g.moveTo(a.X, a.Y); g.lineTo(b.X, b.Y); } }
    g.stroke();
    // O-H sticks
    g.strokeStyle = 'rgba(242,244,247,0.7)'; g.lineWidth = Math.max(1, 0.12 * scale);
    for (let k = 0; k < D.nH; k++) {
      const hi = D.hIdx[k], oi = D.owner[f * D.nH + k];
      const a = byIdx[hi], b = byIdx[oi];
      if (a && b && Math.abs(a.X - b.X) < 2 * scale) { g.beginPath(); g.moveTo(a.X, a.Y); g.lineTo(b.X, b.Y); g.stroke(); }
    }
    atoms.sort((a, b) => b.depth - a.depth);
    for (const a of atoms) {
      const r = SPECIES[a.s].r * scale, spr = this.sprites[a.s === 'C' ? 'C_d' : a.s];
      g.drawImage(spr, a.X - r, a.Y - r, 2 * r, 2 * r);
    }
    // scale bar 1 nm and clock
    g.strokeStyle = VIEW_TEXT; g.lineWidth = 2; g.beginPath(); g.moveTo(16, h - 16); g.lineTo(16 + 10 * scale, h - 16); g.stroke();
    g.fillStyle = VIEW_TEXT; g.font = '11px "IBM Plex Sans", system-ui, sans-serif'; g.textBaseline = 'bottom'; g.fillText('1 nm', 16, h - 20);
    g.textAlign = 'right'; g.fillText('recorded t = ' + (f * t.frame_spacing_fs / 1000).toFixed(3) + ' ps of ' + t.duration_ps.toFixed(2) + ' ps', w - 12, h - 8); g.textAlign = 'start';
    if (this.hooks.onFrame) this.hooks.onFrame(f);
  };

  /* ================================================================ LawChart (pore-flow relation, SVG) */
  function lawChart(el, o) {
    // o: { G, dPiMax, factor, dPiRange:[lo,hi]|null, point:{dPi,q}|null, toMolNs }
    const W = 360, H = 190, ml = 50, mr = 12, mt = 12, mb = 40, pw = W - ml - mr, ph = H - mt - mb;
    const xmax = o.dPiMax, qmax = o.G * xmax * Math.max(1, o.factor || 1) * 1.05;
    const X = (v) => ml + v / xmax * pw, Y = (q) => mt + ph - q / qmax * ph;
    const ticksX = [0, 2.5e6, 5e6, 7.5e6, 1e7].filter((v) => v <= xmax + 1);
    const ticksQ = [0, qmax / 2.1, qmax / 1.05];
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="cl-law-svg" role="img" aria-label="' + (o.aria || 'Pore-flow relation') + '">';
    s += '<rect x="' + ml + '" y="' + mt + '" width="' + pw + '" height="' + ph + '" fill="#FFFFFF" stroke="#D9E2E8"/>';
    ticksX.forEach((v) => { s += '<line x1="' + X(v) + '" x2="' + X(v) + '" y1="' + mt + '" y2="' + (mt + ph) + '" stroke="#E6ECF0"/><text x="' + X(v) + '" y="' + (mt + ph + 14) + '" text-anchor="middle" class="cl-ax">' + fmt3(v / 1e6) + '</text>'; });
    ticksQ.forEach((q) => { s += '<line x1="' + ml + '" x2="' + (ml + pw) + '" y1="' + Y(q) + '" y2="' + Y(q) + '" stroke="#E6ECF0"/><text x="' + (ml - 5) + '" y="' + (Y(q) + 4) + '" text-anchor="end" class="cl-ax">' + fmt3(o.toMolNs(q)) + '</text>'; });
    s += '<text x="' + (ml + pw / 2) + '" y="' + (H - 6) + '" text-anchor="middle" class="cl-ax-t">Local driving potential ΔΠ (MPa)</text>';
    s += '<text transform="translate(12 ' + (mt + ph / 2) + ') rotate(-90)" text-anchor="middle" class="cl-ax-t">q (molecules/ns)</text>';
    if (o.dPiRange) s += '<rect x="' + X(o.dPiRange[0]) + '" y="' + (mt + ph - 6) + '" width="' + Math.max(3, X(o.dPiRange[1]) - X(o.dPiRange[0])) + '" height="6" fill="#0072B2" opacity="0.55"><title>Local ΔΠ over open faces</title></rect>';
    s += '<line x1="' + X(0) + '" y1="' + Y(0) + '" x2="' + X(xmax) + '" y2="' + Y(o.G * xmax) + '" stroke="#006B62" stroke-width="2.5"/>';
    if (o.factor != null && o.factor !== 1) s += '<line x1="' + X(0) + '" y1="' + Y(0) + '" x2="' + X(xmax) + '" y2="' + Y(o.G * o.factor * xmax) + '" stroke="#D55E00" stroke-width="2" stroke-dasharray="6 4"/>';
    if (o.point) s += '<circle cx="' + X(o.point.dPi) + '" cy="' + Y(o.point.q) + '" r="5" fill="#D55E00" stroke="#FFFFFF" stroke-width="1.5"/>';
    s += '</svg>';
    el.innerHTML = s;
  }

  root.ContinuumView = { FlowView, MembraneView, MoleculeView, lawChart, legend, colourOf, seq, div, css, fmt3, fmtInt, lengthLabel, reduceMotion };
})(typeof self !== 'undefined' ? self : this);
