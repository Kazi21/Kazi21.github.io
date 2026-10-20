/* Continuum Lab — "Pores in 3D": a cutaway block of the membrane around the selected tube, drawn at true geometry
   ((6,6) carbon nanotubes, 0.814 nm carbon-centre diameter and 2.46 nm long, on the 10 nm lattice of the calculation;
   nothing is enlarged), with the water inside every tube drifting at that tube's single-pore flow q_i = G_i ΔΠ_c taken
   from the current solution. The page (app.js) chooses the window, computes q_i and the common speed factor (the clock
   fixed to the baseline) and passes them in; this file only draws. Loaded when the view is first opened; uses three.js
   0.160.0 (MIT licence, vendor/three.module.min.js, vendor/THREE_LICENSE.txt).

   Two camera presets: "Focus pore" (the default: the selected tube close up, with its carbon lattice and water chain)
   and "Array context" (the cut row and the 5 × 5 window). The membrane faces have real openings, one per tube, and
   the tube walls are dark inside, so a rotated close-up looks into the channels. A 1 nm or a 5 nm scale bar is shown
   depending on the camera distance.

   Water molecules are schematic: a single-file chain with one molecule per 0.27 nm (about nine in the tube), SPC/E
   geometry (O–H 0.1000 nm, H–O–H 109.47°, the model of the calibration package and of the Water Lab), each molecule
   donating one hydrogen bond to the next along the axis (the ordered water wire of (6,6) tubes). Only the net drift
   is drawn: thermal motion and back-and-forth crossings are omitted. The feed and permeate water are drawn as
   continuous volumes because the calculation treats them as a continuum. */
(function (root) {
  'use strict';
  const ELL = 0.27;            // nm between neighbouring molecules of the drawn single-file chain
  const END = 0.36;            // nm over which a molecule appears above the entrance and fades below the exit
  const R_O = 0.13, R_H = 0.07, D_OH = 0.1000, ANG_DEG = 109.47, ANG_HOH = ANG_DEG * Math.PI / 180;   // SPC/E geometry
  const NEAR_NM = 11;          // camera distance below which the 1 nm bar (and close-up label anchors) are used
  const COLOURS = { bg: 0x0d1b2a, O: 0xe03030, H: 0xf2f4f7, C: 0x8a94a0, bond: 0x9aa3ad, sel: 0x62d6c2, blocked: 0xf2a541, modified: 0xffffff };

  function webglAvailable() {
    try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
  }

  /* carbon positions of an armchair (6,6) tube of length L, axis along y, centred at the origin; the angle convention
     matches three.js CylinderGeometry (x = R sin θ, z = R cos θ) so the half-tube cut agrees with the smooth tubes */
  function cnt66(L) {
    const s3 = Math.sqrt(3), a = s3 * 0.142, n = 6;                     // graphene lattice constant from d(C–C) = 0.142 nm
    const a1 = [a, 0], a2 = [a / 2, a * s3 / 2];
    const Ch = [n * (a1[0] + a2[0]), n * (a1[1] + a2[1])], Cl = Math.hypot(Ch[0], Ch[1]);
    const Tv = [a1[0] - a2[0], a1[1] - a2[1]], Tl = Math.hypot(Tv[0], Tv[1]);
    const R = Cl / (2 * Math.PI), basis = [[0, 0], [(a1[0] + a2[0]) / 3, (a1[1] + a2[1]) / 3]];
    const atoms = [], seen = new Set();
    for (let i = -40; i <= 40; i++) for (let j = -40; j <= 40; j++) for (const b of basis) {
      const x = i * a1[0] + j * a2[0] + b[0], y = i * a1[1] + j * a2[1] + b[1];
      const u = (x * Ch[0] + y * Ch[1]) / (Cl * Cl), w = (x * Tv[0] + y * Tv[1]) / Tl;
      if (u < -1e-9 || u >= 1 - 1e-9 || w < -1e-9 || w >= L - 1e-9) continue;
      const key = Math.round(u * 1e6) + ',' + Math.round(w * 1e6);
      if (seen.has(key)) continue; seen.add(key);
      const th = 2 * Math.PI * u; atoms.push([R * Math.sin(th), w - L / 2 + 0.071, R * Math.cos(th)]);
    }
    const bonds = [];
    for (let p = 0; p < atoms.length; p++) for (let q = p + 1; q < atoms.length; q++) {
      const dx = atoms[p][0] - atoms[q][0], dy = atoms[p][1] - atoms[q][1], dz = atoms[p][2] - atoms[q][2];
      if (dx * dx + dy * dy + dz * dz < 0.155 * 0.155) bonds.push([p, q]);
    }
    return { atoms, bonds, R };
  }

  const copy = (o) => JSON.parse(JSON.stringify(o));

  function Pores3D(THREE, host, hooks) {
    const T = this.T = THREE;
    this.host = host; this.hooks = hooks || {};
    this.data = null; this.key = ''; this.speeds = []; this.phase = []; this.playing = !this.hooks.reduceMotion;
    this.visible = false; this.raf = 0; this.last = 0; this.frames = 0; this.needs = true; this.anim = null;
    const canvas = this.canvas = document.createElement('canvas');
    canvas.className = 'cl-p3-canvas'; canvas.tabIndex = 0; canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Three-dimensional cutaway of the membrane around the selected tube: carbon nanotubes in the membrane, with water molecules moving through them at the computed single-pore flow.');
    host.appendChild(canvas);
    this.labels = document.createElement('div'); this.labels.className = 'cl-p3-labels'; this.labels.setAttribute('aria-hidden', 'true');
    host.appendChild(this.labels);
    this.hud = document.createElement('div'); this.hud.className = 'cl-p3-hud'; this.hud.setAttribute('aria-hidden', 'true');
    this.hud.innerHTML = '<span class="cl-p3-side is-feed">Feed side <span aria-hidden="true">↓</span></span><span class="cl-p3-side is-perm">Permeate side</span>';
    host.appendChild(this.hud);
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    const scene = this.scene = new T.Scene();
    scene.background = new T.Color(COLOURS.bg);
    scene.fog = new T.Fog(COLOURS.bg, 45, 140);
    this.camera = new T.PerspectiveCamera(46, 1, 0.05, 500);
    scene.add(new T.HemisphereLight(0xdfe8f0, 0x1b2a3a, 1.25));
    const key = new T.DirectionalLight(0xffffff, 2.4); key.position.set(-18, 34, 26); scene.add(key);
    const rim = new T.DirectionalLight(0x9fd9ff, 0.7); rim.position.set(26, 8, -30); scene.add(rim);
    const M = (o) => new T.MeshStandardMaterial(o);
    this.mat = {
      tube: M({ color: 0x2a3540, metalness: 0.25, roughness: 0.55, side: T.DoubleSide }),           // dark wall: the channels read as openings
      tubeBlocked: M({ color: 0x4d3d29, metalness: 0.2, roughness: 0.6, side: T.DoubleSide }),
      backdrop: M({ color: 0x18212b, metalness: 0.1, roughness: 0.8, side: T.DoubleSide }),          // behind the atomistic tube's lattice
      slabTop: M({ color: 0x4e6175, side: T.DoubleSide, roughness: 0.8, metalness: 0.05 }),
      slabCut: M({ color: 0x66798d, side: T.DoubleSide, roughness: 0.9 }),
      none: new T.MeshBasicMaterial({ visible: false }),
      slabSide: M({ color: 0x435567, side: T.DoubleSide, roughness: 0.85 }),
      O: M({ color: COLOURS.O, roughness: 0.35 }), H: M({ color: COLOURS.H, roughness: 0.35 }),
      C: M({ color: COLOURS.C, roughness: 0.4, metalness: 0.25 }), bond: M({ color: COLOURS.bond, roughness: 0.5, metalness: 0.2 }),
      sel: new T.MeshBasicMaterial({ color: COLOURS.sel }), blocked: new T.MeshBasicMaterial({ color: COLOURS.blocked }),
      cap: new T.MeshBasicMaterial({ color: COLOURS.blocked, transparent: true, opacity: 0.55, side: T.DoubleSide, depthWrite: false }),
      modified: new T.MeshBasicMaterial({ color: COLOURS.modified }),
      edge: new T.LineBasicMaterial({ color: 0xdbe4ee, transparent: true, opacity: 0.5 }),
      bar: new T.LineBasicMaterial({ color: 0xe9eef3 }),
    };
    this.geo = { sphere: new T.SphereGeometry(1, 18, 12), bond: new T.CylinderGeometry(1, 1, 1, 6, 1, true) };
    this.group = new T.Group(); scene.add(this.group);
    this.tmp = { m: new T.Matrix4(), q: new T.Quaternion(), v: new T.Vector3(), s: new T.Vector3(), up: new T.Vector3(0, 1, 0) };
    // Array context: along the cut row, the selected tube in front and its row receding (a narrower view starts further
    // back). Focus pore: the selected tube close up, the cut face seen obliquely (targets set when data arrive).
    this.homes = {
      array: { wide: { az: -0.95, el: 0.26, dist: 18.5, target: [9.2, -1.0, -3] }, narrow: { az: -0.95, el: 0.30, dist: 23, target: [7.5, -1.2, -2.5] } },
      focus: { wide: { az: -0.75, el: 0.40, dist: 6.2, target: [0.45, -0.15, -0.35] }, narrow: { az: -0.75, el: 0.42, dist: 7.4, target: [0.3, -0.15, -0.35] } },
    };
    this.preset = this.hooks.preset === 'array' ? 'array' : 'focus';
    this.interacted = false;
    this.orbitHome = this.homes[this.preset].wide;
    this.orbit = copy(this.orbitHome);
    this.bindControls();
    const self = this;
    if (root.ResizeObserver) { this.ro = new ResizeObserver(() => self.resize()); this.ro.observe(host); }
    this.onVis = () => { if (document.hidden) self.stop(); else if (self.visible) self.start(); };
    document.addEventListener('visibilitychange', this.onVis);
    this.resize();
  }

  /* ---------------------------------------------------------------- data and scene */
  Pores3D.prototype.setData = function (d) {
    this.data = d;
    const key = JSON.stringify([d.pitch_nm, d.L_nm, d.tubes.map((t) => [t.ti, t.tj, t.x, t.z, t.blocked ? 1 : 0, t.modified ? 1 : 0, t.selected ? 1 : 0])]);
    if (key !== this.key) { this.build(d); this.key = key; }
    this.speeds = d.tubes.map((t) => (t.blocked ? 0 : t.speed));
    if (this.phase.length !== d.tubes.length) this.phase = d.tubes.map((t, i) => (i * 0.137) % ELL);
    this.placeMolecules();
    this.needs = true; this.kick();
  };
  Pores3D.prototype.clearGroup = function () {
    const g = this.group;
    while (g.children.length) {
      const o = g.children.pop();
      o.traverse((c) => { if (c.geometry && c.geometry !== this.geo.sphere && c.geometry !== this.geo.bond) c.geometry.dispose(); });
    }
  };
  /* one face of the membrane (y = const) with a real opening for every tube: full circles for the tubes inside the
     block and half circles cut into the front edge for the tubes of the cut row. Shape coordinates (x, −z). */
  Pores3D.prototype.faceWithOpenings = function (box, tubes, R) {
    const T = this.T, sh = new T.Shape(), { x0, x1, zb, zf } = box, eps = 1e-6;
    const frontX = tubes.filter((t) => Math.abs(t.z - zf) < eps).map((t) => t.x).sort((a, b) => a - b);
    sh.moveTo(x0, -zf);
    for (const xc of frontX) { sh.lineTo(xc - R, -zf); sh.absarc(xc, -zf, R, Math.PI, 0, true); }
    sh.lineTo(x1, -zf); sh.lineTo(x1, -zb); sh.lineTo(x0, -zb); sh.lineTo(x0, -zf);
    let holes = 0;
    for (const t of tubes) {
      if (Math.abs(t.z - zf) < eps) continue;
      const h = new T.Path(); h.absarc(t.x, -t.z, R, 0, 2 * Math.PI, true); sh.holes.push(h); holes++;
    }
    return { geo: new T.ShapeGeometry(sh, 20), holes, notches: frontX.length };
  };
  Pores3D.prototype.build = function (d) {
    const T = this.T, g = this.group, p = d.pitch_nm, L = d.L_nm, R = d.R_nm, mat = this.mat;
    this.clearGroup();
    const xs = d.tubes.map((t) => t.x), zs = d.tubes.map((t) => t.z);
    const x0 = Math.min.apply(null, xs) - p / 2, x1 = Math.max.apply(null, xs) + p / 2, zb = Math.min.apply(null, zs) - p / 2, zf = Math.max.apply(null, zs);
    const W = x1 - x0, D = zf - zb;
    this.box = { x0, x1, zb, zf, L };
    {                                                                      // the membrane, cut through the front row: sides and back from a box,
      const geo = new T.BoxGeometry(W, L, D), mesh = new T.Mesh(geo, [mat.slabSide, mat.slabSide, mat.none, mat.none, mat.none, mat.slabSide]);
      mesh.position.set((x0 + x1) / 2, 0, (zb + zf) / 2); g.add(mesh);     // top and bottom as faces with openings, the cut face in pieces
      // outline: the box edges, with the two cut edges interrupted at the half-openings of the cut row
      const ytop = L / 2, ybot = -L / 2, segs = [];
      const seg = (a1, b1) => { segs.push(new T.Vector3(a1[0], a1[1], a1[2]), new T.Vector3(b1[0], b1[1], b1[2])); };
      for (const y of [ytop, ybot]) { seg([x0, y, zb], [x1, y, zb]); seg([x0, y, zb], [x0, y, zf]); seg([x1, y, zb], [x1, y, zf]); }
      for (const xz of [[x0, zb], [x1, zb], [x0, zf], [x1, zf]]) seg([xz[0], ybot, xz[1]], [xz[0], ytop, xz[1]]);
      const cutX = d.tubes.filter((t) => Math.abs(t.z - zf) < 1e-6).map((t) => t.x).sort((a1, b1) => a1 - b1);
      for (const y of [ytop, ybot]) { let xa0 = x0; for (const xc of cutX) { seg([xa0, y, zf], [xc - R, y, zf]); xa0 = xc + R; } seg([xa0, y, zf], [x1, y, zf]); }
      g.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(segs), mat.edge));
      const face = this.faceWithOpenings(this.box, d.tubes, R);
      for (const y of [L / 2, -L / 2]) { const f = new T.Mesh(face.geo, mat.slabTop); f.rotation.x = -Math.PI / 2; f.position.y = y; g.add(f); }
      this.openings = { holes: face.holes, notches: face.notches, faces: 2 };
      const xsF = d.tubes.filter((t) => Math.abs(t.z - zf) < 1e-6).map((t) => t.x).sort((a, b) => a - b);
      let xa = x0;
      for (const xc of xsF.concat([Infinity])) {
        const xbF = Number.isFinite(xc) ? xc - R : x1;
        if (xbF - xa > 1e-6) { const piece = new T.Mesh(new T.PlaneGeometry(xbF - xa, L), mat.slabCut); piece.position.set((xa + xbF) / 2, 0, zf); g.add(piece); }
        xa = xc + R;
      }
    }

    this.pickables = [];
    const full = new T.CylinderGeometry(R, R, L, 48, 1, true), half = new T.CylinderGeometry(R, R, L, 32, 1, true, Math.PI / 2, Math.PI);
    const ring = (r, w) => new T.TorusGeometry(r, w, 10, 48);
    const front = (t) => Math.abs(t.z - zf) < 1e-6;
    let atomic = null;
    this.markers = { blocked: 0, modified: 0, selected: 0 };
    for (const t of d.tubes) {
      if (t.selected) atomic = t;
      if (!t.selected) {
        const mesh = new T.Mesh(front(t) ? half : full, t.blocked ? mat.tubeBlocked : mat.tube);
        mesh.position.set(t.x, 0, t.z); mesh.userData = { ti: t.ti, tj: t.tj }; g.add(mesh); this.pickables.push(mesh);
      } else {                                                             // invisible pick target and a dark backdrop for the atomistic tube
        const mesh = new T.Mesh(full, new T.MeshBasicMaterial({ visible: false })); mesh.position.set(t.x, 0, t.z); mesh.userData = { ti: t.ti, tj: t.tj };
        g.add(mesh); this.pickables.push(mesh);
        const back = new T.Mesh(front(t) ? new T.CylinderGeometry(R + 0.1, R + 0.1, L, 40, 1, true, Math.PI / 2, Math.PI) : new T.CylinderGeometry(R + 0.1, R + 0.1, L, 48, 1, true),
          t.blocked ? mat.tubeBlocked : mat.backdrop);
        back.position.set(t.x, 0, t.z); g.add(back);
      }
      const marker = (m, y, r, w) => { const o = new T.Mesh(ring(r, w), m); o.rotation.x = Math.PI / 2; o.position.set(t.x, y, t.z); g.add(o); return o; };
      if (t.blocked) {
        this.markers.blocked++;
        marker(mat.blocked, L / 2 + 0.02, R + 0.08, 0.045); marker(mat.blocked, -L / 2 - 0.02, R + 0.08, 0.045);
        const cap = new T.Mesh(new T.CircleGeometry(R, 40), mat.cap); cap.rotation.x = -Math.PI / 2; cap.position.set(t.x, L / 2 + 0.01, t.z); g.add(cap);
      } else if (t.modified) { this.markers.modified++; marker(mat.modified, L / 2 + 0.02, R + 0.08, 0.035); }
      if (t.selected) { this.markers.selected++; marker(mat.sel, L / 2 + 0.06, R + 0.22, 0.05); }
    }
    if (atomic) {                                                          // the selected tube with its carbon lattice
      const cnt = this.cnt || (this.cnt = cnt66(L));
      const keep = cnt.atoms.map((a) => !front(atomic) || a[2] <= 0.06);
      const idx = []; keep.forEach((k, i) => { if (k) idx.push(i); });
      const atoms = new T.InstancedMesh(this.geo.sphere, mat.C, idx.length), tm = this.tmp;
      idx.forEach((i, k) => { const a = cnt.atoms[i]; tm.m.compose(tm.v.set(atomic.x + a[0], a[1], atomic.z + a[2]), tm.q.identity(), tm.s.set(0.062, 0.062, 0.062)); atoms.setMatrixAt(k, tm.m); });
      g.add(atoms);
      const bl = cnt.bonds.filter((b) => keep[b[0]] && keep[b[1]]), bonds = new T.InstancedMesh(this.geo.bond, mat.bond, bl.length);
      bl.forEach((b, k) => {
        const A = cnt.atoms[b[0]], B = cnt.atoms[b[1]], dir = new T.Vector3(B[0] - A[0], B[1] - A[1], B[2] - A[2]), len = dir.length();
        tm.q.setFromUnitVectors(tm.up, dir.normalize());
        tm.m.compose(tm.v.set(atomic.x + (A[0] + B[0]) / 2, (A[1] + B[1]) / 2, atomic.z + (A[2] + B[2]) / 2), tm.q, tm.s.set(0.024, len, 0.024)); bonds.setMatrixAt(k, tm.m);
      });
      g.add(bonds);
      this.atomCount = idx.length;
    } else this.atomCount = 0;
    // water: one chain per tube (molecules beyond the drawn span are scaled to zero)
    this.nPer = Math.ceil((L + 2 * END) / ELL) + 1;
    const n = d.tubes.length * this.nPer;
    this.Omesh = new T.InstancedMesh(this.geo.sphere, mat.O, n); this.Hmesh = new T.InstancedMesh(this.geo.sphere, mat.H, 2 * n);
    this.Omesh.instanceMatrix.setUsage(T.DynamicDrawUsage); this.Hmesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    g.add(this.Omesh); g.add(this.Hmesh);
    // scale bars on the membrane top along the cut edge: 5 nm between the first two tubes of the row, 1 nm beside the selected tube
    // scale bars: 5 nm on the membrane top along the cut edge between the first two tubes of the row; 1 nm on the cut
    // face beside the selected tube, for close-ups
    const sx = atomic ? atomic.x : d.tubes[0].x, by = L / 2 + 0.03, y1 = 0.55, zc = zf + 0.004;
    const mkBar = (xa, y, z, len, t0, t1) => {
      const o = new T.Group();
      o.add(new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(xa, y, z), new T.Vector3(xa + len, y, z)]), mat.bar));
      o.add(new T.LineSegments(new T.BufferGeometry().setFromPoints([new T.Vector3(xa, y + t0, z), new T.Vector3(xa, y + t1, z), new T.Vector3(xa + len, y + t0, z), new T.Vector3(xa + len, y + t1, z)]), mat.bar));
      g.add(o); return o;
    };
    const b5x = d.tubes[0].x + 2.5, b1x = sx + 0.8;
    this.bars = { far: mkBar(b5x, by, zf, 5, 0, 0.45), near: mkBar(b1x, y1, zc, 1, -0.07, 0.07) };
    this.anchorSets = {
      far: { mem: [d.tubes[0].x + 5, -L / 2, zf], sel: atomic ? [atomic.x, L / 2 + 0.75, atomic.z] : null, bar: [b5x + 2.5, by + 0.5, zf] },
      near: { mem: [sx + 1.15, -L / 2, zf], sel: atomic ? [atomic.x, L / 2 + 0.62, atomic.z] : null, bar: [b1x + 0.5, y1 + 0.12, zc] },
    };
    if (atomic) {                                                          // the focus preset frames the selected tube (always in the cut row)
      this.homes.focus.wide.target = [atomic.x + 0.45, -0.15, atomic.z - 0.35];
      this.homes.focus.narrow.target = [atomic.x + 0.3, -0.15, atomic.z - 0.35];
      this.focusAt = [atomic.x, 0, atomic.z];
    }
    this.tubeCount = d.tubes.length;
    this.buildLabels(d);
    this.orbitHome = this.homeFor(this.preset);
    if (!this.interacted && !this.anim) this.orbit = copy(this.orbitHome);
  };

  /* molecule positions from the per-tube phase (nm travelled along the axis, downward = with the flow) */
  Pores3D.prototype.placeMolecules = function () {
    const d = this.data; if (!d || !this.Omesh) return;
    const tm = this.tmp, L = d.L_nm, top = L / 2 + END, bot = -L / 2 - END, span = this.nPer * ELL;
    const c = Math.cos(ANG_HOH), s = Math.sin(ANG_HOH);
    let o = 0, h = 0;
    d.tubes.forEach((t, i) => {
      const ph = this.phase[i] || 0;
      for (let k = 0; k < this.nPer; k++) {
        let y = top - (((k * ELL + ph) % span) + span) % span;
        const seq = Math.floor((k * ELL + ph) / span) * this.nPer + k;      // stable identity for the zigzag
        let sc = 1;
        if (y > L / 2) sc = Math.max(0, Math.min(1, (top - y) / END));
        else if (y < -L / 2) sc = Math.max(0, Math.min(1, (y - bot) / END));
        if (y < bot || y > top) sc = 0;
        sc = sc * sc * (3 - 2 * sc);
        const zig = ((seq % 2) ? 1 : -1) * 0.05;
        const x = t.x + zig, z = t.z;
        // O; H1 along the axis towards the next molecule (the donated hydrogen bond); H2 at the H–O–H angle, towards the axis
        tm.m.compose(tm.v.set(x, y, z), tm.q.identity(), tm.s.set(R_O * sc, R_O * sc, R_O * sc)); this.Omesh.setMatrixAt(o++, tm.m);
        tm.m.compose(tm.v.set(x, y - D_OH, z), tm.q.identity(), tm.s.set(R_H * sc, R_H * sc, R_H * sc)); this.Hmesh.setMatrixAt(h++, tm.m);
        tm.m.compose(tm.v.set(x - zig / Math.abs(zig) * D_OH * s, y - D_OH * c, z), tm.q.identity(), tm.s.set(R_H * sc, R_H * sc, R_H * sc)); this.Hmesh.setMatrixAt(h++, tm.m);
      }
    });
    this.Omesh.instanceMatrix.needsUpdate = true; this.Hmesh.instanceMatrix.needsUpdate = true;
  };

  /* ---------------------------------------------------------------- labels (DOM, projected each frame) */
  Pores3D.prototype.buildLabels = function (d) {
    const L = this.labels; L.innerHTML = '';
    const mk = (cls, txt) => { const e = document.createElement('span'); e.className = 'cl-p3-label ' + cls; e.textContent = txt; L.appendChild(e); return e; };
    this.lab = { mem: mk('is-mem', d.text.membrane), sel: d.text.selected ? mk('is-sel', d.text.selected) : null, barFar: mk('is-bar', '5 nm'), barNear: mk('is-bar', '1 nm') };
  };
  Pores3D.prototype.near = function () { return this.orbit.dist < NEAR_NM; };
  Pores3D.prototype.placeLabels = function () {
    if (!this.lab || !this.anchorSets) return;
    const near = this.near(), A = near ? this.anchorSets.near : this.anchorSets.far;
    const anchors = { mem: A.mem, sel: A.sel, barFar: near ? null : A.bar, barNear: near ? A.bar : null };
    const w = this.cw, h = this.ch, v = this.tmp.v, cam = this.camera;
    for (const k of Object.keys(this.lab)) {
      const e = this.lab[k], a = anchors[k]; if (!e) continue;
      if (!a) { e.style.display = 'none'; continue; }
      v.set(a[0], a[1], a[2]).project(cam);
      const vis = v.z < 1 && v.x > -1.05 && v.x < 1.05 && v.y > -1.05 && v.y < 1.05;
      e.style.display = vis ? '' : 'none';
      if (!vis) continue;
      // keep the label inside the viewport (its CSS margin shifts it relative to the anchor)
      const ml = parseFloat(getComputedStyle(e).marginLeft) || 0, ew = e.offsetWidth;
      let x = (v.x + 1) / 2 * w, y = (1 - v.y) / 2 * h;
      x = Math.max(4 - ml, Math.min(w - 4 - ew - ml, x));
      e.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
    }
  };

  /* ---------------------------------------------------------------- camera, presets, controls, loop */
  Pores3D.prototype.applyCamera = function () {
    const o = this.orbit, c = this.camera, t = o.target;
    c.position.set(t[0] + o.dist * Math.cos(o.el) * Math.sin(o.az), t[1] + o.dist * Math.sin(o.el), t[2] + o.dist * Math.cos(o.el) * Math.cos(o.az));
    c.lookAt(t[0], t[1], t[2]);
  };
  Pores3D.prototype.homeFor = function (name) { return this.homes[name][this.cw / this.ch < 1.1 ? 'narrow' : 'wide']; };
  Pores3D.prototype.goTo = function (home, animate) {
    if (!animate || this.hooks.reduceMotion || !this.visible) { this.anim = null; this.orbit = copy(home); }
    else this.anim = { from: copy(this.orbit), to: copy(home), t: 0, dur: 0.7 };
    this.needs = true; this.kick();
  };
  /* "focus" (selected tube close up) or "array" (the cut row and the window) */
  Pores3D.prototype.setPreset = function (name, animate) {
    this.preset = name === 'array' ? 'array' : 'focus';
    this.orbitHome = this.homeFor(this.preset); this.interacted = false;
    this.goTo(this.orbitHome, animate !== false);
  };
  Pores3D.prototype.resetView = function () { this.interacted = false; this.goTo(this.orbitHome, true); };
  Pores3D.prototype.stepAnim = function (dt) {
    const a = this.anim; if (!a) return;
    a.t = Math.min(1, a.t + dt / a.dur);
    const s = a.t * a.t * (3 - 2 * a.t), lerp = (p, q) => p + (q - p) * s;
    let daz = a.to.az - a.from.az; daz = Math.atan2(Math.sin(daz), Math.cos(daz));
    this.orbit = { az: a.from.az + daz * s, el: lerp(a.from.el, a.to.el), dist: a.from.dist * Math.pow(a.to.dist / a.from.dist, s),
      target: [0, 1, 2].map((i) => lerp(a.from.target[i], a.to.target[i])) };
    if (a.t >= 1) { this.orbit = copy(a.to); this.anim = null; }
    this.needs = true;
  };
  Pores3D.prototype.bindControls = function () {
    const c = this.canvas, self = this, pts = new Map();
    let drag = null, moved = 0, pinch = 0;
    const touched = () => { self.anim = null; self.interacted = true; self.needs = true; self.kick(); };
    c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); drag = [e.clientX, e.clientY]; moved = 0; if (pts.size === 2) { const v = [...pts.values()]; pinch = Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]); } });
    c.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) { const v = [...pts.values()], dd = Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]); if (pinch > 0) self.zoom(pinch / dd); pinch = dd; moved += 10; return; }
      if (!drag) return; const dx = e.clientX - drag[0], dy = e.clientY - drag[1]; drag = [e.clientX, e.clientY]; moved += Math.abs(dx) + Math.abs(dy);
      if (Math.abs(dx) + Math.abs(dy) > 0) { self.anim = null; self.orbit.az -= dx * 0.006; self.orbit.el = Math.max(-0.35, Math.min(1.45, self.orbit.el + dy * 0.005)); touched(); }
    });
    const up = (e) => {
      const wasTap = pts.size === 1 && moved < 6; pts.delete(e.pointerId); if (pts.size < 2) pinch = 0;
      if (wasTap && e.type === 'pointerup') self.pick(e); if (!pts.size) drag = null;
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => { e.preventDefault(); self.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    c.addEventListener('dblclick', () => self.resetView());
    c.addEventListener('keydown', (e) => {
      const k = e.key; let used = true;
      if (k === 'Home' || k === '0') { e.preventDefault(); self.resetView(); return; }
      self.anim = null;
      if (k === 'ArrowLeft') self.orbit.az += 0.08; else if (k === 'ArrowRight') self.orbit.az -= 0.08;
      else if (k === 'ArrowUp') self.orbit.el = Math.min(1.45, self.orbit.el + 0.06); else if (k === 'ArrowDown') self.orbit.el = Math.max(-0.35, self.orbit.el - 0.06);
      else if (k === '+' || k === '=') self.zoom(0.88); else if (k === '-' || k === '_') self.zoom(1.14); else used = false;
      if (used) { e.preventDefault(); touched(); }
    });
  };
  Pores3D.prototype.zoom = function (f) { this.anim = null; this.orbit.dist = Math.max(2.5, Math.min(140, this.orbit.dist * f)); this.interacted = true; this.needs = true; this.kick(); };
  Pores3D.prototype.pick = function (e) {
    if (!this.pickables || !this.hooks.onPick) return;
    const T = this.T, r = this.canvas.getBoundingClientRect();
    const v = new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const rc = new T.Raycaster(); rc.setFromCamera(v, this.camera);
    const hit = rc.intersectObjects(this.pickables, false)[0];
    if (hit) this.hooks.onPick(hit.object.userData);
  };
  Pores3D.prototype.resize = function () {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    if (w === this.cw && h === this.ch) return;
    this.cw = w; this.ch = h; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.orbitHome = this.homeFor(this.preset);
    if (!this.interacted) { this.anim = null; this.orbit = copy(this.orbitHome); }
    this.needs = true; this.kick();
  };
  Pores3D.prototype.setVisible = function (v) { this.visible = v; if (v) { this.resize(); this.start(); } else this.stop(); };
  Pores3D.prototype.setPlaying = function (p) { this.playing = p; this.last = 0; this.kick(); };
  Pores3D.prototype.start = function () { if (!this.raf && this.visible && !document.hidden) { this.last = 0; this.raf = requestAnimationFrame((t) => this.frame(t)); } };
  Pores3D.prototype.stop = function () { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; };
  Pores3D.prototype.kick = function () { if (this.visible) this.start(); };
  Pores3D.prototype.frame = function (now) {
    this.raf = 0;
    if (!this.visible || document.hidden) return;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0; this.last = now;
    const moving = this.playing && this.speeds.some((s) => s > 0);
    if (moving && dt > 0) { for (let i = 0; i < this.speeds.length; i++) this.phase[i] = (this.phase[i] + this.speeds[i] * dt) % (1e6 * ELL); this.placeMolecules(); this.needs = true; }
    if (this.anim) this.stepAnim(dt > 0 ? dt : 1 / 60);
    if (this.needs) {
      if (this.bars) { const near = this.near(); this.bars.far.visible = !near; this.bars.near.visible = near; }   // the bar that matches the zoom
      this.applyCamera(); this.renderer.render(this.scene, this.camera); this.placeLabels(); this.frames++; this.needs = false;
    }
    if (moving || this.anim) this.raf = requestAnimationFrame((t) => this.frame(t));
  };
  /* read-only description for the automated checks */
  Pores3D.prototype.stats = function () {
    const o = this.orbit, f = this.focusAt;
    const cam = [o.target[0] + o.dist * Math.cos(o.el) * Math.sin(o.az), o.target[1] + o.dist * Math.sin(o.el), o.target[2] + o.dist * Math.cos(o.el) * Math.cos(o.az)];
    return { tubes: this.data ? this.data.tubes.length : 0, renderedTubes: this.tubeCount || 0, carbonAtoms: this.atomCount || 0, molecules: this.Omesh ? this.Omesh.count : 0,
      speeds: this.speeds.slice(), phase: this.phase.slice(), playing: this.playing, frames: this.frames, markers: Object.assign({}, this.markers),
      positions: this.data ? this.data.tubes.map((t) => [t.ti, t.tj, t.x, t.z]) : [], geometry: this.data ? { pitch_nm: this.data.pitch_nm, L_nm: this.data.L_nm, R_nm: this.data.R_nm } : null,
      preset: this.preset, animating: !!this.anim, interacted: this.interacted, orbit: copy(o), camera: cam,
      cameraToSelected_nm: f ? Math.hypot(cam[0] - f[0], cam[1] - f[1], cam[2] - f[2]) : null, targetToSelected_nm: f ? Math.hypot(o.target[0] - f[0], o.target[1] - f[1], o.target[2] - f[2]) : null,
      scaleBar: this.near() ? '1 nm' : '5 nm', openings: this.openings ? Object.assign({}, this.openings) : null, water: { dOH_nm: D_OH, angleHOH_deg: ANG_DEG, spacing_nm: ELL } };
  };
  Pores3D.prototype.dispose = function () {
    this.stop(); document.removeEventListener('visibilitychange', this.onVis); if (this.ro) this.ro.disconnect();
    this.clearGroup(); this.renderer.dispose(); this.canvas.remove(); this.labels.remove();
  };

  async function create(host, hooks) {
    if (!webglAvailable()) { const err = new Error('WebGL is not available in this browser'); err.code = 'NO_WEBGL'; throw err; }
    const THREE = await import('./vendor/three.module.min.js');
    return new Pores3D(THREE, host, hooks);
  }
  root.ContinuumPores3D = { create, webglAvailable, ELL_nm: ELL };
})(typeof window !== 'undefined' ? window : globalThis);
