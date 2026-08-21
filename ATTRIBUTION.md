# Attribution

## Star and constellation data

The files in `data/` are derived from **[d3-celestial](https://github.com/ofrohn/d3-celestial)**
by Olaf Frohn, used under the BSD 3-Clause License. The full license text is reproduced verbatim
in [`data/LICENSE.d3-celestial`](data/LICENSE.d3-celestial).

> Copyright (c) 2015, Olaf Frohn. All rights reserved.

Pinned upstream commit: `7e720a3de062059d4c5400a379146a601d9010e0`

Source files used:

| Upstream file | Used for |
| --- | --- |
| `data/stars.6.json` | Star positions, magnitudes, B−V colour indices (5,044 stars to magnitude 6) |
| `data/starnames.json` | Proper names, Bayer letters, Flamsteed numbers |
| `data/constellations.lines.json` | Constellation stick-figure line segments |
| `data/constellations.json` | Constellation names, Latin genitives, label positions |

`tools/build_data.py` downloads these, merges and repacks them into `data/stars.json` and
`data/constellations.json`, and drops fields this site doesn't use. It runs once; its output is
committed. No data is fetched at runtime.

## Underlying catalogues

Olaf Frohn's data derives in turn from:

- **XHIP: An Extended Hipparcos Compilation** — Anderson & Francis (2012), VizieR V/137D.
  Built on the ESA *Hipparcos* astrometric mission.
- **IAU constellation figures** — the official 88 constellations, with stick-figure line
  choices by Olaf Frohn.
- Star name cross-indices from Kostjuk, Smith, the General Catalogue of Variable Stars, and
  the Gliese catalogue.

## Note on endorsement

Clause 3 of the BSD 3-Clause License means neither Olaf Frohn nor the d3-celestial contributors
endorse this project. Stargazer uses their data; it is not affiliated with or endorsed by them.
