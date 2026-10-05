"""Convert the AIMD export (cnt_viewer_aimd/*.xyz + export_meta.json) into the web data for the
Simulation Lab trajectory inspector: one little-endian Int16 binary per tube plus a public manifest.

Per frame: the tube is centred on its carbon centroid (minimum image in x, y), any net axial drift of the
tube is removed, z is wrapped into one cell centred on the tube, and every water is made whole (each H is
placed next to its nearest O by the minimum-image vector). Positions are stored in milli-angstrom.
The binary holds positions (frames x atoms x 3, int16) followed by the owner-O index of every H in every
frame (frames x nH, int16), so proton transfer, if any, is represented as it happened.
The public manifest carries no file-system paths.
"""
import json, os, sys, hashlib, math
import numpy as np

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
SYNTHETIC = "--synthetic" in sys.argv
if len(ARGS) != 2:
    sys.exit("usage: convert-cnt-trajectories.py <export_dir> <output_data_dir> [--synthetic]")
SRC, DST = ARGS
CODES = {"C": 0, "O": 1, "H": 2, "Na": 3, "Cl": 4}
SCALE = 1000.0  # int16 units per angstrom


def read_xyz(path):
    frames, times, species = [], [], None
    with open(path) as fh:
        while True:
            head = fh.readline()
            if not head.strip():
                break
            n = int(head)
            comment = fh.readline()
            t = float(comment.split("time_fs=")[1].split()[0])
            sp, xyz = [], np.empty((n, 3))
            for k in range(n):
                p = fh.readline().split()
                sp.append(p[0]); xyz[k] = (float(p[1]), float(p[2]), float(p[3]))
            if species is None:
                species = sp
            assert sp == species
            frames.append(xyz); times.append(t)
    return species, np.array(frames), np.array(times)


def mic(d, L):
    return d - L * np.round(d / L)


def prepare(species, X, L):
    sp = np.array(species)
    C, O, H = np.where(sp == "C")[0], np.where(sp == "O")[0], np.where(sp == "H")[0]
    F = len(X)
    out = np.empty_like(X)
    owners = np.empty((F, len(H)), dtype=np.int16)
    zshift = 0.0
    ref_cz = None
    prevC = None
    n_bad = 0
    max_oh = 0.0
    for f in range(F):
        x = X[f].copy()
        # tube centre in x, y: carbon centroid by minimum image about the first carbon
        c0 = x[C[0], :2]
        cxy = c0 + mic(x[C, :2] - c0, L[:2]).mean(0)
        x[:, :2] = mic(x[:, :2] - cxy, L[:2])
        # axial drift of the tube: unwrapped carbon displacement since the previous frame
        if prevC is not None:
            zshift += mic(X[f][C, 2] - prevC, L[2]).mean()
        prevC = X[f][C, 2].copy()
        if ref_cz is None:
            c0z = X[0][C[0], 2]
            ref_cz = c0z + mic(X[0][C, 2] - c0z, L[2]).mean()
        x[:, 2] = mic(x[:, 2] - (ref_cz + zshift), L[2])
        # owner O of every H, then make each water whole
        d = mic(x[H][None, :, :] - x[O][:, None, :], L)          # (nO, nH, 3)
        r2 = (d ** 2).sum(-1)
        own = r2.argmin(0)
        owners[f] = O[own]
        counts = np.bincount(own, minlength=len(O))
        n_bad += int(np.any(counts != 2) or np.any(np.sqrt(r2.min(0)) > 1.25))
        x[H] = x[O[own]] + d[own, np.arange(len(H))]
        out[f] = x
        max_oh = max(max_oh, float(np.sqrt(r2.min(0)).max()))
    return out, owners, n_bad, C, O, H, max_oh


def main():
    meta = json.load(open(os.path.join(SRC, "export_meta.json")))
    os.makedirs(DST, exist_ok=True)
    tubes = []
    for t in meta["tubes"]:
        species, X, times = read_xyz(os.path.join(SRC, t["exported_file"]))
        L = np.array(t["cell_A"], dtype=float)
        P, owners, n_bad, C, O, H, max_oh = prepare(species, X, L)
        assert np.abs(P).max() < 32.0, "coordinates exceed the int16 range"
        q = np.round(P * SCALE).astype("<i2")
        blob = q.tobytes() + owners.astype("<i2").tobytes()
        name = f"{t['tag']}.bin"
        open(os.path.join(DST, name), "wb").write(blob)
        rC = np.sqrt((P[:, C, :2] ** 2).sum(-1)).mean()
        comp = t["composition"]
        tubes.append(dict(
            id=t["tag"], label=t["chirality"], n=int(t["chirality"].strip("()").split(",")[0]),
            diameter_nm=round(2 * rC / 10, 3), length_nm=round(L[2] / 10, 3), cell_A=[round(v, 4) for v in L.tolist()],
            n_atoms=len(species), n_water=comp.get("O", 0), n_na=comp.get("Na", 0), n_cl=comp.get("Cl", 0), n_c=comp.get("C", 0),
            species="".join({"C": "C", "O": "O", "H": "H", "Na": "N", "Cl": "L"}[s] for s in species),
            n_frames=len(P), frame_spacing_fs=t["exported_frame_spacing_fs"], t0_fs=float(times[0]),
            duration_ps=round((times[-1] - times[0]) / 1000, 4), run_length_ps=t["run_length_ps"],
            frames_with_irregular_water=n_bad, max_oh_nm=round(max_oh / 10, 4), file=name, bytes=len(blob), sha256=hashlib.sha256(blob).hexdigest(),
            method=dict(code=t["cp2k_version"].replace("CP2K version", "CP2K").strip(), xc=t["xc"], dispersion=t["vdw"],
                        cutoff_Ry=t["cutoff_Ry"], rel_cutoff_Ry=t["rel_cutoff_Ry"], basis=t["basis"],
                        pseudopotentials=t["pseudopotentials"], ensemble=t["ensemble"], T_K=t["T_K"], dt_fs=t["dt_fs"]),
            source_sha256=t["source_sha256"]))
        print(f"{t['tag']:10s} frames={len(P)} atoms={len(species)} D={2*rC/10:.3f} nm  irregular-water frames={n_bad}  {len(blob)/1e6:.2f} MB")
    order = {"cnt_6_6": 0, "cnt_7_7": 1, "cnt_9_9": 2, "cnt_11_11": 3}
    tubes.sort(key=lambda d: order.get(d["id"], 9))
    man = dict(format="cnt-inspector-1", synthetic=SYNTHETIC, units=dict(position="milli-angstrom int16, little-endian", time="fs"),
               layout="positions[frames][atoms][3] then h_owner[frames][nH] (atom index of the owning O)",
               species_codes=dict(C="carbon", O="oxygen", H="hydrogen", N="sodium", L="chloride"), tubes=tubes)
    json.dump(man, open(os.path.join(DST, "manifest.json"), "w"), indent=1)
    print("manifest:", os.path.join(DST, "manifest.json"))


if __name__ == "__main__":
    main()
