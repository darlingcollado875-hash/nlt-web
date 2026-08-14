// Proxy real del tokenizador de Pay2Commerce -- bug real y confirmado en su
// tokenizer.js (v1.0.0): las llamadas internas que hace ("Step 1: Get
// processor config" y "Step 4: Exchange OTS for permanent payment_method_id")
// usan URLs RELATIVAS (fetch('/public/payment-config/...') y
// fetch('/api/v1/tokens')) en vez de apuntar a su propio dominio -- cuando su
// script corre embebido en un sitio de terceros (el uso que ellos mismos
// documentan), esas peticiones pegan contra NUESTRO dominio en vez del de
// Pay2Commerce. Mismo patrón que dev_server.py usa en local.
//
// Antes esto vivía en netlify.toml/_redirects como un redirect "proxy"
// (status 200) -- confirmado real en el deploy (14/08) que la plataforma
// actual de Cloudflare (Workers con Static Assets) RECHAZA el build entero
// si un redirect asi apunta a una URL externa absoluta. Este Worker hace lo
// mismo pero como código real, que sí está permitido.
const UPSTREAM = 'https://app.pay2commerce.net';
const PROXY_PREFIXES = ['/public/payment-config/', '/api/v1/tokens'];

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (PROXY_PREFIXES.some((p) => url.pathname.startsWith(p))) {
            const destino = UPSTREAM + url.pathname + url.search;
            const cabecerasReenviadas = new Headers(request.headers);
            cabecerasReenviadas.delete('host');
            cabecerasReenviadas.set('origin', UPSTREAM);

            try {
                const tieneBody = !['GET', 'HEAD'].includes(request.method);
                const respuestaUpstream = await fetch(destino, {
                    method: request.method,
                    headers: cabecerasReenviadas,
                    body: tieneBody ? request.body : undefined,
                    duplex: tieneBody ? 'half' : undefined,
                });
                const cabecerasRespuesta = new Headers(respuestaUpstream.headers);
                cabecerasRespuesta.set('access-control-allow-origin', '*');
                return new Response(respuestaUpstream.body, {
                    status: respuestaUpstream.status,
                    headers: cabecerasRespuesta,
                });
            } catch (e) {
                return new Response(JSON.stringify({ error: 'proxy_failed', detail: String(e) }), {
                    status: 502,
                    headers: { 'content-type': 'application/json' },
                });
            }
        }

        return env.ASSETS.fetch(request);
    },
};
