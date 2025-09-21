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

// ============ DATENBANK-VERBINDUNG ============
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

console.log('🔌 Datenbank-Verbindung initialisiert');

// ============ DATENBANK-FUNKTIONEN ============

// Alle Benutzer abrufen
async function getUsers() {
  const result = await pool.query(`
    SELECT id, first_name, last_name, 
           CONCAT(first_name, ' ', last_name) as full_name,
           role, pin, barcode, balance, created_at, last_activity,
           stay_active, sepa_mandate, iban, account_holder, mandate_reference
    FROM users 
    ORDER BY first_name, last_name
  `);
  return result.rows;
}

// Benutzer suchen
async function searchUsers(query) {
  const result = await pool.query(`
    SELECT id, first_name, last_name,
           CONCAT(first_name, ' ', last_name) as full_name,
           role, balance, barcode
    FROM users 
    WHERE LOWER(CONCAT(first_name, ' ', last_name)) LIKE LOWER($1)
       OR LOWER(barcode) LIKE LOWER($1)
       OR LOWER(first_name) LIKE LOWER($1)
       OR LOWER(last_name) LIKE LOWER($1)
    ORDER BY first_name, last_name
    LIMIT 10
  `, [`%${query}%`]);
  
  return result.rows;
}

// Alle Produkte abrufen
async function getProducts() {
  const result = await pool.query(`
    SELECT id, name, category, member_price, guest_price, 
           description, available, created_at, stock, min_stock, image
    FROM products 
    WHERE available = true
    ORDER BY name
  `);
  return result.rows;
}

// Produkt per Barcode finden
async function getProductByBarcode(barcode) {
  const result = await pool.query(`
    SELECT id, name, category, member_price, guest_price, 
           description, available, stock, image
    FROM products 
    WHERE $1 = ANY(barcodes) AND available = true
  `, [barcode]);
  
  return result.rows[0] || null;
}

// Transaktion erstellen
async function createTransaction(transactionData) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // 1. Transaktion einfügen
    const transactionResult = await client.query(`
      INSERT INTO transactions (user_id, user_name, items, total, payment_method, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING id, created_at
    `, [
      transactionData.userId,
      transactionData.userName,
      JSON.stringify(transactionData.items),
      transactionData.total,
      transactionData.paymentMethod || 'balance'
    ]);
    
    // 2. Benutzer-Balance aktualisieren
    await client.query(`
      UPDATE users 
      SET balance = balance - $1, last_activity = NOW()
      WHERE id = $2
    `, [transactionData.total, transactionData.userId]);
    
    // 3. Produkt-Bestände aktualisieren
    for (const item of transactionData.items) {
      await client.query(`
        UPDATE products 
        SET stock = stock - $1
        WHERE id = $2 AND stock >= $1
      `, [item.quantity, item.productId]);
    }
    
    await client.query('COMMIT');
    
    return {
      id: transactionResult.rows[0].id,
      created_at: transactionResult.rows[0].created_at,
      ...transactionData
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Dashboard-Statistiken
async function getDashboardStats() {
  const stats = await pool.query(`
    SELECT 
      (SELECT COUNT(*) FROM users) as total_users,
      (SELECT COUNT(*) FROM products WHERE available = true) as total_products,
      (SELECT COUNT(*) FROM transactions) as total_transactions,
      (SELECT COALESCE(SUM(total), 0) FROM transactions 
       WHERE created_at >= NOW() - INTERVAL '30 days') as total_sales
  `);
  
  // Letzte Transaktionen
  const recentTransactions = await pool.query(`
    SELECT t.id, t.user_name, t.total, t.payment_method, t.created_at,
           t.items
    FROM transactions t
    ORDER BY t.created_at DESC
    LIMIT 5
  `);
  
  // Niedrige Bestände
  const lowStockProducts = await pool.query(`
    SELECT id, name, stock, min_stock, image
    FROM products
    WHERE stock <= min_stock AND available = true
    ORDER BY stock
  `);
  
  return {
    ...stats.rows[0],
    recent_transactions: recentTransactions.rows,
    low_stock_products: lowStockProducts.rows
  };
}

// SEPA-Export-Daten
async function getSepaData() {
  const result = await pool.query(`
    SELECT id, first_name, last_name,
           CONCAT(first_name, ' ', last_name) as full_name,
           balance, iban, account_holder, mandate_reference
    FROM users 
    WHERE sepa_mandate = true AND balance < 0
    ORDER BY first_name, last_name
  `);
  
  const sepaUsers = result.rows;
  const totalAmount = sepaUsers.reduce((sum, user) => sum + Math.abs(parseFloat(user.balance)), 0);
  
  return {
    sepa_users: sepaUsers,
    total_amount: totalAmount,
    export_date: new Date().toISOString()
  };
}

// Alle Transaktionen abrufen
async function getTransactions(limit = 100) {
  const result = await pool.query(`
    SELECT t.id, t.user_id, t.user_name, t.items, t.total, 
           t.payment_method, t.created_at
    FROM transactions t
    ORDER BY t.created_at DESC
    LIMIT $1
  `, [limit]);
  
  return result.rows;
}

// ============ API-ENDPUNKTE ============

// Health Check
app.get('/api/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as current_time, 1 as test');
    
    res.json({ 
      success: true, 
      message: 'Datenbankverbindung funktioniert!',
      current_time: result.rows[0].current_time,
      test_value: result.rows[0].test
    });
    
  } catch (error) {
    console.error('Datenbankfehler:', error);
    
    res.status(500).json({ 
      success: false, 
      error: error.message,
      code: error.code
    });
  }
});

// Dashboard
app.get('/api/dashboard', async (req, res) => {
  try {
    const stats = await getDashboardStats();
    res.json(stats);
  } catch (error) {
    console.error('Dashboard-Fehler:', error);
    res.status(500).json({ error: error.message });
  }
});

// Benutzer
app.get('/api/users', async (req, res) => {
  try {
    const users = await getUsers();
    res.json(users);
  } catch (error) {
    console.error('Benutzer-Fehler:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users/search/:query', async (req, res) => {
  try {
    const users = await searchUsers(req.params.query);
    res.json(users);
  } catch (error) {
    console.error('Suche-Fehler:', error);
    res.status(500).json({ error: error.message });
  }
});

// Produkte
app.get('/api/products', async (req, res) => {
  try {
    const products = await getProducts();
    res.json(products);
  } catch (error) {
    console.error('Produkte-Fehler:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/products/barcode/:barcode', async (req, res) => {
  try {
    const product = await getProductByBarcode(req.params.barcode);
    if (product) {
      res.json(product);
    } else {
      res.status(404).json({ error: 'Produkt nicht gefunden' });
    }
  } catch (error) {
    console.error('Barcode-Suche-Fehler:', error);
    res.status(500).json({ error: error.message });
  }
});

// Transaktionen
app.post('/api/transactions', async (req, res) => {
  try {
    const transaction = await createTransaction(req.body);
    res.json(transaction);
  } catch (error) {
    console.error('Transaktions-Fehler:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/transactions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const transactions = await getTransactions(limit);
    res.json(transactions);
  } catch (error) {
    console.error('Transaktions-Liste-Fehler:', error);
    res.status(500).json({ error: error.message });
  }
});

// SEPA-Export
app.get('/api/sepa-export', async (req, res) => {
  try {
    const sepaData = await getSepaData();
    res.json(sepaData);
  } catch (error) {
    console.error('SEPA-Export-Fehler:', error);
    res.status(500).json({ error: error.message });
  }
});

// Backup erstellen
app.get('/api/backup', async (req, res) => {
  try {
    const [users, products, transactions] = await Promise.all([
      getUsers(),
      getProducts(),
      getTransactions(1000)
    ]);

    const backup = {
      timestamp: new Date().toISOString(),
      version: '1.0',
      users: users,
      products: products,
      transactions: transactions
    };

    res.json(backup);
  } catch (error) {
    console.error('Backup-Fehler:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ FRONTEND-ROUTEN ============

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/kasse', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'kasse.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Catch-all für SPA
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'API endpoint not found' });
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// ============ SERVER STARTEN ============
app.listen(PORT, () => {
  console.log(`🎮 Saarcade Kassensystem läuft auf Port ${PORT}`);
  console.log(`🌐 Kasse: http://localhost:${PORT}/kasse`);
  console.log(`⚙️ Admin: http://localhost:${PORT}/admin`);
  console.log(`🔍 Test: http://localhost:${PORT}/api/test-db`);
});

module.exports = app;
