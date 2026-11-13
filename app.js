// ========== Food Store - App Principal ==========
// Maneja: catálogo con filtros, carrito (localStorage), checkout

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
  filters: { q: '', categoria: '' }
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
    } else {
      checkoutLoginPrompt.style.display = 'block';
      checkoutForm.classList.remove('visible');
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
  btn.disabled = true; btn.textContent = 'Procesando...';

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
      showToast(`¡Pedido #${res.data.data.pedido_id} confirmado! Total: S/ ${res.data.data.total.toFixed(2)}`, 'success');
      clearCart();
      document.getElementById('checkoutDireccion').value = '';
      document.getElementById('checkoutTelefono').value = '';
      toggleCart(); // Cerrar panel
    } else {
      showToast(res.data.error || 'Error al crear el pedido', 'error');
    }
  } catch (err) {
    showToast(err.message || 'Error de conexión', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Confirmar Pedido';
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