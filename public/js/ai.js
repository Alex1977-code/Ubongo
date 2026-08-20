// Computer-Gegner: lösen ihre Karte nach einer zufälligen Zeit (je nach Stärke),
// mit sichtbarem Fortschritt und gelegentlichem Scheitern.

const NAMES = [
  ['Jengo', '🦁'], ['Zuri', '🦓'], ['Tembo', '🐘'], ['Twiga', '🦒'],
  ['Kasuku', '🦜'], ['Chui', '🐆'], ['Kifaru', '🦏'], ['Mamba', '🐊'],
];

const SKILL = {
  leicht: { frac: [0.55, 1.15], dnf: 0.30 }, // Anteil der Rundenzeit, Chance zu scheitern
  mittel: { frac: [0.35, 0.85], dnf: 0.15 },
  schwer: { frac: [0.20, 0.55], dnf: 0.05 },
};

export function makeBots(count, skill, roundTimeSec) {
  const pool = NAMES.slice().sort(() => Math.random() - 0.5);
  return Array.from({ length: count }, (_, i) => {
    const [name, emoji] = pool[i];
    return { name, emoji, skill, total: 0, bot: true, id: 'bot' + i, ...newRound(skill, roundTimeSec) };
  });
}

export function newRound(skill, roundTimeSec) {
  const s = SKILL[skill] || SKILL.mittel;
  const frac = s.frac[0] + Math.random() * (s.frac[1] - s.frac[0]);
  const fail = Math.random() < s.dnf || frac > 1;
  return {
    solveMs: fail ? null : Math.round(frac * roundTimeSec * 1000),
    done: false, ms: null,
    // Fortschritt wirkt "menschlich": Denkpausen über Stützpunkte
    curve: Array.from({ length: 3 }, () => 0.15 + Math.random() * 0.7).sort((a, b) => a - b),
  };
}

// Fortschritt 0..1 bei verstrichener Zeit t (ms)
export function botProgress(bot, elapsedMs, roundTimeSec) {
  const target = bot.solveMs ?? roundTimeSec * 1000 * 1.35;
  const x = Math.min(1, elapsedMs / target);
  // leicht stufig statt linear
  const [a, b, c] = bot.curve;
  let p = x < a ? x * 0.5 : x < b ? 0.5 * a + (x - a) * 0.9 : 0.5 * a + (b - a) * 0.9 + (x - b) * 1.4;
  return Math.max(0, Math.min(1, p / (0.5 * a + (b - a) * 0.9 + (1 - b) * 1.4)));
}

// Prüft pro Tick, ob ein Bot gerade fertig geworden ist.
export function botTick(bot, elapsedMs) {
  if (!bot.done && bot.solveMs !== null && elapsedMs >= bot.solveMs) {
    bot.done = true; bot.ms = bot.solveMs;
    return true;
  }
  return false;
}
