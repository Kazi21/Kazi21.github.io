/* Continuum Lab — pore laws and their supported domain. A law maps the driving potential across one pore, dPi (Pa),
   to its volume flow q (m^3/s). Only linear laws (q = G dPi) exist in this release. Each law carries its source
   kind and assessment status; a declared scenario is an input, never a measurement (tools/continuum/CONTRACTS.md §4). */
(function (root) {
  'use strict';

  const SOURCE_KINDS = ['analytic_reference', 'declared_scenario', 'owner_measurement', 'published_reproduction'];
  const ASSESSMENTS = ['unassessed', 'checked', 'supported_in_scope', 'failed'];

  /* Hagen–Poiseuille with Navier slip plus a Sampson orifice resistance split equally between entrance and exit:
     1/G = R_entry + r_interior L + R_exit, r_interior = 8 mu / (pi a^4 (1 + 4 b / a)), R_entry = R_exit = 3 mu / (2 a^3).
     Units: a, b, L in m; mu in Pa s; resistances in Pa s/m^3 (entry/exit) and Pa s/m^4 (interior). */
  function hpwResistances(p) {
    const a = p.radius_m, b = p.slip_m || 0, mu = p.mu_Pa_s;
    return {
      rInterior: 8 * mu / (Math.PI * Math.pow(a, 4) * (1 + 4 * b / a)),
      rEntry: 1.5 * mu / Math.pow(a, 3),
      rExit: 1.5 * mu / Math.pow(a, 3),
    };
  }

  /* Build a law object from a manifest entry. Throws on an invalid declaration. */
  function buildPoreLaw(entry) {
    if (!entry || !entry.lawId) throw new Error('pore law needs a lawId');
    if (SOURCE_KINDS.indexOf(entry.sourceKind) < 0) throw new Error('unknown sourceKind ' + entry.sourceKind);
    if (ASSESSMENTS.indexOf(entry.assessmentStatus) < 0) throw new Error('unknown assessmentStatus ' + entry.assessmentStatus);
    const law = {
      lawId: entry.lawId, label: entry.label || entry.lawId, sourceKind: entry.sourceKind, assessmentStatus: entry.assessmentStatus,
      form: entry.form, domain: Object.assign({}, entry.domain), uncertainty: entry.uncertainty || null, provenance: entry.provenance || {},
      calibrated: (entry.sourceKind === 'owner_measurement' || entry.sourceKind === 'published_reproduction') && entry.assessmentStatus === 'supported_in_scope',
    };
    if (entry.form === 'linear-constant') {
      if (!(entry.G_m3_Pa_s > 0)) throw new Error('linear-constant law needs G_m3_Pa_s > 0');
      law.G_m3_Pa_s = entry.G_m3_Pa_s;
      law.conductanceAt = function (L) {
        const ls = law.domain.lengths_m;
        if (ls && !ls.some((x) => Math.abs(x - L) <= 1e-6 * x)) return { ok: false, reason: 'tube length ' + L + ' m is outside the law (supported: ' + ls.join(', ') + ' m)' };
        return { ok: true, G: law.G_m3_Pa_s };
      };
    } else if (entry.form === 'hpw') {
      law.params = Object.assign({}, entry.params);
      law.conductanceAt = function (L) {
        if (!(L > 0)) return { ok: false, reason: 'tube length must be positive' };
        const r = hpwResistances(law.params);
        return { ok: true, G: 1 / (r.rEntry + r.rInterior * L + r.rExit), resistances: r };
      };
    } else throw new Error('unknown law form ' + entry.form);
    return law;
  }

  /* Evaluate one pore: q = G dPi within the declared driving interval. */
  function evaluatePoreLaw(law, state, dPiPa) {
    const g = law.conductanceAt(state.tubeLength_m);
    if (!g.ok) return { q_m3_s: NaN, dq_dPi_m3_Pa_s: NaN, supported: false, reason: g.reason, uncertainty: null, sourceId: law.lawId };
    const d = law.domain;
    const inRange = !(d.dPiMin_Pa != null && dPiPa < d.dPiMin_Pa - 1e-9 * Math.abs(d.dPiMin_Pa || 1)) &&
                    !(d.dPiMax_Pa != null && dPiPa > d.dPiMax_Pa * (1 + 1e-12));
    let unc = null;
    if (law.uncertainty && law.uncertainty.relHalfWidth != null) {
      unc = { q_lo: g.G * (1 - law.uncertainty.relHalfWidth) * dPiPa, q_hi: g.G * (1 + law.uncertainty.relHalfWidth) * dPiPa, level: law.uncertainty.level };
    }
    return { q_m3_s: g.G * dPiPa, dq_dPi_m3_Pa_s: g.G, supported: inRange, reason: inRange ? '' : 'driving potential outside the law interval', uncertainty: unc, sourceId: law.lawId };
  }

  /* Reasons a law cannot drive a given scenario (empty when compatible). */
  function lawScopeReasons(law, sc) {
    const d = law.domain, out = [];
    if (d.fluid && d.fluid !== sc.fluid) out.push('fluid "' + sc.fluid + '" differs from the law ("' + d.fluid + '")');
    if (d.T_K != null && Math.abs(d.T_K - sc.T_K) > 1e-9) out.push('temperature ' + sc.T_K + ' K differs from the law (' + d.T_K + ' K)');
    if (d.geometryId && d.geometryId !== sc.geometryId) out.push('pore geometry "' + sc.geometryId + '" differs from the law ("' + d.geometryId + '")');
    if (d.pitch_m != null && Math.abs(d.pitch_m - sc.pitch_m) > 1e-6 * d.pitch_m) out.push('pitch ' + sc.pitch_m + ' m differs from the law (' + d.pitch_m + ' m)');
    if (d.referencePlanes && d.referencePlanes !== sc.referencePlanes) out.push('reference-plane convention "' + sc.referencePlanes + '" differs from the law ("' + d.referencePlanes + '")');
    const g = law.conductanceAt(sc.tubeLength_m);
    if (!g.ok) out.push(g.reason);
    return out;
  }

  const api = { SOURCE_KINDS, ASSESSMENTS, hpwResistances, buildPoreLaw, evaluatePoreLaw, lawScopeReasons };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ContinuumPoreLaw = api;
})(typeof self !== 'undefined' ? self : this);
