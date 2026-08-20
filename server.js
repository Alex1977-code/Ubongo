// Ubongo-Server: liefert die App aus und verbindet Handys über WebSocket-Räume.
// Start:  npm start   (Port über PORT-Umgebungsvariable, Standard 3000)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { generateCard, DIFFICULTIES } from './public/js/cardgen.js';
import { roundGems, gemPoints } from './public/js/gems.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;
const HS_FILE = path.join(__dirname, 'highscores.json');

// ---------- Highscores (serverweit, persistent) ----------
let highscores = [];
try { highscores = JSON.parse(fs.readFileSync(HS_FILE, 'utf8')); } catch { /* leer starten */ }

function addHighscore(entry) {
  highscores.push(entry);
  highscores.sort((a, b) => b.score - a.score);
  highscores = highscores.slice(0, 50);
  fs.writeFile(HS_FILE, JSON.stringify(highscores, null, 2), () => {});
}

// ---------- Statische Dateien ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/highscores') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(highscores));
    return;
  }
  let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Nicht gefunden'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- Mehrspieler-Räume ----------
const rooms = new Map(); // code -> Room
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O/1/I

function newCode() {
  let code;
  do { code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

let nextPlayerId = 1;

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function lobbyState(room) {
  return {
    t: 'room', code: room.code, difficulty: room.difficulty, rounds: room.rounds,
    players: room.players.map(p => ({ id: p.id, name: p.name, host: p.id === room.hostId, total: p.total })),
  };
}

function broadcast(room, msg) { for (const p of room.players) send(p.ws, msg); }

function startRound(room) {
  room.round++;
  room.state = 'playing';
  const time = DIFFICULTIES[room.difficulty].time;
  room.deadline = Date.now() + (time + 8) * 1000; // + Puffer für Countdown/Latenz
  for (const p of room.players) {
    p.ms = null; p.done = false;
    p.seed = Math.floor(Math.random() * 2 ** 31);
    generateCard(p.seed, room.difficulty); // Validierung serverseitig (deterministisch)
    send(p.ws, { t: 'round', n: room.round, of: room.rounds, seed: p.seed, time, difficulty: room.difficulty });
  }
  clearTimeout(room.timer);
  room.timer = setTimeout(() => finishRound(room), (time + 10) * 1000);
}

function progress(room) {
  broadcast(room, { t: 'progress', players: room.players.map(p => ({ id: p.id, done: p.done, ms: p.ms })) });
}

function finishRound(room) {
  if (room.state !== 'playing') return;
  room.state = 'between';
  clearTimeout(room.timer);
  // Edelstein-Wertung wie im Original: Schnellster Saphir (4), Zweiter Rubin (3),
  // Dritter Smaragd (2), jeder Löser zusätzlich Bernstein (1).
  const finished = room.players.filter(p => p.done && p.ms !== null).sort((a, b) => a.ms - b.ms);
  const results = room.players.map(p => {
    const gems = roundGems(finished.indexOf(p), p.done && p.ms !== null);
    const pts = gemPoints(gems);
    p.total += pts;
    p.gems.push(...gems);
    return { id: p.id, name: p.name, ms: p.ms, gems, points: pts, total: p.total };
  });
  broadcast(room, { t: 'roundResult', n: room.round, of: room.rounds, results });
  if (room.round >= room.rounds) {
    room.state = 'final';
    const ranking = room.players.map(p => ({ id: p.id, name: p.name, total: p.total, gems: p.gems }))
      .sort((a, b) => b.total - a.total);
    for (const p of room.players) {
      addHighscore({ name: p.name, score: p.total, difficulty: room.difficulty, date: new Date().toISOString().slice(0, 10), online: true });
    }
    broadcast(room, { t: 'final', ranking, highscores });
  } else {
    setTimeout(() => { if (rooms.has(room.code) && room.state === 'between') startRound(room); }, 6000);
  }
}

function leaveRoom(ws) {
  const room = ws.room;
  if (!room) return;
  const idx = room.players.findIndex(p => p.ws === ws);
  if (idx >= 0) room.players.splice(idx, 1);
  ws.room = null;
  if (room.players.length === 0) {
    clearTimeout(room.timer);
    rooms.delete(room.code);
    return;
  }
  if (!room.players.some(p => p.id === room.hostId)) room.hostId = room.players[0].id;
  broadcast(room, lobbyState(room));
  if (room.state === 'playing' && room.players.every(p => p.done)) finishRound(room);
}

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const room = ws.room;
    const clean = (s) => String(s || '').slice(0, 20).replace(/[<>&"]/g, '').trim();

    switch (msg.t) {
      case 'create': {
        const code = newCode();
        const diff = DIFFICULTIES[msg.difficulty] ? msg.difficulty : 'mittel';
        const rounds = Math.min(9, Math.max(1, msg.rounds | 0)) || 3;
        const player = { id: nextPlayerId++, ws, name: clean(msg.name) || 'Spieler', total: 0, gems: [], done: false, ms: null };
        const r = { code, players: [player], hostId: player.id, difficulty: diff, rounds, round: 0, state: 'lobby', timer: null };
        rooms.set(code, r);
        ws.room = r;
        send(ws, { t: 'you', id: player.id });
        broadcast(r, lobbyState(r));
        break;
      }
      case 'join': {
        const r = rooms.get(String(msg.code || '').toUpperCase().trim());
        if (!r) { send(ws, { t: 'error', msg: 'Raum nicht gefunden.' }); return; }
        if (r.state !== 'lobby') { send(ws, { t: 'error', msg: 'Das Spiel läuft bereits.' }); return; }
        if (r.players.length >= 8) { send(ws, { t: 'error', msg: 'Der Raum ist voll (max. 8).' }); return; }
        const player = { id: nextPlayerId++, ws, name: clean(msg.name) || 'Spieler', total: 0, gems: [], done: false, ms: null };
        r.players.push(player);
        ws.room = r;
        send(ws, { t: 'you', id: player.id });
        broadcast(r, lobbyState(r));
        break;
      }
      case 'config': { // Host ändert Einstellungen in der Lobby
        if (!room || room.state !== 'lobby') return;
        const me = room.players.find(p => p.ws === ws);
        if (!me || me.id !== room.hostId) return;
        if (DIFFICULTIES[msg.difficulty]) room.difficulty = msg.difficulty;
        if (msg.rounds) room.rounds = Math.min(9, Math.max(1, msg.rounds | 0));
        broadcast(room, lobbyState(room));
        break;
      }
      case 'start': {
        if (!room || (room.state !== 'lobby' && room.state !== 'final')) return;
        const me = room.players.find(p => p.ws === ws);
        if (!me || me.id !== room.hostId) return;
        if (room.players.length < 2) { send(ws, { t: 'error', msg: 'Mindestens 2 Spieler nötig.' }); return; }
        if (room.state === 'final') { room.round = 0; for (const p of room.players) { p.total = 0; p.gems = []; } }
        startRound(room);
        break;
      }
      case 'solved': {
        if (!room || room.state !== 'playing') return;
        const me = room.players.find(p => p.ws === ws);
        if (!me || me.done) return;
        me.done = true;
        me.ms = Math.min(Math.max(0, msg.ms | 0), DIFFICULTIES[room.difficulty].time * 1000);
        progress(room);
        if (room.players.every(p => p.done)) finishRound(room);
        break;
      }
      case 'dnf': { // Zeit abgelaufen beim Client
        if (!room || room.state !== 'playing') return;
        const me = room.players.find(p => p.ws === ws);
        if (!me || me.done) return;
        me.done = true; me.ms = null;
        progress(room);
        if (room.players.every(p => p.done)) finishRound(room);
        break;
      }
      case 'leave': leaveRoom(ws); break;
    }
  });
  ws.on('close', () => leaveRoom(ws));
});

server.listen(PORT, () => {
  console.log(`Ubongo läuft auf http://localhost:${PORT}`);
  console.log('Im WLAN erreichbar unter der IP dieses Rechners, z. B. http://192.168.x.x:' + PORT);
});
