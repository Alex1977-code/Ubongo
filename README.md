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
- **Touch-Steuerung:** Ziehen = bewegen · Tippen = auswählen, erneut tippen = drehen · Spiegeln per Knopf
- **Sound & Musik:** prozedurale Sound-Effekte per WebAudio (Klick, Klack, Countdown,
  Fanfaren, 10-Sekunden-Warnton – ganz ohne Audio-Dateien) und eine leise
  Kalimba-Ambient-Musik. Beides im Spiel einzeln abschaltbar: 🔊/🔇 für Effekte,
  🎵 für Musik – die Einstellung wird gespeichert
- **Stimmungsvolle Grafik:** Savannen-Abendszene auf dem Startbildschirm (Inline-SVG),
  Glühwürmchen, Holz-Sockel unter der Karte, Setz-Animation beim Einrasten,
  funkelnde Rohkristall-Edelsteine
- **Design-Menü (🎨):** Themen (Savanne · Dschungel bei Nacht · Wüste) und
  Teile-Looks (Klassisch · Juwelen · Bonbon · Holz) umschaltbar; eigene Bilder
  aus `public/img/` werden automatisch eingebunden (siehe unten)
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

### 🌍 Über das Internet spielen (auch über Mobilfunk)

1. Server kostenlos hosten – am einfachsten bei [Render](https://render.com):
   [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Alex1977-code/Ubongo)
   (kostenloses Konto anlegen, deployen – die `render.yaml` im Repo stellt alles ein).
   Danach hat der Server eine Adresse wie `ubongo-server.onrender.com`.
2. Alle Mitspieler öffnen das Spiel (z. B. den GitHub-Pages-Link) und tragen
   unter **„Mit Freunden spielen“ → Spiel-Server** dieselbe Adresse ein.
3. Raum erstellen, Code weitergeben, losspielen.

Hinweise: Der Gratis-Server schläft nach 15 Minuten Leerlauf ein – der erste
Verbindungsaufbau dauert dann ca. 30 Sekunden. Die Online-Highscores liegen auf
dem jeweiligen Server. Der Port lässt sich über die Umgebungsvariable `PORT`
ändern; bricht die Verbindung ab (Bildschirm aus, WLAN-Wechsel), verbindet die
App automatisch neu und setzt die laufende Runde fort.

### 📶 Direktverbindung – 2 Handys ganz ohne Server

Unter **„Mit Freunden spielen“ → Direktverbindung** koppeln sich zwei Handys
direkt per WebRTC – es wird kein Spiel-Server gebraucht:

1. Gastgeber tippt **„Raum eröffnen (QR zeigen)“** – ein QR-Code erscheint
2. Der Gast scannt ihn einfach mit der **normalen Handy-Kamera** (öffnet die App)
   oder in der App über **„Beitreten (QR scannen)“**
3. Das Gast-Handy zeigt einen **Antwort-Code** – der Gastgeber scannt ihn in
   der App über **„Antwort scannen“** – verbunden!

Funktioniert im selben WLAN oder über den **Handy-Hotspot**, also auch komplett
ohne Internet (die App vorher einmal online öffnen, damit sie installiert ist).
Für Handys ohne Kamera gibt es unter „Ohne Kamera koppeln“ Codes zum
Kopieren/Einfügen. Highscores landen dabei lokal auf dem Handy.

### 📲 Als App installieren

Seite im Handy-Browser öffnen → Browser-Menü → **„Zum Startbildschirm hinzufügen“**.
Ubongo startet dann im Vollbild wie eine native App. Über HTTPS (oder localhost)
wird die App zusätzlich offline-fähig (Solo-Modus).

## 🎮 Spielregeln

Jede Runde erhält jeder Spieler eine eigene **Karte** (Fläche) und die passenden
**Legeteile**. Wer die Fläche zuerst lückenlos und ohne Überlappung füllt, ruft
**„UBONGO!“**.

**Edelsteine:** Nur wer vor Ablauf der Zeit löst, sammelt wie im Original
Edelsteine – Schnellster: **blauer Saphir + 1 zufälliger Stein**, Zweiter:
**brauner Bernstein + 1 zufälliger Stein**, alle weiteren Löser: 1 zufälliger
Stein (entfällt bei 💡-Tipp). Werte: Braun 1 · Grün 2 · Blau 3 · Rot 4.
Nach allen Runden gewinnt der wertvollste Schatz. Sobald du gelöst hast,
läuft die Restzeit der Computer-Gegner im **Schnellvorlauf**.

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

## 🎨 Eigene Grafiken (KI-generiert)

Alle Grafiken sind im Code gezeichnet (SVG/Canvas) – die App braucht keine
Bilddateien. Wer mag, legt eigene (z. B. KI-generierte) PNGs in `public/img/`;
sie werden beim Start **automatisch erkannt und verwendet**. Fehlt eine Datei,
bleibt einfach die prozedurale Grafik aktiv. Unterstützte Dateinamen:

| Datei | Verwendung |
| --- | --- |
| `bg-menu.png` | Hintergrund des Startbildschirms (ersetzt die SVG-Savannenszene) |
| `bg-game.png` | Hintergrund des Spielbildschirms |
| `bg-menu-dschungel.png` / `bg-game-dschungel.png` | Hintergründe für das Thema „Dschungel bei Nacht“ |
| `bg-menu-wueste.png` / `bg-game-wueste.png` | Hintergründe für das Thema „Wüste“ |
| `wood.png` | Holz-Textur des Brett-Sockels im Spielfeld |
| `emblem.png` | Emblem hinter dem UBONGO-Titel auf dem Start |
| `mascot.png` | Maskottchen im Endstand neben der Überschrift |
| `mascot-ubongo.png` | Maskottchen groß im „UBONGO!“-Overlay beim Lösen |
| `mascot-sieg.png` | Maskottchen im Endstand bei Sieg |
| `mascot-trost.png` | Maskottchen im Endstand bei Niederlage + neben dem Lösungs-Hinweis |
| `sieg-szene.png` | Stimmungs-Hintergrund des Endstands bei Sieg (Hochformat) |
| `gem-rubin.png`, `gem-saphir.png`, `gem-smaragd.png`, `gem-bernstein.png` | Edelsteine (Schatzleiste, Tabellen, fliegende Steine, Stats) |
| `avatar-1.png` … `avatar-8.png` | Avatare der Computer-Gegner (statt Emoji) |

Themen und der Teile-Look (Klassisch/Juwelen/Bonbon/Holz) lassen sich im Spiel
über das 🎨-Menü oben rechts auf dem Startbildschirm umschalten – die Teile-Looks
sind rein prozedural und funktionieren immer, auch ganz ohne Bilder.
