const { Pool } = require('pg');

// Supabase Postgres Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Tabellen erstellen beim ersten Start
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
      ('Anna', 'Schmidt', 'Anna Schmidt', '1234', 'USER001', -15.50, 'member', true, 'DE89370400440532013000', 'Anna Schmidt', 'SAARCADE-2025-001'),
      ('Max', 'Mustermann', 'Max Mustermann', '5678', 'USER002', -8.20, 'member', true, 'DE89370400440532013001', 'Max Mustermann', 'SAARCADE-2025-002'),
      ('Sarah', 'Müller', 'Sarah Müller', '9999', 'USER003', 5.00, 'member', false, '', '', ''),
      ('Admin', 'User', 'Admin User', '0000', 'ADMIN001', 0, 'admin', false, '', '', '')
    `);

    // Demo-Produkte
    await pool.query(`
      INSERT INTO products (name, category, barcodes, member_price, guest_price, description, stock, image) VALUES
      ('Augustiner Hell', 'bier', ARRAY['4000417025000', '4000417025001'], 2.50, 3.00, 'Bayerisches Helles 0.5L', 24, '🍺'),
      ('Coca Cola', 'softdrinks', ARRAY['5000112637447', '4000417025101'], 1.50, 2.00, 'Cola 0.33L', 48, '🥤'),
      ('Erdinger Weissbier', 'bier', ARRAY['4002103001011', '4002103001012'], 2.80, 3.30, 'Weissbier 0.5L', 18, '🍺'),
      ('Spezi', 'softdrinks', ARRAY['4000417025100'], 1.80, 2.20, 'Cola-Mix 0.33L', 36, '🥤'),
      ('Jägermeister', 'schnaps', ARRAY['4000417025200'], 3.50, 4.50, 'Kräuterlikör 2cl', 8, '🥃'),
      ('Erdnüsse', 'snacks', ARRAY['4000417025300'], 2.00, 2.50, 'Gesalzene Erdnüsse', 12, '🥜'),
      ('Franziskaner Weissbier', 'bier', ARRAY['4000417025400'], 2.70, 3.20, 'Weissbier 0.5L', 16, '🍺'),
      ('Sprite', 'softdrinks', ARRAY['4000417025500'], 1.50, 2.00, 'Zitronenlimonade 0.33L', 24, '🥤'),
      ('Becks', 'bier', ARRAY['4000417025800'], 2.30, 2.80, 'Pils 0.33L', 30, '🍺'),
      ('Fanta', 'softdrinks', ARRAY['4000417025900'], 1.50, 2.00, 'Orangenlimonade 0.33L', 36, '🥤'),
      ('Vodka', 'schnaps', ARRAY['4000417025600'], 3.00, 4.00, 'Vodka 2cl', 12, '🥃'),
      ('Chips', 'snacks', ARRAY['4000417025700'], 1.50, 2.00, 'Kartoffelchips', 20, '🍿')
    `);

    console.log('✅ Demo-Daten eingefügt');
  } catch (error) {
    console.log('ℹ️  Demo-Daten bereits vorhanden oder Fehler:', error.message);
  }
}

module.exports = { pool, initDatabase };
