/* ============================================================
   KELTO backend
   - Serves/edits the product catalog (data/products.json) so the
     admin panel and storefront share one source of truth.
   - Creates Razorpay orders server-side (amount is calculated from
     OUR catalog, never trusted from the browser) and verifies the
     payment signature after checkout — this is the part that
     cannot safely live in frontend-only code.
   Run: npm install && cp .env.example .env  (fill in real values) && npm start
   ============================================================ */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Razorpay = require('razorpay');

const app = express();
const PORT = process.env.PORT || 4000;
const PRODUCTS_PATH = path.join(__dirname, 'data', 'products.json');
const ORDERS_PATH = path.join(__dirname, 'data', 'orders.json');

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : true,
}));
app.use(express.json());

if(!fs.existsSync(ORDERS_PATH)) fs.writeFileSync(ORDERS_PATH, '[]');

function readProducts(){ return JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf-8')); }
function writeProducts(products){ fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2)); }
function readOrders(){ return JSON.parse(fs.readFileSync(ORDERS_PATH, 'utf-8')); }
function writeOrders(orders){ fs.writeFileSync(ORDERS_PATH, JSON.stringify(orders, null, 2)); }

const razorpay = (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

/* ---------- admin auth (very simple shared-token auth) ---------- */
function requireAdmin(req, res, next){
  const token = req.header('x-admin-token');
  if(!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN){
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

/* ---------- public: product catalog ---------- */
app.get('/api/products', (req, res) => {
  res.json(readProducts());
});

app.get('/api/products/:id', (req, res) => {
  const product = readProducts().find(p => p.id === req.params.id);
  if(!product) return res.status(404).json({ error: 'not-found' });
  res.json(product);
});

/* ---------- admin: manage catalog ---------- */
app.post('/api/products', requireAdmin, (req, res) => {
  const products = readProducts();
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
  products.push(product);
  writeProducts(products);
  res.status(201).json(product);
});

app.put('/api/products/:id', requireAdmin, (req, res) => {
  const products = readProducts();
  const idx = products.findIndex(p => p.id === req.params.id);
  if(idx === -1) return res.status(404).json({ error: 'not-found' });
  products[idx] = { ...products[idx], ...req.body, id: products[idx].id };
  writeProducts(products);
  res.json(products[idx]);
});

app.delete('/api/products/:id', requireAdmin, (req, res) => {
  const products = readProducts();
  const next = products.filter(p => p.id !== req.params.id);
  writeProducts(next);
  res.status(204).end();
});

/* ---------- checkout: create a Razorpay order ---------- */
app.post('/api/create-order', async (req, res) => {
  if(!razorpay) return res.status(500).json({ error: 'razorpay-not-configured' });
  try{
    const { items, customer } = req.body;
    const products = readProducts();

    // Recalculate the amount from OUR catalog — never trust a price
    // sent from the browser.
    let subtotal = 0;
    for(const item of items){
      const product = products.find(p => p.id === item.id);
      if(!product) return res.status(400).json({ error: `unknown-product:${item.id}` });
      const available = (product.stock || {})[item.size] ?? 0;
      if(available < item.qty) return res.status(400).json({ error: `out-of-stock:${item.id}` });
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

    const orders = readOrders();
    orders.push({
      orderRef,
      razorpayOrderId: razorpayOrder.id,
      items, customer, subtotal, shipping, total,
      status: 'created',
      createdAt: new Date().toISOString()
    });
    writeOrders(orders);

    res.json({ id: razorpayOrder.id, amount: razorpayOrder.amount, currency: razorpayOrder.currency, orderRef });
  }catch(err){
    console.error(err);
    res.status(500).json({ error: 'order-creation-failed' });
  }
});

/* ---------- checkout: verify payment signature ---------- */
app.post('/api/verify-payment', (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderRef } = req.body;
  if(!razorpay_order_id || !razorpay_payment_id || !razorpay_signature){
    return res.status(400).json({ error: 'missing-fields' });
  }
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(razorpay_order_id + '|' + razorpay_payment_id)
    .digest('hex');

  if(expected !== razorpay_signature){
    return res.status(400).json({ error: 'signature-mismatch' });
  }

  const orders = readOrders();
  const order = orders.find(o => o.razorpayOrderId === razorpay_order_id);
  if(order){
    order.status = 'paid';
    order.razorpay_payment_id = razorpay_payment_id;

    // Decrement stock now that payment is confirmed.
    const products = readProducts();
    order.items.forEach(item => {
      const product = products.find(p => p.id === item.id);
      if(product && product.stock[item.size] != null){
        product.stock[item.size] = Math.max(0, product.stock[item.size] - item.qty);
      }
    });
    writeProducts(products);
    writeOrders(orders);
  }

  res.json({ orderRef: order?.orderRef || orderRef, razorpay_payment_id, status: 'paid' });
});

/* ---------- admin: list orders ---------- */
app.get('/api/orders', requireAdmin, (req, res) => {
  res.json(readOrders().slice().reverse());
});

app.listen(PORT, () => console.log(`KELTO backend running on http://localhost:${PORT}`));
