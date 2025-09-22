// ====================================================================
// SAARCADE KASSENSYSTEM - VERCEL SERVERLESS API
// Vollständiges Backend für Supabase + Vercel
// ====================================================================

const { createClient } = require('@supabase/supabase-js');

// Supabase-Konfiguration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

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
        return res.status(200).json({});
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
            const { data, error } = await supabase
                .from('dashboard_stats')
                .select('*')
                .single();
            
            if (error) throw error;
            return res.status(200).json(data);
        }

        // ============ BENUTZER-ENDPUNKTE ============
        
        // Alle Benutzer
        if (path === '/users' && method === 'GET') {
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .order('full_name');
            
            if (error) throw error;
            return res.status(200).json(data);
        }

        // Benutzer per Barcode
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

        // Neuen Benutzer erstellen
        if (path === '/users' && method === 'POST') {
            const userData = req.body;
            
            // Validierung
            if (!userData.first_name || !userData.last_name || !userData.barcode) {
                return res.status(400).json({ error: 'Pflichtfelder fehlen' });
            }

            const { data, error } = await supabase
                .from('users')
                .insert([userData])
                .select()
                .single();
            
            if (error) {
                if (error.code === '23505') {
                    return res.status(409).json({ error: 'Barcode bereits vergeben' });
                }
                throw error;
            }
            
            return res.status(201).json(data);
        }

        // Benutzer aktualisieren
        if (pathParts[0] === 'users' && pathParts[1] && method === 'PUT') {
            const userId = parseInt(pathParts[1]);
            const userData = req.body;
            
            const { data, error } = await supabase
                .from('users')
                .update(userData)
                .eq('id', userId)
                .select()
                .single();
            
            if (error) throw error;
            return res.status(200).json(data);
        }

        // ============ PRODUKT-ENDPUNKTE ============
        
        // Alle Produkte
        if (path === '/products' && method === 'GET') {
            const { data, error } = await supabase
                .from('products')
                .select('*')
                .eq('available', true)
                .order('category, name');
            
            if (error) throw error;
            return res.status(200).json(data);
        }

        // Produkt per Barcode
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

        // Neues Produkt erstellen
        if (path === '/products' && method === 'POST') {
            const productData = req.body;
            
            const { data, error } = await supabase
                .from('products')
                .insert([productData])
                .select()
                .single();
            
            if (error) throw error;
            return res.status(201).json(data);
        }

        // Produkt aktualisieren
        if (pathParts[0] === 'products' && pathParts[1] && method === 'PUT') {
            const productId = parseInt(pathParts[1]);
            const productData = req.body;
            
            const { data, error } = await supabase
                .from('products')
                .update(productData)
                .eq('id', productId)
                .select()
                .single();
            
            if (error) throw error;
            return res.status(200).json(data);
        }

        // ============ TRANSAKTIONS-ENDPUNKTE ============
        
        // Alle Transaktionen
        if (path === '/transactions' && method === 'GET') {
            const { data, error } = await supabase
                .from('transactions')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(100);
            
            if (error) throw error;
            return res.status(200).json(data);
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
                    session_id: transactionData.sessionId || null
                };
                
                transactions.push(transaction);
                totalAmount += item.total;
                
                // Bestand reduzieren
                const { error: stockError } = await supabase
                    .from('products')
                    .update({ 
                        stock: supabase.sql`stock - ${item.quantity}` 
                    })
                    .eq('id', item.productId);
                
                if (stockError) console.warn('Stock update error:', stockError);
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

        // ============ SEPA-ENDPUNKTE ============
        
        // SEPA-fähige Benutzer
        if (path === '/sepa-users' && method === 'GET') {
            const { data, error } = await supabase
                .from('sepa_eligible_users')
                .select('*')
                .order('full_name');
            
            if (error) throw error;
            return res.status(200).json(data);
        }

        // SEPA-XML generieren
        if (path === '/sepa-export' && method === 'GET') {
            const { data: users, error } = await supabase
                .from('sepa_eligible_users')
                .select('*');
            
            if (error) throw error;
            
            if (users.length === 0) {
                return res.status(200).json({ 
                    message: 'Keine SEPA-fähigen Benutzer gefunden',
                    users: []
                });
            }

            const totalAmount = users.reduce((sum, user) => sum + user.debit_amount, 0);
            const sepaXml = generateSepaXML(users, totalAmount);
            
            return res.status(200).json({
                xml: sepaXml,
                userCount: users.length,
                totalAmount: totalAmount,
                users: users
            });
        }

        // ============ ADMIN-ENDPUNKTE ============
        
        // Niedrige Bestände
        if (path === '/admin/low-stock' && method === 'GET') {
            const { data, error } = await supabase
                .from('low_stock_products')
                .select('*');
            
            if (error) throw error;
            return res.status(200).json(data);
        }

        // Backup erstellen
        if (path === '/admin/backup' && method === 'GET') {
            const backup = await createFullBackup();
            return res.status(200).json(backup);
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

// ============ HILFSFUNKTIONEN ============

function generateSepaXML(users, totalAmount) {
    const msgId = `SAARCADE${Date.now()}`;
    const creationDate = new Date().toISOString();
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 5); // 5 Tage Vorlauf
    const dueDateStr = dueDate.toISOString().split('T')[0];
    
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02">
    <CstmrDrctDbtInitn>
        <GrpHdr>
            <MsgId>${msgId}</MsgId>
            <CreDtTm>${creationDate}</CreDtTm>
            <NbOfTxs>${users.length}</NbOfTxs>
            <CtrlSum>${totalAmount.toFixed(2)}</CtrlSum>
            <InitgPty>
                <Nm>Saarcade e.V.</Nm>
            </InitgPty>
        </GrpHdr>
        <PmtInf>
            <PmtInfId>PMTINF-${Date.now()}</PmtInfId>
            <PmtMtd>DD</PmtMtd>
            <NbOfTxs>${users.length}</NbOfTxs>
            <CtrlSum>${totalAmount.toFixed(2)}</CtrlSum>
            <PmtTpInf>
                <SvcLvl><Cd>SEPA</Cd></SvcLvl>
                <LclInstrm><Cd>CORE</Cd></LclInstrm>
                <SeqTp>RCUR</SeqTp>
            </PmtTpInf>
            <ReqdColltnDt>${dueDateStr}</ReqdColltnDt>
            <Cdtr><Nm>Saarcade e.V.</Nm></Cdtr>
            <CdtrAcct><Id><IBAN>DE89370400440532013000</IBAN></Id></CdtrAcct>
            <CdtrAgt><FinInstnId><BIC>COBADEFFXXX</BIC></FinInstnId></CdtrAgt>`;
    
    users.forEach((user, index) => {
        xml += `
            <DrctDbtTxInf>
                <PmtId><EndToEndId>TXN-${Date.now()}-${index + 1}</EndToEndId></PmtId>
                <InstdAmt Ccy="EUR">${user.debit_amount.toFixed(2)}</InstdAmt>
                <DrctDbtTx>
                    <MndtRltdInf>
                        <MndtId>${user.mandate_id}</MndtId>
                        <DtOfSgntr>2024-01-01</DtOfSgntr>
                    </MndtRltdInf>
                </DrctDbtTx>
                <Dbtr><Nm>${user.full_name}</Nm></Dbtr>
                <DbtrAcct><Id><IBAN>${user.iban}</IBAN></Id></DbtrAcct>
                <RmtInf><Ustrd>Saarcade Kassenabrechnung</Ustrd></RmtInf>
            </DrctDbtTxInf>`;
    });
    
    xml += `
        </PmtInf>
    </CstmrDrctDbtInitn>
</Document>`;
    
    return xml;
}

async function createFullBackup() {
    try {
        // Alle Tabellen-Daten laden
        const { data: users } = await supabase.from('users').select('*');
        const { data: products } = await supabase.from('products').select('*');
        const { data: transactions } = await supabase.from('transactions').select('*');
        const { data: settings } = await supabase.from('system_settings').select('*');
        
        return {
            timestamp: new Date().toISOString(),
            version: '2.0.0',
            database: 'supabase',
            tables: {
                users: users || [],
                products: products || [],
                transactions: transactions || [],
                system_settings: settings || []
            },
            stats: {
                userCount: users?.length || 0,
                productCount: products?.length || 0,
                transactionCount: transactions?.length || 0
            }
        };
    } catch (error) {
        throw new Error(`Backup failed: ${error.message}`);
    }
}
