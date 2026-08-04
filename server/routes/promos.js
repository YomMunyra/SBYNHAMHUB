'use strict';

const express = require('express');
const { db } = require('../../db');
const { requireAuth } = require('../middleware/auth');
const { publicPromo, promoApplicable } = require('../lib/promos');

const router = express.Router();

const DAYS = [0, 1, 2, 3, 4, 5, 6];
const TIMES = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATES = /^\d{4}-\d{2}-\d{2}$/;

function validatePromo(body) {
  const {
    name = '',
    code = '',
    type = 'percent',
    value = '',
    start_date = '',
    end_date = '',
    days = [],
    start_time = '',
    end_time = '',
    min_covers = 0,
    max_uses = 0,
    featured = 0,
    active = 1,
    auto_end = 0
  } = body;

  if (!String(name).trim()) return { error: 'Promotion name is required' };
  if (!['percent', 'flat'].includes(String(type))) return { error: 'Discount type must be percent or flat' };
  const valueNum = Number(value);
  if (!Number.isFinite(valueNum) || valueNum <= 0) return { error: 'Discount value must be a positive number' };
  if (type === 'percent' && valueNum > 50) return { error: 'Percent discounts are capped at 50%' };

  let cleanCode = '';
  if (String(code).trim()) {
    cleanCode = String(code).trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,20}$/.test(cleanCode)) return { error: 'Promo code must be 2-20 characters (letters, numbers, _ or -)' };
    if (db.prepare('SELECT id FROM promos WHERE code = ?').get(cleanCode)) return { error: 'That promo code is already in use' };
  }

  if (start_date && !DATES.test(String(start_date))) return { error: 'Invalid start date' };
  if (end_date && !DATES.test(String(end_date))) return { error: 'Invalid end date' };
  if (start_date && end_date && String(start_date) > String(end_date)) return { error: 'Start date must be before end date' };

  const dayList = Array.isArray(days) ? days.map(Number) : [];
  if (dayList.some((d) => !DAYS.includes(d))) return { error: 'Invalid days selected' };

  if (start_time && !TIMES.test(String(start_time))) return { error: 'Invalid start time' };
  if (end_time && !TIMES.test(String(end_time))) return { error: 'Invalid end time' };
  if (start_time && end_time && String(start_time) > String(end_time)) return { error: 'Start time must be before end time' };

  const covers = Number(min_covers);
  if (!Number.isInteger(covers) || covers < 0) return { error: 'Minimum covers must be 0 or more' };
  const uses = Number(max_uses);
  if (!Number.isInteger(uses) || uses < 0) return { error: 'Usage limit must be 0 (unlimited) or more' };

  return {
    data: {
      name: String(name).trim(),
      code: cleanCode || null,
      type: String(type),
      value: valueNum,
      start_date: start_date || null,
      end_date: end_date || null,
      days: JSON.stringify(dayList),
      start_time: start_time || null,
      end_time: end_time || null,
      min_covers: covers,
      max_uses: uses,
      featured: featured ? 1 : 0,
      active: active ? 1 : 0,
      auto_end: auto_end ? 1 : 0
    }
  };
}

function toRow(row) {
  return {
    id: row.id,
    name: row.name,
    code: row.code || '',
    type: row.type,
    value: row.value,
    discount_label: row.type === 'percent' ? `${Number(row.value)}% off` : `$${Number(row.value).toFixed(2)} off`,
    start_date: row.start_date || '',
    end_date: row.end_date || '',
    days: (() => { try { return JSON.parse(row.days); } catch { return []; } })(),
    start_time: row.start_time || '',
    end_time: row.end_time || '',
    min_covers: row.min_covers,
    max_uses: row.max_uses,
    used: row.used,
    featured: Number(row.featured),
    active: Number(row.active),
    auto_end: Number(row.auto_end),
    created_at: row.created_at
  };
}

function allPromos(req, res) {
  res.json(db.prepare('SELECT * FROM promos ORDER BY id DESC').all().map(toRow));
}

router.get('/promos', (req, res, next) => {
  if (req.query.all) return requireAuth(req, res, () => allPromos(req, res));
  next();
});

router.get('/promos', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare('SELECT * FROM promos ORDER BY id DESC').all();
  const applicable = (row) => {
    if (!Number(row.active) || !Number(row.featured)) return false;
    if (row.max_uses > 0 && Number(row.used) >= Number(row.max_uses)) return false;
    if (row.start_date && String(row.start_date) > today) return false;
    if (row.end_date && String(row.end_date) < today) return false;
    return true;
  };
  res.json(rows.filter(applicable).map(publicPromo));
});

router.get('/promos/offers', (req, res) => {
  const { date = '', time = '', guests = 1 } = req.query;
  const rows = db.prepare('SELECT * FROM promos ORDER BY id DESC').all();
  const offers = rows
    .filter((row) => promoApplicable(row, { date, time, guests: Number(guests) }))
    .map(publicPromo);
  res.json(offers);
});

router.post('/promos', requireAuth, (req, res) => {
  const { data, error } = validatePromo(req.body);
  if (error) return res.status(400).json({ error });
  const id = Number(
    db.prepare(
      `INSERT INTO promos (name, code, type, value, start_date, end_date, days, start_time, end_time, min_covers, max_uses, featured, active, auto_end)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(data.name, data.code, data.type, data.value, data.start_date, data.end_date, data.days, data.start_time, data.end_time, data.min_covers, data.max_uses, data.featured, data.active, data.auto_end).lastInsertRowid
  );
  res.status(201).json({ ok: true, promo: toRow(db.prepare('SELECT * FROM promos WHERE id = ?').get(id)) });
});

router.patch('/promos/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM promos WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Promotion not found' });

  const body = req.body;
  const patch = {};
  const currentCode = existing.code || '';
  const nextCode = body.code !== undefined ? String(body.code).trim().toUpperCase() : currentCode;

  if (body.name !== undefined) {
    if (!String(body.name).trim()) return res.status(400).json({ error: 'Promotion name is required' });
    patch.name = String(body.name).trim();
  }
  if (body.type !== undefined && !['percent', 'flat'].includes(String(body.type))) return res.status(400).json({ error: 'Discount type must be percent or flat' });
  if (body.value !== undefined) {
    const valueNum = Number(body.value);
    const type = body.type !== undefined ? String(body.type) : existing.type;
    if (!Number.isFinite(valueNum) || valueNum <= 0) return res.status(400).json({ error: 'Discount value must be a positive number' });
    if (type === 'percent' && valueNum > 50) return res.status(400).json({ error: 'Percent discounts are capped at 50%' });
    patch.value = valueNum;
  }
  if (body.code !== undefined) {
    if (nextCode && !/^[A-Z0-9_-]{2,20}$/.test(nextCode)) return res.status(400).json({ error: 'Promo code must be 2-20 characters (letters, numbers, _ or -)' });
    const clash = nextCode ? db.prepare('SELECT id FROM promos WHERE code = ? AND id != ?').get(nextCode, id) : null;
    if (clash) return res.status(400).json({ error: 'That promo code is already in use' });
    patch.code = nextCode || null;
  }
  if (body.start_date !== undefined) {
    if (body.start_date && !DATES.test(String(body.start_date))) return res.status(400).json({ error: 'Invalid start date' });
    const end = body.end_date !== undefined ? String(body.end_date) : (existing.end_date || '');
    if (body.start_date && end && String(body.start_date) > end) return res.status(400).json({ error: 'Start date must be before end date' });
    patch.start_date = body.start_date || null;
  }
  if (body.end_date !== undefined) {
    if (body.end_date && !DATES.test(String(body.end_date))) return res.status(400).json({ error: 'Invalid end date' });
    const start = body.start_date !== undefined ? String(body.start_date) : (existing.start_date || '');
    if (start && body.end_date && start > String(body.end_date)) return res.status(400).json({ error: 'Start date must be before end date' });
    patch.end_date = body.end_date || null;
  }
  if (body.days !== undefined) {
    const dayList = Array.isArray(body.days) ? body.days.map(Number) : [];
    if (dayList.some((d) => !DAYS.includes(d))) return res.status(400).json({ error: 'Invalid days selected' });
    patch.days = JSON.stringify(dayList);
  }
  if (body.start_time !== undefined) {
    if (body.start_time && !TIMES.test(String(body.start_time))) return res.status(400).json({ error: 'Invalid start time' });
    const end = body.end_time !== undefined ? String(body.end_time) : (existing.end_time || '');
    if (body.start_time && end && String(body.start_time) > end) return res.status(400).json({ error: 'Start time must be before end time' });
    patch.start_time = body.start_time || null;
  }
  if (body.end_time !== undefined) {
    if (body.end_time && !TIMES.test(String(body.end_time))) return res.status(400).json({ error: 'Invalid end time' });
    const start = body.start_time !== undefined ? String(body.start_time) : (existing.start_time || '');
    if (start && body.end_time && start > String(body.end_time)) return res.status(400).json({ error: 'Start time must be before end time' });
    patch.end_time = body.end_time || null;
  }
  if (body.min_covers !== undefined) {
    const covers = Number(body.min_covers);
    if (!Number.isInteger(covers) || covers < 0) return res.status(400).json({ error: 'Minimum covers must be 0 or more' });
    patch.min_covers = covers;
  }
  if (body.max_uses !== undefined) {
    const uses = Number(body.max_uses);
    if (!Number.isInteger(uses) || uses < 0) return res.status(400).json({ error: 'Usage limit must be 0 (unlimited) or more' });
    patch.max_uses = uses;
  }
  if (body.featured !== undefined) patch.featured = body.featured ? 1 : 0;
  if (body.active !== undefined) patch.active = body.active ? 1 : 0;
  if (body.auto_end !== undefined) patch.auto_end = body.auto_end ? 1 : 0;

  const sets = Object.keys(patch).map((key) => `${key} = ?`);
  if (sets.length) db.prepare(`UPDATE promos SET ${sets.join(', ')} WHERE id = ?`).run(...Object.values(patch), id);
  res.json({ ok: true, promo: toRow(db.prepare('SELECT * FROM promos WHERE id = ?').get(id)) });
});

router.delete('/promos/:id', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM promos WHERE id = ?').run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Promotion not found' });
  res.json({ ok: true });
});

module.exports = router;
