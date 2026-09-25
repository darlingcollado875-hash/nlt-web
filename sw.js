// NLT Service Worker -- SOLO Web Push (notificaciones nativas). No es un
// service worker "offline-first": no cachea nada a propósito, para no
// introducir contenido viejo servido desde caché en un ecosistema que se
// actualiza seguido (ver tools/stamp_versions.py). Su único trabajo es
// recibir el evento `push` y mostrar la notificación, y abrir/enfocar la
// pestaña correcta cuando el usuario toca la notificación.

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
    let datos = { title: 'NLT', body: '', url: '/dashboard.html', tag: undefined };
    try {
        if (event.data) datos = { ...datos, ...event.data.json() };
    } catch (e) {
        // Un payload que no es JSON no debe tumbar la notificación -- se
        // muestra igual con lo que ya había por default.
    }
    event.waitUntil(
        self.registration.showNotification(datos.title || 'NLT', {
            body: datos.body || '',
            icon: '/assets/img/pwa-192.png',
            badge: '/assets/img/pwa-192.png',
            tag: datos.tag,
            data: { url: datos.url || '/dashboard.html' },
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = new URL(event.notification.data && event.notification.data.url || '/dashboard.html', self.location.origin).href;
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
            // Si ya hay una pestaña de NLT abierta, la enfoca y navega ahí
            // en vez de abrir una pestaña nueva -- comportamiento esperado
            // de una PWA instalada.
            const existente = lista.find((c) => c.url.startsWith(self.location.origin));
            if (existente) { existente.focus(); return existente.navigate(url); }
            return self.clients.openWindow(url);
        })
    );
});
