// Edelsteine wie im Original: Wer löst, sammelt Steine – am Ende zählt ihr Wert.
// Die Steine werden als SVG in Form unregelmäßiger Rohkristalle gezeichnet
// (Facetten-Splitter, Glanzlicht, Funkeln) und sowohl vom Client (Anzeige)
// als auch vom Server (Wertung: roundGems/gemPoints) genutzt. Die Rendering-
// Funktionen erzeugen reine Strings und bleiben dadurch in Node importierbar.

export const GEMS = {
  rubin:     { value: 4, name: 'Rubin (rot)',        c1: '#ff9a9a', c2: '#e0223a', c3: '#7c0a1e' },
  saphir:    { value: 3, name: 'Saphir (blau)',      c1: '#9ec8ff', c2: '#2f6fed', c3: '#0d2f86' },
  smaragd:   { value: 2, name: 'Smaragd (grün)',     c1: '#9af0bc', c2: '#1fa860', c3: '#07502c' },
  bernstein: { value: 1, name: 'Bernstein (braun)',  c1: '#eab36e', c2: '#a9672a', c3: '#553008' },
};

const TYPES = ['rubin', 'saphir', 'smaragd', 'bernstein'];

// Edelstein-Vergabe pro Runde (wie im Original):
//  Nur wer VOR Ablauf der Zeit löst, bekommt etwas.
//  Schnellster: blauer Saphir + 1 zufälliger Stein
//  Zweiter:     brauner Bernstein + 1 zufälliger Stein
//  Alle weiteren Löser: 1 zufälliger Stein
//  Wurde der 💡-Tipp benutzt, entfällt der zufällige Stein.
export function roundGems(rank, solved, hintUsed = false, rand = Math.random) {
  if (!solved) return [];
  const g = [];
  if (rank === 0) g.push('saphir');
  else if (rank === 1) g.push('bernstein');
  if (!hintUsed) g.push(TYPES[Math.floor(rand() * TYPES.length)]);
  return g;
}

export const gemPoints = (gems) => gems.reduce((s, t) => s + (GEMS[t]?.value || 0), 0);

// ---------- SVG-Rendering (nur im Browser genutzt, reine String-Erzeugung) ----------
let uid = 0;

const pts2str = (pts) => pts.map(p => p[0] + ',' + p[1]).join(' ');

// Pro Typ eine fest definierte, unregelmäßige Rohkristall-Silhouette
// (7–9 Eckpunkte, asymmetrisch) mit hellem Kern, Glanzlicht und Funkel-Sternen.
const SHAPES = {
  rubin: {     // hoch und spitz
    pts: [[48, 3], [76, 14], [93, 42], [86, 70], [64, 95], [36, 92], [10, 66], [16, 24]],
    core: [42, 36], hi: { x: 38, y: 26, rx: 15, ry: 7, rot: -30 },
    sparks: [[71, 22, 7, 0], [27, 56, 4.5, -0.9], [58, 78, 3.5, -1.6]],
  },
  saphir: {    // schlanker Säulenkristall
    pts: [[38, 4], [68, 9], [88, 32], [83, 66], [58, 96], [27, 85], [12, 40]],
    core: [45, 34], hi: { x: 41, y: 26, rx: 14, ry: 6.5, rot: -24 },
    sparks: [[66, 20, 6.5, -0.4], [24, 52, 4, -1.3], [62, 72, 3.5, -2.1]],
  },
  smaragd: {   // breiter, kantiger Brocken
    pts: [[30, 8], [58, 3], [80, 17], [94, 44], [87, 68], [68, 92], [39, 95], [13, 74], [7, 36]],
    core: [40, 40], hi: { x: 35, y: 28, rx: 16, ry: 7, rot: -18 },
    sparks: [[72, 26, 7, -0.7], [24, 62, 4.5, -1.5], [56, 80, 3.5, 0]],
  },
  bernstein: { // rundlicher Klumpen
    pts: [[42, 6], [70, 11], [90, 35], [92, 62], [71, 90], [42, 96], [14, 72], [9, 33]],
    core: [46, 38], hi: { x: 42, y: 28, rx: 15, ry: 7.5, rot: -26 },
    sparks: [[70, 22, 6, -1.1], [26, 54, 4.5, 0], [60, 76, 3.5, -1.9]],
  },
};

// Kleiner vierstrahliger Funkel-Stern; das Pulsieren übernimmt CSS
// (.gem .spark – nur bei prefers-reduced-motion: no-preference animiert).
const sparkStar = ([x, y, r, delay]) =>
  `<path class="spark" style="animation-delay:${delay}s" fill="#fff" opacity="0.85" d="M ${x} ${y - r} ` +
  `L ${x + r * 0.3} ${y - r * 0.3} L ${x + r} ${y} L ${x + r * 0.3} ${y + r * 0.3} ` +
  `L ${x} ${y + r} L ${x - r * 0.3} ${y + r * 0.3} L ${x - r} ${y} L ${x - r * 0.3} ${y - r * 0.3} Z"/>`;

// Unregelmäßiger, halbtransparenter Rohkristall als Inline-SVG.
export function gemSVG(type, size = 24) {
  const g = GEMS[type] || GEMS.bernstein;
  const s = SHAPES[type] || SHAPES.bernstein;
  const id = 'gem' + (++uid);
  const [kx, ky] = s.core;
  const n = s.pts.length;
  // Facetten-Splitter: Bruchflächen vom hellen Kern zu den Außenkanten,
  // abwechselnd hell/dunkel, dazu feine Bruchlinien.
  let facets = '';
  for (let i = 0; i < n; i++) {
    const a = s.pts[i], b = s.pts[(i + 1) % n];
    const light = i % 2 === 0;
    facets += `<polygon points="${kx},${ky} ${a[0]},${a[1]} ${b[0]},${b[1]}" fill="${light ? '#ffffff' : '#000000'}" opacity="${light ? 0.12 : 0.15}"/>`;
    if (i % 2 === 0) facets += `<line x1="${kx}" y1="${ky}" x2="${a[0]}" y2="${a[1]}" stroke="${g.c3}" stroke-width="0.9" opacity="0.35"/>`;
  }
  const hi = s.hi;
  return `<svg class="gem" width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="${g.name}">
  <defs>
    <radialGradient id="${id}b" cx="${kx}" cy="${ky}" r="64" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="22%" stop-color="${g.c1}"/>
      <stop offset="62%" stop-color="${g.c2}"/>
      <stop offset="100%" stop-color="${g.c3}"/>
    </radialGradient>
  </defs>
  <ellipse cx="52" cy="90" rx="32" ry="6" fill="#000" opacity="0.26"/>
  <polygon points="${pts2str(s.pts)}" fill="url(#${id}b)" fill-opacity="0.85" stroke="${g.c3}" stroke-width="2.5" stroke-linejoin="round"/>
  ${facets}
  <ellipse cx="${hi.x}" cy="${hi.y}" rx="${hi.rx}" ry="${hi.ry}" fill="#fff" opacity="0.55" transform="rotate(${hi.rot} ${hi.x} ${hi.y})"/>
  <ellipse cx="${kx + 18}" cy="${ky + 26}" rx="7" ry="3.5" fill="#fff" opacity="0.16" transform="rotate(-24 ${kx + 18} ${ky + 26})"/>
  ${s.sparks.map(sparkStar).join('')}
</svg>`;
}

// ---------- Bild-Assets (optional) ----------
// Der Client meldet hier (assets.js/main.js) eine Funktion an, die für einen
// Edelstein-Typ die URL eines geladenen PNGs liefert – oder null. Ohne
// Anmeldung (z. B. in Node) bleibt immer das SVG aktiv.
let gemAssetURL = null;
export function useGemAssets(fn) { gemAssetURL = fn; }

// Edelstein als HTML: PNG-Bild, wenn vorhanden, sonst das prozedurale SVG.
export function gemHTML(type, size = 24) {
  const g = GEMS[type] || GEMS.bernstein;
  const src = gemAssetURL && gemAssetURL(type);
  if (src) return `<img class="gem gem-img" src="${src}" width="${size}" height="${size}" alt="${g.name}">`;
  return gemSVG(type, size);
}

// Gruppierte Anzeige einer Sammlung, z. B. für Tabellen: [🔷×2 🔶×1]
export function gemRow(gems, size = 18) {
  if (!gems || gems.length === 0) return '<span class="gem-none">–</span>';
  const count = {};
  for (const t of gems) count[t] = (count[t] || 0) + 1;
  return ['rubin', 'saphir', 'smaragd', 'bernstein']
    .filter(t => count[t])
    .map(t => `<span class="gem-group">${gemHTML(t, size)}${count[t] > 1 ? `<b>×${count[t]}</b>` : ''}</span>`)
    .join('');
}
