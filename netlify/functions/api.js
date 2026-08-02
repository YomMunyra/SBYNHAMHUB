'use strict';

const crypto = require('node:crypto');
const { categories, menu } = require('./menu-data');

const VALID_STATUS = ['pending', 'confirmed', 'arrived', 'cancelled', 'no-show'];
const VALID_OCCASIONS = ['', 'Birthday', 'Anniversary', 'Date Night', 'Business', 'Family Gathering', 'Other'];
const VALID_TABLES = Array.from({ length: 12 }, (_, index) => `T${index + 1}`);
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

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
    return guest;
  }));
}

function sortReservations(items) {
  return items.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`) || String(b.created_at).localeCompare(String(a.created_at)));
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

  if (method === 'GET' && path === '/categories') return json(categories);
  if (method === 'GET' && path === '/menu') {
    let items = menu;
    if (url.searchParams.get('category')) items = items.filter((item) => item.category_slug === url.searchParams.get('category'));
    if (url.searchParams.get('featured') === '1') items = items.filter((item) => item.featured);
    return json(items);
  }

  if (path === '/settings') {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const store = await reservationStore(event);
    if (method === 'GET') return json((await store.get('settings/restaurant', { type: 'json' })) || {});
    if (method === 'PATCH') { const settings = readBody(event); await store.setJSON('settings/restaurant', settings); return json({ ok: true, settings }); }
  }

  if (method === 'POST' && path === '/auth') {
    const { password, role = 'manager' } = readBody(event);
    if (!['manager', 'admin'].includes(role) || !secret(role)) return json({ error: `${role === 'admin' ? 'Admin' : 'Manager'} login is not configured.` }, 503);
    return password === secret(role) ? json({ ok: true, role, token: createToken(role) }) : json({ error: 'Invalid password' }, 401);
  }

  if (path.startsWith('/reservations') || path === '/stats') {
    if (!authorized(event) && !(method === 'POST' && path === '/reservations')) return json({ error: 'Unauthorized' }, 401);
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
    const { name = '', email = '', phone = '', date = '', time = '', guests = '', occasion = '', notes = '' } = body;
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
    const reservation = { id: crypto.randomUUID(), name: String(name).trim(), email: String(email).trim(), phone: String(phone).trim(), date, time, guests: partySize, occasion: occasion || '', notes: String(notes || '').trim(), table: '', status: 'pending', created_at: new Date().toISOString() };
    const store = await reservationStore(event);
    await store.setJSON(`reservation/${reservation.id}`, reservation);
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
    return json({ ok: true, reservation });
  }

  return json({ error: 'Not found' }, 404);
};
