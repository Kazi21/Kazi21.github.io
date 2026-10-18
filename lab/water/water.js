/* water.js — Live Water Lab page: controls, molecular viewer, pulling interaction, measurements and export.
   Plain JavaScript, no libraries. All molecular dynamics runs in worker.js (LAMMPS compiled to WebAssembly);
   this file never changes coordinates: the mouse, touch and keyboard only move the tether handle. Nothing is
   downloaded or computed until the visitor presses Start. */
(function () {
  'use strict';
  var root = document.getElementById('water-lab');
  if (!root) return;
  var W = window.WaterModel, EXP = window.WaterExport, ZIP = window.WaterZip;
  var U = W.U, KJ = U.kcal2kJ, PN = U.kcalA2pN;
  var $ = function (s) { return root.querySelector(s); };
  var doc$ = function (s) { return document.querySelector(s); };
  var params = new URLSearchParams(location.search);
  var TEST = params.get('test') === '1';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var ui = {
    canvas: $('.wl-canvas'), status: $('.wl-status'), poster: $('.wl-poster'), bigStart: $('.wl-start-big'), bigDemo: $('.wl-demo-big'),
    start: $('.wl-start'), pause: $('.wl-pause'), reset: $('.wl-reset'), pace: $('#wl-pace'),
    stateBadge: $('.wl-state'), readout: $('.wl-readout'), systemReadout: $('.wl-system-readout'),
    selCentral: $('.wl-select-central'), release: $('.wl-release'), demo: $('.wl-demo'), drift: $('.wl-drift'),
    k: $('#wl-k'), kOut: $('#wl-k-out'), pullReadout: $('.wl-pull-readout'),
    molecules: $('#wl-molecules'), T: $('#wl-T'), P: $('#wl-P'), lj: $('#wl-lj'), ljLabel: $('.wl-lj-label'),
    restore: $('.wl-restore'), apply: $('.wl-apply'), condNote: $('.wl-cond-note'), hb: $('#wl-hb'), cell: $('#wl-cell'),
    viewReset: $('.wl-view-reset'),
    table: doc$('#wl-table tbody'), avgNote: doc$('.wl-avg-note'), plotsMain: doc$('.wl-plots-main'), plotsMore: doc$('.wl-plots-more'),
    allMeas: doc$('#wl-all-measurements'), log: doc$('.wl-log'),
    downloads: Array.prototype.slice.call(document.querySelectorAll('.wl-download')), dlNotes: Array.prototype.slice.call(document.querySelectorAll('.wl-dl-note')),
    engineInfo: doc$('.wl-engine-info'),
  };

  /* ---------------------------------------------------------------- worker and run IDs */
  var worker = null, runId = 0, cmdSeq = 0, pending = {};
  var topo = null, snap = null, xpos = null, pendingFrames = 0;
  var running = false, ready = false, starting = false, wasRunningBeforeHide = false;
  var engine = null, lastMsgAt = 0, throughput = { steps: 0, ms: 0, t0: 0, simps: 0 };
  var applied = { molecules: 216, T: W.RANGES.T.def, Pbar: W.RANGES.Pbar.def, ljScale: 1.0 };

  function setStatus(msg, isError) {
    ui.status.textContent = msg || '';
    ui.status.hidden = !msg;
    ui.status.classList.toggle('is-error', !!isError);
  }

  function newWorker() {
    if (worker) worker.terminate();
    worker = new Worker('worker.js');
    worker.onmessage = onWorkerMessage;
    worker.onerror = function (e) {
      e.preventDefault && e.preventDefault();
      engineFailed('The simulation engine stopped unexpectedly' + (e.message ? ' (' + e.message + ')' : '') + '. Press Reset to start again.');
    };
  }

  function send(type, payload) {
    if (!worker) return Promise.reject(new Error('engine not started'));
    var id = ++cmdSeq;
    var msg = Object.assign({ type: type, runId: runId, cmdId: id }, payload || {});
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject, runId: runId };
      worker.postMessage(msg);
    });
  }

  function onWorkerMessage(ev) {
    var m = ev.data;
    lastMsgAt = performance.now();
    if (m.type === 'ack') {
      var p = pending[m.cmdId]; delete pending[m.cmdId];
      if (m.runId !== runId) { if (p) p.reject(new Error('stale')); return; }   // a rebuilt system: ignore
      if (m.events) m.events.forEach(addEvent);
      if (m.state) applyState(m.state);
      if (p) { if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error)); }
      return;
    }
    if (m.runId !== runId) return;                                             // stale snapshot or error
    if (m.type === 'ready') {
      ready = true; starting = false;
      engine = m.engine;
      topo = m.topology;
      neighbourCache = null;
      takeSnapshot(m);
      applyState(m.state);
      if (ui.engineInfo) ui.engineInfo.textContent = 'LAMMPS ' + engine.version + ' (WebAssembly; packages ' + engine.packages.join(', ') + ')';
      fitView();
      setStatus('');
      send('pace', { pace: ui.pace.value });
      startRunning();
      if (demoAfterReady) { demoAfterReady = false; startDemo(); }
    } else if (m.type === 'snapshot') {
      takeSnapshot(m);
      if (m.computeMs) {
        throughput.steps += m.chunkSteps; throughput.ms += m.computeMs;
        if (throughput.steps >= 200) {
          var now = performance.now();
          throughput.msPerStep = throughput.ms / throughput.steps;
          throughput.simps = throughput.t0 ? (throughput.steps / 1000) / ((now - throughput.t0) / 1000) : 0;
          throughput.steps = 0; throughput.ms = 0; throughput.t0 = now;
        }
      }
    } else if (m.type === 'error') {
      engineFailed(friendlyError(m), m.fatal);
    }
  }

  function friendlyError(m) {
    var msg = m.message || 'unknown error';
    if (m.where === 'load') return msg + ' Check the connection and press Reset.';
    var first = msg.split('\n')[0].replace(/^ERROR:\s*/, '').replace(/\s*\(src\/[^)]*\)/g, '').trim();
    return 'The simulation stopped (' + first + '). Press Reset to rebuild the system.';
  }

  function engineFailed(msg) {
    running = false; ready = false; starting = false; demoAfterReady = false;
    setStatus(msg, true);
    updateButtons();
    stopDemo();
  }

  function takeSnapshot(m) {
    snap = m.snap;
    if (m.x) { xpos = m.x; pendingFrames++; }
    if (m.newRecords && m.newRecords.length) m.newRecords.forEach(addRecord);
    if (m.events) m.events.forEach(addEvent);
    dirty = true;
    demoStep();
  }

  function applyState(s) {
    if (!s) return;
    state.pulling = s.pulling; state.sel = s.sel; state.phase = s.phase; state.ensemble = s.ensemble; state.k = s.k;
    updateButtons();
  }
  var state = { pulling: false, sel: 0, phase: 'free', ensemble: 'npt', k: 0 };

  /* ---------------------------------------------------------------- build, start, pause, reset */
  function presetId(n) { return 'spce-' + n + '-298K-1bar-v2'; }

  function build(n) {
    stopDemo();
    if (typeof WebAssembly !== 'object' || typeof Worker === 'undefined') {
      setStatus('This browser cannot run the simulation engine: WebAssembly and Web Workers are required (any current Chrome, Edge, Firefox or Safari).', true);
      return Promise.resolve();
    }
    runId++;
    ready = false; running = false; starting = true; snap = null; xpos = null; topo = null;
    clearMeasurements();
    if (!worker) newWorker();
    setStatus('Loading the LAMMPS engine and ' + n + ' water molecules…');
    ui.poster.hidden = true;
    var myRun = runId;
    updateButtons();
    return fetch('data/preset_water' + n + '.data').then(function (r) {
      if (!r.ok) throw new Error('preset not found (' + r.status + ')');
      return r.text();
    }).then(function (text) {
      if (myRun !== runId) return;
      worker.postMessage({ type: 'initialize', runId: runId, config: {
        runId: runId, presetId: presetId(n), molecules: n, dataText: text,
        T: applied.T, Pbar: applied.Pbar, ljScale: applied.ljScale, ensemble: 'npt', allowTestHooks: TEST } });
    }).catch(function (e) { engineFailed('The starting configuration could not be loaded (' + e.message + '). Open this page from the website and press Reset.'); });
  }

  function startRunning() {
    if (!ready) return;
    send('start').then(function () { running = true; updateButtons(); addLog('Simulation running'); }).catch(noop);
    running = true; updateButtons();
  }
  function pauseRunning(reason) {
    if (!ready) return;
    send('pause').catch(noop);
    running = false; updateButtons();
    if (reason) addLog(reason);
  }
  function noop() {}

  var demoAfterReady = false;                       // "Try a gentle pull" pressed before the engine was running
  ui.bigStart.addEventListener('click', function () { build(applied.molecules); ui.canvas.focus({ preventScroll: true }); });
  ui.bigDemo.addEventListener('click', function () { demoAfterReady = true; build(applied.molecules); ui.canvas.focus({ preventScroll: true }); });
  ui.start.addEventListener('click', function () {
    if (!ready && !starting) { build(applied.molecules); return; }
    if (ready && !running) startRunning();
  });
  ui.pause.addEventListener('click', function () { if (running) pauseRunning('Paused'); else startRunning(); });
  ui.reset.addEventListener('click', function () {
    if (worker && !ready && !starting) newWorker();               // engine failed: replace the worker
    build(applied.molecules);
  });
  ui.pace.addEventListener('change', function () { if (ready) send('pace', { pace: ui.pace.value }).catch(noop); });
  if (reduceMotion) { ui.pace.value = 'slow'; }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (running) { wasRunningBeforeHide = true; pauseRunning('Paused while the tab is hidden'); } }
    else if (wasRunningBeforeHide) { wasRunningBeforeHide = false; startRunning(); }
  });

  function updateButtons() {
    var live = ready;
    ui.start.disabled = starting || (ready && running);
    ui.pause.disabled = !ready;
    ui.pause.textContent = !ready || running ? 'Pause' : 'Resume';
    ui.pause.setAttribute('aria-pressed', ready && !running ? 'true' : 'false');
    ui.reset.disabled = !worker;
    ui.selCentral.disabled = !live || state.pulling;
    ui.release.disabled = !live || !state.pulling;
    ui.demo.disabled = starting || demo.active;                 // before Start, it starts the engine and then pulls
    ui.drift.disabled = !live || state.pulling;
    ui.apply.disabled = !live || state.pulling;
    ui.restore.disabled = !live || state.pulling;
    if (!exporting) ui.downloads.forEach(function (b) { b.disabled = !live; });
    ui.condNote.hidden = !state.pulling;
    [ui.T, ui.P, ui.lj, ui.molecules].forEach(function (c) { c.disabled = state.pulling; });
    var badge = state.pulling ? 'Driven response' : state.phase === 'relaxation' ? 'Relaxation after release' : 'Free dynamics';
    ui.stateBadge.textContent = ready ? badge : 'Not started';
    ui.stateBadge.className = 'wl-state' + (state.pulling ? ' is-driven' : state.phase === 'relaxation' ? ' is-relax' : '');
  }

  /* ---------------------------------------------------------------- experiment controls */
  function kValue() { return W.RANGES.k[parseInt(ui.k.value, 10)]; }
  function showK() {
    var k = kValue();
    ui.kOut.textContent = (k * U.kcalA2_Nm).toPrecision(3) + ' N/m';
    ui.k.setAttribute('aria-valuetext', (k * U.kcalA2_Nm).toPrecision(3) + ' newtons per metre');
  }
  ui.k.addEventListener('input', function () {
    showK();
    if (ready) send('setStiffness', { k: kValue() }).catch(showCmdError);
  });
  showK();

  function showCmdError(e) { if (e && e.message !== 'stale') { setStatus(e.message); setTimeout(function () { if (ui.status.textContent === e.message) setStatus(''); }, 5000); } }

  function selectMolecule(mol) {
    if (!ready || state.pulling) return Promise.resolve();
    return send('select', { molecule: mol }).then(function () { state.sel = mol; dirty = true; announce('Molecule ' + mol + ' selected'); }).catch(showCmdError);
  }
  function centralMolecule() {
    if (!snap || !xpos || !topo) return 1;
    var b = snap.box, c = [0, 1, 2].map(function (d) { return (b.lo[d] + b.hi[d]) / 2; }), L = boxL();
    var best = 1, bd = Infinity;
    for (var m = 0; m < topo.nmol; m++) {
      var o = topo.molAtoms[3 * m], d2 = 0;
      for (var k = 0; k < 3; k++) { var d = xpos[3 * o + k] - c[k]; d -= L[k] * Math.round(d / L[k]); d2 += d * d; }
      if (d2 < bd) { bd = d2; best = m + 1; }
    }
    return best;
  }
  ui.selCentral.addEventListener('click', function () { selectMolecule(centralMolecule()); });
  ui.release.addEventListener('click', function () { releasePull(); });
  ui.drift.addEventListener('click', function () { if (ready) send('removeDrift').catch(showCmdError); });

  function beginPull() {
    if (!ready || state.pulling || !state.sel) return Promise.resolve(false);
    state.pulling = true;                                   // optimistic; corrected by the acknowledgement
    return send('beginPull', { molecule: state.sel, settings: { k: kValue() } }).then(function (res) {
      pullStartX = res && res.X ? res.X.slice() : null;      // the latest snapshot may predate the pull
      announce('Pulling molecule ' + state.sel + '. The handle starts at its centre of mass.');
      return true;
    }).catch(function (e) { state.pulling = false; showCmdError(e); return false; });
  }
  var pullStartX = null;
  function handleBase() { return request || (snap.pulling ? snap.X : (pullStartX || snap.R)); }
  function releasePull() {
    if (!ready || !state.pulling) return;
    request = null; pullStartX = null;
    send('releasePull').then(function () { announce('Released. The tether is removed; the liquid now evolves freely.'); }).catch(showCmdError);
  }

  /* conditions */
  function ljLabel() {
    var s = parseFloat(ui.lj.value);
    ui.ljLabel.textContent = Math.abs(s - 1) < 1e-9 ? 'Reference SPC/E parameters' : 'Modified SPC/E educational model (εOO = ' + (0.1553 * s * KJ).toPrecision(3) + ' kJ/mol)';
    ui.ljLabel.classList.toggle('is-modified', Math.abs(s - 1) > 1e-9);
  }
  ui.lj.addEventListener('change', ljLabel);
  ljLabel();
  ui.restore.addEventListener('click', function () { ui.lj.value = '1.00'; ljLabel(); applyConditions(); });
  ui.apply.addEventListener('click', function () { applyConditions(); });

  function readNumber(input, lo, hi, name) {
    var v = parseFloat(input.value);
    if (!(v >= lo && v <= hi)) { input.setAttribute('aria-invalid', 'true'); throw new Error(name + ' must be between ' + lo + ' and ' + hi); }
    input.removeAttribute('aria-invalid');
    return v;
  }
  function applyConditions() {
    if (!ready || state.pulling) return;
    var T, P, s = parseFloat(ui.lj.value), n = parseInt(ui.molecules.value, 10);
    try { T = readNumber(ui.T, W.RANGES.T.min, W.RANGES.T.max, 'Temperature'); P = readNumber(ui.P, W.RANGES.Pbar.min, W.RANGES.Pbar.max, 'Pressure'); }
    catch (e) { setStatus(e.message); return; }
    setStatus('');
    var changed = T !== applied.T || P !== applied.Pbar || Math.abs(s - applied.ljScale) > 1e-9;
    applied.T = T; applied.Pbar = P; applied.ljScale = s;
    if (n !== applied.molecules) { applied.molecules = n; build(n); return; }
    var p = send('setConditions', { targets: { T: T, Pbar: P, ensemble: 'npt' } });
    var q = Math.abs(s - (snap ? snap.ljScale : 1)) > 1e-9 ? send('setLJScale', { scale: s }) : Promise.resolve();
    Promise.all([p, q]).then(function () { if (changed) announce('Conditions applied: ' + T + ' K, ' + P + ' bar, O–O LJ strength ' + s.toFixed(2)); }).catch(showCmdError);
  }

  /* ---------------------------------------------------------------- viewer */
  var canvas = ui.canvas, ctx = canvas.getContext('2d');
  var BG = '#0D1B2A', VTEXT = '#E9EEF3', VMUTED = '#A7B6C6', VACCENT = '#62D6C2';
  var C_TETHER = '#E69F00', C_INT = '#56B4E9', C_HANDLE = '#F0E442';
  var COLOR = { 1: '#e03030', 2: '#f2f4f7' }, RAD = { 1: 0.55, 2: 0.30 };
  var FORCE_A_PER_PN = 6.0 / 1000;                 // arrow length: 1000 pN drawn as 0.6 nm (world units)
  var HB_OO = 3.5, HB_ANG = 30, NEAR_OO = 3.5;
  var Rm = null, zoom = 20, dpr = 1, Wc = 0, Hc = 0, dirty = true;
  var neighbourCache = null, hbCache = null;

  function hex2rgb(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function css(c, a) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (a == null ? 1 : a) + ')'; }
  var BGRGB = hex2rgb(BG), WHITE = [255, 255, 255], BLACK = [0, 0, 0];
  var sprites = {}, SPR = 96, LEVELS = 6;
  function sprite(type, level) {
    var key = type + '|' + level;
    if (sprites[key]) return sprites[key];
    var rgb = mix(hex2rgb(COLOR[type]), BGRGB, level / LEVELS * 0.22);
    var c = document.createElement('canvas'); c.width = c.height = SPR;
    var g = c.getContext('2d'), r = SPR / 2 - 2;
    var grad = g.createRadialGradient(SPR / 2 - r * 0.35, SPR / 2 - r * 0.35, r * 0.08, SPR / 2, SPR / 2, r);
    grad.addColorStop(0, css(mix(rgb, WHITE, 0.5))); grad.addColorStop(0.45, css(rgb)); grad.addColorStop(1, css(mix(rgb, BLACK, 0.5)));
    g.fillStyle = grad; g.beginPath(); g.arc(SPR / 2, SPR / 2, r, 0, Math.PI * 2); g.fill();
    g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,0.45)'; g.stroke();
    return (sprites[key] = c);
  }
  function mul(A, B) { var C = new Array(9); for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j]; return C; }
  function rotX(a) { var c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
  function rotY(a) { var c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
  function orthonormalize(M) {
    var a = [M[0], M[1], M[2]], b = [M[3], M[4], M[5]], na = Math.hypot(a[0], a[1], a[2]);
    a = a.map(function (v) { return v / na; });
    var d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; b = [b[0] - d * a[0], b[1] - d * a[1], b[2] - d * a[2]];
    var nb = Math.hypot(b[0], b[1], b[2]); b = b.map(function (v) { return v / nb; });
    var c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    return [a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]];
  }
  function homeView() { return orthonormalize(mul(rotX(0.42), rotY(-0.55))); }
  Rm = homeView();

  function boxL() { var b = snap.box; return [b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]]; }
  function boxC() { var b = snap.box; return [(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, (b.lo[2] + b.hi[2]) / 2]; }

  function resize() {
    var rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(200, Math.round(rect.width * dpr)), h = Math.max(160, Math.round(rect.height * dpr));
    if (w !== Wc || h !== Hc) { Wc = canvas.width = w; Hc = canvas.height = h; fitView(); dirty = true; }
  }
  function fitView() {
    var L = snap ? Math.max.apply(null, boxL()) : 19;
    zoom = Math.min(Wc, Hc) * 0.66 / L;
    dirty = true;
  }
  function project(p, out) {
    var c = boxC(), x = p[0] - c[0], y = p[1] - c[1], z = p[2] - c[2];
    out[0] = Wc / 2 + zoom * (Rm[0] * x + Rm[1] * y + Rm[2] * z);
    out[1] = Hc / 2 - zoom * (Rm[3] * x + Rm[4] * y + Rm[5] * z);
    out[2] = Rm[6] * x + Rm[7] * y + Rm[8] * z;
    return out;
  }

  /* Display coordinates: oxygen wrapped into the cell, hydrogens placed by the molecule's own unwrapped
     geometry, so every molecule is drawn whole even when it straddles a cell face. */
  var disp = null, shift = null;
  function computeDisplay() {
    var n = topo.natoms, nm = topo.nmol, b = snap.box, L = boxL();
    if (!disp || disp.length !== 3 * n) { disp = new Float32Array(3 * n); shift = new Float32Array(3 * nm); }
    for (var m = 0; m < nm; m++) {
      var o = topo.molAtoms[3 * m];
      for (var k = 0; k < 3; k++) {
        var x = xpos[3 * o + k], w = b.lo[k] + ((x - b.lo[k]) % L[k] + L[k]) % L[k];
        shift[3 * m + k] = w - x;
      }
      for (var a = 0; a < 3; a++) {
        var i = topo.molAtoms[3 * m + a];
        disp[3 * i] = xpos[3 * i] + shift[3 * m]; disp[3 * i + 1] = xpos[3 * i + 1] + shift[3 * m + 1]; disp[3 * i + 2] = xpos[3 * i + 2] + shift[3 * m + 2];
      }
    }
  }
  function micd(d, L) { return d - L * Math.round(d / L); }

  function neighbours(mol) {
    var out = [], o = topo.molAtoms[3 * (mol - 1)], L = boxL();
    for (var m = 0; m < topo.nmol; m++) {
      if (m === mol - 1) continue;
      var p = topo.molAtoms[3 * m];
      var dx = micd(xpos[3 * p] - xpos[3 * o], L[0]), dy = micd(xpos[3 * p + 1] - xpos[3 * o + 1], L[1]), dz = micd(xpos[3 * p + 2] - xpos[3 * o + 2], L[2]);
      if (dx * dx + dy * dy + dz * dz < NEAR_OO * NEAR_OO) out.push(m + 1);
    }
    return out;
  }
  /* Geometric hydrogen bonds with minimum-image distances: O...O < 0.35 nm and angle H-Od...Oa < 30 degrees. */
  function hbonds(onlyMol) {
    var out = [], L = boxL(), cosMax = Math.cos(HB_ANG * Math.PI / 180), nm = topo.nmol;
    for (var d = 0; d < nm; d++) {
      var od = topo.molAtoms[3 * d];
      for (var a = 0; a < nm; a++) {
        if (a === d) continue;
        if (onlyMol && d !== onlyMol - 1 && a !== onlyMol - 1) continue;
        var oa = topo.molAtoms[3 * a];
        var vx = micd(xpos[3 * oa] - xpos[3 * od], L[0]), vy = micd(xpos[3 * oa + 1] - xpos[3 * od + 1], L[1]), vz = micd(xpos[3 * oa + 2] - xpos[3 * od + 2], L[2]);
        var r2 = vx * vx + vy * vy + vz * vz;
        if (r2 > HB_OO * HB_OO) continue;
        var r = Math.sqrt(r2);
        for (var h = 1; h <= 2; h++) {
          var hi = topo.molAtoms[3 * d + h];
          var hx = xpos[3 * hi] - xpos[3 * od], hy = xpos[3 * hi + 1] - xpos[3 * od + 1], hz = xpos[3 * hi + 2] - xpos[3 * od + 2];
          var c = (hx * vx + hy * vy + hz * vz) / (Math.hypot(hx, hy, hz) * r);
          if (c > cosMax) out.push(hi, od, oa, d, a);
        }
      }
    }
    return out;
  }

  var tmp = [0, 0, 0], tmp2 = [0, 0, 0];
  function render() {
    ctx.fillStyle = BG; ctx.fillRect(0, 0, Wc, Hc);
    if (!snap || !xpos || !topo) return;
    computeDisplay();
    var n = topo.natoms, nm = topo.nmol, b = snap.box;
    // periodic cell
    if (ui.cell.checked) {
      var corners = [];
      for (var c = 0; c < 8; c++) corners.push(project([c & 1 ? b.hi[0] : b.lo[0], c & 2 ? b.hi[1] : b.lo[1], c & 4 ? b.hi[2] : b.lo[2]], [0, 0, 0]));
      ctx.save(); ctx.strokeStyle = 'rgba(167,182,198,0.55)'; ctx.lineWidth = 1.2 * dpr; ctx.beginPath();
      [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(function (e) {
        ctx.moveTo(corners[e[0]][0], corners[e[0]][1]); ctx.lineTo(corners[e[1]][0], corners[e[1]][1]);
      });
      ctx.stroke(); ctx.restore();
    }
    // project atoms
    if (!render.sx || render.sx.length !== n) { render.sx = new Float32Array(n); render.sy = new Float32Array(n); render.sz = new Float32Array(n); render.order = []; }
    var sx = render.sx, sy = render.sy, sz = render.sz, zmin = Infinity, zmax = -Infinity, i;
    for (i = 0; i < n; i++) {
      project([disp[3 * i], disp[3 * i + 1], disp[3 * i + 2]], tmp);
      sx[i] = tmp[0]; sy[i] = tmp[1]; sz[i] = tmp[2];
      if (tmp[2] < zmin) zmin = tmp[2]; if (tmp[2] > zmax) zmax = tmp[2];
    }
    var span = Math.max(1e-6, zmax - zmin);
    var order = render.order; order.length = nm;
    for (var m = 0; m < nm; m++) order[m] = m;
    order.sort(function (p, q) { return sz[topo.molAtoms[3 * p]] - sz[topo.molAtoms[3 * q]]; });
    var sel = state.sel, near = sel ? (neighbourCache && neighbourCache.step === snap.step && neighbourCache.sel === sel ? neighbourCache.list : (neighbourCache = { step: snap.step, sel: sel, list: neighbours(sel) }).list) : [];
    // hydrogen bonds (drawn under the molecules)
    if (ui.hb.checked || sel) {
      var hbMode = ui.hb.checked ? 0 : sel;
      if (!hbCache || hbCache.step !== snap.step || hbCache.mode !== hbMode || hbCache.run !== runId) hbCache = { step: snap.step, mode: hbMode, run: runId, list: hbonds(hbMode) };
      var hb = hbCache.list, LL = boxL();
      ctx.save(); ctx.setLineDash([3 * dpr, 3 * dpr]); ctx.lineWidth = 1.4 * dpr; ctx.strokeStyle = 'rgba(98,214,194,0.85)'; ctx.beginPath();
      for (var h = 0; h < hb.length; h += 5) {
        var hi = hb[h], od = hb[h + 1], oa = hb[h + 2];
        var dx = micd(xpos[3 * oa] - xpos[3 * od], LL[0]), dy = micd(xpos[3 * oa + 1] - xpos[3 * od + 1], LL[1]), dz = micd(xpos[3 * oa + 2] - xpos[3 * od + 2], LL[2]);
        project([disp[3 * od] + dx, disp[3 * od + 1] + dy, disp[3 * od + 2] + dz], tmp2);
        ctx.moveTo(sx[hi], sy[hi]); ctx.lineTo(tmp2[0], tmp2[1]);
      }
      ctx.stroke(); ctx.restore();
    }
    // molecules back to front: bonds from the topology, then atoms by depth. With a selection, the other
    // molecules are drawn at reduced opacity, its neighbours in full, and the selected molecule last (on top).
    var stick = Math.max(1.5, 0.16 * zoom);
    var hl = null;
    if (sel) { hl = new Uint8Array(nm); hl[sel - 1] = 2; near.forEach(function (mo) { hl[mo - 1] = 1; }); }
    function drawMolecule(mm) {
      var o = topo.molAtoms[3 * mm], h1 = topo.molAtoms[3 * mm + 1], h2 = topo.molAtoms[3 * mm + 2];
      ctx.strokeStyle = '#c9d2dc'; ctx.lineWidth = stick; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx[o], sy[o]); ctx.lineTo(sx[h1], sy[h1]); ctx.moveTo(sx[o], sy[o]); ctx.lineTo(sx[h2], sy[h2]); ctx.stroke();
      var atoms = [o, h1, h2].sort(function (p, r) { return sz[p] - sz[r]; });
      for (var a = 0; a < 3; a++) {
        var ai = atoms[a], t = topo.type[ai], r = RAD[t] * zoom;
        var lvl = Math.min(LEVELS - 1, Math.floor((1 - (sz[ai] - zmin) / span) * LEVELS));
        ctx.drawImage(sprite(t, lvl), sx[ai] - r, sy[ai] - r, 2 * r, 2 * r);
      }
    }
    for (var q = 0; q < nm; q++) {
      var mq = order[q];
      if (hl && hl[mq] === 2) continue;
      ctx.globalAlpha = hl && !hl[mq] ? 0.55 : 1;
      drawMolecule(mq);
    }
    ctx.globalAlpha = 1;
    if (sel) drawMolecule(sel - 1);
    // selection and nearby waters
    if (sel) {
      ctx.save(); ctx.lineWidth = 2 * dpr;
      ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.strokeStyle = VACCENT;
      near.forEach(function (mo) { var oi = topo.molAtoms[3 * (mo - 1)]; ctx.beginPath(); ctx.arc(sx[oi], sy[oi], RAD[1] * zoom + 3 * dpr, 0, Math.PI * 2); ctx.stroke(); });
      ctx.setLineDash([]); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5 * dpr;
      for (var s = 0; s < 3; s++) { var si = topo.molAtoms[3 * (sel - 1) + s]; ctx.beginPath(); ctx.arc(sx[si], sy[si], RAD[topo.type[si]] * zoom + 3 * dpr, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
      drawPull(sel);
    }
    if (!(TEST && window.__waterLabClean)) drawOverlay();     // the clean flag is used only to render the main-page thumbnail
  }

  function arrow(x0, y0, x1, y1, color, dash) {
    var len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 2 * dpr) return;
    var ux = (x1 - x0) / len, uy = (y1 - y0) / len, hw = 5 * dpr, hl = 9 * dpr;
    ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.6 * dpr; ctx.setLineDash(dash || []);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - ux * hl * 0.8, y1 - uy * hl * 0.8); ctx.stroke();
    ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - ux * hl - uy * hw, y1 - uy * hl + ux * hw); ctx.lineTo(x1 - ux * hl + uy * hw, y1 - uy * hl - ux * hw); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function comDisplay(mol) {
    var R = snap.R, m = mol - 1;
    return [R[0] + shift[3 * m], R[1] + shift[3 * m + 1], R[2] + shift[3 * m + 2]];
  }
  function drawPull(mol) {
    if (!snap.sel || snap.sel !== mol) return;
    var cd = comDisplay(mol), p0 = project(cd, [0, 0, 0]);
    if (snap.pulling) {
      var m = mol - 1;
      var hx = [snap.X[0] + shift[3 * m], snap.X[1] + shift[3 * m + 1], snap.X[2] + shift[3 * m + 2]];
      var ph = project(hx, [0, 0, 0]);
      // spring (zig-zag) from the centre of mass to the handle
      var dx = ph[0] - p0[0], dy = ph[1] - p0[1], len = Math.hypot(dx, dy);
      ctx.save(); ctx.strokeStyle = C_HANDLE; ctx.lineWidth = 1.6 * dpr; ctx.beginPath(); ctx.moveTo(p0[0], p0[1]);
      if (len > 8 * dpr) {
        var ux = dx / len, uy = dy / len, nz = 8, amp = 4 * dpr;
        for (var z = 1; z < nz; z++) { var f = z / nz, sgn = z % 2 ? 1 : -1; ctx.lineTo(p0[0] + dx * f - uy * amp * sgn, p0[1] + dy * f + ux * amp * sgn); }
      }
      ctx.lineTo(ph[0], ph[1]); ctx.stroke();
      ctx.lineWidth = 2.4 * dpr; ctx.beginPath(); ctx.arc(ph[0], ph[1], 8 * dpr, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ph[0] - 12 * dpr, ph[1]); ctx.lineTo(ph[0] - 4 * dpr, ph[1]); ctx.moveTo(ph[0] + 4 * dpr, ph[1]); ctx.lineTo(ph[0] + 12 * dpr, ph[1]);
      ctx.moveTo(ph[0], ph[1] - 12 * dpr); ctx.lineTo(ph[0], ph[1] - 4 * dpr); ctx.moveTo(ph[0], ph[1] + 4 * dpr); ctx.lineTo(ph[0], ph[1] + 12 * dpr); ctx.stroke();
      // requested position when the bounds hold the handle back
      var rq = request || snap.Xreq;
      if (rq) {
        var rx = [rq[0] + shift[3 * m], rq[1] + shift[3 * m + 1], rq[2] + shift[3 * m + 2]], pr = project(rx, [0, 0, 0]);
        if (Math.hypot(pr[0] - ph[0], pr[1] - ph[1]) > 6 * dpr) {
          ctx.setLineDash([2 * dpr, 4 * dpr]); ctx.lineWidth = 1.2 * dpr; ctx.beginPath(); ctx.moveTo(ph[0], ph[1]); ctx.lineTo(pr[0], pr[1]); ctx.stroke();
          ctx.setLineDash([]); ctx.beginPath(); ctx.arc(pr[0], pr[1], 5 * dpr, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.restore();
      var Ft = snap.Ftether, s = FORCE_A_PER_PN * PN;
      var pt = project([cd[0] + Ft[0] * s, cd[1] + Ft[1] * s, cd[2] + Ft[2] * s], [0, 0, 0]);
      arrow(p0[0], p0[1], pt[0], pt[1], C_TETHER);
    }
    var Fi = snap.Fint, s2 = FORCE_A_PER_PN * PN;
    var pi = project([cd[0] + Fi[0] * s2, cd[1] + Fi[1] * s2, cd[2] + Fi[2] * s2], [0, 0, 0]);
    arrow(p0[0], p0[1], pi[0], pi[1], C_INT, [6 * dpr, 4 * dpr]);
  }

  function drawOverlay() {
    ctx.save();
    ctx.font = (12.5 * dpr) + "px 'IBM Plex Sans', system-ui, sans-serif";
    // scale bar
    var nmLen = 10 * zoom, label = '1 nm';
    if (nmLen > Wc * 0.3) { nmLen /= 2; label = '0.5 nm'; }
    var x0 = 14 * dpr, y0 = Hc - 16 * dpr;
    ctx.fillStyle = VTEXT; ctx.fillRect(x0, y0, nmLen, 3 * dpr);
    ctx.textBaseline = 'bottom'; ctx.fillText(label, x0, y0 - 4 * dpr);
    // force scale (world length of 500 pN, drawn horizontally)
    if (state.sel) {
      var fl = 500 * FORCE_A_PER_PN * zoom, xr = Wc - 14 * dpr - fl;
      ctx.strokeStyle = VTEXT; ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.moveTo(xr, y0 + 1.5 * dpr); ctx.lineTo(xr + fl, y0 + 1.5 * dpr); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xr + fl, y0 + 1.5 * dpr); ctx.lineTo(xr + fl - 7 * dpr, y0 - 3 * dpr); ctx.lineTo(xr + fl - 7 * dpr, y0 + 6 * dpr); ctx.closePath(); ctx.fillStyle = VTEXT; ctx.fill();
      ctx.textBaseline = 'bottom'; ctx.fillText('500 pN', xr, y0 - 4 * dpr);
    }
    // time and conditions
    ctx.textBaseline = 'top'; ctx.fillStyle = VTEXT;
    var line = 't = ' + snap.time_ps.toFixed(2) + ' ps   ' + fmt3(snap.T) + ' K   ' + (snap.ensemble === 'npt' ? 'NPT' : 'NVT (fixed volume)');
    ctx.fillText(line, 14 * dpr, 12 * dpr);
    ctx.fillStyle = VMUTED;
    ctx.fillText(topo.nmol + ' molecules · ' + (Math.abs(snap.ljScale - 1) < 1e-9 ? 'reference SPC/E' : 'modified SPC/E, s = ' + snap.ljScale.toFixed(2)), 14 * dpr, 30 * dpr);
    ctx.restore();
  }

  function fmt3(x) {
    if (!Number.isFinite(x)) return '–';
    var a = Math.abs(x);
    if (a >= 100) return Math.round(x).toString().replace('-', '−');
    return x.toPrecision(3).replace('-', '−');
  }

  /* ---------------------------------------------------------------- pointer, touch and keyboard */
  var pointers = {}, dragMode = null, dragDist = 0, pinch0 = 0, zoom0 = 0, request = null, reqStart = null, ptrStart = null;
  function canvasXY(e) { var r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr]; }
  function pickMolecule(px, py) {
    if (!render.sx || !topo) return 0;
    if (state.sel) {                                     // the selected molecule is drawn on top, so it is hit first
      for (var j = 0; j < 3; j++) {
        var a = topo.molAtoms[3 * (state.sel - 1) + j], rr = Math.max(RAD[topo.type[a]] * zoom, 7 * dpr) + 3 * dpr;
        if ((px - render.sx[a]) * (px - render.sx[a]) + (py - render.sy[a]) * (py - render.sy[a]) <= rr * rr) return state.sel;
      }
    }
    var best = 0, bz = -Infinity;
    for (var i = 0; i < topo.natoms; i++) {
      var r = Math.max(RAD[topo.type[i]] * zoom, 7 * dpr), dx = px - render.sx[i], dy = py - render.sy[i];
      if (dx * dx + dy * dy <= r * r && render.sz[i] > bz) { bz = render.sz[i]; best = topo.mol[i]; }
    }
    return best;
  }
  function onSelectedOrHandle(px, py) {
    if (!state.sel || !snap || snap.sel !== state.sel) return false;
    if (pickMolecule(px, py) === state.sel) return true;
    if (snap.pulling) {
      var m = state.sel - 1, ph = project([snap.X[0] + shift[3 * m], snap.X[1] + shift[3 * m + 1], snap.X[2] + shift[3 * m + 2]], [0, 0, 0]);
      if (Math.hypot(px - ph[0], py - ph[1]) < 16 * dpr) return true;
    }
    return false;
  }
  function screenToWorldDelta(dxp, dyp) {                // canvas pixels -> world Å in the screen plane
    var a = dxp / zoom, bb = -dyp / zoom;
    return [Rm[0] * a + Rm[3] * bb, Rm[1] * a + Rm[4] * bb, Rm[2] * a + Rm[5] * bb];
  }
  canvas.addEventListener('pointerdown', function (e) {
    canvas.setPointerCapture(e.pointerId);
    var xy = canvasXY(e);
    pointers[e.pointerId] = { x: xy[0], y: xy[1] };
    dragDist = 0;
    var ids = Object.keys(pointers);
    if (ids.length === 2) { var a = pointers[ids[0]], c = pointers[ids[1]]; pinch0 = Math.hypot(a.x - c.x, a.y - c.y); zoom0 = zoom; dragMode = 'pinch'; return; }
    if (ready && onSelectedOrHandle(xy[0], xy[1])) {
      dragMode = 'pull'; ptrStart = xy;
      var go = state.pulling ? Promise.resolve(true) : beginPull();
      go.then(function (ok) { if (ok && dragMode === 'pull') { reqStart = handleBase().slice(); } });
      reqStart = handleBase().slice();
    } else dragMode = 'rotate';
  });
  canvas.addEventListener('pointermove', function (e) {
    var p = pointers[e.pointerId]; if (!p) return;
    var xy = canvasXY(e), dx = xy[0] - p.x, dy = xy[1] - p.y;
    p.x = xy[0]; p.y = xy[1];
    dragDist += Math.abs(dx) + Math.abs(dy);
    var ids = Object.keys(pointers);
    if (dragMode === 'pinch' && ids.length === 2 && pinch0 > 0) {
      var a = pointers[ids[0]], c = pointers[ids[1]];
      zoom = Math.max(4, Math.min(200, zoom0 * Math.hypot(a.x - c.x, a.y - c.y) / pinch0)); dirty = true;
    } else if (dragMode === 'rotate') {
      Rm = orthonormalize(mul(rotY(dx / dpr * 0.008), mul(rotX(dy / dpr * 0.008), Rm))); dirty = true;
    } else if (dragMode === 'pull' && reqStart && state.pulling) {
      var d = screenToWorldDelta(xy[0] - ptrStart[0], xy[1] - ptrStart[1]);
      request = [reqStart[0] + d[0], reqStart[1] + d[1], reqStart[2] + d[2]];
      requestDirty = true; dirty = true;
    }
  });
  function pointerUp(e) {
    var p = pointers[e.pointerId]; delete pointers[e.pointerId];
    if (Object.keys(pointers).length < 2) pinch0 = 0;
    if (p && dragDist < 6 * dpr && e.type === 'pointerup' && dragMode !== 'pinch') {
      var mol = pickMolecule(p.x, p.y);
      if (!state.pulling) { if (mol) selectMolecule(mol); }
    }
    if (!Object.keys(pointers).length) dragMode = null;
  }
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);
  canvas.addEventListener('wheel', function (e) { e.preventDefault(); zoom = Math.max(4, Math.min(200, zoom * Math.exp(-e.deltaY * 0.0015))); dirty = true; }, { passive: false });
  canvas.addEventListener('keydown', function (e) {
    var used = true, stepA = 0.5;
    if (e.key === ' ') { if (ready) { if (running) pauseRunning('Paused'); else startRunning(); } }
    else if (e.key === 'Escape') releasePull();
    else if ((e.key === 'n' || e.key === 'N') && !state.pulling) selectMolecule(centralMolecule());
    else if (e.key === '+' || e.key === '=') { zoom = Math.min(200, zoom * 1.15); dirty = true; }
    else if (e.key === '-') { zoom = Math.max(4, zoom / 1.15); dirty = true; }
    else if (/^Arrow/.test(e.key) && e.shiftKey) {
      var ang = 5 * Math.PI / 180;
      Rm = orthonormalize(e.key === 'ArrowLeft' ? mul(rotY(-ang), Rm) : e.key === 'ArrowRight' ? mul(rotY(ang), Rm) : e.key === 'ArrowUp' ? mul(rotX(-ang), Rm) : mul(rotX(ang), Rm));
      dirty = true;
    } else if (/^Arrow/.test(e.key) && state.sel && ready) {
      var dxs = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, dys = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
      var go = state.pulling ? Promise.resolve(true) : beginPull();
      go.then(function (ok) {
        if (!ok || !snap) return;
        var base = handleBase();
        var d = screenToWorldDelta(dxs * stepA * zoom, dys * stepA * zoom);
        request = [base[0] + d[0], base[1] + d[1], base[2] + d[2]];
        requestDirty = true; dirty = true;
      });
    } else used = false;
    if (used) e.preventDefault();
  });
  ui.viewReset.addEventListener('click', function () { Rm = homeView(); fitView(); });
  [ui.hb, ui.cell].forEach(function (c) { c.addEventListener('change', function () { dirty = true; }); });

  var requestDirty = false;
  function flushRequest() {
    if (requestDirty && request && state.pulling && ready) {
      requestDirty = false;
      send('updatePullTarget', { position: request }).catch(noop);
    }
  }

  /* ---------------------------------------------------------------- scripted demonstration */
  var demo = { active: false };
  function stopDemo() { demo.active = false; if (ui.demo) ui.demo.disabled = starting; }
  ui.demo.addEventListener('click', function () {
    if (starting) return;
    if (!ready) { demoAfterReady = true; if (worker) newWorker(); build(applied.molecules); return; }
    startDemo();
  });
  function startDemo() {
    if (!ready) return;
    var go = state.pulling ? send('releasePull') : Promise.resolve();
    go.then(function () {
      var mol = centralMolecule();
      ui.k.value = String(W.RANGES.k.indexOf(1)); showK();
      return send('select', { molecule: mol }).then(function () { state.sel = mol; return send('setStiffness', { k: 1 }); })
        .then(function () { return send('beginPull', { molecule: mol, settings: { k: 1 } }); })
        .then(function (res) {
          if (!running) startRunning();
          var dir = [Rm[0], Rm[1], Rm[2]];                  // screen right, in world coordinates
          // the handle starts at the molecule's centre of mass, returned by the engine (the last snapshot predates the pull)
          var X0 = res && res.X ? res.X.slice() : snap.R.slice();
          pullStartX = X0.slice();
          demo = { active: true, phase: 'pull', t0: snap.time_ps, X0: X0, dir: dir, dist: 2.5, pullPs: 1.0, holdPs: 1.0 };
          request = null;
          announce('Demonstration: a gentle tether (0.695 N/m) moves the handle 0.25 nm over 1 ps, holds for 1 ps, then releases.');
          updateButtons();
        });
    }).catch(function (e) { showCmdError(e); stopDemo(); });
  }
  function demoStep() {
    if (!demo.active || !snap) return;
    var t = snap.time_ps - demo.t0;
    if (demo.phase === 'pull') {
      var f = Math.min(1, t / demo.pullPs);
      request = demo.X0.map(function (v, i) { return v + demo.dir[i] * demo.dist * f; });
      requestDirty = true;
      if (f >= 1) demo.phase = 'hold';
    } else if (demo.phase === 'hold' && t >= demo.pullPs + demo.holdPs) {
      demo.phase = 'done'; demo.active = false;
      releasePull();
      updateButtons();
    }
  }

  /* ---------------------------------------------------------------- readouts */
  function rowsHTML(rows) { return rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>'; }).join(''); }
  var lastReadout = 0;
  function updateReadouts() {
    if (!snap) return;
    var now = performance.now();
    if (now - lastReadout < 180) return;
    lastReadout = now;
    var L = boxL();
    var ens = snap.ensemble === 'npt' ? 'Constant pressure (NPT)' : 'Fixed volume (NVT)';
    var model = Math.abs(snap.ljScale - 1) < 1e-9 ? 'Reference SPC/E parameters' : 'Modified SPC/E educational model, s = ' + snap.ljScale.toFixed(2);
    var tp = throughput.msPerStep ? fmt3(throughput.simps) + ' ps/s (' + fmt3(throughput.msPerStep) + ' ms/step)' : 'measuring…';
    var sel = snap.sel;
    var ft = Math.hypot.apply(null, snap.Ftether) * PN, fi = Math.hypot.apply(null, snap.Fint) * PN;
    var vc = Math.hypot.apply(null, snap.vcm) * U.A_fs2m_s;
    ui.readout.innerHTML = rowsHTML([
      ['Simulated time', snap.time_ps.toFixed(2) + ' ps'],
      ['Temperature', fmt3(snap.T) + ' K <span class="wl-dim">(target ' + fmt3(snap.T_target) + ' K)</span>'],
      ['Selected molecule', sel ? sel + (snap.pulling ? ' (tethered)' : '') : 'none'],
      ['<span class="wl-key wl-key-tether"></span>Applied force', snap.pulling ? fmt3(ft) + ' pN' : '0 pN (no tether)'],
    ]);
    ui.systemReadout.innerHTML = rowsHTML([
      ['Ensemble', ens],
      ['Pressure', fmt3(snap.P_bar) + ' bar <span class="wl-dim">(' + (snap.ensemble === 'npt' ? 'target ' + fmt3(snap.P_target) + ' bar' : 'no target at fixed volume') + ')</span>'],
      ['Density', fmt3(snap.density) + ' kg/m³'],
      ['Molecules · cell edge', topo.nmol + ' · ' + (L[0] / 10).toPrecision(3) + ' nm'],
      ['Model', model],
      ['Engine speed', tp],
    ]);
    ui.pullReadout.innerHTML = rowsHTML([
      ['<span class="wl-key wl-key-tether"></span>Applied tether force', snap.pulling ? fmt3(ft) + ' pN' : '0 pN (no tether)'],
      ['<span class="wl-key wl-key-int"></span>Net interaction force', sel ? fmt3(fi) + ' pN' : '–'],
      ['Displacement since selection', sel ? fmt3(snap.disp / 10) + ' nm' : '–'],
      ['Tether energy', fmt3(snap.Utether * KJ) + ' kJ/mol'],
      ['Protocol work (all pulls)', fmt3(snap.Wprot * KJ) + ' kJ/mol'],
      ['Work delivered to molecules', fmt3(snap.Wdel * KJ) + ' kJ/mol'],
      ['Water potential energy per molecule', fmt3(snap.pe * KJ / topo.nmol) + ' kJ/mol'],
      ['Kinetic energy per molecule', fmt3(snap.ke * KJ / topo.nmol) + ' kJ/mol'],
      ['System drift velocity', fmt3(vc) + ' m/s'],
    ]);
    canvas.setAttribute('aria-label', 'Live molecular view: ' + topo.nmol + ' water molecules at ' + fmt3(snap.T) + ' K after ' + snap.time_ps.toFixed(1) +
      ' ps' + (sel ? '; molecule ' + sel + ' selected' + (snap.pulling ? ' and tethered, tether force ' + fmt3(ft) + ' piconewtons' : '') : '') + '.');
    updateTable();
  }

  /* ---------------------------------------------------------------- measurements: records, statistics, plots */
  var rec = null, events = [], avgStart = 0;
  var COL = {};
  function clearMeasurements() {
    rec = { t: [], T: [], Tt: [], P: [], Pt: [], rho: [], pe: [], ft: [], fi: [], disp: [], wp: [], wd: [], ut: [], vc: [], ens: [] };
    events = []; avgStart = 0;
    if (ui.log) ui.log.innerHTML = '';
    dirtyPlots = true;
  }
  clearMeasurements();
  function addRecord(r) {
    if (COL.step == null) { window.WaterAdapter.COLUMNS.forEach(function (c, i) { COL[c] = i; }); }
    var g = function (name) { var v = r[COL[name]]; return v === '' || v == null ? NaN : v; };
    var nmol = topo ? topo.nmol : 1;
    rec.t.push(g('time_ps')); rec.T.push(g('T_K')); rec.Tt.push(g('T_target_K')); rec.P.push(g('P_bar')); rec.Pt.push(g('P_target_bar'));
    rec.rho.push(g('density_kg_m3')); rec.pe.push(g('PE_kJ_mol') / nmol);
    rec.ft.push(Math.hypot(g('Ftether_x_pN'), g('Ftether_y_pN'), g('Ftether_z_pN')));
    rec.fi.push(Math.hypot(g('Fint_x_pN'), g('Fint_y_pN'), g('Fint_z_pN')));
    rec.disp.push(g('disp_nm')); rec.wp.push(g('Wprotocol_kJ_mol')); rec.wd.push(g('Wdelivered_kJ_mol')); rec.ut.push(g('Utether_kJ_mol'));
    rec.vc.push(Math.hypot(g('vcm_x_m_s'), g('vcm_y_m_s'), g('vcm_z_m_s')));
    rec.ens.push(r[COL.state]);
    var MAXP = 30000;
    if (rec.t.length > MAXP) Object.keys(rec).forEach(function (k) { rec[k].shift(); });
    dirtyPlots = true;
  }

  var EVLABEL = { start: 'start', conditions: 'T/P', lj_scale: 's', ensemble: 'NVT', pull_begin: 'pull', release: 'release', drift_removed: 'drift', stiffness: 'k' };
  function addEvent(e) {
    if (e.type === 'anchor') return;                      // handle moves are in the export, not the log
    events.push(e);
    if (e.type === 'start' || e.type === 'conditions' || e.type === 'lj_scale' || e.type === 'release' || e.type === 'pull_begin') avgStart = e.time_ps;
    addLog(describe(e), e.time_ps);
    dirtyPlots = true;
  }
  function describe(e) {
    switch (e.type) {
      case 'start': return 'System built: ' + e.molecules + ' molecules, ' + fmt3(e.T_target_K) + ' K, ' + fmt3(e.P_target_bar) + ' bar (NPT), velocities from the preset';
      case 'conditions': return 'Conditions applied: ' + fmt3(e.T_target_K) + ' K' + (e.P_target_bar != null ? ', ' + fmt3(e.P_target_bar) + ' bar' : '') + ' (' + e.ensemble.toUpperCase() + '); averaging restarted';
      case 'lj_scale': return 'O–O LJ strength s = ' + e.lj_scale.toFixed(2) + ' (' + e.label + '); averaging restarted';
      case 'ensemble': return 'Switched to fixed volume (NVT) for pulling at V = ' + fmt3(e.volume_nm3) + ' nm³';
      case 'select': return 'Molecule ' + e.molecule + ' selected';
      case 'pull_begin': return 'Tether on molecule ' + e.molecule + ', k = ' + fmt3(e.k_N_m) + ' N/m, handle at its centre of mass (driven response)';
      case 'stiffness': return 'Stiffness ' + fmt3(e.previous_k_N_m) + ' → ' + fmt3(e.k_N_m) + ' N/m (work ' + fmt3(e.work_increment_kJ_mol) + ' kJ/mol)';
      case 'release': return 'Released after ' + fmt3(e.duration_ps) + ' ps: protocol work ' + fmt3(e.protocol_work_kJ_mol) + ' kJ/mol, delivered ' + fmt3(e.delivered_work_kJ_mol) + ' kJ/mol, energy change ' + fmt3(e.energy_change_kJ_mol) + ' kJ/mol';
      case 'drift_removed': return 'Centre-of-mass drift removed (' + fmt3(Math.hypot.apply(null, e.vcm_m_s)) + ' m/s; ' + fmt3(e.kinetic_energy_removed_kJ_mol) + ' kJ/mol)';
      default: return e.type;
    }
  }
  function addLog(text, t) {
    if (!ui.log) return;
    var li = document.createElement('li');
    var ts = t != null ? t : (snap ? snap.time_ps : 0);
    li.innerHTML = '<span class="wl-log-t">' + ts.toFixed(2) + ' ps</span> ' + text.replace(/</g, '&lt;');
    ui.log.insertBefore(li, ui.log.firstChild);
    while (ui.log.children.length > 200) ui.log.removeChild(ui.log.lastChild);
  }
  var liveRegion = doc$('.wl-announce');
  function announce(text) { if (liveRegion) { liveRegion.textContent = ''; setTimeout(function () { liveRegion.textContent = text; }, 30); } }

  /* Descriptive running mean of the 10 fs samples since the last change. No relaxation period is discarded and no
     correlation correction is applied, so no interval is shown; the exported analyze_water.py does both. */
  function stats(arr) {
    if (state.pulling) return { n: 0, driven: true };
    var i0 = 0; while (i0 < rec.t.length && rec.t[i0] < avgStart - 1e-9) i0++;
    var s = 0, n = 0, tFirst = null, tLast = null;
    for (var i = i0; i < rec.t.length; i++) if (Number.isFinite(arr[i])) { s += arr[i]; n++; if (tFirst == null) tFirst = rec.t[i]; tLast = rec.t[i]; }
    if (!n) return { n: 0 };
    return { n: n, mean: s / n, span: tLast - tFirst };
  }
  var lastTable = 0;
  function updateTable() {
    if (!ui.table || !snap) return;
    var now = performance.now();
    if (now - lastTable < 1000) return;
    lastTable = now;
    var rows = [
      ['Temperature', 'K', snap.T_target, snap.T, rec.T],
      ['Pressure', 'bar', snap.ensemble === 'npt' ? snap.P_target : null, snap.P_bar, rec.P],
      ['Density', 'kg/m³', null, snap.density, rec.rho],
      ['Potential energy per molecule', 'kJ/mol', null, snap.pe * KJ / topo.nmol, rec.pe],
    ];
    var html = '';
    rows.forEach(function (r) {
      var s = stats(r[4]);
      var meanTxt = s.driven ? 'not averaged while driven' : s.n ? fmt3(s.mean) : '–';
      var note = s.driven || !s.n ? '' : s.n + ' samples over ' + (s.span || 0).toFixed(1) + ' ps';
      html += '<tr><th scope="row">' + r[0] + ' (' + r[1] + ')</th><td>' + (r[2] != null ? fmt3(r[2]) : '–') + '</td><td>' + fmt3(r[3]) +
        '</td><td>' + meanTxt + (note ? '<span class="wl-cell-note">' + note + '</span>' : '') + '</td></tr>';
    });
    ui.table.innerHTML = html;
    ui.avgNote.textContent = state.pulling ? 'Averaging is suspended during the driven response; it restarts at release.' :
      'Means are descriptive: the plain average of the 10 fs samples since t = ' + avgStart.toFixed(2) + ' ps (the last change), including the relaxation that follows it. ' +
      'Successive samples are correlated, so no uncertainty is shown here. For uncertainties, download the experiment and run analyze_water.py, which discards an initial relaxation period and uses block averaging.';
  }

  /* plots: lightweight canvas line charts, Okabe-Ito colours with distinct line styles */
  var PLOTS = [
    { key: 'T', main: true, title: 'Temperature', unit: 'K', series: [{ k: 'T', c: '#0072B2', label: 'measured' }, { k: 'Tt', c: '#D55E00', dash: [6, 4], label: 'target' }] },
    { key: 'P', title: 'Pressure', unit: 'bar', series: [{ k: 'P', c: '#5B92C4', w: 0.8, label: 'instantaneous' }, { k: 'Pm', c: '#0072B2', label: '1 ps running mean' }, { k: 'Pt', c: '#D55E00', dash: [6, 4], label: 'target' }] },
    { key: 'rho', title: 'Density', unit: 'kg/m³', series: [{ k: 'rho', c: '#009E73', label: 'measured' }] },
    { key: 'pe', title: 'Potential energy per molecule', unit: 'kJ/mol', series: [{ k: 'pe', c: '#CC79A7', label: 'water model' }] },
    { key: 'f', main: true, title: 'Forces on the selected molecule', unit: 'pN', series: [{ k: 'ft', c: '#D55E00', label: 'tether |F|' }, { k: 'fi', c: '#0072B2', dash: [5, 3], label: 'interaction |F|' }] },
    { key: 'disp', title: 'Displacement since selection', unit: 'nm', series: [{ k: 'disp', c: '#009E73', label: 'includes thermal motion' }] },
    { key: 'w', title: 'Work and tether energy', unit: 'kJ/mol', series: [{ k: 'wp', c: '#0072B2', label: 'protocol work' }, { k: 'wd', c: '#D55E00', dash: [6, 4], label: 'delivered' }, { k: 'ut', c: '#009E73', dash: [2, 3], label: 'tether energy' }] },
    { key: 'vc', title: 'System drift velocity', unit: 'm/s', series: [{ k: 'vc', c: '#CC79A7', label: '|v_com|' }] },
  ];
  var dirtyPlots = true, lastPlot = 0;
  function buildPlots() {
    if (!ui.plotsMain || !ui.plotsMore) return;
    ui.plotsMain.innerHTML = ''; ui.plotsMore.innerHTML = '';
    PLOTS.forEach(function (p) {
      var fig = document.createElement('figure'); fig.className = 'wl-plot';
      var legend = p.series.map(function (s) { return '<span><i style="border-top:2px ' + (s.dash ? (s.dash[0] <= 2 ? 'dotted' : 'dashed') : 'solid') + ' ' + s.c + '"></i>' + s.label + '</span>'; }).join('');
      fig.innerHTML = '<figcaption><b>' + p.title + '</b> <span class="wl-unit">(' + p.unit + ')</span><span class="wl-plot-legend">' + legend + '</span></figcaption><canvas role="img" aria-label="' + p.title + ' against simulated time"></canvas>';
      (p.main ? ui.plotsMain : ui.plotsMore).appendChild(fig);
      p.canvas = fig.querySelector('canvas');
    });
  }
  buildPlots();
  if (ui.allMeas) ui.allMeas.addEventListener('toggle', function () { dirtyPlots = true; lastPlot = 0; lastTable = 0; });
  function niceTicks(lo, hi, n) {
    if (!(hi > lo)) { hi = lo + 1; lo = lo - 1; }
    var raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    var step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag, out = [];
    for (var v = Math.ceil(lo / step) * step; v <= hi + 1e-9 * step; v += step) out.push(Math.abs(v) < 1e-12 ? 0 : v);
    return out;
  }
  function tickLabel(v) { var a = Math.abs(v); return (a >= 1000 ? String(Math.round(v)) : a < 0.01 && a > 0 ? v.toExponential(0) : String(+v.toPrecision(4))).replace('-', '−'); }
  function runningMean(arr, t, win) {
    var out = new Array(arr.length), s = 0, j = 0, c = 0;
    for (var i = 0; i < arr.length; i++) {
      s += arr[i]; c++;
      while (t[i] - t[j] > win) { s -= arr[j]; c--; j++; }
      out[i] = s / c;
    }
    return out;
  }
  function drawPlots() {
    if (!ui.plotsMain || !rec.t.length) return;
    var data = Object.assign({}, rec, { Pm: runningMean(rec.P, rec.t, 1.0) });
    var t = rec.t, n = t.length, t0 = t[0], t1 = Math.max(t[n - 1], t0 + 0.1);
    var stride = Math.max(1, Math.floor(n / 900));
    PLOTS.forEach(function (p) {
      var cv = p.canvas, r = cv.getBoundingClientRect(), pr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.round(r.width * pr), h = Math.round(r.height * pr);
      if (w < 50 || h < 40) return;
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      var g = cv.getContext('2d');
      g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, w, h);
      var lo = Infinity, hi = -Infinity;
      p.series.forEach(function (s) { var a = data[s.k]; for (var i = 0; i < n; i += stride) if (Number.isFinite(a[i])) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i]; } });
      var any = Number.isFinite(lo);
      if (!any) { lo = 0; hi = 1; }
      if (hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; }
      var pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
      var ml = 46 * pr, mr = 8 * pr, mt = 8 * pr, mb = 22 * pr, pw = w - ml - mr, ph = h - mt - mb;
      var X = function (v) { return ml + (v - t0) / (t1 - t0) * pw; }, Y = function (v) { return mt + (1 - (v - lo) / (hi - lo)) * ph; };
      g.font = (10.5 * pr) + "px 'IBM Plex Sans', system-ui, sans-serif"; g.fillStyle = '#526477'; g.strokeStyle = '#E6ECF0'; g.lineWidth = 1;
      niceTicks(lo, hi, 4).forEach(function (v) { var y = Y(v); g.beginPath(); g.moveTo(ml, y); g.lineTo(ml + pw, y); g.stroke(); g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(tickLabel(v), ml - 4 * pr, y); });
      niceTicks(t0, t1, 5).forEach(function (v) { var x = X(v); g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText(tickLabel(v), x, mt + ph + 4 * pr); });
      g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText('ps', ml + pw, h - 1 * pr);
      g.strokeStyle = '#718096'; g.beginPath(); g.moveTo(ml, mt); g.lineTo(ml, mt + ph); g.lineTo(ml + pw, mt + ph); g.stroke();
      // events
      g.save(); g.setLineDash([3 * pr, 3 * pr]); g.strokeStyle = '#718096'; g.fillStyle = '#526477'; g.textAlign = 'left'; g.textBaseline = 'top';
      var lastX = -1e9, row = 0;
      events.forEach(function (e) {
        if (!EVLABEL[e.type] || e.time_ps < t0) return;
        var x = X(e.time_ps);
        g.beginPath(); g.moveTo(x, mt); g.lineTo(x, mt + ph); g.stroke();
        row = x - lastX < 34 * pr ? row + 1 : 0; lastX = x;
        if (row < 3) g.fillText(EVLABEL[e.type], x + 2 * pr, mt + 1 * pr + row * 12 * pr);
      });
      g.restore();
      if (!any) { g.fillStyle = '#526477'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(p.key === 'f' || p.key === 'disp' ? 'select a molecule' : 'no data yet', ml + pw / 2, mt + ph / 2); return; }
      p.series.forEach(function (s) {
        var a = data[s.k];
        g.save(); g.strokeStyle = s.c; g.lineWidth = (s.w || 1.8) * pr; g.setLineDash((s.dash || []).map(function (d) { return d * pr; })); g.beginPath();
        var pen = false;
        for (var i = 0; i < n; i += stride) {
          if (!Number.isFinite(a[i])) { pen = false; continue; }
          var x = X(t[i]), y = Y(a[i]);
          if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y);
        }
        g.stroke(); g.restore();
      });
    });
  }

  /* ---------------------------------------------------------------- export */
  var exporting = false;
  function dlNote(text) { ui.dlNotes.forEach(function (n) { n.textContent = text; }); }
  ui.downloads.forEach(function (b) { b.addEventListener('click', exportExperiment); });
  function exportExperiment() {
    if (!ready || exporting) return;
    exporting = true;
    ui.downloads.forEach(function (b) { b.disabled = true; });
    dlNote('Preparing the experiment files…');
    var created = new Date();
    send('export', { meta: { runId: runId, created: created.toISOString(), engineVersion: engine && engine.version, page: location.href.split('?')[0] } }).then(function (d) {
      var files = EXP.buildFiles(d, W);
      return fetch('../../tools/analyze_water.py').then(function (r) { return r.ok ? r.text() : null; }).catch(function () { return null; }).then(function (py) {
        if (py) files['analyze_water.py'] = py;
        return ZIP.makeZip(files, created);
      }).then(function (blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'water-lab-run' + runId + '-' + d.meta.steps + 'steps.zip';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        dlNote('Downloaded ' + Object.keys(files).length + ' files (' + (blob.size / 1024).toFixed(0) + ' kB): LAMMPS input, starting and final configurations, measurements, events, model and units.' + (d.recordingFull ? ' The measurement record reached its limit.' : ''));
        if (TEST) window.__lastExport = { files: files, size: blob.size, blob: blob };
      });
    }).catch(function (e) { dlNote('The export failed: ' + e.message); }).then(function () {
      exporting = false;
      ui.downloads.forEach(function (b) { b.disabled = !ready; });
    });
  }

  /* open "Model and validation" when the page is opened at it (links from the main page) */
  function openFromHash() {
    if (/^#(validation|tests|model-validation)$/.test(location.hash)) {
      var d = document.getElementById('model-validation');
      if (d && !d.open) { d.open = true; }
      var t = document.getElementById(location.hash.slice(1));
      if (t) t.scrollIntoView();
    }
  }
  window.addEventListener('hashchange', openFromHash);
  openFromHash();

  /* ---------------------------------------------------------------- frame loop */
  var lastFrame = 0, watchdogShown = false;
  function frame(now) {
    if (pendingFrames && worker) { worker.postMessage({ type: 'frame', runId: runId, n: pendingFrames }); pendingFrames = 0; }
    flushRequest();
    if (dirty) { render(); dirty = false; }
    updateReadouts();
    if (dirtyPlots && now - lastPlot > 500) { drawPlots(); dirtyPlots = false; lastPlot = now; }
    if (running && ready && lastMsgAt && now - lastMsgAt > 15000 && !watchdogShown) {
      watchdogShown = true; setStatus('The simulation engine has not responded for 15 s. Press Reset if it does not recover.', true);
    } else if (watchdogShown && now - lastMsgAt < 1000) { watchdogShown = false; setStatus(''); }
    requestAnimationFrame(frame);
  }
  if (window.ResizeObserver) new ResizeObserver(function () { resize(); dirtyPlots = true; }).observe(canvas); else window.addEventListener('resize', resize);
  resize();
  updateButtons();
  requestAnimationFrame(frame);

  if (TEST) {
    window.__waterLab = {
      get snap() { return snap; }, get ready() { return ready; }, get running() { return running; }, get runId() { return runId; },
      get state() { return state; }, get events() { return events; }, get records() { return rec; },
      send: send, select: selectMolecule, central: centralMolecule, beginPull: beginPull, release: releasePull,
      request: function (pos) { request = pos; requestDirty = true; }, worker: function () { return worker; },
      screenOf: function (mol) {
        var o = topo.molAtoms[3 * (mol - 1)], r = canvas.getBoundingClientRect();
        return { x: r.left + render.sx[o] / dpr, y: r.top + render.sy[o] / dpr };
      },
      frontMolecule: function () {
        var best = 1, bz = -Infinity;
        for (var m = 0; m < topo.nmol; m++) { var o = topo.molAtoms[3 * m]; if (render.sz[o] > bz) { bz = render.sz[o]; best = m + 1; } }
        return best;
      },
      natoms: function () { return topo ? topo.natoms : 0; },
      redraw: function () { dirty = true; },
      staleTest: function () { return new Promise(function (res) { var id = ++cmdSeq; pending[id] = { resolve: res, reject: function (e) { res('rejected: ' + e.message); } }; worker.postMessage({ type: 'select', runId: runId - 1, cmdId: id, molecule: 2 }); }); },
    };
  }
})();
