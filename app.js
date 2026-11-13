// ========== Food Store - App Principal ==========
// Maneja: catálogo con filtros, carrito (localStorage), checkout, pago simulado

const API_BASE = '/api';
const CART_STORAGE_KEY = 'food_store_cart';
const TOKEN_STORAGE_KEY = 'food_store_token';
const COSTO_ENVIO = 3.00;

// ---------- Utilidades ----------
function showToast(message, type = 'info') {
  // Crear toast temporal
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 1000;
    padding: 12px 20px; border-radius: 8px; font-weight: 500;
    background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
    color: white; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    animation: slideIn 0.3s ease;
  `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Agregar keyframes para toast si no existen
if (!document.getElementById('toast-styles')) {
  const style = document.createElement('style');
  style.id = 'toast-styles';
  style.textContent = `
    @keyframes slideIn { from { opacity: 0; transform: translateX(100px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes slideOut { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(100px); } }
  `;
  document.head.appendChild(style);
}

// Agregar estilos para modal de pago si no existen
if (!document.getElementById('payment-modal-styles')) {
  const style = document.createElement('style');
  style.id = 'payment-modal-styles';
  style.textContent = `
    .payment-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 300;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      animation: fadeIn 0.2s ease;
    }
    .payment-modal {
      background: #fff;
      border-radius: 16px;
      padding: 2rem;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25);
      animation: slideUp 0.3s ease;
    }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
    @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    .payment-modal h2 { font-size: 1.5rem; color: #111827; margin-bottom: 0.5rem; text-align: center; }
    .payment-modal .order-info { background: #f9fafb; border-radius: 10px; padding: 1rem; margin-bottom: 1.5rem; }
    .payment-modal .order-info p { margin: 0.5rem 0; font-size: 0.95rem; }
    .payment-modal .order-info .label { color: #6b7280; font-weight: 500; }
    .payment-modal .order-info .value { color: #111827; font-weight: 600; float: right; }
    .payment-modal .total-row { border-top: 1px solid #e5e7eb; padding-top: 0.75rem; margin-top: 0.75rem; font-size: 1.1rem; }
    .payment-modal .total-row .value { color: #2563eb; font-size: 1.25rem; }
    .payment-modal .warning { background: #fef3c7; border: 1px solid #fcd34d; color: #92400e; padding: 0.75rem; border-radius: 8px; font-size: 0.85rem; margin-bottom: 1.5rem; text-align: center; }
    .payment-modal .btn-group { display: flex; gap: 0.75rem; }
    .payment-modal .btn { flex: 1; padding: 0.85rem; border: none; border-radius: 8px; font-weight: 600; font-size: 1rem; cursor: pointer; transition: background 0.2s; }
    .payment-modal .btn-approve { background: #10b981; color: #fff; }
    .payment-modal .btn-approve:hover:not(:disabled) { background: #059669; }
    .payment-modal .btn-reject { background: #ef4444; color: #fff; }
    .payment-modal .btn-reject:hover:not(:disabled) { background: #dc2626; }
    .payment-modal .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .payment-modal .result-message { text-align: center; padding: 1rem; border-radius: 8px; margin-top: 1rem; display: none; }
    .payment-modal .result-message.success { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; }
    .payment-modal .result-message.error { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
    .payment-modal .retry-btn { margin-top: 1rem; background: #2563eb; color: #fff; border: none; padding: 0.75rem 1.5rem; border-radius: 8px; font-weight: 600; cursor: pointer; display: none; }
    .payment-modal .retry-btn:hover { background: #1d4ed8; }
  `;
  document.head.appendChild(style);
}

async function fetchAPI(endpoint, options = {}) {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ---------- Estado global ----------
let state = {
  products: [],
  categories: [],
  cart: [],
  currentUser: null,
  filters: { q: '', categoria: '' },
  orders: [],
  currentClientTab: 'mis-pedidos',
  cancelOrderId: null
};

// ---------- Carrito (localStorage) ----------
function loadCart() {
  try {
    const stored = localStorage.getItem(CART_STORAGE_KEY);
    state.cart = stored ? JSON.parse(stored) : [];
  } catch { state.cart = []; }
}

function saveCart() {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart));
  updateCartCount();
}

function updateCartCount() {
  const countEl = document.getElementById('cartCount');
  if (countEl) {
    const totalItems = state.cart.reduce((sum, item) => sum + item.cantidad, 0);
    countEl.textContent = totalItems;
    countEl.style.display = totalItems > 0 ? 'inline-flex' : 'none';
  }
}

function addToCart(product, quantity = 1) {
  const existing = state.cart.find(item => item.producto_id === product.id);
  if (existing) {
    existing.cantidad += quantity;
  } else {
    state.cart.push({
      producto_id: product.id,
      nombre: product.nombre,
      precio: parseFloat(product.precio),
      imagen_url: product.imagen_url,
      cantidad: quantity
    });
  }
  saveCart();
  renderCart();
  showToast(`"${product.nombre}" agregado al carrito`, 'success');
}

function updateCartQuantity(producto_id, delta) {
  const item = state.cart.find(i => i.producto_id === producto_id);
  if (!item) return;
  item.cantidad += delta;
  if (item.cantidad <= 0) {
    state.cart = state.cart.filter(i => i.producto_id !== producto_id);
  }
  saveCart();
  renderCart();
}

function removeFromCart(producto_id) {
  state.cart = state.cart.filter(i => i.producto_id !== producto_id);
  saveCart();
  renderCart();
}

function clearCart() {
  state.cart = [];
  saveCart();
  renderCart();
}

function getCartSubtotal() {
  return state.cart.reduce((sum, item) => sum + item.precio * item.cantidad, 0);
}

function getCartTotal() {
  return getCartSubtotal() + COSTO_ENVIO;
}

// ---------- Autenticación ----------
function getToken() { return localStorage.getItem(TOKEN_STORAGE_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_STORAGE_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_STORAGE_KEY); }

async function checkSession() {
  const token = getToken();
  if (!token) { updateAuthUI(null); return; }

  const res = await fetchAPI('/auth/me');
  if (res.ok && res.data.authenticated) {
    state.currentUser = res.data.data;
    updateAuthUI(state.currentUser);
  } else {
    clearToken();
    updateAuthUI(null);
  }
}

function updateAuthUI(user) {
  const guestEl = document.getElementById('auth-header-guest');
  const authEl = document.getElementById('auth-header');
  const authSection = document.getElementById('authSection');
  const cartBtn = document.getElementById('btnCartToggle');
  const filtersSection = document.getElementById('filtersSection');
  const productsSection = document.getElementById('productsSection');
  const checkoutLoginPrompt = document.getElementById('checkoutLoginPrompt');
  const checkoutForm = document.getElementById('checkoutForm');
  const ordersSection = document.getElementById('ordersSection');

  if (user) {
    guestEl.style.display = 'none';
    authEl.style.display = 'flex';
    document.getElementById('user-name').textContent = user.nombre;
    const badge = document.getElementById('user-badge');
    badge.textContent = user.rol;
    badge.className = `user-badge badge-${user.rol}`;
    authSection.style.display = 'none';
    cartBtn.style.display = 'flex';
    filtersSection.style.display = 'block';
    productsSection.classList.add('visible');
    loadProducts();
    // Checkout UI
    if (user.rol === 'cliente') {
      checkoutLoginPrompt.style.display = 'none';
      checkoutForm.classList.add('visible');
      ordersSection.style.display = 'block';
      // Cargar pedidos al cambiar a la pestaña
      if (state.currentClientTab === 'mis-pedidos') {
        loadMyOrders();
      } else if (state.currentClientTab === 'mi-perfil') {
        loadMyProfile();
      }
    } else {
      checkoutLoginPrompt.style.display = 'block';
      checkoutForm.classList.remove('visible');
      ordersSection.style.display = 'none';
    }
  } else {
    guestEl.style.display = 'block';
    authEl.style.display = 'none';
    authSection.style.display = 'block';
    cartBtn.style.display = 'none';
    filtersSection.style.display = 'block';
    productsSection.classList.add('visible');
    loadProducts();
    checkoutLoginPrompt.style.display = 'block';
    checkoutForm.classList.remove('visible');
    ordersSection.style.display = 'none';
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('btnLoginSubmit');
  btn.disabled = true; btn.textContent = 'Ingresando...';
  hideMsg('msg-login');

  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  try {
    const res = await fetchAPI('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    if (res.ok && res.data.success) {
      setToken(res.data.data.token);
      state.currentUser = res.data.data.usuario;
      updateAuthUI(state.currentUser);
      loadProducts();
    } else {
      showMsg('msg-login', res.data.error || 'Email o contraseña incorrectos.');
    }
  } catch (err) {
    showMsg('msg-login', err.name === 'AbortError' ? 'Tiempo de espera agotado.' : err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Iniciar Sesión';
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const btn = document.getElementById('btnRegisterSubmit');
  btn.disabled = true; btn.textContent = 'Creando cuenta...';
  hideMsg('msg-register');

  const nombre = document.getElementById('reg-nombre').value;
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;

  try {
    const res = await fetchAPI('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ nombre, email, password })
    });

    if (res.ok && res.data.success) {
      showMsg('msg-register', 'Cuenta creada correctamente. Ahora puedes iniciar sesión.', 'success');
      document.getElementById('form-register').reset();
      switchAuthTab('login');
    } else {
      showMsg('msg-register', res.data.error || 'Error al registrar.');
    }
  } catch (err) {
    showMsg('msg-register', err.name === 'AbortError' ? 'Tiempo de espera agotado.' : err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Crear Cuenta';
  }
}

async function handleLogout() {
  try { await fetchAPI('/auth/logout', { method: 'POST' }); }
  finally { clearToken(); state.currentUser = null; updateAuthUI(null); }
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById(`form-${tab}`).classList.add('active');
  hideMsg('msg-login'); hideMsg('msg-register');
}

function showAuth() {
  document.getElementById('authSection').style.display = 'block';
  document.getElementById('authSection').scrollIntoView({ behavior: 'smooth' });
}

function fillQuickLogin(email, password, nombre) {
  document.getElementById('login-email').value = email;
  document.getElementById('login-password').value = password;
  showMsg('msg-login', `Credenciales de ${nombre} cargadas.`, 'success');
  switchAuthTab('login');
}

function showMsg(id, text, type = 'error') {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = `msg ${type}`;
  el.style.display = 'block';
}
function hideMsg(id) { document.getElementById(id).style.display = 'none'; }

// ---------- Catálogo ----------
async function loadCategories() {
  try {
    const res = await fetchAPI('/productos');
    if (res.ok) {
      // Extraer categorías únicas de los productos
      const cats = [...new Map(res.data.data.map(p => [p.categoria_id, p.categoria_nombre]).filter(c => c[0])).values()];
      state.categories = cats;
      renderCategoryFilter();
    }
  } catch (e) { console.error('Error cargando categorías:', e); }
}

async function loadProducts() {
  const grid = document.getElementById('productsGrid');
  grid.innerHTML = '<p class="loading">Cargando productos...</p>';

  try {
    const params = new URLSearchParams();
    if (state.filters.q) params.set('q', state.filters.q);
    if (state.filters.categoria) params.set('categoria', state.filters.categoria);

    const res = await fetchAPI(`/productos?${params.toString()}`);
    if (res.ok) {
      state.products = res.data.data;
      renderProducts();
    } else {
      grid.innerHTML = '<p class="error">Error al cargar productos.</p>';
    }
  } catch (e) {
    grid.innerHTML = '<p class="error">Error de conexión.</p>';
  }
}

function renderCategoryFilter() {
  const select = document.getElementById('filter-categoria');
  if (!select) return;
  select.innerHTML = '<option value="">Todas las categorías</option>' +
    state.categories.map(c => `<option value="${c}">${c}</option>`).join('');
}

function renderProducts() {
  const grid = document.getElementById('productsGrid');
  if (state.products.length === 0) {
    grid.innerHTML = '<p class="empty">No hay productos disponibles.</p>';
    return;
  }
  grid.innerHTML = state.products.map(p => `
    <article class="product-card" data-id="${p.id}">
      ${p.imagen_url ? `<img src="${p.imagen_url}" alt="${p.nombre}" class="product-image" onerror="this.style.display='none'">` : ''}
      <h3>${p.nombre}</h3>
      <p class="product-category">${p.categoria_nombre || 'Sin categoría'}</p>
      <p class="product-description">${p.descripcion || ''}</p>
      <div class="product-meta">
        <span class="product-price">S/ ${parseFloat(p.precio).toFixed(2)}</span>
        <span class="product-stock">Stock: ${p.stock}</span>
      </div>
      <button class="btn-add-cart" data-product-id="${p.id}">Agregar al carrito</button>
    </article>
  `).join('');

  // Event delegation para botones "Agregar al carrito"
  grid.querySelectorAll('.btn-add-cart').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const productId = parseInt(e.target.dataset.productId, 10);
      const product = state.products.find(p => p.id === productId);
      if (product) addToCart(product);
    });
  });
}

// ---------- Carrito UI ----------
function renderCart() {
  const container = document.getElementById('cartItems');
  const subtotalEl = document.getElementById('cartSubtotal');
  const shippingEl = document.getElementById('cartShipping');
  const totalEl = document.getElementById('cartTotal');
  const checkoutBtn = document.getElementById('btnCheckout');
  const emptyMsg = document.getElementById('cartEmpty');
  const cartSummary = document.getElementById('cartSummary');
  const checkoutForm = document.getElementById('checkoutForm');
  const loginPrompt = document.getElementById('checkoutLoginPrompt');

  if (state.cart.length === 0) {
    container.innerHTML = '';
    emptyMsg.style.display = 'block';
    cartSummary.style.display = 'none';
    checkoutForm.classList.remove('visible');
    loginPrompt.style.display = 'none';
    return;
  }

  emptyMsg.style.display = 'none';
  cartSummary.classList.add('visible');

  const canCheckout = state.currentUser && state.currentUser.rol === 'cliente';
  if (canCheckout) {
    checkoutForm.classList.add('visible');
    loginPrompt.style.display = 'none';
  } else {
    checkoutForm.classList.remove('visible');
    loginPrompt.style.display = 'block';
  }

  container.innerHTML = state.cart.map(item => `
    <div class="cart-item" data-id="${item.producto_id}">
      <img src="${item.imagen_url || ''}" alt="${item.nombre}" class="cart-item-image" onerror="this.style.display='none'">
      <div class="cart-item-info">
        <h4>${item.nombre}</h4>
        <span class="cart-item-price">S/ ${item.precio.toFixed(2)} c/u</span>
      </div>
      <div class="cart-item-qty">
        <button class="qty-btn" onclick="updateCartQuantity(${item.producto_id}, -1)" aria-label="Disminuir">−</button>
        <span class="qty-value">${item.cantidad}</span>
        <button class="qty-btn" onclick="updateCartQuantity(${item.producto_id}, 1)" aria-label="Aumentar">+</button>
      </div>
      <span class="cart-item-subtotal">S/ ${(item.precio * item.cantidad).toFixed(2)}</span>
      <button class="btn-remove" onclick="removeFromCart(${item.producto_id})" aria-label="Eliminar">✕</button>
    </div>
  `).join('');

  const subtotal = getCartSubtotal();
  subtotalEl.textContent = `S/ ${subtotal.toFixed(2)}`;
  shippingEl.textContent = `S/ ${COSTO_ENVIO.toFixed(2)}`;
  totalEl.textContent = `S/ ${getCartTotal().toFixed(2)}`;

  checkoutBtn.disabled = !canCheckout;
  if (!canCheckout) {
    checkoutBtn.title = state.currentUser ? 'Solo clientes pueden comprar' : 'Inicia sesión como cliente para comprar';
  }
}

function toggleCart() {
  const panel = document.getElementById('cartPanel');
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) renderCart();
}

// ---------- Modal de Pago Simulado ----------
let currentPaymentOrderId = null;

function openPaymentModal(pedidoId, total, items) {
  currentPaymentOrderId = pedidoId;

  // Crear overlay del modal
  const overlay = document.createElement('div');
  overlay.className = 'payment-modal-overlay';
  overlay.id = 'paymentModalOverlay';
  overlay.innerHTML = `
    <div class="payment-modal" id="paymentModal">
      <h2>💳 Pago Simulado</h2>
      <p style="text-align:center; color:#6b7280; margin-bottom:1rem;">Paso final: confirme o rechace el pago del pedido</p>

      <div class="order-info">
        <p><span class="label">N° de Pedido:</span> <span class="value">#${pedidoId}</span></p>
        <p><span class="label">Productos:</span> <span class="value">${items.length} item(s)</span></p>
        <p class="total-row"><span class="label">Total a pagar:</span> <span class="value">S/ ${total.toFixed(2)}</span></p>
      </div>

      <div class="warning">
        ⚠️ Este es un pago <strong>100% simulado</strong>. No se solicitan datos de tarjeta ni se procesan transacciones reales.
      </div>

      <div class="btn-group">
        <button class="btn btn-approve" id="btnApprovePayment" onclick="handlePaymentAction(${pedidoId}, 'aprobar')">Aprobar pago</button>
        <button class="btn btn-reject" id="btnRejectPayment" onclick="handlePaymentAction(${pedidoId}, 'rechazar')">Rechazar pago</button>
      </div>

      <div class="result-message" id="paymentResultMessage"></div>
      <button class="retry-btn" id="paymentRetryBtn" onclick="retryPayment()">Volver a intentar</button>
    </div>
  `;

  document.body.appendChild(overlay);

  // Cerrar al hacer click en overlay (fondo)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closePaymentModal();
  });
}

function closePaymentModal() {
  const overlay = document.getElementById('paymentModalOverlay');
  if (overlay) {
    overlay.style.animation = 'fadeOut 0.2s ease';
    setTimeout(() => overlay.remove(), 200);
  }
  currentPaymentOrderId = null;
}

async function handlePaymentAction(pedidoId, accion) {
  const btnApprove = document.getElementById('btnApprovePayment');
  const btnReject = document.getElementById('btnRejectPayment');
  const resultMsg = document.getElementById('paymentResultMessage');
  const retryBtn = document.getElementById('paymentRetryBtn');

  // Deshabilitar botones durante la petición
  btnApprove.disabled = true;
  btnReject.disabled = true;
  resultMsg.style.display = 'none';
  retryBtn.style.display = 'none';

  try {
    const res = await fetchAPI(`/pedidos/${pedidoId}/pagar`, {
      method: 'POST',
      body: JSON.stringify({ accion })
    });

    if (res.ok && res.data.success) {
      if (accion === 'aprobar') {
        // Pago aprobado - mostrar éxito, actualizar catálogo, cerrar carrito y modal
        resultMsg.className = 'result-message success';
        resultMsg.textContent = `✅ ${res.data.message}`;
        resultMsg.style.display = 'block';

        showToast('¡Pago aprobado! Pedido confirmado y stock actualizado.', 'success');

        // Actualizar catálogo para reflejar nuevo stock
        await loadProducts();

        // Limpiar carrito y cerrar todo
        clearCart();
        document.getElementById('checkoutDireccion').value = '';
        document.getElementById('checkoutTelefono').value = '';
        toggleCart(); // Cerrar panel del carrito

        // Cerrar modal después de 2 segundos
        setTimeout(() => closePaymentModal(), 2000);

      } else {
        // Pago rechazado - mostrar mensaje y permitir reintentar
        resultMsg.className = 'result-message error';
        resultMsg.textContent = `❌ ${res.data.message}`;
        resultMsg.style.display = 'block';
        retryBtn.style.display = 'block';

        showToast('Pago rechazado. El pedido permanece pendiente.', 'error');
      }
    } else {
      // Error del servidor (ej. falta de stock)
      resultMsg.className = 'result-message error';
      resultMsg.textContent = `❌ ${res.data.error || 'Error al procesar el pago'}`;

      // Si es error de stock, mostrar detalles
      if (res.data.data && res.data.data.productos_sin_stock) {
        const detalles = res.data.data.productos_sin_stock.map(p =>
          `"${p.nombre}" (stock: ${p.stock_disponible}, solicitado: ${p.cantidad_solicitada})`
        ).join('; ');
        resultMsg.textContent += `\n\nProductos sin stock: ${detalles}`;
      }

      resultMsg.style.display = 'block';

      if (accion === 'aprobar') {
        // Si falló al aprobar, permitir reintentar
        retryBtn.style.display = 'block';
      } else {
        // Si falló al rechazar (raro), cerrar
        setTimeout(() => closePaymentModal(), 3000);
      }
    }
  } catch (err) {
    resultMsg.className = 'result-message error';
    resultMsg.textContent = `❌ Error de conexión: ${err.message}`;
    resultMsg.style.display = 'block';
    if (accion === 'aprobar') retryBtn.style.display = 'block';
  } finally {
    btnApprove.disabled = false;
    btnReject.disabled = false;
  }
}

function retryPayment() {
  const resultMsg = document.getElementById('paymentResultMessage');
  const retryBtn = document.getElementById('paymentRetryBtn');
  const btnApprove = document.getElementById('btnApprovePayment');
  const btnReject = document.getElementById('btnRejectPayment');

  resultMsg.style.display = 'none';
  retryBtn.style.display = 'none';
  btnApprove.disabled = false;
  btnReject.disabled = false;
}

// ---------- Checkout ----------
async function handleCheckout(e) {
  e.preventDefault();

  if (!state.currentUser || state.currentUser.rol !== 'cliente') {
    showToast('Debes iniciar sesión como cliente para confirmar el pedido', 'error');
    showAuth();
    return;
  }

  if (state.cart.length === 0) {
    showToast('El carrito está vacío', 'error');
    return;
  }

  const direccion = document.getElementById('checkoutDireccion').value.trim();
  const telefono = document.getElementById('checkoutTelefono').value.trim();

  if (!direccion || !telefono) {
    showToast('Dirección y teléfono son obligatorios', 'error');
    return;
  }

  const btn = document.getElementById('btnCheckout');
  btn.disabled = true; btn.textContent = 'Creando pedido...';

  const items = state.cart.map(item => ({
    producto_id: item.producto_id,
    cantidad: item.cantidad
  }));

  try {
    const res = await fetchAPI('/pedidos', {
      method: 'POST',
      body: JSON.stringify({ direccion_envio: direccion, telefono_contacto: telefono, items })
    });

    if (res.ok && res.data.success) {
      const pedido = res.data.data;
      showToast(`¡Pedido #${pedido.pedido_id} creado! Proceda al pago.`, 'success');

      // Abrir modal de pago simulado con los datos del pedido
      openPaymentModal(pedido.pedido_id, pedido.total, pedido.items);

    } else {
      showToast(res.data.error || 'Error al crear el pedido', 'error');
    }
  } catch (err) {
    showToast(err.message || 'Error de conexión', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Confirmar Pedido';
  }
}

// ---------- Pestañas del Cliente (Mis Pedidos / Mi Perfil) ----------
function switchClientTab(tab) {
  state.currentClientTab = tab;
  document.querySelectorAll('.client-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.client-tab-panel').forEach(p => p.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById(`panel-${tab}`).classList.add('active');
  hideMsg('msg-orders');

  if (tab === 'mis-pedidos') {
    loadMyOrders();
  } else if (tab === 'mi-perfil') {
    loadMyProfile();
  }
}

async function loadMyOrders() {
  const listEl = document.getElementById('ordersList');
  const emptyEl = document.getElementById('ordersEmpty');

  listEl.innerHTML = '<p class="loading">Cargando pedidos...</p>';
  emptyEl.style.display = 'none';

  try {
    const res = await fetchAPI('/pedidos/mis-pedidos');
    if (res.ok && res.data) {
      state.orders = res.data;
      renderOrders();
    } else {
      listEl.innerHTML = '<p class="error">Error al cargar pedidos.</p>';
    }
  } catch (e) {
    listEl.innerHTML = '<p class="error">Error de conexión.</p>';
  }
}

function renderOrders() {
  const listEl = document.getElementById('ordersList');
  const emptyEl = document.getElementById('ordersEmpty');

  if (state.orders.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }

  emptyEl.style.display = 'none';

  listEl.innerHTML = state.orders.map(order => `
    <article class="order-card" data-id="${order.pedido_id}">
      <div class="order-header">
        <span class="order-id">Pedido #${order.pedido_id}</span>
        <div class="order-meta">
          <span>📅 ${formatDate(order.fecha_creacion)}</span>
          <span class="order-status status-${order.estado}">${order.estado.replace('_', ' ')}</span>
        </div>
      </div>
      <div class="order-body">
        <div class="order-items">
          ${order.items.map(item => `
            <div class="order-item">
              ${item.imagen_url ? `<img src="${item.imagen_url}" alt="${item.nombre}" class="order-item-image" onerror="this.style.display='none'">` : '<div class="order-item-image" style="display:flex;align-items:center;justify-content:center;color:#9ca3af;">📦</div>'}
              <div class="order-item-info">
                <div class="order-item-name">${item.nombre}</div>
                <div class="order-item-details">${item.cantidad} x S/ ${item.precio_unitario.toFixed(2)}</div>
              </div>
              <div class="order-item-subtotal">S/ ${item.subtotal.toFixed(2)}</div>
            </div>
          `).join('')}
        </div>
        <div class="order-footer">
          <div class="order-total">Total: S/ ${order.total.toFixed(2)}</div>
          <div class="order-actions">
            ${order.estado === 'pendiente' ? `
              <button class="btn-small btn-pay" onclick="openPaymentModalFromOrder(${order.pedido_id})">Pagar ahora</button>
              <button class="btn-small btn-cancel" onclick="openCancelModal(${order.pedido_id})">Cancelar pedido</button>
            ` : ''}
          </div>
        </div>
      </div>
    </article>
  `).join('');
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function openPaymentModalFromOrder(pedidoId) {
  const order = state.orders.find(o => o.pedido_id === pedidoId);
  if (order) {
    openPaymentModal(order.pedido_id, order.total, order.items);
  }
}

// ---------- Modal Cancelar Pedido ----------
function openCancelModal(pedidoId) {
  state.cancelOrderId = pedidoId;

  const overlay = document.createElement('div');
  overlay.className = 'cancel-modal-overlay';
  overlay.id = 'cancelModalOverlay';
  overlay.innerHTML = `
    <div class="cancel-modal">
      <h2>❌ Cancelar Pedido #${pedidoId}</h2>
      <p style="text-align:center; color:#6b7280; margin-bottom:1.5rem;">Indique el motivo de la cancelación</p>
      <form id="cancelForm" onsubmit="handleCancelOrder(event)">
        <div class="form-group">
          <label for="cancelMotivo">Motivo *</label>
          <textarea id="cancelMotivo" required placeholder="Ej: Cambio de opinión, problema con la dirección, etc." aria-label="Motivo de cancelación"></textarea>
        </div>
        <div class="btn-group">
          <button type="submit" class="btn btn-confirm" id="btnConfirmCancel">Confirmar cancelación</button>
          <button type="button" class="btn btn-close" onclick="closeCancelModal()">Cerrar</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeCancelModal();
  });
}

function closeCancelModal() {
  const overlay = document.getElementById('cancelModalOverlay');
  if (overlay) {
    overlay.style.animation = 'fadeOut 0.2s ease';
    setTimeout(() => overlay.remove(), 200);
  }
  state.cancelOrderId = null;
}

async function handleCancelOrder(e) {
  e.preventDefault();

  if (!state.cancelOrderId) return;

  const motivo = document.getElementById('cancelMotivo').value.trim();
  if (!motivo) {
    showToast('El motivo es obligatorio', 'error');
    return;
  }

  const btn = document.getElementById('btnConfirmCancel');
  btn.disabled = true; btn.textContent = 'Cancelando...';

  try {
    const res = await fetchAPI(`/pedidos/${state.cancelOrderId}/cancelar`, {
      method: 'POST',
      body: JSON.stringify({ motivo })
    });

    if (res.ok && res.data.success) {
      showToast('Pedido cancelado correctamente.', 'success');
      closeCancelModal();
      loadMyOrders(); // Recargar lista
    } else {
      showToast(res.data.error || 'Error al cancelar el pedido', 'error');
    }
  } catch (err) {
    showToast(err.message || 'Error de conexión', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Confirmar cancelación';
  }
}

// ---------- Mi Perfil ----------
async function loadMyProfile() {
  try {
    const res = await fetchAPI('/auth/perfil');
    if (res.ok && res.data) {
      const user = res.data;
      document.getElementById('profileAvatar').textContent = user.nombre.charAt(0).toUpperCase();
      document.getElementById('profileName').textContent = user.nombre;
      document.getElementById('profileEmail').textContent = user.email;
      document.getElementById('profileEmailInput').value = user.email;
      document.getElementById('profileNombre').value = user.nombre;
      document.getElementById('profileTelefono').value = user.telefono || '';
      document.getElementById('profileDireccion').value = user.direccion || '';
      document.getElementById('profileRole').textContent = user.rol;
      document.getElementById('profileRole').className = `profile-role role-${user.rol}`;
    } else {
      showMsg('msg-orders', res.data.error || 'Error al cargar perfil', 'error');
    }
  } catch (e) {
    showMsg('msg-orders', 'Error de conexión', 'error');
  }
}

async function handleProfileUpdate(e) {
  e.preventDefault();

  const telefono = document.getElementById('profileTelefono').value.trim();
  const direccion = document.getElementById('profileDireccion').value.trim();

  const btn = document.querySelector('#profileForm .btn-submit');
  btn.disabled = true; btn.textContent = 'Guardando...';

  try {
    const res = await fetchAPI('/auth/perfil', {
      method: 'PUT',
      body: JSON.stringify({ telefono: telefono || null, direccion: direccion || null })
    });

    if (res.ok && res.data.success) {
      showToast('Perfil actualizado correctamente.', 'success');
      // Actualizar datos en la UI
      document.getElementById('profileTelefono').value = res.data.data.telefono || '';
      document.getElementById('profileDireccion').value = res.data.data.direccion || '';
    } else {
      showToast(res.data.error || 'Error al actualizar perfil', 'error');
    }
  } catch (err) {
    showToast(err.message || 'Error de conexión', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar cambios';
  }
}

// ---------- DB Status (legacy) ----------
async function checkStatus() {
  const statusEl = document.getElementById('status');
  const detailEl = document.getElementById('detail');
  statusEl.textContent = 'Consultando...'; statusEl.className = 'status loading'; detailEl.textContent = '';

  try {
    const res = await fetchAPI('/status');
    if (res.data.connected) {
      statusEl.textContent = res.data.message; statusEl.className = 'status ok';
      detailEl.textContent = `Hora: ${res.data.data.hora_servidor} | v${res.data.data.version_postgres?.split(' ')[0] || ''}`;
    } else {
      statusEl.textContent = res.data.message; statusEl.className = 'status.error';
      detailEl.textContent = res.data.error || '';
    }
  } catch (e) {
    statusEl.textContent = 'Error de conexión'; statusEl.className = 'status.error';
    detailEl.textContent = e.message;
  }
}
async function initDB() {
  const btn = document.getElementById('btnInit'); btn.disabled = true; btn.textContent = 'Procesando...';
  try {
    const res = await fetchAPI('/init', { method: 'POST' });
    if (res.data.success) {
      document.getElementById('status').textContent = res.data.message;
      document.getElementById('status').className = 'status ok';
      document.getElementById('detail').textContent = `Registros: ${res.data.total_registros}`;
    }
  } catch (e) { showToast('Error al inicializar', 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Inicializar BD'; }
}
async function runSetup() {
  const btn = document.getElementById('btnSetup'); btn.disabled = true; btn.textContent = 'Procesando...';
  const el = document.getElementById('setup-result'); el.style.display = 'none';
  try {
    const res = await fetchAPI('/setup-db', { method: 'POST' });
    el.style.display = 'block';
    if (res.data.success) {
      el.className = 'detail ok';
      el.innerHTML = `Tablas: ${res.data.data.tablas_creadas.join(', ')}<br>Categorías: ${res.data.data.categorias_insertadas}<br>Productos: ${res.data.data.productos_insertados}<br>Usuarios: ${res.data.data.usuarios_insertados}`;
    } else { el.className = 'detail error'; el.textContent = res.data.error; }
  } catch (e) { el.style.display = 'block'; el.className = 'detail error'; el.textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = 'Ejecutar Setup BD'; }
}

// ---------- Inicialización ----------
document.addEventListener('DOMContentLoaded', () => {
  loadCart();
  updateCartCount();
  checkSession();
  loadCategories();
  loadProducts();

  // Event listeners
  document.getElementById('btnLogout')?.addEventListener('click', (e) => { e.preventDefault(); handleLogout(); });
  document.getElementById('form-login')?.addEventListener('submit', handleLogin);
  document.getElementById('form-register')?.addEventListener('submit', handleRegister);
  document.getElementById('btnRefresh')?.addEventListener('click', checkStatus);
  document.getElementById('btnInit')?.addEventListener('click', initDB);
  document.getElementById('btnSetup')?.addEventListener('click', runSetup);

  // Filtros
  document.getElementById('filter-search')?.addEventListener('input', (e) => {
    state.filters.q = e.target.value;
    loadProducts();
  });
  document.getElementById('filter-categoria')?.addEventListener('change', (e) => {
    state.filters.categoria = e.target.value;
    loadProducts();
  });

  // Carrito
  document.getElementById('btnCartToggle')?.addEventListener('click', toggleCart);
  document.getElementById('cartOverlay')?.addEventListener('click', toggleCart);
  document.getElementById('checkoutForm')?.addEventListener('submit', handleCheckout);
});

// Exponer funciones globales para onclick inline
window.addToCart = addToCart;
window.updateCartQuantity = updateCartQuantity;
window.removeFromCart = removeFromCart;
window.switchAuthTab = switchAuthTab;
window.showAuth = showAuth;
window.fillQuickLogin = fillQuickLogin;
window.toggleCart = toggleCart;
window.handlePaymentAction = handlePaymentAction;
window.retryPayment = retryPayment;
window.closePaymentModal = closePaymentModal;
window.switchClientTab = switchClientTab;
window.openCancelModal = openCancelModal;
window.closeCancelModal = closeCancelModal;
window.handleCancelOrder = handleCancelOrder;
window.handleProfileUpdate = handleProfileUpdate;
window.openPaymentModalFromOrder = openPaymentModalFromOrder;