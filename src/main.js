// Stargazer -- wiring.

import { Camera } from './camera.js';
import { Flight } from './flight.js';
import { Interactions } from './interact.js';
import { Labels } from './labels.js';
import { Renderer } from './render.js';
import { Ticker } from './ticker.js';
import { UI } from './ui.js';
import { loadSky } from './data.js';
import { pickConstellation, pickStar } from './picking.js';
import { DEG, fromSpherical } from './vec3.js';

// Orion: the most recognisable figure in the sky, and a good first impression.
const HOME = fromSpherical(83, 2);

boot();

async function boot() {
  const loading = document.getElementById('loading');
  let sky;
  try {
    sky = await loadSky();
  } catch (err) {
    loading.textContent = 'The star catalogue could not be loaded.';
    console.error(err);
    return;
  }

  const skyCanvas = document.getElementById('sky');
  const hudCanvas = document.getElementById('hud');
  const hud = hudCanvas.getContext('2d');

  const camera = new Camera();
  const renderer = new Renderer(skyCanvas, sky, camera);
  const labels = new Labels(sky);

  camera.lookAt(HOME);
  camera.setFov(70 * DEG);

  let skyDirty = true;
  let hovered = null; // { kind: 'star'|'constellation', ... }

  const ticker = new Ticker(frame);
  const flight = new Flight(camera, ticker, invalidate);

  const ui = new UI(sky, {
    onGoTo: (entry) => {
      clearHover();
      flight.to(entry.vec, entry.fov);
    },
    onToggle: (key, on) => {
      if (key === 'lines') renderer.showLines = on;
      if (key === 'constellationNames') labels.showConstellations = on;
      if (key === 'starNames') labels.showStars = on;
      invalidate();
    },
  });

  const interactions = new Interactions(skyCanvas, camera, ticker, {
    onChange: () => {
      flight.cancel();
      invalidate();
    },
    onHover: hoverAt,
    onLeave: clearHover,
    onSelect: selectAt,
  });

  function invalidate() {
    skyDirty = true;
    ticker.request();
  }

  function frame(dt) {
    flight.advance(dt);
    interactions.glide(dt);

    if (skyDirty) {
      renderer.draw();
      labels.draw(renderer.ctx, camera, renderer, renderer.width / 2, renderer.height / 2);
      ui.updateReadout(camera);
      skyDirty = false;
      // Anything the pointer was over has moved out from under it.
      if (hovered) refreshHover();
    }
    drawHud();
  }

  // ---- hover ----

  function hoverAt(x, y) {
    lastPointer = [x, y];
    refreshHover();
  }

  let lastPointer = null;

  function refreshHover() {
    if (!lastPointer) return;
    const [x, y] = lastPointer;
    const cx = renderer.width / 2;
    const cy = renderer.height / 2;

    const star = pickStar(renderer, cx + x, cy + y);
    const next = star >= 0
      ? { kind: 'star', index: star }
      : (() => {
        const con = pickConstellation(sky, camera, x, y);
        return con ? { kind: 'constellation', con } : null;
      })();

    const changed = !sameHover(hovered, next);
    hovered = next;

    if (!next) {
      ui.hideTooltip();
    } else if (next.kind === 'star') {
      ui.showStar(next.index, renderer.px[next.index], renderer.py[next.index]);
    } else {
      ui.showConstellation(next.con, cx + x, cy + y);
    }

    if (changed || next) ticker.request();
  }

  function clearHover() {
    lastPointer = null;
    if (hovered) {
      hovered = null;
      ui.hideTooltip();
      ticker.request();
    }
  }

  function selectAt(x, y) {
    const cx = renderer.width / 2;
    const cy = renderer.height / 2;
    const star = pickStar(renderer, cx + x, cy + y);
    if (star >= 0) {
      const { xyz } = sky.stars;
      flight.to([xyz[star * 3], xyz[star * 3 + 1], xyz[star * 3 + 2]],
        Math.min(camera.fov, 18 * DEG));
      return;
    }
    const con = pickConstellation(sky, camera, x, y);
    if (con) flight.to(con.labelVec, Math.max(con.radius * 2.6, 14 * DEG));
  }

  function sameHover(a, b) {
    if (!a || !b) return a === b;
    return a.kind === b.kind && (a.kind === 'star' ? a.index === b.index : a.con === b.con);
  }

  /** The hover layer, so pointing at things never repaints the whole sky. */
  function drawHud() {
    hud.clearRect(0, 0, renderer.width, renderer.height);
    if (!hovered) return;

    if (hovered.kind === 'constellation') {
      renderer.drawConstellations(hud, renderer.width / 2, renderer.height / 2,
        hovered.con, 0.95, 1.4);
    } else {
      const i = hovered.index;
      hud.beginPath();
      hud.arc(renderer.px[i], renderer.py[i], 9, 0, Math.PI * 2);
      hud.strokeStyle = 'rgba(180, 212, 255, 0.85)';
      hud.lineWidth = 1.2;
      hud.stroke();
    }
  }

  // ---- layout ----

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    // Cap the pixel ratio: on a 3x phone screen the extra pixels cost real
    // frame time and buy nothing visible on 1px stars.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    renderer.resize(width, height, dpr);
    hudCanvas.width = Math.round(width * dpr);
    hudCanvas.height = Math.round(height * dpr);
    hudCanvas.style.width = `${width}px`;
    hudCanvas.style.height = `${height}px`;
    hud.setTransform(dpr, 0, 0, dpr, 0, 0);

    invalidate();
  }

  window.addEventListener('resize', resize);
  resize();

  // Slash focuses search, the way it does in most things with a search box.
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== ui.input) {
      e.preventDefault();
      ui.input.focus();
      ui.input.select();
    }
  });

  loading.classList.add('done');
  skyCanvas.focus();
}
