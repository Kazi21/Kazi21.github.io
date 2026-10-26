#!/usr/bin/env python3
"""First-shell water motion around Na+ and Cl- in the four recorded CP2K AIMD runs, for the ion experiment's 3D view.

Reads the public trajectory files exactly as the CNT inspector and make_hydration.py do (lab/cnt/data: int16
milli-angstrom positions, then the owning oxygen of every hydrogen per frame) and writes, for every Na+ and Cl- of every
run (all ions; none is selected) and every second recorded frame (4 fs apart):
  - the ion's position across the tube relative to the tube axis (the mean carbon position of that frame);
  - the O, H, H positions relative to the ion (minimum image in all three cell directions; each H relative to its own
    oxygen) of every water whose oxygen comes within the first-shell radius plus 0.06 nm of that ion in at least one
    stored frame (0.38 nm for Na+, 0.44 nm for Cl-; the first-shell radii 0.32 and 0.38 nm are the inspector's).
Positions only: the files hold no derived quantity. Axes of the 3D view: x along the tube axis (the trajectory's z),
y and z across it (the trajectory's x and y), so the mapping is a proper rotation.

Output: lab/continuum/ions/data/shells.json (index, metadata only) and shells-6-6.bin, shells-7-7.bin, shells-9-9.bin,
shells-11-11.bin. Each .bin holds, for every ion in the order of the index:
  ion_yz[frames][2]          int16 little-endian, milli-angstrom (position across the tube relative to the axis)
  water[frames][W][3][3]     int16 little-endian, milli-angstrom (O, H, H; x, y, z relative to the ion)

Usage: python3 tools/continuum/ions/make_shells.py [--check]
  --check   recompute and compare with the existing files byte for byte (exit 1 on any difference)
"""
import hashlib
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SRC = os.path.join(SITE, 'lab', 'cnt', 'data')
OUT = os.path.join(SITE, 'lab', 'continuum', 'ions', 'data')
CUT_A = {'N': 3.2, 'L': 3.8}          # angstrom, first-shell radii of lab/cnt/inspector.js (HYD_CUT) and make_hydration.py
MARGIN_A = 0.6                        # angstrom added to the radius for the set of tracked waters
STRIDE = 2                            # every second recorded frame (recorded every 2 fs)
NAME = {'N': 'Na+', 'L': 'Cl-'}


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def mic(d, L):
    return d - L * np.round(d / L)


def to_i16(a_angstrom):
    v = np.rint(np.asarray(a_angstrom) * 1000.0)
    if v.size and (v.max() > 32767 or v.min() < -32768):
        raise SystemExit('value outside the int16 range')
    return v.astype('<i2')


def tube_file(tube):
    raw = open(os.path.join(SRC, tube['file']), 'rb').read()
    if len(raw) != tube['bytes'] or sha256_bytes(raw) != tube['sha256']:
        raise SystemExit('trajectory ' + tube['file'] + ' does not match the manifest')
    F, N = tube['n_frames'], tube['n_atoms']
    spc = np.array(list(tube['species']))
    nH = int((spc == 'H').sum())
    pos = np.frombuffer(raw, dtype='<i2', count=F * N * 3).astype(np.float64).reshape(F, N, 3) / 1000.0
    owner = np.frombuffer(raw, dtype='<i2', offset=F * N * 3 * 2, count=F * nH).astype(np.int64).reshape(F, nH)
    return raw, pos, owner, spc


def build_tube(tube):
    raw, pos, owner, spc = tube_file(tube)
    L = np.array(tube['cell_A'], dtype=np.float64)
    C = np.where(spc == 'C')[0]
    O = np.where(spc == 'O')[0]
    H = np.where(spc == 'H')[0]
    frames = np.arange(0, tube['n_frames'], STRIDE)
    P = pos[frames]                                          # stored frames x atoms x 3, angstrom
    own = owner[frames]
    # tube axis across the tube: mean carbon position, carbons taken relative to the first carbon (minimum image)
    c0 = P[:, C[0], :2]
    axis = c0 + mic(P[:, C, :2] - c0[:, None, :], L[:2]).mean(axis=1)
    blocks, ions = [], []
    offset = 0
    for code in ('N', 'L'):
        for ion in np.where(spc == code)[0]:
            dO = mic(P[:, O, :] - P[:, ion:ion + 1, :], L)    # frames x waters x 3
            dist = np.sqrt((dO * dO).sum(axis=2))
            track = np.where((dist < CUT_A[code] + MARGIN_A).any(axis=0))[0]
            W = len(track)
            yz = mic(P[:, ion, :2] - axis, L[:2])               # trajectory x, y -> view y, z
            water = np.zeros((len(frames), W, 3, 3))
            for k, w in enumerate(track):
                o_atom = O[w]
                orel = dO[:, w, :]
                water[:, k, 0, :] = orel
                for f in range(len(frames)):
                    hs = H[np.where(own[f] == o_atom)[0]]
                    if len(hs) != 2:
                        raise SystemExit('water ' + str(o_atom) + ' has ' + str(len(hs)) + ' hydrogens in a stored frame')
                    for j, h in enumerate(hs):
                        water[f, k, 1 + j, :] = orel[f] + mic(P[f, h, :] - P[f, o_atom, :], L)
            # view axes: x = trajectory z (tube axis), y = trajectory x, z = trajectory y
            water_view = water[..., [2, 0, 1]]
            b = to_i16(yz).tobytes() + to_i16(water_view).tobytes()
            blocks.append(b)
            ions.append({'species': NAME[code], 'atom_index': int(ion), 'first_shell_radius_nm': CUT_A[code] / 10.0,
                         'track_radius_nm': round((CUT_A[code] + MARGIN_A) / 10.0, 4), 'n_waters': W,
                         'water_oxygen_atoms': [int(O[w]) for w in track], 'offset_bytes': offset, 'bytes': len(b)})
            offset += len(b)
    data = b''.join(blocks)
    name = 'shells-' + str(tube['n']) + '-' + str(tube['n']) + '.bin'
    entry = {'id': tube['id'], 'label': tube['label'], 'n': tube['n'], 'file': name, 'bytes': len(data),
             'sha256': sha256_bytes(data), 'frames': int(len(frames)), 'frame_spacing_fs': tube['frame_spacing_fs'] * STRIDE,
             'source_frame_stride': STRIDE, 'source_file': 'lab/cnt/data/' + tube['file'], 'source_sha256': tube['sha256'],
             'cell_A': tube['cell_A'], 'ions': ions}
    return name, data, entry


def build():
    man_path = os.path.join(SRC, 'manifest.json')
    man_bytes = open(man_path, 'rb').read()
    man = json.loads(man_bytes)
    files, tubes = {}, []
    for t in man['tubes']:
        name, data, entry = build_tube(t)
        files[name] = data
        tubes.append(entry)
    index = {
        'format': 'continuum-ions-shells-1',
        'generated_by': 'tools/continuum/ions/make_shells.py',
        'source_manifest': 'lab/cnt/data/manifest.json',
        'source_manifest_sha256': sha256_bytes(man_bytes),
        'method': {'code': 'CP2K 2026.1', 'xc': 'PBE', 'dispersion': 'D3(BJ)', 'ensemble': 'NVT', 'T_K': 300.0},
        'units': {'position': 'milli-angstrom int16, little-endian', 'time': 'fs'},
        'layout': 'per ion, in the order of "ions": ion_yz[frames][2] (position across the tube relative to the axis), then '
                  'water[frames][n_waters][3][3] (O, H, H; x, y, z relative to the ion; minimum image)',
        'axes': 'x along the tube axis (trajectory z); y, z across it (trajectory x, y)',
        'selection': 'every Na+ and Cl- of each run; waters whose oxygen comes within track_radius_nm of the ion in at '
                     'least one stored frame; every second recorded frame',
        'caveats': ['Positions only, from runs of 0.50-0.75 ps: the replay shows the recorded motion of these short runs, '
                    'not converged dynamics.',
                    'Ions were not restrained; neighbouring ions and the counter-ion are not stored.'],
        'tubes': tubes,
    }
    files['shells.json'] = (json.dumps(index, indent=1, ensure_ascii=False) + '\n').encode('utf-8')
    return files


def main():
    files = build()
    if '--check' in sys.argv:
        bad = []
        for name, data in files.items():
            path = os.path.join(OUT, name)
            if not os.path.exists(path) or open(path, 'rb').read() != data:
                bad.append(name)
        if bad:
            print('differ from a fresh computation: ' + ', '.join(bad))
            sys.exit(1)
        print('shells.json and ' + str(len(files) - 1) + ' shell files reproduce')
        return
    os.makedirs(OUT, exist_ok=True)
    for name, data in files.items():
        with open(os.path.join(OUT, name), 'wb') as f:
            f.write(data)
        print('wrote', name, len(data), 'bytes')


if __name__ == '__main__':
    main()
