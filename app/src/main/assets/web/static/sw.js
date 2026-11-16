/**
 * FileShare Service Worker
 * - Cache-first for static assets
 * - Network-first for API calls
 * - Shell caching for offline support
 */

const CACHE_NAME = 'fileshare-v1';
const SHELL_CACHE = 'fileshare-shell-v1';

// Static assets to cache on install (app shell)
const SHELL_ASSETS = [
  '/',
  '/static/manifest.json',
  '/static/sw.js',
];

// ─── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      console.log('[SW] Caching app shell');
      return cache.addAll(SHELL_ASSETS).catch((err) => {
        console.warn('[SW] Shell cache failed:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME && name !== SHELL_CACHE) {
            console.log('[SW] Removing old cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests entirely (POST, DELETE, etc.)
  if (event.request.method !== 'GET') return;

  // Skip non-http(s) schemes
  if (!url.protocol.startsWith('http')) return;

  // ── API calls: Network-first, no caching ──────────────────────────────────
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({ error: 'Offline — API not available' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // ── Static assets (JS, CSS, fonts): Cache-first ───────────────────────────
  if (
    url.pathname.startsWith('/static/') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('cdn.jsdelivr.net')
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (!response || response.status !== 200 || response.type === 'opaque') {
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        }).catch(() => cached || new Response('', { status: 404 }));
      })
    );
    return;
  }

  // ── HTML pages (app shell): Stale-while-revalidate ────────────────────────
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        return cached || new Response(
          `<!DOCTYPE html><html><head><title>Offline</title></head>
          <body style="background:#0a0a1a;color:#fff;font-family:sans-serif;
            display:flex;align-items:center;justify-content:center;
            height:100vh;flex-direction:column;gap:16px;">
            <div style="font-size:4rem">📡</div>
            <h1>You're offline</h1>
            <p style="opacity:0.6">FileShare requires a network connection to browse files.</p>
          </body></html>`,
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        );
      });
      return cached || networkFetch;
    })
  );
});

// ─── Background Sync ──────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'upload-queue') {
    console.log('[SW] Background sync: upload-queue');
  }
});

// ─── Push Notifications ───────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'FileShare', {
      body: data.body || '',
      icon: '/static/icon-192.png',
      badge: '/static/icon-192.png',
      tag: 'fileshare',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((list) => {
      for (const c of list) {
        if (c.url === url && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
