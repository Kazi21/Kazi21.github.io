#!/usr/bin/env python3
"""Standalone validation figures for the Continuum Lab, with units, input hashes and provenance in each figure.

  fig_duct_refinement.png   S1/S2: error of Q in the developed duct vs cells across (log-log, slope-2 guide)
  fig_mesh_check.png        standard vs fine mesh, relative Q difference for every allowed membrane size
  fig_openfoam.png          F1-F4 (+ the reported 80-cell run): browser vs OpenFOAM Q and velocity L2
  fig_pore_flux.png         analyze_pore_flux.py result: q vs drive with the fit and its interval (labelled
                            SYNTHETIC when the input is a synthetic fixture)
Inputs (defaults under tools/continuum): results/t_solver.json, ../../lab/continuum/data/mesh-check.json,
results/openfoam.json, and --pore-flux FILE (optional). Missing inputs are listed and give exit status 1.

Usage: python3 plot_validation.py [--results DIR] [--out DIR] [--pore-flux FILE]
"""
import argparse, hashlib, json, os, sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
COL = {'browser': '#0072B2', 'openfoam': '#D55E00', 'fit': '#009E73'}


def h12(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()[:12]


def footer(fig, src):
    name = lambda s: os.path.relpath(s, HERE) if not os.path.relpath(s, HERE).startswith('../..') else os.path.basename(s)
    fig.text(0.01, 0.01, 'Source: ' + '; '.join('%s (sha256 %s)' % (name(s), h12(s)) for s in src) + '. Units SI. Continuum Lab, plot_validation.py',
             fontsize=6.5, color='#526477')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--results', default=os.path.join(HERE, 'results'))
    ap.add_argument('--out', default=os.path.join(HERE, 'results', 'figures'))
    ap.add_argument('--pore-flux', default=None, help='analyze_pore_flux.py output JSON (optional)')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    missing = []
    plt.rcParams.update({'font.size': 9, 'font.family': 'DejaVu Sans'})
    # duct refinement
    p = os.path.join(a.results, 't_solver.json')
    if os.path.exists(p):
        r = json.load(open(p)); s2 = next(i for i in r['items'] if i['id'] == 'S2')
        N = [d['N'] for d in s2['data']]; e = [abs(d['errQ']) for d in s2['data']]
        fig, ax = plt.subplots(figsize=(4.6, 3.4))
        ax.loglog(N, e, 'o-', color=COL['browser'], label='browser solver, |Q - Q_series| / Q_series')
        ax.loglog(N, [e[0] * (N[0] / n) ** 2 for n in N], '--', color='#718096', label='second order')
        ax.set_xlabel('cells across the duct'); ax.set_ylabel('relative error of Q'); ax.legend(fontsize=7); ax.grid(True, which='both', alpha=0.3)
        ax.set_title('Developed square duct (S1, S2)')
        footer(fig, [p]); fig.tight_layout(rect=(0, 0.04, 1, 1)); fig.savefig(os.path.join(a.out, 'fig_duct_refinement.png'), dpi=150); plt.close(fig)
    else: missing.append(p)
    # mesh check
    p = os.path.join(HERE, '..', '..', 'lab', 'continuum', 'data', 'mesh-check.json')
    if os.path.exists(p):
        m = json.load(open(p))['entries']
        keys = sorted(m, key=lambda k: (m[k]['W_um'] * m[k]['B_um'], m[k]['W_um']))
        fig, ax = plt.subplots(figsize=(6.4, 3.2))
        ax.semilogy(range(len(keys)), [max(m[k]['rel'], 1e-12) for k in keys], 'o', color=COL['browser'])
        ax.axhline(0.02, color=COL['openfoam'], ls='--', lw=1); ax.text(0.2, 0.025, 'gate 2 %', color=COL['openfoam'], fontsize=7)
        ax.set_xticks(range(len(keys))); ax.set_xticklabels([k.replace('x', '×') for k in keys], rotation=70, fontsize=6)
        ax.set_xlabel('membrane W × B (µm), intact membrane, ΔP = 1 MPa'); ax.set_ylabel('|Q_fine − Q_20| / Q_fine'); ax.grid(True, alpha=0.3)
        ax.set_title('Standard vs fine mesh for every allowed size')
        footer(fig, [p]); fig.tight_layout(rect=(0, 0.04, 1, 1)); fig.savefig(os.path.join(a.out, 'fig_mesh_check.png'), dpi=150); plt.close(fig)
    else: missing.append(p)
    # openfoam
    p = os.path.join(a.results, 'openfoam.json')
    if os.path.exists(p):
        o = json.load(open(p)); items = [i for i in o['items'] if 'data' in i]
        fig, axs = plt.subplots(1, 2, figsize=(7.2, 3.2))
        ids = [i['id'] for i in items]
        axs[0].bar(ids, [100 * i['data']['Q_rel_diff'] for i in items], color=COL['browser']); axs[0].axhline(2, color=COL['openfoam'], ls='--', lw=1)
        axs[0].set_ylabel('|Q_browser − Q_OpenFOAM| / Q_OpenFOAM (%)'); axs[0].set_title('Total flow')
        axs[1].bar(ids, [100 * i['data']['velocity_L2'] for i in items], color=COL['browser']); axs[1].axhline(5, color=COL['openfoam'], ls='--', lw=1)
        axs[1].set_ylabel('normalised velocity L2 (%)'); axs[1].set_title('Velocity field')
        for ax in axs: ax.grid(True, axis='y', alpha=0.3)
        conv = (o.get('convergence') or {}).get('levels')
        src = [p]
        footer(fig, src); fig.tight_layout(rect=(0, 0.05, 1, 1)); fig.savefig(os.path.join(a.out, 'fig_openfoam.png'), dpi=150); plt.close(fig)
        if conv:
            fig, ax = plt.subplots(figsize=(4.6, 3.4))
            for code, mk in (('browser', 'o-'), ('openfoam', 's-')):
                pts = [(1 / c['N'], c['Q_' + code]) for c in conv if c.get('Q_' + code)]
                if pts: ax.plot([x for x, _ in pts], [y for _, y in pts], mk, color=COL[code], label=code)
                an = ((o.get('convergence') or {}).get('analysis') or {}).get(code) or {}
                qx = an.get('Q_extrapolated_m3_s')
                if qx is not None and qx == qx and pts:
                    ax.plot([0, pts[-1][0]], [qx, pts[-1][1]], ':', color=COL[code], lw=1)
                    ax.plot([0], [qx], mk[0], mfc='none', color=COL[code], label='%s, Richardson (p = %.2f)' % (code, an.get('observed_order', float('nan'))))
            ax.set_xlabel('1 / cells across W'); ax.set_ylabel('Q (m³/s)'); ax.legend(fontsize=7); ax.grid(True, alpha=0.3); ax.set_xlim(left=0)
            ax.set_title('Closed-strip case: mesh convergence')
            footer(fig, src); fig.tight_layout(rect=(0, 0.04, 1, 1)); fig.savefig(os.path.join(a.out, 'fig_openfoam_convergence.png'), dpi=150); plt.close(fig)
    else: missing.append(p)
    # pore flux
    if a.pore_flux:
        r = json.load(open(a.pore_flux))
        cs = r.get('conditions', {})
        fig, ax = plt.subplots(figsize=(4.6, 3.4))
        for role, mk, col in (('fit', 'o', COL['browser']), ('heldout', 's', COL['openfoam']), ('zero', 'D', '#526477')):
            sel = [c for c in cs.values() if c['role'] == role]
            if sel:
                ax.errorbar([c['drive_Pa'] / 1e6 for c in sel], [c['q_m3_s'] for c in sel],
                            yerr=[[c['q_m3_s'] - c['q_interval_m3_s'][0] for c in sel], [c['q_interval_m3_s'][1] - c['q_m3_s'] for c in sel]], fmt=mk, color=col, label=role, capsize=2)
        if r.get('fit'):
            G = r['fit']['through_origin']['G']; lo, hi = r['fit']['through_origin']['interval_G']
            xs = [min(c['drive_Pa'] for c in cs.values()) / 1e6, max(c['drive_Pa'] for c in cs.values()) / 1e6]
            ax.plot(xs, [G * x * 1e6 for x in xs], '-', color=COL['fit'], label='q = G ΔP, G = %.3g' % G)
            ax.fill_between(xs, [lo * x * 1e6 for x in xs], [hi * x * 1e6 for x in xs], color=COL['fit'], alpha=0.2, lw=0)
        ax.set_xlabel('drive ΔP (MPa)'); ax.set_ylabel('q (m³/s)'); ax.legend(fontsize=7); ax.grid(True, alpha=0.3)
        ax.set_title(('SYNTHETIC FIXTURE — ' if r.get('synthetic') else '') + 'pore flux and fit (status: %s)' % r.get('status'), fontsize=8)
        footer(fig, [a.pore_flux]); fig.tight_layout(rect=(0, 0.04, 1, 1)); fig.savefig(os.path.join(a.out, 'fig_pore_flux.png'), dpi=150); plt.close(fig)
    if missing:
        print('missing inputs: ' + ', '.join(missing)); sys.exit(1)
    print('figures written to ' + a.out)


if __name__ == '__main__':
    main()
