require('dotenv').config();
const express = require('express');
const path = require('path');
const Parser = require('rss-parser');
const axios = require('axios');
const session = require('express-session');
const cookieParser = require('cookie-parser');

const app = express();
const parser = new Parser();
const PORT = 3000;

// Umgebungsvariablen laden
const { OPENWEATHER_API_KEY, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SESSION_SECRET } = process.env;
const SPOTIFY_REDIRECT_URI = 'https://y.wf-tech.de/spotify/callback';

// --- Middleware ---
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());
app.use(session({
    secret: SESSION_SECRET || 'default_secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Für dev. In prod hinter NGINX mit `secure: true`
}));

// --- Hauptroute ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// --- Spotify Login-Route ---
app.get('/login/spotify', (req, res) => {
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

// --- Spotify Callback-Route ---
app.get('/spotify/callback', async (req, res) => {
    const code = req.query.code || null;
    if (!code) {
        return res.redirect('/#error=access_denied');
    }

    try {
        const response = await axios({
            method: 'post',
            url: 'https://accounts.spotify.com/api/token',
            data: new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: SPOTIFY_REDIRECT_URI
            }).toString(),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + (Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64'))
            }
        });
        
        req.session.accessToken = response.data.access_token;
        req.session.refreshToken = response.data.refresh_token;
        
        res.redirect('/');

    } catch (error) {
        console.error('Error getting Spotify token:', error.response ? error.response.data : error.message);
        res.redirect('/#error=auth_failed');
    }
});

// --- Logout-Route ---
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});


// --- Bestehende API Routen (Wetter & RSS) ---
app.get('/api/rss', async (req, res) => {
    const feedUrl = 'https://feeds.feedburner.com/ServeTheHome'; 
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


// --- Server Start ---
app.listen(PORT, () => {
    console.log(`[WF-Dashboard] Server läuft auf Port ${PORT}`);
});