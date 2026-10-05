/* inspector.js - CNT trajectory inspector (Simulation Lab, stage 1).
   Plain JavaScript with no libraries. The only network requests are this site's own data files
   (data/manifest.json and one data/<tube>.bin per tube, loaded when the tube is opened). */
(function () {
  "use strict";

  var root = document.getElementById("inspector");
  if (!root) return;
  var DATA = root.getAttribute("data-src") || "data/";
  var canvas = root.querySelector(".insp-canvas");
  var ctx = canvas.getContext("2d");
  var el = function (sel) { return root.querySelector(sel); };
  var ui = {
    tubes: el(".insp-tubes"), play: el(".insp-play"), slider: el(".insp-slider"), time: el(".insp-time"),
    speed: el(".insp-speed"), cut: el("#insp-cut"), hb: el("#insp-hb"), dip: el("#insp-dip"), pbc: el("#insp-pbc"),
    side: el(".insp-view-side"), axial: el(".insp-view-axial"), reset: el(".insp-view-reset"),
    status: el(".insp-status"), info: el(".insp-info-body"), clear: el(".insp-clear"), facts: el(".insp-facts"),
    legend: el(".insp-dipole-legend")
  };

  /* ---- species, colours and display radii (same as the published stills) ---- */
  var CODE = { C: 0, O: 1, H: 2, N: 3, L: 4 };
  var NAME = ["Carbon", "Water oxygen", "Water hydrogen", "Na\u207a", "Cl\u207b"];
  var COLOR = ["#8c8c8c", "#e03030", "#f2f4f7", "#a05cc8", "#2ecc40"];
  var RAD = [0.30, 0.55, 0.30, 0.85, 1.00];        // angstrom (carbon drawn smaller so the water stands out)
  var HYD_CUT = { 3: 3.2, 4: 3.8 };                  // first-shell radii, angstrom (Na+, Cl-)
  var HB_OO = 3.5, HB_ANG = 30;                      // hydrogen-bond criterion
  var BG = "#0b1828";
  var FOG = 6;                                       // depth-shading levels
  var DIPBINS = 21;

  var EXPORT = window.__INSPECTOR_EXPORT__ || null;   // set only by the tool that renders the main-page preview image
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

  /* ---- state ---- */
  var man = null, tube = null, data = null, store = {};
  var frame = 0, playing = false, speed = 1, acc = 0, lastT = 0;
  var R = [0, 0, 1, 1, 0, 0, 0, 1, 0];               // view = R * world (row-major 3x3)
  var zoom = 20, dpr = 1, W = 0, H = 0;
  var opts = { cut: true, hb: false, dip: false, pbc: false };
  var sel = -1, der = null, derFrame = -1, dirty = true;
  var drawn = { n: 0, idx: null, sx: null, sy: null, sr: null };

  /* ---- colour helpers and sphere sprites ---- */
  function hex2rgb(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function css(c, a) { return "rgba(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + "," + (a == null ? 1 : a) + ")"; }
  var BGRGB = hex2rgb(BG), WHITE = [255, 255, 255], BLACK = [0, 0, 0];
  var DIP_NEG = hex2rgb("#3d8fe0"), DIP_MID = hex2rgb("#c9d2dc"), DIP_POS = hex2rgb("#f0913f");
  function dipColor(c) {                               // c = cos(theta) in [-1, 1]
    return c < 0 ? mix(DIP_MID, DIP_NEG, -c) : mix(DIP_MID, DIP_POS, c);
  }
  var sprites = {};
  var SPR = 96;
  function sprite(rgb, level) {
    var key = Math.round(rgb[0]) + "," + Math.round(rgb[1]) + "," + Math.round(rgb[2]) + "|" + level;
    if (sprites[key]) return sprites[key];
    var c = document.createElement("canvas"); c.width = c.height = SPR;
    var g = c.getContext("2d"), r = SPR / 2 - 2;
    var base = mix(rgb, BGRGB, level / FOG * 0.5);
    var grad = g.createRadialGradient(SPR / 2 - r * 0.35, SPR / 2 - r * 0.35, r * 0.08, SPR / 2, SPR / 2, r);
    grad.addColorStop(0, css(mix(base, WHITE, 0.55)));
    grad.addColorStop(0.45, css(base));
    grad.addColorStop(1, css(mix(base, BLACK, 0.5)));
    g.fillStyle = grad; g.beginPath(); g.arc(SPR / 2, SPR / 2, r, 0, Math.PI * 2); g.fill();
    g.lineWidth = 2; g.strokeStyle = "rgba(0,0,0,0.45)"; g.stroke();
    sprites[key] = c;
    return c;
  }
  var SPC_RGB = COLOR.map(hex2rgb);

  /* ---- matrices ---- */
  function mul(A, B) {
    var C = new Array(9);
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++)
      C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j];
    return C;
  }
  function rotX(a) { var c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
  function rotY(a) { var c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
  function orthonormalize(M) {
    var a = [M[0], M[1], M[2]], b = [M[3], M[4], M[5]];
    var na = Math.hypot(a[0], a[1], a[2]); a = a.map(function (v) { return v / na; });
    var d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; b = [b[0] - d * a[0], b[1] - d * a[1], b[2] - d * a[2]];
    var nb = Math.hypot(b[0], b[1], b[2]); b = b.map(function (v) { return v / nb; });
    var c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    return [a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]];
  }
  var SIDE = [0, 0, 1, 1, 0, 0, 0, 1, 0];              // screen x = tube axis, viewer on the +y side
  var AXIAL = [1, 0, 0, 0, 1, 0, 0, 0, 1];             // looking down the tube axis
  function homeView() { return orthonormalize(mul(rotX(0.30), mul(rotY(-0.42), SIDE))); }

  /* ---- data loading ---- */
  function setStatus(msg) { ui.status.textContent = msg || ""; ui.status.hidden = !msg; }
  function fail(msg) { setStatus(msg); playing = false; updatePlay(); }

  function decode(t, buf) {
    var F = t.n_frames, N = t.n_atoms, n3 = F * N * 3, i;
    var spc = new Uint8Array(N), Hidx = [], Oidx = [], Cidx = [], ions = [];
    for (i = 0; i < N; i++) {
      var s = CODE[t.species.charAt(i)]; spc[i] = s;
      if (s === 2) Hidx.push(i); else if (s === 1) Oidx.push(i); else if (s === 0) Cidx.push(i); else ions.push(i);
    }
    var nH = Hidx.length, pos = new Float32Array(n3), owner = new Int16Array(F * nH);
    var hPos = new Int32Array(N).fill(-1);
    for (i = 0; i < nH; i++) hPos[Hidx[i]] = i;
    if (littleEndian) {
      var q = new Int16Array(buf, 0, n3);
      for (i = 0; i < n3; i++) pos[i] = q[i] / 1000;
      owner.set(new Int16Array(buf, n3 * 2, F * nH));
    } else {
      var dv = new DataView(buf);
      for (i = 0; i < n3; i++) pos[i] = dv.getInt16(2 * i, true) / 1000;
      for (i = 0; i < F * nH; i++) owner[i] = dv.getInt16(2 * (n3 + i), true);
    }
    var L = t.cell_A, bonds = [];
    for (var a = 0; a < Cidx.length; a++) for (var b = a + 1; b < Cidx.length; b++) {
      var ia = 3 * Cidx[a], ib = 3 * Cidx[b];
      var dx = pos[ib] - pos[ia], dy = pos[ib + 1] - pos[ia + 1], dz = pos[ib + 2] - pos[ia + 2];
      dz -= L[2] * Math.round(dz / L[2]);
      if (dx * dx + dy * dy + dz * dz < 1.65 * 1.65 && Math.abs(pos[ib + 2] - pos[ia + 2]) < L[2] / 2) bonds.push(Cidx[a], Cidx[b]);
    }
    return { t: t, F: F, N: N, pos: pos, owner: owner, spc: spc, Hidx: Hidx, Oidx: Oidx, Cidx: Cidx, ions: ions,
             nH: nH, hPos: hPos, bonds: bonds, L: L, Rt: t.diameter_nm * 5 };
  }

  function loadTube(t) {
    if (store[t.id]) { activate(store[t.id]); return; }
    setStatus("Loading the " + t.label + " trajectory (" + (t.bytes / 1e6).toFixed(1) + " MB)\u2026");
    fetch(DATA + t.file).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      if (buf.byteLength !== t.bytes) throw new Error("size");
      store[t.id] = decode(t, buf);
      activate(store[t.id]);
    }).catch(function () {
      fail("The trajectory could not be loaded. Open this page from the website (not as a local file) and try again.");
    });
  }

  var pendingPreset = null;
  function applyPreset(p) {
    [["cut", ui.cut], ["hb", ui.hb], ["dip", ui.dip], ["pbc", ui.pbc]].forEach(function (pair) {
      if (p[pair[0]] === undefined) return;
      opts[pair[0]] = !!p[pair[0]]; pair[1].checked = opts[pair[0]];
    });
    ui.legend.hidden = !opts.dip;
    setView(p.view || "home");
    if (p.select) {
      var i = data.t.species.indexOf(p.select);
      if (i >= 0) { sel = i; showInfo(); }
    }
    if (!reduceMotion && !playing) { playing = true; updatePlay(); }
    dirty = true;
  }
  function runPreset(p) {
    var t = man && man.tubes.filter(function (x) { return x.id === p.tube; })[0];
    if (!t) return;
    canvas.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    if (data && data.t.id === t.id) { applyPreset(p); return; }
    pendingPreset = p;
    loadTube(t);
  }
  Array.prototype.forEach.call(document.querySelectorAll("[data-preset]"), function (b) {
    b.addEventListener("click", function () {
      try { runPreset(JSON.parse(b.getAttribute("data-preset"))); } catch (err) { /* malformed preset: ignore */ }
    });
  });

  function activate(d) {
    data = d; tube = d.t; sel = -1; der = null; derFrame = -1;
    frame = Math.min(frame, d.F - 1);
    ui.slider.max = String(d.F - 1); ui.slider.value = String(frame);
    setStatus("");
    Array.prototype.forEach.call(ui.tubes.querySelectorAll("button"), function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-id") === d.t.id ? "true" : "false");
    });
    if (history.replaceState) history.replaceState(null, "", "#" + d.t.id);
    renderFacts(); fit(); showInfo();
    if (!reduceMotion && !playing) { playing = true; updatePlay(); }
    dirty = true;
    if (pendingPreset && pendingPreset.tube === d.t.id) { var pp = pendingPreset; pendingPreset = null; applyPreset(pp); }
  }

  /* ---- per-frame chemistry: waters, dipoles, hydrogen bonds, hydration shells ---- */
  function mic(d, L) { return d - L * Math.round(d / L); }
  function derive() {
    if (derFrame === frame && der) return der;
    var d = data, P = d.pos, b = frame * d.N * 3, L = d.L, i, k;
    var hOf = {}, own = d.owner.subarray(frame * d.nH, (frame + 1) * d.nH);
    for (k = 0; k < d.nH; k++) { var o = own[k]; (hOf[o] = hOf[o] || []).push(d.Hidx[k]); }
    var cosv = new Float32Array(d.N); cosv.fill(NaN);
    d.Oidx.forEach(function (o) {
      var hs = hOf[o]; if (!hs || hs.length !== 2) return;
      var mx = (P[b + 3 * hs[0]] + P[b + 3 * hs[1]]) / 2 - P[b + 3 * o];
      var my = (P[b + 3 * hs[0] + 1] + P[b + 3 * hs[1] + 1]) / 2 - P[b + 3 * o + 1];
      var mz = (P[b + 3 * hs[0] + 2] + P[b + 3 * hs[1] + 2]) / 2 - P[b + 3 * o + 2];
      cosv[o] = mz / Math.hypot(mx, my, mz);
    });
    var hb = [], cosmax = Math.cos(HB_ANG * Math.PI / 180);
    d.Oidx.forEach(function (od) {
      var hs = hOf[od] || [];
      hs.forEach(function (h) {
        var hx = P[b + 3 * h] - P[b + 3 * od], hy = P[b + 3 * h + 1] - P[b + 3 * od + 1], hz = P[b + 3 * h + 2] - P[b + 3 * od + 2];
        var hn = Math.hypot(hx, hy, hz);
        d.Oidx.forEach(function (oa) {
          if (oa === od) return;
          var ax = mic(P[b + 3 * oa] - P[b + 3 * od], L[0]), ay = mic(P[b + 3 * oa + 1] - P[b + 3 * od + 1], L[1]),
              az = mic(P[b + 3 * oa + 2] - P[b + 3 * od + 2], L[2]);
          var r = Math.hypot(ax, ay, az);
          if (r > HB_OO || r < 1e-6) return;
          if ((hx * ax + hy * ay + hz * az) / (hn * r) >= cosmax) hb.push(h, od, oa);
        });
      });
    });
    var shell = {};
    d.ions.forEach(function (ion) {
      var cut = HYD_CUT[d.spc[ion]], list = [];
      d.Oidx.forEach(function (o) {
        var r = Math.hypot(mic(P[b + 3 * o] - P[b + 3 * ion], L[0]), mic(P[b + 3 * o + 1] - P[b + 3 * ion + 1], L[1]),
                           mic(P[b + 3 * o + 2] - P[b + 3 * ion + 2], L[2]));
        if (r < cut) list.push(o);
      });
      shell[ion] = list;
    });
    der = { hOf: hOf, cos: cosv, hb: hb, shell: shell, own: own };
    derFrame = frame;
    return der;
  }

  /* ---- drawing ---- */
  function resize() {
    var rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(200, Math.round(rect.width * dpr)), h = Math.max(150, Math.round(rect.height * dpr));
    if (w !== W || h !== H) { W = canvas.width = w; H = canvas.height = h; if (data) fit(true); dirty = true; }
  }
  var viewMode = "home";
  function fit(keepMode) {
    if (!data) return;
    var Lz = data.L[2], Rt = data.Rt + 1.5;
    if (EXPORT && EXPORT.fitRadius) { zoom = Math.min(W, H) * 0.86 / (2 * EXPORT.fitRadius); dirty = true; return; }
    if (viewMode === "axial") zoom = Math.min(W, H) * 0.86 / (2 * Rt);
    else zoom = Math.min(W * 0.88 / (Lz * (opts.pbc ? 2.2 : 1.05)), H * 0.86 / (2 * Rt + 4));
    dirty = true;
  }

  function project(x, y, z, out) {
    out[0] = R[0] * x + R[1] * y + R[2] * z;
    out[1] = R[3] * x + R[4] * y + R[5] * z;
    out[2] = R[6] * x + R[7] * y + R[8] * z;
  }

  function render() {
    if (!data) { ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H); return; }
    var d = data, P = d.pos, b = frame * d.N * 3, N = d.N, Lz = d.L[2];
    var dv = derive();
    var cx = W / 2, cy = H / 2, v = [0, 0, 0];
    var copies = opts.pbc ? [-1, 0, 1] : [0];
    var total = N * copies.length;
    if (!drawn.idx || drawn.idx.length < total) {
      drawn.idx = new Int32Array(total); drawn.sx = new Float32Array(total); drawn.sy = new Float32Array(total);
      drawn.sr = new Float32Array(total); drawn.sz = new Float32Array(total); drawn.order = new Int32Array(total);
      drawn.vis = new Uint8Array(total);
    }
    var n = 0, zmin = Infinity, zmax = -Infinity, ci, i;
    for (ci = 0; ci < copies.length; ci++) {
      var off = copies[ci] * Lz;
      for (i = 0; i < N; i++) {
        var x = P[b + 3 * i], y = P[b + 3 * i + 1], z = P[b + 3 * i + 2] + off;
        var slot = ci * N + i;
        drawn.vis[slot] = 0;
        if (d.spc[i] === 0 && opts.cut && (R[6] * x + R[7] * y) > 0.6) continue;   // cut away the front wall
        project(x, y, z, v);
        drawn.idx[n] = i; drawn.sx[n] = cx + v[0] * zoom; drawn.sy[n] = cy - v[1] * zoom; drawn.sz[n] = v[2];
        drawn.sr[n] = RAD[d.spc[i]] * zoom; drawn.vis[slot] = 1;
        if (v[2] < zmin) zmin = v[2]; if (v[2] > zmax) zmax = v[2];
        n++;
      }
    }
    drawn.n = n;

    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);

    // periodic cell boundaries
    if (opts.pbc) {
      ctx.save(); ctx.setLineDash([6 * dpr, 6 * dpr]); ctx.strokeStyle = "rgba(167,182,198,0.35)"; ctx.lineWidth = dpr;
      [-Lz / 2, Lz / 2].forEach(function (z0) {
        ctx.beginPath();
        for (var k = 0; k <= 48; k++) {
          var a = k / 48 * Math.PI * 2; project((d.Rt + 1.2) * Math.cos(a), (d.Rt + 1.2) * Math.sin(a), z0, v);
          var px = cx + v[0] * zoom, py = cy - v[1] * zoom;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
      });
      ctx.restore();
    }

    // carbon lattice bonds (drawn first; the visible wall is the back half)
    ctx.lineWidth = Math.max(1, 0.9 * dpr);
    ctx.strokeStyle = "rgba(160,172,186,0.42)";
    ctx.beginPath();
    for (ci = 0; ci < copies.length; ci++) {
      var o2 = copies[ci] * Lz;
      for (var k2 = 0; k2 < d.bonds.length; k2 += 2) {
        var a1 = d.bonds[k2], a2 = d.bonds[k2 + 1];
        if (!drawn.vis[ci * N + a1] || !drawn.vis[ci * N + a2]) continue;
        project(P[b + 3 * a1], P[b + 3 * a1 + 1], P[b + 3 * a1 + 2] + o2, v);
        var x1 = cx + v[0] * zoom, y1 = cy - v[1] * zoom;
        project(P[b + 3 * a2], P[b + 3 * a2 + 1], P[b + 3 * a2 + 2] + o2, v);
        ctx.moveTo(x1, y1); ctx.lineTo(cx + v[0] * zoom, cy - v[1] * zoom);
      }
    }
    ctx.stroke();

    // hydrogen bonds (central cell)
    if (opts.hb) {
      ctx.save(); ctx.setLineDash([3.5 * dpr, 3 * dpr]); ctx.lineWidth = 1.6 * dpr; ctx.strokeStyle = "rgba(98,214,194,0.9)";
      ctx.beginPath();
      for (var h = 0; h < dv.hb.length; h += 3) {
        var hi = dv.hb[h], oa = dv.hb[h + 2];
        var dz = mic(P[b + 3 * oa + 2] - P[b + 3 * hi + 2], Lz);
        if (!opts.pbc && Math.abs(P[b + 3 * hi + 2] + dz) > Lz / 2) continue;
        project(P[b + 3 * hi], P[b + 3 * hi + 1], P[b + 3 * hi + 2], v);
        var hx = cx + v[0] * zoom, hy = cy - v[1] * zoom;
        project(P[b + 3 * oa], P[b + 3 * oa + 1], P[b + 3 * hi + 2] + dz, v);
        ctx.moveTo(hx, hy); ctx.lineTo(cx + v[0] * zoom, cy - v[1] * zoom);
      }
      ctx.stroke(); ctx.restore();
    }

    // atoms, back to front
    var order = drawn.order;
    for (i = 0; i < n; i++) order[i] = i;
    var sub = Array.prototype.slice.call(order.subarray(0, n));
    sub.sort(function (p, q) { return drawn.sz[p] - drawn.sz[q]; });
    var span = Math.max(1e-6, zmax - zmin);
    for (var s = 0; s < n; s++) {
      var j = sub[s], ai = drawn.idx[j], sp = d.spc[ai];
      var lvl = Math.min(FOG - 1, Math.floor((1 - (drawn.sz[j] - zmin) / span) * FOG));
      var rgb = SPC_RGB[sp];
      if (opts.dip && (sp === 1 || sp === 2)) {
        var ow = sp === 1 ? ai : dv.own[d.hPos[ai]];
        var c = dv.cos[ow];
        rgb = isNaN(c) ? [120, 130, 140] : dipColor(Math.round((c + 1) / 2 * (DIPBINS - 1)) / (DIPBINS - 1) * 2 - 1);
        if (sp === 2) rgb = mix(rgb, WHITE, 0.45);
      }
      var r = drawn.sr[j];
      ctx.drawImage(sprite(rgb, lvl), drawn.sx[j] - r, drawn.sy[j] - r, 2 * r, 2 * r);
    }
    drawn.sorted = sub;

    // selection and partners
    if (sel >= 0) {
      var partners = selectionPartners(dv);
      ctx.save();
      ctx.lineWidth = 2 * dpr;
      for (var q = 0; q < n; q++) {
        var ai2 = drawn.idx[q];
        var isSel = ai2 === sel || (data.spc[sel] === 1 && dv.hOf[sel] && dv.hOf[sel].indexOf(ai2) >= 0);
        var isPartner = partners.indexOf(ai2) >= 0;
        if (!isSel && !isPartner) continue;
        ctx.setLineDash(isSel ? [] : [4 * dpr, 3 * dpr]);
        ctx.strokeStyle = isSel ? "#ffffff" : "#62d6c2";
        ctx.beginPath(); ctx.arc(drawn.sx[q], drawn.sy[q], drawn.sr[q] + 3 * dpr, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }

    if (!EXPORT) drawOverlay(v, cx, cy);
  }

  function drawOverlay(v, cx, cy) {
    // scale bar
    var nm = 10 * zoom, label = "1 nm";
    if (nm > W * 0.35) { nm /= 2; label = "0.5 nm"; } else if (nm < 40 * dpr) { nm *= 2; label = "2 nm"; }
    var x0 = 16 * dpr, y0 = H - 18 * dpr;
    ctx.fillStyle = "#e9eef3"; ctx.fillRect(x0, y0, nm, 3 * dpr);
    ctx.font = (12 * dpr) + "px 'IBM Plex Sans', system-ui, sans-serif"; ctx.textBaseline = "bottom";
    ctx.fillText(label, x0, y0 - 4 * dpr);
    // tube-axis arrow (+z), so the dipole colours can be read
    project(0, 0, 1, v);
    var len = Math.hypot(v[0], v[1]), ax = W - 54 * dpr, ay = H - 30 * dpr;
    if (len > 0.15) {
      var ux = v[0] / len, uy = -v[1] / len, L = 30 * dpr;
      ctx.strokeStyle = "#a7b6c6"; ctx.fillStyle = "#a7b6c6"; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.moveTo(ax - ux * L / 2, ay - uy * L / 2); ctx.lineTo(ax + ux * L / 2, ay + uy * L / 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ax + ux * L / 2, ay + uy * L / 2);
      ctx.lineTo(ax + ux * L / 2 - ux * 7 * dpr - uy * 4 * dpr, ay + uy * L / 2 - uy * 7 * dpr + ux * 4 * dpr);
      ctx.lineTo(ax + ux * L / 2 - ux * 7 * dpr + uy * 4 * dpr, ay + uy * L / 2 - uy * 7 * dpr - ux * 4 * dpr);
      ctx.closePath(); ctx.fill();
      ctx.textBaseline = "top"; ctx.fillText("+axis", ax - 18 * dpr, ay + 10 * dpr);
    } else {
      ctx.fillStyle = "#a7b6c6"; ctx.textBaseline = "top";
      ctx.fillText(v[2] > 0 ? "axis \u2299" : "axis \u2297", ax - 18 * dpr, ay - 6 * dpr);
    }
  }

  /* ---- selection ---- */
  function waterOf(i, dv) { return data.spc[i] === 2 ? dv.own[data.Hidx.indexOf(i)] : i; }
  function selectionPartners(dv) {
    if (sel < 0) return [];
    var s = data.spc[sel];
    if (s === 1) {
      var out = [];
      for (var k = 0; k < dv.hb.length; k += 3) {
        if (dv.hb[k + 1] === sel) out.push(dv.hb[k + 2]);
        if (dv.hb[k + 2] === sel) out.push(dv.hb[k + 1]);
      }
      return out;
    }
    if (s === 3 || s === 4) return dv.shell[sel] || [];
    return [];
  }
  function nm(a) { return (a / 10).toPrecision(3); }
  function wallDistance(i) {
    var P = data.pos, b = frame * data.N * 3, best = Infinity;
    data.Cidx.forEach(function (c) {
      var r = Math.hypot(P[b + 3 * c] - P[b + 3 * i], P[b + 3 * c + 1] - P[b + 3 * i + 1], mic(P[b + 3 * c + 2] - P[b + 3 * i + 2], data.L[2]));
      if (r < best) best = r;
    });
    return best;
  }
  function showInfo() {
    if (!data || sel < 0) {
      ui.info.innerHTML = "<p>Click any atom to inspect it.</p>";
      ui.clear.hidden = true;
      return;
    }
    var dv = derive(), P = data.pos, b = frame * data.N * 3, s = data.spc[sel], rows = [], title;
    var r = Math.hypot(P[b + 3 * sel], P[b + 3 * sel + 1]);
    if (s === 0) {
      title = "Carbon (tube wall)";
      rows.push(["Distance from the tube axis", nm(r) + " nm"]);
    } else if (s === 1) {
      title = "Water molecule";
      var c = dv.cos[sel], don = 0, accn = 0;
      for (var k = 0; k < dv.hb.length; k += 3) { if (dv.hb[k + 1] === sel) don++; if (dv.hb[k + 2] === sel) accn++; }
      rows.push(["Oxygen distance from the axis", nm(r) + " nm"]);
      rows.push(["Oxygen distance to the nearest wall carbon", nm(wallDistance(sel)) + " nm"]);
      rows.push(["Orientation to the tube axis (H\u2013O\u2013H bisector)", isNaN(c) ? "not a whole molecule in this frame" : Math.round(Math.acos(c) * 180 / Math.PI) + "\u00b0"]);
      rows.push(["Hydrogen bonds donated / accepted", don + " / " + accn]);
    } else {
      title = s === 3 ? "Sodium ion (Na\u207a)" : "Chloride ion (Cl\u207b)";
      var sh = dv.shell[sel] || [];
      rows.push(["Distance from the tube axis", nm(r) + " nm"]);
      rows.push(["Distance to the nearest wall carbon", nm(wallDistance(sel)) + " nm"]);
      rows.push(["Water oxygens within " + nm(HYD_CUT[s]) + " nm", String(sh.length)]);
    }
    var html = "<p class=\"insp-sel-title\">" + title + "</p><dl>";
    rows.forEach(function (rw) { html += "<dt>" + rw[0] + "</dt><dd>" + rw[1] + "</dd>"; });
    html += "</dl><p class=\"insp-sel-time\">At t = " + Math.round(frameTime()) + " fs; values update as the trajectory plays. <a href=\"#readouts\">How these are computed</a></p>";
    ui.info.innerHTML = html;
    ui.clear.hidden = false;
  }
  function pick(px, py) {
    if (!drawn.sorted) return;
    for (var s = drawn.sorted.length - 1; s >= 0; s--) {
      var j = drawn.sorted[s], dx = px - drawn.sx[j], dy = py - drawn.sy[j], r = Math.max(drawn.sr[j], 6 * dpr);
      if (dx * dx + dy * dy <= r * r) {
        var i = drawn.idx[j];
        sel = data.spc[i] === 2 ? waterOf(i, derive()) : i;
        showInfo(); dirty = true; return;
      }
    }
    sel = -1; showInfo(); dirty = true;
  }

  /* ---- facts table under the tube buttons ---- */
  function renderFacts() {
    var t = tube;
    ui.facts.innerHTML =
      "<div><dt>Diameter</dt><dd>" + t.diameter_nm.toPrecision(3) + " nm</dd></div>" +
      "<div><dt>Periodic length</dt><dd>" + t.length_nm.toPrecision(3) + " nm</dd></div>" +
      "<div><dt>Contents</dt><dd>" + t.n_water + " H\u2082O, " + t.n_na + " Na\u207a, " + t.n_cl + " Cl\u207b</dd></div>" +
      "<div><dt>Shown</dt><dd>" + t.n_frames + " frames, every " + t.frame_spacing_fs + " fs (" + t.duration_ps.toPrecision(3) + " ps)</dd></div>";
    canvas.setAttribute("aria-label", "Molecular view of the " + t.label + " nanotube trajectory: " + t.n_water +
      " water molecules, " + t.n_na + " sodium and " + t.n_cl + " chloride ions inside a carbon nanotube of diameter " +
      t.diameter_nm.toPrecision(3) + " nanometres.");
  }

  /* ---- playback ---- */
  function frameTime() { return tube.t0_fs + frame * tube.frame_spacing_fs; }
  function updateTime() {
    if (!tube) return;
    ui.time.textContent = "t = " + Math.round(frameTime()) + " fs";
    ui.slider.value = String(frame);
    ui.slider.setAttribute("aria-valuetext", Math.round(frameTime()) + " femtoseconds, frame " + (frame + 1) + " of " + data.F);
  }
  function updatePlay() {
    ui.play.textContent = playing ? "Pause" : "Play";
    ui.play.setAttribute("aria-label", playing ? "Pause the trajectory" : "Play the trajectory");
  }
  function tick(now) {
    var dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0; lastT = now;
    if (playing && data && !document.hidden) {
      acc += dt * 30 * speed;
      var steps = Math.floor(acc);
      if (steps > 0) { acc -= steps; frame = (frame + steps) % data.F; dirty = true; if (sel >= 0) showInfoThrottled(); }
    }
    if (dirty) { render(); updateTime(); dirty = false; }
    requestAnimationFrame(tick);
  }
  var infoTimer = 0;
  function showInfoThrottled() { var t = Date.now(); if (t - infoTimer > 200) { infoTimer = t; showInfo(); } }

  /* ---- input ---- */
  var pointers = {}, dragDist = 0, pinch0 = 0, zoom0 = 0;
  canvas.addEventListener("pointerdown", function (e) {
    canvas.setPointerCapture(e.pointerId);
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    dragDist = 0;
    var ids = Object.keys(pointers);
    if (ids.length === 2) {
      var a = pointers[ids[0]], c = pointers[ids[1]];
      pinch0 = Math.hypot(a.x - c.x, a.y - c.y); zoom0 = zoom;
    }
  });
  canvas.addEventListener("pointermove", function (e) {
    var p = pointers[e.pointerId]; if (!p) return;
    var dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    var ids = Object.keys(pointers);
    if (ids.length === 1) {
      dragDist += Math.abs(dx) + Math.abs(dy);
      R = orthonormalize(mul(rotY(dx * 0.008), mul(rotX(dy * 0.008), R)));
      viewMode = "free"; dirty = true;
    } else if (ids.length === 2 && pinch0 > 0) {
      var a = pointers[ids[0]], c = pointers[ids[1]];
      dragDist += 10;
      zoom = Math.max(2, Math.min(400, zoom0 * Math.hypot(a.x - c.x, a.y - c.y) / pinch0)); dirty = true;
    }
  });
  function up(e) {
    var p = pointers[e.pointerId]; delete pointers[e.pointerId];
    if (Object.keys(pointers).length < 2) pinch0 = 0;
    if (p && dragDist < 6 && e.type === "pointerup") {
      var rect = canvas.getBoundingClientRect();
      pick((e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr);
    }
  }
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", function (e) {
    e.preventDefault();
    zoom = Math.max(2, Math.min(400, zoom * Math.exp(-e.deltaY * 0.0015))); dirty = true;
  }, { passive: false });
  canvas.addEventListener("keydown", function (e) {
    var used = true;
    if (e.key === " ") { playing = !playing; updatePlay(); }
    else if (e.key === "ArrowRight") { step(1); }
    else if (e.key === "ArrowLeft") { step(-1); }
    else if (e.key === "+" || e.key === "=") { zoom *= 1.15; }
    else if (e.key === "-") { zoom /= 1.15; }
    else if (e.key === "r" || e.key === "R") { setView("home"); }
    else used = false;
    if (used) { e.preventDefault(); dirty = true; }
  });
  function step(k) {
    if (!data) return;
    playing = false; updatePlay();
    frame = (frame + k + data.F) % data.F; dirty = true; showInfo();
  }

  ui.play.addEventListener("click", function () { playing = !playing; updatePlay(); });
  ui.slider.addEventListener("input", function () {
    playing = false; updatePlay(); frame = parseInt(ui.slider.value, 10) || 0; dirty = true; showInfo();
  });
  ui.speed.addEventListener("change", function () { speed = parseFloat(ui.speed.value) || 1; });
  [["cut", ui.cut], ["hb", ui.hb], ["dip", ui.dip], ["pbc", ui.pbc]].forEach(function (pair) {
    pair[1].addEventListener("change", function () {
      opts[pair[0]] = pair[1].checked;
      if (pair[0] === "dip") ui.legend.hidden = !opts.dip;
      if (pair[0] === "pbc") fit();
      dirty = true;
    });
  });
  function setView(mode) {
    viewMode = mode;
    R = mode === "axial" ? AXIAL.slice() : mode === "side" ? SIDE.slice() : homeView();
    fit(); dirty = true;
  }
  ui.side.addEventListener("click", function () { setView("side"); });
  ui.axial.addEventListener("click", function () { setView("axial"); });
  ui.reset.addEventListener("click", function () { setView("home"); });
  ui.clear.addEventListener("click", function () { sel = -1; showInfo(); dirty = true; });

  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas); else window.addEventListener("resize", resize);

  /* ---- start ---- */
  R = homeView();
  resize();
  requestAnimationFrame(tick);
  setStatus("Loading\u2026");
  fetch(DATA + "manifest.json").then(function (r) {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }).then(function (m) {
    man = m;
    ui.tubes.innerHTML = "";
    m.tubes.forEach(function (t) {
      var bt = document.createElement("button");
      bt.type = "button"; bt.className = "insp-tube"; bt.setAttribute("data-id", t.id); bt.setAttribute("aria-pressed", "false");
      bt.innerHTML = "<span class=\"insp-tube-label\">" + t.label + "</span><span class=\"insp-tube-d\">" + t.diameter_nm.toPrecision(3) + " nm</span>";
      bt.addEventListener("click", function () { loadTube(t); });
      ui.tubes.appendChild(bt);
    });
    var want = (location.hash || "").slice(1), def = root.getAttribute("data-default");
    var first = m.tubes.filter(function (t) { return t.id === want; })[0] || m.tubes.filter(function (t) { return t.id === def; })[0] || m.tubes[0];
    loadTube(first);
  }).catch(function () {
    fail("The trajectory list could not be loaded. Open this page from the website (not as a local file) and try again.");
  });
})();
