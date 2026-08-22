// Bedienung der Direktverbindung (QR-Kopplung ohne Spiel-Server).
//
// Ablauf:  Gastgeber tippt „Raum eröffnen“ → sein Handy zeigt einen QR-Code
// (ein Spiel-Link mit Einladungs-Code). Der Gast scannt ihn einfach mit der
// normalen Handy-Kamera – die App öffnet sich und zeigt den Antwort-Code als
// QR. Den scannt der Gastgeber in der App („Antwort scannen“) – verbunden.
// Für Handys ohne Kamera gibt es Codes zum Kopieren/Einfügen.

import { DirectHost, DirectGuest } from './p2p.js';
import { qrcode } from './vendor/qrcode.mjs';

const $ = (id) => document.getElementById(id);
const CHANNEL = 'ubongo-direct';

let current = null; // { net, scan } – aktive Kopplung

function baseLink() { return location.origin + location.pathname; }

function renderQR(text) {
  const qr = qrcode(0, 'L');
  qr.addData(text);
  qr.make();
  const box = $('direct-qr');
  box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
  box.classList.remove('hidden');
}

// ---------- Kamera-Scanner (BarcodeDetector, sonst jsQR) ----------

let jsqrLoading = null;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve();
  jsqrLoading = jsqrLoading || new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'js/vendor/jsQR.js';
    s.onload = () => ok();
    s.onerror = () => fail(new Error('Scanner konnte nicht geladen werden'));
    document.head.appendChild(s);
  });
  return jsqrLoading;
}

async function startScan(onCode) {
  const video = $('direct-video');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  video.srcObject = stream;
  video.classList.remove('hidden');
  await video.play();
  let stopped = false;
  const stop = () => {
    stopped = true;
    stream.getTracks().forEach(t => t.stop());
    video.srcObject = null;
    video.classList.add('hidden');
  };
  const finish = (txt) => { if (!stopped) { stop(); onCode(txt); } };
  if ('BarcodeDetector' in window) {
    const det = new BarcodeDetector({ formats: ['qr_code'] });
    const loop = async () => {
      if (stopped) return;
      try {
        const hits = await det.detect(video);
        if (hits.length && hits[0].rawValue) return finish(hits[0].rawValue);
      } catch { /* Einzelbild misslungen – weiterversuchen */ }
      setTimeout(loop, 180);
    };
    loop();
  } else {
    await loadJsQR();
    const cv = document.createElement('canvas');
    const cx = cv.getContext('2d', { willReadFrequently: true });
    const loop = () => {
      if (stopped) return;
      if (video.videoWidth) {
        cv.width = video.videoWidth; cv.height = video.videoHeight;
        cx.drawImage(video, 0, 0);
        const d = cx.getImageData(0, 0, cv.width, cv.height);
        const hit = window.jsQR(d.data, d.width, d.height);
        if (hit && hit.data) return finish(hit.data);
      }
      setTimeout(loop, 220);
    };
    loop();
  }
  return { stop };
}

// ---------- Auf- und Abbau ----------

export function initDirectUI({ getName, adopt }) {
  const status = (s) => { $('direct-status').textContent = s; };
  const hint = (s) => { $('direct-hint').textContent = s; };

  function openOverlay(title) {
    $('direct-title').textContent = title;
    $('direct-qr').classList.add('hidden');
    $('direct-scan').classList.add('hidden');
    $('direct-manual').classList.add('hidden');
    $('direct-manual').open = false;
    $('direct-mycode').value = '';
    $('direct-paste').value = '';
    status(''); hint('');
    $('overlay-direct').classList.remove('hidden');
  }

  function cleanup() {
    if (current) {
      if (current.scan) current.scan.stop();
      if (current.net) current.net.close();
      current = null;
    }
    clearTimeout(cleanup.watchdog);
  }

  async function scanInto(handleText) {
    try {
      const scan = await startScan(async (txt) => {
        if (current) current.scan = null;
        try { await handleText(txt); }
        catch { status('Das war kein gültiger Kopplungs-Code – nochmal versuchen.'); }
      });
      if (current) current.scan = scan;
    } catch {
      status('Keine Kamera verfügbar – nutzt „Ohne Kamera koppeln“ weiter unten.');
      $('direct-manual').classList.remove('hidden');
      $('direct-manual').open = true;
    }
  }

  // Verbindungs-Wächter: Wenn nach dem Koppeln nichts passiert, Tipp anzeigen
  function armWatchdog() {
    clearTimeout(cleanup.watchdog);
    cleanup.watchdog = setTimeout(() => {
      if (current) status('Es verbindet sich nichts … Sind beide Handys im selben WLAN oder Hotspot?');
    }, 20000);
  }

  // ---------- Gastgeber ----------
  async function startHost() {
    cleanup();
    const host = new DirectHost(getName());
    current = { net: host, scan: null };
    adopt(host);
    openOverlay('📶 Raum eröffnen');
    status('Erzeuge Einladung …');
    let code;
    try { code = await host.offer(); }
    catch { status('Direktverbindung wird von diesem Browser nicht unterstützt.'); return; }
    if (!current || current.net !== host) return; // inzwischen abgebrochen
    renderQR(baseLink() + '#du=' + code);
    $('direct-mycode').value = code;
    $('direct-scan').classList.remove('hidden');
    $('direct-manual').classList.remove('hidden');
    status('Dein Mitspieler scannt diesen Code einfach mit der Handy-Kamera.');
    hint('Sein Handy zeigt danach einen Antwort-Code. Tippe dann hier auf „Antwort scannen“.');
  }

  async function applyAnswer(txt) {
    if (!current || !(current.net instanceof DirectHost)) return;
    status('Verbinde …');
    await current.net.accept(txt);
    armWatchdog();
  }

  // ---------- Gast ----------
  async function startGuest(offerText) {
    cleanup();
    const guest = new DirectGuest(getName());
    current = { net: guest, scan: null };
    adopt(guest);
    openOverlay('📶 Raum beitreten');
    if (!offerText) {
      status('Scanne den QR-Code auf dem Handy des Gastgebers.');
      $('direct-manual').classList.remove('hidden');
      await scanInto((txt) => showAnswer(guest, txt));
    } else {
      try { await showAnswer(guest, offerText); }
      catch { status('Der Einladungs-Code ist ungültig oder abgelaufen.'); }
    }
  }

  async function showAnswer(guest, offerText) {
    status('Erzeuge Antwort …');
    const answer = await guest.answer(offerText);
    if (!current || current.net !== guest) return;
    renderQR(baseLink() + '#da=' + answer);
    $('direct-mycode').value = answer;
    $('direct-manual').classList.remove('hidden');
    status('Zeige diesen Antwort-Code dem Gastgeber – er scannt ihn in seiner App über „Antwort scannen“.');
    armWatchdog();
  }

  // ---------- Knöpfe ----------
  $('direct-host').addEventListener('click', startHost);
  $('direct-join').addEventListener('click', () => startGuest());
  $('direct-scan').addEventListener('click', () => {
    status('Scanne den Antwort-Code auf dem anderen Handy.');
    scanInto((txt) => applyAnswer(txt));
  });
  $('direct-apply').addEventListener('click', async () => {
    const txt = $('direct-paste').value.trim();
    if (!txt) return;
    try {
      if (current && current.net instanceof DirectHost) await applyAnswer(txt);
      else if (current && current.net instanceof DirectGuest) await showAnswer(current.net, txt);
    } catch { status('Der eingefügte Code ist ungültig.'); }
  });
  $('direct-copy').addEventListener('click', async () => {
    const el = $('direct-mycode');
    try { await navigator.clipboard.writeText(el.value); $('direct-copy').textContent = '✅ Kopiert'; }
    catch { el.select(); document.execCommand('copy'); }
    setTimeout(() => { $('direct-copy').textContent = 'Code kopieren'; }, 1500);
  });
  $('direct-cancel').addEventListener('click', () => {
    cleanup();
    $('overlay-direct').classList.add('hidden');
  });

  // Antwort-Codes, die per Handy-Kamera in einem NEUEN Tab landen, kommen
  // über den Browser-Kanal zurück zum wartenden Gastgeber-Tab.
  try {
    new BroadcastChannel(CHANNEL).onmessage = (e) => {
      if (e.data && e.data.t === 'answer') applyAnswer(e.data.code).catch(() => {});
    };
  } catch { /* sehr alte Browser */ }

  // ---------- Spiel-Links aus der Handy-Kamera (#du= / #da=) ----------
  const h = location.hash;
  if (h.startsWith('#du=')) {             // Gast: Einladung gescannt
    history.replaceState(null, '', location.pathname + location.search);
    startGuest(h.slice(4));
  } else if (h.startsWith('#da=')) {      // Antwort im falschen Tab gelandet: weiterreichen
    history.replaceState(null, '', location.pathname + location.search);
    try { new BroadcastChannel(CHANNEL).postMessage({ t: 'answer', code: h.slice(4) }); } catch { /* egal */ }
    openOverlay('📶 Antwort übertragen');
    status('✅ Der Antwort-Code wurde übertragen. Wechsle zurück zum bereits offenen Ubongo-Tab – dort verbindet ihr euch jetzt.');
    hint('Tipp für den Gastgeber: Antwort-Codes am besten direkt in der App scannen („Antwort scannen“), dann gibt es keinen Tab-Wechsel.');
  }

  // Wird die Lobby sichtbar (Kopplung geglückt), Overlay schließen
  return {
    onLobby() {
      clearTimeout(cleanup.watchdog);
      if (current) { if (current.scan) current.scan.stop(); current = null; }
      $('overlay-direct').classList.add('hidden');
    },
  };
}
