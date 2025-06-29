// Importiert die notwendigen Module
const express = require('express');
const path = require('path');
const Parser = require('rss-parser'); // NEU: rss-parser importieren

// Initialisiert die Express-Anwendung und den Parser
const app = express();
const parser = new Parser(); // NEU: Parser-Instanz erstellen
const PORT = 3000;

// --- Middleware ---
app.use(express.static(path.join(__dirname, 'public')));

// --- Routen ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// NEUE API-ROUTE FÜR DEN RSS-FEED
app.get('/api/rss', async (req, res) => {
    // Die URL des Feeds. Später können wir dies dynamisch machen.
    const feedUrl = 'https://www.tagesschau.de/newsticker.rdf'; 
    
    try {
        // Versuche, den Feed zu parsen
        const feed = await parser.parseURL(feedUrl);
        // Sende die ersten 5 Artikel als JSON-Antwort zurück
        res.json(feed.items.slice(0, 5)); 
    } catch (error) {
        // Bei einem Fehler, logge den Fehler und sende einen Server-Fehler-Status
        console.error('Fehler beim Abrufen des RSS-Feeds:', error);
        res.status(500).json({ error: 'Feed konnte nicht geladen werden.' });
    }
});


// --- Server Start ---
app.listen(PORT, () => {
    console.log(`[WF-Dashboard] Server läuft auf Port ${PORT}`);
});