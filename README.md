# SbyNhamHub — Taste · Book · Enjoy

A full-stack restaurant website built from the **NyamHub** Figma Make design
(branding, palette, content and booking narrative) for the restaurant **SbyNhamHub**.

## Stack

- **Backend:** Node.js + Express (`server/`)
- **Database:** SQLite via the built-in `node:sqlite` module (`data/sbynhamhub.db`, no native compile)
- **Frontend:** Vanilla HTML/CSS/JS, single shared design system (`public/assets/css/style.css`)
- **Deploy:** Netlify serverless API mirror (`netlify/functions/api.js`) with persistent Netlify Blobs storage

There are **two backends** that must stay in sync: the local Express server (source
of truth, reads `data/sbynhamhub.db`) and the Netlify functions mirror (blob
storage). When you change an endpoint or menu seed in `server/`, mirror it in
`netlify/functions/`.

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

## Pages

| Page | URL | What it does |
|---|---|---|
| Home | `/` | Hero, personalised feed (after 5 visits), menu highlights, hours |
| Discover | `/discover` | Restaurant search: cuisine/price/rating filters, live table availability |
| Menu | `/menu` | Full menu with real dish photos, favourites hearts |
| Book a table | `/book` | Booking flow with promo codes and Nyam Points |
| Reviews | `/reviews` | Read & submit reviews |
| Nyam Points | `/points` | Points balance, expiring-soon, redemption history |
| My taste | `/taste` | Your AI-learned taste profile, correct/remove recommendations, reset |
| Manage booking | `/manage` | Look up, cancel or modify a booking |
| Pay your bill | `/pay` | NyamPay checkout (tip, split, mock card) |
| Receipt | `/receipt` | Printable payment receipt |
| Manager dashboard | `/manager` | Restaurant workspace |
| Admin dashboard | `/admin` | Manager workspace + platform overview |
| Embed widget | `/widget.js` | One-line bookable widget for any site |

## Roles

Two staff roles with role-scoped login tokens:

| Role | Sign-in | Default password | Access |
|---|---|---|---|
| Manager | `/manager` | `sbynham2026` | Restaurant workspace: bookings, floor plan, guests, waitlist, menu, promotions, reviews, analytics, settings |
| Admin | `/admin` | `sbynham2026` | Everything a manager can do, plus the platform dashboard (`/api/admin/summary`) |

Set separate secrets with environment variables (the manager falls back to the admin
password when unset):

```bash
ADMIN_PASSWORD=admin-secret MANAGER_PASSWORD=manager-secret npm start
```

On Netlify, set `ADMIN_PASSWORD` (and optionally `MANAGER_PASSWORD`) in the project's
environment variables. Tokens are HMAC-signed and expire after 12 hours.

## Features

### Bookings & guest management
Guests book online with a reference (`#id`, shown in the confirmation email), and can
look up, cancel or modify their booking from `/manage`. Staff can create
**walk-in / phone / online** bookings from the manager desk, click any booking to see
the **guest card** (history, preferences, Nyam Points), and the reservation desk and
floor plan **auto-refresh every 30s**. Confirmed bookings earn Nyam Points.

### Restaurant Search & Discovery (F-01)
The `/discover` page lets guests filter by cuisine, price and rating, see live table
availability per slot, spot promoted listings, and read reviews — all served by
`GET /api/discover`.

### Reminders & self-service (F-02)
A shared `processReminders` scheduler (background timer + `POST /api/reminders`)
sends 24h and 2h reminders. Guests can cancel or modify a booking up to **1 hour**
before the slot; within the window it must be handled by staff.

### Review moderation & spam filtering (F-03)
Submitted reviews are auto-scanned for links, ALL-CAPS, repeated characters,
suspicious words and duplicate comments. Flagged reviews are held until a manager
approves (publishing clears the flag) or flags them for removal.

### Nyam Points (F-04)
Guests earn points on bookings and redeem them at checkout. Points are awarded in
batches that **expire 18 months after earning**, redemptions use **FIFO** against the
earliest batches, and the balance is recomputed with expiry on every lookup. The
points page shows expiring-soon and earliest-expiry dates.

### Promotions (F-06)
Managers create promo codes with discount type, date/slot windows and an **Auto-end**
toggle: when the booking slot reaches capacity the promo stops applying and
disappears from the offers feed.

### NyamPay (v1.2)
Guest checkout for a reservation bill — from `/pay`, customers enter their booking
reference, pick a tip, optionally split the bill 2–12 ways, and pay by mock card.
Receipts are emailed instantly and printable from `/receipt`.

- **Fees**: 0.95% + $0.50 per transaction (configurable under **Settings → Payments**). Computed in cents.
- **Payment reference**: `NYM-XXXXXXXX`; **demo cards**: any 13–19 digit number works, cards ending in `1111` are declined.
- **Refunds**: manager → **Payments** view can refund a payment (excluded from analytics once refunded).
- **Booking attach**: passing `reservation_id` marks the reservation paid, unlocking the NyamPay button in the guest booking manager.

### Embed widget (F-08)
Any external site can accept bookings with one line of code. The widget is served
from `/widget.js`, is fully self-contained, and posts straight to the reservation API
with CORS enabled.

```html
<div id="sby-widget"></div>
<script src="https://your-domain/widget.js" data-target="#sby-widget" data-title="Book a table at SbyNhamHub" data-brand="#FF611F" data-promo="true" data-points="false" defer></script>
```

Options are read from `data-*` attributes (or `SbyWidget.render({...})` for dynamic
pages): `data-target`, `data-title`, `data-subtitle`, `data-brand`, `data-promo`,
`data-points`, `data-api`. The manager dashboard (**Embed & share**) generates a
ready-to-paste snippet with live preview and one-click copy.

### AI personalisation (F-09)
A rule-based taste engine learns from a guest's bookings, reviews and saved dishes
and serves a **personalised home feed** that switches on after 5 visits. Hearts on
the menu save favourites; `/taste` shows the learned categories, lets the guest
correct or delete recommendations and reset their profile. Shared logic in
`server/lib/personalize.js` (and the Netlify mirror).

### Restaurant applications & approval queue (F-07)
New venues are created with `status = pending` and stay hidden until an admin
approves them. The admin dashboard shows a **Pending applications** queue with
one-click **Approve** (venue goes live) or **Reject** (venue deactivated). Statuses
are `pending | approved | rejected`; marketplace and restaurant detail endpoints
only ever return `approved` venues.

### Promoted listings (F-03)
Admins mark any venue as **Promoted** (`featured = 1`) from the restaurants view or
the new-restaurant form. Promoted venues sort to the top of the marketplace and are
tagged with a **Promoted** badge on `/discover` (`promoted: true` in the API
payload). Unpromote removes the boost at any time.

### Admin support mode — impersonation (F-05)
From the admin restaurants list, **Support** opens a session as that venue's
manager: `POST /api/auth/impersonate` returns a manager-scoped token
(`restaurant_id` embedded), so every manager action (settings, menu, tables,
bookings, stats) is automatically scoped to that venue. The manager dashboard shows
a **Support mode** banner and **Exit impersonation** returns to `/admin`.

### Localisation (i18n)
Venues carry a default `language` (`en` | `km`) and currency (`USD` | `KHR` with a
per-venue `currency_rate`, default 4100) — set in the manager/admin **Settings** or
on the restaurant form. `/api/settings` returns these and `PATCH` persists them
(scoped to the venue/token). The customer site ships a language switcher (EN / ខ្មែរ)
in the header; `money()` in `public/assets/js/i18n.js` formats prices as
`$12.34` (USD) or `៛50,000` (KHR, rounded to 100 riels) from the venue settings.
Translated chrome (nav, footer, hero headings) uses `data-i18n` attributes.

### Menu & photos
The menu is seeded with 25 dishes across 5 categories, each with a real food photo in
`public/assets/img/*.jpg` (4:3). The frontend renders `/assets/img/${d.image}`, so a
manager can change a dish's photo just by setting the image filename. The Netlify
mirror (`netlify/functions/menu-data.js`) is the static fallback and re-seeds the
blob store on first run.

## API

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | — | Health check |
| POST | `/api/auth` | — | Exchange password for role token |
| POST | `/api/auth/impersonate` | Bearer (admin) | Issue a manager token scoped to `restaurant_id` (support mode) |
| GET | `/api/categories` | — | Menu categories |
| GET | `/api/menu?category=&featured=` | — | Menu items |
| POST | `/api/categories` | Bearer | Create category |
| DELETE | `/api/categories/:id` | Bearer | Delete category |
| POST | `/api/menu` | Bearer | Add dish |
| PATCH | `/api/menu/:id` | Bearer | Update dish (incl. image) |
| DELETE | `/api/menu/:id` | Bearer | Delete dish |
| GET | `/api/discover` | — | Discovery feed with live availability |
| GET | `/api/marketplace` | — | Multi-venue marketplace (filter by `city`, `cuisine`, `max_price`, `min_rating`, `date`, `guests`, `occasion`); only `approved` venues, promoted first |
| GET | `/api/restaurants/:slug` | — | Restaurant detail (menu by category, promos, tables, availability) |
| GET | `/api/restaurants` | Bearer (admin) | List restaurants (incl. `active`, `status`, `featured`) |
| POST | `/api/restaurants` | Bearer (admin) | Create a restaurant (created as `status=pending`; accepts `language`, `currency`, `currency_rate`) |
| PATCH | `/api/restaurants/:id` | Bearer (admin) | Update a restaurant (activate/deactivate, `status` approve/reject, `featured` promote, locale fields) |
| DELETE | `/api/restaurants/:id` | Bearer (admin) | Deactivate a restaurant (id 1 is protected) |
| GET | `/api/reviews/summary` | — | Review aggregates |
| GET | `/api/reviews` | — | Published reviews |
| POST | `/api/reviews` | — | Submit review (spam-filtered) |
| PATCH | `/api/reviews/:id` | Bearer | Approve / flag / clear spam |
| GET | `/api/promos` | — | Promotions |
| GET | `/api/promos/offers` | — | Active offers feed |
| POST | `/api/promos` | Bearer | Create promo |
| PATCH | `/api/promos/:id` | Bearer | Update promo (incl. auto-end) |
| DELETE | `/api/promos/:id` | Bearer | Delete promo |
| GET | `/api/personalise` | — | Learned taste profile |
| GET | `/api/personalise/feed` | — | Personalised home feed |
| POST | `/api/personalise/correct` | — | Correct a recommendation |
| POST | `/api/personalise/reset` | — | Reset learned profile |
| GET | `/api/saves` | — | Saved dishes |
| POST | `/api/saves` | — | Save a dish |
| DELETE | `/api/saves` | — | Unsave a dish |
| GET | `/api/points/lookup` | — | Points balance & expiring-soon |
| GET | `/api/waitlist` | Bearer | Waitlist |
| POST | `/api/waitlist` | — | Join waitlist |
| PATCH | `/api/waitlist/:id` | Bearer | Seat / update |
| DELETE | `/api/waitlist/:id` | Bearer | Remove |
| GET | `/api/reservations?date=` | Bearer | List reservations |
| POST | `/api/reservations` | — | Create (online / walk-in / phone) |
| POST | `/api/reservations/lookup` | — | Look up a booking by reference |
| PATCH | `/api/reservations/:id` | Bearer | Confirm / arrive / no-show / cancel |
| POST | `/api/reservations/:id/cancel` | — | Guest cancel (1h window rules) |
| PATCH | `/api/reservations/:id/modify` | — | Guest modify |
| DELETE | `/api/reservations/:id` | Bearer | Delete a reservation |
| GET | `/api/stats` | Bearer | Booking stats |
| GET | `/api/analytics` | Bearer | Analytics dashboard |
| GET | `/api/guests` | Bearer | Guest list with history & points |
| PATCH | `/api/guests/:id` | Bearer | Update guest |
| POST | `/api/reminders` | Bearer | Run a reminder pass |
| GET | `/api/settings` | — | Venue settings, payment fees & locale (`language`, `currency`, `currency_rate`); honors a scoped token |
| PATCH | `/api/settings` | Bearer | Update venue settings (incl. locale fields) |
| GET | `/api/admin/summary` | Bearer (admin) | Platform summary |
| GET | `/api/admin/platform` | Bearer (admin) | Per-venue totals (reservations, covers, menu, tables) |
| GET | `/api/payments` | Bearer | Payment history |
| GET | `/api/payments/receipt/:ref` | — | Payment receipt |
| POST | `/api/payments/pay` | — | Charge a bill (tip, split, mock card) |
| POST | `/api/payments/:id/refund` | Bearer | Refund a payment |
| GET | `/api/yield/offer` | — | Auto-applied yield discount for a date/time/party |
| GET | `/api/yield/rules` | Bearer | List yield rules |
| POST | `/api/yield/rules` | Bearer | Create a yield rule |
| PATCH | `/api/yield/rules/:id` | Bearer | Update a yield rule |
| DELETE | `/api/yield/rules/:id` | Bearer | Delete a yield rule |
| GET | `/api/tables` | Bearer | Table layout (seats, zone, position) |
| POST | `/api/tables` | Bearer | Add a table |
| PATCH | `/api/tables/:id` | Bearer | Update a table (incl. drag position) |
| DELETE | `/api/tables/:id` | Bearer | Delete a table |
| GET | `/api/integrations` | Bearer | SMS/push/webhook config + device list |
| PATCH | `/api/integrations` | Bearer | Save integrations config |
| GET | `/api/push/vapid` | — | Public VAPID key for browser subscriptions |
| POST | `/api/push/subscribe` | — | Save a device push subscription |
| POST | `/api/push/test` | Bearer | Send a test push to all devices |
| POST | `/api/sms/test` | Bearer | Send a test SMS (via webhook URL) |
| POST | `/api/webhook/test` | Bearer | Fire a test webhook event |
| POST | `/api/webhook/fire` | Bearer | Re-fire a booking webhook event |

Multi-venue note: since Phase 5 every venue-scoped resource (menu, promos, yield
rules, tables, reservations, reviews, waitlist, guests, analytics, settings) accepts
`?restaurant=` or `?restaurant_id=` (slug or id) and defaults to venue 1 (SbyNhamHub,
Phnom Penh) — or to the venue embedded in a scoped manager token (impersonation).
Reservations carry `restaurant_id`; promo codes are unique per venue.

## Data

- **Local:** SQLite database at `data/sbynhamhub.db` (auto-created on first run and
  seeded with the full menu). Delete the file and run `npm run seed` to reseed.
- **Netlify:** reservations, reviews, points and payments live in Netlify Blobs; the
  static menu in `netlify/functions/menu-data.js` is copied into the blob store on
  first run.
- **Images:** dish photos live in `public/assets/img/` and are referenced by filename
  from the menu `image` field (also set per dish in the manager/admin Menu editor).

## Design system

All tokens come from the NyamHub Branding Guidelines: Fredoka type, `#FF611F` brand
orange, `#3A1604` dark brown, cream `#FBFAF6` paper, pill buttons, hairline cards,
and the "Taste · Book · Enjoy" tagline.
