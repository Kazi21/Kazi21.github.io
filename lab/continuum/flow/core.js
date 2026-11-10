/* Continuum Lab — flow benchmark: pressure-driven flow of a liquid in one tube, with molecular boundary inputs.
   Pure functions, SI units, no state, no DOM. Used by the page (flow/app.js) and by tools/continuum/flow/t_flow.js.

   Model family (Phys. Chem. Chem. Phys. 26, 19069 (2024), Eqs. 1–5 and 8):
     classical       u(r) = (R²G/4μ)(1 − r²/R²)                 Q = πR⁴G/(8μ)
     slip velocity   u(r) = (R²G/4μ)(1 − r²/R²) + u_s           Q = πR⁴G/(8μ) + πR²u_s
     slip length     u(r) = (R²G/4μ)(1 − r²/R² + 2L_s/R)        Q = π(R⁴ + 4R³L_s)G/(8μ)
   G is the pressure gradient that acts inside the tube. The source paper uses G = ΔP/L with ΔP taken between the
   reservoirs. The entrance-resistance sensitivity adds a series resistance cμ/R³ (Sampson orifice for c = 3, an
   assumption) and then uses the interior pressure drop only, so that no loss is counted twice. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ContinuumFlow = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var PI = Math.PI;
  var FAMILIES = ['classical', 'slip_velocity', 'slip_length'];

  function positive(x, name) {
    if (!(typeof x === 'number' && isFinite(x) && x > 0)) throw new Error(name + ' must be a positive number');
    return x;
  }
  function finite(x, name) {
    if (!(typeof x === 'number' && isFinite(x))) throw new Error(name + ' must be a finite number');
    return x;
  }

  /* spec: { family, R_m, L_m, dP_Pa, mu_Pa_s, us_m_s (slip_velocity), Ls_m (slip_length), ends: null | { c } } */
  function evaluate(spec) {
    if (FAMILIES.indexOf(spec.family) < 0) throw new Error('unknown model family ' + spec.family);
    var R = positive(spec.R_m, 'radius'), L = positive(spec.L_m, 'length'), mu = positive(spec.mu_Pa_s, 'viscosity');
    var dP = finite(spec.dP_Pa, 'pressure drop');
    var G0 = dP / L;                                                  // gradient without end resistance
    var us0 = spec.family === 'slip_velocity' ? finite(spec.us_m_s, 'slip velocity') : 0;
    var Ls = spec.family === 'slip_length' ? finite(spec.Ls_m, 'slip length') : null;
    var fraction = 1, Rtube = null, Rends = null, LsEq = null;
    if (spec.family === 'slip_velocity') LsEq = G0 !== 0 ? 2 * mu * us0 / (G0 * R) : null;   // Navier: u_s = L_s G R / (2μ)
    else LsEq = spec.family === 'slip_length' ? Ls : 0;
    if (spec.ends) {
      var c = positive(spec.ends.c, 'end-loss coefficient');
      if (G0 === 0 || LsEq === null) throw new Error('the entrance-resistance sensitivity needs a non-zero drive');
      Rtube = 8 * mu * L / (PI * (Math.pow(R, 4) + 4 * Math.pow(R, 3) * LsEq));
      Rends = c * mu / Math.pow(R, 3);
      fraction = Rtube / (Rtube + Rends);                             // share of ΔP that acts inside the tube
    }
    var G = fraction * G0;                                            // interior gradient
    var A = R * R * G / (4 * mu);                                     // parabolic amplitude on the axis
    var us = spec.family === 'slip_velocity' ? fraction * us0         // same wall slip length, smaller wall shear
           : spec.family === 'slip_length' ? Ls * G * R / (2 * mu) : 0;
    var Q = PI * Math.pow(R, 4) * G / (8 * mu) + PI * R * R * us;
    return {
      family: spec.family, R_m: R, L_m: L, mu_Pa_s: mu, dP_Pa: dP,
      gradient_Pa_m: G, gradient_no_ends_Pa_m: G0, amplitude_m_s: A, wall_velocity_m_s: us,
      Q_m3_s: Q, mean_velocity_m_s: Q / (PI * R * R), equivalent_slip_length_m: LsEq,
      ends: spec.ends ? { c: spec.ends.c, R_tube: Rtube, R_ends: Rends, interior_fraction: fraction,
                          dP_interior_Pa: fraction * dP, dP_ends_Pa: (1 - fraction) * dP } : null,
      u: function (r) { return Math.abs(r) > R ? NaN : A * (1 - r * r / (R * R)) + us; }
    };
  }

  /* Build a spec from a case of cases.json and a choice { family, boundary: 'D' | 'Dp', viscosity, length: 'default' | 'alt',
     ends: boolean, drive: id }. Only what the case sheet provides can be chosen. */
  function specFromCase(cs, choice) {
    if (!cs || !cs.enabled) throw new Error('case not enabled: ' + (cs ? cs.id : 'undefined'));
    choice = choice || {};
    var family = choice.family || 'slip_velocity';
    if (family !== 'classical' && family !== 'slip_velocity') throw new Error('model family not enabled for this case: ' + family);
    var boundary = choice.boundary || 'D';
    if (boundary !== 'D' && boundary !== 'Dp') throw new Error('unknown boundary ' + boundary);
    var visKey = choice.viscosity || 'interfacial';
    var vis = cs.viscosity_mPa_s[visKey];
    if (!vis) throw new Error('unknown viscosity ' + visKey);
    var drive = null, i;
    for (i = 0; i < cs.drives.length; i++) if (!choice.drive || cs.drives[i].id === choice.drive) { drive = cs.drives[i]; break; }
    if (!drive) throw new Error('unknown drive ' + choice.drive);
    var Lnm = choice.length === 'alt' ? cs.geometry.L_nm.alt : cs.geometry.L_nm.value;
    var Dnm = boundary === 'D' ? cs.geometry.D_nm.value : cs.geometry.Dp_nm.value;
    return {
      family: family, R_m: 0.5 * Dnm * 1e-9, L_m: Lnm * 1e-9, dP_Pa: drive.dP_MPa.value * 1e6, mu_Pa_s: vis.value * 1e-3,
      us_m_s: family === 'slip_velocity' ? cs.slip_velocity_m_s[boundary].value : 0,
      ends: choice.ends ? { c: typeof choice.c === 'number' ? choice.c : 3 } : null
    };
  }

  /* Retrospective agreement with the molecular-dynamics reference of the case: differences at the MD radii that lie inside
     the chosen boundary, and the flow-rate difference. Reported, never judged. */
  function compare(cs, res, uQ) {
    var md = cs.md, rows = [], i, s2 = 0, n = 0, worst = 0;
    for (i = 0; i < md.profile.r_nm.length; i++) {
      var r = md.profile.r_nm[i] * 1e-9, ref = md.profile.u_m_s[i];
      if (r > res.R_m) { rows.push({ r_nm: md.profile.r_nm[i], md_m_s: ref, model_m_s: null, rel: null }); continue; }
      var m = res.u(r), rel = m / ref - 1;
      rows.push({ r_nm: md.profile.r_nm[i], md_m_s: ref, model_m_s: m, rel: rel });
      s2 += rel * rel; n += 1; if (Math.abs(rel) > Math.abs(worst)) worst = rel;
    }
    var Qmd = md.flow_pL_s.value * 1e-15, RD = 0.5 * cs.geometry.D_nm.value * 1e-9;
    return {
      profile: rows, points_compared: n, profile_rms_rel: n ? Math.sqrt(s2 / n) : null, profile_worst_rel: n ? worst : null,
      Q_md_m3_s: Qmd, Q_rel: res.Q_m3_s / Qmd - 1,
      /* standard uncertainty of that difference from the extraction uncertainties, when the model's is supplied */
      Q_rel_u: typeof uQ === 'number' ? Math.abs(res.Q_m3_s / Qmd) * Math.sqrt(Math.pow(uQ / res.Q_m3_s, 2) + Math.pow(md.flow_pL_s.u / md.flow_pL_s.value, 2)) : null,
      mean_velocity_md_m_s: Qmd / (PI * RD * RD)          // MD flow rate over the carbon-centre cross-section, as in the source paper
    };
  }

  /* First-order standard uncertainty of the model flow rate (m³/s) from the extraction uncertainties of the case inputs:
     pressure drop and viscosity (parabolic term), slip velocity (slip term) and, at D′, the boundary diameter (both terms,
     which share the radius). Without end resistance. An input whose uncertainty is not stated (u: null) contributes 0. */
  function flowUncertainty(cs, choice) {
    choice = choice || {};
    var spec = specFromCase(cs, { family: choice.family, boundary: choice.boundary, viscosity: choice.viscosity, length: choice.length, drive: choice.drive });
    var res = evaluate(spec), R = spec.R_m, boundary = choice.boundary || 'D';
    var vis = cs.viscosity_mPa_s[choice.viscosity || 'interfacial'], drive = cs.drives[0], i;
    for (i = 0; i < cs.drives.length; i++) if (choice.drive && cs.drives[i].id === choice.drive) drive = cs.drives[i];
    var par = PI * Math.pow(R, 4) * res.gradient_Pa_m / (8 * spec.mu_Pa_s), slip = PI * R * R * res.wall_velocity_m_s;
    var relOf = function (q) { return q && typeof q.u === 'number' && q.value ? q.u / q.value : 0; };
    var sv = cs.slip_velocity_m_s[boundary];
    var relPar = Math.sqrt(Math.pow(relOf(drive.dP_MPa), 2) + Math.pow(relOf(vis), 2));
    var relUs = spec.family === 'slip_velocity' ? relOf(sv) : 0;
    var relR = relOf(boundary === 'D' ? cs.geometry.D_nm : cs.geometry.Dp_nm);          // u(R)/R = u(D)/D
    var parts = { parabolic_m3_s: par * relPar, slip_m3_s: slip * relUs, radius_m3_s: (4 * par + 2 * slip) * relR };
    return { Q_m3_s: Math.sqrt(Math.pow(parts.parabolic_m3_s, 2) + Math.pow(parts.slip_m3_s, 2) + Math.pow(parts.radius_m3_s, 2)), parts: parts };
  }

  var units = {
    pLs_to_m3s: function (x) { return x * 1e-15; }, m3s_to_pLs: function (x) { return x * 1e15; },
    MPa_per_nm_to_Pa_per_m: function (x) { return x * 1e15; }, Pa_per_m_to_MPa_per_nm: function (x) { return x * 1e-15; }
  };

  return { FAMILIES: FAMILIES, evaluate: evaluate, specFromCase: specFromCase, compare: compare, flowUncertainty: flowUncertainty, units: units };
});
