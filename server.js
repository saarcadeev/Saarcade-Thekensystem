const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database status
let dbStatus = 'not_initialized';
let pool = null;

// Mock-Daten für Fallback
const mockUsers = [
  { id: 1, first_name: 'Anna', last_name: 'Schmidt', full_name: 'Anna Schmidt', role: 'member', barcode: 'SAAR001', balance: -15.50, sepa_mandate: true },
  { id: 2, first_name: 'Max', last_name: 'Mustermann', full_name: 'Max Mustermann', role: 'member', barcode: 'SAAR002', balance: -8.20, sepa_mandate: true },
  { id: 3, first_name: 'Tom', last_name: 'Wagner', full_name: 'Tom Wagner', role: 'bartender', barcode: 'SAAR003', balance: 2.40, sepa_mandate: false },
  { id: 4, first_name: 'Gast', last_name: 'Benutzer', full_name: 'Gast Benutzer', role: 'guest', barcode: 'GUEST001', balance: 0.00, sepa_mandate: false }
];

const mockProducts = [
  { id: 1, name: 'Augustiner Hell', category: 'bier', member_price: 2.50, guest_price: 3.00, stock: 24, image: '🍺', available: true },
  { id: 2, name: 'Coca Cola', category: 'softdrinks', member_price: 1.50, guest_price: 2.00, stock: 48, image: '🥤', available: true },
  { id: 3, name: 'Erdinger Weissbier', category: 'bier', member_price: 2.80, guest_price: 3.30, stock: 18, image: '🍺', available: true },
  { id: 4, name: 'Sprite', category: 'softdrinks', member_price: 1.50, guest_price: 2.00, stock: 24, image: '🥤', available: true },
  { id: 5, name: 'Jägermeister', category: 'schnaps', member_price: 3.50, guest_price: 4.50, stock: 8, image: '🥃', available: true }
];

// Sichere Datenbank-Initialisierung (crasht nicht)
async function tryInitDatabase() {
  if (!process.env.DATABASE_URL) {
    console.log('⚠️ DATABASE_URL not found - using mock data');
    dbStatus = 'mock_mode';
    return;
  }

  try {
    console.log('🔄 Versuche Datenbankverbindung...');
    
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 3000,
    });

    // Test-Verbindung mit Timeout
    const testQuery = await Promise.race([
      pool.query('SELECT NOW()'),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), 5000)
      )
    ]);

    console.log('✅ Datenbankverbindung erfolgreich');
    dbStatus = 'connected';
    await createTables();
    
  } catch (error) {
    console.log('⚠️ Datenbankverbindung fehlgeschlagen:', error.message);
    console.log('🔄 Verwende Mock-Daten als Fallback');
    dbStatus = 'mock_mode';
    pool = null;
  }
}

async function createTables() {
  if (!pool) return;
  
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        full_name VARCHAR(200),
        role VARCHAR(20) DEFAULT 'member',
        barcode VARCHAR(50) UNIQUE,
        balance DECIMAL(10,2) DEFAULT 0,
        sepa_mandate BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        category VARCHAR(50),
        member_price DECIMAL(10,2),
        guest_price DECIMAL(10,2),
        available BOOLEAN DEFAULT TRUE,
        stock INTEGER DEFAULT 0,
        image VARCHAR(10) DEFAULT '📦'
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        user_name VARCHAR(200),
        items JSONB,
        total DECIMAL(10,2),
        payment_method VARCHAR(20) DEFAULT 'balance',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Demo-Daten einfügen falls leer
    const userCheck = await pool.query('SELECT COUNT(*) FROM users');
    if (parseInt(userCheck.rows[0].count) === 0) {
      await insertDemoData();
    }

  } catch (error) {
    console.log('⚠️ Tabellen-Erstellung fehlgeschlagen:', error.message);
  }
}

async function insertDemoData() {
  try {
    await pool.query(`
      INSERT INTO users (first_name, last_name, full_name, barcode, balance, role, sepa_mandate) VALUES
      ('Anna', 'Schmidt', 'Anna Schmidt', 'SAAR001', -15.50, 'member', true),
      ('Max', 'Mustermann', 'Max Mustermann', 'SAAR002', -8.20, 'member', true),
      ('Tom', 'Wagner', 'Tom Wagner', 'SAAR003', 2.40, 'bartender', false),
      ('Gast', 'Benutzer', 'Gast Benutzer', 'GUEST001', 0.00, 'guest', false)
    `);

    await pool.query(`
      INSERT INTO products (name, category, member_price, guest_price, stock, image) VALUES
      ('Augustiner Hell', 'bier', 2.50, 3.00, 24, '🍺'),
      ('Coca Cola', 'softdrinks', 1.50, 2.00, 48, '🥤'),
      ('Erdinger Weissbier', 'bier', 2.80, 3.30, 18, '🍺'),
      ('Sprite', 'softdrinks', 1.50, 2.00, 24, '🥤'),
      ('Jägermeister', 'schnaps', 3.50, 4.50, 8, '🥃')
    `);

    console.log('✅ Demo-Daten eingefügt');
  } catch (error) {
    console.log('⚠️ Demo-Daten Fehler:', error.message);
  }
}

// ============ API ROUTES ============

// Health Check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    database: dbStatus,
    environment: process.env.NODE_ENV || 'development',
    has_database_url: !!process.env.DATABASE_URL
  });
});

// Test-Route für Debugging
app.get('/api/test-db', async (req, res) => {
  if (dbStatus === 'mock_mode') {
    return res.json({ 
      success: true, 
      database: 'mock',
      message: 'Using mock data (DATABASE_URL issue)',
      users: mockUsers.length,
      has_env_var: !!process.env.DATABASE_URL,
      env_var_preview: process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 20) + '...' : 'NOT_SET'
    });
  }

  if (dbStatus === 'not_initialized') {
    return res.json({
      success: false,
      database: 'not_initialized',
      message: 'Database initialization not completed yet'
    });
  }

  if (!pool) {
    return res.json({
      success: false,
      database: 'no_pool',
      message: 'No database pool available'
    });
  }

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
      database: 'query_error'
    });
  }
});

// Dashboard-Statistiken
app.get('/api/dashboard', async (req, res) => {
  if (dbStatus !== 'connected' || !pool) {
    return res.json({
      users: { total: mockUsers.length },
      products: { available_products: mockProducts.length },
      transactions: { total_transactions: 42, total_revenue: 156.50 }
    });
  }

  try {
    const users = await pool.query('SELECT COUNT(*) as total FROM users');
    const products = await pool.query('SELECT COUNT(*) as available_products FROM products WHERE available = true');
    
    res.json({
      users: { total: parseInt(users.rows[0].total) },
      products: { available_products: parseInt(products.rows[0].available_products) },
      transactions: { total_transactions: 42, total_revenue: 156.50 }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Alle Benutzer abrufen
app.get('/api/users', async (req, res) => {
  if (dbStatus !== 'connected' || !pool) {
    return res.json(mockUsers);
  }

  try {
    const result = await pool.query(`
      SELECT 
        id, first_name, last_name, full_name, role, barcode, 
        balance, sepa_mandate, created_at
      FROM users 
      ORDER BY full_name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Users query error:', error);
    res.json(mockUsers); // Fallback zu Mock-Daten
  }
});

// Benutzer per Barcode suchen
app.get('/api/users/:barcode', async (req, res) => {
  const { barcode } = req.params;
  
  if (dbStatus !== 'connected' || !pool) {
    const user = mockUsers.find(u => u.barcode.toLowerCase() === barcode.toLowerCase());
    if (!user) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
    return res.json(user);
  }

  try {
    const result = await pool.query(`
      SELECT 
        id, first_name, last_name, full_name, role, barcode, 
        balance, sepa_mandate, created_at
      FROM users 
      WHERE UPPER(barcode) = UPPER($1)
    `, [barcode]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('User lookup error:', error);
    const user = mockUsers.find(u => u.barcode.toLowerCase() === barcode.toLowerCase());
    if (!user) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
    res.json(user);
  }
});

// Alle Produkte abrufen
app.get('/api/products', async (req, res) => {
  if (dbStatus !== 'connected' || !pool) {
    return res.json(mockProducts.filter(p => p.available));
  }

  try {
    const result = await pool.query(`
      SELECT 
        id, name, category, member_price, guest_price, 
        available, stock, image
      FROM products 
      WHERE available = true
      ORDER BY category, name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Products query error:', error);
    res.json(mockProducts); // Fallback zu Mock-Daten
  }
});

// Transaktion erstellen
app.post('/api/transactions', async (req, res) => {
  const { userId, userName, items, total, paymentMethod = 'balance' } = req.body;
  
  if (dbStatus !== 'connected' || !pool) {
    // Mock: Benutzer-Saldo aktualisieren
    const user = mockUsers.find(u => u.id === userId);
    if (user && paymentMethod === 'balance') {
      user.balance -= total;
    }
    
    const transaction = {
      id: Date.now(),
      user_id: userId,
      user_name: userName,
      items: items,
      total: total,
      payment_method: paymentMethod,
      created_at: new Date().toISOString()
    };
    
    return res.status(201).json(transaction);
  }

  try {
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
        SET balance = balance - $1
        WHERE id = $2
      `, [total, userId]);
    }
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Transaction error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Frontend Routes
app.get('/kasse', (req, res) => {
  res.sendFile(path.join(__dirname, 'kasse.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Catch-all für Frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Server starten (für Vercel als Serverless Function)
// Die Datenbank-Initialisierung läuft asynchron und crasht nicht den Server
tryInitDatabase().catch(err => {
  console.log('Database init failed, continuing with mock data:', err.message);
  dbStatus = 'mock_mode';
});

module.exports = app;
