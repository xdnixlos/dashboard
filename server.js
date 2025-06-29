// Importiert die notwendigen Module
const express = require('express');
const path = require('path');

// Initialisiert die Express-Anwendung
const app = express();
// Definiert den Port, auf dem der Server laufen wird.
const PORT = 3000;

// --- Middleware ---
// Liefert statische Dateien aus dem 'public'-Ordner aus
app.use(express.static(path.join(__dirname, 'public')));

// --- Routen ---
// Hauptroute, die die index.html-Datei ausliefert
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// --- Server Start ---
// Startet den Server und lauscht auf dem definierten Port
app.listen(PORT, () => {
    console.log(`[WF-Dashboard] Server läuft auf Port ${PORT}`);
    console.log(`[WF-Dashboard] Erreichbar im LXC unter http://localhost:${PORT}`);
    console.log(`[WF-Dashboard] Aufruf via NGINX Reverse Proxy auf http://192.168.55.115:${PORT}`);
});
