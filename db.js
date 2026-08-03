'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'sbynhamhub.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL,
  image TEXT NOT NULL DEFAULT 'plate.svg',
  tag TEXT,
  featured INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  guests INTEGER NOT NULL,
  occasion TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER REFERENCES reservations(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  rating_food INTEGER NOT NULL,
  rating_service INTEGER NOT NULL,
  rating_ambience INTEGER NOT NULL,
  rating_value INTEGER NOT NULL,
  comment TEXT NOT NULL,
  reply TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guest_profiles (
  guest_key TEXT PRIMARY KEY,
  preferences TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS points_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  email TEXT,
  phone TEXT,
  balance INTEGER NOT NULL DEFAULT 0,
  lifetime INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS points_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_key TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT 'earned',
  ref_id TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  party_size INTEGER NOT NULL,
  preferred_date TEXT NOT NULL,
  preferred_time TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'waiting',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'SbyNhamHub',
  phone TEXT NOT NULL DEFAULT '+855 12 345 678',
  address TEXT NOT NULL DEFAULT '123 Riverside Walk, Phnom Penh',
  hours TEXT NOT NULL DEFAULT '{}',
  avg_cover REAL NOT NULL DEFAULT 15,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS promos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  type TEXT NOT NULL DEFAULT 'percent',
  value REAL NOT NULL DEFAULT 0,
  start_date TEXT,
  end_date TEXT,
  days TEXT NOT NULL DEFAULT '[]',
  start_time TEXT,
  end_time TEXT,
  min_covers INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_ref TEXT NOT NULL UNIQUE,
  reservation_id INTEGER REFERENCES reservations(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT,
  amount REAL NOT NULL,
  tip_pct REAL NOT NULL DEFAULT 0,
  tip_amount REAL NOT NULL DEFAULT 0,
  fee_rate REAL NOT NULL DEFAULT 0.0095,
  fee_flat REAL NOT NULL DEFAULT 0.5,
  fee_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  split_across INTEGER NOT NULL DEFAULT 1,
  split_index INTEGER NOT NULL DEFAULT 1,
  card_last4 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'paid',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

db.exec(SCHEMA);

db.exec(SCHEMA);
try { db.exec("ALTER TABLE reservations ADD COLUMN table_name TEXT NOT NULL DEFAULT ''"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE reservations ADD COLUMN points_awarded INTEGER NOT NULL DEFAULT 0"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE reservations ADD COLUMN points_redeemed INTEGER NOT NULL DEFAULT 0"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE reservations ADD COLUMN discount REAL NOT NULL DEFAULT 0"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE menu_items ADD COLUMN available INTEGER NOT NULL DEFAULT 1"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE reservations ADD COLUMN reminder_24h INTEGER NOT NULL DEFAULT 0"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE reservations ADD COLUMN reminder_2h INTEGER NOT NULL DEFAULT 0"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE reservations ADD COLUMN promo_id INTEGER NOT NULL DEFAULT 0"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE reservations ADD COLUMN promo_name TEXT NOT NULL DEFAULT ''"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE reservations ADD COLUMN promo_discount REAL NOT NULL DEFAULT 0"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE settings ADD COLUMN avg_cover REAL NOT NULL DEFAULT 15"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE settings ADD COLUMN fee_rate REAL NOT NULL DEFAULT 0.0095"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE settings ADD COLUMN fee_flat REAL NOT NULL DEFAULT 0.50"); } catch { /* Existing local databases already have this column. */ }

function seedSettings() {
  const existing = db.prepare('SELECT id FROM settings WHERE id = 1').get();
  if (existing) return;
  db.prepare(
    `INSERT INTO settings (id, name, phone, address, hours, avg_cover)
     VALUES (1, 'SbyNhamHub', '+855 12 345 678', '123 Riverside Walk, Phnom Penh', ?, 15)`
  ).run(
    JSON.stringify([
      { day: 'Monday – Thursday', hours: '11:00 – 22:00' },
      { day: 'Friday – Saturday', hours: '11:00 – 23:00' },
      { day: 'Sunday', hours: '11:00 – 21:00' }
    ])
  );
}

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n;
  if (count > 0) return false;

  const addCategory = db.prepare(
    'INSERT INTO categories (name, slug, sort) VALUES (?, ?, ?)'
  );
  const starters = Number(
    addCategory.run('Starters', 'starters', 1).lastInsertRowid
  );
  const mains = Number(addCategory.run('Mains', 'mains', 2).lastInsertRowid);
  const grills = Number(
    addCategory.run('Grills & Seafood', 'grills-seafood', 3).lastInsertRowid
  );
  const desserts = Number(
    addCategory.run('Desserts', 'desserts', 4).lastInsertRowid
  );
  const drinks = Number(
    addCategory.run('Drinks', 'drinks', 5).lastInsertRowid
  );

  const addItem = db.prepare(
    `INSERT INTO menu_items
       (category_id, name, description, price, image, tag, featured)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const items = [
    [starters, 'Fish Amok Bites', 'Steamed fish mousse in coconut curry, served in banana-leaf cups with jasmine rice.', 8.5, 'amok.svg', 'Chef\u2019s Pick', 1],
    [starters, 'Fresh Summer Rolls', 'Rice-paper rolls of prawn, herbs and vermicelli with peanut-lime dip.', 6.5, 'salad.svg', 'Veg Option', 0],
    [starters, 'Nom Banh Chok Salad', 'Khmer rice noodles tossed with lemongrass, fish sauce and garden herbs.', 7.0, 'noodles.svg', null, 0],
    [starters, 'Crispy Prawn Skewers', 'Five-spice prawns on sugarcane, charred and served with tamarind glaze.', 10.5, 'skewers.svg', 'New', 0],
    [starters, 'Tom Yum Soup', 'Hot-and-sour prawn soup with lemongrass, lime leaf and button mushrooms.', 7.5, 'curry.svg', 'Spicy', 0],

    [mains, 'Khmer Beef Lok Lak', 'Wok-seared beef in Kampot-pepper sauce, fresh lime, cucumber and fried egg.', 14.0, 'curry.svg', 'Signature', 1],
    [mains, 'Grilled Lemongrass Chicken', 'Free-range chicken marinated overnight in lemongrass, turmeric and kaffir lime.', 12.5, 'skewers.svg', null, 0],
    [mains, 'Char Kway Teow', 'Flat rice noodles, prawns and egg, wok-fried over open flame.', 11.0, 'noodles.svg', null, 0],
    [mains, 'Nasi Goreng SbyNham', 'House fried rice with sunny egg, prawn crackers and sambal on the side.', 10.5, 'curry.svg', null, 0],
    [mains, 'Pumpkin Coconut Curry', 'Slow-cooked pumpkin and chickpeas in coconut cream with Thai basil.', 11.5, 'curry.svg', 'Veg', 0],
    [mains, 'Seafood Hotpot', 'Mussels, prawns and fish in a saffron-lime broth for two.', 18.0, 'seafood.svg', 'For Two', 1],
    [mains, 'SbyNham Smash Burger', 'Double smashed beef, smoked gouda, caramelised onion and house sauce.', 13.0, 'burger.svg', null, 0],

    [grills, 'Whole Grilled Sea Bass', 'Fire-grilled sea bass with garlic butter and a squeeze of lime.', 19.0, 'seafood.svg', 'Chef\u2019s Pick', 1],
    [grills, 'BBQ Pork Ribs', 'Low-and-slow ribs lacquered in our honey-tamarind barbecue glaze.', 16.5, 'skewers.svg', null, 0],
    [grills, 'Satay Platter', 'Chicken, beef and prawn satay with peanut sauce and cucumber relish.', 14.0, 'skewers.svg', null, 0],
    [grills, 'Grilled Octopus', 'Charred octopus tentacle, smoked paprika oil and lemon aioli.', 17.0, 'seafood.svg', null, 0],

    [desserts, 'Sticky Rice & Mango', 'Warm glutinous rice, ripe mango and coconut cream.', 6.0, 'dessert.svg', 'Classic', 1],
    [desserts, 'Coconut Pandan Cake', 'Steamed sponge with coconut cream and pandan custard.', 5.5, 'dessert.svg', 'Veg', 0],
    [desserts, 'Banana Fritters', 'Golden fritters with honeycomb drizzle and vanilla ice cream.', 5.0, 'dessert.svg', null, 0],
    [desserts, 'Churros & Chocolate', 'Cinnamon-sugar churros with warm dark chocolate dip.', 6.5, 'dessert.svg', null, 0],

    [drinks, 'Fresh Young Coconut', 'Chilled and served whole with a straw. Refill, of course.', 3.5, 'drink.svg', null, 0],
    [drinks, 'Iced Thai Tea', 'Sweet Thai tea over ice with a cloud of evaporated milk.', 3.0, 'coffee.svg', null, 0],
    [drinks, 'Mango Smoothie', 'Blended Alphonso mango, lime and yogurt.', 4.5, 'drink.svg', 'Veg', 0],
    [drinks, 'House Sangria', 'Red wine, rum-soaked fruit and a splash of soda.', 6.0, 'drink.svg', null, 0],
    [drinks, 'Local Craft Beer', 'Pilsner from the Siem Reap brewery on tap. 330ml.', 4.0, 'drink.svg', null, 0]
  ];

  for (const item of items) addItem.run(...item);
  return true;
}

function seedReviews() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM reviews').get().n;
  if (count > 0) return false;

  const addReview = db.prepare(
    `INSERT INTO reviews
       (name, comment, rating_food, rating_service, rating_ambience, rating_value, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'published', ?)`
  );

  const reviews = [
    ['Channa Sok', 'Booked a table for two on the app, no phone call, no wait. They remembered our anniversary cake without being reminded. The whole night felt effortless.', 5, 5, 5, 4, '2026-07-18 21:10:00'],
    ['Mei Lin', 'We booked a group of fourteen for a family gathering — one tap, confirmed instantly, and the team kept every name straight. The lok lak was exceptional.', 5, 4, 4, 5, '2026-07-12 20:45:00'],
    ['Dara Kim', 'The reminder 2 hours before saved us after I double-booked myself. Called, they shifted our time with zero fuss. Service like this is why we keep coming back.', 5, 5, 4, 4, '2026-07-05 19:30:00'],
    ['Sreypov Chan', 'Came in off the street without a booking at peak hour and they still found us a corner table in minutes. Points from our last visit paid for dessert.', 4, 5, 4, 5, '2026-06-28 20:15:00'],
    ['Vannak Phoeun', 'Genuinely the easiest reservation I have ever made. Showed up, table was ready, name on the board. The sea bass was the best I have had in Phnom Penh.', 5, 4, 5, 4, '2026-06-21 19:00:00'],
    ['Bopha Rath', 'Nice spot, good food, but the kitchen was a little slow on a Friday. The team comped our drinks while we waited — that is how you handle a wait.', 4, 4, 4, 3, '2026-06-14 20:00:00']
  ];

  for (const review of reviews) addReview.run(...review);
  return true;
}

seed();
seedReviews();
seedSettings();

module.exports = { db, DB_PATH, seed };
