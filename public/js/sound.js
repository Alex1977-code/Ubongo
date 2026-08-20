// Klang-Engine: alle Effekte und die Ambient-Musik werden prozedural per
// WebAudio erzeugt – keine Audio-Dateien, keine externen Quellen.
// Wichtig für Handys: Der AudioContext wird erst nach der ersten
// Nutzer-Geste erzeugt bzw. fortgesetzt (unlock()).

const LS_MUTED = 'ubongo.muted';
const LS_MUSIC = 'ubongo.music';

let ctx = null;        // AudioContext (erst nach Nutzer-Geste)
let master = null;     // Summe der Effekte
let musicBus = null;   // Summe der Musik (deutlich leiser als die Effekte)
let noiseBuf = null;   // wiederverwendbarer Rausch-Puffer
let muted = read(LS_MUTED) === '1';    // Standard: Ton an
let musicOn = read(LS_MUSIC) !== '0';  // Standard: Musik an

function read(k) { try { return localStorage.getItem(k); } catch { return null; } }
function write(k, v) { try { localStorage.setItem(k, v); } catch { /* egal */ } }

function ensure() {
  if (!ctx) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0.13;
      musicBus.connect(ctx.destination);
    } catch { return null; }
  }
  if (ctx.state === 'suspended') { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); }
  return ctx;
}

// Bei der ersten Geste aufrufen: erzeugt den AudioContext und startet die Musik.
export function unlock() { if (ensure()) startMusicLoop(); }

export function isMuted() { return muted; }
export function toggleMuted() { muted = !muted; write(LS_MUTED, muted ? '1' : '0'); return muted; }
export function isMusicOn() { return musicOn; }
export function toggleMusic() {
  musicOn = !musicOn;
  write(LS_MUSIC, musicOn ? '1' : '0');
  if (musicOn) unlock();
  return musicOn;
}

// ---------- Grundbausteine ----------
// Einzelner Ton mit weicher Hüllkurve (kurzer Attack, exponentielles Ausklingen).
function tone({ freq = 440, type = 'sine', dur = 0.15, vol = 0.35, delay = 0, slide = 0, attack = 0.005 }) {
  if (muted) return;
  const c = ensure(); if (!c) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

// Gefiltertes Rauschen – für "Klack", Wisch u. Ä.
function noise({ freq = 1000, q = 1, dur = 0.1, vol = 0.3, delay = 0, slide = 0 }) {
  if (muted) return;
  const c = ensure(); if (!c) return;
  if (!noiseBuf) {
    const len = Math.floor(c.sampleRate * 0.4);
    noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(freq, t0);
  f.Q.value = q;
  if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(80, freq + slide), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

// ---------- Effekte ----------
export function pickup()  { tone({ freq: 540, type: 'triangle', dur: 0.05, vol: 0.16 }); }
export function place()   { // sattes "Klack" beim Einrasten
  noise({ freq: 850, q: 1.2, dur: 0.07, vol: 0.5, slide: -500 });
  tone({ freq: 185, type: 'sine', dur: 0.12, vol: 0.5, slide: -55 });
}
export function invalid() { // dumpfer Ton: passt da nicht
  tone({ freq: 150, type: 'sine', dur: 0.22, vol: 0.38, slide: -55 });
  tone({ freq: 110, type: 'sine', dur: 0.22, vol: 0.26, slide: -35, delay: 0.02 });
}
export function rotate()  { tone({ freq: 940, type: 'triangle', dur: 0.035, vol: 0.14 }); }
export function flip()    { noise({ freq: 480, q: 2.2, dur: 0.16, vol: 0.24, slide: 900 }); }
export function countdown() { tone({ freq: 660, type: 'sine', dur: 0.13, vol: 0.32 }); }
export function go() { // Start: höherer, längerer Ton
  tone({ freq: 990, type: 'sine', dur: 0.3, vol: 0.36 });
  tone({ freq: 1320, type: 'sine', dur: 0.24, vol: 0.16, delay: 0.02 });
}
export function solve() { // "UBONGO!"-Fanfare
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.34, vol: 0.3, delay: i * 0.09 }));
  tone({ freq: 1568, type: 'sine', dur: 0.4, vol: 0.12, delay: 0.36 });
  noise({ freq: 2600, q: 0.8, dur: 0.25, vol: 0.1, delay: 0.3, slide: 1500 });
}
export function roundEnd() { // kleine Jingle beim Rundenergebnis
  [659.25, 783.99, 987.77].forEach((f, i) =>
    tone({ freq: f, type: 'triangle', dur: 0.26, vol: 0.24, delay: i * 0.12 }));
}
export function victory() { // Sieg-Fanfare beim Endstand
  const melody = [392, 523.25, 659.25, 783.99, 1046.5];
  melody.forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.32, vol: 0.28, delay: i * 0.11 }));
  [523.25, 659.25, 783.99, 1046.5].forEach(f =>
    tone({ freq: f, type: 'sine', dur: 0.9, vol: 0.14, delay: 0.58 }));
}
export function warn() { // nur noch 10 Sekunden!
  tone({ freq: 523.25, type: 'triangle', dur: 0.14, vol: 0.3 });
  tone({ freq: 523.25, type: 'triangle', dur: 0.14, vol: 0.3, delay: 0.22 });
}
export function hint() { // 💡-Tipp
  tone({ freq: 880, type: 'sine', dur: 0.16, vol: 0.24 });
  tone({ freq: 1174.66, type: 'sine', dur: 0.24, vol: 0.2, delay: 0.1 });
}

// ---------- Ambient-Musik ----------
// Leise Kalimba-artige Schleife: pentatonische Skala, langsames Tempo,
// weiche Hüllkurven, kleine zufällige Variationen. Läuft im Menü und im Spiel.
const SCALE = [196.0, 220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25]; // G-Pentatonik über 2 Oktaven
const STEP = 0.42;   // Sekunden pro Schritt (ruhiges Tempo)
let musicTimer = 0;
let nextStep = 0;
let stepIdx = 0;
let lastDeg = 4;

function pluck(freq, t, vol) {
  // Kalimba-Zunge: Grundton mit langem Ausklang + kurzer, leiser Oberton
  const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = freq;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2.01;
  const g1 = ctx.createGain(), g2 = ctx.createGain();
  g1.gain.setValueAtTime(0, t);
  g1.gain.linearRampToValueAtTime(vol, t + 0.006);
  g1.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
  g2.gain.setValueAtTime(0, t);
  g2.gain.linearRampToValueAtTime(vol * 0.25, t + 0.004);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  o1.connect(g1).connect(musicBus);
  o2.connect(g2).connect(musicBus);
  o1.start(t); o1.stop(t + 1.8);
  o2.start(t); o2.stop(t + 0.6);
}

function scheduleStep(t) {
  const beat = stepIdx % 16;
  if (beat === 0) { pluck(SCALE[0], t, 0.5); return; }       // tiefer Grundton als Anker
  if (beat === 8) { pluck(SCALE[2], t, 0.4); return; }       // sanfte Terz zur Mitte
  if (Math.random() < 0.42) return;                          // Pausen lassen die Musik atmen
  const walk = [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)];
  lastDeg = Math.max(1, Math.min(SCALE.length - 1, lastDeg + walk));
  pluck(SCALE[lastDeg], t + (Math.random() - 0.5) * 0.02, 0.3 + Math.random() * 0.14);
  if (Math.random() < 0.14) pluck(SCALE[Math.max(0, lastDeg - 3)], t + 0.02, 0.16); // dezente Begleitnote
}

function startMusicLoop() {
  if (musicTimer || !ctx) return;
  nextStep = ctx.currentTime + 0.3;
  musicTimer = setInterval(() => {
    if (!ctx) return;
    if (document.hidden) { nextStep = Math.max(nextStep, ctx.currentTime + 0.2); return; }
    while (nextStep < ctx.currentTime + 0.65) {
      if (musicOn && !muted) scheduleStep(nextStep);
      nextStep += STEP;
      stepIdx++;
    }
  }, 250);
}
