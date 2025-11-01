const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const dbPath = path.join(__dirname, 'db.sqlite');
let db = null; // Singleton-Instanz der Datenbank

/**
 * Stellt eine Verbindung zur SQLite-Datenbank her (oder gibt die bestehende zurück).
 */
function connectDb() {
    if (db) return db; // Bestehende Verbindung wiederverwenden

    db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            console.error('Fehler beim Verbinden mit der SQLite-Datenbank:', err.message);
            throw err;
        }
        console.log('Verbunden mit der SQLite-Datenbank.');
        initDb(); // Datenbank initialisieren
    });
    return db;
}

/**
 * Gibt die Singleton-Datenbankinstanz zurück.
 */
function getDb() {
    if (!db) {
        return connectDb();
    }
    return db;
}

// Asynchrone Hilfsfunktionen für die Datenbank
function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) {
                console.error('DB run error:', err.message, 'SQL:', sql, 'Params:', params);
                return reject(err);
            }
            resolve(this);
        });
    });
}
function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                console.error('DB get error:', err.message, 'SQL:', sql, 'Params:', params);
                return reject(err);
            }
            resolve(row);
        });
    });
}

/**
 * Initialisiert die Datenbankstruktur. Erstellt alle notwendigen Tabellen
 * und fügt Standard-Benutzer/Sektionen hinzu, falls die DB neu ist.
 */
function initDb() {
    const db = getDb();

    db.serialize(() => {
        // Tabelle für Benutzer (mit 'password_hash' statt 'pin_hash')
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL
        )`);

        // Tabelle für Sektionen (z.B. "Selfhosted", "Tools")
        db.run(`CREATE TABLE IF NOT EXISTS sections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            UNIQUE(user_id, name),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        // Tabelle für Apps/Kacheln (mit Verweis auf Sektionen)
        db.run(`CREATE TABLE IF NOT EXISTS user_apps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            section_id INTEGER,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            icon_url TEXT,
            is_public INTEGER NOT NULL DEFAULT 0, -- 0 = privat, 1 = öffentlich
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE SET NULL
        )`);

        // Tabelle für Notizen
        db.run(`CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            content TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        // Tabelle für To-Dos
        db.run(`CREATE TABLE IF NOT EXISTS todos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            task TEXT NOT NULL,
            completed INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        // Tabelle für Short-URLs
        db.run(`CREATE TABLE IF NOT EXISTS short_urls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            short_code TEXT NOT NULL UNIQUE,
            original_url TEXT NOT NULL
        )`);
        
        // Stellt sicher, dass Foreign Keys aktiviert sind
        db.run('PRAGMA foreign_keys = ON');

        // --- Standardbenutzer und Sektionen erstellen ---
        
        // Definiere hier deine Standardbenutzer
        const defaultUsers = [
            { username: 'w.fischer', password: 'DeinSicheresPasswort1' },
            { username: 'jj.tech', password: 'EinAnderesSicheresPasswort2' }
            // Füge hier bei Bedarf weitere Benutzer hinzu
        ];

        // Überprüfe nur, ob der ERSTE Benutzer existiert, um die Initialisierung auszuführen
        db.get('SELECT id FROM users WHERE username = ?', [defaultUsers[0].username], async (err, row) => {
            if (err) {
                console.error("Fehler beim Suchen des Standardbenutzers:", err.message);
                return;
            }
            
            // Wenn der erste Benutzer nicht existiert, gehe davon aus, dass die DB leer ist
            if (!row) {
                console.log('Erstelle Standardbenutzer und Sektionen...');
                
                for (const user of defaultUsers) {
                    try {
                        const hash = await bcrypt.hash(user.password, 10);
                        // Führe das Einfügen des Benutzers aus und warte auf die ID
                        db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [user.username, hash], function (insertErr) {
                            if (insertErr) {
                                if (!insertErr.message.includes('UNIQUE constraint failed')) {
                                    console.error(`Fehler beim Erstellen von Benutzer ${user.username}:`, insertErr.message);
                                }
                            } else {
                                const userId = this.lastID;
                                // Standard-Sektionen & Notizen für JEDEN neuen Benutzer erstellen
                                db.run('INSERT INTO sections (user_id, name) VALUES (?, ?)', [userId, 'Selfhosted']);
                                db.run('INSERT INTO sections (user_id, name) VALUES (?, ?)', [userId, 'Tools']);
                                db.run('INSERT INTO notes (user_id, content) VALUES (?, ?)', [userId, '']);
                                console.log(`STANDARD BENUTZER ERSTELLT: ${user.username}`);
                            }
                        });
                    } catch (hashErr) {
                        console.error(`Fehler beim Hashen des Passworts für ${user.username}:`, hashErr);
                    }
                }
            }
        });
    });
}

/**
 * Schließt die Datenbankverbindung sicher.
 */
function closeDb() {
    if (db) {
        db.close((err) => {
            if (err) {
                console.error(err.message);
            }
            console.log('Datenbankverbindung geschlossen.');
            db = null;
        });
    }
}

module.exports = { initDb, getDb, closeDb };
