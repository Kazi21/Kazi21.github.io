#!/usr/bin/env python3
"""First-shell hydration of Na+ and Cl- in the four recorded CP2K AIMD runs (Simulation Lab data, lab/cnt/data).

Reads the public trajectory files exactly as the CNT inspector does (int16 milli-angstrom positions, minimum image in
all three cell directions) and counts water oxygens within the inspector's first-shell radii (0.32 nm for Na+,
0.38 nm for Cl-). Writes lab/continuum/ions/data/hydration.json, which the ion experiment shows as recorded evidence.

These runs are 0.5-0.75 ps long. The counts are what the recorded configurations contain, not converged hydration
numbers; the spread reported here is the frame-to-frame spread within one short run, not an uncertainty of a mean.

Usage: python3 tools/continuum/ions/make_hydration.py [--check]
  --check   recompute and compare with the existing JSON (exit 1 on any difference)
"""
import hashlib
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SRC = os.path.join(SITE, 'lab', 'cnt', 'data')
OUT = os.path.join(SITE, 'lab', 'continuum', 'ions', 'data', 'hydration.json')
CUT_A = {'N': 3.2, 'L': 3.8}          # angstrom, same as lab/cnt/inspector.js (HYD_CUT)
NAME = {'N': 'Na+', 'L': 'Cl-'}


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def load(tube):
    path = os.path.join(SRC, tube['file'])
    raw = open(path, 'rb').read()
    if len(raw) != tube['bytes']:
        raise SystemExit('size mismatch for ' + tube['file'])
    F, N = tube['n_frames'], tube['n_atoms']
    pos = np.frombuffer(raw, dtype='<i2', count=F * N * 3).astype(np.float64).reshape(F, N, 3) / 1000.0
    return pos, sha256(path)


def mic(d, L):
    return d - L * np.round(d / L)


def analyse(tube):
    pos, digest = load(tube)
    spc = np.array(list(tube['species']))
    L = np.array(tube['cell_A'], dtype=np.float64)
    O = np.where(spc == 'O')[0]
    out = {'id': tube['id'], 'label': tube['label'], 'n': tube['n'], 'diameter_nm': tube['diameter_nm'],
           'n_water': tube['n_water'], 'n_frames': tube['n_frames'], 'frame_spacing_fs': tube['frame_spacing_fs'],
           'run_length_ps': tube['run_length_ps'], 'file': 'lab/cnt/data/' + tube['file'], 'file_sha256': digest,
           'source_sha256': tube.get('source_sha256'), 'ions': {}}
    for code in ('N', 'L'):
        idx = np.where(spc == code)[0]
        counts, dmin_all, shell_r = [], [], []
        for ion in idx:
            d = mic(pos[:, O, :] - pos[:, ion:ion + 1, :], L)
            r = np.sqrt((d * d).sum(axis=2))                     # frames x waters, angstrom
            counts.append((r < CUT_A[code]).sum(axis=1))
            shell_r.append(r[r < CUT_A[code]])
            dmin_all.append(r.min(axis=1))
        c = np.concatenate(counts).astype(np.float64)
        per_frame = np.mean(np.vstack(counts), axis=0)           # averaged over ions of this species
        nb = 5
        blocks = np.array_split(per_frame, nb)
        bm = np.array([b.mean() for b in blocks])
        rr = np.concatenate(shell_r) / 10.0
        hist, edges = np.histogram(rr, bins=np.arange(0.15, CUT_A[code] / 10.0 + 1e-9, 0.005))
        mode = 0.5 * (edges[np.argmax(hist)] + edges[np.argmax(hist) + 1]) if hist.sum() else None
        out['ions'][NAME[code]] = {
            'n_ions': int(len(idx)), 'cutoff_nm': CUT_A[code] / 10.0,
            'mean_count': round(float(c.mean()), 4),
            'frame_sd': round(float(per_frame.std(ddof=1)), 4),
            'min_count': int(c.min()), 'max_count': int(c.max()),
            'block_means_5': [round(float(x), 4) for x in bm],
            'shell_distance_mean_nm': round(float(rr.mean()), 4) if rr.size else None,
            'shell_distance_mode_nm': round(float(mode), 4) if mode is not None else None,
        }
    # Na-Cl distances (minimum image, all pairs)
    na, cl = np.where(spc == 'N')[0], np.where(spc == 'L')[0]
    dd = []
    for i in na:
        for j in cl:
            d = mic(pos[:, j, :] - pos[:, i, :], L)
            dd.append(np.sqrt((d * d).sum(axis=1)) / 10.0)
    dd = np.concatenate(dd)
    out['na_cl_distance_nm'] = {'min': round(float(dd.min()), 4), 'mean': round(float(dd.mean()), 4)}
    return out


def build():
    man_path = os.path.join(SRC, 'manifest.json')
    man = json.load(open(man_path))
    tubes = [analyse(t) for t in man['tubes']]
    return {
        'format': 'continuum-ions-hydration-1',
        'generated_by': 'tools/continuum/ions/make_hydration.py',
        'source_manifest': 'lab/cnt/data/manifest.json',
        'source_manifest_sha256': sha256(man_path),
        'method': {'code': 'CP2K 2026.1', 'xc': 'PBE', 'dispersion': 'D3(BJ)', 'ensemble': 'NVT', 'T_K': 300.0,
                   'counting': 'water oxygens within the cutoff of the ion, minimum image in all three cell directions, '
                               'every stored frame (2 fs spacing), averaged over ions of the species'},
        'caveats': [
            'Each run is 0.50-0.75 ps long: the counts describe the recorded configurations, not converged hydration numbers.',
            'frame_sd and block_means_5 show the spread within one short run; they are not uncertainties of a converged mean.',
            'Ions were not restrained to the tube axis; in the (6,6) run the Na+ and Cl- form a solvent-shared pair '
            '(Na-Cl about 0.44 nm) with only six waters present, which lowers both counts.',
            'In the (9,9) run a Na+-Cl- contact pair forms transiently (minimum separation 0.289 nm).',
            'The (11,11) counts are used by the ion experiment as the reference (least confined) shell; they are not bulk values.',
        ],
        'tubes': tubes,
    }


def main():
    data = build()
    text = json.dumps(data, indent=1, ensure_ascii=False) + '\n'
    if '--check' in sys.argv:
        old = open(OUT, encoding='utf-8').read() if os.path.exists(OUT) else ''
        if old != text:
            print('hydration.json differs from a fresh computation')
            sys.exit(1)
        print('hydration.json reproduces')
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(text)
    for t in data['tubes']:
        print(t['label'], {k: v['mean_count'] for k, v in t['ions'].items()}, t['na_cl_distance_nm'])


if __name__ == '__main__':
    main()
