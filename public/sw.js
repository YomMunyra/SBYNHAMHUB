'use strict';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = { title: 'SbyNhamHub', body: 'You have a new update from SbyNhamHub.', tag: 'sbynhamhub' };
  try {
    if (event.data) data = event.data.json();
  } catch { /* keep defaults */ }
  const options = {
    body: data.body || 'You have a new update from SbyNhamHub.',
    icon: '/assets/img/logo.svg',
    badge: '/assets/img/logo.svg',
    data: { url: data.url || '/book' },
    vibrate: [120, 60, 120]
  };
  event.waitUntil(self.registration.showNotification(data.title || 'SbyNhamHub', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/book';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(location.origin) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
