// Test: 2 Clients verbinden sich, spielen eine Runde, Ergebnis kommt an.
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 3179;
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT }, stdio: 'pipe' });
await new Promise(res => srv.stdout.on('data', d => { if (String(d).includes('läuft')) res(); }));

const url = `ws://localhost:${PORT}/ws`;
const open = (ws) => new Promise(r => ws.on('open', r));
const a = new WebSocket(url), b = new WebSocket(url);
await Promise.all([open(a), open(b)]);

let fails = 0;
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); fails++; } };
const inbox = { a: [], b: [] };
a.on('message', d => inbox.a.push(JSON.parse(d)));
b.on('message', d => inbox.b.push(JSON.parse(d)));
const waitFor = (box, type, ms = 8000) => new Promise((res, rej) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    const i = inbox[box].findIndex(m => m.t === type);
    if (i >= 0) { clearInterval(iv); res(inbox[box].splice(i, 1)[0]); }
    else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error(`Timeout: ${box}/${type}`)); }
  }, 20);
});

try {
  a.send(JSON.stringify({ t: 'create', name: 'Anna', difficulty: 'leicht', rounds: 1 }));
  const roomA = await waitFor('a', 'room');
  assert(/^[A-Z2-9]{4}$/.test(roomA.code), 'Raumcode-Format: ' + roomA.code);

  b.send(JSON.stringify({ t: 'join', code: roomA.code, name: 'Ben' }));
  const roomB = await waitFor('b', 'room');
  assert(roomB.players.length === 2, 'Lobby hat 2 Spieler');

  a.send(JSON.stringify({ t: 'start' }));
  const [ra, rb] = await Promise.all([waitFor('a', 'round'), waitFor('b', 'round')]);
  assert(ra.seed !== rb.seed, 'Jeder Spieler bekommt eigene Karte (Seed)');
  assert(ra.time === 90, 'Rundenzeit leicht = 90s');

  a.send(JSON.stringify({ t: 'solved', ms: 30000 }));
  b.send(JSON.stringify({ t: 'solved', ms: 45000 }));
  const res = await waitFor('a', 'roundResult');
  const anna = res.results.find(r => r.name === 'Anna');
  const ben = res.results.find(r => r.name === 'Ben');
  // Original-Regeln: Erste: Saphir (blau, 3) + 1 Zufallsstein; Zweiter: Bernstein (braun, 1) + 1 Zufallsstein
  assert(anna.gems.length === 2 && anna.gems[0] === 'saphir', `Anna Saphir+Zufall, war ${JSON.stringify(anna.gems)}`);
  assert(ben.gems.length === 2 && ben.gems[0] === 'bernstein', `Ben Bernstein+Zufall, war ${JSON.stringify(ben.gems)}`);
  assert(anna.points >= 4 && anna.points <= 7, `Anna 4-7 Punkte, war ${anna.points}`);
  assert(ben.points >= 2 && ben.points <= 5, `Ben 2-5 Punkte, war ${ben.points}`);

  const fin = await waitFor('a', 'final');
  assert(fin.ranking.length === 2, 'Endstand mit 2 Spielern');
  assert(fin.ranking.every(r => r.gems.length === 2), 'Endstand enthält Edelsteine');
  assert(fin.highscores.some(h => h.name === 'Anna' && h.score === anna.points), 'Highscore gespeichert');
  console.log(fails === 0 ? 'server: alle Tests OK' : `server: ${fails} Fehler`);
} catch (e) {
  console.error('FAIL:', e.message); fails++;
} finally {
  a.close(); b.close(); srv.kill();
}
process.exit(fails === 0 ? 0 : 1);
