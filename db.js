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
`;

db.exec(SCHEMA);
try { db.exec("ALTER TABLE reservations ADD COLUMN table_name TEXT NOT NULL DEFAULT ''"); } catch { /* Existing local databases already have this column. */ }

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

seed();

module.exports = { db, DB_PATH, seed };
