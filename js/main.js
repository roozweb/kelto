/* ============================================================
   KELTO — shared site behaviour: cart, header/footer chrome,
   nav highlighting, toast messages. Cart lives in localStorage
   so it persists per visitor across pages.
   ============================================================ */

const CART_KEY = "kelto_cart_v1";

function getCart(){
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
  catch(e){ return []; }
}
function saveCart(cart){
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartCount();
}
function addToCart(productId, size, qty){
  const cart = getCart();
  const existing = cart.find(l => l.productId === productId && l.size === size);
  if(existing){ existing.qty += qty; }
  else{ cart.push({ productId, size, qty }); }
  saveCart(cart);
  showToast("Added to cart");
}
function removeFromCart(productId, size){
  saveCart(getCart().filter(l => !(l.productId === productId && l.size === size)));
}
function setCartQty(productId, size, qty){
  const cart = getCart();
  const line = cart.find(l => l.productId === productId && l.size === size);
  if(line){
    line.qty = qty;
    if(line.qty <= 0){ return removeFromCart(productId, size); }
    saveCart(cart);
  }
}
function cartCount(){
  return getCart().reduce((n,l)=> n + l.qty, 0);
}
function cartLinesResolved(){
  return getCart().map(l => {
    const p = getProduct(l.productId);
    return p ? { ...l, product: p } : null;
  }).filter(Boolean);
}
function cartSubtotal(){
  return cartLinesResolved().reduce((sum,l)=> sum + l.product.price * l.qty, 0);
}
function updateCartCount(){
  document.querySelectorAll('[data-cart-count]').forEach(el => el.textContent = cartCount());
}

function showToast(msg){
  let t = document.getElementById('toast');
  if(!t){
    t = document.createElement('div');
    t.id = 'toast'; t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=> t.classList.remove('show'), 2200);
}

/* ---------- header / footer injection ---------- */
function renderChrome(activePage){
  const headerEl = document.getElementById('site-header');
  const footerEl = document.getElementById('site-footer');

  if(headerEl){
    headerEl.innerHTML = `
      <div class="header-row">
        <a href="index.html" class="brand">
          <img src="img/logo.png" alt="${STORE.name}">
        </a>
        <nav class="main-nav" id="main-nav">
          <a href="index.html" data-nav="home">Home</a>
          <a href="category.html?cat=tops" data-nav="tops">Tops</a>
          <a href="category.html?cat=bottoms" data-nav="bottoms">Bottoms</a>
          <a href="category.html?cat=accessories" data-nav="accessories">Accessories</a>
          <a href="category.html?cat=caps" data-nav="caps">Caps</a>
          <a href="policy-shipping.html" data-nav="shipping">Shipping</a>
        </nav>
        <div class="header-actions">
          <button class="mobile-toggle" id="mobile-toggle" aria-label="Menu">&#9776;</button>
          <a href="cart.html" class="icon-btn">
            Cart <span class="cart-count" data-cart-count>0</span>
          </a>
        </div>
      </div>`;
    const nav = headerEl.querySelector('#main-nav');
    const toggle = headerEl.querySelector('#mobile-toggle');
    toggle.addEventListener('click', ()=> nav.classList.toggle('open'));
    if(activePage){
      const link = headerEl.querySelector(`[data-nav="${activePage}"]`);
      if(link) link.classList.add('active');
    }
  }

  if(footerEl){
    footerEl.innerHTML = `
      <div class="wrap">
        <div class="foot-grid">
          <div>
            <div class="brand" style="margin-bottom:14px;">
              <img src="img/logo.png" alt="${STORE.name}" style="height:34px;">
            </div>
            <p style="color:var(--text-dim); font-size:13.5px; max-width:32ch;">
              Built for people who don't need a giant logo to make a statement.
            </p>
          </div>
          <div>
            <h4>Categories</h4>
            <ul>
              <li><a href="category.html?cat=tops">Tops</a></li>
              <li><a href="category.html?cat=bottoms">Bottoms</a></li>
              <li><a href="category.html?cat=accessories">Accessories</a></li>
              <li><a href="category.html?cat=caps">Caps</a></li>
            </ul>
          </div>
          <div>
            <h4>Support</h4>
            <ul>
              <li><a href="policy-privacy.html">Privacy Policy</a></li>
              <li><a href="policy-terms.html">Terms &amp; Conditions</a></li>
              <li><a href="policy-replacement.html">Replacement Policy</a></li>
              <li><a href="policy-shipping.html">Shipping Policy</a></li>
            </ul>
          </div>
          <div>
            <h4>Get in touch</h4>
            <ul>
              <li><a href="${STORE.instagram}" target="_blank" rel="noopener">Instagram</a></li>
              <li><a href="${STORE.whatsapp}" target="_blank" rel="noopener">WhatsApp</a></li>
              <li><a href="mailto:${STORE.email}">${STORE.email}</a></li>
              <li><a href="admin/index.html" class="admin-link">Store admin</a></li>
            </ul>
          </div>
        </div>
        <div class="foot-bottom">
          <span>&copy; ${new Date().getFullYear()} ${STORE.name}. All rights reserved.</span>
          <span>Secure checkout via Razorpay</span>
        </div>
      </div>`;
  }

  updateCartCount();
}

document.addEventListener('DOMContentLoaded', ()=>{
  const active = document.body.getAttribute('data-page') || '';
  renderChrome(active);
});
