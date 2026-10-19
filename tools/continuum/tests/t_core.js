// Continuum Lab acceptance tests N1–N9 (core modules: units, counting, pore laws, membrane map, scope gates).
// Criteria: tools/continuum/TOLERANCES.md. Writes tools/continuum/results/t_core.json; exits 1 on any FAIL.
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = path.resolve(__dirname, '../../..');
const U = require(path.join(ROOT, 'lab/continuum/core/units.js'));
const PL = require(path.join(ROOT, 'lab/continuum/core/pore-law.js'));
const MM = require(path.join(ROOT, 'lab/continuum/core/membrane-map.js'));
const SC = require(path.join(ROOT, 'lab/continuum/core/scenario.js'));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'lab/continuum/data/manifest.json'), 'utf8'));
const refLaw = JSON.parse(fs.readFileSync(path.join(ROOT, 'lab/continuum/data/reference-law.json'), 'utf8'));
const items = [];
const rec = (id, name, pass, detail) => { items.push({ id, name, verdict: pass ? 'PASS' : 'FAIL', detail }); console.log((pass ? 'PASS ' : 'FAIL ') + id + ' ' + name + ' — ' + detail); };
let seed = 20261018;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const relErr = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

// N1 unit round trips
{
  let worst = 0, worstName = '';
  for (const name of Object.keys(U.conv)) {
    for (let k = 0; k < 10000; k++) {
      const x = Math.pow(10, -6 + 12 * rand()) * (rand() < 0.5 ? -1 : 1);
      const e = relErr(U.conv[name].fromSI(U.conv[name].toSI(x)), x);
      if (e > worst) { worst = e; worstName = name; }
    }
  }
  const lmh = U.conv.LMH.toSI(1), lmhbar = U.conv.LMHbar.toSI(1);
  const ok = worst <= 1e-14 && relErr(lmh, 2.7777777777777776e-7) < 1e-15 && relErr(lmhbar, 2.7777777777777776e-12) < 1e-15 && relErr(U.C.mWater, 2.991506e-26) < 1e-6;
  rec('N1', 'Unit conversions', ok, `worst round-trip relative error ${worst.toExponential(2)} (${worstName}); 1 LMH = ${lmh.toExponential(6)} m/s; m_w = ${U.C.mWater.toExponential(6)} kg`);
}

// N2 counting
{
  const c1 = MM.countPores({ W_m: 1e-6, B_m: 1e-6, pitch_m: 10e-9 }, { nx: 20, ny: 20 }).total;
  const c2 = MM.countPores({ W_m: 1e-3, B_m: 1e-3, pitch_m: 10e-9 }, { nx: 20, ny: 20 }).total;
  let sumsOk = true, uniformOk = true, nCases = 0;
  const sizes = manifest.device.allowedSizes_um;
  for (const W of sizes) for (const B of sizes) {
    const asp = Math.max(W, B) / Math.min(W, B);
    if (manifest.device.allowedAspects.indexOf(asp) < 0) continue;
    const base = SC.makeScenario(manifest, { W_m: W * 1e-6, B_m: B * 1e-6 });
    for (const lvl of [10, 20, SC.fineLevel(base)]) {
      const sc = SC.makeScenario(manifest, { W_m: W * 1e-6, B_m: B * 1e-6, meshLevel: lvl });
      const dv = SC.deriveDevice(sc);
      const pc = MM.countPores({ W_m: sc.W_m, B_m: sc.B_m, pitch_m: sc.pitch_m }, { nx: dv.nx, ny: dv.ny });
      let s = 0, mn = Infinity, mx = 0; for (let i = 0; i < pc.counts.length; i++) { s += pc.counts[i]; mn = Math.min(mn, pc.counts[i]); mx = Math.max(mx, pc.counts[i]); }
      nCases++;
      if (s !== pc.total || pc.total !== Math.floor(W * 1e3 / 10) * Math.floor(B * 1e3 / 10)) sumsOk = false;
      if (lvl !== 10 && mn !== mx) uniformOk = false;
    }
  }
  rec('N2', 'Counting', c1 === 10000 && c2 === 1e10 && sumsOk && uniformOk, `1 µm × 1 µm at 10 nm pitch: ${c1}; 1 mm × 1 mm: ${c2}; per-face sums equal the total in ${nCases} size/mesh cases: ${sumsOk}; equal face counts on levels 20 and fine: ${uniformOk}`);
}

// shared helpers
const law = PL.buildPoreLaw(manifest.laws[0]);
const G0 = law.G_m3_Pa_s;
const geom2 = { W_m: 2e-6, B_m: 2e-6, pitch_m: 10e-9 };
const mesh16 = { nx: 16, ny: 16 };

// N3 zero drive
{
  const map = MM.buildMembraneMap(geom2, mesh16, G0, MM.emptyModifications(), 4);
  const r = MM.networkFlow(map, 0);
  const ev = PL.evaluatePoreLaw(law, { tubeLength_m: 2.4595e-9 }, 0);
  const allZero = r.Q === 0 && Array.from(r.J).every((x) => x === 0) && ev.q_m3_s === 0;
  const finite = Number.isFinite(r.Jmean) && Number.isFinite(ev.dq_dPi_m3_Pa_s);
  rec('N3', 'Zero drive', allZero && finite, `Q = ${r.Q}, max |J| = ${Math.max(...Array.from(r.J).map(Math.abs))}, q = ${ev.q_m3_s}; diagnostics finite: ${finite}`);
}

// N4 parallel law with random G_i (1000 tubes as individual factors on a 2 µm membrane, 16 faces)
{
  const geom = { W_m: 2e-6, B_m: 2e-6, pitch_m: 10e-9 }, mesh = { nx: 4, ny: 4 };
  let mods = MM.emptyModifications();
  const chosen = new Set(); let sumG = 0;
  const pc = MM.countPores(geom, mesh);
  while (chosen.size < 1000) chosen.add(Math.floor(rand() * pc.Nx) + ',' + Math.floor(rand() * pc.Ny));
  for (const key of chosen) { const [ti, tj] = key.split(',').map(Number); const f = 0.1 + 3 * rand(); mods = MM.applyScopedChange(mods, { kind: 'tube', ti, tj }, f); sumG += f * G0; }
  sumG += (pc.total - 1000) * G0;
  const map = MM.buildMembraneMap(geom, mesh, G0, mods, 4);
  const dPi = 2.5e6, r = MM.networkFlow(map, dPi);
  const e = relErr(r.Q, sumG * dPi);
  rec('N4', 'Parallel law', e <= 1e-12, `${pc.total} pores, 1000 with random G_i: relative error of Q against Σ G_i ΔΠ = ${e.toExponential(2)}`);
}

// N5 single-tube scope at N = 1e4 and 1e10
{
  const out = [];
  let ok = true;
  for (const [W, mesh] of [[1e-6, { nx: 16, ny: 16 }], [1e-3, { nx: 16, ny: 16 }]]) {
    const geom = { W_m: W, B_m: W, pitch_m: 10e-9 };
    const base = MM.buildMembraneMap(geom, mesh, G0, MM.emptyModifications(), 4);
    const mod = MM.buildMembraneMap(geom, mesh, G0, MM.applyScopedChange(MM.emptyModifications(), { kind: 'tube', ti: 3, tj: 7 }, 0), 4);
    const dPi = 1e6, q0 = MM.networkFlow(base, dPi).Q, q1 = MM.networkFlow(mod, dPi).Q;
    const expected = -q0 / base.total, got = q1 - q0;
    // amended procedure (TOLERANCES.md, Amendments): the change is computed from the modifications (conductanceChange);
    // the original difference of two rebuilt face sums is still reported
    let dSdiff = 0; for (let c = 0; c < base.S.length; c++) dSdiff += mod.S[c] - base.S[c];
    const dQ = MM.networkDelta(base, mod, dPi).dQ;
    const e = relErr(dQ, expected), eOrig = relErr(dSdiff * dPi, expected), e2 = relErr(got, expected);
    ok = ok && e <= 1e-12 && MM.affectedPoreCount(base, mod) === 1;
    out.push(`N = ${base.total}: change error ${e.toExponential(2)} (original face-sum difference ${eOrig.toExponential(2)}, Q difference ${e2.toExponential(2)}), affected pores ${MM.affectedPoreCount(base, mod)}`);
  }
  rec('N5', 'Single-tube scope', ok, out.join('; '));
}

// N6 area scaling
{
  const a = MM.buildMembraneMap({ W_m: 2e-6, B_m: 2e-6, pitch_m: 10e-9 }, { nx: 16, ny: 16 }, G0, MM.emptyModifications(), 4);
  const b = MM.buildMembraneMap({ W_m: 4e-6, B_m: 2e-6, pitch_m: 10e-9 }, { nx: 32, ny: 16 }, G0, MM.emptyModifications(), 4);
  const ra = MM.networkFlow(a, 1e6), rb = MM.networkFlow(b, 1e6);
  const eQ = relErr(rb.Q, 2 * ra.Q), eJ = relErr(rb.Jmean, ra.Jmean);
  rec('N6', 'Area scaling', eQ <= 1e-12 && eJ <= 1e-12, `Q ratio error ${eQ.toExponential(2)}, J change ${eJ.toExponential(2)} (J = ${ra.Jmean.toExponential(4)} m/s)`);
}

// N7 length treatment
{
  const bad = law.conductanceAt(5e-9), good = law.conductanceAt(2.4595e-9);
  const ref = PL.buildPoreLaw(refLaw);
  const r = PL.hpwResistances(refLaw.params);
  let worst = 0;
  for (const L of refLaw.testLengths_m) {
    const G = ref.conductanceAt(L).G, expect = 1 / (r.rEntry + r.rInterior * L + r.rExit);
    // independent formula
    const a = refLaw.params.radius_m, mu = refLaw.params.mu_Pa_s;
    const indep = 1 / (8 * mu * L / (Math.PI * a ** 4) + 3 * mu / a ** 3);
    worst = Math.max(worst, relErr(G, expect), relErr(G, indep));
  }
  rec('N7', 'Length treatment', !bad.ok && good.ok && worst <= 1e-12, `illustrative law at 5 nm: ${bad.ok ? 'accepted' : 'rejected'}; at 2.4595 nm: ${good.ok ? 'accepted' : 'rejected'}; HPW composition worst relative error ${worst.toExponential(2)}`);
}

// N8 data scope
{
  const base = SC.makeScenario(manifest);
  const checks = [
    ['default device', base, true],
    ['wrong diameter preset', Object.assign({}, base, { geometryId: 'cnt77-L2.4595' }), false],
    ['wrong temperature', Object.assign({}, base, { T_K: 310 }), false],
    ['wrong fluid', Object.assign({}, base, { fluid: 'nacl-0.5M' }), false],
    ['drive above interval', Object.assign({}, base, { dP_Pa: 12e6 }), false],
    ['negative drive', Object.assign({}, base, { dP_Pa: -1e6 }), false],
    ['reference planes', Object.assign({}, base, { referencePlanes: 'reservoir-bulk' }), false],
    ['W outside the list', Object.assign({}, base, { W_m: 3e-6 }), false],
    ['aspect ratio 5', Object.assign({}, base, { W_m: 10e-6, B_m: 2e-6 }), false],
    ['tube length', Object.assign({}, base, { tubeLength_m: 5e-9 }), false],
  ];
  const res = checks.map(([name, sc, expectOk]) => { const v = SC.validateScenario(sc, manifest, law); return { name, ok: v.ok, expectOk, pass: v.ok === expectOk, reasons: v.reasons }; });
  rec('N8', 'Data scope', res.every((r) => r.pass), res.map((r) => `${r.name}: ${r.ok ? 'accepted' : 'rejected'}`).join('; '));
}

// N9 shared uncertainty (membrane-only network, same G sample for all pores)
{
  const out = []; let ok = true;
  for (const W of [100e-9, 1e-6, 1e-3]) {
    const geom = { W_m: W, B_m: W, pitch_m: 10e-9 }, mesh = { nx: 4, ny: 4 };
    const q = (g) => MM.networkFlow(MM.buildMembraneMap(geom, mesh, g, MM.emptyModifications(), 4), 1e6).Q;
    const Q0 = q(G0), Qlo = q(G0 * 0.8), Qhi = q(G0 * 1.2);
    const half = (Qhi - Qlo) / 2 / Q0, e = Math.abs(half - 0.2) / 0.2;
    ok = ok && e <= 1e-12;
    out.push(`N = ${MM.countPores(geom, mesh).total}: relative half-width ${half.toFixed(15)}`);
  }
  rec('N9', 'Shared uncertainty', ok, out.join('; '));
}

const pass = items.every((i) => i.verdict === 'PASS');
const res = { id: 'core', name: 'Core modules N1–N9', verdict: pass ? 'PASS' : 'FAIL', items, summary: `${items.filter((i) => i.verdict === 'PASS').length} of ${items.length} passed` };
fs.mkdirSync(path.join(ROOT, 'tools/continuum/results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'tools/continuum/results/t_core.json'), JSON.stringify(res, null, 1) + '\n');
console.log('core:', res.verdict, '-', res.summary);
if (!pass) process.exit(1);
