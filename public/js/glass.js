// Glas-Spielsteine: echte 3D-Beleuchtung statt flacher Farbverläufe.
//
// Verfahren (Normalen-Karte + Phong):
//   1. Aus den Zellen wird der Umriss des GANZEN Teils verfolgt und als Pfad
//      mit außen wie innen abgerundeten Ecken gezeichnet - das ergibt eine
//      kantengeglättete Maske (bei kleinen Zellen zweifach überabgetastet).
//   2. Für jedes Pixel wird der Abstand zum Umriss berechnet. Daraus formt eine
//      Kennlinie ein Höhenprofil: fast senkrechte Flanke, geschliffene Fase,
//      nahezu ebenes Plateau, mit feiner Nut an den Zell-Nähten.
//   3. Der Gradient dieses Höhenfelds liefert pro Pixel eine Normale. Damit wird
//      echt beleuchtet: Lambert-Diffus, zwei Blinn-Phong-Glanzlichter, ein
//      Streiflicht, ein Fresnel-Term und eine getönte Umgebungsspiegelung.
//   4. Zwei getrennte Distanzfelder (zu licht-zugewandten bzw. -abgewandten
//      Kanten) erzeugen die Lichtleitung im Glas: oben links leuchtet die Farbe
//      auf, unten rechts sitzt die satte dunkle Verdickung.
//
// Das Licht steht fest oben links im BILDSCHIRM-Raum - drehen und spiegeln die
// Spieler ihre Teile, wandert es also korrekterweise nicht mit.
//
// Alles Teure liegt je Form/Größe/Farbe/Auswahl in Offscreen-Canvas; pro Bild
// bleiben nur wenige drawImage-Aufrufe (~0,03 ms pro Teil).

// ============================================================================
//  proto-A  –  NORMALEN-KARTE + PHONG
//  Aus den Zellen wird eine Maske gebaut, darauf eine exakte Distanz zum Rand
//  gerechnet, daraus ein Höhenfeld (steile Flanke + geschliffene Fase + fast
//  ebenes Plateau + feine Nut an den Zell-Nähten), daraus pro Pixel eine
//  Normale und daraus echte Beleuchtung: Lambert + Blinn-Phong + Fresnel +
//  gefälschte Umgebungsspiegelung + Fensterreflex.
//  Alles einmal pro (Form, Größe, Farbe, Auswahl) in Offscreen-Canvas gecacht.
// ============================================================================

// ---------------------------------------------------------------- Helferlein
function nm_cv(w, h) { const e = document.createElement('canvas'); e.width = w; e.height = h; return e; }
function nm_rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function nm_cl(v, a, b) { return v < a ? a : (v > b ? b : v); }

// ------------------------------------------------- Umriss des Polyominos
function nm_simplify(loop) {
  const n = loop.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = loop[(i - 1 + n) % n], q = loop[i], r = loop[(i + 1) % n];
    const ax = q[0] - p[0], ay = q[1] - p[1], bx = r[0] - q[0], by = r[1] - q[1];
    if (ax * by - ay * bx !== 0) out.push(q);
  }
  return out;
}

function nm_trace(cells) {
  const has = new Set(cells.map(p => p[0] + ',' + p[1]));
  const map = new Map();
  const add = (a, b) => { const k = a[0] + ',' + a[1]; const l = map.get(k); if (l) l.push(b); else map.set(k, [b]); };
  for (const cc of cells) {
    const x = cc[0], y = cc[1];
    if (!has.has(x + ',' + (y - 1))) add([x, y], [x + 1, y]);
    if (!has.has((x + 1) + ',' + y)) add([x + 1, y], [x + 1, y + 1]);
    if (!has.has(x + ',' + (y + 1))) add([x + 1, y + 1], [x, y + 1]);
    if (!has.has((x - 1) + ',' + y)) add([x, y + 1], [x, y]);
  }
  const loops = [];
  let guard = 0;
  while (map.size && guard++ < 400) {
    const sk = map.keys().next().value;
    const start = sk.split(',').map(Number);
    let cur = start; const loop = [];
    for (let i = 0; i < 400; i++) {
      const k = cur[0] + ',' + cur[1];
      const arr = map.get(k);
      if (!arr || !arr.length) break;
      const nx = arr.pop(); if (!arr.length) map.delete(k);
      loop.push(cur); cur = nx;
      if (cur[0] === start[0] && cur[1] === start[1]) break;
    }
    if (loop.length > 2) loops.push(nm_simplify(loop));
  }
  return loops;
}

// Pfad mit abgerundeten Ecken (innen wie außen) über arcTo/Kantenmitten
function nm_path(ctx, loops, c, offx, offy, r) {
  ctx.beginPath();
  for (const L of loops) {
    const n = L.length;
    const P = L.map(p => [offx + p[0] * c, offy + p[1] * c]);
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const s = mid(P[0], P[1]);
    ctx.moveTo(s[0], s[1]);
    for (let i = 1; i <= n; i++) {
      const prev = P[(i - 1 + n) % n];
      const cur = P[i % n], nxt = P[(i + 1) % n];
      const m = mid(cur, nxt);
      const rr = Math.min(r, len(prev, cur) / 2, len(cur, nxt) / 2);
      ctx.arcTo(cur[0], cur[1], m[0], m[1], rr);
      ctx.lineTo(m[0], m[1]);
    }
    ctx.closePath();
  }
}

// Weiche Silhouette: Form in Hilfs-Canvas, dann per Canvas-Filter weichzeichnen
function nm_blob(ctx, loops, c, P, r, blur, ox, oy, col, w, h) {
  const t = nm_cv(w, h);
  const tc = t.getContext('2d');
  tc.fillStyle = col;
  nm_path(tc, loops, c, P + ox, P + oy, r);
  tc.fill();
  ctx.save();
  if (blur > 0.2) ctx.filter = 'blur(' + blur.toFixed(2) + 'px)';
  ctx.drawImage(t, 0, 0);
  ctx.restore();
}

// ------------------------------------------------------------------- Licht
const NM_L = (function () { const v = [-0.50, -0.63, 0.594]; const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })();
const NM_H = (function () { const v = [NM_L[0], NM_L[1], NM_L[2] + 1]; const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })();
const NM_H2 = (function () { const v = [0.55, 0.42, 1.72]; const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })();

// ------------------------------------------------------------------ Cache
const NM_CACHE = new Map();
const NM_MAX = 48;
let NM_TMP = null;
export function resetGlassCache() { NM_CACHE.clear(); NM_TMP = null; }

// =========================================================== Sprite-Aufbau
function nm_build(cells, c, color, sel) {
  let maxX = 0, maxY = 0;
  for (const p of cells) { if (p[0] + 1 > maxX) maxX = p[0] + 1; if (p[1] + 1 > maxY) maxY = p[1] + 1; }
  const gw = maxX * c, gh = maxY * c;
  const P = Math.ceil(c * 0.5) + 12;
  const w = Math.ceil(gw + 2 * P), h = Math.ceil(gh + 2 * P);
  const ss = c <= 64 ? 2 : 1;
  const SW = w * ss, SH = h * ss;

  const loops = nm_trace(cells);
  const R = c * 0.15;

  // ---- Maske (anti-aliased) -------------------------------------------
  const mk = nm_cv(SW, SH);
  const mc = mk.getContext('2d');
  mc.setTransform(ss, 0, 0, ss, 0, 0);
  mc.fillStyle = '#fff';
  nm_path(mc, loops, c, P, P, R);
  mc.fill();
  mc.setTransform(1, 0, 0, 1, 0, 0);
  const mdat = mc.getImageData(0, 0, SW, SH).data;

  // ---- Segmente: Außenrand + innere Nähte ------------------------------
  // Segment-Format: [vertikal?, festeKoord, lo, hi, beleuchtet?]
  // "beleuchtet" = Außennormale zeigt nach oben/links (Licht kommt von dort)
  const bnd = [];
  for (const L of loops) {
    const n = L.length;
    for (let i = 0; i < n; i++) {
      const a = L[i], b = L[(i + 1) % n];
      const ax = P + a[0] * c, ay = P + a[1] * c, bx = P + b[0] * c, by = P + b[1] * c;
      const dxs = bx - ax, dys = by - ay;
      const onx = dys, ony = -dxs;                  // Außennormale
      const lit = (onx * -0.62 + ony * -0.78) > 0 ? 1 : 0;
      if (Math.abs(ax - bx) < 1e-6) bnd.push([1, ax, Math.min(ay, by), Math.max(ay, by), lit]);
      else bnd.push([0, ay, Math.min(ax, bx), Math.max(ax, bx), lit]);
    }
  }
  const has = new Set(cells.map(p => p[0] + ',' + p[1]));
  const seam = [];
  for (const cc of cells) {
    const x = cc[0], y = cc[1];
    if (has.has((x + 1) + ',' + y)) seam.push([1, P + (x + 1) * c, P + y * c, P + (y + 1) * c]);
    if (has.has(x + ',' + (y + 1))) seam.push([0, P + (y + 1) * c, P + x * c, P + (x + 1) * c]);
  }

  // ---- Höhenprofil als LUT ---------------------------------------------
  const B = Math.max(2.8, c * 0.20);        // Fasenbreite
  const T = c * 0.42;                       // Materialdicke (Normalen-Skala)
  const dmax = Math.max(gw, gh) * 0.75 + 4;
  const LN = Math.ceil(dmax * 4) + 8;
  const LUT = new Float32Array(LN);
  for (let i = 0; i < LN; i++) {
    const d = i / 4;
    let v;
    if (d <= 0) v = 0;
    else if (d < B) {
      const t = d / B;
      if (t < 0.30) { v = 0.50 * Math.pow(t / 0.30, 0.50); }   // fast senkrechte Flanke
      else { const u = (t - 0.30) / 0.70; v = 0.50 + 0.50 * (1 - Math.pow(1 - u, 1.9)); }
    } else {
      v = 1 + 0.055 * (1 - Math.exp(-(d - B) / (1.8 * B)));
    }
    LUT[i] = v;
  }
  const GW = Math.max(0.95, c * 0.050), GD = 0.062;
  const GN = Math.ceil(GW * 4) + 3;
  const GLUT = new Float32Array(GN);
  for (let i = 0; i < GN; i++) {
    const t = (i / 4) / GW;
    GLUT[i] = t >= 1 ? 0 : GD * (1 - t * t) * (1 - t * t);
  }

  // ---- Höhenfeld --------------------------------------------------------
  const Hf = new Float32Array(SW * SH);
  const Df = new Float32Array(SW * SH);
  const Fx = new Float32Array(SW * SH);   // Abstand zu den beleuchteten Kanten
  const Fy = new Float32Array(SW * SH);   // Abstand zu den abgewandten Kanten
  const inv = 1 / ss;
  const nb = bnd.length, nsm = seam.length;
  for (let j = 0; j < SH; j++) {
    const Y = (j + 0.5) * inv;
    const row = j * SW;
    for (let i = 0; i < SW; i++) {
      const idx = row + i;
      if (mdat[idx * 4 + 3] < 3) continue;
      const X = (i + 0.5) * inv;
      let d = 1e9, dl = 1e9, dd = 1e9;
      for (let k = 0; k < nb; k++) {
        const s = bnd[k];
        let dx, dy;
        if (s[0]) { dx = X - s[1]; dy = Y < s[2] ? Y - s[2] : (Y > s[3] ? Y - s[3] : 0); }
        else { dy = Y - s[1]; dx = X < s[2] ? X - s[2] : (X > s[3] ? X - s[3] : 0); }
        const q = dx * dx + dy * dy;
        if (q < d) d = q;
        if (s[4]) { if (q < dl) dl = q; } else if (q < dd) dd = q;
      }
      d = Math.sqrt(d);
      Df[idx] = d;
      Fx[idx] = Math.sqrt(dl);
      Fy[idx] = Math.sqrt(dd);
      const li = (d * 4) | 0;
      let hh = li < LN ? LUT[li] : 1.055;
      if (nsm && d > B) {
        let ds = 1e9;
        for (let k = 0; k < nsm; k++) {
          const s = seam[k];
          let dx, dy;
          if (s[0]) { dx = X - s[1]; dy = Y < s[2] ? Y - s[2] : (Y > s[3] ? Y - s[3] : 0); }
          else { dy = Y - s[1]; dx = X < s[2] ? X - s[2] : (X > s[3] ? X - s[3] : 0); }
          const q = dx * dx + dy * dy;
          if (q < ds) ds = q;
        }
        ds = Math.sqrt(ds);
        if (ds < GW) hh -= GLUT[(ds * 4) | 0] * nm_cl((d - B) / (B * 0.8), 0, 1);
      }
      Hf[idx] = hh;
    }
  }

  // ---- Schattierung -----------------------------------------------------
  const col = nm_rgb(color);
  let cr = col[0], cg = col[1], cb = col[2];
  const mxc = Math.max(cr, cg, cb) || 1;
  const boost = 1 + 0.12 * (1 - mxc / 255);
  cr = nm_cl(cr * boost, 0, 255); cg = nm_cl(cg * boost, 0, 255); cb = nm_cl(cb * boost, 0, 255);
  // Tönung der Spiegelung: Farbe leicht Richtung Weiß gezogen (Glasfarbe)
  const nmax = Math.max(cr, cg, cb) || 1;
  const tr = 0.30 + 0.70 * (cr / nmax), tg = 0.30 + 0.70 * (cg / nmax), tb = 0.30 + 0.70 * (cb / nmax);

  const mat = mc.createImageData(SW, SH);
  const base = mc.createImageData(SW, SH);
  const bEdge = mc.createImageData(SW, SH);
  const bCore = mc.createImageData(SW, SH);
  const M = mat.data, BA = base.data, BE = bEdge.data, BC = bCore.data;

  const gsc = 0.5 * ss * T;
  const Lx = NM_L[0], Ly = NM_L[1], Lz = NM_L[2];
  const Hx = NM_H[0], Hy = NM_H[1], Hz = NM_H[2];
  const H2x = NM_H2[0], H2y = NM_H2[1], H2z = NM_H2[2];
  const selK = sel ? 1 : 0;
  const diagN = 1 / (gw + gh);

  for (let j = 1; j < SH - 1; j++) {
    const row = j * SW;
    const Y = (j + 0.5) * inv - P;
    for (let i = 1; i < SW - 1; i++) {
      const idx = row + i;
      const cov = mdat[idx * 4 + 3] / 255;
      if (cov <= 0.004) continue;
      const X = (i + 0.5) * inv - P;

      let nx = -(Hf[idx + 1] - Hf[idx - 1]) * gsc;
      let ny = -(Hf[idx + SW] - Hf[idx - SW]) * gsc;
      const il = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      nx *= il; ny *= il;
      const nz = il;
      const d = Df[idx];

      // --- Lambert
      let ndl = nx * Lx + ny * Ly + nz * Lz;
      if (ndl < 0) ndl = 0;
      const diff = 0.20 + 0.92 * ndl;

      // --- Blinn-Phong
      let sp = nx * Hx + ny * Hy + nz * Hz;
      if (sp < 0) sp = 0;
      const s2 = sp * sp, s4 = s2 * s2, s8 = s4 * s4, s16 = s8 * s8, s32 = s16 * s16;
      const sharp = s32 * s32 * s32;                 // ^96
      const wide = s4 * s2;                          // ^6
      let sp2 = nx * H2x + ny * H2y + nz * H2z;
      if (sp2 < 0) sp2 = 0;
      const t2 = sp2 * sp2, t4 = t2 * t2, t8 = t4 * t4, t16 = t8 * t8;
      const rim = t16 * t16;                         // ^32

      // --- Fresnel
      const om = 1 - nz;
      const om2 = om * om;
      const fres = om2 * om2 * (1 - 0.2 * om);
      const kr = 0.05 + 0.95 * fres;

      // --- Fake-Umgebung (Himmel oben, warmer Boden unten)
      const Ry = 2 * nz * ny;
      const up = Ry < 0 ? -Ry : 0, dn = Ry > 0 ? Ry : 0;
      const up2 = up * up;
      let eR = 20 + 205 * up2 + 66 * dn;
      let eG = 24 + 226 * up2 + 40 * dn;
      let eB = 32 + 252 * up2 + 22 * dn;
      // Die Spiegelung wird von der Glasfarbe eingefärbt -> Kanten leuchten
      // farbig statt grau (Totalreflexion im farbigen Glas).
      eR *= (0.42 + 0.72 * tr); eG *= (0.42 + 0.72 * tg); eB *= (0.42 + 0.72 * tb);

      // --- Fensterreflex auf dem Plateau (zwei weiche Streifen)
      const sdi = (X * 0.66 + Y * 0.75) * diagN;
      const q1 = (sdi - 0.225) / 0.038, q2 = (sdi - 0.345) / 0.016;
      const winB = Math.exp(-q1 * q1) * 0.115 + Math.exp(-q2 * q2) * 0.085;

      // --- Kantenglühen (dünne Fresnel-Linie ganz außen)
      const eg = Math.exp(-d / (B * 0.17));

      // --- Lichtleitung im Glas: getrennte Distanzfelder für die beleuchteten
      //     (oben/links) und die abgewandten (unten/rechts) Kanten -> stetig,
      //     keine Knickkante an der Mittelachse.
      const dL = Fx[idx], dD = Fy[idx];
      const litIn = Math.exp(-(dL > B ? dL - B : 0) / (B * 1.7));
      const darkIn = Math.exp(-(dD > B ? dD - B : 0) / (B * 1.5));

      // --- scharfe Facettenkanten Fase/Plateau
      const fq1 = (dL - B) / (B * 0.34), fq2 = (dD - B) / (B * 0.34);
      const facetL = Math.exp(-fq1 * fq1);
      const facetD = Math.exp(-fq2 * fq2);

      // --- Farbe: Körper (Transmission)
      const core = nm_cl((d - B * 0.4) / (B * 1.6), 0, 1);
      const glowK = 0.20 * core + 0.03;

      let r = cr * (diff + glowK);
      let g = cg * (diff + glowK);
      let b = cb * (diff + glowK);

      // Lichtleitung
      const lf = 1 + 0.36 * litIn - 0.21 * darkIn;
      r *= lf; g *= lf; b *= lf;

      // Sättigung im dicken Kern anheben (Glas soll nicht ins Graue kippen)
      const lum = 0.30 * r + 0.59 * g + 0.11 * b;
      const sat = 0.20 + 0.14 * core;
      r += (r - lum) * sat; g += (g - lum) * sat; b += (b - lum) * sat;
      if (r < 0) r = 0; if (g < 0) g = 0; if (b < 0) b = 0;

      // Spiegelung additiv beimischen, Körperfarbe nur leicht verdrängen
      const keep = 1 - 0.22 * kr;
      r = r * keep + eR * kr * 0.92;
      g = g * keep + eG * kr * 0.92;
      b = b * keep + eB * kr * 0.92;

      // farbiger Kantensaum ganz außen
      const sg = 0.80 * eg * fres;
      r += cr * sg + 64 * sg;
      g += cg * sg + 64 * sg;
      b += cb * sg + 64 * sg;

      // Facettenkante: helle Schliffkante oben/links, dunkle Kante unten rechts
      const fl = facetL * 0.52;
      r += cr * fl * 0.42 + 52 * fl;
      g += cg * fl * 0.42 + 52 * fl;
      b += cb * fl * 0.42 + 52 * fl;
      const fd = 1 - 0.17 * facetD;
      r *= fd; g *= fd; b *= fd;

      const glint = sharp * sharp;                   // ^192, winziger Blitzpunkt
      const hi = (1.35 * sharp + 0.85 * glint + 0.07 * wide + 0.30 * rim
        + winB * (1.15 - 0.85 * fres)) * (selK ? 1.3 : 1) * 255;
      r += hi; g += hi; b += hi;

      if (selK) { r = r * 1.05 + 18; g = g * 1.05 + 14; b = b * 1.05 + 5; }

      let a = 0.74 + 0.26 * fres + 1.2 * sharp + 0.4 * eg;
      if (a > 1) a = 1;
      a *= cov;

      const o = idx * 4;
      M[o] = r > 255 ? 255 : r; M[o + 1] = g > 255 ? 255 : g; M[o + 2] = b > 255 ? 255 : b;
      M[o + 3] = a * 255;

      const bc = cov * cov * (1.6 - 0.6 * cov);
      BA[o] = cr * 0.72; BA[o + 1] = cg * 0.72; BA[o + 2] = cb * 0.72;
      BA[o + 3] = nm_cl(bc, 0, 1) * 255;

      const eA = nm_cl((B * 1.3 - d) / (B * 1.3), 0, 1);
      BE[o] = 255; BE[o + 1] = 255; BE[o + 2] = 255; BE[o + 3] = eA * eA * cov * 255;
      const cA = nm_cl((d - B * 0.5) / (B * 0.9), 0, 1);
      BC[o] = 255; BC[o + 1] = 255; BC[o + 2] = 255; BC[o + 3] = cA * cov * 255;
    }
  }

  const matCv = nm_cv(SW, SH); matCv.getContext('2d').putImageData(mat, 0, 0);
  const baseCv = nm_cv(SW, SH); baseCv.getContext('2d').putImageData(base, 0, 0);
  const edgeCv = nm_cv(SW, SH); edgeCv.getContext('2d').putImageData(bEdge, 0, 0);
  const coreCv = nm_cv(SW, SH); coreCv.getContext('2d').putImageData(bCore, 0, 0);

  // ---- Schatten ---------------------------------------------------------
  const shCv = nm_cv(w, h);
  const sc = shCv.getContext('2d');
  nm_blob(sc, loops, c, P, R, c * 0.22, c * 0.12, c * 0.19, 'rgba(0,0,0,0.44)', w, h);
  nm_blob(sc, loops, c, P, R, c * 0.05, c * 0.015, c * 0.04, 'rgba(0,0,0,0.62)', w, h);
  nm_blob(sc, loops, c, P, R, c * 0.012, 0, c * 0.012, 'rgba(0,0,0,0.55)', w, h);

  // ---- Kaustik ----------------------------------------------------------
  const caCv = nm_cv(w, h);
  const cac = caCv.getContext('2d');
  const ccol = (a) => 'rgba(' + (cr | 0) + ',' + (cg | 0) + ',' + (cb | 0) + ',' + a + ')';
  nm_blob(cac, loops, c, P, R, c * 0.38, c * 0.22, c * 0.30, ccol(0.44), w, h);
  nm_blob(cac, loops, c, P, R, c * 0.14, c * 0.15, c * 0.21, ccol(0.50), w, h);

  // ---- Auswahl-Halo ------------------------------------------------------
  let glowCv = null;
  if (sel) {
    glowCv = nm_cv(w, h);
    const gc = glowCv.getContext('2d');
    nm_blob(gc, loops, c, P, R, c * 0.46, 0, 0, 'rgba(255,240,196,0.85)', w, h);
    nm_blob(gc, loops, c, P, R, c * 0.16, 0, 0, 'rgba(255,250,225,0.85)', w, h);
    // knackiger, heller Konturring
    gc.save();
    gc.filter = 'blur(' + Math.max(0.4, c * 0.018).toFixed(2) + 'px)';
    gc.strokeStyle = 'rgba(255,252,235,0.95)';
    gc.lineWidth = Math.max(1.4, c * 0.055);
    nm_path(gc, loops, c, P, P, R);
    gc.stroke();
    gc.restore();
  }

  return { w, h, P, mat: matCv, base: baseCv, edge: edgeCv, core: coreCv, sh: shCv, ca: caCv, glow: glowCv };
}

// ================================================================ Zeichnen
export function drawGlassPiece(ctx, cells, c, ox, oy, color, opt) {
  opt = opt || {};
  const sel = !!opt.selected;
  let ck = '';
  for (const p of cells) ck += p[0] + '.' + p[1] + ';';
  const key = ck + '|' + Math.round(c * 2) + '|' + color + '|' + (sel ? 1 : 0);
  let S = NM_CACHE.get(key);
  if (!S) {
    S = nm_build(cells, c, color, sel);
    if (NM_CACHE.size >= NM_MAX) NM_CACHE.delete(NM_CACHE.keys().next().value);
    NM_CACHE.set(key, S);
  }
  const dx = ox - S.P, dy = oy - S.P, w = S.w, h = S.h;

  ctx.drawImage(S.sh, dx, dy, w, h);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  // Kaustik zurueckhaltend dosiert: liegen viele Steine dicht beieinander,
  // ueberlagern sich ihre Lichtflecken sonst zu einem Dunstschleier.
  ctx.globalAlpha = 0.32;
  ctx.drawImage(S.ca, dx, dy, w, h);
  if (S.glow) { ctx.globalAlpha = 0.6; ctx.drawImage(S.glow, dx, dy, w, h); }
  ctx.restore();

  ctx.drawImage(S.base, dx, dy, w, h);

  if (opt.bg) {
    const bgX = opt.bgX || 0, bgY = opt.bgY || 0;
    if (!NM_TMP || NM_TMP.width < w || NM_TMP.height < h) NM_TMP = nm_cv(Math.max(w, 320), Math.max(h, 320));
    const t = NM_TMP.getContext('2d');
    const cx = w / 2, cy = h / 2;
    const put = (maskCv, scale, shx, shy, alpha) => {
      t.setTransform(1, 0, 0, 1, 0, 0);
      t.globalCompositeOperation = 'source-over';
      t.globalAlpha = 1;
      t.filter = 'none';
      t.clearRect(0, 0, NM_TMP.width, NM_TMP.height);
      t.save();
      t.filter = 'contrast(1.9) brightness(1.25)';
      t.translate(cx, cy); t.scale(scale, scale); t.translate(-cx, -cy);
      t.drawImage(opt.bg, bgX - dx + shx, bgY - dy + shy);
      t.restore();
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(maskCv, 0, 0, w, h);
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = alpha;
      ctx.drawImage(NM_TMP, 0, 0, w, h, dx, dy, w, h);
      ctx.restore();
    };
    put(S.core, 1.13, -c * 0.045, -c * 0.045, 0.30);
    put(S.edge, 1.75, -c * 0.14, -c * 0.14, 0.70);
  }

  ctx.drawImage(S.mat, dx, dy, w, h);
}
