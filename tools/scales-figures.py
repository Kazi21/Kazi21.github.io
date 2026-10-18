"""Generate the 'From molecular interactions to collective transport' figures (website release 2026.2).

Writes four SVG sources in the site palette. Since release 2026.5 the default theme is light (white background);
set SCALES_THEME=dark for the original dark versions:
  across-scales.svg            main diagram, wide layout (desktop)
  across-scales-stacked.svg    main diagram, stacked layout (phones)
  across-scales-collective.svg          three pairs (ant/colony, person/community, star/galaxy), wide (optional disclosure)
  across-scales-collective-stacked.svg  the same three pairs stacked (phones)

Scales are illustrative; the figures contain no data. The PNGs served on the site were rendered from these SVGs
with the site font (IBM Plex Sans) at 2x (wide) and 3x (stacked) by a headless browser. The stacked layouts are drawn
360 units wide so that their text appears at about its nominal size (14 px body) on a phone.
Usage: python3 tools/scales-figures.py <output_dir>
"""
import math
import os
import sys

LIGHT = os.environ.get("SCALES_THEME", "light") != "dark"
if LIGHT:   # light theme (release 2026.5): text colours >= 4.5:1 on white
    BG, TEXT, MUTED, DIM = "#FFFFFF", "#243447", "#526477", "#5B6B7C"
    WALL, GRID = "#718096", "rgba(36,52,71,0.12)"
    O_RED, H_WHITE, H_EDGE = "#D0342C", "#FFFFFF", "#7A8A9B"
    AMBER, AMBER_SOFT, TEAL, AMBER_FILL = "#9A5B00", "#8A5A12", "#00897B", "rgba(154,91,0,0.08)"
    BOX = {  # stroke, fill, pill text
        "mol": ("#C2412D", "rgba(194,65,45,0.07)", "#A1301F"),
        "nano": ("#3366AA", "rgba(51,102,170,0.07)", "#2B5590"),
        "micro": ("#00796B", "rgba(0,121,107,0.07)", "#00695C"),
        "macro": ("#7B5EA7", "rgba(123,94,167,0.08)", "#674A93"),
    }
else:       # original dark theme (releases 2026.2-2026.4)
    BG, TEXT, MUTED, DIM = "#10233a", "#e9eef3", "#a7b6c6", "#7f90a3"
    WALL, GRID = "#7f90a3", "rgba(233,238,243,0.13)"
    O_RED, H_WHITE, H_EDGE = "#e03030", "#f2f4f7", None
    AMBER, AMBER_SOFT, TEAL, AMBER_FILL = "#f2b950", "#e8c98c", "#62d6c2", "rgba(242,185,80,0.10)"
    BOX = {  # stroke, fill, pill text
        "mol": ("#ff7b6b", "rgba(224,48,48,0.10)", "#ff9c8f"),
        "nano": ("#8fb4ea", "rgba(143,180,234,0.10)", "#b3cdf3"),
        "micro": ("#62d6c2", "rgba(98,214,194,0.09)", "#86e3d3"),
        "macro": ("#b39ddb", "rgba(179,157,219,0.11)", "#cdbcec"),
    }
FONT = "IBM Plex Sans, 'Segoe UI', Roboto, Arial, sans-serif"


def t(x, y, s, size=14, fill=TEXT, weight=400, anchor="middle", extra=""):
    s = s.replace("&", "&amp;").replace("<", "&lt;")
    return f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}" {extra}>{s}</text>'


def arrow_head(x, y, ang, size, fill):
    """Filled triangle with its tip at (x, y), pointing along angle ang (radians)."""
    a1, a2 = ang + math.pi - 0.42, ang + math.pi + 0.42
    p = [(x, y), (x + size * math.cos(a1), y + size * math.sin(a1)), (x + size * math.cos(a2), y + size * math.sin(a2))]
    return '<path d="M{:.1f},{:.1f} L{:.1f},{:.1f} L{:.1f},{:.1f} Z" fill="{}"/>'.format(*p[0], *p[1], *p[2], fill)


def line_arrow(x1, y1, x2, y2, color, width=2.5, head=10, dash=""):
    ang = math.atan2(y2 - y1, x2 - x1)
    bx, by = x2 - 0.8 * head * math.cos(ang), y2 - 0.8 * head * math.sin(ang)
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return (f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{bx:.1f}" y2="{by:.1f}" stroke="{color}" stroke-width="{width}"{d}/>'
            + arrow_head(x2, y2, ang, head, color))


def water(cx, cy, s=1.0, rot=0.0, alpha=1.0):
    """Water molecule: red O and two white H at 104.5 degrees (rot in degrees, 0 = hydrogens pointing down)."""
    out = []
    r_o, r_h, d = 17 * s, 9 * s, 24 * s
    for sign in (-1, 1):
        a = math.radians(90 + rot + sign * 52.25)
        edge = f' stroke="{H_EDGE}" stroke-width="{1.3 * s:.2f}"' if H_EDGE else ""
        out.append(f'<circle cx="{cx + d * math.cos(a):.1f}" cy="{cy + d * math.sin(a):.1f}" r="{r_h:.1f}" fill="{H_WHITE}" fill-opacity="{alpha}"{edge}/>')
    out.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r_o:.1f}" fill="{O_RED}" fill-opacity="{alpha}"/>')
    return "".join(out)


def h_positions(cx, cy, s, rot):
    d = 24 * s
    return [(cx + d * math.cos(math.radians(90 + rot + sg * 52.25)), cy + d * math.sin(math.radians(90 + rot + sg * 52.25))) for sg in (-1, 1)]


def picto_molecule(cx, cy, k=1.0):
    """A water molecule hydrogen-bonded to two neighbours, with faint thermal-motion arcs."""
    out = []
    n1, n2 = (cx - 52 * k, cy + 30 * k), (cx + 54 * k, cy + 24 * k)
    h = h_positions(cx, cy, k, 0)
    for (hx, hy), (nx, ny) in zip(h, (n1, n2)):
        out.append(f'<line x1="{hx:.1f}" y1="{hy:.1f}" x2="{nx:.1f}" y2="{ny:.1f}" stroke="{DIM}" stroke-width="{1.6 * k:.2f}" stroke-dasharray="{3 * k:.1f} {3 * k:.1f}"/>')
    out.append(water(n1[0], n1[1], 0.55 * k, 160, 0.6))
    out.append(water(n2[0], n2[1], 0.55 * k, -150, 0.6))
    for side in (-1, 1):
        for i, rr in enumerate((40, 50)):
            x0 = cx + side * rr * k
            out.append(f'<path d="M{x0:.1f},{cy - (24 - 6 * i) * k:.1f} Q{x0 + side * 7 * k:.1f},{cy - (8 - 4 * i) * k:.1f} {x0:.1f},{cy + (6 - 2 * i) * k:.1f}" '
                       f'fill="none" stroke="{DIM}" stroke-opacity="0.55" stroke-width="{1.6 * k:.2f}" stroke-linecap="round"/>')
    out.append(water(cx, cy - 6 * k, k, 0))
    return "".join(out)


def picto_nano(x0, x1, y_top, y_bot, k=1.0):
    """Two walls with two packed layers of water (layering near the walls)."""
    out = [f'<line x1="{x0}" y1="{y_top}" x2="{x1}" y2="{y_top}" stroke="{WALL}" stroke-width="{5 * k:.1f}" stroke-linecap="round"/>',
           f'<line x1="{x0}" y1="{y_bot}" x2="{x1}" y2="{y_bot}" stroke="{WALL}" stroke-width="{5 * k:.1f}" stroke-linecap="round"/>']
    n = 6
    step = (x1 - x0 - 24 * k) / (n - 1)
    rots = [10, -25, 40, -5, 25, -35, 15, -15, 30, -30, 5, 20]
    for row, y in enumerate((y_top + (y_bot - y_top) * 0.27, y_bot - (y_bot - y_top) * 0.27)):
        for i in range(n):
            x = x0 + 12 * k + i * step + (step / 2 if row else 0) * 0.0
            out.append(water(x, y, 0.33 * k, (180 if row == 0 else 0) + rots[(i + 6 * row) % len(rots)]))
    return "".join(out)


def picto_micro(x0, x1, y_top, y_bot, gid, k=1.0):
    """Averaged field between walls with a parabolic velocity profile."""
    yc, half = (y_top + y_bot) / 2, (y_bot - y_top) / 2
    out = [f'<rect x="{x0}" y="{y_top + 2}" width="{x1 - x0}" height="{y_bot - y_top - 4}" fill="url(#{gid})"/>',
           f'<line x1="{x0}" y1="{y_top}" x2="{x1}" y2="{y_top}" stroke="{WALL}" stroke-width="{5 * k:.1f}" stroke-linecap="round"/>',
           f'<line x1="{x0}" y1="{y_bot}" x2="{x1}" y2="{y_bot}" stroke="{WALL}" stroke-width="{5 * k:.1f}" stroke-linecap="round"/>']
    xb = x0 + 14 * k
    lmax = (x1 - x0) * 0.72
    out.append(f'<line x1="{xb:.1f}" y1="{y_top + 4}" x2="{xb:.1f}" y2="{y_bot - 4}" stroke="{DIM}" stroke-width="1.2" stroke-dasharray="3 3"/>')
    for f in (-0.66, -0.33, 0.0, 0.33, 0.66):
        y = yc + f * half
        L = lmax * (1 - f * f)
        out.append(line_arrow(xb, y, xb + L, y, TEAL, width=1.8 * k, head=7 * k))
    pts = " ".join(f"{xb + lmax * (1 - (u / 20) ** 2):.1f},{yc + (u / 20) * half:.1f}" for u in range(-20, 21))
    out.append(f'<polyline points="{pts}" fill="none" stroke="{TEAL}" stroke-width="{2.4 * k:.1f}"/>')
    return "".join(out)


def picto_macro(x0, x1, y_top, y_bot, k=1.0):
    """CFD mesh with streamlines around a cylinder."""
    out = [f'<rect x="{x0}" y="{y_top}" width="{x1 - x0}" height="{y_bot - y_top}" fill="none" stroke="{WALL}" stroke-width="1.4"/>']
    nx = 11
    for i in range(1, nx + 1):
        x = x0 + i * (x1 - x0) / (nx + 1)
        out.append(f'<line x1="{x:.1f}" y1="{y_top}" x2="{x:.1f}" y2="{y_bot}" stroke="{GRID}" stroke-width="1"/>')
    for f in (0.08, 0.17, 0.3, 0.43, 0.57, 0.7, 0.83, 0.92):
        y = y_top + f * (y_bot - y_top)
        out.append(f'<line x1="{x0}" y1="{y:.1f}" x2="{x1}" y2="{y:.1f}" stroke="{GRID}" stroke-width="1"/>')
    cx, cy = x0 + 0.34 * (x1 - x0), (y_top + y_bot) / 2
    hh = (y_bot - y_top) / 2
    for f in (-0.8, -0.48, -0.2, 0.2, 0.48, 0.8):
        y0 = cy + f * hh
        s = 1 if f > 0 else -1
        kk = max(0.0, 0.38 - abs(f) * 0.32) * hh
        out.append(f'<path d="M{x0},{y0:.1f} C{cx - 0.5 * (cx - x0):.1f},{y0:.1f} {cx - 12 * k:.1f},{y0 + s * kk:.1f} {cx:.1f},{y0 + s * kk:.1f} '
                   f'S{cx + 0.45 * (x1 - cx):.1f},{y0:.1f} {x1},{y0:.1f}" fill="none" stroke="{MACRO_STROKE}" stroke-width="{2 * k:.1f}"/>')
    out.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{11 * k:.1f}" fill="{WALL}"/>')
    return "".join(out)


MACRO_STROKE = BOX["macro"][0]


def bridge_glyph(cx, cy, r, k=1.0):
    """Circle with an ensemble-average bracket around three molecules."""
    w = 2.4 * k
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{AMBER_FILL}" stroke="{AMBER}" stroke-width="{2.6 * k:.1f}"/>'
            f'<polyline points="{cx - 14 * k:.1f},{cy - 15 * k:.1f} {cx - 24 * k:.1f},{cy:.1f} {cx - 14 * k:.1f},{cy + 15 * k:.1f}" fill="none" stroke="{AMBER}" stroke-width="{w:.1f}" stroke-linejoin="round" stroke-linecap="round"/>'
            f'<polyline points="{cx + 14 * k:.1f},{cy - 15 * k:.1f} {cx + 24 * k:.1f},{cy:.1f} {cx + 14 * k:.1f},{cy + 15 * k:.1f}" fill="none" stroke="{AMBER}" stroke-width="{w:.1f}" stroke-linejoin="round" stroke-linecap="round"/>'
            + "".join(f'<circle cx="{cx + dx * k:.1f}" cy="{cy:.1f}" r="{2.8 * k:.1f}" fill="{AMBER}"/>' for dx in (-8, 0, 8)))


def defs():
    return (f'<defs><linearGradient id="fg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{TEAL}" stop-opacity="0"/>'
            f'<stop offset="0.5" stop-color="{TEAL}" stop-opacity="{0.16 if LIGHT else 0.26}"/><stop offset="1" stop-color="{TEAL}" stop-opacity="0"/></linearGradient></defs>')


def pill(cx, y, label, key, anchor="middle", size=12.5):
    stroke, _, txt = BOX[key]
    w = 13 + 0.584 * size * len(label)
    h = 22 + (size - 12.5) * 1.6
    x = cx - w / 2 if anchor == "middle" else cx
    tx = cx if anchor == "middle" else cx + w / 2
    return (f'<rect x="{x:.1f}" y="{y}" width="{w:.1f}" height="{h:.1f}" rx="{h / 2:.1f}" fill="{BG}" stroke="{stroke}" stroke-width="1.2"/>'
            + t(tx, y + h / 2 + size * 0.36, label, size, txt, 600))


SCALES = [  # key, pill, title, body lines
    ("mol", "~0.3 nm", "Molecule", ["thermal motion governed", "by molecular interactions"]),
    ("nano", "sub-nm to 10 nm", "Nanoconfinement", ["packing, correlations and", "the wall shape transport"]),
    ("micro", "µm to mm", "Microflow", ["averaged fields with tested", "constitutive relations"]),
    ("macro", "mm to m", "Macroflow", ["CFD solves flows", "in real devices"]),
]
TITLE = "From molecular interactions to collective transport"
DESC = ("Four illustrative length scales from left to right: a single water molecule whose thermal motion is governed by its "
        "interactions with neighbours; nanoscale confinement, including subnanometre channels, where molecular packing, "
        "correlations and the wall shape transport; microflow, described by averaged fields with tested constitutive relations; "
        "and macroflow, where computational fluid dynamics solves flows in real devices. Molecular simulation covers the first two "
        "scales and continuum modelling the last two. Between them, statistical mechanics and physical closures, with "
        "physics-constrained learning as one method, carry molecular information to the continuum, and a return arrow shows "
        "that every closure is validated against molecular evidence.")


def svg_open(w, h, title, desc):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" font-family="{FONT}" role="img" aria-labelledby="t d">'
            f'<title id="t">{title}</title><desc id="d">{desc}</desc><rect width="{w}" height="{h}" fill="{BG}"/>' + defs())


def main_wide():
    W, H = 1200, 424
    o = [svg_open(W, H, TITLE, DESC)]
    # length-scale axis
    o.append(line_arrow(24, 30, 1176, 30, DIM, width=1.4, head=9))
    o.append(f'<rect x="508" y="20" width="184" height="20" fill="{BG}"/>' + t(600, 35, "increasing length scale", 13, DIM))
    xs = {"mol": 24, "nano": 256, "micro": 728, "macro": 960}
    bw, y0, bh = 216, 52, 248
    for key, pl, title, body in SCALES:
        x = xs[key]
        stroke, fill, _ = BOX[key]
        cx = x + bw / 2
        o.append(f'<rect x="{x}" y="{y0}" width="{bw}" height="{bh}" rx="14" fill="{fill}" stroke="{stroke}" stroke-opacity="0.7" stroke-width="1.4"/>')
        o.append(pill(cx, 64, pl, key))
        o.append(t(cx, 118, title, 20, TEXT, 600))
        for i, line in enumerate(body):
            o.append(t(cx, 254 + 20 * i, line, 14, MUTED))
    o.append(picto_molecule(132, 186))
    o.append(picto_nano(272, 456, 150, 216))
    o.append(picto_micro(744, 928, 150, 216, "fg"))
    o.append(picto_macro(980, 1156, 146, 222))
    # bridge
    o.append(t(600, 104, "Statistical mechanics", 17, TEXT, 600))
    o.append(t(600, 126, "and physical closures", 17, TEXT, 600))
    o.append(bridge_glyph(600, 184, 40))
    o.append(line_arrow(478, 184, 556, 184, AMBER, 3, 11))
    o.append(line_arrow(644, 184, 722, 184, AMBER, 3, 11))
    o.append(t(600, 252, "physics-constrained", 14, AMBER_SOFT))
    o.append(t(600, 271, "learning", 14, AMBER_SOFT))
    # validation return path
    o.append(f'<path d="M790,300 L790,330 L410,330 L410,312" fill="none" stroke="{TEAL}" stroke-width="2" stroke-dasharray="6 5"/>')
    o.append(arrow_head(410, 302, -math.pi / 2, 10, TEAL))
    o.append(t(600, 352, "validate against molecular evidence", 14, TEAL, 500))
    # method brackets
    o.append(f'<path d="M32,368 L32,378 L464,378 L464,368" fill="none" stroke="{MUTED}" stroke-width="1.4"/>' + t(248, 404, "Molecular simulation", 16, TEXT, 600))
    o.append(f'<path d="M736,368 L736,378 L1168,378 L1168,368" fill="none" stroke="{MUTED}" stroke-width="1.4"/>' + t(952, 404, "Continuum modelling and CFD", 16, TEXT, 600))
    o.append("</svg>")
    return "".join(o)


def main_stacked():
    """Phone layout: 360 units wide so labels render near 1:1 (14 px body text) on a ~358 px wide column."""
    W, H = 360, 718
    o = [svg_open(W, H, TITLE, DESC)]
    o.append(t(12, 22, "MOLECULAR SIMULATION", 12.5, DIM, 600, "start", 'letter-spacing="1"'))
    ys = {"mol": 32, "nano": 162, "micro": 458, "macro": 588}
    bw, bh, x, tx = 336, 120, 12, 112
    for key, pl, title, body in SCALES:
        y = ys[key]
        stroke, fill, _ = BOX[key]
        o.append(f'<rect x="{x}" y="{y}" width="{bw}" height="{bh}" rx="12" fill="{fill}" stroke="{stroke}" stroke-opacity="0.7" stroke-width="1.3"/>')
        o.append(pill(tx, y + 11, pl, key, anchor="start", size=13.5))
        o.append(t(tx, y + 58, title, 18, TEXT, 600, "start"))
        for i, line in enumerate(body):
            o.append(t(tx, y + 82 + 18 * i, line, 14, MUTED, 400, "start"))
    o.append(picto_molecule(60, ys["mol"] + 66, 0.6))
    o.append(picto_nano(22, 100, ys["nano"] + 36, ys["nano"] + 86, 0.52))
    o.append(picto_micro(22, 100, ys["micro"] + 36, ys["micro"] + 86, "fg", 0.6))
    o.append(picto_macro(20, 102, ys["macro"] + 34, ys["macro"] + 88, 0.6))
    # bridge block between the molecular and continuum groups
    cy = 352
    o.append(bridge_glyph(58, cy, 28, 0.7))
    o.append(line_arrow(58, 286, 58, cy - 32, AMBER, 2.6, 10))
    o.append(line_arrow(58, cy + 32, 58, 454, AMBER, 2.6, 10))
    o.append(t(tx, cy - 12, "Statistical mechanics", 16, TEXT, 600, "start"))
    o.append(t(tx, cy + 8, "and physical closures", 16, TEXT, 600, "start"))
    o.append(t(tx, cy + 30, "physics-constrained learning", 14, AMBER_SOFT, 400, "start"))
    o.append(f'<path d="M350,458 L350,290" fill="none" stroke="{TEAL}" stroke-width="2" stroke-dasharray="6 5"/>' + arrow_head(350, 286, -math.pi / 2, 9, TEAL))
    o.append(t(340, 404, "validate against", 13.5, TEAL, 500, "end"))
    o.append(t(340, 421, "molecular evidence", 13.5, TEAL, 500, "end"))
    o.append(t(80, 446, "CONTINUUM MODELLING AND CFD", 12.5, DIM, 600, "start", 'letter-spacing="1"'))
    o.append("</svg>")
    return "".join(o)


# ---------------------------------------------------------------- optional disclosure: three pairs
import random

if LIGHT:
    HI, MID, LO = "#526477", "#7A8A9B", "#A3B0BD"
    ANT = "#9C5A2B"
    STAR, STAR_WARM, GAL1, GAL2 = "#3B4A5C", "#B07A1E", "#5B6B7C", "#3366AA"
else:
    HI, MID, LO = "#a7b6c6", "#7f90a3", "#5f7187"
    ANT = "#d29a6c"
    STAR, STAR_WARM, GAL1, GAL2 = "#f2f4f7", "#f4e2b0", "#c9d6e3", "#8fb4ea"


def person(cx, base, s, fill):
    return (f'<circle cx="{cx:.1f}" cy="{base - 29 * s:.1f}" r="{9.5 * s:.1f}" fill="{fill}"/>'
            f'<path d="M{cx - 15 * s:.1f},{base:.1f} L{cx - 15 * s:.1f},{base - 9 * s:.1f} Q{cx - 15 * s:.1f},{base - 18.5 * s:.1f} {cx:.1f},{base - 18.5 * s:.1f} '
            f'Q{cx + 15 * s:.1f},{base - 18.5 * s:.1f} {cx + 15 * s:.1f},{base - 9 * s:.1f} L{cx + 15 * s:.1f},{base:.1f} Z" fill="{fill}"/>')


def ant(cx, cy, deg, s, color=ANT, alpha=1.0):
    """An ant pointing along deg (0 = +x): abdomen, petiole, thorax, head, six legs, two antennae."""
    legs = "".join(f'<path d="M{x0},0 L{x0 + dx},{sg * 4.5} L{x0 + dx2},{sg * 9.5}" fill="none" stroke="{color}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>'
                   for x0, dx, dx2 in ((-1, -2.5, -6), (1, 0.5, 0), (3, 3.5, 7)) for sg in (-1, 1))
    ants = "".join(f'<path d="M10.5,{sg * 1.2} L14.5,{sg * 5.5} L17.5,{sg * 5}" fill="none" stroke="{color}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>' for sg in (-1, 1))
    body = (f'<ellipse cx="-11" cy="0" rx="7" ry="5" fill="{color}"/><circle cx="-3.6" cy="0" r="1.6" fill="{color}"/>'
            f'<ellipse cx="1" cy="0" rx="4.6" ry="3" fill="{color}"/><ellipse cx="8" cy="0" rx="3.6" ry="3.2" fill="{color}"/>')
    return f'<g transform="translate({cx:.1f},{cy:.1f}) rotate({deg:.1f}) scale({s:.3f})" opacity="{alpha}">{legs}{ants}{body}</g>'


def colony(cx, cy, w, k=1.0, seed=3):
    """Ants following a curved trail (a collective path no single ant plans)."""
    rnd = random.Random(seed)
    o = []
    pts = [(cx - w / 2 + w * u / 60, cy + 0.22 * w * math.sin(2 * math.pi * (u / 60) * 0.9 + 0.4)) for u in range(61)]
    o.append('<polyline points="' + " ".join(f"{x:.1f},{y:.1f}" for x, y in pts) + f'" fill="none" stroke="{MID}" stroke-opacity="0.45" stroke-width="{7 * k:.1f}" stroke-linecap="round"/>')
    for i in range(3, 60, 5):
        (x0, y0), (x1, y1) = pts[i - 1], pts[i + 1]
        ang = math.degrees(math.atan2(y1 - y0, x1 - x0))
        o.append(ant(pts[i][0] + rnd.uniform(-2, 2) * k, pts[i][1] + rnd.uniform(-3, 3) * k, ang + rnd.uniform(-12, 12), 0.62 * k))
    for _ in range(3):
        o.append(ant(cx + rnd.uniform(-0.45, 0.45) * w, cy + rnd.uniform(0.32, 0.42) * w * rnd.choice((-1, 1)), rnd.uniform(0, 360), 0.55 * k, alpha=0.7))
    return "".join(o)


def crowd(cx, base, w, k=1.0, seed=5):
    """A community: many people, a few highlighted, arranged loosely in rows."""
    rnd = random.Random(seed)
    o = []
    rows = 4
    for r in range(rows):
        n = 7 if r % 2 == 0 else 6
        for i in range(n):
            x = cx + (i - (n - 1) / 2) * (w / 7) + rnd.uniform(-3, 3) * k
            y = base - (rows - 1 - r) * 15 * k + rnd.uniform(-2, 2) * k
            col = [LO, MID, MID, HI][r] if rnd.random() > 0.12 else TEAL
            o.append(person(x, y, (0.34 + 0.05 * r) * k, col))
    return "".join(o)


def sparkle(cx, cy, r, color=STAR):
    return (f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r * 0.9:.1f}" fill="{color}" fill-opacity="0.10"/>'
            f'<path d="M{cx:.1f},{cy - r:.1f} Q{cx:.1f},{cy:.1f} {cx + r:.1f},{cy:.1f} Q{cx:.1f},{cy:.1f} {cx:.1f},{cy + r:.1f} '
            f'Q{cx:.1f},{cy:.1f} {cx - r:.1f},{cy:.1f} Q{cx:.1f},{cy:.1f} {cx:.1f},{cy - r:.1f} Z" fill="{color}"/>')


def galaxy(cx, cy, R, k=1.0, seed=7, gid="core"):
    """Two-armed spiral of stars around a bright core."""
    rnd = random.Random(seed)
    o = [f'<defs><radialGradient id="{gid}"><stop offset="0" stop-color="{STAR_WARM}" stop-opacity="0.95"/>'
         f'<stop offset="0.35" stop-color="{STAR_WARM}" stop-opacity="0.35"/><stop offset="1" stop-color="{STAR_WARM}" stop-opacity="0"/></radialGradient></defs>',
         f'<ellipse cx="{cx:.1f}" cy="{cy:.1f}" rx="{R * 0.36:.1f}" ry="{R * 0.26:.1f}" fill="url(#{gid})"/>']
    for arm in (0, math.pi):
        for i in range(140):
            th = 0.2 + i * 0.06
            r = R * 0.12 * math.exp(0.30 * th)
            if r > R:
                break
            a = th + arm + rnd.uniform(-0.10, 0.10)
            rr = r * rnd.uniform(0.94, 1.06)
            x, y = cx + rr * math.cos(a), cy + 0.62 * rr * math.sin(a)
            o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{max(0.8, 2.6 - 1.6 * r / R) * k:.2f}" fill="{rnd.choice((STAR, STAR, GAL1, GAL2))}" fill-opacity="{0.95 - 0.45 * r / R:.2f}"/>')
    for _ in range(26):
        a, r = rnd.uniform(0, 2 * math.pi), R * math.sqrt(rnd.random())
        o.append(f'<circle cx="{cx + r * math.cos(a):.1f}" cy="{cy + 0.62 * r * math.sin(a):.1f}" r="{0.8 * k:.2f}" fill="{STAR}" fill-opacity="0.45"/>')
    return "".join(o)


COL_TITLE = "From individuals to collective patterns"
COL_DESC = ("Three pairs drawn at increasing scale: a single ant and a colony following a trail; a single person and a community; "
            "a single star and a spiral galaxy. Collective patterns require different descriptions.")
PAIRS = ("an ant to a colony", "a person to a community", "a star to a galaxy")


def pair_art(i, single_x, coll_x, cy, k, gid):
    if i == 0:
        return ant(single_x, cy, -20, 1.5 * k) + colony(coll_x, cy, 150 * k, k)
    if i == 1:
        return person(single_x, cy + 22 * k, 1.05 * k, HI) + crowd(coll_x, cy + 26 * k, 150 * k, k)
    return sparkle(single_x, cy, 16 * k, STAR_WARM) + galaxy(coll_x, cy, 96 * k, k, gid=gid)


def collective_wide():
    W, H = 1200, 270
    o = [svg_open(W, H, COL_TITLE, COL_DESC)]
    for i, c in enumerate((200, 600, 1000)):
        cy = 108
        o.append(pair_art(i, c - 128, c + 62, cy, 1.0, f"core{i}"))
        o.append(line_arrow(c - 96, cy, c - 44, cy, DIM, 1.6, 8))
        o.append(t(c, 208, PAIRS[i], 16, MUTED))
    o.append(t(600, 250, "Collective patterns require different descriptions.", 16, TEXT, 500))
    o.append("</svg>")
    return "".join(o)


def collective_stacked():
    W, H = 360, 560
    o = [svg_open(W, H, COL_TITLE, COL_DESC)]
    for i in range(3):
        y0 = 16 + i * 170
        cy = y0 + 66
        o.append(pair_art(i, 52, 236, cy, 0.86, f"core{i}"))
        o.append(line_arrow(86, cy, 128, cy, DIM, 1.6, 8))
        o.append(t(180, y0 + 150, PAIRS[i], 15, MUTED))
    o.append(t(180, 546, "Collective patterns require different descriptions.", 12.5, TEXT, 500))
    o.append("</svg>")
    return "".join(o)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out, exist_ok=True)
    for name, fn in (("across-scales", main_wide), ("across-scales-stacked", main_stacked),
                     ("across-scales-collective", collective_wide), ("across-scales-collective-stacked", collective_stacked)):
        with open(os.path.join(out, name + ".svg"), "w", encoding="utf-8") as fh:
            fh.write(fn())
        print("wrote", os.path.join(out, name + ".svg"))
