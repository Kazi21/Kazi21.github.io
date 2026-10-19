/* Continuum Lab — continuum worker. Runs the browser CFD solver (core/solver.js) off the main thread so the page stays
   responsive, and cancels obsolete solves instead of queueing them.

   Protocol (every request and result carries the revision number assigned by the page):
     page -> worker  { type: 'init', manifest }
                     { type: 'solve', revision, scenario, purpose: 'run' | 'meshCheck' }
                     { type: 'setBaseline', revision }       the result of that revision is the page's baseline
                     { type: 'reset' }                        forget stored states (the page may also terminate the worker)
     worker -> page  { type: 'ready', solverVersion }
                     { type: 'state', revision, state: 'solving' | 'cancelled' | 'unsupported' | 'failed', reasons, message }
                     { type: 'progress', revision, iterations, estimate }
                     { type: 'result', revision, configId, lawId, geometryHash, solverVersion, ... }
                     { type: 'refinement', revision, configId, levelRun, levelComparison, Q_run_m3_s, Q_comparison_m3_s, rel, state }
                       after every run: the same configuration at a second mesh level (core/experiment.js refinementGen)
   A request with a newer revision cancels the running solve at its next block of iterations (every 50 MINRES
   iterations); results always carry the revision they were computed for, and the page discards any result that is
   not for its current revision. Changes of the membrane only (same device, drive, law and mesh as a stored state:
   the page's baseline first, otherwise the most recent full solution) are computed as changes of that state
   (core/solver.js solveChange), which keeps small changes exact. A mesh check (purpose 'meshCheck') is queued
   separately and never displaces a pending run. */
'use strict';
importScripts('core/units.js', 'core/pore-law.js', 'core/membrane-map.js', 'core/scenario.js', 'core/solver.js', 'core/experiment.js');
const SC = self.ContinuumScenario, SV = self.ContinuumSolver, E = self.ContinuumExperiment;

let manifest = null;
let latest = 0;                 // newest revision requested
let busy = false, pendingRun = null, pendingCheck = null;
let baseline = null;            // solved state the page uses as its baseline { revision, run }
let recent = null;              // most recent full solution { revision, run }
let last = null;                // most recent completed run

/* zero-delay yield to the event loop so new messages are seen between blocks of iterations */
const chan = new MessageChannel();
let wake = null;
chan.port1.onmessage = () => { const w = wake; wake = null; if (w) w(); };
const yieldNow = () => new Promise((r) => { wake = r; chan.port2.postMessage(0); });

self.onmessage = (e) => {
  const m = e.data || {};
  if (m.type === 'init') { manifest = m.manifest; self.postMessage({ type: 'ready', solverVersion: SV.SOLVER_VERSION }); return; }
  if (m.type === 'reset') { baseline = null; recent = null; last = null; pendingRun = null; pendingCheck = null; return; }
  if (m.type === 'setBaseline') { if (last && last.revision === m.revision) baseline = last; return; }
  if (m.type === 'solve') {
    if (m.solverVersion && m.solverVersion !== SV.SOLVER_VERSION) { self.postMessage({ type: 'state', revision: m.revision, state: 'failed', message: 'solver version mismatch' }); return; }
    latest = Math.max(latest, m.revision);
    if (m.purpose === 'meshCheck') pendingCheck = m; else pendingRun = m;
    if (!busy) pump();
  }
};

async function pump() {
  busy = true;
  while (pendingRun || pendingCheck) {
    let job;
    if (pendingRun) { job = pendingRun; pendingRun = null; } else { job = pendingCheck; pendingCheck = null; }
    if (job.revision < latest) continue;            // superseded before it started
    try { await runJob(job); } catch (err) {
      self.postMessage({ type: 'state', revision: job.revision, state: 'failed', message: String(err && err.message || err) });
    }
  }
  busy = false;
}

function payloadOf(job, res, extra) { return E.payload(res, job.revision, job.purpose, extra); }
function transferList(p) {
  const t = [];
  const add = (a) => { if (a && a.buffer && t.indexOf(a.buffer) < 0) t.push(a.buffer); };
  p.chambers.forEach((c) => { add(c.u); add(c.v); add(c.w); add(c.p); });
  if (p.change) { add(p.change.dJ_m_s); add(p.change.dPi_Pa); add(p.change.dS); }
  return t;                     // membrane arrays are copied: the stored state keeps them for later change solves
}

async function runJob(job) {
  if (!manifest) throw new Error('worker not initialised');
  const sc = job.scenario, rev = job.revision;
  self.postMessage({ type: 'state', revision: rev, state: 'solving' });
  const isRun = job.purpose !== 'meshCheck';
  let gen, mode, ref = null;
  if (isRun && baseline && E.sameDevice(baseline.run.sc, sc)) ref = baseline;
  else if (isRun && recent && E.sameDevice(recent.run.sc, sc)) ref = recent;
  if (ref) { gen = E.runChangeGen(ref.run, sc, manifest); mode = 'change'; }
  else {
    // warm start for a pure pressure change of the last solved state (the system is linear in the pressure difference)
    let x0;
    if (isRun && last && last.run.sc.dP_Pa !== 0 && JSON.stringify(Object.assign({}, last.run.sc, { dP_Pa: 0 })) === JSON.stringify(Object.assign({}, sc, { dP_Pa: 0 }))) {
      const ratio = sc.dP_Pa / last.run.sc.dP_Pa; x0 = last.run.sol.x.map((v) => v * ratio);
    }
    gen = E.runGen(sc, manifest, { solver: x0 ? { x0 } : undefined }); mode = x0 ? 'full (warm start from the scaled previous solution)' : 'full';
  }
  let r = gen.next(), lastPost = 0;
  while (!r.done) {
    if (latest > rev) { self.postMessage({ type: 'state', revision: rev, state: 'cancelled' }); return; }
    const now = Date.now();
    if (now - lastPost > 120) { self.postMessage({ type: 'progress', revision: rev, iterations: r.value.iterations, estimate: r.value.estimate }); lastPost = now; }
    await yieldNow();
    if (latest > rev) { self.postMessage({ type: 'state', revision: rev, state: 'cancelled' }); return; }
    r = gen.next();
  }
  const res = r.value;
  if (latest > rev) { self.postMessage({ type: 'state', revision: rev, state: 'cancelled' }); return; }
  if (!res.ok) { self.postMessage({ type: 'state', revision: rev, state: 'unsupported', reasons: res.reasons }); return; }
  const extra = { mode };
  if (mode === 'change') extra.refRevision = ref.revision;
  if (isRun) {
    last = { revision: rev, run: res };
    if (mode !== 'change') recent = last;
  }
  const p = payloadOf(job, res, extra);
  self.postMessage(p, transferList(p));
  if (!isRun) return;
  // total-flow resolution of this same configuration at a second mesh level (E.refinementGen); abandoned as soon as a
  // newer request arrives, because that request brings its own check
  const g = E.refinementGen(sc, manifest, res.diag.Q_m3_s);
  let rr = g.next();
  while (!rr.done) {
    if (latest > rev) return;
    await yieldNow();
    if (latest > rev) return;
    rr = g.next();
  }
  if (latest > rev) return;
  self.postMessage(Object.assign({ type: 'refinement', revision: rev }, rr.value));
}
