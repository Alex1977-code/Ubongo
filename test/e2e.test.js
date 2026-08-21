// End-to-End-Test: App im Handy-Viewport laden, Solo-Runde spielen,
// Mehrspieler mit 2 "Handys" durchspielen. Benötigt Chromium (playwright-core).
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const PORT = 3200;
const SHOT_DIR = process.env.SHOT_DIR || '.';
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT }, stdio: 'pipe' });
await new Promise(res => srv.stdout.on('data', d => { if (String(d).includes('läuft')) res(); }));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fails = 0;
const assert = (c, m) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); if (!c) fails++; };

const newPhone = async (name) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Test',
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(name + ': ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    // Optionale Bild-Assets (img/…) dürfen fehlen – deren 404 ist kein Fehler.
    const url = (m.location() && m.location().url) || '';
    if (url.includes('/img/')) return;
    page.errors.push(name + ' console: ' + m.text());
  });
  await page.goto(`http://localhost:${PORT}/`);
  return page;
};

try {
  // ---------- Solo-Spiel ----------
  const p = await newPhone('A');
  await p.screenshot({ path: SHOT_DIR + '/shot-start.png' });
  await p.click('[data-goto="solo"]');
  await p.fill('#solo-name', 'Alex');
  await p.click('#solo-diff .chip[data-val="leicht"]');
  await p.click('#solo-skill .chip[data-val="schwer"]');
  await p.click('#solo-rounds .chip[data-val="1"]');
  await p.screenshot({ path: SHOT_DIR + '/shot-solo-setup.png' });
  await p.click('#solo-start');
  await p.waitForFunction(() => window.__ubongo.game && window.__ubongo.game.board);
  assert(true, 'Solo-Spiel gestartet');
  await p.waitForFunction(() => window.__ubongo.game.board.locked === false, null, { timeout: 6000 });
  assert(true, 'Countdown vorbei, Brett freigegeben');

  const nPieces = await p.evaluate(() => window.__ubongo.game.board.pieces.length);
  assert(nPieces === 3, `Leicht = 3 Teile (${nPieces})`);

  // Erster Tipp wählt nur aus, zweiter Tipp dreht
  const before = await p.evaluate(() => window.__ubongo.game.board.pieces[0].rot);
  const pos = await p.evaluate(() => {
    const b = window.__ubongo.game.board;
    const pc = b.pieces[0], t = pc.tray, c = b.cells(pc)[0];
    const r = b.canvas.getBoundingClientRect();
    return { x: r.left + t.x + (c[0] + 0.5) * t.cell, y: r.top + t.y + (c[1] + 0.5) * t.cell };
  });
  await p.mouse.move(pos.x, pos.y);
  await p.mouse.down(); await p.mouse.up();
  const afterFirst = await p.evaluate(() => ({ rot: window.__ubongo.game.board.pieces[0].rot,
    sel: window.__ubongo.game.board.selectedId === window.__ubongo.game.board.pieces[0].id }));
  assert(afterFirst.rot === before && afterFirst.sel, `Erster Tipp wählt nur aus (rot ${before}→${afterFirst.rot})`);
  await p.mouse.down(); await p.mouse.up();
  const after = await p.evaluate(() => window.__ubongo.game.board.pieces[0].rot);
  assert(after === (before + 1) % 4, `Zweiter Tipp dreht Teil (${before}→${after})`);
  // Dritter Tipp an exakt derselben Stelle: dreht weiter, obwohl sich die
  // Teil-Form gedreht hat (ganzer Slot ist Treffer-Fläche)
  await p.mouse.down(); await p.mouse.up();
  const after3 = await p.evaluate(() => window.__ubongo.game.board.pieces[0].rot);
  assert(after3 === (before + 2) % 4, `Dritter Tipp dreht weiter (${after}→${after3})`);

  // Tipp-Funktion kostet 5 Punkte
  await p.click('#ctrl-solution');
  assert(await p.evaluate(() => window.__ubongo.game.hintUsed) === true, 'Tipp gemerkt (kostet den Zufallsstein)');

  // Ein Teil per Drag korrekt platzieren (echte Geste)
  const drag = await p.evaluate(() => {
    const g = window.__ubongo.game, b = g.board;
    const sol = g.card.solution[1];                  // Teil, das gerade in der Ablage liegt
    const pc = b.pieces.find(q => q.id === sol.id);
    const t = pc.tray, c0 = b.cells(pc)[0];
    const r = b.canvas.getBoundingClientRect();
    // Ziel: Lösungliegt evtl. gedreht – wir setzen rot/flip passend, dann ziehen
    const minX = Math.min(...sol.cells.map(c => c[0])), minY = Math.min(...sol.cells.map(c => c[1]));
    const norm = sol.cells.map(([x, y]) => [x - minX, y - minY]).sort((a, b2) => a[1] - b2[1] || a[0] - b2[0]);
    outer: for (let f = 0; f < 2; f++) for (let rr = 0; rr < 4; rr++) {
      pc.rot = rr; pc.flip = f;
      if (JSON.stringify(b.cells(pc)) === JSON.stringify(norm)) break outer;
    }
    b._layoutTray();
    const t2 = pc.tray, cc = b.cells(pc)[0];
    // Neuer Griff: Der angefasste Punkt bleibt unterm Finger (plus 1,1 Zellen Anhebung).
    // Wir fassen die Mitte der ersten Zelle an und peilen deren Zielposition an.
    return {
      id: sol.id,
      from: { x: r.left + t2.x + (cc[0] + 0.5) * t2.cell, y: r.top + t2.y + (cc[1] + 0.5) * t2.cell },
      to: {
        x: r.left + b.bx + (minX + cc[0] + 0.5) * b.cell,
        y: r.top + b.by + (minY + cc[1] + 0.5) * b.cell + b.cell * 1.1,
      },
    };
  });
  await p.mouse.move(drag.from.x, drag.from.y);
  await p.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await p.mouse.move(drag.from.x + (drag.to.x - drag.from.x) * i / 12,
                       drag.from.y + (drag.to.y - drag.from.y) * i / 12);
  }
  await p.mouse.up();
  const placed = await p.evaluate((id) => {
    const b = window.__ubongo.game.board;
    return !!b.pieces.find(q => q.id === id).placed;
  }, drag.id);
  assert(placed, 'Drag & Drop platziert Teil auf dem Brett');
  await p.screenshot({ path: SHOT_DIR + '/shot-game.png' });

  // Restliche Teile lösen, Bot beschleunigen → Rundenende
  await p.evaluate(() => {
    const g = window.__ubongo.game;
    for (const b of g.bots) if (b.solveMs !== null) b.solveMs = 1;
    g.board.reveal(g.card.solution);
    g._solved();
  });
  await p.waitForSelector('#overlay-result:not(.hidden)', { timeout: 10000 });
  assert(true, 'Runden-Ergebnis erscheint');
  const gemsInTable = await p.evaluate(() => document.querySelectorAll('#result-table svg.gem, #result-table img.gem').length);
  assert(gemsInTable > 0, `Edelsteine im Rundenergebnis sichtbar (${gemsInTable})`);
  const shelfShown = await p.evaluate(() => !document.getElementById('gem-shelf').classList.contains('hidden'));
  assert(shelfShown, 'Schatzleiste im Spielfeld sichtbar');
  await p.screenshot({ path: SHOT_DIR + '/shot-result.png' });
  await p.click('#result-next');
  await p.waitForSelector('#overlay-final:not(.hidden)');
  const hs = await p.evaluate(() => JSON.parse(localStorage.getItem('ubongo.highscores')));
  assert(hs && hs.length === 1 && hs[0].name === 'Alex' && hs[0].score > 0, `Lokaler Highscore gespeichert (${hs && hs[0] && hs[0].score} Pkt.)`);
  await p.screenshot({ path: SHOT_DIR + '/shot-final.png' });
  await p.click('#final-menu');
  const quickVisible = await p.evaluate(() => !document.getElementById('quick-start').classList.contains('hidden'));
  assert(quickVisible, 'Schnellstart-Knopf nach erster Partie sichtbar');
  const stats = await p.evaluate(() => JSON.parse(localStorage.getItem('ubongo.stats')));
  assert(stats && stats.games === 1 && stats.solved >= 1,
    `Statistik erfasst (${stats && stats.games} Partie, ${stats && stats.solved} gelöst)`);

  // ---------- Zeit abgelaufen: Lösung wird gezeigt ----------
  await p.click('[data-goto="solo"]');
  await p.click('#solo-diff .chip[data-val="leicht"]');
  await p.click('#solo-rounds .chip[data-val="1"]');
  await p.click('#solo-start');
  await p.waitForFunction(() => window.__ubongo.game && !window.__ubongo.game.board.locked, null, { timeout: 8000 });
  await p.evaluate(() => { const g = window.__ubongo.game; g.vElapsed = g.roundTime * 1000 + 500; }); // Zeit ablaufen lassen
  await p.waitForSelector('#solution-note:not(.hidden)', { timeout: 4000 });
  const revealed = await p.evaluate(() => window.__ubongo.game.board.pieces.every(q => q.placed));
  assert(revealed, 'Nicht gelöst: Lösung liegt komplett auf dem Brett');
  await p.waitForSelector('#overlay-result:not(.hidden)', { timeout: 9000 });
  const noteHidden = await p.evaluate(() => document.getElementById('solution-note').classList.contains('hidden'));
  assert(noteHidden, 'Lösungs-Hinweis verschwindet vor dem Ergebnis');
  await p.click('#result-next');
  await p.waitForSelector('#overlay-final:not(.hidden)');
  await p.click('#final-menu');

  // ---------- Design-Menü: Themen + Teile-Looks ----------
  await p.click('#open-design');
  await p.waitForSelector('#overlay-design:not(.hidden)');
  await p.screenshot({ path: SHOT_DIR + '/shot-design-menu.png' });
  await p.click('#design-theme .chip[data-val="dschungel"]');
  await p.click('#design-skin .chip[data-val="juwelen"]');
  await p.click('#design-close');
  const design = await p.evaluate(() => ({
    theme: localStorage.getItem('ubongo.theme'), skin: localStorage.getItem('ubongo.skin'),
    cls: document.body.classList.contains('theme-dschungel'),
  }));
  assert(design.theme === 'dschungel' && design.skin === 'juwelen' && design.cls,
    'Design-Auswahl gespeichert + Dschungel-Thema sofort aktiv');
  await p.screenshot({ path: SHOT_DIR + '/shot-theme-dschungel.png' });
  await p.reload();
  await p.waitForSelector('#screen-start.active');
  assert(await p.evaluate(() => document.body.classList.contains('theme-dschungel')),
    'Dschungel-Thema übersteht Neuladen');
  await p.click('[data-goto="solo"]');
  await p.click('#solo-start');
  await p.waitForFunction(() => window.__ubongo.game && window.__ubongo.game.board &&
    !window.__ubongo.game.board.locked, null, { timeout: 8000 });
  assert(true, 'Spiel startet mit Dschungel-Thema + Juwelen-Look');
  await p.screenshot({ path: SHOT_DIR + '/shot-skin-juwelen.png' });
  await p.click('#game-exit');
  await p.click('#open-design');
  await p.waitForSelector('#overlay-design:not(.hidden)');
  await p.click('#design-theme .chip[data-val="wueste"]');
  await p.click('#design-close');
  await p.screenshot({ path: SHOT_DIR + '/shot-theme-wueste.png' });
  await p.evaluate(() => { localStorage.setItem('ubongo.theme', 'savanne'); localStorage.setItem('ubongo.skin', 'klassisch'); });

  // ---------- Mehrspieler: 2 Handys ----------
  const A = await newPhone('Host'), B = await newPhone('Gast');
  await A.click('[data-goto="online"]');
  await A.fill('#online-name', 'Alex');
  await A.click('#online-create');
  await A.waitForSelector('#screen-lobby.active');
  const code = await A.textContent('#lobby-code');
  assert(/^[A-Z2-9]{4}$/.test(code), `Raumcode angezeigt: ${code}`);

  await B.click('[data-goto="online"]');
  await B.fill('#online-name', 'Mia');
  await B.fill('#online-code', code);
  await B.click('#online-join');
  await B.waitForSelector('#screen-lobby.active');
  await A.waitForFunction(() => document.querySelectorAll('#lobby-players li').length === 2);
  assert(true, 'Beide Spieler in der Lobby');
  await A.screenshot({ path: SHOT_DIR + '/shot-lobby.png' });

  await A.click('#lobby-rounds .chip[data-val="1"]');
  await A.click('#lobby-diff .chip[data-val="leicht"]');
  await A.click('#lobby-start');
  await A.waitForFunction(() => window.__ubongo.game && window.__ubongo.game.mode === 'online');
  await B.waitForFunction(() => window.__ubongo.game && window.__ubongo.game.mode === 'online');
  assert(true, 'Online-Runde auf beiden Handys gestartet');

  const seedA = await A.evaluate(() => window.__ubongo.game.card.cells.length);
  await A.waitForFunction(() => window.__ubongo.game.board && !window.__ubongo.game.board.locked, null, { timeout: 8000 });
  await B.waitForFunction(() => window.__ubongo.game.board && !window.__ubongo.game.board.locked, null, { timeout: 8000 });
  await A.evaluate(() => { const g = window.__ubongo.game; g.board.reveal(g.card.solution); g._solved(); });
  await B.waitForFunction(() => document.querySelector('.opp.done'), null, { timeout: 5000 });
  assert(true, 'Gast sieht: Host ist fertig');
  await B.evaluate(() => { const g = window.__ubongo.game; g.board.reveal(g.card.solution); g._solved(); });
  await A.waitForSelector('#overlay-final:not(.hidden)', { timeout: 10000 });
  await B.waitForSelector('#overlay-final:not(.hidden)', { timeout: 10000 });
  assert(true, 'Endstand auf beiden Handys');
  const online = await A.evaluate(() => fetch('/api/highscores').then(r => r.json()));
  assert(online.some(h => h.name === 'Alex') && online.some(h => h.name === 'Mia'), 'Online-Highscores gespeichert');
  await A.screenshot({ path: SHOT_DIR + '/shot-mp-final.png' });

  for (const page of [p, A, B]) {
    for (const err of page.errors) { console.log('FAIL Browserfehler: ' + err); fails++; }
  }
} catch (e) {
  console.log('FAIL Ausnahme: ' + e.message);
  fails++;
} finally {
  await browser.close();
  srv.kill();
}
console.log(fails === 0 ? '\ne2e: alle Tests OK' : `\ne2e: ${fails} Fehler`);
process.exit(fails === 0 ? 0 : 1);
