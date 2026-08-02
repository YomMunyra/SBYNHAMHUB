'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { db } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sbynham2026';
const TOKENS = new Set();

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function publicItem(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price,
    image: row.image,
    tag: row.tag,
    featured: !!row.featured,
    category: row.category,
    category_slug: row.category_slug
  };
}

const VALID_STATUS = ['pending', 'confirmed', 'arrived', 'cancelled', 'no-show'];
const VALID_OCCASIONS = ['', 'Birthday', 'Anniversary', 'Date Night', 'Business', 'Family Gathering', 'Other'];
const VALID_TABLES = Array.from({ length: 12 }, (_, index) => `T${index + 1}`);

function auth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!TOKENS.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/* ---------------- Menu ---------------- */

app.get('/api/categories', (req, res) => {
  const rows = db
    .prepare('SELECT id, name, slug FROM categories ORDER BY sort ASC')
    .all();
  res.json(rows);
});

app.get('/api/menu', (req, res) => {
  const { category, featured } = req.query;
  let sql = `
    SELECT m.*, c.name AS category, c.slug AS category_slug
    FROM menu_items m
    JOIN categories c ON c.id = m.category_id
  `;
  const where = [];
  const params = [];
  if (category) {
    where.push('c.slug = ?');
    params.push(category);
  }
  if (featured === '1') {
    where.push('m.featured = 1');
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY c.sort ASC, m.name ASC';
  const rows = db.prepare(sql).all(...params).map(publicItem);
  res.json(rows);
});

/* ---------------- Reservations ---------------- */

app.get('/api/reservations', auth, (req, res) => {
  const { date } = req.query;
  let sql = 'SELECT * FROM reservations';
  const params = [];
  if (date) {
    sql += ' WHERE date = ?';
    params.push(date);
  }
  sql += ' ORDER BY date ASC, time ASC, id DESC';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/reservations', (req, res) => {
  const {
    name = '',
    email = '',
    phone = '',
    date = '',
    time = '',
    guests = '',
    occasion = '',
    notes = ''
  } = req.body;

  const errs = [];
  if (!String(name).trim()) errs.push('name');
  if (!String(phone).trim()) errs.push('phone');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) errs.push('date');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) errs.push('time');
  const n = Number(guests);
  if (!Number.isInteger(n) || n < 1 || n > 20) errs.push('guests');
  if (occasion && !VALID_OCCASIONS.includes(String(occasion))) errs.push('occasion');

  if (errs.length) {
    return res.status(400).json({ error: 'Invalid fields: ' + errs.join(', ') });
  }

  const past = date + ' ' + time + ':00';
  if (new Date(past + 'Z').getTime() <= Date.now() - 15 * 60 * 1000) {
    return res.status(400).json({ error: 'Please pick a future date and time.' });
  }

  const result = db
    .prepare(
      `INSERT INTO reservations (name, email, phone, date, time, guests, occasion, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(name).trim(),
      String(email).trim(),
      String(phone).trim(),
      date,
      time,
      n,
      occasion || '',
      String(notes || '').trim()
    );

  const row = db
    .prepare('SELECT * FROM reservations WHERE id = ?')
    .get(result.lastInsertRowid);

  res.status(201).json({ ok: true, reservation: row });
});

app.patch('/api/reservations/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const { status, table } = req.body;
  if (status !== undefined && !VALID_STATUS.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (table !== undefined && table !== '' && !VALID_TABLES.includes(table)) return res.status(400).json({ error: 'Invalid table' });
  const result = db.prepare('UPDATE reservations SET status = COALESCE(?, status), table_name = COALESCE(?, table_name) WHERE id = ?').run(status ?? null, table ?? null, id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Reservation not found' });
  }
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  res.json({ ok: true, reservation: row });
});

app.delete('/api/reservations/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare('DELETE FROM reservations WHERE id = ?').run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Reservation not found' });
  }
  res.json({ ok: true });
});

app.get('/api/stats', auth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const all = db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n;
  const todayCount = db
    .prepare('SELECT COUNT(*) AS n FROM reservations WHERE date = ?')
    .get(today).n;
  const covers = db
    .prepare('SELECT COALESCE(SUM(guests), 0) AS n FROM reservations WHERE date = ?')
    .get(today).n;
  const confirmed = db
    .prepare("SELECT COUNT(*) AS n FROM reservations WHERE status = 'confirmed'")
    .get().n;
  const byStatus = db
    .prepare('SELECT status, COUNT(*) AS n FROM reservations GROUP BY status')
    .all();
  res.json({ total: all, today: todayCount, covers_today: covers, confirmed, by_status: byStatus });
});

/* ---------------- Admin auth ---------------- */

app.post('/api/auth', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(24).toString('hex');
    TOKENS.add(token);
    return res.json({ ok: true, token });
  }
  res.status(401).json({ error: 'Invalid password' });
});

/* ---------------- Pages ---------------- */

app.get(['/menu', '/book'], (req, res) => res.sendFile(path.join(__dirname, 'public', req.path.slice(1) + '.html')));
app.get('/manager', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'platform-admin.html')));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`SbyNhamHub running at http://localhost:${PORT}`);
  console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
});
