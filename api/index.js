// ====================================================================
// SAARCADE KASSENSYSTEM - ERWEITERTE API MIT BILDUPLOAD
// Neue Version mit Supabase Storage Integration
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

// CORS-Headers fÃ¼r alle Antworten
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
};

// Hilfsfunktion fÃ¼r Base64 zu Buffer Konvertierung
function base64ToBuffer(base64String) {
    // Entferne Data URL Prefix falls vorhanden
    const base64Data = base64String.replace(/^data:image\/[a-z]+;base64,/, '');
    return Buffer.from(base64Data, 'base64');
}

// Hilfsfunktion fÃ¼r Dateiname generierung
function generateFileName(originalName, productId) {
    const timestamp = Date.now();
    const extension = originalName ? originalName.split('.').pop() : 'jpg';
    return `product_${productId}_${timestamp}.${extension}`;
}

// Haupthandler fÃ¼r alle API-Requests
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

// ============ LOGIN (SICHER MIT PASSWORT-HASHING) ============
        if (path === '/login' && method === 'POST') {
            try {
                const { username, password, role } = req.body;
                
                if (!username || !password) {
                    return res.status(400).json({ error: 'Username und Passwort erforderlich' });
                }

                // Nutze die sichere admin_login Funktion aus der Datenbank
                const { data, error } = await supabase
                    .rpc('admin_login', {
                        p_username: username,
                        p_password: password
                    });

                if (error) {
                    console.error('Login RPC error:', error);
                    return res.status(500).json({ error: 'Login fehlgeschlagen' });
                }

                // data ist ein Array mit einem Element
                const loginResult = data && data[0];

                if (!loginResult || !loginResult.success) {
                    return res.status(401).json({ 
                        error: loginResult?.error_message || 'Ungültige Anmeldedaten' 
                    });
                }

                // Prüfe Rolle (falls spezifisch angefordert)
                if (role && loginResult.role !== role) {
                    return res.status(403).json({ error: 'Keine Berechtigung für diesen Bereich' });
                }

                // Erfolgreicher Login
                return res.status(200).json({
                    success: true,
                    user: {
                        id: loginResult.user_id,
                        username: loginResult.username,
                        role: loginResult.role
                    }
                });

            } catch (error) {
                console.error('Login error:', error);
                return res.status(500).json({ error: 'Login fehlgeschlagen' });
            }
        }
        
        // ============ HEALTH CHECK ============
        if (path === '/health') {
            return res.status(200).json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                database: 'connected',
                version: '2.1.0-with-images'
            });
        }

        // ============ NEUER IMAGE UPLOAD ENDPUNKT ============
        if (path === '/upload-image' && method === 'POST') {
            try {
                const { image, fileName, productId } = req.body;
                
                if (!image) {
                    return res.status(400).json({ error: 'Kein Bild bereitgestellt' });
                }

                // Konvertiere Base64 zu Buffer
                const imageBuffer = base64ToBuffer(image);
                
                // Generiere eindeutigen Dateinamen
                const uniqueFileName = generateFileName(fileName, productId || 'temp');
                const filePath = `product-images/${uniqueFileName}`;

                // Upload zu Supabase Storage
                const { data: uploadData, error: uploadError } = await supabase.storage
                    .from('product-images')
                    .upload(filePath, imageBuffer, {
                        contentType: 'image/jpeg',
                        upsert: true
                    });

                if (uploadError) {
                    console.error('Upload Error:', uploadError);
                    return res.status(500).json({ error: 'Fehler beim Hochladen des Bildes' });
                }

                // Generiere Ã¶ffentliche URL
                const { data: urlData } = supabase.storage
                    .from('product-images')
                    .getPublicUrl(filePath);

                return res.status(200).json({
                    success: true,
                    imageUrl: urlData.publicUrl,
                    fileName: uniqueFileName,
                    filePath: filePath
                });

            } catch (error) {
                console.error('Image upload error:', error);
                return res.status(500).json({ error: 'Interner Fehler beim Bildupload' });
            }
        }

// ============ IMAGE DELETE ENDPUNKT ============
        if (pathParts[0] === 'delete-image' && method === 'DELETE') {
            try {
                const { filePath } = req.body;
                
                if (!filePath) {
                    return res.status(400).json({ error: 'Kein Dateipfad angegeben' });
                }

                const { error: deleteError } = await supabase.storage
                    .from('product-images')
                    .remove([filePath]);

                if (deleteError) {
                    console.error('Delete Error:', deleteError);
                    return res.status(500).json({ error: 'Fehler beim LÃ¶schen des Bildes' });
                }

                return res.status(200).json({ success: true });

            } catch (error) {
                console.error('Image delete error:', error);
                return res.status(500).json({ error: 'Interner Fehler beim LÃ¶schen' });
            }
        }

        // ============ DASHBOARD ============
if (path === '/dashboard' && method === 'GET') {
            try {
                const { data: users } = await supabase.from('users').select('role').eq('role', 'member');
                const { data: allUsers } = await supabase.from('users').select('balance, role').eq('role', 'member');
                const { data: products } = await supabase.from('products').select('stock, available').eq('available', true);
                const { data: allProducts } = await supabase.from('products').select('stock, min_stock');
                
// Nicht abgerechnete UND nicht stornierte Transaktionen (ohne manuelle Buchungen)
const { data: unbilledTransactions } = await supabase
    .from('transactions')
    .select('total')
    .is('billing_id', null)
    .eq('cancelled', false)
    .neq('payment_method', 'manual_booking');

                // Mitglieder mit negativem Saldo (offener Betrag)
                const membersWithDebt = allUsers ? allUsers.filter(u => u.balance < 0).length : 0;
                
                const stats = {
                    member_count: users ? users.length : 0,
                    available_products: products ? products.length : 0,
                    total_stock: allProducts ? allProducts.reduce((sum, p) => sum + (p.stock || 0), 0) : 0,
                    low_stock_count: allProducts ? allProducts.filter(p => (p.stock || 0) <= (p.min_stock || 0)).length : 0,
                    members_with_debt: membersWithDebt,
                    unbilled_revenue: unbilledTransactions ? unbilledTransactions.reduce((sum, t) => sum + (t.total || 0), 0) : 0
                };

                return res.status(200).json(stats);            } catch (error) {
                console.error('Dashboard error:', error);
                return res.status(500).json({ error: 'Dashboard data fetch failed' });
            }
        }

        // ============ USERS ENDPUNKTE ============
        
        // GET /users - Alle Benutzer
        if (path === '/users' && method === 'GET') {
            const { data, error } = await supabase
                .from('users')
                .select('id, first_name, last_name, email, role, balance, sepa_active, iban, barcodes, user_pin, pin_require_for_name_search, pin_require_for_barcode')
                .order('first_name');
            
            if (error) throw error;
            return res.status(200).json(data || []);
        }// GET /users/id/{id} - Benutzer per ID
if (pathParts[0] === 'users' && pathParts[1] === 'id' && pathParts[2] && method === 'GET') {
    const userId = parseInt(pathParts[2]);
    
    if (isNaN(userId)) {
        return res.status(400).json({ error: 'UngÃ¼ltige Benutzer-ID' });
    }
    
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();
    
    if (error) {
        if (error.code === 'PGRST116') {
            return res.status(404).json({ error: 'Benutzer nicht gefunden' });
        }
        throw error;
    }
    
    return res.status(200).json(data);
}
        
// GET /users/{barcode} - Benutzer per Barcode
if (pathParts[0] === 'users' && pathParts[1] && method === 'GET') {
    const barcode = pathParts[1].toUpperCase();
    
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .contains('barcodes', [barcode])
        .single();
    
    if (error) {
        if (error.code === 'PGRST116') {
            return res.status(404).json({ error: 'Benutzer nicht gefunden' });
        }
        throw error;
    }
    
    return res.status(200).json(data);
}

// POST /voucher-sales - Neuen Gutscheinverkauf speichern
        if (path === '/voucher-sales' && method === 'POST') {
            const voucherData = req.body;
            
            if (!voucherData.member_id || !voucherData.voucher_serial_number || !voucherData.voucher_hologram_number) {
                return res.status(400).json({ 
                    error: 'Pflichtfelder fehlen: member_id, voucher_serial_number, voucher_hologram_number' 
                });
            }

            const { data, error } = await supabase
                .from('voucher_sales')
                .insert([voucherData])
                .select()
                .single();
            
            if (error) throw error;
            return res.status(201).json(data);
        }

        // GET /voucher-sales - Alle Gutscheinverkäufe
        if (path === '/voucher-sales' && method === 'GET') {
            const { data, error } = await supabase
                .from('voucher_sales')
                .select('*')
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            return res.status(200).json(data || []);
        }
        
// POST /users - Neuen Benutzer erstellen
if (path === '/users' && method === 'POST') {
    const userData = req.body;
    
    if (!userData.first_name || !userData.last_name || !userData.barcodes || userData.barcodes.length === 0) {
        return res.status(400).json({ error: 'Pflichtfelder fehlen: first_name, last_name, barcodes' });
    }

    // Barcode-Eindeutigkeit prüfen für alle Barcodes
    for (const barcode of userData.barcodes) {
        const { data: existingUsers } = await supabase
            .from('users')
            .select('id')
            .contains('barcodes', [barcode]);

        if (existingUsers && existingUsers.length > 0) {
            return res.status(400).json({ error: `Barcode ${barcode} bereits vergeben` });
        }
    }
    
    const { data, error } = await supabase
        .from('users')
        .insert([{
            first_name: userData.first_name,
            last_name: userData.last_name,
            role: userData.role || 'member',
            barcodes: userData.barcodes,  // Array
            balance: userData.balance || 0,
            sepa_active: userData.sepa_active || false,
            email: userData.email || null,
            iban: userData.iban || null,
            user_pin: null,
            pin_require_for_name_search: false,
            pin_require_for_barcode: false
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
        return res.status(400).json({ error: 'UngÃ¼ltige Benutzer-ID' });
    }

    // Barcode-Eindeutigkeit prÃ¼fen (ausgenommen aktueller Benutzer)
    if (userData.barcodes && userData.barcodes.length > 0) {
        for (const barcode of userData.barcodes) {
            const { data: existingUser } = await supabase
                .from('users')
                .select('id')
                .contains('barcodes', [barcode])
                .neq('id', userId)
                .single();

            if (existingUser) {
                return res.status(400).json({ error: `Barcode ${barcode} bereits vergeben` });
            }
        }
    }

    const { data, error } = await supabase
        .from('users')
        .update({
            first_name: userData.first_name,
            last_name: userData.last_name,
            role: userData.role,
            barcodes: userData.barcodes,  // Array
            balance: userData.balance,
            sepa_active: userData.sepa_active,
            email: userData.email,
            iban: userData.iban,
            user_pin: userData.user_pin,
            pin_require_for_name_search: userData.pin_require_for_name_search,
            pin_require_for_barcode: userData.pin_require_for_barcode
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


        // DELETE /users/{id} - Benutzer lÃ¶schen
        if (pathParts[0] === 'users' && pathParts[1] && method === 'DELETE') {
            const userId = parseInt(pathParts[1]);
            
            if (isNaN(userId)) {
                return res.status(400).json({ error: 'UngÃ¼ltige Benutzer-ID' });
            }

            const { error } = await supabase
                .from('users')
                .delete()
                .eq('id', userId);
            
            if (error) throw error;
            return res.status(200).json({ message: 'Benutzer erfolgreich gelÃ¶scht' });
        }

        // ============ PRODUCTS ENDPUNKTE (ERWEITERT) ============
        
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
        .contains('barcodes', [barcode])
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

// GET /products/{id} - Produkt per ID
if (pathParts[0] === 'products' && pathParts[1] && pathParts[1] !== 'barcode' && method === 'GET') {
    const productId = parseInt(pathParts[1]);
    
    if (isNaN(productId)) {
        return res.status(400).json({ error: 'UngÃ¼ltige Produkt-ID' });
    }
    
    const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', productId)
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
    
    if (!productData.name || !productData.member_price || !productData.guest_price) {
        return res.status(400).json({ error: 'Pflichtfelder fehlen: name, member_price, guest_price' });
    }

    // Barcode-Eindeutigkeit prÃ¼fen (falls angegeben)
    if (productData.barcodes && productData.barcodes.length > 0) {
        for (const barcode of productData.barcodes) {
            const { data: existingProduct } = await supabase
                .from('products')
                .select('id')
                .contains('barcodes', [barcode])
                .single();

            if (existingProduct) {
                return res.status(400).json({ error: `Barcode ${barcode} bereits vergeben` });
            }
        }
    }

    const { data, error } = await supabase
        .from('products')
        .insert([{
            name: productData.name,
            category: productData.category || 'sonstiges',
            image: productData.image || 'ðŸ“¦',
            member_price: productData.member_price,
            guest_price: productData.guest_price,
            stock: productData.stock || 0,
            min_stock: productData.min_stock || 5,
            barcodes: productData.barcodes || [],  // Array
            available: productData.available !== false,
            image_url: productData.image_url || null,
            image_file_path: productData.image_file_path || null
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
        return res.status(400).json({ error: 'UngÃ¼ltige Produkt-ID' });
    }

    // Barcode-Eindeutigkeit prÃ¼fen (ausgenommen aktuelles Produkt)
    if (productData.barcodes && productData.barcodes.length > 0) {
        for (const barcode of productData.barcodes) {
            const { data: existingProduct } = await supabase
                .from('products')
                .select('id')
                .contains('barcodes', [barcode])
                .neq('id', productId)
                .single();

            if (existingProduct) {
                return res.status(400).json({ error: `Barcode ${barcode} bereits vergeben` });
            }
        }
    }

    // Rest wie vorher, nur barcodes statt barcode
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
            barcodes: productData.barcodes,  // Array
            available: productData.available,
            image_url: productData.image_url,
            image_file_path: productData.image_file_path
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

        // DELETE /products/{id} - Produkt lÃ¶schen (MIT BILDLÃ–SCHUNG)
        if (pathParts[0] === 'products' && pathParts[1] && method === 'DELETE') {
            const productId = parseInt(pathParts[1]);
            
            if (isNaN(productId)) {
                return res.status(400).json({ error: 'UngÃ¼ltige Produkt-ID' });
            }

            // Produktbild lÃ¶schen
            try {
                const { data: product } = await supabase
                    .from('products')
                    .select('image_file_path')
                    .eq('id', productId)
                    .single();

                if (product && product.image_file_path) {
                    await supabase.storage
                        .from('product-images')
                        .remove([product.image_file_path]);
                }
            } catch (deleteError) {
                console.warn('Could not delete product image:', deleteError);
            }

            const { error } = await supabase
                .from('products')
                .delete()
                .eq('id', productId);
            
            if (error) throw error;
            return res.status(200).json({ message: 'Produkt erfolgreich gelÃ¶scht' });
        }

        // ============ TRANSACTIONS ENDPUNKTE ============
        
// GET /transactions - Alle Transaktionen mit Pagination
if (path === '/transactions' && method === 'GET') {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const limit = parseInt(url.searchParams.get('limit')) || 100;
    const offset = parseInt(url.searchParams.get('offset')) || 0;
    const filter = url.searchParams.get('filter') || 'all';
    
    let query = supabase
        .from('transactions')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });
    
    // Zeitfilter anwenden
    const now = new Date();
    if (filter === 'today') {
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        query = query.gte('created_at', today.toISOString());
    } else if (filter === 'week') {
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        query = query.gte('created_at', weekAgo.toISOString());
    } else if (filter === 'month') {
        const monthAgo = new Date(now);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        query = query.gte('created_at', monthAgo.toISOString());
    }
    
    // Pagination anwenden
    query = query.range(offset, offset + limit - 1);
    
    const { data, error, count } = await query;
    
    if (error) throw error;
    return res.status(200).json({
        transactions: data || [],
        totalCount: count || 0,
        limit,
        offset
    });
        }

        // POST /transactions - Neue Transaktion erstellen
        if (path === '/transactions' && method === 'POST') {
            const transactionData = req.body;
            
            // Validierung
            if (!transactionData.userId || !transactionData.items || transactionData.items.length === 0) {
                return res.status(400).json({ error: 'UngÃ¼ltige Transaktionsdaten' });
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
                    payment_method: transactionData.paymentMethod || 'balance',
                    retried: transactionData.retried || false,  // ← NEU
                    original_timestamp: transactionData.originalTimestamp || null  // ← NEU
                };
    
                transactions.push(transaction);
                totalAmount += item.total;
                
// Bestand reduzieren UND Bestandsbewegung aufzeichnen (nur bei echten Produkten)
if (item.productId && item.productId > 0) {
    try {
        const { data: product } = await supabase
            .from('products')
            .select('stock, name')
            .eq('id', item.productId)
            .single();

        if (product) {
            const oldStock = product.stock;
            const newStock = product.stock - item.quantity;
          
            // Bestand aktualisieren
            await supabase
                .from('products')
                .update({ stock: newStock })
                .eq('id', item.productId);
            
            // Bestandsbewegung aufzeichnen
            await supabase
                .from('stock_movements')
                .insert({
                    product_id: item.productId,
                    product_name: product.name,
                    movement_type: 'sale',
                    quantity: -item.quantity,
                    stock_before: oldStock,
                    stock_after: newStock,
                    reason: `Verkauf an ${transactionData.userName}`,
                    created_by: 'system'
                });
        }
    } catch (stockError) {
        console.warn('Stock update error:', stockError);
        }
    }       
}              
            // Transaktionen speichern
            const { data: savedTransactions, error: transactionError } = await supabase
                .from('transactions')
                .insert(transactions)
                .select();
            
            if (transactionError) throw transactionError;

            // Benutzersaldo aktualisieren
            let newBalance;
            const paymentMethod = transactionData.paymentMethod || 'balance';
            
            if (paymentMethod === 'voucher_card') {
                // Verzehrkarte: Kein Geld, Saldo bleibt GLEICH (nur Getränke zählen)
                newBalance = user.balance;
            } else if (paymentMethod === 'voucher_refund') {
                // Verzehrkarten-Rückgabe: Geld geht RAUS, Saldo wird POSITIVER (weniger negativ)
                newBalance = user.balance + totalAmount;
            } else {
                // Alle anderen: Saldo wird NEGATIVER (Verkauf/Schuld)
                newBalance = user.balance - totalAmount;
            }
            
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

// DELETE /transactions/{id} - Transaktion stornieren (SOFT DELETE)
        if (pathParts[0] === 'transactions' && pathParts[1] && method === 'DELETE') {
            const transactionId = parseInt(pathParts[1]);
            
            if (isNaN(transactionId)) {
                return res.status(400).json({ error: 'Ungültige Transaktions-ID' });
            }

            // Prüfe ob Transaktion bereits abgerechnet ist
            const { data: transaction, error: fetchError } = await supabase
                .from('transactions')
                .select('*')
                .eq('id', transactionId)
                .single();
            
            if (fetchError) {
                if (fetchError.code === 'PGRST116') {
                    return res.status(404).json({ error: 'Transaktion nicht gefunden' });
                }
                throw fetchError;
            }

            if (transaction.is_billed || transaction.billing_id) {
                return res.status(400).json({ error: 'Abgerechnete Transaktionen können nicht storniert werden' });
            }

            if (transaction.cancelled) {
                return res.status(400).json({ error: 'Transaktion ist bereits storniert' });
            }

            // SOFT DELETE: Markiere als storniert
            const { error: cancelError } = await supabase
                .from('transactions')
                .update({
                    cancelled: true,
                    cancelled_at: new Date().toISOString(),
                    cancelled_by: 'barkeeper',
                    cancellation_reason: 'Storniert über Kasse'
                })
                .eq('id', transactionId);
            
            if (cancelError) throw cancelError;

            // BESTANDSKORREKTUR: Produkt zurückbuchen
            if (transaction.product_id && transaction.product_id > 0) {
                try {
                    const { data: product } = await supabase
                        .from('products')
                        .select('stock, name')
                        .eq('id', transaction.product_id)
                        .single();

                    if (product) {
                        const oldStock = product.stock;
                        const newStock = product.stock + transaction.quantity;

                        await supabase
                            .from('products')
                            .update({ stock: newStock })
                            .eq('id', transaction.product_id);

                        await supabase
                            .from('stock_movements')
                            .insert({
                                product_id: transaction.product_id,
                                product_name: product.name,
                                movement_type: 'cancellation',
                                quantity: transaction.quantity,
                                stock_before: oldStock,
                                stock_after: newStock,
                                reason: `Stornierung Transaktion #${transactionId}`,
                                created_by: 'system'
                            });
                    }
                } catch (stockError) {
                    console.warn('Stock correction error:', stockError);
                }
            }

            // SALDO KORRIGIEREN: Nur wenn echtes Geld geflossen ist
            // Bei Verzehrkarten-Einlösungen (voucher_card) NICHT den Saldo ändern!
            if (transaction.payment_method !== 'voucher_card') {
                const { data: user } = await supabase
                    .from('users')
                    .select('balance')
                    .eq('id', transaction.user_id)
                    .single();

                if (user) {
                    const newBalance = user.balance + transaction.total;
                    await supabase
                        .from('users')
                        .update({ balance: newBalance })
                        .eq('id', transaction.user_id);
                }
            }
            
            return res.status(200).json({ 
                message: 'Transaktion erfolgreich storniert',
                transaction: transaction,
                refunded: transaction.total
            });
        }
        // ============ CLOTHING ORDERS ENDPUNKTE ============
        
        // GET /clothing-orders - Alle Kleidungsbestellungen
        if (path === '/clothing-orders' && method === 'GET') {
            const { data, error } = await supabase
                .from('clothing_orders')
                .select('*')
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            return res.status(200).json(data || []);
        }

        // GET /clothing-orders/{id} - Einzelne Kleidungsbestellung
        if (pathParts[0] === 'clothing-orders' && pathParts[1] && method === 'GET') {
            const orderId = parseInt(pathParts[1]);
            
            if (isNaN(orderId)) {
                return res.status(400).json({ error: 'UngÃ¼ltige Bestell-ID' });
            }

            const { data, error } = await supabase
                .from('clothing_orders')
                .select('*')
                .eq('id', orderId)
                .single();
            
            if (error) {
                if (error.code === 'PGRST116') {
                    return res.status(404).json({ error: 'Bestellung nicht gefunden' });
                }
                throw error;
            }
            
            return res.status(200).json(data);
        }

        // POST /clothing-orders - Neue Kleidungsbestellung erstellen
        if (path === '/clothing-orders' && method === 'POST') {
            const orderData = req.body;
            
            // Validierung
            if (!orderData.member_id || !orderData.member_name || !orderData.items || 
                orderData.items.length === 0 || !orderData.payment_method) {
                return res.status(400).json({ 
                    error: 'Pflichtfelder fehlen: member_id, member_name, items, payment_method' 
                });
            }

            // Berechne Gesamtsumme
            const total = orderData.items.reduce((sum, item) => sum + item.total, 0);

            const { data, error } = await supabase
                .from('clothing_orders')
                .insert([{
                    member_id: orderData.member_id,
                    member_name: orderData.member_name,
                    items: orderData.items, // JSONB Array
                    payment_method: orderData.payment_method,
                    total: total,
                    status: 'pending', // pending, confirmed, shipped, completed, cancelled
                    notes: orderData.notes || null
                }])
                .select()
                .single();
            
            if (error) throw error;
            return res.status(201).json(data);
        }

        // PUT /clothing-orders/{id} - Bestellung aktualisieren (Status, Notizen)
        if (pathParts[0] === 'clothing-orders' && pathParts[1] && method === 'PUT') {
            const orderId = parseInt(pathParts[1]);
            const updateData = req.body;
            
            if (isNaN(orderId)) {
                return res.status(400).json({ error: 'UngÃ¼ltige Bestell-ID' });
            }

            const { data, error } = await supabase
                .from('clothing_orders')
                .update({
                    status: updateData.status,
                    notes: updateData.notes,
                    updated_at: new Date().toISOString()
                })
                .eq('id', orderId)
                .select()
                .single();
            
            if (error) throw error;
            return res.status(200).json(data);
        }

        // DELETE /clothing-orders/{id} - Bestellung lÃ¶schen
        if (pathParts[0] === 'clothing-orders' && pathParts[1] && method === 'DELETE') {
            const orderId = parseInt(pathParts[1]);
            
            if (isNaN(orderId)) {
                return res.status(400).json({ error: 'UngÃ¼ltige Bestell-ID' });
            }

            const { error } = await supabase
                .from('clothing_orders')
                .delete()
                .eq('id', orderId);
            
            if (error) throw error;
            return res.status(200).json({ message: 'Bestellung erfolgreich gelÃ¶scht' });
        }

        // GET /clothing-orders/member/{memberId} - Bestellungen eines Mitglieds
        if (pathParts[0] === 'clothing-orders' && pathParts[1] === 'member' && pathParts[2] && method === 'GET') {
            const memberId = parseInt(pathParts[2]);
            
            if (isNaN(memberId)) {
                return res.status(400).json({ error: 'UngÃ¼ltige Mitglieds-ID' });
            }

            const { data, error } = await supabase
                .from('clothing_orders')
                .select('*')
                .eq('member_id', memberId)
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            return res.status(200).json(data || []);
        }

        // GET /clothing-orders/stats - Statistiken fÃ¼r Kleidungsbestellungen
        if (path === '/clothing-orders/stats' && method === 'GET') {
            try {
                const { data: allOrders } = await supabase
                    .from('clothing_orders')
                    .select('*');

                const stats = {
                    total_orders: allOrders ? allOrders.length : 0,
                    pending_orders: allOrders ? allOrders.filter(o => o.status === 'pending').length : 0,
                    confirmed_orders: allOrders ? allOrders.filter(o => o.status === 'confirmed').length : 0,
                    shipped_orders: allOrders ? allOrders.filter(o => o.status === 'shipped').length : 0,
                    completed_orders: allOrders ? allOrders.filter(o => o.status === 'completed').length : 0,
                    total_revenue: allOrders ? allOrders.reduce((sum, o) => sum + (o.total || 0), 0) : 0,
                    payment_methods: {
                        sepa: allOrders ? allOrders.filter(o => o.payment_method === 'sepa').length : 0,
                        transfer: allOrders ? allOrders.filter(o => o.payment_method === 'transfer').length : 0,
                        paypal: allOrders ? allOrders.filter(o => o.payment_method === 'paypal').length : 0
                    }
                };

                return res.status(200).json(stats);
            } catch (error) {
                console.error('Clothing orders stats error:', error);
                return res.status(500).json({ error: 'Fehler beim Laden der Statistiken' });
            }
        }

// ============ CLOTHING BILLINGS ENDPUNKTE ============

// GET /clothing-billings - Alle Kleidungsabrechnungen
if (path === '/clothing-billings' && method === 'GET') {
    const { data, error } = await supabase
        .from('clothing_billings')
        .select('*')
        .order('created_at', { ascending: false });
    
    if (error) throw error;
    return res.status(200).json(data || []);
}

// GET /clothing-billings/{id} - Einzelne Kleidungsabrechnung
if (pathParts[0] === 'clothing-billings' && pathParts[1] && method === 'GET') {
    const billingId = parseInt(pathParts[1]);
    
    if (isNaN(billingId)) {
        return res.status(400).json({ error: 'UngÃ¼ltige Abrechnungs-ID' });
    }

    const { data, error } = await supabase
        .from('clothing_billings')
        .select('*')
        .eq('id', billingId)
        .single();
    
    if (error) {
        if (error.code === 'PGRST116') {
            return res.status(404).json({ error: 'Abrechnung nicht gefunden' });
        }
        throw error;
    }
    
    return res.status(200).json(data);
}

// POST /clothing-billings - Neue Kleidungsabrechnung erstellen
if (path === '/clothing-billings' && method === 'POST') {
    const billingData = req.body;
    
    if (!billingData.order_ids || billingData.order_ids.length === 0) {
        return res.status(400).json({ error: 'Keine Bestellungen angegeben' });
    }

    // Generiere Abrechnungsnummer
    const now = new Date();
    const billingNumber = `CLO-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;

    const { data, error } = await supabase
        .from('clothing_billings')
        .insert([{
            billing_number: billingNumber,
            billing_type: billingData.billing_type || 'clothing',
            billing_date: billingData.billing_date,
            order_ids: billingData.order_ids,
            member_ids: billingData.member_ids,
            total_amount: billingData.total_amount,
            order_count: billingData.order_count
        }])
        .select()
        .single();
    
    if (error) throw error;
    return res.status(201).json(data);
}
        
       // ============ CLOTHING ITEMS ENDPUNKTE ============
        
        // GET /clothing-items - Alle KleidungsstÃ¼cke
        if (path === '/clothing-items' && method === 'GET') {
            const { data, error } = await supabase
                .from('clothing_items')
                .select('*')
                .order('sort_order, name');
            
            if (error) throw error;
            return res.status(200).json(data || []);
        }

        // GET /clothing-items/available - Nur verfÃ¼gbare KleidungsstÃ¼cke
        if (path === '/clothing-items/available' && method === 'GET') {
            const { data, error } = await supabase
                .from('clothing_items')
                .select('*')
                .eq('available', true)
                .order('sort_order, name');
            
            if (error) throw error;
            return res.status(200).json(data || []);
        }

        // GET /clothing-items/{id} - Einzelnes KleidungsstÃ¼ck
        if (pathParts[0] === 'clothing-items' && pathParts[1] && method === 'GET') {
            const itemId = parseInt(pathParts[1]);
            
            if (isNaN(itemId)) {
                return res.status(400).json({ error: 'UngÃ¼ltige Item-ID' });
            }

            const { data, error } = await supabase
                .from('clothing_items')
                .select('*')
                .eq('id', itemId)
                .single();
            
            if (error) {
                if (error.code === 'PGRST116') {
                    return res.status(404).json({ error: 'KleidungsstÃ¼ck nicht gefunden' });
                }
                throw error;
            }
            
            return res.status(200).json(data);
        }

        // POST /clothing-items - Neues KleidungsstÃ¼ck erstellen
        if (path === '/clothing-items' && method === 'POST') {
            const itemData = req.body;
            
            if (!itemData.name || !itemData.price) {
                return res.status(400).json({ 
                    error: 'Pflichtfelder fehlen: name, price' 
                });
            }

            const { data, error } = await supabase
                .from('clothing_items')
                .insert([{
                    name: itemData.name,
                    emoji: itemData.emoji || 'ðŸ‘•',
                    price: itemData.price,
                    sizes: itemData.sizes || ['S', 'M', 'L', 'XL'],
                    colors: itemData.colors || ['Schwarz', 'WeiÃŸ'],
                    available: itemData.available !== false,
                    image_url: itemData.image_url || null,
                    image_file_path: itemData.image_file_path || null,
                    sort_order: itemData.sort_order || 0
                }])
                .select()
                .single();
            
            if (error) throw error;
            return res.status(201).json(data);
        }

        // PUT /clothing-items/{id} - KleidungsstÃ¼ck bearbeiten
        if (pathParts[0] === 'clothing-items' && pathParts[1] && method === 'PUT') {
            const itemId = parseInt(pathParts[1]);
            const itemData = req.body;
            
            if (isNaN(itemId)) {
                return res.status(400).json({ error: 'UngÃ¼ltige Item-ID' });
            }

            const updateData = {};
            if (itemData.name !== undefined) updateData.name = itemData.name;
            if (itemData.emoji !== undefined) updateData.emoji = itemData.emoji;
            if (itemData.price !== undefined) updateData.price = itemData.price;
            if (itemData.sizes !== undefined) updateData.sizes = itemData.sizes;
            if (itemData.colors !== undefined) updateData.colors = itemData.colors;
            if (itemData.available !== undefined) updateData.available = itemData.available;
            if (itemData.image_url !== undefined) updateData.image_url = itemData.image_url;
            if (itemData.image_file_path !== undefined) updateData.image_file_path = itemData.image_file_path;
            if (itemData.sort_order !== undefined) updateData.sort_order = itemData.sort_order;

            const { data, error } = await supabase
                .from('clothing_items')
                .update(updateData)
                .eq('id', itemId)
                .select()
                .single();
            
            if (error) throw error;
            return res.status(200).json(data);
        }

        // DELETE /clothing-items/{id} - KleidungsstÃ¼ck lÃ¶schen
        if (pathParts[0] === 'clothing-items' && pathParts[1] && method === 'DELETE') {
            const itemId = parseInt(pathParts[1]);
            
            if (isNaN(itemId)) {
                return res.status(400).json({ error: 'UngÃ¼ltige Item-ID' });
            }

            // Optional: Erst Bild lÃ¶schen wenn vorhanden
            const { data: item } = await supabase
                .from('clothing_items')
                .select('image_file_path')
                .eq('id', itemId)
                .single();

            if (item && item.image_file_path) {
                await supabase.storage
                    .from('product-images')
                    .remove([item.image_file_path]);
            }

            const { error } = await supabase
                .from('clothing_items')
                .delete()
                .eq('id', itemId);
            
            if (error) throw error;
            return res.status(200).json({ message: 'KleidungsstÃ¼ck erfolgreich gelÃ¶scht' });
        }
        
        // ============ STOCK MOVEMENTS ENDPUNKTE ============
        
        // GET /stock-movements - Alle Bestandsbewegungen
        if (path === '/stock-movements' && method === 'GET') {
            const { data, error } = await supabase
                .from('stock_movements')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(200);
            
            if (error) throw error;
            return res.status(200).json(data || []);
        }

        // GET /stock-movements/product/{productId} - Bestandsbewegungen eines Produkts
        if (pathParts[0] === 'stock-movements' && pathParts[1] === 'product' && pathParts[2] && method === 'GET') {
            const productId = parseInt(pathParts[2]);
            
            if (isNaN(productId)) {
                return res.status(400).json({ error: 'UngÃ¼ltige Produkt-ID' });
            }

            const { data, error } = await supabase
                .from('stock_movements')
                .select('*')
                .eq('product_id', productId)
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            return res.status(200).json(data || []);
        }

        // POST /stock-movements - Neue Bestandsbewegung erstellen
        if (path === '/stock-movements' && method === 'POST') {
            const movementData = req.body;
            
            // Validierung
            if (!movementData.product_id || !movementData.movement_type || !movementData.quantity) {
                return res.status(400).json({ error: 'Pflichtfelder fehlen: product_id, movement_type, quantity' });
            }

            // Produkt laden
            const { data: product, error: productError } = await supabase
                .from('products')
                .select('*')
                .eq('id', movementData.product_id)
                .single();
            
            if (productError) {
                if (productError.code === 'PGRST116') {
                    return res.status(404).json({ error: 'Produkt nicht gefunden' });
                }
                throw productError;
            }

            const oldStock = product.stock;
            let newStock;
            let quantity = parseInt(movementData.quantity);

            // Berechne neuen Bestand basierend auf Bewegungstyp
            if (movementData.movement_type === 'purchase' || movementData.movement_type === 'initial') {
                // Beschaffung oder Startbestand - immer positiv
                quantity = Math.abs(quantity);
                newStock = oldStock + quantity;
            } else if (movementData.movement_type === 'correction') {
                // Korrektur - kann positiv oder negativ sein
                newStock = oldStock + quantity;
                if (newStock < 0) {
                    return res.status(400).json({ error: 'Bestand kann nicht negativ werden' });
                }
            } else {
                return res.status(400).json({ error: 'UngÃ¼ltiger Bewegungstyp' });
            }

            // Bestand im Produkt aktualisieren
            const { error: updateError } = await supabase
                .from('products')
                .update({ stock: newStock })
                .eq('id', movementData.product_id);
            
            if (updateError) throw updateError;

            // Bestandsbewegung aufzeichnen
            const { data: movement, error: movementError } = await supabase
                .from('stock_movements')
                .insert({
                    product_id: movementData.product_id,
                    product_name: product.name,
                    movement_type: movementData.movement_type,
                    quantity: quantity,
                    stock_before: oldStock,
                    stock_after: newStock,
                    reason: movementData.reason || null,
                    reference: movementData.reference || null,
                    cost_per_unit: movementData.cost_per_unit || null,
                    total_cost: movementData.total_cost || null,
                    created_by: movementData.created_by || 'admin'
                })
                .select()
                .single();
            
            if (movementError) throw movementError;

            return res.status(201).json({
                movement: movement,
                newStock: newStock
            });
        }

        // DELETE /stock-movements/{id} - Bestandsbewegung lÃ¶schen
        if (pathParts[0] === 'stock-movements' && pathParts[1] && method === 'DELETE') {
            const movementId = parseInt(pathParts[1]);
            
            if (isNaN(movementId)) {
                return res.status(400).json({ error: 'UngÃ¼ltige Bewegungs-ID' });
            }

            // Bewegung laden
            const { data: movement, error: fetchError } = await supabase
                .from('stock_movements')
                .select('*')
                .eq('id', movementId)
                .single();
            
            if (fetchError) {
                if (fetchError.code === 'PGRST116') {
                    return res.status(404).json({ error: 'Bestandsbewegung nicht gefunden' });
                }
                throw fetchError;
            }

            // VerkÃ¤ufe kÃ¶nnen nicht gelÃ¶scht werden (nur Ã¼ber Transaktion)
            if (movement.movement_type === 'sale') {
                return res.status(400).json({ error: 'Verkaufsbewegungen kÃ¶nnen nicht direkt gelÃ¶scht werden' });
            }

            // LÃ¶sche die Bewegung
            const { error: deleteError } = await supabase
                .from('stock_movements')
                .delete()
                .eq('id', movementId);
            
            if (deleteError) throw deleteError;

            // Bestand zurÃ¼ckrechnen
            const { data: product } = await supabase
                .from('products')
                .select('stock')
                .eq('id', movement.product_id)
                .single();
            
            if (product) {
                const newStock = product.stock - movement.quantity;
                await supabase
                    .from('products')
                    .update({ stock: newStock >= 0 ? newStock : 0 })
                    .eq('id', movement.product_id);
            }

            return res.status(200).json({ 
                message: 'Bestandsbewegung erfolgreich gelÃ¶scht',
                movement: movement
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
                // Alle vorhandenen Einstellungen lÃ¶schen und neue einfÃ¼gen
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

        // ============ BILLINGS ENDPUNKTE ============

// GET /billings - Alle Abrechnungen
if (path === '/billings' && method === 'GET') {
    const { data, error } = await supabase
        .from('billings')
        .select('*')
        .order('created_at', { ascending: false });
    
    if (error) throw error;
    return res.status(200).json(data || []);
}

// POST /billings - Neue Abrechnung erstellen
if (path === '/billings' && method === 'POST') {
    const billingData = req.body;
    
    const { data, error } = await supabase
        .from('billings')
        .insert([billingData])
        .select()
        .single();
    
    if (error) throw error;
    return res.status(201).json(data);
}

// GET /billings/{id}/transactions - Transaktionen einer Abrechnung
if (pathParts[0] === 'billings' && pathParts[1] && pathParts[2] === 'transactions' && method === 'GET') {
    const billingId = parseInt(pathParts[1]);
    
    const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('billing_id', billingId)
        .order('created_at', { ascending: false });
    
    if (error) throw error;
    return res.status(200).json(data || []);
}

// POST /transactions/mark-billed - Transaktionen als abgerechnet markieren
if (path === '/transactions/mark-billed' && method === 'POST') {
    const { billing_id, user_ids } = req.body;
    
    const { data, error } = await supabase
        .from('transactions')
        .update({ 
            billing_id: billing_id,
            is_billed: true 
        })
        .in('user_id', user_ids)
        .is('billing_id', null);  // Nur Transaktionen ohne billing_id markieren
    
    if (error) throw error;
    return res.status(200).json({ message: 'Transaktionen markiert' });
}        
        // ============ SEPA ENDPUNKTE ============
        
        // GET /sepa-users - SEPA-fÃ¤hige Benutzer
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

// GET /users/id/{id} - Benutzer per ID
if (pathParts[0] === 'users' && pathParts[1] === 'id' && pathParts[2] && method === 'GET') {
    const userId = parseInt(pathParts[2]);
    
    if (isNaN(userId)) {
        return res.status(400).json({ error: 'UngÃ¼ltige Benutzer-ID' });
    }
    
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();
    
    if (error) {
        if (error.code === 'PGRST116') {
            return res.status(404).json({ error: 'Benutzer nicht gefunden' });
        }
        throw error;
    }
    
    return res.status(200).json(data);
}

// GET /users/{barcode} - Benutzer per Barcode
if (pathParts[0] === 'users' && pathParts[1] && method === 'GET') {
    const barcode = pathParts[1].toUpperCase();
    
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .contains('barcodes', [barcode])
        .single();
    
    if (error) {
        if (error.code === 'PGRST116') {
            return res.status(404).json({ error: 'Benutzer nicht gefunden' });
        }
        throw error;
    }
    
    return res.status(200).json(data);
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
