/* Continuum Lab — ion experiment: page logic. Nothing is computed or loaded before the visitor starts: the solver
   (core.js, params.js, in a Web Worker), the charts and the 3D view (ions3d.js with three.js) are requested on Start.
   Every number on the page comes from the worker's solution of the selected model; sentences are assembled from
   those numbers. The numerical controller (controller.js, run by the worker) checks the displayed current and reversal
   potential on finer grids; its decisions fill the panel "What limits this prediction?". */
(function () {
  'use strict';
  const root = document.getElementById('ion-lab');
  if (!root) return;
  const $ = (s) => root.querySelector(s), $$ = (s) => Array.from(root.querySelectorAll(s)), d$ = (s) => document.querySelector(s);
  const RM = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const VERSION = root.getAttribute('data-version') || '';
  const V_W = 2.991506e-26 / 996.557;                               // m³ per water molecule (m_w / ρ at 300 K)
  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  const sci = (x, p) => { if (!isFinite(x)) return '–'; if (x === 0) return '0'; const e = Math.floor(Math.log10(Math.abs(x))); if (e >= -2 && e < 4) return Number(x.toPrecision(p || 3)).toString(); const m = x / Math.pow(10, e); return m.toFixed((p || 3) - 1) + ' × 10' + String(e).split('').map((c) => SUP[c]).join(''); };
  const f3 = (x) => (isFinite(x) ? (Math.abs(x) >= 1e4 || (Math.abs(x) < 1e-3 && x !== 0) ? sci(x, 3) : Number(x.toPrecision(3)).toString()) : '–');
  const pA = (I) => f3(I * 1e12) + ' pA';
  const mV = (V) => (V > 0 ? '+' : V < 0 ? '−' : '') + Math.abs(Math.round(V * 1000)) + ' mV';
  const mV3 = (V) => (isFinite(V) ? (V > 0 ? '+' : V < 0 ? '−' : '') + Number(Math.abs(V * 1000).toPrecision(3)) + ' mV' : '–');   // reversal potentials
  const pct = (x) => (isFinite(x) ? (100 * x).toPrecision(3) + ' %' : '–');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const molns = (Q) => Q / V_W * 1e-9;                                // water molecules per ns
  const share = (x) => (!isFinite(x) ? '–' : x > 0.9999 ? '> 99.99 %' : x > 0.99 ? (100 * x).toFixed(2) + ' %' : x < 1e-4 && x > 0 ? '< 0.01 %' : pct(x));

  const S = {
    opts: { preset: '7,7', step: 6, V: 0.1, c: 100, solvation: 'cp2k', lining: 'carbon', epsP: 30, rimN: 2, Dratio: 0.5, slip: 10, target: 'standard' },
    started: false, req: 0, res: {}, overlay: 'conc', species: 0, prof: 'c', cam: 'pore', playing: !RM, guide: -1, hyd: null,
    worker: null, view: null, viewState: 'none', timer: 0, times: {},
  };
  const el = {
    run: $('.ion-run'), posterRun: $('.ion-poster-run'), reset: $('.ion-reset'), state: $('#ion-state'), qline: $('.ion-qline'),
    V: $('#ion-V'), Vout: $('#ion-V-out'), steps: $$('input[name="ion-step"]'), preset: $('#ion-preset'), closures: $$('input[name="ion-closure"]'),
    closureField: $('#ion-closure-field'), lining: $('#ion-lining'), liningRow: $('.ion-lining-row'), eps: $('#ion-eps'), epsRow: $('.ion-eps-row'),
    c: $('#ion-c'), rim: $('#ion-rim'), D: $('#ion-D'), slip: $('#ion-slip'), settingsNow: $('#ion-settings-now'),
    dlJson: $('.ion-dl-json'), dlCsv: $('.ion-dl-csv'), dlNote: $('.ion-dl-note'),
    closureChip: $('#ion-closure-chip'), I: $('#ion-I'), Is: $('#ion-I-s'), G: $('#ion-G'), Gs: $('#ion-G-s'), P: $('#ion-P'), Ps: $('#ion-P-s'), Q: $('#ion-Q'), Qs: $('#ion-Q-s'),
    why: $('#ion-why'), flags: $('#ion-flags'), iv: $('#ion-iv'), prof: $('#ion-prof'), hyd: $('#ion-hyd'), next: $('#ion-next'), evidence: $('#ion-evidence'),
    drawer: $('#ion-evidence-drawer'), ladder: $('#ion-ladder-table'), membrane: $('#ion-membrane'), numerics: d$('#ion-numerics'),
    poster: $('.ion-poster'), host: $('.ion-3d-host'), vstatus: $('.ion-vstatus'), fallback: $('.ion-3d-fallback'), legend: $('#ion-legend'),
    camPore: $('.ion-cam-pore'), camDevice: $('.ion-cam-device'), play: $('.ion-play'), resetView: $('.ion-reset-view'),
    overlayBtns: $$('[data-overlay]'), speciesBtns: $$('[data-species]'), profBtns: $$('[data-prof]'), announce: $('.ion-announce'),
    guideDo: $('.ion-guide-do'), guideSkip: $('.ion-guide-skip'), guideText: $('#ion-guide-text'), guideSteps: $$('.cl-guide-steps li'), guide: $('#ion-guide'),
    target: $('#ion-target'), ctrlChip: $('#ion-ctrl-chip'), ctrl: $('#ion-ctrl'), molChip: $('#ion-mol-chip'), request: $('#ion-request'), dlDecision: $('.ion-dl-decision'), liveChip: $('#ion-live-chip'),
  };

  /* ------------------------------------------------------------------ loading */
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('could not load ' + src)); document.head.appendChild(s); });
  }
  let libs = null;
  function ensureLibs() {
    if (!libs) libs = (async () => {
      if (!window.IonCore) await loadScript('ions/core.js');
      if (!window.IonParams) await loadScript('ions/params.js');
      if (!window.IonController) await loadScript('ions/controller.js');
      if (!window.IonCharts) await loadScript('ions/charts.js');
      try { const r = await fetch('ions/data/hydration.json'); if (r.ok) S.hyd = await r.json(); } catch (e) { S.hyd = null; }
    })();
    return libs;
  }
  function ensureWorker() {
    if (S.worker) return;
    S.worker = new Worker('ions/worker.js');
    S.worker.onmessage = onWorker;
    S.worker.onerror = (e) => { setState('failed', 'Failed'); status('The solver could not run: ' + (e.message || 'worker error'), true); };
  }
  function webgl() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }
  function ensureView() {
    if (S.viewState !== 'none') return;
    if (!webgl()) { S.viewState = 'failed'; el.fallback.hidden = false; return; }
    S.viewState = 'loading'; status('Loading the 3D view …');
    loadScript('ions/ions3d.js').then(() => window.IonView3D.create(el.host, { reduceMotion: RM, preset: S.cam })).then((v) => {
      S.view = v; S.viewState = 'ready'; status('');
      v.setOverlay(S.overlay, S.species); v.setPlaying(S.playing); v.setVisible(true);
      [el.camPore, el.camDevice, el.play, el.resetView].forEach((b) => { b.disabled = false; });
      syncPlay();
      if (S.res.main) pushView();
    }).catch((e) => { S.viewState = 'failed'; status(''); el.fallback.hidden = false; if (e && e.code !== 'NO_WEBGL') el.fallback.querySelector('p').textContent = 'The 3D view could not start (' + (e.message || e) + '). The experiment, the charts and the numbers below work without it.'; });
  }

  /* ------------------------------------------------------------------ controls */
  function readControls() {
    const o = S.opts;
    o.V = Number(el.V.value) / 1000;
    const st = el.steps.find((r) => r.checked); o.step = st ? Number(st.value) : 6;
    o.preset = el.preset.value;
    const cl = el.closures.find((r) => r.checked); o.solvation = cl ? cl.value : 'cp2k';
    o.lining = el.lining.value; o.epsP = Number(el.eps.value); o.c = Number(el.c.value); o.rimN = Number(el.rim.value); o.Dratio = Number(el.D.value); o.slip = Number(el.slip.value);
    o.target = el.target.value;
    syncControls();
  }
  function writeControls() {
    const o = S.opts;
    el.V.value = String(Math.round(o.V * 1000));
    el.steps.forEach((r) => { r.checked = Number(r.value) === o.step; });
    el.preset.value = o.preset; el.closures.forEach((r) => { r.checked = r.value === o.solvation; });
    el.lining.value = o.lining; el.eps.value = String(o.epsP); el.c.value = String(o.c); el.rim.value = String(o.rimN); el.D.value = String(o.Dratio); el.slip.value = String(o.slip);
    el.target.value = o.target;
    syncControls();
  }
  function syncControls() {
    const o = S.opts;
    el.Vout.textContent = mV(o.V);
    el.closureField.disabled = o.step < 4;
    el.closureField.classList.toggle('is-off', o.step < 4);
    el.liningRow.hidden = o.solvation === 'born'; el.epsRow.hidden = o.solvation !== 'born';
    el.settingsNow.textContent = (o.c / 1000).toPrecision(3) + ' M · ' + o.rimN + ' COO⁻ per rim · D ×' + o.Dratio + ' · slip ' + o.slip + ' nm';
    $$('.ion-step').forEach((lab) => lab.classList.toggle('is-active', Number(lab.getAttribute('data-step')) <= o.step));
  }
  function schedule(delay) {
    if (!S.started) return;
    clearTimeout(S.timer); S.timer = setTimeout(run, delay || 0);
  }
  el.V.addEventListener('input', () => { readControls(); schedule(160); });
  [el.preset, el.lining, el.eps, el.c, el.rim, el.D, el.slip, el.target].forEach((x) => x.addEventListener('change', () => { readControls(); schedule(0); }));
  el.steps.concat(el.closures).forEach((r) => r.addEventListener('change', () => { readControls(); schedule(0); }));
  el.run.addEventListener('click', () => { readControls(); run(); });
  el.posterRun.addEventListener('click', () => { readControls(); run(); });
  el.reset.addEventListener('click', () => { S.opts = { preset: '7,7', step: 6, V: 0.1, c: 100, solvation: 'cp2k', lining: 'carbon', epsP: 30, rimN: 2, Dratio: 0.5, slip: 10, target: 'standard' }; writeControls(); schedule(0); });

  /* ------------------------------------------------------------------ run */
  async function run() {
    if (!S.started) { S.started = true; el.poster.hidden = true; }
    setState('solving', 'Solving …');
    try { await ensureLibs(); } catch (e) { setState('failed', 'Failed'); status('The solver files could not be loaded: ' + e.message, true); return; }
    ensureWorker(); ensureView();
    S.req++; S.res = { opts: JSON.parse(JSON.stringify(S.opts)), ctrlLevels: [] }; S.times = { start: performance.now() };
    root.classList.add('is-stale');
    el.dlDecision.disabled = true;
    setChip(el.ctrlChip, 'solving', 'Waiting for the result …');
    S.worker.postMessage({ type: 'run', id: S.req, opts: S.opts, version: VERSION });
  }
  function onWorker(ev) {
    const m = ev.data || {};
    if (m.id !== S.req) return;
    const d = m.data;
    S.times[m.stage] = performance.now() - S.times.start;
    if (m.stage === 'main') { S.res.main = d; root.classList.remove('is-stale'); renderMain(); }
    else if (m.stage === 'iv') { S.res.iv = d; renderIV(); }
    else if (m.stage === 'sel') { S.res.sel = d; renderSel(); }
    else if (m.stage === 'ctrl-level') { S.res.ctrlLevels.push(d.entry); renderCtrlProgress(); }
    else if (m.stage === 'ctrl') { S.res.ctrl = d; renderCtrl(); }
    else if (m.stage === 'sens') { S.res.sens = d; renderNext(); }
    else if (m.stage === 'decision') { S.res.decision = d; renderDecision(); }
    else if (m.stage === 'done') { S.res.done = d; finishRun(); }
    else if (m.stage === 'error') { setState('failed', 'Failed'); setChip(el.ctrlChip, 'failed', 'Failed'); status('The solver stopped: ' + d.message, true); }
  }
  function setState(cls, text) { el.state.className = 'cl-state is-' + cls; el.state.textContent = text; }
  function setChip(chip, cls, text) { chip.className = 'cl-state is-' + cls; chip.textContent = text; }
  function status(text, err) { el.vstatus.hidden = !text; el.vstatus.textContent = text || ''; el.vstatus.classList.toggle('is-error', !!err); }

  /* ------------------------------------------------------------------ rendering: main result */
  const STEP_NAMES = ['', 'Classical PNP', '+ charged rims', '+ ion size', '+ solvation', '+ confined mobility', '+ electro-osmosis'];
  function renderMain() {
    const d = S.res.main, o = d.opts, m = d.model, Ld = d.ladder;
    // numerical status: decided by the controller after the grid check (renderCtrl); the model domain is in the flags
    setState('solving', 'Checking the grid …');
    el.liveChip.hidden = false;
    el.closureChip.hidden = false; el.closureChip.textContent = o.step >= 4 ? 'Illustrative molecular closure' : 'No molecular closure'; el.closureChip.classList.toggle('is-none', o.step < 4);
    el.I.textContent = pA(m.I);
    el.Is.textContent = 'Na⁺ ' + pA(m.Ispecies[0]) + ' · Cl⁻ ' + pA(m.Ispecies[1]) + ' at ' + mV(o.V);
    if (o.V !== 0) { el.G.textContent = f3(Math.abs(m.I / o.V) * 1e12) + ' pS'; el.Gs.textContent = 'Na⁺ carries ' + (m.I !== 0 ? share(m.Ispecies[0] / m.I) : '–') + ' of the current'; }
    else { el.G.textContent = '–'; el.Gs.textContent = 'set a voltage other than 0'; }
    if (o.step >= 6) { el.Q.textContent = f3(molns(m.Q)) + ' /ns'; el.Qs.textContent = 'water molecules per ns, ' + (m.Q >= 0 ? 'towards the permeate' : 'towards the feed') + ' · slip ' + o.slip + ' nm'; }
    else { el.Q.textContent = '–'; el.Qs.textContent = 'no water flow before step 6'; }
    el.P.textContent = '…'; el.Ps.textContent = 'computing the reversal potential';
    el.qline.innerHTML = '<b>' + esc(pA(m.I)) + '</b> at ' + esc(mV(o.V)) + ' · ' + esc(STEP_NAMES[o.step]) + ' · ' + esc(IonParams.presetOf(o.preset).label) + ' tube';
    el.why.textContent = whySentence(d);
    el.flags.innerHTML = m.flags.map((f) => '<li class="ion-flag is-' + f.level + '"><span class="cl-pass ' + (f.level === 'outside' ? 'is-fail' : f.level === 'caution' ? 'is-warn' : 'is-na') + '">' + ({ outside: 'outside domain', caution: 'caution', info: 'regime' })[f.level] + '</span> ' + esc(f.text) + '</li>').join('');
    renderProfiles(); renderHydration(); renderEvidence(); renderLadder(); renderMembrane(); renderNumerics();
    el.announce.textContent = 'Current ' + pA(m.I) + ' at ' + mV(o.V) + ', ' + STEP_NAMES[o.step] + '.';
    if (S.view) pushView();
    guideAfterRun();
  }
  function whySentence(d) {
    const o = d.opts, L = d.ladder, cur = L[o.step - 1], prev = o.step > 1 ? L[o.step - 2] : null, at = ' at ' + mV(o.V);
    const shr = (r) => (r.I !== 0 ? r.INa / r.I : NaN);
    if (o.V === 0) return 'At 0 mV with equal reservoirs no net current or water flow can occur: the solution is the equilibrium state of the selected model (see the profiles).';
    if (!prev) return 'Classical model: bulk diffusivities, point ions, no charge on the pore. It carries ' + pA(cur.I) + at + ', ' + share(shr(cur)) + ' of it by Na⁺ (its diffusivity is lower than that of Cl⁻). This is the reference curve on the charts.';
    const sv = d.solvation, closure = { cp2k: 'recorded CP2K shells', shell: 'rigid-shell geometry', born: 'Born dielectric exclusion, ε = ' + o.epsP }[o.solvation];
    const what = {
      2: 'Charging the rims (' + o.rimN + ' COO⁻ per rim)',
      3: 'Adding finite ion size (d = ' + IonParams.DEFAULTS.ionSize + ' nm)',
      4: 'Adding the solvation penalty (Na⁺ ' + f3(cur.dG[0] / IonParams.RTkJ) + ' RT, Cl⁻ ' + f3(cur.dG[1] / IonParams.RTkJ) + ' RT; ' + closure + ')',
      5: 'Reducing the mobility in the pore (D × ' + o.Dratio + ')',
      6: 'Letting the water move (electro-osmosis, slip ' + o.slip + ' nm)',
    }[o.step];
    const ch = prev.I !== 0 ? cur.I / prev.I - 1 : NaN;
    const both = shr(prev) > 0.99 && shr(cur) > 0.99;
    let s = what + ' changed the current' + at + ' from ' + pA(prev.I) + ' to ' + pA(cur.I) + (isFinite(ch) ? ' (' + (ch >= 0 ? '+' : '−') + pct(Math.abs(ch)) + ')' : '') +
      (both ? '; the fraction of it carried by Cl⁻ went from ' + sci(1 - shr(prev), 2) + ' to ' + sci(1 - shr(cur), 2) + '.' : ' and the Na⁺ share from ' + share(shr(prev)) + ' to ' + share(shr(cur)) + '.');
    if (o.step === 2 || o.step === 4) s += ' Mean number of ions in the pore: Na⁺ ' + f3(prev.nNa) + ' → ' + f3(cur.nNa) + ', Cl⁻ ' + f3(prev.nCl) + ' → ' + f3(cur.nCl) + '.';
    if (o.step === 4 && cur.nNa > 0.5 * prev.nNa && cur.dG[0] > 0 && o.rimN > 0) s += ' Na⁺ largely stays despite its penalty: it compensates the rim charge, and the potential at the pore centre falls by ' + f3(Math.abs(cur.phiC - prev.phiC) * 1000) + ' mV, which draws it back in.';
    if (o.step === 3) s += ' Largest packing fraction ' + f3(cur.pack) + ' (was 0).';
    if (o.step === 5) s += ' Both ions move ' + f3(1 / o.Dratio) + ' times more slowly inside the pore.';
    if (o.step === 6) s += ' The force on the excess Na⁺ drives ' + f3(molns(cur.Q)) + ' water molecules per ns through the pore; advection carries ' + (cur.I !== 0 ? pct(cur.Iadv / cur.I) : '–') + ' of the current at the pore centre.';
    return s;
  }

  /* ------------------------------------------------------------------ numerical controller and decision record */
  const CHIP = { tolerance_reached: 'converged', budget_exhausted: 'warn', not_converged: 'failed', check_failed: 'failed', refused: 'failed' };
  const pA5 = (I) => (I !== null && isFinite(I) ? (I * 1e12).toPrecision(5) : '–');
  const mV5 = (V) => (V === null || !isFinite(V) ? '–' : (V > 0 ? '+' : V < 0 ? '−' : '') + Math.abs(V * 1000).toFixed(4));
  const chgTxt = (c) => (!c ? '–' : (c.mode === 'absolute_floor' ? '< 10⁻¹⁶ A' : c.current_rel === null ? '–' : (100 * c.current_rel).toPrecision(3) + ' %') + (c.V_rev_V !== null ? ' · ' + Number((c.V_rev_V * 1000).toPrecision(3)) + ' mV' : ''));
  function decisionTxt(e, rec) {
    if (e.decision === 'compare') return 'Compare with level ' + (e.level + 1);
    if (e.decision === 'refine') return 'Outside the target: refine to level ' + (e.level + 1);
    if (e.rule === 4) return 'Within the target: stop';
    if (e.rule === 6) return 'Outside the target, end of budget: stop';
    return 'Gate ' + e.failed_gate + ' failed: stop';
  }
  function levelsTable(levels, out) {
    return '<div class="cl-table-wrap"><table class="cl-table ion-ctrl-table"><thead><tr><th scope="col">Level</th><th scope="col">Nodes</th><th scope="col">I (pA)</th><th scope="col">V<sub>rev</sub> (mV)</th><th scope="col">Change from the level before</th><th scope="col">Decision</th></tr></thead><tbody>' +
      levels.map((e) => '<tr' + (out && out.reported_level === e.level ? ' class="is-current"' : '') + '><th scope="row">' + e.level + (out && out.reported_level === e.level ? ' (reported)' : '') + '</th><td>' + e.nodes + '</td><td>' + esc(pA5(e.I_A)) + '</td><td>' + esc(mV5(e.V_rev_V)) + '</td><td>' + esc(chgTxt(e.change)) + '</td><td>' + esc(decisionTxt(e)) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<ol class="ion-cards ion-ctrl-cards">' + levels.map((e) => '<li' + (out && out.reported_level === e.level ? ' class="is-current"' : '') + '><p class="ion-card-h"><b>Grid level ' + e.level + (out && out.reported_level === e.level ? ' (reported)' : '') + '</b><span class="cl-small">' + e.nodes + ' nodes</span></p>' +
        '<p>I ' + esc(pA5(e.I_A)) + ' pA · V<sub>rev</sub> ' + esc(mV5(e.V_rev_V)) + ' mV</p>' + (e.change ? '<p class="cl-small">Change from level ' + (e.level - 1) + ': ' + esc(chgTxt(e.change)) + '</p>' : '') + '<p><b>' + esc(decisionTxt(e)) + '</b></p></li>').join('') + '</ol>';
  }
  const bare = (msg, st) => { const t = IonController.STATUS_TEXT[st], r = msg.indexOf(t) === 0 ? msg.slice(t.length).replace(/^[:\s]+/, '') : msg; return r.charAt(0).toUpperCase() + r.slice(1); };
  function targetTxt() {
    const t = IonController.TARGETS[S.res.opts.target] || IonController.TARGETS.standard;
    return 'Target ' + t.label + ' (change between grid levels: current ≤ ' + t.label + ', reversal potential ≤ ' + Number((IonController.V_PER_T * t.t * 1000).toPrecision(3)) + ' mV) · budget: grid levels 1–' + IonController.MAX_LEVEL + ' · gates G1–G4';
  }
  function renderCtrlProgress() {
    const L = S.res.ctrlLevels, last = L[L.length - 1];
    setChip(el.ctrlChip, 'solving', last && last.decision !== 'stop' ? 'Checking grid level ' + (last.level + 1) + ' …' : 'Checking …');
    el.ctrl.innerHTML = '<p class="ion-ctrl-msg">' + esc(last ? last.reason : '') + '</p>' + levelsTable(L, null);
  }
  function renderCtrl() {
    const n = S.res.ctrl.numerical, out = n.outcome, st = out.status, text = IonController.STATUS_TEXT[st];
    setState(CHIP[st], text); setChip(el.ctrlChip, CHIP[st], text);
    el.ctrl.innerHTML = '<p class="ion-ctrl-msg">' + esc(bare(out.message, st)) + '</p>' + (n.levels.length ? levelsTable(n.levels, out) : '') + '<p class="cl-small">' + esc(targetTxt()) + ' · rule set ' + esc(IonController.POLICY.version) + ' · <a href="#controller">thresholds and rules</a></p>';
    // tiles: when the reported level is not the screening level, show the reported values and say so; when no result is
    // certified (a failed gate), the screening values stay and are marked as not certified
    const m = S.res.main;
    if (m && (st === 'not_converged' || st === 'check_failed')) {
      const note = 'screening grid, not certified: ' + text.toLowerCase();
      el.Is.textContent = note; el.Gs.textContent = note;
      el.Ps.insertAdjacentHTML('beforeend', ' · <b>' + esc(note) + '</b>');
      el.qline.insertAdjacentHTML('beforeend', ' · <b>not certified</b>');
    }
    if (m && out.reported_level && out.reported_level !== 1 && out.I_A !== null) {
      const o = m.opts, lv = n.levels[out.reported_level - 1], note = (st === 'tolerance_reached' ? 'refined' : 'finest grid, not certified') + ': grid level ' + out.reported_level + ' (' + lv.nodes + ' nodes)';
      el.I.textContent = pA(out.I_A); el.Is.textContent = note;
      if (o.V !== 0) { el.G.textContent = f3(Math.abs(out.I_A / o.V) * 1e12) + ' pS'; el.Gs.textContent = 'G at grid level ' + out.reported_level + '; ' + el.Gs.textContent + ' on the screening grid'; }
      el.qline.innerHTML = '<b>' + esc(pA(out.I_A)) + '</b> at ' + esc(mV(o.V)) + ' · ' + esc(STEP_NAMES[o.step]) + ' · ' + esc(IonParams.presetOf(o.preset).label) + ' tube · grid level ' + out.reported_level;
      if (out.V_rev_V !== null) { const sv = IonParams.selectivity(o, out.V_rev_V); el.P.textContent = mV3(out.V_rev_V); el.Ps.innerHTML = 'GHK-equivalent Na⁺/Cl⁻ selectivity <b>' + esc(sv.text) + '</b> · ' + esc(note); }
    }
    el.announce.textContent = text + '.';
  }
  const MOL = { illustrative_closure: ['Illustrative closure', 'ion-mol-ill'], illustrative_inputs: ['Illustrative inputs', 'ion-mol-ill'], no_ranked_inputs: ['No ranked inputs', 'ion-mol-none'] };
  function renderDecision() {
    const rec = S.res.decision.record, me = rec.molecular_evidence, rq = rec.request, mc = MOL[me.inputs_status] || ['–', 'ion-mol-none'];
    el.molChip.className = 'cl-state ' + mc[1]; el.molChip.textContent = mc[0];
    if (rq) {
      el.request.innerHTML = '<div class="ion-request"><p class="ion-request-h"><span class="cl-pass is-warn">Calculation request · not run</span></p>' +
        '<p><b>' + esc(rq.input) + '</b> (' + esc(rq.range) + ') has the largest one-at-a-time sensitivity: across that range the current at +100 mV changes by a factor of ' + esc(f3(rq.sensitivity_factor)) + '.</p>' +
        '<p>A calculation that could constrain it: ' + esc(rq.calculation) + '.</p>' +
        '<p class="cl-small">Not run; nothing is submitted from this page. Basis: one-at-a-time sensitivity on the screening grid, not expected information gain (full ranking under “Sensitivity ranking”).</p></div>';
    } else {
      el.request.innerHTML = '<p class="cl-small">' + esc(me.request_rule) + (me.top_input ? ' Largest sensitivity: ' + esc(me.top_input.name) + ' (factor ' + esc(f3(me.top_input.factor)) + ').' : '') + '</p>';
    }
    el.dlDecision.disabled = false;
  }

  /* ------------------------------------------------------------------ charts */
  const C = () => window.IonCharts.COLORS;
  // charts are drawn at the width of their card (300–640 px), so axis text keeps its size on a phone
  const size = (host, ratio, hMin, hMax) => { const w = Math.round(Math.max(300, Math.min(640, (host && host.clientWidth) || 560))); return { w, h: Math.round(Math.max(hMin, Math.min(hMax, w * ratio))) }; };
  function renderIV() {
    const d = S.res.iv, m = S.res.main; if (!d || !m) return;
    const o = m.opts, V = d.V.map((v) => v * 1000);
    const series = [
      { pts: V.map((v, i) => [v, d.reference[i].I * 1e12]), color: C().ref, width: 2, name: 'Classical reference' },
      { pts: V.map((v, i) => [v, d.model[i].Ispecies[0] * 1e12]), color: C().na, dash: '6 4', width: 1.8, name: 'Na⁺ (this model)' },
      { pts: V.map((v, i) => [v, d.model[i].Ispecies[1] * 1e12]), color: C().cl, dash: '2 3', width: 1.8, name: 'Cl⁻ (this model)' },
      { pts: V.map((v, i) => [v, d.model[i].I * 1e12]), color: C().model, width: 2.6, name: 'Total (this model)' },
    ];
    let lo = Infinity, hi = -Infinity; series.forEach((s) => s.pts.forEach((p) => { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }));
    const pad = 0.06 * (hi - lo || 1);
    const sz = size(el.iv, 0.56, 230, 300);
    const svg = IonCharts.lineChart({ id: 'ioniv', w: sz.w, h: sz.h, x: { lo: -200, hi: 200, label: 'voltage V (mV)', ticks: [-200, -100, 0, 100, 200] }, y: { lo: lo - pad, hi: hi + pad, label: 'current I (pA)' }, series, point: { x: o.V * 1000, y: m.model.I * 1e12 },
      aria: 'Current–voltage curves from −200 to +200 mV. At +200 mV this model gives ' + f3(d.model[d.model.length - 1].I * 1e12) + ' pA and the classical reference ' + f3(d.reference[d.reference.length - 1].I * 1e12) + ' pA.' });
    const leg = IonCharts.legend(series.slice().reverse().map((s) => ({ color: s.color, dash: s.dash, width: s.width, name: s.name })).concat([{ color: C().mark, marker: true, width: 0, name: 'set voltage' }]));
    const ratio = d.reference[d.reference.length - 1].I !== 0 ? d.model[d.model.length - 1].I / d.reference[d.reference.length - 1].I : NaN;
    el.iv.innerHTML = svg + leg + '<p class="cl-small">Same pore, same reservoirs (' + (o.c / 1000).toPrecision(3) + ' M on both sides). At +200 mV this model carries ' + f3(ratio) + ' times the classical current. Solved at 17 voltages in ' + (d.ms / 1000).toFixed(2) + ' s on the screening grid (level 1).</p>';
  }
  function renderProfiles() {
    const d = S.res.main; if (!d || !window.IonCharts) return;
    const m = d.model, r = d.reference, o = d.opts, xw = 8;
    const sel = (sol, f) => { const out = []; sol.x.forEach((x, k) => { const xn = x * 1e9; if (Math.abs(xn) <= xw) out.push([xn, f(k)]); }); return out; };
    let spec;
    const psz = size(el.prof, 0.56, 230, 300); S.chartW = el.prof.clientWidth;
    const half = o.L ? o.L / 2 : 2.5, band = [{ x0: -half, x1: half, label: 'pore' }];
    if (S.prof === 'c') {
      const series = [
        { pts: sel(r, (k) => r.c[0][k] / 1000), color: C().na, dash: '3 3', width: 1.2, name: 'Na⁺ classical' }, { pts: sel(r, (k) => r.c[1][k] / 1000), color: C().cl, dash: '3 3', width: 1.2, name: 'Cl⁻ classical' },
        { pts: sel(m, (k) => m.c[0][k] / 1000), color: C().na, width: 2.4, name: 'Na⁺ this model' }, { pts: sel(m, (k) => m.c[1][k] / 1000), color: C().cl, width: 2.4, name: 'Cl⁻ this model' },
      ];
      let lo = Infinity, hi = 0; series.forEach((s) => s.pts.forEach((p) => { if (p[1] > 0) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); } }));
      lo = Math.max(lo, hi * 1e-8);
      spec = { id: 'ionpc', w: psz.w, h: psz.h, x: { lo: -xw, hi: xw, label: 'position along the axis x (nm); feed left, permeate right' }, y: { lo, hi, log: true, label: 'concentration (M)' }, series, bands: band, aria: 'Concentration profiles of Na⁺ and Cl⁻ along the pore axis, logarithmic scale.' };
      el.prof.innerHTML = IonCharts.lineChart(spec) + IonCharts.legend(series.map((s) => ({ color: s.color, dash: s.dash, width: s.width, name: s.name })));
    } else if (S.prof === 'phi') {
      const series = [{ pts: sel(r, (k) => r.phi[k] * 1000), color: C().ref, width: 2, name: 'classical' }, { pts: sel(m, (k) => m.phi[k] * 1000), color: C().model, width: 2.4, name: 'this model' }];
      let lo = Infinity, hi = -Infinity; series.forEach((s) => s.pts.forEach((p) => { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }));
      const pad = 0.08 * (hi - lo || 10);
      spec = { id: 'ionpp', w: psz.w, h: psz.h, x: { lo: -xw, hi: xw, label: 'position along the axis x (nm); feed left, permeate right' }, y: { lo: lo - pad, hi: hi + pad, label: 'potential φ (mV)' }, series, bands: band, aria: 'Electric potential along the pore axis.' };
      el.prof.innerHTML = IonCharts.lineChart(spec) + IonCharts.legend(series.map((s) => ({ color: s.color, width: s.width, name: s.name })));
    } else {
      const RT = IonParams.RT;
      const series = [{ pts: sel(m, (k) => m.muEx[0][k] / RT), color: C().na, width: 2.4, name: 'Na⁺' }, { pts: sel(m, (k) => m.muEx[1][k] / RT), color: C().cl, width: 2.4, dash: '6 3', name: 'Cl⁻' }];
      let hi = 0.5; series.forEach((s) => s.pts.forEach((p) => { hi = Math.max(hi, p[1]); }));
      spec = { id: 'ionpm', w: psz.w, h: psz.h, x: { lo: -xw, hi: xw, label: 'position along the axis x (nm); feed left, permeate right' }, y: { lo: -0.05 * hi, hi: hi * 1.1, label: 'excess free energy μ_ex / RT' }, series, bands: band, aria: 'Excess free energy of each ion along the axis.' };
      el.prof.innerHTML = IonCharts.lineChart(spec) + IonCharts.legend(series.map((s) => ({ color: s.color, dash: s.dash, width: s.width, name: s.name }))) +
        '<p class="cl-small">Crowding and solvation only: the electrostatics of the rims and of the ions is in the potential, not here, so it is not counted twice. ' + (o.step < 3 ? 'Zero in this model step.' : '') + '</p>';
    }
  }
  let rz = 0;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { const w = el.prof.clientWidth; if (!S.res.main || !window.IonCharts || Math.abs(w - (S.chartW || 0)) < 24) return; renderProfiles(); renderHydration(); if (S.res.iv) renderIV(); }, 200); });
  el.profBtns.forEach((b) => b.addEventListener('click', () => { S.prof = b.getAttribute('data-prof'); el.profBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b))); renderProfiles(); }));

  function renderHydration() {
    if (!S.hyd || !window.IonCharts) return;
    const o = S.res.main.opts, P = IonParams;
    const tubes = S.hyd.tubes.map((t) => {
      const id = t.n + ',' + t.n, g = P.geometry(P.presetOf(id)), na = t.ions['Na+'], cl = t.ions['Cl-'];
      return { id, label: t.label, sub: t.diameter_nm.toFixed(3) + ' nm', na: { rec: na.mean_count, lo: Math.min(...na.block_means_5), hi: Math.max(...na.block_means_5), shell: P.REF.nNa * P.shellFraction(P.R_SHELL.Na, g.Rw) },
        cl: { rec: cl.mean_count, lo: Math.min(...cl.block_means_5), hi: Math.max(...cl.block_means_5), shell: P.REF.nCl * P.shellFraction(P.R_SHELL.Cl, g.Rw) } };
    });
    const sel = tubes.find((t) => t.id === o.preset);
    const hsz = size(el.hyd, 0.47, 220, 260);
    el.hyd.innerHTML = IonCharts.hydrationChart({ tubes, selected: o.preset, w: hsz.w, h: hsz.h, aria: 'First-shell water counts recorded with CP2K for the four tubes, and the rigid-shell estimate. In the ' + sel.label + ' tube: Na⁺ ' + f3(sel.na.rec) + ' recorded, ' + f3(sel.na.shell) + ' rigid shell; Cl⁻ ' + f3(sel.cl.rec) + ' recorded, ' + f3(sel.cl.shell) + ' rigid shell.' }) +
      IonCharts.legend([{ color: C().na, width: 0, marker: true, name: 'Na⁺ recorded (filled) / rigid shell (open)' }, { color: C().cl, width: 0, marker: true, name: 'Cl⁻ recorded / rigid shell' }]);
  }

  /* ------------------------------------------------------------------ selectivity, ranking, evidence, ladder */
  function renderSel() {
    const d = S.res.sel, o = S.res.main.opts, sv = d.model.sel, rs = d.reference.sel;
    el.flags.querySelectorAll('.is-apparent, .is-ghk').forEach((x) => x.remove());
    if (!sv || sv.status === 'not_found') { el.P.textContent = '–'; el.Ps.textContent = 'reversal potential not found'; return; }
    el.P.textContent = mV3(d.model.V);
    const near = { nernst_na: ' (at the Na⁺ Nernst potential)', nernst_cl: ' (at the Cl⁻ Nernst potential)' }[sv.status] || '';
    el.Ps.innerHTML = 'GHK-equivalent Na⁺/Cl⁻ selectivity <b>' + esc(sv.text) + '</b>' + esc(near) + ' · gradient ' + esc((o.c / 1000).toPrecision(3)) + ' | ' + esc((o.c / 10000).toPrecision(3)) +
      ' M; the I–V curve uses equal reservoirs · classical ' + esc(mV3(d.reference.V)) + ' (' + esc(rs ? rs.text : '–') + ')';
    if (sv.status === 'invalid') el.flags.insertAdjacentHTML('beforeend', '<li class="ion-flag is-ghk"><span class="cl-pass is-warn">GHK</span> The reversal potential lies ' + esc(f3(sv.beyond * 1e6)) + ' µV beyond the ' + (d.model.V < 0 === sv.nernstNa < 0 ? 'Na⁺' : 'Cl⁻') + ' Nernst potential of the reservoirs: no positive GHK permeability ratio reproduces it, so no GHK-equivalent selectivity is given.</li>');
    if (o.step >= 6 && d.model.Q) el.flags.insertAdjacentHTML('beforeend', '<li class="ion-flag is-apparent"><span class="cl-pass is-na">flow</span> At zero current under the 10:1 gradient water still moves (' + esc(f3(Math.abs(molns(d.model.Q)))) + ' molecules per ns ' + (d.model.Q < 0 ? 'towards the concentrated feed' : 'towards the permeate') + ') and carries ions with it; the GHK-equivalent ratio includes this coupling.</li>');
  }
  function renderNext() {
    const d = S.res.sens;
    if (!d.rows.length) { el.next.innerHTML = '<p class="cl-small">The classical model has no inputs with a stated range to rank: its inputs are settings, literature and derived values, the recorded tube radius and the fixed 5 nm pore length (an illustrative geometric setting of the experiment). Add a step to rank the sensitivity of the current to stated input ranges.</p>'; return; }
    const top = d.rows[0];
    el.next.innerHTML = '<p>Largest sensitivity: <b>' + esc(top.name) + '</b> (' + esc(top.range) + ') changes the current at +100 mV by a factor of ' + f3(top.factor) + '. A molecular calculation that could constrain it: ' + esc(top.calc) + '.</p>' +
      '<div class="cl-table-wrap"><table class="cl-table"><thead><tr><th scope="col">#</th><th scope="col">Input</th><th scope="col">Range</th><th scope="col">I(+100 mV)</th><th scope="col">Factor</th><th scope="col">Molecular calculation that could constrain it</th></tr></thead><tbody>' +
      d.rows.map((r, i) => '<tr><td>' + (i + 1) + '</td><th scope="row">' + esc(r.name) + '</th><td>' + esc(r.range) + '</td><td>' + esc(f3(Math.min(r.Ilo, r.Ihi) * 1e12) + '–' + f3(Math.max(r.Ilo, r.Ihi) * 1e12)) + ' pA</td><td>× ' + esc(f3(r.factor)) + '</td><td>' + esc(r.calc) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<ol class="ion-cards ion-rank-cards">' + d.rows.map((r) => '<li><p class="ion-card-h"><b>' + esc(r.name) + '</b><span class="ion-card-f">× ' + esc(f3(r.factor)) + '</span></p><p class="cl-small">Range ' + esc(r.range) + ': I(+100 mV) ' + esc(f3(Math.min(r.Ilo, r.Ihi) * 1e12) + '–' + f3(Math.max(r.Ilo, r.Ihi) * 1e12)) + ' pA</p><p>Could be constrained by: ' + esc(r.calc) + '</p></li>').join('') + '</ol>' +
      '<p class="cl-small">Rule-based, on the screening grid (level 1): each input of the current model step that has a stated range (the illustrative inputs and, with the recorded shells, the first-shell count) is moved across that range (others fixed) and the inputs are ranked by the change in the current at +100 mV (' + esc(pA(d.I0)) + ' at the stated values). This is one-at-a-time sensitivity, not expected information gain, calibrated uncertainty reduction or a cost-optimal choice. No learning is involved; the ranking changes when an input is replaced by an assessed calculation.</p>';
  }
  const STATUS_CLASS = { Literature: 'is-lit', Recorded: 'is-rec', Derived: 'is-der', Illustrative: 'is-ill', Setting: 'is-set' };
  function renderEvidence() {
    const rows = IonParams.registry(S.res.main.opts);
    el.evidence.innerHTML = '<p class="cl-small">Every input of the selected experiment. Statuses: Literature, Recorded (CP2K), Derived, Illustrative, Setting. No input is labelled MD-informed: none comes from an assessed molecular calculation.</p>' +
      '<div class="cl-table-wrap"><table class="cl-table ion-evidence-table"><thead><tr><th scope="col">Input</th><th scope="col">Value</th><th scope="col">Units</th><th scope="col">Source</th><th scope="col">Conditions</th><th scope="col">Status</th></tr></thead><tbody>' +
      rows.map((r) => '<tr class="' + (r.active ? '' : 'is-inactive') + '"><th scope="row">' + esc(r.name) + (r.active ? '' : ' <span class="cl-small">(not used in this step)</span>') + '</th><td>' + esc(r.value) + '</td><td>' + esc(r.units) + '</td><td>' + esc(r.source) + '</td><td>' + esc(r.conditions) + '</td><td><span class="ion-status ' + STATUS_CLASS[r.status] + '">' + esc(r.status === 'Recorded' ? 'Recorded (CP2K)' : r.status) + '</span></td></tr>').join('') +
      '</tbody></table></div>' +
      '<ul class="ion-cards ion-ev-cards">' + rows.map((r) => '<li class="' + (r.active ? '' : 'is-inactive') + '"><p class="ion-card-h"><b>' + esc(r.name) + '</b><span class="ion-status ' + STATUS_CLASS[r.status] + '">' + esc(r.status === 'Recorded' ? 'Recorded (CP2K)' : r.status) + '</span></p><p>' + esc(r.value) + (r.units && r.units !== '—' ? (/^10/.test(r.units) ? ' × ' : ' ') + esc(r.units) : '') + (r.active ? '' : ' <span class="cl-small">(not used in this step)</span>') + '</p><p class="cl-small">' + esc(r.source) + (r.conditions && r.conditions !== '—' ? '. ' + esc(r.conditions) : '') + '</p></li>').join('') + '</ul>';
  }
  function renderLadder() {
    const d = S.res.main, o = d.opts;
    el.ladder.innerHTML = '<div class="cl-table-wrap"><table class="cl-table"><thead><tr><th scope="col">Step</th><th scope="col">I at ' + esc(mV(o.V)) + '</th><th scope="col">Na⁺ share</th><th scope="col">Na⁺ / Cl⁻ in the pore</th><th scope="col">Water flow</th></tr></thead><tbody>' +
      d.ladder.map((r) => '<tr' + (r.step === o.step ? ' class="is-current"' : '') + '><th scope="row">' + r.step + ' ' + esc(STEP_NAMES[r.step]) + '</th><td>' + esc(pA(r.I)) + '</td><td>' + esc(r.I !== 0 ? share(r.INa / r.I) : '–') + '</td><td>' + esc(f3(r.nNa) + ' / ' + f3(r.nCl)) + '</td><td>' + esc(r.step >= 6 ? f3(molns(r.Q)) + ' /ns' : '–') + '</td></tr>').join('') +
      '</tbody></table></div><p class="cl-small">Same tube, voltage and settings; each step adds one ingredient. “In the pore”: mean number of ions between the mouths. Screening grid (level 1).</p>';
  }
  function renderMembrane() {
    const m = S.res.main.model, o = S.res.main.opts;
    el.membrane.textContent = o.V !== 0 ? 'Membrane estimate: with independent pores at one per 100 nm² (10¹⁶ m⁻²), all at the same voltage, the area conductance would be ' + sci(1e16 * Math.abs(m.I / o.V), 3) + ' S m⁻². This independent-pore estimate neglects shared access resistance and concentration polarisation.' : '';
  }
  function renderNumerics() {
    const d = S.res.main, m = d.model, t = S.times;
    el.numerics.innerHTML = '<div class="cl-table-wrap"><table class="cl-table"><tbody>' +
      '<tr><th scope="row">Grid</th><td>' + m.nodes + ' nodes, 300 nm of access region on each side; pore radius ' + f3(m.poreRadius * 1e9) + ' nm, length ' + f3(m.half * 2e9) + ' nm</td></tr>' +
      '<tr><th scope="row">Newton (selected model)</th><td>' + m.iterations + ' iterations after ' + m.continuationSteps + ' continuation steps; scaled residual ' + sci(m.residual, 2) + ' (solver stopping criterion 10⁻¹¹: ' + (m.ok ? 'met' : 'not met') + '; controller gate G1, at most 10⁻¹⁰: ' + (m.residual <= IonController.RESIDUAL_MAX ? 'passed' : 'failed') + ')</td></tr>' +
      '<tr><th scope="row">Flux conservation</th><td>largest face-to-mean deviation ' + sci(Math.max(...m.Jdev), 2) + ' (Na⁺, Cl⁻ relative to their own fluxes)</td></tr>' +
      '<tr><th scope="row">Debye length · packing</th><td>' + f3(m.debyeLength * 1e9) + ' nm · largest packing fraction ' + f3(m.packingMax) + '</td></tr>' +
      (S.res.ctrl ? '<tr><th scope="row">Numerical controller</th><td>' + esc(IonController.STATUS_TEXT[S.res.ctrl.numerical.outcome.status]) + '; levels ' + S.res.ctrl.numerical.levels.map((e) => e.level + ' (' + e.nodes + ' nodes)').join(', ') + '; ' + (S.res.ctrl.ms / 1000).toFixed(2) + ' s for the finer grids</td></tr>' : '') +
      '<tr><th scope="row">Timing</th><td>' + ['main', 'iv', 'sel', 'ctrl', 'sens'].filter((k) => t[k]).map((k) => ({ main: 'six steps at the set voltage', iv: 'current–voltage curves', sel: 'reversal potentials', ctrl: 'grid check', sens: 'input ranking' })[k] + ' ready after ' + (t[k] / 1000).toFixed(2) + ' s').join('; ') + '</td></tr>' +
      '</tbody></table></div>';
  }
  function finishRun() {
    if (!S.res.main) { el.dlDecision.disabled = !S.res.decision; return; }   // a refused query: nothing was solved
    renderNumerics();
    el.dlJson.disabled = false; el.dlCsv.disabled = false;
  }

  /* ------------------------------------------------------------------ 3D view */
  function pushView() {
    const d = S.res.main; if (!d || !S.view) return;
    const o = d.opts, m = d.model, P = IonParams, p = P.presetOf(o.preset), g = d.geometry, sv = d.solvation.detail || {};
    S.view.setData({ n: p.n, Rc: g.Rc, a: g.a, L: m.half * 2e9, x: m.x, r: m.r, c: m.c, phi: m.phi, J: m.J, I: m.I, Q: o.step >= 6 ? m.Q : 0, step: o.step, rimN: o.rimN, solvation: o.solvation, lining: o.lining,
      nRef: [P.REF.nNa, P.REF.nCl], nPore: [sv.nNa != null ? sv.nNa : P.REF.nNa, sv.nCl != null ? sv.nCl : P.REF.nCl], waterPerNm: p.waters / 2.46, ionSize: P.DEFAULTS.ionSize, cres: [o.c, o.c], V: o.V });
    renderLegend();
  }
  function renderLegend() {
    if (!S.view) return;
    const lg = S.view.legend(), stops = lg.ramp.map((c, i) => c + ' ' + (100 * i / (lg.ramp.length - 1)).toFixed(1) + '%').join(', ');
    el.legend.innerHTML = '<p class="cl-legend-title">' + esc(lg.title) + ' <span class="cl-legend-unit">(' + esc(lg.unit) + ')</span></p><div class="cl-legend-bar" style="background: linear-gradient(90deg, ' + stops + ')"></div><div class="cl-legend-ticks">' +
      lg.ticks.map((t) => '<span style="left: ' + (100 * t.t).toFixed(2) + '%">' + esc(t.label) + '</span>').join('') + '</div><p class="cl-small cl-legend-note">' + esc(lg.note) + '</p>';
  }
  el.overlayBtns.forEach((b) => b.addEventListener('click', () => { S.overlay = b.getAttribute('data-overlay'); el.overlayBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $('.ion-species').hidden = S.overlay !== 'conc'; if (S.view) { S.view.setOverlay(S.overlay, S.species); renderLegend(); } }));
  el.speciesBtns.forEach((b) => b.addEventListener('click', () => { S.species = Number(b.getAttribute('data-species')); el.speciesBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b))); if (S.view) { S.view.setOverlay(S.overlay, S.species); renderLegend(); } }));
  function setCam(name) { S.cam = name; el.camPore.setAttribute('aria-pressed', String(name === 'pore')); el.camDevice.setAttribute('aria-pressed', String(name === 'device')); if (S.view) S.view.setPreset(name, true); }
  el.camPore.addEventListener('click', () => setCam('pore'));
  el.camDevice.addEventListener('click', () => setCam('device'));
  function syncPlay() { el.play.textContent = S.playing ? 'Pause' : 'Play'; el.play.setAttribute('aria-pressed', String(S.playing)); }
  el.play.addEventListener('click', () => { S.playing = !S.playing; syncPlay(); if (S.view) S.view.setPlaying(S.playing); });
  el.resetView.addEventListener('click', () => { if (S.view) S.view.resetView(); });

  /* ------------------------------------------------------------------ downloads */
  async function sha256(url) {
    try { if (!(window.crypto && crypto.subtle)) return null; const b = await (await fetch(url)).arrayBuffer(); const h = await crypto.subtle.digest('SHA-256', b); return Array.from(new Uint8Array(h)).map((x) => x.toString(16).padStart(2, '0')).join(''); } catch (e) { return null; }
  }
  function save(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function resultJson() {
    const r = S.res, m = r.main.model;
    return {
      format: 'continuum-ions-result-1', website_version: VERSION, created: new Date().toISOString(), page: location.pathname,
      inputs: r.main.opts,
      results: { I_A: m.I, I_species_A: m.Ispecies, J_mol_s: m.J, Q_m3_s: m.Q, n_in_pore: m.nInPore, packing_max: m.packingMax, debye_length_m: m.debyeLength, flags: m.flags.map((f) => f.id), converged: m.ok, newton_iterations: m.iterations, residual: m.residual },
      ladder: r.main.ladder, solvation: r.main.solvation,
      iv: r.iv ? { V_V: r.iv.V, model_I_A: r.iv.model.map((p) => p.I), model_I_Na_A: r.iv.model.map((p) => p.Ispecies[0]), model_I_Cl_A: r.iv.model.map((p) => p.Ispecies[1]), reference_I_A: r.iv.reference.map((p) => p.I) } : null,
      selectivity: r.sel ? { gradient: { feed_mol_m3: r.main.opts.c, permeate_mol_m3: r.main.opts.c / 10 },
        descriptor: 'GHK-equivalent Na+/Cl- permeability ratio: constant-field Goldman-Hodgkin-Katz inversion of V_rev with reservoir activities; an effective, model-dependent descriptor, not a measured permeability',
        nernst_band_V: IonParams.NERNST_BAND, statuses: 'finite | above_limit | below_limit | nernst_na | nernst_cl | invalid | not_found',
        model: { V_rev_V: r.sel.model.V, ratio: r.sel.model.sel ? r.sel.model.sel.ratio : null, status: r.sel.model.sel ? r.sel.model.sel.status : null, shown: r.sel.model.sel ? r.sel.model.sel.text : null,
          nernst_Na_V: r.sel.model.sel ? r.sel.model.sel.nernstNa : null, nernst_Cl_V: r.sel.model.sel ? r.sel.model.sel.nernstCl : null, beyond_nernst_V: r.sel.model.sel ? r.sel.model.sel.beyond : null, Q_at_rev_m3_s: r.sel.model.Q },
        reference: { V_rev_V: r.sel.reference.V, ratio: r.sel.reference.sel ? r.sel.reference.sel.ratio : null, status: r.sel.reference.sel ? r.sel.reference.sel.status : null, shown: r.sel.reference.sel ? r.sel.reference.sel.text : null } } : null,
      ranking: r.sens ? r.sens.rows : null, evidence: IonParams.registry(r.main.opts),
      decision: r.decision ? r.decision.record : null,
      profiles: { x_m: m.x, r_m: m.r, phi_V: m.phi, c_mol_m3: m.c, mu_ex_J_mol: m.muEx },
    };
  }
  el.dlJson.addEventListener('click', async () => {
    if (!S.res.main) return;
    const j = resultJson();
    j.environment = { userAgent: navigator.userAgent, solver_files: [{ path: 'lab/continuum/ions/core.js', sha256: await sha256('ions/core.js') }, { path: 'lab/continuum/ions/params.js', sha256: await sha256('ions/params.js') }, { path: 'lab/continuum/ions/controller.js', sha256: await sha256('ions/controller.js') }] };
    save('continuum-ions-' + S.res.main.opts.preset.replace(',', '-') + '-step' + S.res.main.opts.step + '.json', JSON.stringify(j, null, 1), 'application/json');
    el.dlNote.textContent = 'Saved the JSON result. Recompute it with node tools/continuum/ions/reproduce_ions.js <file>.';
  });
  el.dlDecision.addEventListener('click', () => {
    if (!S.res.decision) return;
    const o = S.res.main ? S.res.main.opts : S.res.opts;
    save('continuum-ions-decision-' + String(o.preset).replace(',', '-') + '-step' + o.step + '-' + o.target + '.json', JSON.stringify(S.res.decision.record, null, 1), 'application/json');
    el.dlNote.textContent = 'Saved the decision record (JSON).';
  });
  el.dlCsv.addEventListener('click', () => {
    if (!S.res.main) return;
    const m = S.res.main.model, r = S.res.main.reference, RT = IonParams.RT, lines = ['x_nm,r_nm,c_Na_mol_m3,c_Cl_mol_m3,phi_mV,mu_ex_Na_RT,mu_ex_Cl_RT,ref_c_Na_mol_m3,ref_c_Cl_mol_m3,ref_phi_mV'];
    m.x.forEach((x, k) => lines.push([x * 1e9, m.r[k] * 1e9, m.c[0][k], m.c[1][k], m.phi[k] * 1e3, m.muEx[0][k] / RT, m.muEx[1][k] / RT, r.c[0][k], r.c[1][k], r.phi[k] * 1e3].map((v) => String(v)).join(',')));
    save('continuum-ions-profiles-' + S.res.main.opts.preset.replace(',', '-') + '-step' + S.res.main.opts.step + '.csv', '# Continuum Lab ion experiment ' + VERSION + ' · ' + JSON.stringify(S.res.main.opts) + '\n' + lines.join('\n') + '\n', 'text/csv');
    el.dlNote.textContent = 'Saved the axial profiles (CSV).';
  });

  /* ------------------------------------------------------------------ guided experiment */
  const GUIDE = [
    { text: 'Step 1 · The classical model: bulk diffusivities, point ions, a neutral pore. Its current–voltage curve is the grey reference on the chart.', set: { step: 1, preset: '7,7', V: 0.1, solvation: 'cp2k', lining: 'carbon' } },
    { text: 'Step 2 · Charge the rims: two ionised carboxylates at each mouth. Watch the Na⁺ share and the reversal potential.', set: { step: 2 } },
    { text: 'Step 3 · Add ion size and the free energy of shedding water, with the first-shell counts recorded in the CP2K run of this (7,7) tube (chart below the 3D view).', set: { step: 4, solvation: 'cp2k' } },
    { text: 'Step 4 · Let the water move: confined mobility, then electro-osmotic flow with 10 nm slip. The water-flow tile shows the computed flow.', set: { step: 6 } },
    { text: 'Step 5 · Same pore, another closure assumption: the rigid-shell geometry removes far more water than the recorded shells do. The difference is the sensitivity of the prediction to the closure, not a validation of either. Compare the curves and the reversal potential.', set: { solvation: 'shell' } },
    { text: 'Step 6 · Inspect the evidence: every input with its value, source and status. Only the tube radii, the first-shell radii and the first-shell counts come from the recorded CP2K runs; the rest are literature values or stated examples. “What limits this prediction?” records the grid check and the molecular calculation that could constrain the most influential input.', set: { solvation: 'cp2k' }, open: true },
  ];
  function guideGo(i) {
    S.guide = i; el.guide.classList.add('is-on');
    el.guideSteps.forEach((li, k) => { li.classList.toggle('is-now', k === i); li.classList.toggle('is-done', k < i); });
    el.guideText.textContent = GUIDE[i].text;
    Object.assign(S.opts, GUIDE[i].set); writeControls();
    if (GUIDE[i].open) { el.drawer.open = true; }
    el.guideDo.textContent = i < GUIDE.length - 1 ? 'Next: ' + el.guideSteps[i + 1].textContent : 'Finish';
    run();
    if (GUIDE[i].open) setTimeout(() => el.drawer.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'start' }), 50);
  }
  function guideAfterRun() { /* the guide advances only on the visitor's click */ }
  el.guideDo.addEventListener('click', () => {
    if (S.guide >= GUIDE.length - 1) { S.guide = -1; el.guideText.textContent = 'Done. Change any control: the experiment reruns, and the sentence under the results explains the last change.'; el.guideDo.textContent = 'Restart the guided experiment'; el.guideSteps.forEach((li) => { li.classList.remove('is-now'); li.classList.add('is-done'); }); return; }
    guideGo(S.guide + 1);
  });
  el.guideSkip.addEventListener('click', () => { el.guide.hidden = true; });

  writeControls();
  window.__ionLab = { state: () => S, view: () => S.view, run };      // read-only access for the automated checks
})();
