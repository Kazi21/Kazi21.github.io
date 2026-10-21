/* Continuum Lab — ion experiment: the reduced one-dimensional model drawn in 3D.

   A cutaway of the membrane around one carbon nanotube: the back half of the membrane and of the tube (an armchair
   (n,n) lattice at the radius of the recorded CP2K tube), the two access regions of the reduced model (cones of slope
   4/π) and the computed field on the section through the axis, one overlay at a time: concentration, potential or
   current density. Nothing is a recorded trajectory: ion markers are placed with the computed line density
   N_A c(x) A(x) and move at the mean drift speed v(x) = J/(N_A c(x) A(x)) of the computed flux, so their density and
   their flux reproduce the solution; thermal motion is not drawn. 1 s on screen = 100 ns. The drawing follows the
   model step: point ions (classical, charged rims), spheres of the lattice-gas size (finite size), and with a
   dehydration closure each ion carries the first-shell waters the closure assumes, fewer inside the pore (the recorded
   CP2K count of this tube, or the rigid-shell estimate). Loaded when the view is first shown; uses three.js 0.160.0
   (MIT licence, ../vendor/three.module.min.js). */
(function (root) {
  'use strict';
  const NS_PER_S = 100;                    // 1 s on screen = 100 ns of transport
  const S_VIEW = 4.0;                      // nm of each access region drawn beyond the mouth
  const ALPHA = 4 / Math.PI;               // cone slope of the reduced model
  const MAX_MARKERS = 140;                 // per species; above this one marker stands for several ions
  const COL = { bg: 0x0d1b2a, C: 0x8a94a0, bond: 0x9aa3ad, O: 0xe03030, H: 0xf2f4f7, Na: 0xb07ce0, Cl: 0x4cc66a, rimO: 0xff7b63, rimC: 0xb8c0c8, N: 0x5b8def, water: 0x9ec9ff };
  const RDBU = ['#053061', '#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#f7f7f7', '#fddbc7', '#f4a582', '#d6604d', '#b2182b', '#67001f'];
  const VIRIDIS = ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'];

  function webglAvailable() {
    try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
  }
  const hex = (h) => parseInt(h.slice(1), 16);
  function rampColor(stops, t) {
    t = Math.max(0, Math.min(1, t)); const u = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(u)), f = u - i;
    const a = hex(stops[i]), b = hex(stops[i + 1]);
    const ch = (s) => (((a >> s) & 255) * (1 - f) + ((b >> s) & 255) * f) / 255;
    return [ch(16), ch(8), ch(0)];
  }
  /* armchair (n,n) carbon positions along x, centred, scaled to carbon-centre radius R */
  function cntAtoms(n, L, R) {
    const s3 = Math.sqrt(3), a = s3 * 0.142, a1 = [a, 0], a2 = [a / 2, a * s3 / 2];
    const Ch = [n * (a1[0] + a2[0]), n * (a1[1] + a2[1])], Cl = Math.hypot(Ch[0], Ch[1]);
    const Tv = [a1[0] - a2[0], a1[1] - a2[1]], Tl = Math.hypot(Tv[0], Tv[1]), basis = [[0, 0], [(a1[0] + a2[0]) / 3, (a1[1] + a2[1]) / 3]];
    const atoms = [], seen = new Set(), lim = Math.ceil(L / a) + n + 4;
    for (let i = -lim; i <= lim; i++) for (let j = -lim; j <= lim; j++) for (const b of basis) {
      const x = i * a1[0] + j * a2[0] + b[0], y = i * a1[1] + j * a2[1] + b[1];
      const u = (x * Ch[0] + y * Ch[1]) / (Cl * Cl), w = (x * Tv[0] + y * Tv[1]) / Tl;
      if (u < -1e-9 || u >= 1 - 1e-9 || w < -1e-9 || w >= L - 1e-9) continue;
      const key = Math.round(u * 1e6) + ',' + Math.round(w * 1e6);
      if (seen.has(key)) continue; seen.add(key);
      const th = 2 * Math.PI * u; atoms.push([w - L / 2, R * Math.cos(th), R * Math.sin(th)]);
    }
    const bonds = [], R0 = Cl / (2 * Math.PI), dmax = 0.155 * R / R0 + 0.01;
    for (let p = 0; p < atoms.length; p++) for (let q = p + 1; q < atoms.length; q++) {
      const dx = atoms[p][0] - atoms[q][0], dy = atoms[p][1] - atoms[q][1], dz = atoms[p][2] - atoms[q][2];
      if (dx * dx + dy * dy + dz * dz < dmax * dmax) bonds.push([p, q]);
    }
    return { atoms, bonds };
  }
  const copy = (o) => JSON.parse(JSON.stringify(o));
  function mulberry(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  function IonView(THREE, host, hooks) {
    const T = this.T = THREE;
    this.host = host; this.hooks = hooks || {};
    this.playing = !this.hooks.reduceMotion; this.visible = false; this.raf = 0; this.last = 0; this.frames = 0; this.needs = true; this.anim = null;
    this.overlay = 'conc'; this.species = 0; this.data = null; this.particles = [[], []]; this.spawnAcc = [0, 0]; this.disp = [0, 0]; this.rng = mulberry(20261021);
    const canvas = this.canvas = document.createElement('canvas');
    canvas.className = 'ion-3d-canvas'; canvas.tabIndex = 0; canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Cutaway of the membrane around one carbon nanotube, with the computed field on a section through the pore axis and schematic Na⁺ and Cl⁻ markers moving at the computed drift speed.');
    host.appendChild(canvas);
    this.labels = document.createElement('div'); this.labels.className = 'ion-3d-labels'; this.labels.setAttribute('aria-hidden', 'true'); host.appendChild(this.labels);
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    const scene = this.scene = new T.Scene();
    scene.background = new T.Color(COL.bg);
    this.camera = new T.PerspectiveCamera(40, 1, 0.05, 400);
    scene.add(new T.HemisphereLight(0xdfe8f0, 0x1b2a3a, 1.3));
    const key = new T.DirectionalLight(0xffffff, 2.2); key.position.set(-10, 18, 22); scene.add(key);
    const rim = new T.DirectionalLight(0x9fd9ff, 0.6); rim.position.set(14, 4, -18); scene.add(rim);
    const M = (o) => new T.MeshStandardMaterial(o);
    this.mat = {
      slab: M({ color: 0x33465a, roughness: 0.9, metalness: 0.02, side: T.DoubleSide }),
      C: M({ color: COL.C, roughness: 0.4, metalness: 0.25 }), bond: M({ color: COL.bond, roughness: 0.5, metalness: 0.2 }),
      Na: M({ color: COL.Na, roughness: 0.35 }), Cl: M({ color: COL.Cl, roughness: 0.35 }),
      O: M({ color: COL.O, roughness: 0.35 }), H: M({ color: COL.H, roughness: 0.35 }),
      rimO: M({ color: COL.rimO, roughness: 0.4 }), rimC: M({ color: COL.rimC, roughness: 0.4 }), N: M({ color: COL.N, roughness: 0.4 }),
      water: new T.MeshStandardMaterial({ color: COL.water, roughness: 0.5, transparent: true, opacity: 0.35, depthWrite: false }),
      field: new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide, transparent: true, opacity: 1, depthWrite: false }),
      cone: new T.LineBasicMaterial({ color: 0xdbe4ee, transparent: true, opacity: 0.3 }),
      bar: new T.LineBasicMaterial({ color: 0xe9eef3 }),
    };
    this.geo = { sphere: new T.SphereGeometry(1, 16, 10), bond: new T.CylinderGeometry(1, 1, 1, 6, 1, true) };
    this.group = new T.Group(); scene.add(this.group);
    this.dyn = new T.Group(); scene.add(this.dyn);
    this.tmp = { m: new T.Matrix4(), q: new T.Quaternion(), v: new T.Vector3(), s: new T.Vector3(), up: new T.Vector3(0, 1, 0) };
    this.homes = { pore: { az: -0.5, el: 0.3, dist: 8.2, target: [0, -0.15, -0.2] }, device: { az: -0.6, el: 0.36, dist: 24, target: [0, 0, 0] } };
    this.preset = this.hooks.preset === 'device' ? 'device' : 'pore';
    this.orbit = copy(this.homes[this.preset]); this.interacted = false;
    this.bindControls();
    const self = this;
    if (root.ResizeObserver) { this.ro = new ResizeObserver(() => self.resize()); this.ro.observe(host); }
    this.onVis = () => { if (document.hidden) self.stop(); else if (self.visible) self.start(); };
    document.addEventListener('visibilitychange', this.onVis);
    this.resize();
  }

  /* ------------------------------------------------------------------ scene from a solution */
  IonView.prototype.clear = function (g) {
    while (g.children.length) { const o = g.children.pop(); if (o.geometry && o.geometry !== this.geo.sphere && o.geometry !== this.geo.bond) o.geometry.dispose(); }
  };
  IonView.prototype.inst = function (geo, mat, n, g) { const m = new this.T.InstancedMesh(geo, mat, Math.max(1, n)); m.count = n; m.instanceMatrix.setUsage(this.T.DynamicDrawUsage); (g || this.group).add(m); return m; };
  IonView.prototype.place = function (mesh, i, x, y, z, r) { const t = this.tmp; t.m.compose(t.v.set(x, y, z), t.q.identity(), t.s.set(r, r, r)); mesh.setMatrixAt(i, t.m); };

  /* d: { n, Rc, a, L, x[], r[], c[2][], phi[], J[2], Q, I, step, rimN, solvation, lining, nRef[2], nPore[2], waterPerNm, ionSize, cres[2], V } */
  IonView.prototype.setData = function (d) {
    const T = this.T, geomKey = [d.n, d.Rc, d.a, d.L, d.step >= 2 ? d.rimN : 0, d.step >= 4 ? d.lining : 'none'].join('|');
    this.data = d;
    if (geomKey !== this.geomKey) { this.geomKey = geomKey; this.buildStatic(d); }
    this.buildField(); this.resetParticles(); this.buildWater();
    this.needs = true; this.kick();
  };
  IonView.prototype.buildStatic = function (d) {
    const T = this.T; this.clear(this.group);
    const L = d.L, Rh = d.Rc + 0.17, Hs = Math.max(3.2, d.Rc + 2.6), Ds = 2.2;
    // membrane slab, back half (z ≤ 0), with the half-cylindrical channel cut through it
    const shape = new T.Shape();
    shape.moveTo(0, -Hs); shape.lineTo(0, -Rh); shape.absarc(0, 0, Rh, -Math.PI / 2, Math.PI / 2, false); shape.lineTo(0, Hs); shape.lineTo(Ds, Hs); shape.lineTo(Ds, -Hs); shape.lineTo(0, -Hs);
    const g = new T.ExtrudeGeometry(shape, { depth: L, bevelEnabled: false, curveSegments: 24 });
    g.rotateY(Math.PI / 2); g.translate(-L / 2, 0, 0);                  // shape u → −z, extrusion → +x
    const slab = new T.Mesh(g, this.mat.slab); this.group.add(slab);
    const edges = new T.LineSegments(new T.EdgesGeometry(g, 30), new T.LineBasicMaterial({ color: 0xdbe4ee, transparent: true, opacity: 0.22 })); this.group.add(edges);
    // carbon lattice, back half only so the channel is open to view
    const tube = cntAtoms(d.n, L, d.Rc), keep = tube.atoms.map((p) => p[2] <= 0.05);
    const idx = []; tube.atoms.forEach((p, i) => { if (keep[i]) idx.push(i); });
    const cm = this.inst(this.geo.sphere, this.mat.C, idx.length);
    idx.forEach((i, k) => this.place(cm, k, tube.atoms[i][0], tube.atoms[i][1], tube.atoms[i][2], 0.055));
    const bl = tube.bonds.filter((b) => keep[b[0]] && keep[b[1]]), bm = this.inst(this.geo.bond, this.mat.bond, bl.length), t = this.tmp;
    bl.forEach((b, k) => {
      const p = tube.atoms[b[0]], q = tube.atoms[b[1]], dir = new T.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]), len = dir.length();
      t.q.setFromUnitVectors(t.up, dir.normalize()); t.m.compose(t.v.set((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2), t.q, t.s.set(0.018, len, 0.018)); bm.setMatrixAt(k, t.m);
    });
    this.atomCount = idx.length;
    // charged rims: COO⁻ groups on the remaining (back) half of each rim
    this.rimGroups = 0;
    if (d.step >= 2 && d.rimN > 0) {
      const om = this.inst(this.geo.sphere, this.mat.rimO, 4 * d.rimN), cmm = this.inst(this.geo.sphere, this.mat.rimC, 2 * d.rimN);
      let ko = 0, kc = 0;
      for (const sx of [-1, 1]) for (let j = 0; j < d.rimN; j++) {
        const th = Math.PI * (1 + (j + 0.5) / d.rimN), cy = (d.Rc + 0.05) * Math.cos(th), cz = (d.Rc + 0.05) * Math.sin(th), x = sx * (L / 2 + 0.13);
        this.place(cmm, kc++, x, cy, cz, 0.07);
        this.place(om, ko++, x + sx * 0.08, cy + 0.1 * Math.cos(th + 0.6), cz + 0.1 * Math.sin(th + 0.6), 0.075);
        this.place(om, ko++, x + sx * 0.08, cy + 0.1 * Math.cos(th - 0.6), cz + 0.1 * Math.sin(th - 0.6), 0.075);
        this.rimGroups++;
      }
      om.count = ko;
    }
    // lining motif (illustrative): carbonyl oxygens or N–H donors on the inner wall of the selectivity region
    this.liningMarks = 0;
    if (d.step >= 4 && d.lining && d.lining !== 'carbon') {
      const rings = Math.max(3, Math.round(L / 0.8)), per = 4, mesh = this.inst(this.geo.sphere, d.lining === 'carbonyl' ? this.mat.O : this.mat.N, rings * per);
      let k = 0;
      for (let i = 0; i < rings; i++) for (let j = 0; j < per; j++) {
        const x = -L / 2 + (i + 0.5) * L / rings, th = Math.PI * (1.08 + 0.84 * j / (per - 1)) + (i % 2) * 0.2, r = d.Rc - 0.12;
        this.place(mesh, k++, x, r * Math.cos(th), r * Math.sin(th), 0.07);
      }
      this.liningMarks = k;
    }
    // outline of the reduced model's access cones on the section plane
    const pts = [];
    for (const sx of [-1, 1]) {
      const r1 = d.a + ALPHA * S_VIEW;
      pts.push(new T.Vector3(sx * L / 2, d.a, 0.002), new T.Vector3(sx * (L / 2 + S_VIEW), r1, 0.002), new T.Vector3(sx * L / 2, -d.a, 0.002), new T.Vector3(sx * (L / 2 + S_VIEW), -r1, 0.002));
    }
    this.group.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(pts), this.mat.cone));
    // 1 nm scale bar below the membrane
    const y0 = -(Rh + 1.1), x0 = -0.5;                                     // 1 nm scale bar on the membrane face, under the pore
    this.group.add(new T.LineSegments(new T.BufferGeometry().setFromPoints([new T.Vector3(x0, y0, 0.01), new T.Vector3(x0 + 1, y0, 0.01), new T.Vector3(x0, y0 - 0.12, 0.01), new T.Vector3(x0, y0 + 0.12, 0.01), new T.Vector3(x0 + 1, y0 - 0.12, 0.01), new T.Vector3(x0 + 1, y0 + 0.12, 0.01)]), this.mat.bar));
    const yc = d.a + ALPHA * 0.9 + 0.4;                                // just outside the cone edge, 0.9 nm beyond each mouth
    const yw = d.a + ALPHA * 2.8 + 0.45;
    this.anchorSets = {                                                // label positions for the close pore view and the wider view
      pore: { feed: [-(L / 2 + 0.9), -yc, 0.05], perm: [L / 2 + 0.9, -yc, 0.05], sel: [0, Rh + 0.35, -0.2], bar: [x0 + 0.5, y0 - 0.3, 0.02], rim: [-(L / 2 + 0.15), -(d.Rc + 0.5), -0.3], cone: [-(L / 2 + 2.6), d.a + ALPHA * 2.6 + 0.35, 0] },
      device: { feed: [-(L / 2 + 2.8), -yw, 0.05], perm: [L / 2 + 2.8, -yw, 0.05], sel: [0, Rh + 0.35, -0.2], bar: [x0 + 0.5, y0 - 0.3, 0.02], cone: [-(L / 2 + 2.6), d.a + ALPHA * 2.6 + 0.35, 0] },
    };
    this.anchors = this.anchorSets.pore;
    this.makeLabels(d);
  };
  IonView.prototype.makeLabels = function (d) {
    const lab = (k, text, cls) => '<span class="ion-3d-label ' + (cls || '') + '" data-k="' + k + '">' + text + '</span>';
    const c = (v) => (v / 1000).toPrecision(3) + ' M';
    this.labels.innerHTML = lab('feed', 'Feed · ' + c(d.cres[0])) + lab('perm', 'Permeate · ' + c(d.cres[1])) + lab('sel', 'Selectivity region (pore)', 'is-sel') + lab('bar', '1 nm') +
      lab('cone', 'Access region of the model', 'is-dim') + (this.rimGroups ? lab('rim', 'COO⁻ rim (fixed charge)', 'is-dim') : '');
  };
  // field on the section plane (z = 0): pore strip |y| < a, access cones |y| < a + 4/π s
  IonView.prototype.fieldValue = function (k) {
    const d = this.data;
    if (this.overlay === 'conc') return Math.log10(Math.max(1e-30, d.c[this.species][k] / d.cres[d.x[k] < 0 ? 0 : 1]));
    if (this.overlay === 'phi') return d.phi[k] * 1000;
    const A = Math.PI * d.r[k] * d.r[k]; return Math.log10(Math.abs(d.I) / A + 1e-300);           // r in m
  };
  IonView.prototype.range = function () {
    const d = this.data, xs = d.x;
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < xs.length; k++) { const xn = xs[k] * 1e9; if (Math.abs(xn) > d.L / 2 + S_VIEW) continue; const v = this.fieldValue(k); if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    if (this.overlay === 'conc') { const m = Math.min(4, Math.max(1, Math.ceil(Math.max(Math.abs(lo), Math.abs(hi))))); return { lo: -m, hi: m, ramp: RDBU }; }
    if (this.overlay === 'phi') { const m = Math.max(5, Math.ceil(Math.max(Math.abs(lo), Math.abs(hi)) / 5) * 5); return { lo: -m, hi: m, ramp: RDBU }; }
    return { lo: Math.floor(lo), hi: Math.max(Math.floor(lo) + 1, Math.ceil(hi)), ramp: VIRIDIS };
  };
  IonView.prototype.buildField = function () {
    const T = this.T, d = this.data;
    if (this.fieldMesh) { this.group.remove(this.fieldMesh); this.fieldMesh.geometry.dispose(); }
    const rg = this.rangeNow = this.range(), pos = [], col = [], ind = [];
    const xs = [], ks = [];
    d.x.forEach((x, k) => { const xn = x * 1e9; if (Math.abs(xn) <= d.L / 2 + S_VIEW + 1e-9) { xs.push(xn); ks.push(k); } });
    xs.forEach((xn, j) => {
      const r = Math.abs(xn) <= d.L / 2 ? d.a : d.a + ALPHA * (Math.abs(xn) - d.L / 2), v = this.fieldValue(ks[j]), c = rampColor(rg.ramp, (v - rg.lo) / (rg.hi - rg.lo));
      // full strength in the pore; in the access regions the field fades with distance from the mouth and, for the diverging
      // maps, with closeness to the neutral colour, so the pore and the double layers at its mouths stay the focus
      const t = (v - rg.lo) / (rg.hi - rg.lo), out = Math.max(0, Math.abs(xn) - d.L / 2) / S_VIEW;
      const dev = rg.ramp === VIRIDIS ? 0.5 : Math.min(1, 2 * Math.abs(t - 0.5));
      const al = out > 0 ? (0.06 + 0.8 * dev) * Math.max(0, 1 - 0.85 * out) : 0.92;
      pos.push(xn, -r, 0, xn, r, 0); col.push(c[0], c[1], c[2], al, c[0], c[1], c[2], al);
      if (j > 0) { const b = 2 * (j - 1); ind.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    });
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 4)); g.setIndex(ind);
    this.fieldMesh = new T.Mesh(g, this.mat.field); this.fieldMesh.renderOrder = 1; this.group.add(this.fieldMesh);
  };
  /* legend of the current overlay for the page */
  IonView.prototype.legend = function () {
    const rg = this.rangeNow || { lo: 0, hi: 1, ramp: VIRIDIS }, sp = this.species === 0 ? 'Na⁺' : 'Cl⁻';
    const ticks = [];
    const n = rg.hi - rg.lo <= 8 ? rg.hi - rg.lo : 4;
    for (let i = 0; i <= n; i++) ticks.push(rg.lo + (rg.hi - rg.lo) * i / n);
    if (this.overlay === 'conc') return { title: sp + ' concentration relative to its reservoir', unit: 'c / c_res', ramp: rg.ramp, ticks: ticks.map((v) => ({ t: (v - rg.lo) / (rg.hi - rg.lo), label: v === 0 ? '1' : '10' + String(v).replace('-', '⁻').replace(/\d/g, (q) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[q]) })), note: 'Red: enriched; blue: depleted. On the section through the axis; markers are drawn with the same line density.' };
    if (this.overlay === 'phi') return { title: 'Electric potential', unit: 'mV', ramp: rg.ramp, ticks: ticks.map((v) => ({ t: (v - rg.lo) / (rg.hi - rg.lo), label: String(Math.round(v)) })), note: 'Feed reservoir at the applied voltage, permeate at 0.' };
    return { title: 'Current density |I| / A(x)', unit: 'A m⁻²', ramp: rg.ramp, ticks: ticks.map((v) => ({ t: (v - rg.lo) / (rg.hi - rg.lo), label: '10' + String(Math.round(v)).replace('-', '⁻').replace(/\d/g, (q) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[q]) })), note: 'The same current through a changing cross-section: it crowds in the pore.' };
  };
  IonView.prototype.setOverlay = function (name, species) { this.overlay = name; if (species != null) this.species = species; if (this.data) { this.buildField(); this.needs = true; this.kick(); } };

  /* ------------------------------------------------------------------ markers */
  IonView.prototype.lineDensity = function (s, k) {                // ions per nm in the front half (z ≥ 0); c in mol m⁻³, r in m
    const d = this.data, A = Math.PI * d.r[k] * d.r[k];
    return 0.5 * d.c[s][k] * 6.02214076e23 * A * 1e-9;
  };
  IonView.prototype.interp = function (arr, xn) {                    // value of a nodal array at x (nm)
    const d = this.data, xs = this.xnm; let lo = 0, hi = xs.length - 1;
    if (xn <= xs[0]) return arr[0]; if (xn >= xs[hi]) return arr[hi];
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= xn) lo = mid; else hi = mid; }
    const f = (xn - xs[lo]) / (xs[hi] - xs[lo]); return arr[lo] * (1 - f) + arr[hi] * f;
  };
  IonView.prototype.resetParticles = function () {
    const d = this.data, X0 = d.L / 2 + S_VIEW;
    this.xnm = d.x.map((x) => x * 1e9);
    this.dens = [0, 1].map((s) => d.x.map((x, k) => this.lineDensity(s, k)));
    // mean drift speed v = J/(N_A c A) in nm/ns: ions per ns divided by ions per nm
    this.vel = [0, 1].map((s) => d.x.map((x, k) => { const n = 2 * this.dens[s][k]; return n > 0 ? d.J[s] * 6.02214076e23 * 1e-9 / n : 0; }));
    this.scale = [1, 1];
    for (let s = 0; s < 2; s++) {
      // cumulative count over the drawn interval
      const cum = [0], xs = [];
      for (let k = 0; k < this.xnm.length; k++) { if (Math.abs(this.xnm[k]) > X0) continue; xs.push(k); }
      for (let j = 1; j < xs.length; j++) { const a = xs[j - 1], b = xs[j]; cum.push(cum[j - 1] + 0.5 * (this.dens[s][a] + this.dens[s][b]) * (this.xnm[b] - this.xnm[a])); }
      const N = cum[cum.length - 1], k = Math.max(1, Math.ceil(N / MAX_MARKERS)), count = Math.round(N / k);
      this.scale[s] = k;
      const ps = [];
      for (let i = 0; i < count; i++) {
        const target = (i + this.rng()) / count * N; let j = 1; while (j < cum.length - 1 && cum[j] < target) j++;
        const a = xs[j - 1], b = xs[j], f = (target - cum[j - 1]) / Math.max(1e-30, cum[j] - cum[j - 1]);
        ps.push(this.newParticle(this.xnm[a] + f * (this.xnm[b] - this.xnm[a])));
      }
      this.particles[s] = ps;
    }
    this.spawnAcc = [0, 0]; this.disp = [0, 0];
    this.buildMarkers();
  };
  IonView.prototype.newParticle = function (x) {
    const u = Math.sqrt(this.rng()) * 0.92, th = Math.PI * (0.06 + 0.88 * this.rng());
    const dirs = [];                                                  // shell directions, the most axial first
    for (let i = 0; i < 8; i++) { const z = 2 * this.rng() - 1, ph = 2 * Math.PI * this.rng(), s = Math.sqrt(1 - z * z); dirs.push([z, s * Math.cos(ph), s * Math.sin(ph)]); }
    dirs.sort((p, q) => Math.abs(q[0]) - Math.abs(p[0]));
    return { x, u, th, dirs };
  };
  IonView.prototype.radiusAt = function (xn) { const d = this.data; return Math.abs(xn) <= d.L / 2 ? d.a : d.a + ALPHA * (Math.abs(xn) - d.L / 2); };
  IonView.prototype.shellCount = function (s, xn) {                  // first-shell waters drawn with an ion at x
    const d = this.data;
    if (!(d.step >= 4) || d.solvation === 'born') return 0;
    const half = d.L / 2, w = 0.15, inside = 0.5 * (Math.tanh((xn + half) / w) - Math.tanh((xn - half) / w));
    return d.nRef[s] + (d.nPore[s] - d.nRef[s]) * inside;
  };
  IonView.prototype.buildMarkers = function () {
    const d = this.data; this.clear(this.dyn);
    const n0 = this.particles[0].length, n1 = this.particles[1].length;
    this.ionMesh = [this.inst(this.geo.sphere, this.mat.Na, n0, this.dyn), this.inst(this.geo.sphere, this.mat.Cl, n1, this.dyn)];
    const shells = d.step >= 4 && d.solvation !== 'born';
    this.shellO = this.inst(this.geo.sphere, this.mat.O, shells ? 8 * (n0 + n1) : 0, this.dyn);
    this.shellH = this.inst(this.geo.sphere, this.mat.H, shells ? 16 * (n0 + n1) : 0, this.dyn);
    this.ionR = d.step <= 2 ? [0.09, 0.09] : (d.step === 3 ? [d.ionSize / 2, d.ionSize / 2] : (d.solvation === 'born' ? [0.188, 0.202] : [0.102, 0.181]));
    this.placeMarkers();
  };
  IonView.prototype.placeMarkers = function () {
    const d = this.data, R1 = [0.24, 0.32];
    let ko = 0, kh = 0;
    for (let s = 0; s < 2; s++) {
      const mesh = this.ionMesh[s], ps = this.particles[s];
      mesh.count = ps.length;
      ps.forEach((p, i) => {
        const r = this.radiusAt(p.x) * p.u, y = r * Math.cos(p.th), z = Math.max(0.02, r * Math.sin(p.th));
        this.place(mesh, i, p.x, y, z, this.ionR[s]);
        if (this.shellO.count === 0 && !(d.step >= 4 && d.solvation !== 'born')) return;
        const m = this.shellCount(s, p.x), full = Math.floor(m), frac = m - full;
        for (let j = 0; j < Math.min(8, Math.ceil(m - 1e-9)); j++) {
          const dir = p.dirs[j], sc = j < full ? 1 : Math.max(0.25, frac), ox = p.x + R1[s] * dir[0], oy = y + R1[s] * dir[1], oz = z + R1[s] * dir[2];
          this.place(this.shellO, ko++, ox, oy, oz, 0.075 * sc);
          // hydrogens: pointing away from a cation, one towards an anion
          const sgn = s === 0 ? 1 : -1;
          for (const off of [0.9, -0.9]) {
            const hx = ox + sgn * 0.08 * dir[0] + 0.05 * off * dir[1], hy = oy + sgn * 0.08 * dir[1] - 0.05 * off * dir[0], hz = oz + sgn * 0.08 * dir[2];
            this.place(this.shellH, kh++, hx, hy, hz, 0.042 * sc);
          }
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.shellO.count = ko; this.shellH.count = kh;
    this.shellO.instanceMatrix.needsUpdate = true; this.shellH.instanceMatrix.needsUpdate = true;
    this.shellWaters = ko;
  };
  IonView.prototype.stepParticles = function (dt) {
    const d = this.data, X0 = d.L / 2 + S_VIEW, tns = dt * NS_PER_S;
    for (let s = 0; s < 2; s++) {
      const ps = this.particles[s], J = d.J[s];
      if (!(Math.abs(J) > 0)) continue;
      const out = [];
      for (const p of ps) {
        // sub-steps keep fast markers from jumping across the pore in one frame
        let t = tns, guard = 0;
        while (t > 0 && guard++ < 50) { const v = this.interp(this.vel[s], p.x), h = Math.min(t, 0.25 / Math.max(1e-9, Math.abs(v))); p.x += v * h; this.disp[s] += v * h; t -= h; }
        if (Math.abs(p.x) <= X0) out.push(p);
      }
      // new markers enter at the upstream end at the computed rate (front half of the flux, one marker per scale ions)
      this.spawnAcc[s] += Math.abs(J) * 6.02214076e23 * 1e-9 * 0.5 * tns / this.scale[s];
      while (this.spawnAcc[s] >= 1) { this.spawnAcc[s] -= 1; const x = (J > 0 ? -X0 : X0) * (1 - 1e-6 * this.rng()); out.push(this.newParticle(x)); }
      this.particles[s] = out;
    }
    if (this.particles[0].length !== this.ionMesh[0].count || this.particles[1].length !== this.ionMesh[1].count) {
      const cap = (m, n) => m.instanceMatrix.count >= n;
      if (!cap(this.ionMesh[0], this.particles[0].length) || !cap(this.ionMesh[1], this.particles[1].length) || !cap(this.shellO, 8 * (this.particles[0].length + this.particles[1].length))) { this.buildMarkers(); return; }
    }
    this.placeMarkers();
  };
  // water column in the pore: static without flow; with electro-osmosis it moves so that density × speed = Q
  IonView.prototype.buildWater = function () {
    const d = this.data; if (this.waterMesh) { this.dyn.remove(this.waterMesh); }
    const n = Math.max(2, Math.round(d.waterPerNm * d.L));
    this.waterMesh = this.inst(this.geo.sphere, this.mat.water, n, this.dyn); this.waterPhase = 0;
    this.waterSpeed = d.Q && d.waterPerNm > 0 ? (d.Q / 3.00184e-29 * 1e-9) / d.waterPerNm : 0;   // nm/ns
    this.placeWater();
  };
  IonView.prototype.placeWater = function () {
    const d = this.data, n = this.waterMesh.count, sp = d.L / n;
    for (let i = 0; i < n; i++) {
      let x = -d.L / 2 + ((i + 0.5) * sp + this.waterPhase) % d.L; if (x > d.L / 2) x -= d.L; if (x < -d.L / 2) x += d.L;
      const th = Math.PI * (0.2 + 0.6 * ((i * 0.618) % 1)), r = Math.max(0, d.a - 0.15) * ((i * 0.37) % 1);
      this.place(this.waterMesh, i, x, r * Math.cos(th), Math.max(0.03, r * Math.sin(th)), 0.07);
    }
    this.waterMesh.instanceMatrix.needsUpdate = true;
  };

  /* ------------------------------------------------------------------ labels, camera, controls, loop */
  IonView.prototype.placeLabels = function () {
    if (!this.anchors) return;
    const w = this.cw, h = this.ch, v = this.tmp.v, A = (this.anchorSets && this.anchorSets[this.preset]) || this.anchors;
    for (const e of this.labels.children) {
      const a = A[e.getAttribute('data-k')]; if (!a) { e.style.visibility = 'hidden'; continue; }
      v.set(a[0], a[1], a[2]).project(this.camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      e.style.visibility = vis ? 'visible' : 'hidden';
      if (!vis) continue;
      const ew = e.offsetWidth; let x = (v.x + 1) / 2 * w - ew / 2, y = (1 - v.y) / 2 * h;
      x = Math.max(4, Math.min(w - 4 - ew, x));
      e.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
    }
  };
  IonView.prototype.applyCamera = function () {
    const o = this.orbit, c = this.camera, t = o.target;
    c.position.set(t[0] + o.dist * Math.cos(o.el) * Math.sin(o.az), t[1] + o.dist * Math.sin(o.el), t[2] + o.dist * Math.cos(o.el) * Math.cos(o.az));
    c.lookAt(t[0], t[1], t[2]);
  };
  IonView.prototype.homeFor = function (name) { const h = copy(this.homes[name]); if (this.cw / this.ch < 1.1) h.dist *= 1.35; return h; };
  IonView.prototype.goTo = function (home, animate) {
    if (!animate || this.hooks.reduceMotion || !this.visible) { this.anim = null; this.orbit = copy(home); }
    else this.anim = { from: copy(this.orbit), to: copy(home), t: 0, dur: 0.7 };
    this.needs = true; this.kick();
  };
  IonView.prototype.setPreset = function (name, animate) { this.preset = name === 'device' ? 'device' : 'pore'; this.interacted = false; this.goTo(this.homeFor(this.preset), animate !== false); };
  IonView.prototype.resetView = function () { this.interacted = false; this.goTo(this.homeFor(this.preset), true); };
  IonView.prototype.stepAnim = function (dt) {
    const a = this.anim; if (!a) return;
    a.t = Math.min(1, a.t + dt / a.dur);
    const s = a.t * a.t * (3 - 2 * a.t), lerp = (p, q) => p + (q - p) * s;
    let daz = a.to.az - a.from.az; daz = Math.atan2(Math.sin(daz), Math.cos(daz));
    this.orbit = { az: a.from.az + daz * s, el: lerp(a.from.el, a.to.el), dist: a.from.dist * Math.pow(a.to.dist / a.from.dist, s), target: [0, 1, 2].map((i) => lerp(a.from.target[i], a.to.target[i])) };
    if (a.t >= 1) { this.orbit = copy(a.to); this.anim = null; }
    this.needs = true;
  };
  IonView.prototype.bindControls = function () {
    const c = this.canvas, self = this, pts = new Map();
    let drag = null, pinch = 0;
    const touched = () => { self.anim = null; self.interacted = true; self.needs = true; self.kick(); };
    c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); drag = [e.clientX, e.clientY]; if (pts.size === 2) { const v = [...pts.values()]; pinch = Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]); } });
    c.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) { const v = [...pts.values()], dd = Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]); if (pinch > 0) self.zoom(pinch / dd); pinch = dd; return; }
      if (!drag) return; const dx = e.clientX - drag[0], dy = e.clientY - drag[1]; drag = [e.clientX, e.clientY];
      if (Math.abs(dx) + Math.abs(dy) > 0) { self.orbit.az -= dx * 0.006; self.orbit.el = Math.max(-0.6, Math.min(1.45, self.orbit.el + dy * 0.005)); touched(); }
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; if (!pts.size) drag = null; };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => { e.preventDefault(); self.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    c.addEventListener('dblclick', () => self.resetView());
    c.addEventListener('keydown', (e) => {
      const k = e.key; let used = true;
      if (k === 'Home' || k === '0') { e.preventDefault(); self.resetView(); return; }
      if (k === 'ArrowLeft') self.orbit.az += 0.08; else if (k === 'ArrowRight') self.orbit.az -= 0.08;
      else if (k === 'ArrowUp') self.orbit.el = Math.min(1.45, self.orbit.el + 0.06); else if (k === 'ArrowDown') self.orbit.el = Math.max(-0.6, self.orbit.el - 0.06);
      else if (k === '+' || k === '=') self.zoom(0.88); else if (k === '-' || k === '_') self.zoom(1.14); else used = false;
      if (used) { e.preventDefault(); touched(); }
    });
  };
  IonView.prototype.zoom = function (f) { this.anim = null; this.orbit.dist = Math.max(3, Math.min(80, this.orbit.dist * f)); this.interacted = true; this.needs = true; this.kick(); };
  IonView.prototype.resize = function () {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    if (w === this.cw && h === this.ch) return;
    this.cw = w; this.ch = h; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (!this.interacted) { this.anim = null; this.orbit = this.homeFor(this.preset); }
    this.needs = true; this.kick();
  };
  IonView.prototype.setVisible = function (v) { this.visible = v; if (v) { this.resize(); this.start(); } else this.stop(); };
  IonView.prototype.setPlaying = function (p) { this.playing = p; this.last = 0; this.kick(); };
  IonView.prototype.start = function () { if (!this.raf && this.visible && !document.hidden) { this.last = 0; this.raf = requestAnimationFrame((t) => this.frame(t)); } };
  IonView.prototype.stop = function () { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; };
  IonView.prototype.kick = function () { if (this.visible) this.start(); };
  IonView.prototype.frame = function (now) {
    this.raf = 0;
    if (!this.visible || document.hidden) return;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0; this.last = now;
    const d = this.data, moving = this.playing && d && (Math.abs(d.J[0]) > 0 || Math.abs(d.J[1]) > 0 || this.waterSpeed);
    if (moving && dt > 0) {
      this.stepParticles(dt);
      if (this.waterSpeed) { this.waterPhase = (this.waterPhase + this.waterSpeed * dt * NS_PER_S) % d.L; if (this.waterPhase < 0) this.waterPhase += d.L; this.placeWater(); }
      this.needs = true;
    }
    if (this.anim) this.stepAnim(dt > 0 ? dt : 1 / 60);
    if (this.needs) { this.applyCamera(); this.renderer.render(this.scene, this.camera); this.placeLabels(); this.frames++; this.needs = false; }
    if (moving || this.anim) this.raf = requestAnimationFrame((t) => this.frame(t));
  };
  /* read-only description for the automated checks */
  IonView.prototype.stats = function () {
    return { frames: this.frames, playing: this.playing, preset: this.preset, overlay: this.overlay, species: this.species,
      markers: [this.particles[0].length, this.particles[1].length], ionsPerMarker: this.scale ? this.scale.slice() : [1, 1], displacement_nm: this.disp.slice(),
      carbonAtoms: this.atomCount || 0, rimGroups: this.rimGroups || 0, liningMarks: this.liningMarks || 0, shellWaters: this.shellWaters || 0,
      waterSpeed_nm_per_ns: this.waterSpeed || 0, legend: this.legend().title, nsPerSecond: NS_PER_S };
  };
  IonView.prototype.dispose = function () { this.stop(); document.removeEventListener('visibilitychange', this.onVis); if (this.ro) this.ro.disconnect(); this.renderer.dispose(); this.canvas.remove(); this.labels.remove(); };

  async function create(host, hooks) {
    if (!webglAvailable()) { const err = new Error('WebGL is not available in this browser'); err.code = 'NO_WEBGL'; throw err; }
    const THREE = await import('../vendor/three.module.min.js');
    return new IonView(THREE, host, hooks);
  }
  root.IonView3D = { create, webglAvailable, NS_PER_S, S_VIEW, rampColor, RDBU, VIRIDIS };
})(typeof window !== 'undefined' ? window : globalThis);
