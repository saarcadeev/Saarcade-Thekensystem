// ====================================================================
// SAARCADE KASSENSYSTEM - VERCEL SERVERLESS API (KORRIGIERT)
// Vollständiges Backend für Supabase + Vercel
// ====================================================================

const { createClient } = require('@supabase/supabase-js');

// Supabase-Konfiguration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('SUPABASE_URL or SUPABASE_ANON_KEY missing');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    db: {
        schema: 'public'
    }
});

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

        // ============ ROUTING ============
        
        // Health Check
        if (path === '/health') {
            return res.status(200).json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                database: 'connected',
                version: '2.0.0'
            });
        }

        // Dashboard-Statistiken
        if (path === '/dashboard' && method === 'GET') {
            try {
                // Direkte Abfragen statt View verwenden
                const { data: users } = await supabase.from('public.users').select('role').eq('role', 'member');
                const { data: products } = await supabase.from('public.products').select('stock, available').eq('available', true);
                const { data: allProducts } = await supabase.from('public.products').select('stock, min_stock');
                
                const today = new Date().toISOString().split('T')[0];
                const { data: todayTransactions } = await supabase
                    .from('public.transactions')
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

        // ============ BENUTZER-ENDPUNKTE ============
        
        // Alle Benutzer
        if (path === '/users' && method === 'GET') {
            const { data, error } = await supabase
                .from('public.users')
                .select('*')
                .order('first_name');
            
            if (error) throw error;
            return res.status(200).json(data || []);
        }

        // Benutzer per Barcode
        if (pathParts[0] === 'users' && pathParts[1] && method === 'GET') {
            const barcode = pathParts[1].toUpperCase();
            
            const { data, error } = await supabase
                .from('public.users')
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

        // ============ PRODUKT-ENDPUNKTE ============
        
        // Alle Produkte
        if (path === '/products' && method === 'GET') {
            const { data, error } = await supabase
                .from('public.products')
                .select('*')
                .eq('available', true)
                .order('category, name');
            
            if (error) throw error;
            return res.status(200).json(data || []);
        }

        // Produkt per Barcode
        if (pathParts[0] === 'products' && pathParts[1] === 'barcode' && pathParts[2] && method === 'GET') {
            const barcode = pathParts[2];
            
            const { data, error } = await supabase
                .from('public.products')
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

        // ============ TRANSAKTIONS-ENDPUNKTE ============
        
        // Alle Transaktionen
        if (path === '/transactions' && method === 'GET') {
            const { data, error } = await supabase
                .from('public.transactions')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(100);
            
            if (error) throw error;
            return res.status(200).json(data || []);
        }

        // Neue Transaktion erstellen
        if (path === '/transactions' && method === 'POST') {
            const transactionData = req.body;
            
            // Validierung
            if (!transactionData.userId || !transactionData.items || transactionData.items.length === 0) {
                return res.status(400).json({ error: 'Ungültige Transaktionsdaten' });
            }

            // Benutzer laden
            const { data: user, error: userError } = await supabase
                .from('public.users')
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
                
                // Bestand reduzieren - Sicherer Weg
                try {
                    const { data: product } = await supabase
                        .from('public.products')
                        .select('stock')
                        .eq('id', item.productId)
                        .single();

                    if (product && product.stock >= item.quantity) {
                        const newStock = product.stock - item.quantity;
                        await supabase
                            .from('public.products')
                            .update({ stock: newStock })
                            .eq('id', item.productId);
                    }
                } catch (stockError) {
                    console.warn('Stock update error:', stockError);
                }
            }

            // Transaktionen speichern
            const { data: savedTransactions, error: transactionError } = await supabase
                .from('public.transactions')
                .insert(transactions)
                .select();
            
            if (transactionError) throw transactionError;

            // Benutzersaldo aktualisieren
            const newBalance = user.balance - totalAmount;
            const { error: balanceError } = await supabase
                .from('public.users')
                .update({ balance: newBalance })
                .eq('id', transactionData.userId);
            
            if (balanceError) throw balanceError;

            return res.status(201).json({
                transactions: savedTransactions,
                newBalance: newBalance,
                totalAmount: totalAmount
            });
        }

        // ============ SEPA-ENDPUNKTE ============
        
        // SEPA-fähige Benutzer
        if (path === '/sepa-users' && method === 'GET') {
            const { data, error } = await supabase
                .from('public.users')
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
