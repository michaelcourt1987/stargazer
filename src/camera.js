// The view onto the celestial sphere: where it points, how wide it is, and how
// world directions become screen pixels.
//
// Projection is stereographic. That is not an aesthetic preference -- at the
// widest field of view the canvas corners sit past 90 degrees from the view
// centre, and a gnomonic projection diverges there and folds back on itself,
// painting mirrored ghost constellations inside the frame. Stereographic has no
// "behind the camera" at all; only the single antipodal point is undefined.

import { DEG, clamp, dot, rotateToward } from './vec3.js';

export const FOV_MIN = 5 * DEG;
export const FOV_MAX = 110 * DEG;

// Past this the view would tip over the pole and the sky would appear upside
// down. At 89.5 degrees Polaris still sits half a degree from screen centre, so
// nothing is actually out of reach.
const MAX_PITCH = 89.5 * DEG;

// Largest rotation any single drag or glide step may apply. See dragBy.
const MAX_STEP = 20 * DEG;

// Past this declination, drag steps are subdivided so the pitch clamp can't be
// jumped over. See dragBy.
const NEAR_POLE = 80 * DEG;

export class Camera {
  constructor() {
    this.yaw = 0;
    this.pitch = 0;
    this.fov = 60 * DEG;
    this.width = 1;
    this.height = 1;
    this._rebuild();
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this._rebuild();
  }

  setFov(fov) {
    this.fov = clamp(fov, FOV_MIN, FOV_MAX);
    this._rebuild();
  }

  /** Point the view at a world direction, keeping north up. */
  lookAt(f) {
    const pitch = Math.asin(clamp(f[2], -1, 1));
    if (Math.abs(pitch) > MAX_PITCH) {
      // Pushed past the pole. Stop there rather than tipping over, which would
      // swing the whole sky through 180 degrees. The heading is left alone
      // deliberately: at the pole itself atan2 has nothing meaningful to say,
      // and dragging sideways still works because that never exceeds the clamp.
      this.pitch = Math.sign(pitch) * MAX_PITCH;
    } else {
      this.pitch = pitch;
      this.yaw = Math.atan2(f[1], f[0]);
    }
    this._rebuild();
  }

  _rebuild() {
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);

    // A star chart is the view from inside the sphere looking out, so right
    // ascension increases to the LEFT. Getting this backwards mirrors the whole
    // sky, which is subtle enough to miss and makes every constellation wrong.
    this.F = [cp * cy, cp * sy, sp];        // forward, at screen centre
    this.ER = [sy, -cy, 0];                 // screen right = decreasing RA
    this.EU = [-sp * cy, -sp * sy, cp];     // screen up = increasing declination

    // rho = k * tan(theta/2), and theta maxes out at fov/2 across the smaller
    // canvas dimension -- hence fov/4, not the fov/2 that a gnomonic projection
    // would use.
    this.k = 0.5 * Math.min(this.width, this.height) / Math.tan(this.fov / 4);

    // Angular radius of the canvas corner, plus margin. Anything further from
    // the view centre than this cannot be on screen.
    const cornerTheta = 2 * Math.atan(Math.hypot(this.width, this.height) / 2 / this.k);
    this.cullTheta = Math.min(Math.PI, cornerTheta + 5 * DEG);
  }

  /**
   * World unit vector to screen offset from canvas centre, written into `out`.
   * Returns false only at the antipode, where the projection is undefined.
   */
  project(v, out) {
    const { F, ER, EU } = this;
    const w = 1 + v[0] * F[0] + v[1] * F[1] + v[2] * F[2];
    if (w < 1e-3) return false;
    const s = this.k / w;
    out[0] = s * (v[0] * ER[0] + v[1] * ER[1] + v[2] * ER[2]);
    out[1] = -s * (v[0] * EU[0] + v[1] * EU[1] + v[2] * EU[2]);
    return true;
  }

  /** Screen offset back to a world unit vector. Closed form, no trig. */
  unproject(sx, sy) {
    const a = sx / this.k;
    const b = -sy / this.k;
    const s = a * a + b * b;
    const d = 1 / (1 + s);
    const rx = (1 - s) * d;
    const ry = 2 * a * d;
    const rz = 2 * b * d;
    const { F, ER, EU } = this;
    return [
      rx * F[0] + ry * ER[0] + rz * EU[0],
      rx * F[1] + ry * ER[1] + rz * EU[1],
      rx * F[2] + ry * ER[2] + rz * EU[2],
    ];
  }

  /**
   * Drag the sky by a pointer delta.
   *
   * `px`/`py` are the pointer's position relative to canvas centre, and the
   * angular scale is taken THERE rather than at the view centre, so the sky
   * stays glued to the cursor even out at the edge of a wide field.
   *
   * This rotates the forward vector directly instead of nudging yaw by
   * dx/cos(dec). That division approaches a hundredfold multiplier near the
   * poles and sends the view into a spin; rotating the vector is exact
   * everywhere and needs no special case.
   */
  dragBy(dx, dy, px, py) {
    const k = this.k;
    const radPerPx = 2 / (k * (1 + (px * px + py * py) / (k * k)));
    const ax = -radPerPx * dx;
    const ay = radPerPx * dy;
    const raw = Math.hypot(ax, ay);
    if (raw < 1e-9) return;

    // A single step never turns more than this. Real pointer deltas are far
    // below it; the cap exists so a runaway glide can't leap clean over the
    // pole in one frame, which would skip past the pitch clamp entirely.
    const alpha = Math.min(raw, MAX_STEP);
    const ux = ax / raw;
    const uy = ay / raw;
    const { F, ER, EU } = this;

    // Rotate about the axis perpendicular to both the view and the drag
    // direction -- that axis stays fixed for the whole gesture, so stepping
    // along it repeatedly traces the exact same great circle.
    const D = [
      ux * ER[0] + uy * EU[0],
      ux * ER[1] + uy * EU[1],
      ux * ER[2] + uy * EU[2],
    ];
    const n = [
      F[1] * D[2] - F[2] * D[1],
      F[2] * D[0] - F[0] * D[2],
      F[0] * D[1] - F[1] * D[0],
    ];

    // Close to the pole, walk the rotation in small pieces. The pitch clamp
    // only bites on a step that actually lands inside the last half degree, and
    // a single large step would vault straight over that band and come down the
    // far side -- swinging the sky through 180 degrees of longitude.
    const steps = Math.abs(this.pitch) > NEAR_POLE
      ? Math.max(1, Math.ceil(alpha / (0.25 * DEG)))
      : 1;
    const piece = alpha / steps;
    const c = Math.cos(piece);
    const s = Math.sin(piece);

    let f = F;
    for (let i = 0; i < steps; i++) {
      f = [
        f[0] * c + (n[1] * f[2] - n[2] * f[1]) * s,
        f[1] * c + (n[2] * f[0] - n[0] * f[2]) * s,
        f[2] * c + (n[0] * f[1] - n[1] * f[0]) * s,
      ];
      this.lookAt(f);
      f = this.F; // pick up whatever the clamp decided
    }
  }

  /** Zoom to `newFov` while holding whatever sits under the pointer in place. */
  zoomAt(px, py, newFov) {
    const target = clamp(newFov, FOV_MIN, FOV_MAX);
    if (target === this.fov) return;

    const anchor = this.unproject(px, py);
    const rho = Math.hypot(px, py);
    const kOld = this.k;

    this.fov = target;
    this._rebuild();

    // The anchor's angular distance from centre changes with k; rotate the view
    // by the difference so it lands back under the cursor.
    const delta = 2 * Math.atan(rho / kOld) - 2 * Math.atan(rho / this.k);
    if (rho > 0.5 && Math.abs(delta) > 1e-9) {
      this.lookAt(rotateToward(this.F, anchor, delta));
    }
  }

  /** Angular distance from the view centre to a world direction. */
  angleFromCentre(v) {
    return Math.acos(clamp(dot(v, this.F), -1, 1));
  }
}
