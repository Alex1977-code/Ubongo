// Spielbrett-Ansicht: zeichnet Karte + Teile auf Canvas und verarbeitet Touch-Eingaben.
// Ziehen = bewegen · Tippen = auswählen, erneut tippen = drehen · Einrasten am Raster.

import { PIECE_MAP, transform, bounds } from './pieces.js';
import { asset } from './assets.js';
import * as snd from './sound.js';

const K = (x, y) => x + ',' + y;

function shade(hex, f) { // Farbe aufhellen (f>0) oder abdunkeln (f<0)
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v + (f > 0 ? (255 - v) * f : v * f))));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

function mix(hexA, hexB, f) { // zwei Farben mischen (f = Anteil von B)
  const a = parseInt(hexA.slice(1), 16), b = parseInt(hexB.slice(1), 16);
  const ch = (sh) => Math.round(((a >> sh) & 255) * (1 - f) + ((b >> sh) & 255) * f);
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
}

// Teile-Look (Design-Menü): klassisch | juwelen | bonbon | holz –
// rein prozedural gezeichnet, wirkt ab der nächsten Zeichnung.
const SKINS = ['kristall', 'klassisch', 'juwelen', 'bonbon', 'holz'];
let PIECE_SKIN = 'kristall';
export function setPieceSkin(s) { PIECE_SKIN = SKINS.includes(s) ? s : 'kristall'; }

export class BoardView {
  constructor(canvas, card, { onSolved, onPlace } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.card = card;
    this.onSolved = onSolved || (() => {});
    this.onPlace = onPlace || (() => {});
    this.region = new Set(card.cells.map(c => K(c[0], c[1])));
    this.cardBounds = bounds(card.cells);
    this.locked = false;
    this.hint = null;          // { cells, until }
    this.selectedId = null;
    this.pieces = card.pieces.map((id, i) => ({
      id, i, color: PIECE_MAP[id].color, base: PIECE_MAP[id].cells,
      rot: 0, flip: 0, placed: null, tray: { x: 0, y: 0 }, drag: null,
    }));
    this._raf = 0;
    this.reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this._onResize = () => this.layout();
    window.addEventListener('resize', this._onResize);

    canvas.addEventListener('pointerdown', e => this._down(e));
    canvas.addEventListener('pointermove', e => this._move(e));
    canvas.addEventListener('pointerup', e => this._up(e));
    canvas.addEventListener('pointercancel', e => this._up(e, true));
    canvas.addEventListener('lostpointercapture', e => this._up(e, true));

    this.layout();
    const loop = () => { this.draw(); this._raf = requestAnimationFrame(loop); };
    this._raf = requestAnimationFrame(loop);
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
  }

  cells(p) { return transform(p.base, p.rot, p.flip); }

  layout() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const { w: cw, h: ch } = this.cardBounds;
    const boardMaxH = this.h * 0.56;
    this.cell = Math.min((this.w - 28) / cw, (boardMaxH - 24) / ch, 58);
    this.bx = (this.w - cw * this.cell) / 2;
    this.by = 14 + Math.max(0, (boardMaxH - 24 - ch * this.cell) / 2);
    this.trayTop = this.by + ch * this.cell + 18;
    this._layoutTray();
  }

  _layoutTray() {
    // Feste Slots: Jedes Teil hat einen quadratischen Stammplatz in der Größe
    // seiner längsten Seite. Drehen/Spiegeln ändert die Slot-Anordnung nie –
    // das Teil wird nur innerhalb seines Slots zentriert (kein Wackeln).
    const availH = this.h - this.trayTop - 10;
    const sizes = this.pieces.map(p => {
      const b = bounds(p.base);
      return Math.max(b.w, b.h);
    });
    let tc = Math.min(this.cell * 0.62, 34);
    for (; tc >= 12; tc -= 2) {
      const gap = 10;
      let x = 10, y = 0, rowH = 0;
      const pos = [];
      for (let i = 0; i < this.pieces.length; i++) {
        const s = sizes[i] * tc;
        if (x + s > this.w - 10 && x > 10) { x = 10; y += rowH + gap; rowH = 0; }
        pos.push({ p: this.pieces[i], x, y, s });
        x += s + gap; rowH = Math.max(rowH, s);
      }
      const total = y + rowH;
      if (total <= availH || tc <= 12) {
        const offY = this.trayTop + Math.max(0, (availH - total) / 2);
        // Zeilen horizontal zentrieren
        const rows = new Map();
        for (const e of pos) { if (!rows.has(e.y)) rows.set(e.y, []); rows.get(e.y).push(e); }
        for (const row of rows.values()) {
          const last = row[row.length - 1];
          const shift = (this.w - 10 - (last.x + last.s)) / 2;
          for (const e of row) { e.p.slot = { x: e.x + shift, y: e.y + offY, px: e.s, cell: tc }; }
        }
        this.trayCell = tc;
        this._updateTrayOrigins();
        return;
      }
    }
  }

  // Zeichen-/Treffer-Ursprung jedes Teils: zentriert im festen Slot.
  _updateTrayOrigins() {
    for (const p of this.pieces) {
      if (!p.slot) continue;
      const b = bounds(this.cells(p));
      p.tray = {
        x: p.slot.x + (p.slot.px - b.w * p.slot.cell) / 2,
        y: p.slot.y + (p.slot.px - b.h * p.slot.cell) / 2,
        cell: p.slot.cell,
      };
    }
  }

  // ---------- Eingabe ----------
  _pieceAt(x, y) {
    // Zuerst platzierte Teile (Rasterkoordinate), dann Ablage-Teile.
    const gx = Math.floor((x - this.bx) / this.cell);
    const gy = Math.floor((y - this.by) / this.cell);
    for (const p of this.pieces) {
      if (!p.placed) continue;
      if (this.cells(p).some(([cx, cy]) => cx + p.placed.gx === gx && cy + p.placed.gy === gy)) return p;
    }
    for (const p of this.pieces) {
      if (p.placed || (p.drag && p.drag.moved) || !p.slot) continue;
      // Ganzer Slot als Treffer-Fläche: Der Stammplatz bewegt sich nie,
      // dadurch trifft jeder Tipp an derselben Stelle zuverlässig dasselbe
      // Teil – egal, wie es gerade gedreht ist.
      const s = p.slot;
      if (x >= s.x - 4 && x <= s.x + s.px + 4 && y >= s.y - 4 && y <= s.y + s.px + 4) return p;
    }
    return null;
  }

  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _down(e) {
    if (this.locked) return;
    // Zweiter Finger während des Ziehens: Teil drehen
    if (this.dragPiece) {
      const dp = this.dragPiece;
      if (dp.drag && e.pointerId !== dp.drag.pointerId) {
        e.preventDefault();
        if (dp.drag.moved) {
          dp.rot = (dp.rot + 1) % 4; // frei in der Hand: einfach drehen
          snd.rotate();
        } else {
          // Teil liegt noch (Brett oder Ablage): über die reguläre
          // Dreh-Logik, damit nichts illegal überlappt
          const wasPlaced = dp.placed ? { ...dp.placed } : null;
          dp.placed = null;
          this._transform(dp, wasPlaced, 'rot');
          this._after();
        }
      }
      return;
    }
    const { x, y } = this._pos(e);
    const p = this._pieceAt(x, y);
    if (!p) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const wasSelected = this.selectedId === p.id;
    this.selectedId = p.id;
    const wasPlaced = p.placed;
    const b = bounds(this.cells(p));
    // Griffpunkt merken: Das Teil bleibt an der Stelle unterm Finger, an der
    // es angefasst wurde (kein "Springen" zur Mitte), nur leicht angehoben.
    let relX, relY; // Griffpunkt in Zell-Einheiten, auf das Teil begrenzt
    if (wasPlaced) {
      relX = (x - (this.bx + wasPlaced.gx * this.cell)) / this.cell;
      relY = (y - (this.by + wasPlaced.gy * this.cell)) / this.cell;
    } else {
      relX = (x - p.tray.x) / p.tray.cell;
      relY = (y - p.tray.y) / p.tray.cell;
    }
    relX = Math.max(0.2, Math.min(b.w - 0.2, relX));
    relY = Math.max(0.2, Math.min(b.h - 0.2, relY));
    p.drag = {
      pointerId: e.pointerId, x, y, startX: x, startY: y, t0: performance.now(),
      wasPlaced: wasPlaced ? { ...wasPlaced } : null, wasSelected, moved: false,
      ox: -relX * this.cell, oy: -relY * this.cell - this.cell * 1.1,
    };
    // Das Teil bleibt liegen, bis wirklich gezogen wird – ein Tipp soll es
    // nicht anheben oder verschieben.
    this.dragPiece = p;
  }

  _move(e) {
    const p = this.dragPiece;
    if (!p || !p.drag || e.pointerId !== p.drag.pointerId) return;
    e.preventDefault();
    const { x, y } = this._pos(e);
    p.drag.x = x; p.drag.y = y;
    const threshold = Math.max(16, this.cell * 0.3); // fingerfreundlich
    if (!p.drag.moved && Math.hypot(x - p.drag.startX, y - p.drag.startY) > threshold) {
      p.drag.moved = true;
      p.placed = null; // erst jetzt vom Brett abheben
      this._layoutTray();
      snd.pickup();
    }
  }

  _up(e, cancel = false) {
    const p = this.dragPiece;
    if (!p || !p.drag || e.pointerId !== p.drag.pointerId) return;
    const d = p.drag;
    const quick = !d.moved; // Tipp = keine Bewegung, Druckdauer egal
    p.drag = null;
    this.dragPiece = null;

    if (cancel) { p.placed = d.wasPlaced; this._after(); return; }

    if (quick) {
      // Erster Tipp wählt das Teil nur aus – erst weitere Tipps drehen es.
      if (d.wasSelected) {
        this._transform(p, d.wasPlaced, 'rot');
      } else {
        p.placed = d.wasPlaced; // nur auswählen, nichts verändern
        snd.pickup();
      }
      this._after();
      return;
    }

    // Ablegen: passende Rasterposition suchen (mit Einrast-Hilfe in der Nähe)
    const px = d.x + d.ox, py = d.y + d.oy;
    const snap = this._snapPos(p, px, py);
    if (snap) {
      p.placed = snap;
      p.settle = performance.now(); // kleine "Setz"-Animation beim Einrasten
      snd.place();
      this.onPlace();
      if (this.pieces.every(q => q.placed)) { this.locked = true; this.onSolved(); }
    } else if (d.moved) {
      const gx = Math.round((px - this.bx) / this.cell);
      const gy = Math.round((py - this.by) / this.cell);
      if (this.cells(p).some(([cx, cy]) => this.region.has(K(cx + gx, cy + gy)))) {
        snd.invalid(); // aufs Brett gelegt, passt dort aber nicht
      }
    }
    this._after();
  }

  // Einrast-Hilfe: exakte Position zuerst, sonst die nächstgelegene passende
  // Nachbarposition im Umkreis von ~1 Zelle.
  _snapPos(p, px, py) {
    const exactX = (px - this.bx) / this.cell, exactY = (py - this.by) / this.cell;
    const gx = Math.round(exactX), gy = Math.round(exactY);
    const cand = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const dist = Math.hypot(gx + dx - exactX, gy + dy - exactY);
        if (dist <= 1.05) cand.push({ gx: gx + dx, gy: gy + dy, dist });
      }
    }
    cand.sort((a, b) => a.dist - b.dist);
    for (const c of cand) {
      if (this._fits(p, c.gx, c.gy)) return { gx: c.gx, gy: c.gy };
    }
    return null;
  }

  _transform(p, wasPlaced, kind) {
    const before = this.cells(p);
    const c0 = bounds(before);
    if (kind === 'flip') { p.flip = 1 - p.flip; snd.flip(); }
    else { p.rot = (p.rot + 1) % 4; snd.rotate(); }
    if (wasPlaced) {
      // Um die Mitte drehen und wieder einsetzen, wenn es passt
      const c1 = bounds(this.cells(p));
      const gx = wasPlaced.gx + Math.round((c0.w - c1.w) / 2);
      const gy = wasPlaced.gy + Math.round((c0.h - c1.h) / 2);
      if (this._fits(p, gx, gy)) { p.placed = { gx, gy }; return; }
      for (const [dx, dy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]) {
        if (this._fits(p, gx + dx, gy + dy)) { p.placed = { gx: gx + dx, gy: gy + dy }; return; }
      }
      p.placed = null; // passt nicht mehr -> zurück in die Ablage
    }
  }

  _fits(p, gx, gy) {
    const occ = new Set();
    for (const q of this.pieces) {
      if (!q.placed || q === p) continue;
      for (const [cx, cy] of this.cells(q)) occ.add(K(cx + q.placed.gx, cy + q.placed.gy));
    }
    return this.cells(p).every(([cx, cy]) => {
      const k = K(cx + gx, cy + gy);
      return this.region.has(k) && !occ.has(k);
    });
  }

  _after() { this._layoutTray(); }

  // ---------- Hilfen ----------
  showHint(solution) {
    // Zeigt die Zielposition eines noch falsch liegenden Teils als Geist an.
    const placedOK = new Set();
    for (const sol of solution) {
      const p = this.pieces.find(q => q.id === sol.id);
      if (!p || !p.placed) continue;
      const abs = this.cells(p).map(([x, y]) => K(x + p.placed.gx, y + p.placed.gy));
      const target = new Set(sol.cells.map(c => K(c[0], c[1])));
      if (abs.every(k => target.has(k))) placedOK.add(sol.id);
    }
    const next = solution.find(s => !placedOK.has(s.id));
    if (!next) return false;
    this.hint = { cells: next.cells, color: PIECE_MAP[next.id].color, until: performance.now() + 2600 };
    return true;
  }

  reveal(solution) {
    // Lösung auflegen (Rundenende)
    for (const sol of solution) {
      const p = this.pieces.find(q => q.id === sol.id);
      // Passende Orientierung + Position aus der Lösung ableiten
      const target = sol.cells.map(c => c.slice()).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      const minX = Math.min(...target.map(c => c[0])), minY = Math.min(...target.map(c => c[1]));
      const norm = target.map(([x, y]) => [x - minX, y - minY]);
      outer:
      for (let f = 0; f < 2; f++) {
        for (let r = 0; r < 4; r++) {
          p.rot = r; p.flip = f;
          if (JSON.stringify(this.cells(p)) === JSON.stringify(norm)) { p.placed = { gx: minX, gy: minY }; break outer; }
        }
      }
    }
    this.locked = true;
    this._layoutTray();
  }

  // ---------- Zeichnen ----------
  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    const c = this.cell;
    this._drawWoodPanel(ctx, c);

    // Karten-Sockel (Vertiefungen)
    ctx.save();
    for (const [x, y] of this.card.cells) {
      const px = this.bx + x * c, py = this.by + y * c;
      ctx.fillStyle = 'rgba(30, 10, 2, .46)';
      this._rr(ctx, px + 1.5, py + 1.5, c - 3, c - 3, 5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 214, 150, .18)';
      ctx.lineWidth = 1.5;
      this._rr(ctx, px + 1.5, py + 1.5, c - 3, c - 3, 5);
      ctx.stroke();
    }
    ctx.restore();

    // Tipp-Geist
    if (this.hint) {
      if (performance.now() > this.hint.until) this.hint = null;
      else {
        const blink = 0.35 + 0.3 * Math.sin(performance.now() / 160);
        ctx.save();
        ctx.globalAlpha = blink;
        for (const [x, y] of this.hint.cells) {
          ctx.fillStyle = this.hint.color;
          this._rr(ctx, this.bx + x * c + 3, this.by + y * c + 3, c - 6, c - 6, 6);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    // Platzierte Teile (frisch eingerastete "setzen" sich kurz)
    for (const p of this.pieces) {
      if (!p.placed) continue;
      const ox = this.bx + p.placed.gx * c, oy = this.by + p.placed.gy * c;
      const sel = p.id === this.selectedId && !this.locked;
      if (p.settle != null) {
        const el = performance.now() - p.settle;
        if (el >= 560) { p.settle = null; this._drawPiece(p, ox, oy, c, sel); continue; }
        const t = Math.min(1, el / 240);
        const k = 1 + 0.12 * (1 - t) * Math.cos(t * Math.PI * 2.2); // gedämpftes Einschwingen
        const b = bounds(this.cells(p));
        const cx = ox + b.w * c / 2, cy = oy + b.h * c / 2;
        ctx.save();
        ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
        this._drawPiece(p, ox, oy, c, sel);
        // Licht-Sweep: ein Glanzband läuft einmal schräg über das Teil
        if (!this.reduceMotion) this._sweep(p, ox, oy, c, el / 560);
        ctx.restore();
      } else {
        this._drawPiece(p, ox, oy, c, sel);
      }
    }
    // Stammplätze in der Ablage dezent andeuten; der aktive leuchtet
    for (const p of this.pieces) {
      if (!p.slot) continue;
      const active = p.id === this.selectedId && !p.placed && !(p.drag && p.drag.moved) && !this.locked;
      ctx.save();
      ctx.fillStyle = active ? 'rgba(255, 211, 77, .14)' : 'rgba(30, 10, 2, .18)';
      ctx.strokeStyle = active ? 'rgba(255, 227, 150, .85)' : 'rgba(255, 214, 150, .12)';
      ctx.lineWidth = active ? 2.5 : 1.5;
      if (active) { ctx.shadowColor = 'rgba(255, 211, 77, .5)'; ctx.shadowBlur = 10; }
      this._rr(ctx, p.slot.x - 4, p.slot.y - 4, p.slot.px + 8, p.slot.px + 8, 9);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    // Ablage-Teile (jedes zentriert in seinem festen Slot); ein nur
    // gehaltenes (noch nicht gezogenes) Teil bleibt normal liegen
    for (const p of this.pieces) {
      if (p.placed || (p.drag && p.drag.moved)) continue;
      this._drawPiece(p, p.tray.x, p.tray.y, p.tray.cell, p.id === this.selectedId);
    }
    // Gezogenes Teil zuletzt (über allem, mit Schatten)
    const dp = this.dragPiece;
    if (dp && dp.drag && dp.drag.moved) {
      const ctx2 = this.ctx;
      ctx2.save();
      ctx2.shadowColor = 'rgba(0,0,0,.5)';
      ctx2.shadowBlur = 16;
      ctx2.shadowOffsetY = 10;
      const px = dp.drag.x + dp.drag.ox, py = dp.drag.y + dp.drag.oy;
      // Einrast-Vorschau mit sanftem Glow-Puls (bei reduced-motion statisch)
      const snap = this._snapPos(dp, px, py);
      if (snap) {
        const pulse = this.reduceMotion ? 0 : Math.sin(performance.now() / 170);
        ctx2.save();
        ctx2.globalAlpha = .34 + .12 * pulse;
        ctx2.shadowColor = 'rgba(255, 235, 170, .9)';
        ctx2.shadowBlur = 12 + 5 * pulse;
        ctx2.shadowOffsetY = 0;
        for (const [cx, cy] of this.cells(dp)) {
          ctx2.fillStyle = '#ffffff';
          this._rr(ctx2, this.bx + (cx + snap.gx) * c + 3, this.by + (cy + snap.gy) * c + 3, c - 6, c - 6, 6);
          ctx2.fill();
        }
        ctx2.restore();
      }
      this._drawPiece(dp, px, py, c, true);
      ctx2.restore();
    }
  }

  // Holz-Sockel hinter der Karte – lässt die Karte plastischer wirken.
  // Liegt img/wood.png vor, wird es als Textur genutzt; die abgedunkelten
  // Ränder und die warme Lichtkante bleiben in beiden Fällen erhalten.
  _drawWoodPanel(ctx, c) {
    const bw = this.cardBounds.w * c, bh = this.cardBounds.h * c;
    const pad = Math.min(14, c * 0.34);
    const x = this.bx - pad, y = this.by - pad, w = bw + pad * 2, h = bh + pad * 2;
    const tex = asset('wood');

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.38)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 7;
    const wood = ctx.createLinearGradient(0, y, 0, y + h);
    wood.addColorStop(0, '#9a5526');
    wood.addColorStop(0.5, '#7c3d15');
    wood.addColorStop(1, '#5d2b0d');
    ctx.fillStyle = wood;
    this._rr(ctx, x, y, w, h, 12);
    ctx.fill();
    ctx.restore();

    if (tex) {
      // Textur formatfüllend (cover) in den abgerundeten Sockel zeichnen
      ctx.save();
      this._rr(ctx, x, y, w, h, 12);
      ctx.clip();
      const sc = Math.max(w / tex.width, h / tex.height);
      const dw = tex.width * sc, dh = tex.height * sc;
      ctx.drawImage(tex, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      // Ränder abdunkeln, damit der Sockel plastisch bleibt
      const edge = ctx.createLinearGradient(0, y, 0, y + h);
      edge.addColorStop(0, 'rgba(50, 20, 4, .22)');
      edge.addColorStop(0.35, 'rgba(0, 0, 0, 0)');
      edge.addColorStop(0.75, 'rgba(0, 0, 0, .08)');
      edge.addColorStop(1, 'rgba(25, 8, 0, .34)');
      ctx.fillStyle = edge;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }

    ctx.save();
    if (!tex) {
      // Dezente Maserung (deterministisch, kein Flackern)
      ctx.globalAlpha = 0.13;
      ctx.strokeStyle = '#3a1a06';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const lines = Math.max(3, Math.round(h / 24));
      for (let i = 1; i <= lines; i++) {
        const ly = y + (h * i) / (lines + 1);
        ctx.moveTo(x + 5, ly);
        for (let lx = 0; lx <= w - 10; lx += 10) {
          ctx.lineTo(x + 5 + lx, ly + Math.sin((lx + i * 53) / 26) * 1.6);
        }
      }
      ctx.stroke();
    }
    // Warme Lichtkante
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = '#ffd9a0';
    ctx.lineWidth = 1.5;
    this._rr(ctx, x + 1.5, y + 1.5, w - 3, h - 3, 10);
    ctx.stroke();
    ctx.restore();
  }

  // Vierstrahliger Funkel-Stern
  _star(ctx, x, y, r, a) {
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const ang = i * Math.PI / 4 + Math.PI / 8;
      const rr = i % 2 ? r * 0.32 : r;
      ctx.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawPiece(p, ox, oy, c, selected) {
    const ctx = this.ctx;
    const cells = this.cells(p);
    const has = new Set(cells.map(([x, y]) => K(x, y)));
    const g = Math.max(1, c * 0.03); // Fuge zwischen Teilen
    const skin = PIECE_SKIN;
    // Holz-Look: Teil-Farbe gedeckt ins Bräunliche gemischt (bleibt unterscheidbar)
    const col = skin === 'holz' ? mix(p.color, '#8a5a2b', 0.55) : p.color;
    const rad = skin === 'bonbon' ? 0.3 : skin === 'juwelen' ? 0.14 : skin === 'kristall' ? 0.16 : 0.18;
    const pb = bounds(cells);

    // Weicher Schlagschatten unter dem Teil: Die Füllung liegt weit außerhalb
    // des Canvas, nur ihr versetzter Schatten wird sichtbar - so bleibt das
    // (halbtransparente) Teil selbst unangetastet.
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, .36)';
    ctx.shadowBlur = c * 0.2;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2000 + c * 0.11;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    for (const [x, y] of cells) ctx.rect(ox + x * c + g, oy + y * c + g - 2000, c - 2 * g, c - 2 * g);
    ctx.fill();
    ctx.restore();

    // Kristall: ein diagonaler Verlauf über das ganze Teil
    let kristallGrad = null;
    if (skin === 'kristall') {
      kristallGrad = ctx.createLinearGradient(ox, oy, ox + pb.w * c, oy + pb.h * c);
      kristallGrad.addColorStop(0, shade(col, 0.62));
      kristallGrad.addColorStop(0.45, col);
      kristallGrad.addColorStop(1, shade(col, -0.42));
    }

    for (const [x, y] of cells) {
      const px = ox + x * c, py = oy + y * c;
      const n = has.has(K(x, y - 1)), s = has.has(K(x, y + 1)),
            w = has.has(K(x - 1, y)), e = has.has(K(x + 1, y));
      // Grundfläche mit Verlauf (je nach Teile-Look)
      const grad = ctx.createLinearGradient(px, py, px, py + c);
      if (skin === 'juwelen') {
        grad.addColorStop(0, shade(col, 0.55));
        grad.addColorStop(0.45, shade(col, 0.08));
        grad.addColorStop(1, shade(col, -0.22));
      } else if (skin === 'bonbon') {
        grad.addColorStop(0, shade(col, 0.42));
        grad.addColorStop(0.55, col);
        grad.addColorStop(1, shade(col, -0.3));
      } else if (skin === 'holz') {
        grad.addColorStop(0, shade(col, 0.14));
        grad.addColorStop(1, shade(col, -0.14));
      } else {
        grad.addColorStop(0, shade(col, 0.22));
        grad.addColorStop(1, shade(col, -0.12));
      }
      const x0 = px + (w ? 0 : g), y0 = py + (n ? 0 : g);
      const x1 = px + c - (e ? 0 : g), y1 = py + c - (s ? 0 : g);
      if (skin === 'kristall') {
        // Frost-Unterlage: hält die Farben auch über dunklem Holz leuchtend bunt
        ctx.fillStyle = 'rgba(255,255,255,.45)';
        this._rrEdges(ctx, x0, y0, x1 - x0, y1 - y0, c * rad, !n && !w, !n && !e, !s && !e, !s && !w);
        ctx.fill();
      }
      ctx.fillStyle = skin === 'kristall' ? kristallGrad : grad;
      if (skin === 'juwelen') ctx.globalAlpha = 0.84; // leicht durchscheinender Kristall
      if (skin === 'kristall') ctx.globalAlpha = 0.88; // Glas: Untergrund schimmert dezent durch
      this._rrEdges(ctx, x0, y0, x1 - x0, y1 - y0, c * rad, !n && !w, !n && !e, !s && !e, !s && !w);
      ctx.fill();
      if (skin === 'juwelen' || skin === 'kristall') ctx.globalAlpha = 1;

      // Kanten-Licht je Teile-Look
      if (skin === 'bonbon') {
        // breites, weiches Top-Highlight (Hochglanz-Bonbon)
        if (!n) {
          ctx.fillStyle = 'rgba(255,255,255,.44)';
          this._rr(ctx, x0 + (x1 - x0) * .08, y0 + g + c * .04, (x1 - x0) * .84, c * .17, c * .085); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.16)';
          this._rr(ctx, x0 + (x1 - x0) * .08, y0 + g + c * .04, (x1 - x0) * .84, c * .3, c * .085); ctx.fill();
        }
        if (!s) { ctx.fillStyle = 'rgba(0,0,0,.24)'; ctx.fillRect(x0 + c * .14, y1 - g - c * .08, (x1 - x0) - c * .28, c * .08); }
      } else if (skin === 'holz') {
        // matte Kanten + feine Maserungslinien (deterministisch je Zelle)
        if (!n) { ctx.fillStyle = 'rgba(255,244,220,.16)'; ctx.fillRect(x0 + c * .12, y0 + g, (x1 - x0) - c * .24, c * .07); }
        if (!s) { ctx.fillStyle = 'rgba(30,14,2,.18)'; ctx.fillRect(x0 + c * .12, y1 - g - c * .07, (x1 - x0) - c * .24, c * .07); }
        ctx.strokeStyle = 'rgba(52, 26, 6, .24)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let li = 1; li <= 2; li++) {
          const ly = py + c * (0.32 * li + 0.08);
          const wob = ((x * 7 + y * 13 + li * 5) % 5) - 2;
          ctx.moveTo(x0 + 2, ly);
          ctx.quadraticCurveTo(px + c / 2, ly + wob, x1 - 2, ly);
        }
        ctx.stroke();
      } else if (skin === 'juwelen') {
        if (!n) { ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(x0 + c * .16, y0 + g, (x1 - x0) - c * .32, c * .08); }
        if (!s) { ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(x0 + c * .14, y1 - g - c * .09, (x1 - x0) - c * .28, c * .09); }
      } else {
        // Klassisch: Glanzkante oben / Schattenkante unten
        if (!n) { ctx.fillStyle = 'rgba(255,255,255,.42)'; ctx.fillRect(x0 + c * .12, y0 + g, (x1 - x0) - c * .24, c * .1); }
        if (!s) { ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(x0 + c * .12, y1 - g - c * .09, (x1 - x0) - c * .24, c * .09); }
      }
      // Innere Rasterlinien (Einheitsquadrate sichtbar machen)
      ctx.strokeStyle = skin === 'kristall' ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.13)';
      ctx.lineWidth = 1;
      if (e) { ctx.beginPath(); ctx.moveTo(px + c, py + 2); ctx.lineTo(px + c, py + c - 2); ctx.stroke(); }
      if (s) { ctx.beginPath(); ctx.moveTo(px + 2, py + c); ctx.lineTo(px + c - 2, py + c); ctx.stroke(); }
    }

    // Juwelen-Look: heller Kern, kräftiges Glanzlicht und kleiner Funkelpunkt
    if (skin === 'juwelen') {
      const b = bounds(cells);
      ctx.save();
      ctx.beginPath();
      for (const [x, y] of cells) ctx.rect(ox + x * c + g, oy + y * c + g, c - 2 * g, c - 2 * g);
      ctx.clip();
      const cxp = ox + b.w * c * 0.36, cyp = oy + b.h * c * 0.3;
      const core = ctx.createRadialGradient(cxp, cyp, 0, cxp, cyp, Math.max(b.w, b.h) * c * 0.55);
      core.addColorStop(0, 'rgba(255,255,255,.34)');
      core.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = core;
      ctx.fillRect(ox, oy, b.w * c, b.h * c);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(cxp - c * 0.06, cyp - c * 0.16, c * 0.34, c * 0.13, -0.5, 0, Math.PI * 2);
      ctx.fill();
      const [fx0, fy0] = cells[0];
      const fx = ox + fx0 * c + c * 0.72, fy = oy + fy0 * c + c * 0.26;
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.arc(fx, fy, c * 0.09, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.95;
      ctx.beginPath(); ctx.arc(fx, fy, c * 0.045, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    if (skin === 'kristall') {
      ctx.save();
      ctx.beginPath();
      for (const [x, y] of cells) ctx.rect(ox + x * c + g, oy + y * c + g, c - 2 * g, c - 2 * g);
      ctx.clip();
      // Heller Lichtkern
      const cxp = ox + pb.w * c * 0.38, cyp = oy + pb.h * c * 0.32;
      const core = ctx.createRadialGradient(cxp, cyp, 0, cxp, cyp, Math.max(pb.w, pb.h) * c * 0.7);
      core.addColorStop(0, 'rgba(255,255,255,.5)');
      core.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = core;
      ctx.fillRect(ox, oy, pb.w * c, pb.h * c);
      // Diagonale Facetten-Streifen
      ctx.strokeStyle = 'rgba(255,255,255,.22)';
      ctx.lineWidth = c * 0.11;
      ctx.beginPath();
      for (let i = -pb.h; i < pb.w; i++) {
        ctx.moveTo(ox + i * c + c * 0.25, oy + pb.h * c);
        ctx.lineTo(ox + (i + pb.h) * c + c * 0.55, oy);
      }
      ctx.stroke();
      // Zwei ruhige Funkelsterne
      const [c0x, c0y] = cells[0];
      const [clx, cly] = cells[cells.length - 1];
      this._star(ctx, ox + c0x * c + c * 0.76, oy + c0y * c + c * 0.28, c * 0.11, 0.55);
      this._star(ctx, ox + clx * c + c * 0.3, oy + cly * c + c * 0.72, c * 0.07, 0.4);
      // Gelegentliches Aufblitzen auf wechselnden Zellen
      if (!this.reduceMotion) {
        const t = performance.now();
        const cyc = 3400, off = p.i * 911;
        const ph = ((t + off) % cyc) / cyc;
        if (ph < 0.22) {
          const a = Math.sin((ph / 0.22) * Math.PI);
          const ci = Math.floor((t + off) / cyc) % cells.length;
          const [tx, ty] = cells[ci];
          this._star(ctx, ox + tx * c + c * 0.62, oy + ty * c + c * 0.38, c * 0.17, a * 0.9);
        }
      }
      ctx.restore();
    }

    // Umriss (bei Auswahl: goldene Leuchtkante statt weißem Rahmen)
    const outline = () => {
      ctx.beginPath();
      for (const [x, y] of cells) {
        const px = ox + x * c, py = oy + y * c;
        const n = has.has(K(x, y - 1)), s = has.has(K(x, y + 1)),
              w = has.has(K(x - 1, y)), e = has.has(K(x + 1, y));
        if (!n) { ctx.moveTo(px + (w ? 0 : g), py + g); ctx.lineTo(px + c - (e ? 0 : g), py + g); }
        if (!s) { ctx.moveTo(px + (w ? 0 : g), py + c - g); ctx.lineTo(px + c - (e ? 0 : g), py + c - g); }
        if (!w) { ctx.moveTo(px + g, py + (n ? 0 : g)); ctx.lineTo(px + g, py + c - (s ? 0 : g)); }
        if (!e) { ctx.moveTo(px + c - g, py + (n ? 0 : g)); ctx.lineTo(px + c - g, py + c - (s ? 0 : g)); }
      }
      ctx.stroke();
    };
    if (selected) {
      ctx.save();
      const pulse = this.reduceMotion ? 0 : Math.sin(performance.now() / 280) * 3;
      ctx.shadowColor = 'rgba(255, 212, 110, .95)';
      ctx.shadowBlur = 10 + pulse;
      ctx.strokeStyle = 'rgba(255, 240, 190, .95)';
      ctx.lineWidth = 2.5;
      outline();
      outline(); // zweiter Strich verstärkt das Leuchten
      ctx.restore();
    } else if (skin === 'kristall') {
      // Juwelen-Kante: dunkle Kontur mit hellem Glaslicht darin
      ctx.strokeStyle = shade(col, -0.55);
      ctx.lineWidth = 2.4;
      outline();
      ctx.strokeStyle = 'rgba(255,255,255,.65)';
      ctx.lineWidth = 1;
      outline();
    } else {
      ctx.strokeStyle = 'rgba(30,10,0,.45)';
      ctx.lineWidth = 1.5;
      outline();
    }
  }

  // Glanzband für den Einrast-Moment (q: 0..1)
  _sweep(p, ox, oy, c, q) {
    const ctx = this.ctx;
    const cells = this.cells(p);
    const b = bounds(cells);
    const w = b.w * c, h = b.h * c;
    ctx.save();
    ctx.beginPath();
    for (const [x, y] of cells) ctx.rect(ox + x * c, oy + y * c, c, c);
    ctx.clip();
    const x = ox - h - c + q * (w + h + 2 * c);
    const grad = ctx.createLinearGradient(x, oy + h, x + h + c, oy);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(ox, oy, w, h);
    ctx.restore();
  }

  _rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  _rrEdges(ctx, x, y, w, h, r, tl, tr, br, bl) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, [tl ? r : 0, tr ? r : 0, br ? r : 0, bl ? r : 0]);
  }

  rotateSelected() { this._btnTransform('rot'); }
  flipSelected()   { this._btnTransform('flip'); }

  _btnTransform(kind) {
    if (this.locked) return;
    let p = this.pieces.find(q => q.id === this.selectedId);
    if (!p) { p = this.pieces.find(q => !q.placed); if (p) this.selectedId = p.id; }
    if (!p) return;
    const wasPlaced = p.placed ? { ...p.placed } : null;
    p.placed = null;
    this._transform(p, wasPlaced, kind);
    this._after();
  }
}
