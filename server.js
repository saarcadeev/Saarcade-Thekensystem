const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Einfache Health Check ohne Datenbank
app.get('/api/test-db', async (req, res) => {
  try {
    const dbUrl = process.env.DATABASE_URL;
    
    // Zeige Details ohne Passwort
    if (!dbUrl) {
      return res.json({ success: false, error: 'DATABASE_URL missing' });
    }
    
    // URL-Teile analysieren
    const urlParts = {
      starts_with_postgresql: dbUrl.startsWith('postgresql://'),
      length: dbUrl.length,
      has_at_symbol: dbUrl.includes('@'),
      has_colon_after_at: dbUrl.split('@')[1]?.includes(':'),
      preview: dbUrl.substring(0, 50) + '...'
    };
    
    res.json({ 
      success: false, 
      analysis: urlParts,
      error: 'Analysis only - no connection attempt'
    });
    
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Test-Route für Datenbankverbindung
app.get('/api/test-db', async (req, res) => {
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    const result = await pool.query('SELECT NOW()');
    res.json({ success: true, time: result.rows[0] });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Frontend ausliefern
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;
