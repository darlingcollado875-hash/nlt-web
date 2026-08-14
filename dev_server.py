"""Servidor estático de nlt-web para desarrollo local -- agrega, ademas de
servir los archivos, un proxy para las 2 rutas relativas rotas del
tokenizer.js de Pay2Commerce (ver el comentario en netlify.toml para el
detalle completo del bug real). En producción (Netlify) esto lo resuelven
los [[redirects]] de netlify.toml; localmente python -m http.server no
puede proxyear nada, así que este script reemplaza a http.server con la
misma funcionalidad de siempre + ese proxy puntual."""
import http.server
import os
import ssl
import sys
import urllib.error
import urllib.request

# Certificado autofirmado SOLO para desarrollo local -- necesario porque
# Accept.js (el tokenizador real de Authorize.Net que usa Pay2Commerce) exige
# HTTPS de verdad para aceptar datos de tarjeta: sin esto, P2C.tokenize()
# falla en el navegador con "Accept.js is not loaded correctly" / "An HTTPS
# connection is required" (confirmado en vivo, mensaje real del propio script
# de Authorize.Net, no una suposición). No afecta producción -- Netlify/
# Cloudflare ya sirven HTTPS real por su cuenta.
_CERT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".local-certs")
_CERT_FILE = os.path.join(_CERT_DIR, "cert.pem")
_KEY_FILE = os.path.join(_CERT_DIR, "key.pem")

UPSTREAM = "https://app.pay2commerce.net"
PROXY_PREFIXES = ("/public/payment-config/", "/api/v1/tokens")


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # SimpleHTTPRequestHandler no manda Cache-Control -- Chrome aplica
        # cacheo heurístico basado en Last-Modified (RFC 7234 4.2.2) y sirve
        # versiones viejas de nlt-shared.js/nlt-api-client.js desde disk cache
        # incluso en pestañas nuevas, sin volver a pedirle nada al server. En
        # Netlify esto no pasa igual (netlify.toml ya fuerza no-cache en los
        # .html; acá lo extendemos a todo para que el dev local nunca sirva
        # JS/CSS desactualizado mientras se itera).
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        # Cache-Control por sí solo no invalida lo que el navegador YA tiene
        # en disk cache de antes de este fix -- Clear-Site-Data fuerza a
        # Chrome a purgarlo en cada respuesta, así el visor de pruebas nunca
        # vuelve a quedar pegado a una versión vieja de un asset.
        self.send_header("Clear-Site-Data", '"cache"')
        super().end_headers()

    def do_GET(self):
        if self.path.startswith(PROXY_PREFIXES):
            return self._proxy("GET")
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith(PROXY_PREFIXES):
            return self._proxy("POST")
        self.send_error(404)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def _proxy(self, method):
        url = UPSTREAM + self.path
        body = None
        headers = {}
        if method == "POST":
            length = int(self.headers.get("Content-Length", 0) or 0)
            body = self.rfile.read(length) if length else None
            headers["Content-Type"] = self.headers.get("Content-Type", "application/json")
        if "Authorization" in self.headers:
            headers["Authorization"] = self.headers["Authorization"]

        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                self.send_response(resp.status)
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self._cors_headers()
                self.end_headers()
                self.wfile.write(resp.read())
        except urllib.error.HTTPError as e:
            body_bytes = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", e.headers.get("Content-Type", "application/json"))
            self._cors_headers()
            self.end_headers()
            self.wfile.write(body_bytes)
        except urllib.error.URLError as e:
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self._cors_headers()
            self.end_headers()
            self.wfile.write(f'{{"error":"proxy_failed","detail":"{e}"}}'.encode())


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = http.server.ThreadingHTTPServer(("0.0.0.0", 5502), Handler)
    # HTTPS es OPT-IN (pasar --https), nunca automático: HTTP plano es el
    # comportamiento normal de siempre (VSCode Live Server, uso diario), y
    # solo hace falta HTTPS puntualmente para probar pagos reales con
    # Accept.js. Que se activara solo con detectar el certificado rompió el
    # uso normal por HTTP (confirmado en vivo: "Failed to fetch" en todas
    # las páginas) -- no debe volver a pasar.
    quiere_https = "--https" in sys.argv
    if quiere_https and os.path.isfile(_CERT_FILE) and os.path.isfile(_KEY_FILE):
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(certfile=_CERT_FILE, keyfile=_KEY_FILE)
        server.socket = ctx.wrap_socket(server.socket, server_side=True)
        print("nlt-web + proxy de Pay2Commerce sirviendo en https://localhost:5502 (certificado autofirmado -- el navegador va a mostrar una advertencia, es esperado en local)")
    else:
        if quiere_https:
            print("Se pidió --https pero falta el certificado en .local-certs/ -- sirviendo por HTTP en su lugar.")
        print("nlt-web + proxy de Pay2Commerce sirviendo en http://localhost:5502 (sin certificado local -- Accept.js/pago con tarjeta real NO va a funcionar, ver .local-certs/)")
    server.serve_forever()
