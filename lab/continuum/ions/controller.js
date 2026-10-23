/* Continuum Lab — ion experiment: numerical controller, decision record and closure-contract check (no DOM).

   A fixed rule set, frozen in tools/continuum/ions/TOLERANCES.md ("Release 2026.10: numerical controller") before this
   file was written: no learning, no language model, nothing is submitted anywhere. For the selected experiment it
   decides how much computation the displayed result needs (compare the screening grid with a twice-finer grid, refine
   within a fixed budget, stop with a stated reason), runs those solves and records every solve and decision. After the
   numerics it may attach one request for a molecular calculation; requests are never executed here.

   The page's worker, the Node tests and reproduce_ions.js all use this file, so they make the same decisions.
   UMD: self.IonController in the browser and the worker, require() in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), require('./params.js'));
  else root.IonController = factory(root.IonCore, root.IonParams);
})(typeof self !== 'undefined' ? self : this, function (Core, Pm) {
  'use strict';

  const SCHEMA = 'continuum-ions-decision-1';
  const POLICY = Object.freeze({
    type: 'deterministic_rules', version: 'ion-controller-1',
    rules: 'tools/continuum/ions/TOLERANCES.md, section "Release 2026.10: numerical controller"',
    learning: false, language_model_used: false,
  });
  /* grid-convergence targets: |I_l − I_(l−1)| ≤ t |I_l| and |V_rev,l − V_rev,(l−1)| ≤ 40 mV × t */
  const TARGETS = Object.freeze({
    standard: Object.freeze({ id: 'standard', label: '0.5 %', t: 5e-3 }),
    fine: Object.freeze({ id: 'fine', label: '0.1 %', t: 1e-3 }),
    strict: Object.freeze({ id: 'strict', label: '0.02 %', t: 2e-4 }),
  });
  const V_PER_T = 0.04;          // V
  const I_FLOOR = 1e-16;         // A: absolute current criterion when both currents are below it (equilibrium)
  const MAX_LEVEL = 3;           // budget: grid levels 1–3
  const CONSERVATION = 1e-9;     // gate G2: relative face-to-mean deviation of each species flux (as test I5), current solve
  const RESIDUAL_MAX = 1e-10;    // gate G1: scaled Newton residual (the acceptance criterion of test I6)
  const DOMAIN = Object.freeze({
    preset: ['6,6', '7,7', '9,9', '11,11'], step: [1, 2, 3, 4, 5, 6], c: [10, 100, 1000], gradient: [10], dp: [0], L: [5],
    solvation: ['cp2k', 'shell', 'born'], lining: ['carbon', 'carbonyl', 'amide'], epsP: [10, 20, 30, 50], rimN: [1, 2, 3],
    Dratio: [0.2, 0.5, 0.8, 1], slip: [0, 1, 10, 100], rimW: [0.5], ionSize: [0.45], level: [1], target: Object.keys(TARGETS),
  });
  const V_MAX = 0.2;             // V
  const KEYS = ['preset', 'step', 'V', 'c', 'gradient', 'dp', 'L', 'solvation', 'lining', 'epsP', 'rimN', 'rimW', 'ionSize', 'Dratio', 'slip', 'level', 'target'];
  const CODES = {
    preset: 'TUBE_UNSUPPORTED', step: 'STEP_UNSUPPORTED', c: 'CONCENTRATION_UNSUPPORTED', gradient: 'GRADIENT_UNSUPPORTED',
    dp: 'PRESSURE_DIFFERENCE_UNSUPPORTED', L: 'PORE_LENGTH_UNSUPPORTED', solvation: 'CLOSURE_UNKNOWN', lining: 'LINING_UNKNOWN',
    epsP: 'PORE_PERMITTIVITY_UNSUPPORTED', rimN: 'RIM_CHARGE_UNSUPPORTED', Dratio: 'DIFFUSIVITY_RATIO_UNSUPPORTED',
    slip: 'SLIP_LENGTH_UNSUPPORTED', rimW: 'RIM_WIDTH_UNSUPPORTED', ionSize: 'ION_SIZE_UNSUPPORTED',
    level: 'GRID_LEVEL_SET_BY_CONTROLLER', target: 'TARGET_UNKNOWN',
  };
  const STATUS_TEXT = {
    tolerance_reached: 'Numerical tolerance reached', budget_exhausted: 'Refinement budget exhausted', not_converged: 'Not converged',
    check_failed: 'Numerical check failed', refused: 'Refused: outside the supported domain',
  };
  const GATE_TEXT = { G1: 'Newton convergence (scaled residual at most 10⁻¹⁰)', G2: 'flux conservation (current solve, V ≠ 0)', G3: 'positive, finite concentrations and a packing fraction below 1', G4: 'reversal potential found at every level or at none' };
  /* what a failed gate means, for the stop message and the level's reason */
  const GATE_FAIL = {
    G1: 'Newton’s scaled residual is above 10⁻¹⁰', G2: 'a species flux deviates from its mean by more than 10⁻⁹ (relative) at some face',
    G3: 'a required observable or packing fraction is non-finite, a concentration is not positive and finite, or a packing fraction is outside [0, 1)', G4: 'a reversal potential is found at some grid levels but not at others',
  };
  const OBSERVABLES = ['current I at the set voltage, equal reservoirs', 'reversal potential V_rev under the 10:1 gradient'];
  const CONTRACT = 'lab/continuum/ions/data/closure-illustrative.json';

  const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
  const sig = (x, p) => Number(Number(x).toPrecision(p || 3)).toString();
  const pctTxt = (x) => sig(100 * x, 3) + ' %';
  const mVtxt = (V) => sig(1000 * V, 3) + ' mV';

  /* ------------------------------------------------------------------ rule 1: domain */
  function checkDomain(query) {
    const q = query || {}, reasons = [];
    for (const k of Object.keys(q)) if (!KEYS.includes(k)) reasons.push('UNKNOWN_INPUT:' + k);
    const o = Object.assign({}, Pm.DEFAULTS, { target: 'standard' }, q);
    for (const k of Object.keys(CODES)) if (!DOMAIN[k].includes(o[k])) reasons.push(CODES[k]);
    if (typeof o.V !== 'number' || !isFinite(o.V) || Math.abs(o.V) > V_MAX) reasons.push('VOLTAGE_OUT_OF_RANGE');
    return { supported: reasons.length === 0, reasons, o };
  }

  function defaultSolver() {
    return {
      current: (o, level) => Core.solve(Pm.build(Object.assign({}, o, { level })).s),
      reversal: (o, level) => Core.reversal(Pm.build(Object.assign({}, o, { level, cL: o.c, cR: o.c / o.gradient })).s),
    };
  }

  function queryRecord(o) {
    return {
      preset: o.preset, step: o.step, V_V: o.V, c_mol_m3: o.c, gradient: o.gradient, dp_Pa: o.dp, L_nm: o.L, T_K: Pm.T,
      solvation: o.solvation, lining: o.lining, epsP: o.epsP, rimN: o.rimN, rimW_nm: o.rimW, ionSize_nm: o.ionSize, Dratio: o.Dratio, slip_nm: o.slip,
      target: o.target,
    };
  }
  function objective(id) {
    const t = TARGETS[id];
    return {
      observables: OBSERVABLES.slice(),
      target: { id: String(id), label: t ? t.label : null, relative_current_change: t ? t.t : null, V_rev_change_V: t ? V_PER_T * t.t : null, absolute_current_floor_A: I_FLOOR },
    };
  }

  /* ------------------------------------------------------------------ gates G1–G3 of one level */
  function positiveFinite(r) {
    for (const a of r.c) for (const v of a) if (!(v > 0) || !isFinite(v)) return false;
    return true;
  }
  /* G1 as amended before the first official run (TOLERANCES.md): the scaled residual of test I6, not the solver's internal
     10⁻¹¹ stopping flag, which the reversal solve on the finest grid misses by round-off; the flag is kept in the record */
  const g1 = (r) => typeof r.residual === 'number' && isFinite(r.residual) && r.residual <= RESIDUAL_MAX;
  function currentGates(r, o) {
    const equilibrium = o.V === 0;                                   // equal reservoirs and Δp = 0: zero net flux
    return { newton: g1(r), solver_flag: !!r.ok, residual: num(r.residual), iterations: r.iterations, conservation_max_rel: equilibrium ? null : num(Math.max(...r.Jdev)), positive: positiveFinite(r), packing_max: num(r.packingMax) };
  }
  /* reversal solve: the relative face-to-mean deviation of the net salt flux is recorded but not gated (amended G2);
     G3 applies to both solves, as written in TOLERANCES.md (the packing fraction is below 1 by construction of core.js) */
  function reversalGates(rv) {
    if (!(rv && isFinite(rv.V) && rv.result)) return { found: false, newton: null, solver_flag: null, residual: null, conservation_max_rel: null, positive: null, packing_max: null };
    const r = rv.result;
    return { found: true, newton: g1(r), solver_flag: !!r.ok, residual: num(r.residual), conservation_max_rel: num(Math.max(...r.Jdev)), positive: positiveFinite(r), packing_max: num(r.packingMax) };
  }
  /* G2 and G3 as amended for release 2026.10.1 (TOLERANCES.md): every required diagnostic must be a finite number, because
     num() records a non-finite value as null and JavaScript evaluates null < 1 as true */
  function failedGate(e, foundAtLevel1, voltage) {
    const c = e.current, v = e.reversal;
    if (!c.newton || (v.found && !v.newton)) return 'G1';
    if (voltage !== 0 && (!Number.isFinite(c.conservation_max_rel) || c.conservation_max_rel < 0 || c.conservation_max_rel > CONSERVATION)) return 'G2';
    if (!Number.isFinite(e.I_A) || !c.positive || !Number.isFinite(c.packing_max) || c.packing_max < 0 || c.packing_max >= 1 ||
        (v.found && (!Number.isFinite(e.V_rev_V) || !v.positive || !Number.isFinite(v.packing_max) || v.packing_max < 0 || v.packing_max >= 1))) return 'G3';
    if (v.found !== foundAtLevel1) return 'G4';
    return null;
  }

  /* change from level a to level b and whether it satisfies the target */
  function change(a, b, target) {
    const dI = Math.abs(b.I_A - a.I_A), floor = Math.abs(a.I_A) < I_FLOOR && Math.abs(b.I_A) < I_FLOOR;
    const rel = floor || b.I_A === 0 ? null : dI / Math.abs(b.I_A);
    const dV = a.V_rev_V !== null && b.V_rev_V !== null ? Math.abs(b.V_rev_V - a.V_rev_V) : null;
    const okI = floor ? dI <= I_FLOOR : rel !== null && rel <= target.t;
    const okV = dV === null || dV <= V_PER_T * target.t;
    return { mode: floor ? 'absolute_floor' : 'relative', current_rel: rel, current_abs_A: dI, V_rev_V: dV, current_within: okI, V_rev_within: okV, within_target: okI && okV };
  }

  /* ------------------------------------------------------------------ rules 1–6, one level at a time (a generator, so the
     worker can let a newer request interrupt between levels); returns the numerical part of the record */
  function* steps(query, opts) {
    opts = opts || {};
    const now = opts.now || (() => Date.now()), solver = opts.solver || defaultSolver();
    const dom = checkDomain(query), o = dom.o;
    const out = { query: queryRecord(o), objective: objective(o.target), domain: { supported: dom.supported, reasons: dom.reasons, physical_flags: [] }, budget: { max_level: MAX_LEVEL }, levels: [], outcome: null };
    const stop = (status, extra) => {
      out.outcome = Object.assign({ status, reported_level: null, certified_by_level: null, I_A: null, V_rev_V: null, last_change: null, message: '' }, extra);
      return out;
    };
    if (!dom.supported) return stop('refused', { message: STATUS_TEXT.refused + ': ' + dom.reasons.join(', ') + '. Nothing was solved.' });
    const target = TARGETS[o.target];
    let found1 = null;
    const solveLevel = (level) => {
      const t0 = now(), pre = opts.pre && opts.pre[level];
      const r = pre && pre.current ? pre.current : solver.current(o, level);
      const rv = pre && pre.reversal ? pre.reversal : solver.reversal(o, level);
      const e = { level, nodes: r.x.length, I_A: num(r.I), V_rev_V: rv && isFinite(rv.V) ? rv.V : null, current: currentGates(r, o), reversal: reversalGates(rv),
        gates_passed: false, failed_gate: null, change: null, decision: 'stop', rule: 2, reason: '', ms: 0 };
      if (level === 1) { found1 = e.reversal.found; out.domain.physical_flags = (r.flags || []).map((f) => f.id); }
      e.failed_gate = failedGate(e, found1, o.V);
      e.gates_passed = e.failed_gate === null;
      e.ms = Math.max(0, now() - t0);
      return e;
    };
    const gateStop = (e) => {
      e.decision = 'stop'; e.rule = e.level === 1 ? 2 : 3;
      e.reason = 'Gate ' + e.failed_gate + ' failed at grid level ' + e.level + ': ' + GATE_FAIL[e.failed_gate] + '.';
      const status = e.failed_gate === 'G1' ? 'not_converged' : 'check_failed';
      return stop(status, { message: STATUS_TEXT[status] + ' at grid level ' + e.level + ': gate ' + e.failed_gate + ' failed (' + GATE_FAIL[e.failed_gate] + '). No result is certified.' });
    };

    let prev = solveLevel(1);
    out.levels.push(prev);
    if (!prev.gates_passed) return gateStop(prev);
    prev.decision = 'compare'; prev.rule = 3;
    prev.reason = 'Screening grid solved; the current and the reversal potential are compared with a twice-finer grid.';
    yield prev;
    for (let level = 2; level <= MAX_LEVEL; level++) {
      const e = solveLevel(level);
      out.levels.push(e);
      if (!e.gates_passed) return gateStop(e);
      e.change = change(prev, e, target);
      const ch = e.change;
      const chTxt = (ch.mode === 'absolute_floor' ? sig(ch.current_abs_A, 2) + ' A in the current (both currents below the 10⁻¹⁶ A floor)' : (ch.current_rel === null ? 'an undefined relative change' : pctTxt(ch.current_rel)) + ' in the current') +
        (ch.V_rev_V !== null ? ' and ' + mVtxt(ch.V_rev_V) + ' in the reversal potential' : '');
      const over = [!ch.current_within ? 'the current' : null, !ch.V_rev_within ? 'the reversal potential' : null].filter(Boolean).join(' and ');
      if (e.change.within_target) {
        e.decision = 'stop'; e.rule = 4;
        e.reason = 'From level ' + prev.level + ' to ' + level + ': ' + chTxt + ', within the ' + target.label + ' target.';
        yield e;
        return stop('tolerance_reached', { reported_level: prev.level, certified_by_level: level, I_A: prev.I_A, V_rev_V: prev.V_rev_V, last_change: e.change,
          message: STATUS_TEXT.tolerance_reached + ': on a twice-finer grid the level-' + prev.level + ' result changes by ' + chTxt + ', within the ' + target.label + ' target.' });
      }
      if (level < MAX_LEVEL) {
        e.decision = 'refine'; e.rule = 5;
        e.reason = 'From level ' + prev.level + ' to ' + level + ': ' + chTxt + '; the change in ' + over + ' is outside the ' + target.label + ' target, so refine to level ' + (level + 1) + '.';
        yield e;
        prev = e;
        continue;
      }
      e.decision = 'stop'; e.rule = 6;
      e.reason = 'From level ' + prev.level + ' to ' + level + ': ' + chTxt + '; the change in ' + over + ' is outside the ' + target.label + ' target, and level ' + MAX_LEVEL + ' is the end of the budget.';
      yield e;
      return stop('budget_exhausted', { reported_level: level, certified_by_level: null, I_A: e.I_A, V_rev_V: e.V_rev_V, last_change: e.change,
        message: STATUS_TEXT.budget_exhausted + ' at grid level ' + MAX_LEVEL + ': the last change, ' + chTxt + ', is outside the ' + target.label + ' target in ' + over + '. The level-' + MAX_LEVEL + ' result is shown; it is not certified to the target.' });
    }
    return out;                                                      // not reached: the loop always stops
  }
  function drain(gen) { let r = gen.next(); while (!r.done) r = gen.next(); return r.value; }
  const run = (query, opts) => drain(steps(query, opts));

  /* ------------------------------------------------------------------ one-at-a-time sensitivity ranking (level 1, +100 mV) */
  function* rankingSteps(query) {
    const o = Object.assign({}, Pm.DEFAULTS, query || {}, { level: 1 });
    const base = Core.solve(Pm.build(Object.assign({}, o, { V: 0.1 })).s), rows = [];
    for (const inp of Pm.sensitivityInputs(o)) {
      yield inp.id;
      const lo = Core.solve(Pm.build(Object.assign({}, o, inp.lo, { V: 0.1 })).s, { prev: base.state });
      const hi = Core.solve(Pm.build(Object.assign({}, o, inp.hi, { V: 0.1 })).s, { prev: base.state });
      rows.push({ id: inp.id, name: inp.name, range: inp.range, calc: inp.calc, Ilo: lo.I, Ihi: hi.I, I0: base.I, ok: lo.ok && hi.ok,
        factor: Math.max(Math.abs(hi.I), Math.abs(lo.I)) / Math.max(1e-300, Math.min(Math.abs(hi.I), Math.abs(lo.I))) });
    }
    rows.sort((p, q) => q.factor - p.factor);
    return { rows, I0: base.I };
  }
  const ranking = (query) => drain(rankingSteps(query));

  /* ------------------------------------------------------------------ rules 7–8: the full decision record */
  function lastRelativeChange(numerical) {
    const L = numerical.levels[numerical.levels.length - 1];
    if (!L || !L.change) return null;
    return L.change.mode === 'absolute_floor' ? 0 : L.change.current_rel;
  }
  function record(numerical, rank, meta) {
    const step = numerical.query.step, status = numerical.outcome.status;
    const rows = rank && Array.isArray(rank.rows) ? rank.rows : null, top = rows && rows.length ? rows[0] : null;
    const numericsOk = status === 'tolerance_reached' || status === 'budget_exhausted';
    const complete = !!rows && rows.every((r) => r.ok && isFinite(r.factor));
    const last = lastRelativeChange(numerical), L = numerical.levels[numerical.levels.length - 1];
    const floorMode = !!(L && L.change && L.change.mode === 'absolute_floor');
    const lastTxt = floorMode ? 'below the 10⁻¹⁶ A floor at 0 mV, recorded as 0' : last === null ? 'none' : pctTxt(last);
    const dominant = !!top && complete && last !== null && top.factor - 1 >= 10 * last;
    let request = null, rule;
    if (status === 'refused') rule = 'Not issued: the query is outside the supported domain.';
    else if (!numericsOk) rule = 'Not issued: the numerical problem comes first.';
    else if (step === 1) rule = 'Not issued: the classical model has no inputs with a stated range to rank; the ranking covers the inputs added by steps 2–6.';
    else if (!complete || !top) rule = 'Not issued: the sensitivity ranking is incomplete (a perturbed solve missed the solver’s own stopping criterion).';
    else if (!dominant) rule = 'Not issued: for the top-ranked input F − 1 = ' + sig(top.factor - 1, 3) + ', less than ten times the last relative change of the current (' + lastTxt + ').';
    else {
      rule = 'Issued under rule 7: numerics ' + (status === 'tolerance_reached' ? 'within the target' : 'at the end of the budget') + ', and for the top-ranked input F − 1 = ' + sig(top.factor - 1, 3) + ' is at least ten times the last relative change of the current (' + lastTxt + ').';
      request = {
        kind: 'calculation_request', input_id: top.id, input: top.name, range: top.range, sensitivity_factor: top.factor, calculation: top.calc,
        reason: 'Largest one-at-a-time sensitivity: across its stated range this input changes the current at +100 mV by a factor F = ' + sig(top.factor, 3) + ', against ' + (floorMode ? 'a current change between grid levels below the 10⁻¹⁶ A floor (0 mV; recorded as a relative change of 0)' : 'a last relative change of the current between grid levels of ' + pctTxt(last)) + '.',
        execution_status: 'not_run', human_approval_required: true, approved: false, submitted: false, expected_variance_reduction: null, cost_estimate: null,
      };
    }
    return {
      schema: SCHEMA, website_version: String((meta && meta.websiteVersion) || ''), policy: Object.assign({}, POLICY),
      query: numerical.query, objective: numerical.objective, domain: numerical.domain, budget: numerical.budget, levels: numerical.levels, outcome: numerical.outcome,
      molecular_evidence: {
        inputs_status: step >= 4 ? 'illustrative_closure' : step >= 2 ? 'illustrative_inputs' : 'no_ranked_inputs',
        closure_contract: step >= 4 ? CONTRACT : null,
        ranking_basis: 'one_at_a_time_sensitivity_not_information_gain',
        top_input: top ? { id: top.id, name: top.name, range: top.range, factor: top.factor } : null,
        request_rule: rule,
      },
      request,
      physical_validation: { status: 'not_run', reason: 'No matched molecular transport comparison exists for this pore; the difference between closures is a sensitivity, not a validation.' },
    };
  }

  /* ------------------------------------------------------------------ strict schema and consistency */
  const SHAPES = {
    top: ['schema', 'website_version', 'policy', 'query', 'objective', 'domain', 'budget', 'levels', 'outcome', 'molecular_evidence', 'request', 'physical_validation'],
    policy: ['type', 'version', 'rules', 'learning', 'language_model_used'],
    query: ['preset', 'step', 'V_V', 'c_mol_m3', 'gradient', 'dp_Pa', 'L_nm', 'T_K', 'solvation', 'lining', 'epsP', 'rimN', 'rimW_nm', 'ionSize_nm', 'Dratio', 'slip_nm', 'target'],
    objective: ['observables', 'target'],
    target: ['id', 'label', 'relative_current_change', 'V_rev_change_V', 'absolute_current_floor_A'],
    domain: ['supported', 'reasons', 'physical_flags'],
    budget: ['max_level'],
    level: ['level', 'nodes', 'I_A', 'V_rev_V', 'current', 'reversal', 'gates_passed', 'failed_gate', 'change', 'decision', 'rule', 'reason', 'ms'],
    current: ['newton', 'solver_flag', 'residual', 'iterations', 'conservation_max_rel', 'positive', 'packing_max'],
    reversal: ['found', 'newton', 'solver_flag', 'residual', 'conservation_max_rel', 'positive', 'packing_max'],
    change: ['mode', 'current_rel', 'current_abs_A', 'V_rev_V', 'current_within', 'V_rev_within', 'within_target'],
    outcome: ['status', 'reported_level', 'certified_by_level', 'I_A', 'V_rev_V', 'last_change', 'message'],
    molecular_evidence: ['inputs_status', 'closure_contract', 'ranking_basis', 'top_input', 'request_rule'],
    top_input: ['id', 'name', 'range', 'factor'],
    request: ['kind', 'input_id', 'input', 'range', 'sensitivity_factor', 'calculation', 'reason', 'execution_status', 'human_approval_required', 'approved', 'submitted', 'expected_variance_reduction', 'cost_estimate'],
    physical_validation: ['status', 'reason'],
  };
  function validate(rec) {
    const errors = [];
    const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
    const shape = (x, name, where) => {
      if (!isObj(x)) { errors.push(where + ': not an object'); return false; }
      const want = SHAPES[name], have = Object.keys(x);
      for (const k of have) if (!want.includes(k)) errors.push(where + ': unknown field ' + k);
      for (const k of want) if (!have.includes(k)) errors.push(where + ': missing field ' + k);
      return true;
    };
    if (!shape(rec, 'top', 'record')) return { valid: false, errors };
    if (rec.schema !== SCHEMA) errors.push('record: schema is not ' + SCHEMA);
    if (shape(rec.policy, 'policy', 'policy')) {
      if (rec.policy.type !== POLICY.type || rec.policy.learning !== false || rec.policy.language_model_used !== false) errors.push('policy: must be deterministic rules without learning or a language model');
    }
    shape(rec.query, 'query', 'query');
    if (shape(rec.objective, 'objective', 'objective')) shape(rec.objective.target, 'target', 'objective.target');
    shape(rec.domain, 'domain', 'domain');
    if (shape(rec.budget, 'budget', 'budget') && rec.budget.max_level !== MAX_LEVEL) errors.push('budget: max_level must be ' + MAX_LEVEL);
    if (!Array.isArray(rec.levels)) errors.push('levels: not an array');
    const levels = Array.isArray(rec.levels) ? rec.levels : [];
    levels.forEach((e, i) => {
      if (!shape(e, 'level', 'levels[' + i + ']')) return;
      shape(e.current, 'current', 'levels[' + i + '].current');
      shape(e.reversal, 'reversal', 'levels[' + i + '].reversal');
      if (e.change !== null) shape(e.change, 'change', 'levels[' + i + '].change');
      if (e.level !== i + 1) errors.push('levels[' + i + ']: level must be ' + (i + 1));
      if (i === 0 && e.change !== null) errors.push('levels[0]: the screening level has no change');
      if (i > 0 && e.gates_passed && e.change === null) errors.push('levels[' + i + ']: change missing');
      if (!['compare', 'refine', 'stop'].includes(e.decision)) errors.push('levels[' + i + ']: unknown decision');
      if (i < levels.length - 1 && e.decision === 'stop') errors.push('levels[' + i + ']: stop before the last level');
      if (i === levels.length - 1 && e.decision !== 'stop' && !(rec.outcome && rec.outcome.status === 'refused')) errors.push('levels[' + i + ']: the last level must stop');
      if (e.gates_passed !== (e.failed_gate === null)) errors.push('levels[' + i + ']: gates_passed and failed_gate disagree');
      if (e.gates_passed && isObj(e.current) && isObj(e.reversal) && isObj(rec.query)) {   // release 2026.10.1: a passed level must pass its own diagnostics
        const first = levels[0] && levels[0].reversal;
        if (failedGate(e, first && first.found, rec.query.V_V) !== null) errors.push('levels[' + i + ']: passed gates contradict diagnostics');
      }
    });
    const out = rec.outcome;
    if (shape(out, 'outcome', 'outcome')) {
      const st = out.status, tgt = TARGETS[rec.query && rec.query.target], last = levels[levels.length - 1];
      if (!Object.keys(STATUS_TEXT).includes(st)) errors.push('outcome: unknown status ' + st);
      if (st === 'refused') {
        if (levels.length) errors.push('refused: must have no levels');
        if (rec.domain && rec.domain.supported !== false) errors.push('refused: domain must be unsupported');
        if (out.reported_level !== null || out.I_A !== null) errors.push('refused: must report no result');
      } else {
        if (rec.domain && rec.domain.supported !== true) errors.push(st + ': domain must be supported');
        if (!levels.length) errors.push(st + ': must have at least one level');
      }
      if (st === 'not_converged' || st === 'check_failed') {
        if (out.reported_level !== null || out.certified_by_level !== null || out.I_A !== null) errors.push(st + ': must certify no result');
        if (rec.request !== null) errors.push(st + ': must carry no request');
        if (last && last.failed_gate === null) errors.push(st + ': the last level must have failed a gate');
        if (last && st === 'not_converged' && last.failed_gate !== 'G1') errors.push('not_converged: the failed gate must be G1');
        if (last && st === 'check_failed' && !['G2', 'G3', 'G4'].includes(last.failed_gate)) errors.push('check_failed: the failed gate must be G2, G3 or G4');
      }
      if (st === 'tolerance_reached') {
        if (levels.length < 2 || !last || !last.change || last.change.within_target !== true) errors.push('tolerance_reached: the last change must be within the target');
        if (out.reported_level !== levels.length - 1 || out.certified_by_level !== levels.length) errors.push('tolerance_reached: reported level must be the coarser level of the last pair');
        if (last && last.change && tgt) {
          const okI = last.change.mode === 'absolute_floor' ? last.change.current_abs_A <= I_FLOOR : last.change.current_rel !== null && last.change.current_rel <= tgt.t;
          const okV = last.change.V_rev_V === null || last.change.V_rev_V <= V_PER_T * tgt.t;
          if (!(okI && okV)) errors.push('tolerance_reached: the last change exceeds the stated target');
        }
        const rep = levels[out.reported_level - 1];
        if (rep && (rep.I_A !== out.I_A || rep.V_rev_V !== out.V_rev_V)) errors.push('tolerance_reached: reported values differ from the reported level');
      }
      if (st === 'budget_exhausted') {
        if (levels.length !== MAX_LEVEL || !last || !last.change || last.change.within_target !== false) errors.push('budget_exhausted: must end at level ' + MAX_LEVEL + ' with a change outside the target');
        if (out.reported_level !== MAX_LEVEL || out.certified_by_level !== null) errors.push('budget_exhausted: reports level ' + MAX_LEVEL + ' without certification');
        if (last && (last.I_A !== out.I_A || last.V_rev_V !== out.V_rev_V)) errors.push('budget_exhausted: reported values differ from level ' + MAX_LEVEL);
      }
    }
    if (shape(rec.molecular_evidence, 'molecular_evidence', 'molecular_evidence') && rec.molecular_evidence.top_input !== null) shape(rec.molecular_evidence.top_input, 'top_input', 'molecular_evidence.top_input');
    if (rec.request !== null) {
      if (shape(rec.request, 'request', 'request')) {
        const r = rec.request, st = out && out.status;
        if (r.kind !== 'calculation_request') errors.push('request: kind must be calculation_request');
        if (r.execution_status !== 'not_run' || r.human_approval_required !== true || r.approved !== false || r.submitted !== false) errors.push('request: must be not run, need human approval and not be submitted');
        if (r.expected_variance_reduction !== null || r.cost_estimate !== null) errors.push('request: must claim no variance reduction and no cost');
        if (!['tolerance_reached', 'budget_exhausted'].includes(st)) errors.push('request: only after numerics within the target or at the end of the budget');
        if (rec.query && rec.query.step === 1) errors.push('request: none in the classical model');
        const top = rec.molecular_evidence && rec.molecular_evidence.top_input;
        if (!top || top.id !== r.input_id) errors.push('request: must name the top-ranked input');
      }
    }
    if (shape(rec.physical_validation, 'physical_validation', 'physical_validation') && rec.physical_validation.status !== 'not_run') errors.push('physical_validation: no physical validation exists in this release');
    return { valid: errors.length === 0, errors };
  }

  /* ------------------------------------------------------------------ closure contracts */
  /* A closure may drive a calibrated prediction only with evidence status molecular_estimated or validated, every required
     value present (required: every value of the species, geometry and conditions sections), an estimated uncertainty and a
     passed physical validation. Nothing in this release qualifies. */
  function checkClosure(c) {
    const reasons = [];
    if (!c || c.artifact_kind !== 'transport_closure') return { status: 'invalid', usable_as_calibrated: false, reasons: ['NOT_A_TRANSPORT_CLOSURE'] };
    // minimum structure for a future molecular record (release 2026.10.1); this does not establish physical validation
    if (['molecular_estimated', 'validated'].includes(c.evidence_status)) {
      const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
      const str = (x) => typeof x === 'string' && x.trim().length > 0;
      const scalar = (q, unit, positive) => obj(q) && q.unit === unit && Number.isFinite(q.value) && (!positive || q.value > 0);
      const profile = (q, unit, length, positive) => obj(q) && q.unit === unit && Array.isArray(q.values) && q.values.length === length && q.values.every((v) => Number.isFinite(v) && (!positive || v > 0));
      const g = c.geometry, k = c.conditions, sp = c.species;
      const x = obj(g) && obj(g.axial_coordinate) ? g.axial_coordinate.values : null;
      const n = Array.isArray(x) ? x.length : 0;
      const geometryOk = obj(g) && n >= 2 && profile(g.axial_coordinate, 'm', n, false) &&
        x.every((v, i) => i === 0 || v > x[i - 1]) && profile(g.accessible_area, 'm^2', n, true) && str(g.area_convention);
      const conditionsOk = obj(k) && scalar(k.temperature, 'K', true) && scalar(k.reservoir_salt_concentration, 'mol m^-3', true) &&
        scalar(k.reference_voltage, 'V', false) && scalar(k.pressure_difference, 'Pa', false) &&
        ['geometry_id', 'chemistry_id', 'molecular_ensemble', 'molecular_boundary_conditions'].every((id) => str(k[id])) &&
        obj(k.continuum_boundary_conditions) && str(k.continuum_boundary_conditions.type);
      const speciesOk = Array.isArray(sp) && sp.length === 2 && [['Na+', 1], ['Cl-', -1]].every(([name, z]) => {
        const rows = sp.filter((s) => obj(s) && s.name === name && s.valence === z);
        return rows.length === 1 && profile(rows[0].excess_free_energy, 'J mol^-1', n, false) && profile(rows[0].axial_diffusivity, 'm^2 s^-1', n, true);
      });
      if (!(geometryOk && conditionsOk && speciesOk)) reasons.push('MOLECULAR_STRUCTURE_MISSING_OR_INVALID');
    }
    const nulls = [];
    const walk = (x, p) => {
      if (x === null) { nulls.push(p); return; }
      if (Array.isArray(x)) x.forEach((v, i) => walk(v, p + '[' + i + ']'));
      else if (typeof x === 'object') for (const k of Object.keys(x)) if (k === 'value' || k === 'values' || typeof x[k] === 'object') walk(x[k], p ? p + '.' + k : k);
    };
    walk(c.species || [], 'species'); walk(c.geometry || {}, 'geometry'); walk(c.conditions || {}, 'conditions');
    if (nulls.length) reasons.push('NULL_REQUIRED_VALUES:' + nulls.length);
    if (!['molecular_estimated', 'validated'].includes(c.evidence_status)) reasons.push('EVIDENCE_STATUS_' + String(c.evidence_status).toUpperCase());
    if (!c.uncertainty || c.uncertainty.status !== 'estimated') reasons.push('UNCERTAINTY_NOT_ESTIMATED');
    if (!c.validation || c.validation.physical_status !== 'passed') reasons.push('NO_PHYSICAL_VALIDATION');
    const status = nulls.length ? 'blocked' : c.evidence_status === 'illustrative' ? 'illustrative' : reasons.length ? 'not_calibrated' : 'calibrated';
    return { status, usable_as_calibrated: reasons.length === 0, reasons, null_paths: nulls };
  }

  return {
    SCHEMA, POLICY, TARGETS, V_PER_T, I_FLOOR, MAX_LEVEL, CONSERVATION, RESIDUAL_MAX, DOMAIN, V_MAX, KEYS, STATUS_TEXT, GATE_TEXT, GATE_FAIL, CONTRACT,
    checkDomain, defaultSolver, steps, run, rankingSteps, ranking, record, validate, checkClosure, change, lastRelativeChange,
  };
});
