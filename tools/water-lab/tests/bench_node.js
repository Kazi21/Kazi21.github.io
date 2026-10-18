// Benchmark: browser engine in Node (same .wasm as the page), NVT, chunks of 10 steps with a page snapshot per chunk.
'use strict';
const H = require('./harness.js');
const os = require('os');
(async () => {
  const out = { engine: null, node: process.version, cpu: os.cpus()[0].model, cores: os.cpus().length, results: [] };
  for (const N of H.W.RANGES.molecules) {
    const { A } = await H.newAdapter({ molecules: N, ensemble: 'nvt' });
    out.engine = 'LAMMPS ' + A.L.version() + ' WebAssembly';
    for (let i = 0; i < 10; i++) A.runSteps(10);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 100; i++) A.runSteps(10);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    A.dispose();
    out.results.push({ molecules: N, steps: 1000, wall_s: ms / 1000, ms_per_step: ms / 1000, steps_per_s: 1000 / (ms / 1000), ps_per_s: 1 / (ms / 1000) });
    console.log(`node wasm ${N}: ${(ms / 1000).toFixed(2)} ms/step, ${(1000 / (ms / 1000)).toFixed(0)} steps/s`);
  }
  H.fs.writeFileSync(H.path.join(H.RESULTS, 'bench_node.json'), JSON.stringify(out, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
