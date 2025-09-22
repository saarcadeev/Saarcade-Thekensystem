const express = require('express');
const app = express();

// Middleware
app.use(express.json());

// Test-Route
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    message: 'Minimal server working'
  });
});

app.get('/api/test', (req, res) => {
  res.json({ 
    success: true,
    message: 'API working',
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('*', (req, res) => {
  res.json({ 
    message: 'Saarcade Kassensystem - Server läuft',
    path: req.path,
    timestamp: new Date().toISOString()
  });
});

module.exports = app;
