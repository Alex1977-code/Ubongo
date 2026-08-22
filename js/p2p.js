// Direktverbindung zwischen zwei Handys per WebRTC-Datenkanal – ganz ohne
// Spiel-Server. Die Kopplung läuft über QR-Codes (oder Codes zum Einfügen):
// Gastgeber zeigt einen Einladungs-Code, der Gast antwortet mit seinem Code.
//
// Der Gastgeber-Browser übernimmt dabei die Rolle des Servers: LocalRoom
// bildet die Raum-Logik aus server.js für genau 2 Spieler nach und spricht
// dasselbe Nachrichten-Protokoll ('room', 'round', 'progress', …). Dadurch
// funktionieren Lobby und Spielablauf unverändert.

import { generateCard, DIFFICULTIES, roundSetup } from './cardgen.js';
import { roundGems, gemPoints } from './gems.js';

// STUN hilft, wenn beide Handys Internet haben, schadet offline aber nicht:
// lokale (WLAN-/Hotspot-)Kandidaten werden immer zuerst gesammelt.
const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const GATHER_MS = 3500; // offline nicht ewig auf STUN warten

// ---------- Kopplungs-Codes: JSON -> deflate -> base64url ----------

function b64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function pump(stream) { // ReadableStream -> Uint8Array
  const chunks = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

export async function encodeSignal(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'function') {
    const zipped = await pump(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw')));
    return 'U1.' + b64url(zipped);
  }
  return 'U0.' + b64url(raw); // sehr alte Browser: unkomprimiert
}

export async function decodeSignal(code) {
  code = String(code || '').trim();
  const link = code.match(/#d[ua]=([^&\s]+)/); // auch komplette Spiel-Links annehmen
  if (link) code = link[1];
  const dot = code.indexOf('.');
  if (dot < 0) throw new Error('Kein gültiger Kopplungs-Code');
  const v = code.slice(0, dot);
  const bytes = b64urlDecode(code.slice(dot + 1));
  let raw = bytes;
  if (v === 'U1') raw = await pump(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')));
  else if (v !== 'U0') throw new Error('Unbekanntes Code-Format');
  return JSON.parse(new TextDecoder().decode(raw));
}

function gatherIce(pc) { // warten, bis alle Verbindungswege gesammelt sind
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', onChange); resolve(); };
    const onChange = () => { if (pc.iceGatheringState === 'complete') done(); };
    const t = setTimeout(done, GATHER_MS);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

// ---------- Gemeinsames Kanal-Handling ----------

function safeClose(x) { try { x && x.close(); } catch { /* egal */ } }

// ---------- Gast: verbindet sich zum Gastgeber ----------

export class DirectGuest {
  constructor(name) {
    this.direct = true;
    this.name = name || 'Spieler';
    this.handlers = {};
    this.pc = null;
    this.ch = null;
    this.myId = 2;
    this._closed = false;
  }

  on(type, fn) { this.handlers[type] = fn; return this; }
  _emit(msg) { (this.handlers[msg.t] || (() => {}))(msg); }

  // Aus dem Einladungs-Code des Gastgebers den Antwort-Code erzeugen.
  async answer(offerCode) {
    const offer = typeof offerCode === 'string' ? await decodeSignal(offerCode) : offerCode;
    const pc = this.pc = new RTCPeerConnection(RTC_CONFIG);
    pc.ondatachannel = (e) => this._wire(e.channel);
    await pc.setRemoteDescription({ type: 'offer', sdp: offer.s });
    await pc.setLocalDescription(await pc.createAnswer());
    await gatherIce(pc);
    return encodeSignal({ s: pc.localDescription.sdp });
  }

  _wire(ch) {
    this.ch = ch;
    ch.onopen = () => this.send({ t: 'hello', name: this.name });
    ch.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'you') this.myId = m.id;
      this._emit(m);
    };
    ch.onclose = () => { if (!this._closed) { this._closed = true; this._emit({ t: '_close' }); } };
  }

  send(msg) { if (this.ch && this.ch.readyState === 'open') this.ch.send(JSON.stringify(msg)); }
  get connected() { return !!this.ch && this.ch.readyState === 'open'; }

  close() {
    this._closed = true;
    safeClose(this.ch); safeClose(this.pc);
    this.ch = this.pc = null;
  }
}

// ---------- Gastgeber: trägt den Raum in seinem Browser ----------

export class DirectHost {
  constructor(name) {
    this.direct = true;
    this.handlers = {};
    this.myId = 1;
    this.room = new LocalRoom(this, name);
    this.pc = null;
    this.ch = null;
    this._closed = false;
  }

  on(type, fn) { this.handlers[type] = fn; return this; }

  // Einladungs-Code erzeugen (enthält das WebRTC-Angebot).
  async offer() {
    const pc = this.pc = new RTCPeerConnection(RTC_CONFIG);
    this._wire(pc.createDataChannel('ubongo'));
    await pc.setLocalDescription(await pc.createOffer());
    await gatherIce(pc);
    return encodeSignal({ s: pc.localDescription.sdp });
  }

  // Antwort-Code des Gastes übernehmen – danach verbindet sich der Kanal.
  async accept(answerCode) {
    const answer = typeof answerCode === 'string' ? await decodeSignal(answerCode) : answerCode;
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answer.s });
  }

  _wire(ch) {
    this.ch = ch;
    ch.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      this.room.handle(2, m);
    };
    ch.onclose = () => { if (!this._closed) this.room.guestLeft(); };
  }

  // Netz-Schnittstelle für die eigene App: Der Gastgeber spielt ja selbst mit.
  send(msg) { this.room.handle(1, msg); }
  get connected() { return true; }

  _deliver(playerId, msg) {
    if (playerId === 1) (this.handlers[msg.t] || (() => {}))(msg);
    else if (this.ch && this.ch.readyState === 'open') this.ch.send(JSON.stringify(msg));
  }

  close() {
    this._closed = true;
    this.room.destroy();
    safeClose(this.ch); safeClose(this.pc);
    this.ch = this.pc = null;
  }
}

// ---------- Raum-Logik (Nachbau von server.js für 2 Spieler) ----------

class LocalRoom {
  constructor(net, hostName) {
    this.net = net;
    this.players = [{ id: 1, name: String(hostName || 'Spieler').slice(0, 20), total: 0, gems: [],
                      done: false, ms: null, prog: 0, progAt: 0, connected: true }];
    this.hostId = 1;
    this.difficulty = 'mittel';
    this.rounds = 9;
    this.timeFactor = 1;
    this.round = 0;
    this.state = 'lobby';
    this.timer = null;
    this.betweenTimer = null;
    this.destroyed = false;
  }

  broadcast(msg) { for (const p of this.players) this.net._deliver(p.id, msg); }

  lobbyState() {
    return {
      t: 'room', code: '📶', difficulty: this.difficulty, rounds: this.rounds,
      timeFactor: this.timeFactor,
      players: this.players.map(p => ({ id: p.id, name: p.name, host: p.id === this.hostId,
                                        total: p.total, online: p.connected !== false })),
    };
  }

  handle(id, msg) {
    if (this.destroyed) return;
    const me = this.players.find(p => p.id === id);
    switch (msg.t) {
      case 'hello': { // Gast ist da (Kanal offen)
        if (id !== 2 || this.players.length >= 2) return;
        this.players.push({ id: 2, name: String(msg.name || 'Spieler').slice(0, 20).replace(/[<>&"]/g, '').trim() || 'Spieler',
                            total: 0, gems: [], done: false, ms: null, prog: 0, progAt: 0, connected: true });
        this.net._deliver(2, { t: 'you', id: 2 });
        this.broadcast(this.lobbyState());
        break;
      }
      case 'config': {
        if (id !== this.hostId || this.state !== 'lobby') return;
        if (DIFFICULTIES[msg.difficulty]) this.difficulty = msg.difficulty;
        if (msg.rounds) this.rounds = Math.min(9, Math.max(1, msg.rounds | 0));
        if ([0.7, 1, 1.4].includes(+msg.timeFactor)) this.timeFactor = +msg.timeFactor;
        this.broadcast(this.lobbyState());
        break;
      }
      case 'start': {
        if (id !== this.hostId || (this.state !== 'lobby' && this.state !== 'final')) return;
        if (this.players.length < 2) {
          this.net._deliver(id, { t: 'error', msg: 'Der Mitspieler ist nicht mehr verbunden.' });
          return;
        }
        if (this.state === 'final') {
          this.round = 0;
          for (const p of this.players) { p.total = 0; p.gems = []; }
        }
        this.startRound();
        break;
      }
      case 'solved': {
        if (!me || this.state !== 'playing' || me.done) return;
        me.done = true;
        me.ms = Math.min(Math.max(0, msg.ms | 0), this.timeTotal * 1000);
        this.progress();
        if (this.players.every(p => p.done)) this.finishRound();
        break;
      }
      case 'dnf': {
        if (!me || this.state !== 'playing' || me.done) return;
        me.done = true;
        me.ms = null;
        this.progress();
        if (this.players.every(p => p.done)) this.finishRound();
        break;
      }
      case 'prog': {
        if (!me || this.state !== 'playing' || me.done) return;
        const now = Date.now();
        if (now - me.progAt < 800) return;
        me.progAt = now;
        me.prog = Math.min(99, Math.max(0, msg.p | 0));
        this.progress();
        break;
      }
      case 'leave': {
        if (id === this.hostId) {
          this.net._deliver(2, { t: 'error', msg: 'Der Gastgeber hat das Spiel beendet.', fatal: true });
          this.destroy();
        } else {
          this.guestLeft();
        }
        break;
      }
    }
  }

  startRound() {
    this.round++;
    this.state = 'playing';
    clearTimeout(this.betweenTimer);
    const { pieces, time } = roundSetup(this.difficulty, this.round, this.timeFactor);
    this.timeTotal = time;
    for (const p of this.players) {
      p.ms = null; p.done = false; p.prog = 0; p.progAt = 0;
      p.seed = Math.floor(Math.random() * 2 ** 31);
      generateCard(p.seed, this.difficulty, pieces); // Lösbarkeit sicherstellen (deterministisch)
      this.net._deliver(p.id, { t: 'round', n: this.round, of: this.rounds, seed: p.seed,
                                time, pieces, difficulty: this.difficulty });
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.finishRound(), (time + 10) * 1000);
  }

  progress() {
    this.broadcast({ t: 'progress', players: this.players.map(p => ({ id: p.id, name: p.name,
      done: p.done, ms: p.ms, prog: p.prog || 0, off: p.connected === false })) });
  }

  finishRound() {
    if (this.state !== 'playing') return;
    this.state = 'between';
    clearTimeout(this.timer);
    const finished = this.players.filter(p => p.done && p.ms !== null).sort((a, b) => a.ms - b.ms);
    const results = this.players.map(p => {
      const gems = roundGems(finished.indexOf(p), p.done && p.ms !== null);
      const pts = gemPoints(gems);
      p.total += pts;
      p.gems.push(...gems);
      return { id: p.id, name: p.name, ms: p.ms, gems, points: pts, total: p.total };
    });
    this.broadcast({ t: 'roundResult', n: this.round, of: this.rounds, results });
    if (this.round >= this.rounds) {
      this.state = 'final';
      const ranking = this.players.map(p => ({ id: p.id, name: p.name, total: p.total, gems: p.gems }))
        .sort((a, b) => b.total - a.total);
      this.broadcast({ t: 'final', ranking });
    } else {
      const anyDnf = this.players.some(p => p.ms === null);
      this.betweenTimer = setTimeout(() => {
        if (!this.destroyed && this.state === 'between') this.startRound();
      }, anyDnf ? 18000 : 10000);
    }
  }

  guestLeft() { // Kanal weg oder Gast hat verlassen
    const idx = this.players.findIndex(p => p.id === 2);
    if (idx < 0) return;
    this.players.splice(idx, 1);
    this.broadcast(this.lobbyState());
    if (this.state === 'playing' && this.players.every(p => p.done)) this.finishRound();
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
    clearTimeout(this.betweenTimer);
  }
}
