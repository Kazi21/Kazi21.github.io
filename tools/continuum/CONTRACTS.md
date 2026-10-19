# Continuum Lab — data, units, geometry and model contracts (M0)

Written 18 October 2026 before implementation. The browser code (`lab/continuum/core/`), the Node tests, the Python
tools and the OpenFOAM cases follow these definitions. A change to any of them is recorded at the end of this file.

## 1. Units

SI inside the coupling and the solver; conversion only at input and output.

| Quantity | Symbol | SI unit | Display conversions |
|---|---|---|---|
| Length | L, W, B, H, s | m | nm, µm, mm |
| Pressure, driving potential | p, ΔP, ΔΠ | Pa | MPa, bar |
| Dynamic viscosity | µ | Pa s | mPa s |
| Density | ρ | kg/m³ | — |
| Single-pore volume flow | q | m³/s | water molecules per ns via q ρ_ref / m_w |
| Single-pore conductance | G | m³/(Pa s) | — |
| Membrane area | A | m² | µm², mm² |
| Areal pore density | n | 1/m² | — |
| Superficial flux | J | m/s | L m⁻² h⁻¹ (1 LMH = 2.7778 × 10⁻⁷ m/s) |
| Total volume flow | Q | m³/s | — |
| Resistance per area | Rs | Pa s/m | — |
| Permeance | M = 1/Rs | m/(Pa s) | L m⁻² h⁻¹ bar⁻¹ (1 LMH/bar = 2.7778 × 10⁻¹² m/(Pa s)) |

Water molecular mass m_w = 18.015268 × 10⁻³ kg/mol / 6.02214076 × 10²³ mol⁻¹ = 2.991506 × 10⁻²⁶ kg.
Net molecular crossings convert to an equivalent volume flow q = m_w (N_forward − N_backward) / (ρ_ref Δt) with
ρ_ref = 996.557 kg/m³ (bulk water, 300 K, 0.101325 MPa); the conserved molecular quantity is the mass flow m_w ΔN/Δt.

## 2. Geometry and counting

CNT preset `cnt66-L2.4595`: armchair (6,6); carbon-centre diameter d_C = a√(3n²)/π with a = √3 × 0.1420 nm, so
d_C = 0.8138 nm; length along the flow L = 2.4595 nm (ten armchair cells, the recorded segment length). An accessible
diameter, when shown, is d_C − 0.340 nm = 0.474 nm (carbon van der Waals diameter subtracted); it is a label, not an
input of any law in this release.

Membrane: aligned tubes on a square lattice of pitch s = 10 nm in an impermeable matrix. Lattice centres sit at
((i + ½)s, (j + ½)s) for 0 ≤ i < floor(W/s), 0 ≤ j < floor(B/s); the strips W − s·floor(W/s) and B − s·floor(B/s)
at the far edges carry no pores. A pore belongs to the continuum face that contains its centre (half-open
intervals). Nominal count N = floor(W/s) floor(B/s); n_active = f/s² for an ideal infinite array. Examples
(geometric only): W = B = 1 µm gives 10 000 pores; W = B = 1 mm gives 10¹⁰.

Device: two chambers of lateral size W × B, each of height H = ½ min(W, B), above (feed) and below (permeate) the
membrane. Square ports of side min(W, B)/5, centred on the top of the feed chamber and the bottom of the permeate
chamber. Patches (the unit of "selected patch" and "block a patch") are squares of side min(W, B)/5, so the centre
patch lies under each port. Allowed W and B: 1, 2, 5, 10, 20, 50, 100, 200, 500 or 1000 µm, with W:B equal to 1, 2
or 4 (either way round). Grid: cubic cells of side min(W, B)/N with N = 20 (standard) or the fine level (40, or 50
when 40 does not divide min(W, B)/s), so every continuum face holds a whole number of lattice rows and every face of
an intact membrane holds the same number of pores. Area, pitch, tube length and camera zoom are separate
quantities; zooming never changes a length.

## 3. Pressure convention and reference planes

Outlet-referenced, as in membrane filtration: p_perm = 0.101325 MPa at the permeate port face and
p_feed = p_perm + ΔP at the feed port face, with 0 ≤ ΔP ≤ 10 MPa in the interface (mean pressure varies with ΔP and
the permeate side is never tensile). Over this interval the density of water changes by 0.446 % (NIST, 300 K), inside
the 1 % incompressibility gate.

ΔΠ is the positive feed-to-permeate normal-traction difference across the membrane, Π = −n·σ·n with
σ = −pI + µ(∇u + ∇uᵀ) and n the feed-to-permeate normal. With zero tangential velocity on both membrane faces, the
tangential derivatives of u and v vanish along the faces, continuity gives ∂w/∂z = 0 there, and Π equals the
pressure: ΔΠ is the face pressure difference. In the discrete model ΔΠ_c ≡ Rs_c J_c on open faces.

The pore law covers everything inside the subgrid region around the membrane: entrance, interior and exit of each
pore and its access flow, on the scale of the pitch. The CFD resolves only the chamber flow outside it. The chamber
resistance is never added to the pore law a second time.

## 4. Pore laws

Linear response, q_i = G_i ΔΠ_i. For a continuum face c of area A_c: M_c = Σ_i G_i / A_c, Rs_c = 1/M_c,
J_c = M_c ΔΠ_c, Q_c = A_c J_c. Scoped changes multiply single-pore conductances:
Σ_i G_i = G₀ F_membrane F_patch(c) [N_c − k_c + Σ_{t in c} F_t], where k_c tubes in face c carry individual factors F_t.
A selected tube changes one term. A face whose conductance sum is zero is closed: J_c = 0 exactly (no large
resistance substitute).

| Law | sourceKind | assessmentStatus | Definition | Supported domain |
|---|---|---|---|---|
| `illustrative-cnt66-v1` | declared_scenario | unassessed | G = 1.0 × 10⁻²⁷ m³ Pa⁻¹ s⁻¹ (3.33 water molecules per ns at ΔΠ = 100 MPa) | pure water, 300 K, preset `cnt66-L2.4595`, s = 10 nm, |ΔΠ| ≤ 10 MPa; pitch independence assumed; no length dependence |
| `hpw-reference-v1` | analytic_reference | checked (code verification only) | 1/G = R_entry + r_interior L + R_exit with r_interior = 8µ/(πa⁴(1 + 4b/a)), R_entry = R_exit = 3µ/(2a³) (Sampson orifice resistance split equally) | verification fixture; not valid for sub-1-nm pores and not offered as a CNT law |

A calibrated law (`transport-*.json`) is enabled only when the transport-data audit of §8 passes.

## 5. Continuum equations and boundary conditions

Steady, isothermal, incompressible Stokes flow in both chambers: ∇·u = 0, −∇p + µ∇²u = 0, µ = 853.742 µPa s,
ρ = 996.557 kg/m³. Boundaries: no-slip chamber walls; at each port the pressure is prescribed and the tangential
velocity is zero (with continuity this sets the normal viscous stress to zero, so the condition is the traction
condition); on open membrane faces both chambers share one normal velocity, −w = J_c, and Π_f − Π_p = Rs_c J_c; on
closed faces J_c = 0; tangential velocity is zero on both membrane faces (declared closure for an idealised solid
membrane). A comparison closure with continuous tangential velocity across open faces exists only to match the
cyclic baffle of the OpenFOAM reference.

Discretisation: staggered (MAC) finite volumes on a uniform Cartesian grid in each chamber; central second-order
viscous terms; ghost values for walls; half control volumes at ports; the membrane velocity is one unknown whose
control volume spans the two adjacent half cells, so the interface flux is shared exactly. Rows are scaled by
control volumes, so the system is symmetric: [A, −Dᵀ; −D, 0], with A symmetric positive definite (viscous terms plus
Rs_c A_c on membrane faces). Lengths are scaled by min(W, B), pressures by |ΔP| and velocities by
|ΔP|/(Rs_ref + µ/min(W, B)). Float64 throughout. Solver: MINRES with a block-diagonal SPD preconditioner (velocity:
diagonal or symmetric Gauss–Seidel; pressure: cell volume / scaled viscosity), fixed iteration budget, warm start,
cancellation between iteration blocks.

## 6. Diagnostics

- Q from the membrane faces and from each port; normalised global imbalance.
- Interface conservation: by construction (shared unknown); verified on the assembled divergence rows.
- Algebraic residual: momentum and continuity blocks reported separately from mass balance and discretisation error.
- Energy: external power ΔP·Q = viscous dissipation (discrete uᵀA_v u) + membrane dissipation Σ A_c Rs_c J_c².
  "Where is the resistance?" reports R_ch = Φ_visc/Q² and R_m = Φ_m/Q², so Q = ΔP/(R_ch + R_m) exactly.
- Re = ρ U_port d_port / µ with U_port = Q / port area and d_port = port side; creeping-flow gate Re ≤ 0.1.
- Compressibility: Δρ/ρ between the port pressures from the NIST table; gate ≤ 1 %.

## 7. Uncertainty

A shared uncertain G uses the same conductance for every equivalent pore in each draw. When only G is uncertain and
Q(G) is monotone, Q is solved at the estimate and at both interval ends; the interval is conditional on geometry,
mesh and all other inputs. It does not shrink with the number of pores. The illustrative law has no uncertainty
(declared scenario): the interface states "not applicable".

## 8. Source qualification and transport-data audit

Every law carries sourceKind (analytic_reference | declared_scenario | owner_measurement | published_reproduction)
and assessmentStatus (unassessed | checked | supported_in_scope | failed), plus: reference and file hashes, licence,
molecular model and parameter hash, engine version, geometry and diameter convention, tube length, wall treatment,
pitch, fluid, mean pressure, temperature, equilibration and production protocol, forcing definition, flux
observable and reference planes, density convention, drive range, uncertainty method, correlation diagnostics,
replicas, held-out conditions, included and excluded resistances, interpolation policy and unsupported
extrapolations. Only `owner_measurement` or `published_reproduction` with `supported_in_scope` can be called a
calibrated CNT prediction.

## 9. Scope gates (validateScenario)

Rejected (UNSUPPORTED, last valid result kept and marked): a law whose fluid, temperature, geometry preset, pitch,
tube length or reference-plane convention differs from the scenario; |ΔΠ| outside the law's interval; ΔP outside
0–10 MPa; W or B not in the allowed list or aspect ratio above 4; Re > 0.1; Δρ/ρ > 1 %.

## 10. Runtime protocol

Every request and result carries configId, lawId, geometryHash, solverVersion and a revision that increases with
each input change. Results whose revision is older than the newest request are discarded. State machine:
idle → loading → solving → converged, with cancelled, unsupported and failed. While solving, a displayed field is
labelled "previous". Iteration counts are not physical time; tracer speed is a labelled visual multiplier.

## Revisions

- 18 Oct 2026, before any solver acceptance test: grid levels changed from 8/16/32 to 10/20/40 (fine level 40 or 50)
  and port side from min(W, B)/4 to min(W, B)/5, patches defined as squares of side min(W, B)/5, aspect ratios
  restricted to 1, 2 and 4. Reason: on a 16-cell grid of a 2 µm membrane each face spans 12.5 lattice pitches, so
  exact counting gave 144, 156 or 169 pores per face and a ±8 % striped flux map that was a discretisation artefact,
  not physics. With the new levels every face of an intact membrane holds the same whole number of pores.
