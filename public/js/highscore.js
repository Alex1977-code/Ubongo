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

export async function onlineScores(base) {
  let prefix = '';
  if (base) {
    let s = String(base).trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(s)) {
      const local = /^(localhost|\d+\.\d+\.\d+\.\d+)(:\d+)?$/.test(s);
      s = (local ? 'http://' : 'https://') + s;
    }
    prefix = s;
  }
  const res = await fetch(prefix + '/api/highscores', { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

export function getServer()  { return localStorage.getItem('ubongo.server') || ''; }
export function setServer(s) { localStorage.setItem('ubongo.server', s); }

export function getName()      { return localStorage.getItem('ubongo.name') || ''; }
export function setName(n)     { localStorage.setItem('ubongo.name', n); }
