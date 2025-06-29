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

const { OPENWEATHER_API_KEY, SESSION_SECRET } = process.env;

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
    secret: SESSION_SECRET || 'default_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Hauptroute
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// --- BENUTZER-LOGIN MIT PIN ---
app.post('/login', (req, res) => {
    const { username, pin } = req.body; // Geändert von password zu pin
    const sql = "SELECT * FROM users WHERE username = ?";
    
    db.get(sql, [username], (err, user) => {
        if (err || !user) {
            return res.status(400).json({ "error": "Benutzer nicht gefunden" });
        }
        bcrypt.compare(pin, user.password, (err, result) => { // Geändert von password zu pin
            if (result) {
                req.session.userId = user.id;
                req.session.username = user.username;
                res.json({ "message": "Erfolgreich eingeloggt" });
            } else {
                res.status(400).json({ "error": "Falsche PIN" }); // Geänderte Fehlermeldung
            }
        });
    });
});

// Logout-Route
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// Auth Status Route
app.get('/api/auth/status', (req, res) => {
    if (req.session.userId) {
        res.json({ loggedIn: true, username: req.session.username });
    } else {
        res.json({ loggedIn: false });
    }
});

// Bestehende API Routen
app.get('/api/rss', async (req, res) => {
    const feedUrl = 'https://www.tagesschau.de/newsticker.rdf';
    try {
        const feed = await parser.parseURL(feedUrl);
        res.json(feed.items.slice(0, 5));
    } catch (error) {
        console.error('Fehler beim Abrufen des RSS-Feeds:', error);
        res.status(500).json({ error: 'Feed konnte nicht geladen werden.' });
    }
});

app.get('/api/weather', async (req, res) => {
    if (!OPENWEATHER_API_KEY) {
        return res.status(500).json({ error: 'Wetterschlüssel nicht konfiguriert.' });
    }
    const lat = 48.1374; 
    const lon = 11.5755;
    const lang = 'de';
    const units = 'metric';
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&lang=${lang}&units=${units}`;
    try {
        const weatherResponse = await axios.get(url);
        const weatherData = weatherResponse.data;
        const relevantData = {
            city: weatherData.name,
            temperature: Math.round(weatherData.main.temp),
            description: weatherData.weather[0].description,
            icon: weatherData.weather[0].icon
        };
        res.json(relevantData);
    } catch (error) {
        console.error('Fehler beim Abrufen der Wetterdaten:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Wetterdaten konnten nicht geladen werden.' });
    }
});

// Server Start
app.listen(PORT, () => {
    console.log(`[WF-Dashboard] Server läuft auf Port ${PORT}`);
});
