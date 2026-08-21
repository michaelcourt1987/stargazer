# Stargazer

An interactive map of the night sky. Drag to pan across the celestial sphere, scroll to zoom,
and find any star or constellation by name.

**[Open Stargazer →](https://michaelcourt1987.github.io/stargazer/)**

- **5,044 stars** down to magnitude 6 — everything visible to the naked eye on a dark night,
  sized by brightness and coloured by real B−V index, so Betelgeuse glows orange and Rigel
  blue-white.
- **All 88 constellations** as labelled stick figures, Serpens correctly split into its two
  halves.
- **Search** any of 493 named stars or any constellation, and the view flies there.
- **Hover** a star for its proper name, Bayer or Flamsteed designation, and magnitude.

No horizon, no clock, no location — this is the whole sphere at once, to explore rather than
to match against tonight's sky.

## Running it locally

There is no build step, but the page loads its data with `fetch` and uses ES modules, so it
needs to be served over HTTP rather than opened from disk:

```bash
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

## How it works

Everything is plain ES modules and a 2D canvas — no dependencies, no bundler. The repo deploys
to GitHub Pages exactly as it sits.

| Module | Role |
| --- | --- |
| `src/camera.js` | Where the view points and how sky directions become pixels |
| `src/data.js` | Loads the catalogue into typed arrays, subdivides constellation lines |
| `src/render.js` | Draws the sky |
| `src/labels.js` | Places names without letting them collide |
| `src/interact.js` | Drag, flick, zoom, pinch, keyboard |
| `src/picking.js` | Works out what's under the cursor |
| `src/flight.js` | Animated travel between two points on the sky |

Three decisions carry most of the weight:

**Positions are 3D unit vectors, never angle pairs.** Right ascension wraps from 360° back to
0°, and constellations that straddle that seam — Andromeda, Pisces, Cassiopeia — get smeared
across the sky by any code that interpolates in raw coordinates. Converting once at load makes
the seam disappear.

**The projection is stereographic.** At the widest field the canvas corners sit past 90° from
the view centre. A gnomonic projection diverges there and folds back on itself, painting
mirrored ghost constellations inside the frame. Stereographic has no "behind the camera" at
all, and its inverse is closed-form, which is what makes zoom-to-cursor and hover picking cheap.

**Stars are drawn in batches, not one at a time.** Each star is pre-sorted into one of ~60
buckets by magnitude band and colour, and each bucket becomes a single `Path2D` and a single
fill. Frames are also drawn only when something actually changes, so an idle map costs nothing.

Two details worth knowing if you change the rendering: right ascension increases to the **left**
(a star chart is the view from inside the sphere looking out — get this backwards and the whole
sky mirrors, which is easy to miss), and near the poles drag steps are subdivided so the pitch
clamp can't be vaulted over.

## Data

Star positions, magnitudes, colours and constellation figures come from
[d3-celestial](https://github.com/ofrohn/d3-celestial) by Olaf Frohn, under the BSD 3-Clause
License, ultimately deriving from the ESA *Hipparcos* mission. See [ATTRIBUTION.md](ATTRIBUTION.md).

`tools/build_data.py` downloads and repacks the upstream files. It runs once and its output is
committed — the site never fetches anything at runtime. To rebuild:

```bash
python3 tools/build_data.py
```

## Licence

MIT for the code — see [LICENSE](LICENSE). The star data carries its own licence, reproduced in
[`data/LICENSE.d3-celestial`](data/LICENSE.d3-celestial).
