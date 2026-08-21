// App-Steuerung: Bildschirme, Menüs, Solo-/Online-Start, Highscores, PWA.

import { Game } from './game.js';
import { Net } from './net.js';
import { localScores, onlineScores, getName, setName, getServer, setServer, getStats } from './highscore.js';
import { gemRow, GEMS } from './gems.js';
import { unlock, isMuted, toggleMuted, isMusicOn, toggleMusic } from './sound.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

// roundRect-Fallback für ältere Browser
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    const rr = Array.isArray(r) ? r : [r, r, r, r];
    this.moveTo(x + rr[0], y);
    this.lineTo(x + w - rr[1], y); this.arcTo(x + w, y, x + w, y + rr[1], rr[1]);
    this.lineTo(x + w, y + h - rr[2]); this.arcTo(x + w, y + h, x + w - rr[2], y + h, rr[2]);
    this.lineTo(x + rr[3], y + h); this.arcTo(x, y + h, x, y + h - rr[3], rr[3]);
    this.lineTo(x, y + rr[0]); this.arcTo(x, y, x + rr[0], y, rr[0]);
    this.closePath();
    return this;
  };
}

// ---------- Klang ----------
// AudioContext erst nach der ersten Nutzer-Geste erzeugen (Pflicht auf Handys).
window.addEventListener('pointerdown', () => unlock(), { once: true });
window.addEventListener('keydown', () => unlock(), { once: true });

const muteBtn = $('ctrl-mute'), musicBtn = $('ctrl-music');
function renderSoundButtons() {
  muteBtn.textContent = isMuted() ? '🔇' : '🔊';
  muteBtn.setAttribute('aria-label', isMuted() ? 'Ton einschalten' : 'Ton ausschalten');
  musicBtn.classList.toggle('off', !isMusicOn());
  musicBtn.setAttribute('aria-label', isMusicOn() ? 'Musik ausschalten' : 'Musik einschalten');
}
muteBtn.addEventListener('click', () => { toggleMuted(); renderSoundButtons(); });
musicBtn.addEventListener('click', () => { toggleMusic(); renderSoundButtons(); });
renderSoundButtons();

// ---------- Bildschirm-Navigation ----------
function show(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('screen-' + name).classList.add('active');
  if (name === 'start') updateQuickStart();
}
document.querySelectorAll('[data-goto]').forEach(b =>
  b.addEventListener('click', () => {
    const target = b.dataset.goto;
    if (target === 'scores') renderScores('local');
    if (target === 'solo') applyLastGameToSetup();
    show(target);
  }));

// ---------- Chip-Gruppen (Auswahl-Knöpfe) ----------
function chipGroup(id, onChange) {
  const host = $(id);
  host.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    host.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    if (onChange) onChange(chip.dataset.val);
  });
  return { get: () => host.querySelector('.chip.active').dataset.val };
}

const soloDiff = chipGroup('solo-diff');
const soloBots = chipGroup('solo-bots');
const soloSkill = chipGroup('solo-skill');
const soloTempo = chipGroup('solo-tempo');
const soloRounds = chipGroup('solo-rounds');
const lobbyDiff = chipGroup('lobby-diff', () => sendConfig());
const lobbyTempo = chipGroup('lobby-tempo', () => sendConfig());
const lobbyRounds = chipGroup('lobby-rounds', () => sendConfig());

// Namen vorbelegen und merken
for (const id of ['solo-name', 'online-name']) {
  $(id).value = getName();
  $(id).addEventListener('input', () => setName($(id).value.trim()));
}

// Spiel-Server-Adresse (für Spiele übers Internet) vorbelegen und merken
$('online-server').value = getServer();
$('online-server').addEventListener('input', () => setServer($('online-server').value.trim()));
const serverBase = () => $('online-server').value.trim();

// ---------- Spiel-Lebenszyklus ----------
let game = null;
let net = null;
let isHost = false;
let sessionToken = null;   // für automatisches Wiederverbinden
let reconnecting = false;

function endGame(backTo = 'start') {
  if (game) { game.destroy(); game = null; }
  if (net) { net.close(); net = null; }
  sessionToken = null;
  reconnecting = false;
  $('net-banner').classList.add('hidden');
  show(backTo);
}

$('game-exit').addEventListener('click', () => {
  if (net) net.send({ t: 'leave' });
  endGame('start');
});
$('ctrl-flip').addEventListener('click', () => game && game.flip());
$('ctrl-solution').addEventListener('click', () => game && game.hint());
$('result-next').addEventListener('click', () => game && game.nextRound());
$('final-menu').addEventListener('click', () => {
  if (net) net.send({ t: 'leave' });
  endGame('start');
});
$('final-again').addEventListener('click', () => {
  if (!game) return;
  if (game.mode === 'solo') {
    const o = game.o;
    game.destroy();
    game = new Game(o);
    game.startSolo();
  } else if (isHost) {
    net.send({ t: 'start' });
  } else {
    $('final-note').textContent = 'Nur der Gastgeber kann neu starten …';
  }
});

// ---------- Solo ----------
const DIFF_LABEL = { leicht: 'Leicht', mittel: 'Mittel', schwer: 'Schwer', experte: 'Experte' };

function lastGame() {
  try { return JSON.parse(localStorage.getItem('ubongo.lastGame')); } catch { return null; }
}

function startSoloGame(cfg) {
  const name = getName() || 'Du';
  try { localStorage.setItem('ubongo.lastGame', JSON.stringify(cfg)); } catch { /* egal */ }
  game = new Game({ mode: 'solo', name, ...cfg });
  show('game');
  game.startSolo();
}

$('solo-start').addEventListener('click', () => {
  setName($('solo-name').value.trim() || 'Du');
  startSoloGame({
    difficulty: soloDiff.get(),
    rounds: parseInt(soloRounds.get(), 10),
    timeFactor: parseFloat(soloTempo.get()),
    botCount: parseInt(soloBots.get(), 10),
    botSkill: soloSkill.get(),
  });
});

// Schnellstart: gleiche Einstellungen wie die letzte Partie
function updateQuickStart() {
  const cfg = lastGame();
  const btn = $('quick-start');
  btn.classList.toggle('hidden', !cfg);
  if (cfg) btn.textContent = `⚡ Schnellstart · ${DIFF_LABEL[cfg.difficulty] || ''} · ${cfg.rounds} Runden`;
}
$('quick-start').addEventListener('click', () => {
  const cfg = lastGame();
  if (cfg) startSoloGame(cfg);
});
updateQuickStart();

// Solo-Setup mit den zuletzt gewählten Einstellungen vorbelegen
function applyLastGameToSetup() {
  const cfg = lastGame();
  if (!cfg) return;
  const apply = (id, val) => document.querySelectorAll(`#${id} .chip`)
    .forEach(c => c.classList.toggle('active', c.dataset.val === String(val)));
  apply('solo-diff', cfg.difficulty);
  apply('solo-bots', cfg.botCount);
  apply('solo-skill', cfg.botSkill);
  apply('solo-rounds', cfg.rounds);
  apply('solo-tempo', cfg.timeFactor);
}

// ---------- Online ----------
function sendConfig() {
  if (net && isHost) net.send({ t: 'config', difficulty: lobbyDiff.get(),
    rounds: parseInt(lobbyRounds.get(), 10), timeFactor: parseFloat(lobbyTempo.get()) });
}

async function connect() {
  if (net && net.connected) return net;
  net = new Net();
  net.on('you', (msg) => { if (msg.token) sessionToken = msg.token; })
     .on('room', (msg) => renderLobby(msg))
     .on('error', (msg) => {
       $('online-status').textContent = msg.msg;
       if (document.querySelector('#screen-lobby.active')) $('lobby-status').textContent = msg.msg;
       if (msg.fatal) endGame('online');
     })
     .on('round', (msg) => {
       if (!game) {
         game = new Game({ mode: 'online', name: getName() || 'Spieler',
                           difficulty: msg.difficulty, rounds: msg.of, net });
         show('game');
       }
       game.o.net = net;
       game.o.difficulty = msg.difficulty;
       game.onRound(msg);
     })
     .on('progress', (msg) => game && game.onProgress(msg))
     .on('roundResult', (msg) => game && game.onRoundResult(msg))
     .on('final', (msg) => game && game.onFinal(msg))
     .on('_close', () => handleDisconnect());
  await net.connect(serverBase());
  return net;
}

$('online-create').addEventListener('click', async () => {
  const name = $('online-name').value.trim() || 'Spieler';
  setName(name);
  $('online-status').textContent = 'Verbinde …';
  try {
    await connect();
    net.send({ t: 'create', name, difficulty: 'mittel', rounds: 9 });
    $('online-status').textContent = '';
  } catch {
    $('online-status').textContent = serverBase()
      ? 'Server nicht erreichbar – Adresse prüfen (gehostete Gratis-Server brauchen beim Aufwachen ca. 30 s, einfach nochmal tippen).'
      : 'Kein Server erreichbar. Im WLAN die Server-Adresse direkt öffnen oder unten einen Spiel-Server eintragen.';
  }
});

$('online-join').addEventListener('click', async () => {
  const name = $('online-name').value.trim() || 'Spieler';
  const code = $('online-code').value.trim().toUpperCase();
  setName(name);
  if (code.length !== 4) { $('online-status').textContent = 'Bitte den 4-stelligen Raumcode eingeben.'; return; }
  $('online-status').textContent = 'Verbinde …';
  try {
    await connect();
    net.send({ t: 'join', code, name });
    $('online-status').textContent = '';
  } catch {
    $('online-status').textContent = serverBase()
      ? 'Server nicht erreichbar – Adresse prüfen (gehostete Gratis-Server brauchen beim Aufwachen ca. 30 s, einfach nochmal tippen).'
      : 'Kein Server erreichbar. Im WLAN die Server-Adresse direkt öffnen oder unten einen Spiel-Server eintragen.';
  }
});

function renderLobby(msg) {
  if (game && game.mode === 'online') { game.setRoster(msg.players); return; } // mitten im Spiel: nur Namen aktualisieren
  show('lobby');
  $('lobby-code').textContent = msg.code;
  const me = msg.players.find(p => p.id === net.myId);
  isHost = !!(me && me.host);
  $('lobby-players').innerHTML = msg.players.map(p =>
    `<li class="${p.online === false ? 'offline' : ''}">${p.host ? '👑' : '🙂'} ${esc(p.name)}` +
    `${p.id === net.myId ? ' (du)' : ''}${p.online === false ? ' 📴' : ''}` +
    `${p.host ? '<span class="badge">Gastgeber</span>' : ''}</li>`).join('');
  $('lobby-host-controls').classList.toggle('hidden', !isHost);
  $('lobby-wait').classList.toggle('hidden', isHost);
  // Start erst ab 2 Spielern - vorher klar machen, worauf gewartet wird
  const alone = msg.players.length < 2;
  const startBtn = $('lobby-start');
  startBtn.disabled = alone;
  startBtn.textContent = alone ? '⏳ Warten auf Mitspieler …' : 'Spiel starten';
  $('lobby-status').textContent = alone
    ? 'Mindestens 2 Spieler nötig – gib den Raumcode weiter! Deine Freunde brauchen denselben Spiel-Link und dieselbe Server-Adresse.'
    : '';
  // Host-Auswahl synchron halten
  document.querySelectorAll('#lobby-diff .chip').forEach(c => c.classList.toggle('active', c.dataset.val === msg.difficulty));
  document.querySelectorAll('#lobby-rounds .chip').forEach(c => c.classList.toggle('active', c.dataset.val === String(msg.rounds)));
  document.querySelectorAll('#lobby-tempo .chip').forEach(c => c.classList.toggle('active', parseFloat(c.dataset.val) === (msg.timeFactor || 1)));
}

// Unerwarteter Verbindungsabbruch: mit dem Sitzungs-Token zurück in den Raum.
// Absichtliches Verlassen läuft über net.close(), das kein _close auslöst.
function handleDisconnect() {
  const active = document.querySelector('#screen-lobby.active') ||
    (document.querySelector('#screen-game.active') && game && game.mode === 'online');
  if (!active) return;
  if (!sessionToken) {
    endGame('online');
    $('online-status').textContent = 'Verbindung getrennt.';
    return;
  }
  attemptReconnect();
}

async function attemptReconnect() {
  if (reconnecting) return;
  reconnecting = true;
  $('net-banner').classList.remove('hidden');
  for (let i = 0; i < 24 && reconnecting; i++) {
    try {
      net = null;                              // alte Verbindung verwerfen
      await connect();                         // neu verbinden (Handler inklusive)
      net.send({ t: 'rejoin', token: sessionToken });
      if (game) game.o.net = net;
      reconnecting = false;
      $('net-banner').classList.add('hidden');
      return;
    } catch {
      await new Promise(r => setTimeout(r, 2500));
    }
  }
  reconnecting = false;
  $('net-banner').classList.add('hidden');
  endGame('online');
  $('online-status').textContent = 'Verbindung verloren – bitte neu beitreten.';
}

// Handy-Bildschirm wieder an: sofort neu verbinden statt zu warten
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && sessionToken && (!net || !net.connected)) handleDisconnect();
});

$('lobby-start').addEventListener('click', () => net && net.send({ t: 'start' }));
$('lobby-leave').addEventListener('click', () => {
  if (net) net.send({ t: 'leave' });
  endGame('online');
});

// ---------- Highscores ----------
document.querySelectorAll('.tab').forEach(t =>
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    renderScores(t.dataset.tab);
  }));

async function renderScores(which) {
  const table = $('score-table');
  const empty = $('scores-empty');
  if (which === 'stats') { renderStats(table, empty); return; }
  let list = [];
  if (which === 'local') list = localScores();
  else {
    table.innerHTML = '<tr><td>Lade …</td></tr>';
    try { list = await onlineScores(getServer()); }
    catch {
      table.innerHTML = '';
      empty.classList.remove('hidden');
      empty.textContent = 'Online-Highscores brauchen eine Verbindung zum Ubongo-Server.';
      return;
    }
  }
  empty.classList.toggle('hidden', list.length > 0);
  empty.textContent = 'Noch keine Einträge – spiel eine Partie!';
  const diffLabel = { leicht: 'Leicht', mittel: 'Mittel', schwer: 'Schwer', experte: 'Experte' };
  table.innerHTML = list.length === 0 ? '' :
    '<tr><th>#</th><th>Name</th><th>Stufe</th><th>Datum</th><th>Punkte</th></tr>' +
    list.slice(0, 25).map((s, i) =>
      `<tr><td>${i + 1}.</td><td>${esc(s.name)}</td><td>${diffLabel[s.difficulty] || ''}</td>` +
      `<td>${esc(s.date || '')}</td><td>${s.score}</td></tr>`).join('');
}

// Persönliche Statistik (dieses Handy)
function renderStats(table, empty) {
  const s = getStats();
  if (!s || s.games === 0) {
    table.innerHTML = '';
    empty.classList.remove('hidden');
    empty.textContent = 'Noch keine Partien – spiel eine Runde!';
    return;
  }
  empty.classList.add('hidden');
  const quote = Math.round((s.wins / s.games) * 100);
  const best = s.bestMs != null ? (s.bestMs / 1000).toFixed(1).replace('.', ',') + ' s' : '–';
  const gemList = Object.entries(s.gems).flatMap(([t, n]) => Array(n).fill(t));
  const gemValue = Object.entries(s.gems).reduce((sum, [t, n]) => sum + n * GEMS[t].value, 0);
  table.innerHTML =
    `<tr><td>🎮 Partien</td><td>${s.games}</td></tr>` +
    `<tr><td>🏆 Siege</td><td>${s.wins} (${quote} %)</td></tr>` +
    `<tr><td>🧩 Gelöste Karten</td><td>${s.solved}</td></tr>` +
    `<tr><td>⚡ Schnellste Karte</td><td>${best}</td></tr>` +
    `<tr><td>⭐ Punkte gesamt</td><td>${s.points}</td></tr>` +
    `<tr><td>💎 Schatzkammer</td><td class="gem-cell">${gemRow(gemList, 16)}${gemList.length ? ` <b>= ${gemValue}</b>` : ''}</td></tr>`;
}

// ---------- PWA ----------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Raumcode-Eingabe: automatisch Großbuchstaben
$('online-code').addEventListener('input', () => {
  $('online-code').value = $('online-code').value.toUpperCase().replace(/[^A-Z2-9]/g, '');
});

// Für Tests / Debugging
window.__ubongo = { get game() { return game; }, show };
