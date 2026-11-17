#!/usr/bin/env python3
"""Read marker centres and curves from a published figure panel (an embedded raster image of the article PDF).

These are the functions behind the values of lab/continuum/flow/data/cases.json. They need the figure images of the
article (for example `pdfimages -png article.pdf prefix`), which are not redistributed with this site.

Procedure used for the case sheets
  1. Crop the panel (box = left, top, right, bottom in image pixels).
  2. Calibrate each axis by a straight-line fit through the centres of its tick marks: `find_frame` gives the frame
     lines, `ticks` the tick centres along one of them, and the tick values are typed from the printed axis labels.
  3. `markers`: isolate one colour, remove thin connecting lines by erosion, take the centroid of each remaining blob.
     For a triangle marker the value sits at the centre of the marker's bounding box, not at the centroid of its area
     (about 2.5 px higher at this resolution): use centre='bbox' with erode=0.
  4. `curve`: sample a coloured curve as the centroid of its pixels in column bands; a parabola is then fitted to the
     samples outside this file.
  5. A marker partly hidden by another one was located from its visible edge and the marker size measured on the free
     markers of the same series. That step was done by hand for two markers and is flagged in the case sheet.

Uncertainty: 2.5 px on each axis, converted to data units, taken as one standard uncertainty. `markers` returns it
together with the largest residual of the tick fit. `digitize` is the earlier frame-based calibration, kept because the
first readings were cross-checked with it; the case sheets use the tick-based calibration.

Usage (as a module):
    import digitize_fig as dg
    frame = dg.find_frame(numpy.asarray(PIL.Image.open(path).convert('RGB').crop(box)))
    ypx = dg.ticks(path, box, frame, axis='y')          # pair these with the printed tick values
    pts, (dx, dy), (rx, ry) = dg.markers(path, box, 'red', xcal, ycal)
"""
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

COLOURS = {
    'red':    lambda r, g, b: (r > 180) & (g < 90) & (b < 90),
    'green':  lambda r, g, b: (g > 170) & (r < 120) & (b < 120),
    'blue':   lambda r, g, b: (b > 170) & (r < 90) & (g < 90),
    'black':  lambda r, g, b: (r < 70) & (g < 70) & (b < 70),
    'magenta': lambda r, g, b: (r > 170) & (b > 170) & (g < 110),
    'yellow': lambda r, g, b: (r > 200) & (g > 200) & (b < 110),
}


def _line_centres(mask_1d, min_len):
    """Centres of runs of True in a boolean profile whose perpendicular extent was already required to be long."""
    idx = np.flatnonzero(mask_1d)
    if idx.size == 0:
        return []
    runs = np.split(idx, np.flatnonzero(np.diff(idx) > 1) + 1)
    return [float(r.mean()) for r in runs]


def find_frame(rgb, frac=0.55):
    r, g, b = (rgb[..., i].astype(int) for i in range(3))
    dark = (r < 90) & (g < 90) & (b < 90)
    h, w = dark.shape
    # a frame line is a row (column) whose longest dark run covers at least `frac` of the panel width (height)
    def longest_run(v):
        best = cur = 0
        for t in v:
            cur = cur + 1 if t else 0
            best = max(best, cur)
        return best
    rows = np.array([longest_run(dark[y]) for y in range(h)]) >= frac * w
    cols = np.array([longest_run(dark[:, x]) for x in range(w)]) >= frac * h
    ys, xs = _line_centres(rows, 0), _line_centres(cols, 0)
    if len(ys) < 2 or len(xs) < 2:
        raise RuntimeError(f'frame not found: {len(xs)} vertical, {len(ys)} horizontal lines')
    return xs[0], xs[-1], ys[0], ys[-1]


def digitize(path, box, xlim, ylim, colour, erode=4, min_area=20, frame=None):
    im = Image.open(path).convert('RGB').crop(box)
    rgb = np.asarray(im)
    x0, x1, y0, y1 = frame or find_frame(rgb)      # pixel positions of left, right, top, bottom frame lines
    r, g, b = (rgb[..., i].astype(int) for i in range(3))
    m = COLOURS[colour](r, g, b)
    if erode:
        m = ndi.binary_erosion(m, structure=np.ones((erode, erode)))
    lab, n = ndi.label(m)
    pts = []
    for k in range(1, n + 1):
        ys, xs = np.nonzero(lab == k)
        if ys.size < min_area:
            continue
        cx, cy = xs.mean(), ys.mean()
        if not (x0 - 3 <= cx <= x1 + 3 and y0 - 3 <= cy <= y1 + 3):
            continue                                  # legend entries outside the frame are dropped; those inside are returned
        X = xlim[0] + (cx - x0) / (x1 - x0) * (xlim[1] - xlim[0])
        Y = ylim[0] + (y1 - cy) / (y1 - y0) * (ylim[1] - ylim[0])
        pts.append((X, Y, int(ys.size)))
    dx = 2.5 / (x1 - x0) * abs(xlim[1] - xlim[0])
    dy = 2.5 / (y1 - y0) * abs(ylim[1] - ylim[0])
    return sorted(pts), (dx, dy), (x0, x1, y0, y1)


def ticks(path, box, frame, axis='y', min_len=12, max_len=60):
    """Centres (px) of tick marks that start at the left frame line (axis='y') or at the bottom frame line (axis='x')."""
    rgb = np.asarray(Image.open(path).convert('RGB').crop(box)).astype(int)
    dark = (rgb[..., 0] < 100) & (rgb[..., 1] < 100) & (rgb[..., 2] < 100)
    x0, x1, y0, y1 = (int(round(v)) for v in frame)
    out = []
    if axis == 'y':
        for y in range(0, dark.shape[0]):
            n = 0
            while x0 + n < dark.shape[1] and dark[y, x0 + n]:
                n += 1
            out.append(min_len <= n <= max_len)
    else:
        for x in range(0, dark.shape[1]):
            n = 0
            while y1 - n >= 0 and dark[y1 - n, x]:
                n += 1
            out.append(min_len <= n <= max_len)
    return _line_centres(np.array(out), 0)


def markers(path, box, colour, xcal, ycal, erode=4, min_area=20, keep=None, centre='centroid'):
    """Marker centres in data units with a tick-based calibration. xcal and ycal are lists of (pixel, value) pairs
    (two or more); a straight line is fitted to each. centre='centroid' (circles, squares, asterisks) or 'bbox' (triangles;
    use erode=0). Returns points, the (dx, dy) of +-2.5 px, and the fit residuals in px."""
    rgb = np.asarray(Image.open(path).convert('RGB').crop(box)).astype(int)
    m = COLOURS[colour](rgb[..., 0], rgb[..., 1], rgb[..., 2])
    if erode:
        m = ndi.binary_erosion(m, structure=np.ones((erode, erode)))
    lab, n = ndi.label(m)
    fx = np.polyfit([p for p, v in xcal], [v for p, v in xcal], 1)
    fy = np.polyfit([p for p, v in ycal], [v for p, v in ycal], 1)
    rx = max(abs(np.polyval(fx, p) - v) / abs(fx[0]) for p, v in xcal)
    ry = max(abs(np.polyval(fy, p) - v) / abs(fy[0]) for p, v in ycal)
    pts = []
    for k in range(1, n + 1):
        ys, xs = np.nonzero(lab == k)
        if ys.size < min_area:
            continue
        cx, cy = (xs.mean(), ys.mean()) if centre == 'centroid' else (0.5 * (xs.min() + xs.max()), 0.5 * (ys.min() + ys.max()))
        X, Y = float(np.polyval(fx, cx)), float(np.polyval(fy, cy))
        if keep is None or keep(X, Y):
            pts.append((X, Y))
    return sorted(pts), (2.5 * abs(fx[0]), 2.5 * abs(fy[0])), (rx, ry)


def curve(path, box, colour, xcal, ycal, window, step=8):
    """Samples of a coloured curve: centroid of the coloured pixels in each `step`-pixel column band inside a data window
    (xmin, xmax, ymin, ymax). Returns a list of (x, y)."""
    rgb = np.asarray(Image.open(path).convert('RGB').crop(box)).astype(int)
    m = COLOURS[colour](rgb[..., 0], rgb[..., 1], rgb[..., 2])
    fx = np.polyfit([p for p, v in xcal], [v for p, v in xcal], 1)
    fy = np.polyfit([p for p, v in ycal], [v for p, v in ycal], 1)
    ys, xs = np.nonzero(m)
    X, Y = np.polyval(fx, xs), np.polyval(fy, ys)
    ok = (X >= window[0]) & (X <= window[1]) & (Y >= window[2]) & (Y <= window[3])
    xs, X, Y = xs[ok], X[ok], Y[ok]
    out = []
    for x0 in range(int(xs.min()), int(xs.max()) + 1, step) if xs.size else []:
        sel = (xs >= x0) & (xs < x0 + step)
        if sel.sum() >= 3:
            out.append((float(X[sel].mean()), float(Y[sel].mean())))
    return out


if __name__ == '__main__':
    print(__doc__)
