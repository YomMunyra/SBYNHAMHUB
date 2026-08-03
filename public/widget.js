/* SbyNhamHub Embed Widget — standalone booking widget.
 * Load on any page with:
 *   <div id="sby-widget"></div>
 *   <script src="https://your-domain/widget.js" data-target="#sby-widget" defer></script>
 * Options (data-* attributes or SbyWidget.render({...})):
 *   data-target   container selector to render into            (default #sby-widget)
 *   data-brand    brand accent colour                          (default #FF611F)
 *   data-title    widget heading                               (default "Book a table at SbyNhamHub")
 *   data-subtitle widget sub-heading                           (default "Reserve in seconds")
 *   data-promo    show the promo-code field                    ("true"/"false", default true)
 *   data-points   show the Nyam Points redeemer                ("true"/"false", default false)
 *   data-api      override the API base URL                    (default: same origin as this script)
 */
(function () {
  'use strict';

  var SCRIPT = (function () {
    try {
      return document.currentScript || document.querySelector('script[src*="widget.js"]');
    } catch (e) {
      return null;
    }
  })();

  var SCRIPT_ORIGIN = (function () {
    try {
      if (SCRIPT && SCRIPT.src) return new URL('/api', SCRIPT.src).origin;
    } catch (e) { /* ignore */ }
    return window.location.origin;
  })();

  function attr(name, fallback) {
    try {
      var v = SCRIPT && SCRIPT.getAttribute ? SCRIPT.getAttribute(name) : null;
      return v === null || v === '' ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function readCfg() {
    return {
      target: attr('data-target', '#sby-widget'),
      brand: attr('data-brand', '#FF611F'),
      title: attr('data-title', 'Book a table at SbyNhamHub'),
      subtitle: attr('data-subtitle', 'Reserve in seconds — we\u2019ll hold your table.'),
      promo: attr('data-promo', 'true') !== 'false',
      points: attr('data-points', 'false') === 'true',
      api: attr('data-api', '') || SCRIPT_ORIGIN + '/api'
    };
  }

  var CSS = [
    '#sby-widget,.sby-widget{--sby-brand:#FF611F;--sby-brand-soft:#FFE5D6;--sby-dark:#221507;--sby-ink:#4A3826;--sby-line:#EADDCB;--sby-cream:#FFF9F2;box-sizing:border-box;font-family:Poppins,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--sby-dark)}',
    '.sby-widget *,.sby-widget *::before,.sby-widget *::after{box-sizing:border-box}',
    '.sby-widget{max-width:420px;margin:0 auto;background:var(--sby-cream);border:1px solid var(--sby-line);border-radius:18px;padding:20px;box-shadow:0 10px 30px rgba(34,21,7,.08)}',
    '.sby-widget__head{display:flex;align-items:center;gap:10px;margin-bottom:4px}',
    '.sby-widget__logo{width:34px;height:34px;border-radius:10px;background:var(--sby-brand);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex:none}',
    '.sby-widget__title{margin:0;font-size:18px;font-weight:700;color:var(--sby-dark)}',
    '.sby-widget__sub{margin:0 0 14px;font-size:13px;color:var(--sby-ink);line-height:1.4}',
    '.sby-widget__grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '.sby-widget__field{display:flex;flex-direction:column;gap:5px;margin-bottom:10px}',
    '.sby-widget__field--full{grid-column:1/-1}',
    '.sby-widget label{font-size:12.5px;font-weight:600;color:var(--sby-dark)}',
    '.sby-widget input,.sby-widget select,.sby-widget textarea{width:100%;padding:10px 12px;border:1px solid var(--sby-line);border-radius:10px;background:#fff;font:inherit;font-size:14px;color:var(--sby-dark)}',
    '.sby-widget input:focus,.sby-widget select:focus{outline:2px solid var(--sby-brand-soft);border-color:var(--sby-brand)}',
    '.sby-widget__toggle{width:100%;background:none;border:0;cursor:pointer;color:var(--sby-brand);font-weight:600;font-size:13px;padding:4px 0;text-align:left;display:flex;align-items:center;gap:6px}',
    '.sby-widget__panel{display:none;margin:6px 0 12px;padding:12px;background:#fff;border:1px dashed var(--sby-line);border-radius:12px}',
    '.sby-widget__panel--open{display:block}',
    '.sby-widget__hint{font-size:12px;color:var(--sby-ink);margin:6px 0 0}',
    '.sby-widget__balance{font-size:13px;font-weight:600;color:var(--sby-dark);margin:8px 0 4px}',
    '.sby-widget__note{font-size:12px;color:var(--sby-ink);line-height:1.45;margin-top:8px}',
    '.sby-widget__btn{width:100%;margin-top:4px;padding:13px;border:0;border-radius:12px;background:var(--sby-brand);color:#fff;font:inherit;font-weight:700;font-size:15px;cursor:pointer;transition:filter .15s ease}',
    '.sby-widget__btn:hover{filter:brightness(1.06)}',
    '.sby-widget__btn:disabled{opacity:.6;cursor:wait}',
    '.sby-widget__check{margin-top:8px;width:100%;padding:8px;border:1px solid var(--sby-line);border-radius:10px;background:var(--sby-cream);color:var(--sby-dark);font:inherit;font-size:13px;font-weight:600;cursor:pointer}',
    '.sby-widget__msg{margin-top:10px;padding:10px 12px;border-radius:10px;font-size:13px;line-height:1.45;display:none}',
    '.sby-widget__msg--ok{display:block;background:#E7F6EA;color:#1E6B34;border:1px solid #C9E9D1}',
    '.sby-widget__msg--err{display:block;background:#FCEBE7;color:#A33220;border:1px solid #F5CDA8}',
    '.sby-widget__done{text-align:center;padding:12px 4px}',
    '.sby-widget__done-icon{width:54px;height:54px;margin:0 auto 10px;border-radius:50%;background:var(--sby-brand-soft);color:var(--sby-brand);display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700}',
    '.sby-widget__done h3{margin:0 0 6px;font-size:17px}',
    '.sby-widget__done p{margin:4px 0;font-size:13.5px;color:var(--sby-ink);line-height:1.5}',
    '.sby-widget__ref{display:inline-block;margin-top:6px;padding:6px 12px;background:var(--sby-dark);color:#fff;border-radius:8px;font-size:14px;font-weight:700}',
    '.sby-widget__again{margin-top:14px;padding:10px 18px;border:1px solid var(--sby-brand);border-radius:10px;background:#fff;color:var(--sby-brand);font:inherit;font-size:13px;font-weight:700;cursor:pointer}',
    '@media(max-width:480px){.sby-widget__grid{grid-template-columns:1fr}}'
  ].join('');

  function injectCss() {
    if (document.getElementById('sby-widget-css')) return;
    var style = document.createElement('style');
    style.id = 'sby-widget-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var TIME_SLOTS = ['11:00', '11:30', '12:00', '12:30', '13:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00'];
  var MAX_GUESTS = 12;

  function todayStr() {
    var d = new Date();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function slots() {
    var now = new Date();
    var today = todayStr();
    var isToday = todayStr() === today;
    var cutoff = now.getHours() * 60 + now.getMinutes() + 30;
    return TIME_SLOTS.map(function (t) {
      if (!isToday) return t;
      var parts = t.split(':');
      var mins = Number(parts[0]) * 60 + Number(parts[1]);
      return mins >= cutoff ? t : null;
    }).filter(Boolean);
  }

  function guests() {
    var out = [];
    for (var i = 1; i <= MAX_GUESTS; i++) {
      out.push(i === MAX_GUESTS
        ? { value: i, label: i + '+ (large party)' }
        : { value: i, label: i + (i === 1 ? ' guest' : ' guests') });
    }
    return out;
  }

  function formHtml(cfg) {
    var timeOpts = slots().map(function (t) {
      return '<option value="' + t + '">' + t + '</option>';
    }).join('');
    var guestOpts = guests().map(function (g) {
      return '<option value="' + g.value + (g.value === 2 ? '" selected' : '"') + '>' + g.label + '</option>';
    }).join('');
    var promoHtml = '';
    if (cfg.promo) {
      promoHtml = [
        '<button type="button" class="sby-widget__toggle" data-toggle="promo">',
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/><path d="M7.5 9.5h.01M7.5 14.5h.01M16.5 9.5h.01M16.5 14.5h.01"/></svg>',
        'Have a promo code?</button>',
        '<div class="sby-widget__panel" data-panel="promo">',
        '<div class="sby-widget__field sby-widget__field--full">',
        '<label for="sby-promo">Promo code</label>',
        '<input id="sby-promo" name="promo" placeholder="e.g. LUNCH20" autocomplete="off" style="text-transform:uppercase">',
        '<p class="sby-widget__hint">Enter an offer code — we\u2019ll apply it when you book.</p>',
        '</div></div>'
      ].join('');
    }
    var pointsHtml = '';
    if (cfg.points) {
      pointsHtml = [
        '<button type="button" class="sby-widget__toggle" data-toggle="points">',
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
        'Use Nyam Points</button>',
        '<div class="sby-widget__panel" data-panel="points">',
        '<p class="sby-widget__hint" style="margin-top:0">Redeem points against tonight\u2019s bill. 100 pts = $0.50 off.</p>',
        '<div class="sby-widget__grid">',
        '<div class="sby-widget__field"><label for="sby-pts-email">Email</label><input id="sby-pts-email" type="email" placeholder="you@email.com"></div>',
        '<div class="sby-widget__field"><label for="sby-pts-phone">Phone</label><input id="sby-pts-phone" placeholder="Phone (to verify)"></div>',
        '</div>',
        '<button type="button" class="sby-widget__check" data-action="check-points">Check my points</button>',
        '<div class="sby-widget__balance" data-pts-balance></div>',
        '<div class="sby-widget__field sby-widget__field--full" data-pts-redeem style="display:none">',
        '<label for="sby-pts-amount">Redeem</label>',
        '<select id="sby-pts-amount" data-pts-amount></select>',
        '</div>',
        '</div>'
      ].join('');
    }
    return [
      '<div class="sby-widget" style="--sby-brand:' + esc(cfg.brand) + '">',
      '<div class="sby-widget__head">',
      '<div class="sby-widget__logo">S</div>',
      '<div><h3 class="sby-widget__title">' + esc(cfg.title) + '</h3></div>',
      '</div>',
      '<p class="sby-widget__sub">' + esc(cfg.subtitle) + '</p>',
      '<div class="sby-widget__grid">',
      '<div class="sby-widget__field"><label for="sby-date">Date *</label><input id="sby-date" name="date" type="date" min="' + todayStr() + '" required></div>',
      '<div class="sby-widget__field"><label for="sby-time">Time *</label><select id="sby-time" name="time" required>' + timeOpts + '</select></div>',
      '<div class="sby-widget__field"><label for="sby-guests">Guests *</label><select id="sby-guests" name="guests" required>' + guestOpts + '</select></div>',
      '<div class="sby-widget__field"><label for="sby-occasion">Occasion</label><select id="sby-occasion" name="occasion"><option value="">Just dinner</option><option>Birthday</option><option>Anniversary</option><option>Date Night</option><option>Business</option><option>Family Gathering</option><option>Other</option></select></div>',
      '</div>',
      '<div class="sby-widget__grid">',
      '<div class="sby-widget__field"><label for="sby-name">Your name *</label><input id="sby-name" name="name" required autocomplete="name"></div>',
      '<div class="sby-widget__field"><label for="sby-phone">Phone *</label><input id="sby-phone" name="phone" required autocomplete="tel"></div>',
      '</div>',
      '<div class="sby-widget__field sby-widget__field--full"><label for="sby-email">Email</label><input id="sby-email" name="email" type="email" autocomplete="email" placeholder="For booking updates and Nyam Points"></div>',
      promoHtml,
      pointsHtml,
      '<button type="submit" class="sby-widget__btn" data-action="submit">Request booking</button>',
      '<div class="sby-widget__msg" data-msg></div>',
      '</div>'
    ].join('');
  }

  function doneHtml(cfg, r) {
    var savings = [];
    if (r.promo_name) savings.push(r.promo_name);
    if (Number(r.points_redeemed) > 0) savings.push(Number(r.points_redeemed) + ' Nyam Points');
    var savingsHtml = savings.length
      ? '<p>Applied: <b>' + esc(savings.join(' + ')) + (Number(r.discount) > 0 ? ' \u2014 $' + Number(r.discount).toFixed(2) + ' off' : '') + '</b></p>'
      : '';
    return [
      '<div class="sby-widget sby-widget__done" style="--sby-brand:' + esc(cfg.brand) + '">',
      '<div class="sby-widget__done-icon">\u2713</div>',
      '<h3>Booking requested!</h3>',
      '<p>Thanks ' + esc(r.name) + ' \u2014 we\u2019ve got your table for ' + esc(String(r.guests)) + (Number(r.guests) === 1 ? ' guest' : ' guests') + ' on ' + esc(r.date) + ' at ' + esc(r.time) + '.</p>',
      savingsHtml,
      '<p>Your booking reference:</p>',
      '<span class="sby-widget__ref">#' + esc(r.id) + '</span>',
      '<p class="sby-widget__note">We\u2019ll confirm by phone. You can also manage this booking any time on the SbyNhamHub site.</p>',
      '<button type="button" class="sby-widget__again" data-action="again">Make another booking</button>',
      '</div>'
    ].join('');
  }

  function wire(cfg, root, api) {
    var submit = root.querySelector('[data-action="submit"]');
    var msg = root.querySelector('[data-msg]');
    var panel = null;

    function showMsg(kind, text) {
      msg.className = 'sby-widget__msg sby-widget__msg--' + kind;
      msg.textContent = text;
    }

    function clearMsg() {
      msg.className = 'sby-widget__msg';
      msg.textContent = '';
    }

    function toggle(name) {
      var b = root.querySelector('[data-toggle="' + name + '"]');
      var p = root.querySelector('[data-panel="' + name + '"]');
      if (!b || !p) return;
      var open = p.classList.toggle('sby-widget__panel--open');
      var ico = b.querySelector('svg');
      if (ico) ico.style.transform = open ? 'rotate(180deg)' : '';
    }
    if (cfg.promo) root.querySelector('[data-toggle="promo"]').addEventListener('click', function () { toggle('promo'); });
    if (cfg.points) root.querySelector('[data-toggle="points"]').addEventListener('click', function () { toggle('points'); });

    if (cfg.points) {
      var checkBtn = root.querySelector('[data-action="check-points"]');
      var balanceEl = root.querySelector('[data-pts-balance]');
      var redeemRow = root.querySelector('[data-pts-redeem]');
      var amountSel = root.querySelector('[data-pts-amount]');
      checkBtn.addEventListener('click', async function () {
        var email = root.querySelector('#sby-pts-email').value.trim();
        var phone = root.querySelector('#sby-pts-phone').value.trim();
        if (!email) { balanceEl.textContent = 'Enter your email to check points.'; return; }
        checkBtn.disabled = true;
        checkBtn.textContent = 'Checking\u2026';
        try {
          var res = await fetch(api + '/points/lookup?email=' + encodeURIComponent(email) + '&phone=' + encodeURIComponent(phone));
          var data = await res.json();
          var bal = Number(data.balance) || 0;
          if (bal < 100) {
            balanceEl.textContent = 'No redeemable points for that email yet.';
            redeemRow.style.display = 'none';
          } else {
            balanceEl.textContent = 'Available: ' + bal + ' pts (' + (bal / 100 * 0.5).toFixed(2) + ' value)';
            var opts = ['<option value="0">0 \u2014 don\u2019t redeem</option>'];
            for (var p = 100; p <= bal; p += 100) opts.push('<option value="' + p + '">' + p + ' pts \u2014 $' + (p / 100 * 0.5).toFixed(2) + ' off</option>');
            amountSel.innerHTML = opts.join('');
            redeemRow.style.display = '';
          }
        } catch (e) {
          balanceEl.textContent = 'Could not check points. Try again.';
        }
        checkBtn.disabled = false;
        checkBtn.textContent = 'Check my points';
      });
    }

    submit.addEventListener('click', async function (e) {
      e.preventDefault();
      if (submit.disabled) return;
      clearMsg();
      var payload = {
        name: root.querySelector('#sby-name').value.trim(),
        phone: root.querySelector('#sby-phone').value.trim(),
        email: root.querySelector('#sby-email').value.trim(),
        date: root.querySelector('#sby-date').value,
        time: root.querySelector('#sby-time').value,
        guests: Number(root.querySelector('#sby-guests').value),
        occasion: root.querySelector('#sby-occasion').value
      };
      if (!payload.name) return showMsg('err', 'Please tell us your name.');
      if (!payload.phone) return showMsg('err', 'Please add a phone number so we can confirm.');
      if (!payload.date) return showMsg('err', 'Please choose a date.');
      if (cfg.promo) {
        var code = root.querySelector('#sby-promo').value.trim();
        if (code) payload.promo_code = code;
      }
      if (cfg.points && amountSel) {
        var rp = Number(amountSel.value || 0);
        if (rp > 0) {
          if (!payload.email) return showMsg('err', 'Add your email to redeem Nyam Points.');
          payload.redeem_points = rp;
        }
      }
      submit.disabled = true;
      submit.textContent = 'Booking\u2026';
      try {
        var res = await fetch(api + '/reservations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Something went wrong.');
        root.innerHTML = doneHtml(cfg, data.reservation);
        root.querySelector('[data-action="again"]').addEventListener('click', function () {
          render(cfg, root);
        });
      } catch (err) {
        showMsg('err', err.message);
        submit.disabled = false;
        submit.textContent = 'Request booking';
      }
    });
  }

  function render(cfg, container) {
    container.innerHTML = formHtml(cfg);
    container.querySelector('.sby-widget').style.setProperty('--sby-brand', cfg.brand);
    wire(cfg, container.querySelector('.sby-widget'), cfg.api);
  }

  function auto() {
    var cfg = readCfg();
    var container = document.querySelector(cfg.target);
    if (!container) return;
    injectCss();
    render(cfg, container);
  }

  injectCss();
  if (window.SbyWidget && window.SbyWidget.render) {
    // already initialised once on this page
  } else {
    window.SbyWidget = {
      render: function (opts, container) {
        injectCss();
        var el = container || document.querySelector((opts && opts.target) || '#sby-widget');
        if (!el) return;
        var cfg = readCfg();
        if (opts) {
          if (opts.brand) cfg.brand = opts.brand;
          if (opts.title) cfg.title = opts.title;
          if (opts.subtitle) cfg.subtitle = opts.subtitle;
          if (opts.promo === true) cfg.promo = true;
          if (opts.promo === false) cfg.promo = false;
          if (opts.points === true) cfg.points = true;
          if (opts.points === false) cfg.points = false;
          if (opts.api) cfg.api = opts.api;
        }
        render(cfg, el);
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', auto);
    } else {
      auto();
    }
  }
})();
