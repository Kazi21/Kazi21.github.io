#!/usr/bin/env node
/* make_closures.js — writes the two closure contracts of the ion experiment from the solver's own parameter file
   (lab/continuum/ions/params.js) and the recorded hydration data (lab/continuum/ions/data/hydration.json):
     lab/continuum/ions/data/closure-illustrative.json        the solvation closure in use (evidence status: illustrative)
     lab/continuum/ions/data/closure-molecular-template.json  the proposed molecular closure (null values block its use)
   Usage (repository root): node tools/continuum/ions/make_closures.js [--check]
   --check compares the files on disk with freshly generated ones and exits 1 if they differ. */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '../../..');
const Pm = require(path.join(ROOT, 'lab/continuum/ions/params.js'));
const DATA = path.join(ROOT, 'lab/continuum/ions/data');
const hydFile = path.join(DATA, 'hydration.json');
const hydBytes = fs.readFileSync(hydFile), hyd = JSON.parse(hydBytes);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const kJ = (x) => x * 1000, nm = (x) => x * 1e-9;
const q = (value, unit, status, source, extra) => Object.assign({ value, unit, status, source }, extra || {});
const per = (f) => { const o = {}; for (const p of Pm.PRESETS) o[p.id] = f(p); return o; };
const LINING_IDS = Object.keys(Pm.LININGS);

function species(name, key) {                                         // key: 'Na' or 'Cl'
  const hk = key === 'Na' ? 'Na+' : 'Cl-';
  return {
    name, valence: key === 'Na' ? 1 : -1,
    hydration_gibbs_energy: q(kJ(Pm.MARCUS[key]), 'J mol^-1', 'Literature', 'Marcus (1991), 25 °C, standard state'),
    born_radius: q(nm(Pm.R_BORN[key]), 'm', 'Derived', 'Born equation inverted to reproduce the Marcus energy at the relative permittivity of water at 25 °C'),
    first_shell_radius: q(nm(Pm.R_SHELL[key]), 'm', 'Recorded', 'Most frequent ion–oxygen distance in the CP2K (11,11) run, rounded', { conditions: '0.50 ps; 2 ions of each kind' }),
    first_shell_share_of_hydration_energy: q(kJ(Pm.G1[key]), 'J mol^-1', 'Derived', '|ΔG_hyd| minus the Born energy of a sphere of radius r1 + 0.14 nm'),
    first_shell_count: { values: per((p) => p['n' + key]), unit: 'molecules', status: 'Recorded', source: 'lab/continuum/ions/data/hydration.json (mean over every stored frame and ion)',
      conditions: per((p) => p.run_ps.toFixed(2) + ' ps, ' + p.waters + ' waters: not converged'),
      block_means: per((p) => hyd.tubes.find((t) => t.n === p.n).ions[hk].block_means_5) },
    reference_shell_count: q(Pm.REF['n' + key], 'molecules', 'Recorded', 'CP2K (11,11) run, the least confined tube', { conditions: '0.50 ps: not converged; not a bulk value' }),
    wall_recovery_kappa: { values: Object.fromEntries(LINING_IDS.map((l) => [l, Pm.LININGS[l]['k' + key]])), unit: '1', status: 'Illustrative', source: 'Stated example values per pore lining; not calibrated for this CNT/NaCl system' },
    excess_free_energy_in_pore: {
      unit: 'J mol^-1', status: 'Derived', source: 'Pm.solvation(): the selected closure applied to the inputs above',
      dehydration_recorded_shells: per((p) => Object.fromEntries(LINING_IDS.map((l) => [l, kJ(Pm.solvation({ preset: p.id, solvation: 'cp2k', lining: l })[key])]))),
      dehydration_rigid_shell: per((p) => Object.fromEntries(LINING_IDS.map((l) => [l, kJ(Pm.solvation({ preset: p.id, solvation: 'shell', lining: l })[key])]))),
      born_exclusion: per((p) => Object.fromEntries([10, 20, 30, 50].map((e) => ['epsP_' + e, kJ(Pm.solvation({ preset: p.id, solvation: 'born', epsP: e })[key])]))),
    },
    bulk_diffusivity: q(Pm.DT[key], 'm^2 s^-1', 'Derived', 'Li & Gregory (1974) at 25 °C, scaled to 300 K with D ∝ T/η (IAPWS 2008 viscosities)', { conditions: 'Infinite dilution' }),
    confined_to_bulk_diffusivity_ratio: { values: [0.2, 0.5, 0.8, 1], unit: '1', status: 'Illustrative', source: 'Stated example values, the same for both ions' },
  };
}

const illustrative = {
  schema_version: '1.0.0',
  artifact_kind: 'transport_closure',
  id: 'cnt-nacl-solvation-illustrative-1',
  evidence_status: 'illustrative',
  title: 'Solvation closure of the Continuum Lab ion experiment (model steps 4–6), with the confined-mobility ratio (steps 5–6)',
  summary: 'Recorded CP2K first-shell counts and shell radii, literature hydration energies and stated example values give the excess free energy of each ion in the pore. Executable and labelled illustrative: it is not an ion-transfer free energy from molecular simulation, and it is not calibrated against a molecular or experimental conductance.',
  execution: { status: 'in_use', used_by: 'lab/continuum/ions/params.js (solvation, build), model steps 4–6' },
  conditions: {
    temperature: q(Pm.T, 'K', 'Setting', 'Chosen to match the CP2K runs (NVT, 300 K)'),
    reservoir_salt_concentration: { values: [10, 100, 1000], unit: 'mol m^-3', status: 'Setting', source: 'Visitor setting; the reversal potential uses a 10:1 gradient' },
    pressure_difference: q(0, 'Pa', 'Setting', 'No applied pressure difference'),
    relative_permittivity_of_water: q(Pm.EPS_T, '1', 'Literature', 'Malmberg & Maryott (1956) correlation at 26.85 °C'),
  },
  geometry: {
    tubes: Pm.PRESETS.map((p) => { const g = Pm.geometry(p); return {
      id: p.id, carbon_centre_radius: q(nm(g.Rc), 'm', 'Recorded', p.label + ' tube of the CP2K run'),
      ion_accessible_radius: q(nm(g.a), 'm', 'Derived', 'Carbon-centre radius − carbon van der Waals radius 0.170 nm (Bondi 1964)'),
      water_accessible_radius: q(nm(g.Rw), 'm', 'Derived', 'Carbon-centre radius − carbon–oxygen LJ σ 0.319 nm (Werder et al. 2003)'),
    }; }),
    pore_length: q(nm(Pm.DEFAULTS.L), 'm', 'Illustrative', 'Example membrane; the CP2K segment is a 2.46 nm periodic cell, not a finite pore'),
    area_convention: 'A(x) = π a² in the pore (a: ion-accessible radius); access cones of slope 4/π outside, which reproduce Hall’s access resistance',
  },
  species: [species('Na+', 'Na'), species('Cl-', 'Cl')],
  closures: [
    { id: 'cp2k', name: 'Dehydration with the recorded CP2K first-shell counts', formula: 'ΔG_i = (1 − κ_i) (N_lost,i / n_ref,i) ΔG_1,i, N_lost,i = max(0, n_ref,i − n_i)' },
    { id: 'shell', name: 'Dehydration with the rigid-shell geometry', formula: 'as cp2k, with n_i = n_ref,i × fraction of a spherical shell of radius r1 that fits inside the water-accessible radius' },
    { id: 'born', name: 'Dielectric exclusion (Born)', formula: 'ΔG_i = N_A z_i² e² / (8π ε0 a_B,i) (1/ε_p − 1/ε_b)' },
  ],
  conventions: {
    free_energy_type: 'excess_molar_free_energy',
    mean_field_electrostatics_included: false,
    geometric_entropy_included: false,
    profile: 'ΔG_i s(x): a smooth step of width 0.15 nm at each mouth',
    concentration_definition: 'moles per ion-accessible volume, averaged over the cross-section',
    note: 'The electrostatics of the rims and of the ions is in Poisson’s equation, not in ΔG, so it is not counted twice.',
  },
  supported_domain: {
    tubes: Pm.PRESETS.filter((p) => p.id !== '6,6').map((p) => p.id), model_steps: [4, 5, 6], voltage_range_V: [-0.2, 0.2], pressure_difference_range_Pa: [0, 0],
    interpolation: 'none', extrapolation: 'refuse',
    comparison_only: { tubes: ['6,6'], reason: 'single-file water: the continuum description is outside its domain; the page computes this tube for comparison only and flags it' },
  },
  uncertainty: {
    status: 'not_estimated',
    uncovered_sources: ['sampling: runs of 0.50–0.75 ps', 'reference method: PBE-D3(BJ)', 'closure form', 'wall recovery κ (stated examples)', 'dielectric model', 'geometry of a finite pore'],
  },
  provenance: {
    source_artifacts: [{ path: 'lab/continuum/ions/data/hydration.json', sha256: sha(hydBytes) }].concat(hyd.tubes.map((t) => ({ path: t.file, sha256: t.file_sha256 }))),
    parameters_file: 'lab/continuum/ions/params.js',
    producer: 'tools/continuum/ions/make_closures.js',
  },
  validation: {
    numerical_status: 'Solver and controller tests I1–I17 and IB1–IB11 (the page’s Validation section)',
    physical_status: 'not_run',
    note: 'The recorded-shell and rigid-shell closures give different currents for the same pore; the page computes the ratio for its default settings (“How molecular simulation enters the prediction”). The difference is a sensitivity of the prediction to the closure, not a validation of either.',
  },
};

const template = {
  schema_version: '1.0.0',
  artifact_kind: 'transport_closure',
  id: 'cnt-nacl-molecular-closure-proposal',
  evidence_status: 'proposed',
  title: 'Proposed molecular closure for low-bias ionic conductance through one CNT pore (not data)',
  summary: 'The quantities a molecular calculation would have to supply before the ion experiment could make a molecularly calibrated prediction. Every required value is null, so no calculation can use this record.',
  execution: { status: 'not_run', run_ids: [], completed_at: null },
  conditions: {
    temperature: { value: null, unit: 'K' }, reservoir_salt_concentration: { value: null, unit: 'mol m^-3' },
    reference_voltage: { value: 0, unit: 'V' }, pressure_difference: { value: 0, unit: 'Pa' },
    geometry_id: null, chemistry_id: null, molecular_ensemble: null, molecular_boundary_conditions: null,
    continuum_boundary_conditions: { type: 'symmetric_reservoir_dirichlet', boundary_locations_verified_bulk_like: false },
  },
  geometry: { axial_coordinate: { values: null, unit: 'm' }, accessible_area: { values: null, unit: 'm^2' }, area_convention: null },
  species: [
    { name: 'Na+', valence: 1, excess_free_energy: { values: null, unit: 'J mol^-1' }, axial_diffusivity: { values: null, unit: 'm^2 s^-1' } },
    { name: 'Cl-', valence: -1, excess_free_energy: { values: null, unit: 'J mol^-1' }, axial_diffusivity: { values: null, unit: 'm^2 s^-1' } },
  ],
  conventions: {
    free_energy_type: 'excess_molar_free_energy', geometric_entropy_included: false, mean_field_electrostatics_included: false,
    free_energy_reference: 'matched_bulk_reservoir', electrostatic_reference_id: null, dielectric_model_id: null,
    concentration_definition: 'moles per declared accessible volume',
    note: 'A potential of mean force from a line density contains −RT ln(A/A_bulk) and the mean electrostatic term; both must be removed before use with an explicit area and Poisson’s equation, or they are counted twice.',
  },
  required_calculations: [
    'First-shell counts for each tube, sampled until stable across independent replicas (block averages and integrated autocorrelation time; tens of ps of AIMD or MLIP-MD per tube as a pilot; the restraint and coordinate of the ion stated, since a restrained ion samples a conditional distribution)',
    'Ion-transfer free-energy profile of Na⁺ and of Cl⁻ from the reservoir into the (7,7) tube, with overlap and replica checks',
    'Axial diffusivities of Na⁺ and Cl⁻ inside the tube, with a position-dependent estimator',
    'An independent molecular estimate of the low-bias conductance of the same finite pore, under matched conditions',
  ],
  proposed_acceptance: { observable: 'low-bias conductance', relative_difference_max: 0.2, against: 'an independent matched molecular estimate', status: 'proposed_project_target' },
  supported_domain: { validated_state_ids: [], voltage_range_V: null, interpolation: 'none', extrapolation: 'refuse' },
  uncertainty: { status: 'not_estimated', uncovered_sources: ['sampling', 'reference_model', 'MLIP_model', 'coarse_graining', 'dielectric_model', 'geometry'] },
  provenance: { source_artifacts: [], basis: 'proposal_not_data', producer: 'tools/continuum/ions/make_closures.js' },
  validation: { numerical_status: 'not_run', physical_status: 'not_run', held_out_condition_ids: [] },
};

const out = [['closure-illustrative.json', illustrative], ['closure-molecular-template.json', template]];
/* numbers are written with 15 significant digits, so binary round-off (9.299999999999998e-11) does not appear in the files;
   the change is at most 5 × 10⁻¹⁵ relative, far inside the 10⁻¹² of test I17 */
const tidy = (k, v) => (typeof v === 'number' && isFinite(v) && !Number.isInteger(v) ? Number(v.toPrecision(15)) : v);
let differs = 0;
for (const [name, obj] of out) {
  const text = JSON.stringify(obj, tidy, 1) + '\n', file = path.join(DATA, name);
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (now !== text) { differs++; console.log('differs: ' + name); } else console.log('reproduces: ' + name);
  } else { fs.writeFileSync(file, text); console.log('wrote lab/continuum/ions/data/' + name + ' (' + (text.length / 1024).toFixed(1) + ' kB)'); }
}
process.exit(differs ? 1 : 0);
