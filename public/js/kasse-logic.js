// ============ SAARCADE KASSENSYSTEM LOGIK ============
console.log('🎮 Kasse-Logic wird geladen...');

class SaarcadeKasse {
    constructor() {
        this.products = [];
        this.users = [];
        this.currentUser = null;
        this.cart = [];
        this.currentFilter = 'all';
        
        this.initialize();
    }

    async initialize() {
        console.log('🎮 Saarcade Kasse wird initialisiert...');
        
        try {
            await this.loadData();
            this.setupEventListeners();
            this.renderProducts();
            this.updateUI();
            this.showStatus('System bereit - Mitglied scannen zum Starten', 'info');
            console.log('✅ Kasse erfolgreich initialisiert');
        } catch (error) {
            console.error('❌ Initialisierungsfehler:', error);
            this.showStatus('Fehler beim Laden der Daten: ' + error.message, 'error');
        }
    }

    async loadData() {
        const [productsResponse, usersResponse] = await Promise.all([
            fetch('/api/products'),
            fetch('/api/users')
        ]);

        if (!productsResponse.ok || !usersResponse.ok) {
            throw new Error('Daten konnten nicht geladen werden');
        }

        this.products = await productsResponse.json();
        this.users = await usersResponse.json();
        
        console.log(`📦 ${this.products.length} Produkte geladen`);
        console.log(`👥 ${this.users.length} Benutzer geladen`);
    }

    setupEventListeners() {
        const barcodeInput = document.getElementById('barcodeInput');
        
        barcodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.processBarcodeInput(e.target.value.trim());
                e.target.value = '';
                hideUserDropdown();
            }
        });

        barcodeInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            if (query.length >= 1 && !this.currentUser) {
                showUserDropdown(query);
            } else {
                hideUserDropdown();
            }
        });

        // Auto-focus für Scanner
        barcodeInput.focus();
        
        // Fokus behalten
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.scanner-area') && !e.target.closest('.user-dropdown')) {
                setTimeout(() => barcodeInput.focus(), 100);
            }
        });
    }

    async processBarcodeInput(input) {
        if (!input) return;

        console.log('🔍 Verarbeite Eingabe:', input);

        if (!this.currentUser) {
            // Benutzer suchen
            const user = this.users.find(u => 
                u.barcode === input || 
                u.full_name.toLowerCase() === input.toLowerCase() ||
                u.first_name.toLowerCase() === input.toLowerCase() ||
                u.last_name.toLowerCase() === input.toLowerCase()
            );

            if (user) {
                this.selectUser(user);
                this.showStatus(`Willkommen ${user.full_name}! Jetzt Produkte auswählen.`, 'success');
                this.updateScannerState('product');
            } else {
                this.showStatus('Mitglied nicht gefunden. Bitte erneut versuchen.', 'error');
            }
        } else {
            // Produkt suchen
            try {
                const response = await fetch(`/api/products/barcode/${encodeURIComponent(input)}`);
                const product = await response.json();
                
                if (product) {
                    this.addToCart(product);
                    this.showStatus(`${product.name} hinzugefügt (${this.getCurrentPrice(product).toFixed(2)}€)`, 'success');
                } else {
                    this.showStatus('Produkt nicht gefunden oder nicht verfügbar', 'error');
                }
            } catch (error) {
                this.showStatus('Fehler bei der Produktsuche: ' + error.message, 'error');
            }
        }
    }

    selectUser(user) {
        this.currentUser = user;
        this.updateUI();
        console.log('✅ Benutzer ausgewählt:', user.full_name);
    }

    addToCart(product) {
        const existingItem = this.cart.find(item => item.product.id === product.id);
        
        if (existingItem) {
            existingItem.quantity++;
        } else {
            this.cart.push({
                product: product,
                quantity: 1
            });
        }
        
        this.updateCart();
    }

    removeFromCart(index) {
        const item = this.cart[index];
        if (item.quantity > 1) {
            item.quantity--;
        } else {
            this.cart.splice(index, 1);
        }
        this.updateCart();
    }

    clearCart() {
        this.cart = [];
        this.updateCart();
        this.showStatus('Warenkorb geleert', 'info');
    }

    getCurrentPrice(product) {
        if (!this.currentUser) return product.guest_price;
        return this.currentUser.role === 'member' ? product.member_price : product.guest_price;
    }

    async finalizePurchase() {
        if (this.cart.length === 0 || !this.currentUser) return;

        try {
            let total = 0;
            const items = this.cart.map(item => {
                const price = this.getCurrentPrice(item.product);
                const itemTotal = price * item.quantity;
                total += itemTotal;
                
                return {
                    productId: item.product.id,
                    productName: item.product.name,
                    quantity: item.quantity,
                    price: price,
                    total: itemTotal
                };
            });

            const response = await fetch('/api/transactions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: this.currentUser.id,
                    userName: this.currentUser.full_name,
                    items: items,
                    total: total,
                    paymentMethod: 'account'
                })
            });

            const result = await response.json();
            
            if (response.ok) {
                // Lokalen Saldo aktualisieren
                this.currentUser.balance -= total;
                
                this.showStatus(`Kauf über ${total.toFixed(2)}€ abgeschlossen!`, 'success');
                this.clearCart();
                this.updateUserDisplay();

                // Auto-Abmeldung wenn gewünscht
                if (!this.currentUser.stay_active) {
                    setTimeout(() => {
                        this.resetSession();
                        this.showStatus('Benutzer abgemeldet - Nächsten Mitgliedsausweis scannen', 'info');
                    }, 2000);
                }
            } else {
                this.showStatus('Fehler beim Kaufabschluss: ' + result.error, 'error');
            }
        } catch (error) {
            this.showStatus('Verbindungsfehler: ' + error.message, 'error');
        }
    }

    resetSession() {
        this.currentUser = null;
        this.cart = [];
        this.updateUI();
        this.updateScannerState('user');
        hideUserDropdown();
        document.getElementById('barcodeInput').focus();
    }

    // ============ UI UPDATES ============
    updateUI() {
        this.updateUserDisplay();
        this.updateCart();
        this.updateNoUserOverlay();
        this.updateButtons();
    }

    updateUserDisplay() {
        const userDisplay = document.getElementById('userDisplay');
        
        if (!this.currentUser) {
            userDisplay.className = 'user-display';
            userDisplay.innerHTML = `
                <div class="user-name">Kein Benutzer</div>
                <div class="user-balance">Bitte scannen</div>
                <div class="user-info">Barcode oder Namen eingeben</div>
            `;
            return;
        }

        userDisplay.className = `user-display ${this.currentUser.role}`;
        userDisplay.innerHTML = `
            <div class="user-name">${this.currentUser.full_name}</div>
            <div class="user-balance">${this.currentUser.balance.toFixed(2)}€</div>
            <div class="user-info">${this.getRoleDisplayName(this.currentUser.role)} • ${this.currentUser.stay_active ? 'Bleibt aktiv' : 'Auto-Abmeldung'}</div>
        `;
    }

    updateCart() {
        const cartItemsDiv = document.getElementById('cartItems');
        const cartTotalDiv = document.getElementById('cartTotal');
        
        if (this.cart.length === 0) {
            cartItemsDiv.innerHTML = `
                <div style="text-align: center; color: #718096; margin: 20px 0;">
                    <div style="font-size: 3em; margin-bottom: 10px;">🛒</div>
                    <p>Warenkorb ist leer</p>
                    <p style="font-size: 0.9em;">Produkte durch Klicken hinzufügen</p>
                </div>
            `;
            cartTotalDiv.style.display = 'none';
            return;
        }

        let total = 0;
        let cartHTML = '';
        
        this.cart.forEach((item, index) => {
            const price = this.getCurrentPrice(item.product);
            const itemTotal = price * item.quantity;
            total += itemTotal;
            
            cartHTML += `
                <div class="cart-item">
                    <div class="cart-item-info">
                        <div class="cart-item-name">${item.product.image} ${item.product.name}</div>
                        <div class="cart-item-details">${item.quantity}x ${price.toFixed(2)}€ = ${itemTotal.toFixed(2)}€</div>
                    </div>
                    <div class="cart-item-actions">
                        <button onclick="kasse.removeFromCart(${index})" style="background: #f56565; color: white; border: none; padding: 5px 10px; border-radius: 5px; cursor: pointer; font-size: 0.8em;">−</button>
                    </div>
                </div>
            `;
        });
        
        cartItemsDiv.innerHTML = cartHTML;
        
        const newBalance = this.currentUser ? (this.currentUser.balance - total).toFixed(2) : '0.00';
        const balanceColor = parseFloat(newBalance) >= 0 ? '#38a169' : '#e53e3e';
        
        cartTotalDiv.innerHTML = `
            <div class="cart-total" onclick="kasse.finalizePurchase()">
                <div class="cart-total-amount">${total.toFixed(2)}€</div>
                ${this.currentUser ? `<div style="color: ${balanceColor};">Neuer Saldo: ${newBalance}€</div>` : ''}
                <div class="cart-total-info">💳 Klicken zum Kaufen</div>
            </div>
        `;
        cartTotalDiv.style.display = 'block';
    }

    updateNoUserOverlay() {
        const overlay = document.getElementById('noUserOverlay');
        overlay.style.display = this.currentUser ? 'none' : 'flex';
    }

    updateButtons() {
        const clearCartBtn = document.getElementById('clearCartBtn');
        clearCartBtn.disabled = this.cart.length === 0;
    }

    updateScannerState(mode) {
        const scannerArea = document.getElementById('scannerArea');
        const scannerIcon = document.getElementById('scannerIcon');
        
        scannerArea.classList.remove('active', 'waiting');
        
        if (mode === 'user') {
            scannerIcon.textContent = '👤';
        } else if (mode === 'product') {
            scannerArea.classList.add('active');
            scannerIcon.textContent = '📱';
        }
    }

    // ============ PRODUKT-VERWALTUNG ============
    renderProducts() {
        const grid = document.getElementById('productsGrid');
        
        let filteredProducts = this.currentFilter === 'all' 
            ? this.products 
            : this.products.filter(p => p.category === this.currentFilter);
        
        grid.innerHTML = filteredProducts.map(product => `
            <div class="product-card ${!this.currentUser ? 'disabled' : ''}" 
                 onclick="${this.currentUser ? `kasse.addToCart(${JSON.stringify(product).replace(/"/g, '&quot;')})` : ''}">
                <div class="product-image">${product.image || '📦'}</div>
                <div class="product-name">${product.name}</div>
                <div class="product-price">${this.getCurrentPrice(product).toFixed(2)}€</div>
            </div>
        `).join('');
    }

    filterProducts(category) {
        this.currentFilter = category;
        this.renderProducts();
    }

    // ============ HILFSFUNKTIONEN ============
    getRoleDisplayName(role) {
        const roleNames = {
            'member': 'Mitglied',
            'guest': 'Gast',
            'bartender': 'Barkeeper',
            'admin': 'Vorstand'
        };
        return roleNames[role] || role;
    }

    getRoleIcon(role) {
        const roleIcons = {
            'member': '👥',
            'guest': '👤',
            'bartender': '🍺',
            'admin': '⚙️'
        };
        return roleIcons[role] || '👤';
    }

    showStatus(message, type = 'info') {
        const statusDiv = document.getElementById('statusDisplay');
        statusDiv.className = `status-display status-${type}`;
        statusDiv.textContent = message;
        
        statusDiv.classList.add('show');
        
        setTimeout(() => {
            statusDiv.classList.remove('show');
        }, 4000);
    }
}

// ============ GLOBALE DROPDOWN-FUNKTIONEN ============

// User Dropdown anzeigen
async function showUserDropdown(query) {
    try {
        const response = await fetch(`/api/users/search/${encodeURIComponent(query)}`);
        const filteredUsers = await response.json();
        
        if (filteredUsers.length === 0) {
            hideUserDropdown();
            return;
        }

        const dropdown = document.getElementById('userDropdown');
        if (!dropdown) {
            console.error('User Dropdown Element nicht gefunden');
            return;
        }
        
        dropdown.innerHTML = filteredUsers.slice(0, 5).map(user => `
            <div class="user-dropdown-item" onclick="selectUserFromDropdown(${user.id})">
                <div class="user-dropdown-avatar">${user.first_name.charAt(0)}</div>
                <div class="user-dropdown-info">
                    <div class="user-dropdown-name">${getRoleIcon(user.role)} ${user.full_name}</div>
                    <div class="user-dropdown-details">${getRoleDisplayName(user.role)} • ${user.balance.toFixed(2)}€</div>
                </div>
            </div>
        `).join('');
        
        dropdown.classList.add('show');
        console.log('Dropdown angezeigt mit', filteredUsers.length, 'Benutzern');
    } catch (error) {
        console.error('Fehler bei Benutzersuche:', error);
    }
}

// User Dropdown verstecken
function hideUserDropdown() {
    const dropdown = document.getElementById('userDropdown');
    if (dropdown) {
        dropdown.classList.remove('show');
    }
}

// User aus Dropdown auswählen
function selectUserFromDropdown(userId) {
    console.log('Benutzer ausgewählt:', userId);
    
    if (typeof kasse !== 'undefined' && kasse.users) {
        const user = kasse.users.find(u => u.id === userId);
        if (user) {
            kasse.selectUser(user);
            kasse.showStatus(`${user.full_name} ausgewählt! Jetzt Produkte scannen.`, 'success');
            kasse.updateScannerState('product');
            document.getElementById('barcodeInput').value = '';
            hideUserDropdown();
        }
    } else {
        console.error('Kasse-Objekt nicht verfügbar');
    }
}

// Hilfsfunktionen für Rollen
function getRoleIcon(role) {
    const roleIcons = {
        'member': '👥',
        'guest': '👤', 
        'bartender': '🍺',
        'admin': '⚙️'
    };
    return roleIcons[role] || '👤';
}

function getRoleDisplayName(role) {
    const roleNames = {
        'member': 'Mitglied',
        'guest': 'Gast',
        'bartender': 'Barkeeper',
        'admin': 'Vorstand'
    };
    return roleNames[role] || role;
}

// ============ GLOBALE UI-FUNKTIONEN ============
function focusScanner() {
    document.getElementById('barcodeInput').focus();
}

function filterProducts(category) {
    kasse.filterProducts(category);
    
    // Tab-Status aktualisieren
    document.querySelectorAll('.category-tab').forEach(tab => tab.classList.remove('active'));
    event.target.classList.add('active');
}

function clearCart() {
    kasse.clearCart();
}

function resetSession() {
    kasse.resetSession();
}

console.log('✅ Kasse-Logic erfolgreich geladen!');
