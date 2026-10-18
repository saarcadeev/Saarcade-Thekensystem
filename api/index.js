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

// ============ KLEIDUNG: POSITIONEN (Status je Artikel) ============
// Eine Position = ein Stück einer Bestellung. Bestand wird bei der Bestellung abgebucht
// (SQL-Funktionen aus sql/kleidung_etappe2.sql).
const POSITION_STATUSES = ['bestellt', 'fehlt', 'abholbereit', 'ausgegeben', 'storniert'];
const POSITION_OPEN_STATUSES = ['bestellt', 'fehlt', 'abholbereit'];

// Positionen einer Bestellung laden; null, wenn die Tabelle (noch) nicht existiert
async function loadOrderPositions(orderId) {
    const { data, error } = await supabase
        .from('clothing_order_positions')
        .select('*')
        .eq('order_id', orderId)
        .order('id');
    if (error) {
        console.error('Positionen laden fehlgeschlagen:', error.message);
        return null;
    }
    return data || [];
}

// Bestand für eine Position ab- (book = true) oder zurückbuchen (false)
async function positionStock(positionId, book) {
    const { error } = await supabase.rpc('clothing_position_stock', { p_position_id: positionId, p_book: book });
    if (error) throw error;
}

// Größe/Farbe einer Position ändern: alten Bestand zurück-, neuen abbuchen
async function changePositionVariant(pos, size, color) {
    const newSize = size !== undefined ? (size || null) : pos.size;
    const newColor = color !== undefined ? (color || null) : pos.color;
    if (newSize === pos.size && newColor === pos.color) return pos;
    const wasBooked = pos.stock_booked;
    if (wasBooked) await positionStock(pos.id, false);
    const { data, error } = await supabase
        .from('clothing_order_positions')
        .update({ size: newSize, color: newColor, updated_at: new Date().toISOString() })
        .eq('id', pos.id)
        .select()
        .single();
    if (error) throw error;
    if (wasBooked) await positionStock(pos.id, true);
    return data;
}

// Eine Position ändern (Status, Größe, Farbe, Notiz, Berechnet) inkl. Bestandsbuchung
async function updatePosition(positionId, changes) {
    const { data: pos, error: loadError } = await supabase
        .from('clothing_order_positions')
        .select('*')
        .eq('id', positionId)
        .single();
    if (loadError || !pos) {
        const err = new Error('Position nicht gefunden');
        err.statusCode = 404;
        throw err;
    }
    if (changes.status !== undefined && !POSITION_STATUSES.includes(changes.status)) {
        const err = new Error('Ungültiger Status: ' + changes.status);
        err.statusCode = 400;
        throw err;
    }

    if (changes.size !== undefined || changes.color !== undefined) {
        await changePositionVariant(pos, changes.size, changes.color);
    }

    const now = new Date().toISOString();
    const fields = { updated_at: now };
    if (changes.status !== undefined && changes.status !== pos.status) {
        fields.status = changes.status;
        if (changes.status === 'abholbereit') fields.ready_at = now;
        fields.delivered_at = changes.status === 'ausgegeben' ? now : null;
        // Stornieren bucht zurück, Reaktivieren bucht wieder ab
        if (changes.status === 'storniert') await positionStock(pos.id, false);
        if (pos.status === 'storniert') await positionStock(pos.id, true);
    }
    if (changes.notes !== undefined) fields.notes = changes.notes || null;
    if (changes.billed !== undefined) {
        fields.billed = !!changes.billed;
        fields.billed_at = changes.billed ? now : null;
        if (changes.billing_id !== undefined) fields.billing_id = changes.billing_id || null;
    }

    const { data, error } = await supabase
        .from('clothing_order_positions')
        .update(fields)
        .eq('id', positionId)
        .select()
        .single();
    if (error) throw error;
    return data;
}

// Status/billed der Bestellung aus den Positionen ableiten, damit die bisherigen Seiten stimmen
async function syncOrderFromPositions(orderId) {
    const positions = await loadOrderPositions(orderId);
    if (!positions || positions.length === 0) return;
    const { data: order } = await supabase
        .from('clothing_orders')
        .select('status, billed')
        .eq('id', orderId)
        .single();
    if (!order) return;

    const active = positions.filter(p => p.status !== 'storniert');
    const fields = {};
    if (active.length === 0) {
        if (order.status !== 'cancelled') fields.status = 'cancelled';
    } else if (active.every(p => p.status === 'ausgegeben')) {
        const allBilled = active.every(p => p.billed);
        const target = (order.status === 'shipped' && !allBilled) ? 'shipped' : 'completed';
        if (order.status !== target) {
            fields.status = target;
            fields.delivered_at = new Date().toISOString();
        }
    } else if (order.status === 'completed' || order.status === 'cancelled' || order.status === 'shipped') {
        fields.status = 'pending';
    }
    const allBilled = active.length > 0 && active.every(p => p.billed);
    if (!!order.billed !== allBilled) fields.billed = allBilled;

    if (Object.keys(fields).length > 0) {
        fields.updated_at = new Date().toISOString();
        await supabase.from('clothing_orders').update(fields).eq('id', orderId);
    }
}

// Alle Zeilen einer Abfrage seitenweise laden (Supabase liefert max. 1000 pro Abfrage)
async function fetchAllRows(buildQuery) {
    const pageSize = 1000;
    let all = [];
    for (let from = 0; ; from += pageSize) {
        const { data, error } = await buildQuery().range(from, from + pageSize - 1);
        if (error) throw error;
        all = all.concat(data || []);
        if (!data || data.length < pageSize) break;
    }
    return all;
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

// ============ PDF UPLOAD ENDPUNKT ============
        if (path === '/upload-pdf' && method === 'POST') {
            try {
                const { pdf, fileName, itemId } = req.body;
                
                if (!pdf) {
                    return res.status(400).json({ error: 'Keine PDF bereitgestellt' });
                }

                const base64Data = pdf.replace(/^data:application\/pdf;base64,/, '');
                const pdfBuffer = Buffer.from(base64Data, 'base64');
                
                const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
                const uniqueFileName = `${Date.now()}_${itemId}_${safeName}`;
                const filePath = `clothing-pdfs/${uniqueFileName}`;

                const { data: uploadData, error: uploadError } = await supabase.storage
                    .from('clothing-pdfs')
                    .upload(filePath, pdfBuffer, {
                        contentType: 'application/pdf',
                        upsert: true
                    });

                if (uploadError) {
                    console.error('PDF Upload Error:', uploadError);
                    return res.status(500).json({ error: 'Fehler beim Hochladen der PDF' });
                }

                const { data: urlData } = supabase.storage
                    .from('clothing-pdfs')
                    .getPublicUrl(filePath);

                return res.status(200).json({
                    success: true,
                    pdfUrl: urlData.publicUrl,
                    filePath: filePath
                });

            } catch (error) {
                console.error('PDF upload error:', error);
                return res.status(500).json({ error: 'Interner Fehler beim PDF-Upload' });
            }
        }

// ============ CLOTHING PASSWORD CHECK ============
        if (path === '/check-clothing-password' && method === 'POST') {
            const { password } = req.body;
            const correct = process.env.CLOTHING_PASSWORD;
            
            if (!correct) {
                return res.status(500).json({ error: 'Passwort nicht konfiguriert' });
            }
            
            if (password === correct) {
                return res.status(200).json({ success: true });
            } else {
                return res.status(401).json({ error: 'Falsches Passwort' });
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
                .select('id, first_name, last_name, email, role, balance, sepa_active, iban, barcodes, user_pin, pin_require_for_name_search, pin_require_for_barcode, voucher_access')
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
            pin_require_for_barcode: false,
            voucher_access: userData.voucher_access || false
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
            pin_require_for_barcode: userData.pin_require_for_barcode,
            voucher_access: userData.voucher_access
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
                .order('sort_order', { ascending: true })
                .order('name', { ascending: true });
            
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
            image: productData.image || '📦',
            member_price: productData.member_price,
            guest_price: productData.guest_price,
            stock: productData.stock || 0,
            min_stock: productData.min_stock || 5,
            barcodes: productData.barcodes || [],  // Array
            available: productData.available !== false,
            is_favorite: productData.is_favorite || false,
            sort_order: productData.sort_order || 999,
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
            is_favorite: productData.is_favorite,
            sort_order: productData.sort_order,
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
    const userIdParam = url.searchParams.get('user_id');

    // Nur Buchungen eines Accounts (optional nur nicht abgerechnete).
    // Spart der Kasse das Laden aller Buchungen und umgeht die 1000-Zeilen-Grenze von Supabase.
    if (userIdParam) {
        const userId = parseInt(userIdParam);
        if (isNaN(userId)) {
            return res.status(400).json({ error: 'Ungültige Benutzer-ID' });
        }
        const unbilledOnly = url.searchParams.get('unbilled') === 'true';
        // Optional: nur Buchungen nach diesem Zeitpunkt (Barkasse: seit der letzten Abrechnung)
        const since = url.searchParams.get('since');
        if (since && isNaN(Date.parse(since))) {
            return res.status(400).json({ error: 'Ungültiger Zeitpunkt (since)' });
        }
        const pageSize = 1000;
        let all = [];

        for (let from = 0; ; from += pageSize) {
            let userQuery = supabase
                .from('transactions')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .range(from, from + pageSize - 1);

            if (unbilledOnly) {
                userQuery = userQuery.is('billing_id', null).not('is_billed', 'is', true);
            }
            if (since) {
                userQuery = userQuery.gt('created_at', since);
            }

            const { data, error } = await userQuery;
            if (error) throw error;

            all = all.concat(data || []);
            if (!data || data.length < pageSize) break;
        }

        return res.status(200).json({
            transactions: all,
            totalCount: all.length,
            limit: all.length,
            offset: 0
        });
    }

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
            
            console.log('📝 Transaction request:', {
                userId: transactionData.userId,
                itemCount: transactionData.items?.length,
                total: transactionData.total
            });
            
            // Validierung
            if (!transactionData.userId || !transactionData.items || transactionData.items.length === 0) {
                console.error('❌ Validation failed:', transactionData);
                return res.status(400).json({ error: 'Ungültige Transaktionsdaten' });
            }

            try {
                // Verwende atomare DB-Funktion (schneller und sicherer!)
                const { data, error } = await supabase.rpc('create_transaction_atomic', {
                    p_user_id: transactionData.userId,
                    p_user_name: transactionData.userName,
                    p_items: transactionData.items,
                    p_payment_method: transactionData.paymentMethod || 'balance',
                    p_retried: transactionData.retried || false,
                    p_original_timestamp: transactionData.originalTimestamp || null
                });
                
                if (error) {
                    console.error('❌ DB function error:', error);
                    throw error;
                }
                
                // data ist ein Array mit einem Element, das unser JSONB zurückgibt
                const result = data;
                
                console.log('✅ Transaction created:', {
                    userId: transactionData.userId,
                    transactionCount: result.transactions?.length || 0,
                    newBalance: result.newBalance
                });
                
                return res.status(201).json(result);
                
            } catch (error) {
                console.error('❌ Transaction creation failed:', error);
                return res.status(500).json({ 
                    error: 'Transaktion fehlgeschlagen',
                    message: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        }

// POST /transaction-logs - Log für Debugging speichern
        if (path === '/transaction-logs' && method === 'POST') {
            try {
                const logData = req.body;
                
                const { error } = await supabase
                    .from('transaction_attempt_logs')
                    .insert({
                        request_id: logData.requestId,
                        timestamp: logData.timestamp,
                        user_id: logData.userId,
                        user_name: logData.userName,
                        item_count: logData.itemCount,
                        total: logData.total,
                        payment_method: logData.paymentMethod,
                        status: logData.status,
                        duration: logData.duration,
                        error: logData.error,
                        error_type: logData.errorType,
                        response_valid: logData.responseValid
                    });
                
                if (error) throw error;
                
                return res.status(201).json({ success: true });
            } catch (error) {
                // Logging-Fehler nicht weiterwerfen
                console.warn('Log save failed:', error);
                return res.status(200).json({ success: false });
            }
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
        // (nicht für /stats und /member/{id}, die weiter unten stehen)
        if (pathParts[0] === 'clothing-orders' && pathParts.length === 2 && pathParts[1] !== 'stats' && method === 'GET') {
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

            // Positionen anlegen + Bestand abbuchen. Ein Fehler hier darf die Bestellung nicht verhindern.
            try {
                const { error: posError } = await supabase.rpc('clothing_order_create_positions', { p_order_id: data.id });
                if (posError) console.error('Positionen für Bestellung', data.id, 'nicht angelegt:', posError.message);
            } catch (posErr) {
                console.error('Positionen für Bestellung', data.id, 'nicht angelegt:', posErr.message);
            }

            return res.status(201).json(data);
        }

        // PUT /clothing-orders/{id} - Bestellung aktualisieren (Status, Notizen)
        if (pathParts[0] === 'clothing-orders' && pathParts[1] && method === 'PUT') {
            const orderId = parseInt(pathParts[1]);
            const updateData = req.body;
            
            if (isNaN(orderId)) {
                return res.status(400).json({ error: 'UngÃ¼ltige Bestell-ID' });
            }
// Nur die Felder updaten, die tatsächlich mitgesendet wurden
            const updateFields = { updated_at: new Date().toISOString() };
            if (updateData.status !== undefined) updateFields.status = updateData.status;
            if (updateData.notes !== undefined) updateFields.notes = updateData.notes;
            if (updateData.payment_method !== undefined) updateFields.payment_method = updateData.payment_method;
            if (updateData.items !== undefined) updateFields.items = updateData.items;
            if (updateData.billed !== undefined) updateFields.billed = updateData.billed;

            // Bestellungen mit Positionen: Bestand wurde schon bei der Bestellung abgebucht,
            // Änderungen werden unten auf die Positionen übertragen.
            const positions = await loadOrderPositions(orderId);
            const hasPositions = Array.isArray(positions) && positions.length > 0;
            const { data: previousOrder } = await supabase
                .from('clothing_orders')
                .select('status')
                .eq('id', orderId)
                .single();

            // Bei Auslieferung: Bestand automatisch reduzieren + Datum setzen
            // (nur noch für alte Bestellungen ohne Positionen)
            if (updateData.status === 'completed') {
                updateFields.delivered_at = new Date().toISOString();
                const { data: currentOrder } = await supabase
                    .from('clothing_orders')
                    .select('items, status')
                    .eq('id', orderId)
                    .single();
                if (!hasPositions && currentOrder && currentOrder.status !== 'completed' && Array.isArray(currentOrder.items)) {
                    const reductions = {};
                    for (const item of currentOrder.items) {
                        if (item.product_id && item.size) {
                            const key = `${item.product_id}__${item.size}`;
                            reductions[key] = (reductions[key] || 0) + (item.quantity || 1);
                        }
                    }
                    for (const key of Object.keys(reductions)) {
                        const [itemId, size] = key.split('__');
                        const { data: stockRow } = await supabase
                            .from('clothing_stock')
                            .select('id, quantity')
                            .eq('clothing_item_id', parseInt(itemId))
                            .eq('size', size)
                            .single();
                        if (stockRow) {
                            const newQty = Math.max(0, stockRow.quantity - reductions[key]);
                            await supabase
                                .from('clothing_stock')
                                .update({ quantity: newQty, updated_at: new Date().toISOString() })
                                .eq('id', stockRow.id);
                        }
                    }
                }
            }

            const { data, error } = await supabase
                .from('clothing_orders')
                .update(updateFields)
                .eq('id', orderId)
                .select()
                .single();

            if (error) throw error;

            // Änderungen der bisherigen Seiten auf die Positionen übertragen
            if (hasPositions) {
                const now = new Date().toISOString();
                const oldStatus = previousOrder ? previousOrder.status : null;

                // Größe/Farbe geändert (Bearbeiten-Fenster): Bestand umbuchen
                if (Array.isArray(updateData.items)) {
                    for (const pos of positions) {
                        const item = updateData.items[pos.item_index];
                        if (!item) continue;
                        await changePositionVariant(pos, item.size, item.color);
                    }
                }

                const st = updateData.status;
                if (st === 'cancelled') {
                    // Stornieren: nicht ausgegebene Stücke zurückbuchen
                    for (const pos of positions.filter(p => POSITION_OPEN_STATUSES.includes(p.status))) {
                        await positionStock(pos.id, false);
                        await supabase.from('clothing_order_positions')
                            .update({ status: 'storniert', updated_at: now })
                            .eq('id', pos.id);
                    }
                } else if (st === 'shipped' || st === 'completed') {
                    // Ausgeliefert: alle offenen Stücke ausgegeben
                    for (const pos of positions.filter(p => POSITION_OPEN_STATUSES.includes(p.status))) {
                        if (!pos.stock_booked) await positionStock(pos.id, true);
                        await supabase.from('clothing_order_positions')
                            .update({ status: 'ausgegeben', delivered_at: now, updated_at: now })
                            .eq('id', pos.id);
                    }
                }

                // Berechnet: "bezahlt" (admin.html), shipped -> completed (admin.html) oder Haken billed
                let billed;
                if (st === 'paid') billed = true;
                if (st === 'completed' && oldStatus === 'shipped') billed = true;
                if (updateData.billed !== undefined) billed = !!updateData.billed;
                if (billed !== undefined) {
                    await supabase.from('clothing_order_positions')
                        .update({ billed, billed_at: billed ? now : null, updated_at: now })
                        .eq('order_id', orderId)
                        .neq('status', 'storniert')
                        .eq('billed', !billed);
                }

                // Zahlungsart geändert
                if (updateData.payment_method !== undefined) {
                    await supabase.from('clothing_order_positions')
                        .update({ payment_method: updateData.payment_method, updated_at: now })
                        .eq('order_id', orderId);
                }
            }

            return res.status(200).json(data);
        }

// DELETE /clothing-orders/{id} - Bestellung löschen
        if (pathParts[0] === 'clothing-orders' && pathParts[1] && method === 'DELETE') {            const orderId = parseInt(pathParts[1]);

            if (isNaN(orderId)) {
                return res.status(400).json({ error: 'UngÃ¼ltige Bestell-ID' });
            }

            // Nicht ausgegebene Stücke zurückbuchen (Positionen werden mit der Bestellung gelöscht)
            const positions = await loadOrderPositions(orderId);
            if (positions) {
                for (const pos of positions.filter(p => POSITION_OPEN_STATUSES.includes(p.status) && p.stock_booked)) {
                    await positionStock(pos.id, false);
                }
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
            
            if (!itemData.name || itemData.price === undefined || itemData.price === null) {
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
                    pdf_url: itemData.pdf_url || null,
                    sort_order: itemData.sort_order || 0,
                    stock_by_color: !!itemData.stock_by_color
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
            if (itemData.pdf_url !== undefined) updateData.pdf_url = itemData.pdf_url;
            if (itemData.sort_order !== undefined) updateData.sort_order = itemData.sort_order;
            if (itemData.stock_by_color !== undefined) updateData.stock_by_color = !!itemData.stock_by_color;

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
                // Zwei Formate werden geschickt:
                //  - Einzelwert aus der Kasse: { key: 'cash_helper_enabled', value: 'true' }
                //  - Alle Werte aus dem Admin:  { checkout_barcode: '...', creditor_iban: '...', ... }
                // Früher wurden dabei ALLE Einstellungen gelöscht und nur die geschickten neu angelegt.
                // Jetzt werden nur die geschickten Werte aktualisiert bzw. ergänzt, nichts wird gelöscht.
                const isSingle = Object.keys(settingsData).length === 2 &&
                    typeof settingsData.key === 'string' && 'value' in settingsData;
                const entries = isSingle
                    ? [[settingsData.key, settingsData.value]]
                    : Object.entries(settingsData);

                const { data: existing, error: loadError } = await supabase
                    .from('settings')
                    .select('id, key');
                if (loadError) throw loadError;

                for (const [key, rawValue] of entries) {
                    const value = typeof rawValue === 'object' ? JSON.stringify(rawValue) : String(rawValue);
                    const row = (existing || []).find(s => s.key === key);

                    const { error } = row
                        ? await supabase.from('settings').update({ value }).eq('id', row.id)
                        : await supabase.from('settings').insert([{ key, value }]);
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

        // ============ BARKASSEN-ABRECHNUNG ENDPUNKTE ============

// GET /cash-closings - Alle Barkassen-Abrechnungen
if (path === '/cash-closings' && method === 'GET') {
    const { data, error } = await supabase
        .from('cash_closings')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) throw error;
    return res.status(200).json(data || []);
}

// GET /cash-closings/state?bartender_user_id=X&date=YYYY-MM-DD
// Für die Kasse (Raspberry Pi): nur die letzte Abrechnung des Accounts und die Abrechnungen des Tages.
// Muss vor /cash-closings/{id} stehen.
if (pathParts[0] === 'cash-closings' && pathParts[1] === 'state' && method === 'GET') {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const bartenderId = parseInt(url.searchParams.get('bartender_user_id'));
    const date = url.searchParams.get('date');

    if (isNaN(bartenderId) || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
        return res.status(400).json({ error: 'bartender_user_id und date (YYYY-MM-DD) erforderlich' });
    }

    const { data: latestRows, error: latestError } = await supabase
        .from('cash_closings')
        .select('*')
        .eq('bartender_user_id', bartenderId)
        .order('created_at', { ascending: false })
        .limit(1);
    if (latestError) throw latestError;

    const { data: today, error: todayError } = await supabase
        .from('cash_closings')
        .select('*')
        .eq('bartender_user_id', bartenderId)
        .eq('closing_date', date)
        .order('created_at', { ascending: true });
    if (todayError) throw todayError;

    return res.status(200).json({
        latest: (latestRows && latestRows[0]) || null,
        today: today || []
    });
}

// GET /cash-closings/{id} - Einzelne Barkassen-Abrechnung
if (pathParts[0] === 'cash-closings' && pathParts[1] && method === 'GET') {
    const closingId = parseInt(pathParts[1]);

    if (isNaN(closingId)) {
        return res.status(400).json({ error: 'Ungültige ID' });
    }

    const { data, error } = await supabase
        .from('cash_closings')
        .select('*')
        .eq('id', closingId)
        .single();

    if (error) throw error;
    return res.status(200).json(data);
}

// POST /cash-closings - Neue Barkassen-Abrechnung speichern
if (path === '/cash-closings' && method === 'POST') {
    const c = req.body;

    if (!c.event_name || !c.closing_name) {
        return res.status(400).json({ error: 'Veranstaltung und Name der Abrechnung erforderlich' });
    }

    const { data, error } = await supabase
        .from('cash_closings')
        .insert([{
            event_name: c.event_name,
            closing_date: c.closing_date,
            bartender_user_id: c.bartender_user_id || null,
            bartender_name: c.bartender_name || null,
            handover_name: c.handover_name || null,
            closing_name: c.closing_name,
            change_counts: c.change_counts || {},
            change_total: c.change_total || 0,
            cash_counts: c.cash_counts || {},
            cash_total: c.cash_total || 0,
            revenue_counted: c.revenue_counted || 0,
            revenue_system: c.revenue_system || 0,
            difference: c.difference || 0,
            system_breakdown: c.system_breakdown || {},
            // Schichtwechsel / Tagesabschluss (sql/cash_closings_schichten.sql)
            closing_type: c.closing_type === 'shift' ? 'shift' : 'final',
            opening_total: c.opening_total ?? null,
            opening_source_id: c.opening_source_id || null,
            withdrawal: c.withdrawal || 0,
            handover_total: c.handover_total ?? null,
            balance_at_closing: c.balance_at_closing ?? null,
            period_start: c.period_start || null
        }])
        .select()
        .single();

    if (error) throw error;
    return res.status(201).json(data);
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

// ============ CLOTHING STOCK ENDPUNKTE ============

        // GET /clothing-stock - Alle Bestände mit Artikelname
        if (path === '/clothing-stock' && method === 'GET') {
            const { data, error } = await supabase
                .from('clothing_stock')
                .select('*, clothing_items(name, emoji)')
 .order('clothing_item_id').order('size').order('color');
            if (error) throw error;
            return res.status(200).json(data || []);
        }

        // POST /clothing-stock/book - Zugang buchen (Upsert), optional mit Farbe
        // (Farbe zählt nur bei Artikeln mit "Bestand nach Farbe")
        if (path === '/clothing-stock/book' && method === 'POST') {
            const { clothing_item_id, color, quantity } = req.body;
            const size = req.body.size || ''; // leer = Artikel ohne Größen (z. B. Cap)
            if (!clothing_item_id || quantity === undefined) {
                return res.status(400).json({ error: 'clothing_item_id und quantity erforderlich' });
            }
            const qty = parseInt(quantity);
            if (isNaN(qty) || qty <= 0) return res.status(400).json({ error: 'Ungültige Menge' });
            const { data: stockColor, error: colorError } = await supabase
                .rpc('clothing_stock_color', { p_item_id: clothing_item_id, p_color: color || '' });
            if (colorError) throw colorError;
            const { error: bookError } = await supabase.rpc('clothing_stock_adjust', {
                p_item_id: clothing_item_id, p_size: size, p_color: stockColor || '', p_delta: qty
            });
            if (bookError) throw bookError;
            const { data: result, error } = await supabase
                .from('clothing_stock')
                .select('*, clothing_items(name, emoji)')
                .eq('clothing_item_id', clothing_item_id)
                .eq('size', size)
                .eq('color', stockColor || '')
                .order('id')
                .limit(1)
                .single();
            if (error) throw error;
            return res.status(200).json(result);
        }

        // GET /clothing-demand - Bestellbedarf: was fehlt, damit alle offenen Stücke ausgegeben werden können
        // (Bestand ist schon um die offenen Stücke gemindert, negativer Bestand = Bedarf)
        if (path === '/clothing-demand' && method === 'GET') {
            const stock = await fetchAllRows(() => supabase
                .from('clothing_stock')
                .select('*, clothing_items(name, emoji)')
                .order('id'));
            const openPositions = await fetchAllRows(() => supabase
                .from('clothing_order_positions')
                .select('clothing_item_id, stock_size, stock_color, status')
                .in('status', POSITION_OPEN_STATUSES)
                .eq('stock_booked', true)
                .order('id'));

            const rows = {};
            const keyOf = (itemId, size, color) => `${itemId}__${size || ''}__${color || ''}`;
            for (const s of stock) {
                const key = keyOf(s.clothing_item_id, s.size, s.color);
                rows[key] = {
                    clothing_item_id: s.clothing_item_id,
                    name: s.clothing_items ? s.clothing_items.name : null,
                    emoji: s.clothing_items ? s.clothing_items.emoji : null,
                    size: s.size || '',
                    color: s.color || '',
                    stock: (rows[key] ? rows[key].stock : 0) + (s.quantity || 0),
                    open: 0,
                    not_packed: 0
                };
            }
            for (const p of openPositions) {
                const key = keyOf(p.clothing_item_id, p.stock_size, p.stock_color);
                if (!rows[key]) continue; // Bestandszeile entsteht beim Abbuchen, fehlt also nie
                rows[key].open += 1;
                if (p.status !== 'abholbereit') rows[key].not_packed += 1;
            }
            const result = Object.values(rows)
                .map(r => ({ ...r, missing: Math.max(0, -r.stock) }))
                .filter(r => r.open > 0 || r.stock < 0)
                .sort((a, b) => (a.name || '').localeCompare(b.name || '') || a.size.localeCompare(b.size) || a.color.localeCompare(b.color));
            return res.status(200).json(result);
        }

        // ============ CLOTHING POSITIONS (Status je Artikel) ============

        // GET /clothing-positions - Positionen, Filter: ?status=a,b &open=1 &unbilled=1 &member_id= &order_id=
        if (path === '/clothing-positions' && method === 'GET') {
            const query = new URLSearchParams(url.split('?')[1] || '');
            const data = await fetchAllRows(() => {
                let q = supabase.from('clothing_order_positions').select('*');
                if (query.get('status')) q = q.in('status', query.get('status').split(','));
                if (query.get('open') === '1') q = q.in('status', POSITION_OPEN_STATUSES);
                if (query.get('unbilled') === '1') q = q.eq('billed', false).neq('status', 'storniert');
                if (query.get('member_id')) q = q.eq('member_id', parseInt(query.get('member_id')));
                if (query.get('order_id')) q = q.eq('order_id', parseInt(query.get('order_id')));
                return q.order('member_name').order('order_id').order('id');
            });
            return res.status(200).json(data);
        }

        // POST /clothing-positions/update - mehrere Positionen auf einmal ändern
        // Body: { ids: [..], status?, notes?, billed?, billing_id? }
        if (path === '/clothing-positions/update' && method === 'POST') {
            const { ids, ...changes } = req.body || {};
            if (!Array.isArray(ids) || ids.length === 0) {
                return res.status(400).json({ error: 'ids erforderlich' });
            }
            delete changes.size;   // Größe/Farbe nur einzeln ändern
            delete changes.color;
            const updated = [];
            const orderIds = new Set();
            try {
                for (const id of ids) {
                    const pos = await updatePosition(parseInt(id), changes);
                    updated.push(pos);
                    orderIds.add(pos.order_id);
                }
            } catch (e) {
                for (const oid of orderIds) await syncOrderFromPositions(oid);
                if (e.statusCode) return res.status(e.statusCode).json({ error: e.message, updated });
                throw e;
            }
            for (const oid of orderIds) await syncOrderFromPositions(oid);
            return res.status(200).json(updated);
        }

        // PUT /clothing-positions/{id} - eine Position ändern
        // Body: { status?, size?, color?, notes?, billed?, billing_id? }
        if (pathParts[0] === 'clothing-positions' && pathParts.length === 2 && method === 'PUT') {
            const positionId = parseInt(pathParts[1]);
            if (isNaN(positionId)) return res.status(400).json({ error: 'Ungültige ID' });
            try {
                const pos = await updatePosition(positionId, req.body || {});
                await syncOrderFromPositions(pos.order_id);
                return res.status(200).json(pos);
            } catch (e) {
                if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
                throw e;
            }
        }

        // PUT /clothing-stock/{id} - Bestand direkt setzen
        if (pathParts[0] === 'clothing-stock' && pathParts[1] && pathParts[1] !== 'book' && method === 'PUT') {
            const stockId = parseInt(pathParts[1]);
            if (isNaN(stockId)) return res.status(400).json({ error: 'Ungültige ID' });
            const { quantity } = req.body;
            if (quantity === undefined) return res.status(400).json({ error: 'quantity erforderlich' });
            const { data, error } = await supabase
                .from('clothing_stock')
                .update({ quantity: parseInt(quantity), updated_at: new Date().toISOString() })
                .eq('id', stockId)
                .select('*, clothing_items(name, emoji)')
                .single();
            if (error) throw error;
            return res.status(200).json(data);
        }
    
        // ============ FREE SHIRTS ============
        // GET /free-shirts - Alle Einträge
        if (path === '/free-shirts' && method === 'GET') {
            const { data, error } = await supabase
                .from('free_shirts')
                .select('*')
                .order('created_at', { ascending: false });
            if (error) throw error;
            return res.status(200).json(data || []);
        }

        // POST /free-shirts - Neuer Eintrag
        if (path === '/free-shirts' && method === 'POST') {
            const { first_name, last_name, size, color, notes, clothing_item_id } = req.body;
            if (!first_name || !last_name) {
                return res.status(400).json({ error: 'Vorname und Nachname erforderlich' });
            }
            const newShirt = { first_name, last_name, size: size || null, color: color || null, notes: notes || null };
            if (clothing_item_id) newShirt.clothing_item_id = clothing_item_id;
            const { data, error } = await supabase
                .from('free_shirts')
                .insert([newShirt])
                .select()
                .single();
            if (error) throw error;
            return res.status(201).json(data);
        }

        // PUT /free-shirts/{id} - Eintrag aktualisieren (z.B. ausgeliefert)
        if (pathParts[0] === 'free-shirts' && pathParts[1] && method === 'PUT') {
            const shirtId = parseInt(pathParts[1]);
            if (isNaN(shirtId)) return res.status(400).json({ error: 'Ungültige ID' });
            const updateData = req.body;
            const fields = { updated_at: new Date().toISOString() };
            if (updateData.delivered !== undefined)    fields.delivered    = updateData.delivered;
            if (updateData.delivered_at !== undefined) fields.delivered_at = updateData.delivered_at;
            if (updateData.notes !== undefined)        fields.notes        = updateData.notes;
            // Artikel/Größe/Farbe (werden bei "ausgeliefert" für die Bestandsabbuchung gebraucht)
            if (updateData.clothing_item_id !== undefined) fields.clothing_item_id = updateData.clothing_item_id || null;
            if (updateData.size !== undefined)         fields.size         = updateData.size || null;
            if (updateData.color !== undefined)        fields.color        = updateData.color || null;
            const { data, error } = await supabase
                .from('free_shirts')
                .update(fields)
                .eq('id', shirtId)
                .select()
                .single();
            if (error) throw error;

            // Ausgeliefert: Bestand abbuchen (nur mit Artikel); zurückgenommen: zurückbuchen
            if (updateData.delivered !== undefined) {
                const { error: stockError } = await supabase
                    .rpc('clothing_free_shirt_stock', { p_shirt_id: shirtId, p_book: !!updateData.delivered });
                if (stockError) {
                    console.error('Bestandsbuchung Freimitglieder-Shirt fehlgeschlagen:', stockError.message);
                } else {
                    const { data: fresh } = await supabase.from('free_shirts').select('*').eq('id', shirtId).single();
                    if (fresh) return res.status(200).json(fresh);
                }
            }
            return res.status(200).json(data);
        }

        // DELETE /free-shirts/{id} - Eintrag löschen
        if (pathParts[0] === 'free-shirts' && pathParts[1] && method === 'DELETE') {
            const shirtId = parseInt(pathParts[1]);
            if (isNaN(shirtId)) return res.status(400).json({ error: 'Ungültige ID' });
            const { error } = await supabase
                .from('free_shirts')
                .delete()
                .eq('id', shirtId);
            if (error) throw error;
            return res.status(200).json({ message: 'Eintrag gelöscht' });
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
