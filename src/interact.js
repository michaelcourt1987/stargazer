// Pointer, wheel, touch and keyboard control of the camera.

import { DEG } from './vec3.js';

const INERTIA = 'inertia';
// Velocity decays to 1/e over this long. Short enough to feel like friction,
// long enough that a flick carries.
const FRICTION_MS = 120;
const MIN_SPEED = 0.02; // px/ms; below this the glide has visually stopped
const MAX_SPEED = 5;    // px/ms; faster than any real flick

const clampSpeed = (v) => Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v));

export class Interactions {
  constructor(canvas, camera, ticker, hooks) {
    this.canvas = canvas;
    this.camera = camera;
    this.ticker = ticker;
    this.hooks = hooks; // { onChange, onHover, onLeave, onSelect }

    this.pointers = new Map();
    this.dragging = false;
    this.moved = 0;
    this.vx = 0;
    this.vy = 0;
    this.anchorX = 0;
    this.anchorY = 0;
    this.pinchDistance = 0;

    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    canvas.addEventListener('pointerdown', this.onDown.bind(this));
    canvas.addEventListener('pointermove', this.onMove.bind(this));
    canvas.addEventListener('pointerup', this.onUp.bind(this));
    canvas.addEventListener('pointercancel', this.onUp.bind(this));
    canvas.addEventListener('pointerleave', this.onLeave.bind(this));
    canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('keydown', this.onKey.bind(this));
  }

  /** Pointer position relative to canvas centre, which is what the camera wants. */
  local(e) {
    const rect = this.canvas.getBoundingClientRect();
    return [
      e.clientX - rect.left - rect.width / 2,
      e.clientY - rect.top - rect.height / 2,
    ];
  }

  onDown(e) {
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.focus();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.ticker.stop(INERTIA);
    this.vx = this.vy = 0;
    this.moved = 0;
    this.lastMoveAt = e.timeStamp;

    if (this.pointers.size === 2) this.pinchDistance = this.spread();
    else this.dragging = true;
  }

  onMove(e) {
    const prev = this.pointers.get(e.pointerId);

    if (!prev) {
      // Not a drag -- just the cursor passing over the sky.
      const [x, y] = this.local(e);
      this.hooks.onHover(x, y);
      return;
    }

    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;
    this.moved += Math.hypot(dx, dy);

    if (this.pointers.size >= 2) {
      this.pinch();
    } else {
      const [px, py] = this.local(e);
      this.anchorX = px;
      this.anchorY = py;
      this.camera.dragBy(dx, dy, px, py);

      // Velocity as a rolling average. Using only the most recent delta picks up
      // whatever jitter happened to land in the final event. The floor on dt
      // matters: high-polling-rate pointers can deliver several events inside a
      // millisecond, and dividing by that gives a nonsense speed.
      const dt = Math.max(e.timeStamp - this.lastMoveAt, 8);
      this.lastMoveAt = e.timeStamp;
      const w = Math.exp(-dt / 60);
      this.vx = clampSpeed(this.vx * w + (dx / dt) * (1 - w));
      this.vy = clampSpeed(this.vy * w + (dy / dt) * (1 - w));

      this.hooks.onChange();
    }
  }

  onUp(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);

    if (this.pointers.size < 2) this.pinchDistance = 0;
    if (this.pointers.size === 0) {
      this.dragging = false;

      // A press that never really moved is a click, not a flick.
      if (this.moved < 4) {
        const [x, y] = this.local(e);
        this.hooks.onSelect(x, y);
        return;
      }

      if (!this.reducedMotion.matches && Math.hypot(this.vx, this.vy) > MIN_SPEED) {
        this.ticker.start(INERTIA);
      }
    }
  }

  onLeave() {
    if (!this.dragging) this.hooks.onLeave();
  }

  /** Called each frame while the view is still gliding after a flick. */
  glide(dt) {
    if (!this.ticker.isRunning(INERTIA)) return;
    this.camera.dragBy(this.vx * dt, this.vy * dt, this.anchorX, this.anchorY);
    const decay = Math.exp(-dt / FRICTION_MS);
    this.vx *= decay;
    this.vy *= decay;
    if (Math.hypot(this.vx, this.vy) < MIN_SPEED) this.ticker.stop(INERTIA);
    this.hooks.onChange();
  }

  spread() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  pinch() {
    const distance = this.spread();
    if (this.pinchDistance > 0 && distance > 0) {
      const [a, b] = [...this.pointers.values()];
      const rect = this.canvas.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - rect.left - rect.width / 2;
      const my = (a.y + b.y) / 2 - rect.top - rect.height / 2;
      // Fingers apart means a narrower field of view.
      this.camera.zoomAt(mx, my, this.camera.fov * (this.pinchDistance / distance));
    }
    this.pinchDistance = distance;
    this.hooks.onChange();
  }

  onWheel(e) {
    e.preventDefault();

    // deltaMode is pixels, lines or pages depending on the device; without
    // normalising, a mouse wheel and a trackpad feel wildly different.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const delta = e.deltaY * unit;

    const [x, y] = this.local(e);
    this.camera.zoomAt(x, y, this.camera.fov * Math.exp(delta * 0.0018));
    this.hooks.onChange();
    this.hooks.onHover(x, y);
  }

  onKey(e) {
    // dragBy takes pixels, so convert the desired angular step back through the
    // projection scale. Reusing the drag path means keyboard panning behaves
    // identically to the mouse at the poles.
    const step = (this.camera.fov * 0.12 * this.camera.k) / 2;
    const nudge = (dx, dy) => this.camera.dragBy(dx * step, dy * step, 0, 0);

    switch (e.key) {
      case 'ArrowLeft': nudge(1, 0); break;
      case 'ArrowRight': nudge(-1, 0); break;
      case 'ArrowUp': nudge(0, 1); break;
      case 'ArrowDown': nudge(0, -1); break;
      case '+': case '=': this.camera.setFov(this.camera.fov / 1.3); break;
      case '-': case '_': this.camera.setFov(this.camera.fov * 1.3); break;
      case 'Home': this.camera.setFov(60 * DEG); break;
      default: return;
    }
    e.preventDefault();
    this.hooks.onChange();
  }
}
