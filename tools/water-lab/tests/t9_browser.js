// Check 9 (browser part): 40 ps NVT and NPT of preset 216 with new velocities (seed 4101), same commands as the page.
'use strict';
const H = require('./harness.js');
(async () => {
  const out = {};
  for (const ens of ['nvt', 'npt']) {
    const t0 = Date.now();
    const { core } = await H.buildCore(216, { ensemble: ens });
    core.commands('velocity all create 298.15 4101 dist gaussian mom yes rot no temp tcom\nrun 0 post no');
    const rec = { t: [], T: [], P: [], pe: [], rho: [] };
    for (let i = 0; i < 4000; i++) {
      core.command('run 10 pre no post no');
      rec.t.push((i + 1) * 0.01); rec.T.push(core.thermo('temp')); rec.P.push(core.thermo('press') * 1.01325);
      rec.pe.push(core.thermo('pe') * 4.184 / 216); rec.rho.push(core.thermo('density') * 1000);
    }
    core.close();
    out[ens] = rec;
    console.log(ens, 'done', (Date.now() - t0) / 1000, 's');
  }
  H.fs.writeFileSync(H.path.join(H.RESULTS, 't9_browser_series.json'), JSON.stringify(out));
})().catch((e) => { console.error(e); process.exit(1); });
