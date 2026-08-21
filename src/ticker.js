// Frames are drawn on demand rather than at a constant 60fps. A star map is the
// kind of page people leave open, and repainting an unchanged sky forever is a
// waste of their battery.
//
// Anything that animates registers itself as a source; while at least one is
// active, frames keep coming.

export class Ticker {
  constructor(draw) {
    this.draw = draw;
    this.sources = new Set();
    this.pending = false;
    this.last = 0;
    this._frame = this._frame.bind(this);
  }

  /** Draw one frame, soon. Repeated calls before that frame arrive coalesce. */
  request() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(this._frame);
  }

  start(source) {
    this.sources.add(source);
    this.request();
  }

  stop(source) {
    this.sources.delete(source);
  }

  isRunning(source) {
    return this.sources.has(source);
  }

  _frame(now) {
    this.pending = false;
    // Clamped so a backgrounded tab doesn't resume with one enormous timestep.
    const dt = this.last ? Math.min(now - this.last, 100) : 16;
    this.last = now;
    this.draw(dt);
    if (this.sources.size) this.request();
  }
}
