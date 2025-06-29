// NEU: dotenv laden, um .env-Datei zu lesen. Muss ganz am Anfang stehen.
require('dotenv').config(); 

const express = require('express');
const path = require('path');
const Parser = require('rss-parser');

const app = express();
const parser = new Parser();
const PORT = 3000;

// API-Schlüssel aus der .env-Datei lesen
const weatherApiKey = process.env.OPENWEATHER_API_KEY;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

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

// NEUE API-ROUTE FÜR DAS WETTER
app.get('/api/weather', async (req, res) => {
    // Überprüfen, ob der API-Schlüssel geladen wurde
    if (!weatherApiKey) {
        return res.status(500).json({ error: 'Wetterschlüssel nicht konfiguriert.' });
    }

    // Koordinaten für München (später anpassbar)
    const lat = 48.1374; 
    const lon = 11.5755;
    const lang = 'de';
    const units = 'metric';
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${weatherApiKey}&lang=${lang}&units=${units}`;

    try {
        const weatherResponse = await fetch(url);
        if (!weatherResponse.ok) {
            // Wirft einen Fehler, wenn die API einen Fehler zurückgibt (z.B. falscher Key)
            throw new Error(`OpenWeatherMap API Fehler: ${weatherResponse.statusText}`);
        }
        const weatherData = await weatherResponse.json();
        
        // Wir senden nur die Daten, die wir wirklich brauchen, an das Frontend
        const relevantData = {
            city: weatherData.name,
            temperature: Math.round(weatherData.main.temp), // Temperatur runden
            description: weatherData.weather[0].description,
            icon: weatherData.weather[0].icon
        };
        res.json(relevantData);

    } catch (error) {
        console.error('Fehler beim Abrufen der Wetterdaten:', error);
        res.status(500).json({ error: 'Wetterdaten konnten nicht geladen werden.' });
    }
});

app.listen(PORT, () => {
    console.log(`[WF-Dashboard] Server läuft auf Port ${PORT}`);
});
