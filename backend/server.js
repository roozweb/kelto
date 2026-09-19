/* ============================================================
   KELTO backend
   - Product catalog, orders, categories and discount codes now
     live in Supabase (Postgres) instead of local JSON files, so
     nothing is lost the next time this service gets redeployed —
     Render's free tier wipes local files on every deploy, but a
     real database survives it.
   - Each Supabase table stores one row per record as (key, data
     jsonb) — "data" is the exact same object shape this backend
     always used, so all the existing product/order/category/
     discount logic below is unchanged from before; only how it's
     read and written changed.
   - Creates Razorpay orders server-side (amount is calculated from
     OUR catalog, never trusted from the browser) and verifies the
     payment signature after checkout.
   Run: npm install && cp .env.example .env  (fill in real values) && npm start
   ============================================================ */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 4000;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : true,
}));
app.use(express.json());

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY environment variables.');
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const razorpay = (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

/* ---------- generic (table, key column) helpers ----------
   Every table here is just (keyColumn, data jsonb) — "data" is
   the exact object the rest of this file already works with. */
async function readAll(table) {
  const { data, error } = await supabase.from(table).select('data');
  if (error) throw error;
  return data.map(r => r.data);
}
async function readOne(table, keyCol, key) {
  const { data, error } = await supabase.from(table).select('data').eq(keyCol, key).maybeSingle();
  if (error) throw error;
  return data ? data.data : null;
}
async function insertRow(table, keyCol, keyVal, obj) {
  const row = { [keyCol]: keyVal, data: obj };
  const { error } = await supabase.from(table).insert(row);
  if (error) throw error;
}
async function updateRow(table, keyCol, keyVal, obj) {
  const { error } = await supabase.from(table).update({ data: obj }).eq(keyCol, keyVal);
  if (error) throw error;
}
async function deleteRow(table, keyCol, keyVal) {
  const { error } = await supabase.from(table).delete().eq(keyCol, keyVal);
  if (error) throw error;
}

/* ---------- admin auth (very simple shared-token auth) ---------- */
function requireAdmin(req, res, next) {
  const token = req.header('x-admin-token');
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

app.post('/api/admin/login', (req, res) => {
  const { token } = req.body || {};
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.json({ ok: true, store: 'KELTO' });
});

/* ---------- public: product catalog ---------- */
app.get('/api/products', async (req, res) => {
  try { res.json(await readAll('products')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await readOne('products', 'id', req.params.id);
    if (!product) return res.status(404).json({ error: 'not-found' });
    res.json(product);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- admin: manage catalog ---------- */
app.post('/api/products', requireAdmin, async (req, res) => {
  try {
    const id = req.body.id || (req.body.category || 'item') + '-' + Date.now().toString(36);
    const product = {
      id,
      category: req.body.category || 'tops',
      name: req.body.name || 'Untitled product',
      price: Number(req.body.price) || 0,
      oldPrice: req.body.oldPrice ? Number(req.body.oldPrice) : null,
      img: req.body.img || '',
      sizes: req.body.sizes || ['One Size'],
      stock: req.body.stock || { 'One Size': 0 },
      desc: req.body.desc || '',
      tag: req.body.tag || ''
    };
    await insertRow('products', 'id', id, product);
    res.status(201).json(product);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/products/:id', requireAdmin, async (req, res) => {
  try {
    const existing = await readOne('products', 'id', req.params.id);
    if (!existing) return res.status(404).json({ error: 'not-found' });
    const updated = { ...existing, ...req.body, id: existing.id };
    await updateRow('products', 'id', req.params.id, updated);
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/products/:id', requireAdmin, async (req, res) => {
  try {
    await deleteRow('products', 'id', req.params.id);
    res.status(204).end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- checkout: create a Razorpay order ---------- */
app.post('/api/create-order', async (req, res) => {
  if (!razorpay) return res.status(500).json({ error: 'razorpay-not-configured' });
  try {
    const { items, customer } = req.body;
    const products = await readAll('products');

    // Recalculate the amount from OUR catalog — never trust a price
    // sent from the browser.
    let subtotal = 0;
    for (const item of items) {
      const product = products.find(p => p.id === item.id);
      if (!product) return res.status(400).json({ error: `unknown-product:${item.id}` });
      const available = (product.stock || {})[item.size] ?? 0;
      if (available < item.qty) return res.status(400).json({ error: `out-of-stock:${item.id}` });
      subtotal += product.price * item.qty;
    }
    const shipping = subtotal >= 500 ? 0 : 79;
    const total = subtotal + shipping;
    const orderRef = 'KELTO-' + Date.now().toString(36).toUpperCase();

    const razorpayOrder = await razorpay.orders.create({
      amount: total * 100, // paise
      currency: 'INR',
      receipt: orderRef,
      notes: { customerEmail: customer?.email || '', customerPhone: customer?.phone || '' }
    });

    await insertRow('orders', 'order_ref', orderRef, {
      orderRef,
      razorpayOrderId: razorpayOrder.id,
      items, customer, subtotal, shipping, total,
      status: 'created',
      createdAt: new Date().toISOString()
    });

    res.json({ id: razorpayOrder.id, amount: razorpayOrder.amount, currency: razorpayOrder.currency, orderRef });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'order-creation-failed' });
  }
});

/* ---------- checkout: verify payment signature ---------- */
app.post('/api/verify-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderRef } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'missing-fields' });
    }
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    if (expected !== razorpay_signature) {
      return res.status(400).json({ error: 'signature-mismatch' });
    }

    const orders = await readAll('orders');
    const order = orders.find(o => o.razorpayOrderId === razorpay_order_id);
    if (order) {
      order.status = 'paid';
      order.razorpay_payment_id = razorpay_payment_id;

      // Decrement stock now that payment is confirmed.
      const products = await readAll('products');
      for (const item of order.items) {
        const product = products.find(p => p.id === item.id);
        if (product && product.stock[item.size] != null) {
          product.stock[item.size] = Math.max(0, product.stock[item.size] - item.qty);
          await updateRow('products', 'id', product.id, product);
        }
      }
      await updateRow('orders', 'order_ref', order.orderRef, order);
    }

    res.json({ orderRef: order?.orderRef || orderRef, razorpay_payment_id, status: 'paid' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/* ---------- admin: orders ---------- */
app.get('/api/orders', requireAdmin, async (req, res) => {
  try {
    const orders = await readAll('orders');
    orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(orders);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update fulfilment status (Paid orders move through Processing →
// Shipped → Delivered; this never touches Razorpay, just our record).
app.put('/api/orders/:orderRef', requireAdmin, async (req, res) => {
  try {
    const order = await readOne('orders', 'order_ref', req.params.orderRef);
    if (!order) return res.status(404).json({ error: 'not-found' });
    if (req.body.status) order.status = req.body.status;
    await updateRow('orders', 'order_ref', req.params.orderRef, order);
    res.json(order);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- admin: dashboard analytics ---------- */
app.get('/api/dashboard', requireAdmin, async (req, res) => {
  try {
    const orders = await readAll('orders');
    const products = await readAll('products');
    const paidOrders = orders.filter(o => o.status !== 'created' && o.status !== 'cancelled');

    const sales = paidOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const totalStock = p => Object.values(p.stock || {}).reduce((a, b) => a + b, 0);
    const lowStock = products
      .map(p => ({ ...p, totalStock: totalStock(p) }))
      .filter(p => p.totalStock <= 10)
      .sort((a, b) => a.totalStock - b.totalStock)
      .slice(0, 6);

    const productTotals = {};
    paidOrders.forEach(o => {
      (o.items || []).forEach(item => {
        const p = products.find(x => x.id === item.id);
        const name = p ? p.name : item.id;
        productTotals[name] = productTotals[name] || { product: name, qty: 0, revenue: 0 };
        productTotals[name].qty += item.qty;
        productTotals[name].revenue += (p ? p.price : 0) * item.qty;
      });
    });
    const top = Object.values(productTotals).sort((a, b) => b.qty - a.qty).slice(0, 5);

    const byDay = {};
    paidOrders.forEach(o => {
      const day = (o.createdAt || '').slice(0, 10);
      if (!day) return;
      byDay[day] = (byDay[day] || 0) + (o.total || 0);
    });
    const daily = Object.entries(byDay).map(([day, sales]) => ({ day, sales })).sort((a, b) => a.day.localeCompare(b.day));

    const customerEmails = new Set(orders.map(o => o.customer?.email).filter(Boolean));
    const sortedOrders = orders.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      metrics: {
        sales,
        orders: orders.length,
        products: products.length,
        customers: customerEmails.size
      },
      recent: sortedOrders.slice(0, 8),
      top,
      low: lowStock,
      daily
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- admin: customers (derived from orders) ---------- */
app.get('/api/customers', requireAdmin, async (req, res) => {
  try {
    const orders = await readAll('orders');
    const byEmail = {};
    orders.forEach(o => {
      const c = o.customer || {};
      if (!c.email) return;
      if (!byEmail[c.email]) {
        byEmail[c.email] = {
          id: c.email,
          name: c.fullName || c.email,
          email: c.email,
          phone: c.phone || '',
          city: c.city || '',
          orders: 0,
          spent: 0,
          lastOrder: o.createdAt
        };
      }
      const entry = byEmail[c.email];
      entry.orders += 1;
      if (o.status !== 'created') entry.spent += (o.total || 0);
      if (new Date(o.createdAt) > new Date(entry.lastOrder)) entry.lastOrder = o.createdAt;
    });
    res.json(Object.values(byEmail).sort((a, b) => b.spent - a.spent));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- admin: categories ---------- */
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await readAll('categories');
    const products = await readAll('products');
    res.json(categories.map(c => ({
      ...c,
      productCount: products.filter(p => p.category === c.slug).length
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/categories', requireAdmin, async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name-required' });
    const slug = req.body.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const existing = await readOne('categories', 'slug', slug);
    if (existing) return res.status(400).json({ error: 'category-exists' });
    const category = { slug, name };
    await insertRow('categories', 'slug', slug, category);
    res.status(201).json(category);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/categories/:slug', requireAdmin, async (req, res) => {
  try {
    await deleteRow('categories', 'slug', req.params.slug);
    res.status(204).end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- admin: discount codes ---------- */
app.get('/api/discounts', requireAdmin, async (req, res) => {
  try { res.json(await readAll('discounts')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/discounts', requireAdmin, async (req, res) => {
  try {
    const code = (req.body.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'code-required' });
    const existing = await readOne('discounts', 'id', code);
    if (existing) return res.status(400).json({ error: 'code-exists' });
    const discount = {
      id: code,
      code,
      type: req.body.type === 'fixed' ? 'fixed' : 'percentage',
      value: Number(req.body.value) || 0,
      active: req.body.active !== false,
      expiresAt: req.body.expiresAt || ''
    };
    await insertRow('discounts', 'id', code, discount);
    res.status(201).json(discount);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/discounts/:code', requireAdmin, async (req, res) => {
  try {
    const d = await readOne('discounts', 'id', req.params.code);
    if (!d) return res.status(404).json({ error: 'not-found' });
    Object.assign(d, {
      type: req.body.type === 'fixed' ? 'fixed' : (req.body.type === 'percentage' ? 'percentage' : d.type),
      value: req.body.value != null ? Number(req.body.value) : d.value,
      active: req.body.active != null ? !!req.body.active : d.active,
      expiresAt: req.body.expiresAt != null ? req.body.expiresAt : d.expiresAt
    });
    await updateRow('discounts', 'id', req.params.code, d);
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/discounts/:code', requireAdmin, async (req, res) => {
  try {
    await deleteRow('discounts', 'id', req.params.code);
    res.status(204).end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- one-time seed: only runs the very first time the
   products table is empty, from the catalog bundled in the repo ---------- */
async function seedIfEmpty() {
  const { count: productCount } = await supabase.from('products').select('*', { count: 'exact', head: true });
  if (!productCount) {
    const seedProducts = require('./data/products.json');
    for (const p of seedProducts) await insertRow('products', 'id', p.id, p).catch(() => {});
    console.log(`Seeded ${seedProducts.length} products into Supabase.`);
  }
  const { count: catCount } = await supabase.from('categories').select('*', { count: 'exact', head: true });
  if (!catCount) {
    const seedCategories = require('./data/categories.json');
    for (const c of seedCategories) await insertRow('categories', 'slug', c.slug, c).catch(() => {});
    console.log(`Seeded ${seedCategories.length} categories into Supabase.`);
  }
  const { count: discCount } = await supabase.from('discounts').select('*', { count: 'exact', head: true });
  if (!discCount) {
    const seedDiscounts = require('./data/discounts.json');
    for (const d of seedDiscounts) await insertRow('discounts', 'id', d.id, d).catch(() => {});
    console.log(`Seeded ${seedDiscounts.length} discounts into Supabase.`);
  }
}
seedIfEmpty().catch(e => console.error('Seed check failed:', e.message));

app.listen(PORT, () => console.log(`KELTO backend running on http://localhost:${PORT}`));
