const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Mock-Daten für Test
const mockUsers = [
  { id: 1, first_name: 'Anna', last_name: 'Schmidt', full_name: 'Anna Schmidt', role: 'member', barcode: 'SAAR001', balance: -15.50 },
  { id: 2, first_name: 'Max', last_name: 'Mustermann', full_name: 'Max Mustermann', role: 'member', barcode: 'SAAR002', balance: -8.20 },
  { id: 3, first_name: 'Gast', last_name: 'Benutzer', full_name: 'Gast Benutzer', role: 'guest', barcode: 'GUEST001', balance: 0.00 }
];

const mockProducts = [
  { id: 1, name: 'Augustiner Hell', category: 'bier', member_price: 2.50, guest_price: 3.00, stock: 24, image: '🍺', available: true },
  { id: 2, name: 'Coca Cola', category: 'softdrinks', member_price: 1.50, guest_price: 2.00, stock: 48, image: '🥤', available: true },
  { id: 3, name: 'Erdinger Weissbier', category: 'bier', member_price: 2.80, guest_price: 3.30, stock: 18, image: '🍺', available: true }
];

// ============ API ROUTES ============

// Health Check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    database: 'mock-data'
  });
});

// Test-Route für Vercel
app.get('/api/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Vercel Serverless Function works!',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Dashboard-Statistiken
app.get('/api/dashboard', (req, res) => {
  res.json({
    users: { total: mockUsers.length },
    products: { available_products: mockProducts.length },
    transactions: {
      total_transactions: 42,
      total_revenue: 156.50
    }
  });
});

// Alle Benutzer abrufen
app.get('/api/users', (req, res) => {
  res.json(mockUsers);
});

// Benutzer per Barcode suchen
app.get('/api/users/:barcode', (req, res) => {
  const { barcode } = req.params;
  const user = mockUsers.find(u => u.barcode.toLowerCase() === barcode.toLowerCase());
  
  if (!user) {
    return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  }
  
  res.json(user);
});

// Alle Produkte abrufen
app.get('/api/products', (req, res) => {
  res.json(mockProducts.filter(p => p.available));
});

// Transaktion erstellen (Mock)
app.post('/api/transactions', (req, res) => {
  const { userId, userName, items, total, paymentMethod = 'balance' } = req.body;
  
  // Simulation: Benutzer-Saldo aktualisieren
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
  
  res.status(201).json(transaction);
});

// Frontend Routes
app.get('/kasse', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Catch-all für Frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Server starten (für lokale Entwicklung)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ Saarcade Kassensystem (Mock) läuft auf Port ${PORT}`);
    console.log(`🌐 Frontend: http://localhost:${PORT}`);
    console.log(`🛒 Kasse: http://localhost:${PORT}/kasse`);
    console.log(`⚙️ Admin: http://localhost:${PORT}/admin`);
  });
}

module.exports = app;
