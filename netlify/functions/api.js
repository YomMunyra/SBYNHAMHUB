'use strict';

const crypto = require('node:crypto');
const { categories, menu } = require('./menu-data');

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
    const { name = '', email = '', phone = '', date = '', time = '', guests = '', occasion = '', notes = '', redeem_points = '' } = body;
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

    const reservation = { id: crypto.randomUUID(), name: String(name).trim(), email: String(email).trim(), phone: String(phone).trim(), date, time, guests: partySize, occasion: occasion || '', notes: String(notes || '').trim(), table: '', status: 'pending', points_awarded: 0, points_redeemed, discount, created_at: new Date().toISOString() };
    const store = await reservationStore(event);
    await store.setJSON(`reservation/${reservation.id}`, reservation);
    if (points_redeemed) {
      await store.setJSON(`ledger/${guestId({ email, phone })}/${crypto.randomUUID()}`, { delta: -points_redeemed, reason: 'redeemed', ref_id: String(reservation.id), note: `Discount $${discount.toFixed(2)} on booking #${reservation.id}`, created_at: new Date().toISOString() });
    }
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
