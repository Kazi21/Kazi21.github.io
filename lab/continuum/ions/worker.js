/* Continuum Lab — ion experiment worker: runs the solver and the numerical controller off the page's main thread.
   Loads only this site's files (core.js, params.js, controller.js). One request at a time; a newer request makes the
   worker skip the remaining stages of the older one. Stages are posted as they finish so the page can show results early:
     main       — the selected model at the displayed voltage on the screening grid (level 1), and all six steps
     iv         — current–voltage curves of the selected model and of the classical reference, −200 … +200 mV
     sel        — reversal potential and GHK-equivalent selectivity under the 10:1 gradient, model and reference
     ctrl-level — one grid level checked by the numerical controller (rules: tools/continuum/ions/TOLERANCES.md)
     ctrl       — the controller's outcome: tolerance reached, budget exhausted, not converged, check failed or refused
     sens       — one-at-a-time sensitivity ranking of the illustrative inputs at +100 mV (screening grid)
     decision   — the decision record: numerics, the calculation request if rule 7 issues one, physical validation
     done       — end of the request */
/* global importScripts, IonCore, IonParams, IonController */
importScripts('core.js', 'params.js', 'controller.js');
let latest = 0;
const VS = []; for (let v = -200; v <= 200; v += 25) VS.push(v / 1000);

function slim(r) {                                                   // what the page needs from a solution
  return {
    ok: r.ok, iterations: r.iterations, residual: r.residual, continuationSteps: r.continuationSteps, nodes: r.x.length,
    x: r.x, r: r.r, half: r.half, phi: r.phi, c: r.c, muEx: r.muEx, J: r.J, Jdev: r.Jdev, I: r.I, Ispecies: r.Ispecies, Q: r.Q, Rh: r.Rh,
    nInPore: r.nInPore, packingMax: r.packingMax, debyeLength: r.debyeLength, poreRadius: r.poreRadius, flags: r.flags,
  };
}

function summary(r, step, sv) {
  // advective share of the current at the pore centre: I_adv = F Q (c_Na − c_Cl)
  let k0 = 0; for (let k = 0; k < r.x.length; k++) if (Math.abs(r.x[k]) < Math.abs(r.x[k0])) k0 = k;
  const Iadv = IonCore.K.F * r.Q * (r.c[0][k0] - r.c[1][k0]);
  return { step, ok: r.ok, I: r.I, INa: r.Ispecies[0], ICl: r.Ispecies[1], nNa: r.nInPore[0], nCl: r.nInPore[1], Q: r.Q, pack: r.packingMax, Iadv, phiC: r.phi[k0],
    dG: step >= 4 ? [sv.Na, sv.Cl] : [0, 0], flags: r.flags.map((f) => f.id) };
}

const yieldNow = () => new Promise((res) => setTimeout(res, 0));   // lets a newer request arrive between stages

self.onmessage = async function (ev) {
  const m = ev.data || {};
  if (m.type !== 'run') return;
  const id = m.id; latest = id;
  const query = m.opts || {}, meta = { websiteVersion: m.version || '' };
  const o = Object.assign({}, IonParams.DEFAULTS, { target: 'standard' }, query);
  const stale = () => latest !== id;
  const post = (stage, data) => self.postMessage({ id, stage, data });
  try {
    const t0 = Date.now();
    // rule 1 of the controller first: a query outside the supported domain is refused and nothing is solved
    if (!IonController.checkDomain(query).supported) {
      const numerical = IonController.run(query);
      post('ctrl', { numerical, ms: 0 });
      post('decision', { record: IonController.record(numerical, null, meta) });
      post('done', { ms: Date.now() - t0 });
      return;
    }
    const b = IonParams.build(o), main = IonCore.solve(b.s);
    const ref = IonCore.solve(IonParams.build(Object.assign({}, o, { step: 1 })).s);
    // all six steps at the set voltage (same geometry and settings): the comparison table and "why did this change?"
    const ladder = [];
    for (let st = 1; st <= 6; st++) {
      const r = st === o.step ? main : (st === 1 ? ref : IonCore.solve(IonParams.build(Object.assign({}, o, { step: st })).s));
      ladder.push(summary(r, st, IonParams.build(Object.assign({}, o, { step: st })).solvation));
    }
    post('main', { opts: o, model: slim(main), reference: slim(ref), ladder, solvation: b.solvation, geometry: b.geometry, ms: Date.now() - t0 });
    await yieldNow(); if (stale()) return;
    const t1 = Date.now();
    const ivModel = IonCore.ivCurve(b.s, VS), ivRef = IonCore.ivCurve(IonParams.build(Object.assign({}, o, { step: 1 })).s, VS);
    post('iv', { V: VS, model: ivModel, reference: ivRef, ms: Date.now() - t1 });
    await yieldNow(); if (stale()) return;
    const t2 = Date.now(), grad = { cL: o.c, cR: o.c / o.gradient };
    const rvM = IonCore.reversal(IonParams.build(Object.assign({}, o, grad)).s), rvR = IonCore.reversal(IonParams.build(Object.assign({}, o, grad, { step: 1 })).s);
    post('sel', {
      model: { V: rvM.V, ok: rvM.ok, I: rvM.I, Q: rvM.result ? rvM.result.Q : 0, sel: isFinite(rvM.V) ? IonParams.selectivity(o, rvM.V) : null },
      reference: { V: rvR.V, ok: rvR.ok, I: rvR.I, sel: isFinite(rvR.V) ? IonParams.selectivity(Object.assign({}, o, { step: 1 }), rvR.V) : null },
      ms: Date.now() - t2,
    });
    await yieldNow(); if (stale()) return;
    // numerical controller: level 1 is the screening result above; finer levels are solved here, one at a time
    const t25 = Date.now(), gen = IonController.steps(query, { pre: { 1: { current: main, reversal: rvM } } });
    let it;
    while (!(it = gen.next()).done) { post('ctrl-level', { entry: it.value }); await yieldNow(); if (stale()) return; }
    const numerical = it.value;
    post('ctrl', { numerical, ms: Date.now() - t25 });
    await yieldNow(); if (stale()) return;
    const t3 = Date.now(), rg = IonController.rankingSteps(o);
    while (!(it = rg.next()).done) { await yieldNow(); if (stale()) return; }
    const rank = it.value;
    post('sens', { rows: rank.rows, I0: rank.I0, ms: Date.now() - t3 });
    post('decision', { record: IonController.record(numerical, rank, meta) });
    post('done', { ms: Date.now() - t0 });
  } catch (e) {
    post('error', { message: String((e && e.message) || e) });
  }
};
