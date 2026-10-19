/* Continuum Lab — units and physical constants. SI inside the coupling and the solver; these helpers convert only at
   input and output. Shared by the page, the worker and the Node/Python test harness (see tools/continuum/CONTRACTS.md). */
(function (root) {
  'use strict';

  const NA = 6.02214076e23;                 // 1/mol (exact, SI 2019)
  const M_WATER = 18.015268e-3;             // kg/mol (IAPWS)
  const C = Object.freeze({
    NA,
    mWater: M_WATER / NA,                   // kg per water molecule = 2.991506e-26
    rhoRef: 996.557,                        // kg/m^3, water at 300 K and 0.101325 MPa (NIST, IAPWS-95)
    rhoAt10MPa: 1001.00,                    // kg/m^3, water at 300 K and 10.1013 MPa (NIST)
    muWater: 853.742e-6,                    // Pa s, water at 300 K and 0.101325 MPa (NIST, Huber et al. 2009)
    pAmbient: 101325,                       // Pa
    T: 300.0,                               // K
  });

  const LMH = 1e-3 / 3600;                  // 1 L m^-2 h^-1 in m/s
  const conv = Object.freeze({
    nm: { toSI: (x) => x * 1e-9, fromSI: (x) => x * 1e9 },
    um: { toSI: (x) => x * 1e-6, fromSI: (x) => x * 1e6 },
    mm: { toSI: (x) => x * 1e-3, fromSI: (x) => x * 1e3 },
    MPa: { toSI: (x) => x * 1e6, fromSI: (x) => x * 1e-6 },
    bar: { toSI: (x) => x * 1e5, fromSI: (x) => x * 1e-5 },
    LMH: { toSI: (x) => x * LMH, fromSI: (x) => x / LMH },                     // flux
    LMHbar: { toSI: (x) => x * LMH / 1e5, fromSI: (x) => x * 1e5 / LMH },      // permeance
    // volume flow of water (m^3/s) <-> molecules per ns, through the reference bulk density
    moleculesPerNs: { toSI: (x) => x * 1e9 * C.mWater / C.rhoRef, fromSI: (x) => x * C.rhoRef / C.mWater * 1e-9 },
  });

  /* Equivalent volume flow from net molecular crossings: q = m_w (N_forward - N_backward) / (rho_ref * dt). */
  function crossingsToVolumeFlow(nForward, nBackward, dtSeconds, rhoRef) {
    return C.mWater * (nForward - nBackward) / ((rhoRef || C.rhoRef) * dtSeconds);
  }

  /* Density from the NIST isotherm at 300 K (linear between 0.101325 and 10.1013 MPa; gate checks only). */
  function waterDensity300K(pPa) {
    const p0 = 0.101325e6, p1 = 10.1013e6;
    return C.rhoRef + (C.rhoAt10MPa - C.rhoRef) * (pPa - p0) / (p1 - p0);
  }

  /* Compact numeric formatting with 3 significant figures and a proper minus sign. */
  function fmt3(v) {
    if (!Number.isFinite(v)) return '–';
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e3 || a < 1e-3 || Math.abs(+v.toPrecision(3)) >= 1e3) {
      const e = Math.floor(Math.log10(a));
      let m = v / Math.pow(10, e);
      if (Math.abs(+m.toPrecision(3)) >= 10) { m /= 10; return fmtSci(m, e + 1); }
      return fmtSci(m, e);
    }
    return v.toPrecision(3).replace('-', '−');
  }
  function fmtSci(m, e) {
    const sup = String(e).replace('-', '⁻').replace(/[0-9]/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]);
    return (m.toPrecision(3) + ' × 10' + sup).replace(/^-/, '−');
  }
  /* Exact integers with thin-space grouping (counts up to 2^53). */
  function fmtInt(n) {
    if (!Number.isFinite(n)) return '–';
    const s = Math.round(n).toString();
    return n >= 1e12 ? fmt3(n) : s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  const api = { C, conv, LMH, crossingsToVolumeFlow, waterDensity300K, fmt3, fmtInt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ContinuumUnits = api;
})(typeof self !== 'undefined' ? self : this);
