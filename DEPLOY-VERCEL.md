# Deploy on Vercel

This app was migrated off Netlify (functions + Netlify Blobs) to **Vercel**
(single serverless function `api/index.js` + **Vercel Blob** storage). The
static site in `public/` is unchanged. `vercel.json` replaces `netlify.toml`.

## How the pieces map

| Netlify                       | Vercel                                    |
| ----------------------------- | ----------------------------------------- |
| `netlify/functions/api.js`    | wrapped by `api/index.js` (unchanged logic)|
| `@netlify/blobs` `getStore()` | `@vercel/blob` via `server/lib/vercel-blob-store.js` |
| `netlify.toml` redirects       | `vercel.json` routes                      |
| Netlify env vars               | Vercel env vars (below)                   |

> **Static data (menu, categories & restaurant rows) re-seeds itself** on first
> read, so a fresh deploy is fully populated without any migration.

## Deploy steps

1. **Install the Vercel CLI** and log in:
   ```bash
   npm i -g vercel
   vercel login
   ```
2. **Link the project** from the repo root:
   ```bash
   vercel link
   ```
3. **Set up storage** — create & link a store once:
   ```bash
   vercel blob create-store sbynhamhub-blobs --access private --yes
   ```
   This writes `BLOB_READ_WRITE_TOKEN` to `.env.local` and links the store to
   the project. Add that token as a **Production** env var in the dashboard.
4. **Add the app env vars** in **Settings → Environment Variables**
   (copy from the old Netlify env; without these the admin/manager login and
   email/push/SMS features won't work — the public site still works):
   - `ADMIN_PASSWORD`, `MANAGER_PASSWORD`
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
   - `SMS_WEBHOOK_URL`, `SMS_FROM`
5. **Optionally** `BLOB_PREFIX` if you want all keys under one folder.
6. **Deploy:**
   ```bash
   vercel --prod
   ```
   Share the resulting `https://<your-app>.vercel.app` URL with your friend.

### Local preview (before going live)
```bash
vercel dev
```

## Migrating existing dynamic data (optional)

Only *real* reservations / reviews / points ledger need to move — the catalog
re-seeds itself.

1. Export the Netlify store to `{ key: value }` JSON. With the Netlify CLI:
   ```bash
   netlify blobs list --site <site>` and download or pipe values to export
   ```
   (or download blobs from the Netlify Blobs dashboard into a `dump.json` of that shape).
2. Run the importer with the Vercel token in scope:
   ```bash
   $env:BLOB_READ_WRITE_TOKEN="<your-token>"
   node scripts/migrate-to-vercel.js dump.json
   ```

## Verification
The migration was smoke-tested locally:
- blob adapter round-trip / overwrite / list / delete / missing → `null`
- Vercel `req/res` → Netlify `event` translation (method, path, query, body, headers, status)
- full real `api.js` routes (menu seed, auth, category write) through the adapter
- `npm run dev` still works unchanged for local development (uses SQLite in `db.js`)