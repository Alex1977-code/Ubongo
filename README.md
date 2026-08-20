# 🧩 Ubongo – Das wilde Legespiel als Handy-App

Ubongo als **Progressive Web App (PWA)**: läuft auf jedem Handy im Browser, lässt sich
wie eine echte App auf dem Startbildschirm installieren und funktioniert im
Solo-Modus sogar offline.

![Ubongo](public/icons/icon.svg)

## ✨ Funktionen

- **Immer Mehrspieler:** gegen 1–3 Computer-Gegner **oder** online gegen Freunde
- **Handys verbinden sich:** Raum erstellen → 4-stelligen Code weitergeben → bis zu 8 Spieler
- **Highscores:** lokal auf dem Handy **und** online auf dem Server (Top 50)
- **Unendlich viele Karten:** prozeduraler Karten-Generator – jede Karte ist garantiert lösbar
- **4 Schwierigkeitsgrade:** Leicht (3 Teile) · Mittel (4) · Schwer (5) · Experte (6)
- **Touch-Steuerung:** Ziehen = bewegen · Tippen = drehen · Doppeltipp = spiegeln
- **Sound & Musik:** prozedurale Sound-Effekte per WebAudio (Klick, Klack, Countdown,
  Fanfaren, 10-Sekunden-Warnton – ganz ohne Audio-Dateien) und eine leise
  Kalimba-Ambient-Musik. Beides im Spiel einzeln abschaltbar: 🔊/🔇 für Effekte,
  🎵 für Musik – die Einstellung wird gespeichert
- **Stimmungsvolle Grafik:** Savannen-Abendszene auf dem Startbildschirm (Inline-SVG),
  Glühwürmchen, Holz-Sockel unter der Karte, Setz-Animation beim Einrasten
- **Extras:** Countdown, Konfetti, „UBONGO!“-Ruf, Tipp-Funktion (💡, kostet 5 Punkte),
  Vibration beim Lösen, KI-Gegner mit sichtbarem Fortschritt

## 🚀 Starten

Voraussetzung: [Node.js](https://nodejs.org) (Version 18 oder neuer)

```bash
npm install
npm start
```

Dann im Browser öffnen: **http://localhost:3000**

### 📱 Mit mehreren Handys spielen (gleiches WLAN)

1. Den Server auf einem Rechner im WLAN starten (`npm start`)
2. Die IP-Adresse des Rechners herausfinden (z. B. `192.168.1.23`)
3. Auf allen Handys im Browser öffnen: `http://192.168.1.23:3000`
4. Ein Spieler tippt **„Mit Freunden spielen“ → Raum erstellen**, die anderen
   geben den angezeigten **4-stelligen Code** ein
5. Der Gastgeber wählt Schwierigkeit + Runden und startet

Alternativ kann der Server auch im Internet gehostet werden (z. B. bei einem
Node.js-Hoster) – dann funktioniert das Spielen auch über Mobilfunk.
Der Port lässt sich über die Umgebungsvariable `PORT` ändern.

### 📲 Als App installieren

Seite im Handy-Browser öffnen → Browser-Menü → **„Zum Startbildschirm hinzufügen“**.
Ubongo startet dann im Vollbild wie eine native App. Über HTTPS (oder localhost)
wird die App zusätzlich offline-fähig (Solo-Modus).

## 🎮 Spielregeln

Jede Runde erhält jeder Spieler eine eigene **Karte** (Fläche) und die passenden
**Legeteile**. Wer die Fläche zuerst lückenlos und ohne Überlappung füllt, ruft
**„UBONGO!“**.

**Punkte:** Gelöst = 10 · Schnellster +5 · Zweiter +3 · Dritter +1 ·
Zeitbonus +1 pro 10 Sekunden Restzeit.

## 🛠️ Technik

| Bereich | Umsetzung |
| --- | --- |
| Oberfläche | HTML/CSS/JavaScript (ES-Module), Canvas-Rendering, keine Frameworks |
| Karten | Seed-basierter Generator (`public/js/cardgen.js`), konstruktiv beweisbar lösbar |
| Mehrspieler | Node.js + WebSocket (`ws`), Raum-Codes, Server verteilt Karten-Seeds |
| Highscores | `localStorage` (lokal) + `highscores.json` auf dem Server (online) |
| PWA | Web-App-Manifest + Service Worker (Offline-Cache der App-Hülle) |

### Tests

```bash
npm test               # Karten-Generator (1000 Karten) + Server-Protokoll
node test/e2e.test.js  # End-to-End im Browser (benötigt Chromium/playwright-core)
```

### Projektstruktur

```
server.js            Webserver + Mehrspieler-Räume + Online-Highscores
public/
  index.html         Alle Bildschirme (Menü, Setup, Lobby, Spiel, Highscores, Hilfe)
  css/style.css      Design
  js/pieces.js       Die 12 Legeteile + Transformationen
  js/cardgen.js      Karten-Generator + Schwierigkeitsgrade
  js/board.js        Spielbrett: Canvas-Rendering + Touch-Steuerung
  js/game.js         Rundenablauf, Timer, Punkte, Konfetti
  js/ai.js           Computer-Gegner
  js/sound.js        Sound-Effekte + Ambient-Musik (prozedural per WebAudio)
  js/net.js          WebSocket-Client
  js/highscore.js    Lokale + Online-Highscores
  sw.js              Service Worker (offline)
```

## 🎨 Eigene Grafiken

Alle Grafiken sind aktuell im Code gezeichnet (SVG/Canvas). Eigene Bilder –
Logo, Hintergrund, App-Icon – können einfach unter `public/icons/` bzw. per CSS
eingebunden werden.
