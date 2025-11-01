# WF-Group Home

**[Zur Live-Ansicht des Dashboards](https://x.wf-group.dev)**

Ein personalisiertes, selbstgehostetes Dashboard, entwickelt für die WF-Group e.V (i.G). Es dient als zentrale Anlaufstelle (PWA) für öffentliche Widgets, private Apps und Medieninhalte.

---

## ✨ Features

-   **Dynamisches Kachel-Management (CMS):**
    -   Erstellen von Sektionen (z.B. "Selfhosted", "Tools") direkt im Admin-Bereich.
    -   Hinzufügen von App-Kacheln über ein Modal-Interface.
    -   Verwendung von Bild-URLs (z.B. von Google Bilder) für individuelle Kachel-Icons.
    -   Apps können als **öffentlich** (für alle sichtbar) oder **privat** (nur nach Login) markiert werden.

-   **Admin-Vorschau:**
    -   Als Admin kann man per Knopfdruck zwischen der privaten Admin-Ansicht und der öffentlichen Besucher-Ansicht wechseln.
    -   In beiden Ansichten bleiben die Admin-Rechte (Lösch-Buttons an Kacheln) erhalten.

-   **Öffentliche Ansicht (Ausgeloggt):**
    -   **Audio Player:** Spielt eigene `.mp3`-Dateien ab, die per SFTP in den `/public/music/` Ordner geladen werden.
    -   **Wetter-Widget:** 4-Tage-Vorhersage für Erding (via OpenWeatherMap API).
    -   **RSS-Feed:** Zeigt die neuesten Schlagzeilen (z.B. Heise Online).
    -   **Radio-Player:** Streamt verschiedene `https`-Webradio-Sender.
    -   **URL-Shortener:** Kürzt lange URLs auf die eigene Domain (z.B. `x.wf-group.dev/aB3d`).
    -   **Dynamische App-Sektionen:** Zeigt alle als "öffentlich" markierten Kacheln.

-   **Private Ansicht (Eingeloggt):**
    -   Sicherer Login mit Benutzername & Passwort (Hashing via `bcrypt`).
    -   **Admin-Widgets:** Verwaltung von Sektionen, To-Do-Liste, Schnelle Notizen (mit Auto-Save).
    -   **Dynamische App-Sektionen:** Zeigt alle privaten Kacheln des eingeloggten Benutzers.

-   **PWA - Progressive Web App:**
    -   Installierbar auf Desktop und mobilen Geräten über das Browser-Menü.
    -   Offline-Fähigkeit für die App-Shell (via Service Worker).

---

## 🛠️ Technologie-Stack

-   **Backend:** Node.js, Express.js
-   **Datenbank:** SQLite3
-   **Frontend:** HTML5, Tailwind CSS, Vanilla JavaScript
-   **Authentifizierung:** `bcrypt` (Hashing), `express-session` (Cookie-basierte Sessions)
-   **Prozess-Management:** pm2

---

## 🚀 Setup & Installation (Lokal)

1.  **Repository klonen:**
    ```bash
    git clone [https://github.com/xdnixlos/dashboard.git](https://github.com/xdnixlos/dashboard.git)
    cd dashboard
    ```
2.  **Abhängigkeiten installieren:**
    ```bash
    npm install
    ```
3.  **`.env`-Datei erstellen:**
    * Kopiere `.env.example` zu `.env`.
    * Trage deinen `OPENWEATHER_API_KEY` und einen `SESSION_SECRET` ein.
4.  **Server starten:**
    ```bash
    node server.js 
    ```
    Das Dashboard ist nun unter `http://localhost:3000` erreichbar.

---

## 🎵 Medien hinzufügen

Eigene Musikdateien (`.mp3`) können einfach per **SFTP** (über Port 22, nicht FTP) in den Ordner `/root/dashboard/public/music/` auf dem Server hochgeladen werden. Der Player erkennt neue Dateien automatisch.
