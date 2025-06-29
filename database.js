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
        
        // Users-Tabelle (unverändert)
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            spotify_access_token TEXT,
            spotify_refresh_token TEXT,
            spotify_token_expires INTEGER
        )`);

        // Urls-Tabelle (unverändert)
        db.run(`CREATE TABLE IF NOT EXISTS urls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            short_code TEXT UNIQUE,
            original_url TEXT
        )`);

        // NEU: Tabelle für die App-Kacheln
        db.run(`CREATE TABLE IF NOT EXISTS apps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            icon TEXT,
            user_id INTEGER,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`, (err) => {
            if (err) {
                console.error('Fehler beim Erstellen der Apps-Tabelle:', err);
            }
        });

        // Ersten Admin-Benutzer anlegen, falls noch keiner existiert
        db.get("SELECT * FROM users", [], (err, row) => {
            if (!row) {
                const firstAdminUser = 'admin';
                const firstAdminPin = '1234'; // UNBEDINGT ÄNDERN!
                bcrypt.hash(firstAdminPin, saltRounds, (err, hash) => {
                    db.run('INSERT INTO users (username, password) VALUES (?,?)', [firstAdminUser, hash]);
                    console.log(`ERSTER BENUTZER ERSTELLT: admin / ${firstAdminPin}`);
                });
            }
        });
    }
});

module.exports = db;
