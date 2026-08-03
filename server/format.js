'use strict';

const crypto = require('node:crypto');

function publicItem(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price,
    image: row.image,
    tag: row.tag,
    featured: !!row.featured,
    available: row.available !== 0,
    category_id: row.category_id,
    category: row.category,
    category_slug: row.category_slug
  };
}

function reviewOverall(row) {
  return Math.round((row.rating_food + row.rating_service + row.rating_ambience + row.rating_value) / 4);
}

function publicReview(row) {
  const parts = String(row.name || '').trim().split(/\s+/);
  const firstName = parts[0] || 'Guest';
  const lastInitial = parts.length > 1 ? ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.' : '';
  return {
    id: row.id,
    name: firstName + lastInitial,
    overall: reviewOverall(row),
    ratings: {
      food: row.rating_food,
      service: row.rating_service,
      ambience: row.rating_ambience,
      value: row.rating_value
    },
    comment: row.comment,
    reply: row.reply || '',
    created_at: row.created_at
  };
}

function guestId(email, phone) {
  return crypto
    .createHash('sha256')
    .update(`${String(email || '').trim().toLowerCase()}|${String(phone || '').trim()}`)
    .digest('base64url')
    .slice(0, 18);
}

module.exports = { publicItem, publicReview, reviewOverall, guestId };
