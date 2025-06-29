require('dotenv').config();
const express = require('express');
const path = require('path');
const Parser = require('rss-parser');
const axios = require('axios');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('./database.js');

const app = express();
const parser = new Parser();
const PORT = 3000;

const { OPENWEATHER_API_KEY, SESSION_SECRET, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = process.env;
const SPOTIFY_REDIRECT_URI = 'https://y.wf-tech.de/spotify/callback';

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(cookieParser());
app.use(session({
    secret: SESSION_SECRET || 'fallback_secret_string_bitte_in_env_aendern',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } 
}));

const isLoggedIn = (req, res, next) => {
    if (req.session.userId) return next();
    res.status(401).json({ error: 'Nicht autorisiert' });
};

// --- AUTH & CORE ROUTES ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));

app.post('/login', (req, res) => {
    const { username, pin } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (!user) return res.status(400).json({ "error": "Benutzer nicht gefunden" });
        bcrypt.compare(pin, user.password, (err, result) => {
            if (result) {
                req.session.userId = user.id;
                req.session.username = user.username;
                res.json({ message: "Erfolgreich eingeloggt" });
            } else {
                res.status(400).json({ error: "Falsche PIN" });
            }
        });
    });
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));
app.get('/api/auth/status', (req, res) => res.json({ loggedIn: !!req.session.userId, username: req.session.username }));

// --- SPOTIFY ROUTES ---
app.get('/connect/spotify', isLoggedIn, (req, res) => {
    const scope = 'user-read-private user-read-email user-read-playback-state user-modify-playback-state';
    res.redirect('https://accounts.spotify.com/authorize?' + new URLSearchParams({
        response_type: 'code',
        client_id: SPOTIFY_CLIENT_ID,
        scope: scope,
        redirect_uri: SPOTIFY_REDIRECT_URI,
    }).toString());
});

app.get('/spotify/callback', isLoggedIn, async (req, res) => {
    const code = req.query.code || null;
    try {
        const response = await axios({
            method: 'post',
            url: 'https://accounts.spotify.com/api/token',
            data: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: SPOTIFY_REDIRECT_URI }),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + (Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'))
            }
        });
        const { access_token, refresh_token, expires_in } = response.data;
        const expires_at = Date.now() + expires_in * 1000;
        db.run(`UPDATE users SET spotify_access_token = ?, spotify_refresh_token = ?, spotify_token_expires = ? WHERE id = ?`, [access_token, refresh_token, expires_at, req.session.userId]);
        res.redirect('/');
    } catch (error) {
        console.error('Spotify Token Fehler:', error.response ? error.response.data : error.message);
        res.redirect('/#error=spotify_auth_failed');
    }
});

app.get('/api/spotify/player', isLoggedIn, async (req, res) => {
    db.get('SELECT spotify_access_token FROM users WHERE id = ?', [req.session.userId], async (err, user) => {
        if (!user || !user.spotify_access_token) return res.json({ connected: false });
        try {
            const response = await axios.get('https://api.spotify.com/v1/me/player', { headers: { 'Authorization': `Bearer ${user.spotify_access_token}` } });
            if (response.status === 204 || !response.data) return res.json({ connected: true, is_playing: false });
            res.json({ connected: true, ...response.data });
        } catch (error) {
            console.error("Spotify Player Fehler:", error.response ? error.response.data : error.message);
            res.status(500).json({ error: 'Spotify-Fehler' });
        }
    });
});

// --- WIDGET API ROUTES ---
app.get('/api/rss', async (req, res) => {
    const feedUrl = 'https://www.tagesschau.de/newsticker.rdf';
    try {
        const feed = await parser.parseURL(feedUrl);
        res.json(feed.items.slice(0, 5));
    } catch (error) {
        res.status(500).json({ error: 'Feed konnte nicht geladen werden.' });
    }
});

app.get('/api/weather', async (req, res) => {
    if (!OPENWEATHER_API_KEY) return res.status(500).json({ error: 'Wetterschlüssel nicht konfiguriert.' });
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=48.1374&lon=11.5755&appid=${OPENWEATHER_API_KEY}&lang=de&units=metric`;
    try {
        const weatherResponse = await axios.get(url);
        const d = weatherResponse.data;
        res.json({ city: d.name, temperature: Math.round(d.main.temp), description: d.weather[0].description, icon: d.weather[0].icon });
    } catch (error) {
        res.status(500).json({ error: 'Wetterdaten konnten nicht geladen werden.' });
    }
});

// --- URL-SHORTENER-ROUTEN ---
app.post('/api/shorten', async (req, res) => {
    const { url } = req.body;
    if (!url || !url.startsWith('http')) {
        return res.status(400).json({ error: 'Ungültige URL angegeben.' });
    }
    const shortCode = crypto.randomBytes(4).toString('hex');
    db.run('INSERT INTO urls (short_code, original_url) VALUES (?, ?)', [shortCode, url], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Fehler beim Speichern der URL.' });
        }
        res.json({ shortUrl: `https://y.wf-tech.de/${shortCode}` });
    });
});

// --- APP-KACHELN API ---
app.get('/api/apps', isLoggedIn, (req, res) => {
    const sql = "SELECT * FROM apps WHERE user_id = ?";
    db.all(sql, [req.session.userId], (err, rows) => {
        if (err) return res.status(400).json({"error": err.message});
        res.json({ "data": rows });
    });
});

app.post('/api/apps/add', isLoggedIn, (req, res) => {
    const { name, url, icon } = req.body;
    const finalIcon = (icon && icon.trim() !== '') ? icon.trim() : "fas fa-globe";
    
    const sql = 'INSERT INTO apps (name, url, icon, user_id) VALUES (?,?,?,?)';
    db.run(sql, [name, url, finalIcon, req.session.userId], function(err) {
        if (err) return res.status(400).json({"error": err.message});
        res.json({ "data": { id: this.lastID, name, url, icon: finalIcon } });
    });
});

app.delete('/api/apps/:id', isLoggedIn, (req, res) => {
    const sql = 'DELETE FROM apps WHERE id = ? AND user_id = ?';
    db.run(sql, [req.params.id, req.session.userId], function(err) {
        if (err) return res.status(400).json({"error": err.message});
        if (this.changes > 0) {
            res.json({"message": `App ${req.params.id} gelöscht`});
        } else {
            res.status(404).json({"error": "App nicht gefunden oder keine Berechtigung."});
        }
    });
});

// --- Redirect Route MUSS ALS LETZTE ROUTE STEHEN ---
app.get('/:shortCode', (req, res, next) => {
    const { shortCode } = req.params;
    if (shortCode.includes('.') || shortCode.startsWith('api')) { 
        return next();
    }
    db.get("SELECT original_url FROM urls WHERE short_code = ?", [shortCode], (err, row) => {
        if (err) return res.status(500).send('Serverfehler');
        if (row) {
            res.redirect(row.original_url);
        } else {
            next();
        }
    });
});

// --- SERVER START ---
app.listen(PORT, () => console.log(`[WF-Dashboard] Server läuft auf Port ${PORT}`));