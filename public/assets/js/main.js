'use strict';

const LOGO_MARK = `
<svg class="logo-mark-svg" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M6 3v8a3 3 0 0 0 3 3v7M9 3v6M12 3v6" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
  <path d="M17 3c-1.5 1-2.5 3-2.5 5.5S15.5 13 17 14v7" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
</svg>`;

const LOGO = `
<div class="logo-mark">${LOGO_MARK}</div>
<div class="logo-text">
  <div class="logo-word">SbyNham<span class="hub">Hub</span></div>
  <div class="logo-tag">Taste · Book · Enjoy</div>
</div>`;

function renderHeader(active) {
  const links = [
    ['/', 'Home'],
    ['/discover', 'Discover'],
    ['/menu', 'Menu'],
    ['/reviews', 'Reviews'],
    ['/book', 'Reservations'],
    ['/pay', 'Pay'],
    ['/points', 'Nyam Points'],
    ['/taste', 'My taste']
  ];
  const portal = [
    ['/manager', 'Manager'],
    ['/admin', 'Admin']
  ];
  const profileLinks = [
    ['/discover', 'Discover & book'],
    ['/book', 'Book a table'],
    ['/manage', 'Manage my booking'],
    ['/pay', 'Pay your bill'],
    ['/points', 'Nyam Points'],
    ['/taste', 'My taste & favourites'],
    ['/reviews', 'Leave a review']
  ];
  const nav = document.getElementById('nav');
  if (!nav) return;
  nav.innerHTML = `
  <div class="nav-inner container">
    <a class="logo" href="/" aria-label="SbyNhamHub home">${LOGO}</a>
    <button class="burger" id="burger" aria-label="Toggle menu">
      <span></span><span></span><span></span>
    </button>
    <ul class="nav-links" id="navLinks">
      ${links.map(([href, label]) =>
        `<li><a href="${href}" class="${href === active ? 'active' : ''}">${label}</a></li>`
      ).join('')}
    </ul>
    <div class="nav-cta">
      <a class="btn btn-primary btn-sm" href="/book">Book a table</a>
      <div class="nav-profile" id="profile">
        <button class="profile-btn" id="profileBtn" aria-label="Open menu" aria-expanded="false">
          <span class="profile-avatar">S</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <div class="profile-menu" id="profileMenu">
          <div class="profile-head">
            <span class="profile-avatar">S</span>
            <div><strong>Guest</strong><small>SbyNhamHub</small></div>
          </div>
          <p class="profile-label">Portals</p>
          <div class="nav-portal">
            ${portal.map(([href, label]) =>
              `<a href="${href}" class="${href === active ? 'active' : ''}">${label}</a>`
            ).join('')}
          </div>
          <p class="profile-label">Quick links</p>
          ${profileLinks.map(([href, label]) =>
            `<a class="profile-link" href="${href}">${label}</a>`
          ).join('')}
        </div>
      </div>
    </div>
  </div>`;
  const burger = document.getElementById('burger');
  const navLinks = document.getElementById('navLinks');
  burger.addEventListener('click', () => {
    navLinks.classList.toggle('open');
    burger.classList.toggle('open');
  });
  const profile = document.getElementById('profile');
  const profileBtn = document.getElementById('profileBtn');
  const profileMenu = document.getElementById('profileMenu');
  function toggleProfile(open) {
    profileMenu.classList.toggle('open', open);
    profileBtn.setAttribute('aria-expanded', String(open));
  }
  profileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleProfile(!profileMenu.classList.contains('open'));
  });
  document.addEventListener('click', (e) => {
    if (!profile.contains(e.target)) toggleProfile(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') toggleProfile(false);
  });
}

function renderFooter() {
  const el = document.getElementById('footer');
  if (!el) return;
  const year = new Date().getFullYear();
  el.innerHTML = `
  <div class="container">
    <div class="footer-grid">
      <div>
        <a class="logo on-dark" href="/" aria-label="SbyNhamHub home">${LOGO}</a>
        <p style="margin-top:18px;color:rgba(255,255,255,0.72);font-size:14.5px;max-width:280px;">
          A next-generation restaurant bringing the flavours of Southeast Asia to your table.
          Discover. Book. Enjoy.
        </p>
      </div>
      <div>
        <h4>Explore</h4>
        <ul>
          <li><a href="/">Home</a></li>
          <li><a href="/discover">Discover</a></li>
          <li><a href="/menu">Menu</a></li>
          <li><a href="/reviews">Reviews</a></li>
          <li><a href="/points">Nyam Points</a></li>
          <li><a href="/book">Book a table</a></li>
          <li><a href="/pay">Pay your bill</a></li>
          <li><a href="/manage">Manage booking</a></li>
          <li><a href="/admin">Admin</a></li>
        </ul>
      </div>
      <div>
        <h4>Hours</h4>
        <ul>
          <li>Mon – Thu · 11:00 – 22:00</li>
          <li>Fri – Sat · 11:00 – 23:00</li>
          <li>Sunday · 11:00 – 21:00</li>
          <li><a href="/book">Reserve anytime, 24/7</a></li>
        </ul>
      </div>
      <div>
        <h4>Contact</h4>
        <ul>
          <li>123 Riverside Walk, Phnom Penh</li>
          <li>+855 12 345 678</li>
          <li>hello@sbynhamhub.com</li>
          <li class="footnote">Taste · Book · Enjoy</li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© ${year} SbyNhamHub. All rights reserved.</span>
      <span>Reservations reimagined.</span>
    </div>
  </div>`;
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

let toastTimer;
function toast(message, type = 'success') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
  }, 3200);
}

function money(value) {
  return '$' + Number(value).toFixed(2);
}

function escapeHTML(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stars(rating) {
  const full = Math.round(rating);
  return '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full);
}

function guestIdentity() {
  try {
    return JSON.parse(localStorage.getItem('sby_guest') || '{}');
  } catch {
    return {};
  }
}

function setGuestIdentity(identity) {
  localStorage.setItem('sby_guest', JSON.stringify({ ...guestIdentity(), ...identity }));
}

function guestIdentityParam() {
  const identity = guestIdentity();
  const params = new URLSearchParams();
  if (identity.email) params.set('email', identity.email);
  if (identity.phone) params.set('phone', identity.phone);
  return params;
}

async function ensureGuestIdentity() {
  const identity = guestIdentity();
  if (identity.email || identity.phone) return identity;
  const email = window.prompt('Enter your email so we can learn your taste and remember your favourites:');
  if (!email || !String(email).trim()) return null;
  const phone = window.prompt('And the phone number you book with (so we can match your visits):') || '';
  setGuestIdentity({ email: String(email).trim(), phone: String(phone).trim() });
  return guestIdentity();
}

document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;
  renderHeader(page);
  renderFooter();
});
