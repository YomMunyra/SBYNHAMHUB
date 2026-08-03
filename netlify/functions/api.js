'use strict';

const crypto = require('node:crypto');
const { categories, menu } = require('./menu-data');
const { sendBookingConfirmation, sendReminder } = require('../../server/lib/mailer');

const VALID_STATUS = ['pending', 'confirmed', 'arrived', 'cancelled', 'no-show'];
const VALID_OCCASIONS = ['', 'Birthday', 'Anniversary', 'Date Night', 'Business', 'Family Gathering', 'Other'];
const VALID_TABLES = Array.from({ length: 12 }, (_, index) => `T${index + 1}`);
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const POINTS_PER_COVER = 100;
const POINTS_UNIT = 100;
const POINTS_RATE = 0.5;

function json(body, statusCode = 200) {
  return {
    statusCode,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  };
}

function secret(role = 'admin') {
  return role === 'manager' ? (process.env.MANAGER_PASSWORD || process.env.ADMIN_PASSWORD || '') : (process.env.ADMIN_PASSWORD || '');
}

function sign(value, role) {
  return crypto.createHmac('sha256', secret(role)).update(value).digest('base64url');
}

function createToken(role) {
  const payload = Buffer.from(JSON.stringify({ role, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload, role)}`;
}

function authorized(event) {
  const token = (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  let decoded;
  try { decoded = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return false; }
  if (!secret(decoded.role)) return false;
  const expected = sign(payload, decoded.role);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  return decoded.exp > Date.now();
}

async function reservationStore(event) {
  // @netlify/blobs is ESM-only, while this function uses CommonJS.
  const { connectLambda, getStore } = await import('@netlify/blobs');
  // Netlify passes short-lived Blobs credentials in each Lambda event.
  connectLambda(event);
  return getStore('sbynhamhub-reservations');
}

async function reservations(event) {
  const store = await reservationStore(event);
  const { blobs } = await store.list({ prefix: 'reservation/' });
  const values = await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json' })));
  return values.filter(Boolean);
}

function guestId(item) {
  return crypto.createHash('sha256').update(`${String(item.email || '').trim().toLowerCase()}|${String(item.phone || '').trim()}`).digest('base64url').slice(0, 18);
}

async function guests(event) {
  const items = await reservations(event);
  const store = await reservationStore(event);
  const grouped = new Map();
  for (const item of items) {
    const id = guestId(item);
    const current = grouped.get(id) || { id, name: item.name, email: item.email, phone: item.phone, visits: [], preferences: '' };
    current.visits.push(item);
    if (item.created_at > (current.latest_created_at || '')) { current.name = item.name; current.email = item.email; current.phone = item.phone; current.latest_created_at = item.created_at; }
    grouped.set(id, current);
  }
  return Promise.all([...grouped.values()].map(async (guest) => {
    const profile = await store.get(`guest/${guest.id}`, { type: 'json' });
    guest.preferences = profile?.preferences || '';
    guest.visits = sortReservations(guest.visits);
    guest.total_bookings = guest.visits.length;
    guest.last_visit = guest.visits.at(-1)?.date || '';
    const account = await store.get(`points/${guest.id}`, { type: 'json' });
    guest.points = account?.balance || 0;
    return guest;
  }));
}

function sortReservations(items) {
  return items.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`) || String(b.created_at).localeCompare(String(a.created_at)));
}

async function reviews(event) {
  const store = await reservationStore(event);
  const { blobs } = await store.list({ prefix: 'review/' });
  const values = await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json' })));
  return values.filter(Boolean);
}

function reviewOverall(item) {
  return Math.round((item.rating_food + item.rating_service + item.rating_ambience + item.rating_value) / 4);
}

function publicReview(item) {
  const parts = String(item.name || '').trim().split(/\s+/);
  const firstName = parts[0] || 'Guest';
  const lastInitial = parts.length > 1 ? ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.' : '';
  return {
    id: item.id,
    name: firstName + lastInitial,
    overall: reviewOverall(item),
    ratings: { food: item.rating_food, service: item.rating_service, ambience: item.rating_ambience, value: item.rating_value },
    comment: item.comment,
    reply: item.reply || '',
    created_at: item.created_at
  };
}

async function pointsAccount(store, key) {
  return (await store.get(`points/${key}`, { type: 'json' })) || { guest_key: key, name: '', email: '', phone: '', balance: 0, lifetime: 0 };
}

async function pointsLookup(event, store, email, phone) {
  const key = guestId({ email, phone });
  const account = await pointsAccount(store, key);
  const { blobs } = await store.list({ prefix: `ledger/${key}/` });
  const ledger = await Promise.all(blobs.map(({ key: blobKey }) => store.get(blobKey, { type: 'json' })));
  return { balance: account.balance, lifetime: account.lifetime, name: account.name, history: (ledger.filter(Boolean).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))).slice(0, 50) };
}

async function awardPoints(event, store, reservation) {
  if (Number(reservation.points_awarded)) return null;
  const key = guestId(reservation);
  const earned = Number(reservation.guests) * POINTS_PER_COVER;
  const account = await pointsAccount(store, key);
  account.balance += earned;
  account.lifetime += earned;
  if (String(reservation.name || '').trim()) account.name = String(reservation.name).trim();
  if (String(reservation.email || '').trim()) account.email = String(reservation.email).trim();
  if (String(reservation.phone || '').trim()) account.phone = String(reservation.phone).trim();
  await store.setJSON(`points/${key}`, account);
  await store.setJSON(`ledger/${key}/${crypto.randomUUID()}`, { delta: earned, reason: 'earned', ref_id: String(reservation.id), note: `Arrived booking #${reservation.id}`, created_at: new Date().toISOString() });
  reservation.points_awarded = 1;
  await store.setJSON(`reservation/${reservation.id}`, reservation);
  return { key, earned };
}

const DEFAULT_HOURS = [
  { day: 'Mon–Thu', hours: '11:00 AM – 10:00 PM' },
  { day: 'Fri–Sat', hours: '11:00 AM – 11:30 PM' },
  { day: 'Sunday', hours: '12:00 PM – 9:00 PM' }
];

async function nextCounter(store, name, min = 0) {
  const current = (await store.get(`meta/${name}`, { type: 'json' }))?.value || 0;
  const next = Math.max(current, min) + 1;
  await store.setJSON(`meta/${name}`, { value: next });
  return next;
}

async function loadCategories(store) {
  const { blobs } = await store.list({ prefix: 'cat/' });
  if (blobs.length) {
    const values = await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json' })));
    return values.filter(Boolean).sort((a, b) => a.id - b.id);
  }
  for (const category of categories) await store.setJSON(`cat/${category.id}`, category);
  return loadCategories(store);
}

async function loadMenu(store) {
  const { blobs } = await store.list({ prefix: 'menu/' });
  if (blobs.length) {
    const values = await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json' })));
    return values.filter(Boolean).sort((a, b) => a.id - b.id);
  }
  for (const item of menu) {
    const category = categories.find((c) => c.slug === item.category_slug);
    await store.setJSON(`menu/${item.id}`, { ...item, category_id: category ? category.id : 1, available: true });
  }
  return loadMenu(store);
}

function contactMatches(reservation, contact) {
  const c = String(contact || '').trim().toLowerCase();
  return c === String(reservation.email || '').trim().toLowerCase() || c === String(reservation.phone || '').trim();
}

async function storeGetJson(event, key) {
  const store = await reservationStore(event);
  return store.get(key, { type: 'json' });
}

function promoParseDays(promo) {
  const d = promo.days;
  if (Array.isArray(d)) return d.map(Number);
  try {
    const arr = JSON.parse(d);
    return Array.isArray(arr) ? arr.map(Number) : [];
  } catch {
    return [];
  }
}

function promoPublic(row) {
  return {
    id: row.id,
    name: row.name,
    code: row.code || '',
    type: row.type,
    value: row.value,
    discount_label: row.type === 'percent' ? `${Number(row.value)}% off` : `$${Number(row.value).toFixed(2)} off`,
    min_covers: row.min_covers,
    days: promoParseDays(row),
    start_time: row.start_time || '',
    end_time: row.end_time || '',
    used: row.used,
    max_uses: row.max_uses
  };
}

function promoApplicable(row, { date = '', time = '', guests = 1 } = {}) {
  if (!Number(row.active)) return false;
  if (row.max_uses > 0 && Number(row.used) >= Number(row.max_uses)) return false;
  if (row.start_date && String(row.start_date) > String(date)) return false;
  if (row.end_date && String(row.end_date) < String(date)) return false;
  if (row.min_covers > 0 && Number(guests) < Number(row.min_covers)) return false;
  const days = promoParseDays(row);
  if (days.length && date) {
    const dow = new Date(String(date) + 'T12:00:00').getDay();
    if (!days.includes(dow)) return false;
  }
  if (row.start_time && String(time) < String(row.start_time)) return false;
  if (row.end_time && String(time) > String(row.end_time)) return false;
  return true;
}

function promoDiscount(row, guests, avgCover) {
  if (row.type === 'flat') return Number(row.value);
  return Math.round(Number(guests) * Number(avgCover) * (Number(row.value) / 100) * 100) / 100;
}

async function loadPromos(store) {
  const { blobs } = await store.list({ prefix: 'promo/' });
  if (!blobs.length) return [];
  const values = await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json' })));
  return values.filter(Boolean).sort((a, b) => b.id - a.id);
}

async function findPromoByCode(store, code) {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return null;
  const promos = await loadPromos(store);
  return promos.find((p) => p.code === clean) || null;
}

function requestUrl(event) {
  if (event.rawUrl) return new URL(event.rawUrl);
  const host = event.headers?.host || 'localhost';
  const protocol = event.headers?.['x-forwarded-proto'] || 'https';
  return new URL(`${protocol}://${host}${event.path || '/'}${event.rawQuery ? `?${event.rawQuery}` : ''}`);
}

function requestPath(event) {
  return requestUrl(event).pathname
    .replace(/^\/.netlify\/functions\/api/, '')
    .replace(/^\/api/, '') || '/';
}

function readBody(event) {
  if (!event.body) return {};
  try {
    const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    return JSON.parse(body);
  } catch {
    return {};
  }
}

exports.handler = async (event) => {
  const path = requestPath(event);
  const method = event.httpMethod;
  const url = requestUrl(event);

  if (method === 'GET' && path === '/categories') {
    const store = await reservationStore(event);
    return json(await loadCategories(store));
  }
  if (method === 'GET' && path === '/menu') {
    const store = await reservationStore(event);
    let items = await loadMenu(store);
    if (url.searchParams.get('category')) items = items.filter((item) => item.category_slug === url.searchParams.get('category'));
    if (url.searchParams.get('featured') === '1') items = items.filter((item) => item.featured);
    return json(items);
  }

  if (method === 'POST' && path === '/categories') {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const { name = '' } = readBody(event);
    if (!String(name).trim()) return json({ error: 'Category name is required' }, 400);
    const store = await reservationStore(event);
    const cats = await loadCategories(store);
    const slug = String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'category';
    if (cats.some((c) => c.slug === slug)) return json({ error: 'A category with that name already exists.' }, 409);
    const id = await nextCounter(store, 'cat-counter', 5);
    const category = { id, name: String(name).trim(), slug };
    await store.setJSON(`cat/${id}`, category);
    return json({ ok: true, category }, 201);
  }

  if (method === 'POST' && path === '/menu') {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const { name = '', category_id = '', price = '', description = '', image = '', tag = '', featured = 0, available = 1 } = readBody(event);
    if (!String(name).trim()) return json({ error: 'Dish name is required' }, 400);
    const store = await reservationStore(event);
    const cats = await loadCategories(store);
    const cat = cats.find((c) => c.id === Number(category_id));
    if (!cat) return json({ error: 'Invalid category' }, 400);
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) return json({ error: 'Invalid price' }, 400);
    const id = await nextCounter(store, 'menu-counter', 25);
    const item = { id, name: String(name).trim(), description: String(description || '').trim(), price: priceNum, image: String(image || 'plate.svg').trim(), tag: String(tag || '').trim() || null, featured: Boolean(featured), available: !(available === 0 || available === false || available === '0' || available === 'false'), category_id: cat.id, category: cat.name, category_slug: cat.slug };
    await store.setJSON(`menu/${id}`, item);
    return json({ ok: true, item }, 201);
  }

  const menuMatch = path.match(/^\/menu\/(\d+)$/);
  if (menuMatch && method === 'PATCH') {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const store = await reservationStore(event);
    const key = `menu/${Number(menuMatch[1])}`;
    const item = await store.get(key, { type: 'json' });
    if (!item) return json({ error: 'Dish not found' }, 404);
    const body = readBody(event);
    if (body.name !== undefined) {
      if (!String(body.name).trim()) return json({ error: 'Dish name is required' }, 400);
      item.name = String(body.name).trim();
    }
    if (body.category_id !== undefined) {
      const cat = (await loadCategories(store)).find((c) => c.id === Number(body.category_id));
      if (!cat) return json({ error: 'Invalid category' }, 400);
      item.category_id = cat.id;
      item.category = cat.name;
      item.category_slug = cat.slug;
    }
    if (body.price !== undefined) {
      const priceNum = Number(body.price);
      if (!Number.isFinite(priceNum) || priceNum < 0) return json({ error: 'Invalid price' }, 400);
      item.price = priceNum;
    }
    if (body.description !== undefined) item.description = String(body.description).trim();
    if (body.image !== undefined) item.image = String(body.image || 'plate.svg').trim();
    if (body.tag !== undefined) item.tag = String(body.tag).trim() || null;
    if (body.featured !== undefined) item.featured = Boolean(body.featured);
    if (body.available !== undefined) item.available = Boolean(body.available);
    await store.setJSON(key, item);
    return json({ ok: true, item });
  }

  if (menuMatch && method === 'DELETE') {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const store = await reservationStore(event);
    const key = `menu/${Number(menuMatch[1])}`;
    const item = await store.get(key, { type: 'json' });
    if (!item) return json({ error: 'Dish not found' }, 404);
    await store.delete(key);
    return json({ ok: true });
  }

  const catMatch = path.match(/^\/categories\/(\d+)$/);
  if (catMatch && method === 'DELETE') {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const store = await reservationStore(event);
    const items = await loadMenu(store);
    if (items.some((i) => i.category_id === Number(catMatch[1]))) return json({ error: 'Move or delete dishes in this category first.' }, 409);
    await store.delete(`cat/${Number(catMatch[1])}`);
    return json({ ok: true });
  }

  if (method === 'GET' && path === '/promos/offers') {
    const store = await reservationStore(event);
    const promos = await loadPromos(store);
    return json(promos.filter((p) => promoApplicable(p, { date: url.searchParams.get('date') || '', time: url.searchParams.get('time') || '', guests: Number(url.searchParams.get('guests')) || 1 })).map(promoPublic));
  }

  if (method === 'GET' && path === '/promos') {
    const store = await reservationStore(event);
    const promos = await loadPromos(store);
    if (url.searchParams.get('all') === '1') {
      if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
      return json(promos);
    }
    const today = new Date().toISOString().slice(0, 10);
    return json(promos.filter((p) => Number(p.active) && Number(p.featured) && (!p.max_uses || Number(p.used) < Number(p.max_uses)) && (!p.start_date || p.start_date <= today) && (!p.end_date || p.end_date >= today)).map(promoPublic));
  }

  if (method === 'POST' && path === '/promos') {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const body = readBody(event);
    const { name = '', code = '', type = 'percent', value = '', start_date = '', end_date = '', days = [], start_time = '', end_time = '', min_covers = 0, max_uses = 0, featured = 0, active = 1 } = body;
    if (!String(name).trim()) return json({ error: 'Promotion name is required' }, 400);
    if (!['percent', 'flat'].includes(String(type))) return json({ error: 'Discount type must be percent or flat' }, 400);
    const valueNum = Number(value);
    if (!Number.isFinite(valueNum) || valueNum <= 0) return json({ error: 'Discount value must be a positive number' }, 400);
    if (type === 'percent' && valueNum > 50) return json({ error: 'Percent discounts are capped at 50%' }, 400);
    let cleanCode = '';
    if (String(code).trim()) {
      cleanCode = String(code).trim().toUpperCase();
      if (!/^[A-Z0-9_-]{2,20}$/.test(cleanCode)) return json({ error: 'Promo code must be 2-20 characters (letters, numbers, _ or -)' }, 400);
      const store = await reservationStore(event);
      if (await findPromoByCode(store, cleanCode)) return json({ error: 'That promo code is already in use' }, 400);
    }
    if (start_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(start_date))) return json({ error: 'Invalid start date' }, 400);
    if (end_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(end_date))) return json({ error: 'Invalid end date' }, 400);
    if (start_date && end_date && String(start_date) > String(end_date)) return json({ error: 'Start date must be before end date' }, 400);
    const dayList = Array.isArray(days) ? days.map(Number) : [];
    if (dayList.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return json({ error: 'Invalid days selected' }, 400);
    if (start_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(start_time))) return json({ error: 'Invalid start time' }, 400);
    if (end_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(end_time))) return json({ error: 'Invalid end time' }, 400);
    if (start_time && end_time && String(start_time) > String(end_time)) return json({ error: 'Start time must be before end time' }, 400);
    const covers = Number(min_covers);
    const uses = Number(max_uses);
    if (!Number.isInteger(covers) || covers < 0) return json({ error: 'Minimum covers must be 0 or more' }, 400);
    if (!Number.isInteger(uses) || uses < 0) return json({ error: 'Usage limit must be 0 (unlimited) or more' }, 400);
    const store = await reservationStore(event);
    const promo = { id: await nextCounter(store, 'promo-counter'), name: String(name).trim(), code: cleanCode || null, type: String(type), value: valueNum, start_date: start_date || null, end_date: end_date || null, days: dayList, start_time: start_time || null, end_time: end_time || null, min_covers: covers, max_uses: uses, used: 0, featured: featured ? 1 : 0, active: active ? 1 : 0, created_at: new Date().toISOString() };
    await store.setJSON(`promo/${promo.id}`, promo);
    return json({ ok: true, promo }, 201);
  }

  const promoMatch = path.match(/^\/promos\/(\d+)$/);
  if (promoMatch && (method === 'PATCH' || method === 'DELETE')) {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const store = await reservationStore(event);
    const key = `promo/${Number(promoMatch[1])}`;
    const promo = await store.get(key, { type: 'json' });
    if (!promo) return json({ error: 'Promotion not found' }, 404);
    if (method === 'DELETE') { await store.delete(key); return json({ ok: true }); }
    const body = readBody(event);
    if (body.name !== undefined) {
      if (!String(body.name).trim()) return json({ error: 'Promotion name is required' }, 400);
      promo.name = String(body.name).trim();
    }
    if (body.type !== undefined) {
      if (!['percent', 'flat'].includes(String(body.type))) return json({ error: 'Discount type must be percent or flat' }, 400);
      promo.type = String(body.type);
    }
    if (body.value !== undefined) {
      const valueNum = Number(body.value);
      if (!Number.isFinite(valueNum) || valueNum <= 0) return json({ error: 'Discount value must be a positive number' }, 400);
      if (promo.type === 'percent' && valueNum > 50) return json({ error: 'Percent discounts are capped at 50%' }, 400);
      promo.value = valueNum;
    }
    if (body.code !== undefined) {
      const cleanCode = String(body.code).trim().toUpperCase();
      if (cleanCode && !/^[A-Z0-9_-]{2,20}$/.test(cleanCode)) return json({ error: 'Promo code must be 2-20 characters (letters, numbers, _ or -)' }, 400);
      const clash = cleanCode ? (await loadPromos(store)).find((p) => p.code === cleanCode && p.id !== promo.id) : null;
      if (clash) return json({ error: 'That promo code is already in use' }, 400);
      promo.code = cleanCode || null;
    }
    if (body.start_date !== undefined) {
      if (body.start_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.start_date))) return json({ error: 'Invalid start date' }, 400);
      promo.start_date = body.start_date || null;
    }
    if (body.end_date !== undefined) {
      if (body.end_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.end_date))) return json({ error: 'Invalid end date' }, 400);
      promo.end_date = body.end_date || null;
    }
    if (body.days !== undefined) {
      const dayList = Array.isArray(body.days) ? body.days.map(Number) : [];
      if (dayList.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return json({ error: 'Invalid days selected' }, 400);
      promo.days = dayList;
    }
    if (body.start_time !== undefined) {
      if (body.start_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.start_time))) return json({ error: 'Invalid start time' }, 400);
      promo.start_time = body.start_time || null;
    }
    if (body.end_time !== undefined) {
      if (body.end_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.end_time))) return json({ error: 'Invalid end time' }, 400);
      promo.end_time = body.end_time || null;
    }
    if (body.min_covers !== undefined) {
      const covers = Number(body.min_covers);
      if (!Number.isInteger(covers) || covers < 0) return json({ error: 'Minimum covers must be 0 or more' }, 400);
      promo.min_covers = covers;
    }
    if (body.max_uses !== undefined) {
      const uses = Number(body.max_uses);
      if (!Number.isInteger(uses) || uses < 0) return json({ error: 'Usage limit must be 0 (unlimited) or more' }, 400);
      promo.max_uses = uses;
    }
    if (body.featured !== undefined) promo.featured = body.featured ? 1 : 0;
    if (body.active !== undefined) promo.active = body.active ? 1 : 0;
    await store.setJSON(key, promo);
    return json({ ok: true, promo });
  }

  if (path === '/settings') {
    const store = await reservationStore(event);
    if (method === 'GET') {
      const saved = (await store.get('settings/restaurant', { type: 'json' })) || {};
      return json({ name: saved.name || 'SbyNhamHub', phone: saved.phone || '+855 12 345 678', address: saved.address || '123 Riverside Walk, Phnom Penh', hours: saved.hours || DEFAULT_HOURS, avg_cover: saved.avg_cover || 15 });
    }
    if (method === 'PATCH') {
      if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
      const settings = readBody(event);
      await store.setJSON('settings/restaurant', settings);
      return json({ ok: true, settings });
    }
  }

  if (method === 'POST' && path === '/auth') {
    const { password, role = 'manager' } = readBody(event);
    if (!['manager', 'admin'].includes(role) || !secret(role)) return json({ error: `${role === 'admin' ? 'Admin' : 'Manager'} login is not configured.` }, 503);
    return password === secret(role) ? json({ ok: true, role, token: createToken(role) }) : json({ error: 'Invalid password' }, 401);
  }

  if (path.startsWith('/reservations') || path === '/stats' || path === '/analytics' || path === '/waitlist' || path === '/reminders') {
    const publicEndpoints =
      (method === 'POST' && (path === '/reservations' || path === '/reservations/lookup' || /\/cancel$/.test(path))) ||
      (method === 'PATCH' && /\/modify$/.test(path)) ||
      (method === 'GET' && path === '/waitlist' && url.searchParams.get('public') === '1');
    if (!authorized(event) && !publicEndpoints) return json({ error: 'Unauthorized' }, 401);
  }

  if (path === '/guests' && !authorized(event)) return json({ error: 'Unauthorized' }, 401);

  if (method === 'GET' && path === '/guests') return json(await guests(event));

  const guestMatch = path.match(/^\/guests\/([^/]+)$/);
  if (guestMatch && method === 'PATCH') {
    const { preferences = '' } = readBody(event);
    if (String(preferences).length > 1000) return json({ error: 'Preferences are too long' }, 400);
    const store = await reservationStore(event);
    await store.setJSON(`guest/${guestMatch[1]}`, { preferences: String(preferences).trim(), updated_at: new Date().toISOString() });
    return json({ ok: true });
  }

  if (method === 'POST' && path === '/reservations') {
    const body = readBody(event);
    const { name = '', email = '', phone = '', date = '', time = '', guests = '', occasion = '', notes = '', redeem_points = '', promo_code = '' } = body;
    const invalid = [];
    if (!String(name).trim()) invalid.push('name');
    if (!String(phone).trim()) invalid.push('phone');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) invalid.push('date');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) invalid.push('time');
    const partySize = Number(guests);
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 20) invalid.push('guests');
    if (occasion && !VALID_OCCASIONS.includes(String(occasion))) invalid.push('occasion');
    if (invalid.length) return json({ error: `Invalid fields: ${invalid.join(', ')}` }, 400);
    if (new Date(`${date} ${time}:00Z`).getTime() <= Date.now() - 15 * 60 * 1000) return json({ error: 'Please pick a future date and time.' }, 400);

    let points_redeemed = 0;
    let discount = 0;
    const rp = Number(redeem_points);
    if (rp) {
      if (!String(email).trim()) return json({ error: 'Add an email to redeem points.' }, 400);
      if (!Number.isInteger(rp) || rp < POINTS_UNIT || rp % POINTS_UNIT !== 0) return json({ error: `Points must be a multiple of ${POINTS_UNIT}.` }, 400);
      const store = await reservationStore(event);
      const key = guestId({ email, phone });
      const account = await pointsAccount(store, key);
      if (account.balance < rp) return json({ error: 'Not enough points for that email.' }, 400);
      account.balance -= rp;
      await store.setJSON(`points/${key}`, account);
      discount = (rp / POINTS_UNIT) * POINTS_RATE;
      points_redeemed = rp;
    }

    let promo_id = 0;
    let promo_name = '';
    let promo_discount = 0;
    const store = await reservationStore(event);
    const settings = (await store.get('settings/restaurant', { type: 'json' })) || {};
    const avgCover = Number(settings.avg_cover) || 15;
    if (String(promo_code).trim()) {
      const promo = await findPromoByCode(store, promo_code);
      if (!promo) return json({ error: 'That promo code is not valid.' }, 400);
      if (!promoApplicable(promo, { date, time, guests: partySize })) {
        if (promo.max_uses > 0 && Number(promo.used) >= Number(promo.max_uses)) return json({ error: 'That promo has reached its usage limit.' }, 400);
        return json({ error: 'That promo does not apply to your date, time or party size.' }, 400);
      }
      promo.used += 1;
      await store.setJSON(`promo/${promo.id}`, promo);
      promo_id = promo.id;
      promo_name = promo.name;
      promo_discount = promoDiscount(promo, partySize, avgCover);
      discount += promo_discount;
    }

    const reservation = { id: crypto.randomUUID(), name: String(name).trim(), email: String(email).trim(), phone: String(phone).trim(), date, time, guests: partySize, occasion: occasion || '', notes: String(notes || '').trim(), table: '', status: 'pending', points_awarded: 0, points_redeemed, discount, promo_id, promo_name, promo_discount, reminder_24h: 0, reminder_2h: 0, created_at: new Date().toISOString() };
    await store.setJSON(`reservation/${reservation.id}`, reservation);
    if (points_redeemed) {
      await store.setJSON(`ledger/${guestId({ email, phone })}/${crypto.randomUUID()}`, { delta: -points_redeemed, reason: 'redeemed', ref_id: String(reservation.id), note: `Discount $${discount.toFixed(2)} on booking #${reservation.id}`, created_at: new Date().toISOString() });
    }
    try { await sendBookingConfirmation(reservation); } catch { /* email is best-effort */ }
    return json({ ok: true, reservation }, 201);
  }

  if (method === 'GET' && path === '/reservations') {
    const date = url.searchParams.get('date');
    const items = sortReservations(await reservations(event)).filter((item) => !date || item.date === date);
    return json(items);
  }

  if (method === 'GET' && path === '/stats') {
    const items = await reservations(event);
    const today = new Date().toISOString().slice(0, 10);
    const todays = items.filter((item) => item.date === today);
    const by_status = VALID_STATUS.map((status) => ({ status, n: items.filter((item) => item.status === status).length })).filter((item) => item.n);
    return json({ total: items.length, today: todays.length, covers_today: todays.reduce((total, item) => total + Number(item.guests), 0), confirmed: items.filter((item) => item.status === 'confirmed').length, by_status });
  }

  if (method === 'GET' && path === '/points/lookup') {
    const store = await reservationStore(event);
    const result = await pointsLookup(event, store, url.searchParams.get('email') || '', url.searchParams.get('phone') || '');
    return json({ balance: result.balance, lifetime: result.lifetime, name: result.name, history: result.history });
  }

  if (method === 'GET' && path === '/reviews/summary') {
    const items = await reviews(event);
    const published = items.filter((item) => item.status === 'published');
    const count = published.length;
    const avg = count ? published.reduce((sum, item) => sum + reviewOverall(item), 0) / count : 0;
    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (const item of published) distribution[reviewOverall(item)] += 1;
    return json({ count, avg: Math.round(avg * 10) / 10, distribution });
  }

  if (method === 'GET' && path === '/reviews') {
    const all = url.searchParams.get('all') === '1';
    if (all && !authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const items = (await reviews(event)).sort((a, b) => String(b.id).localeCompare(String(a.id)));
    return json(all ? items : items.filter((item) => item.status === 'published').map(publicReview));
  }

  if (method === 'POST' && path === '/reviews') {
    const body = readBody(event);
    const { reservation_id = '', contact = '', food = '', service = '', ambience = '', value = '', comment = '' } = body;
    const invalid = [];
    if (!String(reservation_id).trim()) invalid.push('reservation_id');
    if (!String(contact).trim()) invalid.push('contact');
    const ratings = [food, service, ambience, value].map(Number);
    for (const r of ratings) { if (!Number.isInteger(r) || r < 1 || r > 5) invalid.push('rating'); }
    if (!String(comment).trim()) invalid.push('comment');
    if (String(comment).trim().length > 2000) invalid.push('comment length');
    if (invalid.length) return json({ error: `Invalid fields: ${invalid.join(', ')}` }, 400);

    const store = await reservationStore(event);
    const reservation = await store.get(`reservation/${reservation_id}`, { type: 'json' });
    if (!reservation) return json({ error: 'No booking found with that reference.' }, 404);

    if (new Date(`${reservation.date} ${reservation.time}:00Z`).getTime() >= Date.now()) {
      return json({ error: 'Reviews are only possible after your visit.' }, 400);
    }
    if (!['arrived', 'confirmed', 'completed'].includes(reservation.status)) {
      return json({ error: 'Only completed visits can be reviewed.' }, 400);
    }

    const c = String(contact).trim().toLowerCase();
    const email = String(reservation.email || '').trim().toLowerCase();
    const phone = String(reservation.phone || '').trim();
    if (c !== email && c !== phone) {
      return json({ error: 'That contact does not match the booking.' }, 403);
    }

    const existing = (await reviews(event)).find((item) => item.reservation_id === reservation_id);
    if (existing) return json({ error: 'A review already exists for this booking.' }, 409);

    const review = {
      id: crypto.randomUUID(),
      reservation_id,
      name: String(reservation.name).trim(),
      email: String(reservation.email || '').trim(),
      phone: String(reservation.phone || '').trim(),
      rating_food: ratings[0], rating_service: ratings[1], rating_ambience: ratings[2], rating_value: ratings[3],
      comment: String(comment).trim(),
      reply: '',
      status: 'pending',
      created_at: new Date().toISOString()
    };
    await store.setJSON(`review/${review.id}`, review);
    return json({ ok: true, review: publicReview(review) }, 201);
  }

  const reviewMatch = path.match(/^\/reviews\/([^/]+)$/);
  if (reviewMatch && method === 'PATCH') {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const { status, reply } = readBody(event);
    if (status !== undefined && !['pending', 'published', 'hidden'].includes(status)) return json({ error: 'Invalid status' }, 400);
    if (reply !== undefined && String(reply).length > 1000) return json({ error: 'Reply is too long' }, 400);
    const store = await reservationStore(event);
    const key = `review/${reviewMatch[1]}`;
    const review = await store.get(key, { type: 'json' });
    if (!review) return json({ error: 'Review not found' }, 404);
    if (status !== undefined) review.status = status;
    if (reply !== undefined) review.reply = String(reply).trim();
    await store.setJSON(key, review);
    return json({ ok: true, review });
  }

  if (method === 'POST' && path === '/reservations/lookup') {
    const { id = '', contact = '' } = readBody(event);
    if (!String(id).trim()) return json({ error: 'Booking reference is required.' }, 400);
    if (!String(contact).trim()) return json({ error: 'Email or phone is required.' }, 400);
    const store = await reservationStore(event);
    const reservation = await store.get(`reservation/${String(id).trim()}`, { type: 'json' });
    if (!reservation) return json({ error: 'No booking found with that reference.' }, 404);
    if (!contactMatches(reservation, contact)) return json({ error: 'That contact does not match the booking.' }, 403);
    return json({ ok: true, reservation });
  }

  const cancelMatch = path.match(/^\/reservations\/([^/]+)\/cancel$/);
  if (cancelMatch && method === 'POST') {
    const { contact = '' } = readBody(event);
    const store = await reservationStore(event);
    const key = `reservation/${cancelMatch[1]}`;
    const reservation = await store.get(key, { type: 'json' });
    if (!reservation) return json({ error: 'No booking found with that reference.' }, 404);
    if (!contactMatches(reservation, contact)) return json({ error: 'That contact does not match the booking.' }, 403);
    if (!['pending', 'confirmed'].includes(reservation.status)) return json({ error: 'This booking can no longer be cancelled.' }, 409);
    reservation.status = 'cancelled';
    await store.setJSON(key, reservation);
    return json({ ok: true, reservation });
  }

  const modifyMatch = path.match(/^\/reservations\/([^/]+)\/modify$/);
  if (modifyMatch && method === 'PATCH') {
    const body = readBody(event);
    const store = await reservationStore(event);
    const key = `reservation/${modifyMatch[1]}`;
    const reservation = await store.get(key, { type: 'json' });
    if (!reservation) return json({ error: 'No booking found with that reference.' }, 404);
    if (!contactMatches(reservation, body.contact)) return json({ error: 'That contact does not match the booking.' }, 403);
    if (!['pending', 'confirmed'].includes(reservation.status)) return json({ error: 'This booking can no longer be modified.' }, 409);
    const { date = '', time = '', guests = '' } = body;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) return json({ error: 'Provide a new date and time.' }, 400);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(date)) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) return json({ error: 'Provide both a new date and time.' }, 400);
    const nextDate = String(date).trim() || reservation.date;
    const nextTime = String(time).trim() || reservation.time;
    if (new Date(`${nextDate} ${nextTime}:00Z`).getTime() <= Date.now() - 15 * 60 * 1000) return json({ error: 'Please pick a future date and time.' }, 400);
    if (guests !== '') {
      const partySize = Number(guests);
      if (!Number.isInteger(partySize) || partySize < 1 || partySize > 20) return json({ error: 'Guests must be between 1 and 20.' }, 400);
      reservation.guests = partySize;
    }
    reservation.date = nextDate;
    reservation.time = nextTime;
    await store.setJSON(key, reservation);
    try { await sendBookingConfirmation(reservation); } catch { /* best-effort */ }
    return json({ ok: true, reservation });
  }

  if (method === 'POST' && path === '/waitlist') {
    const { name = '', phone = '', email = '', party_size = '', preferred_date = '', preferred_time = '', notes = '' } = readBody(event);
    const invalid = [];
    if (!String(name).trim()) invalid.push('name');
    if (!String(phone).trim()) invalid.push('phone');
    const partySize = Number(party_size);
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 20) invalid.push('party_size');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(preferred_date))) invalid.push('preferred_date');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(preferred_time))) invalid.push('preferred_time');
    if (invalid.length) return json({ error: `Invalid fields: ${invalid.join(', ')}` }, 400);
    const store = await reservationStore(event);
    const entry = { id: await nextCounter(store, 'wait-counter'), name: String(name).trim(), phone: String(phone).trim(), email: String(email || '').trim(), party_size: partySize, preferred_date, preferred_time, notes: String(notes || '').trim(), status: 'waiting', created_at: new Date().toISOString() };
    await store.setJSON(`wait/${entry.id}`, entry);
    return json({ ok: true, entry }, 201);
  }

  if (method === 'GET' && path === '/waitlist') {
    const store = await reservationStore(event);
    const { blobs } = await store.list({ prefix: 'wait/' });
    const values = await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json' })));
    const date = url.searchParams.get('date');
    return json(values.filter(Boolean).sort((a, b) => `${a.preferred_date} ${a.preferred_time}`.localeCompare(`${b.preferred_date} ${b.preferred_time}`)).filter((item) => !date || item.preferred_date === date));
  }

  const waitMatch = path.match(/^\/waitlist\/(\d+)$/);
  if (waitMatch && (method === 'PATCH' || method === 'DELETE')) {
    const store = await reservationStore(event);
    const key = `wait/${Number(waitMatch[1])}`;
    const entry = await store.get(key, { type: 'json' });
    if (!entry) return json({ error: 'Waitlist entry not found' }, 404);
    if (method === 'DELETE') { await store.delete(key); return json({ ok: true }); }
    const { status } = readBody(event);
    if (!['waiting', 'notified', 'seated', 'cancelled'].includes(status)) return json({ error: 'Invalid status' }, 400);
    entry.status = status;
    await store.setJSON(key, entry);
    return json({ ok: true, entry });
  }

  if (method === 'POST' && path === '/reminders') {
    const store = await reservationStore(event);
    const items = await reservations(event);
    const now = Date.now();
    const sent = [];
    for (const reservation of items) {
      if (!['pending', 'confirmed'].includes(reservation.status)) continue;
      const hours = (new Date(`${reservation.date} ${reservation.time}:00Z`).getTime() - now) / 3600000;
      if (hours >= 20 && hours <= 26 && !reservation.reminder_24h) {
        try { await sendReminder(reservation, 24); } catch { /* best-effort */ }
        reservation.reminder_24h = 1;
        await store.setJSON(`reservation/${reservation.id}`, reservation);
        sent.push({ id: reservation.id, kind: '24h' });
      } else if (hours >= 1 && hours <= 3 && !reservation.reminder_2h) {
        try { await sendReminder(reservation, 2); } catch { /* best-effort */ }
        reservation.reminder_2h = 1;
        await store.setJSON(`reservation/${reservation.id}`, reservation);
        sent.push({ id: reservation.id, kind: '2h' });
      }
    }
    return json({ ok: true, count: sent.length, sent });
  }

  if (method === 'GET' && path === '/analytics') {
    const items = await reservations(event);
    const reviewsList = await reviews(event);
    const published = reviewsList.filter((item) => item.status === 'published');

    const now = new Date();
    const trend = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const date = d.toISOString().slice(0, 10);
      const day = items.filter((r) => r.date === date);
      trend.push({ date, bookings: day.length, covers: day.reduce((sum, r) => sum + Number(r.guests), 0) });
    }

    const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const byDay = dowNames.map((day, i) => ({ day, bookings: items.filter((r) => new Date(`${r.date}T12:00:00`).getDay() === i).length }));

    const hourMap = {};
    for (const r of items) hourMap[r.time] = (hourMap[r.time] || 0) + 1;
    const byHour = Object.entries(hourMap).sort((a, b) => a[0].localeCompare(b[0])).map(([time, count]) => ({ time, count }));

    const occasionMap = {};
    for (const r of items) if (r.occasion) occasionMap[r.occasion] = (occasionMap[r.occasion] || 0) + 1;
    const topOccasions = Object.entries(occasionMap).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count }));

    const closed = items.filter((r) => ['cancelled', 'no-show'].includes(r.status));
    const noShowRate = items.length ? Math.round((closed.length / items.length) * 100) : 0;

    const { blobs } = await (await reservationStore(event)).list({ prefix: 'points/' });
    const accounts = await Promise.all(blobs.map(({ key }) => storeGetJson(event, key)));
    const pointsEarned = accounts.filter(Boolean).reduce((sum, a) => sum + Number(a.lifetime || 0), 0);
    const pointsRedeemed = items.reduce((sum, r) => sum + Number(r.points_redeemed || 0), 0);
    const promoDiscount = items.reduce((sum, r) => sum + Number(r.promo_discount || 0), 0);
    const discountTotal = items.reduce((sum, r) => sum + Number(r.discount || 0), 0);
    const promoUses = items.filter((r) => Number(r.promo_id)).length;
    const promoMap = {};
    for (const r of items) {
      if (!Number(r.promo_id)) continue;
      const name = r.promo_name || 'Promotion';
      promoMap[name] = promoMap[name] || { name, uses: 0, discount: 0 };
      promoMap[name].uses += 1;
      promoMap[name].discount += Number(r.promo_discount || 0);
    }
    const topPromos = Object.values(promoMap).sort((a, b) => b.uses - a.uses).slice(0, 5);
    const reviewAvg = published.length ? published.reduce((sum, r) => sum + reviewOverall(r), 0) / published.length : 0;

    return json({
      totals: { bookings: items.length, covers: items.reduce((sum, r) => sum + Number(r.guests), 0), arrivals: items.filter((r) => r.status === 'arrived').length, confirmed: items.filter((r) => r.status === 'confirmed').length, closed },
      trend, byDay, byHour, topOccasions,
      noShowRate,
      points: { earned: pointsEarned, redeemed: pointsRedeemed, discount: Math.round((discountTotal - promoDiscount) * 100) / 100 },
      promos: { uses: promoUses, discount: Math.round(promoDiscount * 100) / 100, top: topPromos },
      reviews: { count: published.length, avg: Math.round(reviewAvg * 10) / 10 }
    });
  }

  const match = path.match(/^\/reservations\/([^/]+)$/);
  if (match && (method === 'PATCH' || method === 'DELETE')) {
    const store = await reservationStore(event);
    const key = `reservation/${match[1]}`;
    const reservation = await store.get(key, { type: 'json' });
    if (!reservation) return json({ error: 'Reservation not found' }, 404);
    if (method === 'DELETE') { await store.delete(key); return json({ ok: true }); }
    const { status, table } = readBody(event);
    if (status !== undefined && !VALID_STATUS.includes(status)) return json({ error: 'Invalid status' }, 400);
    if (table !== undefined && table !== '' && !VALID_TABLES.includes(table)) return json({ error: 'Invalid table' }, 400);
    if (status !== undefined) reservation.status = status;
    if (table !== undefined) reservation.table = table;
    await store.setJSON(key, reservation);
    const points = reservation.status === 'arrived' ? await awardPoints(event, store, reservation) : null;
    return json({ ok: true, reservation, points });
  }

  return json({ error: 'Not found' }, 404);
};
