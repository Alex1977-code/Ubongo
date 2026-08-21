// Spielablauf: Runden, Timer, Punkte, Gegner-Anzeige, Overlays – für
// Solo (gegen Computer) und Online (über den Server).

import { generateCard, DIFFICULTIES, roundSetup } from './cardgen.js';
import { BoardView } from './board.js';
import { makeBots, newRound, botProgress, botTick } from './ai.js';
import { addLocalScore, recordSolve, recordMatch } from './highscore.js';
import { roundGems, gemPoints, gemHTML, gemRow } from './gems.js';
import { assetURL } from './assets.js';
import * as snd from './sound.js';

const $ = (id) => document.getElementById(id);
const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};
const FFWD = 8; // Schnellvorlauf-Faktor, sobald der Spieler gelöst hat

export class Game {
  constructor(opts) {
    this.o = opts;                    // { mode, name, difficulty, rounds, botCount, botSkill, net, onExit }
    this.mode = opts.mode;            // 'solo' | 'online'
    this.diff = DIFFICULTIES[opts.difficulty];
    this.round = 0;
    this.myTotal = 0;
    this.myGems = [];
    this.hintUsed = false;
    this.board = null;
    this.timerIv = null;
    this.destroyed = false;
    if (this.mode === 'solo') {
      this.bots = makeBots(opts.botCount, opts.botSkill, this.diff.time);
      for (const b of this.bots) b.gems = [];
    }
    $('ctrl-solution').classList.toggle('hidden', this.mode !== 'solo');
    this._renderShelf();
  }

  // ---------- Rundenstart ----------
  startSolo() {
    const setup = roundSetup(this.o.difficulty, this.round + 1, this.o.timeFactor || 1);
    this.roundPieces = setup.pieces;
    this.roundTime = setup.time;
    this._beginRound(Math.floor(Math.random() * 2 ** 31));
  }

  onRound(msg) {  // Online: Server verteilt Karten-Seed
    this.round = msg.n - 1;
    this.o.rounds = msg.of;
    this.diff = DIFFICULTIES[msg.difficulty];
    this.roundPieces = msg.pieces;
    this.roundTime = msg.full || msg.time; // volle Rundenzeit (bei Rückkehr: full)
    if (msg.n === 1 && !msg.resumed) { // neue Partie ("Nochmal spielen"): Schatz leeren
      this.myTotal = 0;
      this.myGems = [];
      this._renderShelf();
    }
    this._beginRound(msg.seed, msg.resumed ? msg : null);
  }

  _beginRound(seed, resume) {
    if (this.destroyed) return;
    this.round++;
    this.roundTime = this.roundTime || this.diff.time;
    this.hintUsed = false;
    this._warned = false;
    this.myMs = null; this.myDone = false;
    this.card = generateCard(seed, this.o.difficulty, this.roundPieces);
    $('game-round').textContent = `Runde ${this.round}/${this.o.rounds}`;
    document.querySelectorAll('.fly-gem').forEach(el => el.remove());
    $('solution-note').classList.add('hidden');
    $('overlay-result').classList.add('hidden');
    $('overlay-final').classList.add('hidden');
    $('overlay-solved').classList.add('hidden');

    if (this.board) this.board.destroy();
    this._progAt = 0;
    this.board = new BoardView($('board'), this.card, {
      onSolved: () => this._solved(),
      onPlace: () => this._shareProgress(),
    });
    this.board.locked = true; // bis Countdown vorbei

    if (this.mode === 'solo') {
      for (const b of this.bots) Object.assign(b, newRound(b.skill, this.roundTime));
    }
    this._renderOpponents();

    if (resume) {
      // Wiederverbunden mitten in der Runde: kein Countdown, Restzeit weiter
      this._startTimer(resume.time);
      if (resume.done) {
        this.myDone = true;
        this.myMs = resume.ms ?? null;
        this.board.locked = true;
      } else {
        this.board.locked = false;
      }
      return;
    }

    // Countdown 3-2-1
    const ov = $('overlay-countdown'), num = $('countdown-num');
    ov.classList.remove('hidden');
    let n = 3;
    num.textContent = n;
    snd.countdown();
    const cd = setInterval(() => {
      if (this.destroyed) { clearInterval(cd); return; }
      n--;
      if (n > 0) { num.textContent = n; snd.countdown(); return; }
      clearInterval(cd);
      ov.classList.add('hidden');
      snd.go(); // höherer Ton: los geht's!
      this._startTimer();
      this.board.locked = false;
    }, 900);
  }

  _startTimer(remainingSecs) {
    this.t0 = performance.now();
    this.endAt = this.t0 + (remainingSecs ?? this.roundTime) * 1000;
    this.vElapsed = 0;               // virtuelle Rundenzeit (für Schnellvorlauf)
    this._lastTick = this.t0;
    clearInterval(this.timerIv);
    this.timerIv = setInterval(() => this._tick(), 120);
    this._tick();
  }

  _tick() {
    if (this.destroyed) return;
    const now = performance.now();
    let left;
    let ffwd = false;

    if (this.mode === 'solo') {
      // Virtuelle Uhr: Sobald der Spieler gelöst hat, läuft die Zeit für die
      // Computer-Gegner im Schnellvorlauf – keine lange Warterei.
      ffwd = this.myDone;
      this.vElapsed += (now - this._lastTick) * (ffwd ? FFWD : 1);
      this._lastTick = now;
      left = this.roundTime * 1000 - this.vElapsed;
    } else {
      left = this.endAt - now;
    }

    const el = $('game-timer');
    el.textContent = (ffwd ? '⏩ ' : '') + fmt(left);
    el.classList.toggle('low', left < 15000 && !this.myDone);
    $('timer-fill').style.width = Math.max(0, (left / (this.roundTime * 1000)) * 100) + '%';

    if (!this.myDone && !this._warned && left <= 10000 && left > 0) {
      this._warned = true;
      snd.warn(); // nur noch 10 Sekunden!
    }

    if (this.mode === 'solo') {
      for (const b of this.bots) botTick(b, this.vElapsed);
      // Runde endet, wenn die Zeit abläuft oder niemand mehr fertig werden kann.
      const pending = !this.myDone || this.bots.some(b => !b.done && b.solveMs !== null);
      if (left <= 0 || !pending) { this._endSoloRound(); return; }
      this._renderOpponents(this.vElapsed);
    } else if (left <= 0 && !this.myDone) {
      this.myDone = true;
      this.board.locked = true;
      this.o.net.send({ t: 'dnf' });
      clearInterval(this.timerIv);
      $('game-timer').textContent = '0:00';
    }
  }

  // Eigenen Fortschritt (belegte Felder) an die Mitspieler melden
  _shareProgress() {
    if (this.mode !== 'online' || this.myDone || !this.board) return;
    const now = performance.now();
    if (now - this._progAt < 1200) return;
    this._progAt = now;
    const covered = this.board.pieces.reduce((s, p) => s + (p.placed ? this.board.cells(p).length : 0), 0);
    this.o.net.send({ t: 'prog', p: Math.round((covered / this.card.cells.length) * 100) });
  }

  _solved() {
    if (this.myDone) return;
    this.myDone = true;
    this.myMs = this.mode === 'solo' ? Math.round(this.vElapsed) : Math.round(performance.now() - this.t0);
    $('overlay-solved').classList.remove('hidden');
    setTimeout(() => $('overlay-solved').classList.add('hidden'), 1600);
    recordSolve(this.myMs);
    snd.solve(); // UBONGO!-Fanfare
    confetti($('confetti'));
    if (navigator.vibrate) navigator.vibrate([60, 40, 120]);
    if (this.mode === 'online') this.o.net.send({ t: 'solved', ms: this.myMs });
  }

  // ---------- Solo: Rundenende & Wertung ----------
  _endSoloRound() {
    clearInterval(this.timerIv);
    this.board.locked = true;

    const everyone = [
      { name: this.o.name, me: true, ms: this.myMs, done: this.myMs !== null },
      ...this.bots.map(b => ({ name: `${b.emoji} ${b.name}`, bot: b, ms: b.ms, done: b.done })),
    ];
    const finished = everyone.filter(p => p.done).sort((a, b) => a.ms - b.ms);
    for (const p of everyone) {
      p.gems = roundGems(finished.indexOf(p), p.done, p.me && this.hintUsed);
      p.points = gemPoints(p.gems);
      if (p.me) { this.myTotal += p.points; this.myGems.push(...p.gems); p.total = this.myTotal; }
      else { p.bot.total += p.points; p.bot.gems.push(...p.gems); p.total = p.bot.total; }
    }
    const mine = everyone[0];
    const showRes = () => this._celebrateGems(mine.gems, () => this._showRoundResult(everyone, true));
    if (this.myMs == null) this._showSolution(showRes); // nicht gelöst: erst die Lösung zeigen
    else showRes();
  }

  // Konnte der Spieler nicht lösen, wird die fertige Lösung ein paar Sekunden
  // auf dem Brett gezeigt, bevor das Rundenergebnis erscheint.
  _showSolution(then) {
    const startedRound = this.round;
    if (!this.board || !this.card.solution) { then(); return; }
    this.board.reveal(this.card.solution);
    $('solution-note').classList.remove('hidden');
    setTimeout(() => {
      $('solution-note').classList.add('hidden');
      if (!this.destroyed && this.round === startedRound) then();
    }, 3600);
  }

  // Gewonnene Edelsteine fallen sichtbar aufs Spielfeld und fliegen dann in
  // die eigene Schatzleiste – erst danach erscheint das Rundenergebnis.
  _celebrateGems(gems, thenRaw) {
    const startedRound = this.round;
    const then = () => { if (!this.destroyed && this.round === startedRound) thenRaw(); };
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!gems || gems.length === 0 || reduce || !this.board) {
      this._renderShelf();
      setTimeout(then, gems && gems.length ? 500 : 700);
      return;
    }
    const screen = $('screen-game');
    const sRect = screen.getBoundingClientRect();
    const bRect = this.board.canvas.getBoundingClientRect();
    const shelf = $('gem-shelf');
    shelf.classList.remove('hidden');
    const shelfRect = shelf.getBoundingClientRect();
    const size = 42;
    gems.forEach((type, i) => {
      const el = document.createElement('div');
      el.className = 'fly-gem';
      el.innerHTML = gemHTML(type, size);
      const x = bRect.left - sRect.left + bRect.width * (0.28 + 0.44 * Math.random());
      const yLand = bRect.top - sRect.top + this.board.by + this.board.cardBounds.h * this.board.cell * 0.45;
      el.style.left = (x - size / 2) + 'px';
      el.style.top = '0px';
      screen.appendChild(el);
      const tx = shelfRect.left - sRect.left + 18 - x;
      const ty = shelfRect.top - sRect.top + 2;
      const anim = el.animate([
        { transform: `translateY(-${size + 20}px) rotate(-40deg)`, opacity: 0.9, offset: 0 },
        { transform: `translateY(${yLand}px) rotate(8deg)`, opacity: 1, offset: 0.42, easing: 'cubic-bezier(.5,0,1,.6)' },
        { transform: `translateY(${yLand - 26}px) rotate(-4deg)`, offset: 0.58, easing: 'cubic-bezier(0,.4,.5,1)' },
        { transform: `translateY(${yLand}px) rotate(0deg)`, offset: 0.72, easing: 'cubic-bezier(.5,0,1,.6)' },
        { transform: `translateY(${yLand}px) scale(1.06)`, offset: 0.84 },
        { transform: `translate(${tx}px, ${ty}px) scale(0.45)`, opacity: 0.9, offset: 1, easing: 'cubic-bezier(.4,0,.7,1)' },
      ], { duration: 1500, delay: i * 180, fill: 'forwards' });
      anim.onfinish = () => { el.remove(); this._renderShelf(); };
      setTimeout(() => snd.gem(), 620 + i * 180);
    });
    setTimeout(then, 1500 + gems.length * 180 + 200);
  }

  // Eigene Schatzleiste im Spielfeld (gesammelte Edelsteine + Gesamtwert)
  _renderShelf() {
    const shelf = $('gem-shelf');
    if (!shelf) return;
    if (!this.myGems || this.myGems.length === 0) { shelf.classList.add('hidden'); shelf.innerHTML = ''; return; }
    shelf.classList.remove('hidden');
    shelf.innerHTML = `<span class="shelf-gems">${gemRow(this.myGems, 21)}</span>` +
      `<span class="shelf-total">= ${this.myTotal}</span>`;
  }

  _showRoundResult(results, solo) {
    $('result-title').textContent = `Runde ${this.round} von ${this.o.rounds}`;
    const rows = results.slice().sort((a, b) => (b.points - a.points) || ((a.ms ?? 1e9) - (b.ms ?? 1e9)));
    $('result-table').innerHTML =
      '<tr><th></th><th>Zeit</th><th>Edelsteine</th><th>Gesamt</th></tr>' +
      rows.map(r => `<tr class="${r.me ? 'me' : ''}"><td>${esc(r.name)}</td>` +
        `<td>${r.ms != null ? fmt2(r.ms) : '–'}</td><td class="gem-cell">${gemRow(r.gems || [], 17)}</td><td>${r.total}</td></tr>`).join('');
    const last = this.round >= this.o.rounds;
    $('result-next').classList.toggle('hidden', !solo);
    $('result-wait').classList.toggle('hidden', solo);
    $('result-next').textContent = last ? 'Zum Endstand' : 'Nächste Runde';
    $('overlay-result').classList.remove('hidden');
    snd.roundEnd(); // kleine Jingle zum Rundenergebnis
    this._resultIsFinal = last;
  }

  nextRound() { // "Weiter"-Knopf (nur solo)
    $('overlay-result').classList.add('hidden');
    if (this._resultIsFinal) this._finalSolo();
    else this.startSolo();
  }

  _finalSolo() {
    const ranking = [
      { name: this.o.name, me: true, total: this.myTotal, gems: this.myGems },
      ...this.bots.map(b => ({ name: `${b.emoji} ${b.name}`, total: b.total, gems: b.gems })),
    ].sort((a, b) => b.total - a.total);
    addLocalScore({ name: this.o.name, score: this.myTotal, difficulty: this.o.difficulty,
                    date: new Date().toISOString().slice(0, 10) });
    recordMatch({ won: !!ranking[0].me, points: this.myTotal, gems: this.myGems });
    this._showFinal(ranking, 'Highscore auf diesem Handy gespeichert! ⭐');
    if (ranking[0].me) confetti($('confetti'), 140);
  }

  // ---------- Online-Ereignisse ----------
  setRoster(players) { // Namen aus der Lobby (Progress-Nachrichten tragen nur IDs)
    this.roster = Object.fromEntries(players.map(p => [p.id, p.name]));
  }

  onProgress(msg) {
    this.oppState = msg.players.map(p => ({ ...p, name: (this.roster || {})[p.id] || p.name || 'Spieler' }));
    this._renderOpponents();
  }

  onRoundResult(msg) {
    clearInterval(this.timerIv);
    if (this.board) this.board.locked = true;
    const results = msg.results.map(r => ({
      name: r.name, me: r.id === this.o.net.myId, ms: r.ms, points: r.points, total: r.total,
      gems: r.gems || [],
    }));
    const mine = results.find(r => r.me);
    if (mine) {
      this.myTotal = mine.total;
      this.myGems.push(...mine.gems);
    }
    const showRes = () => this._celebrateGems(mine ? mine.gems : [], () => this._showRoundResult(results, false));
    if (this.myMs == null) this._showSolution(showRes); // nicht gelöst: erst die Lösung zeigen
    else showRes();
  }

  onFinal(msg) {
    $('overlay-result').classList.add('hidden');
    const ranking = msg.ranking.map(r => ({ name: r.name, me: r.id === this.o.net.myId, total: r.total, gems: r.gems }));
    recordMatch({ won: !!ranking[0]?.me, points: this.myTotal, gems: this.myGems });
    this._showFinal(ranking, 'Im Online-Highscore gespeichert! 🌍');
    if (ranking[0]?.me) confetti($('confetti'), 140);
  }

  _showFinal(ranking, note) {
    const won = !!ranking[0]?.me;
    // Maskottchen-Reaktion: Sieg/Trost-Bild, sonst das allgemeine Maskottchen
    const mascot = $('final-mascot');
    const mSrc = assetURL(won ? 'mascot-sieg' : 'mascot-trost') || assetURL('mascot');
    if (mSrc) { mascot.src = mSrc; mascot.classList.remove('hidden'); }
    else mascot.classList.add('hidden');
    // Sieger-Szene als Hintergrund der Ergebnistafel (nur bei Sieg + Asset)
    const card = $('overlay-final').querySelector('.result-card');
    const scene = won && assetURL('sieg-szene');
    card.classList.toggle('scene', !!scene);
    card.style.backgroundImage = scene
      ? `linear-gradient(rgba(24, 8, 0, .55), rgba(24, 8, 0, .68)), url("${scene}")`
      : '';
    const medals = ['🥇', '🥈', '🥉'];
    $('final-table').innerHTML =
      ranking.map((r, i) => {
        const medal = i === 0 ? '<span class="medal-gold">🥇</span>' : medals[i] || (i + 1) + '.';
        const spark = i === 0 ? ' <span class="sparkle">✨</span>' : '';
        return `<tr class="${r.me ? 'me' : ''}"><td>${medal}</td>` +
          `<td>${esc(r.name)}${spark}<div class="gem-cell">${gemRow(r.gems || [], 15)}</div></td><td>${r.total}</td></tr>`;
      }).join('');
    $('final-note').textContent = note;
    $('overlay-final').classList.remove('hidden');
    snd.victory(); // Sieg-Fanfare zum Endstand
  }

  // ---------- Anzeige der Gegner ----------
  _renderOpponents(elapsed) {
    const host = $('opponents');
    if (this.mode === 'solo') {
      host.innerHTML = this.bots.map(b => {
        const prog = b.done ? 1 : botProgress(b, elapsed ?? 0, this.roundTime);
        const cls = b.done ? 'done' : (b.solveMs === null && (elapsed ?? 0) > this.roundTime * 900) ? 'dnf' : '';
        // Bot-Avatar: PNG (img/avatar-N.png), wenn vorhanden – sonst Emoji
        const avSrc = assetURL('avatar-' + b.avatar);
        const av = avSrc ? `<img class="opp-avatar" src="${avSrc}" alt="">` : b.emoji;
        return `<div class="opp ${cls}"><div class="opp-name">${av} ${esc(b.name)}` +
          `<span style="margin-left:auto">${b.done ? '✓ ' + fmt2(b.ms) : ''}</span></div>` +
          `<div class="opp-bar"><div class="opp-fill" style="width:${Math.round(prog * 100)}%"></div></div></div>`;
      }).join('');
    } else {
      const players = (this.oppState || []).filter(p => p.id !== this.o.net.myId);
      host.innerHTML = players.map(p =>
        `<div class="opp ${p.done ? (p.ms != null ? 'done' : 'dnf') : ''} ${p.off ? 'dnf' : ''}">` +
        `<div class="opp-name">${esc(p.name)}<span style="margin-left:auto">` +
        `${p.off ? '📴' : p.done ? (p.ms != null ? '✓ ' + fmt2(p.ms) : '✗') : '…'}</span></div>` +
        `<div class="opp-bar"><div class="opp-fill" style="width:${p.done ? 100 : Math.max(4, p.prog || 0)}%"></div></div></div>`).join('');
    }
  }

  // ---------- Steuerung ----------
  rotate() { if (this.board) this.board.rotateSelected(); }
  flip()   { if (this.board) this.board.flipSelected(); }
  hint() {
    if (this.mode !== 'solo' || !this.board || this.board.locked) return;
    if (this.board.showHint(this.card.solution)) { this.hintUsed = true; snd.hint(); }
  }

  destroy() {
    this.destroyed = true;
    clearInterval(this.timerIv);
    if (this.board) { this.board.destroy(); this.board = null; }
    document.querySelectorAll('.fly-gem').forEach(el => el.remove());
    const shelf = $('gem-shelf');
    if (shelf) { shelf.classList.add('hidden'); shelf.innerHTML = ''; }
    $('solution-note').classList.add('hidden');
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
