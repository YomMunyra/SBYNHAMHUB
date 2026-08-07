'use strict';

// Drop-in replacement for Netlify Block Storage (`@netlify/blobs`) backed by
// Vercel Blob (`@vercel/blob`). It exposes the same minimal surface that
// netlify/functions/api.js relies on:
//
//   store.get(key, { type: 'json' })
//   store.setJSON(key, value)
//   store.delete(key)
//   store.list({ prefix })
//
// Netlify blob keys (e.g. `reservation/123`, `ledger/<hash>/<uuid>`) map 1:1 to
// Vercel pathnames. Keys are stored {@link access: 'private'} so they are only
// readable server-side with BLOB_READ_WRITE_TOKEN — matching Netlify's
// non-public store semantics.

function streamToString(stream) {
  if (!stream) return Promise.resolve('');
  return new Response(stream).text();
}

function createVercelBlobStore(blobApi = null) {
  const blob =
    blobApi ||
    (() => {
      try {
        return require('@vercel/blob');
      } catch {
        return null;
      }
    })();

  if (!blob || typeof blob.put !== 'function') {
    throw new Error('vercel-blob-store: @vercel/blob is not available');
  }

  // Optional single top-level path prefix so every app blob lives under one
  // folder (e.g. `sbynham/`). All keys are still addressed without it.
  const prefix = (process.env.BLOB_PREFIX || '').replace(/^\/+|\/+$/g, '');
  const full = (key) => {
    const k = String(key || '');
    return (prefix ? `${prefix}/${k}` : k).replace(/^\/+/, '');
  };
  const strip = (pathname) => (prefix ? String(pathname).slice(`${prefix}/`.length) : String(pathname));

  return {
    async get(key, opts = {}) {
      const p = full(key);
      let res;
      try {
        res = await blob.get(p, { access: 'private', useCache: false });
      } catch (err) {
        if (err && (err.status === 404 || err.statusCode === 404)) return null;
        throw err;
      }
      if (!res || !res.stream) return null;
      const text = await streamToString(res.stream);
      if (!text) return null;
      if (!opts || opts.type === 'json') {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      }
      return text;
    },

    async setJSON(key, value) {
      const p = full(key);
      await blob.put(p, JSON.stringify(value), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json; charset=utf-8'
      });
    },

    async delete(key) {
      const p = full(key);
      await blob.del(p);
    },

    async list(opts = {}) {
      const searchPrefix = strip(full(opts.prefix || ''));
      // Ensure a clean prefix without a stray leading slash.
      const normalized = prefix
        ? `${prefix}/${searchPrefix.replace(/^\/+/, '')}`
        : searchPrefix.replace(/^\/+/, '');
      const blobs = [];
      let cursor;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const page = await blob.list({
          prefix: normalized,
          limit: 1000,
          ...(cursor ? { cursor } : {})
        });
        if (page && Array.isArray(page.blobs)) {
          for (const b of page.blobs) blobs.push({ key: strip(b.pathname), pathname: b.pathname, url: b.url });
        }
        if (!page || !page.hasMore || !page.cursor) break;
        cursor = page.cursor;
      }
      return { blobs };
    }
  };
}

module.exports = { createVercelBlobStore };