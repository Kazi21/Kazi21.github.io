/* Live Water Lab — model definition, allowed ranges, unit conversions and LAMMPS input generation.
   Shared by the browser worker, the export bundle and the Node/Python test harness, so every route
   (browser engine, native replay, tests) issues the same LAMMPS commands.
   Units: LAMMPS "real" internally (Å, fs, kcal/mol, atm, K); SI-based values for display and export. */
(function (root) {
  'use strict';

  /* Rigid SPC/E water (https://docs.lammps.org/Howto_spc.html), LAMMPS real units. */
  const MODEL = Object.freeze({
    id: 'spce-rigid-pppm-v1',
    name: 'Rigid SPC/E water',
    qO: -0.8476, qH: 0.4238,             // e
    epsOO: 0.1553, sigOO: 3.166,          // kcal/mol, Å; all hydrogen-containing LJ pairs are zero
    rOH: 1.0, thetaHOH: 109.47,           // Å, degrees (held rigid by SHAKE)
    massO: 15.9994, massH: 1.008,         // g/mol
    cutoff: 8.5,                          // Å, LJ and real-space Coulomb
    pppmAccuracy: 1.0e-4,                 // PPPM relative RMS force accuracy
    tail: true,                           // analytic LJ tail corrections to energy and pressure
    shakeTol: 1.0e-5, shakeIter: 100,     // SHAKE (bonds and angle)
    dt: 1.0,                              // fs
    Tdamp: 100.0, Pdamp: 1000.0,          // fs (Nose-Hoover thermostat / barostat)
    skin: 2.0,                            // Å neighbour skin
  });

  /* Ranges allowed in the interface. The conditions actually run in the validation suite are listed on the page
     (checks 1–10 mostly at 298.15 K and 1 bar; supplementary check S1 at the corners of these ranges). */
  const RANGES = Object.freeze({
    molecules: [216, 256, 343, 512],
    T: { min: 260, max: 370, def: 298.15 },              // K
    Pbar: { min: 1, max: 1000, def: 1 },                 // bar
    ljScale: [0.90, 0.95, 1.00, 1.05, 1.10],             // dimensionless multiplier of epsOO
    k: [0.5, 1, 2, 5, 10],                               // kcal mol^-1 Å^-2 (tether stiffness)
    kDefault: 2,
    handleMaxDist: 3.0,                                  // Å, |X - R| reset to this bound at every command update (can be exceeded slightly in between)
    handleMaxSpeed: 0.005,                               // Å/fs  (= 0.5 nm/ps = 500 m/s), anchor speed bound
  });

  const PACE = Object.freeze({
    slow: { steps: 2, chunks: 1, label: 'Slow motion' },
    normal: { steps: 10, chunks: 1, label: 'Normal' },
    fast: { steps: 10, chunks: 3, label: 'Fast' },
  });
  const RECORD_EVERY = 10;              // steps between recorded measurements (10 fs)

  /* Unit conversions (CODATA 2018 constants). */
  const NA = 6.02214076e23;
  const U = Object.freeze({
    kcal2kJ: 4.184,
    atm2bar: 1.01325,
    kcalA2pN: 4184 / NA / 1e-10 * 1e12,          // 1 kcal/mol/Å = 69.4770 pN
    kcalA2_Nm: 4184 / NA / 1e-20,                // 1 kcal/mol/Å² = 0.694770 N/m
    A_fs2m_s: 1e5,                               // 1 Å/fs = 1e5 m/s
    mvv2e: 48.88821291 * 48.88821291,            // g/mol·(Å/fs)² → kcal/mol (LAMMPS real)
    gcc2kgm3: 1000,
  });

  function fmt(x) {
    if (!Number.isFinite(x)) throw new Error('non-finite parameter ' + x);
    return String(x);                           // shortest representation that round-trips exactly
  }
  const Pbar2atm = (p) => p / U.atm2bar;

  /* Commands issued once when a system is built. `dataFile` is "start.data" in the export, a virtual path in the browser. */
  function initCommands(o) {
    const m = MODEL;
    const T = o.T, Patm = Pbar2atm(o.Pbar), s = o.ljScale;
    const integ = integratorCommands(o.ensemble, T, o.Pbar);
    return [
      '# ---- model: rigid SPC/E water, LAMMPS real units ----',
      'units           real',
      'atom_style      full',
      'boundary        p p p',
      `pair_style      lj/cut/coul/long ${m.cutoff}`,
      'pair_modify     tail yes',
      `kspace_style    pppm ${m.pppmAccuracy.toExponential(1)}`,
      'bond_style      harmonic',
      'angle_style     harmonic',
      'special_bonds   lj/coul 0.0 0.0 0.0',
      `read_data       ${o.dataFile}`,
      ljCommand(s),
      'pair_coeff      1 2 0.0 1.0',
      'pair_coeff      2 2 0.0 1.0',
      'bond_coeff      1 1000.0 1.0',
      'angle_coeff     1 100.0 109.47',
      `neighbor        ${m.skin} bin`,
      'neigh_modify    every 1 delay 0 check yes',
      `timestep        ${m.dt}`,
      '# ---- measurement definitions ----',
      'compute         tcom all temp/com',
      'thermo_style    custom step time temp press pe ke etotal evdwl ecoul elong etail density vol lx ly lz ecouple econserve',
      'thermo_modify   temp tcom norm no',
      'variable        mtot equal mass(all)',
      'variable        vcx equal vcm(all,x)',
      'variable        vcy equal vcm(all,y)',
      'variable        vcz equal vcm(all,z)',
      '# ---- centre-of-mass harmonic tether on one molecule (zero force while K = 0) ----',
      '# U = 0.5 K |R - X|^2, F_i = -(m_i/M) K (R - X); R = unwrapped centre of mass of group sel, X = handle.',
      `group           sel molecule ${o.selected || 1}`,
      'variable        K equal 0.0',
      'variable        X equal 0.0',
      'variable        Y equal 0.0',
      'variable        Z equal 0.0',
      'variable        msel equal mass(sel)',
      'variable        rcx equal xcm(sel,x)',
      'variable        rcy equal xcm(sel,y)',
      'variable        rcz equal xcm(sel,z)',
      'variable        tdx equal v_rcx-v_X',
      'variable        tdy equal v_rcy-v_Y',
      'variable        tdz equal v_rcz-v_Z',
      'variable        tfx atom -v_K*v_tdx*mass/v_msel',
      'variable        tfy atom -v_K*v_tdy*mass/v_msel',
      'variable        tfz atom -v_K*v_tdz*mass/v_msel',
      'variable        tue atom 0.5*v_K*(v_tdx*v_tdx+v_tdy*v_tdy+v_tdz*v_tdz)*mass/v_msel',
      '# Fix order (LAMMPS): force-adding fix, then SHAKE, then the integrator. The tether energy is reported',
      '# separately (fix_modify energy no) and its virial is excluded from the pressure (fix_modify virial no).',
      'fix             tether sel addforce v_tfx v_tfy v_tfz energy v_tue',
      `fix             cons all shake ${m.shakeTol.toExponential(1)} ${m.shakeIter} 0 b 1 a 1`,
      ...integ,
      'run             0 post no',
    ];
  }

  function ljCommand(s) { return `pair_coeff      1 1 ${fmt(MODEL.epsOO * s)} ${MODEL.sigOO}`; }

  function integratorCommands(ensemble, T, Pbar) {
    const m = MODEL;
    const line = ensemble === 'npt'
      ? `fix             integ all npt temp ${fmt(T)} ${fmt(T)} ${m.Tdamp} iso ${fmt(Pbar2atm(Pbar))} ${fmt(Pbar2atm(Pbar))} ${m.Pdamp}`
      : `fix             integ all nvt temp ${fmt(T)} ${fmt(T)} ${m.Tdamp}`;
    return [line, 'fix_modify      integ temp tcom'];
  }

  /* Parses the topology of a LAMMPS data file (atom_style full): types, molecule IDs and charges ordered by atom ID, and bonds. */
  function parseTopology(text) {
    const lines = text.split('\n');
    let natoms = 0, nbonds = 0;
    for (let i = 0; i < 40 && i < lines.length; i++) {
      const t = lines[i].trim().split(/\s+/);
      if (t[1] === 'atoms') natoms = parseInt(t[0], 10);
      if (t[1] === 'bonds') nbonds = parseInt(t[0], 10);
    }
    const type = new Uint8Array(natoms), mol = new Int32Array(natoms), q = new Float64Array(natoms);
    const bonds = new Int32Array(2 * nbonds);
    let sec = '', nb = 0, na = 0;
    for (const raw of lines) {
      const ln = raw.trim();
      if (!ln) continue;
      if (/^[A-Z][A-Za-z ]+(#.*)?$/.test(ln)) { sec = ln.split('#')[0].trim(); continue; }
      const t = ln.split(/\s+/);
      if (sec === 'Atoms' && t.length >= 7) {
        const id = parseInt(t[0], 10) - 1; mol[id] = parseInt(t[1], 10); type[id] = parseInt(t[2], 10); q[id] = parseFloat(t[3]); na++;
      } else if (sec === 'Bonds' && t.length >= 4) {
        bonds[2 * nb] = parseInt(t[2], 10) - 1; bonds[2 * nb + 1] = parseInt(t[3], 10) - 1; nb++;
      }
    }
    if (na !== natoms || nb !== nbonds) throw new Error(`data file topology incomplete (${na}/${natoms} atoms, ${nb}/${nbonds} bonds)`);
    const nmol = natoms / 3;
    // per molecule: [O, H, H] atom indices
    const molAtoms = new Int32Array(3 * nmol).fill(-1);
    const fill = new Uint8Array(nmol);
    for (let i = 0; i < natoms; i++) {
      const m = mol[i] - 1;
      if (type[i] === 1) molAtoms[3 * m] = i; else molAtoms[3 * m + 1 + fill[m]++] = i;
    }
    return { natoms, nmol, type, mol, q, bonds, molAtoms };
  }

  /* Native-LAMMPS input that replays a browser experiment command for command. */
  function exportInput(meta, init, journal) {
    const head = [
      '# Live Water Lab experiment — replay with native LAMMPS:',
      '#   lmp -in in.water_lab.lmp -log log.native.lammps',
      `# Recorded with ${meta.engine} in the browser on ${meta.created}.`,
      `# Preset: ${meta.preset} (${meta.molecules} molecules; starting configuration and velocities in start.data).`,
      `# Run ID ${meta.runId}. Model ${MODEL.id}. ${journal.length} commands after initialisation, ${meta.steps} steps.`,
      '# Every command below was issued to the browser engine in this order; chaotic dynamics means a native',
      '# replay matches the browser trajectory closely for the first picoseconds and statistically thereafter.',
      '',
    ];
    const body = init.map((c) => c);
    const jr = journal.map((j) => j.cmd);
    return head.concat(body, ['', '# ---- experiment journal (step at which each block was issued is in events.json) ----'], jr, ['']).join('\n');
  }

  const api = { MODEL, RANGES, PACE, RECORD_EVERY, U, NA, fmt, Pbar2atm, initCommands, ljCommand, integratorCommands, parseTopology, exportInput };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WaterModel = api;
})(typeof self !== 'undefined' ? self : this);
