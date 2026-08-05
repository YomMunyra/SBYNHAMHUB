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

CREATE TABLE IF NOT EXISTS saves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_key TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (guest_key, item_id)
);

CREATE TABLE IF NOT EXISTS pref_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_key TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  signal INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (guest_key, item_id)
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  remaining INTEGER
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
  city TEXT NOT NULL DEFAULT 'Phnom Penh',
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
  auto_end INTEGER NOT NULL DEFAULT 0,
  occasions TEXT NOT NULL DEFAULT '[]',
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

CREATE TABLE IF NOT EXISTS yield_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  day_of_week INTEGER NOT NULL DEFAULT -1,
  start_time TEXT,
  end_time TEXT,
  min_covers INTEGER NOT NULL DEFAULT 0,
  discount_pct REAL NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  seats INTEGER NOT NULL DEFAULT 4,
  zone TEXT NOT NULL DEFAULT 'main',
  shape TEXT NOT NULL DEFAULT 'round',
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  rotation REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL UNIQUE,
  keys TEXT NOT NULL DEFAULT '{}',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS restaurants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT 'Phnom Penh',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  hours TEXT NOT NULL DEFAULT '[]',
  avg_cover REAL NOT NULL DEFAULT 15,
  capacity INTEGER NOT NULL DEFAULT 48,
  tagline TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT 'logo.svg',
  active INTEGER NOT NULL DEFAULT 1,
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
try { db.exec("ALTER TABLE reservations ADD COLUMN source TEXT NOT NULL DEFAULT 'online'"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE reservations ADD COLUMN sms_opt_in INTEGER NOT NULL DEFAULT 0"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE settings ADD COLUMN avg_cover REAL NOT NULL DEFAULT 15"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE settings ADD COLUMN fee_rate REAL NOT NULL DEFAULT 0.0095"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE settings ADD COLUMN integrations TEXT NOT NULL DEFAULT '{}'"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE settings ADD COLUMN vapid_keys TEXT NOT NULL DEFAULT '{}'"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE settings ADD COLUMN fee_flat REAL NOT NULL DEFAULT 0.50"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE settings ADD COLUMN capacity INTEGER NOT NULL DEFAULT 48"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE settings ADD COLUMN city TEXT NOT NULL DEFAULT 'Phnom Penh'"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE promos ADD COLUMN occasions TEXT NOT NULL DEFAULT '[]'"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE reservations ADD COLUMN yield_rule_id INTEGER NOT NULL DEFAULT 0"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE reservations ADD COLUMN yield_label TEXT NOT NULL DEFAULT ''"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE reservations ADD COLUMN yield_discount REAL NOT NULL DEFAULT 0"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE guest_profiles ADD COLUMN dietary TEXT NOT NULL DEFAULT '[]'"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE guest_profiles ADD COLUMN allergies TEXT NOT NULL DEFAULT '[]'"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE guest_profiles ADD COLUMN favourite_table TEXT NOT NULL DEFAULT ''"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE guest_profiles ADD COLUMN occasions TEXT NOT NULL DEFAULT '[]'"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE guest_profiles ADD COLUMN vip INTEGER NOT NULL DEFAULT 0"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE reviews ADD COLUMN spam INTEGER NOT NULL DEFAULT 0"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE reviews ADD COLUMN spam_reason TEXT NOT NULL DEFAULT ''"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE points_ledger ADD COLUMN expires_at TEXT"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE points_ledger ADD COLUMN remaining INTEGER"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE promos ADD COLUMN auto_end INTEGER NOT NULL DEFAULT 0"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE menu_items ADD COLUMN restaurant_id INTEGER NOT NULL DEFAULT 1"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE reservations ADD COLUMN restaurant_id INTEGER NOT NULL DEFAULT 1"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE promos ADD COLUMN restaurant_id INTEGER NOT NULL DEFAULT 1"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE yield_rules ADD COLUMN restaurant_id INTEGER NOT NULL DEFAULT 1"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE tables ADD COLUMN restaurant_id INTEGER NOT NULL DEFAULT 1"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE reviews ADD COLUMN restaurant_id INTEGER NOT NULL DEFAULT 1"); } catch { /* Existing local databases already have this column. */ }
try { db.exec("ALTER TABLE waitlist ADD COLUMN restaurant_id INTEGER NOT NULL DEFAULT 1"); } catch { /* Existing local databases already have this column. */ }
db.exec("UPDATE points_ledger SET remaining = delta, expires_at = datetime(created_at, '+18 months') WHERE reason = 'earned' AND remaining IS NULL");

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

function seedYieldRules() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM yield_rules').get().n;
  if (count > 0) return false;
  const addRule = db.prepare(
    `INSERT INTO yield_rules (name, day_of_week, start_time, end_time, min_covers, discount_pct, label, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  );
  addRule.run('Early-bird lunch', -1, '11:00', '13:00', 0, 15, 'Early-bird lunch');
  addRule.run('Weekday slow starter', -1, '17:30', '18:30', 0, 10, 'Weekday happy hour');
  addRule.run('Late-night wind-down', -1, '20:30', '21:30', 0, 12, 'Late-night wind-down');
  addRule.run('Sunday supper club', 0, '17:30', '21:00', 4, 20, 'Sunday supper club');
  return true;
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
    [starters, 'Fish Amok Bites', 'Steamed fish mousse in coconut curry, served in banana-leaf cups with jasmine rice.', 8.5, 'amok.jpg', 'Chef\u2019s Pick', 1],
    [starters, 'Fresh Summer Rolls', 'Rice-paper rolls of prawn, herbs and vermicelli with peanut-lime dip.', 6.5, 'summer-rolls.jpg', 'Veg Option', 0],
    [starters, 'Nom Banh Chok Salad', 'Khmer rice noodles tossed with lemongrass, fish sauce and garden herbs.', 7.0, 'noodle-salad.jpg', null, 0],
    [starters, 'Crispy Prawn Skewers', 'Five-spice prawns on sugarcane, charred and served with tamarind glaze.', 10.5, 'prawn-skewers.jpg', 'New', 0],
    [starters, 'Tom Yum Soup', 'Hot-and-sour prawn soup with lemongrass, lime leaf and button mushrooms.', 7.5, 'tom-yum.jpg', 'Spicy', 0],

    [mains, 'Khmer Beef Lok Lak', 'Wok-seared beef in Kampot-pepper sauce, fresh lime, cucumber and fried egg.', 14.0, 'lok-lak.jpg', 'Signature', 1],
    [mains, 'Grilled Lemongrass Chicken', 'Free-range chicken marinated overnight in lemongrass, turmeric and kaffir lime.', 12.5, 'lemongrass-chicken.jpg', null, 0],
    [mains, 'Char Kway Teow', 'Flat rice noodles, prawns and egg, wok-fried over open flame.', 11.0, 'char-kway-teow.jpg', null, 0],
    [mains, 'Nasi Goreng SbyNham', 'House fried rice with sunny egg, prawn crackers and sambal on the side.', 10.5, 'nasi-goreng.jpg', null, 0],
    [mains, 'Pumpkin Coconut Curry', 'Slow-cooked pumpkin and chickpeas in coconut cream with Thai basil.', 11.5, 'pumpkin-curry.jpg', 'Veg', 0],
    [mains, 'Seafood Hotpot', 'Mussels, prawns and fish in a saffron-lime broth for two.', 18.0, 'seafood-hotpot.jpg', 'For Two', 1],
    [mains, 'SbyNham Smash Burger', 'Double smashed beef, smoked gouda, caramelised onion and house sauce.', 13.0, 'smash-burger.jpg', null, 0],

    [grills, 'Whole Grilled Sea Bass', 'Fire-grilled sea bass with garlic butter and a squeeze of lime.', 19.0, 'sea-bass.jpg', 'Chef\u2019s Pick', 1],
    [grills, 'BBQ Pork Ribs', 'Low-and-slow ribs lacquered in our honey-tamarind barbecue glaze.', 16.5, 'bbq-ribs.jpg', null, 0],
    [grills, 'Satay Platter', 'Chicken, beef and prawn satay with peanut sauce and cucumber relish.', 14.0, 'satay.jpg', null, 0],
    [grills, 'Grilled Octopus', 'Charred octopus tentacle, smoked paprika oil and lemon aioli.', 17.0, 'octopus.jpg', null, 0],

    [desserts, 'Sticky Rice & Mango', 'Warm glutinous rice, ripe mango and coconut cream.', 6.0, 'mango-sticky-rice.jpg', 'Classic', 1],
    [desserts, 'Coconut Pandan Cake', 'Steamed sponge with coconut cream and pandan custard.', 5.5, 'pandan-cake.jpg', 'Veg', 0],
    [desserts, 'Banana Fritters', 'Golden fritters with honeycomb drizzle and vanilla ice cream.', 5.0, 'banana-fritters.jpg', null, 0],
    [desserts, 'Churros & Chocolate', 'Cinnamon-sugar churros with warm dark chocolate dip.', 6.5, 'churros.jpg', null, 0],

    [drinks, 'Fresh Young Coconut', 'Chilled and served whole with a straw. Refill, of course.', 3.5, 'coconut.jpg', null, 0],
    [drinks, 'Iced Thai Tea', 'Sweet Thai tea over ice with a cloud of evaporated milk.', 3.0, 'thai-tea.jpg', null, 0],
    [drinks, 'Mango Smoothie', 'Blended Alphonso mango, lime and yogurt.', 4.5, 'mango-smoothie.jpg', 'Veg', 0],
    [drinks, 'House Sangria', 'Red wine, rum-soaked fruit and a splash of soda.', 6.0, 'sangria.jpg', null, 0],
    [drinks, 'Local Craft Beer', 'Pilsner from the Siem Reap brewery on tap. 330ml.', 4.0, 'craft-beer.jpg', null, 0]
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

function seedTables() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM tables').get().n;
  if (count > 0) return false;
  const addTable = db.prepare(
    `INSERT INTO tables (name, seats, zone, shape, x, y, rotation, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  );
  const layout = [
    ['T1', 2, 'window', 'square', 5, 8, 0], ['T2', 2, 'window', 'square', 16, 8, 0],
    ['T3', 4, 'window', 'round', 8, 34, 0], ['T4', 4, 'window', 'round', 20, 34, 0],
    ['T5', 6, 'main', 'rectangle', 38, 6, 0], ['T6', 4, 'main', 'round', 52, 6, 0],
    ['T7', 4, 'main', 'round', 38, 30, 0], ['T8', 4, 'main', 'round', 52, 30, 0],
    ['T9', 8, 'main', 'rectangle', 40, 55, 0], ['T10', 4, 'patio', 'round', 72, 10, 0],
    ['T11', 2, 'patio', 'square', 82, 10, 0], ['T12', 6, 'patio', 'round', 74, 40, 0]
  ];
  for (const t of layout) addTable.run(...t);
  return true;
}

function seedRestaurants() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM restaurants').get().n;
  if (count > 0) return;
  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() || {};
  const add = db.prepare(
    `INSERT INTO restaurants (slug, name, city, address, phone, hours, avg_cover, capacity, tagline, avatar, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  );
  add.run(
    'sbynhamhub',
    settings.name || 'SbyNhamHub',
    settings.city || 'Phnom Penh',
    settings.address || '123 Riverside Walk, Phnom Penh',
    settings.phone || '+855 12 345 678',
    settings.hours || JSON.stringify([
      { day: 'Monday – Thursday', hours: '11:00 – 22:00' },
      { day: 'Friday – Saturday', hours: '11:00 – 23:00' },
      { day: 'Sunday', hours: '11:00 – 21:00' }
    ]),
    Number(settings.avg_cover || 15),
    Number(settings.capacity || 48),
    'Taste · Book · Enjoy — Southeast Asian flavours, beautifully served.',
    'logo.svg'
  );
  add.run(
    'wat-phnom-kitchen',
    'Wat Phnom Kitchen',
    'Phnom Penh',
    '88 Norodom Blvd, Phnom Penh',
    '+855 23 987 654',
    JSON.stringify([
      { day: 'Monday – Saturday', hours: '11:00 – 21:00' },
      { day: 'Sunday', hours: '12:00 – 20:00' }
    ]),
    12,
    32,
    'Family recipes from the old quarter — generous, honest Khmer cooking.',
    'curry.svg'
  );
  add.run(
    'templeside-grill',
    'Templeside Grill',
    'Siem Reap',
    '7 Pub Street, Siem Reap',
    '+855 63 765 432',
    JSON.stringify([
      { day: 'Daily', hours: '16:00 – 23:00' }
    ]),
    18,
    40,
    'Fire-grilled meats and cold craft beer, steps from the temples.',
    'skewers.svg'
  );
}

function seedPartners() {
  const partner = (slug) => db.prepare('SELECT id FROM restaurants WHERE slug = ?').get(slug);
  const wp = partner('wat-phnom-kitchen');
  const ts = partner('templeside-grill');
  if (!wp || !ts) return;

  const hasPartnerMenu = db.prepare('SELECT COUNT(*) AS n FROM menu_items WHERE restaurant_id = ?').get(wp.id).n;
  if (!hasPartnerMenu) {
    const cat = (slug) => db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug);
    const addItem = db.prepare(
      `INSERT INTO menu_items (category_id, name, description, price, image, tag, featured, restaurant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const wpItems = [
      [cat('starters').id, 'Num Pang Croutons', 'Toasted baguette with pâté, pickles and chilli mayo.', 4.5, 'noodle-salad.jpg', 'Classic', 1],
      [cat('mains').id, 'Amok de Mère', 'The house fish amok, steamed with fresh coconut cream.', 9.5, 'amok.jpg', 'Signature', 1],
      [cat('mains').id, 'Prahok Ktis', 'Pork belly in fragrant prahok-coconut dip with greens.', 10.0, 'lok-lak.jpg', null, 0],
      [cat('mains').id, 'Kampot Pepper Crab', 'Whole crab tossed in green Kampot pepper and butter.', 16.0, 'seafood-hotpot.jpg', 'For Two', 1],
      [cat('grills-seafood').id, 'Honey-Glazed Chicken Wings', 'Charred wings with honey, lemongrass and crushed peanuts.', 7.5, 'lemongrass-chicken.jpg', null, 0],
      [cat('desserts').id, 'Pandan Crepe Roulade', 'Rolled pandan crepe with young-coconut filling.', 4.5, 'pandan-cake.jpg', 'Classic', 1],
      [cat('drinks').id, 'Sugar-Cane Juice', 'Pressed sugar cane with a squeeze of lime.', 2.5, 'coconut.jpg', null, 0],
      [cat('drinks').id, 'Cambodian Iced Coffee', 'Strong espresso over sweetened condensed milk.', 3.0, 'thai-tea.jpg', null, 0]
    ];
    for (const item of wpItems) addItem.run(...item, wp.id);
  }

  const hasTsMenu = db.prepare('SELECT COUNT(*) AS n FROM menu_items WHERE restaurant_id = ?').get(ts.id).n;
  if (!hasTsMenu) {
    const cat = (slug) => db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug);
    const addItem = db.prepare(
      `INSERT INTO menu_items (category_id, name, description, price, image, tag, featured, restaurant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const tsItems = [
      [cat('starters').id, 'Charcoal Corn Ribs', 'Smoky grilled corn with lime-chilli butter.', 5.0, 'summer-rolls.jpg', 'New', 0],
      [cat('grills-seafood').id, 'Tomahawk for Two', 'Wagyu tomahawk, charred over open flame, jungle-spice rub.', 42.0, 'bbq-ribs.jpg', 'Signature', 1],
      [cat('grills-seafood').id, 'Beef Satay Sticks', 'Overnight-marinated beef skewers with peanut relish.', 9.0, 'satay.jpg', null, 0],
      [cat('grills-seafood').id, 'Smoked Ribs', '12-hour smoked pork ribs with tamarind barbecue glaze.', 14.5, 'bbq-ribs.jpg', null, 1],
      [cat('mains').id, 'Chargrilled Sea Bass', 'Whole sea bass with garlic butter and grilled lemon.', 18.0, 'sea-bass.jpg', 'Chef\u2019s Pick', 1],
      [cat('mains').id, 'Lok Lak Burger', 'Kampot-pepper beef patty, fried egg, cucumber relish.', 11.5, 'smash-burger.jpg', null, 0],
      [cat('desserts').id, 'Grilled Pineapple', 'Caramelised pineapple with palm-sugar syrup.', 4.0, 'mango-sticky-rice.jpg', 'Veg', 0],
      [cat('drinks').id, 'Angkor Draught', 'Local pale lager on tap, ice-cold. 330ml.', 3.5, 'craft-beer.jpg', null, 0]
    ];
    for (const item of tsItems) addItem.run(...item, ts.id);
  }

  const hasWpTables = db.prepare('SELECT COUNT(*) AS n FROM tables WHERE restaurant_id = ?').get(wp.id).n;
  if (!hasWpTables) {
    const addTable = db.prepare(
      `INSERT INTO tables (name, seats, zone, shape, x, y, rotation, active, restaurant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
    );
    const layout = [
      ['K1', 2, 'window', 'square', 8, 8, 0], ['K2', 2, 'window', 'square', 18, 8, 0],
      ['K3', 4, 'main', 'round', 30, 8, 0], ['K4', 4, 'main', 'round', 44, 8, 0],
      ['K5', 6, 'main', 'rectangle', 34, 38, 0], ['K6', 4, 'patio', 'round', 62, 18, 0]
    ];
    for (const t of layout) addTable.run(...t, wp.id);
  }

  const hasTsTables = db.prepare('SELECT COUNT(*) AS n FROM tables WHERE restaurant_id = ?').get(ts.id).n;
  if (!hasTsTables) {
    const addTable = db.prepare(
      `INSERT INTO tables (name, seats, zone, shape, x, y, rotation, active, restaurant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
    );
    const layout = [
      ['G1', 2, 'patio', 'square', 6, 6, 0], ['G2', 4, 'patio', 'round', 20, 6, 0],
      ['G3', 4, 'main', 'round', 36, 6, 0], ['G4', 6, 'main', 'rectangle', 50, 6, 0],
      ['G5', 8, 'main', 'rectangle', 34, 36, 0], ['G6', 4, 'bar', 'round', 66, 12, 0]
    ];
    for (const t of layout) addTable.run(...t, ts.id);
  }

  const hasWpYield = db.prepare('SELECT COUNT(*) AS n FROM yield_rules WHERE restaurant_id = ?').get(wp.id).n;
  if (!hasWpYield) {
    const addRule = db.prepare(
      `INSERT INTO yield_rules (name, day_of_week, start_time, end_time, min_covers, discount_pct, label, active, restaurant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
    );
    addRule.run('Lunchtime special', -1, '11:00', '14:00', 0, 10, 'Lunchtime special', wp.id);
    addRule.run('Sunday family feast', 0, '12:00', '20:00', 4, 15, 'Sunday family feast', wp.id);
  }
  const hasTsYield = db.prepare('SELECT COUNT(*) AS n FROM yield_rules WHERE restaurant_id = ?').get(ts.id).n;
  if (!hasTsYield) {
    const addRule = db.prepare(
      `INSERT INTO yield_rules (name, day_of_week, start_time, end_time, min_covers, discount_pct, label, active, restaurant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
    );
    addRule.run('Twilight grill hour', -1, '16:00', '18:00', 0, 8, 'Twilight grill hour', ts.id);
  }

  const hasWpPromo = db.prepare('SELECT COUNT(*) AS n FROM promos WHERE restaurant_id = ?').get(wp.id).n;
  if (!hasWpPromo) {
    db.prepare(
      `INSERT INTO promos (name, code, type, value, days, featured, active, occasions, restaurant_id)
       VALUES (?, ?, 'percent', ?, '[]', 1, 1, '[]', ?)`
    ).run('Khmer Classics Week', 'KHMER15', 15, wp.id);
  }
  const hasTsPromo = db.prepare('SELECT COUNT(*) AS n FROM promos WHERE restaurant_id = ?').get(ts.id).n;
  if (!hasTsPromo) {
    db.prepare(
      `INSERT INTO promos (name, code, type, value, days, featured, active, occasions, restaurant_id)
       VALUES (?, ?, 'percent', ?, '[]', 1, 1, '[]', ?)`
    ).run('Grill & Chill', 'EMBERS10', 10, ts.id);
  }
}

seed();
seedReviews();
seedSettings();
seedYieldRules();
seedTables();
seedRestaurants();
seedPartners();

module.exports = { db, DB_PATH, seed };
