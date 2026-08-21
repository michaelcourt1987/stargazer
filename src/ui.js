// DOM chrome: the tooltip, the search box, the display toggles, the readout.
//
// These are real elements rather than canvas drawing so they reach screen
// readers and so text stays selectable and crisp at any zoom.

import { DEG } from './vec3.js';
import { buildIndex, search } from './search.js';

export class UI {
  constructor(sky, handlers) {
    this.sky = sky;
    this.handlers = handlers; // { onGoTo, onToggle }
    this.entries = buildIndex(sky);
    this.results = [];
    this.cursor = -1;

    this.tooltip = document.getElementById('tooltip');
    this.readout = document.getElementById('readout');
    this.form = document.getElementById('search');
    this.input = document.getElementById('search-input');
    this.list = document.getElementById('suggestions');

    this.genitives = new Map(sky.constellations.map((c) => [c.abbr, c.gen]));

    this.wireSearch();
    this.wireToggles();
  }

  // ---- search ----

  wireSearch() {
    this.input.addEventListener('input', () => this.refresh());
    this.input.addEventListener('focus', () => this.refresh());
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.choose(Math.max(this.cursor, 0));
    });

    document.addEventListener('pointerdown', (e) => {
      if (!this.form.contains(e.target)) this.close();
    });
  }

  refresh() {
    this.results = search(this.entries, this.input.value);
    this.cursor = this.results.length ? 0 : -1;
    this.render();
  }

  render() {
    this.list.textContent = '';
    if (!this.results.length) {
      this.list.hidden = true;
      return;
    }

    this.results.forEach((entry, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === this.cursor));

      const name = document.createElement('span');
      name.textContent = entry.label;
      const kind = document.createElement('span');
      kind.className = 'kind';
      kind.textContent = entry.detail;

      li.append(name, kind);
      li.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.choose(i);
      });
      this.list.append(li);
    });
    this.list.hidden = false;
  }

  onKey(e) {
    if (e.key === 'Escape') {
      this.close();
      this.input.blur();
      return;
    }
    if (!this.results.length) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      this.cursor = (this.cursor + step + this.results.length) % this.results.length;
      this.render();
    }
  }

  choose(i) {
    const entry = this.results[i];
    if (!entry) return;
    this.handlers.onGoTo(entry);
    this.close();
    this.input.blur();
  }

  close() {
    this.list.hidden = true;
    this.results = [];
    this.cursor = -1;
  }

  // ---- toggles ----

  wireToggles() {
    const bind = (id, key) => {
      const el = document.getElementById(id);
      el.addEventListener('change', () => this.handlers.onToggle(key, el.checked));
    };
    bind('toggle-lines', 'lines');
    bind('toggle-names', 'constellationNames');
    bind('toggle-stars', 'starNames');
  }

  // ---- tooltip ----

  showStar(index, x, y) {
    const { name, bayer, flam, con, mag, hip } = this.sky.stars;
    const home = this.genitives.get(con[index]) || con[index];

    const designation = bayer[index]
      ? `${bayer[index]} ${home}`
      : flam[index] ? `${flam[index]} ${home}` : home;

    this.paintTooltip(
      name[index] || designation || `HIP ${hip[index]}`,
      [name[index] && designation, `magnitude ${mag[index].toFixed(2)}`]
        .filter(Boolean).join(' · '),
      x, y,
    );
  }

  showConstellation(con, x, y) {
    this.paintTooltip(con.name, con.gen ? `Constellation · ${con.gen}` : 'Constellation', x, y);
  }

  paintTooltip(title, detail, x, y) {
    this.tooltip.textContent = '';
    const strong = document.createElement('strong');
    strong.textContent = title;
    const span = document.createElement('span');
    span.textContent = detail;
    this.tooltip.append(strong, span);

    this.tooltip.hidden = false;
    // Flip to the other side of the cursor when close to the right edge.
    const width = this.tooltip.offsetWidth;
    const flip = x + width + 30 > window.innerWidth;
    this.tooltip.style.transform = flip
      ? `translate(calc(-100% - 14px), -50%)`
      : `translate(14px, -50%)`;
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${y}px`;
  }

  hideTooltip() {
    this.tooltip.hidden = true;
  }

  /** Where the view is pointing, in the terms an astronomer would use. */
  updateReadout(camera) {
    const hours = ((camera.yaw / DEG + 360) % 360) / 15;
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    const dec = camera.pitch / DEG;
    const sign = dec < 0 ? '−' : '+';
    this.readout.textContent =
      `RA ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m · ` +
      `Dec ${sign}${Math.abs(dec).toFixed(0)}° · ${(camera.fov / DEG).toFixed(0)}° field`;
  }
}
