// server.js - PostgreSQL/Supabase Version
const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

// PostgreSQL via Supabase
const { pool, initDatabase } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Datenbank beim Start initialisieren
initDatabase();

// Health Check für Vercel
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ 
      status: 'OK', 
      timestamp: result.rows[0].now,
      environment: process.env.NODE_ENV || 'development',
      database: 'supabase-postgresql'
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'ERROR', 
      error: error.message,
      database: 'supabase-postgresql'
    });
  }
});

// Dashboard-Statistiken
app.get('/api/dashboard', async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE role = 'member') as total_members,
        (SELECT COUNT(*) FROM products WHERE available = true) as total_products,
        (SELECT COALESCE(SUM(total), 0) FROM transactions WHERE DATE(created_at) = CURRENT_DATE) as today_revenue,
        (SELECT COUNT(*) FROM transactions WHERE DATE(created_at) = CURRENT_DATE) as today_transactions,
        (SELECT COUNT(*) FROM users WHERE balance < 0) as users_with_debt,
        (SELECT COALESCE(SUM(ABS(balance)), 0) FROM users WHERE balance < 0) as total_debt
    `);
    
    res.json(stats.rows[0]);
  } catch (error) {
    console.error('Dashboard-Fehler:', error);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

// Alle Benutzer abrufen
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users ORDER BY full_name');
    res.json(result.rows);
  } catch (error) {
    console.error('Fehler beim Abrufen der Benutzer:', error);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

// Benutzer per Barcode suchen
app.get('/api/users/:barcode', async (req, res) => {
  try {
    const { barcode } = req.params;
    const result = await pool.query('SELECT * FROM users WHERE barcode = $1', [barcode]);
    
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
  } catch (error) {
    console.error('Fehler bei Benutzer-Suche:', error);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

// Benutzer suchen (Name oder Barcode)
app.get('/api/users/search/:query', async (req, res) => {
  try {
    const { query } = req.params;
    const result = await pool.query(
      'SELECT * FROM users WHERE full_name ILIKE $1 OR barcode = $2 ORDER BY full_name LIMIT 10',
      [`%${query}%`, query]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Fehler bei der Benutzersuche:', error);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

// Neuen Benutzer erstellen
app.post('/api/users', async (req, res) => {
  try {
    const { firstName, lastName, pin, barcode, role = 'member' } = req.body;
    const fullName = `${firstName} ${lastName}`;
    
    const result = await pool.query(
      'INSERT INTO users (first_name, last_name, full_name, pin, barcode, role) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [firstName, lastName, fullName, pin, barcode, role]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Fehler beim Erstellen des Benutzers:', error);
    if (error.code === '23505') { // Unique constraint violation
      res.status(400).json({ error: 'Barcode bereits vergeben' });
    } else {
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  }
});

// Benutzer aktualisieren
app.put('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, pin, balance, sepaMandate, iban, accountHolder } = req.body;
    const fullName = `${firstName} ${lastName}`;
    
    const result = await pool.query(
      `UPDATE users SET 
       first_name = $1, last_name = $2, full_name = $3, pin = $4, 
       balance = $5, sepa_mandate = $6, iban = $7, account_holder = $8
       WHERE id = $9 RETURNING *`,
      [firstName, lastName, fullName, pin, balance, sepaMandate, iban, accountHolder, id]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Fehler beim Aktualisieren des Benutzers:', error);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

// Alle Produkte abrufen
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products WHERE available = true ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Fehler beim Abrufen der Produkte:', error);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

// Produkt per Barcode finden
app.get('/api/products/barcode/:barcode', async (req, res) => {
  try {
    const { barcode } = req.params;
    const result = await pool.query(
      'SELECT * FROM products WHERE $1 = ANY(barcodes) AND available = true',
      [barcode]
    );
    
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ error: 'Produkt nicht gefunden' });
    }
  } catch (error) {
    console.error('Fehler bei Barcode-Suche:', error);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

// Neues Produkt erstellen
app.post('/api/products', async (req, res) => {
  try {
    const { name, category, barcodes, memberPrice, guestPrice, description, stock, image } = req.body;
    
    const result = await pool.query(
      'INSERT INTO products (name, category, barcodes, member_price, guest_price, description, stock, image) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [name, category, barcodes, memberPrice, guestPrice, description, stock, image]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Fehler beim Erstellen des Produkts:', error);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

// Produkt aktualisieren
app.put('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, barcodes, memberPrice, guestPrice, description, stock, available } = req.body;
    
    const result = await pool.query(
      `UPDATE products SET 
       name = $1, category = $2, barcodes = $3, member_price = $4, 
       guest_price = $5, description = $6, stock = $7, available = $8
       WHERE id = $9 RETURNING *`,
      [name, category, barcodes, memberPrice, guestPrice, description, stock, available, id]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Fehler beim Aktualisieren des Produkts:', error);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

// Neue Transaktion erstellen
app.post('/api/transactions', async (req, res) => {
  try {
    const { userId, userName, items, total, paymentMethod = 'balance' } = req.body;
    
    // Transaktion erstellen
    const result = await pool.query(
      'INSERT INTO transactions (user_id, user_name, items, total, payment_method) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [userId, userName, JSON.stringify(items), total, paymentMethod]
    );
    
    // Bei Anschreibung: Benutzerguthaben aktualisieren
    if (paymentMethod === 'balance' && userId) {
      await pool.query(
        'UPDATE users SET balance = balance - $1, last_activity = CURRENT_TIMESTAMP WHERE id = $2',
        [total, userId]
      );
    }
    
    // Lagerbestand aktualisieren
    for (const item of items) {
      await pool.query(
        'UPDATE products SET stock = stock - $1 WHERE id = $2',
        [item.quantity, item.productId]
      );
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Fehler beim Erstellen der Transaktion:', error);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

// Transaktionen abrufen
app.get('/api/transactions', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const result = await pool.query(
      'SELECT * FROM transactions ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Fehler beim Abrufen der Transaktionen:', error);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

// SEPA-Export für Lastschriften
app.get('/api/sepa-export', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        full_name as name,
        iban,
        account_holder,
        mandate_reference,
        ABS(balance) as amount,
        balance
      FROM users 
      WHERE balance < 0 AND sepa_mandate = true AND iban IS NOT NULL AND iban != ''
      ORDER BY full_name
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('SEPA-Export Fehler:', error);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

// Backup-Endpunkt
app.get('/api/backup', async (req, res) => {
  try {
    const users = await pool.query('SELECT * FROM users ORDER BY id');
    const products = await pool.query('SELECT * FROM products ORDER BY id');
    const transactions = await pool.query('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 1000');
    
    const backup = {
      timestamp: new Date().toISOString(),
      version: '2.0.0',
      database: 'postgresql',
      data: {
        users: users.rows,
        products: products.rows,
        transactions: transactions.rows
      }
    };
    
    res.json(backup);
  } catch (error) {
    console.error('Backup-Fehler:', error);
    res.status(500).json({ error: 'Datenbankfehler' });
  }
});

// Catch-all für SPA-Routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Export für Vercel
module.exports = app;

// Lokaler Server starten (nur wenn nicht auf Vercel)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🎮 Saarcade Kassensystem läuft auf Port ${PORT}`);
    console.log(`💾 Datenbank: Supabase PostgreSQL`);
    console.log(`🌐 Frontend: http://localhost:${PORT}`);
    console.log(`📊 Admin: http://localhost:${PORT}/admin`);
    console.log(`💰 Kasse: http://localhost:${PORT}/kasse`);
  });
}
