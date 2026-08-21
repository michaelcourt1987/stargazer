// Animated travel between two points on the sky, for search results.

import { DEG, angleBetween, clamp, rotateToward } from './vec3.js';
import { FOV_MAX } from './camera.js';

const FLIGHT = 'flight';
// Below this the two points are close enough that a straight zoom reads fine.
const ARC_THRESHOLD = 40 * DEG;

export class Flight {
  constructor(camera, ticker, onChange) {
    this.camera = camera;
    this.ticker = ticker;
    this.onChange = onChange;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.active = null;
  }

  to(target, targetFov) {
    const camera = this.camera;

    if (this.reducedMotion.matches) {
      camera.setFov(targetFov);
      camera.lookAt(target);
      this.onChange();
      return;
    }

    const from = camera.F.slice();
    let omega = angleBetween(from, target);

    // Antipodal points have no unique great circle between them; nudge off the
    // axis so the interpolation has a plane to work in.
    if (omega > Math.PI - 1e-4) {
      omega = Math.PI - 1e-4;
    }

    const fromFov = camera.fov;
    let arc = 1;
    if (omega > ARC_THRESHOLD) {
      // Pull back mid-flight, the way a map does on a long jump. It shows the
      // journey, and it hides the fast apparent spin when the path clips a pole.
      const midpoint = Math.sqrt(fromFov * targetFov);
      arc = clamp(omega * 1.2, midpoint, FOV_MAX) / midpoint;
    }

    this.active = {
      from,
      target,
      omega,
      fromFov,
      targetFov,
      arc,
      elapsed: 0,
      duration: clamp(400 + 900 * (omega / Math.PI), 400, 1400),
    };
    this.ticker.start(FLIGHT);
  }

  cancel() {
    this.active = null;
    this.ticker.stop(FLIGHT);
  }

  advance(dt) {
    const f = this.active;
    if (!f) return;

    f.elapsed += dt;
    const t = clamp(f.elapsed / f.duration, 0, 1);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    // Field of view moves geometrically -- a linear sweep from 5 to 110 degrees
    // spends almost the whole flight barely zoomed in.
    const base = f.fromFov * Math.pow(f.targetFov / f.fromFov, e);
    this.camera.setFov(base * Math.pow(f.arc, Math.sin(Math.PI * e)));
    this.camera.lookAt(rotateToward(f.from, f.target, f.omega * e));

    if (t >= 1) {
      this.active = null;
      this.ticker.stop(FLIGHT);
    }
    this.onChange();
  }
}
