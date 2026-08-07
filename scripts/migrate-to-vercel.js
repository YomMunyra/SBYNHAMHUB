'use strict';

// One-time importer: moves dynamic site data from Netlify Blobs into Vercel Blob.
//
// Usage:
//   1. Export current Netlify data to a JSON file as { key: value } (see README for
//      the `netlify blobs` one-liner, or download blobs from the Netlify dashboard).
//   2. Set BLOB_READ_WRITE_TOKEN (from `npx vercel blob link` + dashboard).
//   3.   node scripts/migrate-to-vercel.js <input.json> [--prefix your-folder]
//
// Static/catalog data (categories, menu, restaurants) is re-seeded automatically by
// the API on first read, so it does NOT need to be migrated.

const fs = require('node:fs');
const path = require('node:path');
const { createVercelBlobStore } = require('../server/lib/vercel-blob-store');

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node scripts/migrate-to-vercel.js <dump.json>');
    process.exit(1);
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('Missing BLOB_READ_WRITE_TOKEN env var. Run `npx vercel blob` to set one up.');
    process.exit(1);
  }

  const dump = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
  const entries = Array.isArray(dump) ? dump : Object.entries(dump);
  if (Array.isArray(dump)) {
    console.error('Expected an object { key: value }. Use the export format from the README.');
    process.exit(1);
  }

  const store = createVercelBlobStore();
  let n = 0;
  for (const [key, value] of entries) {
    await store.setJSON(key, value);
    n += 1;
    if (n % 25 === 0) process.stdout.write(`  ${n} stored...\n`);
  }
  console.log(`Done. Stored ${n} blobs in Vercel Blob.`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});