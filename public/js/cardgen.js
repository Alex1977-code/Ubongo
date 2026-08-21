// Prozeduraler Karten-Generator für Ubongo.
// Eine Karte = zusammenhängende Fläche, die exakt mit den vorgegebenen Teilen
// gefüllt werden kann. Die Fläche wird KONSTRUKTIV aus den Teilen selbst gebaut,
// dadurch ist jede Karte garantiert lösbar. Deterministisch per Seed.

import { PIECES, orientations, normalize } from './pieces.js';

// Schwierigkeitsgrade
export const DIFFICULTIES = {
  leicht:  { pieces: 3, time: 90,  label: 'Leicht',  maxW: 6, maxH: 5 },
  mittel:  { pieces: 4, time: 120, label: 'Mittel',  maxW: 7, maxH: 6 },
  schwer:  { pieces: 5, time: 150, label: 'Schwer',  maxW: 8, maxH: 6 },
  experte: { pieces: 6, time: 180, label: 'Experte', maxW: 9, maxH: 7 },
};

// Seeded RNG (mulberry32) – gleicher Seed => gleiche Karte, auf Server & Client.
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const K = ([x, y]) => x + ',' + y;
const NEIGH = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Versucht, eine Karte aus einer konkreten Teil-Auswahl zu bauen.
function tryBuild(pieceIds, rand, maxW, maxH) {
  const occupied = new Map(); // "x,y" -> pieceId
  const placements = [];      // { id, cells:[[x,y],...] } in absoluten Koordinaten

  for (let pi = 0; pi < pieceIds.length; pi++) {
    const id = pieceIds[pi];
    const orients = orientations(PIECES.find(p => p.id === id).cells);

    if (pi === 0) {
      const o = orients[Math.floor(rand() * orients.length)];
      for (const c of o) occupied.set(K(c), id);
      placements.push({ id, cells: o.map(c => c.slice()) });
      continue;
    }

    // Kandidaten sammeln: Orientierung + Versatz, ohne Überlappung,
    // mit Kantenkontakt zur bestehenden Fläche, innerhalb der Maximalgröße.
    const cells = [...occupied.keys()].map(k => k.split(',').map(Number));
    const minX = Math.min(...cells.map(c => c[0])), maxX = Math.max(...cells.map(c => c[0]));
    const minY = Math.min(...cells.map(c => c[1])), maxY = Math.max(...cells.map(c => c[1]));

    let best = null, bestArea = Infinity, found = 0;
    const tries = 160;
    for (let t = 0; t < tries; t++) {
      const o = orients[Math.floor(rand() * orients.length)];
      const ox = minX - 4 + Math.floor(rand() * (maxX - minX + 9));
      const oy = minY - 4 + Math.floor(rand() * (maxY - minY + 9));
      const abs = o.map(([x, y]) => [x + ox, y + oy]);
      let overlap = false, touch = false;
      for (const c of abs) {
        if (occupied.has(K(c))) { overlap = true; break; }
      }
      if (overlap) continue;
      for (const c of abs) {
        for (const n of NEIGH) {
          if (occupied.has(K([c[0] + n[0], c[1] + n[1]]))) { touch = true; break; }
        }
        if (touch) break;
      }
      if (!touch) continue;
      const nMinX = Math.min(minX, ...abs.map(c => c[0])), nMaxX = Math.max(maxX, ...abs.map(c => c[0]));
      const nMinY = Math.min(minY, ...abs.map(c => c[1])), nMaxY = Math.max(maxY, ...abs.map(c => c[1]));
      const w = nMaxX - nMinX + 1, h = nMaxY - nMinY + 1;
      if (Math.max(w, h) > Math.max(maxW, maxH) || Math.min(w, h) > Math.min(maxW, maxH)) continue;
      // Kompakteste Platzierung bevorzugen (kleinste Bounding-Box).
      const area = w * h;
      found++;
      if (area < bestArea || (area === bestArea && rand() < 0.35)) {
        bestArea = area; best = abs;
      }
    }
    if (!best) return null;
    for (const c of best) occupied.set(K(c), id);
    placements.push({ id, cells: best.map(c => c.slice()) });
  }

  // Auf Ursprung normalisieren.
  const all = placements.flatMap(p => p.cells);
  const minX = Math.min(...all.map(c => c[0]));
  const minY = Math.min(...all.map(c => c[1]));
  for (const p of placements) p.cells = p.cells.map(([x, y]) => [x - minX, y - minY]);

  return {
    cells: normalize(all),
    pieces: pieceIds.slice(),
    solution: placements,
  };
}

// Rundenaufbau innerhalb einer Partie: Karten werden allmählich kniffliger
// (ab Runde 3 ein Teil mehr, ab Runde 5 zwei), die Zeit wächst mit und wird
// mit dem Tempo-Faktor (Flott/Normal/Entspannt) skaliert.
const TIME_BY_COUNT = { 3: 90, 4: 120, 5: 150, 6: 180 };

export function roundSetup(difficulty, round, timeFactor = 1) {
  const base = DIFFICULTIES[difficulty] || DIFFICULTIES.mittel;
  const extra = Math.min(2, Math.floor(((round || 1) - 1) / 2));
  const pieces = Math.min(6, base.pieces + extra);
  return { pieces, time: Math.round(TIME_BY_COUNT[pieces] * timeFactor) };
}

// Öffentliche API: Karte für Seed + Schwierigkeit erzeugen.
// pieceCount überschreibt optional die Teilanzahl (für die Runden-Steigerung).
export function generateCard(seed, difficulty, pieceCount) {
  const diff = DIFFICULTIES[difficulty] || DIFFICULTIES.mittel;
  const count = pieceCount || diff.pieces;
  const limits = Object.values(DIFFICULTIES).find(d => d.pieces === count) || diff;
  const rand = rng(seed);
  for (let attempt = 0; attempt < 60; attempt++) {
    const ids = shuffled(PIECES.map(p => p.id), rand).slice(0, count);
    const card = tryBuild(ids, rand, limits.maxW, limits.maxH);
    if (card) return card;
  }
  // Fallback (praktisch unerreichbar): einfache Reihe aus I3+V3.
  return tryBuild(['I3', 'V3', 'O4'].slice(0, Math.min(3, count)), rng(seed + 1), 12, 12);
}
