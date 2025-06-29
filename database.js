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
        
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            spotify_access_token TEXT,
            spotify_refresh_token TEXT,
            spotify_token_expires INTEGER
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS urls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            short_code TEXT UNIQUE,
            original_url TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS apps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            icon TEXT,
            user_id INTEGER,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`);

        // NEU: Tabelle für die eine Notiz pro User
        db.run(`CREATE TABLE IF NOT EXISTS notes (
            user_id INTEGER PRIMARY KEY,
            content TEXT,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`);

        // NEU: Tabelle für die To-Do-Aufgaben
        db.run(`CREATE TABLE IF NOT EXISTS todos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task TEXT NOT NULL,
            completed BOOLEAN NOT NULL DEFAULT 0,
            user_id INTEGER,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`);

        // Ersten Admin-Benutzer anlegen (unverändert)
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
