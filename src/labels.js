// Constellation and star names, placed so they don't collide.
//
// Greedy placement in priority order: at ~240 candidates the exhaustive
// alternatives buy nothing a reader would notice. What does matter is that a
// label which survived the previous frame gets a small bonus, otherwise names
// flicker in and out of existence as you pan.

import { DEG, clamp } from './vec3.js';
import { FOV_MAX, FOV_MIN } from './camera.js';

const CONSTELLATION_FONT = 13;
const STAR_FONT = 11;
const PAD = 3;
const STICKY_BONUS = 25;

// A name only earns its space once there's room to read it.
const RANK_FOV = { 1: Infinity, 2: 70 * DEG, 3: 40 * DEG };
const BAYER_FOV = 12 * DEG;

// How faint a star can be and still be named, as the view narrows. Even on the
// widest field the dozen or so genuinely famous stars stay labelled -- they are
// the landmarks people navigate by.
const NAME_MAG_WIDE = 1.6;
const NAME_MAG_TIGHT = 5.0;

export class Labels {
  constructor(sky) {
    this.sky = sky;
    this.widths = new Map();
    // "Alp" + "Canis Majoris". Serpens has two entries under one abbreviation;
    // either genitive is the same word, so first wins.
    this.genitives = new Map(sky.constellations.map((c) => [c.abbr, c.gen]));
    this.placedLast = new Set();
    this.showConstellations = true;
    this.showStars = true;
  }

  draw(ctx, camera, renderer, cx, cy) {
    const candidates = [];
    if (this.showConstellations) this.collectConstellations(candidates, camera, cx, cy);
    if (this.showStars) this.collectStars(candidates, camera, renderer);

    for (const c of candidates) {
      c.score = c.priority + (this.placedLast.has(c.key) ? STICKY_BONUS : 0);
    }
    candidates.sort((a, b) => b.score - a.score);

    const taken = [];
    const placed = new Set();

    for (const c of candidates) {
      ctx.font = `${c.kind === 'con' ? '600 ' : ''}${c.font}px ui-sans-serif, system-ui, sans-serif`;
      const w = this.measure(ctx, c.text, c.font);
      const h = c.font;

      const spot = this.findSpot(c, w, h, taken);
      if (!spot) continue;

      taken.push(spot);
      placed.add(c.key);
      this.paint(ctx, c, spot, w, h);
    }

    this.placedLast = placed;
  }

  /** First offset that clears everything already placed. */
  findSpot(c, w, h, taken) {
    const gap = c.gap;
    const positions = [
      [c.x + gap, c.y - h / 2],
      [c.x - gap - w, c.y - h / 2],
      [c.x - w / 2, c.y - gap - h],
      [c.x - w / 2, c.y + gap],
    ];

    for (const [x, y] of positions) {
      const rect = { x: x - PAD, y: y - PAD, w: w + PAD * 2, h: h + PAD * 2, tx: x, ty: y };
      if (!taken.some((t) => overlaps(t, rect))) return rect;
    }
    return null;
  }

  paint(ctx, c, spot, w, h) {
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    // Outlined first: over a dense star field, plain text is unreadable.
    ctx.strokeStyle = 'rgba(3, 5, 12, 0.75)';
    ctx.strokeText(c.text, spot.tx, spot.ty);
    ctx.fillStyle = c.color;
    ctx.fillText(c.text, spot.tx, spot.ty);
  }

  collectConstellations(out, camera, cx, cy) {
    const projected = [0, 0];
    for (const con of this.sky.constellations) {
      if (camera.fov > (RANK_FOV[con.rank] ?? RANK_FOV[3])) continue;
      if (!camera.project(con.labelVec, projected)) continue;

      const x = cx + projected[0];
      const y = cy + projected[1];
      if (x < -100 || x > camera.width + 100 || y < -60 || y > camera.height + 60) continue;

      out.push({
        key: `c:${con.abbr}:${con.name}`,
        kind: 'con',
        text: con.name,
        x,
        y,
        gap: 0,
        font: CONSTELLATION_FONT,
        color: 'rgba(150, 190, 245, 0.92)',
        priority: 1000 - con.rank * 10,
      });
    }
  }

  collectStars(out, camera, renderer) {
    const { px, py, visible, sky } = renderer;
    const { n, mag, name, bayer, con } = sky.stars;
    const showBayer = camera.fov <= BAYER_FOV;

    const zoom = 1 - (camera.fov - FOV_MIN) / (FOV_MAX - FOV_MIN);
    const magLimit = clamp(
      NAME_MAG_WIDE + (NAME_MAG_TIGHT - NAME_MAG_WIDE) * zoom,
      NAME_MAG_WIDE, NAME_MAG_TIGHT,
    );

    for (let i = 0; i < n; i++) {
      if (!visible[i]) continue;
      // Sorted brightest first, so this is where the interesting stars end.
      if (mag[i] > magLimit) break;

      const text = name[i] || (showBayer && bayer[i]
        ? `${bayer[i]} ${this.genitives.get(con[i]) || con[i]}`
        : '');
      if (!text) continue;

      out.push({
        key: `s:${i}`,
        kind: 'star',
        text,
        x: px[i],
        y: py[i],
        gap: 6,
        font: STAR_FONT,
        color: name[i] ? 'rgba(226, 234, 250, 0.9)' : 'rgba(176, 192, 220, 0.75)',
        priority: 500 - mag[i] * 20,
      });
    }
  }

  /** measureText is surprisingly costly and these strings never change. */
  measure(ctx, text, font) {
    const key = `${font}|${text}`;
    let w = this.widths.get(key);
    if (w === undefined) {
      w = ctx.measureText(text).width;
      this.widths.set(key, w);
    }
    return w;
  }
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
