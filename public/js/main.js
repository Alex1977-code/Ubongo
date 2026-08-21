// App-Steuerung: Bildschirme, Menüs, Solo-/Online-Start, Highscores, PWA.

import { Game } from './game.js';
import { Net } from './net.js';
import { localScores, onlineScores, getName, setName } from './highscore.js';
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
}
document.querySelectorAll('[data-goto]').forEach(b =>
  b.addEventListener('click', () => {
    const target = b.dataset.goto;
    if (target === 'scores') renderScores('local');
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
const soloRounds = chipGroup('solo-rounds');
const lobbyDiff = chipGroup('lobby-diff', () => sendConfig());
const lobbyRounds = chipGroup('lobby-rounds', () => sendConfig());

// Namen vorbelegen und merken
for (const id of ['solo-name', 'online-name']) {
  $(id).value = getName();
  $(id).addEventListener('input', () => setName($(id).value.trim()));
}

// ---------- Spiel-Lebenszyklus ----------
let game = null;
let net = null;
let isHost = false;

function endGame(backTo = 'start') {
  if (game) { game.destroy(); game = null; }
  if (net) { net.close(); net = null; }
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
$('solo-start').addEventListener('click', () => {
  const name = $('solo-name').value.trim() || 'Du';
  setName(name);
  game = new Game({
    mode: 'solo', name,
    difficulty: soloDiff.get(),
    rounds: parseInt(soloRounds.get(), 10),
    botCount: parseInt(soloBots.get(), 10),
    botSkill: soloSkill.get(),
  });
  show('game');
  game.startSolo();
});

// ---------- Online ----------
function sendConfig() {
  if (net && isHost) net.send({ t: 'config', difficulty: lobbyDiff.get(), rounds: parseInt(lobbyRounds.get(), 10) });
}

async function connect() {
  if (net && net.connected) return net;
  net = new Net();
  net.on('room', (msg) => renderLobby(msg))
     .on('error', (msg) => { $('online-status').textContent = msg.msg; })
     .on('round', (msg) => {
       if (!game) {
         game = new Game({ mode: 'online', name: getName() || 'Spieler',
                           difficulty: msg.difficulty, rounds: msg.of, net });
         show('game');
       }
       game.o.difficulty = msg.difficulty;
       game.onRound(msg);
     })
     .on('progress', (msg) => game && game.onProgress(msg))
     .on('roundResult', (msg) => game && game.onRoundResult(msg))
     .on('final', (msg) => game && game.onFinal(msg))
     .on('_close', () => {
       if (document.querySelector('#screen-lobby.active') || document.querySelector('#screen-game.active')) {
         endGame('online');
         $('online-status').textContent = 'Verbindung getrennt.';
       }
     });
  await net.connect();
  return net;
}

$('online-create').addEventListener('click', async () => {
  const name = $('online-name').value.trim() || 'Spieler';
  setName(name);
  $('online-status').textContent = 'Verbinde …';
  try {
    await connect();
    net.send({ t: 'create', name, difficulty: 'mittel', rounds: 3 });
    $('online-status').textContent = '';
  } catch {
    $('online-status').textContent = 'Kein Server erreichbar. Läuft der Ubongo-Server? (siehe Anleitung)';
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
    $('online-status').textContent = 'Kein Server erreichbar. Läuft der Ubongo-Server? (siehe Anleitung)';
  }
});

function renderLobby(msg) {
  show('lobby');
  $('lobby-code').textContent = msg.code;
  const me = msg.players.find(p => p.id === net.myId);
  isHost = !!(me && me.host);
  $('lobby-players').innerHTML = msg.players.map(p =>
    `<li>${p.host ? '👑' : '🙂'} ${esc(p.name)}${p.id === net.myId ? ' (du)' : ''}` +
    `${p.host ? '<span class="badge">Gastgeber</span>' : ''}</li>`).join('');
  $('lobby-host-controls').classList.toggle('hidden', !isHost);
  $('lobby-wait').classList.toggle('hidden', isHost);
  // Host-Auswahl synchron halten
  document.querySelectorAll('#lobby-diff .chip').forEach(c => c.classList.toggle('active', c.dataset.val === msg.difficulty));
  document.querySelectorAll('#lobby-rounds .chip').forEach(c => c.classList.toggle('active', c.dataset.val === String(msg.rounds)));
}

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
  let list = [];
  if (which === 'local') list = localScores();
  else {
    table.innerHTML = '<tr><td>Lade …</td></tr>';
    try { list = await onlineScores(); }
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
