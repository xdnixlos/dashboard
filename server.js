require('dotenv').config();
const express = require('express');
const path = require('path');
const Parser = require('rss-parser');
const axios = require('axios');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const crypto = require('crypto'); // NEU: Für zufällige Strings
const db = require('./database.js');

const app = express();
const parser = new Parser();
const PORT = 3000;

const { OPENWEATHER_API_KEY, SESSION_SECRET, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = process.env;

// Middleware (unverändert)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(cookieParser());
app.use(session({ /*...*/ }));

const isLoggedIn = (req, res, next) => { /*...*/ };

// --- AUTH & CORE ROUTES (unverändert) ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
app.post('/login', (req, res) => { /*...*/ });
app.get('/logout', (req, res) => { /*...*/ });
app.get('/api/auth/status', (req, res) => { /*...*/ });

// --- SPOTIFY ROUTES (unverändert) ---
app.get('/connect/spotify', isLoggedIn, (req, res) => { /*...*/ });
app.get('/spotify/callback', isLoggedIn, async (req, res) => { /*...*/ });
app.get('/api/spotify/player', isLoggedIn, async (req, res) => { /*...*/ });

// --- WIDGET API ROUTES (unverändert) ---
app.get('/api/rss', async (req, res) => { /*...*/ });
app.get('/api/weather', async (req, res) => { /*...*/ });


// --- NEUE URL-SHORTENER-ROUTEN ---

// Route zum Erstellen einer Kurz-URL
app.post('/api/shorten', async (req, res) => {
    const { url } = req.body;
    if (!url || !url.startsWith('http')) {
        return res.status(400).json({ error: 'Ungültige URL angegeben.' });
    }

    // Einen zufälligen, kurzen Code generieren
    const shortCode = crypto.randomBytes(4).toString('hex');

    const sql = 'INSERT INTO urls (short_code, original_url) VALUES (?, ?)';
    db.run(sql, [shortCode, url], function(err) {
        if (err) {
            console.error(err.message);
            return res.status(500).json({ error: 'Fehler beim Speichern der URL.' });
        }
        // Die vollständige Kurz-URL zurückgeben
        res.json({ shortUrl: `https://y.wf-tech.de/${shortCode}` });
    });
});

// Route zum Aufrufen und Weiterleiten einer Kurz-URL
// WICHTIG: Diese Route muss ganz am Ende stehen, vor dem Server-Start!
app.get('/:shortCode', (req, res) => {
    const { shortCode } = req.params;
    const sql = "SELECT original_url FROM urls WHERE short_code = ?";

    db.get(sql, [shortCode], (err, row) => {
        if (err) {
            return res.status(500).send('Serverfehler');
        }
        if (row) {
            // URL gefunden, weiterleiten
            res.redirect(row.original_url);
        } else {
            // Nicht gefunden, zeige einen 404-Fehler
            res.status(404).send('URL nicht gefunden');
        }
    });
});


// --- SERVER START ---
app.listen(PORT, () => console.log(`[WF-Dashboard] Server läuft auf Port ${PORT}`));
