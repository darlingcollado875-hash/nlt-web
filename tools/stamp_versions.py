#!/usr/bin/env python3
"""Actualiza el ?v=<sha1[:8]> de cada <script src="assets/js/...">, <link href="assets/css/..."> de todos los .html.

Uso (desde la raíz del repo, después de tocar cualquier JS/CSS de assets/):  python3 tools/stamp_versions.py
Con --check solo revisa (sale con código 1 si hay sellos viejos): sirve para avisar antes de publicar.
El sello cambia la URL cuando cambia el archivo, así el navegador nunca se queda con una versión vieja guardada en caché."""
import glob
import hashlib
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PAT = re.compile(r'((?:src|href)="(assets/(?:js|css)/[^"?]+))\?v=([0-9a-f]{8})"')


def sello(ruta: Path) -> str:
    return hashlib.sha1(ruta.read_bytes()).hexdigest()[:8]


def main() -> int:
    solo_revisar = "--check" in sys.argv
    viejos, cambiadas = 0, 0
    for html in sorted(glob.glob(str(RAIZ / "*.html"))):
        texto = Path(html).read_text(encoding="utf-8")

        def cambiar(m):
            nonlocal viejos
            archivo = RAIZ / m.group(2)
            if not archivo.exists():
                return m.group(0)
            nuevo = sello(archivo)
            if nuevo != m.group(3):
                viejos += 1
            return f'{m.group(1)}?v={nuevo}"'

        nuevo_texto = PAT.sub(cambiar, texto)
        if nuevo_texto != texto:
            cambiadas += 1
            if not solo_revisar:
                Path(html).write_text(nuevo_texto, encoding="utf-8")
    print(f"{viejos} sello(s) desactualizado(s) en {cambiadas} página(s)" + (" (solo revisión)" if solo_revisar else " -> actualizados"))
    return 1 if (solo_revisar and viejos) else 0


if __name__ == "__main__":
    sys.exit(main())
