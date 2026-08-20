// Spielablauf: Runden, Timer, Punkte, Gegner-Anzeige, Overlays – für
// Solo (gegen Computer) und Online (über den Server).

import { generateCard, DIFFICULTIES } from './cardgen.js';
import { BoardView } from './board.js';
import { makeBots, newRound, botProgress, botTick } from './ai.js';
import { addLocalScore } from './highscore.js';

const $ = (id) => document.getElementById(id);
const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};
const RANK_BONUS = [5, 3, 1];
const points = (rank, msUsed, timeSec) =>
  10 + (RANK_BONUS[rank] || 0) + Math.floor(Math.max(0, timeSec - msUsed / 1000) / 10);

export class Game {
  constructor(opts) {
    this.o = opts;                    // { mode, name, difficulty, rounds, botCount, botSkill, net, onExit }
    this.mode = opts.mode;            // 'solo' | 'online'
    this.diff = DIFFICULTIES[opts.difficulty];
    this.round = 0;
    this.myTotal = 0;
    this.hintPenalty = 0;
    this.board = null;
    this.timerIv = null;
    this.destroyed = false;
    if (this.mode === 'solo') {
      this.bots = makeBots(opts.botCount, opts.botSkill, this.diff.time);
    }
    $('ctrl-solution').classList.toggle('hidden', this.mode !== 'solo');
  }

  // ---------- Rundenstart ----------
  startSolo() { this._beginRound(Math.floor(Math.random() * 2 ** 31)); }

  onRound(msg) {  // Online: Server verteilt Karten-Seed
    this.round = msg.n - 1;
    this.o.rounds = msg.of;
    this.diff = DIFFICULTIES[msg.difficulty];
    this._beginRound(msg.seed);
  }

  _beginRound(seed) {
    if (this.destroyed) return;
    this.round++;
    this.hintPenalty = 0;
    this.myMs = null; this.myDone = false;
    this.card = generateCard(seed, this.o.difficulty);
    $('game-round').textContent = `Runde ${this.round}/${this.o.rounds}`;
    $('overlay-result').classList.add('hidden');
    $('overlay-final').classList.add('hidden');
    $('overlay-solved').classList.add('hidden');

    if (this.board) this.board.destroy();
    this.board = new BoardView($('board'), this.card, {
      onSolved: () => this._solved(),
    });
    this.board.locked = true; // bis Countdown vorbei

    if (this.mode === 'solo') {
      for (const b of this.bots) Object.assign(b, newRound(b.skill, this.diff.time));
    }
    this._renderOpponents();

    // Countdown 3-2-1
    const ov = $('overlay-countdown'), num = $('countdown-num');
    ov.classList.remove('hidden');
    let n = 3;
    num.textContent = n;
    const cd = setInterval(() => {
      if (this.destroyed) { clearInterval(cd); return; }
      n--;
      if (n > 0) { num.textContent = n; return; }
      clearInterval(cd);
      ov.classList.add('hidden');
      this._startTimer();
      this.board.locked = false;
    }, 900);
  }

  _startTimer() {
    this.t0 = performance.now();
    this.endAt = this.t0 + this.diff.time * 1000;
    clearInterval(this.timerIv);
    this.timerIv = setInterval(() => this._tick(), 120);
    this._tick();
  }

  _tick() {
    if (this.destroyed) return;
    const now = performance.now();
    const left = this.endAt - now;
    const el = $('game-timer');
    el.textContent = fmt(left);
    el.classList.toggle('low', left < 15000 && !this.myDone);
    $('timer-fill').style.width = Math.max(0, (left / (this.diff.time * 1000)) * 100) + '%';

    if (this.mode === 'solo') {
      const elapsed = now - this.t0;
      for (const b of this.bots) botTick(b, elapsed);
      // Runde endet, wenn die Zeit abläuft oder niemand mehr fertig werden kann.
      const pending = !this.myDone || this.bots.some(b => !b.done && b.solveMs !== null);
      if (left <= 0 || !pending) { this._endSoloRound(); return; }
      this._renderOpponents(elapsed);
    } else if (left <= 0 && !this.myDone) {
      this.myDone = true;
      this.board.locked = true;
      this.o.net.send({ t: 'dnf' });
      clearInterval(this.timerIv);
      $('game-timer').textContent = '0:00';
    }
  }

  _solved() {
    if (this.myDone) return;
    this.myDone = true;
    this.myMs = Math.round(performance.now() - this.t0);
    $('overlay-solved').classList.remove('hidden');
    setTimeout(() => $('overlay-solved').classList.add('hidden'), 1600);
    confetti($('confetti'));
    if (navigator.vibrate) navigator.vibrate([60, 40, 120]);
    if (this.mode === 'online') this.o.net.send({ t: 'solved', ms: this.myMs });
  }

  // ---------- Solo: Rundenende & Wertung ----------
  _endSoloRound() {
    clearInterval(this.timerIv);
    this.board.locked = true;
    if (!this.myDone) this.board.reveal(this.card.solution); // zeigen, wie es ging

    const everyone = [
      { name: this.o.name, me: true, ms: this.myMs, done: this.myMs !== null },
      ...this.bots.map(b => ({ name: `${b.emoji} ${b.name}`, bot: b, ms: b.ms, done: b.done })),
    ];
    const finished = everyone.filter(p => p.done).sort((a, b) => a.ms - b.ms);
    for (const p of everyone) {
      p.points = p.done ? points(finished.indexOf(p), p.ms, this.diff.time) : 0;
      if (p.me) { p.points = Math.max(0, p.points - this.hintPenalty); this.myTotal += p.points; p.total = this.myTotal; }
      else { p.bot.total += p.points; p.total = p.bot.total; }
    }
    this._showRoundResult(everyone, true);
  }

  _showRoundResult(results, solo) {
    $('result-title').textContent = `Runde ${this.round} von ${this.o.rounds}`;
    const rows = results.slice().sort((a, b) => (b.points - a.points) || ((a.ms ?? 1e9) - (b.ms ?? 1e9)));
    $('result-table').innerHTML =
      '<tr><th></th><th>Zeit</th><th>Punkte</th><th>Gesamt</th></tr>' +
      rows.map(r => `<tr class="${r.me ? 'me' : ''}"><td>${esc(r.name)}</td>` +
        `<td>${r.ms != null ? fmt2(r.ms) : '–'}</td><td>+${r.points}</td><td>${r.total}</td></tr>`).join('');
    const last = this.round >= this.o.rounds;
    $('result-next').classList.toggle('hidden', !solo);
    $('result-wait').classList.toggle('hidden', solo);
    $('result-next').textContent = last ? 'Zum Endstand' : 'Nächste Runde';
    $('overlay-result').classList.remove('hidden');
    this._resultIsFinal = last;
  }

  nextRound() { // "Weiter"-Knopf (nur solo)
    $('overlay-result').classList.add('hidden');
    if (this._resultIsFinal) this._finalSolo();
    else this.startSolo();
  }

  _finalSolo() {
    const ranking = [
      { name: this.o.name, me: true, total: this.myTotal },
      ...this.bots.map(b => ({ name: `${b.emoji} ${b.name}`, total: b.total })),
    ].sort((a, b) => b.total - a.total);
    addLocalScore({ name: this.o.name, score: this.myTotal, difficulty: this.o.difficulty,
                    date: new Date().toISOString().slice(0, 10) });
    this._showFinal(ranking, 'Highscore auf diesem Handy gespeichert! ⭐');
    if (ranking[0].me) confetti($('confetti'), 140);
  }

  // ---------- Online-Ereignisse ----------
  onProgress(msg) {
    this.oppState = msg.players;
    this._renderOpponents();
  }

  onRoundResult(msg) {
    clearInterval(this.timerIv);
    if (this.board) this.board.locked = true;
    const results = msg.results.map(r => ({
      name: r.name, me: r.id === this.o.net.myId, ms: r.ms, points: r.points, total: r.total,
    }));
    const mine = results.find(r => r.me);
    if (mine) this.myTotal = mine.total;
    this._showRoundResult(results, false);
  }

  onFinal(msg) {
    $('overlay-result').classList.add('hidden');
    const ranking = msg.ranking.map(r => ({ name: r.name, me: r.id === this.o.net.myId, total: r.total }));
    this._showFinal(ranking, 'Im Online-Highscore gespeichert! 🌍');
    if (ranking[0]?.me) confetti($('confetti'), 140);
  }

  _showFinal(ranking, note) {
    const medals = ['🥇', '🥈', '🥉'];
    $('final-table').innerHTML =
      ranking.map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td>${medals[i] || (i + 1) + '.'}</td>` +
        `<td>${esc(r.name)}</td><td>${r.total}</td></tr>`).join('');
    $('final-note').textContent = note;
    $('overlay-final').classList.remove('hidden');
  }

  // ---------- Anzeige der Gegner ----------
  _renderOpponents(elapsed) {
    const host = $('opponents');
    if (this.mode === 'solo') {
      host.innerHTML = this.bots.map(b => {
        const prog = b.done ? 1 : botProgress(b, elapsed ?? 0, this.diff.time);
        const cls = b.done ? 'done' : (b.solveMs === null && (elapsed ?? 0) > this.diff.time * 900) ? 'dnf' : '';
        return `<div class="opp ${cls}"><div class="opp-name">${b.emoji} ${esc(b.name)}` +
          `<span style="margin-left:auto">${b.done ? '✓ ' + fmt2(b.ms) : ''}</span></div>` +
          `<div class="opp-bar"><div class="opp-fill" style="width:${Math.round(prog * 100)}%"></div></div></div>`;
      }).join('');
    } else {
      const players = (this.oppState || []).filter(p => p.id !== this.o.net.myId);
      host.innerHTML = players.map(p =>
        `<div class="opp ${p.done ? (p.ms != null ? 'done' : 'dnf') : ''}">` +
        `<div class="opp-name">${esc(p.name)}<span style="margin-left:auto">` +
        `${p.done ? (p.ms != null ? '✓ ' + fmt2(p.ms) : '✗') : '…'}</span></div>` +
        `<div class="opp-bar"><div class="opp-fill" style="width:${p.done ? 100 : 8}%"></div></div></div>`).join('');
    }
  }

  // ---------- Steuerung ----------
  rotate() { if (this.board) this.board.rotateSelected(); }
  flip()   { if (this.board) this.board.flipSelected(); }
  hint() {
    if (this.mode !== 'solo' || !this.board || this.board.locked) return;
    if (this.board.showHint(this.card.solution)) this.hintPenalty += 5;
  }

  destroy() {
    this.destroyed = true;
    clearInterval(this.timerIv);
    if (this.board) { this.board.destroy(); this.board = null; }
    for (const id of ['overlay-countdown', 'overlay-solved', 'overlay-result', 'overlay-final'])
      $(id).classList.add('hidden');
  }
}

// ---------- Hilfsfunktionen ----------
const esc = (s) => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const fmt2 = (ms) => (ms / 1000).toFixed(1).replace('.', ',') + ' s';

// Konfetti-Regen
export function confetti(canvas, count = 80) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  canvas.width = r.width * dpr; canvas.height = r.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const colors = ['#e63946', '#2f6fed', '#f4c500', '#2a9d3a', '#f77f00', '#8338ec', '#00b4d8', '#ef5da8'];
  const parts = Array.from({ length: count }, () => ({
    x: Math.random() * r.width, y: -20 - Math.random() * r.height * 0.5,
    vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4,
    rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
    w: 6 + Math.random() * 7, h: 4 + Math.random() * 5,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  (function frame(now) {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, r.width, r.height);
    if (t > 3.2) return;
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - t / 3.2);
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    requestAnimationFrame(frame);
  })(t0);
}
