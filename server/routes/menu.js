'use strict';

const express = require('express');
const { db } = require('../../db');
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

module.exports = router;
