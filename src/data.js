// Loads the committed star catalogue and reshapes it for drawing: unit vectors
// in typed arrays, constellation figures subdivided into short arcs, and stars
// pre-grouped into the buckets the renderer fills in a single pass each.

import { DEG, clamp, dot, fromSpherical, normalize, slerp } from './vec3.js';

// Resolved against this module's own URL so the site works both at a domain
// root and under a GitHub Pages project path like /stargazer/.
const STARS_URL = new URL('../data/stars.json', import.meta.url);
const CONSTELLATIONS_URL = new URL('../data/constellations.json', import.meta.url);

// Straight lines drawn between distant stars visibly bow away from the true
// great circle under a stereographic projection -- up to about 11px for the
// longest segment in the data. Splitting every segment into arcs of at most 4
// degrees drops that below a third of a pixel, and as a bonus removes any need
// to clip lines against the edge of the projection.
const MAX_ARC = 4 * DEG;

// Magnitude bands, chosen finer at the faint end where the fade-out happens.
const BAND_EDGES = [-2, 1, 2.5, 3.5, 4.25, 5.0, 5.5, 6.0, 6.51];
const BV_BINS = 8;
const BV_LO = -0.4;
const BV_HI = 2.0;
const BV_DEFAULT = 0.65; // roughly the Sun; used for the two stars lacking B-V

export async function loadSky() {
  const [stars, constellations] = await Promise.all([
    fetchJSON(STARS_URL),
    fetchJSON(CONSTELLATIONS_URL),
  ]);
  return {
    stars: prepareStars(stars),
    constellations: constellations.map(prepareConstellation),
  };
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load ${url.pathname} (${res.status})`);
  return res.json();
}

function prepareStars(raw) {
  const n = raw.hip.length;
  const xyz = new Float32Array(n * 3);
  const mag = new Float32Array(n);
  const radius = new Float32Array(n);
  const bandOf = new Uint8Array(n);
  const binOf = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const v = fromSpherical(raw.ra[i], raw.dec[i]);
    xyz[i * 3] = v[0];
    xyz[i * 3 + 1] = v[1];
    xyz[i * 3 + 2] = v[2];

    const m = raw.mag[i];
    mag[i] = m;

    // Brightness scaled geometrically, not by flux. True flux scaling spans a
    // factor of thirty from Sirius to the faintest naked-eye star and looks
    // absurd; this keeps bright stars clearly dominant over a ~6x range.
    radius[i] = 0.55 * Math.pow(1.28, 6.5 - m);

    bandOf[i] = bandFor(m);
    binOf[i] = binFor(raw.bv[i]);
  }

  return {
    n,
    xyz,
    mag,
    radius,
    hip: raw.hip,
    name: raw.name,
    bayer: raw.bayer,
    flam: raw.flam,
    con: raw.con,
    buckets: buildBuckets(n, bandOf, binOf),
  };
}

function bandFor(m) {
  for (let b = 0; b < BAND_EDGES.length - 1; b++) {
    if (m < BAND_EDGES[b + 1]) return b;
  }
  return BAND_EDGES.length - 2;
}

function binFor(bv) {
  const v = clamp(typeof bv === 'number' ? bv : BV_DEFAULT, BV_LO, BV_HI);
  const t = (v - BV_LO) / (BV_HI - BV_LO);
  return clamp(Math.floor(t * BV_BINS), 0, BV_BINS - 1);
}

/**
 * Group stars by (magnitude band, colour bin) once, so each frame is a few
 * dozen batched fills rather than five thousand individual ones. That batching
 * is essentially the entire performance story of the renderer.
 */
function buildBuckets(n, bandOf, binOf) {
  const bandCount = BAND_EDGES.length - 1;
  const lists = Array.from({ length: bandCount * BV_BINS }, () => []);
  for (let i = 0; i < n; i++) {
    lists[bandOf[i] * BV_BINS + binOf[i]].push(i);
  }

  const buckets = [];
  for (let band = 0; band < bandCount; band++) {
    // Representative values for the bucket: alpha and colour are quantised per
    // bucket, but each star still gets its own exact radius.
    const magMid = (BAND_EDGES[band] + BAND_EDGES[band + 1]) / 2;
    const radiusMid = 0.55 * Math.pow(1.28, 6.5 - magMid);

    for (let bin = 0; bin < BV_BINS; bin++) {
      const indices = lists[band * BV_BINS + bin];
      if (!indices.length) continue;
      const bvMid = BV_LO + ((bin + 0.5) / BV_BINS) * (BV_HI - BV_LO);
      buckets.push({
        indices: Uint16Array.from(indices),
        radiusMid,
        rgb: bvToRGB(bvMid, magMid),
      });
    }
  }
  return buckets;
}

/**
 * Star colour from B-V index, via Ballesteros' formula for temperature and then
 * a blackbody approximation for RGB.
 *
 * The clamp on B-V matters: the formula has a pole at -0.674, and the real
 * catalogue runs out to +3.27 on a handful of deep red stars. Faint stars are
 * pushed further toward white, which matches how colour drains out of dim
 * points of light and, conveniently, also looks right.
 */
export function bvToRGB(bv, mag) {
  const b = clamp(Number.isFinite(bv) ? bv : BV_DEFAULT, BV_LO, BV_HI);
  const kelvin = 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
  const t = kelvin / 100;

  let r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  let g = t <= 66
    ? 99.4708025861 * Math.log(t) - 161.1195681661
    : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  let bl = t >= 66 ? 255 : (t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307);

  const white = clamp(0.25 + 0.11 * (mag + 1.5), 0.25, 0.85);
  return [r, g, bl].map((c) => Math.round(clamp(c + (255 - c) * white, 0, 255)));
}

function prepareConstellation(c) {
  const segments = c.lines.map((flat) => {
    const points = [];
    for (let i = 0; i < flat.length; i += 2) {
      points.push(fromSpherical(flat[i], flat[i + 1]));
    }
    return subdivide(points);
  });

  // A bounding cone, so a whole figure that is nowhere near the view can be
  // skipped with one dot product.
  const all = [];
  for (const seg of segments) {
    for (let i = 0; i < seg.length; i += 3) all.push([seg[i], seg[i + 1], seg[i + 2]]);
  }
  const centre = normalize(all.reduce(
    (acc, v) => [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]], [0, 0, 0],
  ));
  const radius = all.reduce((max, v) => Math.max(max, Math.acos(clamp(dot(centre, v), -1, 1))), 0);

  return {
    abbr: c.abbr,
    name: c.name,
    gen: c.gen,
    rank: c.rank,
    labelVec: fromSpherical(c.label[0], c.label[1]),
    segments,
    centre,
    radius,
  };
}

/** Split a polyline into arcs of at most MAX_ARC, flattened to xyz triples. */
function subdivide(points) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const steps = Math.max(1, Math.ceil(Math.acos(clamp(dot(a, b), -1, 1)) / MAX_ARC));
    for (let s = 1; s <= steps; s++) out.push(slerp(a, b, s / steps));
  }

  const flat = new Float32Array(out.length * 3);
  out.forEach((v, i) => {
    flat[i * 3] = v[0];
    flat[i * 3 + 1] = v[1];
    flat[i * 3 + 2] = v[2];
  });
  return flat;
}
