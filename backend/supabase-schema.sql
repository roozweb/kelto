-- KELTO backend schema — run once in Supabase's SQL Editor.
-- Each table stores one row per record; "data" holds the exact same
-- JSON shape the backend already used on disk, so none of the
-- product/order/category/discount logic had to change — only where
-- it's stored.

create table if not exists products (
  id text primary key,
  data jsonb not null
);

create table if not exists orders (
  order_ref text primary key,
  data jsonb not null
);

create table if not exists categories (
  slug text primary key,
  data jsonb not null
);

create table if not exists discounts (
  id text primary key,
  data jsonb not null
);
