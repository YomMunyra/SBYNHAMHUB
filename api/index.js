'use strict';

// Vercel serverless function that wraps the existing Netlify Lambda handler.
// Translates Vercel's (req, res) into a Netlify-shaped `event` so
// netlify/functions/api.js — requestPath / requestUrl / readBody and every
// route — works unchanged, then translates the Lambda reply back to res.

const { handler } = require('../netlify/functions/api');

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = async function vercelHandler(req, res) {
  const url = req.url || '/';
  const qIndex = url.indexOf('?');
  const path = qIndex === -1 ? url : url.slice(0, qIndex);
  const rawQuery = qIndex === -1 ? '' : url.slice(qIndex + 1);
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const body = await readRawBody(req);

  const event = {
    httpMethod: req.method,
    headers: req.headers,
    path,
    rawQuery,
    rawUrl: `${proto}://${host}${url}`,
    body: body || '',
    isBase64Encoded: false,
    queryStringParameters: Object.fromEntries(new URLSearchParams(rawQuery))
  };

  const result = await handler(event);

  res.statusCode = result.statusCode || 200;
  const headers = result.headers || {};
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }

  const bodyOut = result.body ?? '';
  if (result.isBase64Encoded) {
    return res.end(Buffer.from(bodyOut, 'base64'));
  }
  if (typeof bodyOut !== 'string') {
    return res.end(String(bodyOut));
  }
  return res.end(bodyOut);
};