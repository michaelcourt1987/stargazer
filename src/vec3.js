// Small vector helpers. Positions live as 3D unit vectors on the celestial
// sphere rather than as right ascension / declination pairs, which is what keeps
// constellations straddling RA 0h (Andromeda, Pisces, Cassiopeia) from being
// smeared across the sky by the coordinate wrap.

export const DEG = Math.PI / 180;

export function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Right ascension / declination in degrees to a unit vector. */
export function fromSpherical(lonDeg, latDeg) {
  const ra = lonDeg * DEG;
  const dec = latDeg * DEG;
  const cd = Math.cos(dec);
  return [cd * Math.cos(ra), cd * Math.sin(ra), Math.sin(dec)];
}

export function normalize(v) {
  const m = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
}

export function angleBetween(a, b) {
  return Math.acos(clamp(dot(a, b), -1, 1));
}

/**
 * Rotate `from` toward `to` by `angle` radians along the great circle joining
 * them. Returns `from` unchanged when the two are parallel or antipodal, where
 * the rotation plane is undefined.
 */
export function rotateToward(from, to, angle) {
  const d = dot(from, to);
  let tx = to[0] - from[0] * d;
  let ty = to[1] - from[1] * d;
  let tz = to[2] - from[2] * d;
  const n = Math.hypot(tx, ty, tz);
  if (n < 1e-9) return from.slice();
  tx /= n; ty /= n; tz /= n;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [from[0] * c + tx * s, from[1] * c + ty * s, from[2] * c + tz * s];
}

/** Shortest-path interpolation between two unit vectors. */
export function slerp(a, b, t) {
  return rotateToward(a, b, angleBetween(a, b) * t);
}
