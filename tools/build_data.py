#!/usr/bin/env python3
"""One-time build of stargazer's star data. Run it, commit the output, forget it.

Downloads the star catalogue and constellation figures from d3-celestial
(BSD-3-Clause, (c) 2015 Olaf Frohn) and repacks them into two compact JSON files
that the site loads directly. Nothing here runs at deploy time.

    python3 tools/build_data.py

Writes data/stars.json and data/constellations.json. Downloads are cached in
tools/.cache/ so re-runs are instant.

Source coordinates are [lon, lat] where lat is declination in degrees and lon is
right ascension in degrees wrapped to -180..180. Epoch J2000. We keep that
convention as-is; the renderer converts to 3D unit vectors at load.
"""

import json
import math
import os
import sys
import urllib.request

# Pinned so the data is reproducible. Bump deliberately, never silently.
COMMIT = "7e720a3de062059d4c5400a379146a601d9010e0"
BASE = "https://raw.githubusercontent.com/ofrohn/d3-celestial/%s/data/" % COMMIT

FILES = ["stars.6.json", "constellations.lines.json", "constellations.json", "starnames.json"]

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "tools", ".cache")
OUT = os.path.join(ROOT, "data")

# starnames.json carries a translated name per language plus cross-catalogue ids
# we have no use for. Everything not listed here is dropped.
NAME_KEEP = ("name", "bayer", "flam", "c")


def fetch(filename):
    """Download filename unless it's already cached."""
    path = os.path.join(CACHE, filename)
    if not os.path.exists(path):
        os.makedirs(CACHE, exist_ok=True)
        sys.stderr.write("fetching %s ... " % filename)
        sys.stderr.flush()
        with urllib.request.urlopen(BASE + filename, timeout=60) as r:
            body = r.read()
        with open(path, "wb") as f:
            f.write(body)
        sys.stderr.write("%d bytes\n" % len(body))
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def to_vec(lon, lat):
    """Unit vector, for angular comparisons that must not care about the RA wrap."""
    ra, dec = math.radians(lon), math.radians(lat)
    return (math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec))


def angle_between(a, b):
    d = max(-1.0, min(1.0, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
    return math.acos(d)


def build_stars(stars_raw, names_raw):
    """Parallel arrays, sorted brightest first.

    Sorting by magnitude means a zoom-dependent star limit is a single array
    slice, and label importance is just array order.
    """
    rows = []
    for f in stars_raw["features"]:
        hip = f["id"]
        lon, lat = f["geometry"]["coordinates"]
        props = f["properties"]

        # bv is a string in the source and empty for a couple of stars. Left as
        # None here; the renderer substitutes a sun-like default.
        try:
            bv = float(props.get("bv", ""))
        except (TypeError, ValueError):
            bv = None

        n = names_raw.get(str(hip), {})
        rows.append({
            "hip": hip,
            "ra": round(lon, 4),
            "dec": round(lat, 4),
            "mag": round(float(props["mag"]), 2),
            "bv": None if bv is None else round(bv, 3),
            "name": n.get("name", "") or "",
            "bayer": n.get("bayer", "") or "",
            "flam": n.get("flam", "") or "",
            "con": n.get("c", "") or "",
        })

    rows.sort(key=lambda r: r["mag"])
    return {k: [r[k] for r in rows] for k in
            ("hip", "ra", "dec", "mag", "bv", "name", "bayer", "flam", "con")}


def build_constellations(lines_raw, meta_raw):
    """Merge stick figures with their labels.

    Serpens is the awkward case: it occupies two disjoint regions of sky (Caput
    and Cauda, split by Ophiuchus) and appears TWICE in both source files. Keying
    by abbreviation would silently drop half of it, so this returns a list and
    pairs duplicate entries by proximity.
    """
    by_abbr = {}
    for f in lines_raw["features"]:
        by_abbr.setdefault(f["id"], {"lines": [], "meta": []})["lines"].append(f)
    for f in meta_raw["features"]:
        by_abbr.setdefault(f["id"], {"lines": [], "meta": []})["meta"].append(f)

    out = []
    for abbr in sorted(by_abbr):
        entry = by_abbr[abbr]
        line_feats, meta_feats = entry["lines"], entry["meta"]
        if not line_feats or not meta_feats:
            sys.stderr.write("warning: %s has lines=%d meta=%d, skipping\n"
                             % (abbr, len(line_feats), len(meta_feats)))
            continue

        # Pair each figure with its nearest label. One-to-one for all but Serpens.
        remaining = list(meta_feats)
        for lf in line_feats:
            verts = [pt for seg in lf["geometry"]["coordinates"] for pt in seg]
            cx = sum(to_vec(*p)[0] for p in verts) / len(verts)
            cy = sum(to_vec(*p)[1] for p in verts) / len(verts)
            cz = sum(to_vec(*p)[2] for p in verts) / len(verts)
            norm = math.sqrt(cx * cx + cy * cy + cz * cz) or 1.0
            centroid = (cx / norm, cy / norm, cz / norm)

            mf = min(remaining, key=lambda m: angle_between(
                centroid, to_vec(*m["geometry"]["coordinates"])))
            if len(remaining) > 1:
                remaining.remove(mf)

            props = mf["properties"]
            out.append({
                "abbr": abbr,
                "name": props.get("name", abbr),
                "gen": props.get("gen", ""),
                "rank": int(props.get("rank", "3") or 3),
                "label": [round(c, 4) for c in mf["geometry"]["coordinates"]],
                "lines": [[round(c, 4) for pt in seg for c in pt]
                          for seg in lf["geometry"]["coordinates"]],
            })

    # Both Serpens halves are just named "Serpens" upstream. Caput is the head
    # (lower RA), Cauda the tail. Disambiguating makes the labels honest.
    serpens = [c for c in out if c["abbr"] == "Ser"]
    if len(serpens) == 2:
        serpens.sort(key=lambda c: (c["label"][0] + 360) % 360)
        serpens[0]["name"] = "Serpens Caput"
        serpens[1]["name"] = "Serpens Cauda"

    return out


def main():
    raw = {name: fetch(name) for name in FILES}

    stars = build_stars(raw["stars.6.json"], raw["starnames.json"])
    constellations = build_constellations(
        raw["constellations.lines.json"], raw["constellations.json"])

    os.makedirs(OUT, exist_ok=True)
    for filename, payload in (("stars.json", stars), ("constellations.json", constellations)):
        path = os.path.join(OUT, filename)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)
        sys.stderr.write("wrote %s (%d bytes)\n" % (path, os.path.getsize(path)))

    named = sum(1 for n in stars["name"] if n)
    bayer = sum(1 for b in stars["bayer"] if b)
    segments = sum(len(c["lines"]) for c in constellations)
    sys.stderr.write(
        "\n%d stars (%d named, %d with Bayer letters)\n"
        "%d constellation figures, %d line segments\n"
        "brightest: %s at mag %s\n"
        % (len(stars["hip"]), named, bayer, len(constellations), segments,
           stars["name"][0] or stars["hip"][0], stars["mag"][0]))


if __name__ == "__main__":
    main()
