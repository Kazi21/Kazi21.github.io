/* Live Water Lab — engine adapter. Drives LAMMPS (via LammpsCore) for one experiment and keeps the
   evidence needed to reproduce it: the exact command journal, the event history and the measurement records.
   Interface (spec section 10): initialize, runSteps, pause, setConditions, setLJScale, beginPull,
   updatePullTarget, releasePull, getSnapshot, exportExperiment, dispose — plus select, setStiffness,
   removeDrift. Used inside the browser worker and by the Node test harness. */
(function (root) {
  'use strict';

  const COLUMNS = [
    'step', 'time_ps', 'state', 'ensemble', 'T_target_K', 'P_target_bar', 'lj_scale',
    'T_K', 'P_bar', 'density_kg_m3', 'volume_nm3', 'Lx_nm', 'Ly_nm', 'Lz_nm',
    'PE_kJ_mol', 'KE_kJ_mol', 'KEcom_kJ_mol', 'Ecouple_kJ_mol', 'Eext_kJ_mol',
    'Evdwl_kJ_mol', 'Ecoul_kJ_mol', 'Elong_kJ_mol', 'Etail_kJ_mol',
    'selected_molecule', 'k_N_m', 'anchor_x_nm', 'anchor_y_nm', 'anchor_z_nm', 'com_x_nm', 'com_y_nm', 'com_z_nm', 'disp_nm',
    'Ftether_x_pN', 'Ftether_y_pN', 'Ftether_z_pN', 'Fint_x_pN', 'Fint_y_pN', 'Fint_z_pN',
    'Utether_kJ_mol', 'Wprotocol_kJ_mol', 'Wdelivered_kJ_mol', 'vcm_x_m_s', 'vcm_y_m_s', 'vcm_z_m_s',
  ];
  const MAX_RECORDS = 30000;     // 300 ps at one record per 10 fs
  const MAX_JOURNAL = 400000;    // commands

  class WaterAdapter {
    constructor(core, model) {
      this.L = core;
      this.W = model;
      this.running = false;
    }

    /* ---- build ---- */
    initialize(cfg) {
      const W = this.W;
      if (!W.RANGES.molecules.includes(cfg.molecules)) throw new Error('unsupported molecule count ' + cfg.molecules);
      this.checkT(cfg.T); this.checkP(cfg.Pbar); this.checkS(cfg.ljScale);
      this.cfg = Object.assign({}, cfg);
      this.topo = W.parseTopology(cfg.dataText);
      if (this.topo.nmol !== cfg.molecules) throw new Error('preset does not hold ' + cfg.molecules + ' molecules');
      this.dataText = cfg.dataText;
      this.L.writeFile('/start.data', cfg.dataText);
      this.init = W.initCommands({ dataFile: 'start.data', T: cfg.T, Pbar: cfg.Pbar, ljScale: cfg.ljScale, ensemble: cfg.ensemble, selected: 1 });
      this.L.commands(this.init.join('\n'));
      this.journal = [];
      this.events = [];
      this.records = [];
      this.recordingFull = false;
      this.journalFull = false;
      this.needSetup = false;
      this.integFresh = false;
      this.st = {
        T: cfg.T, Pbar: cfg.Pbar, ljScale: cfg.ljScale, ensemble: cfg.ensemble,
        sel: 1, selActive: false, R0: null,
        pulling: false, k: 0, X: [0, 0, 0], Xreq: null, lastAnchorStep: 0,
        phase: 'free',
      };
      this.ecoupleOffset = 0;      // thermostat/barostat energy carried over when the integrator fix is re-created (kcal/mol)
      this.eRemoved = 0;           // kinetic energy removed by explicit drift removal (kcal/mol)
      this.WprotTotal = 0;         // cumulative protocol work, all pulls (kcal/mol)
      this.WdelTotal = 0;          // cumulative work delivered to the molecules by the tether, completed pulls (kcal/mol)
      this.pull = null;            // current pull episode
      this.mtot = this.L.variable('mtot');
      this.event('start', { preset: cfg.presetId, molecules: cfg.molecules, T_target_K: cfg.T, P_target_bar: cfg.Pbar,
        ensemble: cfg.ensemble, lj_scale: cfg.ljScale, velocities: 'preset (stored in start.data)' });
      const s = this.getSnapshot();
      this.pushRecord(s);
      return s;
    }

    checkT(T) { const r = this.W.RANGES.T; if (!(T >= r.min && T <= r.max)) throw new Error(`temperature must be ${r.min}–${r.max} K`); }
    checkP(P) { const r = this.W.RANGES.Pbar; if (!(P >= r.min && P <= r.max)) throw new Error(`pressure must be ${r.min}–${r.max} bar`); }
    checkS(s) { if (!this.W.RANGES.ljScale.some((v) => Math.abs(v - s) < 1e-9)) throw new Error('O–O LJ strength must be one of the allowed values ' + this.W.RANGES.ljScale.join(', ')); }
    checkK(k) { if (!this.W.RANGES.k.some((v) => Math.abs(v - k) < 1e-9)) throw new Error('pull stiffness must be one of the allowed values'); }

    /* Every LAMMPS command after initialisation goes through here, so the export replays exactly this sequence. */
    issue(cmds) {
      const step = this.L.step();
      for (const c of cmds) {
        this.L.command(c);
        if (this.journal.length < MAX_JOURNAL) this.journal.push({ step, cmd: c });
        else this.journalFull = true;
      }
    }

    event(type, detail) {
      const step = this.L.step();
      const e = Object.assign({ step, time_ps: step * this.W.MODEL.dt / 1000, type }, detail || {});
      this.events.push(e);
      (this.newEvents || (this.newEvents = [])).push(e);
      return e;
    }

    takeNewEvents() { const e = this.newEvents || []; this.newEvents = []; return e; }

    /* ---- dynamics ---- */
    runSteps(n, withPositions = true) {
      if (!(n >= 1 && n <= 1000)) throw new Error('chunk size out of range');
      if (this.st.pulling) this.applyAnchor();
      const pre = this.needSetup ? 'yes' : 'no';
      this.issue([`run ${n} pre ${pre} post no`]);
      this.needSetup = false;
      this.integFresh = false;
      const s = this.getSnapshot(withPositions);
      if (s.step % this.W.RECORD_EVERY === 0) this.pushRecord(s);
      return s;
    }

    pause() { this.running = false; }

    /* ---- conditions experiment ---- */
    setConditions(t) {
      if (this.st.pulling) throw new Error('Release the pull before changing the conditions');
      const T = t.T != null ? t.T : this.st.T, P = t.Pbar != null ? t.Pbar : this.st.Pbar;
      const ens = t.ensemble || 'npt';
      this.checkT(T); this.checkP(P);
      if (ens !== 'npt' && ens !== 'nvt') throw new Error('unknown ensemble');
      const from = this.st.ensemble;
      this.replaceIntegrator(ens, T, P);
      Object.assign(this.st, { T, Pbar: P, ensemble: ens, phase: 'free' });
      this.event('conditions', { T_target_K: T, P_target_bar: ens === 'npt' ? P : null, ensemble: ens, previous_ensemble: from });
    }

    replaceIntegrator(ens, T, P) {
      const ec = this.integFresh ? 0 : this.L.thermo('ecouple');
      this.issue(['unfix integ'].concat(this.W.integratorCommands(ens, T, P)));
      this.ecoupleOffset += ec;
      this.integFresh = true;                               // a new fix contributes zero coupling energy until it has run
      this.needSetup = true;
    }

    ecoupleNow() { return this.integFresh ? 0 : this.L.thermo('ecouple'); }

    setLJScale(s) {
      if (this.st.pulling) throw new Error('Release the pull before changing the model');
      this.checkS(s);
      const prev = this.st.ljScale;
      this.issue([this.W.ljCommand(s)]);
      this.st.ljScale = s;
      this.st.phase = 'free';
      this.needSetup = true;
      this.event('lj_scale', { lj_scale: s, previous: prev, epsOO_kcal_mol: this.W.MODEL.epsOO * s,
        label: Math.abs(s - 1) < 1e-9 ? 'Reference SPC/E parameters' : 'Modified SPC/E educational model' });
    }

    /* ---- pull and release experiment ---- */
    com() { return [this.L.variable('rcx'), this.L.variable('rcy'), this.L.variable('rcz')]; }

    select(mol) {
      if (this.st.pulling) throw new Error('Release the current pull before selecting another molecule');
      if (!(mol >= 1 && mol <= this.topo.nmol)) throw new Error('no such molecule');
      if (mol !== this.st.sel) this.issue(['group sel clear', `group sel molecule ${mol}`]);
      this.st.sel = mol; this.st.selActive = true;
      this.st.R0 = this.com();
      this.event('select', { molecule: mol, com_nm: this.st.R0.map((v) => v / 10) });
    }

    beginPull(mol, settings) {
      if (this.st.pulling) return;
      const k = settings && settings.k != null ? settings.k : this.W.RANGES.kDefault;
      this.checkK(k);
      if (mol !== this.st.sel || !this.st.selActive) this.select(mol);
      if (this.st.ensemble === 'npt') {
        const V = this.L.thermo('vol');
        this.replaceIntegrator('nvt', this.st.T, this.st.Pbar);
        this.st.ensemble = 'nvt';
        this.event('ensemble', { from: 'npt', to: 'nvt', reason: 'fixed volume for pulling', volume_nm3: V / 1000 });
      }
      const R = this.com();
      const X = R.slice();                                  // handle starts at the centre of mass: no force jump
      this.issue([`variable X equal ${this.W.fmt(X[0])}`, `variable Y equal ${this.W.fmt(X[1])}`, `variable Z equal ${this.W.fmt(X[2])}`,
        `variable K equal ${this.W.fmt(k)}`]);
      Object.assign(this.st, { pulling: true, k, X, Xreq: X.slice(), lastAnchorStep: this.L.step(), phase: 'driven' });
      this.pull = { molecule: mol, startStep: this.L.step(), Wprot: 0, E0: null };
      this.pull.E0 = this.extEnergy();
      this.needSetup = true;
      this.event('pull_begin', { molecule: mol, k_N_m: k * this.W.U.kcalA2_Nm, anchor_nm: X.map((v) => v / 10), work_increment_kJ_mol: 0 });
    }

    /* Requested handle position (unwrapped, Å). Applied at the next chunk boundary within the speed and distance bounds. */
    updatePullTarget(pos) {
      if (!this.st.pulling) return;
      if (!pos || pos.length !== 3 || !pos.every(Number.isFinite)) throw new Error('invalid handle position');
      this.st.Xreq = pos.slice();
    }

    applyAnchor() {
      const st = this.st, W = this.W, R = W.RANGES;
      const Xo = st.X, Xr = st.Xreq;
      if (!Xr) return;
      const step = this.L.step();
      const elapsed = Math.max(1, step - st.lastAnchorStep) * W.MODEL.dt;
      let d = [Xr[0] - Xo[0], Xr[1] - Xo[1], Xr[2] - Xo[2]];
      const dn = Math.hypot(d[0], d[1], d[2]);
      const com = this.com();
      // keep the anchor within handleMaxDist of the current centre of mass even when no new request arrived
      let Xn;
      if (dn < 1e-9) Xn = Xo.slice();
      else {
        const lim = R.handleMaxSpeed * elapsed;
        if (dn > lim) d = d.map((v) => v * lim / dn);
        Xn = [Xo[0] + d[0], Xo[1] + d[1], Xo[2] + d[2]];
      }
      const e = [Xn[0] - com[0], Xn[1] - com[1], Xn[2] - com[2]], en = Math.hypot(e[0], e[1], e[2]);
      let clamped = false;
      if (en > R.handleMaxDist) { Xn = com.map((c, i) => c + e[i] * R.handleMaxDist / en); clamped = true; }
      const moved = Math.hypot(Xn[0] - Xo[0], Xn[1] - Xo[1], Xn[2] - Xo[2]);
      if (moved < 1e-9) return;
      const u = (X) => 0.5 * st.k * ((com[0] - X[0]) ** 2 + (com[1] - X[1]) ** 2 + (com[2] - X[2]) ** 2);
      const dW = u(Xn) - u(Xo);                            // protocol work at fixed coordinates
      this.issue([`variable X equal ${W.fmt(Xn[0])}`, `variable Y equal ${W.fmt(Xn[1])}`, `variable Z equal ${W.fmt(Xn[2])}`]);
      st.X = Xn; st.lastAnchorStep = step;
      this.pull.Wprot += dW; this.WprotTotal += dW;
      this.needSetup = true;
      this.event('anchor', { anchor_nm: Xn.map((v) => v / 10), clamped, work_increment_kJ_mol: dW * W.U.kcal2kJ });
    }

    setStiffness(k) {
      this.checkK(k);
      const st = this.st;
      if (!st.pulling) { this.cfg.k = k; return; }
      const R = this.com();
      const r2 = (R[0] - st.X[0]) ** 2 + (R[1] - st.X[1]) ** 2 + (R[2] - st.X[2]) ** 2;
      const dW = 0.5 * (k - st.k) * r2;
      this.issue([`variable K equal ${this.W.fmt(k)}`]);
      this.pull.Wprot += dW; this.WprotTotal += dW;
      const prev = st.k; st.k = k;
      this.needSetup = true;
      this.event('stiffness', { k_N_m: k * this.W.U.kcalA2_Nm, previous_k_N_m: prev * this.W.U.kcalA2_Nm, work_increment_kJ_mol: dW * this.W.U.kcal2kJ });
    }

    releasePull() {
      const st = this.st;
      if (!st.pulling) return;
      const R = this.com();
      const r2 = (R[0] - st.X[0]) ** 2 + (R[1] - st.X[1]) ** 2 + (R[2] - st.X[2]) ** 2;
      const dW = -0.5 * st.k * r2;                          // stored tether energy removed with the tether
      this.issue(['variable K equal 0.0']);
      this.pull.Wprot += dW; this.WprotTotal += dW;
      const Wdel = this.pull.Wprot;                         // tether energy is zero after release
      this.WdelTotal += Wdel;
      const dE = this.extEnergy() - this.pull.E0;
      st.pulling = false; st.k = 0; st.Xreq = null; st.phase = 'relaxation';
      this.needSetup = true;
      this.event('release', { molecule: this.pull.molecule, duration_ps: (this.L.step() - this.pull.startStep) * this.W.MODEL.dt / 1000,
        work_increment_kJ_mol: dW * this.W.U.kcal2kJ, protocol_work_kJ_mol: this.pull.Wprot * this.W.U.kcal2kJ,
        delivered_work_kJ_mol: Wdel * this.W.U.kcal2kJ, energy_change_kJ_mol: dE * this.W.U.kcal2kJ });
      this.pull = null;
    }

    removeDrift() {
      if (this.st.pulling) throw new Error('Release the pull first');
      const v = this.vcm(), ke = 0.5 * this.mtot * (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) * this.W.U.mvv2e;
      this.issue(['velocity all zero linear']);
      this.eRemoved += ke;
      this.event('drift_removed', { vcm_m_s: v.map((c) => c * this.W.U.A_fs2m_s), kinetic_energy_removed_kJ_mol: ke * this.W.U.kcal2kJ });
    }

    /* ---- measurements ---- */
    vcm() { return [this.L.variable('vcx'), this.L.variable('vcy'), this.L.variable('vcz')]; }

    /* Molecular energy including centre-of-mass kinetic energy and the cumulative thermostat/barostat exchange.
       In exact dynamics its change equals the work delivered by the tether. */
    extEnergy() {
      const v = this.vcm();
      const kecom = 0.5 * this.mtot * (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) * this.W.U.mvv2e;
      return this.L.thermo('pe') + this.L.thermo('ke') + kecom + this.ecoupleNow() + this.ecoupleOffset + this.eRemoved;
    }

    getSnapshot(withPositions = true) {
      const L = this.L, W = this.W, U = W.U, st = this.st;
      const th = {};
      for (const k of ['temp', 'press', 'pe', 'ke', 'evdwl', 'ecoul', 'elong', 'etail', 'density', 'vol', 'lx', 'ly', 'lz']) th[k] = L.thermo(k);
      th.ecouple = this.ecoupleNow();
      const v = this.vcm();
      const kecom = 0.5 * this.mtot * (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) * U.mvv2e;
      const R = this.com();
      const Fint = [L.fixVector('tether', 0), L.fixVector('tether', 1), L.fixVector('tether', 2)];
      const Ut = L.fixScalar('tether');
      const k = st.pulling ? st.k : 0;
      const Ft = st.pulling ? R.map((r, i) => -k * (r - st.X[i])) : [0, 0, 0];
      const U_analytic = st.pulling ? 0.5 * k * ((R[0] - st.X[0]) ** 2 + (R[1] - st.X[1]) ** 2 + (R[2] - st.X[2]) ** 2) : 0;
      const ecTot = th.ecouple + this.ecoupleOffset;
      const Eext = th.pe + th.ke + kecom + ecTot + this.eRemoved;
      const Wdel = this.WdelTotal + (this.pull ? this.pull.Wprot - U_analytic : 0);
      const R0 = st.R0 || R;
      const step = L.step();
      const snap = {
        step, time_ps: step * W.MODEL.dt / 1000,
        phase: st.phase, ensemble: st.ensemble, T_target: st.T, P_target: st.Pbar, ljScale: st.ljScale,
        T: th.temp, P_bar: th.press * U.atm2bar, density: th.density * U.gcc2kgm3, vol_nm3: th.vol / 1000,
        box: L.box(),
        pe: th.pe, ke: th.ke, kecom, ecouple: ecTot, eext: Eext,
        evdwl: th.evdwl, ecoul: th.ecoul, elong: th.elong, etail: th.etail,
        sel: st.selActive ? st.sel : 0, pulling: st.pulling, k, X: st.X.slice(), Xreq: st.Xreq ? st.Xreq.slice() : null, R,
        disp: Math.hypot(R[0] - R0[0], R[1] - R0[1], R[2] - R0[2]),
        Ftether: Ft, Fint, Utether: Ut, Utether_analytic: U_analytic,
        Wprot: this.WprotTotal, Wdel, Wprot_pull: this.pull ? this.pull.Wprot : null,
        vcm: v, recordingFull: this.recordingFull, journalFull: this.journalFull,
        steps: step,
      };
      if (withPositions) snap.x = L.gather(false, false).x;
      return snap;
    }

    pushRecord(s) {
      if (this.records.length >= MAX_RECORDS) { this.recordingFull = true; return; }
      const U = this.W.U, kJ = U.kcal2kJ, nm = 0.1, pN = U.kcalA2pN, ms = U.A_fs2m_s;
      const st = s.sel ? s.sel : '';
      this.records.push([
        s.step, s.time_ps, s.phase, s.ensemble, s.T_target, s.ensemble === 'npt' ? s.P_target : '', s.ljScale,
        s.T, s.P_bar, s.density, s.vol_nm3, (s.box.hi[0] - s.box.lo[0]) * nm, (s.box.hi[1] - s.box.lo[1]) * nm, (s.box.hi[2] - s.box.lo[2]) * nm,
        s.pe * kJ, s.ke * kJ, s.kecom * kJ, s.ecouple * kJ, s.eext * kJ,
        s.evdwl * kJ, s.ecoul * kJ, s.elong * kJ, s.etail * kJ,
        st, s.k * U.kcalA2_Nm,
        s.pulling ? s.X[0] * nm : '', s.pulling ? s.X[1] * nm : '', s.pulling ? s.X[2] * nm : '',
        s.sel ? s.R[0] * nm : '', s.sel ? s.R[1] * nm : '', s.sel ? s.R[2] * nm : '', s.sel ? s.disp * nm : '',
        s.Ftether[0] * pN, s.Ftether[1] * pN, s.Ftether[2] * pN,
        s.sel ? s.Fint[0] * pN : '', s.sel ? s.Fint[1] * pN : '', s.sel ? s.Fint[2] * pN : '',
        s.Utether * kJ, s.Wprot * kJ, s.Wdel * kJ, s.vcm[0] * ms, s.vcm[1] * ms, s.vcm[2] * ms,
      ]);
    }

    /* ---- reproducibility ---- */
    exportExperiment(meta) {
      return {
        meta: Object.assign({ steps: this.L.step(), molecules: this.topo.nmol, preset: this.cfg.presetId }, meta),
        init: this.init.slice(), journal: this.journal.slice(), events: this.events.slice(),
        columns: COLUMNS.slice(), records: this.records.slice(), dataText: this.dataText,
        recordingFull: this.recordingFull, journalFull: this.journalFull,
        finalData: this.writeFinal(),
      };
    }

    /* write_data wraps atoms into the box and rebuilds ghost atoms, so it is journaled (the native replay
       writes the same file at the same point) and the next chunk performs a full setup. */
    writeFinal() {
      try {
        this.issue(['write_data final.data']);
        this.needSetup = true;
        return this.L.readFile('/final.data');
      } catch (e) { return null; }
    }

    dispose() { try { this.L.close(); } catch (e) { /* already closed */ } }
  }

  WaterAdapter.COLUMNS = COLUMNS;
  if (typeof module !== 'undefined' && module.exports) module.exports = { WaterAdapter, COLUMNS };
  else root.WaterAdapter = WaterAdapter;
})(typeof self !== 'undefined' ? self : this);
