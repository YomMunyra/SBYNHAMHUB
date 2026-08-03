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
const analyticsRoutes = require('./routes/analytics');
const settingsRoutes = require('./routes/settings');
const waitlistRoutes = require('./routes/waitlist');
const manageRoutes = require('./routes/manage');
const promoRoutes = require('./routes/promos');
const adminRoutes = require('./routes/admin');
const paymentRoutes = require('./routes/payments');
const discoverRoutes = require('./routes/discover');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api', authRoutes);
  app.use('/api', menuRoutes);
  app.use('/api', reservationRoutes);
  app.use('/api', guestRoutes);
  app.use('/api', pointRoutes);
  app.use('/api', reviewRoutes);
  app.use('/api', analyticsRoutes);
  app.use('/api', settingsRoutes);
  app.use('/api', waitlistRoutes);
  app.use('/api', manageRoutes);
  app.use('/api', promoRoutes);
  app.use('/api', adminRoutes);
  app.use('/api', paymentRoutes);
  app.use('/api', discoverRoutes);

  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));
  app.get('/api/*', (req, res) => res.status(404).json({ error: 'Not found' }));
  const pages = {
    '/': ['customer', 'index.html'],
    '/discover': ['customer', 'discover.html'],
    '/menu': ['customer', 'menu.html'],
    '/book': ['customer', 'book.html'],
    '/reviews': ['customer', 'reviews.html'],
    '/points': ['customer', 'points.html'],
    '/manage': ['customer', 'manage.html'],
    '/pay': ['customer', 'pay.html'],
    '/receipt': ['customer', 'receipt.html'],
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
