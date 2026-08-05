'use strict';

// English-only site chrome and currency formatting. The previous Khmer bundle
// was removed because its translation text was corrupted.
(function () {
  const DICT = {
    'nav.home': 'Home', 'nav.discover': 'Discover', 'nav.menu': 'Menu', 'nav.reviews': 'Reviews', 'nav.book': 'Reservations', 'nav.pay': 'Pay', 'nav.points': 'Nyam Points', 'nav.taste': 'My taste',
    'portal.manager': 'Manager', 'portal.admin': 'Admin', 'profile.guest': 'Guest', 'profile.portals': 'Portals', 'profile.quick': 'Quick links', 'profile.discover': 'Discover & book', 'profile.book': 'Book a table', 'profile.manage': 'Manage my booking', 'profile.pay': 'Pay your bill', 'profile.points': 'Nyam Points', 'profile.taste': 'My taste & favourites', 'profile.reviews': 'Leave a review', 'profile.reminders': 'Booking reminders',
    'logo.tagline': 'Taste · Book · Enjoy', 'cta.book': 'Book a table', 'footer.explore': 'Explore', 'footer.hours': 'Hours', 'footer.contact': 'Contact', 'footer.home': 'Home', 'footer.discover': 'Discover', 'footer.menu': 'Menu', 'footer.reviews': 'Reviews', 'footer.points': 'Nyam Points', 'footer.book': 'Book a table', 'footer.pay': 'Pay your bill', 'footer.manage': 'Manage booking', 'footer.admin': 'Admin', 'footer.rights': 'All rights reserved.', 'footer.byline': 'Reservations reimagined.',
    'hero.index': 'Every meal out, as effortless as <span class="italic-accent">ordering in.</span>', 'hero.discover': 'Find your <span class="italic-accent">table.</span>', 'hero.menu': 'Eat <span class="italic-accent">better.</span>', 'hero.reviews': 'Verified <span class="italic-accent">reviews.</span>', 'hero.book': 'Book your <span class="italic-accent">table.</span>', 'hero.pay': 'Pay your bill, <span class="italic-accent">your way.</span>', 'hero.manage': 'Manage your <span class="italic-accent">table.</span>', 'hero.points': 'Your <span class="italic-accent">Nyam Points.</span>', 'hero.taste': 'Your taste, <span class="italic-accent">learned.</span>', 'hero.receipt': 'Your <span class="italic-accent">receipt.</span>',
    'menu.promo': 'Promoted', 'menu.chef': 'Chef’s picks', 'reviews.leave': 'Leave a review', 'points.title': 'Nyam Points'
  };
  const locale = { language: 'en', currency: 'USD', currency_rate: 4100 };
  let readyPromise = null;
  const lang = () => 'en';
  const t = (key) => DICT[key] || key;
  function persist() { try { localStorage.removeItem('sby_lang'); localStorage.setItem('sby_locale', JSON.stringify({ ...locale, ts: Date.now() })); } catch (e) { /* ignore */ } }
  function applyTranslations(root) {
    (root || document).querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.getAttribute('data-i18n-html')); });
    (root || document).querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')); });
    (root || document).querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.getAttribute('data-i18n-ph')); });
    document.querySelectorAll('.logo-tag').forEach((el) => { el.textContent = t('logo.tagline'); }); document.documentElement.lang = 'en';
  }
  function translateChrome() {
    const maps = [['.nav-links a', { '/': 'nav.home', '/discover': 'nav.discover', '/menu': 'nav.menu', '/reviews': 'nav.reviews', '/book': 'nav.book', '/pay': 'nav.pay', '/points': 'nav.points', '/taste': 'nav.taste' }], ['.nav-portal a', { '/manager': 'portal.manager', '/admin': 'portal.admin' }], ['.profile-link', { '/discover': 'profile.discover', '/book': 'profile.book', '/manage': 'profile.manage', '/pay': 'profile.pay', '/points': 'profile.points', '/taste': 'profile.taste', '/reviews': 'profile.reviews' }], ['.footer-grid a', { '/': 'footer.home', '/discover': 'footer.discover', '/menu': 'footer.menu', '/reviews': 'footer.reviews', '/points': 'footer.points', '/book': 'footer.book', '/pay': 'footer.pay', '/manage': 'footer.manage', '/admin': 'footer.admin' }]];
    maps.forEach(([selector, map]) => document.querySelectorAll(selector).forEach((el) => { const key = map[el.getAttribute('href')]; if (key) el.textContent = t(key); }));
    const bookBtn = document.querySelector('.nav-cta .btn-primary'); if (bookBtn) bookBtn.textContent = t('cta.book');
    const guest = document.querySelector('.profile-head strong'); if (guest) guest.textContent = t('profile.guest');
    document.querySelectorAll('.footer-grid h4').forEach((el) => { const key = { Explore: 'footer.explore', Hours: 'footer.hours', Contact: 'footer.contact' }[el.textContent.trim()]; if (key) el.textContent = t(key); });
    applyTranslations();
  }
  async function refreshLocale() { try { const res = await fetch('/api/settings'); if (res.ok) { const s = await res.json(); locale.currency = s.currency || 'USD'; locale.currency_rate = Number(s.currency_rate) > 0 ? Number(s.currency_rate) : 4100; } } catch (e) { /* keep defaults */ } locale.language = 'en'; persist(); apply(); }
  function apply() { translateChrome(); document.dispatchEvent(new CustomEvent('localechange', { detail: { locale: { ...locale } } })); }
  window.SbyI18n = { t, lang, getLocale: () => ({ ...locale }), setLang: () => apply(), money: (value) => { const v = Number(value) || 0; return locale.currency === 'KHR' ? '\u17DB' + (Math.round(v * locale.currency_rate / 100) * 100).toLocaleString('en-US') : '$' + v.toFixed(2); }, onReady: (cb) => { readyPromise ? readyPromise.then(cb) : (readyPromise = refreshLocale().then(cb)); } };
  window.money = window.SbyI18n.money;
  const renderHeader = window.renderHeader; window.renderHeader = function (active) { renderHeader && renderHeader(active); translateChrome(); };
  const renderFooter = window.renderFooter; window.renderFooter = function () { renderFooter && renderFooter(); translateChrome(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refreshLocale); else refreshLocale();
})();
