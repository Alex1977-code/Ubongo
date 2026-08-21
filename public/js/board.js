// Spielbrett-Ansicht: zeichnet Karte + Teile auf Canvas und verarbeitet Touch-Eingaben.
// Ziehen = bewegen · Tippen = auswählen, erneut tippen = drehen · Einrasten am Raster.

import { PIECE_MAP, transform, bounds } from './pieces.js';
import * as snd from './sound.js';

const K = (x, y) => x + ',' + y;

function shade(hex, f) { // Farbe aufhellen (f>0) oder abdunkeln (f<0)
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v + (f > 0 ? (255 - v) * f : v * f))));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

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
        const t = (performance.now() - p.settle) / 240;
        if (t >= 1) { p.settle = null; this._drawPiece(p, ox, oy, c, sel); continue; }
        const k = 1 + 0.12 * (1 - t) * Math.cos(t * Math.PI * 2.2); // gedämpftes Einschwingen
        const b = bounds(this.cells(p));
        const cx = ox + b.w * c / 2, cy = oy + b.h * c / 2;
        ctx.save();
        ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
        this._drawPiece(p, ox, oy, c, sel);
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
      // Einrast-Vorschau (gleiche Logik wie beim Ablegen, inkl. Einrast-Hilfe)
      const snap = this._snapPos(dp, px, py);
      if (snap) {
        ctx2.save();
        ctx2.globalAlpha = .35;
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
  _drawWoodPanel(ctx, c) {
    const bw = this.cardBounds.w * c, bh = this.cardBounds.h * c;
    const pad = Math.min(14, c * 0.34);
    const x = this.bx - pad, y = this.by - pad, w = bw + pad * 2, h = bh + pad * 2;

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

    ctx.save();
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
    // Warme Lichtkante
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = '#ffd9a0';
    ctx.lineWidth = 1.5;
    this._rr(ctx, x + 1.5, y + 1.5, w - 3, h - 3, 10);
    ctx.stroke();
    ctx.restore();
  }

  _drawPiece(p, ox, oy, c, selected) {
    const ctx = this.ctx;
    const cells = this.cells(p);
    const has = new Set(cells.map(([x, y]) => K(x, y)));
    const g = Math.max(1, c * 0.03); // Fuge zwischen Teilen

    for (const [x, y] of cells) {
      const px = ox + x * c, py = oy + y * c;
      const n = has.has(K(x, y - 1)), s = has.has(K(x, y + 1)),
            w = has.has(K(x - 1, y)), e = has.has(K(x + 1, y));
      // Grundfläche mit Verlauf
      const grad = ctx.createLinearGradient(px, py, px, py + c);
      grad.addColorStop(0, shade(p.color, 0.22));
      grad.addColorStop(1, shade(p.color, -0.12));
      ctx.fillStyle = grad;
      const x0 = px + (w ? 0 : g), y0 = py + (n ? 0 : g);
      const x1 = px + c - (e ? 0 : g), y1 = py + c - (s ? 0 : g);
      this._rrEdges(ctx, x0, y0, x1 - x0, y1 - y0, c * 0.18, !n && !w, !n && !e, !s && !e, !s && !w);
      ctx.fill();
      // Glanzkante oben / Schattenkante unten
      if (!n) { ctx.fillStyle = 'rgba(255,255,255,.42)'; ctx.fillRect(x0 + c * .12, y0 + g, (x1 - x0) - c * .24, c * .1); }
      if (!s) { ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(x0 + c * .12, y1 - g - c * .09, (x1 - x0) - c * .24, c * .09); }
      // Innere Rasterlinien (Einheitsquadrate sichtbar machen)
      ctx.strokeStyle = 'rgba(0,0,0,.13)';
      ctx.lineWidth = 1;
      if (e) { ctx.beginPath(); ctx.moveTo(px + c, py + 2); ctx.lineTo(px + c, py + c - 2); ctx.stroke(); }
      if (s) { ctx.beginPath(); ctx.moveTo(px + 2, py + c); ctx.lineTo(px + c - 2, py + c); ctx.stroke(); }
    }
    // Umriss
    ctx.strokeStyle = selected ? '#fff' : 'rgba(30,10,0,.45)';
    ctx.lineWidth = selected ? 2.5 : 1.5;
    for (const [x, y] of cells) {
      const px = ox + x * c, py = oy + y * c;
      const n = has.has(K(x, y - 1)), s = has.has(K(x, y + 1)),
            w = has.has(K(x - 1, y)), e = has.has(K(x + 1, y));
      ctx.beginPath();
      if (!n) { ctx.moveTo(px + (w ? 0 : g), py + g); ctx.lineTo(px + c - (e ? 0 : g), py + g); }
      if (!s) { ctx.moveTo(px + (w ? 0 : g), py + c - g); ctx.lineTo(px + c - (e ? 0 : g), py + c - g); }
      if (!w) { ctx.moveTo(px + g, py + (n ? 0 : g)); ctx.lineTo(px + g, py + c - (s ? 0 : g)); }
      if (!e) { ctx.moveTo(px + c - g, py + (n ? 0 : g)); ctx.lineTo(px + c - g, py + c - (s ? 0 : g)); }
      ctx.stroke();
    }
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
