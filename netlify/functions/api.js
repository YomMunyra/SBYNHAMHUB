'use strict';

const crypto = require('node:crypto');
const { categories, menu } = require('./menu-data');
const { sendBookingConfirmation, sendReminder, sendPaymentReceipt } = require('../../server/lib/mailer');

const VALID_STATUS = ['pending', 'confirmed', 'arrived', 'cancelled', 'no-show'];
const VALID_OCCASIONS = ['', 'Birthday', 'Anniversary', 'Date Night', 'Business', 'Family Gathering', 'Other'];
const CITIES = ['Phnom Penh', 'Siem Reap', 'Bangkok'];
const TIME_SLOTS = [
  '11:00', '11:30', '12:00', '12:30', '13:00',
  '17:30', '18:00', '18:30', '19:00', '19:30',
  '20:00', '20:30', '21:00'
];
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const POINTS_PER_COVER = 100;
const POINTS_UNIT = 100;
const POINTS_RATE = 0.5;
const POINTS_EXPIRY_MONTHS = 18;
const POINTS_EXPIRY_SOON_MS = 30 * 24 * 60 * 60 * 1000;
const PAY_FEE_RATE = 0.0095;
const PAY_FEE_FLAT = 0.5;

function addMonths(iso, months) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) return new Date().toISOString();
  d.setMonth(d.getMonth() + Number(months));
  return d.toISOString();
}

function normalizeLedgerEntry(entry) {
  if (!entry) return entry;
  return {
    ...entry,
    remaining: Number(entry.remaining ?? (entry.reason === 'earned' ? Number(entry.delta) : 0)),
    expires_at: entry.expires_at || (entry.reason === 'earned' ? addMonths(entry.created_at, POINTS_EXPIRY_MONTHS) : '')
  };
}

async function blobPointsState(store, key) {
  const { blobs } = await store.list({ prefix: `ledger/${key}/` });
  const now = Date.now();
  const ledger = [];
  let balance = 0;
  let expiringSoon = 0;
  let earliest = null;
  for (const { key: blobKey } of blobs) {
    const raw = await store.get(blobKey, { type: 'json' });
    const entry = normalizeLedgerEntry(raw);
    if (!entry) continue;
    entry.__blob = blobKey;
    ledger.push(entry);
    if (entry.reason !== 'earned') continue;
    const expMs = new Date(entry.expires_at).getTime();
    if (expMs <= now) continue;
    balance += entry.remaining;
    if (expMs <= now + POINTS_EXPIRY_SOON_MS) expiringSoon += entry.remaining;
    if (!earliest || expMs < earliest) earliest = entry.expires_at;
  }
  return { ledger, balance, expiringSoon, earliest, now };
}

async function consumeBlobPoints(store, key, ledger, amount, refId, note) {
  let left = Number(amount);
  for (const entry of ledger) {
    if (entry.reason !== 'earned' || entry.remaining <= 0) continue;
    const expMs = new Date(entry.expires_at).getTime();
    if (expMs <= Date.now()) continue;
    const take = Math.min(entry.remaining, left);
    entry.remaining -= take;
    await store.setJSON(entry.__blob, entry);
    left -= take;
    if (left <= 0) break;
  }
  if (left > 0) throw new Error('Not enough points');
  await store.setJSON(`ledger/${key}/${crypto.randomUUID()}`, { delta: -Number(amount), reason: 'redeemed', ref_id: String(refId), note, created_at: new Date().toISOString() });
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function paymentRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'NYM-';
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function computeTip(amount, tipPct) {
  return Math.round(Math.round(Number(amount) * 100) * Number(tipPct) / 100) / 100;
}

function computeFee(amount, feeRate, feeFlat) {
  const cents = Math.round(Number(amount) * 100);
  const bps = Math.round(Number(feeRate) * 10000);
  const feeCents = Math.round(cents * bps / 10000) + Math.round(Number(feeFlat) * 100);
  return feeCents / 100;
}

function cardDigits(number) {
  return String(number || '').replace(/[\s-]/g, '');
}

function mockProcessCard(card) {
  const number = cardDigits(card && card.number);
  if (!/^\d{13,19}$/.test(number)) return { error: 'Card number must be 13–19 digits.' };
  const last4 = number.slice(-4);
  if (last4 === '1111') return { error: 'Card declined by issuer. Please try another card.' };
  const expiry = String(card && card.expiry || '').trim();
  const m = expiry.match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
  if (!m) return { error: 'Expiry must be in MM/YY format.' };
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  const now = new Date();
  if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) return { error: 'This card has expired.' };
  const cvc = String(card && card.cvc || '').trim();
  if (!/^\d{3,4}$/.test(cvc)) return { error: 'CVC must be 3–4 digits.' };
  return { ok: true, last4 };
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function json(body, statusCode = 200) {
  return {
    statusCode,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS
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

function createToken(role, restaurant_id) {
  const payload = Buffer.from(JSON.stringify({
    role,
    exp: Date.now() + TOKEN_TTL_MS,
    ...(restaurant_id !== undefined && restaurant_id !== null && restaurant_id !== '' ? { restaurant_id: Number(restaurant_id) } : {})
  })).toString('base64url');
  return `${payload}.${sign(payload, role)}`;
}

function authOf(event) {
  const token = (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  let decoded;
  try { decoded = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
  if (!['manager', 'admin'].includes(decoded.role) || !secret(decoded.role)) return null;
  const expected = sign(payload, decoded.role);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return decoded.exp > Date.now() ? decoded : null;
}

function roleOf(event) {
  const auth = authOf(event);
  return auth ? auth.role : null;
}

function authorized(event) {
  return roleOf(event) !== null;
}

let activeEvent = null;

function reservationStore() {
  // Vercel Blob store adapter (replaces Netlify Blobs). Storage is addressed by
  // key only; the store is derived from BLOB_READ_WRITE_TOKEN in the runtime.
  const { createVercelBlobStore } = require('../../server/lib/vercel-blob-store');
  return createVercelBlobStore();
}

async function storeReservations(store) {
  const { blobs } = await store.list({ prefix: 'reservation/' });
  const values = await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json' })));
  return values.filter(Boolean);
}

async function reservations(event) {
  return storeReservations(await reservationStore(event));
}

function belongsTo(item, rid) {
  return Number((item && item.restaurant_id) ?? 1) === Number(rid);
}

function guestId(item) {
  return crypto.createHash('sha256').update(`${String(item.email || '').trim().toLowerCase()}|${String(item.phone || '').trim()}`).digest('base64url').slice(0, 18);
}

async function guests(event, rid) {
  const items = (rid === undefined ? await reservations(event) : (await storeReservations(await reservationStore(event))).filter((r) => belongsTo(r, rid)));
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
    guest.dietary = profile?.dietary || '[]';
    guest.allergies = profile?.allergies || '[]';
    guest.favourite_table = profile?.favourite_table || '';
    guest.occasions = profile?.occasions || '[]';
    guest.vip = Number(profile?.vip) || 0;
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

async function payments(event) {
  const store = await reservationStore(event);
  const { blobs } = await store.list({ prefix: 'payment/' });
  const values = await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json' })));
  return values.filter(Boolean).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

async function storeReviews(store) {
  const { blobs } = await store.list({ prefix: 'review/' });
  const values = await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json' })));
  return values.filter(Boolean);
}

async function reviews(event) {
  return storeReviews(await reservationStore(event));
}

async function blobSaves(store) {
  const { blobs } = await store.list({ prefix: 'save/' });
  const values = await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json' })));
  return values.filter(Boolean);
}

async function blobCorrections(store) {
  const { blobs } = await store.list({ prefix: 'pref/' });
  const values = await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json' })));
  return values.filter(Boolean);
}

function netlifyAffinity(menu, saves, corrections) {
  const affinity = {};
  const bump = (item, amount) => {
    if (!item || !item.category_id) return;
    affinity[item.category_id] = (affinity[item.category_id] || 0) + amount;
  };
  const correctionsByItem = {};
  for (const c of corrections) correctionsByItem[Number(c.item_id)] = Number(c.signal);
  for (const s of saves) bump(menu.find((m) => Number(m.id) === Number(s.item_id)), 3);
  for (const [itemId, signal] of Object.entries(correctionsByItem)) bump(menu.find((m) => Number(m.id) === Number(itemId)), signal > 0 ? 2 : -2);
  return { affinity, correctionsByItem };
}

async function netlifyProfile(event, key, limit = 6) {
  const store = await reservationStore(event);
  const [allReservations, allReviews, allSaves, allCorrections, menu, cats] = await Promise.all([
    reservations(event),
    reviews(event),
    blobSaves(store),
    blobCorrections(store),
    loadMenu(store),
    loadCategories(store)
  ]);
  const guestReservations = allReservations.filter((r) => guestId(r) === key && ['confirmed', 'arrived', 'completed'].includes(r.status));
  const guestReviews = allReviews.filter((r) => guestId(r) === key);
  const bookings = guestReservations.length;
  const reviewsCount = guestReviews.length;
  const signals = bookings + reviewsCount;
  const state = { bookings, reviews: reviewsCount, signals, personalised: signals >= 5, progress: Math.min(100, Math.round((signals / 5) * 100)), to_go: Math.max(0, 5 - signals) };

  const saves = allSaves.filter((s) => s.guest_key === key);
  const corrections = allCorrections.filter((c) => c.guest_key === key);
  const { affinity, correctionsByItem } = netlifyAffinity(menu, saves, corrections);
  const savedSet = new Set(saves.map((s) => Number(s.item_id)));

  const scored = menu
    .filter((m) => m.available !== false)
    .map((m) => {
      let score = 0;
      if (savedSet.has(Number(m.id))) score += 2;
      if (m.featured) score += 1;
      score += (affinity[m.category_id] || 0) * 1.5;
      const correction = correctionsByItem[Number(m.id)];
      if (correction) score += correction * 3;
      return { item: m, score };
    })
    .sort((a, b) => b.score - a.score || String(a.item.name).localeCompare(String(b.item.name)));

  const topCategories = cats
    .map((c) => ({ id: c.id, name: c.name, slug: c.slug, score: affinity[c.id] || 0 }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  const savedItems = menu.filter((m) => savedSet.has(Number(m.id)));

  return { state, categories: topCategories, saved: savedItems, corrections: corrections.length, feed: scored.slice(0, limit).map(({ item }) => item) };
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

function detectSpam(text, opts = {}) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (/(https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|xyz|info|biz|site|online)\b)/i.test(t)) return 'Contains a link';
  const caps = (t.match(/[A-Z]/g) || []).length;
  if (t.length > 24 && caps / t.length > 0.6) return 'Mostly capital letters';
  if (/(.)\1{4,}/.test(t)) return 'Repeated characters';
  const lower = t.toLowerCase();
  for (const word of ['viagra', 'casino', 'bitcoin', 'crypto', 'forex', 'loan', 'buy followers', 'cheap followers', 'follow me', 'dm me', 'click here', 'free prize', 'cash prize', 'giveaway', 'lottery', 'discount code', 'weight loss', 'free gift', 'seo services']) {
    if (lower.includes(word)) return 'Suspicious wording';
  }
  if (opts.isDuplicate) return 'Same comment as an existing review';
  return null;
}

async function pointsAccount(store, key) {
  return (await store.get(`points/${key}`, { type: 'json' })) || { guest_key: key, name: '', email: '', phone: '', balance: 0, lifetime: 0 };
}

async function pointsLookup(event, store, email, phone) {
  const key = guestId({ email, phone });
  const account = await pointsAccount(store, key);
  const state = await blobPointsState(store, key);
  account.balance = state.balance;
  await store.setJSON(`points/${key}`, account);
  return {
    balance: state.balance,
    lifetime: account.lifetime,
    name: account.name,
    expiring_soon: state.expiringSoon,
    earliest_expiry: state.earliest,
    expiry_months: POINTS_EXPIRY_MONTHS,
    history: state.ledger
      .map(({ __blob, ...entry }) => entry)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 50)
  };
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
  await store.setJSON(`ledger/${key}/${crypto.randomUUID()}`, {
    delta: earned,
    reason: 'earned',
    ref_id: String(reservation.id),
    note: `Arrived booking #${reservation.id}`,
    created_at: new Date().toISOString(),
    expires_at: addMonths(new Date().toISOString(), POINTS_EXPIRY_MONTHS),
    remaining: earned
  });
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

async function loadMenu(store, rid) {
  const { blobs } = await store.list({ prefix: 'menu/' });
  if (!blobs.length) {
    for (const item of menu) {
      const category = categories.find((c) => c.slug === item.category_slug);
      await store.setJSON(`menu/${item.id}`, { ...item, category_id: category ? category.id : 1, available: true, restaurant_id: 1 });
    }
    return loadMenu(store, rid);
  }
  const values = (await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json' })))).filter(Boolean).sort((a, b) => a.id - b.id);
  return rid === undefined ? values : values.filter((m) => belongsTo(m, rid));
}

function contactMatches(reservation, contact) {
  const c = String(contact || '').trim().toLowerCase();
  return c === String(reservation.email || '').trim().toLowerCase() || c === String(reservation.phone || '').trim();
}

const RESTAURANT_SEEDS = [
  { slug: 'sbynhamhub', name: 'SbyNhamHub', city: 'Phnom Penh', address: '123 Riverside Walk, Phnom Penh', phone: '+855 12 345 678', hours: DEFAULT_HOURS, avg_cover: 15, capacity: 48, tagline: 'Taste · Book · Enjoy — Southeast Asian flavours, beautifully served.', avatar: 'logo.svg', featured: 0, status: 'approved', language: 'en', currency: 'USD', currency_rate: 4100 },
  { slug: 'wat-phnom-kitchen', name: 'Wat Phnom Kitchen', city: 'Phnom Penh', address: '88 Norodom Blvd, Phnom Penh', phone: '+855 23 987 654', hours: [{ day: 'Monday – Saturday', hours: '11:00 – 21:00' }, { day: 'Sunday', hours: '12:00 – 20:00' }], avg_cover: 12, capacity: 32, tagline: 'Family recipes from the old quarter — generous, honest Khmer cooking.', avatar: 'curry.svg', featured: 0, status: 'approved', language: 'en', currency: 'USD', currency_rate: 4100 },
  { slug: 'templeside-grill', name: 'Templeside Grill', city: 'Siem Reap', address: '7 Pub Street, Siem Reap', phone: '+855 63 765 432', hours: [{ day: 'Daily', hours: '16:00 – 23:00' }], avg_cover: 18, capacity: 40, tagline: 'Fire-grilled meats and cold craft beer, steps from the temples.', avatar: 'skewers.svg', featured: 0, status: 'approved', language: 'en', currency: 'USD', currency_rate: 4100 }
];

const PARTNER_TABLES = {
  2: [
    ['K1', 2, 'window', 'square', 8, 8, 0], ['K2', 2, 'window', 'square', 18, 8, 0],
    ['K3', 4, 'main', 'round', 30, 8, 0], ['K4', 4, 'main', 'round', 44, 8, 0],
    ['K5', 6, 'main', 'rectangle', 34, 38, 0], ['K6', 4, 'patio', 'round', 62, 18, 0]
  ],
  3: [
    ['G1', 2, 'patio', 'square', 6, 6, 0], ['G2', 4, 'patio', 'round', 20, 6, 0],
    ['G3', 4, 'main', 'round', 36, 6, 0], ['G4', 6, 'main', 'rectangle', 50, 6, 0],
    ['G5', 8, 'main', 'rectangle', 34, 36, 0], ['G6', 4, 'bar', 'round', 66, 12, 0]
  ]
};

const PARTNER_YIELD = {
  2: [
    { name: 'Lunchtime special', day_of_week: -1, start_time: '11:00', end_time: '14:00', min_covers: 0, discount_pct: 10, label: 'Lunchtime special' },
    { name: 'Sunday family feast', day_of_week: 0, start_time: '12:00', end_time: '20:00', min_covers: 4, discount_pct: 15, label: 'Sunday family feast' }
  ],
  3: [
    { name: 'Twilight grill hour', day_of_week: -1, start_time: '16:00', end_time: '18:00', min_covers: 0, discount_pct: 8, label: 'Twilight grill hour' }
  ]
};

const PARTNER_PROMOS = {
  2: { name: 'Khmer Classics Week', code: 'KHMER15', value: 15 },
  3: { name: 'Grill & Chill', code: 'EMBERS10', value: 10 }
};

let marketplaceSeeded = false;
async function seedMarketplace(store) {
  const { blobs } = await store.list({ prefix: 'restaurant/' });
  if (blobs.length) return;
  const saved = (await store.get('settings/restaurant', { type: 'json' })) || {};
  const now = new Date().toISOString();
  const base = {
    ...RESTAURANT_SEEDS[0],
    id: 1,
    name: saved.name || RESTAURANT_SEEDS[0].name,
    city: saved.city || RESTAURANT_SEEDS[0].city,
    address: saved.address || RESTAURANT_SEEDS[0].address,
    phone: saved.phone || RESTAURANT_SEEDS[0].phone,
    hours: saved.hours || RESTAURANT_SEEDS[0].hours,
    avg_cover: Number(saved.avg_cover) || RESTAURANT_SEEDS[0].avg_cover,
    capacity: Number(saved.capacity) || RESTAURANT_SEEDS[0].capacity
  };
  for (const r of [base, { ...RESTAURANT_SEEDS[1], id: 2 }, { ...RESTAURANT_SEEDS[2], id: 3 }]) {
    await store.setJSON(`restaurant/${r.id}`, { ...r, active: 1, created_at: now });
  }
  await loadMenu(store);
  await loadTables(store);
  await loadYieldRules(store);
  for (const [rid, rows] of Object.entries(PARTNER_TABLES)) {
    for (const [name, seats, zone, shape, x, y, rotation] of rows) {
      const id = await nextCounter(store, 'table-counter', 12);
      await store.setJSON(`table/${id}`, { id, name, seats, zone, shape, x, y, rotation, active: 1, restaurant_id: Number(rid), created_at: now });
    }
  }
  for (const [rid, rows] of Object.entries(PARTNER_YIELD)) {
    for (const rule of rows) {
      const id = await nextCounter(store, 'yield-counter', 4);
      await store.setJSON(`yield/rule/${id}`, { id, ...rule, active: 1, restaurant_id: Number(rid), created_at: now });
    }
  }
  for (const [rid, promo] of Object.entries(PARTNER_PROMOS)) {
    const id = await nextCounter(store, 'promo-counter');
    await store.setJSON(`promo/${id}`, { id, name: promo.name, code: promo.code, type: 'percent', value: promo.value, start_date: null, end_date: null, days: [], start_time: null, end_time: null, min_covers: 0, max_uses: 0, used: 0, featured: 1, active: 1, auto_end: 0, occasions: [], restaurant_id: Number(rid), created_at: now });
  }
  const cats = await loadCategories(store);
  const catId = (slug) => { const c = cats.find((x) => x.slug === slug); return c ? c.id : 1; };
  const partnerMenu = {
    2: [
      { category: 'starters', name: 'Num Pang Croutons', description: 'Toasted baguette with pâté, pickles and chilli mayo.', price: 4.5, image: 'noodle-salad.jpg', tag: 'Classic', featured: true },
      { category: 'mains', name: 'Amok de Mère', description: 'The house fish amok, steamed with fresh coconut cream.', price: 9.5, image: 'amok.jpg', tag: 'Signature', featured: true },
      { category: 'mains', name: 'Prahok Ktis', description: 'Pork belly in fragrant prahok-coconut dip with greens.', price: 10.0, image: 'lok-lak.jpg', tag: null, featured: false },
      { category: 'mains', name: 'Kampot Pepper Crab', description: 'Whole crab tossed in green Kampot pepper and butter.', price: 16.0, image: 'seafood-hotpot.jpg', tag: 'For Two', featured: true },
      { category: 'grills-seafood', name: 'Honey-Glazed Chicken Wings', description: 'Charred wings with honey, lemongrass and crushed peanuts.', price: 7.5, image: 'lemongrass-chicken.jpg', tag: null, featured: false },
      { category: 'desserts', name: 'Pandan Crepe Roulade', description: 'Rolled pandan crepe with young-coconut filling.', price: 4.5, image: 'pandan-cake.jpg', tag: 'Classic', featured: true },
      { category: 'drinks', name: 'Sugar-Cane Juice', description: 'Pressed sugar cane with a squeeze of lime.', price: 2.5, image: 'coconut.jpg', tag: null, featured: false },
      { category: 'drinks', name: 'Cambodian Iced Coffee', description: 'Strong espresso over sweetened condensed milk.', price: 3.0, image: 'thai-tea.jpg', tag: null, featured: false }
    ],
    3: [
      { category: 'starters', name: 'Charcoal Corn Ribs', description: 'Smoky grilled corn with lime-chilli butter.', price: 5.0, image: 'summer-rolls.jpg', tag: 'New', featured: false },
      { category: 'grills-seafood', name: 'Tomahawk for Two', description: 'Wagyu tomahawk, charred over open flame, jungle-spice rub.', price: 42.0, image: 'bbq-ribs.jpg', tag: 'Signature', featured: true },
      { category: 'grills-seafood', name: 'Beef Satay Sticks', description: 'Overnight-marinated beef skewers with peanut relish.', price: 9.0, image: 'satay.jpg', tag: null, featured: false },
      { category: 'grills-seafood', name: 'Smoked Ribs', description: '12-hour smoked pork ribs with tamarind barbecue glaze.', price: 14.5, image: 'bbq-ribs.jpg', tag: null, featured: true },
      { category: 'mains', name: 'Chargrilled Sea Bass', description: 'Whole sea bass with garlic butter and grilled lemon.', price: 18.0, image: 'sea-bass.jpg', tag: 'Chef\u2019s Pick', featured: true },
      { category: 'mains', name: 'Lok Lak Burger', description: 'Kampot-pepper beef patty, fried egg, cucumber relish.', price: 11.5, image: 'smash-burger.jpg', tag: null, featured: false },
      { category: 'desserts', name: 'Grilled Pineapple', description: 'Caramelised pineapple with palm-sugar syrup.', price: 4.0, image: 'mango-sticky-rice.jpg', tag: 'Veg', featured: false },
      { category: 'drinks', name: 'Angkor Draught', description: 'Local pale lager on tap, ice-cold. 330ml.', price: 3.5, image: 'craft-beer.jpg', tag: null, featured: false }
    ]
  };
  for (const [rid, items] of Object.entries(partnerMenu)) {
    for (const it of items) {
      const id = await nextCounter(store, 'menu-counter', 25);
      await store.setJSON(`menu/${id}`, { id, name: it.name, description: it.description, price: it.price, image: it.image, tag: it.tag || null, featured: it.featured, available: true, restaurant_id: Number(rid), category_id: catId(it.category) });
    }
  }
  marketplaceSeeded = true;
}

async function loadRestaurants(store) {
  await seedMarketplace(store);
  const { blobs } = await store.list({ prefix: 'restaurant/' });
  const values = (await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json' })))).filter(Boolean);
  return values.sort((a, b) => a.id - b.id);
}

async function getRestaurantValue(store, value) {
  if (value === undefined || value === null || value === '') return null;
  const all = await loadRestaurants(store);
  if (/^\d+$/.test(String(value))) return all.find((r) => Number(r.id) === Number(value)) || null;
  return all.find((r) => r.slug === String(value)) || null;
}

async function restaurantIdOf(store, url, fallback = 1) {
  const raw = url && (url.searchParams.get('restaurant') ?? url.searchParams.get('restaurant_id'));
  if (raw !== undefined && raw !== null && raw !== '') {
    const row = await getRestaurantValue(store, raw);
    if (row) return Number(row.id);
  }
  const auth = activeEvent ? authOf(activeEvent) : null;
  if (auth && auth.restaurant_id) return Number(auth.restaurant_id);
  return Number(fallback) || 1;
}

function settingsKey(rid) {
  return Number(rid) === 1 ? 'settings/restaurant' : `settings/restaurant/${Number(rid)}`;
}

function netlifyPriceBand(avg) {
  if (avg >= 20) return '$$$$';
  if (avg >= 15) return '$$$';
  if (avg >= 10) return '$$';
  return '$';
}

async function netlifyPublicRestaurant(store, row) {
  let hours = [];
  try { hours = Array.isArray(row.hours) ? row.hours : JSON.parse(row.hours); } catch { hours = []; }
  const published = (await storeReviews(store)).filter((r) => r.status === 'published' && belongsTo(r, row.id));
  const count = published.length;
  const avg = count ? published.reduce((sum, r) => sum + reviewOverall(r), 0) / count : 0;
  const menuCount = (await loadMenu(store)).filter((m) => belongsTo(m, row.id)).length;
  return {
    id: Number(row.id),
    slug: row.slug,
    name: row.name,
    city: row.city,
    address: row.address,
    phone: row.phone,
    hours,
    avg_cover: Number(row.avg_cover),
    capacity: Number(row.capacity),
    tagline: row.tagline,
    avatar: row.avatar,
    rating: count ? Math.round(avg * 10) / 10 : null,
    reviews_count: count,
    menu_count: menuCount,
    featured: Number(row.featured || 0),
    promoted: Number(row.featured || 0) === 1,
    status: row.status || 'approved',
    language: row.language || 'en',
    currency: row.currency || 'USD',
    currency_rate: Number(row.currency_rate || 4100)
  };
}

async function restaurantSettings(store, rid) {
  const row = await getRestaurantValue(store, rid);
  const saved = (await store.get(settingsKey(rid), { type: 'json' })) || {};
  let hours = row ? (Array.isArray(row.hours) ? row.hours : (() => { try { return JSON.parse(row.hours); } catch { return []; } })()) : [];
  const fees = (await store.get('settings/integrations', { type: 'json' })) || {};
  return {
    name: (row && row.name) || saved.name || 'SbyNhamHub',
    phone: (row && row.phone) || saved.phone || '+855 12 345 678',
    address: (row && row.address) || saved.address || '123 Riverside Walk, Phnom Penh',
    city: (row && row.city) || saved.city || 'Phnom Penh',
    hours,
    avg_cover: Number((row && row.avg_cover) || saved.avg_cover || 15),
    capacity: Number((row && row.capacity) || saved.capacity || 48),
    fee_rate: Number(saved.fee_rate ?? 0.0095),
    fee_flat: Number(saved.fee_flat ?? 0.5),
    language: (row && row.language) || 'en',
    currency: (row && row.currency) || 'USD',
    currency_rate: Number((row && row.currency_rate) || 4100)
  };
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

function promoParseOccasions(promo) {
  const o = promo.occasions;
  if (Array.isArray(o)) return o.map(String).filter(Boolean);
  try {
    const arr = JSON.parse(o);
    return Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
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
    max_uses: row.max_uses,
    auto_end: Number(row.auto_end || 0),
    occasions: promoParseOccasions(row)
  };
}

function promoApplicable(row, { date = '', time = '', guests = 1, occasion = '' } = {}) {
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
  const occasions = promoParseOccasions(row);
  if (occasions.length && occasion) {
    if (!occasions.includes(String(occasion))) return false;
  }
  return true;
}

function promoDiscount(row, guests, avgCover) {
  if (row.type === 'flat') return Number(row.value);
  return Math.round(Number(guests) * Number(avgCover) * (Number(row.value) / 100) * 100) / 100;
}

async function loadPromos(store, rid) {
  const { blobs } = await store.list({ prefix: 'promo/' });
  if (!blobs.length) return [];
  const values = (await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json' })))).filter(Boolean).sort((a, b) => b.id - a.id);
  return rid === undefined ? values : values.filter((p) => belongsTo(p, rid));
}

async function findPromoByCode(store, code, rid) {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return null;
  const promos = await loadPromos(store, rid);
  return promos.find((p) => p.code === clean) || null;
}

async function slotIsFullAt(store, date, time, rid) {
  if (!date || !time) return false;
  const items = await storeReservations(store);
  const seats = items
    .filter((r) => belongsTo(r, rid) && r.date === String(date) && r.time === String(time) && ['pending', 'confirmed', 'arrived'].includes(r.status))
    .reduce((sum, r) => sum + Number(r.guests || 0), 0);
  const settings = await restaurantSettings(store, rid);
  const capacity = Number(settings.capacity) || 48;
  return seats >= capacity;
}

const YIELD_DEFAULT_RULES = [
  { name: 'Early-bird lunch', day_of_week: -1, start_time: '11:00', end_time: '13:00', min_covers: 0, discount_pct: 15, label: 'Early-bird lunch' },
  { name: 'Weekday slow starter', day_of_week: -1, start_time: '17:30', end_time: '18:30', min_covers: 0, discount_pct: 10, label: 'Weekday happy hour' },
  { name: 'Late-night wind-down', day_of_week: -1, start_time: '20:30', end_time: '21:30', min_covers: 0, discount_pct: 12, label: 'Late-night wind-down' },
  { name: 'Sunday supper club', day_of_week: 0, start_time: '17:30', end_time: '21:00', min_covers: 4, discount_pct: 20, label: 'Sunday supper club' }
];

function yieldPublic(rule) {
  return {
    id: Number(rule.id),
    name: rule.name,
    day_of_week: Number(rule.day_of_week),
    start_time: rule.start_time || '',
    end_time: rule.end_time || '',
    min_covers: Number(rule.min_covers),
    discount_pct: Number(rule.discount_pct),
    label: rule.label || '',
    active: Number(rule.active),
    created_at: rule.created_at || ''
  };
}

let yieldSeeded = false;
async function loadYieldRules(store, rid) {
  const { blobs } = await store.list({ prefix: 'yield/rule/' });
  if (!blobs.length && !yieldSeeded) {
    yieldSeeded = true;
    const now = new Date().toISOString();
    const rules = YIELD_DEFAULT_RULES.map((r, i) => ({ id: i + 1, active: 1, restaurant_id: 1, created_at: now, ...r }));
    await Promise.all(rules.map((r) => store.setJSON(`yield/rule/${r.id}`, r)));
    return loadYieldRules(store, rid);
  }
  const values = (await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json' })))).filter(Boolean);
  const sorted = values.sort((a, b) => a.id - b.id);
  return rid === undefined ? sorted : sorted.filter((r) => belongsTo(r, rid));
}

function yieldParseTime(t) {
  const m = String(t || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

async function yieldOfferFor(store, { date = '', time = '', guests = 1, rid = 1 } = {}) {
  if (!date || !time) return null;
  const t = yieldParseTime(time);
  if (t === null) return null;
  const rules = await loadYieldRules(store, rid);
  const active = rules.filter((r) => Number(r.active) === 1);
  if (!active.length) return null;
  const dow = new Date(String(date) + 'T12:00:00').getDay();
  const settings = await restaurantSettings(store, rid);
  const capacity = Number(settings.capacity) || 48;
  const avgCover = Number(settings.avg_cover) || 15;
  const items = await storeReservations(store);
  const seats = items
    .filter((r) => belongsTo(r, rid) && r.date === String(date) && r.time === String(time) && ['pending', 'confirmed', 'arrived'].includes(r.status))
    .reduce((sum, r) => sum + Number(r.guests || 0), 0);
  for (const rule of active) {
    if (Number(rule.day_of_week) >= 0 && Number(rule.day_of_week) !== dow) continue;
    if (rule.start_time) {
      const s = yieldParseTime(rule.start_time);
      if (s !== null && t < s) continue;
    }
    if (rule.end_time) {
      const e = yieldParseTime(rule.end_time);
      if (e !== null && t > e) continue;
    }
    if (Number(rule.min_covers) > 0 && Number(guests) < Number(rule.min_covers)) continue;
    if (seats >= capacity) continue;
    const pct = Number(rule.discount_pct);
    const discount = Math.round(Number(guests) * avgCover * (pct / 100) * 100) / 100;
    return {
      rule: yieldPublic(rule),
      discount_pct: pct,
      discount,
      label: rule.label || `${pct}% off`
    };
  }
  return null;
}

const TABLES_DEFAULT = [
  { id: 1, name: 'T1', seats: 2, zone: 'window', shape: 'square', x: 5, y: 8, rotation: 0 },
  { id: 2, name: 'T2', seats: 2, zone: 'window', shape: 'square', x: 16, y: 8, rotation: 0 },
  { id: 3, name: 'T3', seats: 4, zone: 'window', shape: 'round', x: 8, y: 34, rotation: 0 },
  { id: 4, name: 'T4', seats: 4, zone: 'window', shape: 'round', x: 20, y: 34, rotation: 0 },
  { id: 5, name: 'T5', seats: 6, zone: 'main', shape: 'rectangle', x: 38, y: 6, rotation: 0 },
  { id: 6, name: 'T6', seats: 4, zone: 'main', shape: 'round', x: 52, y: 6, rotation: 0 },
  { id: 7, name: 'T7', seats: 4, zone: 'main', shape: 'round', x: 38, y: 30, rotation: 0 },
  { id: 8, name: 'T8', seats: 4, zone: 'main', shape: 'round', x: 52, y: 30, rotation: 0 },
  { id: 9, name: 'T9', seats: 8, zone: 'main', shape: 'rectangle', x: 40, y: 55, rotation: 0 },
  { id: 10, name: 'T10', seats: 4, zone: 'patio', shape: 'round', x: 72, y: 10, rotation: 0 },
  { id: 11, name: 'T11', seats: 2, zone: 'patio', shape: 'square', x: 82, y: 10, rotation: 0 },
  { id: 12, name: 'T12', seats: 6, zone: 'patio', shape: 'round', x: 74, y: 40, rotation: 0 }
];

function tablePublic(t) {
  return {
    id: Number(t.id),
    name: t.name,
    seats: Number(t.seats),
    zone: t.zone || 'main',
    shape: t.shape || 'round',
    x: Number(t.x) || 0,
    y: Number(t.y) || 0,
    rotation: Number(t.rotation) || 0,
    active: t.active === undefined ? 1 : Number(t.active),
    created_at: t.created_at || ''
  };
}

let tablesSeeded = false;
async function loadTables(store, rid) {
  const { blobs } = await store.list({ prefix: 'table/' });
  if (!blobs.length && !tablesSeeded) {
    tablesSeeded = true;
    const now = new Date().toISOString();
    const rows = TABLES_DEFAULT.map((t) => ({ ...t, active: 1, restaurant_id: 1, created_at: now }));
    await Promise.all(rows.map((t) => store.setJSON(`table/${t.id}`, t)));
    return loadTables(store, rid);
  }
  const values = (await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json' })))).filter(Boolean);
  const sorted = values.sort((a, b) => a.id - b.id);
  return (rid === undefined ? sorted : sorted.filter((t) => belongsTo(t, rid))).map(tablePublic);
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

let netlifyWebpush = null;
function loadWebpush() {
  if (netlifyWebpush) return netlifyWebpush;
  try {
    netlifyWebpush = require('web-push');
  } catch {
    return null;
  }
  return netlifyWebpush;
}

async function getVapid(store) {
  const wp = loadWebpush();
  if (!wp) return null;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT || 'mailto:ops@sbynhamhub.com';
  if (pub && priv) return { publicKey: pub, privateKey: priv, subject: subj };
  const saved = (await store.get('settings/vapid', { type: 'json' })) || {};
  if (saved.publicKey && saved.privateKey) return { ...saved, subject: saved.subject || subj };
  const fresh = wp.generateVAPIDKeys();
  const keys = { publicKey: fresh.publicKey, privateKey: fresh.privateKey, subject: subj };
  await store.setJSON('settings/vapid', keys);
  return keys;
}

async function loadSubscriptions(store) {
  const { blobs } = await store.list({ prefix: 'push/' });
  const values = (await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json' })))).filter(Boolean);
  return values.sort((a, b) => a.id - b.id);
}

async function integrationsConfig(store) {
  const saved = (await store.get('settings/integrations', { type: 'json' })) || {};
  return { webhook_url: '', sms_enabled: true, push_enabled: true, ...saved };
}

async function netlifySendSms(store, phone, message) {
  const config = await integrationsConfig(store);
  const url = config.webhook_url;
  if (!url) return { sent: false, dev: true, reason: 'sms-not-configured' };
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, message }) });
    return { sent: res.ok, dev: false, status: res.status };
  } catch (error) {
    return { sent: false, dev: false, reason: error.message };
  }
}

async function netlifyPushMatches(store, reservation, payload) {
  const wp = loadWebpush();
  const vapid = await getVapid(store);
  if (!wp || !vapid) return [];
  const targets = (await loadSubscriptions(store)).filter((s) => (reservation.email && String(s.email).trim().toLowerCase() === String(reservation.email).trim().toLowerCase()) || (reservation.phone && String(s.phone).trim() === String(reservation.phone).trim()));
  const results = [];
  for (const target of targets) {
    try {
      await wp.sendNotification({ endpoint: target.endpoint, keys: target.keys || {} }, JSON.stringify(payload), { vapidDetails: vapid });
      results.push({ id: target.id, sent: true });
    } catch (error) {
      if ([404, 410].includes(Number(error?.statusCode))) await store.delete(`push/${target.id}`);
      results.push({ id: target.id, sent: false });
    }
  }
  return results;
}

exports.handler = async (event) => {
  activeEvent = event;
  const path = requestPath(event);
  const method = event.httpMethod;
  const url = requestUrl(event);

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (method === 'GET' && path === '/categories') {
    const store = await reservationStore(event);
    return json(await loadCategories(store));
  }
  if (method === 'GET' && path === '/menu') {
    const store = await reservationStore(event);
    const rid = await restaurantIdOf(store, url);
    let items = await loadMenu(store, rid);
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
    const rid = await restaurantIdOf(store, url);
    const cats = await loadCategories(store);
    const cat = cats.find((c) => c.id === Number(category_id));
    if (!cat) return json({ error: 'Invalid category' }, 400);
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) return json({ error: 'Invalid price' }, 400);
    const id = await nextCounter(store, 'menu-counter', 25);
    const item = { id, name: String(name).trim(), description: String(description || '').trim(), price: priceNum, image: String(image || 'plate.svg').trim(), tag: String(tag || '').trim() || null, featured: Boolean(featured), available: !(available === 0 || available === false || available === '0' || available === 'false'), category_id: cat.id, category: cat.name, category_slug: cat.slug, restaurant_id: rid };
    await store.setJSON(`menu/${id}`, item);
    return json({ ok: true, item }, 201);
  }

  const menuMatch = path.match(/^\/menu\/(\d+)$/);
  if (menuMatch && method === 'PATCH') {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const store = await reservationStore(event);
    const rid = await restaurantIdOf(store, url);
    const key = `menu/${Number(menuMatch[1])}`;
    const item = await store.get(key, { type: 'json' });
    if (!item || !belongsTo(item, rid)) return json({ error: 'Dish not found' }, 404);
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
    const rid = await restaurantIdOf(store, url);
    const key = `menu/${Number(menuMatch[1])}`;
    const item = await store.get(key, { type: 'json' });
    if (!item || !belongsTo(item, rid)) return json({ error: 'Dish not found' }, 404);
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
    const rid = await restaurantIdOf(store, url);
    const promos = await loadPromos(store, rid);
    const date = url.searchParams.get('date') || '';
    const time = url.searchParams.get('time') || '';
    const guests = Number(url.searchParams.get('guests')) || 1;
    const shown = [];
    for (const p of promos) {
      if (!promoApplicable(p, { date, time, guests })) continue;
      if (Number(p.auto_end) && await slotIsFullAt(store, date, time, rid)) continue;
      shown.push(promoPublic(p));
    }
    return json(shown);
  }

  if (method === 'GET' && path === '/yield/offer') {
    const store = await reservationStore(event);
    const rid = await restaurantIdOf(store, url);
    const offer = await yieldOfferFor(store, {
      date: url.searchParams.get('date') || '',
      time: url.searchParams.get('time') || '',
      guests: Number(url.searchParams.get('guests')) || 1,
      rid
    });
    return json(offer ? { applied: true, ...offer } : { applied: false });
  }

  if (method === 'GET' && path === '/yield/rules') {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const store = await reservationStore(event);
    const rid = await restaurantIdOf(store, url);
    return json(await loadYieldRules(store, rid));
  }

  if (method === 'POST' && path === '/yield/rules') {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const body = readBody(event);
    const { name = '', day_of_week = -1, start_time = '', end_time = '', min_covers = 0, discount_pct = '', label = '', active = 1 } = body;
    if (!String(name).trim()) return json({ error: 'Rule name is required' }, 400);
    const dow = Number(day_of_week);
    if (!Number.isInteger(dow) || dow < -1 || dow > 6) return json({ error: 'Day of week must be between -1 (any day) and 6' }, 400);
    if (start_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(start_time))) return json({ error: 'Invalid start time' }, 400);
    if (end_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(end_time))) return json({ error: 'Invalid end time' }, 400);
    if (start_time && end_time && String(start_time) > String(end_time)) return json({ error: 'Start time must be before end time' }, 400);
    const covers = Number(min_covers);
    if (!Number.isInteger(covers) || covers < 0) return json({ error: 'Minimum covers must be 0 or more' }, 400);
    const pct = Number(discount_pct);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 50) return json({ error: 'Discount must be between 1% and 50%' }, 400);
    const store = await reservationStore(event);
    const rid = await restaurantIdOf(store, url);
    const rule = { id: await nextCounter(store, 'yield-counter'), name: String(name).trim(), day_of_week: dow, start_time: start_time || null, end_time: end_time || null, min_covers: covers, discount_pct: pct, label: String(label || '').trim(), active: active ? 1 : 0, restaurant_id: rid, created_at: new Date().toISOString() };
    await store.setJSON(`yield/rule/${rule.id}`, rule);
    return json({ ok: true, rule }, 201);
  }

  const yieldMatch = path.match(/^\/yield\/rules\/(\d+)$/);
  if (yieldMatch && (method === 'PATCH' || method === 'DELETE')) {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const store = await reservationStore(event);
    const rid = await restaurantIdOf(store, url);
    const key = `yield/rule/${Number(yieldMatch[1])}`;
    const rule = await store.get(key, { type: 'json' });
    if (!rule || !belongsTo(rule, rid)) return json({ error: 'Yield rule not found' }, 404);
    if (method === 'DELETE') { await store.delete(key); return json({ ok: true }); }
    const body = readBody(event);
    if (body.name !== undefined) {
      if (!String(body.name).trim()) return json({ error: 'Rule name is required' }, 400);
      rule.name = String(body.name).trim();
    }
    if (body.day_of_week !== undefined) {
      const dow = Number(body.day_of_week);
      if (!Number.isInteger(dow) || dow < -1 || dow > 6) return json({ error: 'Day of week must be between -1 (any day) and 6' }, 400);
      rule.day_of_week = dow;
    }
    if (body.start_time !== undefined) {
      if (body.start_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.start_time))) return json({ error: 'Invalid start time' }, 400);
      rule.start_time = body.start_time || null;
    }
    if (body.end_time !== undefined) {
      if (body.end_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.end_time))) return json({ error: 'Invalid end time' }, 400);
      rule.end_time = body.end_time || null;
    }
    if (body.min_covers !== undefined) {
      const covers = Number(body.min_covers);
      if (!Number.isInteger(covers) || covers < 0) return json({ error: 'Minimum covers must be 0 or more' }, 400);
      rule.min_covers = covers;
    }
    if (body.discount_pct !== undefined) {
      const pct = Number(body.discount_pct);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 50) return json({ error: 'Discount must be between 1% and 50%' }, 400);
      rule.discount_pct = pct;
    }
    if (body.label !== undefined) rule.label = String(body.label || '').trim();
    if (body.active !== undefined) rule.active = body.active ? 1 : 0;
    await store.setJSON(key, rule);
    return json({ ok: true, rule });
  }

  if (method === 'GET' && path === '/tables') {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const store = await reservationStore(event);
    const rid = await restaurantIdOf(store, url);
    return json(await loadTables(store, rid));
  }

  if (method === 'POST' && path === '/tables') {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const body = readBody(event);
    const { name = '', seats = 4, zone = 'main', shape = 'round', x = 0, y = 0, rotation = 0, active = 1 } = body;
    const clean = String(name).trim();
    if (!clean) return json({ error: 'Table name is required' }, 400);
    if (!/^[A-Za-z0-9 .-]{1,20}$/.test(clean)) return json({ error: 'Invalid table name' }, 400);
    const n = Number(seats);
    if (!Number.isInteger(n) || n < 1 || n > 20) return json({ error: 'Seats must be between 1 and 20' }, 400);
    const store = await reservationStore(event);
    const rid = await restaurantIdOf(store, url);
    const existing = await loadTables(store, rid);
    if (existing.some((t) => t.name === clean)) return json({ error: 'A table with that name already exists' }, 400);
    const table = { id: await nextCounter(store, 'table-counter'), name: clean, seats: n, zone: String(zone || 'main'), shape: String(shape || 'round'), x: Number(x) || 0, y: Number(y) || 0, rotation: Number(rotation) || 0, active: active ? 1 : 0, restaurant_id: rid, created_at: new Date().toISOString() };
    await store.setJSON(`table/${table.id}`, table);
    return json({ ok: true, table }, 201);
  }

  const tableMatch = path.match(/^\/tables\/(\d+)$/);
  if (tableMatch && (method === 'PATCH' || method === 'DELETE')) {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const store = await reservationStore(event);
    const rid = await restaurantIdOf(store, url);
    const key = `table/${Number(tableMatch[1])}`;
    const table = await store.get(key, { type: 'json' });
    if (!table || !belongsTo(table, rid)) return json({ error: 'Table not found' }, 404);
    if (method === 'DELETE') { await store.delete(key); return json({ ok: true }); }
    const body = readBody(event);
    if (body.name !== undefined) {
      const clean = String(body.name).trim();
      if (!clean) return json({ error: 'Table name is required' }, 400);
      if (!/^[A-Za-z0-9 .-]{1,20}$/.test(clean)) return json({ error: 'Invalid table name' }, 400);
      const existing = await loadTables(store, rid);
      if (existing.some((t) => t.name === clean && t.id !== table.id)) return json({ error: 'A table with that name already exists' }, 400);
      table.name = clean;
    }
    if (body.seats !== undefined) {
      const n = Number(body.seats);
      if (!Number.isInteger(n) || n < 1 || n > 20) return json({ error: 'Seats must be between 1 and 20' }, 400);
      table.seats = n;
    }
    if (body.zone !== undefined) table.zone = String(body.zone || 'main');
    if (body.shape !== undefined) table.shape = String(body.shape || 'round');
    if (body.x !== undefined) table.x = Number(body.x) || 0;
    if (body.y !== undefined) table.y = Number(body.y) || 0;
    if (body.rotation !== undefined) table.rotation = Number(body.rotation) || 0;
    if (body.active !== undefined) table.active = body.active ? 1 : 0;
    await store.setJSON(key, table);
    return json({ ok: true, table });
  }

  if (method === 'GET' && path === '/push/vapid') {
    const store = await reservationStore(event);
    const vapid = await getVapid(store);
    return json({ supported: !!loadWebpush(), publicKey: vapid?.publicKey || '' });
  }

  if (method === 'POST' && path === '/push/subscribe') {
    const store = await reservationStore(event);
    const { endpoint = '', keys = {}, email = '', phone = '' } = readBody(event);
    if (!endpoint || !/^https:\/\//.test(String(endpoint))) return json({ error: 'A valid push subscription endpoint is required' }, 400);
    const subs = await loadSubscriptions(store);
    const existing = subs.find((s) => s.endpoint === endpoint);
    if (existing) {
      existing.keys = keys || {};
      existing.email = String(email || '').trim();
      existing.phone = String(phone || '').trim();
      await store.setJSON(`push/${existing.id}`, existing);
      return json({ ok: true, id: existing.id }, 201);
    }
    const id = await nextCounter(store, 'push-counter');
    const subscription = { id, endpoint, keys: keys || {}, email: String(email || '').trim(), phone: String(phone || '').trim(), created_at: new Date().toISOString() };
    await store.setJSON(`push/${id}`, subscription);
    return json({ ok: true, id }, 201);
  }

  if (path === '/integrations') {
    const store = await reservationStore(event);
    if (method === 'GET') {
      if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
      const config = await integrationsConfig(store);
      const subs = await loadSubscriptions(store);
      const vapid = await getVapid(store);
      return json({ webhook_url: config.webhook_url || '', sms_enabled: !!config.sms_enabled, push_enabled: !!config.push_enabled, push_supported: !!loadWebpush(), vapid_public_key: vapid?.publicKey || '', subscriptions: subs.map((s) => ({ id: s.id, endpoint: String(s.endpoint).slice(0, 60) + '…', email: s.email, phone: s.phone, created_at: s.created_at })), subscription_count: subs.length });
    }
    if (method === 'PATCH') {
      if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
      const config = await integrationsConfig(store);
      const body = readBody(event);
      if (body.webhook_url !== undefined) {
        const clean = String(body.webhook_url || '').trim();
        if (clean && !/^https?:\/\//.test(clean)) return json({ error: 'Webhook URL must start with http(s)://' }, 400);
        config.webhook_url = clean;
      }
      if (body.sms_enabled !== undefined) config.sms_enabled = !!body.sms_enabled;
      if (body.push_enabled !== undefined) config.push_enabled = !!body.push_enabled;
      await store.setJSON('settings/integrations', config);
      return json({ ok: true, config: { webhook_url: config.webhook_url || '', sms_enabled: !!config.sms_enabled, push_enabled: !!config.push_enabled } });
    }
  }

  if (method === 'POST' && path === '/push/test') {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const store = await reservationStore(event);
    const config = await integrationsConfig(store);
    if (!config.push_enabled) return json({ error: 'Push notifications are disabled' }, 400);
    const wp = loadWebpush();
    if (!wp) return json({ error: 'web-push is not installed on the server' }, 400);
    const vapid = await getVapid(store);
    const subs = await loadSubscriptions(store);
    if (!subs.length) return json({ error: 'No devices are subscribed yet' }, 400);
    const payload = JSON.stringify({ title: 'SbyNhamHub test', body: 'Push notifications are working!', tag: 'test-push' });
    const results = [];
    for (const sub of subs) {
      try {
        await wp.sendNotification({ endpoint: sub.endpoint, keys: sub.keys || {} }, payload, { vapidDetails: vapid });
        results.push({ id: sub.id, sent: true });
      } catch (error) {
        const gone = [404, 410].includes(Number(error?.statusCode));
        if (gone) await store.delete(`push/${sub.id}`);
        results.push({ id: sub.id, sent: false, reason: gone ? 'subscription-gone' : String(error?.message || error) });
      }
    }
    return json({ ok: true, sent: results.filter((r) => r.sent).length, total: results.length, results });
  }

  if (method === 'POST' && path === '/sms/test') {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const store = await reservationStore(event);
    const config = await integrationsConfig(store);
    const phone = String((readBody(event) || {}).phone || '').trim();
    if (!config.sms_enabled) return json({ error: 'SMS reminders are disabled' }, 400);
    if (!phone) return json({ error: 'A phone number is required to send a test SMS' }, 400);
    const result = await netlifySendSms(store, phone, 'SbyNhamHub: this is a test SMS. SMS reminders are working!');
    return json({ ok: true, ...result });
  }

  if (method === 'POST' && path === '/webhook/test') {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const store = await reservationStore(event);
    const config = await integrationsConfig(store);
    const url = config.webhook_url;
    if (!url) return json({ error: 'Set a webhook URL first' }, 400);
    const payload = { event: 'test', message: 'SbyNhamHub webhook is working', sent_at: new Date().toISOString() };
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      return json({ ok: true, status: res.status, payload });
    } catch (error) {
      return json({ ok: false, error: error.message, payload });
    }
  }

  if (method === 'POST' && path === '/webhook/fire') {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const store = await reservationStore(event);
    const config = await integrationsConfig(store);
    if (!config.webhook_url) return json({ fired: false });
    const booking = (readBody(event) || {}).booking || {};
    try {
      const res = await fetch(config.webhook_url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'booking.created', booking }) });
      return json({ fired: true, status: res.status });
    } catch {
      return json({ fired: false, status: 0 });
    }
  }

  if (method === 'GET' && path === '/discover') {
    const store = await reservationStore(event);
    const rid = await restaurantIdOf(store, url);
    const [cats, menuItems, promoRows, reviewRows, resvRows] = await Promise.all([
      loadCategories(store),
      loadMenu(store, rid),
      loadPromos(store, rid),
      storeReviews(store),
      storeReservations(store)
    ]);
    const settings = await restaurantSettings(store, rid);
    const capacity = Number(settings.capacity) || 48;
    const city = settings.city || 'Phnom Penh';
    const name = settings.name || 'SbyNhamHub';
    const address = settings.address || '123 Riverside Walk, Phnom Penh';

    const cuisine = url.searchParams.get('cuisine') || '';
    const maxPrice = Number(url.searchParams.get('max_price'));
    const minRating = Number(url.searchParams.get('min_rating')) || 0;
    const date = url.searchParams.get('date') || '';
    const guests = Number(url.searchParams.get('guests')) || 0;
    const occasion = url.searchParams.get('occasion') || '';
    const cityFilter = (url.searchParams.get('city') || '').trim();

    let items = menuItems.filter((m) => m.available !== false);
    if (cuisine) items = items.filter((i) => i.category_slug === String(cuisine));
    if (Number.isFinite(maxPrice) && maxPrice >= 0) items = items.filter((i) => Number(i.price) <= maxPrice);
    items = items.slice().sort((a, b) => Number(b.featured) - Number(a.featured) || String(a.category_slug).localeCompare(String(b.category_slug)) || String(a.name).localeCompare(String(b.name)));

    const published = reviewRows.filter((r) => r.status === 'published' && belongsTo(r, rid));
    const count = published.length;
    const avg = count ? Math.round(published.reduce((sum, r) => sum + reviewOverall(r), 0) / count * 10) / 10 : 0;
    const ratingMatched = !minRating || avg >= minRating;
    const cityMatched = !cityFilter || cityFilter === city;

    const avgPrice = items.length ? items.reduce((sum, i) => sum + Number(i.price), 0) / items.length : 0;
    const band = avgPrice >= 20 ? '$$$$' : avgPrice >= 15 ? '$$$' : avgPrice >= 10 ? '$$' : '$';

    const promos = promoRows
      .filter((p) => Number(p.active) && Number(p.featured))
      .filter((p) => promoApplicable(p, { date, time: '', guests: guests || 1, occasion }))
      .map(promoPublic);

    let availability = [];
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      const booked = {};
      for (const r of resvRows) {
        if (belongsTo(r, rid) && r.date === String(date) && ['pending', 'confirmed', 'arrived'].includes(r.status)) booked[r.time] = (booked[r.time] || 0) + Number(r.guests || 0);
      }
      const now = new Date();
      const isToday = String(date) === now.toISOString().slice(0, 10);
      availability = [];
      for (const slot of TIME_SLOTS) {
        if (isToday) {
          const [h, m] = slot.split(':').map(Number);
          if (new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime() <= now.getTime() + 15 * 60 * 1000) continue;
        }
        const seats = booked[slot] || 0;
        const remaining = capacity - seats;
        let state = 'open';
        if (remaining <= 0) state = 'full';
        else if (guests > 0 && remaining < guests) state = 'limited';
        else if (seats / capacity >= 0.8) state = 'limited';
        const offer = state === 'full' ? null : await yieldOfferFor(store, { date: String(date), time: slot, guests: guests || 1, rid });
        availability.push({ time: slot, booked: seats, remaining, capacity, state, yield: offer ? { label: offer.label, discount_pct: offer.discount_pct, discount: offer.discount } : null });
      }
    }

    return json({
      restaurant: { name, address, city, cuisine: cats.map((c) => c.name), price_band: band, verified: true },
      rating: { count, avg },
      categories: cats,
      items,
      promos,
      availability,
      occasions: VALID_OCCASIONS.filter(Boolean),
      cities: CITIES,
      capacity,
      matched: ratingMatched && cityMatched,
      filters: { cuisine, max_price: Number.isFinite(maxPrice) && maxPrice >= 0 ? maxPrice : '', min_rating: minRating || '', date, guests: guests || '', occasion, city: cityFilter }
    });
  }

  if (method === 'GET' && path === '/promos') {
    const store = await reservationStore(event);
    const rid = await restaurantIdOf(store, url);
    const promos = await loadPromos(store, rid);
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
    const { name = '', code = '', type = 'percent', value = '', start_date = '', end_date = '', days = [], start_time = '', end_time = '', min_covers = 0, max_uses = 0, featured = 0, active = 1, auto_end = 0, occasions = [] } = body;
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
      const rid = await restaurantIdOf(store, url);
      if (await findPromoByCode(store, cleanCode, rid)) return json({ error: 'That promo code is already in use' }, 400);
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
    const occasionList = Array.isArray(occasions) ? occasions.map(String).filter(Boolean).map((o) => o.trim()).filter(Boolean) : [];
    if (occasionList.length > 10) return json({ error: 'Too many occasion tags (max 10)' }, 400);
    const store = await reservationStore(event);
    const rid = await restaurantIdOf(store, url);
    const promo = { id: await nextCounter(store, 'promo-counter'), name: String(name).trim(), code: cleanCode || null, type: String(type), value: valueNum, start_date: start_date || null, end_date: end_date || null, days: dayList, start_time: start_time || null, end_time: end_time || null, min_covers: covers, max_uses: uses, used: 0, featured: featured ? 1 : 0, active: active ? 1 : 0, auto_end: auto_end ? 1 : 0, occasions: occasionList, restaurant_id: rid, created_at: new Date().toISOString() };
    await store.setJSON(`promo/${promo.id}`, promo);
    return json({ ok: true, promo }, 201);
  }

  const promoMatch = path.match(/^\/promos\/(\d+)$/);
  if (promoMatch && (method === 'PATCH' || method === 'DELETE')) {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const store = await reservationStore(event);
    const rid = await restaurantIdOf(store, url);
    const key = `promo/${Number(promoMatch[1])}`;
    const promo = await store.get(key, { type: 'json' });
    if (!promo || !belongsTo(promo, rid)) return json({ error: 'Promotion not found' }, 404);
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
      const clash = cleanCode ? (await loadPromos(store, rid)).find((p) => p.code === cleanCode && p.id !== promo.id) : null;
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
    if (body.auto_end !== undefined) promo.auto_end = body.auto_end ? 1 : 0;
    if (body.occasions !== undefined) {
      const occasionList = Array.isArray(body.occasions) ? body.occasions.map(String).filter(Boolean).map((o) => o.trim()).filter(Boolean) : [];
      if (occasionList.length > 10) return json({ error: 'Too many occasion tags (max 10)' }, 400);
      promo.occasions = occasionList;
    }
    await store.setJSON(key, promo);
    return json({ ok: true, promo });
  }

  if (path === '/settings') {
    const store = await reservationStore(event);
    if (method === 'GET') {
      const rid = await restaurantIdOf(store, url);
      const s = await restaurantSettings(store, rid);
      return json({ name: s.name, phone: s.phone, address: s.address, city: s.city, hours: s.hours, avg_cover: s.avg_cover, capacity: s.capacity, fee_rate: s.fee_rate, fee_flat: s.fee_flat, language: s.language, currency: s.currency, currency_rate: s.currency_rate });
    }
    if (method === 'PATCH') {
      if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
      const body = readBody(event);
      const rid = await restaurantIdOf(store, url);
      const row = await getRestaurantValue(store, rid);
      if (!row) return json({ error: 'Restaurant not found' }, 404);
      const current = await restaurantSettings(store, rid);
      let avgCover = current.avg_cover;
      if (body.avg_cover !== undefined) {
        avgCover = Number(body.avg_cover);
        if (!Number.isFinite(avgCover) || avgCover < 0) return json({ error: 'Average cover must be 0 or more' }, 400);
      }
      let feeRate = current.fee_rate;
      if (body.fee_rate !== undefined) {
        feeRate = Number(body.fee_rate);
        if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate > 0.1) return json({ error: 'Fee rate must be between 0 and 10%' }, 400);
      }
      let feeFlat = current.fee_flat;
      if (body.fee_flat !== undefined) {
        feeFlat = Number(body.fee_flat);
        if (!Number.isFinite(feeFlat) || feeFlat < 0) return json({ error: 'Flat fee must be 0 or more' }, 400);
      }
      let seatCapacity = current.capacity;
      if (body.capacity !== undefined) {
        seatCapacity = Number(body.capacity);
        if (!Number.isInteger(seatCapacity) || seatCapacity < 1 || seatCapacity > 1000) return json({ error: 'Seat capacity must be between 1 and 1000' }, 400);
      }
      const nextLanguage = 'en';
      let nextCurrency = row.currency || 'USD';
      if (body.currency !== undefined) {
        if (!['USD', 'KHR'].includes(String(body.currency))) return json({ error: 'Currency must be USD or KHR' }, 400);
        nextCurrency = String(body.currency);
      }
      let nextRate = Number(row.currency_rate || 4100);
      if (body.currency_rate !== undefined) {
        nextRate = Number(body.currency_rate);
        if (!Number.isFinite(nextRate) || nextRate <= 0) return json({ error: 'Currency rate must be more than 0' }, 400);
      }
      const next = {
        ...row,
        name: body.name !== undefined ? String(body.name).trim() : row.name,
        phone: body.phone !== undefined ? String(body.phone).trim() : row.phone,
        address: body.address !== undefined ? String(body.address).trim() : row.address,
        city: body.city !== undefined ? String(body.city).trim() : (row.city || 'Phnom Penh'),
        hours: body.hours !== undefined ? (Array.isArray(body.hours) ? body.hours : []) : row.hours,
        avg_cover: avgCover,
        capacity: seatCapacity,
        language: nextLanguage,
        currency: nextCurrency,
        currency_rate: nextRate
      };
      if (JSON.stringify(next.hours).length > 10000) return json({ error: 'Hours data is too long' }, 400);
      await store.setJSON(`restaurant/${row.id}`, next);
      const key = settingsKey(rid);
      const existing = (await store.get(key, { type: 'json' })) || {};
      await store.setJSON(key, { ...existing, fee_rate: feeRate, fee_flat: feeFlat });
      return json({ ok: true, settings: { name: next.name, phone: next.phone, address: next.address, city: next.city, hours: Array.isArray(next.hours) ? next.hours : (() => { try { return JSON.parse(next.hours); } catch { return []; } })(), avg_cover: Number(next.avg_cover), capacity: Number(next.capacity), fee_rate: Number(feeRate), fee_flat: Number(feeFlat), language: next.language, currency: next.currency, currency_rate: Number(next.currency_rate) } });
    }
  }

  if (method === 'POST' && path === '/auth') {
    const { password, role = 'manager' } = readBody(event);
    if (!['manager', 'admin'].includes(role) || !secret(role)) return json({ error: `${role === 'admin' ? 'Admin' : 'Manager'} login is not configured.` }, 503);
    return password === secret(role) ? json({ ok: true, role, token: createToken(role) }) : json({ error: 'Invalid password' }, 401);
  }

  if (method === 'POST' && path === '/auth/impersonate') {
    if (roleOf(event) !== 'admin') return json({ error: 'Admin access required' }, 403);
    const store = await reservationStore(event);
    const { restaurant_id } = readBody(event);
    if (restaurant_id === undefined || restaurant_id === null || restaurant_id === '') return json({ error: 'Restaurant id is required' }, 400);
    const row = await getRestaurantValue(store, Number(restaurant_id));
    if (!row) return json({ error: 'Restaurant not found' }, 404);
    return json({ ok: true, role: 'manager', restaurant_id: Number(row.id), name: row.name, token: createToken('manager', Number(row.id)) });
  }

  function slugify(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  async function availabilityFor(store, row, { date = '', guests = 1, validParty = false } = {}) {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return [];
    const capacity = Number(row.capacity);
    const booked = {};
    for (const r of await storeReservations(store)) {
      if (belongsTo(r, row.id) && r.date === String(date) && ['pending', 'confirmed', 'arrived'].includes(r.status)) booked[r.time] = (booked[r.time] || 0) + Number(r.guests || 0);
    }
    const now = new Date();
    const isToday = String(date) === now.toISOString().slice(0, 10);
    const out = [];
    for (const slot of TIME_SLOTS) {
      if (isToday) {
        const [h, m] = slot.split(':').map(Number);
        if (new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime() <= now.getTime() + 15 * 60 * 1000) continue;
      }
      const seats = booked[slot] || 0;
      const remaining = capacity - seats;
      let state = 'open';
      if (remaining <= 0) state = 'full';
      else if (validParty && remaining < guests) state = 'limited';
      else if (seats / capacity >= 0.8) state = 'limited';
      const offer = state === 'full' ? null : await yieldOfferFor(store, { date, time: slot, guests: validParty ? guests : 1, rid: Number(row.id) });
      out.push({ time: slot, booked: seats, remaining, capacity, state, yield: offer ? { label: offer.label, discount_pct: offer.discount_pct, discount: offer.discount } : null });
    }
    return out;
  }

  if (method === 'GET' && path === '/marketplace') {
    const store = await reservationStore(event);
    const cityFilter = (url.searchParams.get('city') || '').trim();
    const cuisine = (url.searchParams.get('cuisine') || '').trim();
    const maxPriceRaw = url.searchParams.get('max_price');
    const minRatingRaw = url.searchParams.get('min_rating');
    const date = url.searchParams.get('date') || '';
    const guestsRaw = url.searchParams.get('guests');
    const occasionFilter = (url.searchParams.get('occasion') || '').trim();
    const party = Number(guestsRaw);
    const validParty = Number.isInteger(party) && party > 0 && party <= 20;
    const ratingFilter = minRatingRaw !== null && Number.isFinite(Number(minRatingRaw)) && Number(minRatingRaw) > 0 ? Number(minRatingRaw) : 0;
    const maxPrice = maxPriceRaw !== null && Number.isFinite(Number(maxPriceRaw)) && Number(maxPriceRaw) >= 0 ? Number(maxPriceRaw) : null;

    const allRows = (await loadRestaurants(store)).filter((r) => Number(r.active) === 1 && (r.status || 'approved') === 'approved').sort((a, b) => Number(b.featured || 0) - Number(a.featured || 0) || Number(a.id) - Number(b.id));
    const restaurants = await Promise.all(allRows.map(async (row) => {
      const pub = await netlifyPublicRestaurant(store, row);
      const matched = (cityFilter ? pub.city === cityFilter : true) && (ratingFilter ? (pub.rating ?? 0) >= ratingFilter : true);
      return { ...pub, price_band: netlifyPriceBand(pub.avg_cover), matched, availability: matched ? await availabilityFor(store, row, { date, guests: validParty ? party : 1, validParty }) : [] };
    }));

    const cats = await loadCategories(store);
    let dishItems = [];
    if (cuisine) {
      const cat = cats.find((c) => c.slug === cuisine);
      if (cat) dishItems = (await loadMenu(store)).filter((m) => m.available !== false && Number(m.category_id) === Number(cat.id));
      if (maxPrice !== null) dishItems = dishItems.filter((m) => Number(m.price) <= maxPrice);
      dishItems = dishItems.slice().sort((a, b) => Number(b.featured) - Number(a.featured) || Number(a.price) - Number(b.price)).slice(0, 40);
    } else if (maxPrice !== null) {
      dishItems = (await loadMenu(store)).filter((m) => m.available !== false && Number(m.price) <= maxPrice).slice().sort((a, b) => Number(a.price) - Number(b.price)).slice(0, 40);
    }
    const dishMatched = new Set(dishItems.map((i) => Number(i.restaurant_id || 1)));

    const promoRows = (await loadPromos(store)).filter((p) => Number(p.active) && Number(p.featured)).filter((p) => promoApplicable(p, { date, time: '', guests: validParty ? party : 1, occasion: occasionFilter }));
    const promos = promoRows.map((p) => ({ ...promoPublic(p), restaurant_id: Number(p.restaurant_id || 1) }));

    return json({
      restaurants,
      promos,
      occasions: VALID_OCCASIONS.filter(Boolean),
      cities: CITIES,
      filters: {
        city: cityFilter,
        cuisine,
        max_price: maxPrice,
        min_rating: ratingFilter || '',
        date: date || '',
        guests: validParty ? party : '',
        occasion: occasionFilter,
        dish_matched_restaurant_ids: [...dishMatched]
      }
    });
  }

  if (method === 'GET' && path === '/restaurants') {
    if (roleOf(event) !== 'admin') return json({ error: 'Admin access required' }, 403);
    const store = await reservationStore(event);
    const rows = await loadRestaurants(store);
    const restaurants = await Promise.all(rows.map(async (row) => ({ ...(await netlifyPublicRestaurant(store, row)), active: Number(row.active), slug: row.slug, status: row.status || 'approved', featured: Number(row.featured || 0) })));
    return json(restaurants);
  }

  if (method === 'POST' && path === '/restaurants') {
    if (roleOf(event) !== 'admin') return json({ error: 'Admin access required' }, 403);
    const body = readBody(event);
    const { name = '', city = 'Phnom Penh', address = '', phone = '', hours = [], avg_cover = 15, capacity = 48, tagline = '', avatar = 'logo.svg' } = body;
    if (!String(name).trim()) return json({ error: 'Restaurant name is required' }, 400);
    let slug = slugify(name) || 'restaurant';
    let base = slug;
    let n = 1;
    const store = await reservationStore(event);
    const existing = await loadRestaurants(store);
    while (existing.some((r) => r.slug === slug)) { slug = `${base}-${n++}`; }
    const avg = Number(avg_cover);
    if (!Number.isFinite(avg) || avg < 0) return json({ error: 'Average cover must be 0 or more' }, 400);
    const cap = Number(capacity);
    if (!Number.isInteger(cap) || cap < 1 || cap > 1000) return json({ error: 'Seat capacity must be between 1 and 1000' }, 400);
    const id = await nextCounter(store, 'restaurant-counter', 3);
    const language = 'en';
    const currency = ['USD', 'KHR'].includes(String(body.currency)) ? String(body.currency) : 'USD';
    const rateNum = Number(body.currency_rate);
    const rate = Number.isFinite(rateNum) && rateNum > 0 ? rateNum : 4100;
    const row = { id, slug, name: String(name).trim(), city: String(city).trim(), address: String(address).trim(), phone: String(phone).trim(), hours: Array.isArray(hours) ? hours.slice(0, 12) : [], avg_cover: avg, capacity: cap, tagline: String(tagline || '').trim(), avatar: String(avatar || 'logo.svg').trim(), active: 1, status: 'pending', featured: 0, language, currency, currency_rate: rate, created_at: new Date().toISOString() };
    await store.setJSON(`restaurant/${id}`, row);
    return json({ ok: true, restaurant: { ...(await netlifyPublicRestaurant(store, row)), active: 1, status: 'pending' } }, 201);
  }

  const restAdminMatch = path.match(/^\/restaurants\/(\d+)$/);
  if (restAdminMatch && (method === 'PATCH' || method === 'DELETE')) {
    if (roleOf(event) !== 'admin') return json({ error: 'Admin access required' }, 403);
    const store = await reservationStore(event);
    const id = Number(restAdminMatch[1]);
    const row = await getRestaurantValue(store, id);
    if (!row) return json({ error: 'Restaurant not found' }, 404);
    if (method === 'DELETE') {
      if (id === 1) return json({ error: 'The home restaurant cannot be removed.' }, 400);
      row.active = 0;
      await store.setJSON(`restaurant/${id}`, row);
      return json({ ok: true });
    }
    const body = readBody(event);
    if (body.name !== undefined) {
      if (!String(body.name).trim()) return json({ error: 'Restaurant name is required' }, 400);
      row.name = String(body.name).trim();
    }
    if (body.slug !== undefined) {
      const clean = slugify(body.slug);
      if (!clean) return json({ error: 'Invalid slug' }, 400);
      if ((await loadRestaurants(store)).some((r) => r.slug === clean && Number(r.id) !== id)) return json({ error: 'That slug is already in use' }, 400);
      row.slug = clean;
    }
    if (body.city !== undefined) row.city = String(body.city).trim();
    if (body.address !== undefined) row.address = String(body.address).trim();
    if (body.phone !== undefined) row.phone = String(body.phone).trim();
    if (body.hours !== undefined) row.hours = Array.isArray(body.hours) ? body.hours.slice(0, 12) : [];
    if (body.avg_cover !== undefined) {
      const avg = Number(body.avg_cover);
      if (!Number.isFinite(avg) || avg < 0) return json({ error: 'Average cover must be 0 or more' }, 400);
      row.avg_cover = avg;
    }
    if (body.capacity !== undefined) {
      const cap = Number(body.capacity);
      if (!Number.isInteger(cap) || cap < 1 || cap > 1000) return json({ error: 'Seat capacity must be between 1 and 1000' }, 400);
      row.capacity = cap;
    }
    if (body.tagline !== undefined) row.tagline = String(body.tagline).trim();
    if (body.avatar !== undefined) row.avatar = String(body.avatar || 'logo.svg').trim();
    if (body.active !== undefined) row.active = body.active ? 1 : 0;
    if (body.featured !== undefined) row.featured = body.featured ? 1 : 0;
    if (body.language !== undefined) row.language = 'en';
    if (body.currency !== undefined) {
      if (!['USD', 'KHR'].includes(String(body.currency))) return json({ error: 'Currency must be USD or KHR' }, 400);
      row.currency = String(body.currency);
    }
    if (body.currency_rate !== undefined) {
      const rateNum = Number(body.currency_rate);
      if (!Number.isFinite(rateNum) || rateNum <= 0) return json({ error: 'Currency rate must be greater than 0' }, 400);
      row.currency_rate = rateNum;
    }
    if (body.status !== undefined) {
      if (!['pending', 'approved', 'rejected'].includes(String(body.status))) return json({ error: 'Status must be pending, approved or rejected' }, 400);
      row.status = String(body.status);
      if (row.status === 'approved') row.active = 1;
      if (row.status === 'rejected') row.active = 0;
    }
    await store.setJSON(`restaurant/${id}`, row);
    return json({ ok: true, restaurant: { ...(await netlifyPublicRestaurant(store, row)), active: Number(row.active), slug: row.slug, status: row.status || 'approved', featured: Number(row.featured || 0) } });
  }

  const restMatch = path.match(/^\/restaurants\/([^/]+)$/);
  if (restMatch && method === 'GET') {
    const store = await reservationStore(event);
    const row = await getRestaurantValue(store, restMatch[1]);
    if (!row || Number(row.active) !== 1 || (row.status || 'approved') !== 'approved') return json({ error: 'Restaurant not found' }, 404);
    const date = url.searchParams.get('date') || '';
    const guestsRaw = url.searchParams.get('guests');
    const party = Number(guestsRaw);
    const validParty = Number.isInteger(party) && party > 0 && party <= 20;

    const cats = await loadCategories(store);
    const menuItems = (await loadMenu(store, Number(row.id))).filter((m) => m.available !== false);
    const grouped = new Map();
    for (const item of menuItems) {
      const cat = cats.find((c) => Number(c.id) === Number(item.category_id)) || { name: 'Menu', slug: 'menu' };
      const list = grouped.get(cat.slug) || { name: cat.name, slug: cat.slug, items: [] };
      list.items.push({ id: item.id, name: item.name, description: item.description, price: Number(item.price), image: item.image, tag: item.tag, featured: Number(item.featured) });
      grouped.set(cat.slug, list);
    }

    const promos = (await loadPromos(store, Number(row.id))).filter((p) => Number(p.active) === 1).filter((p) => promoApplicable(p, { date, time: '', guests: validParty ? party : 1 })).map(promoPublic);
    const tables = (await loadTables(store, Number(row.id))).filter((t) => Number(t.active) === 1).map((t) => ({ name: t.name, seats: t.seats }));

    return json({
      ...(await netlifyPublicRestaurant(store, row)),
      price_band: netlifyPriceBand(Number(row.avg_cover)),
      categories: [...grouped.values()],
      promos,
      tables,
      capacity: Number(row.capacity),
      availability: await availabilityFor(store, row, { date, guests: validParty ? party : 1, validParty }),
      occasions: VALID_OCCASIONS.filter(Boolean)
    });
  }

  if (path.startsWith('/reservations') || path === '/stats' || path === '/analytics' || path === '/waitlist' || path === '/reminders') {
    const publicEndpoints =
      (method === 'POST' && (path === '/reservations' || path === '/reservations/lookup' || /\/cancel$/.test(path))) ||
      (method === 'PATCH' && /\/modify$/.test(path)) ||
      (method === 'GET' && path === '/waitlist' && url.searchParams.get('public') === '1');
    if (!authorized(event) && !publicEndpoints) return json({ error: 'Unauthorized' }, 401);
  }

  if (path === '/guests' && !authorized(event)) return json({ error: 'Unauthorized' }, 401);

  if (method === 'GET' && path === '/guests') {
    const store = await reservationStore(event);
    const rid = await restaurantIdOf(store, url);
    return json(await guests(event, rid));
  }

  const guestMatch = path.match(/^\/guests\/([^/]+)$/);
  if (guestMatch && method === 'PATCH') {
    const body = readBody(event);
    const { preferences = '', dietary, allergies, favourite_table = '', occasions, vip } = body;
    if (String(preferences).length > 1000) return json({ error: 'Preferences are too long' }, 400);
    const listOf = (v) => (Array.isArray(v) ? v.map(String) : String(v || '').split(',').map((s) => s.trim())).filter(Boolean).slice(0, 20);
    const store = await reservationStore(event);
    const existing = (await store.get(`guest/${guestMatch[1]}`, { type: 'json' })) || {};
    const profile = {
      ...existing,
      preferences: String(preferences).trim(),
      dietary: JSON.stringify(listOf(dietary)),
      allergies: JSON.stringify(listOf(allergies)),
      favourite_table: String(favourite_table || '').trim().slice(0, 20),
      occasions: JSON.stringify(listOf(occasions)),
      vip: vip ? 1 : 0,
      updated_at: new Date().toISOString()
    };
    await store.setJSON(`guest/${guestMatch[1]}`, profile);
    return json({ ok: true, profile });
  }

  const personalise = (req) => {
    const email = String((req.query && req.query.email) || (req.body && req.body.email) || '').trim();
    const phone = String((req.query && req.query.phone) || (req.body && req.body.phone) || '').trim();
    return email || phone ? guestId({ email, phone }) : null;
  };

  if (method === 'GET' && path === '/personalise') {
    const key = personalise({ query: url.searchParams });
    if (!key) return json({ error: 'Enter an email or phone.' }, 400);
    const profile = await netlifyProfile(event, key);
    return json({ guest_key: key, state: profile.state, categories: profile.categories, saved: profile.saved, corrections: profile.corrections });
  }

  if (method === 'GET' && path === '/personalise/feed') {
    const key = personalise({ query: url.searchParams });
    if (!key) return json({ error: 'Enter an email or phone.' }, 400);
    const limit = Math.min(12, Math.max(1, Number(url.searchParams.get('limit')) || 6));
    const profile = await netlifyProfile(event, key, limit);
    return json({ ...profile.state, items: profile.feed });
  }

  if (method === 'GET' && path === '/saves') {
    const key = personalise({ query: url.searchParams });
    if (!key) return json({ error: 'Enter an email or phone.' }, 400);
    const store = await reservationStore(event);
    const menu = await loadMenu(store);
    const allSaves = await blobSaves(store);
    const ids = new Set(allSaves.filter((s) => s.guest_key === key).map((s) => Number(s.item_id)));
    return json({ items: menu.filter((m) => ids.has(Number(m.id))) });
  }

  if (method === 'POST' && path === '/saves') {
    const body = readBody(event);
    const key = personalise({ body });
    if (!key) return json({ error: 'Enter an email or phone.' }, 400);
    const itemId = Number(body.item_id);
    if (!itemId) return json({ error: 'Dish not found' }, 400);
    const store = await reservationStore(event);
    const menu = await loadMenu(store);
    if (!menu.some((m) => Number(m.id) === itemId)) return json({ error: 'Dish not found' }, 400);
    await store.setJSON(`save/${key}-${itemId}`, { guest_key: key, item_id: itemId, created_at: new Date().toISOString() });
    return json({ ok: true });
  }

  if (method === 'DELETE' && path === '/saves') {
    const body = readBody(event);
    const key = personalise({ body });
    if (!key) return json({ error: 'Enter an email or phone.' }, 400);
    const store = await reservationStore(event);
    await store.delete(`save/${key}-${Number(body.item_id)}`);
    return json({ ok: true });
  }

  if (method === 'POST' && path === '/personalise/correct') {
    const body = readBody(event);
    const key = personalise({ body });
    if (!key) return json({ error: 'Enter an email or phone.' }, 400);
    const itemId = Number(body.item_id);
    if (!itemId) return json({ error: 'Dish not found' }, 400);
    const store = await reservationStore(event);
    const menu = await loadMenu(store);
    if (!menu.some((m) => Number(m.id) === itemId)) return json({ error: 'Dish not found' }, 400);
    const signal = Number(body.signal) > 0 ? 1 : -1;
    await store.setJSON(`pref/${key}-${itemId}`, { guest_key: key, item_id: itemId, signal, updated_at: new Date().toISOString() });
    return json({ ok: true });
  }

  if (method === 'POST' && path === '/personalise/reset') {
    const body = readBody(event);
    const key = personalise({ body });
    if (!key) return json({ error: 'Enter an email or phone.' }, 400);
    const store = await reservationStore(event);
    const saves = await blobSaves(store);
    const corrections = await blobCorrections(store);
    for (const s of saves.filter((s) => s.guest_key === key)) await store.delete(`save/${key}-${s.item_id}`);
    for (const c of corrections.filter((c) => c.guest_key === key)) await store.delete(`pref/${key}-${c.item_id}`);
    return json({ ok: true });
  }

  if (method === 'POST' && path === '/reservations') {
    const body = readBody(event);
    const { name = '', email = '', phone = '', date = '', time = '', guests = '', occasion = '', notes = '', redeem_points = '', promo_code = '', source = 'online', sms_opt_in = false } = body;
    const invalid = [];
    if (!String(name).trim()) invalid.push('name');
    if (!String(phone).trim()) invalid.push('phone');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) invalid.push('date');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) invalid.push('time');
    const partySize = Number(guests);
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 20) invalid.push('guests');
    if (occasion && !VALID_OCCASIONS.includes(String(occasion))) invalid.push('occasion');
    if (!['online', 'walk-in', 'phone'].includes(String(source))) invalid.push('source');
    if (invalid.length) return json({ error: `Invalid fields: ${invalid.join(', ')}` }, 400);
    if (new Date(`${date} ${time}:00Z`).getTime() <= Date.now() - 15 * 60 * 1000) return json({ error: 'Please pick a future date and time.' }, 400);

    const store = await reservationStore(event);
    let rid = await restaurantIdOf(store, url);
    if (body.restaurant !== undefined && body.restaurant !== null && String(body.restaurant).trim() !== '') {
      const row = await getRestaurantValue(store, body.restaurant);
      if (row) rid = Number(row.id);
    }
    const restaurant = await getRestaurantValue(store, rid);

    let points_redeemed = 0;
    let discount = 0;
    let pointsState = null;
    let pointsKey = '';
    const rp = Number(redeem_points);
    if (rp) {
      if (!String(email).trim()) return json({ error: 'Add an email to redeem points.' }, 400);
      if (!Number.isInteger(rp) || rp < POINTS_UNIT || rp % POINTS_UNIT !== 0) return json({ error: `Points must be a multiple of ${POINTS_UNIT}.` }, 400);
      pointsKey = guestId({ email, phone });
      pointsState = await blobPointsState(store, pointsKey);
      if (pointsState.balance < rp) return json({ error: 'Not enough points for that email.' }, 400);
      discount = (rp / POINTS_UNIT) * POINTS_RATE;
      points_redeemed = rp;
    }

    let promo_id = 0;
    let promo_name = '';
    let promo_discount = 0;
    const settings = await restaurantSettings(store, rid);
    const avgCover = Number(settings.avg_cover) || 15;
    if (String(promo_code).trim()) {
      const promo = await findPromoByCode(store, promo_code, rid);
      if (!promo) return json({ error: 'That promo code is not valid.' }, 400);
      if (Number(promo.auto_end) && await slotIsFullAt(store, date, time, rid)) return json({ error: 'That promo has ended — the restaurant is at capacity for this slot.' }, 400);
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

    let yield_rule_id = 0;
    let yield_label = '';
    let yield_discount = 0;
    if (!promo_id) {
      const offer = await yieldOfferFor(store, { date, time, guests: partySize, rid });
      if (offer) {
        yield_rule_id = offer.rule.id;
        yield_label = offer.label;
        yield_discount = offer.discount;
        discount += yield_discount;
      }
    }

    const reservation = { id: crypto.randomUUID(), name: String(name).trim(), email: String(email).trim(), phone: String(phone).trim(), date, time, guests: partySize, occasion: occasion || '', notes: String(notes || '').trim(), table: '', status: 'pending', points_awarded: 0, points_redeemed, discount, promo_id, promo_name, promo_discount, yield_rule_id, yield_label, yield_discount, source: String(source), sms_opt_in: sms_opt_in ? 1 : 0, reminder_24h: 0, reminder_2h: 0, restaurant_id: rid, created_at: new Date().toISOString() };
    await store.setJSON(`reservation/${reservation.id}`, reservation);
    if (points_redeemed) {
      await consumeBlobPoints(store, pointsKey, pointsState.ledger, points_redeemed, reservation.id, `Discount $${discount.toFixed(2)} on booking #${reservation.id}`);
      const account = await pointsAccount(store, pointsKey);
      account.balance = pointsState.balance - points_redeemed;
      await store.setJSON(`points/${pointsKey}`, account);
    }
    const venue = (restaurant && restaurant.name) || 'SbyNhamHub';
    try { await sendBookingConfirmation(reservation); } catch { /* email is best-effort */ }
    if (reservation.sms_opt_in) {
      try { await netlifySendSms(store, reservation.phone, `${venue}: table confirmed for ${reservation.date} at ${reservation.time}. Party of ${reservation.guests}. Ref #${reservation.id}`); } catch { /* best-effort */ }
    }
    try { await netlifyPushMatches(store, reservation, { title: `Your table at ${venue} is confirmed`, body: `${reservation.date} at ${reservation.time} · Party of ${reservation.guests}`, tag: `confirmed-${reservation.id}` }); } catch { /* best-effort */ }
    const fireWebhook = async () => {
      try {
        const config = await integrationsConfig(store);
        if (!config.webhook_url) return;
        await fetch(config.webhook_url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'booking.created', booking: reservation }) });
      } catch { /* best-effort */ }
    };
    fireWebhook();
    return json({ ok: true, reservation }, 201);
  }

  if (method === 'GET' && path === '/reservations') {
    const store = await reservationStore(event);
    const rid = await restaurantIdOf(store, url);
    const date = url.searchParams.get('date');
    const items = sortReservations((await storeReservations(store)).filter((r) => belongsTo(r, rid))).filter((item) => !date || item.date === date);
    return json(items);
  }

  if (method === 'GET' && path === '/stats') {
    const store = await reservationStore(event);
    const rid = await restaurantIdOf(store, url);
    const items = (await storeReservations(store)).filter((r) => belongsTo(r, rid));
    const today = new Date().toISOString().slice(0, 10);
    const todays = items.filter((item) => item.date === today);
    const by_status = VALID_STATUS.map((status) => ({ status, n: items.filter((item) => item.status === status).length })).filter((item) => item.n);
    return json({ total: items.length, today: todays.length, covers_today: todays.reduce((total, item) => total + Number(item.guests), 0), confirmed: items.filter((item) => item.status === 'confirmed').length, by_status });
  }

  if (method === 'GET' && path === '/admin/summary') {
    if (roleOf(event) !== 'admin') return json({ error: 'Admin access required' }, 403);
    const store = await reservationStore(event);
    const rid = await restaurantIdOf(store, url);
    const items = (await storeReservations(store)).filter((r) => belongsTo(r, rid));
    const today = new Date().toISOString().slice(0, 10);
    const todays = items.filter((item) => item.date === today);
    const recent = [...items].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 6);
    return json({ total: items.length, today: todays.length, covers_today: todays.reduce((total, item) => total + Number(item.guests), 0), confirmed: items.filter((item) => item.status === 'confirmed').length, recent });
  }

  if (method === 'GET' && path === '/admin/platform') {
    if (roleOf(event) !== 'admin') return json({ error: 'Admin access required' }, 403);
    const store = await reservationStore(event);
    const [rows, resvAll, menuAll, tablesAll] = await Promise.all([
      loadRestaurants(store),
      storeReservations(store),
      loadMenu(store),
      loadTables(store)
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const restaurants = await Promise.all(rows.map(async (row) => {
      const rid = Number(row.id);
      const resv = resvAll.filter((r) => belongsTo(r, rid));
      const fees = (await store.get(settingsKey(rid), { type: 'json' })) || {};
      return {
        ...(await netlifyPublicRestaurant(store, row)),
        active: Number(row.active),
        slug: row.slug,
        total_reservations: resv.length,
        today_reservations: resv.filter((r) => r.date === today).length,
        covers_today: resv.filter((r) => r.date === today).reduce((sum, r) => sum + Number(r.guests), 0),
        menu_count: menuAll.filter((m) => belongsTo(m, rid)).length,
        table_count: tablesAll.filter((t) => belongsTo(t, rid)).length,
        fee_rate: Number(fees.fee_rate ?? 0.0095),
        fee_flat: Number(fees.fee_flat ?? 0.5)
      };
    }));
    const totals = restaurants.reduce(
      (acc, r) => {
        acc.total_reservations += r.total_reservations;
        acc.today_reservations += r.today_reservations;
        acc.covers_today += r.covers_today;
        return acc;
      },
      { total_reservations: 0, today_reservations: 0, covers_today: 0, restaurants: restaurants.length }
    );
    return json({ restaurants, totals });
  }

  if (method === 'POST' && path === '/payments/pay') {
    const body = readBody(event);
    const { name = '', email = '', amount = '', tip_pct = 0, split_across = 1, split_index = 1, reservation_id = '', card = {} } = body;
    const invalid = [];
    if (!String(name).trim()) invalid.push('name');
    if (!String(email).trim()) invalid.push('email');
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > 100000) invalid.push('amount');
    const tipPct = Number(tip_pct);
    if (!Number.isFinite(tipPct) || tipPct < 0 || tipPct > 25) invalid.push('tip');
    const splitAcross = Number(split_across);
    const splitIndex = Number(split_index);
    if (!Number.isInteger(splitAcross) || splitAcross < 1 || splitAcross > 12) invalid.push('split_across');
    if (!Number.isInteger(splitIndex) || splitIndex < 1 || splitIndex > splitAcross) invalid.push('split_index');
    if (invalid.length) return json({ error: `Invalid fields: ${invalid.join(', ')}` }, 400);

    const processed = mockProcessCard(card);
    if (processed.error) return json({ error: processed.error }, 400);

    const store = await reservationStore(event);
    let target = null;
    if (String(reservation_id).trim()) {
      target = await store.get(`reservation/${String(reservation_id).trim()}`, { type: 'json' });
      if (!target) return json({ error: 'No booking found with that reference.' }, 404);
    }
    const settings = await restaurantSettings(store, Number(target?.restaurant_id) || 1);
    const feeRate = Number(settings.fee_rate) || PAY_FEE_RATE;
    const feeFlat = Number(settings.fee_flat) || PAY_FEE_FLAT;
    const tipAmount = computeTip(amt, tipPct);
    const feeTotal = computeFee(amt, feeRate, feeFlat);
    const total = round2(amt + tipAmount + feeTotal);

    let rid = 0;
    if (target) {
      target.status = 'paid';
      await store.setJSON(`reservation/${target.id}`, target);
      rid = target.id;
    }

    const ref = paymentRef();
    const payment = { id: ref, payment_ref: ref, reservation_id: rid, name: String(name).trim(), email: String(email).trim(), amount: amt, tip_pct: tipPct, tip_amount: tipAmount, fee_rate: feeRate, fee_flat: feeFlat, fee_total: feeTotal, total, split_across: splitAcross, split_index: splitIndex, card_last4: processed.last4, status: 'paid', created_at: new Date().toISOString() };
    await store.setJSON(`payment/${ref}`, payment);
    try { await sendPaymentReceipt(payment, rid ? await store.get(`reservation/${rid}`, { type: 'json' }) : null); } catch { /* email is best-effort */ }
    return json({ ok: true, payment }, 201);
  }

  if (method === 'GET' && /^\/payments\/receipt\/[^/]+$/.test(path)) {
    const ref = String(path.split('/').pop()).toUpperCase();
    if (!/^NYM-[A-Z0-9]{8}$/.test(ref)) return json({ error: 'Invalid receipt reference.' }, 400);
    const store = await reservationStore(event);
    const payment = await store.get(`payment/${ref}`, { type: 'json' });
    if (!payment) return json({ error: 'No payment found with that reference.' }, 404);
    const reservation = payment.reservation_id ? await store.get(`reservation/${payment.reservation_id}`, { type: 'json' }) : null;
    return json({ payment, reservation });
  }

  if (method === 'GET' && path === '/payments') {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const rows = await payments(event);
    const summary = { count: rows.length, gross: round2(rows.reduce((sum, p) => sum + p.total, 0)), fees: round2(rows.reduce((sum, p) => sum + p.fee_total, 0)), tips: round2(rows.reduce((sum, p) => sum + p.tip_amount, 0)), net: round2(rows.reduce((sum, p) => sum + p.total - p.fee_total, 0)) };
    return json({ summary, payments: rows });
  }

  if (method === 'POST' && /^\/payments\/[^/]+\/refund$/.test(path)) {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const ref = path.split('/')[2];
    const store = await reservationStore(event);
    const payment = await store.get(`payment/${ref}`, { type: 'json' });
    if (!payment) return json({ error: 'Payment not found' }, 404);
    payment.status = 'refunded';
    await store.setJSON(`payment/${ref}`, payment);
    return json({ ok: true, payment });
  }

  if (method === 'GET' && path === '/points/lookup') {
    const store = await reservationStore(event);
    const result = await pointsLookup(event, store, url.searchParams.get('email') || '', url.searchParams.get('phone') || '');
    return json({ balance: result.balance, lifetime: result.lifetime, name: result.name, history: result.history });
  }

  if (method === 'GET' && path === '/reviews/summary') {
    const store = await reservationStore(event);
    const rid = await restaurantIdOf(store, url);
    const items = (await storeReviews(store)).filter((r) => belongsTo(r, rid));
    const published = items.filter((item) => item.status === 'published');
    const count = published.length;
    const avg = count ? published.reduce((sum, item) => sum + reviewOverall(item), 0) / count : 0;
    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (const item of published) distribution[reviewOverall(item)] += 1;
    return json({ count, avg: Math.round(avg * 10) / 10, distribution });
  }

  if (method === 'GET' && path === '/reviews') {
    const store = await reservationStore(event);
    const rid = await restaurantIdOf(store, url);
    const all = url.searchParams.get('all') === '1';
    if (all && !authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const items = (await storeReviews(store)).filter((r) => belongsTo(r, rid)).sort((a, b) => String(b.id).localeCompare(String(a.id)));
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

    const text = String(comment).trim();
    const gid = guestId({ email, phone });
    const allReviews = await reviews(event);
    const isDuplicate = allReviews.some((r) => r.comment === text && guestId({ email: r.email, phone: r.phone }) === gid);
    const spamReason = detectSpam(text, { isDuplicate });

    const review = {
      id: crypto.randomUUID(),
      reservation_id,
      name: String(reservation.name).trim(),
      email: String(reservation.email || '').trim(),
      phone: String(reservation.phone || '').trim(),
      rating_food: ratings[0], rating_service: ratings[1], rating_ambience: ratings[2], rating_value: ratings[3],
      comment: text,
      reply: '',
      status: 'pending',
      spam: spamReason ? 1 : 0,
      spam_reason: spamReason || '',
      restaurant_id: Number(reservation.restaurant_id) || 1,
      created_at: new Date().toISOString()
    };
    await store.setJSON(`review/${review.id}`, review);
    return json({ ok: true, review: publicReview(review) }, 201);
  }

  const reviewMatch = path.match(/^\/reviews\/([^/]+)$/);
  if (reviewMatch && method === 'PATCH') {
    if (!authorized(event)) return json({ error: 'Unauthorized' }, 401);
    const { status, reply, spam, spam_reason } = readBody(event);
    if (status !== undefined && !['pending', 'published', 'hidden'].includes(status)) return json({ error: 'Invalid status' }, 400);
    if (reply !== undefined && String(reply).length > 1000) return json({ error: 'Reply is too long' }, 400);
    if (spam !== undefined && ![0, 1].includes(Number(spam))) return json({ error: 'Invalid spam flag' }, 400);
    const store = await reservationStore(event);
    const rid = await restaurantIdOf(store, url);
    const key = `review/${reviewMatch[1]}`;
    const review = await store.get(key, { type: 'json' });
    if (!review || !belongsTo(review, rid)) return json({ error: 'Review not found' }, 404);
    if (status !== undefined) review.status = status;
    if (reply !== undefined) review.reply = String(reply).trim();
    if (review.status === 'published') {
      review.spam = 0;
      review.spam_reason = '';
    }
    if (spam !== undefined) {
      review.spam = Number(spam);
      review.spam_reason = Number(spam) ? String(spam_reason || 'Marked by staff') : '';
    }
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
    let rid = await restaurantIdOf(store, url);
    const bodyRestaurant = readBody(event).restaurant;
    if (bodyRestaurant !== undefined && String(bodyRestaurant).trim()) {
      const row = await getRestaurantValue(store, bodyRestaurant);
      if (row) rid = Number(row.id);
    }
    const entry = { id: await nextCounter(store, 'wait-counter'), name: String(name).trim(), phone: String(phone).trim(), email: String(email || '').trim(), party_size: partySize, preferred_date, preferred_time, notes: String(notes || '').trim(), status: 'waiting', restaurant_id: rid, created_at: new Date().toISOString() };
    await store.setJSON(`wait/${entry.id}`, entry);
    return json({ ok: true, entry }, 201);
  }

  if (method === 'GET' && path === '/waitlist') {
    const store = await reservationStore(event);
    const rid = await restaurantIdOf(store, url);
    const { blobs } = await store.list({ prefix: 'wait/' });
    const values = await Promise.all(blobs.map(({ key }) => store.get(key, { type: 'json' })));
    const date = url.searchParams.get('date');
    return json(values.filter(Boolean).filter((item) => belongsTo(item, rid)).sort((a, b) => `${a.preferred_date} ${a.preferred_time}`.localeCompare(`${b.preferred_date} ${b.preferred_time}`)).filter((item) => !date || item.preferred_date === date));
  }

  const waitMatch = path.match(/^\/waitlist\/(\d+)$/);
  if (waitMatch && (method === 'PATCH' || method === 'DELETE')) {
    const store = await reservationStore(event);
    const rid = await restaurantIdOf(store, url);
    const key = `wait/${Number(waitMatch[1])}`;
    const entry = await store.get(key, { type: 'json' });
    if (!entry || !belongsTo(entry, rid)) return json({ error: 'Waitlist entry not found' }, 404);
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
    const config = await integrationsConfig(store);
    const sent = [];
    for (const reservation of items) {
      if (!['pending', 'confirmed'].includes(reservation.status)) continue;
      const hours = (new Date(`${reservation.date} ${reservation.time}:00Z`).getTime() - now) / 3600000;
      if (hours >= 20 && hours <= 26 && !reservation.reminder_24h) {
        try { await sendReminder(reservation, 24); } catch { /* best-effort */ }
        if (config.sms_enabled && Number(reservation.sms_opt_in)) { try { await netlifySendSms(store, reservation.phone, `SbyNhamHub: ${reservation.name}, your table is tomorrow at ${reservation.time}. Party of ${reservation.guests}. Ref #${reservation.id}`); } catch { /* best-effort */ } }
        if (config.push_enabled) { try { await netlifyPushMatches(store, reservation, { title: 'Your SbyNhamHub table is tomorrow', body: `${reservation.date} at ${reservation.time} · Party of ${reservation.guests}`, tag: `reminder-24h-${reservation.id}` }); } catch { /* best-effort */ } }
        reservation.reminder_24h = 1;
        await store.setJSON(`reservation/${reservation.id}`, reservation);
        sent.push({ id: reservation.id, kind: '24h' });
      } else if (hours >= 1 && hours <= 3 && !reservation.reminder_2h) {
        try { await sendReminder(reservation, 2); } catch { /* best-effort */ }
        if (config.sms_enabled && Number(reservation.sms_opt_in)) { try { await netlifySendSms(store, reservation.phone, `SbyNhamHub: ${reservation.name}, your table is in 2 hours at ${reservation.time}. Party of ${reservation.guests}. Ref #${reservation.id}`); } catch { /* best-effort */ } }
        if (config.push_enabled) { try { await netlifyPushMatches(store, reservation, { title: 'Your SbyNhamHub table is in 2 hours', body: `${reservation.date} at ${reservation.time} · Party of ${reservation.guests}`, tag: `reminder-2h-${reservation.id}` }); } catch { /* best-effort */ } }
        reservation.reminder_2h = 1;
        await store.setJSON(`reservation/${reservation.id}`, reservation);
        sent.push({ id: reservation.id, kind: '2h' });
      }
    }
    return json({ ok: true, count: sent.length, sent });
  }

  if (method === 'GET' && path === '/analytics') {
    const store = await reservationStore(event);
    const rid = await restaurantIdOf(store, url);
    const items = (await storeReservations(store)).filter((r) => belongsTo(r, rid));
    const reviewsList = (await storeReviews(store)).filter((r) => belongsTo(r, rid));
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

    const allPay = await payments(event);
    const ridSet = new Set(items.map((r) => r.id));
    const payRows = allPay.filter((p) => p.status === 'paid' && (!p.reservation_id || ridSet.has(p.reservation_id)));
    const payRevenue = payRows.reduce((sum, p) => sum + p.total, 0);
    const payFees = payRows.reduce((sum, p) => sum + p.fee_total, 0);
    const payTips = payRows.reduce((sum, p) => sum + p.tip_amount, 0);
    const payByDay = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const date = d.toISOString().slice(0, 10);
      const day = payRows.filter((p) => String(p.created_at).slice(0, 10) === date);
      payByDay.push({ date, revenue: Math.round(day.reduce((sum, p) => sum + p.total, 0) * 100) / 100 });
    }

    return json({
      totals: { bookings: items.length, covers: items.reduce((sum, r) => sum + Number(r.guests), 0), arrivals: items.filter((r) => r.status === 'arrived').length, confirmed: items.filter((r) => r.status === 'confirmed').length, closed },
      trend, byDay, byHour, topOccasions,
      noShowRate,
      points: { earned: pointsEarned, redeemed: pointsRedeemed, discount: Math.round((discountTotal - promoDiscount) * 100) / 100 },
      promos: { uses: promoUses, discount: Math.round(promoDiscount * 100) / 100, top: topPromos },
      reviews: { count: published.length, avg: Math.round(reviewAvg * 10) / 10 },
      payments: { count: payRows.length, gross: Math.round(payRevenue * 100) / 100, fees: Math.round(payFees * 100) / 100, tips: Math.round(payTips * 100) / 100, net: Math.round((payRevenue - payFees) * 100) / 100, byDay: payByDay }
    });
  }

  const match = path.match(/^\/reservations\/([^/]+)$/);
  if (match && (method === 'PATCH' || method === 'DELETE')) {
    const store = await reservationStore(event);
    const key = `reservation/${match[1]}`;
    const reservation = await store.get(key, { type: 'json' });
    if (!reservation) return json({ error: 'Reservation not found' }, 404);
    const rid = await restaurantIdOf(store, url, reservation.restaurant_id || 1);
    if (!belongsTo(reservation, rid)) return json({ error: 'Reservation not found' }, 404);
    if (method === 'DELETE') { await store.delete(key); return json({ ok: true }); }
    const { status, table } = readBody(event);
    if (status !== undefined && !VALID_STATUS.includes(status)) return json({ error: 'Invalid status' }, 400);
    if (table !== undefined && table !== '') {
      const valid = (await loadTables(store, rid)).filter((t) => Number(t.active) === 1).map((t) => t.name);
      if (!valid.includes(String(table))) return json({ error: 'Invalid table' }, 400);
    }
    if (status !== undefined) reservation.status = status;
    if (table !== undefined) reservation.table = table;
    await store.setJSON(key, reservation);
    const points = reservation.status === 'arrived' ? await awardPoints(event, store, reservation) : null;
    return json({ ok: true, reservation, points });
  }

  return json({ error: 'Not found' }, 404);
};
