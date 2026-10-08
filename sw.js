const CACHE = 'veedores-sucua-2026-v12';

const ARCHIVOS_ESTATICOS = [
    '/veedores_sucua/vendor/fontawesome/css/all.min.css',
    '/veedores_sucua/vendor/fontawesome/webfonts/fa-solid-900.woff2',
    '/veedores_sucua/vendor/fontawesome/webfonts/fa-solid-900.ttf',
    '/veedores_sucua/vendor/fontawesome/webfonts/fa-regular-400.woff2',
    '/veedores_sucua/vendor/fontawesome/webfonts/fa-regular-400.ttf',
    '/veedores_sucua/vendor/fontawesome/webfonts/fa-brands-400.woff2',
    '/veedores_sucua/vendor/fontawesome/webfonts/fa-brands-400.ttf',
    '/veedores_sucua/acceso/acceso.html',
    '/veedores_sucua/acceso/acceso.css',
    '/veedores_sucua/acceso/acceso.js',
    '/veedores_sucua/dignidad/dignidad.html',
    '/veedores_sucua/dignidad/dignidad.css',
    '/veedores_sucua/dignidad/dignidad.js',
    '/veedores_sucua/seleccion/seleccion.html',
    '/veedores_sucua/seleccion/seleccion.css',
    '/veedores_sucua/seleccion/seleccion.js',
    '/veedores_sucua/votos/votos.html',
    '/veedores_sucua/votos/votos.css',
    '/veedores_sucua/votos/votos.js',
    '/veedores_sucua/administrador/admin.html',
    '/veedores_sucua/administrador/admin.css',
    '/veedores_sucua/administrador/admin.js',
    '/veedores_sucua/registro/registro.html',
    '/veedores_sucua/js/sync-offline.js',
    '/veedores_sucua/manifest.json',
    '/veedores_sucua/icon-192.png',
    '/veedores_sucua/icon-512.png'
];

function esPaginaNgrok(text) {
    return text.includes('ERR_NGROK_6024') || (text.includes('ngrok-free.dev') && text.includes('You are about to visit'));
}

function fetchConHeader(req) {
    const headers = new Headers(req.headers);
    headers.set('ngrok-skip-browser-warning', 'true');
    return fetch(new Request(req, { headers }));
}

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE).then(cache => {
            return Promise.allSettled(
                ARCHIVOS_ESTATICOS.map(url =>
                    fetch(url, { headers: { 'ngrok-skip-browser-warning': 'true' } }).then(res => {
                        if (!res.ok) throw new Error('HTTP ' + res.status);
                        return cache.put(url, res);
                    }).catch(e => console.warn('[SW] No cacheado:', url, e.message))
                )
            );
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    if (event.request.method === 'POST' ||
        url.pathname === '/login' ||
        url.pathname === '/registrar-resultados' ||
        url.pathname === '/subir-foto') {
        event.respondWith(fetch(event.request).catch(() =>
            new Response(JSON.stringify({ success: false, offline: true, message: 'Sin conexión' }), {
                headers: { 'Content-Type': 'application/json' }
            })
        ));
        return;
    }

    if (['/parroquias', '/zonas', '/juntas', '/candidatos', '/dignidades-estado',
         '/parroquias-disponibles', '/zonas-disponibles', '/estadisticas',
         '/estado-acceso', '/usuarios', '/resultados', '/junta-registrada',
         '/todas-fotos', '/foto-acta', '/descargar-excel', '/descargar-fotos-actas']
        .some(p => url.pathname.startsWith(p))) {
        event.respondWith(
            fetchConHeader(event.request).then(response => {
                if (event.request.method === 'GET') {
                    const clone = response.clone();
                    caches.open(CACHE).then(c => c.put(event.request, clone)).catch(() => {});
                }
                return response;
            }).catch(() => caches.match(event.request))
        );
        return;
    }

    if (url.pathname.endsWith('.html') && event.request.mode === 'navigate') {
        event.respondWith(
            caches.match(event.request).then(cached => {
                if (cached) return cached;
                return fetchConHeader(event.request).then(response => {
                    if (response && response.status === 200) {
                        return response.text().then(text => {
                            if (esPaginaNgrok(text)) {
                                return caches.match('/veedores_sucua/acceso/acceso.html').then(fb => {
                                    return fb || new Response(text, { status: 200, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
                                });
                            }
                            const resp = new Response(text, { status: 200, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
                            caches.open(CACHE).then(c => c.put(event.request, resp.clone()));
                            return resp;
                        });
                    }
                    return response;
                });
            }).catch(() => caches.match('/veedores_sucua/acceso/acceso.html'))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetchConHeader(event.request).then(response => {
                if (response && response.status === 200) {
                    caches.open(CACHE).then(c => c.put(event.request, response.clone()));
                }
                return response;
            });
        }).catch(() => {
            if (event.request.mode === 'navigate')
                return caches.match('/veedores_sucua/acceso/acceso.html');
        })
    );
});
