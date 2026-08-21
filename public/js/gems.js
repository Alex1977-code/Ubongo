// Edelsteine wie im Original: Wer löst, sammelt Steine – am Ende zählt ihr Wert.
// Die Steine werden als SVG im Brillantschliff gezeichnet (Facetten, Glanzlicht,
// Funkeln) und sowohl vom Client (Anzeige) als auch vom Server (Wertung) genutzt.

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

// ---------- SVG-Rendering (nur im Browser genutzt) ----------
let uid = 0;

function polygon(cx, cy, r, n, rot) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i * 2 * Math.PI) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}
const pts2str = (pts) => pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');

// Realistischer Edelstein im Brillantschliff (Draufsicht) als Inline-SVG.
export function gemSVG(type, size = 24) {
  const g = GEMS[type] || GEMS.bernstein;
  const id = 'gem' + (++uid);
  const outer = polygon(50, 50, 46, 8, -Math.PI / 8);   // Rondiste (Außenkante)
  const table = polygon(50, 47, 22, 8, -Math.PI / 8);   // Tafel, leicht nach oben versetzt
  // Kronen-Facetten zwischen Außenkante und Tafel, abwechselnd hell/dunkel
  let facets = '';
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    const quad = [outer[i], outer[j], table[j], table[i]];
    const light = i % 2 === 0;
    facets += `<polygon points="${pts2str(quad)}" fill="${light ? '#ffffff' : '#000000'}" opacity="${light ? 0.16 : 0.18}"/>`;
    facets += `<line x1="${outer[i][0].toFixed(1)}" y1="${outer[i][1].toFixed(1)}" x2="${table[i][0].toFixed(1)}" y2="${table[i][1].toFixed(1)}" stroke="${g.c3}" stroke-width="0.8" opacity="0.5"/>`;
  }
  return `<svg class="gem" width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="${g.name}">
  <defs>
    <radialGradient id="${id}b" cx="38%" cy="30%" r="80%">
      <stop offset="0%" stop-color="${g.c1}"/>
      <stop offset="52%" stop-color="${g.c2}"/>
      <stop offset="100%" stop-color="${g.c3}"/>
    </radialGradient>
    <radialGradient id="${id}t" cx="42%" cy="35%" r="70%">
      <stop offset="0%" stop-color="${g.c1}"/>
      <stop offset="70%" stop-color="${g.c2}"/>
      <stop offset="100%" stop-color="${g.c2}"/>
    </radialGradient>
  </defs>
  <ellipse cx="52" cy="88" rx="34" ry="7" fill="#000" opacity="0.28"/>
  <polygon points="${pts2str(outer)}" fill="url(#${id}b)" stroke="${g.c3}" stroke-width="2.5" stroke-linejoin="round"/>
  ${facets}
  <polygon points="${pts2str(table)}" fill="url(#${id}t)" stroke="${g.c3}" stroke-width="0.8" opacity="0.98"/>
  <ellipse cx="41" cy="33" rx="15" ry="7.5" fill="#fff" opacity="0.5" transform="rotate(-22 41 33)"/>
  <ellipse cx="62" cy="64" rx="7" ry="3.5" fill="#fff" opacity="0.14" transform="rotate(-22 62 64)"/>
  <path d="M 74 22 l 2.6 6.4 6.4 2.6 -6.4 2.6 -2.6 6.4 -2.6 -6.4 -6.4 -2.6 6.4 -2.6 Z" fill="#fff" opacity="0.9"/>
</svg>`;
}

// Gruppierte Anzeige einer Sammlung, z. B. für Tabellen: [🔷×2 🔶×1]
export function gemRow(gems, size = 18) {
  if (!gems || gems.length === 0) return '<span class="gem-none">–</span>';
  const count = {};
  for (const t of gems) count[t] = (count[t] || 0) + 1;
  return ['rubin', 'saphir', 'smaragd', 'bernstein']
    .filter(t => count[t])
    .map(t => `<span class="gem-group">${gemSVG(t, size)}${count[t] > 1 ? `<b>×${count[t]}</b>` : ''}</span>`)
    .join('');
}
