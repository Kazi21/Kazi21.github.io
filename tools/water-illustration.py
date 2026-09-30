#!/usr/bin/env python3
"""Generate the static SPC/E water illustration used in the Simulation Lab section.

Geometry (rigid SPC/E): O-H = 0.1000 nm, H-O-H = 109.47 degrees.
Scale: 40 px per 0.1 nm. Each donor hydrogen points at its acceptor oxygen,
O...O separations are 0.27-0.29 nm, so the dashed hydrogen bonds are geometrically
sensible. The output is an illustration, not a simulation frame.

Usage: python3 tools/water-illustration.py > /tmp/water.svg
(The block is pasted into tools/index.template.html by the release script.)
"""
import math

S = 40.0                      # px per 0.1 nm
OH_NM = 0.1000                # SPC/E O-H distance
ANGLE = 109.47                # SPC/E H-O-H angle
OH = OH_NM * 10 * S           # 40 px
HALF = ANGLE / 2.0
PHI_P, PHI_M = 90 - HALF, 90 + HALF   # directions of H(+) and H(-) before rotation

O = {1: (100.0, 80.0), 2: (195.0, 140.0), 3: (292.0, 84.0), 4: (230.0, 245.0)}
th32 = math.degrees(math.atan2(O[2][1] - O[3][1], O[2][0] - O[3][0]))
th35 = th32 - ANGLE
O[5] = (O[3][0] + 112 * math.cos(math.radians(th35)), O[3][1] + 112 * math.sin(math.radians(th35)))


def ang(d, a):
    return math.degrees(math.atan2(O[a][1] - O[d][1], O[a][0] - O[d][0]))


ROT = {1: ang(1, 2) - PHI_P, 2: ang(2, 4) - PHI_P, 3: th32 - PHI_M, 4: 35.0, 5: 115.0}
BONDS = [(1, 2, +1), (3, 2, -1), (2, 4, +1), (3, 5, +1)]   # donor, acceptor, which H


def hpos(i, sign):
    r = math.radians(ROT[i])
    hx, hy = sign * OH * math.sin(math.radians(HALF)), OH * math.cos(math.radians(HALF))
    return O[i][0] + hx * math.cos(r) - hy * math.sin(r), O[i][1] + hx * math.sin(r) + hy * math.cos(r)


lines, report = [], []
for d, a, sgn in BONDS:
    hx, hy = hpos(d, sgn); ox, oy = O[a]
    L = math.hypot(ox - hx, oy - hy); ux, uy = (ox - hx) / L, (oy - hy) / L
    lines.append((hx + ux * 9, hy + uy * 9, ox - ux * 15, oy - uy * 15))
    report.append(f"{d}->{a}: H...O {L / S * 0.1:.3f} nm, O...O {math.hypot(ox - O[d][0], oy - O[d][1]) / S * 0.1:.3f} nm")

hx, hy = OH * math.sin(math.radians(HALF)), OH * math.cos(math.radians(HALF))
mols = "\n".join(
    f'''          <g class="mol" transform="translate({O[i][0]:.1f},{O[i][1]:.1f}) rotate({ROT[i]:.1f})">
            <line class="bond" x1="0" y1="0" x2="{hx:.1f}" y2="{hy:.1f}"/><line class="bond" x1="0" y1="0" x2="{-hx:.1f}" y2="{hy:.1f}"/>
            <circle class="H" cx="{hx:.1f}" cy="{hy:.1f}" r="8"/><circle class="H" cx="{-hx:.1f}" cy="{hy:.1f}" r="8"/><circle class="O" cx="0" cy="0" r="14"/>
          </g>''' for i in O)
hb = "\n".join(f'            <path d="M{x1:.1f},{y1:.1f} L{x2:.1f},{y2:.1f}"/>' for x1, y1, x2, y2 in lines)
h1 = hpos(1, -1)

svg = f'''        <svg class="water-illustration" viewBox="0 0 420 340" role="img" aria-labelledby="w-title w-desc">
          <title id="w-title">Water molecules and hydrogen bonds</title>
          <desc id="w-desc">A static illustration of five SPC/E water molecules (O–H 0.1000 nm, H–O–H 109.47°) drawn to a consistent scale, connected by dashed hydrogen bonds, with a scale bar of 0.1 nanometre.</desc>
          <defs>
            <radialGradient id="gO" cx="35%" cy="35%" r="70%"><stop offset="0" stop-color="#ffb3a6"/><stop offset="1" stop-color="#d9553f"/></radialGradient>
            <radialGradient id="gH" cx="35%" cy="35%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#b9c6d3"/></radialGradient>
          </defs>
          <g class="hbonds">
{hb}
          </g>
          <!-- molecules: SPC/E O–H 0.1000 nm, H–O–H 109.47°, scale 40 px per 0.1 nm; each donor H points at its acceptor O -->
{mols}
          <text class="wl" x="70" y="62">O</text>
          <text class="wl" x="{h1[0] - 22:.0f}" y="{h1[1] + 5:.0f}">H</text>
          <text class="wl wl-hb" x="60" y="150">hydrogen bond</text>
          <text class="wl wl-hb" x="60" y="164">O···O ≈ 0.28 nm</text>
          <line class="scale" x1="40" y1="310" x2="80" y2="310"/><line class="scale" x1="40" y1="305" x2="40" y2="315"/><line class="scale" x1="80" y1="305" x2="80" y2="315"/>
          <text class="wl" x="88" y="314">0.1 nm</text>
          <text class="wl wl-note" x="410" y="326" text-anchor="end">illustration, not a trajectory</text>
        </svg>'''

if __name__ == "__main__":
    import sys
    print(svg)
    print("\n".join(report), file=sys.stderr)
