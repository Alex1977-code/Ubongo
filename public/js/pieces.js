// Ubongo-Legeteile: 12 Polyominos (3-5 Felder) mit kräftigen Farben.
// Jedes Teil ist als Liste von [x,y]-Zellen definiert (normalisiert auf Ursprung).

export const PIECES = [
  { id: 'I3', cells: [[0,0],[1,0],[2,0]],             color: '#e63946', name: 'Rot'      },
  { id: 'V3', cells: [[0,0],[1,0],[0,1]],             color: '#2f6fed', name: 'Blau'     },
  { id: 'O4', cells: [[0,0],[1,0],[0,1],[1,1]],       color: '#f4c500', name: 'Gelb'     },
  { id: 'I4', cells: [[0,0],[1,0],[2,0],[3,0]],       color: '#2a9d3a', name: 'Grün'     },
  { id: 'L4', cells: [[0,0],[0,1],[0,2],[1,2]],       color: '#f77f00', name: 'Orange'   },
  { id: 'T4', cells: [[0,0],[1,0],[2,0],[1,1]],       color: '#8338ec', name: 'Lila'     },
  { id: 'S4', cells: [[1,0],[2,0],[0,1],[1,1]],       color: '#00b4d8', name: 'Türkis'   },
  { id: 'P5', cells: [[0,0],[1,0],[0,1],[1,1],[0,2]], color: '#ef5da8', name: 'Pink'     },
  { id: 'U5', cells: [[0,0],[2,0],[0,1],[1,1],[2,1]], color: '#0a8578', name: 'Petrol'   },
  { id: 'Y5', cells: [[1,0],[0,1],[1,1],[1,2],[1,3]], color: '#9acd32', name: 'Limette'  },
  { id: 'N5', cells: [[1,0],[1,1],[0,1],[0,2],[0,3]], color: '#c0398b', name: 'Magenta'  },
  { id: 'T5', cells: [[0,0],[1,0],[2,0],[1,1],[1,2]], color: '#c47b2a', name: 'Bernstein'},
];

export const PIECE_MAP = Object.fromEntries(PIECES.map(p => [p.id, p]));

// Zellen auf Ursprung normalisieren (min x/y = 0) und sortieren.
export function normalize(cells) {
  const minX = Math.min(...cells.map(c => c[0]));
  const minY = Math.min(...cells.map(c => c[1]));
  return cells.map(([x, y]) => [x - minX, y - minY])
              .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

export function rotate90(cells)  { return normalize(cells.map(([x, y]) => [-y, x])); }
export function flipX(cells)     { return normalize(cells.map(([x, y]) => [-x, y])); }

function key(cells) { return cells.map(c => c.join(',')).join(';'); }

// Alle eindeutigen Orientierungen (Rotationen x Spiegelung) eines Teils.
export function orientations(cells) {
  const out = [];
  const seen = new Set();
  let cur = normalize(cells);
  for (let f = 0; f < 2; f++) {
    for (let r = 0; r < 4; r++) {
      const k = key(cur);
      if (!seen.has(k)) { seen.add(k); out.push(cur); }
      cur = rotate90(cur);
    }
    cur = flipX(cur);
  }
  return out;
}

// Transformation aus (rot, flip) anwenden – für UI-Steuerung (0-3 Rotationen, flip 0/1).
export function transform(cells, rot, flip) {
  let cur = normalize(cells);
  if (flip) cur = flipX(cur);
  for (let r = 0; r < (rot % 4 + 4) % 4; r++) cur = rotate90(cur);
  return cur;
}

export function bounds(cells) {
  let maxX = 0, maxY = 0;
  for (const [x, y] of cells) { if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
  return { w: maxX + 1, h: maxY + 1 };
}
