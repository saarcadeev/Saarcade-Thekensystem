// server.js - Vercel-optimierte Version
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// SQLite-Datenbank für Vercel anpassen
const isVercel = process.env.VERCEL || process.env.NODE_ENV === 'production';
const dbPath = isVercel ? '/tmp/saarcade.db' : './saarcade_demo.db';

// In-Memory-Datenbank für Vercel als Fallback
let db;

function initializeDatabase() {
  if (isVercel) {
    // Für Vercel: In-Memory-Datenbank mit vordefinierten Daten
    db = new sqlite3.Database(':memory:');
    
    // Demo-Daten für Vercel laden
    const initSQL = `
      -- Benutzer Tabelle
      CREATE TABLE users (
        barcode TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        balance REAL DEFAULT 0,
        sepa_mandate INTEGER DEFAULT 0,
        auto_logout INTEGER DEFAULT 1
      );
      
      -- Produkte Tabelle  
      CREATE TABLE products (
        barcode TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        price_member REAL NOT NULL,
        price_guest REAL NOT NULL,
        stock INTEGER DEFAULT 0,
        category TEXT DEFAULT 'Getränke'
      );
      
      -- Transaktionen Tabelle
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_barcode TEXT,
        product_barcode TEXT,
        quantity INTEGER,
        amount REAL,
        payment_method TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Demo-Benutzer einfügen
      INSERT INTO users VALUES
      ('SAAR001', 'Max Mustermann', 'member', -15.50, 1, 1),
      ('SAAR002', 'Anna Schmidt', 'member', -8.20, 0, 1),
      ('SAAR003', 'Tom Wagner', 'barkeeper', 2.40, 0, 0),
      ('GUEST001', 'Gast Benutzer', 'guest', 0.00, 0, 1);
      
      -- Demo-Produkte einfügen
      INSERT INTO products VALUES
      ('4000417025001', 'Augustiner Helles', 2.50, 3.00, 24, 'Bier'),
      ('5000112637447', 'Coca Cola', 1.50, 2.00, 18, 'Softdrinks'),
      ('4002103001011', 'Erdinger Weissbier', 2.80, 3.30, 12, 'Bier'),
      ('4000417025200', 'Jägermeister', 3.50, 4.50, 6, 'Spirituosen');
    `;
    
    db.exec(initSQL, (err) => {
      if (err) {
        console.error('Fehler beim Initialisieren der Datenbank:', err);
      } else {
        console.log('✅ In-Memory-Datenbank für Vercel initialisiert');
      }
    });
  } else {
    // Lokale SQLite-Datei für Entwicklung
    db = new sqlite3.Database(dbPath);
  }
}

// Datenbank initialisieren
initializeDatabase();

// Health Check für Vercel
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: isVercel ? 'vercel' : 'local',
    database: isVercel ? 'memory' : 'sqlite'
  });
});

// API Routes
app.get('/api/users', (req, res) => {
  db.all('SELECT * FROM users', (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.get('/api/users/:barcode', (req, res) => {
  const { barcode } = req.params;
  db.get('SELECT * FROM users WHERE barcode = ?', [barcode], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else if (row) {
      res.json(row);
    } else {
      res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
  });
});

app.get('/api/products', (req, res) => {
  db.all('SELECT * FROM products', (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.get('/api/products/:barcode', (req, res) => {
  const { barcode } = req.params;
  db.get('SELECT * FROM products WHERE barcode = ?', [barcode], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else if (row) {
      res.json(row);
    } else {
      res.status(404).json({ error: 'Produkt nicht gefunden' });
    }
  });
});

app.post('/api/transactions', (req, res) => {
  const { user_barcode, product_barcode, quantity, payment_method } = req.body;
  
  // Produktpreis ermitteln
  db.get('SELECT * FROM products WHERE barcode = ?', [product_barcode], (err, product) => {
    if (err || !product) {
      return res.status(404).json({ error: 'Produkt nicht gefunden' });
    }
    
    // Benutzer ermitteln für Preisberechnung
    db.get('SELECT * FROM users WHERE barcode = ?', [user_barcode], (err, user) => {
      if (err || !user) {
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
      }
      
      const price = user.role === 'guest' ? product.price_guest : product.price_member;
      const amount = price * quantity;
      
      // Transaktion einfügen
      db.run(
        'INSERT INTO transactions (user_barcode, product_barcode, quantity, amount, payment_method) VALUES (?, ?, ?, ?, ?)',
        [user_barcode, product_barcode, quantity, amount, payment_method],
        function(err) {
          if (err) {
            res.status(500).json({ error: err.message });
          } else {
            // Benutzersaldo aktualisieren (nur bei Account-Zahlung)
            if (payment_method === 'account') {
              db.run(
                'UPDATE users SET balance = balance - ? WHERE barcode = ?',
                [amount, user_barcode],
                (err) => {
                  if (err) {
                    console.error('Fehler beim Aktualisieren des Saldos:', err);
                  }
                }
              );
            }
            
            res.json({ 
              id: this.lastID, 
              amount: amount,
              message: 'Transaktion erfolgreich' 
            });
          }
        }
      );
    });
  });
});

app.get('/api/dashboard', (req, res) => {
  // Dashboard-Statistiken
  Promise.all([
    new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    }),
    new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM products', (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    }),
    new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE date(timestamp) = date("now")', (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    }),
    new Promise((resolve, reject) => {
      db.get('SELECT SUM(amount) as total FROM transactions WHERE date(timestamp) = date("now")', (err, row) => {
        if (err) reject(err);
        else resolve(row.total || 0);
      });
    })
  ]).then(([userCount, productCount, transactionCount, dailyRevenue]) => {
    res.json({
      users: userCount,
      products: productCount,
      transactions_today: transactionCount,
      revenue_today: dailyRevenue.toFixed(2)
    });
  }).catch(err => {
    res.status(500).json({ error: err.message });
  });
});

// Catch-all für SPA-Routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Export für Vercel
module.exports = app;

// Lokaler Server starten (nur wenn nicht auf Vercel)
if (!isVercel) {
  app.listen(PORT, () => {
    console.log(`🎮 Saarcade Kassensystem läuft auf http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/admin`);
    console.log(`💰 Kasse: http://localhost:${PORT}/kasse`);
  });
}
