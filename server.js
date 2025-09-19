// ====================================================================
// SAARCADE KASSENSYSTEM - VOLLSTÄNDIGER SERVER
// Backend für Demo und Produktiveinsatz
// ====================================================================

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;
   app.use(express.static('public'));
   app.use((req, res, next) => {
       res.setHeader('Content-Type', 'text/html; charset=utf-8');
       next();
   });

// ============ MIDDLEWARE SETUP ============
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============ DATENBANK SETUP ============
const dbPath = process.env.DATABASE_PATH || './saarcade_demo.db';
let db;

function initializeDatabase() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('❌ Datenbankfehler:', err);
                reject(err);
            } else {
                console.log('✅ SQLite Datenbank verbunden:', dbPath);
                createTables().then(resolve).catch(reject);
            }
        });
    });
}

function createTables() {
    return new Promise((resolve, reject) => {
        const schema = `
            -- Benutzer Tabelle
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                first_name TEXT NOT NULL,
                last_name TEXT NOT NULL,
                full_name TEXT NOT NULL,
                role TEXT DEFAULT 'member',
                barcode TEXT UNIQUE NOT NULL,
                balance DECIMAL(10,2) DEFAULT 0.00,
                sepa_mandate BOOLEAN DEFAULT 0,
                iban TEXT,
                account_holder TEXT,
                stay_active BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_activity DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            -- Produkte Tabelle
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                category TEXT DEFAULT 'bier',
                member_price DECIMAL(10,2) NOT NULL,
                guest_price DECIMAL(10,2) NOT NULL,
                stock INTEGER DEFAULT 0,
                min_stock INTEGER DEFAULT 5,
                image TEXT DEFAULT '📦',
                available BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            -- Produkt Barcodes Tabelle
            CREATE TABLE IF NOT EXISTS product_barcodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER,
                barcode TEXT NOT NULL,
                FOREIGN KEY (product_id) REFERENCES products (id)
            );

            -- Transaktionen Tabelle
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                user_name TEXT,
                total DECIMAL(10,2) NOT NULL,
                payment_method TEXT DEFAULT 'account',
                items_json TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            );

            -- Kategorien Tabelle
            CREATE TABLE IF NOT EXISTS categories (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                icon TEXT DEFAULT '📦'
            );
        `;

        db.exec(schema, (err) => {
            if (err) {
                console.error('❌ Schema-Fehler:', err);
                reject(err);
            } else {
                console.log('✅ Datenbank-Schema erstellt');
                insertDemoData().then(resolve).catch(reject);
            }
        });
    });
}

function insertDemoData() {
    return new Promise((resolve, reject) => {
        // Prüfen ob bereits Daten vorhanden
        db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
            if (err) {
                reject(err);
                return;
            }

            if (row.count > 0) {
                console.log('✅ Demo-Daten bereits vorhanden');
                resolve();
                return;
            }

            console.log('📦 Erstelle Demo-Daten...');

            // Kategorien einfügen
            const categories = [
                ['bier', 'Bier', '🍺'],
                ['softdrinks', 'Softdrinks', '🥤'],
                ['schnaps', 'Spirituosen', '🥃'],
                ['snacks', 'Snacks', '🍿'],
                ['heissgetraenke', 'Heißgetränke', '☕']
            ];

            const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (id, name, icon) VALUES (?, ?, ?)');
            categories.forEach(cat => insertCategory.run(cat));
            insertCategory.finalize();

            // Benutzer einfügen
            const users = [
                ['Max', 'Mustermann', 'Max Mustermann', 'member', 'SAAR001', -15.50, 1, 'DE89370400440532013000', 'Max Mustermann', 1],
                ['Anna', 'Schmidt', 'Anna Schmidt', 'member', 'SAAR002', -8.20, 1, 'DE12300400330200000123', 'Anna Schmidt', 0],
                ['Tom', 'Wagner', 'Tom Wagner', 'bartender', 'SAAR003', 2.40, 0, '', '', 1],
                ['Sarah', 'Klein', 'Sarah Klein', 'member', 'SAAR004', -12.30, 1, 'DE45500700100987654321', 'Sarah Klein', 0],
                ['Lisa', 'Müller', 'Lisa Müller', 'member', 'SAAR005', -5.60, 0, '', '', 0],
                ['Gast', 'Benutzer', 'Gast Benutzer', 'guest', 'GUEST001', 0.00, 0, '', '', 0]
            ];

            const insertUser = db.prepare(`
                INSERT INTO users (first_name, last_name, full_name, role, barcode, balance, sepa_mandate, iban, account_holder, stay_active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            users.forEach(user => insertUser.run(user));
            insertUser.finalize();

            // Produkte einfügen
            const products = [
                ['Augustiner Helles', 'bier', 2.50, 3.00, 24, 10, '🍺'],
                ['Erdinger Weissbier', 'bier', 2.80, 3.30, 18, 8, '🍺'],
                ['Franziskaner Weissbier', 'bier', 2.70, 3.20, 15, 8, '🍺'],
                ['Becks Pils', 'bier', 2.30, 2.80, 20, 10, '🍺'],
                ['Coca Cola', 'softdrinks', 1.50, 2.00, 36, 15, '🥤'],
                ['Sprite', 'softdrinks', 1.50, 2.00, 30, 15, '🥤'],
                ['Fanta Orange', 'softdrinks', 1.50, 2.00, 28, 15, '🥤'],
                ['Spezi', 'softdrinks', 1.80, 2.20, 25, 12, '🥤'],
                ['Apfelschorle', 'softdrinks', 1.60, 2.10, 22, 12, '🥤'],
                ['Jägermeister', 'schnaps', 3.50, 4.50, 12, 5, '🥃'],
                ['Vodka', 'schnaps', 3.00, 4.00, 15, 5, '🥃'],
                ['Korn', 'schnaps', 2.50, 3.50, 10, 5, '🥃'],
                ['Erdnüsse gesalzen', 'snacks', 2.00, 2.50, 8, 3, '🥜'],
                ['Chips Paprika', 'snacks', 1.50, 2.00, 12, 5, '🍿'],
                ['Gummibärchen', 'snacks', 1.80, 2.20, 6, 3, '🍭'],
                ['Kaffee', 'heissgetraenke', 1.00, 1.50, 50, 20, '☕'],
                ['Tee', 'heissgetraenke', 0.80, 1.20, 45, 20, '🍵'],
                ['Heisse Schokolade', 'heissgetraenke', 1.20, 1.80, 30, 15, '🍫']
            ];

            const insertProduct = db.prepare(`
                INSERT INTO products (name, category, member_price, guest_price, stock, min_stock, image)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            
            products.forEach((product, index) => {
                insertProduct.run(product, function(err) {
                    if (err) {
                        console.error('Produktfehler:', err);
                        return;
                    }
                    
                    const productId = this.lastID;
                    
                    // Barcodes für jedes Produkt
                    const barcodes = [
                        `4000417025${String(index + 1).padStart(3, '0')}`, // EAN-Format
                        `500011263${String(index + 1).padStart(4, '0')}`,   // Alternative
                    ];
                    
                    const insertBarcode = db.prepare('INSERT INTO product_barcodes (product_id, barcode) VALUES (?, ?)');
                    barcodes.forEach(barcode => insertBarcode.run(productId, barcode));
                    insertBarcode.finalize();
                });
            });
            insertProduct.finalize();

            // Demo-Transaktionen
            const transactions = [
                [1, 'Max Mustermann', 5.00, 'account', '[{"name":"Augustiner Helles","quantity":2,"price":2.50}]'],
                [2, 'Anna Schmidt', 4.30, 'account', '[{"name":"Coca Cola","quantity":1,"price":1.50},{"name":"Erdinger","quantity":1,"price":2.80}]'],
                [4, 'Sarah Klein', 6.60, 'account', '[{"name":"Jägermeister","quantity":1,"price":3.50},{"name":"Chips","quantity":2,"price":1.55}]'],
                [1, 'Max Mustermann', 3.60, 'account', '[{"name":"Spezi","quantity":2,"price":1.80}]']
            ];

            const insertTransaction = db.prepare(`
                INSERT INTO transactions (user_id, user_name, total, payment_method, items_json)
                VALUES (?, ?, ?, ?, ?)
            `);
            transactions.forEach(trans => insertTransaction.run(trans));
            insertTransaction.finalize();

            console.log('✅ Demo-Daten erfolgreich erstellt');
            resolve();
        });
    });
}

// ============ API ROUTES ============

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '2.0.0-demo' });
});

// Dashboard Statistiken
app.get('/api/dashboard', (req, res) => {
    const queries = {
        users: 'SELECT COUNT(*) as total, SUM(CASE WHEN role="member" THEN 1 ELSE 0 END) as members FROM users',
        transactions: 'SELECT COUNT(*) as total_transactions, COALESCE(SUM(total), 0) as total_revenue FROM transactions WHERE DATE(timestamp) >= DATE("now", "-30 days")',
        products: 'SELECT COUNT(*) as available_products, SUM(CASE WHEN stock <= min_stock THEN 1 ELSE 0 END) as low_stock_products FROM products WHERE available = 1'
    };

    Promise.all([
        new Promise((resolve, reject) => {
            db.get(queries.users, (err, row) => err ? reject(err) : resolve(row));
        }),
        new Promise((resolve, reject) => {
            db.get(queries.transactions, (err, row) => err ? reject(err) : resolve(row));
        }),
        new Promise((resolve, reject) => {
            db.get(queries.products, (err, row) => err ? reject(err) : resolve(row));
        })
    ]).then(([users, transactions, products]) => {
        res.json({
            users: {
                total: users.total || 0,
                members: users.members || 0
            },
            transactions: {
                total_transactions: transactions.total_transactions || 0,
                total_revenue: transactions.total_revenue || 0
            },
            products: {
                available_products: products.available_products || 0,
                low_stock_products: products.low_stock_products || 0
            }
        });
    }).catch(err => {
        console.error('Dashboard Error:', err);
        res.status(500).json({ error: 'Datenbankfehler' });
    });
});

// Alle Benutzer
app.get('/api/users', (req, res) => {
    db.all('SELECT * FROM users ORDER BY first_name', (err, rows) => {
        if (err) {
            console.error('Users Error:', err);
            res.status(500).json({ error: 'Datenbankfehler' });
        } else {
            res.json(rows);
        }
    });
});

// Benutzersuche
app.get('/api/users/search/:query', (req, res) => {
    const query = req.params.query.toLowerCase();
    db.all(`
        SELECT * FROM users 
        WHERE LOWER(first_name) LIKE ? 
           OR LOWER(last_name) LIKE ? 
           OR LOWER(full_name) LIKE ?
           OR LOWER(barcode) LIKE ?
        ORDER BY first_name
        LIMIT 10
    `, [`${query}%`, `${query}%`, `%${query}%`, `${query}%`], (err, rows) => {
        if (err) {
            console.error('User Search Error:', err);
            res.status(500).json({ error: 'Suchfehler' });
        } else {
            res.json(rows);
        }
    });
});

// Alle Produkte
app.get('/api/products', (req, res) => {
    db.all(`
        SELECT p.*, c.name as category_name 
        FROM products p 
        LEFT JOIN categories c ON p.category = c.id 
        WHERE p.available = 1 
        ORDER BY p.category, p.name
    `, (err, rows) => {
        if (err) {
            console.error('Products Error:', err);
            res.status(500).json({ error: 'Datenbankfehler' });
        } else {
            res.json(rows);
        }
    });
});

// Produkt per Barcode
app.get('/api/products/barcode/:barcode', (req, res) => {
    const barcode = req.params.barcode;
    db.get(`
        SELECT p.*, c.name as category_name 
        FROM products p 
        LEFT JOIN categories c ON p.category = c.id 
        JOIN product_barcodes pb ON p.id = pb.product_id 
        WHERE pb.barcode = ? AND p.available = 1
    `, [barcode], (err, row) => {
        if (err) {
            console.error('Barcode Search Error:', err);
            res.status(500).json({ error: 'Datenbankfehler' });
        } else {
            res.json(row || null);
        }
    });
});

// Transaktionen
app.get('/api/transactions', (req, res) => {
    db.all(`
        SELECT * FROM transactions 
        ORDER BY timestamp DESC 
        LIMIT 100
    `, (err, rows) => {
        if (err) {
            console.error('Transactions Error:', err);
            res.status(500).json({ error: 'Datenbankfehler' });
        } else {
            res.json(rows);
        }
    });
});

// Neue Transaktion
app.post('/api/transactions', (req, res) => {
    const { userId, userName, items, total, paymentMethod } = req.body;
    
    if (!userId || !userName || !items || !total) {
        return res.status(400).json({ error: 'Unvollständige Transaktionsdaten' });
    }

    const itemsJson = JSON.stringify(items);
    
    db.serialize(() => {
        // Transaktion einfügen
        db.run(`
            INSERT INTO transactions (user_id, user_name, total, payment_method, items_json)
            VALUES (?, ?, ?, ?, ?)
        `, [userId, userName, total, paymentMethod || 'account', itemsJson], function(err) {
            if (err) {
                console.error('Transaction Insert Error:', err);
                res.status(500).json({ error: 'Transaktionsfehler' });
                return;
            }
            
            const transactionId = this.lastID;
            
            // Benutzersaldo aktualisieren
            db.run(`
                UPDATE users 
                SET balance = balance - ?, last_activity = CURRENT_TIMESTAMP 
                WHERE id = ?
            `, [total, userId], (err) => {
                if (err) {
                    console.error('Balance Update Error:', err);
                    res.status(500).json({ error: 'Saldo-Update-Fehler' });
                    return;
                }
                
                // Bestände reduzieren
                items.forEach(item => {
                    if (item.productId) {
                        db.run(`
                            UPDATE products 
                            SET stock = stock - ? 
                            WHERE id = ? AND stock >= ?
                        `, [item.quantity, item.productId, item.quantity]);
                    }
                });
                
                res.json({ 
                    success: true, 
                    transactionId: transactionId,
                    message: 'Transaktion erfolgreich' 
                });
            });
        });
    });
});

// SEPA Export
app.get('/api/sepa-export', (req, res) => {
    db.all(`
        SELECT * FROM users 
        WHERE sepa_mandate = 1 AND balance < 0
        ORDER BY full_name
    `, (err, rows) => {
        if (err) {
            console.error('SEPA Export Error:', err);
            res.status(500).json({ error: 'SEPA-Export-Fehler' });
        } else {
            const totalAmount = rows.reduce((sum, user) => sum + Math.abs(user.balance), 0);
            res.json({
                sepa_users: rows,
                total_amount: totalAmount,
                export_date: new Date().toISOString()
            });
        }
    });
});

// Backup Export
app.get('/api/backup', (req, res) => {
    const queries = [
        'SELECT * FROM users',
        'SELECT * FROM products',
        'SELECT * FROM product_barcodes', 
        'SELECT * FROM transactions',
        'SELECT * FROM categories'
    ];
    
    Promise.all(queries.map(query => 
        new Promise((resolve, reject) => {
            db.all(query, (err, rows) => err ? reject(err) : resolve(rows));
        })
    )).then(([users, products, barcodes, transactions, categories]) => {
        const backup = {
            timestamp: new Date().toISOString(),
            version: '2.0.0-demo',
            users,
            products,
            product_barcodes: barcodes,
            transactions,
            categories
        };
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=saarcade_backup_${new Date().toISOString().split('T')[0]}.json`);
        res.json(backup);
    }).catch(err => {
        console.error('Backup Error:', err);
        res.status(500).json({ error: 'Backup-Fehler' });
    });
});

// ============ STATIC FILE ROUTES ============
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/kasse', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'kasse.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ============ SERVER START ============
initializeDatabase().then(() => {
    app.listen(PORT, () => {
        console.log('🎮 ====================================');
        console.log('🎮 SAARCADE KASSENSYSTEM GESTARTET!');
        console.log('🎮 ====================================');
        console.log(`🌐 Server läuft auf: http://localhost:${PORT}`);
        console.log(`🛒 Kassensystem: http://localhost:${PORT}/kasse`);
        console.log(`⚙️  Admin-Panel: http://localhost:${PORT}/admin`);
        console.log(`📊 Health Check: http://localhost:${PORT}/health`);
        console.log('🎮 ====================================');
        console.log('✅ Bereit für Demo und Produktiveinsatz!');
    });
}).catch(err => {
    console.error('❌ Server-Start fehlgeschlagen:', err);
    process.exit(1);
});

// Graceful Shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Server wird beendet...');
    if (db) {
        db.close((err) => {
            if (err) {
                console.error('❌ Datenbankfehler beim Schließen:', err);
            } else {
                console.log('✅ Datenbank geschlossen');
            }
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
});
