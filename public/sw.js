// Service worker: makes the app open instantly. The app's own files (the
// shell, its modules, styles, vendor libraries, icons) are kept on the device
// and served from there at once, while a fresh copy is fetched in the
// background (stale-while-revalidate), so a sleeping server never delays the
// start. Financial data is NOT cached here: the API and Supabase are never
// intercepted. When a new version of the app arrives, open pages are told so
// they can offer a refresh.
const CACHE = 'budget-app-v60';
const PRECACHE = ['/app/', '/manifest.json', '/wallet.svg', '/wallet-192.png', '/wallet-512.png', '/badge-96.png'];
const STATIC = /^\/(app\/(src|styles|vendor)\/|(icon|wallet|shortcut|badge)[\w-]*\.(svg|png)$|manifest\.json$)/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

async function tellPages(msg) {
  for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage(msg);
}

// Serve from the device if we have it; refresh the stored copy either way.
async function staleWhileRevalidate(request, cacheKey, { notifyOnChange = false } = {}) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(cacheKey);
  const fresh = fetch(request).then(async (res) => {
    if (res && res.ok && res.type === 'basic') {
      if (notifyOnChange && cached) {
        const [a, b] = await Promise.all([cached.clone().text(), res.clone().text()]);
        if (a !== b) tellPages({ type: 'app-updated' });
      }
      await cache.put(cacheKey, res.clone());
    }
    return res;
  }).catch(() => null);
  if (cached) { fresh.catch(() => {}); return cached; }
  return (await fresh) || new Response('', { status: 504 });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, fonts: straight to the network
  if (req.mode === 'navigate') {
    // Every page of the new app is the same shell (hash routes).
    if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
      // Arriving from a sign-in or invite link carries parameters: go to the
      // network. A home-screen shortcut (?action=…) opens the app's shell.
      if (url.search && !/^\?action=[a-z]+$/.test(url.search)) return;
      e.respondWith(staleWhileRevalidate(req, '/app/', { notifyOnChange: true }));
      return;
    }
    e.respondWith(fetch(req).catch(() => caches.match('/app/')));
    return;
  }
  if (STATIC.test(url.pathname)) e.respondWith(staleWhileRevalidate(req, url.pathname));
});

self.addEventListener('push', (e) => {
  let data = { title: 'ניהול תקציב', body: '', url: '/' };
  try { if (e.data) data = { ...data, ...e.data.json() }; } catch (_) {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      // icon: the app's logo beside the text. badge: the small icon in the
      // status bar, which Android paints from its alpha channel only (a
      // full-color icon there shows as a white square).
      icon: '/wallet-192.png',
      badge: '/badge-96.png',
      lang: 'he',
      dir: 'rtl',
      data: { url: openUrl(data.url) }
    })
  );
});

// A notification's link, inside the app: old links (the previous app's
// "?tab=") and anything off this site open the new app's home.
function openUrl(url) {
  try {
    const u = new URL(url || '/app/', self.location.origin);
    if (u.origin !== self.location.origin || !u.pathname.startsWith('/app')) return '/app/#/home';
    return u.pathname + u.search + u.hash;
  } catch (_e) { return '/app/#/home'; }
}

// A tap opens the app on the notification's screen: an open window goes
// there (and comes to the front); otherwise a new one opens there.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = openUrl(e.notification.data && e.notification.data.url);
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
      const win = list.find((c) => new URL(c.url).pathname.startsWith('/app')) || list[0];
      if (!win) return self.clients.openWindow(url);
      await win.focus().catch(() => {});
      // The page moves itself (works where navigate() does not, like iOS).
      win.postMessage({ type: 'open', url });
      return win;
    })
  );
});
