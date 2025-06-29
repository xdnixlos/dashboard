const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const DBSOURCE = "db.sqlite";
const saltRounds = 10;

const db = new sqlite3.Database(DBSOURCE, (err) => {
    if (err) {
        // Kann die Datenbank nicht öffnen
        console.error(err.message);
        throw err;
    } else {
        console.log('Verbunden mit der SQLite-Datenbank.');
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT
        )`, (err) => {
            if (err) {
                // Tabelle konnte nicht erstellt werden
                console.error('Fehler beim Erstellen der Benutzertabelle:', err);
            } else {
                // Prüfen, ob bereits Benutzer existieren
                const sql = "SELECT * FROM users";
                db.all(sql, [], (err, rows) => {
                    if (rows.length === 0) {
                        // Kein Benutzer vorhanden, ersten Admin-Benutzer mit PIN erstellen
                        const firstAdminUser = 'w.fischer';
                        const firstAdminPin = '778877'; // UNBEDINGT ÄNDERN!
                        
                        bcrypt.hash(firstAdminPin, saltRounds, (err, hash) => {
                            if (err) {
                                console.error('Fehler beim Hashen der PIN:', err);
                                return;
                            }
                            const insert = 'INSERT INTO users (username, password) VALUES (?,?)';
                            db.run(insert, [firstAdminUser, hash]);
                            console.log(`=======================================================`);
                            console.log(`ERSTER BENUTZER ERSTELLT:`);
                            console.log(`Benutzername: ${firstAdminUser}`);
                            console.log(`PIN: ${firstAdminPin}`);
                            console.log(`BITTE ÄNDERN SIE DIE PIN IM CODE NACH DEM ERSTEN START!`);
                            console.log(`=======================================================`);
                        });
                    }
                });
            }
        });
    }
});

module.exports = db;
