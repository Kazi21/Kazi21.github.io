/* Live Water Lab — simulation worker. Owns the LAMMPS WebAssembly engine and runs molecular dynamics in
   bounded chunks, so the page stays responsive. Every message carries the run ID of the system it belongs to;
   messages for an older (rebuilt or reset) system are acknowledged as stale and never touch the engine.
   Visitor actions are applied only between chunks (the worker is single-threaded), i.e. at a safe boundary. */
'use strict';
importScripts('engine/lammps-water.js', 'engine/lammps-core.js', 'engine/water-model.js', 'engine/water-adapter.js');

const MAX_INFLIGHT = 2;            // snapshots the page has not drawn yet; beyond this the worker waits
let modulePromise = null;
let adapter = null;
let runId = 0;
let running = false;
let inflight = 0;
let pace = 'normal';
let scheduled = false;
let sentRecords = 0;
let allowTestHooks = false;
let engineInfo = null;

const channel = new MessageChannel();
channel.port1.onmessage = () => { scheduled = false; tick(); };

function post(msg, transfer) { self.postMessage(msg, transfer || []); }

function getModule() {
  if (!modulePromise) {
    modulePromise = self.createLammpsModule({
      locateFile: (p) => 'engine/' + p,
      print: () => {},
      printErr: (s) => { if (s && !/^WARNING/.test(s)) console.warn('[lammps]', s); },
    });
  }
  return modulePromise;
}

function schedule() {
  if (scheduled || !running || !adapter || inflight >= MAX_INFLIGHT) return;
  scheduled = true;
  channel.port2.postMessage(0);          // yield to the message queue, then run the next chunk
}

function packSnapshot(s, extra) {
  const x = s.x ? new Float32Array(s.x) : null;
  delete s.x;
  const newRecords = adapter.records.slice(sentRecords);
  sentRecords = adapter.records.length;
  const msg = Object.assign({ type: 'snapshot', runId, snap: s, x, newRecords, events: adapter.takeNewEvents() }, extra || {});
  return { msg, transfer: x ? [x.buffer] : [] };
}

function sendSnapshot(s, extra) {
  const p = packSnapshot(s, extra);
  inflight++;
  post(p.msg, p.transfer);
}

function fatal(e, where) {
  running = false;
  post({ type: 'error', runId, fatal: true, where, message: (e && e.message) || String(e) });
}

function tick() {
  if (!running || !adapter || inflight >= MAX_INFLIGHT) return;
  const p = self.WaterModel.PACE[pace] || self.WaterModel.PACE.normal;
  const t0 = performance.now();
  let s;
  try {
    for (let c = 0; c < p.chunks; c++) s = adapter.runSteps(p.steps, c === p.chunks - 1);
  } catch (e) { fatal(e, 'run'); return; }
  const ms = performance.now() - t0;
  sendSnapshot(s, { computeMs: ms, chunkSteps: p.steps * p.chunks });
  schedule();
}

function summary() {
  if (!adapter) return null;
  const st = adapter.st;
  return { running, pace, ensemble: st.ensemble, T: st.T, Pbar: st.Pbar, ljScale: st.ljScale, pulling: st.pulling,
           k: st.k, sel: st.selActive ? st.sel : 0, phase: st.phase, step: adapter.L.step() };
}

async function initialize(m) {
  runId = m.runId;
  running = false; inflight = 0; scheduled = false; sentRecords = 0;
  allowTestHooks = !!m.config.allowTestHooks;
  if (adapter) { adapter.dispose(); adapter = null; }
  let M;
  try { M = await getModule(); } catch (e) { post({ type: 'error', runId: m.runId, fatal: true, where: 'load', message: 'The simulation engine could not be loaded: ' + e.message }); return; }
  if (m.runId !== runId) return;                    // superseded while the engine was loading
  try {
    const core = new self.LammpsCore(M).open();
    engineInfo = { version: core.version(), packages: ['MOLECULE', 'KSPACE', 'RIGID'].filter((p) => core.hasPackage(p)) };
    adapter = new self.WaterAdapter(core, self.WaterModel);
    const s = adapter.initialize(m.config);
    const t = adapter.topo;
    const p = packSnapshot(s, {});
    p.msg.type = 'ready';
    p.msg.engine = engineInfo;
    p.msg.topology = { natoms: t.natoms, nmol: t.nmol, type: t.type, mol: t.mol, bonds: t.bonds, molAtoms: t.molAtoms, q: t.q };
    p.msg.state = summary();
    post(p.msg, p.transfer);
  } catch (e) {
    if (adapter) { adapter.dispose(); adapter = null; }
    post({ type: 'error', runId: m.runId, fatal: true, where: 'initialize', message: e.message });
  }
}

self.onmessage = (ev) => {
  const m = ev.data || {};
  if (m.type === 'initialize') { initialize(m); return; }
  if (m.type === 'frame') {                            // the page drew n snapshots
    if (m.runId === runId) { inflight = Math.max(0, inflight - (m.n || 1)); schedule(); }
    return;
  }
  if (m.runId !== runId || !adapter) {
    post({ type: 'ack', runId: m.runId, cmdId: m.cmdId, ok: false, stale: true, error: 'stale message for a previous system' });
    return;
  }
  let result = null;
  try {
    switch (m.type) {
      case 'start': running = true; break;
      case 'pause': running = false; adapter.pause(); break;
      case 'pace': if (self.WaterModel.PACE[m.pace]) pace = m.pace; break;
      case 'setConditions': adapter.setConditions(m.targets); break;
      case 'setLJScale': adapter.setLJScale(m.scale); break;
      case 'select': adapter.select(m.molecule); break;
      case 'beginPull': adapter.beginPull(m.molecule, m.settings); result = { X: adapter.st.X.slice() }; break;   // handle start (= centre of mass)
      case 'updatePullTarget': adapter.updatePullTarget(m.position); break;
      case 'setStiffness': adapter.setStiffness(m.k); break;
      case 'releasePull': adapter.releasePull(); break;
      case 'removeDrift': adapter.removeDrift(); break;
      case 'export': result = adapter.exportExperiment(Object.assign({ engine: 'LAMMPS ' + engineInfo.version + ' (WebAssembly)' }, m.meta)); break;
      case 'testFail':
        if (!allowTestHooks) throw new Error('test hooks are disabled');
        adapter.L.command('deliberately_invalid_command_for_testing');
        break;
      case 'dispose': running = false; adapter.dispose(); adapter = null; break;
      default: throw new Error('unknown command ' + m.type);
    }
  } catch (e) {
    const isEngine = !!e.lammps;
    post({ type: 'ack', runId, cmdId: m.cmdId, ok: false, error: e.message, events: adapter ? adapter.takeNewEvents() : [], state: summary() });
    if (isEngine) fatal(e, m.type);                     // a LAMMPS error leaves the instance unusable: the page offers Reset
    return;
  }
  post({ type: 'ack', runId, cmdId: m.cmdId, ok: true, result, events: adapter ? adapter.takeNewEvents() : [], state: summary() });
  schedule();
};
