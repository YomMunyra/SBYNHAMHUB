'use strict';

const path = require('node:path');
const express = require('express');
const { requireAuth } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const menuRoutes = require('./routes/menu');
const reservationRoutes = require('./routes/reservations');
const guestRoutes = require('./routes/guests');
const pointRoutes = require('./routes/points');
const reviewRoutes = require('./routes/reviews');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api', authRoutes);
  app.use('/api', menuRoutes);
  app.use('/api', reservationRoutes);
  app.use('/api', guestRoutes);
  app.use('/api', pointRoutes);
  app.use('/api', reviewRoutes);

  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));
  app.get('/api/*', (req, res) => res.status(404).json({ error: 'Not found' }));
  const pages = {
    '/': ['customer', 'index.html'],
    '/menu': ['customer', 'menu.html'],
    '/book': ['customer', 'book.html'],
    '/reviews': ['customer', 'reviews.html'],
    '/points': ['customer', 'points.html'],
    '/manager': ['manager', 'index.html'],
    '/admin': ['admin', 'index.html']
  };
  for (const [route, [folder, file]] of Object.entries(pages)) {
    app.get(route, (req, res) => res.sendFile(path.join(publicDir, folder, file)));
  }
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.join(publicDir, 'customer', 'index.html'));
  });

  return app;
}

module.exports = { createApp, requireAuth };
