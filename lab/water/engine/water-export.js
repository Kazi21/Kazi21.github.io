/* Live Water Lab — experiment export. Turns the adapter's evidence (initialisation commands, command journal,
   events, measurement records and starting configuration) into the files of the downloadable bundle.
   Shared by the page and the test harness, so the tested export is the one visitors download. */
(function (root) {
  'use strict';

  function csv(columns, records) {
    const esc = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toPrecision(10)) : String(v));
    return columns.join(',') + '\n' + records.map((r) => r.map(esc).join(',')).join('\n') + '\n';
  }

  const DEFINITIONS = {
    step: 'MD step (1 step = 1 fs)',
    time_ps: 'simulated time since the start of this system, ps',
    state: 'free = no tether; driven = tether active ("Driven response"); relaxation = free dynamics after a release',
    ensemble: 'npt = Nose-Hoover thermostat and isotropic barostat; nvt = Nose-Hoover thermostat at fixed volume',
    T_target_K: 'thermostat target temperature, K',
    P_target_bar: 'barostat target pressure, bar (blank at fixed volume); LAMMPS receives P_atm = P_bar / 1.01325',
    lj_scale: 's in epsilon_OO = s x 0.1553 kcal/mol; charges, sigma and geometry unchanged; s = 1 is reference SPC/E',
    T_K: 'temperature from LAMMPS compute temp/com: kinetic energy without the system centre-of-mass motion, divided over 6N - 3 degrees of freedom (SHAKE constraints removed), K',
    P_bar: 'pressure from the LAMMPS virial with the kinetic part from compute temp/com; includes the SHAKE constraint virial and the long-range (PPPM) and LJ tail contributions; excludes the external tether virial, bar',
    density_kg_m3: 'mass density, kg/m^3',
    volume_nm3: 'cell volume, nm^3',
    Lx_nm: 'cell edge, nm', Ly_nm: 'cell edge, nm', Lz_nm: 'cell edge, nm',
    PE_kJ_mol: 'potential energy of the water model (LJ with tail correction + real-space and PPPM Coulomb + bond/angle terms, which are ~0 under SHAKE); excludes the tether energy; no SPC/E polarisation correction applied, kJ/mol (whole system)',
    KE_kJ_mol: 'kinetic energy excluding the system centre-of-mass motion (thermo ke with temp/com), kJ/mol',
    KEcom_kJ_mol: 'kinetic energy of the system centre-of-mass motion, 0.5 M |v_com|^2, kJ/mol',
    Ecouple_kJ_mol: 'cumulative energy exchanged with the thermostat/barostat (LAMMPS ecouple, carried across integrator changes), kJ/mol',
    Eext_kJ_mol: 'PE + KE + KEcom + Ecouple + kinetic energy removed by explicit drift removal; in exact dynamics its change equals Wdelivered, kJ/mol',
    Evdwl_kJ_mol: 'LJ energy including the tail correction, kJ/mol', Ecoul_kJ_mol: 'real-space Coulomb energy, kJ/mol',
    Elong_kJ_mol: 'PPPM long-range Coulomb energy, kJ/mol', Etail_kJ_mol: 'LJ tail correction, kJ/mol',
    selected_molecule: 'molecule ID of the selected water (blank if none)',
    k_N_m: 'tether stiffness k (0 when no tether), N/m; 1 kcal mol^-1 A^-2 = 0.69477 N/m',
    anchor_x_nm: 'handle position X (unwrapped coordinates), nm', anchor_y_nm: '', anchor_z_nm: '',
    com_x_nm: 'centre of mass R of the selected molecule (unwrapped coordinates), nm', com_y_nm: '', com_z_nm: '',
    disp_nm: '|R(t) - R(selection)|, includes ordinary thermal motion, nm',
    Ftether_x_pN: 'tether force on the molecule, F = -k (R - X), pN', Ftether_y_pN: '', Ftether_z_pN: '',
    Fint_x_pN: 'net force on the selected molecule from all other molecules (LJ + Coulomb incl. PPPM), read from LAMMPS fix addforce before the tether force is added, pN', Fint_y_pN: '', Fint_z_pN: '',
    Utether_kJ_mol: 'tether potential energy 0.5 k |R - X|^2 (LAMMPS fix addforce energy), kJ/mol',
    Wprotocol_kJ_mol: 'cumulative protocol work: sum of U(R, X_new) - U(R, X_old) at each handle move, 0.5 (k_new - k_old) |R - X|^2 at stiffness changes, -U at release, kJ/mol',
    Wdelivered_kJ_mol: 'cumulative work done by the tether on the molecules: Wprotocol - Utether, kJ/mol',
    vcm_x_m_s: 'velocity of the system centre of mass, m/s (changed only by the tether impulse or an explicit drift removal)', vcm_y_m_s: '', vcm_z_m_s: '',
  };

  function readme(d, W) {
    const m = d.meta, M = W.MODEL;
    const ev = d.events;
    const counts = {};
    ev.forEach((e) => { counts[e.type] = (counts[e.type] || 0) + 1; });
    const lines = [
      '# Live Water Lab — exported experiment',
      '',
      `Recorded in the browser on ${m.created} with ${m.engine}. Run ID ${m.runId}.`,
      `System: ${m.molecules} rigid SPC/E water molecules, preset \`${m.preset}\`; ${m.steps} MD steps (${(m.steps * M.dt / 1000).toFixed(3)} ps).`,
      '',
      '## Files',
      '',
      '- `in.water_lab.lmp` — LAMMPS input: the model and measurement definitions, then every command issued to the browser engine, in order (the run segmentation is preserved).',
      '- `start.data` — starting configuration with velocities (the preset; no random velocity draw).',
      '- `final.data` — configuration at the time of export, written by LAMMPS `write_data`.',
      '- `thermo.csv` — measurements every 10 fs; columns and units are defined in `model.json` (`definitions`).',
      '- `events.json` — parameter changes and pulling events (selection, handle moves with their work increments, stiffness changes, release).',
      '- `model.json` — model parameters, allowed ranges, units and measurement definitions.',
      '',
      '## Replay with native LAMMPS',
      '',
      '```',
      'lmp -in in.water_lab.lmp -log log.native.lammps',
      '```',
      '',
      `Requires LAMMPS with the MOLECULE, KSPACE and RIGID packages (RIGID provides fix shake; the browser engine is LAMMPS ${m.engineVersion || ''} built from the stable_22Jul2025_update4 release). ` +
        'Molecular dynamics is chaotic: a native replay follows the browser trajectory closely for the first picoseconds and then agrees statistically, not atom by atom.',
      '',
      '## Analyse',
      '',
      '```',
      'python analyze_water.py --input thermo.csv --events events.json --discard-ps 20 --block-ps 5 --min-blocks 8 --confidence 0.95 --seed 20261017 --out analysis',
      '```',
      '',
      '`analyze_water.py` is in the website repository (`tools/analyze_water.py`). It averages only stationary segments without a tether, discards the stated time after every change, and reports "insufficient data" when there are too few blocks. These sampling defaults are provisional.',
      '',
      '## Model',
      '',
      `Rigid SPC/E water (https://docs.lammps.org/Howto_spc.html): qO = ${M.qO} e, qH = +${M.qH} e, epsilon_OO = ${M.epsOO} kcal/mol, sigma_OO = ${M.sigOO} A, O-H = ${M.rOH} A, H-O-H = ${M.thetaHOH} deg, no LJ on hydrogen; ` +
        `SHAKE (tolerance ${M.shakeTol}); LJ and real-space Coulomb cut at ${M.cutoff} A with LJ tail corrections; PPPM long-range electrostatics (relative accuracy ${M.pppmAccuracy}); intramolecular non-bonded interactions excluded; ` +
        `time step ${M.dt} fs; Nose-Hoover thermostat (${M.Tdamp} fs) and barostat (${M.Pdamp} fs).`,
      '',
      'The O–O Lennard-Jones strength s multiplies epsilon_OO only; charges and geometry stay fixed. s = 1 is the reference SPC/E model; any other value is a modified educational model.',
      '',
      '## Pulling protocol',
      '',
      'A harmonic tether U = 0.5 k |R - X|^2 acts on the centre of mass R of one molecule (unwrapped coordinates); the force -k (R - X) is shared over its atoms in proportion to mass (no direct torque). ' +
        'The handle X starts at R and moves at most 0.5 nm/ps; at every command update (every 2–10 fs) it is reset to within 0.3 nm of R, and between updates the separation can exceed 0.3 nm by a few per cent. Forces are never clipped: the recorded tether force is the one LAMMPS applied. Pulling runs at fixed volume (NVT); starting a pull from NPT switches the integrator and is recorded. ' +
        'Release sets k = 0. Protocol work increments are U(R, X_new) - U(R, X_old) at fixed coordinates; the work delivered to the molecules is the protocol work minus the tether energy. ' +
        'The tether injects momentum: the system centre-of-mass velocity is recorded and is never removed silently.',
      '',
      '## Events in this experiment',
      '',
      Object.keys(counts).map((k) => `- ${k}: ${counts[k]}`).join('\n'),
      '',
      d.recordingFull ? '**Note:** the measurement record reached its length limit; later measurements are not in thermo.csv.\n' : '',
      d.journalFull ? '**Note:** the command journal reached its length limit; the replay input is incomplete.\n' : '',
      '## Credits',
      '',
      'Simulation engine: LAMMPS (https://www.lammps.org, GPL-2.0), compiled to WebAssembly with Emscripten. ' +
        'Experiment design, interface, diagnostics and reproducibility workflow: Kazi Ehsanul Karim (https://kazi21.github.io/).',
      '',
    ];
    return lines.join('\n');
  }

  function buildFiles(d, W) {
    const files = {};
    files['in.water_lab.lmp'] = W.exportInput(d.meta, d.init, d.journal);
    files['start.data'] = d.dataText;
    if (d.finalData) files['final.data'] = d.finalData;
    files['thermo.csv'] = csv(d.columns, d.records);
    files['events.json'] = JSON.stringify({ meta: d.meta, events: d.events }, null, 1) + '\n';
    files['model.json'] = JSON.stringify({
      model: W.MODEL, allowed_ranges: W.RANGES, record_interval_steps: W.RECORD_EVERY,
      units: { length: 'nm (LAMMPS input: A)', time: 'ps (LAMMPS: fs)', energy: 'kJ/mol (LAMMPS: kcal/mol)', force: 'pN (LAMMPS: kcal/mol/A)', pressure: 'bar (LAMMPS: atm)', temperature: 'K', density: 'kg/m^3' },
      conversions: W.U, definitions: DEFINITIONS, meta: d.meta,
    }, null, 1) + '\n';
    files['README.md'] = readme(d, W);
    return files;
  }

  const api = { buildFiles, csv, DEFINITIONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WaterExport = api;
})(typeof self !== 'undefined' ? self : this);
