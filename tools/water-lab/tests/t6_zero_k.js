// Check 6: with zero stiffness the page's tether (and a selection) leaves the trajectory bit-for-bit unchanged.
'use strict';
const H = require('./harness.js');
(async () => {
  const { A } = await H.newAdapter({ molecules: 216, ensemble: 'nvt' });
  for (let i = 0; i < 30; i++) A.runSteps(10);
  A.select(H.centralMolecule(A.L.gather(false, false).x, A.L.box(), A.topo));
  for (let i = 0; i < 70; i++) A.runSteps(10);
  const xa = A.L.gather(false, false).x, stepA = A.L.step();
  A.dispose();
  const { core, cmds } = await H.buildCore(216, { ensemble: 'nvt', edit: H.withoutTether });
  for (let i = 0; i < 100; i++) core.command('run 10 pre no post no');
  const xb = core.gather(false, false).x, stepB = core.step();
  core.close();
  const dmax = H.maxAbsDiff(xa, xb);
  const ok = stepA === stepB && dmax <= 1e-10;
  const res = { id: 6, name: 'Zero stiffness reproduces the unperturbed control', verdict: ok ? 'PASS' : 'FAIL', tolerances: { max_coordinate_diff_A: 1e-10 },
    steps: stepA, control_commands_removed: cmds.length, max_coordinate_diff_A: dmax,
    summary: `after ${stepA} steps the coordinates differ by ${dmax === 0 ? 'exactly 0' : dmax.toExponential(2) + ' A'} from the run without the tether` };
  H.save('t6.json', res);
  console.log('check 6:', res.verdict, '-', res.summary);
  if (res.verdict !== 'PASS') process.exit(1);                 // failure status for scripts and CI
})().catch((e) => { console.error(e); process.exit(1); });
