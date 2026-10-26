/* Continuum Lab — ion experiment: the reduced one-dimensional model drawn in 3D.

   A cutaway of the membrane around one carbon nanotube: the back half of the membrane and of the tube (an armchair
   (n,n) lattice at the radius of the recorded CP2K tube), the two access regions of the reduced model (cones of slope
   4/π) and the computed field on the section through the axis, one overlay at a time: concentration, potential or
   current density. The ion markers are not a recorded trajectory: they are placed with the computed line density
   N_A c(x) A(x) and move along the pore at the mean drift speed v(x) = J/(c(x) A(x)) of the computed molar flow J
   (mol s⁻¹), so their density and their flux reproduce the solution; 1 s on screen = 100 ns. The drawing follows the model step: point
   ions (classical, charged rims), spheres of the lattice-gas size (finite size), and with a dehydration closure each
   ion carries the first-shell waters the closure assumes, fewer inside the pore (the recorded CP2K count of this tube,
   or the rigid-shell estimate).
   Release 2026.10.2: the shell water configurations are reconstructed from the recorded runs, so the scene is a composite
   of computed continuum drift and recorded molecular motion on two separate clocks. Their positions relative to the ion
   come from the CP2K runs (data/shells-n-n.bin, written by tools/continuum/ions/make_shells.py from the inspector's trajectories): inside
   the pore the run of the selected tube, outside the (11,11) run (the model's reference shell), cross-faded across each
   mouth. Each marker replays one recorded ion of its species, from its own start time, forward and backward, on a
   separate clock (1 s on screen = 0.1 ps), after a rotation about the tube axis and an optional 180° turn across it.
   Inside the pore the ion keeps its recorded distance from the tube axis (no shift; ions and shells are drawn after the
   section strip so that those just behind the section plane stay visible). The drawn sizes represent the closure's mean
   hydration: each water is weighted by a logistic step in its oxygen distance (width 0.01 nm) placed so that the
   weights add up to the closure's count, and drawn at that fraction of its size. Loaded when the view is first shown; uses three.js 0.160.0 (MIT licence,
   ../vendor/three.module.min.js). */
(function (root) {
  'use strict';
  const NS_PER_S = 100;                    // 1 s on screen = 100 ns of transport
  const S_VIEW = 4.0;                      // nm of each access region drawn beyond the mouth
  const ALPHA = 4 / Math.PI;               // cone slope of the reduced model
  const MAX_MARKERS = 140;                 // per species; above this one marker stands for several ions
  const REPLAY_FS_PER_S = 100;             // shell replay clock: 1 s on screen = 0.1 ps of the recorded run
  const SHELL_DELTA = 0.01;                // nm, width of the logistic weight in the oxygen distance
  const MOUTH_W = 0.15;                    // nm, width of the mouth blend (the same as for the drawn count)
  const Z_FRONT = 0.02;                    // nm, schematic placements (outside the recorded pore shells) sit in front of the section plane
  const REF_TUBE = 11;                     // the (11,11) run: the model's reference (least confined) shell
  const W_DRAW = 1e-3;                     // waters with a smaller weight are not instanced (radius below 0.1 % of full size)
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
    // recorded shells (release 2026.10.2): decoded runs by tube, loading promises, per-species cycling, playing time, scratch
    this.shellTubes = {}; this.shellLoading = {}; this.shellIndexP = null; this.shellError = null; this.shellPick = [0, 0]; this.shellCap = 16; this.playTime = 0; this.pid = 0;
    this.sc = { ion: new Float64Array(3), pos: new Float64Array(64 * 9), d: new Float64Array(64), w: new Float64Array(64), src: new Int8Array(64), idx: new Int16Array(64), n: 0, win: 0, m: 0, shift: 0, tIn: 0, tOut: 0 };
    const canvas = this.canvas = document.createElement('canvas');
    canvas.className = 'ion-3d-canvas'; canvas.tabIndex = 0; canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Cutaway of the membrane around one carbon nanotube, with the computed field on a section through the pore axis and schematic Na⁺ and Cl⁻ markers moving at the computed drift speed; from the dehydration step on, the first-shell water configurations around each ion are reconstructed from recorded CP2K trajectories.');
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
      // ions and shell waters: opaque in look, but drawn in the transparent pass after the section strip (renderOrder 2)
      mNa: M({ color: COL.Na, roughness: 0.35, transparent: true, opacity: 1 }), mCl: M({ color: COL.Cl, roughness: 0.35, transparent: true, opacity: 1 }),
      mO: M({ color: COL.O, roughness: 0.35, transparent: true, opacity: 1 }), mH: M({ color: COL.H, roughness: 0.35, transparent: true, opacity: 1 }),
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
    this.buildField(); this.resetParticles(); this.buildWater(); this.ensureShells();
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
    // mean drift speed v = J/(c A) (J in mol/s, c in mol/m³) in nm/ns: ions per ns divided by ions per nm
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
    const dirs = [];                                                  // schematic shell directions, the most axial first (until the recorded shells load)
    for (let i = 0; i < 8; i++) { const z = 2 * this.rng() - 1, ph = 2 * Math.PI * this.rng(), s = Math.sqrt(1 - z * z); dirs.push([z, s * Math.cos(ph), s * Math.sin(ph)]); }
    dirs.sort((p, q) => Math.abs(q[0]) - Math.abs(p[0]));
    this.pid += 1;
    return { id: this.pid, x, u, th, dirs, sh: null };
  };
  IonView.prototype.radiusAt = function (xn) { const d = this.data; return Math.abs(xn) <= d.L / 2 ? d.a : d.a + ALPHA * (Math.abs(xn) - d.L / 2); };
  // weight of "inside the pore" at x: tanh steps of width 0.15 nm at both mouths, set to exactly 0 or 1 within 1e-4 of them
  IonView.prototype.insideWeight = function (xn) {
    const half = this.data.L / 2, w = 0.5 * (Math.tanh((xn + half) / MOUTH_W) - Math.tanh((xn - half) / MOUTH_W));
    return w > 1 - 1e-4 ? 1 : (w < 1e-4 ? 0 : w);
  };
  IonView.prototype.shellCount = function (s, xn) {                  // first-shell waters drawn with an ion at x
    const d = this.data;
    if (!(d.step >= 4) || d.solvation === 'born') return 0;
    return d.nRef[s] + (d.nPore[s] - d.nRef[s]) * this.insideWeight(xn);
  };

  /* ------------------------------------------------------------------ recorded shells (release 2026.10.2) */
  function decodeShellTube(t, buf) {                                 // int16 milli-ångström → nm (1 milli-Å = 1e-4 nm)
    const dv = new DataView(buf), F = t.frames, dt = t.frame_spacing_fs;
    const out = { n: t.n, label: t.label, F, dt, D: (F - 1) * dt, ions: [[], []] };
    for (const io of t.ions) {
      const W = io.n_waters, yz = new Float64Array(F * 2), wat = new Float64Array(F * W * 9);
      let o = io.offset_bytes;
      for (let i = 0; i < F * 2; i++, o += 2) yz[i] = dv.getInt16(o, true) / 10000;
      for (let i = 0; i < F * W * 9; i++, o += 2) wat[i] = dv.getInt16(o, true) / 10000;
      let my = 0, mz = 0; for (let f = 0; f < F; f++) { my += yz[2 * f]; mz += yz[2 * f + 1]; }
      out.ions[io.species === 'Na+' ? 0 : 1].push({ atom: io.atom_index, W, yz, wat, my: my / F, mz: mz / F });
    }
    return out;
  }
  function pingpong(tau, D) { if (!(D > 0)) return 0; const u = tau % (2 * D); return u <= D ? u : 2 * D - u; }
  /* logistic weights w_k = 1/(1 + exp((d_k − r)/δ)) of n waters starting at o, with r chosen so that they add up to T */
  function shellWeights(d, w, o, n, T) {
    if (!(T > 0) || n === 0) { for (let k = 0; k < n; k++) w[o + k] = 0; return; }
    T = Math.min(T, n * (1 - 1e-12));
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < n; k++) { lo = Math.min(lo, d[o + k]); hi = Math.max(hi, d[o + k]); }
    lo -= 40 * SHELL_DELTA; hi += 40 * SHELL_DELTA;
    let r = 0.5 * (lo + hi);
    for (let it = 0; it < 100; it++) {                                // safeguarded Newton on a monotonic sum
      let S = 0, dS = 0;
      for (let k = 0; k < n; k++) { const v = 1 / (1 + Math.exp((d[o + k] - r) / SHELL_DELTA)); S += v; dS += v * (1 - v) / SHELL_DELTA; }
      const g = S - T;
      if (Math.abs(g) < 1e-13) break;
      if (g > 0) hi = r; else lo = r;
      let rn = dS > 1e-300 ? r - g / dS : NaN;
      if (!(rn > lo && rn < hi)) rn = 0.5 * (lo + hi);
      r = rn;
    }
    for (let k = 0; k < n; k++) w[o + k] = 1 / (1 + Math.exp((d[o + k] - r) / SHELL_DELTA));
  }
  IonView.prototype.shellsOn = function () { const d = this.data; return !!d && d.step >= 4 && d.solvation !== 'born'; };
  IonView.prototype.shellsReady = function () { const d = this.data; return this.shellsOn() && !!this.shellTubes[d.n] && !!this.shellTubes[REF_TUBE]; };
  // fetch the index and the runs of the selected tube and of (11,11); only once shells are drawn (never before Start)
  IonView.prototype.ensureShells = function () {
    if (!this.shellsOn()) return;
    const self = this, d = this.data, base = this.hooks.dataBase || 'ions/data/';
    if (!this.shellIndexP) this.shellIndexP = fetch(base + 'shells.json').then((r) => { if (!r.ok) throw new Error('shells.json: HTTP ' + r.status); return r.json(); });
    for (const n of [d.n, REF_TUBE]) {
      if (this.shellTubes[n] || this.shellLoading[n]) continue;
      this.shellLoading[n] = this.shellIndexP.then((idx) => {
        const t = idx.tubes.find((u) => u.n === n);
        if (!t) throw new Error('no recorded shells for (' + n + ',' + n + ')');
        return fetch(base + t.file).then((r) => { if (!r.ok) throw new Error(t.file + ': HTTP ' + r.status); return r.arrayBuffer(); }).then((buf) => {
          if (buf.byteLength !== t.bytes) throw new Error(t.file + ': ' + buf.byteLength + ' bytes, expected ' + t.bytes);
          self.shellTubes[n] = decodeShellTube(t, buf);
          if (self.shellsReady()) { self.buildMarkers(); self.needs = true; self.kick(); }   // also when paused: show the recorded shells
        });
      }).catch((e) => { self.shellError = String((e && e.message) || e); });
    }
  };
  /* symmetry operations of one marker: an optional 180° turn across the tube ((x, y, z) → (−x, −y, z)), then a rotation
     about the tube axis by φ; inside the pore φ turns the recorded ion's mean position towards the viewer (+z), ± 0.5 rad */
  IonView.prototype.assignShell = function (p, s) {
    const tin = this.shellTubes[this.data.n], tout = this.shellTubes[REF_TUBE], k = this.shellPick[s]++;
    const inIon = k % tin.ions[s].length, outIon = k % tout.ions[s].length, rec = tin.ions[s][inIon];
    const flipIn = this.rng() < 0.5 ? -1 : 1, flipOut = this.rng() < 0.5 ? -1 : 1;
    const phiIn = Math.PI / 2 - Math.atan2(rec.mz, flipIn * rec.my) + (2 * this.rng() - 1) * 0.5, phiOut = 2 * Math.PI * this.rng();
    p.sh = { tube: this.data.n, inIon, outIon, flipIn, flipOut, phiIn, phiOut, cIn: Math.cos(phiIn), sIn: Math.sin(phiIn), cOut: Math.cos(phiOut), sOut: Math.sin(phiOut),
      tau: this.rng() * 2 * Math.max(tin.D, tout.D) };                // replay time (fs), its own start for every marker
  };
  // waters of one recorded ion at time t (fs), after the marker's operations, appended to the scratch with weights adding up to T
  IonView.prototype.addSource = function (rec, tube, t, flip, c, sn, T, srcId) {
    const sc = this.sc, W = rec.W, fi = t / tube.dt, i0 = Math.min(tube.F - 2, Math.floor(fi)), f = fi - i0, b0 = i0 * W * 9, b1 = b0 + W * 9, start = sc.n;
    for (let k = 0; k < W; k++) {
      const o = start + k, q = o * 9;
      for (let a = 0; a < 3; a++) {
        const j0 = b0 + k * 9 + a * 3, j1 = b1 + k * 9 + a * 3;
        let x = (1 - f) * rec.wat[j0] + f * rec.wat[j1], y = (1 - f) * rec.wat[j0 + 1] + f * rec.wat[j1 + 1];
        const z = (1 - f) * rec.wat[j0 + 2] + f * rec.wat[j1 + 2];
        if (flip < 0) { x = -x; y = -y; }
        sc.pos[q + a * 3] = x; sc.pos[q + a * 3 + 1] = y * c - z * sn; sc.pos[q + a * 3 + 2] = y * sn + z * c;
      }
      sc.d[o] = Math.hypot(sc.pos[q], sc.pos[q + 1], sc.pos[q + 2]);
      sc.src[o] = srcId; sc.idx[o] = k;
    }
    sc.n = start + W;
    shellWeights(sc.d, sc.w, start, W, T);
  };
  /* the ion and its shell for marker p at its replay time: inside the pore the selected tube's run, outside the (11,11)
     run, cross-faded with the mouth weight; the ion's position across the pore is recorded inside, schematic outside */
  IonView.prototype.computeShell = function (p, s) {
    const d = this.data, sc = this.sc, sh = p.sh, tin = this.shellTubes[d.n], tout = this.shellTubes[REF_TUBE];
    const win = this.insideWeight(p.x), m = this.shellCount(s, p.x);
    sc.win = win; sc.m = m; sc.n = 0; sc.shift = 0;
    sc.tIn = pingpong(sh.tau, tin.D); sc.tOut = pingpong(sh.tau, tout.D);
    const r0 = this.radiusAt(p.x) * p.u, yOut = r0 * Math.cos(p.th), zOut = Math.max(Z_FRONT, r0 * Math.sin(p.th));
    let yIn = 0, zIn = 0;
    if (win > 0) {
      const rec = tin.ions[s][sh.inIon], fi = sc.tIn / tin.dt, i0 = Math.min(tin.F - 2, Math.floor(fi)), f = fi - i0;
      let y = (1 - f) * rec.yz[2 * i0] + f * rec.yz[2 * i0 + 2];
      const z = (1 - f) * rec.yz[2 * i0 + 1] + f * rec.yz[2 * i0 + 3];
      if (sh.flipIn < 0) y = -y;
      yIn = y * sh.cIn - z * sh.sIn; zIn = y * sh.sIn + z * sh.cIn;
    }
    const y = (1 - win) * yOut + win * yIn, z = (1 - win) * zOut + win * zIn;   // no shift: the recorded distance from the axis is kept
    sc.ion[0] = p.x; sc.ion[1] = y; sc.ion[2] = z;
    if (win > 0) this.addSource(tin.ions[s][sh.inIon], tin, sc.tIn, sh.flipIn, sh.cIn, sh.sIn, win * m, 1);
    if (win < 1) this.addSource(tout.ions[s][sh.outIon], tout, sc.tOut, sh.flipOut, sh.cOut, sh.sOut, (1 - win) * m, 0);
  };

  IonView.prototype.buildMarkers = function () {
    const d = this.data; this.clear(this.dyn);
    if (this.waterMesh) this.dyn.add(this.waterMesh);                 // the water column stays in the scene when the markers are rebuilt
    const n0 = this.particles[0].length, n1 = this.particles[1].length;
    this.ionMesh = [this.inst(this.geo.sphere, this.mat.mNa, n0, this.dyn), this.inst(this.geo.sphere, this.mat.mCl, n1, this.dyn)];
    const cap = this.shellsOn() ? Math.max(8, this.shellCap) : 0;
    this.shellO = this.inst(this.geo.sphere, this.mat.mO, cap * (n0 + n1), this.dyn);
    this.shellH = this.inst(this.geo.sphere, this.mat.mH, 2 * cap * (n0 + n1), this.dyn);
    for (const m of [this.ionMesh[0], this.ionMesh[1], this.shellO, this.shellH]) m.renderOrder = 2;   // after the section strip (renderOrder 1)
    this.ionR = d.step <= 2 ? [0.09, 0.09] : (d.step === 3 ? [d.ionSize / 2, d.ionSize / 2] : (d.solvation === 'born' ? [0.188, 0.202] : [0.102, 0.181]));
    this.placeMarkers();
  };
  IonView.prototype.placeMarkers = function () {
    const d = this.data, R1 = [0.24, 0.32], shells = this.shellsOn(), ready = shells && this.shellsReady();
    const capO = this.shellO.instanceMatrix.count;
    let ko = 0, kh = 0, overflow = false;
    for (let s = 0; s < 2; s++) {
      const mesh = this.ionMesh[s], ps = this.particles[s];
      mesh.count = ps.length;
      ps.forEach((p, i) => {
        if (ready) {
          if (!p.sh || p.sh.tube !== d.n) this.assignShell(p, s);
          this.computeShell(p, s);
          const sc = this.sc, ix = sc.ion[0], iy = sc.ion[1], iz = sc.ion[2];
          this.place(mesh, i, ix, iy, iz, this.ionR[s]);
          for (let k = 0; k < sc.n; k++) {
            const wk = sc.w[k]; if (wk < W_DRAW) continue;
            if (ko >= capO) { overflow = true; continue; }
            const q = k * 9;
            this.place(this.shellO, ko++, ix + sc.pos[q], iy + sc.pos[q + 1], iz + sc.pos[q + 2], 0.075 * wk);
            this.place(this.shellH, kh++, ix + sc.pos[q + 3], iy + sc.pos[q + 4], iz + sc.pos[q + 5], 0.042 * wk);
            this.place(this.shellH, kh++, ix + sc.pos[q + 6], iy + sc.pos[q + 7], iz + sc.pos[q + 8], 0.042 * wk);
          }
          return;
        }
        // schematic placement: steps 1–3, the Born closure, and while the recorded shells load
        const r = this.radiusAt(p.x) * p.u, y = r * Math.cos(p.th), z = Math.max(0.02, r * Math.sin(p.th));
        this.place(mesh, i, p.x, y, z, this.ionR[s]);
        if (!shells) return;
        const m = this.shellCount(s, p.x), full = Math.floor(m), frac = m - full;
        for (let j = 0; j < Math.min(8, Math.ceil(m - 1e-9)); j++) {
          if (ko >= capO) { overflow = true; break; }
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
    if (overflow && this.shellCap < 64) { this.shellCap *= 2; this.buildMarkers(); }
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
    // recorded shells: every marker's replay time advances on its own clock, also at equilibrium
    if (this.shellsReady()) { const dtau = dt * REPLAY_FS_PER_S; for (const ps of this.particles) for (const p of ps) if (p.sh) p.sh.tau += dtau; }
    this.playTime += dt;
    if (this.particles[0].length !== this.ionMesh[0].count || this.particles[1].length !== this.ionMesh[1].count) {
      const cap = (m, n) => m.instanceMatrix.count >= n, per = this.shellsOn() ? Math.max(8, this.shellCap) : 0;
      if (!cap(this.ionMesh[0], this.particles[0].length) || !cap(this.ionMesh[1], this.particles[1].length) || !cap(this.shellO, per * (this.particles[0].length + this.particles[1].length))) { this.buildMarkers(); return; }
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
    const d = this.data, moving = this.playing && d && (Math.abs(d.J[0]) > 0 || Math.abs(d.J[1]) > 0 || this.waterSpeed || this.shellsReady());
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
      waterSpeed_nm_per_ns: this.waterSpeed || 0, legend: this.legend().title, nsPerSecond: NS_PER_S, playTime_s: this.playTime,
      shellReplay: { on: this.shellsOn(), ready: this.shellsReady(), clock_fs_per_s: REPLAY_FS_PER_S, inside: this.data ? '(' + this.data.n + ',' + this.data.n + ')' : null, outside: '(' + REF_TUBE + ',' + REF_TUBE + ')', error: this.shellError } };
  };
  /* read-only: the recorded-shell state of the drawn markers, recomputed at their current replay time exactly as drawn */
  IonView.prototype.shellProbe = function (max) {
    const out = { playTime_s: this.playTime, ready: this.shellsReady(), clock_fs_per_s: REPLAY_FS_PER_S, drawThreshold: W_DRAW, markers: [] };
    if (!out.ready) return out;
    const d = this.data, lim = max || Infinity, v3 = (a, q) => [a[q], a[q + 1], a[q + 2]];
    for (let s = 0; s < 2; s++) for (const p of this.particles[s]) {
      if (out.markers.length >= lim) break;
      if (!p.sh || p.sh.tube !== d.n) continue;                         // not drawn with the recorded shells yet
      this.computeShell(p, s);
      const sc = this.sc, waters = [];
      for (let k = 0; k < sc.n; k++) { const q = k * 9; waters.push({ src: sc.src[k] ? 'in' : 'out', idx: sc.idx[k], w: sc.w[k], drawn: sc.w[k] >= W_DRAW, O: v3(sc.pos, q), H1: v3(sc.pos, q + 3), H2: v3(sc.pos, q + 6) }); }
      out.markers.push({ id: p.id, s, x: p.x, win: sc.win, m: sc.m, tau: p.sh.tau, tIn: sc.tIn, tOut: sc.tOut, shift: sc.shift, ion: v3(sc.ion, 0),
        inside: { tube: d.n, ion: p.sh.inIon, flip: p.sh.flipIn, phi: p.sh.phiIn }, outside: { tube: REF_TUBE, ion: p.sh.outIon, flip: p.sh.flipOut, phi: p.sh.phiOut }, waters });
    }
    return out;
  };
  IonView.prototype.dispose = function () { this.stop(); document.removeEventListener('visibilitychange', this.onVis); if (this.ro) this.ro.disconnect(); this.renderer.dispose(); this.canvas.remove(); this.labels.remove(); };

  async function create(host, hooks) {
    if (!webglAvailable()) { const err = new Error('WebGL is not available in this browser'); err.code = 'NO_WEBGL'; throw err; }
    const THREE = await import('../vendor/three.module.min.js');
    return new IonView(THREE, host, hooks);
  }
  root.IonView3D = { create, webglAvailable, NS_PER_S, S_VIEW, REPLAY_FS_PER_S, rampColor, RDBU, VIRIDIS };
})(typeof window !== 'undefined' ? window : globalThis);
