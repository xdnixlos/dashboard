const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const dbPath = path.resolve(__dirname, 'db.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Fehler beim Verbinden mit der SQLite-Datenbank', err.message);
    } else {
        console.log('Verbunden mit der SQLite-Datenbank.');
        initDb(); // Initialisiere die DB-Struktur nach erfolgreicher Verbindung
    }
});

// Funktion zum Initialisieren der Datenbankstruktur
function initDb() {
    db.serialize(() => {
        // Tabelle für Benutzer (mit PIN statt Passwort)
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            pin_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) console.error("Fehler beim Erstellen der users-Tabelle:", err.message);
        });

        // Tabelle für Short URLs
        db.run(`CREATE TABLE IF NOT EXISTS short_urls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            original_url TEXT NOT NULL,
            short_code TEXT UNIQUE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
             if (err) console.error("Fehler beim Erstellen der short_urls-Tabelle:", err.message);
        });

        // Tabelle für benutzerdefinierte App-Kacheln
        db.run(`CREATE TABLE IF NOT EXISTS user_apps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            icon TEXT, -- Font Awesome Klasse (Fallback)
            icon_url TEXT, -- NEU: Für Bild-URLs
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`, (err) => {
            if (err) console.error("Fehler beim Erstellen/Ändern der user_apps-Tabelle:", err.message);
        });

         // Tabelle für Notizen
        db.run(`CREATE TABLE IF NOT EXISTS user_notes (
            user_id INTEGER PRIMARY KEY,
            content TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`, (err) => {
            if (err) console.error("Fehler beim Erstellen der user_notes-Tabelle:", err.message);
        });

         // Tabelle für To-Dos
        db.run(`CREATE TABLE IF NOT EXISTS user_todos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            task TEXT NOT NULL,
            completed INTEGER DEFAULT 0, -- 0 for false, 1 for true
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`, (err) => {
             if (err) console.error("Fehler beim Erstellen der user_todos-Tabelle:", err.message);
        });


        // Standardbenutzer hinzufügen, falls noch keiner existiert
        const defaultUsername = 'admin';
        const defaultPin = '1234'; // Nur als Beispiel, in Produktion unbedingt ändern!

        db.get('SELECT * FROM users WHERE username = ?', [defaultUsername], async (err, row) => {
            if (err) {
                 console.error("Fehler beim Prüfen des Standardbenutzers:", err.message);
                 return;
            }
            if (!row) {
                try {
                    const saltRounds = 10;
                    const hash = await bcrypt.hash(defaultPin, saltRounds);
                    db.run('INSERT INTO users (username, pin_hash) VALUES (?, ?)', [defaultUsername, hash], (insertErr) => {
                        if (insertErr) {
                            console.error("Fehler beim Erstellen des Standardbenutzers:", insertErr.message);
                        } else {
                            console.log(`ERSTER BENUTZER ERSTELLT: ${defaultUsername} / ${defaultPin} (PIN bitte ändern!)`);
                        }
                    });
                } catch (hashError) {
                     console.error("Fehler beim Hashen der PIN:", hashError);
                }
            }
        });
    });
}

// Exportiere die Datenbankverbindung und die Initialisierungsfunktion
module.exports = { db, initDb };

```eof

#### Schritt 2: Backend anpassen (`server.js`)

Die API-Routen zum Hinzufügen und Abrufen der Apps werden angepasst, um die neue `icon_url`-Spalte zu berücksichtigen. Ersetze den **gesamten Inhalt** deiner `server.js`-Datei mit diesem Code:

```javascript:server.js:/root/dashboard/server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const Parser = require('rss-parser');
const axios = require('axios');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const { db, initDb } = require('./database.js'); // initDb importieren

const app = express();
const parser = new Parser();
const PORT = 3000;

// Nur noch benötigte Umgebungsvariablen laden
const { OPENWEATHER_API_KEY, SESSION_SECRET } = process.env;

// Middleware
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files like CSS, JS, images, music, videos
app.use(express.json());
app.use(cookieParser());
app.use(session({
    secret: SESSION_SECRET || 'fallback_secret_string_bitte_in_env_aendern',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true if using HTTPS in production
        httpOnly: true, // Helps against XSS attacks
        maxAge: 24 * 60 * 60 * 1000 // Example: 1 day session duration
    }
}));

// Middleware um Login zu prüfen for API routes
const isLoggedIn = (req, res, next) => {
    if (req.session.userId) return next();
    res.status(401).json({ error: 'Nicht autorisiert' });
};

// --- AUTH & CORE ROUTES ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.post('/login', async (req, res) => {
    const { username, pin } = req.body;
    if (!username || !pin) {
        return res.status(400).json({ error: 'Benutzername und PIN sind erforderlich.' });
    }
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) {
            console.error("Datenbankfehler bei Login:", err);
            return res.status(500).json({ error: 'Serverfehler beim Login.' });
        }
        if (!user) {
            return res.status(401).json({ error: 'Benutzer nicht gefunden.' });
        }

        try {
            const match = await bcrypt.compare(String(pin), user.pin_hash);
            if (match) {
                // Regenerate session to prevent session fixation
                req.session.regenerate(err => {
                    if (err) {
                         console.error("Fehler bei Session Regenerierung:", err);
                         return res.status(500).json({ error: 'Serverfehler beim Login.' });
                    }
                    req.session.userId = user.id;
                    req.session.username = user.username;
                    res.json({ message: 'Login erfolgreich' });
                });
            } else {
                res.status(401).json({ error: 'Ungültige PIN.' });
            }
        } catch (compareError) {
            console.error("Fehler beim PIN-Vergleich:", compareError);
            res.status(500).json({ error: 'Serverfehler beim Login.' });
        }
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
             console.error("Fehler beim Logout:", err);
             // Trotzdem versuchen umzuleiten
        }
        res.clearCookie('connect.sid', { path: '/' }); // Ensure cookie is cleared correctly
        res.redirect('/');
    });
});

app.get('/api/auth/status', (req, res) => {
    res.json({ loggedIn: !!req.session.userId, username: req.session.username || null });
});

// --- SPOTIFY ROUTES WURDEN HIER ENTFERNT ---

// --- WIDGET API ROUTES ---
app.get('/api/rss', async (req, res) => {
    const feedUrl = 'https://www.tagesschau.de/xml/rss2/'; // Tagesschau als Standard-Feed
    try {
        const feed = await parser.parseURL(feedUrl);
        // Map items and add index for staggered animation
        res.json(feed.items.slice(0, 5).map((item, index) => ({ title: item.title, link: item.link, index })));
    } catch (error) {
        console.error('RSS-Feed Fehler:', error);
        res.status(500).json({ error: 'RSS-Feed konnte nicht geladen werden.' });
    }
});

app.get('/api/weather', async (req, res) => {
    const city = 'Erding';
    const lang = 'de';
    const units = 'metric';

    if (!OPENWEATHER_API_KEY) {
        console.error("OpenWeatherMap API Key fehlt in .env");
        return res.status(500).json({ error: 'Wetterdienst nicht konfiguriert.' });
    }

    const currentWeatherUrl = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${OPENWEATHER_API_KEY}&lang=${lang}&units=${units}`;
    const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?q=${city}&appid=${OPENWEATHER_API_KEY}&lang=${lang}&units=${units}&cnt=33`; // +1 Puffer

    try {
        const [currentRes, forecastRes] = await Promise.all([
            axios.get(currentWeatherUrl),
            axios.get(forecastUrl)
        ]);

        const currentData = currentRes.data;
        const forecastData = forecastRes.data;

        const dailyForecasts = {};
        forecastData.list.forEach(item => {
            const date = new Date(item.dt * 1000);
            const dayKey = date.toISOString().split('T')[0];
            const hour = date.getHours();
            const todayKey = new Date().toISOString().split('T')[0];
            if (dayKey !== todayKey) { // Skip today
                 if (!dailyForecasts[dayKey] || Math.abs(hour - 12) < Math.abs(new Date(dailyForecasts[dayKey].dt * 1000).getHours() - 12)) {
                    dailyForecasts[dayKey] = item;
                }
            }
        });

         // Map forecast and add index for staggered animation
         const forecast = Object.values(dailyForecasts).slice(0, 4).map((item, index) => ({
            day: new Date(item.dt * 1000).toLocaleDateString('de-DE', { weekday: 'short' }),
            icon: item.weather[0].icon,
            temp: Math.round(item.main.temp),
            index // Add index
        }));

        res.json({
            city: currentData.name,
            current: {
                 temperature: Math.round(currentData.main.temp),
                 description: currentData.weather[0].description,
                 icon: currentData.weather[0].icon
            },
            forecast: forecast
        });
    } catch (error) {
        console.error('Fehler beim Abrufen der Wetterdaten:', error.response ? error.response.data : error.message);
         let errorMessage = 'Wetterdaten konnten nicht abgerufen werden.';
         if (error.response) {
             if (error.response.status === 401) { errorMessage = 'OpenWeatherMap API Fehler: Nicht autorisiert (API Key ungültig?).'; }
             else if (error.response.status === 404) { errorMessage = `OpenWeatherMap API Fehler: Stadt "${city}" nicht gefunden.`; }
             else if (error.response.status === 429) { errorMessage = 'OpenWeatherMap API Fehler: Zu viele Anfragen.'; }
         }
        res.status(500).json({ error: errorMessage });
    }
});


app.post('/api/shorten', (req, res) => {
    const { url } = req.body;
    if (!url || !url.startsWith('http')) {
        return res.status(400).json({ error: 'Ungültige URL angegeben.' });
    }
    const shortCode = crypto.randomBytes(4).toString('hex');
    const host = req.get('host');
    const protocol = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const fullShortUrl = `${protocol}://${host}/${shortCode}`;

    db.run('INSERT INTO short_urls (original_url, short_code) VALUES (?, ?)', [url, shortCode], function(err) {
        if (err) { console.error("DB Fehler beim Shorten:", err); return res.status(500).json({ error: 'Fehler beim Speichern der URL.' }); }
        res.json({ shortUrl: fullShortUrl });
    });
});

// --- User Apps API (ANGEPASST) ---
app.get('/api/apps', isLoggedIn, (req, res) => {
    // Wähle auch die neue icon_url Spalte aus
    db.all('SELECT id, name, url, icon, icon_url FROM user_apps WHERE user_id = ? ORDER BY id ASC', [req.session.userId], (err, rows) => {
        if (err) { console.error("DB Fehler beim Laden der Apps:", err); return res.status(500).json({ error: 'Fehler beim Laden der Apps.' }); }
        res.json({ data: rows });
    });
});

app.post('/api/apps/add', isLoggedIn, (req, res) => {
    // iconUrl aus dem Body extrahieren
    const { name, url, iconUrl } = req.body;
    if (!name || !url || !url.startsWith('http')) {
         return res.status(400).json({ error: 'Name und gültige URL sind erforderlich.' });
    }
     // Standard Font Awesome Icon (nur als Fallback, wenn keine URL da ist)
    const defaultIcon = 'fas fa-globe';

    // Speichere iconUrl oder NULL, icon wird jetzt ignoriert (könnte man später entfernen)
    db.run('INSERT INTO user_apps (user_id, name, url, icon, icon_url) VALUES (?, ?, ?, ?, ?)',
        [req.session.userId, name, url, defaultIcon, iconUrl || null], // iconUrl oder null speichern
        function(err) {
            if (err) { console.error("DB Fehler beim Hinzufügen der App:", err); return res.status(500).json({ error: 'Fehler beim Speichern der App.' }); }
             // Gib das komplette neue App-Objekt zurück
             db.get('SELECT id, name, url, icon, icon_url FROM user_apps WHERE id = ?', [this.lastID], (getErr, newApp) => {
                if (getErr || !newApp) { return res.status(500).json({ error: 'Konnte hinzugefügte App nicht abrufen.' }); }
                res.status(201).json({ message: 'App hinzugefügt', data: newApp });
             });
        }
    );
});

// Delete bleibt gleich
app.delete('/api/apps/:id', isLoggedIn, (req, res) => {
    const appId = req.params.id;
    db.run('DELETE FROM user_apps WHERE id = ? AND user_id = ?', [appId, req.session.userId], function(err) {
        if (err) { console.error("DB Fehler beim Löschen der App:", err); return res.status(500).json({ error: 'Fehler beim Löschen der App.' }); }
        if (this.changes === 0) { return res.status(404).json({ error: 'App nicht gefunden oder keine Berechtigung.' }); }
        res.status(200).json({ message: 'App gelöscht' });
    });
});

 // --- API Routen für Notizen ---
 app.get('/api/notes', isLoggedIn, (req, res) => { /* ... unverändert ... */ });
 app.post('/api/notes', isLoggedIn, (req, res) => { /* ... unverändert ... */ });

// --- API Routen für To-Dos ---
app.get('/api/todos', isLoggedIn, (req, res) => { /* ... unverändert ... */ });
app.post('/api/todos', isLoggedIn, (req, res) => { /* ... unverändert ... */ });
app.put('/api/todos/:id', isLoggedIn, (req, res) => { /* ... unverändert ... */ });
app.delete('/api/todos/:id', isLoggedIn, (req, res) => { /* ... unverändert ... */ });

 // --- MEDIA PLAYER API ROUTEN ---
 function readMediaDirectory(directory, fileExtension) { /* ... unverändert ... */ }
 app.get('/api/music', async (req, res) => { /* ... unverändert ... */ });
 app.get('/api/videos', async (req, res) => { /* ... unverändert ... */ });

// --- Redirect Route ---
app.get('/:shortCode', (req, res, next) => { /* ... unverändert ... */ });

// --- PWA Service Worker & Manifest Routes ---
app.get('/sw.js', (req, res) => { res.setHeader('Service-Worker-Allowed', '/'); res.sendFile(path.join(__dirname, 'public', 'sw.js')); });
app.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'public', 'manifest.json')));

// --- Fallback 404 Route ---
 app.use((req, res) => { res.status(404).sendFile(path.join(__dirname, 'views', '404.html')); });

// --- SERVER START ---
app.listen(PORT, () => {
    console.log(`[WF-Dashboard] Server läuft auf Port ${PORT}`);
    initDb(); // Datenbank initialisieren
});
```eof

#### Schritt 3: Frontend anpassen (`index.html`)

Wir passen das Modal an und ändern die Logik, wie die Kacheln gerendert werden. Ersetze den **gesamten Inhalt** deiner `views/index.html`-Datei mit diesem Code:

```html:index.html:/root/dashboard/views/index.html
<!DOCTYPE html>
<html lang="de" class="h-full text-white">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WF-TECH Dashboard</title>
    <!-- PWA -->
    <link rel="manifest" href="/manifest.json">
    <link rel="icon" href="/favicon.ico" type="image/x-icon">
    <meta name="theme-color" content="#0A0A10">
    <link rel="apple-touch-icon" href="/images/icon-192.png">

    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root{--background-color:#0A0A10;--tile-bg:rgba(20,20,35,0.4);--tile-hover-bg:rgba(30,30,50,0.6);--border-color:rgba(255,255,255,0.1);--accent-purple:#a855f7;--accent-blue:#3b82f6}body{font-family:'Inter',sans-serif;background-color:var(--background-color);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;overflow:hidden}#background-animation{position:fixed;top:0;left:0;width:100%;height:100%;z-index:-1;background:linear-gradient(315deg,rgba(168,85,247,0.1),transparent 40%),linear-gradient(45deg,rgba(59,130,246,0.1),transparent 40%),var(--background-color);animation:moveGradient 20s linear infinite}@keyframes moveGradient{0%{background-position:0 0}50%{background-position:100% 100%}100%{background-position:0 0}}.content-wrapper{position:relative;z-index:1;overflow-y:auto;height:100vh;scroll-behavior:smooth}.accent-gradient-text{background:linear-gradient(90deg,var(--accent-blue),var(--accent-purple));-webkit-background-clip:text;background-clip:text;color:transparent}.widget,.tile{position:relative;background:var(--tile-bg);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid var(--border-color);transition:all .3s cubic-bezier(.25,.8,.25,1)}.widget:hover,.tile:hover{background:var(--tile-hover-bg);transform:translateY(-8px) scale(1.03);box-shadow:0 10px 25px rgba(0,0,0,.3);border-color:var(--accent-purple)}.tile-icon{transition:all .3s ease; width: 3.5rem; height: 3.5rem; object-fit: contain;} /* Angepasste Icon Größe */
        .tile-icon-img { width: 3.5rem; height: 3.5rem; object-fit: contain; border-radius: 0.375rem; /* Etwas abrunden */}
        .tile:hover .tile-icon{transform:scale(1.1);color:#c084fc}.fade-in-up{animation:fadeInUp .8s ease-in-out}@keyframes fadeInUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}.action-btn{background:linear-gradient(90deg,var(--accent-blue),var(--accent-purple));transition:all .3s ease;box-shadow:0 4px 15px rgba(0,0,0,.2)}.action-btn:hover{transform:scale(1.05);box-shadow:0 6px 20px rgba(139,92,246,.4)}.logo{font-weight:700;font-size:1.5rem;letter-spacing:1px;background:linear-gradient(90deg,#e0e0e0,#a0a0a0);-webkit-background-clip:text;background-clip:text;color:transparent}.input-field{background:rgba(0,0,0,.3);border:1px solid var(--border-color);border-radius:.5rem;padding:.75rem;color:#fff;transition:border-color .3s}.input-field:focus{outline:0;border-color:var(--accent-blue)}.todo-item{display:flex;align-items:center;gap:.75rem;padding:.5rem 0}.todo-item input:checked+label{text-decoration:line-through;color:#6b7280}.modal-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.7);backdrop-filter:blur(5px);z-index:40;display:flex;align-items:center;justify-content:center}.modal-content{background:#111827;padding:2rem;border-radius:1rem;border:1px solid var(--border-color);width:90%;max-width:500px}
        .delete-btn{position:absolute;top:5px;right:5px;width:20px;height:20px;background:rgba(255,0,0,0.6);color:white;border:none;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;cursor:pointer;opacity:0;transition:opacity .2s ease-in-out}.tile:hover .delete-btn{opacity:1}
        select.input-field{-webkit-appearance:none;-moz-appearance:none;appearance:none;background-image:url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");background-position:right .5rem center;background-repeat:no-repeat;background-size:1.5em 1.5em;padding-right:2.5rem}
        .header-btn { padding: 0.5rem 1rem; border-radius: 0.5rem; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); font-weight: 500; color: #e5e7eb; transition: all 0.2s ease-in-out; display: flex; align-items: center; gap: 0.5rem; }
        .header-btn:hover { background: rgba(255, 255, 255, 0.1); color: #ffffff; transform: translateY(-2px); }
        .header-btn-main { transform: scale(1.1); background: rgba(255, 255, 255, 0.1); box-shadow: 0 0 15px rgba(168, 85, 247, 0.3); }
        .header-btn-main:hover { transform: scale(1.1) translateY(-2px); }
        .playlist-item { cursor: pointer; transition: background-color 0.2s; }
        .playlist-item:hover { background-color: rgba(255,255,255,0.1); }
        .playlist-item.active { background-color: var(--accent-purple); color: white; }
        .progress-bar-bg { background-color: rgba(255,255,255,0.1); cursor: pointer; }
        .progress-bar-fg { background: linear-gradient(90deg, var(--accent-blue), var(--accent-purple)); pointer-events: none; }
        .media-toggle { display: flex; background: rgba(255,255,255,0.05); border-radius: 0.5rem; padding: 0.25rem; }
        .media-toggle button { flex: 1; padding: 0.5rem; border-radius: 0.375rem; border: none; background: transparent; color: #9ca3af; font-weight: 500; transition: all 0.2s; }
        .media-toggle button.active { background: var(--accent-purple); color: white; }
        #media-player-widget.loading::after { content: 'Lade Medien...'; position: absolute; inset: 0; background: rgba(10, 10, 16, 0.8); display: flex; align-items: center; justify-content: center; font-size: 1.2rem; color: #ccc; z-index: 10; }
        /* Hilfsklasse zum Ausblenden */
        .hidden { display: none !important; }
    </style>
</head>
<body class="h-full">
    <div id="background-animation"></div>
    <audio id="media-audio-player" preload="metadata"></audio>
    <div id="app" class="content-wrapper p-4 sm:p-6 lg:p-8 flex flex-col fade-in-up">

        <header class="mb-8 flex flex-col md:flex-row justify-between items-center gap-6 w-full">
            <div class="flex-1 text-center md:text-left"><div class="logo">WF-TECH</div></div>
            <div class="flex-none flex items-center justify-center gap-4 md:gap-6">
                 <a href="https://www.wf-tech.de" target="_blank" class="header-btn"><span>🇩🇪</span><span>WF-TECH</span></a>
                 <a href="https://www.wf-group.dev" target="_blank" class="header-btn header-btn-main"><span>🇩🇪</span><span>WF-Group</span></a>
                 <a href="https://www.jj-tech.de" target="_blank" class="header-btn"><span>🇩🇪</span><span>JJ-TECH</span></a>
            </div>
            <div class="flex-1 text-center md:text-right">
                <div id="user-greeting" class="text-lg text-gray-300 hidden">Hallo, <span class="font-bold"></span>!</div>
                 <div id="clock-widget" class="mt-2 md:mt-0">
                    <h1 id="time" class="text-5xl font-bold accent-gradient-text">--:--</h1>
                    <p id="date" class="text-lg text-gray-400">...</p>
                    <p id="calendar-week" class="text-sm text-gray-500 font-semibold mt-1">KW --</p>
                </div>
            </div>
        </header>

        <main id="public-view" class="flex-grow w-full">
             <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
                <div id="media-player-widget" class="widget rounded-2xl p-6 flex flex-col justify-between lg:col-span-2 loading">
                    <div class="flex justify-between items-center w-full mb-4">
                        <h3 class="font-bold text-lg text-white"><i class="fas fa-play-circle mr-2"></i>Media Player</h3>
                        <div class="media-toggle"><button id="toggle-audio" class="active" disabled>Audio</button><button id="toggle-video" disabled>Video</button></div>
                    </div>
                     <p class="text-center text-gray-400 flex-grow flex items-center justify-center">Lade Medien...</p>
                </div>
                <div class="flex flex-col gap-6">
                     <div id="weather-widget" class="widget rounded-2xl p-6 flex flex-col justify-between">
                        <div class="flex justify-between items-start w-full">
                            <div><h2 class="text-xl font-semibold text-gray-400">Lade Wetter...</h2><p class="text-4xl font-bold text-gray-200">-°C</p><p class="text-gray-400">-</p></div>
                            <i class="fas fa-spinner fa-spin text-6xl text-blue-300"></i>
                        </div>
                        <div id="weather-forecast" class="grid grid-cols-4 gap-4 mt-4 w-full text-center"></div>
                    </div>
                    <div id="rss-widget" class="widget rounded-2xl p-6"><h3 class="font-bold text-lg text-white mb-3"><i class="fas fa-rss mr-2"></i>Tech News</h3><ul class="text-gray-300 space-y-2 text-sm"><li>Lade Feed...</li></ul></div>
                     <div id="radio-widget" class="widget rounded-2xl p-6"><h3 class="font-bold text-lg text-white mb-3"><i class="fas fa-broadcast-tower mr-2"></i>WeAreOne - Radiostreams</h3><div class="flex items-center gap-4"><button id="radio-play-pause-btn" class="text-5xl text-white hover:text-purple-400 transition-colors"><i class="fas fa-play-circle"></i></button><div class="w-full"><label for="station-select" class="text-sm text-gray-400">Sender</label><select id="station-select" class="w-full input-field mt-1"><option value="http://listen.technobase.fm/tunein-mp3">TechnoBase.fm</option><option value="http://listen.housetime.fm/tunein-mp3">HouseTime.fm</option><option value="http://listen.hardbase.fm/tunein-mp3">HardBase.fm</option><option value="http://listen.clubtime.fm/tunein-mp3">ClubTime.fm</option><option value="http://listen.replay.fm/tunein-mp3">Replay.fm</option></select></div></div></div>
                     <div id="shortener-widget" class="widget rounded-2xl p-6"><h3 class="font-bold text-lg text-white mb-3"><i class="fas fa-link mr-2"></i>URL Shortener</h3><div class="flex gap-2"><input id="long-url-input" type="url" class="w-full input-field" placeholder="Lange URL hier einfügen..."><button id="shorten-btn" class="action-btn text-white font-bold py-2 px-4 rounded-lg whitespace-nowrap">Kürzen</button></div><div id="short-url-result" class="mt-4 hidden"><p class="text-gray-400">Deine kurze URL:</p><div class="flex items-center gap-2 mt-1 bg-gray-800 p-2 rounded-lg"><input id="short-url-output" type="text" class="bg-transparent text-green-400 font-mono w-full" readonly><button id="copy-btn" class="text-gray-400 hover:text-white" title="Kopieren"><i class="fas fa-copy"></i></button></div></div></div>
                </div>
            </div>
            <h3 class="text-2xl font-bold mb-6 text-gray-200 border-l-4 border-purple-500 pl-4">Öffentliche Links</h3>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-5">
                <button id="google-suite-btn" class="tile rounded-xl p-4 flex flex-col items-center justify-center aspect-square"><i class="fab fa-google text-4xl mb-2 tile-icon text-blue-400"></i><span class="font-semibold text-center text-gray-200">Google Suite</span></button>
                <a href="https://web.whatsapp.com" target="_blank" rel="noopener noreferrer" class="tile rounded-xl p-4 flex flex-col items-center justify-center aspect-square"><i class="fab fa-whatsapp text-green-500 text-5xl mb-2 tile-icon"></i><span class="font-semibold text-center text-gray-200">WhatsApp</span></a>
                <a href="https://tiktok.com" target="_blank" rel="noopener noreferrer" class="tile rounded-xl p-4 flex flex-col items-center justify-center aspect-square"><i class="fab fa-tiktok text-white text-5xl mb-2 tile-icon"></i><span class="font-semibold text-center text-gray-200">TikTok</span></a>
                <a href="https://news.google.com" target="_blank" rel="noopener noreferrer" class="tile rounded-xl p-4 flex flex-col items-center justify-center aspect-square"><i class="fas fa-newspaper text-blue-400 text-5xl mb-2 tile-icon"></i><span class="font-semibold text-center text-gray-200">Nachrichten</span></a>
                <a href="https://wikipedia.org" target="_blank" rel="noopener noreferrer" class="tile rounded-xl p-4 flex flex-col items-center justify-center aspect-square"><i class="fab fa-wikipedia-w text-gray-300 text-5xl mb-2 tile-icon"></i><span class="font-semibold text-center text-gray-200">Wikipedia</span></a>
            </div>
        </main>

        <main id="private-view" class="flex-grow w-full hidden">
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
                <div class="widget rounded-2xl p-6"><h3 class="font-bold text-lg text-white mb-3"><i class="fas fa-list-check mr-2"></i>To-Do Liste</h3><div id="todo-list" class="space-y-2 text-gray-200 mb-3 max-h-60 overflow-y-auto"></div><form id="add-todo-form" class="flex gap-2"><input id="new-todo-input" class="w-full input-field" placeholder="Neue Aufgabe..." required><button type="submit" class="action-btn text-white font-bold py-2 px-4 rounded-lg">Add</button></form></div>
                <div class="widget rounded-2xl p-6 flex flex-col md:col-span-2 lg:col-span-1">
                    <h3 class="font-bold text-lg text-white mb-2"><i class="fas fa-note-sticky mr-2"></i>Schnelle Notiz</h3>
                    <textarea id="notes-textarea" class="input-field w-full h-full resize-none flex-grow" placeholder="Hier schreiben..."></textarea>
                </div>
            </div>
            <h3 class="text-2xl font-bold mb-6 text-gray-200 border-l-4 border-blue-500 pl-4">Private Apps</h3>
            <div id="private-apps-container" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-5">
                <button id="add-app-button" class="tile rounded-xl p-4 flex flex-col items-center justify-center aspect-square border-dashed border-2 border-gray-600 hover:border-purple-500"><i class="fas fa-plus text-5xl text-gray-500 tile-icon"></i><span class="font-semibold text-center text-gray-400">Hinzufügen</span></button>
            </div>
        </main>

        <footer class="mt-8 text-gray-500 flex justify-between items-center w-full">
            <p>Powered by <span class="font-bold">WF-Group</span></p>
            <button id="auth-button" class="action-btn text-white font-bold py-3 px-6 rounded-lg"><i class="fas fa-lock mr-2"></i> Anmelden</button>
        </footer>
    </div>

    <!-- Modals -->
    <div id="login-modal" class="modal-overlay hidden">
        <div class="modal-content fade-in-up">
            <h2 class="text-2xl font-bold mb-4">Anmelden</h2>
            <p id="login-error" class="text-red-400 mb-4 hidden"></p>
            <form id="login-form" class="space-y-4">
                <div><label for="username" class="block mb-2 text-sm font-medium text-gray-300">Benutzername</label><input type="text" id="username" class="w-full input-field" required></div>
                <div><label for="pin" class="block mb-2 text-sm font-medium text-gray-300">PIN</label><input type="password" id="pin" class="w-full input-field" required inputmode="numeric" pattern="[0-9]*"></div>
                <div class="mt-6 flex justify-end gap-4">
                    <button type="button" id="cancel-login" class="py-2 px-4 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors">Abbrechen</button>
                    <button type="submit" id="submit-login" class="py-2 px-4 action-btn rounded-lg">Anmelden</button>
                </div>
            </form>
        </div>
    </div>

    <div id="add-app-modal" class="modal-overlay hidden">
        <div class="modal-content fade-in-up">
            <h2 class="text-2xl font-bold mb-4">Neue App hinzufügen</h2>
            <p id="add-app-error" class="text-red-400 mb-4 hidden"></p>
            <form id="add-app-form" class="space-y-4">
                <div><label for="app-name" class="block mb-2 text-sm font-medium text-gray-300">Name</label><input type="text" id="app-name" class="w-full input-field" required></div>
                <div><label for="app-url" class="block mb-2 text-sm font-medium text-gray-300">URL</label><input type="url" id="app-url" class="w-full input-field" placeholder="https://beispiel.de" required></div>
                <div>
                    <label for="app-icon-url" class="block mb-2 text-sm font-medium text-gray-300">Icon Bild-URL (optional)</label>
                    <input type="url" id="app-icon-url" class="w-full input-field" placeholder="https://.../icon.png">
                    <p class="text-xs text-gray-500 mt-1">Direkter Link zu einer Bilddatei (png, jpg, ico...).</p>
                </div>
                <div class="mt-6 flex justify-end gap-4">
                    <button type="button" id="cancel-add-app" class="py-2 px-4 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors">Abbrechen</button>
                    <button type="submit" id="save-add-app" class="py-2 px-4 action-btn rounded-lg">Speichern</button>
                </div>
            </form>
        </div>
    </div>

    <div id="google-suite-modal" class="modal-overlay hidden">
        <div class="modal-content fade-in-up">
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-2xl font-bold"><i class="fab fa-google text-blue-400 mr-3"></i>Google Suite</h2>
                <button id="close-google-modal" class="text-gray-400 hover:text-white text-2xl">&times;</button>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                <a href="https://youtube.com" target="_blank" rel="noopener noreferrer" class="tile rounded-lg p-4 flex flex-col items-center justify-center aspect-square"><i class="fab fa-youtube text-red-500 text-4xl mb-2 tile-icon"></i><span class="font-semibold text-center">YouTube</span></a>
                <a href="https://gemini.google.com" target="_blank" rel="noopener noreferrer" class="tile rounded-lg p-4 flex flex-col items-center justify-center aspect-square"><i class="fas fa-brain text-purple-400 text-4xl mb-2 tile-icon"></i><span class="font-semibold text-center">Gemini</span></a>
                <a href="https://notebooklm.google.com" target="_blank" rel="noopener noreferrer" class="tile rounded-lg p-4 flex flex-col items-center justify-center aspect-square"><i class="fas fa-book-open text-blue-400 text-4xl mb-2 tile-icon"></i><span class="font-semibold text-center">NotebookLM</span></a>
                <a href="https://drive.google.com" target="_blank" rel="noopener noreferrer" class="tile rounded-lg p-4 flex flex-col items-center justify-center aspect-square"><i class="fab fa-google-drive text-green-500 text-4xl mb-2 tile-icon"></i><span class="font-semibold text-center">Drive</span></a>
                <a href="https://maps.google.com" target="_blank" rel="noopener noreferrer" class="tile rounded-lg p-4 flex flex-col items-center justify-center aspect-square"><i class="fas fa-map-location-dot text-green-600 text-4xl mb-2 tile-icon"></i><span class="font-semibold text-center">Maps</span></a>
                <a href="https://meet.google.com" target="_blank" rel="noopener noreferrer" class="tile rounded-lg p-4 flex flex-col items-center justify-center aspect-square"><i class="fas fa-video text-green-400 text-4xl mb-2 tile-icon"></i><span class="font-semibold text-center">Meet</span></a>
                <a href="https://chat.google.com" target="_blank" rel="noopener noreferrer" class="tile rounded-lg p-4 flex flex-col items-center justify-center aspect-square"><i class="fas fa-comments text-teal-400 text-4xl mb-2 tile-icon"></i><span class="font-semibold text-center">Chat</span></a>
                <a href="https://docs.google.com" target="_blank" rel="noopener noreferrer" class="tile rounded-lg p-4 flex flex-col items-center justify-center aspect-square"><i class="fas fa-file-word text-blue-500 text-4xl mb-2 tile-icon"></i><span class="font-semibold text-center">Docs</span></a>
                <a href="https://sheets.google.com" target="_blank" rel="noopener noreferrer" class="tile rounded-lg p-4 flex flex-col items-center justify-center aspect-square"><i class="fas fa-file-excel text-green-600 text-4xl mb-2 tile-icon"></i><span class="font-semibold text-center">Sheets</span></a>
                <a href="https://keep.google.com" target="_blank" rel="noopener noreferrer" class="tile rounded-lg p-4 flex flex-col items-center justify-center aspect-square"><i class="fas fa-lightbulb text-yellow-400 text-4xl mb-2 tile-icon"></i><span class="font-semibold text-center">Notizen</span></a>
            </div>
        </div>
    </div>

    <script>
        // --- Globale Zustandsvariablen ---
        let isLoggedInState = false;
        let currentUsername = '';

        // --- Hilfsfunktionen ---
        function getCalendarWeek(date) { const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); return Math.ceil((((d - yearStart) / 86400000) + 1) / 7); }
        function updateClock() { const t=document.getElementById("time"),e=document.getElementById("date"),o=document.getElementById("calendar-week");if(!t||!e||!o)return;const n=new Date;t.textContent=n.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"}),e.textContent=n.toLocaleDateString("de-DE",{weekday:"long",year:"numeric",month:"long",day:"numeric"}),o.textContent=`KW ${getCalendarWeek(n)}`}
        function getWeatherIconClass(t){const e="text-6xl",o="text-blue-300";switch(t){case"01d":return`fas fa-sun ${e} text-yellow-300`;case"01n":return`fas fa-moon ${e} text-indigo-300`;case"02d":return`fas fa-cloud-sun ${e} text-yellow-400`;case"02n":return`fas fa-cloud-moon ${e} text-indigo-300`;case"03d":case"03n":case"04d":case"04n":return`fas fa-cloud ${e} text-gray-400`;case"09d":case"09n":return`fas fa-cloud-showers-heavy ${e} ${o}`;case"10d":return`fas fa-cloud-sun-rain ${e} ${o}`;case"10n":return`fas fa-cloud-moon-rain ${e} ${o}`;case"11d":case"11n":return`fas fa-bolt ${e} text-yellow-500`;case"13d":case"13n":return`fas fa-snowflake ${e} text-white`;case"50d":case"50n":return`fas fa-smog ${e} text-gray-500`;default:return`fas fa-question-circle ${e} text-gray-400`}}
        function formatTime(seconds) { if (isNaN(seconds) || seconds < 0) return '0:00'; const min = Math.floor(seconds / 60); const sec = Math.floor(seconds % 60).toString().padStart(2, '0'); return `${min}:${sec}`; }

        // --- UI Update Funktion ---
         function toggleView(loggedIn, username = '') {
            const publicView = document.getElementById('public-view');
            const privateView = document.getElementById('private-view');
            const userGreeting = document.getElementById('user-greeting');
            const authButton = document.getElementById('auth-button');
            const loginModal = document.getElementById('login-modal');

             if (!publicView || !privateView || !authButton) { console.error("Kritische UI-Elemente für View-Toggle fehlen!"); return; }

            isLoggedInState = loggedIn;
            currentUsername = username;

            if (loggedIn) {
                publicView.classList.add('hidden');
                privateView.classList.remove('hidden');
                if (userGreeting) { userGreeting.querySelector('span').textContent = username; userGreeting.classList.remove('hidden'); }
                authButton.innerHTML = `<i class="fas fa-unlock mr-2"></i> Abmelden`;
                authButton.onclick = () => { window.location.href = '/logout'; };
                fetchApps(); fetchNote(); fetchTodos();
            } else {
                publicView.classList.remove('hidden');
                privateView.classList.add('hidden');
                if (userGreeting) userGreeting.classList.add('hidden');
                authButton.innerHTML = `<i class="fas fa-lock mr-2"></i> Anmelden`;
                authButton.onclick = () => { if (loginModal) loginModal.classList.remove('hidden'); };
                fetchWeatherData(); fetchRssData(); setupMediaPlayer(); initRadioPlayer();
            }
        }


        // --- Datenladefunktionen (Public) ---
        function fetchWeatherData(){
             const t=document.getElementById("weather-widget"); if(!t) return;
             const e=t.querySelector("h2"),o=t.querySelector("p:nth-of-type(1)"),n=t.querySelector("p:nth-of-type(2)"),a=t.querySelector("i"),d=document.getElementById("weather-forecast");
             e.textContent='Lade Wetter...';o.textContent='-°C';n.textContent='-';a.className='fas fa-spinner fa-spin text-6xl text-blue-300';if(d)d.innerHTML='';
             fetch("/api/weather").then(res=>{if(!res.ok)throw new Error(`HTTP ${res.status}: ${res.statusText}`);return res.json()}).then(t=>{if(t.error)throw new Error(t.error);if(e)e.textContent=t.city;if(o)o.textContent=`${t.current.temperature}°C`;if(n)n.textContent=t.current.description;if(a)a.className=getWeatherIconClass(t.current.icon);if(d){d.innerHTML="";t.forecast.forEach((t, index)=>{const e=document.createElement("div");e.className="text-center fade-in-up";e.style.animationDelay=`${index*0.1}s`;e.innerHTML=`<p class="font-semibold text-sm">${t.day}</p><i class="${getWeatherIconClass(t.icon).replace("text-6xl","text-3xl")} my-1"></i><p class="text-sm">${t.temp}°C</p>`;d.appendChild(e)})}}).catch(t=>{console.error("Wetter-Fehler:",t);if(e)e.textContent="Wetter-Fehler";if(o)o.textContent=":(";if(n)n.textContent=t.message.includes('API Key')?'API Key?':'Nicht verfügbar';if(a)a.className='fas fa-times-circle text-6xl text-red-500'})}
        function fetchRssData(){const t=document.querySelector("#rss-widget ul");if(!t)return;t.innerHTML='<li>Lade Feed...</li>';fetch("/api/rss").then(res=>{if(!res.ok)throw new Error(`HTTP ${res.status}: ${res.statusText}`);return res.json()}).then(e=>{t.innerHTML="";if(!e||0===e.length){t.innerHTML="<li>Keine Artikel gefunden.</li>";return}e.forEach((e, index)=>{const o=document.createElement("li");o.className="truncate fade-in-up";o.style.animationDelay=`${index*0.1}s`;o.innerHTML=`<a href="${e.link}" target="_blank" rel="noopener noreferrer" class="hover:text-white transition-colors duration-200">${e.title}</a>`;t.appendChild(o)})}).catch(e=>{console.error("RSS-Fehler:",e);if(t)t.innerHTML=`<li>Feed konnte nicht geladen werden. (${e.message})</li>`})}

        // --- Datenladefunktionen (Private) ---
        function renderApps(t){const e=document.getElementById("private-apps-container");if(!e)return;e.querySelectorAll(".app-tile").forEach(t=>t.remove());t.sort((a,b)=>a.id-b.id);t.forEach(t=>{addAppTileToDOM(t)})}
        function addAppTileToDOM(t){
            const e=document.getElementById("private-apps-container"),addButton=document.getElementById("add-app-button");if(!e||!addButton)return;
            const o=document.createElement("a");
            o.href=t.url, o.target="_blank", o.rel="noopener noreferrer", o.className="app-tile tile rounded-xl p-4 flex flex-col items-center justify-center aspect-square fade-in-up", o.dataset.id=t.id;
            let iconHTML = '';
            // Prüfe, ob eine gültige icon_url vorhanden ist
            if (t.icon_url && t.icon_url.startsWith('http')) {
                iconHTML = `<img src="${t.icon_url}" alt="${t.name} Icon" class="tile-icon-img mb-2" onerror="this.onerror=null; this.replaceWith(document.createElement('i').className = 'fas fa-globe text-blue-400 text-5xl mb-2 tile-icon')">`; // Fallback zu Globe bei Bildfehler
            } else {
                // Fallback zu Font Awesome Icon oder Standard Globe
                const iconClass = t.icon && t.icon.trim().startsWith('fa') ? t.icon.trim() : "fas fa-globe";
                iconHTML = `<i class="${iconClass} text-blue-400 text-5xl mb-2 tile-icon"></i>`;
            }
            o.innerHTML=`<button class="delete-btn" data-id="${t.id}" title="Löschen"><i class="fas fa-times"></i></button>${iconHTML}<span class="font-semibold text-center text-gray-200">${t.name}</span>`;
            e.insertBefore(o,addButton);
            const n=o.querySelector(".delete-btn"); n&&n.addEventListener("click",e=>{e.preventDefault(),e.stopPropagation(),deleteApp(t.id)})
        }
        function deleteApp(t){const e=document.querySelector(`.app-tile[data-id='${t}']`),appName=e?e.querySelector("span").textContent:"diese App";if(!e||!confirm(`Möchten Sie "${appName}" wirklich löschen?`))return;fetch(`/api/apps/${t}`,{method:"DELETE"}).then(res=>{if(!res.ok)return res.json().then(err=>{throw new Error(err.error||"Löschen fehlgeschlagen")});return res.json()}).then(data=>{e.remove();console.log(data.message)}).catch(err=>{console.error("Fehler beim Löschen der App:",err),alert(`App konnte nicht gelöscht werden: ${err.message}`)})}
        function fetchApps(){fetch("/api/apps").then(t=>{if(!t.ok)throw new Error("Netzwerkfehler beim Laden der Apps");return t.json()}).then(t=>{renderApps(t.data||[])}).catch(t=>{console.error("Fehler beim Laden der Apps:",t),renderApps([])})}
        let noteSaveTimeout; function saveNote(){clearTimeout(noteSaveTimeout);const t=document.getElementById("notes-textarea");if(!t)return;noteSaveTimeout=setTimeout(()=>{const e=t.value;fetch("/api/notes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content:e})}).catch(t=>console.error("Fehler beim Speichern der Notiz:",t))},750)}
        function fetchNote(){const t=document.getElementById("notes-textarea");t&&fetch("/api/notes").then(t=>{if(!t.ok)throw new Error("Netzwerkfehler beim Laden der Notiz");return t.json()}).then(e=>{t.value=e.content||""}).catch(e=>{console.error("Fehler beim Laden der Notiz:",e),t.value=""})}
        function renderTodos(t){const e=document.getElementById("todo-list");if(!e)return;e.innerHTML="";t.sort((a,b)=>(a.completed-b.completed)||(a.id-b.id));t.forEach((t,index)=>{const o=document.createElement("div");o.className="todo-item flex items-center justify-between group fade-in-up",o.dataset.id=t.id,o.style.animationDelay=`${index*.05}s`,o.innerHTML=`<div class="flex items-center gap-3 flex-grow min-w-0"><input type="checkbox" id="todo-${t.id}" ${t.completed?"checked":""} class="w-5 h-5 accent-purple-500 bg-gray-700 rounded border-gray-600 focus:ring-purple-500 flex-shrink-0"><label for="todo-${t.id}" class="cursor-pointer ${t.completed?"line-through text-gray-500":""} truncate">${t.task}</label></div><button class="text-gray-600 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100 transition-opacity ml-2 flex-shrink-0" title="Löschen"><i class="fas fa-trash"></i></button>`;const n=o.querySelector("input[type=checkbox]"),a=o.querySelector("button");n&&n.addEventListener("change",e=>toggleTodo(t.id,e.target.checked)),a&&a.addEventListener("click",()=>deleteTodoDOM(t.id)),e.appendChild(o)})}
        function fetchTodos(){fetch("/api/todos").then(t=>{if(!t.ok)throw new Error("Netzwerkfehler beim Laden der Todos");return t.json()}).then(t=>{renderTodos(t.data||[])}).catch(t=>{console.error("Fehler beim Laden der Todos:",t),renderTodos([])})}
        function addTodo(t){fetch("/api/todos",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({task:t})}).then(res=>{if(!res.ok)return res.json().then(err=>{throw new Error(err.error||"Fehler beim Hinzufügen")});return res.json()}).then(t=>{t.data&&fetchTodos()}).catch(e=>{alert(`Fehler: ${e.message}`)})}
        function toggleTodo(t,e){fetch(`/api/todos/${t}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({completed:e?1:0})}).then(res=>{if(!res.ok)return res.json().then(err=>{throw new Error(err.error||"Update fehlgeschlagen")});fetchTodos()}).catch(e=>{alert(`Fehler: ${e.message}`)})}
        function deleteTodoDOM(t){const e=document.querySelector(`.todo-item[data-id='${t}']`),taskText=e?e.querySelector("label").textContent:"diese Aufgabe";if(!e||!confirm(`"${taskText}" wirklich löschen?`))return;fetch(`/api/todos/${t}`,{method:"DELETE"}).then(res=>{if(!res.ok)return res.json().then(err=>{throw new Error(err.error||"Löschen fehlgeschlagen")});e.remove()}).catch(e=>{alert(`Fehler: ${e.message}`)})}

        // --- Media Player Funktion ---
        function setupMediaPlayer() {
            const widget = document.getElementById('media-player-widget');
            if (!widget || widget.classList.contains('initialized')) return;
            widget.classList.add('initialized', 'loading');
            let playlist=[],currentTrackIndex=0,activePlayer,mediaType='audio',isSeeking=!1;
            widget.innerHTML=`<div class="flex justify-between items-center w-full mb-4"><h3 class="font-bold text-lg text-white"><i class="fas fa-play-circle mr-2"></i>Media Player</h3><div class="media-toggle"><button id="toggle-audio" class="active">Audio</button><button id="toggle-video">Video</button></div></div><div class="flex flex-col sm:flex-row gap-6 w-full"><div class="w-32 h-32 rounded-lg shadow-lg flex-shrink-0 mx-auto relative bg-gray-800 flex items-center justify-center overflow-hidden"><img id="media-album-art" src="/images/icon-192.png" alt="Album Art" class="w-full h-full object-cover rounded-lg absolute inset-0 transition-opacity duration-300"><video id="media-video-player" class="w-full h-full rounded-lg absolute inset-0 hidden opacity-0 transition-opacity duration-300" controls preload="metadata"></video></div><div class="flex flex-col justify-between flex-grow w-full text-center sm:text-left"><div><h3 id="media-song-title" class="font-bold text-lg md:text-xl text-white truncate">Wähle einen Titel</h3><p id="media-song-artist" class="text-base md:text-lg text-gray-400">-</p></div><div class="mt-4"><div class="flex justify-between text-xs text-gray-400"><span id="media-current-time">0:00</span><span id="media-total-time">0:00</span></div><div class="progress-bar-bg w-full h-2 rounded-full mt-1 overflow-hidden cursor-pointer group"><div id="media-progress-bar" class="progress-bar-fg h-2 rounded-full group-hover:h-3 transition-all duration-150" style="width:0%"></div></div><div class="flex items-center justify-center gap-6 mt-3"><button id="media-prev-btn" class="text-3xl text-gray-400 hover:text-white transition-colors" title="Vorheriger"><i class="fas fa-backward-step"></i></button><button id="media-play-pause-btn" class="text-5xl hover:text-purple-400 transition-colors" title="Play/Pause"><i class="fas fa-play-circle"></i></button><button id="media-next-btn" class="text-3xl text-gray-400 hover:text-white transition-colors" title="Nächster"><i class="fas fa-forward-step"></i></button></div></div></div></div><div class="mt-4 w-full border-t border-gray-700 pt-4"><h4 id="playlist-title" class="font-semibold mb-2">Playlist: Audio</h4><ul id="media-playlist" class="text-left space-y-1 max-h-32 overflow-y-auto pr-2"><li>Lade...</li></ul></div>`;
            const ui={audioPlayer:document.getElementById("media-audio-player"),videoPlayer:document.getElementById("media-video-player"),playPauseBtn:document.getElementById("media-play-pause-btn"),prevBtn:document.getElementById("media-prev-btn"),nextBtn:document.getElementById("media-next-btn"),albumArt:document.getElementById("media-album-art"),title:document.getElementById("media-song-title"),artist:document.getElementById("media-song-artist"),currentTime:document.getElementById("media-current-time"),totalTime:document.getElementById("media-total-time"),progressBar:document.getElementById("media-progress-bar"),progressBarContainer:widget.querySelector(".progress-bar-bg"),playlist:document.getElementById("media-playlist"),toggleAudio:document.getElementById("toggle-audio"),toggleVideo:document.getElementById("toggle-video"),playlistTitle:document.getElementById("playlist-title")};
            if(Object.values(ui).some(el=>!el)){console.error("Ein oder mehrere Media Player UI-Elemente nicht gefunden!",ui),widget.classList.remove("loading","initialized"),widget.innerHTML='<p class="text-red-500 text-center">Fehler beim Initialisieren des Players.</p>';return}
            function loadPlaylist(type){if(mediaType===type&&playlist.length>0&&!widget.classList.contains("loading"))return;widget.classList.add("loading"),pauseTrack(),mediaType=type,ui.playlistTitle.textContent=`Playlist: ${"audio"===type?"Audio":"Video"}`,ui.toggleAudio.classList.toggle("active","audio"===type),ui.toggleVideo.classList.toggle("active","video"===type),ui.toggleAudio.disabled=!0,ui.toggleVideo.disabled=!0,ui.playlist.innerHTML='<li><i class="fas fa-spinner fa-spin mr-2"></i>Lade...</li>',fetch(`/api/${"audio"===type?"music":"videos"}`).then(res=>{if(!res.ok)throw new Error(`Serverfehler: ${res.status}`);return res.json()}).then(data=>{playlist=data||[],currentTrackIndex=0,renderPlaylist(),playlist.length>0?loadTrack(0):handleEmptyPlaylist()}).catch(handlePlaylistError).finally(()=>{widget.classList.remove("loading"),ui.toggleAudio.disabled=!1,ui.toggleVideo.disabled=!1})}
            function handleEmptyPlaylist(){ui.title.textContent="Keine Titel gefunden",ui.artist.textContent="-",ui.playlist.innerHTML=`<li>Keine ${"audio"===mediaType?"Musikdateien (.mp3)":"Videodateien (.mp4)"} im Ordner gefunden.</li>`,ui.albumArt.src="/images/icon-192.png",ui.currentTime.textContent="0:00",ui.totalTime.textContent="0:00",ui.progressBar.style.width="0%",activePlayer&&(activePlayer.src="",activePlayer.load()),pauseTrack()}function handlePlaylistError(err){console.error(`Fehler beim Laden der ${mediaType}-Playlist:`,err),ui.playlist.innerHTML="<li>Fehler beim Laden.</li>",ui.title.textContent="Fehler",ui.artist.textContent=err.message||"-",handleEmptyPlaylist()}function renderPlaylist(){ui.playlist.innerHTML="";if(!playlist||0===playlist.length)return void handleEmptyPlaylist();playlist.forEach((item,index)=>{const li=document.createElement("li");li.className=`p-2 rounded-md playlist-item truncate ${index===currentTrackIndex?"active":""}`;let displayText=item.title||"Unbenannter Titel";"audio"===mediaType&&item.artist&&"Unbekannter Künstler"!==item.artist&&(displayText=`${item.artist} - ${displayText}`),li.textContent=displayText,li.title=displayText,li.onclick=e=>{e.stopPropagation(),currentTrackIndex=index,loadTrack(currentTrackIndex),playTrack()},ui.playlist.appendChild(li)});const activeItem=ui.playlist.querySelector(".active");activeItem&&activeItem.scrollIntoView({behavior:"smooth",block:"nearest"})}
            function loadTrack(index){if(!playlist||0===playlist.length||index<0||index>=playlist.length)return void handleEmptyPlaylist();currentTrackIndex=index;const track=playlist[index];ui.title.textContent=track.title||"Unbenannter Titel",ui.artist.textContent="audio"===mediaType||track.artist&&"Unbekannter Künstler"!==track.artist?track.artist||"-":"-",pauseTrack();const wasPlaying=activePlayer&&!activePlayer.paused;"audio"===mediaType?(activePlayer=ui.audioPlayer,ui.videoPlayer.classList.add("hidden","opacity-0"),ui.videoPlayer.pause(),ui.videoPlayer.src&&"",ui.albumArt.classList.remove("hidden","opacity-0"),ui.albumArt.src=track.cover||"/images/icon-192.png"):(activePlayer=ui.videoPlayer,ui.audioPlayer.pause(),ui.audioPlayer.src&&"",ui.albumArt.classList.add("hidden","opacity-0"),ui.videoPlayer.classList.remove("hidden","opacity-0")),activePlayer.currentSrc!==track.src?activePlayer.src=track.src:updateTime(),activePlayer.load(),renderPlaylist(),ui.currentTime.textContent="0:00",ui.totalTime.textContent="0:00",ui.progressBar.style.width="0%",activePlayer.oncanplaythrough=()=>{updateTime(),wasPlaying&&playTrack(),activePlayer.oncanplaythrough=null}}
            function playTrack(){activePlayer&&activePlayer.src&&0!==playlist.length&&activePlayer.play().then(()=>{ui.playPauseBtn.innerHTML='<i class="fas fa-pause-circle"></i>'}).catch(e=>{console.error("Play Error:",e),ui.playPauseBtn.innerHTML='<i class="fas fa-play-circle"></i>'})}function pauseTrack(){activePlayer&&activePlayer.pause(),ui.playPauseBtn.innerHTML='<i class="fas fa-play-circle"></i>'}
            ui.toggleAudio.addEventListener("click",()=>loadPlaylist("audio")),ui.toggleVideo.addEventListener("click",()=>loadPlaylist("video")),ui.playPauseBtn.addEventListener("click",()=>{activePlayer&&activePlayer.src&&0!==playlist.length?activePlayer.paused?playTrack():pauseTrack():playlist.length>0&&(loadTrack(0),playTrack())}),ui.nextBtn.addEventListener("click",()=>{playlist.length<=1||(currentTrackIndex=(currentTrackIndex+1)%playlist.length,loadTrack(currentTrackIndex),playTrack())}),ui.prevBtn.addEventListener("click",()=>{playlist.length<=1||(currentTrackIndex=(currentTrackIndex-1+playlist.length)%playlist.length,loadTrack(currentTrackIndex),playTrack())}),ui.progressBarContainer.addEventListener("click",e=>{if(!activePlayer||!activePlayer.duration||isNaN(activePlayer.duration)||activePlayer.duration<=0)return;const t=ui.progressBarContainer.getBoundingClientRect(),o=e.clientX-t.left,n=Math.max(0,Math.min(1,o/t.width));activePlayer.currentTime=n*activePlayer.duration,updateTime()});const updateTime=()=>{!isSeeking&&activePlayer&&activePlayer.duration&&!isNaN(activePlayer.duration)&&activePlayer.duration>0?(ui.progressBar.style.width=`${activePlayer.currentTime/activePlayer.duration*100}%`,ui.currentTime.textContent=formatTime(activePlayer.currentTime),ui.totalTime.textContent=formatTime(activePlayer.duration)):activePlayer&&activePlayer.src&&!(activePlayer.duration>0)||(ui.currentTime.textContent="0:00",ui.totalTime.textContent="0:00",ui.progressBar.style.width="0%")};ui.audioPlayer.addEventListener("timeupdate",updateTime),ui.videoPlayer.addEventListener("timeupdate",updateTime);const handleMetadata=()=>updateTime();ui.audioPlayer.addEventListener("loadedmetadata",handleMetadata),ui.videoPlayer.addEventListener("loadedmetadata",handleMetadata);const playNextTrack=()=>{playlist.length>1?ui.nextBtn.click():(pauseTrack(),activePlayer&&(activePlayer.currentTime=0),updateTime())};ui.audioPlayer.addEventListener("ended",playNextTrack),ui.videoPlayer.addEventListener("ended",playNextTrack)}

        // --- Radio Player Initialisierung ---
        function initRadioPlayer() {
            const radioPlayer = document.getElementById('radio-player');
            const playPauseBtn = document.getElementById('radio-play-pause-btn');
            const stationSelect = document.getElementById('station-select');
            if(!radioPlayer || !playPauseBtn || !stationSelect) return;

            // Initialen Zustand setzen (verhindert Autoplay)
            radioPlayer.src = stationSelect.value;
            playPauseBtn.innerHTML = '<i class="fas fa-play-circle"></i>';

            playPauseBtn.addEventListener("click",()=>{
                if (radioPlayer.paused) {
                    radioPlayer.src = stationSelect.value; // Immer aktuelle Quelle setzen
                    radioPlayer.load(); // Wichtig: Quelle neu laden
                    radioPlayer.play().catch(e => console.error("Radio play error:", e));
                } else {
                    radioPlayer.pause();
                }
            });
            stationSelect.addEventListener("change",()=>{
                radioPlayer.src=stationSelect.value;
                radioPlayer.load(); // Wichtig: Quelle neu laden
                radioPlayer.play().catch(e => console.error("Radio play error on change:", e));
            });
             radioPlayer.onplay = () => playPauseBtn.innerHTML='<i class="fas fa-pause-circle"></i>';
             radioPlayer.onpause = () => playPauseBtn.innerHTML='<i class="fas fa-play-circle"></i>';
             radioPlayer.onerror = (e) => {
                console.error("Radio Player Error:", e);
                alert("Fehler beim Laden des Radiostreams.");
                pauseTrack(); // Button zurücksetzen
             }
        }

        // --- HAUPTLOGIK & EVENT LISTENERS ---
        document.addEventListener("DOMContentLoaded",()=>{
            const t={authButton:document.getElementById("auth-button"),loginModal:document.getElementById("login-modal"),loginForm:document.getElementById("login-form"),cancelLoginBtn:document.getElementById("cancel-login"),loginErrorMsg:document.getElementById("login-error"),addAppModal:document.getElementById("add-app-modal"),addAppForm:document.getElementById("add-app-form"),addAppButton:document.getElementById("add-app-button"),cancelAddAppBtn:document.getElementById("cancel-add-app"),addAppErrorMsg:document.getElementById("add-app-error"),routeStartBtn:document.getElementById("route-start-btn"),shortenBtn:document.getElementById("shorten-btn"),copyBtn:document.getElementById("copy-btn"),notesTextarea:document.getElementById("notes-textarea"),addTodoForm:document.getElementById("add-todo-form"),googleSuiteBtn:document.getElementById("google-suite-btn"),googleSuiteModal:document.getElementById("google-suite-modal"),closeGoogleModalBtn:document.getElementById("close-google-modal")};

            updateClock(); setInterval(updateClock, 30000);

            fetch("/api/auth/status").then(res=>{if(!res.ok)throw new Error("Auth status check failed");return res.json()}).then(o=>{toggleView(o.loggedIn,o.username)}).catch(o=>{console.error("Auth-Status-Fehler:",o),toggleView(!1)});

            // Event Listeners for Modals & Widgets
            if(t.cancelLoginBtn) t.cancelLoginBtn.addEventListener("click",()=>t.loginModal.classList.add("hidden"));
            if(t.loginForm) t.loginForm.addEventListener("submit",e=>{e.preventDefault();const o=document.getElementById("username").value,n=document.getElementById("pin").value;t.loginErrorMsg.classList.add("hidden");fetch("/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:o,pin:n})}).then(t=>t.json().then(e=>({status:t.status,body:e}))).then(({status:e,body:o})=>{if(200!==e)throw new Error(o.error||"Login fehlgeschlagen");window.location.reload()}).catch(e=>{t.loginErrorMsg.textContent=e.message,t.loginErrorMsg.classList.remove("hidden")})});
            if(t.addAppButton) t.addAppButton.addEventListener("click",()=>t.addAppModal.classList.remove("hidden"));
            if(t.cancelAddAppBtn) t.cancelAddAppBtn.addEventListener("click",()=>t.addAppModal.classList.add("hidden"));
            if(t.addAppForm) t.addAppForm.addEventListener("submit",e=>{e.preventDefault();const o=document.getElementById("app-name").value,n=document.getElementById("app-url").value,a=document.getElementById("app-icon-url").value;t.addAppErrorMsg.classList.add("hidden");fetch("/api/apps/add",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:o,url:n,iconUrl:a})}).then(t=>{if(!t.ok)return t.json().then(e=>{throw new Error(e.error||"Fehler beim Hinzufügen")});return t.json()}).then(e=>{addAppTileToDOM(e.data),t.addAppModal.classList.add("hidden"),t.addAppForm.reset()}).catch(e=>{t.addAppErrorMsg.textContent=e.message,t.addAppErrorMsg.classList.remove("hidden")})});
            if(t.googleSuiteBtn) t.googleSuiteBtn.addEventListener("click",()=>t.googleSuiteModal.classList.remove("hidden"));
            if(t.closeGoogleModalBtn) t.closeGoogleModalBtn.addEventListener("click",()=>t.googleSuiteModal.classList.add("hidden"));
            if(t.googleSuiteModal) t.googleSuiteModal.addEventListener("click",e=>{e.target===t.googleSuiteModal&&t.googleSuiteModal.classList.add("hidden")});
            if(t.routeStartBtn) t.routeStartBtn.addEventListener("click",()=>{const e=document.getElementById("route-start").value,o=document.getElementById("route-destination").value;if(!e||!o)return t.routeStartBtn.textContent="Bitte alles ausfüllen!",t.routeStartBtn.classList.add("bg-red-500"),void setTimeout(()=>{t.routeStartBtn.textContent="Route starten",t.routeStartBtn.classList.remove("bg-red-500")},2e3);const n=`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(e)}&destination=${encodeURIComponent(o)}`;window.open(n,"_blank")});
            if(t.shortenBtn) t.shortenBtn.addEventListener("click",()=>{const e=document.getElementById("long-url-input");const o=e.value;if(!o||!o.startsWith("http"))return alert("Bitte eine gültige URL eingeben.");t.shortenBtn.disabled=!0,t.shortenBtn.innerHTML='<i class="fas fa-spinner fa-spin"></i>';fetch("/api/shorten",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:o})}).then(t=>t.json()).then(o=>{if(o.error)throw new Error(o.error);document.getElementById("short-url-output").value=o.shortUrl,document.getElementById("short-url-result").classList.remove("hidden");e.value='';}).catch(e=>alert(e.message)).finally(()=>{t.shortenBtn.disabled=!1,t.shortenBtn.innerHTML="Kürzen"})});
            if(t.copyBtn) t.copyBtn.addEventListener("click",()=>{const e=document.getElementById("short-url-output");e.select();try{document.execCommand("copy");t.copyBtn.innerHTML='<i class="fas fa-check text-green-500"></i>'}catch(err){t.copyBtn.innerHTML='<i class="fas fa-times text-red-500"></i>',console.error("Copy failed:",err)}setTimeout(()=>{t.copyBtn.innerHTML='<i class="fas fa-copy"></i>'},2e3)});
            if(t.notesTextarea) t.notesTextarea.addEventListener("input",saveNote);
            if(t.addTodoForm) t.addTodoForm.addEventListener("submit",e=>{e.preventDefault();const o=document.getElementById("new-todo-input");const n=o.value.trim();""!==n&&(addTodo(n),o.value="")});

            // PWA Service Worker Registration
            if('serviceWorker'in navigator){window.addEventListener("load",()=>{navigator.serviceWorker.register("/sw.js",{scope:"/"}).then(registration=>console.log("ServiceWorker registration successful with scope: ",registration.scope)).catch(err=>console.log("ServiceWorker registration failed: ",err))})}
        });
    </script>
</body>
</html>
```eof

#### Schritt 4: Deployment

1.  **Datenbank zurücksetzen:** Löschen Sie die `db.sqlite`-Datei lokal **und** auf dem Server (`rm /root/dashboard/db.sqlite`). Da wir die Tabellenstruktur geändert haben, ist ein Neuanfang am sichersten.
2.  **Code zu GitHub pushen:** Committen und pushen Sie alle Änderungen (`database.js`, `server.js`, `index.html`).
3.  **Auf dem LXC Server (115) aktualisieren:**
    * `git pull`
    * `npm install` (um sicherzustellen, dass alle Pakete aktuell sind)
    * Server neu starten: `CTRL+C`, dann `node server.js`.
4.  **Testen:**
    * Loggen Sie sich ein (der Standardbenutzer wird neu erstellt).
    * Klicken Sie auf den `+`-Button im Bereich "Private Apps".
    * Geben Sie Name, URL und optional eine Bild-URL für das Icon ein.
    * Klicken Sie auf "Speichern". Die Kachel sollte nun mit dem Bild (oder dem Standard-Icon) erscheinen.
    * Testen Sie das Löschen.
    * Laden Sie die Seite neu, um zu prüfen, ob die Kachel bestehen bleibt.

```eof
