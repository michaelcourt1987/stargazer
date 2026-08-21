// Hit testing against whatever was last drawn.
//
// No spatial index: the renderer already leaves projected positions in typed
// arrays, and a linear scan over five thousand of them costs a fraction of a
// millisecond -- far less than maintaining a quadtree across every pan.

import { DEG, clamp, dot } from './vec3.js';

const REF_FOV = 60 * DEG;

/** Nearest star to a canvas point, or -1. Coordinates are in CSS pixels. */
export function pickStar(renderer, x, y) {
  const { px, py, visible, sky, camera } = renderer;
  const { n, radius } = sky.stars;
  const boost = Math.pow(REF_FOV / camera.fov, 0.28);

  let best = -1;
  let bestDistance = Infinity;

  for (let i = 0; i < n; i++) {
    if (!visible[i]) continue;
    const dx = px[i] - x;
    const dy = py[i] - y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= bestDistance) continue;
    // Generous around bright stars, still forgiving around faint ones.
    const reach = Math.max(9, radius[i] * boost * 2.5);
    if (d2 < reach * reach) {
      bestDistance = d2;
      best = i;
    }
  }
  return best;
}

/**
 * Constellation whose figure passes nearest a canvas point, or null.
 * `x`/`y` are relative to canvas centre.
 */
export function pickConstellation(sky, camera, x, y) {
  const target = camera.unproject(x, y);
  const threshold = clamp(camera.fov * 0.05, 1.5 * DEG, 6 * DEG);
  const cosThreshold = Math.cos(threshold);

  let best = null;
  let bestDot = cosThreshold;

  for (const con of sky.constellations) {
    // Skip the figure entirely unless the cursor is inside its bounding cone.
    if (dot(con.centre, target) < Math.cos(Math.min(Math.PI, con.radius + threshold))) continue;

    for (const seg of con.segments) {
      for (let i = 0; i < seg.length; i += 3) {
        const d = seg[i] * target[0] + seg[i + 1] * target[1] + seg[i + 2] * target[2];
        if (d > bestDot) {
          bestDot = d;
          best = con;
        }
      }
    }
  }
  return best;
}
