# SbyNhamHub — Taste · Book · Enjoy

A full-stack restaurant website built from the **NyamHub** Figma Make design
(branding, palette, content and booking narrative) for the restaurant **SbyNhamHub**.

## Stack

- **Backend:** Node.js + Express
- **Database:** SQLite via the built-in `node:sqlite` module (no native compile, no extra dependency)
- **Frontend:** Vanilla HTML/CSS/JS, single shared design system (`public/css/style.css`)

## Run

```bash
npm install
npm start
```

Then open http://localhost:3000

## Deploy to Netlify

This repository includes Netlify configuration and a serverless API. Menu data is
included with the deployment and reservations are stored persistently in Netlify
Blobs.

1. Push this project to GitHub.
2. In Netlify, choose **Add new project** and import `YomMunyra/SBYNHAMHUB`.
3. Leave the build command empty and use `public` as the publish directory.
4. In **Project configuration → Environment variables**, add a strong
   `ADMIN_PASSWORD` value. The default local password is deliberately not used on Netlify.
5. Deploy. Future GitHub pushes will publish automatically.

You can also deploy from a terminal after signing in: `npx netlify-cli deploy --prod`.

| Page | URL |
|---|---|
| Home | http://localhost:3000/ |
| Menu | http://localhost:3000/menu |
| Book a table | http://localhost:3000/book |
| Admin dashboard | http://localhost:3000/admin |

## Admin dashboard

The dashboard is where staff manage incoming reservations (confirm, mark arrived,
cancel, no-show, delete) and see daily stats.

- Sign in with the password below (or set `ADMIN_PASSWORD` when starting the server).

```bash
ADMIN_PASSWORD=your-secret npm start
```

Default admin password: `sbynham2026`

## API

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/menu?category=&featured=` | — | Menu items |
| GET | `/api/categories` | — | Menu categories |
| POST | `/api/reservations` | — | Create a reservation |
| GET | `/api/reservations?date=` | Bearer token | List reservations |
| PATCH | `/api/reservations/:id` | Bearer token | Update status |
| DELETE | `/api/reservations/:id` | Bearer token | Delete a reservation |
| GET | `/api/stats` | Bearer token | Booking stats |
| POST | `/api/auth` | — | Exchange password for token |

## Data

SQLite database lives at `data/sbynhamhub.db` (auto-created on first run and seeded
with the full menu). Delete the file and run `npm run seed` to reseed.

## Design system

All tokens come from the NyamHub Branding Guidelines: Fredoka type, `#FF611F` brand
orange, `#3A1604` dark brown, cream `#FBFAF6` paper, pill buttons, hairline cards,
and the "Taste · Book · Enjoy" tagline.
