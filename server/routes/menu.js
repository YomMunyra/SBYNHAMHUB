'use strict';

const express = require('express');
const { db } = require('../../db');
const { requireAuth } = require('../middleware/auth');
const { publicItem } = require('../format');

const router = express.Router();

router.get('/categories', (req, res) => {
  const rows = db
    .prepare('SELECT id, name, slug FROM categories ORDER BY sort ASC')
    .all();
  res.json(rows);
});

router.get('/menu', (req, res) => {
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

function slugify(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

router.post('/categories', requireAuth, (req, res) => {
  const { name = '' } = req.body;
  if (!String(name).trim()) return res.status(400).json({ error: 'Category name is required' });
  const slug = slugify(name) || 'category';
  const existing = db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug);
  if (existing) return res.status(409).json({ error: 'A category with that name already exists' });
  const next = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM categories').get().n;
  const id = Number(db.prepare('INSERT INTO categories (name, slug, sort) VALUES (?, ?, ?)').run(String(name).trim(), slug, next).lastInsertRowid);
  res.status(201).json({ ok: true, category: db.prepare('SELECT id, name, slug, sort FROM categories WHERE id = ?').get(id) });
});

router.delete('/categories/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const count = db.prepare('SELECT COUNT(*) AS n FROM menu_items WHERE category_id = ?').get(id).n;
  if (count) return res.status(409).json({ error: 'Move or delete dishes in this category first.' });
  const result = db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  if (!result.changes) return res.status(404).json({ error: 'Category not found' });
  res.json({ ok: true });
});

router.post('/menu', requireAuth, (req, res) => {
  const { name = '', category_id = '', price = '', description = '', image = '', tag = '', featured = 0, available = 1 } = req.body;
  const catId = Number(category_id);
  const priceNum = Number(price);
  if (!String(name).trim()) return res.status(400).json({ error: 'Dish name is required' });
  if (!Number.isInteger(catId) || !db.prepare('SELECT id FROM categories WHERE id = ?').get(catId)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  if (!Number.isFinite(priceNum) || priceNum < 0) return res.status(400).json({ error: 'Invalid price' });
  const id = Number(
    db.prepare(
      'INSERT INTO menu_items (category_id, name, description, price, image, tag, featured, available) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(catId, String(name).trim(), String(description || '').trim(), priceNum, String(image || 'plate.svg').trim(), tag ? String(tag).trim() : null, featured ? 1 : 0, available ? 1 : 0).lastInsertRowid
  );
  const row = db.prepare(
    `SELECT m.*, c.name AS category, c.slug AS category_slug FROM menu_items m JOIN categories c ON c.id = m.category_id WHERE m.id = ?`
  ).get(id);
  res.status(201).json({ ok: true, item: publicItem(row) });
});

router.patch('/menu/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Dish not found' });
  const { name, category_id, price, description, image, tag, featured, available } = req.body;
  const patch = {};
  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ error: 'Dish name is required' });
    patch.name = String(name).trim();
  }
  if (category_id !== undefined) {
    const catId = Number(category_id);
    if (!Number.isInteger(catId) || !db.prepare('SELECT id FROM categories WHERE id = ?').get(catId)) {
      return res.status(400).json({ error: 'Invalid category' });
    }
    patch.category_id = catId;
  }
  if (price !== undefined) {
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) return res.status(400).json({ error: 'Invalid price' });
    patch.price = priceNum;
  }
  if (description !== undefined) patch.description = String(description).trim();
  if (image !== undefined) patch.image = String(image || 'plate.svg').trim();
  if (tag !== undefined) patch.tag = String(tag).trim() || null;
  if (featured !== undefined) patch.featured = featured ? 1 : 0;
  if (available !== undefined) patch.available = available ? 1 : 0;
  const sets = Object.keys(patch).map((key) => `${key} = ?`);
  db.prepare(`UPDATE menu_items SET ${sets.join(', ')} WHERE id = ?`).run(...Object.values(patch), id);
  const row = db.prepare(
    `SELECT m.*, c.name AS category, c.slug AS category_slug FROM menu_items m JOIN categories c ON c.id = m.category_id WHERE m.id = ?`
  ).get(id);
  res.json({ ok: true, item: publicItem(row) });
});

router.delete('/menu/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare('DELETE FROM menu_items WHERE id = ?').run(id);
  if (!result.changes) return res.status(404).json({ error: 'Dish not found' });
  res.json({ ok: true });
});

module.exports = router;
