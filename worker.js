// Unico proposito de este Worker: arreglar un bug real y confirmado del
// tokenizer.js de Pay2Commerce (v1.0.0) -- sus llamadas internas
// ("Step 1: Get processor config" y "Step 4: Exchange OTS for permanent
// payment_method_id") usan URLs RELATIVAS (/public/payment-config/... y
// /api/v1/tokens) en vez de apuntar a su propio dominio. Cuando el script
// corre embebido en nltnextlevel.uk (el uso que ellos mismos documentan),
// esas peticiones pegan contra nuestro dominio en vez del de Pay2Commerce
// y su script revienta parseando la pagina de error 404 como si fuera
// JSON ("Unexpected token '<'... is not valid JSON"). Reportado a su
// soporte; mientras lo corrigen de su lado, este Worker actua como el
// mismo proxy transparente que en Netlify se resolvia con un [[redirects]]
// de status 200 -- Cloudflare Workers Static Assets rechaza ese tipo de
// redirect a URL externa absoluta ("Proxy (200) redirects can only point
// to relative paths"), asi que la unica forma real de lograrlo aca es un
// Worker que reenvia la request server-side.
//
// Todo lo que NO sea una de estas 2 rutas cae directo a env.ASSETS.fetch(),
// exactamente como Cloudflare serviria el sitio sin este archivo -- nunca
// se toca ni se reinterpreta ninguna otra ruta.
const PAY2COMMERCE_ORIGIN = "https://app.pay2commerce.net";

function esRutaDeProxyDePagos(pathname) {
    return pathname === "/api/v1/tokens" || pathname.startsWith("/public/payment-config/");
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (esRutaDeProxyDePagos(url.pathname)) {
            const destino = PAY2COMMERCE_ORIGIN + url.pathname + url.search;
            const requestReenviada = new Request(destino, request);
            return fetch(requestReenviada);
        }

        return env.ASSETS.fetch(request);
    },
};
