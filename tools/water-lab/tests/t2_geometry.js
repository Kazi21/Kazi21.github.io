// Check 2: geometry, neutrality, topology and periodic wrapping (presets and a 5 ps browser-engine NVT run).
'use strict';
const H = require('./harness.js');
(async () => {
  const presets = [];
  let ok = true;
  for (const N of H.W.RANGES.molecules) {
    const topo = H.W.parseTopology(H.presetText(N));
    let topoOK = topo.nmol === N && topo.natoms === 3 * N && topo.bonds.length === 4 * N;
    for (let m = 0; m < topo.nmol && topoOK; m++) {
      const a = [0, 1, 2].map((k) => topo.molAtoms[3 * m + k]);
      topoOK = a.every((i) => i >= 0 && topo.mol[i] === m + 1) && topo.type[a[0]] === 1 && topo.type[a[1]] === 2 && topo.type[a[2]] === 2;
    }
    const nAngles = parseInt((H.presetText(N).match(/^\s*(\d+)\s+angles/m) || [])[1], 10);
    let q = 0; for (let i = 0; i < topo.natoms; i++) q += topo.q[i];
    const { core } = await H.buildCore(N, { ensemble: 'nvt' });
    const g = H.geometry(core.gather(false, false).x, topo);
    core.close();
    const pass = topoOK && nAngles === N && Math.abs(q) <= 1e-10 && g.maxdr <= 1e-4 && g.maxdth <= 0.01;
    ok = ok && pass;
    presets.push({ molecules: N, topology_ok: topoOK, angles: nAngles, total_charge_e: q, max_OH_dev_A: g.maxdr, max_angle_dev_deg: g.maxdth, pass });
    console.log(`preset ${N}: topology ${topoOK}, angles ${nAngles}, q ${q.toExponential(2)}, |dOH| ${g.maxdr.toExponential(2)} A, |dtheta| ${g.maxdth.toExponential(2)} deg`);
  }
  // 5 ps NVT in the page adapter; check every 10 fs, including display wrapping
  const { A } = await H.newAdapter({ molecules: 216, ensemble: 'nvt' });
  const topo = A.topo;
  let maxdr = 0, maxdth = 0, wrapOK = true, snaps = 0;
  for (let i = 0; i < 500; i++) {
    const s = A.runSteps(10);
    const g = H.geometry(s.x, topo); maxdr = Math.max(maxdr, g.maxdr); maxdth = Math.max(maxdth, g.maxdth);
    const L = [0, 1, 2].map((d) => s.box.hi[d] - s.box.lo[d]);
    for (let m = 0; m < topo.nmol; m++) {          // same wrapping rule as the page renderer
      const o = topo.molAtoms[3 * m];
      for (let k = 0; k < 3; k++) { const w = s.box.lo[k] + ((s.x[3 * o + k] - s.box.lo[k]) % L[k] + L[k]) % L[k]; if (!(w >= s.box.lo[k] && w < s.box.hi[k])) wrapOK = false; }
    }
    snaps++;
  }
  A.dispose();
  const runPass = maxdr <= 1e-4 && maxdth <= 0.01 && wrapOK;
  ok = ok && runPass;
  const res = { id: 2, name: 'Geometry, neutrality, topology and periodic wrapping', verdict: ok ? 'PASS' : 'FAIL',
    tolerances: { OH_A: 1e-4, angle_deg: 0.01, charge_e: 1e-10 }, presets,
    nvt_run: { molecules: 216, duration_ps: 5, snapshots: snaps, max_OH_dev_A: maxdr, max_angle_dev_deg: maxdth, oxygen_wrapped_inside_cell: wrapOK, pass: runPass },
    summary: `all presets whole and neutral; over 5 ps, max |O-H - 1 A| = ${maxdr.toExponential(2)} A and max |angle - 109.47| = ${maxdth.toExponential(2)} deg` };
  H.save('t2.json', res);
  console.log('check 2:', res.verdict, '-', res.summary);
  if (res.verdict !== 'PASS') process.exit(1);                 // failure status for scripts and CI
})().catch((e) => { console.error(e); process.exit(1); });
