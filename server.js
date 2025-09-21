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
    
    // Schritt 1: Pool erstellen ohne SSL zuerst
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: dbUrl
      // SSL erstmal weglassen
    });
    
    // Schritt 2: Einfachste Query
    const result = await pool.query('SELECT 1 as test');
    
    res.json({ 
      success: true, 
      result: result.rows[0],
      message: 'Connection working!'
    });
    
  } catch (error) {
    res.json({ 
      success: false, 
      error: error.message,
      error_code: error.code,
      stack: error.stack?.split('\n')[0] // Nur erste Zeile des Stacks
    });
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
