require('dotenv').config();
const express = require('express');
const path = require('path');
const Parser = require('rss-parser');
const axios = require('axios');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
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
    secret: SESSION_SECRET || 'default_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Hilfsfunktion: Prüft, ob der Benutzer eingeloggt ist
const isLoggedIn = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        res.status(401).json({ error: 'Nicht autorisiert' });
    }
};

// --- AUTHENTIFIZIERUNGS-ROUTEN ---
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

// --- SPOTIFY-VERBINDUNGS-ROUTEN ---
app.get('/connect/spotify', isLoggedIn, (req, res) => {
    const scope = 'user-read-private user-read-email user-read-playback-state user-modify-playback-state';
    const authUrl = 'https://accounts.spotify.com/authorize?' +
        new URLSearchParams({
            response_type: 'code',
            client_id: SPOTIFY_CLIENT_ID,
            scope: scope,
            redirect_uri: SPOTIFY_REDIRECT_URI,
        }).toString();
    res.redirect(authUrl);
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

        db.run(
            `UPDATE users SET spotify_access_token = ?, spotify_refresh_token = ?, spotify_token_expires = ? WHERE id = ?`,
            [access_token, refresh_token, expires_at, req.session.userId]
        );
        res.redirect('/');
    } catch (error) {
        console.error('Spotify Token Fehler:', error.response ? error.response.data : error.message);
        res.redirect('/#error=spotify_auth_failed');
    }
});

// --- SPOTIFY-PLAYER-API ---
app.get('/api/spotify/player', isLoggedIn, async (req, res) => {
    db.get('SELECT spotify_access_token FROM users WHERE id = ?', [req.session.userId], async (err, user) => {
        if (!user || !user.spotify_access_token) {
            return res.json({ connected: false });
        }
        try {
            const response = await axios.get('https://api.spotify.com/v1/me/player', {
                headers: { 'Authorization': `Bearer ${user.spotify_access_token}` }
            });
            if (response.status === 204 || !response.data) {
                return res.json({ connected: true, is_playing: false });
            }
            res.json({ connected: true, ...response.data });
        } catch (error) {
            // Hier würde man die Token-Refresh-Logik einbauen
            console.error("Spotify Player Fehler:", error.response ? error.response.data : error.message);
            res.status(500).json({ error: 'Spotify-Fehler' });
        }
    });
});

// --- API Routen (Wetter & RSS) ---
app.get('/api/rss', async (req, res) => { /* ... bleibt gleich ... */ });
app.get('/api/weather', async (req, res) => { /* ... bleibt gleich ... */ });

// Server Start
app.listen(PORT, () => console.log(`[WF-Dashboard] Server läuft auf Port ${PORT}`));