# KELTO — Online Store

A complete storefront for KELTO: home page, 4 category pages (Tops, Bottoms,
Accessories, Caps), product detail pages, cart, checkout, Razorpay payment,
policy pages, and an admin panel for editing inventory.

## What's inside

```
kelto/
├── index.html              Home page
├── category.html           Category listing (?cat=tops etc.), shows 3 items then "Show more"
├── product.html             Product detail (?id=...) — size, qty, add to cart, buy now
├── cart.html                 Cart page
├── checkout.html             Shipping/contact details form (mandatory fields)
├── payment.html               Razorpay payment
├── order-success.html         Confirmation page
├── policy-privacy.html
├── policy-terms.html
├── policy-replacement.html
├── policy-shipping.html
├── css/style.css              All styling
├── js/products.js             Product catalog (frontend copy) + store info
├── js/config.js               Razorpay public key + backend URL — EDIT THIS
├── js/main.js                 Cart logic, header/footer, nav
├── img/logo.png               Your logo
├── admin/                       Full store admin dashboard (talks to /backend)
│   ├── index.html               Dashboard, Orders, Products, Categories, Customers, Discounts, Settings
│   ├── admin.css                Admin-only layout styles (reuses css/style.css tokens — same fonts/colors as the store)
│   └── admin.js                 Admin app logic — wired to every backend endpoint below
└── backend/                    Node.js API: catalog, orders, dashboard analytics, customers, categories, discounts, Razorpay
    ├── server.js
    ├── package.json
    ├── .env.example
    └── data/                    JSON files = the database (products, orders, categories, discounts)
```

## 1. Try it locally (no payments yet)

You can preview the whole frontend without any setup — just open
`index.html` in a browser, or serve the folder with any static server, e.g.:

```
npx serve kelto
```

Browsing, cart, checkout form, and the policy pages all work immediately.
The **Pay with Razorpay** button won't work yet — it needs the backend below.

## 2. Set up the backend (needed for real payments + live admin editing)

```
cd backend
npm install
cp .env.example .env
```

Edit `.env`:
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — from your Razorpay dashboard
  (Settings → API Keys). Use your **test** keys first.
- `ADMIN_TOKEN` — make up a long random password; this protects the admin panel.
- `ALLOWED_ORIGINS` — the URL(s) your frontend runs on.

Then run it:

```
npm start
```

This starts the API at `http://localhost:4000`.

## 3. Connect the frontend to the backend

Open `js/config.js` and set:

```js
const RAZORPAY_KEY_ID = "rzp_test_yourrealkeyid";   // the PUBLIC key only
const BACKEND_URL = "http://localhost:4000";         // or your deployed backend URL
```

**Never** put your Razorpay **key secret** in any frontend file — it only
belongs in `backend/.env`.

## 4. Use the admin dashboard

Open `admin/index.html`, enter your backend URL and the `ADMIN_TOKEN` you set,
and you land on a full dashboard — not just a product list:

- **Dashboard** — total sales, order count, product count, customer count,
  a sales-over-time chart, top-selling products, and low-stock alerts, all
  computed live from your real orders and inventory.
- **Orders** — every order placed through checkout (customer, items, amount,
  payment status), with a dropdown to move each one through
  Processing → Shipped → Delivered.
- **Products** — same inline price/stock editing as before, plus adding and
  deleting products.
- **Categories** — add or remove the categories used by the storefront's
  category pages.
- **Customers** — automatically built from checkout details on every order
  (name, email, phone, city, order count, total spent) — no separate
  customer database to maintain.
- **Discounts** — create and manage discount codes. Note: creating a code
  here doesn't yet make it usable at checkout — applying a code (subtracting
  it from the total in `checkout.html`/`payment.html`) is a small follow-up
  if you want that wired up.

Changes save straight to the JSON files in `backend/data/` and the storefront
fetches live from `/api/products` on every page load (see `js/products.js` →
`KELTO_READY`), so admin edits appear on the site immediately for every
visitor — no rebuild or redeploy needed. If the backend can't be reached (not
running yet, or the visitor is offline), the site falls back to the snapshot
baked into `js/products.js` so it never shows a blank store.

### Admin API reference

All admin routes require the header `x-admin-token: <your ADMIN_TOKEN>`.

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/admin/login` | Validate a token (used by the dashboard's login screen) |
| GET | `/api/dashboard` | Sales metrics, recent orders, top products, low stock |
| GET | `/api/orders` | List all orders, newest first |
| PUT | `/api/orders/:orderRef` | Update an order's fulfilment status |
| GET | `/api/customers` | Customers rolled up from order history |
| GET/POST/DELETE | `/api/categories` | List (public) / add / remove categories |
| GET/POST/PUT/DELETE | `/api/discounts` | List / add / update / remove discount codes |
| GET/POST/PUT/DELETE | `/api/products` | Existing catalog CRUD (unchanged) |

## 5. Deploy for real

- **Frontend**: any static host works — Netlify, Vercel, GitHub Pages, or
  your own hosting. Just upload the whole `kelto/` folder (excluding `backend/`).
- **Backend**: needs an actual Node.js host — Render, Railway, Fly.io, a VPS,
  etc. (not a static host). Set the same environment variables there as in
  your local `.env`, using your **live** Razorpay keys once you're ready to
  go live (Razorpay requires KYC/business verification for live mode).
- Update `js/config.js` on the deployed frontend to point at your deployed
  backend URL, and update `ALLOWED_ORIGINS` in the backend to your real
  frontend domain.

### Updating your existing GitHub → Render/Netlify deployment

If you already have this repo pushed to GitHub with Render (backend) and
Netlify (frontend) connected to it, updating to the new admin dashboard is
just:

1. Copy this whole `kelto/` folder over your local copy of the repo
   (overwriting `admin/` and `backend/server.js`; nothing else changed).
2. `git add . && git commit -m "Full admin dashboard" && git push`
3. Render redeploys the backend automatically. No new environment variables
   are required — the dashboard reuses your existing `ADMIN_TOKEN`.
4. Netlify redeploys the frontend automatically, including the new
   `admin/index.html`.
5. Open `your-site.netlify.app/admin/`, enter your Render backend URL and
   your `ADMIN_TOKEN`, and the dashboard loads.

## Filling in your details

Search for these placeholders and replace them:

- `js/products.js` → `STORE.whatsapp`, `STORE.email`, `STORE.phone`, `STORE.address`, `STORE.gst`
- `backend/.env` → your real Razorpay keys and admin token

## Notes & honest limitations

- This is a genuine, working store once the backend is deployed and keys are
  filled in — but it's a lean build, not a full platform. There's no user
  accounts/login, no automated email receipts (Razorpay sends a payment
  receipt; order-confirmation emails would need an email service like
  Resend/SendGrid wired into the backend), and no shipping-rate API.
- Product images are placeholders (styled blocks with a "K"). Add real photos
  by putting image files in `img/` and setting each product's `img` field to
  the file path (via the admin panel or directly in `backend/data/products.json`).
- `backend/data/products.json` is now the single source of truth. The
  `js/products.js` list only matters as an offline fallback — edit products
  through the admin panel (or that JSON file) day to day, not the frontend file.
