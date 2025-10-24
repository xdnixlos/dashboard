const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const dbPath = path.resolve(__dirname, 'db.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Fehler beim Verbinden mit der SQLite-Datenbank', err.message);
    } else {
        console.log('Verbunden mit der SQLite-Datenbank.');
        initDb(); // Initialisiere die DB-Struktur nach erfolgreicher Verbindung
    }
});

// Funktion zum Initialisieren der Datenbankstruktur
function initDb() {
    db.serialize(() => {
        // Tabelle für Benutzer (mit PIN statt Passwort)
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            pin_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) console.error("Fehler beim Erstellen der users-Tabelle:", err.message);
        });

        // Tabelle für Short URLs
        db.run(`CREATE TABLE IF NOT EXISTS short_urls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            original_url TEXT NOT NULL,
            short_code TEXT UNIQUE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
             if (err) console.error("Fehler beim Erstellen der short_urls-Tabelle:", err.message);
        });

        // Tabelle für benutzerdefinierte App-Kacheln
        db.run(`CREATE TABLE IF NOT EXISTS user_apps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            icon TEXT, -- Font Awesome Klasse (Fallback)
            icon_url TEXT, -- NEU: Für Bild-URLs
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`, (err) => {
            if (err) console.error("Fehler beim Erstellen/Ändern der user_apps-Tabelle:", err.message);
        });

         // Tabelle für Notizen
        db.run(`CREATE TABLE IF NOT EXISTS user_notes (
            user_id INTEGER PRIMARY KEY,
            content TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`, (err) => {
            if (err) console.error("Fehler beim Erstellen der user_notes-Tabelle:", err.message);
        });

         // Tabelle für To-Dos
        db.run(`CREATE TABLE IF NOT EXISTS user_todos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            task TEXT NOT NULL,
            completed INTEGER DEFAULT 0, -- 0 for false, 1 for true
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`, (err) => {
             if (err) console.error("Fehler beim Erstellen der user_todos-Tabelle:", err.message);
        });


        // Standardbenutzer hinzufügen, falls noch keiner existiert
        const defaultUsername = 'admin';
        const defaultPin = '1234'; // Nur als Beispiel, in Produktion unbedingt ändern!

        db.get('SELECT * FROM users WHERE username = ?', [defaultUsername], async (err, row) => {
            if (err) {
                 console.error("Fehler beim Prüfen des Standardbenutzers:", err.message);
                 return;
            }
            if (!row) {
                try {
                    const saltRounds = 10;
                    const hash = await bcrypt.hash(defaultPin, saltRounds);
                    db.run('INSERT INTO users (username, pin_hash) VALUES (?, ?)', [defaultUsername, hash], (insertErr) => {
                        if (insertErr) {
                            console.error("Fehler beim Erstellen des Standardbenutzers:", insertErr.message);
                        } else {
                            console.log(`ERSTER BENUTZER ERSTELLT: ${defaultUsername} / ${defaultPin} (PIN bitte ändern!)`);
                        }
                    });
                } catch (hashError) {
                     console.error("Fehler beim Hashen der PIN:", hashError);
                }
            }
        });
    });
}

// Exportiere die Datenbankverbindung und die Initialisierungsfunktion
module.exports = { db, initDb };
