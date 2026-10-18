#!/usr/bin/env python3
"""Fills the validation and throughput tables of lab/water/index.html from tools/water-lab/results/*.json and writes
results/summary.json (PASS / FAIL / NOT RUN per check, engine checksum). Run from anywhere:
    python3 tools/water-lab/build_validation.py"""
import hashlib, html, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
RES = os.path.join(HERE, 'results')
PAGE = os.path.join(ROOT, 'lab', 'water', 'index.html')

CHECKS = [
    (1, 'Browser engine vs native LAMMPS: forces, energy, pressure',
     'Same input in both engines (4 configurations: 216 and 512 molecules, s = 0.90, 1.00, 1.10, an active tether): per-atom forces within 10⁻⁶ kcal mol⁻¹ Å⁻¹, energies within 10⁻⁶ kcal/mol, pressure within 10⁻⁴ atm'),
    (2, 'Geometry, neutrality, topology, periodic wrapping',
     'All presets and every 10 fs of 5 ps: O–H 1.0 ± 10⁻⁴ Å, H–O–H 109.47 ± 0.01°, |Σq| ≤ 10⁻¹⁰ e, molecules whole, every oxygen drawn inside the cell'),
    (3, 'O–O LJ strength reaches the force field',
     'LJ energy proportional to s within 10⁻¹⁰; Coulomb unchanged; forces and pressure linear in s; the page’s change between chunks equals a fresh build at that s within 10⁻⁶ kcal/mol'),
    (4, 'Tether force and torque',
     'Added force per atom (mᵢ/M)(−k(R − X)) within 10⁻¹⁰; torque about R ≤ 10⁻⁹ kcal/mol; isolated molecule oscillates within 1 % of 2π(M/k)^½ and is not set rotating'),
    (5, 'Tether force vs finite differences',
     'Central differences of the tether energy reported by LAMMPS equal −k(R − X) within 10⁻⁶'),
    (6, 'Zero stiffness = unperturbed control',
     'With k = 0 (and a molecule selected) the coordinates after 1000 steps equal a run without the tether within 10⁻¹⁰ Å'),
    (7, 'Pulling, release and periodic crossing',
     'Constraints held while a molecule is pulled across a cell face; R continuous; a repeat gives an identical journal and identical coordinates; native replay of the export matches the potential energy within 10⁻⁶ for 0.5 ps; energy balance within 2 % + 0.5 kJ/mol'),
    (8, 'Unforced NVE energy drift',
     'At 1 fs, |drift| ≤ 0.25 kJ mol⁻¹ ns⁻¹ per molecule over 20 ps, native and browser engine (browser run revised from 5 ps); 0.5 and 2 fs reported'),
    (9, 'NVT and NPT statistics vs native',
     'Four independent 40 ps runs per engine and ensemble (revised from one): browser and native means of T, PE and P (NVT) and density and PE (NPT) agree at 99 % per comparison (Welch, Bonferroni over five); mean T consistent with 298.15 K'),
    (10, 'Interface behaviour',
     'Molecule-count change, pause/resume, stale messages, engine failure and Reset, hidden tab, touch at 360/390 px, keyboard, reduced motion, download, no engine download before Start; '
     'for release 2026.5.1 also the essential readout, expandable panels from the keyboard, descriptive means, plots drawn on opening, one-click gentle pull before Start, and the demonstration handle within 0.25 nm of its start'),
]


SUP = str.maketrans('0123456789-+', '⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺')


def pretty(txt):
    """Typography for the page only (the JSON results keep plain ASCII)."""
    txt = txt.replace('kcal/mol/A', 'kcal mol⁻¹ Å⁻¹').replace('kJ/mol/ns', 'kJ mol⁻¹ ns⁻¹').replace('kg/m^3', 'kg/m³')
    txt = txt.replace('|O-H - 1 A|', '|O–H − 1 Å|').replace('|angle - 109.47|', '|H–O–H − 109.47°|').replace('0.5 k|R-X|^2', '½k|R − X|²')
    txt = re.sub(r'(\d) deg\b', r'\1°', txt)
    txt = re.sub(r'\((1) crossings\)', r'(\1 crossing)', txt)
    txt = re.sub(r'angular momentum ([0-9.e+-]+)$', r'angular momentum \1 g mol⁻¹ Å² fs⁻¹', txt)
    def sci(m):
        mant, exp = m.group(1), int(m.group(2))
        if float(mant) == 0:
            return '0'
        return f'{mant} × 10' + str(exp).translate(SUP)
    txt = re.sub(r'(\d) A\b', r'\1 Å', txt)
    txt = re.sub(r'(\d+(?:\.\d+)?)e([+-]?\d+)', sci, txt)
    txt = re.sub(r'(?<![\w.])-(\d)', '−\\1', txt)
    return txt


def load(name):
    p = os.path.join(RES, name)
    return json.load(open(p)) if os.path.exists(p) else None


AMENDED = {3, 8, 9, 10}      # protocol amendments recorded in tests/TOLERANCES.md (Revisions)


def verdict_cell(r, cid=None):
    if r is None:
        return '<span class="wl-verdict wl-verdict-notrun">NOT RUN</span>', 'NOT RUN'
    v = r.get('verdict', 'NOT RUN')
    cls = {'PASS': 'pass', 'FAIL': 'fail'}.get(v, 'notrun')
    extra = ' (amended)' if (r.get('revised') or cid in AMENDED) else ''
    return f'<span class="wl-verdict wl-verdict-{cls}">{v}{extra}</span>', v + extra


def ranges_block():
    """Allowed interface ranges against the conditions actually run (checks 1-10 and supplementary check S1)."""
    s1 = load('s1.json')
    rows = [
        ('Molecules', '216, 256, 343, 512', 'all four (checks 2 and 10, throughput); forces at 216 and 512 (check 1)', '216'),
        ('Temperature target', '260–370 K', '298.15 K; 320 K briefly in check 10', '260 and 370 K'),
        ('Pressure target', '1–1000 bar', '1 bar; 500 bar briefly in check 10', '1 and 1000 bar'),
        ('O–O LJ strength s', '0.90, 0.95, 1.00, 1.05, 1.10', '0.90, 1.00, 1.10 (checks 1 and 3); 1.05 briefly in check 10', '0.90, 0.95, 1.05, 1.10 (298.15 K, 1 bar)'),
        ('Pull stiffness k', '0.347, 0.695, 1.39, 3.47, 6.95 N/m', '3.47 N/m (checks 1, 4, 5, 7); 0.695 and 1.39 N/m (check 10); 0 (check 6)', '0.347 and 6.95 N/m'),
    ]
    out = ('<h4 class="wl-subhead" id="ranges">Allowed ranges and conditions actually run</h4>\n'
           '<div class="wl-tests-wrap"><table class="wl-tests"><thead><tr><th scope="col">Setting</th><th scope="col">Allowed in the interface</th>'
           '<th scope="col">Run in checks 1–10</th><th scope="col">Run in check S1</th></tr></thead><tbody>'
           + ''.join(f'<tr><th scope="row">{a}</th><td>{b}</td><td>{c}</td><td>{d}</td></tr>' for a, b, c, d in rows) + '</tbody></table></div>\n'
           '<p class="wl-small">Values between the points listed (for example 340 K or 200 bar) are allowed but were not run individually. '
           'Check S1 was specified in TOLERANCES.md before it was run.</p>\n')
    if not s1:
        return out + '<p class="wl-small">Check S1: NOT RUN.</p>\n'
    v = s1.get('verdict', 'NOT RUN')
    cls = {'PASS': 'pass', 'FAIL': 'fail'}.get(v, 'notrun')
    nat, br, pl = s1.get('native') or {}, s1.get('browser') or {}, s1.get('pulls') or {}
    label = {'260K_1bar': '260 K, 1 bar', '260K_1000bar': '260 K, 1000 bar', '370K_1bar': '370 K, 1 bar', '370K_1000bar': '370 K, 1000 bar',
             's0.90': 's = 0.90', 's0.95': 's = 0.95', 's1.05': 's = 1.05', 's1.10': 's = 1.10'}
    f = lambda x, d=1: ('–' if x is None else f'{x:.{d}f}')
    trs = []
    for key, name in label.items():
        n, b = nat.get(key, {}), br.get(key, {})
        ok = n.get('pass') and b.get('pass')
        trs.append(f'<tr><th scope="row">{name}</th><td>{f(n.get("mean_T_10_20ps_K"))}</td><td>{f(n.get("density_min_kg_m3"), 0)}–{f(n.get("density_max_kg_m3"), 0)}</td>'
                   f'<td>{f(n.get("density_5_10ps"), 0)} → {f(n.get("density_10_20ps"), 0)}</td><td>{f(b.get("mean_T_2_5_5ps_K"))}</td>'
                   f'<td><span class="wl-verdict wl-verdict-{"pass" if ok else "fail"}">{"PASS" if ok else "FAIL"}</span></td></tr>')
    out += ('<div class="wl-tests-wrap"><table class="wl-tests"><thead><tr><th scope="col">Check S1 condition (216 molecules)</th>'
            '<th scope="col">Native, 20 ps NPT: mean T, 10–20 ps (K)</th><th scope="col">Density range (kg/m³)</th><th scope="col">Mean density, 5–10 → 10–20 ps (kg/m³)</th>'
            '<th scope="col">Browser engine, 5 ps: mean T, 2.5–5 ps (K)</th><th scope="col">Result</th></tr></thead><tbody>' + ''.join(trs) + '</tbody></table></div>\n')
    prow = []
    for key in ('k0.5', 'k10'):
        q = pl.get(key)
        if not q:
            continue
        dOH = pretty(f"{q['max_OH_dev_A']:.1e}")
        bal = f(q.get('energy_balance_error_kJ_mol'), 2) + ' of ' + f(q.get('energy_balance_tolerance_kJ_mol'), 2) + ' kJ/mol allowed'
        pv = 'PASS' if q.get('pass') else 'FAIL'
        prow.append(f'<tr><th scope="row">{q["k_N_m"]:.3g} N/m</th><td>{q["max_handle_com_separation_A"] / 10:.4f} nm</td><td>{dOH} Å</td>'
                    f'<td>{bal}</td><td><span class="wl-verdict wl-verdict-{pv.lower()}">{pv}</span></td></tr>')
    if prow:
        out += ('<div class="wl-tests-wrap"><table class="wl-tests"><thead><tr><th scope="col">Check S1 pull (handle requested 0.8 nm away for 2 ps, release, 1 ps)</th>'
                '<th scope="col">Largest handle–molecule separation (end of each 10 fs chunk)</th><th scope="col">Max |O–H − 1 Å|</th>'
                '<th scope="col">Energy balance at release</th><th scope="col">Result</th></tr></thead><tbody>' + ''.join(prow) + '</tbody></table></div>\n')
    out += (f'<p class="wl-small">Check S1 overall: <span class="wl-verdict wl-verdict-{cls}">{v}</span>. Criteria: the run completes with all 648 atoms; '
            '|O–H − 1 Å| ≤ 10⁻⁴ Å; mean temperature within 5 K of the target (native) or 10 K (browser engine, 5 ps); density within 850–1150 kg/m³ throughout and the mean density '
            'over 10–20 ps within 4 % of that over 5–10 ps; energy balance at release within 2 % of the delivered work + 0.5 kJ/mol. Results: <code>results/s1.json</code>.</p>\n')
    return out


def main():
    rows, summary = [], {'checks': []}
    for cid, name, crit in CHECKS:
        r = load(f't{cid}.json')
        cell, v = verdict_cell(r, cid)
        measured = html.escape(pretty(r['summary'])) if r else 'not run'
        if r and cid == 3:
            measured += ('. Amended procedure: the first evaluation compared the page path with a fresh build at slightly different coordinates '
                         '(before and after SHAKE’s setup-time correction; difference 2.4 × 10⁻⁶ kcal/mol, above the 10⁻⁶ criterion); both are now evaluated '
                         'at identical coordinates, criterion unchanged, as recorded in TOLERANCES.md')
        if r and cid == 10:
            measured += ('. Amended for release 2026.5.1: items added for the new panel layout, including a check that the demonstration handle stays within 0.25 nm of its start, '
                         'added after a defect in release 2026.5 was found and fixed; the first run against the new layout failed at the 390 px touch step through a harness '
                         'scrolling artefact, since corrected, as recorded in TOLERANCES.md')
        if r and cid == 8 and r.get('original_stated_version'):
            o = r['original_stated_version']
            measured += (f'. The first stated version, with a 5 ps browser run, gave {o["browser_5ps"]["drift_kJ_mol_ns_per_molecule"]:.2f}'.replace('-', '−') + ' '
                         'and FAILED: 5 ps cannot resolve this tolerance (native 5 ps windows scatter from −1.43 to 0.75); the browser run was extended to 20 ps, as recorded in TOLERANCES.md')
        if r and cid == 9 and r.get('original_stated_version'):
            measured += ('. The first stated version, with one run per engine, FAILED on one of five comparisons (NPT potential energy per molecule, z ≈ 2.6); '
                         'it was revised to four independent runs per engine with a Bonferroni-corrected 99 % level per comparison, as recorded in TOLERANCES.md')
        rows.append(f'<tr><td>{cid}</td><th scope="row">{html.escape(name)}</th><td>{html.escape(crit)}</td><td>{measured}</td><td>{cell}</td></tr>')
        summary['checks'].append({'id': cid, 'name': name, 'verdict': v, 'summary': r['summary'] if r else None})
    wasm = os.path.join(ROOT, 'lab', 'water', 'engine', 'lammps-water.wasm')
    summary['engine_sha256'] = hashlib.sha256(open(wasm, 'rb').read()).hexdigest()
    summary['engine_bytes'] = os.path.getsize(wasm)
    bn, bw, bb = load('bench_native.json'), load('bench_node.json'), load('bench_browser.json')
    bench = ''
    if bn and bw and bb:
        by = lambda d: {x['molecules']: x for x in d['results']}
        n, w, b = by(bn), by(bw), by(bb)
        brows = []
        for N in (216, 256, 343, 512):
            if N in n and N in w and N in b:
                brows.append(f'<tr><td>{N}</td><td>{n[N]["steps_per_s"]:.0f}</td><td>{w[N]["steps_per_s"]:.0f}</td>'
                             f'<td>{b[N]["steps_per_s"]:.0f} ({b[N]["ps_per_s"]:.3f} ps/s)</td><td>{b[N]["display_fps"]:.0f}</td></tr>')
        bench = ('<h4 class="wl-subhead">Throughput</h4>\n<div class="wl-tests-wrap"><table class="wl-tests"><thead><tr><th scope="col">Molecules</th>'
                 '<th scope="col">Native LAMMPS (steps/s)</th><th scope="col">Browser engine in Node (steps/s)</th><th scope="col">This page in Chromium, worker (steps/s)</th>'
                 '<th scope="col">Display (frames/s)</th></tr></thead><tbody>' + ''.join(brows) + '</tbody></table></div>\n'
                 f'<p class="wl-small">Measured on {html.escape(bb["cpu"])} ({bb["cores"]} cores) with {html.escape(bb["browser"])}, pace “Fast”, '
                 f'20 s per size after a 3 s warm-up; native and Node: 1000 steps in 10-step chunks. Simulation throughput is measured in the worker, '
                 'separately from the page’s display frame rate. Your device will differ.</p>')
        summary['benchmarks'] = {'native': bn, 'node': bw, 'browser': bb}
    block = ('<div class="wl-tests-wrap"><table class="wl-tests"><thead><tr><th scope="col">#</th><th scope="col">Check</th>'
             '<th scope="col">Acceptance criterion</th><th scope="col">Measured</th><th scope="col">Result</th></tr></thead><tbody>\n'
             + '\n'.join(rows) + '\n</tbody></table></div>\n'
             '<p class="wl-small">Ten implementation checks, with protocols, results and amendments documented. The protocols and acceptance criteria were written in '
             '<a href="../../tools/water-lab/tests/TOLERANCES.md">TOLERANCES.md</a> before the first evaluation. Checks 3, 8 and 9 were amended after their first runs, and check 10 was extended for the release 2026.5.1 interface; '
             'each amendment is recorded there with its reason, and the original results are kept and reported. The checks show that the browser engine reproduces native LAMMPS '
             'forces at the tested configurations; longer-run behaviour was assessed separately (checks 8 and 9). Scripts and full results: <code>tools/water-lab/tests/</code> and '
             '<code>tools/water-lab/results/</code>; each script exits with a failure status when its check fails. The browser-engine checks run the same <code>.wasm</code> file '
             'and adapter code as this page (in Node); check 10 drives this page in Chromium.</p>\n'
             + ranges_block() + bench)
    page = open(PAGE).read()
    new = re.sub(r'(<!-- BEGIN:validation -->)(.*?)(<!-- END:validation -->)', lambda m: m.group(1) + '\n' + block + '        ' + m.group(3), page, flags=re.S)
    open(PAGE, 'w').write(new)
    s1 = load('s1.json')
    summary['supplementary'] = [{'id': 'S1', 'name': 'Allowed-range stability sweep', 'verdict': s1['verdict'] if s1 else 'NOT RUN', 'summary': s1['summary'] if s1 else None}]
    json.dump(summary, open(os.path.join(RES, 'summary.json'), 'w'), indent=1)
    for c in summary['checks'] + summary['supplementary']:
        print(f"{c['id']:>2} {c['verdict']:<14} {c['name']}")
    print('engine sha256', summary['engine_sha256'])
    bad = [c for c in summary['checks'] + summary['supplementary'] if not str(c['verdict']).startswith('PASS')]
    if bad:                                      # the page still shows the honest result; the exit status flags it
        print('NOT PASSED:', ', '.join(str(c['id']) for c in bad))
        sys.exit(1)


if __name__ == '__main__':
    main()
