/* ============================================================
   KELTO admin console — talks to the real backend (/backend).
   Nothing here touches the storefront pages or their data model;
   it just reads/writes the same products.json / orders.json /
   categories.json / discounts.json through the API.
   ============================================================ */

const LS_BACKEND = 'kelto_admin_backend';
const LS_TOKEN = 'kelto_admin_token';

const $ = sel => document.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const money = n => '₹' + Number(n || 0).toLocaleString('en-IN');
const fmtDate = d => d ? new Date(d).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';

let BACKEND = '', TOKEN = '';
let currentPage = 'dashboard';
let currentRows = []; // rows currently rendered, for client-side search

const loginGate = $('#login-gate');
const app = $('#app');
const backendInput = $('#backend-url-input');
const tokenInput = $('#admin-token-input');

backendInput.value = localStorage.getItem(LS_BACKEND) || (typeof BACKEND_URL !== 'undefined' ? BACKEND_URL : '');

/* ---------- API helper ---------- */
async function apiFetch(path, opts = {}) {
  const res = await fetch(BACKEND + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-admin-token': TOKEN, ...(opts.headers || {}) }
  });
  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) {
    let msg = 'request-failed';
    try { msg = (await res.json()).error || msg; } catch (e) {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

function toast(msg) {
  const t = $('#admin-toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window.__adminToastTimer);
  window.__adminToastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- login ---------- */
$('#login-btn').addEventListener('click', doLogin);
tokenInput.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

async function doLogin() {
  BACKEND = backendInput.value.trim().replace(/\/$/, '');
  TOKEN = tokenInput.value;
  if (!BACKEND) { showLoginError('Enter your backend URL first.'); return; }
  $('#login-btn').textContent = 'Connecting…';
  $('#login-btn').disabled = true;
  try {
    await apiFetch('/api/admin/login', { method: 'POST', body: JSON.stringify({ token: TOKEN }) });
    localStorage.setItem(LS_BACKEND, BACKEND);
    localStorage.setItem(LS_TOKEN, TOKEN);
    enterApp();
  } catch (e) {
    showLoginError(e.message === 'unauthorized' ? 'Wrong admin token.' : `Could not reach the backend at ${BACKEND}.`);
  } finally {
    $('#login-btn').textContent = 'Enter dashboard';
    $('#login-btn').disabled = false;
  }
}

function showLoginError(msg) {
  const el = $('#login-err');
  el.textContent = msg;
  el.style.display = 'block';
}

function enterApp() {
  loginGate.style.display = 'none';
  app.style.display = 'grid';
  $('#admin-conn').textContent = 'Connected · ' + BACKEND.replace(/^https?:\/\//, '');
  go('dashboard');
}

$('#logout-btn').addEventListener('click', () => {
  localStorage.removeItem(LS_TOKEN);
  app.style.display = 'none';
  loginGate.style.display = 'flex';
  tokenInput.value = '';
});

/* Auto-login if we already have a saved token */
(function tryAutoLogin() {
  const savedBackend = localStorage.getItem(LS_BACKEND);
  const savedToken = localStorage.getItem(LS_TOKEN);
  if (savedBackend && savedToken) {
    BACKEND = savedBackend; TOKEN = savedToken;
    apiFetch('/api/admin/login', { method: 'POST', body: JSON.stringify({ token: TOKEN }) })
      .then(enterApp)
      .catch(() => { /* fall back to manual login */ });
  }
})();

/* ---------- nav ---------- */
document.querySelectorAll('#admin-nav button').forEach(b => {
  b.addEventListener('click', () => go(b.dataset.page));
});
$('#admin-menu-toggle').addEventListener('click', () => $('#admin-side').classList.toggle('open'));
$('#admin-search').addEventListener('input', e => filterCurrentTable(e.target.value));

function go(page) {
  currentPage = page;
  document.querySelectorAll('#admin-nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $('#admin-side').classList.remove('open');
  $('#admin-search').value = '';
  const renderers = { dashboard, orders: ordersPage, products: productsPage, categories: categoriesPage, customers: customersPage, discounts: discountsPage, settings: settingsPage };
  (renderers[page] || dashboard)();
}

function filterCurrentTable(q) {
  const tbody = document.getElementById('admin-tbody');
  if (!tbody || !window.__renderRows) return;
  const query = q.trim().toLowerCase();
  const filtered = query ? currentRows.filter(r => JSON.stringify(r).toLowerCase().includes(query)) : currentRows;
  tbody.innerHTML = window.__renderRows(filtered);
  window.__afterRender && window.__afterRender();
}

/* ============================================================
   DASHBOARD
   ============================================================ */
async function dashboard() {
  $('#admin-content').innerHTML = `<div class="admin-heading"><div><h2>Dashboard</h2><p>Live sales, orders and stock overview.</p></div></div><div id="dash-body">Loading…</div>`;
  try {
    const d = await apiFetch('/api/dashboard');
    const maxDaily = Math.max(1, ...d.daily.map(x => x.sales));
    $('#dash-body').innerHTML = `
      <div class="admin-grid4">
        ${metricCard(money(d.metrics.sales), 'Total sales')}
        ${metricCard(d.metrics.orders, 'Orders')}
        ${metricCard(d.metrics.products, 'Products')}
        ${metricCard(d.metrics.customers, 'Customers')}
      </div>
      <div class="admin-dashgrid">
        <div class="admin-card span2">
          <h3>Sales over time</h3>
          ${d.daily.length ? `<div class="admin-chart">${d.daily.map(x => `<div class="admin-bar-wrap"><div class="admin-bar" style="height:${Math.max(4, (x.sales / maxDaily) * 100)}%"></div><span>${esc(x.day.slice(5))}</span></div>`).join('')}</div>` : `<p style="color:var(--text-dim); font-size:13px;">No paid orders yet — this fills in as sales come through Razorpay.</p>`}
        </div>
        <div class="admin-card">
          <h3>Top-selling products</h3>
          <div class="admin-list">${d.top.length ? d.top.map(x => `<div class="admin-list-row"><div><b>${esc(x.product)}</b><div class="sub">${x.qty} sold</div></div><b>${money(x.revenue)}</b></div>`).join('') : emptyRow('No sales yet')}</div>
        </div>
        <div class="admin-card">
          <h3>Low stock</h3>
          <div class="admin-list">${d.low.length ? d.low.map(x => `<div class="admin-list-row"><div><b>${esc(x.name)}</b><div class="sub">${esc(x.category)}</div></div><b style="color:${x.totalStock === 0 ? '#e04b4b' : 'var(--text)'}">${x.totalStock} left</b></div>`).join('') : emptyRow('All stocked up')}</div>
        </div>
        <div class="admin-card span2">
          <div class="admin-toolbar" style="margin-bottom:12px;"><h3 style="margin:0;">Recent orders</h3><button class="btn btn-outline" onclick="go('orders')">View all</button></div>
          ${ordersTable(d.recent)}
        </div>
      </div>`;
  } catch (e) {
    $('#dash-body').innerHTML = errorNote(e);
  }
}
function metricCard(value, label) {
  return `<div class="admin-card"><div class="metric-label">${label}</div><div class="metric-value">${value}</div></div>`;
}
function emptyRow(msg) { return `<p style="color:var(--text-dim); font-size:13px; margin:0;">${msg}</p>`; }
function errorNote(e) { return `<p class="note">Could not load: ${esc(e.message)}</p>`; }

/* ============================================================
   ORDERS
   ============================================================ */
function orderStatusOptions(current) {
  return ['created', 'paid', 'processing', 'shipped', 'delivered', 'cancelled']
    .map(s => `<option value="${s}" ${s === current ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('');
}
function ordersTable(rows) {
  return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Date</th></tr></thead>
    <tbody>${rows.map(o => `<tr>
      <td><b>${esc(o.orderRef)}</b></td>
      <td>${esc(o.customer?.fullName || '—')}<div class="sub" style="color:var(--text-dim); font-size:11.5px;">${esc(o.customer?.email || '')}</div></td>
      <td>${(o.items || []).reduce((n, i) => n + i.qty, 0)} item(s)</td>
      <td>${money(o.total)}</td>
      <td><span class="admin-badge ${esc(o.status)}">${esc(o.status)}</span></td>
      <td>${fmtDate(o.createdAt)}</td>
    </tr>`).join('')}</tbody></table></div>`;
}
async function ordersPage() {
  $('#admin-content').innerHTML = `<div class="admin-heading"><div><h2>Orders</h2><p>Every order placed through checkout, synced live from Razorpay.</p></div></div><div id="orders-body">Loading…</div>`;
  try {
    const rows = await apiFetch('/api/orders');
    currentRows = rows;
    window.__renderRows = renderOrderRows;
    window.__afterRender = bindOrderRowEvents;
    $('#orders-body').innerHTML = `<div class="admin-card"><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Phone</th><th>Items</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody id="admin-tbody">${renderOrderRows(rows)}</tbody></table></div></div>`;
    bindOrderRowEvents();
  } catch (e) {
    $('#orders-body').innerHTML = errorNote(e);
  }
}
function renderOrderRows(rows) {
  if (!rows.length) return `<tr><td colspan="7" style="color:var(--text-dim);">No orders yet.</td></tr>`;
  return rows.map(o => `<tr data-ref="${esc(o.orderRef)}">
    <td><b>${esc(o.orderRef)}</b></td>
    <td>${esc(o.customer?.fullName || '—')}<div style="color:var(--text-dim); font-size:11.5px;">${esc(o.customer?.email || '')}</div></td>
    <td>${esc(o.customer?.phone || '—')}</td>
    <td>${(o.items || []).map(i => `${i.qty}× ${esc(i.id)}${i.size ? ' (' + esc(i.size) + ')' : ''}`).join(', ') || '—'}</td>
    <td>${money(o.total)}</td>
    <td><select class="f-status">${orderStatusOptions(o.status)}</select></td>
    <td>${fmtDate(o.createdAt)}</td>
  </tr>`).join('');
}
function bindOrderRowEvents() {
  document.querySelectorAll('#admin-tbody tr[data-ref]').forEach(row => {
    const ref = row.dataset.ref;
    row.querySelector('.f-status').addEventListener('change', async e => {
      try {
        await apiFetch(`/api/orders/${encodeURIComponent(ref)}`, { method: 'PUT', body: JSON.stringify({ status: e.target.value }) });
        toast('Order status updated');
      } catch (err) { toast('Could not update: ' + err.message); }
    });
  });
}

/* ============================================================
   PRODUCTS
   ============================================================ */
async function productsPage() {
  $('#admin-content').innerHTML = `
    <div class="admin-heading"><div><h2>Products</h2><p>Edit price and stock directly — changes go live on the store immediately.</p></div><button class="btn btn-primary" id="add-product-btn">+ Add product</button></div>
    <div class="admin-card"><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Product</th><th>Category</th><th>Price (₹)</th><th>Old price</th><th>Stock (per size)</th><th>Image</th><th></th></tr></thead><tbody id="admin-tbody">Loading…</tbody></table></div></div>`;
  $('#add-product-btn').addEventListener('click', openAddProductModal);
  try {
    const rows = await apiFetch('/api/products');
    currentRows = rows;
    window.__renderRows = renderProductRows;
    window.__afterRender = bindProductRowEvents;
    $('#admin-tbody').innerHTML = renderProductRows(rows);
    bindProductRowEvents();
  } catch (e) {
    $('#admin-tbody').innerHTML = `<tr><td colspan="7">${errorNote(e)}</td></tr>`;
  }
}
function renderProductRows(products) {
  if (!products.length) return `<tr><td colspan="7" style="color:var(--text-dim);">No products yet.</td></tr>`;
  return products.map(p => `<tr data-id="${esc(p.id)}">
    <td><input type="text" class="f-name" value="${esc(p.name)}"></td>
    <td><select class="f-category">${['tops','bottoms','accessories','caps'].map(c => `<option value="${c}" ${c === p.category ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
    <td><input type="number" class="f-price" value="${p.price}"></td>
    <td><input type="number" class="f-oldprice" value="${p.oldPrice ?? ''}"></td>
    <td><div class="stock-cell">${Object.entries(p.stock || {}).map(([size, qty]) => `<span>${esc(size)}: <input type="number" class="f-stock" data-size="${esc(size)}" value="${qty}"></span>`).join('')}</div></td>
    <td><input type="text" class="f-img" placeholder="Image URL" value="${esc(p.img || '')}" style="min-width:160px;"></td>
    <td><div class="admin-row-actions"><button class="save">Save</button><button class="danger">Delete</button></div></td>
  </tr>`).join('');
}
function bindProductRowEvents() {
  document.querySelectorAll('#admin-tbody tr[data-id]').forEach(row => {
    const id = row.dataset.id;
    row.querySelector('.save').addEventListener('click', async () => {
      const stock = {};
      row.querySelectorAll('.f-stock').forEach(inp => stock[inp.dataset.size] = Number(inp.value));
      const body = {
        name: row.querySelector('.f-name').value,
        category: row.querySelector('.f-category').value,
        price: Number(row.querySelector('.f-price').value),
        oldPrice: row.querySelector('.f-oldprice').value ? Number(row.querySelector('.f-oldprice').value) : null,
        img: row.querySelector('.f-img').value.trim(),
        stock
      };
      try {
        await apiFetch(`/api/products/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) });
        toast('Saved');
      } catch (e) { toast('Could not save: ' + e.message); }
    });
    row.querySelector('.danger').addEventListener('click', async () => {
      if (!confirm('Remove this product from the store?')) return;
      try {
        await apiFetch(`/api/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
        row.remove();
        toast('Deleted');
      } catch (e) { toast('Could not delete: ' + e.message); }
    });
  });
}
function openAddProductModal() {
  openModal(`
    <h3 style="margin-bottom:16px;">Add product</h3>
    <div class="field"><label>Name</label><input id="np-name" type="text"></div>
    <div class="field"><label>Category</label><select id="np-category">${['tops','bottoms','accessories','caps'].map(c => `<option value="${c}">${c}</option>`).join('')}</select></div>
    <div class="field"><label>Price (₹)</label><input id="np-price" type="number" value="999"></div>
    <div class="field"><label>Sizes (comma separated)</label><input id="np-sizes" type="text" value="S,M,L,XL"></div>
    <div class="field"><label>Image URL <span style="color:var(--text-dim); font-weight:400;">(optional — you can add this later too)</span></label><input id="np-img" type="text" placeholder="https://..."></div>
    <div class="admin-modal-actions"><button class="btn btn-outline" id="np-cancel">Cancel</button><button class="btn btn-primary" id="np-save">Add product</button></div>
  `);
  $('#np-cancel').addEventListener('click', closeModal);
  $('#np-save').addEventListener('click', async () => {
    const name = $('#np-name').value.trim();
    if (!name) { toast('Name is required'); return; }
    const category = $('#np-category').value;
    const price = Number($('#np-price').value) || 0;
    const sizes = $('#np-sizes').value.split(',').map(s => s.trim()).filter(Boolean);
    const stock = {}; sizes.forEach(s => stock[s] = 0);
    const img = $('#np-img').value.trim();
    try {
      await apiFetch('/api/products', { method: 'POST', body: JSON.stringify({ name, category, price, sizes, stock, desc: '', img }) });
      closeModal();
      toast('Product added');
      productsPage();
    } catch (e) { toast('Could not add: ' + e.message); }
  });
}

/* ============================================================
   CATEGORIES
   ============================================================ */
async function categoriesPage() {
  $('#admin-content').innerHTML = `
    <div class="admin-heading"><div><h2>Categories</h2><p>Categories power the storefront's category pages and product filters.</p></div><button class="btn btn-primary" id="add-cat-btn">+ Add category</button></div>
    <div class="admin-card"><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Name</th><th>Slug</th><th>Products</th><th></th></tr></thead><tbody id="admin-tbody">Loading…</tbody></table></div></div>`;
  $('#add-cat-btn').addEventListener('click', openAddCategoryModal);
  try {
    const rows = await apiFetch('/api/categories');
    currentRows = rows;
    window.__renderRows = renderCategoryRows;
    window.__afterRender = bindCategoryRowEvents;
    $('#admin-tbody').innerHTML = renderCategoryRows(rows);
    bindCategoryRowEvents();
  } catch (e) {
    $('#admin-tbody').innerHTML = `<tr><td colspan="4">${errorNote(e)}</td></tr>`;
  }
}
function renderCategoryRows(rows) {
  if (!rows.length) return `<tr><td colspan="4" style="color:var(--text-dim);">No categories yet.</td></tr>`;
  return rows.map(c => `<tr data-slug="${esc(c.slug)}"><td><b>${esc(c.name)}</b></td><td>${esc(c.slug)}</td><td>${c.productCount}</td><td><div class="admin-row-actions"><button class="danger">Delete</button></div></td></tr>`).join('');
}
function bindCategoryRowEvents() {
  document.querySelectorAll('#admin-tbody tr[data-slug]').forEach(row => {
    row.querySelector('.danger').addEventListener('click', async () => {
      if (!confirm('Delete this category? Products already using it will keep the old category value.')) return;
      try {
        await apiFetch(`/api/categories/${encodeURIComponent(row.dataset.slug)}`, { method: 'DELETE' });
        row.remove();
        toast('Category deleted');
      } catch (e) { toast('Could not delete: ' + e.message); }
    });
  });
}
function openAddCategoryModal() {
  openModal(`
    <h3 style="margin-bottom:16px;">Add category</h3>
    <div class="field"><label>Name</label><input id="nc-name" type="text" placeholder="e.g. Jackets"></div>
    <div class="admin-modal-actions"><button class="btn btn-outline" id="nc-cancel">Cancel</button><button class="btn btn-primary" id="nc-save">Add category</button></div>
  `);
  $('#nc-cancel').addEventListener('click', closeModal);
  $('#nc-save').addEventListener('click', async () => {
    const name = $('#nc-name').value.trim();
    if (!name) { toast('Name is required'); return; }
    try {
      await apiFetch('/api/categories', { method: 'POST', body: JSON.stringify({ name }) });
      closeModal();
      toast('Category added');
      categoriesPage();
    } catch (e) { toast('Could not add: ' + e.message); }
  });
}

/* ============================================================
   CUSTOMERS
   ============================================================ */
async function customersPage() {
  $('#admin-content').innerHTML = `<div class="admin-heading"><div><h2>Customers</h2><p>Built automatically from checkout details on every order.</p></div></div><div class="admin-card"><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>City</th><th>Orders</th><th>Total spent</th><th>Last order</th></tr></thead><tbody id="admin-tbody">Loading…</tbody></table></div></div>`;
  try {
    const rows = await apiFetch('/api/customers');
    currentRows = rows;
    window.__renderRows = renderCustomerRows;
    window.__afterRender = null;
    $('#admin-tbody').innerHTML = renderCustomerRows(rows);
  } catch (e) {
    $('#admin-tbody').innerHTML = `<tr><td colspan="7">${errorNote(e)}</td></tr>`;
  }
}
function renderCustomerRows(rows) {
  if (!rows.length) return `<tr><td colspan="7" style="color:var(--text-dim);">No customers yet — they appear here after the first checkout.</td></tr>`;
  return rows.map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.email)}</td><td>${esc(c.phone)}</td><td>${esc(c.city)}</td><td>${c.orders}</td><td>${money(c.spent)}</td><td>${fmtDate(c.lastOrder)}</td></tr>`).join('');
}

/* ============================================================
   DISCOUNTS
   ============================================================ */
async function discountsPage() {
  $('#admin-content').innerHTML = `
    <div class="admin-heading"><div><h2>Discounts</h2><p>Manage discount codes. (Applying a code at checkout is a separate step — see Settings.)</p></div><button class="btn btn-primary" id="add-disc-btn">+ Add discount</button></div>
    <div class="admin-card"><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Code</th><th>Type</th><th>Value</th><th>Active</th><th>Expires</th><th></th></tr></thead><tbody id="admin-tbody">Loading…</tbody></table></div></div>`;
  $('#add-disc-btn').addEventListener('click', openAddDiscountModal);
  try {
    const rows = await apiFetch('/api/discounts');
    currentRows = rows;
    window.__renderRows = renderDiscountRows;
    window.__afterRender = bindDiscountRowEvents;
    $('#admin-tbody').innerHTML = renderDiscountRows(rows);
    bindDiscountRowEvents();
  } catch (e) {
    $('#admin-tbody').innerHTML = `<tr><td colspan="6">${errorNote(e)}</td></tr>`;
  }
}
function renderDiscountRows(rows) {
  if (!rows.length) return `<tr><td colspan="6" style="color:var(--text-dim);">No discount codes yet.</td></tr>`;
  return rows.map(d => `<tr data-code="${esc(d.code)}">
    <td><b>${esc(d.code)}</b></td>
    <td>${d.type === 'fixed' ? 'Fixed ₹' : 'Percentage %'}</td>
    <td>${d.type === 'fixed' ? money(d.value) : d.value + '%'}</td>
    <td><label style="display:flex; align-items:center; gap:6px;"><input type="checkbox" class="f-active" ${d.active ? 'checked' : ''}> Active</label></td>
    <td>${d.expiresAt || '—'}</td>
    <td><div class="admin-row-actions"><button class="danger">Delete</button></div></td>
  </tr>`).join('');
}
function bindDiscountRowEvents() {
  document.querySelectorAll('#admin-tbody tr[data-code]').forEach(row => {
    const code = row.dataset.code;
    row.querySelector('.f-active').addEventListener('change', async e => {
      try {
        await apiFetch(`/api/discounts/${encodeURIComponent(code)}`, { method: 'PUT', body: JSON.stringify({ active: e.target.checked }) });
        toast('Updated');
      } catch (err) { toast('Could not update: ' + err.message); }
    });
    row.querySelector('.danger').addEventListener('click', async () => {
      if (!confirm('Delete this discount code?')) return;
      try {
        await apiFetch(`/api/discounts/${encodeURIComponent(code)}`, { method: 'DELETE' });
        row.remove();
        toast('Deleted');
      } catch (e) { toast('Could not delete: ' + e.message); }
    });
  });
}
function openAddDiscountModal() {
  openModal(`
    <h3 style="margin-bottom:16px;">Add discount code</h3>
    <div class="field"><label>Code</label><input id="nd-code" type="text" placeholder="e.g. WELCOME10" style="text-transform:uppercase;"></div>
    <div class="field"><label>Type</label><select id="nd-type"><option value="percentage">Percentage %</option><option value="fixed">Fixed ₹ amount</option></select></div>
    <div class="field"><label>Value</label><input id="nd-value" type="number" value="10"></div>
    <div class="field"><label>Expires (optional)</label><input id="nd-expires" type="date"></div>
    <div class="admin-modal-actions"><button class="btn btn-outline" id="nd-cancel">Cancel</button><button class="btn btn-primary" id="nd-save">Add code</button></div>
  `);
  $('#nd-cancel').addEventListener('click', closeModal);
  $('#nd-save').addEventListener('click', async () => {
    const code = $('#nd-code').value.trim();
    if (!code) { toast('Code is required'); return; }
    try {
      await apiFetch('/api/discounts', { method: 'POST', body: JSON.stringify({ code, type: $('#nd-type').value, value: Number($('#nd-value').value), expiresAt: $('#nd-expires').value }) });
      closeModal();
      toast('Discount added');
      discountsPage();
    } catch (e) { toast('Could not add: ' + e.message); }
  });
}

/* ============================================================
   SETTINGS
   ============================================================ */
function settingsPage() {
  $('#admin-content').innerHTML = `
    <div class="admin-heading"><div><h2>Settings</h2><p>Connection and store configuration.</p></div></div>
    <div class="admin-card" style="max-width:560px;">
      <h3>Connected backend</h3>
      <p style="color:var(--text-dim); font-size:13.5px; word-break:break-all;">${esc(BACKEND)}</p>
      <p class="note">Store details (name, WhatsApp, email, phone, Instagram) live in <code>js/products.js</code> → <code>STORE</code>. Razorpay keys and the admin token live in the backend's environment variables on Render.</p>
      <p class="note">Discount codes are managed here but aren't yet deducted automatically at checkout — wiring a code field into <code>checkout.html</code> is a small follow-up if you want that.</p>
      <button class="btn btn-outline" id="settings-logout">Log out</button>
    </div>`;
  $('#settings-logout').addEventListener('click', () => $('#logout-btn').click());
}

/* ---------- modal helper ---------- */
function openModal(html) {
  const m = $('#admin-modal');
  m.innerHTML = `<div class="admin-modal-box">${html}</div>`;
  m.classList.remove('hidden');
}
function closeModal() { $('#admin-modal').classList.add('hidden'); }
$('#admin-modal').addEventListener('click', e => { if (e.target.id === 'admin-modal') closeModal(); });
