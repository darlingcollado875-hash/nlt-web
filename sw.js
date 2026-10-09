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
    const opciones = {
        body: datos.body || '',
        icon: '/assets/img/pwa-192.png',
        badge: '/assets/img/pwa-192.png',
        tag: datos.tag,
        data: { url: datos.url || '/dashboard.html' },
    };
    // Llamadas: la notificación se queda hasta que la toques, vibra y vuelve a sonar aunque ya hubiera otra igual
    if (/^(call_|live_)/.test(datos.tag || '')) {
        opciones.requireInteraction = true;
        opciones.renotify = true;
        opciones.vibrate = [250, 120, 250, 120, 250];
    }
    event.waitUntil(self.registration.showNotification(datos.title || 'NLT', opciones));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = new URL(event.notification.data && event.notification.data.url || '/dashboard.html', self.location.origin).href;
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (lista) => {
            // Si ya hay una pestaña de NLT abierta, la enfoca en vez de abrir una pestaña nueva -- comportamiento esperado de una PWA
            // instalada. Se le pide a la PÁGINA que abra el destino (si estás en una llamada, navegar la pestaña la cortaría); si no
            // contesta en 700 ms (página vieja), se navega como antes.
            const existente = lista.find((c) => c.url.startsWith(self.location.origin));
            if (!existente) return self.clients.openWindow(url);
            try { await existente.focus(); } catch (e) { /* sin foco */ }
            const acuse = await new Promise((resolver) => {
                const canal = new MessageChannel();
                const t = setTimeout(() => resolver(false), 700);
                canal.port1.onmessage = () => { clearTimeout(t); resolver(true); };
                try { existente.postMessage({ nlt: 'abrir', url }, [canal.port2]); } catch (e) { clearTimeout(t); resolver(false); }
            });
            if (!acuse) return existente.navigate(url);
        })
    );
});
