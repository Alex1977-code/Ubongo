// Lokale Highscores (auf diesem Handy) + Abruf der Online-Liste vom Server.

const KEY = 'ubongo.highscores';

export function localScores() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}

export function addLocalScore(entry) {
  const list = localScores();
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50)));
}

export async function onlineScores() {
  const res = await fetch('/api/highscores', { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

export function getName()      { return localStorage.getItem('ubongo.name') || ''; }
export function setName(n)     { localStorage.setItem('ubongo.name', n); }
