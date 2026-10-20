# Calibration package — pore law for the (6,6) CNT membrane (Continuum Lab)

The Continuum Lab currently runs with an **illustrative pore law** (`illustrative-cnt66-v1`: q = G ΔΠ with a declared
G = 1.0 × 10⁻²⁷ m³ Pa⁻¹ s⁻¹). It is an input scenario, not a measured property of water in a (6,6) carbon nanotube.
This folder contains everything needed to replace it with a qualified law: the system builder, the LAMMPS input, the
crossing counter, a manifest template and the campaign script. The statistics are done by
[`../analyze_pore_flux.py`](../analyze_pore_flux.py), which refuses to produce a law when a test fails.

## The smallest measurement that would replace the illustrative law

Net water crossings through the declared (6,6) membrane, pure SPC/E water, 300 K, with:

| Condition | Drive ΔP | Role | Replicas × length |
|---|---|---|---|
| `zero` | 0 | zero-drive test and equilibrium linear response (the gate for the 0–10 MPa range) | 8 × 20 ns |
| `m100` | −100 MPa | fit; symmetry pair of `p100` | 4 × 20 ns |
| `p050` | +50 MPa | fit | 4 × 20 ns |
| `p100` | +100 MPa | fit | 4 × 20 ns |
| `p150` | +150 MPa | fit | 4 × 20 ns |
| `p200` | +200 MPa | held out (never used in the fit) | 4 × 20 ns |

with crossing counts at two planes inside the tube (mid-plane and near the entrance), 100 ps discarded after every
switch of the drive, and the mean reservoir pressure recorded. Total: 28 runs, 560 ns of production. The zero-drive
condition has eight replicas because the equilibrium gate (below) needs G_eq to 10 %: in synthetic tests with the
rapid back-and-forth recrossings of a counting plane, four 20 ns replicas give a relative standard error of about
8 % and pass the gate in 75 % of consistent data sets (test A5).

**Why drives of 50–200 MPa when the lab runs at 0–10 MPa?** At 10 MPa a tube with G ≈ 10⁻²⁷ m³ Pa⁻¹ s⁻¹ passes about
0.3 molecules per ns, while zero-drive back-and-forth crossings add noise of about √(2 k₀ t) with k₀ of a few per ns:
a 10 % flux estimate at 10 MPa would need several microseconds per replica. The package therefore brackets the
operating range: the zero-drive runs give the **equilibrium linear response**
G_eq = v_w² D_N / (k_B T) (Einstein relation for the net crossing count, v_w = m_w/ρ_ref), and the driven runs give
the slope and test linearity, intercept, symmetry and a held-out drive. The law may cover 0–10 MPa only if G_eq
agrees with the driven slope **and** the linearity test passes; otherwise the supported interval is the tested one,
and the lab must say that it cannot use the law in its 0–10 MPa range. High-pressure data are never treated as a
low-pressure calibration without that check. Since release 2026.8 `analyze_pore_flux.py` enforces this rule (test 8,
checked by A4 and A5 in `../tests/t_tools.py`); before, it reported G_eq only as a diagnostic and its supported
interval always reached zero drive. The chamber model itself stays incompressible only up to 10 MPa
(0.446 % density change), so drives above 10 MPa exist only inside the MD calibration, not in the continuum.

## Files

| File | Purpose |
|---|---|
| `build_membrane.py` | Builds `membrane.data`: (6,6) tube (240 C, carbon-centre radius 4.068 Å, length 24.595 Å), two graphene sheets with a hole of radius R + 1.4 Å, a 2.95 × 2.98 nm lateral cell and 1273 SPC/E molecules in one periodic reservoir (4661 atoms); writes a JSON summary with the SHA-256 |
| `in.calibrate.lmp` | Equilibration (`-var stage equil`) and force-slab production (`-var stage drive -var fz …`): fixed carbon, SHAKE water, PPPM, x/y-only thermostat, crossing dump every 100 fs, slab count and reservoir pressure every ps |
| `crossings_from_dump.py` | Converts a crossing dump and its thermo file into the CSV format of `analyze_pore_flux.py` (drive from ⟨N_slab⟩ f_z / A) |
| `calibration_manifest.template.json` | Every required metadata field: source, model and parameters, geometry and diameter convention, state, drive mapping, reference planes, included resistance, planes, protocol, conditions and roles, analysis settings, interpolation policy |
| `run_campaign.sh` | The whole campaign in order: build, equilibrate, produce, convert, analyse |

## Model and protocol (declared)

- Water: rigid SPC/E (q_O = −0.8476 e, ε_OO = 0.15535 kcal/mol, σ_OO = 3.166 Å), SHAKE 10⁻⁵, 1 fs.
- Carbon: fixed positions (not integrated), C–C pairs excluded, uncharged; water–carbon LJ on oxygen only,
  ε_CO = 0.09352 kcal/mol, σ_CO = 3.190 Å (Werder et al. 2003). LAMMPS warns that neighbour exclusions with PPPM
  may give inconsistent Coulomb energies; with uncharged carbon there are no excluded charged pairs.
- Real-space cutoff 10 Å, PPPM 10⁻⁵, fully periodic cell.
- Equilibration: minimisation, 2 ps limited NVE (start-up only), NVT 300 K (Nose–Hoover 100 fs). The tube starts
  empty and must fill by itself: production starts only after the number of molecules in the tube (`v_ntube`, column 3
  of `thermo.<tag>.txt`) has a stable plateau for at least 100 ps. A sub-nanometre tube is not filled by
  bulk-density arithmetic.
- Drive: force f_z on each water oxygen inside a 10 Å slab in the middle of the reservoir (the rigid constraints pass
  it to the whole molecule); ΔP = ⟨N_slab⟩ f_z / (L_x L_y), 1 kcal mol⁻¹ Å⁻¹ = 6.9477 × 10⁻¹¹ N. The slab is far from
  both membrane faces, so ΔP is the reservoir-to-reservoir pressure difference across the membrane; it is defined on
  the same planes as the lab's driving potential (the two membrane faces), and it includes the entrance, interior and
  exit losses of the pore and the access region of the MD cell. The continuum solver resolves the chamber flow; that
  resistance is not added again.
- Thermostat during production on the x and y velocity components only (`temp/partial 1 1 0`), so the streaming
  motion along z is not damped.
- Replicas: new velocities from different seeds after the equilibrated restart (or independent equilibrations).
- Pitch: the MD cell corresponds to a pore density of 1 per 8.80 nm² (equivalent pitch 2.97 nm); the lab uses 10 nm.
  The access resistance of a sub-nanometre pore is expected to be small at both pitches, but this is not verified:
  either run one condition at a larger lateral cell or restrict the qualified law to the tested pitch.

## Analysis and acceptance

```
python3 ../analyze_pore_flux.py --input *_r?.csv --manifest calibration_manifest.json \
    --discard-ps 100 --block-ps 20 --min-blocks 20 --bootstrap 2000 --confidence 0.95 --seed 20261018 --out pore_flux_result.json
```

The defaults are starting values, not established correlation times; the program checks them (standard error from
blocks of 1×, 2× and 4× the block length) and reports the uncertainty as unsupported when they are too short. The law
is accepted (`supported_in_scope`, exit 0) only when: every run has enough blocks; the correlation is resolved; the
two planes agree; the zero-drive flux is zero within its interval; the intercept is consistent with zero; the linear
model passes the χ² test; ± drives are antisymmetric; and the held-out drive is predicted within its interval.
Exit 1 means a test failed, exit 2 insufficient data.

**Equilibrium gate (test 8).** The supported interval reaches zero drive, and so covers the lab's 0–10 MPa range, only
when the zero-drive runs pass all of the following; otherwise it starts at the lowest positive driven condition and
`low_pressure_extension.reasons` says why:

- at least two zero-drive replicas, each with crossing fluctuations;
- D_N from the slope of the pooled block variance of the crossing count against block length,
  Var(N(τ)) = 2 D_N τ + C, over 1×, 2×, 4× and 8× the block length (those with ten or more blocks per replica, at
  least three of them), with D_N > 0 and a linear growth that passes the χ² test. The offset C absorbs the rapid
  recrossings of the counting plane: with 20 ps blocks they make a single-block estimate several times too large
  (3.7 × in the synthetic test A5), the slope does not;
- a relative standard error of G_eq = v_w² D_N / (k_B T) of at most 10 % (larger of the fit error and the scatter of
  per-replica fits);
- |G_eq − G| ≤ z √(SE_eq² + SE_G²) at the analysis confidence level.

A refusal close to the threshold calls for more zero-drive sampling, not a different threshold: a 95 % test refuses
about one consistent data set in twenty. The interval on G is the wider of a replica bootstrap and a
Student-t interval (few replicas make a percentile bootstrap too narrow). Synthetic fixtures (`../fixtures/`) are
labelled `SYNTHETIC`, test the program and can never become a law.

A qualified result is copied into `lab/continuum/data/` as `transport-cnt66-v1.json` with `sourceKind`
`owner_measurement` (or `published_reproduction`), `assessmentStatus` `supported_in_scope`, its interval and its
domain, and listed in the lab manifest. The page then reports the prediction with the shared-G interval (one
conductance sample for every equivalent pore, endpoint solves) instead of `INSUFFICIENT_EVIDENCE`.

## Pilot run in the build environment (functionality only)

Generated from [`pilot_summary.json`](pilot_summary.json) (LAMMPS 22 Jul 2025 – Update 4, one core of a shared two-core build machine).
Functionality only: no number here enters the lab.

- **Builder.** `build_membrane.py` with the default seed reproduced the same data file in two separate builds
  (SHA-256 59315c32…): 4661 atoms (842 fixed carbons, 1273 SPC/E molecules), cell
  2.95 nm × 2.98 nm × 7.10 nm.
- **Input file.** The equilibration stage (minimisation, 2 ps limited start, 3 ps NVT) and a driven stage restarted from
  its final restart (f_z = 0.010 kcal mol⁻¹ Å⁻¹, 3 ps) both completed, and `crossings_from_dump.py` wrote the
  62-row CSV that `analyze_pore_flux.py` reads. With ⟨N_slab⟩ = 289 molecules and
  A = 8.80 × 10⁻¹⁸ m², f_z = 0.010 kcal mol⁻¹ Å⁻¹ corresponds to ΔP = 22.8 MPa; the campaign drives of 50–200 MPa then
  need f_z ≈ 0.022–0.088 kcal mol⁻¹ Å⁻¹ (recompute from the equilibrated ⟨N_slab⟩ before production).
- **Speed.** 2.73–3.06 ns/day (1 fs, PPPM 10⁻⁵). The 560 ns campaign therefore needs about
  183–205 single-core days (157–176 for the 480 ns campaign defined when the pilot was recorded); the 28 production
  runs are independent and can run in parallel.
- **Filling was not reached — the main risk of the campaign.** In 36 ps from the empty tube, the number of
  oxygens inside the tube (r < 3.0 Å, 0 ≤ z ≤ 24.6 Å) averaged 0.42 between 10 and 36 ps (largest 1 ps
  mean 1.0; none in 31 % of the 1 ps windows), whereas a hydrogen-bonded single file (O–O ≈ 0.28 nm)
  would hold about nine. 36 ps cannot decide whether the tube fills. In the (6,6) simulations of Hummer et al.
  (Nature 414, 188, 2001) the tube filled with their carbon–water parameters (ε = 0.114 kcal/mol, σ = 3.275 Å) and
  fluctuated between empty and filled states on a nanosecond time scale when the attraction was weakened
  (ε = 0.065 kcal/mol); the Werder value used here (ε_CO = 0.0935 kcal/mol, σ_CO = 3.19 Å) lies between the two. The
  equilibration must therefore run for nanoseconds with the occupancy trace inspected. If the tube switches between
  empty and filled states, one conductance does not describe the pore: the decision is `EVALUATE_NEW_PORE_STATE` (the lab's
  decision vocabulary), not a law.
