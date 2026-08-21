// Bild-Assets: optionale (z. B. KI-generierte) PNGs aus public/img/.
// Jede Datei wird einzeln und fehlertolerant geladen – fehlt ein Bild,
// bleibt die bisherige prozedurale Grafik (SVG/Canvas) einfach aktiv.
//
// Absichtlich per fetch statt <img src>: Ein 404 einer fehlenden Datei
// erzeugt so keinen Fehler in der Browser-Konsole.

const FILES = [
  'bg-menu', 'bg-game', 'wood', 'emblem', 'mascot',
  'bg-menu-dschungel', 'bg-game-dschungel',           // Thema: Dschungel bei Nacht
  'bg-menu-wueste', 'bg-game-wueste',                 // Thema: Wüste
  'mascot-ubongo', 'mascot-sieg', 'mascot-trost',     // Maskottchen-Reaktionen
  'sieg-szene',                                       // Hintergrund des Endstands bei Sieg
  'gem-rubin', 'gem-saphir', 'gem-smaragd', 'gem-bernstein',
  'avatar-1', 'avatar-2', 'avatar-3', 'avatar-4',
  'avatar-5', 'avatar-6', 'avatar-7', 'avatar-8',
];

const urls = new Map();   // name -> Objekt-URL (für <img src> / CSS)
const imgs = new Map();   // name -> fertig dekodiertes Image (für Canvas)
let loading = null;

async function loadOne(name) {
  try {
    const res = await fetch('img/' + name + '.png');
    if (!res.ok) return;                       // Datei gibt es (noch) nicht
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = url; });
    urls.set(name, url);
    imgs.set(name, img);
  } catch { /* kein Bild oder kein gültiges PNG – prozeduraler Fallback */ }
}

// Einmalig beim App-Start aufrufen (nicht blockierend fürs UI).
export function loadAssets() {
  if (!loading) loading = Promise.all(FILES.map(loadOne)).then(() => {});
  return loading;
}

export const asset = (name) => imgs.get(name) || null;      // Image | null
export const assetURL = (name) => urls.get(name) || null;   // URL | null
export const hasAsset = (name) => imgs.has(name);
