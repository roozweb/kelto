/* ============================================================
   KELTO — product catalog & store settings
   This file IS the inventory. The admin panel (admin/index.html)
   edits data in localStorage that overrides these defaults in the
   browser used for admin — see js/admin.js. For every visitor's
   catalog to update from one place, this file should eventually be
   served by the backend (see /backend) instead of loaded statically.
   ============================================================ */

const STORE = {
  name: "KELTO",
  instagram: "https://www.instagram.com/kelto.co_/",
  whatsapp: "https://wa.me/918943374005",
  email: "keltosupport@gmail.com",
  phone: "+91 89433 74005",
  address: "",                                    // online-only store — no walk-in address
  gst: "",                                        // TODO: GSTIN if registered
  freeShippingOver: 500,
  currency: "₹"
};

const CATEGORIES = [
  { slug: "tops",        name: "Tops" },
  { slug: "bottoms",     name: "Bottoms" },
  { slug: "accessories", name: "Accessories" },
  { slug: "caps",        name: "Caps" }
];

/* Offline fallback catalog — used only if the backend can't be
   reached (e.g. previewing the site with no server running). Once
   the backend responds, PRODUCTS below is replaced with the live
   data from /api/products, which is what the admin panel edits. */
const FALLBACK_PRODUCTS = [
  // ---- TOPS ----
  { id:"top-01", category:"tops", name:"Chrome Red Oversized Tee", price:899, oldPrice:1099, img:"", sizes:["S","M","L","XL"], stock:{S:8,M:12,L:10,XL:4}, desc:"Heavyweight 240gsm cotton oversized tee with the Kelto chrome wordmark printed across the chest.", tag:"New" },
  { id:"top-02", category:"tops", name:"Kelto Racing Jersey", price:1299, oldPrice:null, img:"", sizes:["S","M","L","XL"], stock:{S:5,M:6,L:0,XL:2}, desc:"Motorsport-inspired long sleeve jersey in matte black with red spike detailing.", tag:"" },
  { id:"top-03", category:"tops", name:"Blackout Hoodie", price:1799, oldPrice:1999, img:"", sizes:["M","L","XL","XXL"], stock:{M:10,L:10,XL:8,XXL:3}, desc:"Fleece-lined pullover hoodie, boxy fit, embroidered star mark on the sleeve.", tag:"Bestseller" },
  { id:"top-04", category:"tops", name:"Vent Mesh Tee", price:799, oldPrice:null, img:"", sizes:["S","M","L","XL"], stock:{S:9,M:9,L:9,XL:9}, desc:"Lightweight mesh-panel tee built for movement, subtle tonal Kelto print.", tag:"" },
  { id:"top-05", category:"tops", name:"Garage Zip Jacket", price:2199, oldPrice:null, img:"", sizes:["M","L","XL"], stock:{M:3,L:2,XL:0}, desc:"Cropped zip-through jacket in brushed twill with a woven Kelto label.", tag:"" },
  { id:"top-06", category:"tops", name:"Signature Long Sleeve", price:999, oldPrice:null, img:"", sizes:["S","M","L","XL"], stock:{S:6,M:6,L:6,XL:6}, desc:"Ribbed cuff long sleeve in stone black with a small chest hit logo.", tag:"" },

  // ---- BOTTOMS ----
  { id:"bot-01", category:"bottoms", name:"Kelto Cargo Pants", price:1699, oldPrice:1899, img:"", sizes:["30","32","34","36"], stock:{"30":6,"32":10,"34":8,"36":3}, desc:"Six-pocket tapered cargo in washed black twill with red bartack stitching.", tag:"New" },
  { id:"bot-02", category:"bottoms", name:"Track Joggers", price:1199, oldPrice:null, img:"", sizes:["S","M","L","XL"], stock:{S:7,M:9,L:9,XL:5}, desc:"Tapered fit joggers with ribbed hem and side-seam Kelto print.", tag:"" },
  { id:"bot-03", category:"bottoms", name:"Raw Denim Straight", price:2499, oldPrice:null, img:"", sizes:["30","32","34","36"], stock:{"30":2,"32":4,"34":0,"36":1}, desc:"Rigid raw denim, straight leg, subtle red selvedge detail.", tag:"" },
  { id:"bot-04", category:"bottoms", name:"Shorts — Pit Crew", price:899, oldPrice:null, img:"", sizes:["S","M","L","XL"], stock:{S:8,M:8,L:8,XL:8}, desc:"Above-knee twill shorts with drawstring waist and utility pockets.", tag:"" },

  // ---- ACCESSORIES ----
  { id:"acc-01", category:"accessories", name:"Chrome Dogtag Chain", price:599, oldPrice:null, img:"", sizes:["One Size"], stock:{"One Size":15}, desc:"Stainless steel dogtag with the Kelto star mark engraved.", tag:"" },
  { id:"acc-02", category:"accessories", name:"Kelto Crossbody Bag", price:1399, oldPrice:1599, img:"", sizes:["One Size"], stock:{"One Size":6}, desc:"Compact utility crossbody in ballistic nylon with red zip pulls.", tag:"Limited" },
  { id:"acc-03", category:"accessories", name:"Racing Socks (2-pack)", price:399, oldPrice:null, img:"", sizes:["One Size"], stock:{"One Size":20}, desc:"Crew socks with jacquard Kelto lettering at the cuff.", tag:"" },

  // ---- CAPS ----
  { id:"cap-01", category:"caps", name:"Kelto Trucker Cap", price:699, oldPrice:null, img:"", sizes:["One Size"], stock:{"One Size":12}, desc:"Structured 5-panel trucker with embroidered chrome-red logo patch.", tag:"New" },
  { id:"cap-02", category:"caps", name:"Blackout Dad Cap", price:649, oldPrice:749, img:"", sizes:["One Size"], stock:{"One Size":9}, desc:"Low-profile unstructured cap, tonal black with a small side embroidery.", tag:"" },
  { id:"cap-03", category:"caps", name:"Spike Beanie", price:549, oldPrice:null, img:"", sizes:["One Size"], stock:{"One Size":0}, desc:"Ribbed knit beanie with woven Kelto star tag.", tag:"" }
];

/* PRODUCTS starts as the offline fallback and is swapped for live
   backend data as soon as it arrives — see KELTO_READY below. All
   helpers read from this variable each call, so once it's
   reassigned every page picks up the live catalog automatically. */
let PRODUCTS = FALLBACK_PRODUCTS;

function getProduct(id){ return PRODUCTS.find(p => p.id === id); }
function getCategoryProducts(slug){ return PRODUCTS.filter(p => p.category === slug); }
function totalStock(p){ return Object.values(p.stock || {}).reduce((a,b)=>a+b, 0); }
function fmtPrice(n){ return STORE.currency + Number(n).toLocaleString('en-IN'); }

/* Resolves once the live catalog has loaded (or failed and fallen
   back). Every page waits on this before rendering product data:
     KELTO_READY.then(() => { ...render... });
   Requires js/config.js (defines BACKEND_URL) to be loaded first. */
const KELTO_READY = (async function loadLiveCatalog(){
  try{
    const res = await fetch(`${BACKEND_URL}/api/products`, { cache: 'no-store' });
    if(res.ok){
      const data = await res.json();
      if(Array.isArray(data) && data.length){ PRODUCTS = data; }
    }
  }catch(err){
    console.warn('KELTO: could not reach backend, showing offline catalog.', err);
  }
  return PRODUCTS;
})();
