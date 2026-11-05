const APP_CACHE_NAME = 'mountpro-app-v6-offline';
const TILE_CACHE_NAME = 'mountpro-tiles-v1-offline';

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/index.css',
  '/manifest.json',
  '/favicon.ico',
  '/apple-touch-icon.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
];

// Tile SVG di fallback per aree non pre-caricate quando si è offline (evita icone di immagine rotta su Leaflet)
const OFFLINE_BASE_TILE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="#121215"/>
  <path d="M0 64h256M0 128h256M0 192h256M64 0v256M128 0v256M192 0v256" stroke="#1f1f24" stroke-width="1"/>
  <rect width="256" height="256" fill="none" stroke="#27272a" stroke-width="0.75" stroke-dasharray="4 4"/>
  <text x="128" y="124" text-anchor="middle" fill="#52525b" font-family="sans-serif" font-size="10" font-weight="600">AREA NON IN CACHE</text>
  <text x="128" y="138" text-anchor="middle" fill="#3f3f46" font-family="monospace" font-size="8">Modalità Offline</text>
</svg>`;

const OFFLINE_OVERLAY_TILE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"></svg>`;

function createFallbackTileResponse(urlStr) {
  const isOverlay =
    urlStr.includes('waymarkedtrails.org') ||
    urlStr.includes('rainviewer.com') ||
    urlStr.includes('/Reference/');
  const svg = isOverlay ? OFFLINE_OVERLAY_TILE_SVG : OFFLINE_BASE_TILE_SVG;
  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE_NAME).then(async (cache) => {
      for (const asset of ASSETS_TO_CACHE) {
        try {
          const isCrossOrigin = asset.startsWith('http');
          const req = isCrossOrigin
            ? new Request(asset, { mode: 'no-cors' })
            : new Request(asset, { cache: 'reload' });
          const res = await fetch(req);
          if (res && (res.status === 200 || res.type === 'opaque')) {
            await cache.put(asset, res);
          }
        } catch (err) {
          console.warn('SW pre-cache note:', asset, err);
        }
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  const allowedCaches = new Set([APP_CACHE_NAME, TILE_CACHE_NAME]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (!allowedCaches.has(key)) {
            console.log('[SW] Clearing old cache:', key);
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Strategy 1: Map Tiles (OpenStreetMap, Esri Satellite/Hybrid, Waymarked Trails, RainViewer)
  // Cache-First con normalizzazione sottodominio OSM (a/b/c -> a), aggiornamento in background e fallback SVG sicuro se offline
  if (
    (url.hostname.includes('openstreetmap.org') && url.pathname.endsWith('.png')) ||
    url.hostname.includes('arcgisonline.com') ||
    url.hostname.includes('waymarkedtrails.org') ||
    url.hostname.includes('rainviewer.com')
  ) {
    const canonicalTileUrl = url.hostname.endsWith('.tile.openstreetmap.org')
      ? `https://a.tile.openstreetmap.org${url.pathname}`
      : event.request.url;

    event.respondWith(
      caches.open(TILE_CACHE_NAME).then(async (tileCache) => {
        const cached =
          (await tileCache.match(canonicalTileUrl)) ||
          (await tileCache.match(event.request));

        const networkPromise = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
              tileCache.put(canonicalTileUrl, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => null);

        if (cached) {
          return cached;
        }
        const netRes = await networkPromise;
        return netRes || createFallbackTileResponse(event.request.url);
      })
    );
    return;
  }

  // Ignora chiamate API dinamiche (Overpass, Nominatim, Open-Meteo, BRouter, OSRM) lasciandole gestire alla logica applicativa e IndexedDB
  if (
    url.hostname.includes('overpass') ||
    url.hostname.includes('openstreetmap.fr') ||
    url.hostname.includes('mail.ru') ||
    url.hostname.includes('nominatim.openstreetmap.org') ||
    url.hostname.includes('open-meteo.com') ||
    url.hostname.includes('brouter') ||
    url.hostname.includes('routing.openstreetmap.de')
  ) {
    return;
  }

  // Strategy 2: Navigation & HTML requests -> Network First with Cache Fallback
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(APP_CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cache = await caches.open(APP_CACHE_NAME);
          return (
            (await cache.match(event.request)) ||
            (await cache.match('/index.html')) ||
            (await cache.match('/'))
          );
        })
    );
    return;
  }

  // Strategy 3: App Shell, JS/TS bundles, CSS, Fonts, Icons -> Network-First con Fallback Cache completo per Offline
  event.respondWith(
    caches.open(APP_CACHE_NAME).then(async (cache) => {
      try {
        const networkResponse = await fetch(event.request);
        if (
          networkResponse &&
          (networkResponse.status === 200 || networkResponse.type === 'opaque')
        ) {
          cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      } catch (err) {
        const cachedResponse =
          (await cache.match(event.request)) || (await cache.match(event.request.url));
        if (cachedResponse) return cachedResponse;
        if (event.request.destination === 'image') {
          return (await cache.match('/pwa-192x192.png')) || Response.error();
        }
        return Response.error();
      }
    })
  );
});
