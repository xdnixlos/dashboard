const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const DBSOURCE = "db.sqlite";
const saltRounds = 10;

const db = new sqlite3.Database(DBSOURCE, (err) => {
    if (err) {
        console.error(err.message);
        throw err;
    } else {
        console.log('Verbunden mit der SQLite-Datenbank.');
        
        // Users-Tabelle erstellen (unverändert)
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            spotify_access_token TEXT,
            spotify_refresh_token TEXT,
            spotify_token_expires INTEGER
        )`, (err) => {
            if (err) {
                console.error('Fehler beim Erstellen der Benutzertabelle:', err);
            } else {
                // Ersten Admin-Benutzer anlegen (unverändert)
                db.get("SELECT * FROM users", [], (err, row) => {
                    if (!row) {
                        const firstAdminUser = 'admin';
                        const firstAdminPin = '1234';
                        bcrypt.hash(firstAdminPin, saltRounds, (err, hash) => {
                            db.run('INSERT INTO users (username, password) VALUES (?,?)', [firstAdminUser, hash]);
                            console.log(`ERSTER BENUTZER ERSTELLT: admin / ${firstAdminPin}`);
                        });
                    }
                });
            }
        });

        // NEU: Tabelle für die URLs erstellen
        db.run(`CREATE TABLE IF NOT EXISTS urls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            short_code TEXT UNIQUE,
            original_url TEXT
        )`, (err) => {
            if (err) {
                console.error('Fehler beim Erstellen der URL-Tabelle:', err);
            }
        });
    }
});

module.exports = db;