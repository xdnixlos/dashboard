// server.js

// --- Imports ---
const express = require('express');
const path = require('path');
const fs = require('fs');
const Parser = require('rss-parser');
const axios = require('axios');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
require('dotenv').config(); // Lädt .env-Variablen

// --- Datenbank-Import (Korrigiert) ---
const { getDb, initDb, closeDb } = require('./database.js');

// --- App-Initialisierung ---
const app = express();
const parser = new Parser();
const port = 3000;

// --- Middleware ---
app.use(express.json()); // Für JSON-Bodys (POST-Anfragen)
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Statische Dateien (CSS, JS, Bilder, PWA-Dateien, Medien)
app.use(express.static(path.join(__dirname, 'public')));
// Templates
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'html');
app.engine('html', (filePath, options, callback) => {
    fs.readFile(filePath, (err, content) => {
        if (err) return callback(err);
        return callback(null, content.toString());
    });
});

// Session-Middleware (Wichtig für Logins)
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_secret_bitte_in_env_aendern',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', 
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 Stunden
    }
}));

// Middleware, um zu prüfen, ob der Benutzer eingeloggt ist
function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.status(401).json({ error: 'Nicht autorisiert' });
    }
}

// --- Hauptroute ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// --- Authentifizierungs-Routen ---

// Login (mit Passwort)
app.post('/login', async (req, res) => {
    const { username, password } = req.body; // <-- Geändert von 'pin'
    const db = getDb(); // Datenbankverbindung holen

    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) {
            console.error('Datenbankfehler beim Login:', err);
            return res.status(500).json({ error: 'Serverfehler' });
        }
        if (!user) {
            return res.status(401).json({ error: 'Ungültiger Benutzername oder Passwort' }); // <-- Geändert
        }

        try {
            // Vergleiche 'password' mit 'password_hash'
            const match = await bcrypt.compare(password, user.password_hash); 
            
            if (match) {
                req.session.userId = user.id;
                req.session.username = user.username;
                res.json({ success: true, message: 'Login erfolgreich' });
            } else {
                res.status(401).json({ error: 'Ungültiger Benutzername oder Passwort' }); // <-- Geändert
            }
        } catch (compareErr) {
            console.error('Fehler beim Passwort-Vergleich:', compareErr);
            res.status(500).json({ error: 'Serverfehler beim Passwort-Vergleich' });
        }
    });
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ error: 'Logout fehlgeschlagen' });
        }
        res.clearCookie('connect.sid'); 
        res.redirect('/');
    });
});

// Login-Status prüfen
app.get('/api/auth/status', (req, res) => {
    if (req.session.userId) {
        res.json({ loggedIn: true, username: req.session.username, userId: req.session.userId });
    } else {
        res.json({ loggedIn: false });
    }
});

// --- Widget API-Routen (Öffentlich) ---

// Wetter-API
app.get('/api/weather', async (req, res) => {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    const city = "Erding"; 
    const lang = "de";
    const units = "metric";

    if (!apiKey) {
        return res.status(500).json({ error: "Kein API-Schlüssel für Wetter konfiguriert" });
    }

    const currentUrl = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&lang=${lang}&units=${units}`;
    const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?q=${city}&appid=${apiKey}&lang=${lang}&units=${units}`;

    try {
        const [currentRes, forecastRes] = await Promise.all([
            axios.get(currentUrl),
            axios.get(forecastUrl)
        ]);

        const currentData = currentRes.data;
        const current = {
            temperature: Math.round(currentData.main.temp),
            description: currentData.weather[0].description,
            icon: currentData.weather[0].icon,
        };

        const forecastList = forecastRes.data.list;
        const dailyForecast = forecastList.filter(item => item.dt_txt.includes("12:00:00"))
            .slice(0, 4) 
            .map(item => ({
                day: new Date(item.dt * 1000).toLocaleDateString('de-DE', { weekday: 'short' }),
                temp: Math.round(item.main.temp),
                icon: item.weather[0].icon,
            }));

        res.json({
            city: currentData.name,
            current: current,
            forecast: dailyForecast
        });

    } catch (error) {
        console.error("Fehler beim Abrufen der Wetterdaten:", error.message);
        res.status(500).json({ error: "Fehler beim Abrufen der Wetterdaten" });
    }
});

// RSS-Feed API
app.get('/api/rss', async (req, res) => {
    const FEED_URL = 'https://www.heise.de/rss/heise-atom.xml'; 
    try {
        const feed = await parser.parseURL(FEED_URL);
        const items = feed.items.slice(0, 5).map(item => ({
            title: item.title,
            link: item.link
        }));
        res.json(items);
    } catch (error) {
        console.error("Fehler beim Abrufen des RSS Feeds:", error.message);
        res.status(500).json({ error: "RSS Feed konnte nicht geladen werden" });
    }
});

// Media Player API: Musik
app.get('/api/music', (req, res) => {
    const db = getDb(); 
    const musicDir = path.join(__dirname, 'public', 'music');
    fs.readdir(musicDir, (err, files) => {
        if (err) {
            console.error("Fehler beim Lesen des Musik-Ordners:", err);
            return res.status(500).json({ error: 'Medien konnten nicht geladen werden' });
        }
        const songs = files
            .filter(file => file.endsWith('.mp3'))
            .map(file => ({
                title: file.replace('.mp3', '').replace(/_/g, ' '),
                artist: 'Eigenproduktion', 
                src: `/music/${file}`,
                cover: '/images/icon-512.png' 
            }));
        res.json(songs);
    });
});

// URL Shortener API: Erstellen
app.post('/api/shorten', (req, res) => {
    const db = getDb();
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'URL fehlt' });
    }
    const shortCode = crypto.randomBytes(4).toString('hex');
    db.run('INSERT INTO short_urls (short_code, original_url) VALUES (?, ?)', [shortCode, url], function (err) {
        if (err) {
            console.error('Fehler beim Erstellen der Short-URL:', err);
            return res.status(500).json({ error: 'Serverfehler' });
        }
        const shortUrl = `https://${req.get('host')}/${shortCode}`; // HTTPS
        res.json({ shortUrl: shortUrl });
    });
});

// --- Private API-Routen (Login erforderlich) ---

// Notizen (GET)
app.get('/api/notes', isAuthenticated, (req, res) => {
    const db = getDb();
    db.get('SELECT content FROM notes WHERE user_id = ?', [req.session.userId], (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Serverfehler' });
        }
        res.json({ content: row ? row.content : '' });
    });
});

// Notizen (POST)
app.post('/api/notes', isAuthenticated, (req, res) => {
    const db = getDb();
    const { content } = req.body;
    db.run(
        'INSERT INTO notes (user_id, content) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET content = excluded.content',
        [req.session.userId, content],
        (err) => {
            if (err) {
                return res.status(500).json({ error: 'Speichern fehlgeschlagen' });
            }
            res.json({ success: true });
        }
    );
});

// To-Dos (GET)
app.get('/api/todos', isAuthenticated, (req, res) => {
    const db = getDb();
    db.all('SELECT * FROM todos WHERE user_id = ?', [req.session.userId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Serverfehler' });
        }
        res.json({ data: rows });
    });
});

// To-Do (POST - Neu)
app.post('/api/todos', isAuthenticated, (req, res) => {
    const db = getDb();
    const { task } = req.body;
    db.run('INSERT INTO todos (user_id, task) VALUES (?, ?)', [req.session.userId, task], function (err) {
        if (err) {
            return res.status(500).json({ error: 'Serverfehler' });
        }
        res.json({ id: this.lastID, task: task, completed: 0 });
    });
});

// To-Do (PUT - Update)
app.put('/api/todos/:id', isAuthenticated, (req, res) => {
    const db = getDb();
    const { completed } = req.body;
    db.run(
        'UPDATE todos SET completed = ? WHERE id = ? AND user_id = ?',
        [completed ? 1 : 0, req.params.id, req.session.userId],
        function (err) {
            if (err) {
                return res.status(500).json({ error: 'Serverfehler' });
            }
            res.json({ success: this.changes > 0 });
        }
    );
});

// To-Do (DELETE)
app.delete('/api/todos/:id', isAuthenticated, (req, res) => {
    const db = getDb();
    db.run('DELETE FROM todos WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId], function (err) {
        if (err) {
            return res.status(500).json({ error: 'Serverfehler' });
        }
        res.json({ success: this.changes > 0 });
    });
});

// --- Sektionen & Apps API (Login erforderlich) ---

// Sektionen (GET)
app.get('/api/sections', isAuthenticated, (req, res) => {
    const db = getDb();
    db.all('SELECT * FROM sections WHERE user_id = ? ORDER BY sort_order, name', [req.session.userId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Serverfehler' });
        }
        res.json({ data: rows });
    });
});

// Sektion (POST - Neu)
app.post('/api/sections', isAuthenticated, (req, res) => {
    const db = getDb();
    const { name } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Name ist erforderlich' });
    }
    db.run('INSERT INTO sections (user_id, name) VALUES (?, ?)', [req.session.userId, name], function (err) {
        if (err) {
            return res.status(500).json({ error: 'Serverfehler' });
        }
        res.json({ id: this.lastID, name: name });
    });
});

// Sektion (DELETE)
app.delete('/api/sections/:id', isAuthenticated, (req, res) => {
    const db = getDb();
    db.get('SELECT COUNT(*) as count FROM user_apps WHERE section_id = ? AND user_id = ?', [req.params.id, req.session.userId], (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Serverfehler' });
        }
        if (row.count > 0) {
            return res.status(400).json({ error: 'Sektion kann nicht gelöscht werden, da sie noch Apps enthält.' });
        }
        db.run('DELETE FROM sections WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId], function (err) {
            if (err) {
                return res.status(500).json({ error: 'Serverfehler' });
            }
            res.json({ success: this.changes > 0 });
        });
    });
});

// App (POST - Neu)
app.post('/api/apps/add', isAuthenticated, (req, res) => {
    const db = getDb();
    const { name, url, icon_url, section_id, is_public } = req.body;
    if (!name || !url || !section_id) {
        return res.status(400).json({ error: 'Name, URL und Sektion sind erforderlich' });
    }
    const isPublicValue = is_public ? 1 : 0;
    
    db.run(
        'INSERT INTO user_apps (user_id, section_id, name, url, icon_url, is_public) VALUES (?, ?, ?, ?, ?, ?)',
        [req.session.userId, section_id, name, url, icon_url || null, isPublicValue],
        function (err) {
            if (err) {
                return res.status(500).json({ error: 'Serverfehler' });
            }
            // Hole die neu erstellte App inklusive Sektionsname
             db.get(`
                SELECT a.*, s.name as section_name 
                FROM user_apps a 
                LEFT JOIN sections s ON a.section_id = s.id 
                WHERE a.id = ?`, 
                [this.lastID], 
                (err, newApp) => {
                    if (err) return res.status(500).json({ error: 'App erstellt, aber konnte nicht abgerufen werden' });
                    res.json({ success: true, data: newApp });
            });
        }
    );
});

// App (DELETE)
app.delete('/api/apps/:id', isAuthenticated, (req, res) => {
    const db = getDb();
    db.run('DELETE FROM user_apps WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId], function (err) {
        if (err) {
            return res.status(500).json({ error: 'Serverfehler' });
        }
        res.json({ success: this.changes > 0 });
    });
});

// --- Öffentliche App-Routen (Kein Login nötig) ---

// Apps (GET - Öffentlich)
app.get('/api/apps/public', (req, res) => {
    const db = getDb();
    const query = `
        SELECT a.id, a.name, a.url, a.icon_url, s.name as section_name, s.id as section_id
        FROM user_apps a
        LEFT JOIN sections s ON a.section_id = s.id
        WHERE a.is_public = 1
        ORDER BY s.sort_order, s.name, a.sort_order, a.name
    `;
    db.all(query, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Serverfehler' });
        }
        res.json({ data: rows });
    });
});

// Apps (GET - Privat)
app.get('/api/apps/private', isAuthenticated, (req, res) => {
    const db = getDb();
    const query = `
        SELECT a.id, a.name, a.url, a.icon_url, s.name as section_name, s.id as section_id
        FROM user_apps a
        LEFT JOIN sections s ON a.section_id = s.id
        WHERE a.user_id = ? AND a.is_public = 0
        ORDER BY s.sort_order, s.name, a.sort_order, a.name
    `;
    db.all(query, [req.session.userId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Serverfehler' });
        }
        res.json({ data: rows });
    });
});

// --- URL Shortener Redirect (Muss am Ende stehen!) ---
app.get('/:shortCode', (req, res, next) => {
    // Filter für statische Dateien und API-Routen
    if (req.path === '/manifest.json' || 
        req.path === '/sw.js' || 
        req.path === '/favicon.ico' || 
        req.path.startsWith('/api') ||
        req.path.startsWith('/images') ||
        req.path.startsWith('/music') ||
        req.path.startsWith('/videos')) {
        return next(); // Lässt die Anfrage an express.static weiter
    }
    
    const db = getDb();
    const { shortCode } = req.params;
    db.get('SELECT original_url FROM short_urls WHERE short_code = ?', [shortCode], (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Serverfehler' });
        }
        if (row) {
            res.redirect(row.original_url);
        } else {
            // Wenn der Code nicht gefunden wurde, zur Hauptseite
            res.redirect('/');
        }
    });
});

// --- Serverstart ---
app.listen(port, async () => {
    try {
        await initDb(); // Datenbank initialisieren (macht connectDb)
        console.log(`[WF-Dashboard] Server läuft auf Port ${port}`);
    } catch (err) {
        console.error("Server konnte nicht gestartet werden (DB-Fehler):", err);
        process.exit(1);
    }
});

// Sauberes Schließen der Datenbank
process.on('SIGINT', () => {
    closeDb();
    process.exit(0);
});
