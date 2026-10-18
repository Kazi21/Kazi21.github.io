// Check 7 (browser part): pull a molecule across a cell face, hold, release, relax; repeat in a fresh engine;
// export the experiment for the native replay (t7_native_replay.py).
'use strict';
const H = require('./harness.js');
async function protocol() {
  const { A } = await H.newAdapter({ molecules: 216, ensemble: 'npt' });
  for (let i = 0; i < 20; i++) A.runSteps(10);
  const s0 = A.getSnapshot();
  const lo = s0.box.lo[0], L = s0.box.hi[0] - lo;
  // molecule whose wrapped centre of mass lies 0.5-2.5 A inside the +x face
  let mol = 0;
  for (let m = 1; m <= A.topo.nmol && !mol; m++) {
    A.select(m);
    const R = A.com(), w = lo + ((R[0] - lo) % L + L) % L;
    if (lo + L - w < 2.5 && lo + L - w > 0.5) mol = m;
  }
  A.select(mol);
  A.beginPull(mol, { k: 5 });
  const X0 = A.st.X.slice();
  const geo = { maxdr: 0, maxdth: 0 }, Rs = [];
  const track = (s) => { const g = H.geometry(s.x, A.topo); geo.maxdr = Math.max(geo.maxdr, g.maxdr); geo.maxdth = Math.max(geo.maxdth, g.maxdth); Rs.push(s.R.slice()); };
  for (let i = 1; i <= 200; i++) { A.updatePullTarget([X0[0] + 6 * i / 200, X0[1], X0[2]]); track(A.runSteps(10)); }
  for (let i = 0; i < 50; i++) track(A.runSteps(10));
  A.releasePull();
  for (let i = 0; i < 100; i++) track(A.runSteps(10));
  let maxJump = 0, crossings = 0;
  for (let i = 1; i < Rs.length; i++) {
    maxJump = Math.max(maxJump, Math.hypot(Rs[i][0] - Rs[i - 1][0], Rs[i][1] - Rs[i - 1][1], Rs[i][2] - Rs[i - 1][2]));
    if (Math.floor((Rs[i][0] - lo) / L) !== Math.floor((Rs[i - 1][0] - lo) / L)) crossings++;
  }
  const exp = A.exportExperiment({ runId: 7, engine: 'LAMMPS ' + A.L.version() + ' WebAssembly (Node test harness)', created: '2026-10-18T00:00:00Z', engineVersion: A.L.version() });
  const xfinal = A.L.gather(false, false).x;
  const release = A.events.find((e) => e.type === 'release');
  A.dispose();
  return { mol, geo, maxJump, crossings, exp, xfinal, release, X0 };
}
(async () => {
  const a = await protocol();
  const b = await protocol();
  const journalSame = a.exp.journal.length === b.exp.journal.length && a.exp.journal.every((j, i) => j.cmd === b.exp.journal[i].cmd && j.step === b.exp.journal[i].step);
  const eventsSame = a.exp.events.length === b.exp.events.length && a.exp.events.every((e, i) => e.type === b.exp.events[i].type && e.step === b.exp.events[i].step);
  const coordDiff = H.maxAbsDiff(a.xfinal, b.xfinal);
  const W = a.release.delivered_work_kJ_mol, dE = a.release.energy_change_kJ_mol;
  const balanceErr = Math.abs(dE - W), balanceTol = 0.02 * Math.abs(W) + 0.5;
  // write the export for the native replay
  const dir = H.path.join(H.RESULTS, 't7_export');
  H.fs.mkdirSync(dir, { recursive: true });
  const files = H.EXP.buildFiles(a.exp, H.W);
  for (const [n, txt] of Object.entries(files)) H.fs.writeFileSync(H.path.join(dir, n), txt);
  const part = { molecule: a.mol, k_kcal_mol_A2: 5, constraints: { max_OH_dev_A: a.geo.maxdr, max_angle_dev_deg: a.geo.maxdth },
    face_crossings: a.crossings, max_com_step_A: a.maxJump, journal_commands: a.exp.journal.length, events: a.exp.events.length,
    repeat_identical_journal: journalSame, repeat_identical_events: eventsSame, repeat_max_coordinate_diff_A: coordDiff,
    release: a.release, energy_balance_error_kJ_mol: balanceErr, energy_balance_tolerance_kJ_mol: balanceTol, steps: a.exp.meta.steps,
    export_files: Object.keys(files) };
  part.browser_pass = a.geo.maxdr <= 1e-4 && a.geo.maxdth <= 0.01 && a.crossings >= 1 && a.maxJump <= 0.5 && journalSame && eventsSame && coordDiff === 0 && balanceErr <= balanceTol;
  H.fs.writeFileSync(H.path.join(H.RESULTS, 't7_browser.json'), JSON.stringify(part, null, 1));
  console.log(JSON.stringify(part, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
