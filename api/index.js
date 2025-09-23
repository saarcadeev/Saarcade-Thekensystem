// ====================================================================
// SAARCADE KASSENSYSTEM - VOLLSTÄNDIGE API MIT CRUD-OPERATIONEN
// Erweiterte Version mit allen Endpunkten für Admin-Dashboard
// ====================================================================

const { createClient } = require('@supabase/supabase-js');

// Supabase-Konfiguration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey, {
    db: {
        schema: 'public'
    }
});

if (!supabaseUrl || !supabaseKey) {
    console.error('SUPABASE_URL or SUPABASE_ANON_KEY missing');
}

// CORS-Headers für alle Antworten
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
};

// Haupthandler für alle API-Requests
module.exports = async (req, res) => {
    // CORS Preflight
    if (req.method === 'OPTIONS') {
        Object.entries(corsHeaders).forEach(([key, value]) => {
            res.setHeader(key, value);
        });
        return res.status(200).end();
    }

    // Headers setzen
    Object.entries(corsHeaders).forEach(([key, value]) => {
        res.setHeader(key, value);
    });

    try {
        const { url, method } = req;
        const path = url.replace('/api', '').split('?')[0];
        const pathParts = path.split('/').filter(p => p);
        
        console.log(`${method} ${path}`);

        // ============ HEALTH CHECK ============
        if (path === '/health') {
            return res.status(200).json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                database: 'connected',
                version: '2.0.0'
            });
        }

        // ============ DASHBOARD ============
        if (path === '/dashboard' && method === 'GET') {
            try {
                const { data: users } = await supabase.from('users').select('role').eq('role', 'member');
                const { data: products } = await supabase.from('products').select('stock, available').eq('available', true);
                const { data: allProducts } = await supabase.from('products').select('stock, min_stock');
                
                const today = new Date().toISOString().split('T')[0];
                const { data: todayTransactions } = await supabase
                    .from('transactions')
                    .select('total')
                    .gte('created_at', today);

                const stats = {
                    member_count: users ? users.length : 0,
                    available_products: products ? products.length : 0,
                    total_stock: allProducts ? allProducts.reduce((sum, p) => sum + (p.stock || 0), 0) : 0,
                    low_stock_count: allProducts ? allProducts.filter(p => (p.stock || 0) <= (p.min_stock || 0)).length : 0,
                    today_transactions: todayTransactions ? todayTransactions.length : 0,
                    today_revenue: todayTransactions ? todayTransactions.reduce((sum, t) => sum + (t.total || 0), 0) : 0
                };

                return res.status(200).json(stats);
            } catch (error) {
                console.error('Dashboard error:', error);
                return res.status(500).json({ error: 'Dashboard data fetch failed' });
            }
        }

        // ============ USERS ENDPUNKTE ============
        
        // GET /users - Alle Benutzer
        if (path === '/users' && method === 'GET') {
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .order('first_name');
            
            if (error) throw error;
            return res.status(200).json(data || []);
        }

        // GET /users/{barcode} - Benutzer per Barcode
        if (pathParts[0] === 'users' && pathParts[1] && method === 'GET') {
            const barcode = pathParts[1].toUpperCase();
            
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('barcode', barcode)
                .single();
            
            if (error) {
                if (error.code === 'PGRST116') {
                    return res.status(404).json({ error: 'Benutzer nicht gefunden' });
                }
                throw error;
            }
            
            return res.status(200).json(data);
        }

        // POST /users - Neuen Benutzer erstellen
        if (path === '/users' && method === 'POST') {
            const userData = req.body;
            
            // Validierung
            if (!userData.first_name || !userData.last_name || !userData.barcode) {
                return res.status(400).json({ error: 'Pflichtfelder fehlen: first_name, last_name, barcode' });
            }

            // Barcode-Eindeutigkeit prüfen
            const { data: existingUser } = await supabase
                .from('users')
                .select('id')
                .eq('barcode', userData.barcode)
                .single();

            if (existingUser) {
                return res.status(400).json({ error: 'Barcode bereits vergeben' });
            }

            // Benutzer erstellen
            const { data, error } = await supabase
                .from('users')
                .insert([{
                    first_name: userData.first_name,
                    last_name: userData.last_name,
                    role: userData.role || 'member',
                    barcode: userData.barcode,
                    balance: userData.balance || 0,
                    sepa_active: userData.sepa_active || false,
                    email: userData.email || null,
                    iban: userData.iban || null
                }])
                .select()
                .single();
            
            if (error) throw error;
            return res.status(201).json(data);
        }

        // PUT /users/{id} - Benutzer bearbeiten
        if (pathParts[0] === 'users' && pathParts[1] && method === 'PUT') {
            const userId = parseInt(pathParts[1]);
            const userData = req.body;
            
            if (isNaN(userId)) {
                return res.status(400).json({ error: 'Ungültige Benutzer-ID' });
            }

            // Barcode-Eindeutigkeit prüfen (ausgenommen aktueller Benutzer)
            if (userData.barcode) {
                const { data: existingUser } = await supabase
                    .from('users')
                    .select('id')
                    .eq('barcode', userData.barcode)
                    .neq('id', userId)
                    .single();

                if (existingUser) {
                    return res.status(400).json({ error: 'Barcode bereits vergeben' });
                }
            }

            const { data, error } = await supabase
                .from('users')
                .update({
                    first_name: userData.first_name,
                    last_name: userData.last_name,
                    role: userData.role,
                    barcode: userData.barcode,
                    balance: userData.balance,
                    sepa_active: userData.sepa_active,
                    email: userData.email,
                    iban: userData.iban
                })
                .eq('id', userId)
                .select()
                .single();
            
            if (error) {
                if (error.code === 'PGRST116') {
                    return res.status(404).json({ error: 'Benutzer nicht gefunden' });
                }
                throw error;
            }
            
            return res.status(200).json(data);
        }

        // DELETE /users/{id} - Benutzer löschen
        if (pathParts[0] === 'users' && pathParts[1] && method === 'DELETE') {
            const userId = parseInt(pathParts[1]);
            
            if (isNaN(userId)) {
                return res.status(400).json({ error: 'Ungültige Benutzer-ID' });
            }

            const { error } = await supabase
                .from('users')
                .delete()
                .eq('id', userId);
            
            if (error) throw error;
            return res.status(200).json({ message: 'Benutzer erfolgreich gelöscht' });
        }

        // ============ PRODUCTS ENDPUNKTE ============
        
        // GET /products - Alle Produkte
        if (path === '/products' && method === 'GET') {
            const { data, error } = await supabase
                .from('products')
                .select('*')
                .order('category, name');
            
            if (error) throw error;
            return res.status(200).json(data || []);
        }

        // GET /products/barcode/{barcode} - Produkt per Barcode
        if (pathParts[0] === 'products' && pathParts[1] === 'barcode' && pathParts[2] && method === 'GET') {
            const barcode = pathParts[2];
            
            const { data, error } = await supabase
                .from('products')
                .select('*')
                .eq('barcode', barcode)
                .eq('available', true)
                .single();
            
            if (error) {
                if (error.code === 'PGRST116') {
                    return res.status(404).json({ error: 'Produkt nicht gefunden' });
                }
                throw error;
            }
            
            return res.status(200).json(data);
        }

        // POST /products - Neues Produkt erstellen
        if (path === '/products' && method === 'POST') {
            const productData = req.body;
            
            // Validierung
            if (!productData.name || !productData.member_price || !productData.guest_price) {
                return res.status(400).json({ error: 'Pflichtfelder fehlen: name, member_price, guest_price' });
            }

            // Barcode-Eindeutigkeit prüfen (falls angegeben)
            if (productData.barcode) {
                const { data: existingProduct } = await supabase
                    .from('products')
                    .select('id')
                    .eq('barcode', productData.barcode)
                    .single();

                if (existingProduct) {
                    return res.status(400).json({ error: 'Barcode bereits vergeben' });
                }
            }

            // Produkt erstellen
            const { data, error } = await supabase
                .from('products')
                .insert([{
                    name: productData.name,
                    category: productData.category || 'sonstiges',
                    image: productData.image || '📦',
                    member_price: productData.member_price,
                    guest_price: productData.guest_price,
                    stock: productData.stock || 0,
                    min_stock: productData.min_stock || 5,
                    barcode: productData.barcode || null,
                    available: productData.available !== false
                }])
                .select()
                .single();
            
            if (error) throw error;
            return res.status(201).json(data);
        }

        // PUT /products/{id} - Produkt bearbeiten
        if (pathParts[0] === 'products' && pathParts[1] && method === 'PUT') {
            const productId = parseInt(pathParts[1]);
            const productData = req.body;
            
            if (isNaN(productId)) {
                return res.status(400).json({ error: 'Ungültige Produkt-ID' });
            }

            // Barcode-Eindeutigkeit prüfen (ausgenommen aktuelles Produkt)
            if (productData.barcode) {
                const { data: existingProduct } = await supabase
                    .from('products')
                    .select('id')
                    .eq('barcode', productData.barcode)
                    .neq('id', productId)
                    .single();

                if (existingProduct) {
                    return res.status(400).json({ error: 'Barcode bereits vergeben' });
                }
            }

            const { data, error } = await supabase
                .from('products')
                .update({
                    name: productData.name,
                    category: productData.category,
                    image: productData.image,
                    member_price: productData.member_price,
                    guest_price: productData.guest_price,
                    stock: productData.stock,
                    min_stock: productData.min_stock,
                    barcode: productData.barcode,
                    available: productData.available
                })
                .eq('id', productId)
                .select()
                .single();
            
            if (error) {
                if (error.code === 'PGRST116') {
                    return res.status(404).json({ error: 'Produkt nicht gefunden' });
                }
                throw error;
            }
            
            return res.status(200).json(data);
        }

        // DELETE /products/{id} - Produkt löschen
        if (pathParts[0] === 'products' && pathParts[1] && method === 'DELETE') {
            const productId = parseInt(pathParts[1]);
            
            if (isNaN(productId)) {
                return res.status(400).json({ error: 'Ungültige Produkt-ID' });
            }

            const { error } = await supabase
                .from('products')
                .delete()
                .eq('id', productId);
            
            if (error) throw error;
            return res.status(200).json({ message: 'Produkt erfolgreich gelöscht' });
        }

        // ============ TRANSACTIONS ENDPUNKTE ============
        
        // GET /transactions - Alle Transaktionen
        if (path === '/transactions' && method === 'GET') {
            const { data, error } = await supabase
                .from('transactions')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(100);
            
            if (error) throw error;
            return res.status(200).json(data || []);
        }

        // POST /transactions - Neue Transaktion erstellen
        if (path === '/transactions' && method === 'POST') {
            const transactionData = req.body;
            
            // Validierung
            if (!transactionData.userId || !transactionData.items || transactionData.items.length === 0) {
                return res.status(400).json({ error: 'Ungültige Transaktionsdaten' });
            }

            // Benutzer laden
            const { data: user, error: userError } = await supabase
                .from('users')
                .select('*')
                .eq('id', transactionData.userId)
                .single();
            
            if (userError) throw userError;

            // Einzelne Transaktionen erstellen und Saldo aktualisieren
            const transactions = [];
            let totalAmount = 0;
            
            for (const item of transactionData.items) {
                const transaction = {
                    user_id: transactionData.userId,
                    user_name: transactionData.userName,
                    product_id: item.productId,
                    product_name: item.productName,
                    quantity: item.quantity,
                    price: item.price,
                    total: item.total,
                    payment_method: transactionData.paymentMethod || 'balance'
                };
                
                transactions.push(transaction);
                totalAmount += item.total;
                
                // Bestand reduzieren
                try {
                    const { data: product } = await supabase
                        .from('products')
                        .select('stock')
                        .eq('id', item.productId)
                        .single();

                    if (product && product.stock >= item.quantity) {
                        const newStock = product.stock - item.quantity;
                        await supabase
                            .from('products')
                            .update({ stock: newStock })
                            .eq('id', item.productId);
                    }
                } catch (stockError) {
                    console.warn('Stock update error:', stockError);
                }
            }

            // Transaktionen speichern
            const { data: savedTransactions, error: transactionError } = await supabase
                .from('transactions')
                .insert(transactions)
                .select();
            
            if (transactionError) throw transactionError;

            // Benutzersaldo aktualisieren
            const newBalance = user.balance - totalAmount;
            const { error: balanceError } = await supabase
                .from('users')
                .update({ balance: newBalance })
                .eq('id', transactionData.userId);
            
            if (balanceError) throw balanceError;

            return res.status(201).json({
                transactions: savedTransactions,
                newBalance: newBalance,
                totalAmount: totalAmount
            });
        }

        // ============ SETTINGS ENDPUNKTE ============
        
        // GET /settings - Alle Einstellungen
        if (path === '/settings' && method === 'GET') {
            const { data, error } = await supabase
                .from('settings')
                .select('*');
            
            if (error) throw error;
            
            // In einfaches Key-Value Format umwandeln
            const settings = {};
            if (data) {
                data.forEach(setting => {
                    settings[setting.key] = setting.value;
                });
            }
            
            return res.status(200).json(settings);
        }

        // PUT /settings - Einstellungen speichern
        if (path === '/settings' && method === 'PUT') {
            const settingsData = req.body;
            
            try {
                // Alle vorhandenen Einstellungen löschen und neue einfügen
                await supabase.from('settings').delete().neq('id', 0);
                
                const settingsArray = Object.entries(settingsData).map(([key, value]) => ({
                    key,
                    value: typeof value === 'object' ? JSON.stringify(value) : String(value)
                }));
                
                if (settingsArray.length > 0) {
                    const { error } = await supabase
                        .from('settings')
                        .insert(settingsArray);
                    
                    if (error) throw error;
                }
                
                return res.status(200).json({ message: 'Einstellungen gespeichert' });
            } catch (error) {
                console.error('Settings error:', error);
                return res.status(500).json({ error: 'Fehler beim Speichern der Einstellungen' });
            }
        }

        // ============ SEPA ENDPUNKTE ============
        
        // GET /sepa-users - SEPA-fähige Benutzer
        if (path === '/sepa-users' && method === 'GET') {
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('sepa_active', true)
                .lt('balance', 0)
                .not('iban', 'is', null)
                .order('first_name');
            
            if (error) throw error;
            
            const sepaUsers = (data || []).map(user => ({
                ...user,
                debit_amount: Math.abs(user.balance)
            }));
            
            return res.status(200).json(sepaUsers);
        }

        // ============ TEST ENDPUNKTE ============
        
        // Debug-Test ohne Supabase
        if (path === '/test' && method === 'GET') {
            return res.status(200).json({
                message: 'API funktioniert',
                path: path,
                method: method,
                env_url_exists: !!supabaseUrl,
                env_key_exists: !!supabaseKey,
                timestamp: new Date().toISOString()
            });
        }

        // Supabase-Verbindungstest
        if (path === '/supabase-test' && method === 'GET') {
            try {
                const { data, error, count } = await supabase
                    .from('users')
                    .select('*', { count: 'exact' })
                    .limit(1);
                
                return res.status(200).json({
                    supabase_connection: error ? 'failed' : 'success',
                    error_message: error ? error.message : null,
                    data_length: data ? data.length : 0,
                    count: count,
                    first_user: data && data[0] ? data[0].first_name : null
                });
            } catch (e) {
                return res.status(500).json({
                    supabase_connection: 'exception',
                    error: e.message
                });
            }
        }
        
        // ============ 404 - ENDPUNKT NICHT GEFUNDEN ============
        return res.status(404).json({ 
            error: 'Endpunkt nicht gefunden',
            path: path,
            method: method
        });

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ 
            error: 'Interner Serverfehler',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};
