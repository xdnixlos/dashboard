    require('dotenv').config();
    const express = require('express');
    const path = require('path');
    const Parser = require('rss-parser');
    const axios = require('axios'); // Wird noch für Wetter gebraucht
    const session = require('express-session');
    const cookieParser = require('cookie-parser');
    const bcrypt = require('bcrypt');
    const crypto = require('crypto');
    const fs = require('fs');
    const db = require('./database.js');

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
            res.json(feed.items.slice(0, 5).map(item => ({ title: item.title, link: item.link })));
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
        // Für eine 4-Tage-Vorhersage (ungefähr) brauchen wir mehr Einträge, OpenWeather gibt alle 3h einen
        // cnt=32 => 4 Tage (8 Einträge pro Tag * 4 Tage)
        const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?q=${city}&appid=${OPENWEATHER_API_KEY}&lang=${lang}&units=${units}&cnt=33`; // +1 Puffer

        try {
            const [currentRes, forecastRes] = await Promise.all([
                axios.get(currentWeatherUrl),
                axios.get(forecastUrl)
            ]);

            const currentData = currentRes.data;
            const forecastData = forecastRes.data;

            // Verarbeite Vorhersage, um ~Mittags-Werte der nächsten 4 Tage zu bekommen
            const dailyForecasts = {};
            forecastData.list.forEach(item => {
                const date = new Date(item.dt * 1000);
                const dayKey = date.toISOString().split('T')[0]; // YYYY-MM-DD als Schlüssel
                const hour = date.getHours();

                // Speichere den Eintrag, der am nächsten an 12 Uhr mittags liegt
                if (!dailyForecasts[dayKey] || Math.abs(hour - 12) < Math.abs(new Date(dailyForecasts[dayKey].dt * 1000).getHours() - 12)) {
                    // Überspringe den heutigen Tag für die Vorhersage
                    const todayKey = new Date().toISOString().split('T')[0];
                    if (dayKey !== todayKey) {
                        dailyForecasts[dayKey] = item;
                    }
                }
            });

             // Nimm die ersten 4 Tage aus den gesammelten Mittags-Werten
             const forecast = Object.values(dailyForecasts).slice(0, 4).map(item => ({
                day: new Date(item.dt * 1000).toLocaleDateString('de-DE', { weekday: 'short' }), // Tag (Mo, Di, ...)
                icon: item.weather[0].icon,
                temp: Math.round(item.main.temp)
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
                 if (error.response.status === 401) {
                    errorMessage = 'OpenWeatherMap API Fehler: Nicht autorisiert (API Key ungültig?).';
                 } else if (error.response.status === 404) {
                    errorMessage = `OpenWeatherMap API Fehler: Stadt "${city}" nicht gefunden.`;
                 } else if (error.response.status === 429) {
                    errorMessage = 'OpenWeatherMap API Fehler: Zu viele Anfragen.';
                 }
             }
            res.status(500).json({ error: errorMessage });
        }
    });


    app.post('/api/shorten', (req, res) => {
        const { url } = req.body;
        if (!url || !url.startsWith('http')) {
            return res.status(400).json({ error: 'Ungültige URL angegeben.' });
        }

        const shortCode = crypto.randomBytes(4).toString('hex'); // Etwas längerer Code für weniger Kollisionen
        // Dynamisch den Host aus der Anfrage nehmen
        const host = req.get('host');
        // Sicherstellen, dass https verwendet wird, wenn hinter einem Proxy mit SSL
        const protocol = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
        const fullShortUrl = `${protocol}://${host}/${shortCode}`;

        db.run('INSERT INTO short_urls (original_url, short_code) VALUES (?, ?)', [url, shortCode], function(err) {
            if (err) {
                 console.error("DB Fehler beim Shorten:", err);
                 return res.status(500).json({ error: 'Fehler beim Speichern der URL.' });
            }
            res.json({ shortUrl: fullShortUrl });
        });
    });

    app.get('/api/apps', isLoggedIn, (req, res) => {
        db.all('SELECT * FROM user_apps WHERE user_id = ? ORDER BY id ASC', [req.session.userId], (err, rows) => {
            if (err) {
                console.error("DB Fehler beim Laden der Apps:", err);
                return res.status(500).json({ error: 'Fehler beim Laden der Apps.' });
            }
            res.json({ data: rows });
        });
    });

    app.post('/api/apps/add', isLoggedIn, (req, res) => {
        const { name, url, icon } = req.body;
        if (!name || !url || !url.startsWith('http')) {
             return res.status(400).json({ error: 'Name und gültige URL sind erforderlich.' });
        }

        db.run('INSERT INTO user_apps (user_id, name, url, icon) VALUES (?, ?, ?, ?)',
            [req.session.userId, name, url, icon || 'fas fa-globe'],
            function(err) {
                if (err) {
                    console.error("DB Fehler beim Hinzufügen der App:", err);
                    return res.status(500).json({ error: 'Fehler beim Speichern der App.' });
                }
                // Gib das komplette App-Objekt zurück, damit das Frontend es rendern kann
                 db.get('SELECT * FROM user_apps WHERE id = ?', [this.lastID], (getErr, newApp) => {
                    if (getErr || !newApp) {
                        return res.status(500).json({ error: 'Konnte hinzugefügte App nicht abrufen.' });
                    }
                    res.status(201).json({ message: 'App hinzugefügt', data: newApp });
                 });
            }
        );
    });

    app.delete('/api/apps/:id', isLoggedIn, (req, res) => {
        const appId = req.params.id;
        db.run('DELETE FROM user_apps WHERE id = ? AND user_id = ?', [appId, req.session.userId], function(err) {
            if (err) {
                 console.error("DB Fehler beim Löschen der App:", err);
                 return res.status(500).json({ error: 'Fehler beim Löschen der App.' });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'App nicht gefunden oder keine Berechtigung.' });
            }
            res.status(200).json({ message: 'App gelöscht' });
        });
    });

     // --- API Routen für Notizen ---
     app.get('/api/notes', isLoggedIn, (req, res) => {
        db.get('SELECT content FROM user_notes WHERE user_id = ?', [req.session.userId], (err, row) => {
            if (err) {
                 console.error("DB Fehler beim Laden der Notiz:", err);
                 return res.status(500).json({ error: 'Fehler beim Laden der Notiz.' });
            }
            res.json({ content: row ? row.content : '' });
        });
    });

    app.post('/api/notes', isLoggedIn, (req, res) => {
        const { content } = req.body;
        // Upsert: Fügt ein oder ersetzt den Eintrag, falls user_id schon existiert
        db.run('INSERT OR REPLACE INTO user_notes (user_id, content) VALUES (?, ?)',
            [req.session.userId, content],
            (err) => {
                if (err) {
                    console.error("DB Fehler beim Speichern der Notiz:", err);
                    return res.status(500).json({ error: 'Fehler beim Speichern der Notiz.' });
                }
                res.status(200).json({ message: 'Notiz gespeichert' });
            }
        );
    });

    // --- API Routen für To-Dos ---
    app.get('/api/todos', isLoggedIn, (req, res) => {
        db.all('SELECT * FROM user_todos WHERE user_id = ? ORDER BY created_at ASC', [req.session.userId], (err, rows) => {
            if (err) {
                console.error("DB Fehler beim Laden der Todos:", err);
                return res.status(500).json({ error: 'Fehler beim Laden der To-Dos.' });
            }
            res.json({ data: rows });
        });
    });

    app.post('/api/todos', isLoggedIn, (req, res) => {
        const { task } = req.body;
        if (!task || task.trim() === '') {
             return res.status(400).json({ error: 'Aufgabe darf nicht leer sein.' });
        }
        db.run('INSERT INTO user_todos (user_id, task) VALUES (?, ?)', [req.session.userId, task.trim()], function(err) {
            if (err) {
                 console.error("DB Fehler beim Hinzufügen des Todos:", err);
                 return res.status(500).json({ error: 'Fehler beim Hinzufügen des To-Dos.' });
            }
             // Gib das neue Todo-Objekt zurück
             db.get('SELECT * FROM user_todos WHERE id = ?', [this.lastID], (getErr, newTodo) => {
                if (getErr || !newTodo) {
                    return res.status(500).json({ error: 'Konnte hinzugefügtes Todo nicht abrufen.' });
                }
                res.status(201).json({ data: newTodo });
            });
        });
    });

    app.put('/api/todos/:id', isLoggedIn, (req, res) => {
        const { completed } = req.body;
        const todoId = req.params.id;
         // Input validation
         if (typeof completed === 'undefined') {
             return res.status(400).json({ error: 'Status (completed) fehlt.' });
         }
        db.run('UPDATE user_todos SET completed = ? WHERE id = ? AND user_id = ?',
            [completed ? 1 : 0, todoId, req.session.userId],
            function(err) {
                if (err) {
                    console.error("DB Fehler beim Aktualisieren des Todos:", err);
                    return res.status(500).json({ error: 'Fehler beim Aktualisieren des To-Dos.' });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'To-Do nicht gefunden oder keine Berechtigung.' });
                }
                res.status(200).json({ message: 'To-Do aktualisiert' });
            }
        );
    });

    app.delete('/api/todos/:id', isLoggedIn, (req, res) => {
        const todoId = req.params.id;
        db.run('DELETE FROM user_todos WHERE id = ? AND user_id = ?', [todoId, req.session.userId], function(err) {
            if (err) {
                console.error("DB Fehler beim Löschen des Todos:", err);
                return res.status(500).json({ error: 'Fehler beim Löschen des To-Dos.' });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'To-Do nicht gefunden oder keine Berechtigung.' });
            }
            res.status(200).json({ message: 'To-Do gelöscht' });
        });
    });

     // --- MEDIA PLAYER API ROUTEN ---
     function readMediaDirectory(directory, fileExtension) {
        return new Promise((resolve, reject) => {
            fs.readdir(directory, (err, files) => {
                if (err) {
                    // Wenn Ordner nicht existiert, leere Liste zurückgeben
                    if (err.code === 'ENOENT') {
                         console.warn(`Medienverzeichnis ${directory} nicht gefunden. Erstelle es oder lade Dateien hoch.`);
                         return resolve([]);
                    }
                    console.error(`Verzeichnis konnte nicht gelesen werden: ${directory}`, err);
                    return reject('Medien konnten nicht geladen werden.');
                }
                const mediaFiles = files
                    .filter(file => file.toLowerCase().endsWith(fileExtension)) // Sicherstellen, dass auch .MP3 geht
                    .map((file, index) => {
                        const nameWithoutExt = path.parse(file).name;
                        const parts = nameWithoutExt.split(' - ');
                        const artist = parts.length > 1 ? parts[0].trim() : (fileExtension === '.mp3' ? 'Unbekannter Künstler' : '');
                        const title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : parts[0].trim();

                        return {
                            id: index,
                            title: title || 'Unbenannter Titel',
                            artist: artist,
                            // Wichtig: Pfad muss relativ zum 'public' Ordner sein und URL-codiert
                            src: `/${path.basename(directory)}/${encodeURIComponent(file)}`,
                            cover: '/images/icon-192.png' // Standard Cover aus PWA Icons
                        };
                    });
                resolve(mediaFiles);
            });
        });
    }

    app.get('/api/music', async (req, res) => {
        try {
            const musicDir = path.join(__dirname, 'public', 'music');
            // Erstelle Ordner synchron, falls nicht vorhanden (nur beim ersten Mal relevant)
            if (!fs.existsSync(musicDir)) {
                 fs.mkdirSync(musicDir, { recursive: true });
                 console.log(`Musikordner erstellt: ${musicDir}`);
            }
            const songs = await readMediaDirectory(musicDir, '.mp3');
            res.json(songs);
        } catch (error) {
            res.status(500).json({ error: error.message || 'Fehler beim Laden der Musik.' });
        }
    });

    app.get('/api/videos', async (req, res) => {
        try {
            const videoDir = path.join(__dirname, 'public', 'videos');
             // Erstelle Ordner synchron, falls nicht vorhanden
            if (!fs.existsSync(videoDir)) {
                 fs.mkdirSync(videoDir, { recursive: true });
                 console.log(`Videoordner erstellt: ${videoDir}`);
            }
            const videos = await readMediaDirectory(videoDir, '.mp4');
            res.json(videos);
        } catch (error) {
            res.status(500).json({ error: error.message || 'Fehler beim Laden der Videos.' });
        }
    });

    // --- Redirect Route (MUSS NAHEZU AM ENDE STEHEN, VOR 404) ---
    app.get('/:shortCode', (req, res, next) => {
        const shortCode = req.params.shortCode;

        // Ignoriere explizit PWA-Dateien und andere bekannte Pfade
        if (['manifest.json', 'sw.js', 'favicon.ico'].includes(shortCode) || shortCode.startsWith('images') || shortCode.startsWith('music') || shortCode.startsWith('videos')) {
            return next();
        }
        // Ignoriere API-Routen und andere bekannte Pfade
        if (shortCode === 'api' || shortCode === 'login' || shortCode === 'logout') {
            return next();
        }

        db.get('SELECT original_url FROM short_urls WHERE short_code = ?', [shortCode], (err, row) => {
            if (err) {
                 console.error("DB Fehler beim Redirect:", err);
                 return res.status(500).send('Serverfehler.');
            }
            if (row && row.original_url) {
                // Sicherheitscheck: Ist es eine gültige URL? (Einfacher Check)
                if (row.original_url.startsWith('http://') || row.original_url.startsWith('https://')) {
                    return res.redirect(row.original_url);
                } else {
                    console.warn(`Ungültige URL im Shortener gefunden: ${row.original_url}`);
                    return res.status(400).send('Ungültige Ziel-URL konfiguriert.');
                }
            }
            // Wenn kein Shortcode gefunden, mit 404 antworten, statt next() zu rufen
            res.status(404).sendFile(path.join(__dirname, 'views', '404.html')); // Optional: Eigene 404-Seite
        });
    });


    // --- PWA Service Worker Route (redundant durch static, aber schadet nicht) ---
    app.get('/sw.js', (req, res) => {
        res.setHeader('Service-Worker-Allowed', '/'); // Wichtig für Scope '/'
        res.sendFile(path.join(__dirname, 'public', 'sw.js'));
    });
     app.get('/manifest.json', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
    });


    // --- Fallback 404 Route (MUSS GANZ AM ENDE STEHEN) ---
     app.use((req, res) => {
        res.status(404).sendFile(path.join(__dirname, 'views', '404.html')); // Optional: Eigene 404 Seite
     });


    // --- SERVER START ---
    app.listen(PORT, () => {
        console.log(`[WF-Dashboard] Server läuft auf Port ${PORT}`);
        // Datenbank initialisieren, falls noch nicht geschehen
        require('./database.js').initDb(); // Rufe die exportierte Funktion auf
    });
    
