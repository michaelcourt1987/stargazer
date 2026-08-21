// Name lookup for the search box: every constellation plus every star that has
// a proper name.

import { DEG, clamp } from './vec3.js';

// Diacritics folded away so "Andromede" finds "Andromède".
const fold = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function buildIndex(sky) {
  const entries = [];

  for (const con of sky.constellations) {
    entries.push({
      kind: 'constellation',
      label: con.name,
      detail: 'Constellation',
      vec: con.labelVec,
      // Frame the whole figure with a little room around it.
      fov: clamp(con.radius * 2.6, 14 * DEG, 70 * DEG),
      terms: [fold(con.name), fold(con.abbr), fold(con.gen)],
      weight: 100 - con.rank,
    });
  }

  const { n, name, bayer, con, mag, xyz } = sky.stars;
  const genitives = new Map(sky.constellations.map((c) => [c.abbr, c.gen]));

  for (let i = 0; i < n; i++) {
    if (!name[i]) continue;
    const home = genitives.get(con[i]) || con[i];
    entries.push({
      kind: 'star',
      label: name[i],
      detail: [bayer[i] && `${bayer[i]} ${home}`, `mag ${mag[i].toFixed(2)}`]
        .filter(Boolean).join(' · '),
      vec: [xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]],
      fov: 18 * DEG,
      terms: [fold(name[i])],
      // Brighter stars outrank fainter ones on an equal-quality match.
      weight: 60 - mag[i] * 4,
    });
  }

  return entries;
}

export function search(entries, query, limit = 7) {
  const q = fold(query);
  if (!q) return [];

  const scored = [];
  for (const e of entries) {
    let best = 0;
    for (const term of e.terms) {
      if (!term) continue;
      if (term === q) best = Math.max(best, 1000);
      else if (term.startsWith(q)) best = Math.max(best, 700 - (term.length - q.length));
      else if (term.includes(` ${q}`)) best = Math.max(best, 500);
      else if (term.includes(q)) best = Math.max(best, 250);
    }
    if (best) scored.push({ entry: e, score: best + e.weight });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.entry);
}
