// Check 1 (browser part): evaluates identical configurations in the browser engine and stores the exact commands,
// so t1_native_compare.py can run the same commands in native LAMMPS.
'use strict';
const H = require('./harness.js');
const CASES = [
  { id: 'preset216_s1.00', N: 216, s: 1.0 },
  { id: 'preset216_s1.10', N: 216, s: 1.1 },
  { id: 'preset512_s0.90', N: 512, s: 0.9 },
  { id: 'preset216_tether_k5', N: 216, s: 1.0, tether: { k: 5, d: [0.8, -0.6, 0.66] } },
];
const KEYS = ['pe', 'evdwl', 'ecoul', 'elong', 'etail', 'press', 'pxx', 'pyy', 'pzz', 'pxy', 'pxz', 'pyz'];
(async () => {
  const out = { engine: null, cases: [] };
  for (const c of CASES) {
    const { core, cmds } = await H.buildCore(c.N, { ljScale: c.s, ensemble: 'nvt' });
    out.engine = 'LAMMPS ' + core.version() + ' WebAssembly (Node ' + process.version + ')';
    const extra = [];
    if (c.tether) {
      const x = core.gather(false, false).x, box = core.box();
      const topo = H.W.parseTopology(H.presetText(c.N));
      const mol = H.centralMolecule(x, box, topo);
      const g = [`group sel clear`, `group sel molecule ${mol}`];
      core.commands(g.join('\n')); extra.push(...g);
      const R = [core.variable('rcx'), core.variable('rcy'), core.variable('rcz')];
      const X = R.map((r, i) => r + c.tether.d[i]);
      const t = [`variable X equal ${H.W.fmt(X[0])}`, `variable Y equal ${H.W.fmt(X[1])}`, `variable Z equal ${H.W.fmt(X[2])}`, `variable K equal ${c.tether.k}`];
      core.commands(t.join('\n')); extra.push(...t);
      c.molecule = mol;
    }
    const tail = ['thermo_style custom step temp pe evdwl ecoul elong etail press pxx pyy pzz pxy pxz pyz', 'thermo_modify temp tcom norm no', 'run 0 post no'];
    core.commands(tail.join('\n')); extra.push(...tail);
    const res = {};
    KEYS.forEach((k) => { res[k] = core.thermo(k); });
    res.tether_energy = core.fixScalar('tether');
    res.tether_vector = [0, 1, 2].map((i) => core.fixVector('tether', i));
    const f = core.gather(false, true).f;
    out.cases.push(Object.assign({}, c, { commands: cmds.concat(extra), browser: res, forces: Array.from(f) }));
    core.close();
    console.log(c.id, 'pe', res.pe.toFixed(6), 'press', res.press.toFixed(4), 'tether', res.tether_energy);
  }
  H.fs.writeFileSync(H.path.join(__dirname, '..', 'results', 't1_browser.json'), JSON.stringify(out));
  console.log('wrote t1_browser.json');
})().catch((e) => { console.error(e); process.exit(1); });
