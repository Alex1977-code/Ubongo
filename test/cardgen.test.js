// Test: Karten-Generator erzeugt gültige, exakt lösbare Karten.
import { generateCard, DIFFICULTIES, roundSetup } from '../public/js/cardgen.js';
import { PIECE_MAP } from '../public/js/pieces.js';

let fails = 0;
const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

for (const diff of Object.keys(DIFFICULTIES)) {
  const d = DIFFICULTIES[diff];
  for (let seed = 1; seed <= 250; seed++) {
    const card = generateCard(seed * 7919 + diff.length, diff);
    assert(card, `${diff}/${seed}: keine Karte`);
    if (!card) continue;
    // Teile-Anzahl korrekt
    assert(card.pieces.length === d.pieces, `${diff}/${seed}: ${card.pieces.length} Teile statt ${d.pieces}`);
    // Zellensumme = Flächengröße
    const sum = card.pieces.reduce((s, id) => s + PIECE_MAP[id].cells.length, 0);
    assert(card.cells.length === sum, `${diff}/${seed}: Fläche ${card.cells.length} != Teile ${sum}`);
    // Lösung deckt Fläche exakt ab, keine Überlappung
    const region = new Set(card.cells.map(c => c.join(',')));
    const covered = new Set();
    for (const pl of card.solution) {
      for (const c of pl.cells) {
        const k = c.join(',');
        assert(region.has(k), `${diff}/${seed}: Lösung außerhalb ${k}`);
        assert(!covered.has(k), `${diff}/${seed}: Überlappung ${k}`);
        covered.add(k);
      }
    }
    assert(covered.size === region.size, `${diff}/${seed}: Lösung unvollständig`);
    // Bounding-Box im Limit
    const w = Math.max(...card.cells.map(c => c[0])) + 1;
    const h = Math.max(...card.cells.map(c => c[1])) + 1;
    assert(Math.max(w, h) <= Math.max(d.maxW, d.maxH) && Math.min(w, h) <= Math.min(d.maxW, d.maxH),
      `${diff}/${seed}: Box ${w}x${h} zu groß`);
    // Deterministisch
    const again = generateCard(seed * 7919 + diff.length, diff);
    assert(JSON.stringify(again) === JSON.stringify(card), `${diff}/${seed}: nicht deterministisch`);
  }
}
// Runden-Steigerung + Tempo-Faktor
assert(roundSetup('leicht', 1).pieces === 3 && roundSetup('leicht', 3).pieces === 4 &&
       roundSetup('leicht', 5).pieces === 5, 'Steigerung leicht: 3/4/5 Teile');
assert(roundSetup('experte', 9).pieces === 6, 'Experte bleibt bei max. 6 Teilen');
assert(roundSetup('leicht', 1, 0.7).time === 63 && roundSetup('leicht', 3, 1).time === 120,
       'Tempo-Faktor skaliert die Zeit');
const c5 = generateCard(4242, 'leicht', 5);
assert(c5.pieces.length === 5, 'Teilanzahl-Vorgabe greift');

console.log(fails === 0 ? 'cardgen: alle Tests OK (1000 Karten geprüft)' : `cardgen: ${fails} Fehler`);
process.exit(fails === 0 ? 0 : 1);
