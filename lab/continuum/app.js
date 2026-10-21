/* Continuum Lab — page controller: scenario state, controls, worker protocol, linked views, baseline comparison,
   "Why did this change?", "Where is the resistance?", the deterministic decision panel, the guided path and the
   download. Every number shown comes from a solution computed by the worker (core/*.js) or from the declared pore law
   that drove that solution (q_i = G_i ΔΠ_c for a displayed tube); this file formats, it does not model. */
(function () {
  'use strict';
  const U = window.ContinuumUnits, SC = window.ContinuumScenario, MM = window.ContinuumMembrane, PL = window.ContinuumPoreLaw, V = window.ContinuumView;
  const app = document.getElementById('continuum-lab');
  if (!app) return;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const fmt3 = U.fmt3, fmtInt = U.fmtInt;
  const VERSION = app.getAttribute('data-version') || '';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pct = (x) => (x == null || !Number.isFinite(x) ? '–' : fmt3(100 * x) + ' %');
  /* a share close to 100 % with enough digits to show the remainder (99.9993 % rather than 100 %) */
  const pctFine = (x) => { if (!(x > 0.999 && x < 1)) return pct(x); const d = Math.min(10, Math.ceil(-Math.log10(1 - x)) + 1); return (100 * x).toFixed(Math.max(1, d - 1)) + ' %'; };
  const MPa = (p) => fmt3(p / 1e6) + ' MPa';

  /* ---------------------------------------------------------------- state */
  const S = {
    manifest: null, law: null, meshTable: null,
    sc: null, revision: 1, started: false, status: 'idle', statusText: 'Not started',
    result: null, lastValid: null, baseline: null, worker: null, events: [], runStart: 0,
    sel: { scope: 'tube', tube: null, patch: null, factor: 0 },
    view: 'flow', tab: 'flow', memMode: 'map', compare: false, meshChecks: {}, refinements: {}, molLoaded: false, guide: { step: -1 },
    staleDiscarded: 0,
    scaleFixed: true, scaleRef: null,                  // colour range and tracer clock fixed to the baseline (same device)
    pores: null, poresState: 'idle', p3preset: 'focus', // 3D pore view (pores3d.js + three.js, loaded when first opened); camera preset
  };
  window.__continuumState = S;                         // read-only hook for the automated browser checks

  /* ---------------------------------------------------------------- elements */
  const el = {
    run: $('.cl-run'), state: $('#cl-state'), dp: $('#cl-dp'), dpOut: $('#cl-dp-out'), dpNote: $('#cl-dp-note'),
    scopeRadios: $$('input[name="cl-scope"]'), scopeDesc: $('#cl-scope-desc'), factor: $('#cl-factor'), apply: $('.cl-apply'),
    block: $('.cl-block'), restore: $('.cl-restore'), restoreAll: $('.cl-restore-all'), mods: $('.cl-mods'),
    W: $('#cl-W'), B: $('#cl-B'), sizeNote: $('#cl-size-note'), settingsNow: $('#cl-settings-now'), mesh: $('#cl-mesh'),
    setBase: $('.cl-set-baseline'), compare: $('.cl-compare'), download: $('.cl-download'), dlNote: $('.cl-dl-note'),
    flowCanvas: $('.cl-flow-canvas'), memCanvas: $('.cl-mem-canvas'), molCanvas: $('.cl-mol-canvas'),
    poster: $('.cl-poster'), posterRun: $('.cl-poster-run'), vstatus: $('.cl-vstatus'), memStatus: $('.cl-mem-vstatus'),
    flowLegend: $('#cl-flow-legend'), memLegend: $('#cl-mem-legend'), memInfo: $('.cl-mem-info'), flowNote: $('.cl-flow-note'),
    tracers: $('#cl-tracers'), slice: $('#cl-slice'), flowReset: $('.cl-flow-reset'),
    showJ: $('.cl-show-j'), showD: $('.cl-show-d'), zoom: $('.cl-zoom'), zoomOut: $('.cl-zoom-out'),
    molPoster: $('.cl-mol-poster'), molShow: $('.cl-mol-show'), molPlay: $('.cl-mol-play'), law: $('.cl-law'), tube: $('.cl-tube-readout'),
    q: $('#cl-q'), qs: $('#cl-q-s'), Q: $('#cl-Q'), Qs: $('#cl-Q-s'), J: $('#cl-J'), Js: $('#cl-J-s'), cons: $('#cl-cons'), conss: $('#cl-cons-s'), strip: $('.cl-strip'),
    stateLine: $('.cl-stateline'), compareBody: $('#cl-compare-body'), why: $('#cl-why'), whyBody: $('#cl-why-body'), resist: $('#cl-resist'), resistBody: $('#cl-resist-body'),
    decision: $('#cl-decision-body'), numerics: $('#cl-numerics-body'), announce: $('.cl-announce'),
    tabs: $('.cl-tabs'), tabBtns: $$('.cl-tabs button'), viewBtns: $$('.cl-viewbar [data-view]'),
    panes: { flow: $('#cl-pane-flow'), membrane: $('#cl-pane-membrane'), pores: $('#cl-pane-pores'), molecule: $('#cl-pane-molecule') }, main: $('.cl-main'), side: $('.cl-side'),
    guideText: $('#cl-guide-text'), guideDo: $('.cl-guide-do'), guideSkip: $('.cl-guide-skip'), guideSteps: $$('.cl-guide-steps li'),
    meshCheckBtn: null, fixScale: $('#cl-fixscale'), qline: $('.cl-qline'), settings: $('.cl-settings'), tubePanel: $('#cl-tube-panel'),
    p3: { host: $('.cl-p3-host'), poster: $('.cl-p3-poster'), msg: $('.cl-p3-msg'), run: $('.cl-p3-run'), legend: $('#cl-p3-legend'), play: $('.cl-p3-play'), reset: $('.cl-p3-reset'),
          focus: $('.cl-p3-focus'), array: $('.cl-p3-array'), how: $('.cl-p3-how') },
  };

  /* ---------------------------------------------------------------- views */
  const flow = new V.FlowView(el.flowCanvas);
  const membrane = new V.MembraneView(el.memCanvas, {
    onPick: (hit) => {
      if (hit.tube) selectTube(hit.tube.ti, hit.tube.tj, true);
      else if (hit.patch) { selectPatch(hit.patch.pi, hit.patch.pj); if (hit.xy) selectTubeAt(hit.xy[0], hit.xy[1], false); }
    },
    onZoom: (p) => { selectPatch(p.pi, p.pj); setMemMode('zoom'); },
    onKey: memKey,
  });
  const molecule = new V.MoleculeView(el.molCanvas);

  /* ---------------------------------------------------------------- layout: desktop view switch, phone tabs */
  const narrow = window.matchMedia('(max-width: 899px)');
  function applyLayout() {
    const n = narrow.matches;
    el.tabs.hidden = !n;
    if (n) {
      el.tabs.setAttribute('role', 'tablist'); el.tabs.setAttribute('aria-label', 'Views');
      el.tabBtns.forEach((b) => { const t = b.getAttribute('data-tab'); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', t === S.tab ? 'true' : 'false'); b.tabIndex = t === S.tab ? 0 : -1; b.setAttribute('aria-controls', 'cl-pane-' + t); });
      Object.keys(el.panes).forEach((k) => { const p = el.panes[k]; p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', 'cl-tab-' + k); p.removeAttribute('aria-label'); p.hidden = k !== S.tab; });
      el.main.hidden = S.tab === 'molecule'; el.side.hidden = false;           // the side column also holds the controls
    } else {
      el.tabs.removeAttribute('role'); el.tabs.removeAttribute('aria-label');
      el.tabBtns.forEach((b) => { b.removeAttribute('role'); b.removeAttribute('aria-selected'); b.removeAttribute('aria-controls'); b.tabIndex = 0; });
      const names = { flow: 'Device flow', membrane: 'Membrane map', pores: 'Pores in 3D', molecule: 'Molecule' };
      Object.keys(el.panes).forEach((k) => { el.panes[k].setAttribute('role', 'region'); el.panes[k].setAttribute('aria-label', names[k]); el.panes[k].removeAttribute('aria-labelledby'); });
      el.panes.flow.hidden = S.view !== 'flow'; el.panes.membrane.hidden = S.view !== 'membrane'; el.panes.pores.hidden = S.view !== 'pores'; el.panes.molecule.hidden = false;
      el.main.hidden = false; el.side.hidden = false;
    }
    el.viewBtns.forEach((b) => b.setAttribute('aria-pressed', b.getAttribute('data-view') === S.view ? 'true' : 'false'));
    flow.setVisible(!el.panes.flow.hidden && !el.main.hidden);
    if (!el.panes.membrane.hidden) membrane.render();
    if (!el.panes.molecule.hidden && !el.side.hidden) molecule.draw();
    const pv = !el.panes.pores.hidden && !el.main.hidden;
    if (pv) ensurePores();
    if (S.pores) S.pores.setVisible(pv);
  }
  function setView(v, animate) {
    if (v === S.view && (!narrow.matches || S.tab === v)) return Promise.resolve();
    const go = () => { S.view = v; if (narrow.matches) S.tab = v; applyLayout(); };
    if (animate && v === 'membrane' && S.view === 'flow' && !el.panes.flow.hidden && S.result) return flow.flyToMembrane().then(go);
    go(); return Promise.resolve();
  }
  function setTab(t) { S.tab = t; if (t !== 'molecule') S.view = t; applyLayout(); if (t === 'molecule') ensureMolecule(); }
  el.viewBtns.forEach((b) => b.addEventListener('click', () => setView(b.getAttribute('data-view'), true)));
  el.tabBtns.forEach((b, i) => {
    b.addEventListener('click', () => setTab(b.getAttribute('data-tab')));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      const n = el.tabBtns.length, j = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n;
      el.tabBtns[j].focus(); setTab(el.tabBtns[j].getAttribute('data-tab'));
    });
  });
  if (narrow.addEventListener) narrow.addEventListener('change', applyLayout); else narrow.addListener(applyLayout);

  /* ---------------------------------------------------------------- scenario helpers */
  function device(sc) { return SC.deriveDevice(sc || S.sc); }
  function poreCounts(sc) { return MM.countPores({ W_m: sc.W_m, B_m: sc.B_m, pitch_m: sc.pitch_m }, { nx: 1, ny: 1 }); }
  function tubeXY(t, sc) { return [(t.ti + 0.5) * (sc || S.sc).pitch_m, (t.tj + 0.5) * (sc || S.sc).pitch_m]; }
  function patchOfTube(t, sc) {
    sc = sc || S.sc; const dev = device(sc), f = MM.faceOfTube({ W_m: sc.W_m, B_m: sc.B_m, pitch_m: sc.pitch_m }, { nx: dev.nx, ny: dev.ny }, t.ti, t.tj);
    return { fi: f.fi, fj: f.fj, face: f.fj * dev.nx + f.fi, pi: Math.floor(f.fi / dev.patchCells), pj: Math.floor(f.fj / dev.patchCells) };
  }
  function tubeFactorNow(t) {
    const m = S.sc.mods, p = patchOfTube(t), pf = m.patchFactors[p.pi + ',' + p.pj], tf = m.tubeFactors[t.ti + ',' + t.tj];
    return { total: m.membraneFactor * (pf == null ? 1 : pf) * (tf == null ? 1 : tf), own: tf == null ? 1 : tf, patch: pf == null ? 1 : pf, membrane: m.membraneFactor };
  }
  function defaultSelection() {
    const pc = poreCounts(S.sc), dev = device();
    S.sel.tube = { ti: Math.floor(pc.Nx / 2), tj: Math.floor(pc.Ny / 2) };
    S.sel.patch = { pi: Math.floor(dev.patches.px / 2), pj: Math.floor(dev.patches.py / 2) };
  }
  function selectionForViews() { return { tube: S.sel.tube, patch: S.sel.patch, tubeXY: S.sel.tube ? tubeXY(S.sel.tube) : null }; }

  /* ---------------------------------------------------------------- events and revisions */
  function logEvent(type, detail) { S.events.push({ revision: S.revision, time_utc: new Date().toISOString(), type, detail: detail || {} }); }
  let solveTimer = 0;
  function changed(type, detail, opts) {
    S.revision += 1;
    logEvent(type, detail);
    if (S.result) markStale();
    refreshControls();
    if (S.started) { clearTimeout(solveTimer); solveTimer = setTimeout(requestSolve, opts && opts.debounce ? 140 : 0); }
    else drawGeometry();
  }
  function markStale() {
    setStatus('stale', 'Input changed — recomputing (values shown are from revision ' + S.result.revision + ')');
    app.classList.add('is-stale');
  }

  /* ---------------------------------------------------------------- worker */
  function startWorker() {
    if (S.worker) return;
    setStatus('loading', 'Loading the solver…');
    S.worker = new Worker('worker.js');
    S.worker.onmessage = onWorker;
    S.worker.onerror = (e) => setStatus('failed', 'The solver could not start: ' + (e.message || 'worker error'));
    S.worker.postMessage({ type: 'init', manifest: S.manifest });
  }
  /* every request carries the revision and the complete configuration key (configuration hash, law, geometry hash,
     solver version once the worker has reported it); a result is accepted only if both revision and key match */
  function requestKey(sc) { return { configId: SC.configHash(sc), lawId: sc.lawId, geometryHash: SC.geometryHash(sc), solverVersion: S.solverVersion || null }; }
  function requestSolve() {
    if (!S.worker) return;
    const v = SC.validateScenario(S.sc, S.manifest, S.law);
    if (!v.ok) { setUnsupported(v.reasons, 'inputs'); return; }
    S.runStart = performance.now();
    setStatus('solving', 'Solving revision ' + S.revision + '…');
    const sc = JSON.parse(JSON.stringify(S.sc));
    S.pendingKey = requestKey(sc);
    S.worker.postMessage(Object.assign({ type: 'solve', revision: S.revision, scenario: sc, purpose: 'run' }, S.pendingKey));
  }
  function onWorker(e) {
    const m = e.data;
    if (m.type === 'ready') { S.solverVersion = m.solverVersion; return; }
    if (m.revision !== S.revision) { if (m.type === 'result') S.staleDiscarded += 1; return; }   // stale: belongs to an older input state
    if (m.type === 'result' && m.purpose !== 'meshCheck' && S.pendingKey && m.configId !== S.pendingKey.configId) { S.staleDiscarded += 1; return; }
    if (m.type === 'progress') { setStatus('solving', 'Solving revision ' + m.revision + ' · iteration ' + m.iterations + ' · residual estimate ' + fmt3(m.estimate)); return; }
    if (m.type === 'state') {
      if (m.state === 'unsupported') setUnsupported(m.reasons || [], 'inputs');
      else if (m.state === 'failed') setStatus('failed', 'Solver failed: ' + (m.message || 'unknown error') + '. The last valid result is kept.');
      else if (m.state === 'cancelled') setStatus('cancelled', 'Cancelled');
      return;
    }
    if (m.type === 'refinement') { onRefinement(m); return; }
    if (m.type === 'result' && m.purpose === 'meshCheck') { onMeshCheck(m); return; }
    if (m.type === 'result') onResult(m);
  }

  /* ---------------------------------------------------------------- results */
  function onResult(r) {
    r.receivedMs = performance.now() - S.runStart;
    const d = r.diag;
    const out = d.scopeReasons.length > 0 || !d.lawSupported;
    if (!d.converged) { setStatus('failed', 'The solve did not converge (residual ' + fmt3(r.solver.relResidual) + '). The last valid result is kept.'); return; }
    if (out) { S.outOfScope = r; setUnsupported(d.scopeReasons.length ? d.scopeReasons : ['local driving potential outside the pore-law interval'], 'solution'); return; }
    S.outOfScope = null;
    S.result = r; S.lastValid = r;
    app.classList.remove('is-stale');
    if (!S.baseline) setBaseline(r, true);
    setStatus('converged', 'Numerically converged');
    render();
    announce('Result for revision ' + r.revision + ': total flow ' + fmt3(d.Q_m3_s) + ' cubic metres per second.');
    if (S.guide.after) { const f = S.guide.after; S.guide.after = null; f(); }
    if (S.guide.step >= 0) guideRender();
  }
  function setUnsupported(reasons, where) {
    S.unsupported = { reasons, where, revision: S.revision };
    setStatus('unsupported', 'Unsupported: ' + reasons.join('; ') + (S.lastValid ? '. Showing the last valid result (revision ' + S.lastValid.revision + ').' : '.'));
    renderDecision();
  }
  function setStatus(st, text) {
    S.status = st; S.statusText = text;
    const label = { idle: 'Not started', loading: 'Loading the solver', solving: 'Solving', converged: 'Numerically converged', stale: 'Recomputing', cancelled: 'Cancelled', unsupported: 'Unsupported', failed: 'Failed' }[st] || st;
    el.state.textContent = label; el.state.className = 'cl-state is-' + st;
    el.vstatus.textContent = text; el.vstatus.hidden = st === 'converged' || st === 'idle';
    el.vstatus.classList.toggle('is-error', st === 'unsupported' || st === 'failed');
    if (el.memStatus) { el.memStatus.textContent = el.vstatus.textContent; el.memStatus.hidden = el.vstatus.hidden; el.memStatus.classList.toggle('is-error', st === 'unsupported' || st === 'failed'); }
    if (st !== 'unsupported') S.unsupported = null;
    if (el.guideDo) el.guideDo.disabled = (st === 'solving' || st === 'stale' || st === 'loading') && S.guide.step >= 0 && S.guide.step < GUIDE.length;
    renderStateLine();
  }
  function announce(t) { if (el.announce) el.announce.textContent = t; }

  function snapshot(r) {
    return { revision: r.revision, scenario: JSON.parse(JSON.stringify(r.scenario)), Q: r.diag.Q_m3_s, diag: Object.assign({}, r.diag),
      J: Float64Array.from(r.membrane.J), closed: Uint8Array.from(r.membrane.closed), dPi: Float64Array.from(r.membrane.dPi),
      chambers: r.chambers.map((c) => ({ u: Float64Array.from(c.u), v: Float64Array.from(c.v), w: Float64Array.from(c.w) })), configId: r.configId, time: new Date().toISOString() };
  }
  function setBaseline(r, auto) {
    S.baseline = snapshot(r);
    if (S.worker) S.worker.postMessage({ type: 'setBaseline', revision: r.revision });
    if (!auto) { logEvent('baseline', { revision: r.revision }); }
    else logEvent('baseline', { revision: r.revision, automatic: true });
  }

  /* comparison of the current result with the fixed baseline snapshot */
  function comparison() {
    const r = S.result, b = S.baseline;
    if (!r || !b) return null;
    const keys = ['W_m', 'B_m', 'meshLevel', 'dP_Pa', 'lawId', 'geometryId', 'pitch_m', 'tubeLength_m'];
    const sameDev = keys.every((k) => JSON.stringify(r.scenario[k]) === JSON.stringify(b.scenario[k]));
    const sameGrid = ['W_m', 'B_m', 'meshLevel'].every((k) => r.scenario[k] === b.scenario[k]);
    const exact = !!(r.change && r.change.refRevision === b.revision);
    const n = r.membrane.J.length;
    let dQ = exact ? r.change.dQ_m3_s : r.diag.Q_m3_s - b.Q, dJ = null, openBoth = null, velChange = null, maxOpen = 0, jRef = 0;
    if (sameGrid) {
      openBoth = new Uint8Array(n); dJ = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        openBoth[k] = !r.membrane.closed[k] && !b.closed[k] ? 1 : 0;
        dJ[k] = exact ? r.change.dJ_m_s[k] : r.membrane.J[k] - b.J[k];
        if (openBoth[k]) { maxOpen = Math.max(maxOpen, Math.abs(dJ[k])); jRef = Math.max(jRef, Math.abs(b.J[k])); }
      }
      let d2 = 0, n2 = 0;
      for (let c = 0; c < 2; c++) ['u', 'v', 'w'].forEach((comp) => { const a = b.chambers[c][comp], x = r.chambers[c][comp]; for (let q = 0; q < a.length; q++) { d2 += (x[q] - a[q]) * (x[q] - a[q]); n2 += a[q] * a[q]; } });
      velChange = n2 > 0 ? Math.sqrt(d2 / n2) : 0;
    }
    let affected = exact ? r.change.affectedPores : NaN;
    if (!exact && sameGrid) {
      const dev = device(r.scenario), g = { W_m: r.scenario.W_m, B_m: r.scenario.B_m, pitch_m: r.scenario.pitch_m };
      const ma = MM.buildMembraneMap(g, { nx: dev.nx, ny: dev.ny }, 1, b.scenario.mods, dev.patches), mb = MM.buildMembraneMap(g, { nx: dev.nx, ny: dev.ny }, 1, r.scenario.mods, dev.patches);
      affected = MM.affectedPoreCount(ma, mb);
    }
    return { sameDev, sameGrid, exact, dQ, rel: dQ / b.Q, dJ, openBoth, maxOpen, jRef, velChange, affected, b, r };
  }

  /* ---------------------------------------------------------------- colour and tracer scale */
  /* Fixed to the baseline when the visitor keeps "fixed" and the result belongs to the same device (size and law), so a
     change of pressure or conductance changes colours and tracer speeds in proportion to the computed field; otherwise
     automatic for each result. The reference is taken when the baseline result is rendered. */
  function scaleRefFor(r) {
    if (!S.scaleFixed || !S.scaleRef) return null;
    const a = S.scaleRef.scenario, b = r.scenario;
    return a.W_m === b.W_m && a.B_m === b.B_m && a.lawId === b.lawId ? S.scaleRef : null;
  }
  function refSinglePoreMax(r) {                       // largest single-pore flow of the baseline (upper bound over its factors)
    const m = r.scenario.mods, pf = Object.values(m.patchFactors), tf = Object.values(m.tubeFactors);
    const f = m.membraneFactor * Math.max(1, ...pf) * Math.max(1, ...tf);
    return r.membrane.G0 * Math.max(0, r.diag.dPiMax_Pa || 0) * f;
  }
  /* legend sentence for the colour range: set by this result (the baseline), fixed to the baseline, or automatic.
     A saturation note appears when the current maximum exceeds the fixed range by more than 0.5 %. */
  function scaleNote(ref, nowMax, unit, tracers) {
    const what = 'Colour range' + (tracers ? ' and tracer clock' : '');
    const r = S.result, isBase = !!(r && S.baseline && S.baseline.revision === r.revision);
    if (ref) {
      const top = ref.vmax || ref.jmax || ref.qmax;
      return what + ' fixed to the baseline (revision ' + ref.revision + ')' + (nowMax > top * 1.005 ? '; values above ' + fmt3(top) + ' ' + unit + ' are shown in the top colour (now up to ' + fmt3(nowMax) + ' ' + unit + ')' : '') + '.';
    }
    if (isBase && S.scaleFixed) return what + ' set by this result, the baseline; later results of the same device keep it.';
    return S.scaleFixed && S.scaleRef ? 'Automatic range: this device differs from the baseline’s.' : 'Automatic range for this result (fixed scale switched off).';
  }

  /* ---------------------------------------------------------------- rendering of a result */
  function render() {
    const r = S.result; if (!r) return;
    el.poster.hidden = true;
    const isBase = !!(S.baseline && S.baseline.revision === r.revision);
    const ref = isBase ? null : scaleRefFor(r);
    const scale = flow.setResult(r, ref);
    flow.setSelection(selectionForViews());
    const mult = flow.multiplier, tr = V.reduceMotion ? 'off (reduced motion)' : !(mult > 0) ? 'none' : mult < 1 ? 'slow motion, 1/' + fmt3(1 / mult) + ' of the computed speed' : fmt3(mult) + ' × the computed speed';
    const cmp = comparison();
    membrane.setResult(r, cmp && cmp.dJ ? { dJ: cmp.dJ, openBoth: cmp.openBoth } : null, ref);
    if (isBase) S.scaleRef = { revision: r.revision, scenario: r.scenario, vmax: flow.vmaxNow, multiplier: flow.multiplierAuto, jmax: membrane.jmaxNow, qmax: refSinglePoreMax(r) };
    V.legend(el.flowLegend, scale, 'Speed |u| in the chambers; on the membrane, the flux J', 'm/s, logarithmic', 'Section through the ports (y = B/2). ' + scaleNote(flow.ref, flow.vmaxNow, 'm/s', true) + ' Tracers: ' + tr + '; their density is not a concentration.');
    // read-only record of what the views draw (used by the automated browser checks)
    S.display = { flowScaleMax: scale.max, flowFixed: !!flow.ref, flowMaxNow: flow.vmaxNow, tracerFactor: flow.multiplier, tracerFactorAuto: flow.multiplierAuto,
      jScaleMax: membrane.scales().J.max, jFixed: !!membrane.scales().J.fixed, jMaxNow: membrane.jmaxNow, refRevision: S.scaleRef ? S.scaleRef.revision : null };
    membrane.setSelection(selectionForViews());
    renderMemLegend(cmp);
    renderStrip(cmp); renderTube(); renderCompare(cmp); renderWhy(cmp); renderResistance(); renderDecision(); renderNumerics(); renderNumbers(cmp); refreshControls();
    updatePores();
    el.download.disabled = false;
  }
  function renderMemLegend(cmp) {
    const sc = membrane.scales(); if (!sc) return;
    if (S.memMode === 'zoom' && membrane.qScale && membrane.qScale.empty) {
      el.memLegend.innerHTML = '<p class="cl-legend-title">Single-pore flow q in this window: 0 m³/s</p><p class="cl-legend-note">Every tube drawn here is blocked (open circles with a cross), so no colour scale applies. Tube symbols are enlarged (to scale: 0.814 nm on a 10 nm pitch).</p>';
    } else if (S.memMode === 'zoom' && membrane.qScale) {
      V.legend(el.memLegend, membrane.qScale, 'Single-pore flow q in this window', 'm³/s', scaleNote(membrane.qScale.fixed ? { revision: membrane.ref.revision, qmax: membrane.ref.qmax } : null, membrane.qmaxNow, 'm³/s', false) + ' ' + 'Open circles with a cross: blocked tubes; white rim: modified conductance. Tube symbols are enlarged (to scale: 0.814 nm on a 10 nm pitch).');
    } else if (membrane.show === 'dJ' && sc.dJ) {
      V.legend(el.memLegend, sc.dJ, 'Change of flux ΔJ against the baseline', 'm/s', 'Colour range set by the largest change on faces open in both states' + (cmp && cmp.jRef ? ' (' + fmt3(sc.dJ.max / cmp.jRef) + ' of the baseline J)' : '') + '. Hatched: closed in either state.');
    } else {
      V.legend(el.memLegend, sc.J, 'Flux J through each membrane face', 'm/s', 'Scale from zero, so a uniform flux looks uniform. ' + scaleNote(sc.J.fixed ? { revision: membrane.ref.revision, jmax: membrane.ref.jmax } : null, membrane.jmaxNow, 'm/s', false) + ' Hatched: closed faces. Dashed square: inlet port above.');
    }
    renderMemInfo();
  }
  function renderMemInfo() {
    const r = S.result; if (!r) return;
    const m = r.membrane, dev = r.device, p = S.sel.patch;
    let txt = '';
    if (p) {
      let pores = 0, Qp = 0, closed = 0, nf = 0;
      for (let j = p.pj * dev.patchCells; j < (p.pj + 1) * dev.patchCells; j++) for (let i = p.pi * dev.patchCells; i < (p.pi + 1) * dev.patchCells; i++) {
        const k = j * dev.nx + i; pores += m.counts[k]; Qp += m.J[k] * m.areaFace; nf++; if (m.closed[k]) closed++;
      }
      const pf = r.scenario.mods.patchFactors[p.pi + ',' + p.pj];
      txt = 'Selected patch (' + p.pi + ', ' + p.pj + '): ' + fmtInt(pores) + ' pores, ' + nf + ' continuum faces' + (closed ? ' (' + closed + ' closed)' : '') +
        '; flow through it ' + fmt3(Qp) + ' m³/s (' + pct(Qp / r.diag.Q_m3_s) + ' of Q); conductance factor ' + (pf == null ? '1' : fmt3(pf)) + '.';
    }
    if (S.memMode === 'zoom' && membrane.zoomWin) {
      const w = membrane.zoomWin;
      txt += w.full ? ' All ' + fmtInt(w.patchTubes) + ' tubes of the patch are drawn.' : ' Representative rendering: a ' + w.nx + ' × ' + w.ny + ' window of real lattice positions out of ' + fmtInt(w.patchTubes) + ' tubes in this patch; physical pore counts are used in the calculation.';
    }
    el.memInfo.textContent = txt;
  }
  function renderStrip(cmp) {
    const r = S.result, d = r.diag, t = S.sel.tube;
    const tq = tubeFlow(t);
    el.q.textContent = tq ? fmt3(tq.q) + ' m³/s' : '–';
    el.qs.textContent = tq ? (tq.q === 0 ? 'blocked · tube (' + t.ti + ', ' + t.tj + ')' : '≈ ' + fmt3(U.conv.moleculesPerNs.fromSI(tq.q)) + ' molecules/ns · tube (' + t.ti + ', ' + t.tj + ')') : '';
    el.Q.textContent = fmt3(d.Q_m3_s) + ' m³/s';
    el.Qs.textContent = cmp && (cmp.dQ !== 0 || !cmp.sameDev) ? 'vs baseline: ' + (cmp.dQ >= 0 ? '+' : '') + fmt3(cmp.dQ) + ' m³/s (' + (cmp.rel >= 0 ? '+' : '') + pct(cmp.rel) + ')' : '≈ ' + fmt3(d.Q_m3_s * U.C.rhoRef / U.C.mWater) + ' water molecules/s';
    if (el.qline) el.qline.innerHTML = 'Total flow Q = <b>' + fmt3(d.Q_m3_s) + ' m³/s</b>' + (cmp && cmp.sameDev && cmp.dQ === 0 && !scenarioDiffs(cmp.b.scenario, r.scenario).length ? ' · this is the baseline' : cmp ? ' · ' + (cmp.rel >= 0 ? '+' : '') + pct(cmp.rel) + ' vs the baseline' : '');
    el.J.textContent = fmt3(d.Jmean_m_s) + ' m/s';
    el.Js.textContent = '= ' + fmt3(U.conv.LMH.fromSI(d.Jmean_m_s)) + ' L m⁻² h⁻¹ · over A = ' + fmt3(d.area_m2 * 1e12) + ' µm²';
    const ok = d.imbalance <= 1e-6 && Math.abs(d.energyClosure) <= 1e-8 && r.solver.relResidual <= 1e-9;
    el.cons.innerHTML = '<span class="cl-pass ' + (ok ? 'is-pass' : 'is-fail') + '">' + (ok ? 'PASS' : 'FAIL') + '</span> ' + fmt3(d.imbalance);
    el.conss.textContent = '|Q_in − Q_out|/Q; energy closure ' + fmt3(Math.abs(d.energyClosure)) + '; residual ' + fmt3(r.solver.relResidual);
  }
  function renderStateLine() {
    const r = S.result, dev = device();
    let s = 'State: ' + el.state.textContent;
    if (r) s += ' · revision ' + r.revision + ' · 3D mesh ' + r.device.nx + ' × ' + r.device.ny + ' × ' + r.device.nz + ' cells per chamber (' + fmtInt(r.solver.unknowns) + ' unknowns) · ' + r.solver.iterations + ' iterations, ' + fmt3(r.receivedMs / 1000) + ' s' + (r.mode === 'change' ? ' · computed as a change of revision ' + r.change.refRevision : '');
    else s += ' · 3D mesh ' + dev.nx + ' × ' + dev.ny + ' × ' + dev.nz + ' cells per chamber';
    el.stateLine.textContent = s;
  }

  /* the selected tube: q_i = G_i ΔΠ_c with ΔΠ_c of its face from the current solution */
  function tubeFlow(t) {
    const r = S.result; if (!r || !t) return null;
    if (t.ti >= r.membrane.Nx || t.tj >= r.membrane.Ny) return null;   // selection already belongs to a new device
    const p = patchOfTube(t, r.scenario), f = tubeFactorNowFor(t, r.scenario);
    const closed = r.membrane.closed[p.face], dPi = r.membrane.dPi[p.face], G = r.membrane.G0 * f.total;
    return { q: closed ? 0 : G * dPi, G, dPi, f, p, closed };
  }
  function tubeFactorNowFor(t, sc) {
    const m = sc.mods, p = patchOfTube(t, sc), pf = m.patchFactors[p.pi + ',' + p.pj], tf = m.tubeFactors[t.ti + ',' + t.tj];
    return { total: m.membraneFactor * (pf == null ? 1 : pf) * (tf == null ? 1 : tf), own: tf == null ? 1 : tf, patch: pf == null ? 1 : pf, membrane: m.membraneFactor };
  }
  function renderTube() {
    const t = S.sel.tube, law = S.law, G0 = law.G_m3_Pa_s;
    const r = S.result, tq = tubeFlow(t);
    let dPiRange = null;
    if (r) {
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < r.membrane.J.length; k++) if (!r.membrane.closed[k]) { lo = Math.min(lo, r.membrane.dPi[k]); hi = Math.max(hi, r.membrane.dPi[k]); }
      if (lo <= hi) dPiRange = [lo, hi];
    }
    const f = t ? tubeFactorNow(t) : { total: 1 };
    V.lawChart(el.law, { G: G0, dPiMax: law.domain.dPiMax_Pa, factor: f.total, dPiRange, point: tq ? { dPi: tq.dPi, q: tq.q } : null, toMolNs: (q) => U.conv.moleculesPerNs.fromSI(q),
      aria: 'Pore-flow relation of the illustrative law: q = G ΔΠ with G = ' + fmt3(G0) + ' cubic metres per pascal second' + (tq ? '; selected tube at ' + fmt3(tq.dPi / 1e6) + ' MPa, q = ' + fmt3(tq.q) + ' cubic metres per second' : '') });
    const rows = [];
    if (t) {
      const p = patchOfTube(t);
      rows.push(['Selected tube', '(' + t.ti + ', ' + t.tj + ') in face (' + p.fi + ', ' + p.fj + '), patch (' + p.pi + ', ' + p.pj + ')']);
      rows.push(['Conductance G_i', fmt3(G0 * f.total) + ' m³ Pa⁻¹ s⁻¹' + (f.total !== 1 ? ' (× ' + fmt3(f.total) + ')' : '')]);
      if (tq) {
        rows.push(['Local ΔΠ_c (from the CFD)', tq.closed ? 'face closed' : MPa(tq.dPi)]);
        rows.push(['Single-pore flow q_i = G_i ΔΠ_c', fmt3(tq.q) + ' m³/s ≈ ' + fmt3(U.conv.moleculesPerNs.fromSI(tq.q)) + ' molecules/ns']);
      } else rows.push(['Local ΔΠ_c', 'run the experiment']);
    }
    el.tube.innerHTML = rows.map((x) => '<div><dt>' + x[0] + '</dt><dd>' + x[1] + '</dd></div>').join('');
  }
  function renderCompare(cmp) {
    if (!cmp) { el.compareBody.innerHTML = '<p class="cl-small">The first converged result becomes the baseline. Change the membrane, the pressure or the size, then compare.</p>'; return; }
    const b = cmp.b, r = cmp.r, bd = b.diag, rd = r.diag;
    const diffs = scenarioDiffs(b.scenario, r.scenario);
    const row = (k, a, c, d) => '<tr><th scope="row">' + k + '</th><td>' + a + '</td><td>' + c + '</td><td>' + d + '</td></tr>';
    let h = '<p class="cl-small">Baseline: revision ' + b.revision + (diffs.length ? '. Differences: ' + diffs.map(esc).join('; ') + '.' : ' (identical inputs).') + '</p>';
    h += '<div class="cl-table-wrap"><table class="cl-table"><thead><tr><th scope="col">Quantity</th><th scope="col">Baseline</th><th scope="col">Now</th><th scope="col">Change</th></tr></thead><tbody>';
    h += row('Total flow Q (m³/s)', fmt3(b.Q), fmt3(rd.Q_m3_s), (cmp.dQ >= 0 ? '+' : '') + fmt3(cmp.dQ) + ' (' + (cmp.rel >= 0 ? '+' : '') + pct(cmp.rel) + ')');
    h += row('Flux per area Q/A (m/s)', fmt3(bd.Jmean_m_s), fmt3(rd.Jmean_m_s), pct(rd.Jmean_m_s / bd.Jmean_m_s - 1));
    h += row('Active membrane footprint (µm²)', fmt3(bd.openArea_m2 * 1e12), fmt3(rd.openArea_m2 * 1e12), pct(rd.openArea_m2 / bd.openArea_m2 - 1));   // membrane area of open faces, not the summed tube openings
    h += row('Pores, open-equivalent', fmtInt(bd.poresOpenEquivalent), fmtInt(rd.poresOpenEquivalent), pct(rd.poresOpenEquivalent / bd.poresOpenEquivalent - 1));
    h += row('Affected physical pores', '–', '–', Number.isFinite(cmp.affected) ? fmtInt(cmp.affected) : 'different devices');
    if (cmp.sameGrid) h += row('Largest |ΔJ| on faces open in both (m/s)', '–', '–', fmt3(cmp.maxOpen) + (cmp.jRef ? ' (' + fmt3(cmp.maxOpen / cmp.jRef) + ' of J)' : ''));
    if (cmp.sameGrid) h += row('Chamber velocity change (relative L2)', '–', '–', fmt3(cmp.velChange));
    h += '</tbody></table></div>';
    h += '<p class="cl-small">' + (cmp.exact ? 'Changes computed directly by the change solve against the baseline (exact to the solver tolerance, including one-tube changes).' : 'Changes computed as differences of two solutions' + (cmp.sameDev ? '' : ' of different devices or drives') + '; a one-tube change in a very large membrane is below this precision.') + '</p>';
    el.compareBody.innerHTML = h;
  }
  function scenarioDiffs(a, b) {
    const out = [];
    if (a.dP_Pa !== b.dP_Pa) out.push('ΔP ' + MPa(a.dP_Pa) + ' → ' + MPa(b.dP_Pa));
    if (a.W_m !== b.W_m || a.B_m !== b.B_m) out.push('size ' + V.lengthLabel(a.W_m) + ' × ' + V.lengthLabel(a.B_m) + ' → ' + V.lengthLabel(b.W_m) + ' × ' + V.lengthLabel(b.B_m));
    if (a.meshLevel !== b.meshLevel) out.push('mesh ' + a.meshLevel + ' → ' + b.meshLevel);
    const ma = a.mods, mb = b.mods;
    if (ma.membraneFactor !== mb.membraneFactor) out.push('whole membrane ' + changeWord(ma.membraneFactor, mb.membraneFactor));
    new Set(Object.keys(ma.patchFactors).concat(Object.keys(mb.patchFactors))).forEach((k) => { const x = ma.patchFactors[k], y = mb.patchFactors[k]; if (x !== y) out.push('patch (' + k.replace(',', ', ') + ') ' + changeWord(x, y)); });
    new Set(Object.keys(ma.tubeFactors).concat(Object.keys(mb.tubeFactors))).forEach((k) => { const x = ma.tubeFactors[k], y = mb.tubeFactors[k]; if (x !== y) out.push('tube (' + k.replace(',', ', ') + ') ' + changeWord(x, y)); });
    return out;
  }
  function factorWord(f) { return f == null || f === 1 ? 'as declared' : f === 0 ? 'blocked' : '× ' + fmt3(f); }
  function changeWord(x, y) {
    const d = (f) => f == null || f === 1;
    if (d(x)) return factorWord(y);
    if (d(y)) return 'restored (was ' + factorWord(x) + ')';
    return factorWord(x) + ' → ' + factorWord(y);
  }

  function renderWhy(cmp) {
    if (!cmp) { el.whyBody.innerHTML = '<p>Run the experiment, make a change, and this panel explains the response from the computed numbers.</p>'; return; }
    const b = cmp.b, r = cmp.r, rd = r.diag, bd = b.diag, diffs = scenarioDiffs(b.scenario, r.scenario);
    if (!diffs.length) { el.whyBody.innerHTML = '<p>The current inputs equal the baseline, so nothing changed (ΔQ = ' + fmt3(cmp.dQ) + ' m³/s).</p>'; return; }
    const onlyMembrane = cmp.sameDev;
    const p = [];
    p.push('<p><b>What changed:</b> ' + diffs.map(esc).join('; ') + '.</p>');
    if (onlyMembrane) {
      const total = rd.poresTotal;
      const tubesOnly = b.scenario.mods.membraneFactor === r.scenario.mods.membraneFactor && JSON.stringify(b.scenario.mods.patchFactors) === JSON.stringify(r.scenario.mods.patchFactors);
      p.push('<p><b>Population:</b> ' + fmtInt(cmp.affected) + ' of ' + fmtInt(total) + ' physical pores (' + pct(cmp.affected / total) + ') carry a different conductance.' + (tubesOnly ? ' Each selected-tube change alters exactly one term of its face’s sum S_c = Σ G_i; the other ' + fmtInt(total - cmp.affected) + ' pores keep their conductance.' : '') + '</p>');
      p.push('<p><b>Total flow:</b> Q went from ' + fmt3(b.Q) + ' to ' + fmt3(rd.Q_m3_s) + ' m³/s (ΔQ = ' + fmt3(cmp.dQ) + ' m³/s, ' + pct(cmp.rel) + ').</p>');
      if (cmp.exact && r.change) {
        const ch = r.change;
        p.push('<p><b>Three ways to see the same number.</b> (1) Network reference with the baseline’s local driving potentials held fixed (no chamber feedback): Σ ΔS_c ΔΠ_c = ' + fmt3(ch.network_dQ_m3_s) + ' m³/s. (2) First-order response including the chambers’ feedback, Σ ΔS_c ΔΠ_c² / ΔP (exact sensitivity of this linear, reciprocal system): ' + fmt3(ch.firstOrder_dQ_m3_s) + ' m³/s. (3) The solved CFD change: ' + fmt3(ch.dQ_m3_s) + ' m³/s.' +
          ' (1) and (3) differ by ' + pct(Math.abs((ch.dQ_m3_s - ch.network_dQ_m3_s) / ch.dQ_m3_s)) + ' of the change: that is the share of the driving pressure lost in the chambers.</p>');
      }
      const chShare = 1 - rd.membraneShare;
      p.push(chShare < 0.01
        ? '<p><b>Why the rest of the membrane barely notices:</b> the chambers carry only ' + pct(chShare) + ' of the device’s hydraulic resistance (see “Where is the resistance?”), so every open face still sees ΔΠ_c ≈ ΔP; the largest flux change on faces open in both states is ' + fmt3(cmp.maxOpen) + ' m/s, ' + fmt3(cmp.jRef ? cmp.maxOpen / cmp.jRef : 0) + ' of the local flux.</p>'
        : '<p><b>Shared chamber losses matter:</b> the chambers carry ' + pct(chShare) + ' of the resistance, so the local driving potential responds to the change: the largest flux change on faces open in both states is ' + fmt3(cmp.maxOpen) + ' m/s (' + fmt3(cmp.jRef ? cmp.maxOpen / cmp.jRef : 0) + ' of the local flux).</p>');
      if (cmp.velChange != null) p.push('<p><b>Where the flow goes:</b> the chamber velocity field changed by ' + fmt3(cmp.velChange) + ' (relative L2 over both chambers). This re-routing is part of the solved Stokes field: the interface law participates in the pressure–velocity solve; nothing is painted afterwards.</p>');
    } else {
      const sameMods = JSON.stringify(b.scenario.mods) === JSON.stringify(r.scenario.mods), sameSize = b.scenario.W_m === r.scenario.W_m && b.scenario.B_m === r.scenario.B_m;
      if (sameMods && sameSize && b.scenario.dP_Pa !== r.scenario.dP_Pa && b.scenario.meshLevel === r.scenario.meshLevel) {
        const k0 = b.Q / b.scenario.dP_Pa, k1 = rd.Q_m3_s / r.scenario.dP_Pa;
        p.push('<p><b>Pressure:</b> Q/ΔP = ' + fmt3(k0) + ' m³ Pa⁻¹ s⁻¹ before and ' + fmt3(k1) + ' after (relative difference ' + fmt3(Math.abs(k1 / k0 - 1)) + '). Stokes flow and a linear pore law make Q proportional to ΔP, so the flow pattern keeps its shape and every value scales by ' + fmt3(r.scenario.dP_Pa / b.scenario.dP_Pa) + '.</p>');
      } else if (sameMods && !sameSize) {
        p.push('<p><b>Area:</b> A went from ' + fmt3(bd.area_m2 * 1e12) + ' to ' + fmt3(rd.area_m2 * 1e12) + ' µm² and the pore count from ' + fmtInt(bd.poresTotal) + ' to ' + fmtInt(rd.poresTotal) + '. The flux per area changed by ' + pct(rd.Jmean_m_s / bd.Jmean_m_s - 1) + ' (at the same local driving potential it would not change at all), so Q followed the area: ×' + fmt3(rd.Q_m3_s / b.Q) + '.</p>');
      } else p.push('<p>Several kinds of input changed at once, so the panel reports the totals without attributing them: ΔQ = ' + fmt3(cmp.dQ) + ' m³/s (' + pct(cmp.rel) + '). Set a new baseline before the next change to see one effect at a time.</p>');
    }
    el.whyBody.innerHTML = p.join('');
  }
  function renderResistance() {
    const r = S.result; if (!r) return;
    const d = r.diag, dP = r.scenario.dP_Pa;
    if (!(d.Q_m3_s > 0)) { el.resistBody.innerHTML = '<p>No flow at zero pressure difference: nothing is dissipated.</p>'; return; }
    const Rch = d.R_chambers_Pa_s_m3, Rm = d.R_membrane_Pa_s_m3, N = d.poresOpenEquivalent, G0 = r.membrane.G0;
    const gain = (F) => (Rch + Rm) / (Rch + Rm / F);
    let h = '<div class="cl-table-wrap"><table class="cl-table"><tbody>';
    h += '<tr><th scope="row">External power ΔP · Q</th><td>' + fmt3(d.powerExternal_W) + ' W</td></tr>';
    h += '<tr><th scope="row">Membrane dissipation Σ A_c Rs_c J_c²</th><td>' + fmt3(d.dissMembrane_W) + ' W (' + pctFine(d.membraneShare) + ')</td></tr>';
    h += '<tr><th scope="row">Viscous dissipation in the chambers</th><td>' + fmt3(d.dissViscous_W) + ' W (' + pct(d.dissViscous_W / d.powerExternal_W) + ')</td></tr>';
    h += '<tr><th scope="row">Closure |ΔP Q − Φ_v − Φ_m| / (ΔP Q)</th><td>' + fmt3(Math.abs(d.energyClosure)) + '</td></tr>';
    h += '<tr><th scope="row">R_chambers = Φ_v / Q²</th><td>' + fmt3(Rch) + ' Pa s m⁻³</td></tr>';
    h += '<tr><th scope="row">R_membrane = Φ_m / Q²</th><td>' + fmt3(Rm) + ' Pa s m⁻³</td></tr>';
    h += '<tr><th scope="row">One pore 1/G and N pores in parallel 1/(N G)</th><td>' + fmt3(1 / G0) + ' and ' + fmt3(1 / (N * G0)) + ' Pa s m⁻³ (N = ' + fmtInt(N) + ' open-equivalent)</td></tr>';
    h += '</tbody></table></div>';
    h += '<p class="cl-small">Φ_v is the discrete viscous quadratic form of the solved velocity field and Φ_m the membrane term; with the MAC discretisation their sum equals ΔP Q to rounding, which is the closure shown. Pore-scale (entrance, interior, exit and access) losses are inside the membrane term, because the pore law lumps them.</p>';
    h += '<p><b>Network reference</b> (series resistances taken from this solution, not a new CFD result): Q = ΔP / (R_chambers + R_pore/N). If every pore conducted 10 times more, Q would rise ×' + fmt3(gain(10)) + '; 1000 times more, ×' + fmt3(gain(1000)) + '. The pores would have to conduct ' + fmt3(Rm / Rch) + ' times more before the chambers carried half the resistance. ' +
      (d.membraneShare > 0.99 ? 'This device is pore-limited: total flow follows the pore law and the number of open pores, and better pores would pay off almost fully.' : 'Shared chamber losses matter here: multiplying one-tube flow by N would overestimate Q.') + '</p>';
    el.resistBody.innerHTML = h;
  }

  /* deterministic decision panel: priority 1 scope/reference/units, 2 convergence/conservation, 3 resolution,
     4 molecular evidence, 5 accepted within tested scope */
  /* Total-flow resolution of the displayed configuration (SC.resolutionStatus): only a comparison of this same
     configuration at a second mesh level can PASS — the automatic check the worker sends after every run (10 cells for
     the standard mesh, 20 for a fine mesh) or the optional standard-vs-fine check. A fine mesh on its own and the
     offline table of intact membranes never certify a result; zero flow is NOT_APPLICABLE. */
  function meshStatus() {
    const r = S.result; if (!r) return null;
    const auto = S.refinements[r.configId], man = S.meshChecks[r.configId];
    const st = SC.resolutionStatus(r.configId, auto, man);
    const lv = (a, b) => a + ' and ' + b + ' cells across the shorter side';
    if (st.state === 'NOT_APPLICABLE') return { state: st.state, text: 'zero flow on both mesh levels (ΔP = 0 or no open pores): nothing to resolve' };
    if (st.source === 'manual') return { state: st.state, rel: st.rel, text: 'this configuration on the standard and the fine mesh (' + lv(r.scenario.meshLevel, st.level) + '): |ΔQ|/Q = ' + fmt3(st.rel) + ' (gate 2 %)' };
    if (st.source === 'auto') return { state: st.state, rel: st.rel, text: 'this configuration at ' + lv(st.levelComparison, st.levelRun) + ': |ΔQ|/Q = ' + fmt3(st.rel) + ' (gate 2 %)' };
    if (auto && auto.configId === r.configId && !auto.ok) return { state: 'NOT_CHECKED', text: 'the comparison of this configuration could not be computed (' + (auto.reasons || []).join('; ') + ')' };
    return { state: 'CHECKING', text: 'comparing this configuration at a second mesh level…' };
  }
  function onRefinement(m) {
    S.refinements[m.configId] = m;
    logEvent('resolution-check', { levels: [m.levelComparison, m.levelRun], rel: m.rel, state: m.state });
    if (S.result && S.result.configId === m.configId) { renderDecision(); renderNumerics(); }
  }
  function renderDecision() {
    const r = S.result, checks = [];
    const v = SC.validateScenario(S.sc, S.manifest, S.law);
    checks.push({ k: 'Inputs within the declared scope (fluid, 300 K, geometry, tube length, reference planes, size, ΔP 0–10 MPa, compressibility)', state: v.ok ? 'PASS' : 'FAIL', text: v.ok ? 'density change ' + pct(v.densityChange) : v.reasons.join('; ') });
    let code = null, why = '';
    if (!v.ok) { code = 'CHECK_REFERENCE_OR_UNITS'; why = 'An input is outside the declared scope; nothing is computed for it.'; }
    const sol = S.unsupported && S.unsupported.where === 'solution' ? S.outOfScope : r;
    if (sol) {
      const d = sol.diag;
      checks.push({ k: 'Creeping flow (Re ≤ 0.1 at the ports) and local ΔΠ inside the pore-law interval', state: d.scopeReasons.length ? 'FAIL' : 'PASS', text: 'Re = ' + fmt3(d.Re) + (d.scopeReasons.length ? '; ' + d.scopeReasons.join('; ') : '') });
      if (!code && d.scopeReasons.length) { code = 'OUTSIDE_TESTED_SCOPE'; why = 'The solution leaves the creeping-flow or pore-law scope (' + d.scopeReasons.join('; ') + '). A Navier–Stokes model or a wider qualified pore law would be needed; the last valid result stays on display.'; }
      const conv = sol.solver.converged && sol.solver.relResidual <= 1e-9, cons = d.imbalance <= 1e-6 && Math.abs(d.energyClosure) <= 1e-8;
      checks.push({ k: 'Solver convergence ‖b − Kx‖/‖b‖ ≤ 10⁻⁹', state: conv ? 'PASS' : 'FAIL', text: fmt3(sol.solver.relResidual) + ' after ' + sol.solver.iterations + ' iterations' });
      checks.push({ k: 'Conservation: |Q_in − Q_out|/Q ≤ 10⁻⁶ and energy closure ≤ 10⁻⁸', state: cons ? 'PASS' : 'FAIL', text: fmt3(d.imbalance) + ' and ' + fmt3(Math.abs(d.energyClosure)) });
      if (!code && (!conv || !cons)) { code = 'RERUN_SOLVER'; why = 'Convergence or conservation failed; the numbers are not reliable.'; }
      const ms = meshStatus();
      checks.push({ k: 'Numerical resolution of the total flow (this configuration at two mesh levels, |ΔQ|/Q ≤ 2 %)', state: ms.state, text: ms.text, mesh: true });
      if (!code && (ms.state === 'FAIL' || ms.state === 'NOT_CHECKED')) { code = 'REFINE_CONTINUUM_MESH'; why = ms.state === 'FAIL' ? 'The total flow of this configuration changes by more than 2 % between the two mesh levels.' : 'The resolution of this configuration could not be checked.'; }
    }
    const lawOk = S.law.calibrated;
    checks.push({ k: 'Molecular evidence behind the pore law', state: lawOk ? 'PASS' : 'INSUFFICIENT', text: S.law.sourceKind + ' / ' + S.law.assessmentStatus + (lawOk ? '' : ': a declared input scenario, not a measured property of water in a (6,6) CNT') });
    const numericOk = !code, pending = !!(sol && checks.some((c) => c.mesh && c.state === 'CHECKING'));
    if (!code && !lawOk) { code = 'INSUFFICIENT_EVIDENCE'; why = 'The continuum calculation passes its numerical checks within the tested scope, but the pore law is a declared input scenario. Next step: EXTEND_MOLECULAR_SAMPLING — run the calibration package (net water crossings at three or more drives of both signs, with replicas) and qualify a pore law.'; }
    if (!code) { code = 'ACCEPT_WITHIN_TESTED_SCOPE'; why = 'All checks pass within the tested scope.'; }
    S.decision = { code, why, checks: checks.map((c) => ({ check: c.k, state: c.state, detail: c.text })) };
    const chip = (st) => '<span class="cl-pass ' + (st === 'PASS' ? 'is-pass' : st === 'FAIL' ? 'is-fail' : st === 'NOT_APPLICABLE' ? 'is-na' : 'is-warn') + '">' + st.replace('_', ' ') + '</span>';
    let h = '<p class="cl-code"><span class="cl-code-chip">' + code + '</span></p><p>' + why + '</p>';
    if (sol) h += '<p class="cl-small">Continuum solution: <b>' + (pending && numericOk ? 'resolution check running' : numericOk ? 'ACCEPT_WITHIN_TESTED_SCOPE' : code) + '</b>. As a CNT membrane prediction: <b>' + (lawOk ? 'supported in scope' : 'INSUFFICIENT_EVIDENCE') + '</b>.</p>';
    h += '<ul class="cl-checks">' + checks.map((c) => '<li>' + chip(c.state) + ' <span>' + esc(c.k) + ': ' + esc(c.text) + (c.mesh && r && c.state !== 'FAIL' && c.state !== 'NOT_APPLICABLE' && canMeshCheck() ? ' <button type="button" class="btn-link cl-meshcheck">Also check on the fine mesh</button>' : '') + '</span></li>').join('') + '</ul>';
    if (sol) h += '<p class="cl-small cl-resolution-note">The resolution check concerns the total flow Q. The chamber velocity field near the port edges converges more slowly and is shown for orientation (Validation, native comparison).</p>';
    h += '<p class="cl-small">Fixed rules, evaluated in priority order (scope and units, convergence and conservation, resolution, molecular evidence); no language model is involved.</p>';
    el.decision.innerHTML = h;
    const b = $('.cl-meshcheck', el.decision);
    if (b) b.addEventListener('click', runMeshCheck);
  }
  function canMeshCheck() {
    const r = S.result; if (!r || r.scenario.meshLevel !== 20) return false;
    const lvl = SC.fineLevel(r.scenario), nx = r.device.nx / 20 * lvl, ny = r.device.ny / 20 * lvl;
    return nx * ny <= 2600 && !S.meshChecks[r.configId];                        // square devices only (about 0.5 M unknowns)
  }
  function runMeshCheck() {
    const r = S.result; if (!r || !S.worker) return;
    const lvl = SC.fineLevel(r.scenario), sc = Object.assign(JSON.parse(JSON.stringify(r.scenario)), { meshLevel: lvl });
    S.meshPending = { configId: r.configId, level: lvl, Q: r.diag.Q_m3_s };      // compared by SC.resolutionStatus with the same configuration only
    S.worker.postMessage({ type: 'solve', revision: S.revision, scenario: sc, purpose: 'meshCheck' });
    const b = $('.cl-meshcheck', el.decision); if (b) { b.disabled = true; b.textContent = 'Checking on ' + lvl + ' cells (may take a while)…'; }
  }
  function onMeshCheck(m) {
    const p = S.meshPending; if (!p) return;
    S.meshChecks[p.configId] = { configId: p.configId, level: p.level, Q_run_m3_s: p.Q, Q_comparison_m3_s: m.diag.Q_m3_s, rel: SC.refinementVerdict(p.Q, m.diag.Q_m3_s).rel };
    S.meshPending = null; logEvent('mesh-check', { level: p.level, Qstd: p.Q, Qfine: m.diag.Q_m3_s });
    renderDecision();
  }
  function renderNumerics() {
    const r = S.result; if (!r) return;
    const s = r.solver, d = r.diag, dev = r.device;
    const rows = [
      ['Spatial dimension of the computed fields', '3D (two chambers), steady'],
      ['Grid', dev.nx + ' × ' + dev.ny + ' × ' + dev.nz + ' cells per chamber, cubic cells of ' + V.lengthLabel(dev.dx)],
      ['Unknowns, matrix nonzeros', fmtInt(s.unknowns) + ', ' + fmtInt(s.nonzeros)],
      ['Method', 'MAC finite volumes; ' + s.method + '; ' + s.precision],
      ['Computation', r.mode === 'change' ? 'change solve against revision ' + r.change.refRevision + ' (' + r.change.changeIterations + ' iterations, change residual ' + fmt3(r.change.changeResidual) + ')' : r.mode],
      ['Iterations, restarts', s.iterations + ', ' + s.restarts],
      ['Residual ‖b − Kx‖/‖b‖; row-relative', fmt3(s.relResidual) + '; ' + fmt3(s.rowRelResidual)],
      ['Mass balance |Q_in − Q_out|/Q', fmt3(d.imbalance)],
      ['Scales', 'velocity ' + fmt3(s.U) + ' m s⁻¹ per Pa, ε = ' + fmt3(s.eps) + ', Rs,ref = ' + fmt3(s.RsRef) + ' Pa s m⁻¹'],
      ['Wall time (worker solve; page round trip)', fmt3(s.wallMs / 1000) + ' s; ' + fmt3(r.receivedMs / 1000) + ' s'],
      ['Total-flow resolution (same configuration, second mesh level)', (function () { const ms = meshStatus(); return ms.state.replace('_', ' ') + ': ' + ms.text; })()],
      ['Reynolds number at the ports', fmt3(d.Re) + ' (gate 0.1)'],
      ['Density change over the drive', pct(d.densityChange) + ' (gate 1 %)'],
      ['Solver version, configuration, geometry', r.solverVersion + ', ' + r.configId + ', ' + r.geometryHash],
    ];
    el.numerics.innerHTML = '<div class="cl-table-wrap"><table class="cl-table"><tbody>' + rows.map((x) => '<tr><th scope="row">' + x[0] + '</th><td>' + esc(x[1]) + '</td></tr>').join('') + '</tbody></table></div>';
  }

  /* numbers behind the colours: one row per patch (membrane map) and the probe points (flow view) */
  function renderNumbers(cmp) {
    const r = S.result, box = document.getElementById('cl-numbers-body'); if (!r || !box) return;
    const m = r.membrane, dev = r.device, rows = [];
    for (let pj = dev.patches.py - 1; pj >= 0; pj--) for (let pi = 0; pi < dev.patches.px; pi++) {
      let pores = 0, Qp = 0, A = 0, closed = 0, dQp = 0, haveD = !!(cmp && cmp.dJ);
      for (let j = pj * dev.patchCells; j < (pj + 1) * dev.patchCells; j++) for (let i = pi * dev.patchCells; i < (pi + 1) * dev.patchCells; i++) {
        const k = j * dev.nx + i; pores += m.counts[k]; Qp += m.J[k] * m.areaFace; A += m.areaFace; if (m.closed[k]) closed++; if (haveD) dQp += cmp.dJ[k] * m.areaFace;
      }
      rows.push('<tr><td>(' + pi + ', ' + pj + ')</td><td>' + fmtInt(pores) + '</td><td>' + (closed ? closed + ' of ' + dev.patchCells * dev.patchCells : '–') + '</td><td>' + fmt3(Qp / A) + '</td><td>' + fmt3(Qp) + '</td>' + (haveD ? '<td>' + fmt3(dQp) + '</td>' : '') + '</tr>');
    }
    const FSm = window.ContinuumSample, smp = r.chambers.map((c) => FSm.makeSampler(c, { nx: dev.nx, ny: dev.ny, nz: dev.nz }, { dx: dev.dx, dy: dev.dy, dz: dev.dz }, 'no-slip'));
    const W = dev.W, B = dev.B, H = dev.H, dz = dev.dz;
    const probes = [['inlet port centre, half a cell below', 0, W / 2, B / 2, H - dz / 2], ['feed chamber centre', 0, W / 2, B / 2, H / 2], ['feed, half a cell above the membrane centre', 0, W / 2, B / 2, dz / 2],
      ['feed corner region', 0, W / 10, B / 10, H / 2], ['permeate chamber centre', 1, W / 2, B / 2, H / 2], ['outlet port centre, half a cell above', 1, W / 2, B / 2, dz / 2]];
    const prow = probes.map((q) => { const v = smp[q[1]](q[2], q[3], q[4], [0, 0, 0]); return '<tr><td>' + q[0] + '</td><td>' + fmt3(Math.hypot(v[0], v[1], v[2])) + '</td><td>' + fmt3(v[2]) + '</td></tr>'; });
    box.innerHTML = '<h3 class="cl-numbers-h">Membrane, by patch (rows from the top of the map)</h3><div class="cl-table-wrap"><table class="cl-table"><thead><tr><th scope="col">Patch (i, j)</th><th scope="col">Pores</th><th scope="col">Closed faces</th><th scope="col">Mean J (m/s)</th><th scope="col">Q through it (m³/s)</th>' + (cmp && cmp.dJ ? '<th scope="col">ΔQ vs baseline (m³/s)</th>' : '') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' +
      '<h3 class="cl-numbers-h">Chamber flow at fixed points</h3><div class="cl-table-wrap"><table class="cl-table"><thead><tr><th scope="col">Point</th><th scope="col">Speed (m/s)</th><th scope="col">Vertical velocity w (m/s)</th></tr></thead><tbody>' + prow.join('') + '</tbody></table></div>';
  }

  /* ---------------------------------------------------------------- controls */
  function refreshControls() {
    const sc = S.sc, dev = device(), pc = poreCounts(sc);
    const pt = $('.cl-poster-title'), pn = $('.cl-poster-note');
    if (pt) pt.textContent = 'Water is pushed through ' + fmtInt(pc.total) + ' sub-nanometre carbon nanotubes.';
    if (pn) pn.textContent = 'Feed chamber above, permeate chamber below, a ' + V.lengthLabel(sc.W_m) + ' × ' + V.lengthLabel(sc.B_m) + ' membrane between them. The 3D Stokes solver loads and runs in your browser only when you start.';
    el.dpOut.textContent = MPa(sc.dP_Pa);
    el.dpNote.textContent = 'Supported interval 0–10 MPa. Absolute pressures at the port faces: feed ' + MPa(sc.pPerm_Pa + sc.dP_Pa) + ', permeate ' + MPa(sc.pPerm_Pa) + '.';
    if (el.settingsNow) el.settingsNow.textContent = V.lengthLabel(sc.W_m) + ' × ' + V.lengthLabel(sc.B_m) + ' · ' + (sc.meshLevel === 20 ? 'standard' : 'fine') + ' mesh';
    el.sizeNote.textContent = 'A = ' + areaLabel(sc.W_m * sc.B_m) + ' · ' + fmtInt(pc.total) + ' pores at ' + fmt3(sc.pitch_m * 1e9) + ' nm pitch · each chamber ' + V.lengthLabel(sc.W_m) + ' × ' + V.lengthLabel(sc.B_m) + ' × ' + V.lengthLabel(dev.H) + ' · ports ' + V.lengthLabel(dev.portSide) + ' square';
    const t = S.sel.tube, p = S.sel.patch;
    const scope = S.sel.scope;
    el.scopeRadios.forEach((rb) => { rb.checked = rb.value === scope; });
    let desc = '';
    if (scope === 'tube' && t) { const pp = patchOfTube(t); desc = 'Tube (' + t.ti + ', ' + t.tj + ') in patch (' + pp.pi + ', ' + pp.pj + '): 1 of ' + fmtInt(pc.total) + ' pores. Pick another in the membrane view (zoom into a patch).'; }
    else if (scope === 'patch' && p) { desc = 'Patch (' + p.pi + ', ' + p.pj + ') of ' + dev.patches.px + ' × ' + dev.patches.py + ': ' + fmtInt(patchPores(p)) + ' pores. Pick another on the membrane map.'; }
    else desc = 'Whole membrane: ' + fmtInt(pc.total) + ' pores.';
    el.scopeDesc.textContent = desc;
    // active modifications
    const m = sc.mods, items = [];
    if (m.membraneFactor !== 1) items.push({ label: 'Whole membrane ' + factorWord(m.membraneFactor), scope: { kind: 'membrane' } });
    Object.keys(m.patchFactors).forEach((k) => { const [pi, pj] = k.split(',').map(Number); items.push({ label: 'Patch (' + pi + ', ' + pj + ') ' + factorWord(m.patchFactors[k]), scope: { kind: 'patch', pi, pj } }); });
    Object.keys(m.tubeFactors).forEach((k) => { const [ti, tj] = k.split(',').map(Number); items.push({ label: 'Tube (' + ti + ', ' + tj + ') ' + factorWord(m.tubeFactors[k]), scope: { kind: 'tube', ti, tj } }); });
    el.mods.innerHTML = items.length ? items.map((x, i) => '<li><span>' + esc(x.label) + '</span> <button type="button" class="btn-link" data-mod="' + i + '" aria-label="Restore ' + esc(x.label) + '">Restore</button></li>').join('') : '<li class="cl-small">No changes: every pore as declared.</li>';
    $$('[data-mod]', el.mods).forEach((b) => b.addEventListener('click', () => { const x = items[+b.getAttribute('data-mod')]; applyChange(x.scope, 1, 'restore'); }));
    el.restoreAll.disabled = !items.length;
    el.setBase.disabled = !S.result || (S.baseline && S.baseline.revision === S.result.revision);
    el.compare.setAttribute('aria-pressed', S.compare ? 'true' : 'false');
    el.compare.disabled = !S.baseline;
    renderStateLine();
  }
  function areaLabel(A) { return A >= 1e-6 ? fmt3(A * 1e6) + ' mm²' : fmt3(A * 1e12) + ' µm²'; }
  function patchPores(p) {
    const sc = S.sc, dev = device(), counts = MM.countPores({ W_m: sc.W_m, B_m: sc.B_m, pitch_m: sc.pitch_m }, { nx: dev.nx, ny: dev.ny }).counts;
    let n = 0; for (let j = p.pj * dev.patchCells; j < (p.pj + 1) * dev.patchCells; j++) for (let i = p.pi * dev.patchCells; i < (p.pi + 1) * dev.patchCells; i++) n += counts[j * dev.nx + i];
    return n;
  }
  function scopeObject(kind) {
    if (kind === 'tube') return S.sel.tube ? { kind: 'tube', ti: S.sel.tube.ti, tj: S.sel.tube.tj } : null;
    if (kind === 'patch') return S.sel.patch ? { kind: 'patch', pi: S.sel.patch.pi, pj: S.sel.patch.pj } : null;
    return { kind: 'membrane' };
  }
  function applyChange(scope, factor, type) {
    if (!scope) return;
    S.sc.mods = MM.applyScopedChange(S.sc.mods, scope, factor);
    changed(type || 'scope-change', { scope, factor });
  }
  function selectTube(ti, tj, fromView) {
    const pc = poreCounts(S.sc);
    S.sel.tube = { ti: Math.max(0, Math.min(pc.Nx - 1, ti)), tj: Math.max(0, Math.min(pc.Ny - 1, tj)) };
    const pp = patchOfTube(S.sel.tube); S.sel.patch = { pi: pp.pi, pj: pp.pj };
    if (fromView) S.sel.scope = 'tube';
    updateSelectionViews();
  }
  function selectTubeAt(x, y, setScope) { const s = S.sc.pitch_m; selectTube(Math.floor(x / s), Math.floor(y / s), setScope); }
  function selectPatch(pi, pj) {
    const dev = device(); S.sel.patch = { pi: Math.max(0, Math.min(dev.patches.px - 1, pi)), pj: Math.max(0, Math.min(dev.patches.py - 1, pj)) };
    if (S.sel.scope === 'tube' && S.memMode !== 'zoom') S.sel.scope = 'patch';
    updateSelectionViews();
  }
  function updateSelectionViews() {
    const sel = selectionForViews();
    flow.setSelection(sel); membrane.setSelection(sel);
    if (S.result) { renderStrip(comparison()); renderMemInfo(); if (S.memMode === 'zoom') renderMemLegend(comparison()); }
    renderTube(); refreshControls(); updatePores();
  }
  function setMemMode(mode) {
    S.memMode = mode; membrane.setMode(mode);
    el.zoom.hidden = mode === 'zoom'; el.zoomOut.hidden = mode !== 'zoom';
    el.showJ.disabled = el.showD.disabled = mode === 'zoom';                 // the zoom always shows single-pore flow
    if (S.result) renderMemLegend(comparison());
  }
  function memKey(e) {
    const k = e.key, dev = device();
    if (S.memMode === 'zoom' && S.sel.tube) {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[k];
      if (d) { selectTube(S.sel.tube.ti + d[0], S.sel.tube.tj + d[1], true); return true; }
      if (k === 'Escape') { setMemMode('map'); return true; }
      return false;
    }
    const p = S.sel.patch || { pi: 0, pj: 0 }, d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[k];
    if (d) { selectPatch(p.pi + d[0], p.pj + d[1]); return true; }
    if (k === 'Enter' && S.result) { setMemMode('zoom'); return true; }
    return false;
  }

  function bindControls() {
    const startRun = () => {
      if (!S.started) {
        S.started = true; logEvent('run', {}); startWorker(); requestSolve(); ensureMolecule();
        el.run.textContent = 'Run again';
      } else { S.revision += 1; logEvent('run', { rerun: true }); requestSolve(); }
    };
    el.run.addEventListener('click', startRun);
    el.posterRun.addEventListener('click', startRun);
    el.dp.addEventListener('input', () => { S.sc.dP_Pa = Math.round(parseFloat(el.dp.value) * 10) / 10 * 1e6; changed('pressure', { dP_Pa: S.sc.dP_Pa }, { debounce: true }); });
    el.scopeRadios.forEach((rb) => rb.addEventListener('change', () => { if (rb.checked) { S.sel.scope = rb.value; refreshControls(); } }));
    el.apply.addEventListener('click', () => applyChange(scopeObject(S.sel.scope), parseFloat(el.factor.value)));
    el.block.addEventListener('click', () => { if (!S.sel.patch) defaultSelection(); S.sel.scope = 'patch'; applyChange(scopeObject('patch'), 0, 'block-patch'); });
    el.restore.addEventListener('click', () => applyChange(scopeObject(S.sel.scope), 1, 'restore'));
    el.restoreAll.addEventListener('click', () => { S.sc.mods = MM.emptyModifications(); changed('restore-all', {}); });
    const sizeChange = () => {
      const W = parseFloat(el.W.value) * 1e-6, B = parseFloat(el.B.value) * 1e-6;
      S.sc.W_m = W; S.sc.B_m = B; S.sc.mods = MM.emptyModifications(); S.sc.meshLevel = el.mesh.value === 'fine' ? SC.fineLevel(S.sc) : 20;
      defaultSelection(); setMemMode('map');
      changed('size', { W_m: W, B_m: B, note: 'membrane changes cleared' });
      updateSelectionViews();
    };
    el.W.addEventListener('change', sizeChange); el.B.addEventListener('change', sizeChange);
    el.mesh.addEventListener('change', () => { S.sc.meshLevel = el.mesh.value === 'fine' ? SC.fineLevel(S.sc) : 20; changed('mesh', { meshLevel: S.sc.meshLevel }); });
    el.setBase.addEventListener('click', () => { if (S.result) { setBaseline(S.result, false); render(); } });
    el.compare.addEventListener('click', () => {
      S.compare = !S.compare; membrane.setShow(S.compare ? 'dJ' : 'J');
      el.showJ.setAttribute('aria-pressed', S.compare ? 'false' : 'true'); el.showD.setAttribute('aria-pressed', S.compare ? 'true' : 'false');
      if (S.compare) setView('membrane', true);
      if (S.result) renderMemLegend(comparison()); refreshControls();
      const card = $('.cl-compare-card'); if (S.compare && card) card.classList.add('is-highlight');
    });
    el.showJ.addEventListener('click', () => { S.compare = false; membrane.setShow('J'); el.showJ.setAttribute('aria-pressed', 'true'); el.showD.setAttribute('aria-pressed', 'false'); if (S.result) renderMemLegend(comparison()); refreshControls(); });
    el.showD.addEventListener('click', () => { S.compare = true; membrane.setShow('dJ'); el.showJ.setAttribute('aria-pressed', 'false'); el.showD.setAttribute('aria-pressed', 'true'); if (S.result) renderMemLegend(comparison()); refreshControls(); });
    el.zoom.addEventListener('click', () => { if (!S.sel.patch) defaultSelection(); setMemMode('zoom'); });
    el.zoomOut.addEventListener('click', () => setMemMode('map'));
    el.tracers.addEventListener('change', () => flow.setTracers(el.tracers.checked));
    if (el.fixScale) el.fixScale.addEventListener('change', () => { S.scaleFixed = el.fixScale.checked; logEvent('display-scale', { fixedToBaseline: S.scaleFixed }); if (S.result) render(); });
    el.slice.addEventListener('change', () => { flow.sliceOn = el.slice.checked; flow.invalidate(); });
    el.flowReset.addEventListener('click', () => flow.resetView());
    el.p3.play.addEventListener('click', () => { if (!S.pores) return; const on = !S.pores.playing; S.pores.setPlaying(on); el.p3.play.textContent = on ? 'Pause' : 'Play'; el.p3.play.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    el.p3.reset.addEventListener('click', () => { if (S.pores) S.pores.resetView(); });
    el.p3.focus.addEventListener('click', () => setP3Preset('focus'));
    el.p3.array.addEventListener('click', () => setP3Preset('array'));
    el.p3.run.addEventListener('click', () => el.run.click());
    el.molShow.addEventListener('click', ensureMolecule);
    el.molPlay.addEventListener('click', () => { const on = !molecule.playing; molecule.play(on); el.molPlay.textContent = on ? 'Pause' : 'Play'; el.molPlay.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    el.download.addEventListener('click', download);
    const reset = document.querySelector('.cl-reset');
    if (reset) reset.addEventListener('click', () => {           // terminate the worker and start from the defaults
      if (S.worker) { S.worker.terminate(); S.worker = null; }
      S.sc = SC.makeScenario(S.manifest); S.result = null; S.lastValid = null; S.baseline = null; S.started = false; S.compare = false; S.meshChecks = {}; S.refinements = {}; S.scaleRef = null; S.guide.step = -1; S.guide.after = null;
      S.revision += 1; logEvent('reset', {});
      el.dp.value = String(S.sc.dP_Pa / 1e6); el.W.value = String(S.manifest.defaultScenario.W_um); el.B.value = String(S.manifest.defaultScenario.B_um); el.mesh.value = 'std';
      membrane.setShow('J'); el.showJ.setAttribute('aria-pressed', 'true'); el.showD.setAttribute('aria-pressed', 'false');
      defaultSelection(); setMemMode('map'); el.poster.hidden = false; el.run.textContent = 'Run experiment'; el.download.disabled = true;
      if (el.qline) el.qline.textContent = 'Total flow appears here after the first run.';
      app.classList.remove('is-stale'); setStatus('idle', 'Not started'); drawGeometry(); refreshControls(); renderCompare(null); renderWhy(null); renderDecision(); guideRender();
    });
    if (V.reduceMotion) { el.tracers.checked = false; el.tracers.disabled = true; }
    document.addEventListener('visibilitychange', () => { if (document.hidden) molecule.play(false); });
  }

  function ensureMolecule() {
    if (S.molLoaded) return;
    S.molLoaded = true;
    const g = S.manifest.geometries[0].recordedTrajectory;
    el.molPoster.hidden = true;
    molecule.load(g.file, g.manifest, g.id).then(() => {
      el.molPlay.disabled = false;
      if (!V.reduceMotion) { molecule.play(true); el.molPlay.textContent = 'Pause'; el.molPlay.setAttribute('aria-pressed', 'true'); }
    }).catch((e) => { el.molPoster.hidden = false; S.molLoaded = false; el.molPoster.querySelector('p').textContent = 'The recorded trajectory could not be loaded (' + e.message + ').'; });
  }

  /* ---------------------------------------------------------------- 3D pore view */
  /* A 5 × 5 window of real lattice positions with the selected tube at its front-left corner (the block is cut through its row),
     each tube with q_i = G_i ΔΠ_c from the current solution. Drift speed on screen = q_i × factor, with one factor for
     all tubes: two molecular spacings per second at the reference flow, the reference being the baseline's largest
     single-pore flow while the scale is fixed to the baseline (so 4 MPa runs four times faster), otherwise this
     result's own. */
  const P3_HOPS = 2, P3_ELL = 0.27;                    // molecular spacings per second at the reference flow; nm between molecules
  /* 3 significant figures, with a power of ten below 0.01 (8.99 × 10⁻³ rather than 0.00899) */
  const sig3 = (x) => { if (!(Math.abs(x) < 0.01) || x === 0) return fmt3(x); const e = Math.floor(Math.log10(Math.abs(x))), mt = x / Math.pow(10, e);
    return (mt.toFixed(2) === '10.00' ? '1.00 × 10' + String(e + 1) : mt.toFixed(2) + ' × 10' + String(e)).replace(/10(-?\d+)$/, (m0, k) => '10' + k.replace('-', '⁻').replace(/\d/g, (c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c])); };
  function ensurePores() {
    if (S.poresState !== 'idle') return;
    S.poresState = 'loading';
    el.p3.msg.textContent = 'Loading the 3D view…'; el.p3.run.hidden = true; el.p3.poster.hidden = false;
    const go = () => window.ContinuumPores3D.create(el.p3.host, { onPick: (u) => selectTube(u.ti, u.tj, true), reduceMotion: V.reduceMotion, preset: S.p3preset });
    (window.ContinuumPores3D ? Promise.resolve() : loadScript('pores3d.js')).then(go).then((v) => {
      S.pores = v; S.poresState = 'ready';
      el.p3.play.disabled = false; el.p3.reset.disabled = false; el.p3.focus.disabled = false; el.p3.array.disabled = false;
      el.p3.play.textContent = v.playing ? 'Pause' : 'Play'; el.p3.play.setAttribute('aria-pressed', v.playing ? 'true' : 'false');
      updatePores();
      v.setVisible(!el.panes.pores.hidden && !el.main.hidden);
      logEvent('pores3d', { loaded: true });
    }).catch((e) => {
      S.poresState = 'failed'; el.p3.poster.hidden = false; el.p3.run.hidden = true;
      el.p3.msg.textContent = e && e.code === 'NO_WEBGL' ? 'This view needs WebGL, which this browser has switched off or does not support. The experiment and the other views work without it.' : 'The 3D view could not be loaded (' + (e && e.message || e) + ').';
    });
  }
  function poresData() {
    const r = S.result, t0 = S.sel.tube; if (!r || !t0) return null;
    const m = r.membrane, sc = r.scenario, geo = S.manifest.geometries[0];
    if (t0.ti >= m.Nx || t0.tj >= m.Ny) return null;
    const pitch_nm = sc.pitch_m * 1e9;
    const ti0 = Math.max(0, Math.min(t0.ti, m.Nx - 5)), ti1 = Math.min(m.Nx - 1, ti0 + 4), tj0 = t0.tj, tj1 = Math.min(m.Ny - 1, t0.tj + 4);   // selected tube at the front-left corner
    const ref = scaleRefFor(r), qRef = ref ? ref.qmax : refSinglePoreMax(r);
    const factor = qRef > 0 ? P3_ELL * P3_HOPS / qRef : 0;
    const tubes = [];
    for (let tj = tj0; tj <= tj1; tj++) for (let ti = ti0; ti <= ti1; ti++) {
      const f = tubeFlow({ ti, tj }), blocked = !!(f.closed || f.f.total === 0);
      tubes.push({ ti, tj, x: (ti - t0.ti) * pitch_nm, z: -(tj - t0.tj) * pitch_nm, q: f.q, speed: f.q * factor, blocked, modified: !blocked && f.f.total !== 1, selected: ti === t0.ti && tj === t0.tj, face: f.p.face });
    }
    const vw = U.C.mWater / U.C.rhoRef;
    return { r, ref, qRef, factor, T_ns: qRef > 0 ? P3_HOPS * vw / qRef * 1e9 : null, vw, tubes, t0, win: { ti0, ti1, tj0, tj1 },
      pitch_nm, L_nm: geo.tubeLength_m * 1e9, R_nm: geo.carbonCentreDiameter_m * 1e9 / 2,
      text: { feed: 'Feed side', perm: 'Permeate side', membrane: 'Membrane · ' + fmt3(geo.tubeLength_m * 1e9) + ' nm', selected: 'Selected tube (' + t0.ti + ', ' + t0.tj + ')' } };
  }
  function setP3Preset(name) {
    S.p3preset = name === 'array' ? 'array' : 'focus';
    el.p3.focus.setAttribute('aria-pressed', S.p3preset === 'focus' ? 'true' : 'false');
    el.p3.array.setAttribute('aria-pressed', S.p3preset === 'array' ? 'true' : 'false');
    if (S.pores) S.pores.setPreset(S.p3preset, true);
  }
  /* physical pores with non-zero conductance (closed patches and closed tubes excluded) */
  function openPoreCount(r) {
    const m = r.membrane, mods = r.scenario.mods || {}, mf = mods.membraneFactor == null ? 1 : mods.membraneFactor;
    if (!(mf > 0)) return 0;
    const shut = new Float64Array(m.counts.length);
    (m.tubes || []).forEach((t) => { if (!(t.factor > 0)) shut[t.face] += 1; });
    let n = 0;
    for (let c = 0; c < m.counts.length; c++) if (m.patchFactor[c] > 0) n += m.counts[c] - shut[c];
    return n;
  }
  const P3_KB = 1.380649e-23;                          // J/K
  function updatePores() {
    const d = poresData();
    if (!d) {
      S.display3d = null;
      if (S.poresState !== 'failed') { el.p3.poster.hidden = false; el.p3.run.hidden = S.started; el.p3.msg.textContent = S.started ? 'Computing…' : 'Run the experiment first: this view then shows the tubes around the selected one at true size, with their water moving at the solved single-pore flow.'; }
      el.p3.legend.innerHTML = ''; el.p3.how.innerHTML = '<p>Run the experiment to see how the drawing follows the computed flow.</p>'; return;
    }
    const m = d.r.membrane, sel = d.tubes.find((t) => t.selected), open = d.tubes.filter((t) => !t.blocked && t.q > 0);
    const toMolNs = (q) => U.conv.moleculesPerNs.fromSI(q);
    const qSel = sel && !sel.blocked ? sel.q : 0, qOpen = qSel > 0 ? qSel : open.reduce((a, t) => Math.max(a, t.q), 0);
    const Q = d.r.diag.Q_m3_s, nOpen = openPoreCount(d.r), nTot = d.r.diag.poresTotal;
    S.display3d = { factor: d.factor, T_ns: d.T_ns, qRef: d.qRef, fixed: !!d.ref, refRevision: d.ref ? d.ref.revision : null, revision: d.r.revision,
      tubes: d.tubes.map((t) => ({ ti: t.ti, tj: t.tj, q: t.q, speed: t.speed, blocked: t.blocked, selected: t.selected })),
      selectedMolNs: toMolNs(qSel), Q_m3_s: Q, openPores: nOpen, poresTotal: nTot, vw: d.vw };
    if (S.pores) { S.pores.setData(d); el.p3.poster.hidden = true; }
    const uTube = qOpen / d.vw * P3_ELL * 1e-9, Jf = sel ? m.J[sel.face] : d.r.diag.Jmean_m_s;
    const nWin = (d.win.ti1 - d.win.ti0 + 1) + ' × ' + (d.win.tj1 - d.win.tj0 + 1);
    const clock = d.T_ns ? '1 s on screen = ' + fmt3(d.T_ns) + ' ns' + (d.ref && !(S.baseline && S.baseline.revision === d.r.revision) ? ', clock fixed to the baseline' : '') : '';
    const sentence2 = d.T_ns ? 'The water in each tube advances at that tube’s flow from the live solution (' + clock + ').' : 'No net flow in this state, so no water moves.';
    const selVal = sel && sel.blocked ? 'Blocked: no net flow' : fmt3(toMolNs(qSel)) + ' molecules/ns';
    const tile = (k, v, sub) => '<div class="cl-p3-tile"><p class="cl-tile-k">' + k + '</p><p class="cl-p3-v">' + v + '</p><p class="cl-p3-sub">' + sub + '</p></div>';
    el.p3.legend.innerHTML = '<p class="cl-legend-title">Water through the pores, at the computed flow</p>' +
      '<p class="cl-legend-note">A cutaway of the membrane at true size: (6,6) carbon nanotubes ' + fmt3(d.R_nm * 2) + ' nm wide and ' + fmt3(d.L_nm) + ' nm long on the ' + fmt3(d.pitch_nm) + ' nm lattice of the calculation, the selected tube in front. ' + sentence2 + '</p>' +
      '<div class="cl-p3-results">' +
        tile('Selected pore', selVal, sel && sel.blocked ? 'q = 0' : 'q = ' + fmt3(qSel) + ' m³/s') +
        tile('Whole membrane', fmt3(Q) + ' m³/s', 'J = ' + fmt3(d.r.diag.Jmean_m_s) + ' m/s') +
        tile('Open pores', fmtInt(nOpen) + ' of ' + fmtInt(nTot), nWin + ' drawn here') +
      '</div>' +
      '<p class="cl-legend-note"><span class="cl-key cl-key-sel"></span>Selected tube <span class="cl-key cl-key-blocked"></span>Blocked <span class="cl-key cl-key-mod"></span>Modified conductance</p>';
    // how the illustration works (expandable): geometry, water, clock, speed, fluctuations, scope
    const G0 = S.law.G_m3_Pa_s, Tk = (S.law.domain && S.law.domain.T_K) || 300, DN = G0 * P3_KB * Tk / (d.vw * d.vw) * 1e-9;   // per ns
    const vwNm3 = d.vw * 1e27, aChain = vwNm3 / P3_ELL, aPitch = d.pitch_nm * d.pitch_nm, aOpen = Math.PI * d.R_nm * d.R_nm;
    const li = [];
    li.push('<b>Window.</b> ' + nWin + ' lattice positions of the ' + fmtInt(nTot) + ' in the membrane, cut open through the selected tube’s row. Nothing is enlarged: the tube cross-sections (carbon-centre diameter) cover ' + fmt3(100 * aOpen / aPitch) + ' % of the membrane, which is why the tubes look sparse. <b>Focus pore</b> shows the selected tube and its carbon lattice; <b>Array context</b> its row and neighbours.');
    li.push('<b>Water.</b> Drawn as a single file, one molecule per ' + fmt3(P3_ELL) + ' nm, with SPC/E geometry (O–H 0.100 nm, H–O–H 109.47°, the model of the calibration package and of the Water Lab), each molecule donating a hydrogen bond to the next: the ordered water wire that molecular dynamics finds in (6,6) tubes (<a href="https://doi.org/10.1038/35102535">Hummer, Rasaiah and Noworyta, Nature 414, 188, 2001</a>). Only the net transport is drawn; thermal motion and back-and-forth crossings are omitted, so a blocked pore shows no net transport, not frozen water.');
    if (d.T_ns) li.push('<b>Clock.</b> One factor for every tube, set by the baseline’s largest single-pore flow: ' + P3_HOPS + ' molecular spacings per second on screen, so ' + clock + '. Raising ΔP from 1 to 4 MPa makes every chain move 4 × faster.');
    if (uTube > 0 && Jf > 0) li.push('<b>Speed.</b> At ' + fmt3(toMolNs(qOpen)) + ' molecules/ns the drawn chain advances at ' + sig3(uTube) + ' m/s, ' + fmt3(uTube / Jf) + ' × the superficial velocity J = ' + fmt3(Jf) + ' m/s of its face. For a face of identical open pores the ratio is the membrane area per pore, ' + fmt3(aPitch) + ' nm², divided by the chain’s effective cross-section v_w/ℓ = ' + fmt3(aChain) + ' nm² (one ' + fmt3(vwNm3) + ' nm³ molecule per ' + fmt3(P3_ELL) + ' nm): ' + fmt3(aPitch / aChain) + ', a number set by the assumed spacing ℓ. The carbon-centre opening, ' + fmt3(aOpen) + ' nm², would give ' + fmt3(aPitch / aOpen) + ': the water occupies only the centre of the tube.');
    li.push('<b>Fluctuations.</b> The same pore law implies an equilibrium collective diffusion of the net crossing count D_N = G k_B T / v_w² = ' + fmt3(DN) + ' ns⁻¹ at ' + fmt3(Tk) + ' K: in 1 ns the count wanders by about √(2 D_N t) = ' + fmt3(Math.sqrt(2 * DN)) + ' molecules, against a net drift of ' + fmt3(toMolNs(G0 * 1e6)) + ' molecules per ns at 1 MPa. Molecular dynamics therefore measures G from equilibrium fluctuations or at 50–200 MPa, and the calibration analysis accepts the low-pressure range only if the two agree.');
    li.push('<b>Scope.</b> Neighbouring tubes interact only hydraulically, through the chamber water drawn as a continuum; molecular interactions between tubes (for example carbon polarization) are not modelled and would enter through G_i.');
    li.push('<b>Controls.</b> Drag to rotate, scroll or pinch to zoom, double-click to return to the chosen view; with the view focused, arrow keys rotate and <kbd>+</kbd> / <kbd>−</kbd> zoom. Click a tube to select it.');
    el.p3.how.innerHTML = '<ul class="cl-p3-how-list"><li>' + li.join('</li><li>') + '</li></ul>';
  }

  function drawGeometry() {
    const dev = device();
    flow.setGeometry(dev); flow.setSelection(selectionForViews());
    membrane.setGeometry(dev); membrane.setSelection(selectionForViews());
    renderTube(); renderStateLine(); updatePores();
  }

  /* ---------------------------------------------------------------- guided path */
  /* Six steps a visitor can follow in about a minute: run, raise the pressure (fixed colour scale, so the flow visibly
     speeds up), block the centre patch against the new baseline, compare, block one tube instead to see what the
     scope means, then watch the tubes in 3D. Each step changes inputs through the same controls a visitor uses; the
     button waits for the result. */
  const scrollOpt = () => ({ block: 'nearest', behavior: V.reduceMotion ? 'auto' : 'smooth' });
  const GUIDE = [
    { text: () => 'Run the experiment: ' + fmtInt(poreCounts(S.sc).total) + ' tubes at ΔP = 1 MPa (earlier changes of pressure and membrane are cleared). This result becomes the baseline.',
      act: () => {
        setView('flow', false); if (narrow.matches) setTab('flow');
        const dirty = S.sc.dP_Pa !== 1e6 || JSON.stringify(S.sc.mods) !== JSON.stringify(MM.emptyModifications());
        if (dirty) { el.dp.value = '1'; S.sc.dP_Pa = 1e6; S.sc.mods = MM.emptyModifications(); }
        const makeBase = () => { if (S.result) { setBaseline(S.result, false); render(); } };
        if (!S.started) el.run.click();                                           // the first result becomes the baseline
        else if (dirty) { S.guide.after = makeBase; changed('guided-start', { dP_Pa: 1e6, mods: 'cleared' }); }
        else if (S.result && (!S.baseline || S.baseline.revision !== S.result.revision)) makeBase();
      } },
    { text: () => 'Raise the pressure from 1 to 4 MPa. Colours and tracers keep the baseline’s scale, so the flow visibly speeds up; Q rises in proportion (Stokes flow, linear pore law).',
      act: () => { setView('flow', false); if (narrow.matches) setTab('flow'); el.dp.value = '4'; S.sc.dP_Pa = 4e6; changed('pressure', { dP_Pa: 4e6, guided: true }); } },
    { text: () => 'Block a patch: the 4 MPa state becomes the baseline, then the centre patch under the inlet is closed (' + fmtInt(patchPores(centrePatch())) + ' tubes).',
      act: () => { if (S.result) { setBaseline(S.result, false); render(); } const c = centrePatch(); S.sel.patch = c; S.sel.scope = 'patch'; applyChange(scopeObject('patch'), 0, 'block-patch'); if (narrow.matches) setTab('membrane'); else setView('membrane', true); } },
    { text: () => 'Compare with the baseline: the table gives ΔQ, the affected pores and the largest flux change elsewhere; the map shows the change of flux on every face.',
      act: () => { if (!S.compare) el.compare.click(); const c = $('.cl-compare-card'); if (c) c.scrollIntoView(scrollOpt()); } },
    { text: () => 'One tube, one patch or the whole membrane: block a single tube instead. It changes one term of one face’s conductance sum, so Q falls by about one part in ' + fmtInt(poreCounts(S.sc).total) + '; a patch scales every face under it, the whole membrane every face.',
      act: () => {
        const c3 = comparison(); S.guide.patch = c3 && c3.sameDev ? { rel: c3.rel, affected: c3.affected } : null;   // the closed patch of step 3, for the summary
        S.sc.mods = MM.emptyModifications(); defaultSelection(); S.sel.scope = 'tube';
        S.sc.mods = MM.applyScopedChange(S.sc.mods, scopeObject('tube'), 0);
        changed('block-tube', { guided: true, tube: S.sel.tube }); S.guide.tubeRevision = S.revision;
        if (narrow.matches) setTab('membrane'); else setView('membrane', false);
        setMemMode('zoom'); el.why.open = true; if (el.tubePanel) el.tubePanel.open = true;
      } },
    { text: () => 'Pores in 3D: the tubes around the selected one at true size (' + fmt3(S.manifest.geometries[0].carbonCentreDiameter_m * 1e9) + ' nm wide, ' + fmt3(S.sc.pitch_m * 1e9) + ' nm apart). Net transport stops through the blocked tube while its neighbours carry their computed flow; thermal motion is not drawn. Focus pore shows the carbon lattice and the water chain up close.',
      act: () => { setP3Preset('array'); if (narrow.matches) setTab('pores'); else setView('pores', false); } },
  ];
  /* the guided experiment's result in one sentence: one closed tube against the closed patch of step 3 (computed values) */
  function guideSummary() {
    const c = comparison(), p = S.guide.patch;
    if (!c || !c.sameDev || !S.result || S.result.revision !== S.guide.tubeRevision || !(c.rel < 0)) return '';
    return 'One closed tube changed Q by ' + pct(c.rel) + ' (one part in ' + fmtInt(Math.round(-1 / c.rel)) + ')' +
      (p && p.rel < 0 ? '; the closed patch of step 3 by ' + pct(p.rel) + ' (' + fmtInt(p.affected) + ' tubes)' : '') + '. ';
  }
  function centrePatch() { const dev = device(); return { pi: Math.floor(dev.patches.px / 2), pj: Math.floor(dev.patches.py / 2) }; }
  function guideRender() {
    const s = S.guide.step;
    el.guideSteps.forEach((li, i) => { li.classList.toggle('is-done', i < s); li.classList.toggle('is-now', i === s); if (i === s) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); });
    if (s < 0) { el.guideText.textContent = 'Six steps, about a minute: run, raise the pressure, block a patch, compare, close one tube instead, then watch the water move through the pores in 3D. Each button performs one step; you can also explore freely.'; el.guideDo.textContent = 'Start: run the experiment'; }
    else if (s >= GUIDE.length) { el.guideText.textContent = 'Done. ' + guideSummary() + 'Explore freely: pick tubes and patches, change the conductance, the pressure or the size, and download the experiment.'; el.guideDo.textContent = 'Start again'; }
    else { el.guideText.textContent = 'Step ' + (s + 1) + ' of ' + GUIDE.length + ': ' + GUIDE[s].text(); el.guideDo.textContent = 'Do step ' + (s + 1); }
  }
  function guideDo() {
    if (S.guide.step >= GUIDE.length) S.guide.step = -1;
    if (S.guide.step < 0) S.guide.step = 0;
    const s = S.guide.step;
    GUIDE[s].act(); S.guide.step = s + 1;
    logEvent('guide', { step: s + 1 });
    guideRender();
    if (el.guideDo && S.status !== 'converged' && S.guide.step < GUIDE.length) el.guideDo.disabled = true;   // re-enabled by the next result
  }

  /* ---------------------------------------------------------------- download */
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src)); document.head.appendChild(s); }); }
  function download() {
    if (!S.result) return;
    el.download.disabled = true; el.dlNote.textContent = 'Preparing the download…';
    const need = [];
    if (!window.WaterZip) need.push(loadScript('../water/zip.js'));
    if (!window.ContinuumExport) need.push(loadScript('export.js'));
    Promise.all(need).then(() => window.ContinuumExport.build(S, { version: VERSION })).then((files) => window.WaterZip.makeZip(files)).then((blob) => {
      const a = document.createElement('a'), url = URL.createObjectURL(blob);
      a.href = url; a.download = 'continuum-lab-rev' + S.result.revision + '.zip'; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
      el.dlNote.textContent = 'Saved continuum-lab-rev' + S.result.revision + '.zip (' + fmt3(blob.size / 1024) + ' kB).';
      logEvent('download', { revision: S.result.revision });
    }).catch((e) => { el.dlNote.textContent = 'Download failed: ' + e.message; }).then(() => { el.download.disabled = false; });
  }

  /* ---------------------------------------------------------------- start */
  function fillSizes() {
    const sizes = S.manifest.device.allowedSizes_um;
    const opt = (v, sel) => '<option value="' + v + '"' + (v === sel ? ' selected' : '') + '>' + (v >= 1000 ? v / 1000 + ' mm' : v + ' µm') + '</option>';
    el.W.innerHTML = sizes.map((v) => opt(v, S.manifest.defaultScenario.W_um)).join('');
    el.B.innerHTML = sizes.map((v) => opt(v, S.manifest.defaultScenario.B_um)).join('');
    const check = () => {                                  // allowed aspect ratios 1, 2 and 4: disable other depths
      const W = parseFloat(el.W.value);
      Array.from(el.B.options).forEach((o) => { const a = Math.max(W, +o.value) / Math.min(W, +o.value); o.disabled = [1, 2, 4].every((x) => Math.abs(x - a) > 1e-9); });
      if (el.B.selectedOptions[0] && el.B.selectedOptions[0].disabled) el.B.value = String(W);
    };
    el.W.addEventListener('change', check, true); check();
  }
  Promise.all([fetch('data/manifest.json').then((r) => r.json()), fetch('data/mesh-check.json').then((r) => (r.ok ? r.json() : null)).catch(() => null)]).then(([man, mesh]) => {
    S.manifest = man; S.meshTable = mesh;
    S.law = PL.buildPoreLaw(man.laws[0]);
    S.sc = SC.makeScenario(man);
    defaultSelection(); fillSizes(); bindControls(); applyLayout(); drawGeometry(); refreshControls(); guideRender(); renderDecision();
    el.guideDo.addEventListener('click', guideDo);
    el.guideSkip.addEventListener('click', () => { S.guide.step = GUIDE.length; guideRender(); });
    renderCompare(null); renderWhy(null);
    app.classList.add('is-ready');
  }).catch((e) => { setStatus('failed', 'The lab could not load its manifest: ' + e.message); });
})();
