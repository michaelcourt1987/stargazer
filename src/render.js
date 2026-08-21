// Draws the sky: background, constellation figures, stars.
//
// Labels are handled separately (labels.js) and the hover highlight lives on a
// second canvas, so moving the mouse never forces the whole sky to repaint.

import { DEG } from './vec3.js';

const TAU = Math.PI * 2;
const REF_FOV = 60 * DEG;

// Below about three quarters of a pixel a filled dot just aliases into uniform
// grey mush, and every faint star ends up looking identical. Past that point
// brightness is carried by opacity instead of size, so dim stars read as dim
// rather than merely small.
const MIN_RADIUS = 0.75;

const LINE_COLOR = 'rgba(122, 168, 236, ';
const GLOW_MAG = 1.5;

export class Renderer {
  constructor(canvas, sky, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.sky = sky;
    this.camera = camera;

    // Projected screen positions from the last frame, reused for hit testing.
    this.px = new Float32Array(sky.stars.n);
    this.py = new Float32Array(sky.stars.n);
    this.visible = new Uint8Array(sky.stars.n);

    this.showLines = true;
    this.glow = makeGlowSprite();
  }

  resize(width, height, dpr) {
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.camera.resize(width, height);
  }

  draw() {
    const { ctx, width, height } = this;
    const cx = width / 2;
    const cy = height / 2;

    this.paintBackground(ctx, cx, cy, width, height);
    if (this.showLines) this.drawConstellations(ctx, cx, cy);
    this.drawStars(ctx, cx, cy);
  }

  paintBackground(ctx, cx, cy, width, height) {
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, width, height);

    // A barely-there brightening at centre; it gives the sphere some depth
    // without ever reading as a light source.
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(cx, cy));
    g.addColorStop(0, 'rgba(28, 40, 76, 0.55)');
    g.addColorStop(1, 'rgba(5, 7, 15, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  drawConstellations(ctx, cx, cy, only = null, alpha = 0.34, lineWidth = 1) {
    const cam = this.camera;
    const { F, ER, EU, k, cullTheta } = cam;

    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const con of this.sky.constellations) {
      if (only && con !== only) continue;

      // One dot product rejects a figure whose bounding cone cannot reach the view.
      const toCentre = con.centre[0] * F[0] + con.centre[1] * F[1] + con.centre[2] * F[2];
      if (toCentre < Math.cos(Math.min(Math.PI, cullTheta + con.radius))) continue;

      // Fainter figures recede slightly, so the sky doesn't read as a wire mesh.
      const weight = only ? 1 : (con.rank === 1 ? 1 : con.rank === 2 ? 0.78 : 0.58);
      ctx.strokeStyle = `${LINE_COLOR}${(alpha * weight).toFixed(3)})`;

      const path = new Path2D();
      for (const seg of con.segments) {
        let started = false;
        for (let i = 0; i < seg.length; i += 3) {
          const x = seg[i];
          const y = seg[i + 1];
          const z = seg[i + 2];
          const w = 1 + x * F[0] + y * F[1] + z * F[2];
          if (w < 1e-3) { started = false; continue; }
          const s = k / w;
          const sx = cx + s * (x * ER[0] + y * ER[1] + z * ER[2]);
          const sy = cy - s * (x * EU[0] + y * EU[1] + z * EU[2]);
          if (started) path.lineTo(sx, sy);
          else path.moveTo(sx, sy);
          started = true;
        }
      }
      ctx.stroke(path);
    }
  }

  drawStars(ctx, cx, cy) {
    const cam = this.camera;
    const { F, ER, EU, k } = cam;
    const { xyz, radius, mag, buckets, n } = this.sky.stars;
    const { px, py, visible, width, height } = this;

    visible.fill(0);

    // Zooming in grows stars a little, so a narrow field doesn't look sparse.
    const boost = Math.pow(REF_FOV / cam.fov, 0.28);
    const margin = 8;

    for (const bucket of buckets) {
      const repRadius = bucket.radiusMid * boost;
      const alpha = Math.min(1, (repRadius / MIN_RADIUS) ** 2);
      const path = new Path2D();
      let any = false;

      for (let j = 0; j < bucket.indices.length; j++) {
        const i = bucket.indices[j];
        const i3 = i * 3;
        const x = xyz[i3];
        const y = xyz[i3 + 1];
        const z = xyz[i3 + 2];

        const w = 1 + x * F[0] + y * F[1] + z * F[2];
        if (w < 1e-3) continue;
        const s = k / w;
        const sx = cx + s * (x * ER[0] + y * ER[1] + z * ER[2]);
        const sy = cy - s * (x * EU[0] + y * EU[1] + z * EU[2]);
        if (sx < -margin || sx > width + margin || sy < -margin || sy > height + margin) continue;

        px[i] = sx;
        py[i] = sy;
        visible[i] = 1;

        const r = Math.max(radius[i] * boost, MIN_RADIUS);
        if (r < 1.5) {
          // At this size a square and a circle are indistinguishable, and a
          // rect is markedly cheaper to tessellate.
          path.rect(sx - r, sy - r, r * 2, r * 2);
        } else {
          path.moveTo(sx + r, sy);
          path.arc(sx, sy, r, 0, TAU);
        }
        any = true;
      }

      if (!any) continue;
      const [r8, g8, b8] = bucket.rgb;
      ctx.fillStyle = `rgba(${r8},${g8},${b8},${alpha.toFixed(3)})`;
      ctx.fill(path);
    }

    // A soft halo on the handful of genuinely brilliant stars. Costs nothing and
    // does more for the illusion of a real sky than any amount of twinkling.
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      if (mag[i] >= GLOW_MAG) break; // sorted brightest first
      if (!visible[i]) continue;
      const size = (14 + (GLOW_MAG - mag[i]) * 9) * boost;
      ctx.globalAlpha = 0.5;
      ctx.drawImage(this.glow, px[i] - size / 2, py[i] - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

function makeGlowSprite() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.25, 'rgba(190,215,255,0.18)');
  grad.addColorStop(1, 'rgba(160,195,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}
