const express = require('express');
const path = require('path');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// PostgreSQL Connection Pool für Supabase
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Database initialization
async function initDatabase() {
  try {
    console.log('🔧 Initialisiere Datenbank...');

    // Users Tabelle
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        full_name VARCHAR(200),
        role VARCHAR(20) DEFAULT 'member',
        pin VARCHAR(10),
        barcode VARCHAR(50) UNIQUE,
        balance DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        stay_active BOOLEAN DEFAULT FALSE,
        sepa_mandate BOOLEAN DEFAULT FALSE,
        iban VARCHAR(34),
        account_holder VARCHAR(200),
        mandate_reference VARCHAR(35),
        last_billing DATE
      )
    `);

    // Products Tabelle
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        category VARCHAR(50),
        barcodes TEXT[],
        member_price DECIMAL(10,2),
        guest_price DECIMAL(10,2),
        description TEXT,
        available BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        stock INTEGER DEFAULT 0,
        image VARCHAR(10) DEFAULT '📦'
      )
    `);

    // Transactions Tabelle
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        user_name VARCHAR(200),
        items JSONB,
        total DECIMAL(10,2),
        payment_method VARCHAR(20) DEFAULT 'balance',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        pos_terminal VARCHAR(50),
        receipt_number VARCHAR(20)
      )
    `);

    console.log('✅ Datenbank-Tabellen erstellt/geprüft');
    
    // Demo-Daten einfügen (nur wenn leer)
    await insertDemoData();
    
  } catch (error) {
    console.error('❌ Datenbank-Initialisierung fehlgeschlagen:', error);
    throw error;
  }
}

// Demo-Daten einfügen
async function insertDemoData() {
  try {
    // Prüfen ob bereits Daten vorhanden
    const userCheck = await pool.query('SELECT COUNT(*) FROM users');
    if (parseInt(userCheck.rows[0].count) > 0) {
      console.log('📋 Demo-Daten bereits vorhanden');
      return;
    }

    console.log('📦 Füge Demo-Daten ein...');

    // Demo-Benutzer
    await pool.query(`
      INSERT INTO users (first_name, last_name, full_name, pin, barcode, balance, role, sepa_mandate, iban, account_holder, mandate_reference) VALUES
      ('Anna', 'Schmidt', 'Anna Schmidt', '1234', 'SAAR001', -15.50, 'member', true, 'DE89370400440532013000', 'Anna Schmidt', 'SAARCADE-2025-001'),
      ('Max', 'Mustermann', 'Max Mustermann', '5678', 'SAAR002', -8.20, 'member', true, 'DE89370400440532013001', 'Max Mustermann', 'SAARCADE-2025-002'),
      ('Sarah', 'Müller', 'Sarah Müller', '9999', 'SAAR003', 5.00, 'member', false, '', '', ''),
      ('Tom', 'Wagner', 'Tom Wagner', '1111', 'SAAR004', 2.40, 'bartender', false, '', '', ''),
      ('Gast', 'Benutzer', 'Gast Benutzer', '0000', 'GUEST001', 0.00, 'guest', false, '', '', '')
    `);

    // Demo-Produkte
    await pool.query(`
      INSERT INTO products (name, category, barcodes, member_price, guest_price, description, stock, image) VALUES
      ('Augustiner Hell', 'bier', ARRAY['4000417025001'], 2.50, 3.00, 'Bayerisches Helles 0.5L', 24, '🍺'),
      ('Coca Cola', 'softdrinks', ARRAY['5000112637447'], 1.50, 2.00, 'Cola 0.33L', 48, '🥤'),
      ('Erdinger Weissbier', 'bier', ARRAY['4002103001011'], 2.80, 3.30, 'Weissbier 0.5L', 18, '🍺'),
      ('Sprite', 'softdrinks', ARRAY['4000417025500'], 1.50, 2.00, 'Zitronenlimonade 0.33L', 24, '🥤'),
      ('Jägermeister', 'schnaps', ARRAY['4000417025200'], 3.50, 4.50, 'Kräuterlikör 2cl', 8, '🥃'),
      ('Erdnüsse', 'snacks', ARRAY['4000417025300'], 2.00, 2.50, 'Gesalzene Erdnüsse', 12, '🥜'),
      ('Franziskaner Weissbier', 'bier', ARRAY['4000417025400'], 2.70, 3.20, 'Weissbier 0.5L', 16, '🍺'),
      ('Fanta', 'softdrinks', ARRAY['4000417025900'], 1.50, 2.00, 'Orangenlimonade 0.33L', 36, '🥤'),
      ('Becks', 'bier', ARRAY['4000417025800'], 2.30, 2.80, 'Pils 0.33L', 30, '🍺'),
      ('Vodka', 'schnaps', ARRAY['4000417025600'], 3.00, 4.00, 'Vodka 2cl', 12, '🥃'),
      ('Chips', 'snacks', ARRAY['4000417025700'], 1.50, 2.00, 'Kartoffelchips', 20, '🍿'),
      ('Kaffee', 'heissgetraenke', ARRAY['4008400123457'], 1.00, 1.50, 'Kaffee heiß', 50, '☕')
    `);

    console.log('✅ Demo-Daten eingefügt');
  } catch (error) {
    console.log('ℹ️ Demo-Daten bereits vorhanden oder Fehler:', error.message);
  }
}

// ============ API ROUTES ============

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Test-Route für Datenbankverbindung
app.get('/api/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as current_time, COUNT(*) as user_count FROM users');
    res.json({ 
      success: true, 
      database: 'connected',
      time: result.rows[0].current_time,
      users: result.rows[0].user_count,
      message: 'Supabase connection working!'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      code: error.code,
      detail: error.detail
    });
  }
});

// Dashboard-Statistiken
app.get('/api/dashboard', async (req, res) => {
  try {
    const users = await pool.query('SELECT COUNT(*) as total FROM users');
    const products = await pool.query('SELECT COUNT(*) as available_products FROM products WHERE available = true');
    const transactions = await pool.query(`
      SELECT 
        COUNT(*) as total_transactions,
        COALESCE(SUM(total), 0) as total_revenue
      FROM transactions 
      WHERE created_at >= NOW() - INTERVAL '30 days'
    `);
    
    res.json({
      users: { total: parseInt(users.rows[0].total) },
      products: { available_products: parseInt(products.rows[0].available_products) },
      transactions: {
        total_transactions: parseInt(transactions.rows[0].total_transactions),
        total_revenue: parseFloat(transactions.rows[0].total_revenue)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Alle Benutzer abrufen
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, first_name, last_name, full_name, role, barcode, 
        balance, sepa_mandate, created_at, last_activity
      FROM users 
      ORDER BY last_activity DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Benutzer per Barcode suchen
app.get('/api/users/:barcode', async (req, res) => {
  try {
    const { barcode } = req.params;
    const result = await pool.query(`
      SELECT 
        id, first_name, last_name, full_name, role, barcode, 
        balance, sepa_mandate, created_at, last_activity
      FROM users 
      WHERE UPPER(barcode) = UPPER($1)
    `, [barcode]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
    
    // Update last_activity
    await pool.query('UPDATE users SET last_activity = NOW() WHERE id = $1', [result.rows[0].id]);
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Alle Produkte abrufen
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, name, category, barcodes, member_price, guest_price, 
        description, available, stock, image
      FROM products 
      WHERE available = true
      ORDER BY category, name
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Transaktion erstellen
app.post('/api/transactions', async (req, res) => {
  try {
    const { userId, userName, items, total, paymentMethod = 'balance' } = req.body;
    
    // Transaktion in DB speichern
    const result = await pool.query(`
      INSERT INTO transactions (user_id, user_name, items, total, payment_method)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [userId, userName, JSON.stringify(items), total, paymentMethod]);
    
    // Benutzer-Saldo aktualisieren (bei Kontozahlung)
    if (paymentMethod === 'balance') {
      await pool.query(`
        UPDATE users 
        SET balance = balance - $1, last_activity = NOW()
        WHERE id = $2
      `, [total, userId]);
    }
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Transaktionen abrufen
app.get('/api/transactions', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, user_id, user_name, items, total, payment_method, created_at
      FROM transactions 
      ORDER BY created_at DESC 
      LIMIT 100
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Frontend Routes
app.get('/kasse', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'kasse.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Catch-all für Frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ SERVER START ============

async function startServer() {
  try {
    // Datenbank initialisieren
    await initDatabase();
    
    // Server starten
    app.listen(PORT, () => {
      console.log(`✅ Saarcade Kassensystem läuft auf Port ${PORT}`);
      console.log(`🌐 Frontend: http://localhost:${PORT}`);
      console.log(`🛒 Kasse: http://localhost:${PORT}/kasse`);
      console.log(`⚙️ Admin: http://localhost:${PORT}/admin`);
      console.log(`🗄️ Database: ${process.env.DATABASE_URL ? 'Supabase Connected' : 'Environment Variable Missing'}`);
    });
  } catch (error) {
    console.error('❌ Server-Start fehlgeschlagen:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Server wird beendet...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🛑 Server wird beendet...');
  await pool.end();
  process.exit(0);
});

// Server starten
startServer();

module.exports = app;
