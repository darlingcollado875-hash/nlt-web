// Cliente Supabase y helpers compartidos por todas las páginas de NLT.
// Requiere que la página haya cargado <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script> antes.

// Parche de window.fetch para el tokenizador de Pay2Commerce (bug real y
// confirmado en su tokenizer.js v1.0.0: usa fetch('/public/payment-config/...')
// y fetch('/api/v1/tokens') con rutas RELATIVAS -- pensadas para cuando su
// script corre en su propio dominio, pero rotas cuando corre embebido en un
// sitio de terceros como el nuestro, porque esas rutas relativas pegan contra
// NUESTRO dominio en vez del de Pay2Commerce. Se intentó primero un proxy vía
// Cloudflare Worker (_worker.js) pero se confirmó que Cloudflare no lo estaba
// ejecutando en absoluto; esta solución client-side no depende de la
// plataforma de hosting. Confirmado real (14/08) que Pay2Commerce sí permite
// estas llamadas cross-origin (CORS abierto), así que reescribir la URL acá
// basta -- no hace falta ningún proxy server-side.
(function () {
    const originalFetch = window.fetch.bind(window);
    const P2C_PROXY_PREFIXES = ['/public/payment-config/', '/api/v1/tokens'];
    const P2C_ORIGIN = 'https://app.pay2commerce.net';

    window.fetch = function (input, init) {
        const urlStr = typeof input === 'string' ? input : (input && input.url) || '';
        if (P2C_PROXY_PREFIXES.some((p) => urlStr.startsWith(p))) {
            const nuevaUrl = P2C_ORIGIN + urlStr;
            if (typeof input === 'string') {
                return originalFetch(nuevaUrl, init);
            }
            return originalFetch(new Request(nuevaUrl, input), init);
        }
        return originalFetch(input, init);
    };
})();

(function () {
    const SUPABASE_URL = 'https://wjczkcuxptzpayzemttb.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_XeUjMNK559IZdBG_lnEqzg_6JVPc-TG';
    const ADMIN_EMAIL = 'darlingcollado875@gmail.com';

    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Cachea la promesa de supabase.auth.getSession() -- sin esto,
    // requireSession(), mountPublicHeader(), mountAuthAwareCTA() y el
    // _token() de nlt-api-client.js cada uno pedía su propia sesión a
    // Supabase, hasta 3 veces en la misma carga de página (confirmado real
    // en dashboard.html). Se resuelve una sola vez por carga de página y
    // el resto reusa la misma promesa.
    let _sessionPromise = null;
    function _getSessionRaw() {
        if (!_sessionPromise) {
            _sessionPromise = supabase.auth.getSession();
        }
        return _sessionPromise;
    }
    async function getSession() {
        const { data: { session } } = await _getSessionRaw();
        return session;
    }

    // BUG REAL confirmado en producción (Admin, sesión larga -- "Error:
    // Token inválido o expirado" en todas las tarjetas): una vez resuelta,
    // _sessionPromise quedaba "congelada" con el access_token de ESA
    // primera resolución para siempre -- las promesas no se re-evalúan.
    // supabase-js sí renueva el access_token en segundo plano
    // (autoRefreshToken:true por default), pero _token() en
    // nlt-api-client.js sigue leyendo la sesión vieja de acá, así que
    // cualquier pestaña abierta más de ~1h (vida del access_token)
    // empezaba a fallar TODOS los fetches hasta recargar la página a
    // mano. Este listener mantiene _sessionPromise sincronizada con cada
    // evento real de Supabase (incluido TOKEN_REFRESHED) sin tocar el
    // resto del mecanismo de caché (sigue resolviendo una sola vez el
    // getSession() inicial de la carga de página).
    supabase.auth.onAuthStateChange((_event, session) => {
        _sessionPromise = Promise.resolve({ data: { session }, error: null });
    });

    // Redirige a index.html si no hay sesión activa. Devuelve la sesión si existe.
    async function requireSession() {
        let { data: { session }, error } = await _getSessionRaw();

        // Justo después de volver del redirect de OAuth el cliente puede tardar
        // un instante en procesar el token de la URL. Antes de expulsar al usuario,
        // le damos un margen escuchando el primer evento de auth (máx. 2s).
        if (!session && !error) {
            session = await new Promise((resolve) => {
                const timeout = setTimeout(() => resolve(null), 2000);
                const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
                    clearTimeout(timeout);
                    listener.subscription.unsubscribe();
                    resolve(s);
                });
            });
            // El auth-state-change trajo una sesión que la caché no tenía
            // (típico justo después del redirect de OAuth) -- se actualiza
            // la caché para que el resto de la página (header, sidebar,
            // NLT_API) vea esta sesión nueva en vez de la nula original.
            if (session) _sessionPromise = Promise.resolve({ data: { session }, error: null });
        }

        if (error || !session) {
            window.location.href = 'index.html';
            return null;
        }
        // "Contact us" -- se monta acá porque TODA página autenticada pasa
        // por requireSession() (incluida academy-dashboard.html, que no usa
        // mountSidebar ni mountPublicHeader) -- un solo punto cubre las ~15
        // páginas del sidebar + esa. Las páginas públicas (mountPublicHeader)
        // tienen su propio punto de montaje, ver esa función más abajo.
        mountSupportChat(session);
        return session;
    }

    // Lee error/error_description que Supabase agrega a la URL cuando el login
    // OAuth falla (ej. redirect URL no autorizada) y limpia la URL.
    function getAuthRedirectError() {
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const queryParams = new URLSearchParams(window.location.search);
        const errorCode = hashParams.get('error') || queryParams.get('error');
        if (!errorCode) return null;

        const description = hashParams.get('error_description') || queryParams.get('error_description');
        window.history.replaceState({}, document.title, window.location.pathname);
        return description ? decodeURIComponent(description.replace(/\+/g, ' ')) : errorCode;
    }

    // Cierre de sesión a prueba de fallos: siempre limpia estado local y redirige,
    // pase lo que pase con la llamada a Supabase.
    async function signOut() {
        try {
            await supabase.auth.signOut();
        } catch (err) {
            console.error('Error al cerrar sesión en Supabase:', err);
        } finally {
            window.localStorage.clear();
            window.sessionStorage.clear();
            window.location.href = 'index.html';
        }
    }

    // Conecta el botón de logout (id="btn-salir") sin usar onclick inline.
    function bindLogoutButton(id) {
        const btn = document.getElementById(id || 'btn-salir');
        if (!btn) return;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            signOut();
        });
    }

    // Portales públicos (index/ecosystem/copy-system/plans/indicator): antes
    // cada botón "Comenzar" disparaba el login de Google SIN chequear si ya
    // había sesión -- la sesión real de Supabase nunca se cerraba sola al
    // navegar entre páginas, pero como el botón seguía diciendo "Comenzar",
    // se sentía como un logout falso. Esto revisa la sesión una vez y deja
    // el/los botón(es) coherentes con el estado real: si ya hay sesión,
    // llevan directo al Dashboard sin volver a pasar por OAuth.
    async function mountAuthAwareCTA(buttonIds, opts = {}) {
        const ids = Array.isArray(buttonIds) ? buttonIds : [buttonIds];
        const destino = opts.loggedInHref || 'dashboard.html';

        // El click se conecta YA, sin esperar a Supabase -- si el usuario
        // toca el botón antes de que la sesión resuelva, el propio handler
        // la resuelve (reusando la misma caché) al momento del click. Nunca
        // debe pasar que el botón exista en pantalla pero no reaccione.
        ids.forEach((id) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.onclick = async (e) => {
                e.preventDefault();
                const session = await getSession();
                if (session) {
                    window.location.href = destino;
                } else {
                    const urlDestino = new URL(opts.redirectTo || destino, window.location.href).toString();
                    supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: urlDestino } });
                }
            };
        });

        // El texto del botón ("Comenzar" vs "Ir al Dashboard") sigue
        // actualizándose de forma asíncrona una vez se conoce la sesión --
        // eso es solo cosmético, nunca condición para que el click funcione.
        const session = await getSession();
        ids.forEach((id) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.textContent = session ? (opts.loggedInLabel || 'Ir al Dashboard') : (opts.loggedOutLabel || btn.textContent);
        });
        return session;
    }

    // Header global de los portales públicos (index/ecosystem/copy-system/plans/
    // indicator/academy): SIN sesión -> botón "Comenzar". CON sesión -> botón
    // "Dashboard" + avatar + "Cerrar sesión", y el logo pasa a apuntar directo
    // al Dashboard. Usa la MISMA sesión de Supabase que requireSession() --
    // nunca una segunda fuente de verdad -- así navegar entre portales nunca
    // da la sensación de haberse desconectado.
    // Textura de grano fílmico sobre el resplandor azul del fondo -- el
    // detalle visual que le da profundidad a la landing (referencia:
    // nlt.relioops.com). Un solo SVG feTurbulence como data-URI, sin
    // requests externos ni CDN, tileado y con mix-blend-mode: overlay para
    // que reaccione con el color de abajo en vez de verse como ruido plano.
    // Se inyecta una sola vez por página, idempotente (chequea el id antes
    // de crear), y se llama desde mountPublicHeader() para llegar gratis a
    // las ~23 páginas públicas que ya la invocan.
    // Fondo animado tipo "liquido"/plasma (referencia: nlt.relioops.com) --
    // anillos de luz azul en movimiento continuo sobre negro, con grano
    // integrado al mismo shader (no una textura estatica encima). Un solo
    // <canvas> WebGL de pantalla completa, fbm noise con dominio deformado
    // por el tiempo (la tecnica estandar para el efecto "liquid chrome"),
    // sin ninguna libreria/CDN. Respeta prefers-reduced-motion (deja el
    // fondo estatico oscuro, sin animar) y cae a un fondo solido si WebGL
    // no esta disponible -- nunca rompe la pagina.
    const _LIQUID_VERT = `
        attribute vec2 aPos;
        void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
    `;
    const _LIQUID_FRAG = `
        precision highp float;
        uniform vec2 uRes;
        uniform float uTime;
        vec2 hash(vec2 p) {
            p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
            return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
        }
        float noise(vec2 p) {
            const float K1 = 0.366025404;
            const float K2 = 0.211324865;
            vec2 i = floor(p + (p.x + p.y) * K1);
            vec2 a = p - i + (i.x + i.y) * K2;
            vec2 o = (a.x > a.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
            vec2 b = a - o + K2;
            vec2 c = a - 1.0 + 2.0 * K2;
            vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
            vec3 n = h * h * h * h * vec3(dot(a, hash(i)), dot(b, hash(i + o)), dot(c, hash(i + 1.0)));
            return dot(n, vec3(70.0));
        }
        float fbm(vec2 p) {
            float v = 0.0; float amp = 0.5;
            for (int i = 0; i < 4; i++) { v += amp * noise(p); p *= 2.02; amp *= 0.55; }
            return v;
        }
        void main() {
            vec2 uv = (gl_FragCoord.xy - 0.5 * uRes.xy) / uRes.y;
            float t = uTime * 0.035;
            vec2 warp = vec2(fbm(uv * 1.1 + t), fbm(uv * 1.1 - t + 4.0));
            float n = fbm(uv * 1.25 + warp * 1.1 + t * 0.5);
            float glow = smoothstep(-0.45, 1.2, n);
            vec3 base = vec3(0.031, 0.039, 0.059);
            vec3 accent = vec3(0.263, 0.471, 1.0);
            vec3 col = mix(base, accent, glow * 0.48);
            float grainHash = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + uTime * 60.0) * 43758.5453);
            col += (grainHash - 0.5) * 0.028;
            gl_FragColor = vec4(col, 1.0);
        }
    `;

    function _mountStaticFallbackBackground() {
        if (document.getElementById('nlt-liquid-style')) return;
        const style = document.createElement('style');
        style.id = 'nlt-liquid-style';
        style.textContent = `#nlt-liquid-bg { position: fixed; inset: 0; z-index: 0; pointer-events: none; background: #080A0F; }`;
        document.head.appendChild(style);
        const div = document.createElement('div');
        div.id = 'nlt-liquid-bg';
        div.setAttribute('aria-hidden', 'true');
        document.body.insertBefore(div, document.body.firstChild);
    }

    // Las paginas con shell de sidebar (dashboard.html y el resto de las
    // paginas autenticadas -- <aside id="sidebar"> + <main> con scroll
    // interno) componen ese <main> en su PROPIA capa opaca -- confirmado
    // en vivo: un <canvas> fixed detras, aunque z-index:0 y de body para
    // abajo, nunca se ve a traves de esa region (ni con z-index mas alto,
    // que en cambio termina tapando todo el contenido real). En vez de
    // pelear con el compositing de esa capa, estas paginas usan una version
    // "premium" ESTATICA del mismo fondo (glow + grano) como
    // background-image del propio <body> -- ahi no hay ninguna capa/canvas
    // de por medio, se pinta sin conflicto de z-index posible.
    function _mountStaticPremiumBackground() {
        if (document.getElementById('nlt-premium-bg-style')) return;
        const style = document.createElement('style');
        style.id = 'nlt-premium-bg-style';
        style.textContent = `
            body {
                background-image:
                    radial-gradient(900px circle at 12% -10%, rgba(67,120,255,0.14), transparent 60%),
                    radial-gradient(700px circle at 105% 105%, rgba(67,120,255,0.09), transparent 60%),
                    url("assets/img/grain-subtle.png");
                background-size: auto, auto, 64px 64px;
                background-repeat: no-repeat, no-repeat, repeat;
                background-attachment: fixed, fixed, fixed;
                background-blend-mode: normal, normal, screen;
            }
        `;
        document.head.appendChild(style);
    }

    function mountLiquidBackground() {
        if (document.getElementById('nlt-liquid-bg') || document.getElementById('nlt-liquid-style') || document.getElementById('nlt-premium-bg-style')) return;
        if (document.getElementById('sidebar')) { _mountStaticPremiumBackground(); return; }
        const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        const style = document.createElement('style');
        style.id = 'nlt-liquid-style';
        style.textContent = `#nlt-liquid-bg { position: fixed; inset: 0; z-index: 0; pointer-events: none; display: block; width: 100%; height: 100%; }`;
        document.head.appendChild(style);

        const canvas = document.createElement('canvas');
        canvas.id = 'nlt-liquid-bg';
        canvas.setAttribute('aria-hidden', 'true');
        document.body.insertBefore(canvas, document.body.firstChild);

        const conn = navigator.connection || {};
        const lowEnd = conn.saveData || (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2);
        if (reduceMotion || lowEnd) { _mountStaticFallbackBackground(); canvas.remove(); return; }

        const gl = canvas.getContext('webgl');
        if (!gl) { canvas.remove(); _mountStaticFallbackBackground(); return; }

        function compile(type, src) {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            return s;
        }
        const vs = compile(gl.VERTEX_SHADER, _LIQUID_VERT);
        const fs = compile(gl.FRAGMENT_SHADER, _LIQUID_FRAG);
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            canvas.remove(); _mountStaticFallbackBackground(); return;
        }
        gl.useProgram(prog);

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const aPos = gl.getAttribLocation(prog, 'aPos');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        const uRes = gl.getUniformLocation(prog, 'uRes');
        const uTime = gl.getUniformLocation(prog, 'uTime');

        // Calidad adaptativa: el shader es suave (no necesita resolucion
        // nativa) asi que, si el dispositivo no llega a ~40 fps, se baja la
        // resolucion del canvas por pasos (hasta 50%) en vez de trabarse.
        // En pantallas tactiles se limita a ~30 fps (el fondo se mueve
        // despacio: no se nota y se ahorra la mitad de GPU/bateria).
        // En móvil el fondo se dibuja a la mitad de resolución CSS (el shader
        // es un degradado suave: reescalado no se nota) y a ~24 fps, y se
        // congela mientras el dedo está desplazando la página -- el scroll
        // compite por la misma GPU y es lo que el usuario sí nota.
        const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        const dpr = coarse ? 0.5 : Math.min(window.devicePixelRatio || 1, 1.5);
        const minGap = coarse ? 41 : 0;
        let scale = 1, scrollingUntil = 0;
        if (coarse) {
            const marcar = () => { scrollingUntil = performance.now() + 180; };
            window.addEventListener('scroll', marcar, { passive: true });
            window.addEventListener('touchmove', marcar, { passive: true });
        }
        function resize() {
            const d = dpr * scale;
            canvas.width = Math.floor(window.innerWidth * d);
            canvas.height = Math.floor(window.innerHeight * d);
            gl.viewport(0, 0, canvas.width, canvas.height);
        }
        resize();
        window.addEventListener('resize', resize);

        let raf = null, last = 0, acc = 0, cnt = 0, badRounds = 0;
        const start = performance.now();
        const scaleFloor = coarse ? 0.3 : 0.5;
        function frame(now) {
            raf = requestAnimationFrame(frame);
            if (now < scrollingUntil) { last = 0; return; }
            if (minGap && now - last < minGap) return;
            const dt = last ? now - last : (minGap || 16);
            last = now;
            gl.uniform2f(uRes, canvas.width, canvas.height);
            gl.uniform1f(uTime, (now - start) / 1000);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            acc += dt; cnt++;
            // Ventana corta (~1.5-2s) para reaccionar rápido en vez de dejar
            // varios segundos de traqueteo visible antes de ajustar.
            if (cnt === 30) {
                const avg = acc / cnt; acc = 0; cnt = 0;
                const bad = avg > (minGap ? 70 : 26);
                if (bad && scale > scaleFloor) {
                    scale = Math.max(scaleFloor, scale * 0.7); resize(); badRounds = 0;
                } else if (bad && scale <= scaleFloor) {
                    // Ya se bajó todo lo razonable y el dispositivo SIGUE sin
                    // poder sostenerlo -- los heurísticos de deviceMemory/
                    // hardwareConcurrency no detectan buena parte de los
                    // equipos reales de gama media/baja (celulares Android
                    // comunes reportan 4-8 núcleos y >=4GB igual). Confirmado
                    // esto con medición real, no una suposición: se apaga el
                    // WebGL del todo y se cae al fondo estático -- gasto cero
                    // de GPU en vez de seguir intentando a costa de la
                    // fluidez, que es justo lo que el usuario está pidiendo.
                    badRounds++;
                    if (badRounds >= 2) {
                        cancelAnimationFrame(raf);
                        canvas.remove();
                        _mountStaticFallbackBackground();
                        return;
                    }
                } else {
                    badRounds = 0;
                }
            }
        }
        // Pausa el rAF cuando la pestaña no esta visible -- evita quemar GPU
        // en una pestaña de fondo (WebGL sigue corriendo aunque no se vea).
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = null; }
            else if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
        });
        raf = requestAnimationFrame(frame);
    }

    // Resplandor de color propio al hover + grano animado sutil "retro" en
    // TODAS las .glass-card del ecosistema (referencia: nlt.relioops.com,
    // donde cada tarjeta brilla con el color de su propio ícono al pasar el
    // mouse). Una sola inyección de CSS, sin tocar el markup de cada
    // tarjeta existente -- .glass-card ya es la clase base compartida por
    // las tarjetas de las ~46 páginas del sitio. El color default (azul) se
    // usa salvo que la tarjeta declare --card-glow-rgb (así lo hace
    // NLT_MODULES / renderModuleStrip, con un color distinto por módulo).
    function mountCardEffects() {
        if (document.getElementById('nlt-card-style')) return;
        const style = document.createElement('style');
        style.id = 'nlt-card-style';
        style.textContent = `
            .glass-card {
                --card-glow-rgb: 67,120,255;
                --mx: 50%; --my: 50%;
                position: relative; overflow: hidden;
                transition: border-color 0.4s ease, box-shadow 0.4s ease, transform 0.4s ease;
            }
            .glass-card:hover {
                border-color: rgba(var(--card-glow-rgb), 0.45);
                box-shadow: 0 20px 50px -18px rgba(var(--card-glow-rgb), 0.35);
            }
            .glass-card::before {
                content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
                background: radial-gradient(240px circle at var(--mx) var(--my), rgba(var(--card-glow-rgb), 0.22), transparent 70%);
                opacity: 0; transition: opacity 0.35s ease; z-index: 0;
            }
            .glass-card:hover::before { opacity: 1; }
            .glass-card::after {
                content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
                background-image: url("assets/img/grain.png");
                background-size: 90px 90px; background-repeat: repeat;
                mix-blend-mode: screen; opacity: 0.045; z-index: 0;
                animation: nlt-card-grain 0.5s steps(2) infinite;
            }
            @keyframes nlt-card-grain {
                0%, 100% { opacity: 0.03; }
                50%      { opacity: 0.07; }
            }
            @media (prefers-reduced-motion: reduce) {
                .glass-card::after { animation: none; }
            }

            /* "Chip" 3D en cada ícono -- referencia: los chips/procesadores
               animados de nlt.relioops.com. Perspectiva real por tarjeta,
               inclinación que sigue al cursor mientras hay hover, y un idle
               sutil (mini oscilación continua) cuando no hay hover, para que
               se sienta "viva" incluso sin interacción. Se apoya en
               --tilt-x/--tilt-y, que el mismo listener del spotlight
               actualiza mas abajo -- ningun listener nuevo. */
            .icon-wrap {
                --tilt-x: 0deg; --tilt-y: 0deg;
                perspective: 500px;
                transform-style: preserve-3d;
            }
            .icon-wrap i {
                display: inline-block;
                transform: translateZ(10px) rotateX(var(--tilt-y)) rotateY(var(--tilt-x));
                transition: transform 0.15s ease-out;
                animation: nlt-chip-idle 5.5s ease-in-out infinite;
            }
            .glass-card:hover .icon-wrap i { animation-play-state: paused; }
            @keyframes nlt-chip-idle {
                0%, 100% { transform: translateZ(10px) rotateX(0deg) rotateY(0deg); }
                50%      { transform: translateZ(10px) rotateX(7deg) rotateY(-9deg); }
            }
            @media (prefers-reduced-motion: reduce) {
                .icon-wrap i { animation: none !important; transform: none !important; }
            }
            /* Móvil: sin hover no hay spotlight ni inclinación que mostrar, y
               el grano parpadeante (mix-blend-mode) + el vaivén de cada ícono
               repintaban todas las tarjetas visibles 2-60 veces por segundo.
               Queda el mismo grano, estático. */
            @media (hover: none), (pointer: coarse) {
                /* El blur(24px) de cada tarjeta sobre el fondo animado obligaba
                   a la GPU a re-desenfocar todas las tarjetas visibles en cada
                   frame del fondo -- la causa principal de los tirones al hacer
                   scroll en el celular. El fondo es un degradado suave: sin
                   el blur la tarjeta se ve prácticamente igual. */
                .glass-card { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
                .glass-card::after { animation: none; opacity: 0.045; }
                .glass-card::before { display: none; }
                .icon-wrap { perspective: none; transform-style: flat; }
                .icon-wrap i { animation: none; transform: none; transition: none; }
            }
        `;
        document.head.appendChild(style);

        // Spotlight que sigue al cursor DENTRO de cada tarjeta + inclinacion
        // 3D del icono en la misma direccion -- un solo listener delegado en
        // document, no uno por tarjeta.
        document.addEventListener('pointermove', (e) => {
            const card = e.target.closest && e.target.closest('.glass-card');
            if (!card) return;
            const r = card.getBoundingClientRect();
            const px = e.clientX - r.left;
            const py = e.clientY - r.top;
            card.style.setProperty('--mx', `${px}px`);
            card.style.setProperty('--my', `${py}px`);
            const icon = card.querySelector('.icon-wrap');
            if (icon) {
                const nx = (px / r.width) * 2 - 1;   // -1..1
                const ny = (py / r.height) * 2 - 1;  // -1..1
                icon.style.setProperty('--tilt-x', `${nx * 16}deg`);
                icon.style.setProperty('--tilt-y', `${-ny * 16}deg`);
            }
        }, { passive: true });
    }

    // Header "glass" al hacer scroll, estilo Apple -- arriba de todo el
    // <header> queda transparente/minimalista (sin blur ni sombra); al
    // scrollear mas alla de un umbral chico, aparece con transicion suave
    // el fondo glass (blur + sombra) y se compacta un poco en altura. El
    // header ya usa la clase compartida .nav-blur (siempre "on" antes de
    // esto) en las ~23 paginas publicas -- este override CSS + un listener
    // de scroll universal alcanzan sin editar cada pagina.
    function mountNavScrollEffect() {
        if (document.getElementById('nlt-nav-style')) return;
        const style = document.createElement('style');
        style.id = 'nlt-nav-style';
        style.textContent = `
            header.nav-blur {
                transition: background-color 0.45s cubic-bezier(0.16,1,0.3,1),
                            backdrop-filter 0.45s cubic-bezier(0.16,1,0.3,1),
                            box-shadow 0.45s cubic-bezier(0.16,1,0.3,1),
                            border-color 0.45s cubic-bezier(0.16,1,0.3,1);
            }
            header.nav-blur:not(.nlt-nav-scrolled) {
                background-color: transparent !important;
                backdrop-filter: none !important;
                border-color: transparent !important;
                box-shadow: none;
            }
            header.nav-blur.nlt-nav-scrolled {
                background-color: rgba(8, 10, 15, 0.6) !important;
                backdrop-filter: blur(20px) saturate(1.4) !important;
                -webkit-backdrop-filter: blur(20px) saturate(1.4) !important;
                box-shadow: 0 8px 30px -10px rgba(0, 0, 0, 0.5);
            }
            @media (hover: none), (pointer: coarse) {
                header.nav-blur.nlt-nav-scrolled {
                    background-color: rgba(8, 10, 15, 0.78) !important;
                    backdrop-filter: blur(12px) !important;
                    -webkit-backdrop-filter: blur(12px) !important;
                }
            }
        `;
        document.head.appendChild(style);

        const header = document.querySelector('header.nav-blur') || document.querySelector('header');
        if (!header) return;
        const THRESHOLD = 24;
        function update() {
            header.classList.toggle('nlt-nav-scrolled', window.scrollY > THRESHOLD);
        }
        update();
        window.addEventListener('scroll', update, { passive: true });
    }

    // Scroll-story (firma visual del ecosistema): secciones .nlt-story con un
    // objeto 3D de capas PEGADO al costado (.nlt-chip-stack) atado a una lista
    // de pasos (.space-y-3 > .flex). Scroll = avanza el paso activo, su capa
    // sube y brilla, el objeto gira como plato giratorio y un destello cruza
    // el vidrio; hover sobre un paso ilumina su capa. Un solo loop rAF con
    // inercia, activo solo mientras alguna seccion esta a la vista. El color
    // de acento sale del numero del primer paso de cada seccion. Se monta
    // solo (ver _autoMountVisualEffects) en cualquier pagina que tenga
    // .nlt-story -- index.html y ecosystem.html hoy.
    function mountStories() {
        if (!document.querySelector('.nlt-story') || document.getElementById('nlt-story-style')) return;
        const style = document.createElement('style');
        style.id = 'nlt-story-style';
        style.textContent = `
        /* ------------------------------------------------------------------
           Secciones de producto = "scroll-story": el objeto 3D queda PEGADO al
           costado (sticky) mientras se lee, y esta atado al texto -- cada paso
           01..04 ilumina y levanta SU capa, el objeto gira segun el scroll
           (plato giratorio), un destello cruza el vidrio, y al pasar el mouse
           por un paso se ilumina su capa. El movimiento lo calcula un solo
           loop (JS, mas abajo) con inercia; el CSS solo define forma y estados.
           ------------------------------------------------------------------ */
        /* overflow-x:hidden en <body> (junto con el de <html>) lo vuelve un
           contenedor de scroll y el sticky deja de funcionar contra el
           viewport -- clip recorta igual sin crear contenedor de scroll. */
        body { overflow-x: clip; }
        .nlt-story-grid { display: grid; grid-template-columns: 1fr; gap: 1.25rem; align-items: start; }
        @media (min-width: 480px)  { .nlt-story-grid { grid-template-columns: 1fr 1fr; gap: 2rem; } }
        @media (min-width: 1024px) { .nlt-story-grid { gap: 4rem; } }
        /* En teléfono el objeto va arriba del texto: si quedara sticky, los
           pasos pasarían por debajo de él al hacer scroll (texto tapado). */
        @media (max-width: 479px)  { .nlt-story-grid > .nlt-chip-stack { order: -1; position: relative; top: auto; } }

        .nlt-chip-stack {
            perspective: 1100px; height: clamp(160px, 44vw, 300px);
            display: flex; align-items: center; justify-content: center;
            position: sticky; top: 96px; align-self: start;
        }
        .nlt-chip-inner {
            --w: 1;
            position: relative; width: calc(var(--w) * clamp(110px, 26vw, 190px)); aspect-ratio: 1;
            transform-style: preserve-3d;
            transform: rotateX(55deg) rotateZ(-45deg);
            will-change: transform;
        }
        .nlt-chip-stack:not(.nlt-in) .nlt-chip-part { opacity: 0; }
        .nlt-chip-part { opacity: 1; transition: opacity 0.6s ease; }

        .nlt-chip-part.nlt-shape-layer {
            position: absolute; inset: 0; border-radius: 28px; backdrop-filter: blur(6px);
            --a: 0; will-change: transform;
        }
        .nlt-chip-top { display: flex; align-items: center; justify-content: center; }

        /* Capa activa: aro de luz del color del producto (--a = 0..1 lo anima el JS). */
        .nlt-shape-layer::after {
            content: ''; position: absolute; inset: -1px; border-radius: inherit; pointer-events: none;
            border: 1px solid rgba(var(--acc), 1);
            box-shadow: 0 0 34px -4px rgba(var(--acc), 0.9), inset 0 0 26px rgba(var(--acc), 0.28);
            opacity: var(--a);
        }
        /* Destello: una franja de luz que cruza el vidrio segun el scroll (--sheen 0..1). */
        .nlt-shape-layer::before {
            content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
            background: linear-gradient(115deg,
                transparent calc(var(--sheen, 0) * 100% - 22%),
                rgba(255,255,255,0.14) calc(var(--sheen, 0) * 100%),
                transparent calc(var(--sheen, 0) * 100% + 22%));
        }

        /* Pasos: el activo se enciende, los demas quedan en segundo plano. */
        .nlt-story { --acc: 67,120,255; }
        .nlt-story .nlt-step { position: relative; opacity: 0.82; transition: opacity 0.45s ease; cursor: default; }
        .nlt-story .nlt-step > span:first-child { filter: brightness(1.25); }
        .nlt-story .nlt-step:not(.is-active) h3 { color: #d1d5db; }
        .nlt-story .nlt-step.is-active { opacity: 1; }
        .nlt-story .nlt-step::before {
            content: ''; position: absolute; left: -14px; top: 2px; bottom: 2px; width: 2px; border-radius: 2px;
            background: rgba(var(--acc), 1); box-shadow: 0 0 10px rgba(var(--acc), 0.8);
            transform: scaleY(0); transform-origin: top; transition: transform 0.5s cubic-bezier(0.16,1,0.3,1);
        }
        .nlt-story .nlt-step.is-active::before { transform: scaleY(1); }
        .nlt-story .nlt-step.is-active > span:first-child { text-shadow: 0 0 14px rgba(var(--acc), 0.9); }

        @media (prefers-reduced-motion: reduce) {
            .nlt-chip-part { transition: none; }
            .nlt-story .nlt-step, .nlt-story .nlt-step::before { transition: none; }
        }
        /* Móvil: el desenfoque detrás de capas 3D se recalcula en cada frame
           y era lo más caro de la sección; las capas ya son casi opacas. */
        @media (hover: none), (pointer: coarse) {
            .nlt-chip-part.nlt-shape-layer { backdrop-filter: none; -webkit-backdrop-filter: none; }
            .nlt-shape-layer::after { box-shadow: 0 0 22px -6px rgba(var(--acc), 0.8); }
        }
        `;
        document.head.appendChild(style);
        (function () {
            const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
            const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

            const stories = Array.from(document.querySelectorAll('.nlt-story')).map((sec, idx) => {
                const stack = sec.querySelector('.nlt-chip-stack');
                const inner = stack && stack.querySelector('.nlt-chip-inner');
                if (!inner) return null;
                const layers = Array.from(inner.querySelectorAll('.nlt-shape-layer'));
                const steps = Array.from(sec.querySelectorAll('.space-y-3 > .flex')).map((el) => { el.classList.add('nlt-step'); return el; });
                // color de acento = el del numero del primer paso (cada producto ya lo tiene)
                const numEl = steps[0] && steps[0].querySelector('span');
                const rgb = numEl ? (getComputedStyle(numEl).color.match(/\d+/g) || []).slice(0, 3) : [];
                if (rgb.length === 3) sec.style.setProperty('--acc', rgb.join(','));
                const zs = layers.map((l) => parseFloat(getComputedStyle(l).getPropertyValue('--z')) || 0);
                const s = {
                    idx, sec, stack, inner, layers, steps, zs,
                    p: 0.5, e: 0, reveal: 0, visible: false, seen: false,
                    tx: 0, ty: 0, stx: 0, sty: 0,
                    act: layers.map(() => 0), step: -1, hover: -1,
                };
                // hover sobre un paso = ilumina su capa
                steps.forEach((el, i) => {
                    el.addEventListener('pointerenter', () => { s.hover = i; if (reduce) render(s, 0); ensure(); });
                    el.addEventListener('pointerleave', () => { s.hover = -1; if (reduce) render(s, 0); });
                });
                // inclinacion con el mouse sobre el objeto
                stack.addEventListener('pointermove', (ev) => {
                    const r = stack.getBoundingClientRect();
                    s.tx = clamp(((ev.clientX - r.left) / r.width) * 2 - 1, -1, 1);
                    s.ty = clamp(((ev.clientY - r.top) / r.height) * 2 - 1, -1, 1);
                    if (reduce) render(s, 0); else ensure();
                }, { passive: true });
                stack.addEventListener('pointerleave', () => { s.tx = 0; s.ty = 0; if (reduce) render(s, 0); }, { passive: true });
                return s;
            }).filter(Boolean);
            if (!stories.length) return;

            const layerOf = (s, step) => clamp(s.layers.length - 1 - step, 0, s.layers.length - 1);
            // Rendimiento (móvil): la escala se mide solo al montar y en resize
            // -- leerla en cada frame (offsetWidth + getComputedStyle entre
            // escrituras de transform) forzaba un layout síncrono por frame.
            // En pantallas táctiles no hay vaivén continuo: el loop se apaga
            // solo en cuanto todo llega a reposo y el scroll lo vuelve a encender.
            const touch = window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches;
            function medir() {
                stories.forEach((s) => {
                    s.scale = (s.inner.offsetWidth / (parseFloat(getComputedStyle(s.inner).getPropertyValue('--w')) || 1)) / 190 || 1;
                });
            }
            medir();

            function render(s, t) {
                const scale = s.scale;
                const spread = (0.3 + 0.85 * s.e) * s.reveal;
                const N = Math.max(1, s.steps.length);
                const q = clamp((s.p - 0.3) / 0.4, 0, 0.999);
                const step = s.hover >= 0 ? s.hover : Math.floor(q * N);
                if (step !== s.step) {
                    s.step = step;
                    s.steps.forEach((el, i) => el.classList.toggle('is-active', i === step));
                    // secciones multicolor (ecosystem.html): el aro y el riel
                    // toman el color de la categoria activa (data-acc="r,g,b")
                    const c = s.steps[step] && s.steps[step].getAttribute('data-acc');
                    if (c) s.sec.style.setProperty('--acc', c);
                }
                const target = layerOf(s, step);
                s.layers.forEach((l, i) => {
                    const want = i === target ? 1 : 0;
                    s.act[i] += (want - s.act[i]) * (reduce ? 1 : 0.16);
                    if (Math.abs(want - s.act[i]) < 0.002) s.act[i] = want;
                    const z = (s.zs[i] * spread * scale + s.act[i] * 18 * scale).toFixed(1);
                    const a = s.act[i].toFixed(2);
                    // Solo se escribe lo que cambió: cada escritura de --a
                    // recalcula estilos de la capa y repinta su aro de luz.
                    if (l._z !== z) { l._z = z; l.style.transform = 'translateZ(' + z + 'px)'; }
                    if (l._a !== a) { l._a = a; l.style.setProperty('--a', a); }
                });
                const rx = 55 - s.sty * 9;
                const rz = -45 + (s.p - 0.5) * 46 + s.stx * 12;
                const bob = (reduce || touch) ? 0 : Math.sin(t * 0.9 + s.idx) * 3;
                const tr = 'translateY(' + bob.toFixed(2) + 'px) rotateX(' + rx.toFixed(2) + 'deg) rotateZ(' + rz.toFixed(2) + 'deg)';
                if (s._tr !== tr) { s._tr = tr; s.inner.style.transform = tr; }
                // --sheen va en el objeto (no en la sección): así solo
                // recalcula estilos de las capas, no de todo el texto.
                const sh = (s.p * 1.5 - 0.25).toFixed(3);
                if (s._sh !== sh) { s._sh = sh; s.inner.style.setProperty('--sheen', sh); }
            }

            let running = false;
            function frame(now) {
                const t = now / 1000, vh = window.innerHeight;
                const vis = stories.filter((s) => s.visible);
                // Primero todas las lecturas de layout, después todas las escrituras.
                const rects = vis.map((s) => s.sec.getBoundingClientRect());
                let moving = false;
                vis.forEach((s, k) => {
                    const r = rects[k];
                    const d = ((r.top + r.height / 2) - vh / 2) / (vh / 2 + r.height / 2); // +1 abajo .. -1 arriba
                    const p = clamp((1 - d) / 2, 0, 1);
                    const e = clamp(1 - Math.pow(Math.abs(d), 1.5), 0, 1);
                    s.p += (p - s.p) * 0.12;
                    s.e += (e - s.e) * 0.10;
                    s.reveal += (1 - s.reveal) * 0.05;
                    s.stx += (s.tx - s.stx) * 0.10;
                    s.sty += (s.ty - s.sty) * 0.10;
                    render(s, t);
                    if (!touch || Math.abs(p - s.p) + Math.abs(e - s.e) + (1 - s.reveal) + Math.abs(s.tx - s.stx) + Math.abs(s.ty - s.sty) > 0.003
                        || s.act.some((v) => v > 0.002 && v < 0.998)) moving = true;
                });
                if (vis.length && moving) requestAnimationFrame(frame); else running = false;
            }
            function ensure() { if (!running && !reduce) { running = true; requestAnimationFrame(frame); } }
            if (touch) window.addEventListener('scroll', ensure, { passive: true });
            window.addEventListener('resize', () => { medir(); ensure(); }, { passive: true });

            if (reduce) {
                stories.forEach((s) => { s.reveal = 1; s.e = 0.7; s.p = 0.5; s.stack.classList.add('nlt-in'); render(s, 0); });
                return;
            }
            const io = new IntersectionObserver((entries) => {
                entries.forEach((en) => {
                    const s = stories.find((x) => x.sec === en.target);
                    if (!s) return;
                    s.visible = en.isIntersecting;
                    if (en.isIntersecting) { s.seen = true; }
                });
                ensure();
            }, { rootMargin: '120px 0px 120px 0px' });
            stories.forEach((s) => io.observe(s.sec));
        })();
    }

    // Aliados del ecosistema -- "constelacion": NLT al centro y cada partner en una orbita de vidrio unida por
    // lineas de datos con un punto de luz viajando hacia el aliado. Hasta 8 partners = constelacion (escritorio)
    // o grilla (movil); mas de 8 = cinta que corre despacio. SOLO partners reales, de los mismos endpoints
    // publicos que ya usan partners.html, broker.html y funded.html; si no hay ninguno (o falla el backend)
    // la seccion queda oculta -- nunca se inventan logos ni nombres.
    function _mqEsc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    const _PARTNER_TINT = { broker: '45,212,191', fondeo: '245,158,11', funding: '245,158,11', prop: '245,158,11', technology: '34,211,238', tecnologia: '34,211,238', tecnología: '34,211,238', education: '236,72,153', educacion: '236,72,153', educación: '236,72,153', media: '168,85,247' };
    function _partnerTint(cat) {
        const k = String(cat || '').toLowerCase();
        for (const key in _PARTNER_TINT) if (k.includes(key)) return _PARTNER_TINT[key];
        return '67,120,255';
    }
    async function _fetchPartnersReales() {
        const api = window.NLT_API;
        if (!api) return [];
        const pedir = (fn) => (typeof fn === 'function' ? Promise.resolve().then(() => fn()) : Promise.reject(new Error('sin endpoint')));
        const [nlt, brokers, hub] = await Promise.allSettled([pedir(api.partnersPublicos), pedir(api.brokerListarProviders), pedir(api.propHubListarPartners)]);
        const lista = (r) => (r.status === 'fulfilled' ? (Array.isArray(r.value) ? r.value : (r.value && (r.value.partners || r.value.items)) || []) : []);
        const out = [];
        lista(nlt).forEach((p) => p && p.company_name && out.push({ name: p.company_name, logo: p.logo_url, cat: p.category || 'Partner', href: 'partners.html' }));
        lista(brokers).forEach((b) => b && b.nombre && b.status === 'ACTIVE' && out.push({ name: b.nombre, logo: b.logo_url, cat: 'Broker', href: 'broker.html' }));
        lista(hub).forEach((h) => h && h.name && out.push({ name: h.name, logo: h.logo_url, cat: 'Fondeo', href: h.slug ? `funded-detail.html?slug=${encodeURIComponent(h.slug)}` : 'funded.html' }));
        const seen = new Set();
        return out.filter((p) => { const k = p.name.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    }

    async function mountPartnersMarquee(containerId = 'partnersMarquee') {
        const box = document.getElementById(containerId);
        if (!box || box.dataset.mounted) return;
        box.dataset.mounted = '1';
        // nlt-api-client.js es otro <script defer> que corre DESPUES de este archivo: si todavia no esta, esperar a "load".
        if (!window.NLT_API && document.readyState !== 'complete') await new Promise((res) => window.addEventListener('load', res, { once: true }));
        const list = await _fetchPartnersReales();
        if (!list.length) return;

        if (!document.getElementById('nlt-partners-style')) {
            const style = document.createElement('style');
            style.id = 'nlt-partners-style';
            style.textContent = `
                .nlt-pt { --c: 67,120,255; position: relative; display: flex; align-items: center; gap: 11px; padding: 12px 18px 12px 12px; border-radius: 16px; white-space: nowrap; text-decoration: none; color: #cbd5e1;
                          background: linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015)); border: 1px solid rgba(255,255,255,0.08); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
                          transition: border-color .35s ease, box-shadow .35s ease, transform .35s cubic-bezier(.16,1,.3,1), color .3s ease; --mx: 50%; --my: 50%; }
                .nlt-pt::before { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; opacity: 0; transition: opacity .35s ease;
                                  background: radial-gradient(150px circle at var(--mx) var(--my), rgba(var(--c), .22), transparent 70%); }
                .nlt-pt:hover, .nlt-pt.hot { color: #fff; border-color: rgba(var(--c), .55); box-shadow: 0 14px 40px -16px rgba(var(--c), .6); }
                .nlt-pt:hover::before { opacity: 1; }
                .nlt-pt-logo, .nlt-pt-ini { width: 34px; height: 34px; border-radius: 10px; flex: none; }
                .nlt-pt-logo { object-fit: cover; filter: grayscale(1) brightness(1.15); opacity: .82; transition: filter .35s ease, opacity .35s ease; }
                .nlt-pt:hover .nlt-pt-logo, .nlt-pt.hot .nlt-pt-logo { filter: none; opacity: 1; }
                .nlt-pt-ini { display: grid; place-items: center; font: 800 12px Geist, Inter, sans-serif; color: rgb(var(--c)); background: rgba(var(--c), .12); border: 1px solid rgba(var(--c), .3); }
                .nlt-pt-name { display: block; font: 600 14px/1.15 Geist, Inter, sans-serif; letter-spacing: -.01em; }
                .nlt-pt-cat { display: block; margin-top: 3px; font: 700 8.5px/1 'SFMono-Regular', Consolas, monospace; letter-spacing: .18em; text-transform: uppercase; color: rgba(var(--c), .9); }
                /* marcas de esquina tipo HUD */
                .nlt-pt::after { content: ''; position: absolute; inset: 5px; border-radius: 11px; pointer-events: none; opacity: .5; transition: opacity .35s ease;
                    background: linear-gradient(rgba(var(--c),.7), rgba(var(--c),.7)) top left / 8px 1px no-repeat, linear-gradient(rgba(var(--c),.7), rgba(var(--c),.7)) top left / 1px 8px no-repeat,
                                linear-gradient(rgba(var(--c),.7), rgba(var(--c),.7)) bottom right / 8px 1px no-repeat, linear-gradient(rgba(var(--c),.7), rgba(var(--c),.7)) bottom right / 1px 8px no-repeat; }
                .nlt-pt:hover::after { opacity: 1; }

                /* constelacion */
                .nlt-const { position: relative; width: 100%; max-width: 1000px; margin: 0 auto; aspect-ratio: 1000 / 400; }
                .nlt-const svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
                .nlt-const .ln { fill: none; stroke: rgba(120,160,255,.28); stroke-width: 1; stroke-dasharray: 3 7; animation: nlt-dash 2.6s linear infinite; transition: stroke .3s ease; }
                .nlt-const .ln.hot { stroke: rgba(150,185,255,.85); }
                .nlt-const .pk { fill: rgb(170,200,255); filter: drop-shadow(0 0 5px rgba(120,160,255,.95)); }
                @keyframes nlt-dash { to { stroke-dashoffset: -20; } }
                .nlt-const .nlt-pt { position: absolute; transform: translate(-50%, -50%); }
                .nlt-const .nlt-pt:hover { transform: translate(-50%, -50%) translateY(-3px); }
                .nlt-const-core { position: absolute; left: 50%; top: 50%; width: 70px; height: 70px; margin: -35px 0 0 -35px; border-radius: 22px; display: grid; place-items: center;
                                  background: linear-gradient(135deg, rgba(67,120,255,.28), rgba(14,18,28,.95)); border: 1px solid rgba(120,160,255,.6); box-shadow: 0 0 60px -6px rgba(67,120,255,.75), inset 0 1px 0 rgba(255,255,255,.18); }
                .nlt-const-core img { width: 34px; height: 34px; filter: drop-shadow(0 0 8px rgba(120,160,255,.8)); }
                .nlt-const-core i { position: absolute; inset: -1px; border-radius: 22px; border: 1px solid rgba(120,160,255,.65); opacity: 0; animation: nlt-ping 3.4s ease-out infinite; }
                .nlt-const-core i:nth-child(2) { animation-delay: 1.7s; }
                @keyframes nlt-ping { 0% { transform: scale(1); opacity: .8; } 100% { transform: scale(2.6); opacity: 0; } }
                .nlt-const, .nlt-const * { animation-play-state: paused; } .nlt-const.live, .nlt-const.live * { animation-play-state: running; }

                /* cinta (mas de 8 partners) */
                .nlt-marquee { overflow: hidden; -webkit-mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent); mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent); }
                .nlt-marquee-track { display: flex; gap: 14px; width: max-content; animation: nlt-marquee var(--dur, 40s) linear infinite; }
                .nlt-marquee:hover .nlt-marquee-track { animation-play-state: paused; }
                @keyframes nlt-marquee { to { transform: translateX(-50%); } }

                @media (max-width: 760px) {
                    .nlt-const { aspect-ratio: auto; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
                    .nlt-const svg, .nlt-const-core { display: none; }
                    .nlt-const .nlt-pt { position: relative; left: auto !important; top: auto !important; transform: none !important; white-space: normal; min-width: 0; }
                    .nlt-pt-name { overflow: hidden; text-overflow: ellipsis; }
                }
                @media (prefers-reduced-motion: reduce) {
                    .nlt-const .ln, .nlt-const-core i, .nlt-marquee-track { animation: none; }
                    .nlt-const .pk { display: none; } .nlt-marquee { overflow-x: auto; -webkit-mask-image: none; mask-image: none; }
                }
            `;
            document.head.appendChild(style);
        }

        const tile = (p, i) => {
            const ini = p.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
            const okLogo = typeof p.logo === 'string' && /^https?:\/\//i.test(p.logo);
            const logo = okLogo ? `<img class="nlt-pt-logo" src="${_mqEsc(p.logo)}" alt="" loading="lazy" decoding="async">` : `<span class="nlt-pt-ini">${_mqEsc(ini)}</span>`;
            return { i, html: (style) => `<a href="${_mqEsc(p.href)}" class="nlt-pt" data-i="${i}" style="--c:${_partnerTint(p.cat)};${style || ''}">${logo}<span><span class="nlt-pt-name">${_mqEsc(p.name)}</span><span class="nlt-pt-cat">${_mqEsc(p.cat)}</span></span></a>` };
        };
        const tiles = list.map(tile);

        if (list.length <= 8) {
            // posiciones en una elipse (porcentajes de 1000x400); 1-2 partners = izquierda/derecha
            const n = list.length, W = 1000, H = 400, cx = W / 2, cy = H / 2, rx = n === 1 ? 0 : 385, ry = 135;
            const pos = tiles.map((t, k) => {
                const a = n === 1 ? -Math.PI / 2 : n === 2 ? (k === 0 ? Math.PI : 0) : -Math.PI / 2 + (k * 2 * Math.PI) / n;
                return { x: cx + rx * Math.cos(a), y: n === 1 ? cy - 130 : cy + ry * Math.sin(a) };
            });
            const lines = pos.map((q, k) => `<path class="ln" data-i="${k}" d="M${cx},${cy} L${q.x.toFixed(1)},${q.y.toFixed(1)}"/>`).join('');
            const pk = pos.map((q, k) => `<circle class="pk" r="2.4"><animateMotion dur="${(3.2 + (k % 3) * 0.5).toFixed(1)}s" begin="${(k * 0.55).toFixed(2)}s" repeatCount="indefinite" path="M${cx},${cy} L${q.x.toFixed(1)},${q.y.toFixed(1)}" keyTimes="0;1" keyPoints="0;1" calcMode="linear"/></circle>`).join('');
            box.innerHTML = `<div class="nlt-const">
                <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${lines}${pk}</svg>
                <div class="nlt-const-core" aria-hidden="true"><i></i><i></i><img src="assets/img/nlt-icon.png" alt=""></div>
                ${tiles.map((t, k) => t.html(`left:${(pos[k].x / W * 100).toFixed(2)}%;top:${(pos[k].y / H * 100).toFixed(2)}%`)).join('')}
            </div>`;
            const root = box.firstElementChild;
            const svg = root.querySelector('svg');
            root.addEventListener('pointermove', (e) => {
                const t = e.target.closest && e.target.closest('.nlt-pt');
                if (!t) return;
                const r = t.getBoundingClientRect();
                t.style.setProperty('--mx', (e.clientX - r.left) + 'px'); t.style.setProperty('--my', (e.clientY - r.top) + 'px');
            }, { passive: true });
            root.querySelectorAll('.nlt-pt').forEach((t) => {
                const line = root.querySelector(`.ln[data-i="${t.dataset.i}"]`);
                const on = () => { t.classList.add('hot'); if (line) line.classList.add('hot'); };
                const off = () => { t.classList.remove('hot'); if (line) line.classList.remove('hot'); };
                t.addEventListener('pointerenter', on); t.addEventListener('pointerleave', off); t.addEventListener('focus', on); t.addEventListener('blur', off);
            });
            if ('IntersectionObserver' in window) {
                new IntersectionObserver((es) => {
                    const v = es[0].isIntersecting;
                    root.classList.toggle('live', v);
                    if (svg.pauseAnimations) { v ? svg.unpauseAnimations() : svg.pauseAnimations(); }
                }, { threshold: 0.05 }).observe(root);
            } else { root.classList.add('live'); }
        } else {
            const reps = Math.max(1, Math.ceil((window.innerWidth * 1.25) / (list.length * 200)));
            const half = Array.from({ length: reps }, () => tiles.map((t) => t.html('')).join('')).join('');
            box.classList.add('nlt-marquee');
            box.innerHTML = `<div class="nlt-marquee-track" style="--dur:${Math.max(28, list.length * reps * 5)}s">${half}${half}</div>`;
        }
        const sec = box.closest('section');
        if (sec) sec.hidden = false;
    }

    // ------------------------------------------------------------------
    // Capa "app premium" del dashboard y del resto de paginas con sidebar:
    //   - Numeros que cuentan al cambiar (data-countup) -- solo animan
    //     valores REALES que llegan del backend, nunca un numero inventado.
    //   - Entrada escalonada de las tarjetas.
    //   - Paleta de comandos Ctrl/Cmd+K para saltar a cualquier seccion.
    // ------------------------------------------------------------------
    function mountCountUp() {
        const els = document.querySelectorAll('[data-countup]');
        if (!els.length) return;
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        els.forEach((el) => {
            if (el.dataset.cuBound) return;
            el.dataset.cuBound = '1';
            let animating = false, last = null, shown = 0, raf = 0;
            const parse = (t) => { const m = /^(-?\d+(?:\.\d+)?)(.*)$/.exec(String(t).trim()); return m ? { n: parseFloat(m[1]), dec: (m[1].split('.')[1] || '').length, suf: m[2] } : null; };
            const obs = new MutationObserver(() => {
                if (animating) return;
                const txt = el.textContent;
                if (txt === last) return;
                last = txt;
                const p = parse(txt);
                if (!p) { shown = 0; return; }        // "—" u otro texto: sin animar
                if (reduce) { shown = p.n; return; }
                const from = shown, to = p.n, t0 = performance.now(), dur = 900;
                cancelAnimationFrame(raf);
                animating = true;
                const step = (now) => {
                    const k = Math.min((now - t0) / dur, 1);
                    const v = from + (to - from) * (1 - Math.pow(1 - k, 3));
                    el.textContent = v.toFixed(p.dec) + p.suf;
                    if (k < 1) { raf = requestAnimationFrame(step); } else { el.textContent = txt; animating = false; shown = to; last = txt; }
                };
                raf = requestAnimationFrame(step);
            });
            obs.observe(el, { childList: true, characterData: true, subtree: true });
        });
    }

    function mountAppEntrance() {
        if (!document.getElementById('sidebar') || document.getElementById('nlt-app-entrance')) return;
        const style = document.createElement('style');
        style.id = 'nlt-app-entrance';
        // `backwards` (no `both`): al terminar, la tarjeta vuelve a sus estilos
        // normales y el hover con transform sigue funcionando.
        style.textContent = `
            main .glass-card { animation: nlt-card-rise 0.6s cubic-bezier(0.16, 1, 0.3, 1) backwards; }
            main .glass-card:nth-child(2) { animation-delay: 0.06s; }
            main .glass-card:nth-child(3) { animation-delay: 0.12s; }
            main .glass-card:nth-child(4) { animation-delay: 0.18s; }
            main .glass-card:nth-child(n+5) { animation-delay: 0.24s; }
            @keyframes nlt-card-rise { from { opacity: 0; transform: translateY(14px); } }
            @media (prefers-reduced-motion: reduce) { main .glass-card { animation: none; } }
        `;
        document.head.appendChild(style);
    }

    function _paletteItems() {
        const out = [];
        const seen = new Set();
        const add = (label, href, icono, group, rgb, kw = '') => {
            if (!href || !label) return;
            const key = href + '|' + label;
            if (seen.has(key)) return;
            seen.add(key);
            out.push({ label, href, icono, group, rgb, kw });
        };
        const fromNav = (arr, group, rgb, base = '') => arr.forEach((i) => add(i.label, i.href.startsWith('#') ? (base || 'futuros.html') + i.href : i.href, i.icono, group, rgb));
        fromNav(NAV_CFD, 'Copy System', SECTION_RGB.cfd);
        fromNav(NAV_FUTURES_HOME, 'Futuros', SECTION_RGB.futures, 'futuros.html');
        fromNav(NAV_FUTURES_LINK, 'Futuros', SECTION_RGB.futures);
        fromNav(NAV_BROKER, 'NLT Broker', SECTION_RGB.broker);
        fromNav(NAV_PROPFIRM, 'NLT Funded', SECTION_RGB.propfirm);
        fromNav(NAV_SIGNALS, 'Elite Signals', SECTION_RGB.signals);
        fromNav(NAV_INDICATOR, 'Indicator', SECTION_RGB.indicator);
        fromNav(NAV_BOT, 'Bot Supreme', SECTION_RGB.bot);
        fromNav(NAV_CFD_AJUSTES, 'Ajustes', SECTION_RGB.cfd);
        fromNav(NAV_FUTURES_AJUSTES, 'Ajustes', SECTION_RGB.futures);
        add('Ecosistema NLT', 'ecosystem.html', 'ph-compass', 'Ecosistema', '67,120,255', 'productos inicio');
        add('NLT Bot Supreme', 'nlt-bot.html', 'ph-robot', 'Ecosistema', SECTION_RGB.bot, 'bot automatizado trading planes');
        add('Planes y precios', 'plans.html', 'ph-credit-card', 'Ecosistema', '67,120,255', 'suscripcion precios');
        NLT_MODULES.forEach((m) => add(m.nombre, m.href, m.icono, 'Ecosistema', m.color || '67,120,255', m.descripcion));
        _paletteActions.forEach((a) => out.push({ label: a.label, href: null, run: a.run, icono: a.icon || 'ph-lightning', group: 'Acciones', rgb: a.rgb || '67,120,255', kw: a.kw || '' }));
        // Recientes (sin la pagina actual): solo se muestran con la busqueda vacia.
        try {
            const rec = JSON.parse(localStorage.getItem('nlt_recent') || '[]');
            const here = location.pathname.split('/').pop() || 'index.html';
            const recItems = rec.filter((r) => r.href !== here).map((r) => { const base = out.find((o) => o.href === r.href); return base ? { ...base, group: 'Recientes', recent: true } : null; }).filter(Boolean).slice(0, 4);
            out.unshift(...recItems);
        } catch (_) { /* sin storage */ }
        return out;
    }

    function mountCommandPalette() {
        if (!document.getElementById('sidebar') || document.getElementById('nlt-palette-style')) return;
        const style = document.createElement('style');
        style.id = 'nlt-palette-style';
        style.textContent = `
            #nlt-pal { position: fixed; inset: 0; z-index: 200; display: none; align-items: flex-start; justify-content: center; padding: 14vh 16px 16px; background: rgba(4,6,10,0.62); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
            #nlt-pal.open { display: flex; animation: nlt-pal-fade 0.18s ease; }
            .nlt-pal-panel { width: 100%; max-width: 580px; border-radius: 22px; overflow: hidden; background: linear-gradient(180deg, rgba(20,25,36,0.96), rgba(11,14,21,0.98)); border: 1px solid rgba(255,255,255,0.09); box-shadow: 0 30px 80px -20px rgba(0,0,0,0.8), 0 0 0 1px rgba(67,120,255,0.12), 0 0 70px -20px rgba(67,120,255,0.35); animation: nlt-pal-pop 0.28s cubic-bezier(0.16, 1, 0.3, 1); }
            .nlt-pal-search { display: flex; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); }
            .nlt-pal-search i { font-size: 20px; color: #6b7280; }
            .nlt-pal-search input { flex: 1; min-width: 0; background: transparent; border: 0; outline: 0; color: #fff; font-size: 15px; }
            .nlt-pal-search input::placeholder { color: #6b7280; }
            .nlt-pal-list { max-height: min(52vh, 420px); overflow-y: auto; padding: 8px; }
            .nlt-pal-group { padding: 10px 12px 6px; font-size: 9px; font-weight: 800; letter-spacing: 0.18em; text-transform: uppercase; color: #6b7280; }
            .nlt-pal-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 13px; cursor: pointer; color: #cbd5e1; font-size: 14px; font-weight: 500; }
            .nlt-pal-item .ic { width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; font-size: 16px; flex: none; }
            .nlt-pal-item .lb { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .nlt-pal-item .hint { font-size: 11px; color: #6b7280; opacity: 0; transition: opacity .15s ease; }
            .nlt-pal-list.q .nlt-pal-item .hint { opacity: 1; }
            .nlt-pal-item.on { background: rgba(255,255,255,0.06); color: #fff; }
            .nlt-pal-item.on .hint { opacity: 1; }
            .nlt-pal-empty { padding: 34px 16px; text-align: center; font-size: 13px; color: #6b7280; }
            .nlt-pal-foot { display: flex; gap: 16px; padding: 10px 18px; border-top: 1px solid rgba(255,255,255,0.06); font-size: 11px; color: #6b7280; }
            .nlt-pal-foot kbd, .nlt-kbd { font-family: inherit; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.05); color: #9ca3af; }
            @keyframes nlt-pal-fade { from { opacity: 0; } }
            @keyframes nlt-pal-pop { from { opacity: 0; transform: translateY(-10px) scale(0.98); } }
            @media (prefers-reduced-motion: reduce) { #nlt-pal.open, .nlt-pal-panel { animation: none; } }
        `;
        document.head.appendChild(style);

        const root = document.createElement('div');
        root.id = 'nlt-pal';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-label', 'Buscar en NLT');
        root.innerHTML = `
            <div class="nlt-pal-panel">
                <div class="nlt-pal-search"><i class="ph ph-magnifying-glass"></i><input id="nlt-pal-input" type="text" autocomplete="off" spellcheck="false" placeholder="Ir a… (Dashboard, Cuentas, Bot, Journal)" aria-label="Buscar"><span class="nlt-kbd">Esc</span></div>
                <div class="nlt-pal-list" id="nlt-pal-list" role="listbox"></div>
                <div class="nlt-pal-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> navegar</span><span><kbd>↵</kbd> abrir</span><span><kbd>Esc</kbd> cerrar</span></div>
            </div>`;
        document.body.appendChild(root);

        try {
            const here = location.pathname.split('/').pop();
            if (here) { const rec = JSON.parse(localStorage.getItem('nlt_recent') || '[]').filter((r) => r.href !== here); rec.unshift({ href: here }); localStorage.setItem('nlt_recent', JSON.stringify(rec.slice(0, 8))); }
        } catch (_) { /* sin storage */ }
        const input = root.querySelector('#nlt-pal-input');
        const list = root.querySelector('#nlt-pal-list');
        const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        let items = [], shown = [], idx = 0, lastFocus = null;

        function render() {
            const q = norm(input.value).split(/\s+/).filter(Boolean);
            shown = items.filter((it) => { if (q.length && it.recent) return false; const hay = norm(it.label + ' ' + it.group + ' ' + it.kw); return q.every((t) => hay.includes(t)); });
            if (q.length) shown.sort((a, b) => (norm(b.label).startsWith(q[0]) ? 1 : 0) - (norm(a.label).startsWith(q[0]) ? 1 : 0));
            idx = Math.min(idx, Math.max(0, shown.length - 1));
            list.classList.toggle('q', q.length > 0);
            if (!shown.length) { list.innerHTML = '<div class="nlt-pal-empty">Sin resultados</div>'; return; }
            let html = '', g = null;
            shown.forEach((it, i) => {
                if (!q.length && it.group !== g) { g = it.group; html += `<div class="nlt-pal-group">${_mqEsc(g)}</div>`; }
                html += `<div class="nlt-pal-item${i === idx ? ' on' : ''}" role="option" data-i="${i}"><span class="ic" style="background:rgba(${it.rgb},0.12); border:1px solid rgba(${it.rgb},0.28); color:rgb(${it.rgb})"><i class="ph-fill ${_mqEsc(it.icono)}"></i></span><span class="lb">${_mqEsc(it.label)}</span><span class="hint">${q.length ? _mqEsc(it.group) + ' · ' : ''}↵</span></div>`;
            });
            list.innerHTML = html;
            const on = list.querySelector('.on');
            if (on) on.scrollIntoView({ block: 'nearest' });
        }
        function open() {
            if (root.classList.contains('open')) return;
            items = _paletteItems();
            lastFocus = document.activeElement;
            input.value = ''; idx = 0; render();
            root.classList.add('open');
            input.focus();
        }
        function close() {
            root.classList.remove('open');
            if (lastFocus && lastFocus.focus) lastFocus.focus();
        }
        function go(i) { const it = shown[i]; if (!it) return; if (it.run) { close(); it.run(); } else { window.location.href = it.href; } }

        input.addEventListener('input', () => { idx = 0; render(); });
        root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
        list.addEventListener('mousemove', (e) => { const el = e.target.closest('.nlt-pal-item'); if (el && +el.dataset.i !== idx) { idx = +el.dataset.i; list.querySelectorAll('.nlt-pal-item').forEach((n) => n.classList.toggle('on', +n.dataset.i === idx)); } });
        list.addEventListener('click', (e) => { const el = e.target.closest('.nlt-pal-item'); if (el) go(+el.dataset.i); });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(shown.length - 1, idx + 1); render(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); render(); }
            else if (e.key === 'Enter') { e.preventDefault(); go(idx); }
        });
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); root.classList.contains('open') ? close() : open(); }
            else if (e.key === 'Escape' && root.classList.contains('open')) { e.preventDefault(); close(); }
        });
        document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-nlt-palette]')) open(); });
    }

    // Secuencia de imagenes atada al scroll (estilo Apple): un render 3D
    // pre-calculado (ver /design-assets) que se "abre" en capas mientras se
    // baja por la seccion. Un canvas + N frames WebP, sin librerias 3D en
    // runtime: liviano y consistente en cualquier dispositivo. Los frames se
    // cargan cuando la seccion esta cerca de entrar en pantalla, y el loop
    // rAF solo corre mientras la seccion esta visible.
    function mountScrollSequence() {
        const secs = document.querySelectorAll('[data-seq-section]');
        if (!secs.length || document.getElementById('nlt-seq-style')) return;
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const style = document.createElement('style');
        style.id = 'nlt-seq-style';
        style.textContent = `
            .nlt-seq { position: relative; height: 320vh; }
            .nlt-seq-sticky { position: sticky; top: 0; height: 100vh; mix-blend-mode: screen; max-width: 72rem; margin: 0 auto; padding: 0 40px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: center; gap: 24px; }
            .nlt-seq-caps { position: relative; min-height: 260px; }
            .nlt-seq-cap { position: absolute; left: 28px; right: 0; top: 50%; transform: translateY(-46%); opacity: 0; pointer-events: none; transition: opacity .55s ease, transform .7s cubic-bezier(.16,1,.3,1); }
            .nlt-seq-cap.on { opacity: 1; transform: translateY(-50%); pointer-events: auto; }
            .nlt-seq-stage { position: relative; display: grid; place-items: center; }
            .nlt-seq-stage canvas { width: 100%; max-width: 660px; aspect-ratio: 1 / 1; }
            .nlt-seq-bar { position: absolute; left: 0; top: 18%; bottom: 18%; width: 2px; border-radius: 2px; background: rgba(255,255,255,.08); }
            .nlt-seq-bar i { position: absolute; left: 0; top: 0; width: 100%; height: 100%; transform-origin: top; transform: scaleY(var(--p, 0)); background: var(--seq-bar, linear-gradient(180deg, #22c55e, #a855f7, #ec4899, #4378ff, #f59e0b, #22d3ee)); border-radius: 2px; }
            .nlt-seq-caps { padding-left: 28px; }
            @media (max-width: 860px) {
                .nlt-seq { height: 300vh; }
                .nlt-seq-sticky { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 46vh) auto; padding: 72px 24px 24px; gap: 8px; align-content: center; }
                .nlt-seq-stage { order: -1; } .nlt-seq-stage canvas { max-width: min(78vw, 44vh); }
                .nlt-seq-caps { min-height: 210px; padding-left: 0; text-align: center; }
                .nlt-seq-cap { left: 0; }
                .nlt-seq-bar { display: none; }
            }
            @media (prefers-reduced-motion: reduce) {
                .nlt-seq { height: auto; }
                .nlt-seq-sticky { position: static; height: auto; padding: 56px 24px; }
                .nlt-seq-caps { min-height: 0; padding-left: 0; } .nlt-seq-cap { position: relative; left: 0; top: 0; transform: none; opacity: 1; margin-bottom: 22px; }
            }
        `;
        document.head.appendChild(style);

        secs.forEach((sec) => {
            const canvas = sec.querySelector('canvas[data-seq]');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const base = canvas.dataset.seqBase, n = parseInt(canvas.dataset.seqFrames, 10) || 1, ext = canvas.dataset.seqExt || 'webp';
            const caps = [...sec.querySelectorAll('[data-seq-cap]')];
            const bar = sec.querySelector('.nlt-seq-bar');
            const imgs = new Array(n);
            let started = false, live = false, raf = 0, cur = reduce ? 0.62 : 0, shownIdx = -1, dirty = true;

            function pad(i) { return String(i).padStart(2, '0'); }
            function load() {
                if (started) return;
                started = true;
                // primero el frame 0 y el ultimo, despues el resto en orden
                // en movil / ahorro de datos: 1 de cada 4 frames (un cuarto de descarga; nearest() cubre los huecos)
                const lite = (window.matchMedia && window.matchMedia('(max-width: 860px)').matches) || (navigator.connection && navigator.connection.saveData);
                const primero = [0, n - 1];
                const resto = []; for (let i = 1; i < n - 1; i++) { if (!lite || i % 4 === 0) resto.push(i); }
                const pedir = (i) => {
                    const im = new Image();
                    im.onload = () => { imgs[i] = im; dirty = true; if (!raf && live) raf = requestAnimationFrame(frame); else if (reduce) draw(); };
                    im.src = `${base}${pad(i)}.${ext}`;
                };
                primero.forEach(pedir);
                // El resto de los frames NO es crítico para el primer pintado
                // -- en móvil se escalonan (idle callback / de a poco) para
                // no lanzar 15-20 requests de golpe justo cuando el navegador
                // todavía está bajando lo crítico de la página (fuente,
                // CSS, nlt-shared.js). En escritorio, sin conexión lenta de
                // por medio, se pide todo junto como antes.
                if (!lite) { resto.forEach(pedir); return; }
                let i = 0;
                const siguiente = () => { if (i < resto.length) pedir(resto[i++]); };
                const idle = window.requestIdleCallback || ((cb) => setTimeout(() => cb({ timeRemaining: () => 0 }), 60));
                function tanda() { siguiente(); if (i < resto.length) idle(tanda, { timeout: 200 }); }
                idle(tanda, { timeout: 200 });
            }
            function nearest(idx) {
                for (let d = 0; d < n; d++) { if (imgs[idx - d]) return imgs[idx - d]; if (imgs[idx + d]) return imgs[idx + d]; }
                return null;
            }
            function draw() {
                const idx = Math.max(0, Math.min(n - 1, Math.round(cur * (n - 1))));
                if (idx === shownIdx && !dirty) return;
                const im = nearest(idx);
                if (!im) return;
                if (canvas.width !== im.naturalWidth) { canvas.width = im.naturalWidth; canvas.height = im.naturalHeight; }
                ctx.drawImage(im, 0, 0, canvas.width, canvas.height);
                shownIdx = idx; dirty = false;
            }
            function progress() {
                const r = sec.getBoundingClientRect();
                const total = Math.max(1, r.height - window.innerHeight);
                return Math.max(0, Math.min(1, -r.top / total));
            }
            function frame() {
                const target = reduce ? 0.62 : progress();
                cur += (target - cur) * 0.16;
                if (Math.abs(target - cur) < 0.0005) cur = target;
                draw();
                if (bar) bar.firstElementChild.style.setProperty('--p', cur.toFixed(3));
                caps.forEach((c) => { const a = parseFloat(c.dataset.from), b = parseFloat(c.dataset.to); c.classList.toggle('on', cur >= a && (cur < b || b >= 1)); });
                raf = (live && (Math.abs(target - cur) > 0.0005)) ? requestAnimationFrame(frame) : 0;
            }
            function kick() { if (!raf) raf = requestAnimationFrame(frame); }

            if (!('IntersectionObserver' in window)) { load(); live = true; kick(); return; }
            // 900px de margen en un viewport de escritorio (~900px+ de alto)
            // es "todavia lejos"; en un telefono (viewport ~700-850px de
            // alto) ese mismo margen cubre casi toda la pantalla, asi que la
            // seccion quedaba "cerca" desde el primer render y las ~550KB de
            // frames se descargaban de una, compitiendo con todo lo demas en
            // la carga inicial -- medido real, no supuesto. Un margen chico
            // en movil sigue precargando antes de que el dedo llegue, sin
            // adelantar el trabajo al momento mas caro de la pagina (la carga).
            const cargaAntes = (window.matchMedia && window.matchMedia('(max-width: 860px)').matches) ? '150px 0px' : '900px 0px';
            new IntersectionObserver((es) => { if (es[0].isIntersecting) load(); }, { rootMargin: cargaAntes }).observe(sec);
            new IntersectionObserver((es) => { live = es[0].isIntersecting; if (live) kick(); }, { rootMargin: '0px' }).observe(sec);
            window.addEventListener('scroll', () => { if (live) kick(); }, { passive: true });
            window.addEventListener('resize', () => { dirty = true; if (live) kick(); });
            if (reduce) { load(); caps.forEach((c) => c.classList.add('on')); }
        });
    }

    // Marcos de producto (screenshot dentro de una ventana de vidrio) que
    // se enderezan al entrar en pantalla y siguen levemente al cursor.
    function mountTiltFrames() {
        const frames = document.querySelectorAll('[data-tiltframe]');
        if (!frames.length || document.getElementById('nlt-tilt-style')) return;
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const style = document.createElement('style');
        style.id = 'nlt-tilt-style';
        style.textContent = `
            .nlt-frame-wrap { position: relative; perspective: 1700px; --rx: 0deg; --ry: 0deg; --s: 1; --mx: 50%; --my: 30%; }
            .nlt-frame { position: relative; transform-style: preserve-3d; transform: rotateX(var(--rx)) rotateY(var(--ry)) scale(var(--s)); transform-origin: 50% 80%; will-change: transform;
                         border-radius: 22px; border: 1px solid rgba(255,255,255,0.1); background: #0a0d14; overflow: hidden;
                         box-shadow: 0 60px 120px -40px rgba(67,120,255,0.45), 0 30px 60px -30px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.12); }
            .nlt-frame-bar { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: rgba(255,255,255,0.04); border-bottom: 1px solid rgba(255,255,255,0.06); }
            .nlt-frame-bar i { width: 10px; height: 10px; border-radius: 50%; background: rgba(255,255,255,0.16); }
            .nlt-frame-bar span { margin: 0 auto; font-size: 11px; font-weight: 600; letter-spacing: .02em; color: #6b7280; padding: 4px 16px; border-radius: 8px; background: rgba(255,255,255,0.04); }
            .nlt-frame .shot { display: block; width: 100%; height: auto; }
            .nlt-frame::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: radial-gradient(600px circle at var(--mx) var(--my), rgba(255,255,255,0.09), transparent 55%); }
            .nlt-float { position: absolute; right: -2.5%; bottom: -9%; width: 47%; border-radius: 18px; border: 1px solid rgba(255,255,255,0.14); transform: translateZ(70px);
                         box-shadow: 0 40px 80px -20px rgba(0,0,0,0.85), 0 0 60px -16px rgba(67,120,255,0.55); animation: nlt-float-y 7s ease-in-out infinite; }
            @keyframes nlt-float-y { 0%, 100% { translate: 0 0; } 50% { translate: 0 -10px; } }
            @media (max-width: 720px) { .nlt-float { width: 60%; right: -4%; bottom: -12%; } .nlt-frame { border-radius: 16px; } }
            @media (prefers-reduced-motion: reduce) { .nlt-float { animation: none; } .nlt-frame { transform: none !important; } }
        `;
        document.head.appendChild(style);
        frames.forEach((wrap) => {
            const frame = wrap.querySelector('.nlt-frame');
            if (!frame || reduce) return;
            let px = 0, py = 0, cx = 0, cy = 0, live = false, raf = 0, prev = '';
            // Solo corre mientras algo se mueve (scroll, cursor o inercia):
            // en reposo no hay rAF ni recálculo de estilos.
            function loop() {
                const r = wrap.getBoundingClientRect(), vh = window.innerHeight;
                const p = Math.max(0, Math.min(1, (vh * 0.98 - r.top) / (vh * 0.75)));
                const e = p * p * (3 - 2 * p);
                cx += (px - cx) * 0.08; cy += (py - cy) * 0.08;
                const rx = ((1 - e) * 15 + cy * -3).toFixed(2), ry = (cx * 4).toFixed(2), sc = (0.9 + 0.1 * e).toFixed(3);
                const key = rx + ry + sc;
                if (key !== prev) {
                    wrap.style.setProperty('--rx', rx + 'deg');
                    wrap.style.setProperty('--ry', ry + 'deg');
                    wrap.style.setProperty('--s', sc);
                }
                const quieto = key === prev && Math.abs(px - cx) + Math.abs(py - cy) < 0.002;
                prev = key;
                raf = (live && !quieto) ? requestAnimationFrame(loop) : 0;
            }
            const kick = () => { if (live && !raf) raf = requestAnimationFrame(loop); };
            new IntersectionObserver((es) => { live = es[0].isIntersecting; kick(); }, { rootMargin: '200px 0px' }).observe(wrap);
            window.addEventListener('scroll', kick, { passive: true });
            wrap.addEventListener('pointermove', (e) => {
                kick();
                const r = wrap.getBoundingClientRect();
                px = ((e.clientX - r.left) / r.width) * 2 - 1; py = ((e.clientY - r.top) / r.height) * 2 - 1;
                wrap.style.setProperty('--mx', (e.clientX - r.left) + 'px'); wrap.style.setProperty('--my', (e.clientY - r.top) + 'px');
            }, { passive: true });
            wrap.addEventListener('pointerleave', () => { px = 0; py = 0; kick(); });
        });
    }

    // Videos decorativos: solo se reproducen mientras estan en pantalla
    // (y nunca con prefers-reduced-motion: ahi queda el poster).
    function mountAutoVideos() {
        // El poster de un <video> NO tiene equivalente a loading="lazy" --
        // el navegador lo pide apenas parsea el HTML, sin importar qué tan
        // abajo esté (medido real: 110KB bajando a los 452ms en el celular,
        // compitiendo con todo lo crítico de la carga inicial). Se guarda en
        // data-poster y se asigna recién acá, con margen de sobra para que
        // ya esté listo cuando el usuario llegue a esa sección.
        document.querySelectorAll('video[data-poster]').forEach((v) => {
            if (!('IntersectionObserver' in window)) { v.poster = v.dataset.poster; return; }
            new IntersectionObserver((es, o) => {
                if (!es[0].isIntersecting) return;
                v.poster = v.dataset.poster;
                o.disconnect();
            }, { rootMargin: '200px 0px' }).observe(v);
        });

        const vids = document.querySelectorAll('video[data-autoplay-view]');
        if (!vids.length) return;
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce || !('IntersectionObserver' in window)) return;
        const obs = new IntersectionObserver((es) => es.forEach((e) => {
            const v = e.target;
            if (e.isIntersecting) { const p = v.play(); if (p && p.catch) p.catch(() => {}); } else { v.pause(); }
        }), { threshold: 0.25 });
        vids.forEach((v) => obs.observe(v));
    }

    // Acordeon suave para <details> del FAQ: anima la altura en vez de abrir de golpe.
    function mountAccordions() {
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        document.querySelectorAll('#faq details, details[data-accordion]').forEach((d) => {
            if (d.dataset.acc) return;
            d.dataset.acc = '1';
            const sum = d.querySelector('summary');
            if (!sum) return;
            let anim = null;
            sum.addEventListener('click', (e) => {
                e.preventDefault();
                if (reduce || !d.animate) { d.open = !d.open; return; }
                if (anim) { anim.cancel(); anim = null; d.style.overflow = ''; }
                const wasOpen = d.open;
                const h0 = d.offsetHeight;
                d.open = !wasOpen;
                const h1 = d.offsetHeight;
                d.open = true;                        // abierto durante la animacion
                d.style.overflow = 'hidden';
                anim = d.animate({ height: [h0 + 'px', h1 + 'px'] }, { duration: 340, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
                anim.onfinish = () => { d.open = !wasOpen; d.style.overflow = ''; anim = null; };
                anim.oncancel = () => { d.style.overflow = ''; };
            });
        });
    }

    // Enlace "saltar al contenido" (teclado / lectores de pantalla) en paginas publicas.
    function mountSkipLink() {
        if (document.querySelector('.nlt-skip') || document.getElementById('sidebar')) return;
        const target = document.querySelector('main, section');
        if (!target) return;
        if (!target.id) target.id = 'nlt-main';
        target.setAttribute('tabindex', '-1');
        const a = document.createElement('a');
        a.className = 'nlt-skip'; a.href = '#' + target.id; a.textContent = 'Saltar al contenido';
        document.body.insertBefore(a, document.body.firstChild);
    }

    // Landmark <main> en las paginas publicas: envuelve el contenido entre <header> y <footer>
    // (accesibilidad: lectores de pantalla y "saltar al contenido"). No cambia el layout: <main> es un
    // bloque sin posicion ni z-index. Se omite si la pagina ya tiene <main>, si el body es flex/grid
    // o si no hay <header>.
    function mountLandmarks() {
        if (window.__nltNoLandmarks || document.querySelector('main') || document.getElementById('sidebar')) return;
        const header = document.querySelector('body > header');
        if (!header) return;
        const cs = getComputedStyle(document.body);
        if (cs.display === 'flex' || cs.display === 'grid') return;
        const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'NOSCRIPT', 'TEMPLATE']);
        const nodes = [];
        for (let el = header.nextElementSibling; el && el.tagName !== 'FOOTER'; el = el.nextElementSibling) {
            if (!SKIP.has(el.tagName)) nodes.push(el);
        }
        if (!nodes.length) return;
        const main = document.createElement('main');
        main.id = 'nlt-main';
        nodes[0].parentNode.insertBefore(main, nodes[0]);
        nodes.forEach((n) => main.appendChild(n));
    }

    // ------------------------------------------------------------------
    // Tour guiado (spotlight) + acciones de la paleta + atajos de teclado.
    //   NLT.startTour(steps, { key })    steps: [{ sel, title, text }]; con `key` solo se muestra una vez.
    //   NLT.registerPaletteAction({ label, icon, rgb, kw, run })   -> aparece en Ctrl/Cmd+K, grupo "Acciones".
    // Los pasos cuyo elemento no existe / no se ve (p.ej. sidebar oculto en movil) se saltan solos.
    // ------------------------------------------------------------------
    const _paletteActions = [];
    function registerPaletteAction(a) { if (a && a.label && typeof a.run === 'function') _paletteActions.push(a); }

    function startTour(steps, opts = {}) {
        const key = opts.key ? 'nlt_tour_' + opts.key : null;
        try { if (key && !opts.force && localStorage.getItem(key)) return false; } catch (_) { /* sin storage: se muestra igual */ }
        if (document.getElementById('nlt-tour')) return false;
        const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden'; };
        const list = steps.map((s) => ({ ...s, el: document.querySelector(s.sel) })).filter((s) => visible(s.el));
        if (!list.length) return false;

        if (!document.getElementById('nlt-tour-style')) {
            const st = document.createElement('style');
            st.id = 'nlt-tour-style';
            st.textContent = `
                #nlt-tour { position: fixed; inset: 0; z-index: 250; }
                .nlt-tour-spot { position: fixed; border-radius: 18px; pointer-events: none; box-shadow: 0 0 0 9999px rgba(4,6,10,0.74), 0 0 0 2px rgba(120,160,255,0.75), 0 0 46px rgba(67,120,255,0.5);
                                 transition: left .5s cubic-bezier(.16,1,.3,1), top .5s cubic-bezier(.16,1,.3,1), width .5s cubic-bezier(.16,1,.3,1), height .5s cubic-bezier(.16,1,.3,1); }
                .nlt-tour-card { position: fixed; width: min(340px, calc(100vw - 32px)); padding: 20px 22px 18px; border-radius: 20px; background: linear-gradient(180deg, rgba(22,28,42,.98), rgba(11,14,21,.99));
                                 border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 30px 80px -20px rgba(0,0,0,.85), 0 0 60px -20px rgba(67,120,255,.5);
                                 transition: left .5s cubic-bezier(.16,1,.3,1), top .5s cubic-bezier(.16,1,.3,1), opacity .3s ease; }
                .nlt-tour-n { font: 800 9.5px 'SFMono-Regular', Consolas, monospace; letter-spacing: .2em; text-transform: uppercase; color: #78a0ff; margin-bottom: 8px; }
                .nlt-tour-t { font: 800 18px/1.15 Geist, Inter, sans-serif; letter-spacing: -.02em; color: #fff; margin-bottom: 8px; }
                .nlt-tour-p { font-size: 13px; line-height: 1.55; color: #9ca3af; margin-bottom: 18px; }
                .nlt-tour-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
                .nlt-tour-btn { border: 0; cursor: pointer; padding: 9px 16px; border-radius: 999px; font-size: 12px; font-weight: 700; color: #fff; background: linear-gradient(135deg, #4378ff, #7c5cff); box-shadow: 0 8px 22px -8px rgba(67,120,255,.8); }
                .nlt-tour-btn.ghost { color: #9ca3af; background: transparent; box-shadow: none; padding: 9px 10px; } .nlt-tour-btn.ghost:hover { color: #fff; }
                .nlt-tour-dots { display: flex; gap: 5px; } .nlt-tour-dots i { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,.18); transition: background .3s ease, transform .3s ease; } .nlt-tour-dots i.on { background: #78a0ff; transform: scale(1.3); }
                @media (prefers-reduced-motion: reduce) { .nlt-tour-spot, .nlt-tour-card { transition: none; } }
            `;
            document.head.appendChild(st);
        }
        const root = document.createElement('div');
        root.id = 'nlt-tour'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Tour guiado');
        root.innerHTML = '<div class="nlt-tour-spot"></div><div class="nlt-tour-card"></div>';
        document.body.appendChild(root);
        const spot = root.querySelector('.nlt-tour-spot'), card = root.querySelector('.nlt-tour-card');
        let i = 0;

        function place() {
            const s = list[i]; if (!s || !visible(s.el)) return;
            const r = s.el.getBoundingClientRect(), pad = 10;
            spot.style.left = (r.left - pad) + 'px'; spot.style.top = (r.top - pad) + 'px';
            spot.style.width = (r.width + pad * 2) + 'px'; spot.style.height = (r.height + pad * 2) + 'px';
            const cw = card.offsetWidth, ch = card.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
            let left = r.left + r.width / 2 - cw / 2, top = r.bottom + pad + 16;
            if (top + ch > vh - 12) top = Math.max(12, r.top - pad - 16 - ch);          // no cabe abajo: arriba
            if (top < 12 || (top + ch > vh - 12)) { top = Math.min(vh - ch - 12, Math.max(12, r.top + r.height / 2 - ch / 2)); left = r.right + pad + 16; }   // a un costado
            if (left + cw > vw - 12) left = Math.max(12, r.left - pad - 16 - cw);
            card.style.left = Math.max(12, Math.min(left, vw - cw - 12)) + 'px'; card.style.top = Math.max(12, top) + 'px';
        }
        function show(n) {
            i = n; const s = list[i];
            s.el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
            card.style.opacity = '0';
            card.innerHTML = `
                <div class="nlt-tour-n">Paso ${i + 1} de ${list.length}</div>
                <div class="nlt-tour-t">${_mqEsc(s.title)}</div>
                <div class="nlt-tour-p">${_mqEsc(s.text)}</div>
                <div class="nlt-tour-row">
                    <div class="nlt-tour-dots" aria-hidden="true">${list.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
                    <div style="display:flex;gap:4px;align-items:center">
                        <button type="button" class="nlt-tour-btn ghost" data-a="skip">${i === list.length - 1 ? '' : 'Saltar'}</button>
                        ${i > 0 ? '<button type="button" class="nlt-tour-btn ghost" data-a="prev">Atrás</button>' : ''}
                        <button type="button" class="nlt-tour-btn" data-a="next">${i === list.length - 1 ? 'Listo' : 'Siguiente'}</button>
                    </div>
                </div>`;
            setTimeout(() => { place(); card.style.opacity = '1'; const b = card.querySelector('[data-a="next"]'); if (b) b.focus({ preventScroll: true }); }, 380);
            place();
        }
        function end() {
            try { if (key) localStorage.setItem(key, '1'); } catch (_) { /* noop */ }
            window.removeEventListener('resize', place); window.removeEventListener('keydown', onKey, true);
            root.remove();
        }
        function next() { if (i >= list.length - 1) end(); else show(i + 1); }
        function onKey(e) {
            if (e.key === 'Escape') { e.preventDefault(); end(); }
            else if (e.key === 'ArrowRight' || (e.key === 'Enter' && !e.target.closest('button'))) { e.preventDefault(); next(); }
            else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); show(i - 1); }
        }
        card.addEventListener('click', (e) => { const a = e.target.closest('[data-a]'); if (!a) return; const k = a.dataset.a; if (k === 'next') next(); else if (k === 'prev') show(i - 1); else end(); });
        root.addEventListener('mousedown', (e) => { if (e.target === root) end(); });
        window.addEventListener('resize', place); window.addEventListener('keydown', onKey, true);
        show(0);
        return true;
    }

    // Atajos: "?" abre la ayuda; "g" y luego una letra salta a una seccion (solo en paginas con sidebar).
    function mountShortcuts() {
        if (!document.getElementById('sidebar') || document.getElementById('nlt-sc-style')) return;
        const GO = { d: ['dashboard.html', 'Visión General'], m: ['maestra.html', 'Cuenta Maestra'], c: ['cuentas.html', 'Cuentas Destino'], h: ['historial.html', 'Historial'], j: ['journal.html', 'Trader Journal'], s: ['suscripcion.html', 'Suscripción'] };
        const st = document.createElement('style');
        st.id = 'nlt-sc-style';
        st.textContent = `
            #nlt-sc { position: fixed; inset: 0; z-index: 210; display: none; place-items: center; padding: 16px; background: rgba(4,6,10,.66); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
            #nlt-sc.open { display: grid; }
            .nlt-sc-panel { width: 100%; max-width: 460px; border-radius: 22px; padding: 22px 24px; background: linear-gradient(180deg, rgba(20,25,36,.97), rgba(11,14,21,.99)); border: 1px solid rgba(255,255,255,.09); box-shadow: 0 30px 80px -20px rgba(0,0,0,.85); }
            .nlt-sc-panel h3 { font: 800 18px Geist, Inter, sans-serif; letter-spacing: -.02em; color: #fff; margin-bottom: 14px; }
            .nlt-sc-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.05); font-size: 13px; color: #cbd5e1; }
            .nlt-sc-row:last-child { border: 0; } .nlt-sc-row span:last-child { display: flex; gap: 5px; }
        `;
        document.head.appendChild(st);
        const root = document.createElement('div');
        root.id = 'nlt-sc'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Atajos de teclado');
        const mod = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl';
        const kbd = (t) => `<span class="nlt-kbd">${t}</span>`;
        root.innerHTML = `<div class="nlt-sc-panel"><h3>Atajos de teclado</h3>
            <div class="nlt-sc-row"><span>Buscar / ir a cualquier sección</span><span>${kbd(mod)}${kbd('K')}</span></div>
            <div class="nlt-sc-row"><span>Esta ayuda</span><span>${kbd('?')}</span></div>
            ${Object.entries(GO).map(([k, v]) => `<div class="nlt-sc-row"><span>Ir a ${v[1]}</span><span>${kbd('G')}${kbd(k.toUpperCase())}</span></div>`).join('')}
            <div class="nlt-sc-row"><span>Cerrar</span><span>${kbd('Esc')}</span></div></div>`;
        document.body.appendChild(root);
        const toggle = (on) => root.classList.toggle('open', on);
        root.addEventListener('mousedown', (e) => { if (e.target === root) toggle(false); });
        let gAt = 0;
        document.addEventListener('keydown', (e) => {
            const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
            if (e.key === 'Escape' && root.classList.contains('open')) { toggle(false); return; }
            if (typing || e.ctrlKey || e.metaKey || e.altKey || document.getElementById('nlt-pal')?.classList.contains('open') || document.getElementById('nlt-tour')) return;
            if (e.key === '?') { e.preventDefault(); toggle(!root.classList.contains('open')); return; }
            if (e.key.toLowerCase() === 'g') { gAt = Date.now(); return; }
            if (gAt && Date.now() - gAt < 1000 && GO[e.key.toLowerCase()]) { gAt = 0; window.location.href = GO[e.key.toLowerCase()][0]; }
        });
        registerPaletteAction({ label: 'Atajos de teclado', icon: 'ph-keyboard', rgb: '148,163,184', kw: 'ayuda ? teclas', run: () => toggle(true) });
    }

    // Pulido visual para graficos Chart.js (journal): degradado bajo las lineas, brillo suave en el trazo,
    // barras redondeadas, tooltip y animacion de entrada consistentes con el resto del sitio.
    // Uso: new Chart(ctx, NLT.chartPolish(config)). No cambia datos ni escalas.
    function chartPolish(config) {
        const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
        config.options = config.options || {};
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        config.options.animation = Object.assign({ duration: reduce ? 0 : 1100, easing: 'easeOutQuart' }, config.options.animation);
        const pl = config.options.plugins = config.options.plugins || {};
        pl.tooltip = Object.assign({ backgroundColor: 'rgba(11,14,21,0.96)', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, titleColor: '#ffffff', bodyColor: '#cbd5e1', padding: 10, cornerRadius: 10, displayColors: false }, pl.tooltip);
        (config.data && config.data.datasets || []).forEach((ds) => {
            if (config.type === 'bar' && ds.borderRadius === undefined) ds.borderRadius = 4;
            const rgb = config.type === 'line' && ds.fill ? hexRgb(ds.borderColor) : null;
            if (rgb) {
                ds.backgroundColor = (c) => {
                    const a = c.chart.chartArea;
                    if (!a) return `rgba(${rgb.join(',')},0.12)`;
                    const g = c.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
                    g.addColorStop(0, `rgba(${rgb.join(',')},0.32)`); g.addColorStop(1, `rgba(${rgb.join(',')},0)`);
                    return g;
                };
                ds.borderWidth = ds.borderWidth || 2;
            }
        });
        config.plugins = (config.plugins || []).concat([{
            id: 'nltGlow',
            beforeDatasetDraw(chart, args) { if (chart.config.type !== 'line') return; const o = args.meta.dataset && args.meta.dataset.options; chart.ctx.save(); chart.ctx.shadowColor = (o && o.borderColor) || '#4378FF'; chart.ctx.shadowBlur = 14; },
            afterDatasetDraw(chart) { if (chart.config.type === 'line') chart.ctx.restore(); },
        }]);
        return config;
    }

    // ------------------------------------------------------------------
    // "Flow" de toda la web -- 4 capas que se sienten en cada pagina:
    //   1. Tipografia de display (Geist) en titulares.
    //   2. Transiciones entre paginas (View Transitions API, sin JS de
    //      navegacion: el header/sidebar/fondo se quedan fijos y solo el
    //      contenido hace fundido).
    //   3. Scroll con inercia, propio y sin dependencias (paginas publicas
    //      de escritorio; el shell con sidebar tiene scroll interno y no lo
    //      usa).
    //   4. Entrada orquestada del hero (titulo palabra por palabra), botones
    //      magneticos y leve parallax del fondo liquido con el cursor.
    // Todo es idempotente, respeta prefers-reduced-motion y no toca el
    // markup de ninguna pagina.
    // ------------------------------------------------------------------
    function mountDisplayFont() {
        if (document.getElementById('nlt-display-font') || document.querySelector('link[href*="family=Geist"]')) return;
        const link = document.createElement('link');
        link.id = 'nlt-display-font';
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Geist:wght@500;600;700;800;900&display=swap';
        document.head.appendChild(link);
        const style = document.createElement('style');
        style.id = 'nlt-display-font-style';
        style.textContent = `
            h1, h2, .nlt-display { font-family: 'Geist', 'Inter', system-ui, sans-serif; font-feature-settings: 'ss01', 'cv11'; }
            h3 { font-family: 'Geist', 'Inter', system-ui, sans-serif; }
            h1 { text-wrap: balance; }
            h2 { text-wrap: balance; }
        `;
        document.head.appendChild(style);
    }

    function mountPageTransitions() {
        // Camino normal: assets/css/nlt-flow.css (render-blocking, ya linkeado
        // en cada pagina). Esto solo cubre una pagina que aun no lo linkee --
        // inyectado por JS el opt-in llega tarde para la PRIMERA visita, pero
        // igual sirve desde la segunda navegacion.
        if (document.getElementById('nlt-vt-style') || document.querySelector('link[href*="nlt-flow.css"]')) return;
        const style = document.createElement('style');
        style.id = 'nlt-vt-style';
        style.textContent = `
            @view-transition { navigation: auto; }
            header.nav-blur { view-transition-name: nlt-header; }
            #sidebar { view-transition-name: nlt-sidebar; }
            #nlt-liquid-bg { view-transition-name: nlt-bg; }
            ::view-transition-group(nlt-header), ::view-transition-group(nlt-sidebar), ::view-transition-group(nlt-bg) { animation-duration: 0s; }
            ::view-transition-old(root) { animation: nlt-vt-out 0.22s ease both; }
            ::view-transition-new(root) { animation: nlt-vt-in 0.42s cubic-bezier(0.16, 1, 0.3, 1) both; }
            @keyframes nlt-vt-out { to { opacity: 0; transform: translateY(-6px); } }
            @keyframes nlt-vt-in { from { opacity: 0; transform: translateY(10px); } }
            @media (prefers-reduced-motion: reduce) {
                ::view-transition-old(root), ::view-transition-new(root) { animation: none; }
            }
        `;
        document.head.appendChild(style);
    }

    function mountSmoothScroll() {
        if (window.__nltSmooth) return;
        if (document.getElementById('sidebar')) return;   // shell de app: scroll interno
        const mq = (q) => window.matchMedia && window.matchMedia(q).matches;
        if (mq('(prefers-reduced-motion: reduce)') || !mq('(hover: hover) and (pointer: fine)')) return;
        window.__nltSmooth = true;

        const style = document.createElement('style');
        style.textContent = 'html { scroll-behavior: auto !important; }';
        document.head.appendChild(style);

        const root = document.documentElement;
        const maxScroll = () => Math.max(0, root.scrollHeight - window.innerHeight);
        const clamp = (v) => Math.min(maxScroll(), Math.max(0, v));
        let cur = window.scrollY, tgt = cur, raf = 0;

        function frame() {
            const d = tgt - cur;
            if (Math.abs(d) < 0.5) { cur = tgt; window.scrollTo(0, cur); raf = 0; return; }
            cur += d * 0.12;
            window.scrollTo(0, cur);
            raf = requestAnimationFrame(frame);
        }
        function goTo(y) { tgt = clamp(y); if (!raf) raf = requestAnimationFrame(frame); }
        function sync() { if (raf) { cancelAnimationFrame(raf); raf = 0; } cur = tgt = window.scrollY; }

        // Un hijo con scroll propio (modal, textarea, lista) siempre gana.
        function innerScrolls(el, dy) {
            for (; el && el !== root && el !== document.body; el = el.parentElement) {
                if (el.nodeType !== 1) continue;
                const oy = getComputedStyle(el).overflowY;
                if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
                    if (dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
                }
            }
            return false;
        }

        window.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.defaultPrevented || e.deltaX && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
            if (document.body.style.overflow === 'hidden') return;   // modal abierto
            if (innerScrolls(e.target, e.deltaY)) return;
            const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;
            e.preventDefault();
            if (!raf) cur = tgt = window.scrollY;
            goTo(tgt + dy);
        }, { passive: false });

        // Cualquier otro origen de scroll (teclado, barra, anclas) resincroniza.
        window.addEventListener('scroll', () => { if (!raf) cur = tgt = window.scrollY; }, { passive: true });
        window.addEventListener('keydown', (e) => {
            if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(e.key)) sync();
        });
        window.addEventListener('resize', () => { tgt = clamp(tgt); });

        // Anclas internas (#precio, #modulos...) con la misma inercia.
        document.addEventListener('click', (e) => {
            const a = e.target.closest && e.target.closest('a[href^="#"]');
            if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
            const id = a.getAttribute('href').slice(1);
            if (!id) return;
            const el = document.getElementById(id);
            if (!el) return;
            e.preventDefault();
            history.pushState(null, '', '#' + id);
            cur = window.scrollY;
            goTo(el.getBoundingClientRect().top + window.scrollY - 88);
        });
    }

    // Titulo del hero: entra palabra por palabra (rise + blur). Un elemento
    // con degradado en el texto (background-clip:text) se anima entero -- si
    // se partiera en palabras perderia el degradado.
    function _splitWords(el) {
        let i = 0;
        (function walk(node) {
            [...node.childNodes].forEach((n) => {
                if (n.nodeType === 3) {
                    const parts = n.textContent.split(/(\s+)/);
                    const frag = document.createDocumentFragment();
                    parts.forEach((p) => {
                        if (!p) return;
                        if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
                        const s = document.createElement('span');
                        s.className = 'nlt-w';
                        s.style.setProperty('--i', i++);
                        s.textContent = p;
                        frag.appendChild(s);
                    });
                    node.replaceChild(frag, n);
                } else if (n.nodeType === 1 && n.tagName !== 'BR') {
                    const cs = getComputedStyle(n);
                    if ((cs.webkitBackgroundClip || cs.backgroundClip) === 'text') {
                        n.classList.add('nlt-w');
                        n.style.setProperty('--i', i++);
                    } else {
                        walk(n);
                    }
                }
            });
        })(el);
    }

    function mountHeroIntro() {
        if (document.getElementById('nlt-hero-style')) return;
        if (document.getElementById('sidebar')) return;
        const mq = (q) => window.matchMedia && window.matchMedia(q).matches;
        const reduce = mq('(prefers-reduced-motion: reduce)');
        const fine = mq('(hover: hover) and (pointer: fine)');

        const style = document.createElement('style');
        style.id = 'nlt-hero-style';
        style.textContent = `
            .nlt-w { display: inline-block; opacity: 0; transform: translateY(0.45em); filter: blur(10px);
                     animation: nlt-word-in 0.9s cubic-bezier(0.16, 1, 0.3, 1) forwards; animation-delay: calc(var(--i, 0) * 70ms + 120ms); }
            @keyframes nlt-word-in { to { opacity: 1; transform: none; filter: blur(0); } }
            .glow-button { will-change: translate; transition: translate 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
            #nlt-liquid-bg { will-change: transform; }
            @media (prefers-reduced-motion: reduce) { .nlt-w { animation: none; opacity: 1; transform: none; filter: none; } }
            /* Móvil: el blur animado por palabra es caro en el primer segundo de carga. */
            @media (hover: none), (pointer: coarse) { .nlt-w { filter: none; animation-name: nlt-word-in-lite; } }
            @keyframes nlt-word-in-lite { to { opacity: 1; transform: none; } }
        `;
        document.head.appendChild(style);

        if (!reduce) {
            const h1 = document.querySelector('h1');
            // Solo el h1 del hero (arriba del todo), una sola vez.
            // No se parte un h1 que el JS de la pagina rellena despues (placeholder tipo "--").
            if (h1 && h1.textContent.trim().length > 3 && !/^[-–—.…\s]+$/.test(h1.textContent) && h1.getBoundingClientRect().top < window.innerHeight * 0.8) _splitWords(h1);
        }
        if (reduce || !fine) return;

        // Botones magneticos + parallax suave del fondo, un solo listener.
        const bg = document.getElementById('nlt-liquid-bg');
        let px = 0, py = 0, bx = 0, by = 0, bgRaf = 0;
        function bgLoop() {
            bx += (px - bx) * 0.05; by += (py - by) * 0.05;
            bg.style.transform = `translate3d(${bx.toFixed(2)}px, ${by.toFixed(2)}px, 0) scale(1.05)`;
            bgRaf = (Math.abs(px - bx) + Math.abs(py - by) > 0.05) ? requestAnimationFrame(bgLoop) : 0;
        }
        let lastMag = null;
        document.addEventListener('pointermove', (e) => {
            if (bg) {
                px = -(e.clientX / window.innerWidth - 0.5) * 26;
                py = -(e.clientY / window.innerHeight - 0.5) * 18;
                if (!bgRaf) bgRaf = requestAnimationFrame(bgLoop);
            }
            const btn = e.target.closest && e.target.closest('.glow-button, .botx-btn');
            if (lastMag && lastMag !== btn) { lastMag.style.translate = ''; lastMag = null; }
            if (!btn) return;
            const r = btn.getBoundingClientRect();
            const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
            const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
            btn.style.translate = `${(dx * 8).toFixed(1)}px ${(dy * 6).toFixed(1)}px`;
            lastMag = btn;
        }, { passive: true });
        document.addEventListener('pointerleave', () => { if (lastMag) { lastMag.style.translate = ''; lastMag = null; } });
    }

    // Punto unico para los 3 efectos visuales del ecosistema (fondo liquido,
    // tarjetas con brillo/spotlight/grano, header glass al scroll) -- se
    // llama desde mountPublicHeader() (paginas publicas) Y desde
    // mountSidebar() (dashboard y el resto de las paginas autenticadas),
    // para que ninguna de las dos familias de paginas quede afuera.
    function _mountGlobalVisualEffects() {
        mountLiquidBackground();
        mountCardEffects();
        mountNavScrollEffect();
    }

    async function mountPublicHeader(opts = {}) {
        _mountGlobalVisualEffects();
        const ctaBoxId = opts.ctaBoxId || 'headerCTA';
        const logoId = opts.logoId || 'logoNLT';
        const box = document.getElementById(ctaBoxId);
        const logo = document.getElementById(logoId);

        // Se pinta y se conecta el botón "Comenzar" YA, sin esperar a
        // Supabase -- es el estado por defecto más común (visitante
        // anónimo) y queda clickeable desde el primer instante. Si el
        // usuario ya tiene sesión, el click igual lo manda al Dashboard
        // (se resuelve dentro del propio handler); si no, dispara el login.
        // Antes esto esperaba a getSession() para recién ahí pintar CUALQUIER
        // botón, dejando un margen real donde el botón se veía pero no hacía nada.
        if (box) {
            box.innerHTML = `<button id="headerLoginBtn" class="px-5 py-2.5 rounded-full bg-nlt-accent text-white font-semibold text-xs tracking-wide transition-all glow-button cursor-pointer">Comenzar</button>`;
            document.getElementById('headerLoginBtn').addEventListener('click', async () => {
                const session = await getSession();
                if (session) {
                    window.location.href = 'dashboard.html';
                } else {
                    const urlDestino = new URL(opts.redirectTo || 'dashboard.html', window.location.href).toString();
                    supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: urlDestino } });
                }
            });
            _mountMobileNavToggle(box);
        }

        const session = await getSession();

        if (logo) logo.setAttribute('href', session ? 'dashboard.html' : 'index.html');

        // Si sí hay sesión, se reemplaza el botón optimista de arriba por el
        // header real de usuario logueado -- comportamiento visual idéntico
        // al de antes, solo que ya no bloquea la existencia del botón.
        if (box && session) {
            // skipProfileAvatar: usado por community.html, que ya tiene su
            // propio punto de entrada de perfil (#miPerfilSlot) -- sin esto,
            // un usuario con membresía de Community terminaba viendo DOS
            // avatares en el mismo header (bug real confirmado, no
            // hipotético). El resto de las páginas públicas no pasa esta
            // opción y se comporta como siempre.
            if (opts.skipProfileAvatar) {
                box.innerHTML = `<a href="dashboard.html" class="px-5 py-2.5 rounded-full bg-nlt-accent text-white font-semibold text-xs tracking-wide transition-all glow-button">Dashboard</a>`;
            } else {
                box.innerHTML = `
                    <div class="flex items-center gap-3">
                        <a href="dashboard.html" class="px-5 py-2.5 rounded-full bg-nlt-accent text-white font-semibold text-xs tracking-wide transition-all glow-button">Dashboard</a>
                        ${profileMenuHTML('publicProfile')}
                    </div>
                `;
                mountProfileMenu(session, 'publicProfile');
            }
            _mountMobileNavToggle(box);
        }
        // "Contact us" -- cubre las páginas públicas (community.html,
        // tools.html, partners.html, etc.) cuando SÍ hay sesión. El otro
        // punto de montaje vive en requireSession() (arriba en este archivo).
        mountSupportChat(session);
        return session;
    }

    // El <nav> de escritorio del header público usa "hidden md:flex" -- en
    // mobile queda oculto del todo y, confirmado real navegando el sitio a
    // 375px, no hay ningún botón hamburguesa que lo reemplace: en celular no
    // hay forma de navegar desde el header (solo se ve logo + CTA). Esto
    // arma un botón hamburguesa + panel desplegable clonando los mismos
    // links del <nav> de escritorio, para no duplicar el menú a mano en
    // cada página -- una sola vez acá alcanza para las 10 páginas públicas
    // que llaman a mountPublicHeader.
    function _mountMobileNavToggle(ctaBox) {
        const header = ctaBox.closest('header');
        const nav = header ? header.querySelector('nav') : null;
        if (!header || !nav || header.querySelector('#mobileNavToggle')) return;

        const enlaces = Array.from(nav.children);
        if (!enlaces.length) return;

        const toggle = document.createElement('button');
        toggle.id = 'mobileNavToggle';
        toggle.setAttribute('aria-label', 'Abrir menú');
        toggle.className = 'md:hidden ml-3 w-10 h-10 rounded-full border border-white/10 flex items-center justify-center text-gray-300 hover:text-white hover:border-white/20 transition-colors cursor-pointer';
        toggle.innerHTML = '<i class="ph-bold ph-list text-lg"></i>';
        ctaBox.insertAdjacentElement('afterend', toggle);

        const panel = document.createElement('div');
        panel.id = 'mobileNavPanel';
        panel.className = 'hidden md:hidden fixed inset-x-0 top-20 z-30 nav-blur border-b border-white/5 px-6 py-6 flex flex-col gap-5 text-base text-gray-300 font-medium';
        panel.innerHTML = enlaces.map((el) => `<span class="mobile-nav-link">${el.outerHTML}</span>`).join('');
        header.insertAdjacentElement('afterend', panel);
        // Los links clonados heredan el mismo comportamiento (href normal, o
        // el listener del botón "Red en vivo" si aplica) -- delegamos el
        // click reenviándolo al elemento original en vez de duplicar lógica.
        Array.from(panel.querySelectorAll('.mobile-nav-link > *')).forEach((clon, i) => {
            clon.addEventListener('click', (e) => {
                cerrar();
                if (clon.tagName === 'BUTTON') { e.preventDefault(); enlaces[i].click(); }
            });
        });

        function abrir() {
            panel.classList.remove('hidden');
            toggle.innerHTML = '<i class="ph-bold ph-x text-lg"></i>';
        }
        function cerrar() {
            panel.classList.add('hidden');
            toggle.innerHTML = '<i class="ph-bold ph-list text-lg"></i>';
        }
        toggle.addEventListener('click', () => panel.classList.contains('hidden') ? abrir() : cerrar());
        document.addEventListener('click', (e) => {
            if (!panel.classList.contains('hidden') && !panel.contains(e.target) && !toggle.contains(e.target)) cerrar();
        });
    }

    function isAdmin(session) {
        return !!session && session.user.email === ADMIN_EMAIL;
    }

    // Nombre más preciso que isAdmin() ahora que existen admins secundarios
    // con permisos por módulo (ver admin_permissions en el backend) --
    // mismo criterio exacto (email === ADMIN_EMAIL), nunca depende de una
    // fila de base de datos. isAdmin() queda intacta para no tocar sus 3
    // usos actuales.
    function isGlobalAdmin(session) {
        return !!session && session.user.email === ADMIN_EMAIL;
    }

    // Crea la fila de perfil del usuario si todavía no existe (plan 'free' por defecto).
    async function ensurePerfil(session) {
        const { data, error } = await supabase
            .from('perfiles')
            .select('plan')
            .eq('user_id', session.user.id)
            .maybeSingle();

        if (error) {
            console.error('Error leyendo perfil:', error);
            return 'free';
        }

        if (data) return data.plan;

        const { error: insertError } = await supabase
            .from('perfiles')
            .insert([{ user_id: session.user.id, email: session.user.email, plan: 'free' }]);

        if (insertError) {
            console.error('Error creando perfil:', insertError);
        } else {
            // Perfil recién creado (primera vez que este usuario aparece) --
            // único momento en que tiene sentido atribuir un referido
            // pendiente. La validación real (código existe/activo, no
            // autoreferirse, etc) vive en el backend -- acá solo se manda
            // si había uno guardado, nunca se confía en el resultado desde
            // el cliente. Falla en silencio a propósito: un código vencido
            // o inválido nunca debe romper el login normal.
            const pendiente = _leerReferidoPendiente();
            if (pendiente && typeof NLT_API !== 'undefined') {
                try { await NLT_API.afiliadoAtribuirReferido(pendiente); } catch (e) { /* silencioso, ver arriba */ }
            }
            localStorage.removeItem('nlt_pending_ref');
        }
        return 'free';
    }

    const REF_ATTRIBUTION_WINDOW_DIAS = 30;

    function _leerReferidoPendiente() {
        try {
            const raw = localStorage.getItem('nlt_pending_ref');
            if (!raw) return null;
            const { codigo, ts } = JSON.parse(raw);
            if (!codigo || !ts) return null;
            const diasPasados = (Date.now() - ts) / (1000 * 60 * 60 * 24);
            return diasPasados <= REF_ATTRIBUTION_WINDOW_DIAS ? codigo : null;
        } catch (e) {
            return null;
        }
    }

    // Servidores MT5 más comunes, para autocompletar (no es una lista exhaustiva:
    // el campo sigue siendo texto libre para brokers que no estén aquí).
    const MT5_SERVERS = [
        'MetaQuotes-Demo',
        'Eightcap-Demo', 'Eightcap-Live',
        'ICMarkets-Demo', 'ICMarkets-Live01', 'ICMarkets-Live02', 'ICMarkets-Live03', 'ICMarkets-Live04',
        'ICMarketsSC-Demo', 'ICMarketsSC-Live01', 'ICMarketsSC-Live02',
        'Pepperstone-Demo', 'Pepperstone-Live01', 'Pepperstone-Live02',
        'Exness-MT5Trial', 'Exness-MT5Real', 'Exness-MT5Real2', 'Exness-MT5Real3', 'Exness-MT5Real4',
        'XMGlobal-Demo', 'XMGlobal-Real', 'XM.COM-Demo', 'XM.COM-Real',
        'FTMO-Demo', 'FTMO-Server', 'FTMO-Server2', 'FTMO-Server3',
        'HFMarketsGlobal-Demo', 'HFMarketsGlobal-Live',
        'OctaFX-Demo', 'OctaFX-Real',
        'FBS-Demo', 'FBS-Real',
        'Deriv-Demo', 'Deriv-Server', 'Deriv-Server02', 'Deriv-Server03',
        'AvaTrade-Demo', 'AvaTrade-Real',
        'FXTM-Demo', 'FXTM-Live', 'FXTM-ECN',
        'RoboForex-Demo', 'RoboForex-ECN', 'RoboForex-Pro',
        'VantageInternational-Demo', 'VantageInternational-Live',
        'Tickmill-Demo', 'Tickmill-Live',
        'Axi-Demo', 'AxiCorp-Live02',
        'Alpari-Demo', 'Alpari-MT5',
        'AdmiralsGroup-Demo', 'AdmiralsGroup-Live',
        'BlackBullMarkets-Demo', 'BlackBullMarkets-Live',
        'FPMarketsLLC-Demo', 'FPMarketsLLC-Live',
        'GlobalPrime-Demo', 'GlobalPrime-Live',
        'LandFX-Demo', 'LandFX-Live',
        'IG-Demo', 'IG-Live',
        'Swissquote-Server',
        'FXCM-USDDemo01', 'FXCM-USDReal01',
        'JustMarkets-Demo', 'JustMarkets-Live',
        'InstaForex-Demo', 'InstaForex-Server',
    ];

    // Estados reales que puede devolver el motor (ver NLT_Copier/estados.py) ->
    // etiqueta visible + color. Cualquier valor no reconocido cae al genérico rojo.
    const ESTADO_BADGES = {
        PENDIENTE: { emoji: '🟡', texto: 'En cola...', clase: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20 animate-pulse' },
        CONNECTING: { emoji: '🟡', texto: 'Conectando...', clase: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20 animate-pulse' },
        CONECTADA: { emoji: '🟢', texto: 'Conectada', clase: 'bg-green-500/10 text-green-400 border-green-500/20' },
        TRADING_DISABLED: { emoji: '🔴', texto: 'Trading deshabilitado', clase: 'bg-red-500/10 text-red-400 border-red-500/20' },
        CREDENCIALES_INVALIDAS: { emoji: '🔴', texto: 'Credenciales incorrectas', clase: 'bg-red-500/10 text-red-400 border-red-500/20' },
        DESCONECTADA: { emoji: '🔴', texto: 'Desconectada', clase: 'bg-red-500/10 text-red-400 border-red-500/20' },
        ERROR_CONEXION: { emoji: '🔴', texto: 'Error de conexión', clase: 'bg-red-500/10 text-red-400 border-red-500/20' },
        SESION_FRIA: { emoji: '🟠', texto: 'Necesita reconexión', clase: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
    };

    // Devuelve el HTML de una píldora de estado consistente en todas las páginas.
    function renderEstadoBadge(estado) {
        const info = ESTADO_BADGES[estado] || { emoji: '🔴', texto: estado || 'Desconocido', clase: 'bg-red-500/10 text-red-400 border-red-500/20' };
        return `<span class="px-3 py-1 ${info.clase} text-xs font-bold rounded-full border">${info.emoji} ${info.texto}</span>`;
    }

    // Selector principal CFDs/Forex <-> Futuros (arquitectura multimercado).
    // 'activo' es 'cfd' o 'futures'. Cada página con id="marketToggle" en su
    // header lo llena con esto -- una sola fuente de verdad para el toggle,
    // en vez de duplicar el markup en cada página.
    function marketTypeToggleHTML(activo) {
        const base = 'px-2.5 py-1.5 md:px-4 md:py-2 rounded-xl text-[10px] md:text-xs font-bold uppercase tracking-wider transition-all border whitespace-nowrap';
        const on = 'bg-nlt-accent/10 text-nlt-accent border-nlt-accent/20';
        const off = 'text-gray-500 hover:text-gray-300 border-transparent hover:border-white/10';
        return `
            <a href="dashboard.html" class="${base} ${activo === 'cfd' ? on : off}">CFDs / Forex</a>
            <a href="futuros.html" class="${base} ${activo === 'futures' ? on : off}">Futuros</a>
        `;
    }

    // Inserta un <datalist id="mt5Servers"> en la página (una sola vez) para que
    // cualquier <input list="mt5Servers"> ofrezca autocompletado sin dejar de ser texto libre.
    function injectServerDatalist() {
        if (document.getElementById('mt5Servers')) return;
        const dl = document.createElement('datalist');
        dl.id = 'mt5Servers';
        dl.innerHTML = MT5_SERVERS.map((s) => `<option value="${s}"></option>`).join('');
        document.body.appendChild(dl);
    }

    // Registro único de módulos del ecosistema NLT -- lo usa la homepage
    // (cards de "todo lo que necesitas") y, más adelante, el Dashboard, para
    // no mantener dos listas separadas que puedan desincronizarse.
    // status: 'live' (real, enlaza a la app) | 'soon' (todavía no construido,
    // se muestra atenuado con "Próximamente" -- nunca se linkea a nada falso).
    // "color": trio RGB (sin espacios) para el resplandor de hover de cada
    // tarjeta -- referencia visual: nlt.relioops.com, donde cada módulo del
    // ecosistema tiene su propio color de identidad en vez de un azul
    // genérico repetido. Se consume como rgba(var(--card-glow-rgb),alpha)
    // en el CSS inyectado por mountCardEffects().
    const NLT_MODULES = [
        {
            id: 'copy', nombre: 'NLT Copy System', status: 'live', href: 'dashboard.html',
            icono: 'ph-arrows-left-right', descripcion: 'Copiado de operaciones en tiempo real entre tu cuenta maestra y tus cuentas destino -- CFDs, Forex y Futuros.',
            color: '67,120,255',
        },
        {
            // DAFRYX ZONE AI es el indicador real de NLT -- análisis de zonas
            // (oferta/demanda, FVG, BOS), AI Score, bias y probabilidad,
            // directo en TradingView. No es un producto separado de "Zone
            // Engine": es la misma herramienta, así que no se listan dos veces.
            id: 'indicator', nombre: 'NLT Indicator', status: 'live', href: 'indicator.html',
            icono: 'ph-crosshair', descripcion: 'Análisis de zonas con IA para TradingView -- AI Score, bias, calidad de zona y probabilidad en tiempo real.',
            color: '34,211,238',
        },
        {
            id: 'futures-calc', nombre: 'Futures Calculator', status: 'live', href: 'calculators.html#futures',
            icono: 'ph-calculator', descripcion: 'Calculadora profesional de contratos y riesgo para ES, NQ, YM, RTY, CL, GC.',
            color: '245,158,11',
        },
        {
            id: 'forex-calc', nombre: 'Forex Calculator', status: 'live', href: 'calculators.html#forex',
            icono: 'ph-currency-circle-dollar', descripcion: 'Tamaño de posición, valor de pip y riesgo calculado al instante para cualquier par.',
            color: '34,197,94',
        },
        {
            id: 'news', nombre: 'NLT News', status: 'live', href: 'news.html',
            icono: 'ph-newspaper', descripcion: 'Calendario económico y noticias de mercado, organizados por impacto -- entiende el día en segundos.',
            color: '248,113,113',
        },
        {
            id: 'tools', nombre: 'Trading Tools', status: 'live', href: 'tools.html',
            icono: 'ph-wrench', descripcion: 'Caja de herramientas del trader: margen, pips, prop firms y más.',
            color: '168,85,247',
        },
        {
            id: 'community', nombre: 'Community', status: 'live', href: 'community.html',
            icono: 'ph-users-three', descripcion: 'La comunidad NLT -- anuncios, contenido y conversación entre traders.',
            color: '45,212,191',
        },
        {
            id: 'academy', nombre: 'NLT Academy', status: 'live', href: 'academy.html',
            icono: 'ph-graduation-cap', descripcion: 'Cursos y lecciones estructuradas para llevar tu operativa al siguiente nivel.',
            color: '236,72,153',
        },
        {
            // La landing está viva (status: 'live') aunque el trading real
            // todavía no lo esté -- ver TRADING_ENABLED en el backend. Hoy
            // es Broker Partner + Referral (Eightcap), no un broker propio.
            id: 'broker', nombre: 'NLT Broker', status: 'live', href: 'broker.html',
            icono: 'ph-briefcase', descripcion: 'Descubre brokers partner de confianza y conecta tu experiencia de trading con el ecosistema NLT.',
            color: '67,120,255',
        },
        {
            id: 'propfirm', nombre: 'NLT Funded', status: 'live', href: 'propfirm.html',
            icono: 'ph-trophy', descripcion: 'Compra tu challenge y accede a una cuenta funded a través de nuestro partner de PropFirm.',
            color: '245,158,11',
        },
        {
            // Directorio de prop firms EXTERNAS con descuento NLT (salida por
            // referral, sin checkout propio) -- distinto de NLT Funded.
            id: 'prop-hub', nombre: 'NLT Prop Hub', status: 'live', href: 'funded.html',
            icono: 'ph-buildings', descripcion: 'Compara las prop firms partner de NLT y entra con descuentos exclusivos para la comunidad.',
            color: '129,140,248',
        },
        {
            id: 'journal', nombre: 'NLT Trader Journal', status: 'live', href: 'journal.html',
            icono: 'ph-notebook', descripcion: 'Registra tus operaciones, mide tu desempeño real y construye disciplina con analítica profesional.',
            color: '168,85,247',
        },
        {
            id: 'elite-signals', nombre: 'NLT Elite Signals', status: 'live', href: 'signals.html',
            icono: 'ph-broadcast', descripcion: 'Señales BUY/SELL con entry, TP y SL, clasificadas por Quality Score (NORMAL/OPTIMA/STRONG/PERFECTA/ELITE).',
            color: '34,197,94',
        },
    ];

    // --- Sidebar global (Fase 1: navegación consistente en toda la plataforma) ---
    // Antes cada una de las 10 páginas autenticadas tenía su propio <aside>
    // copiado a mano -- al centralizarlo se encontraron 3 inconsistencias
    // reales (Panel Admin faltante en maestra/cuentas/configuracion.html,
    // "Pro Plan" hardcodeado en cuentas.html), que quedan corregidas acá,
    // una sola vez, en vez de en cada archivo.

    const NAV_CFD = [
        { id: 'dashboard', href: 'dashboard.html', icono: 'ph-squares-four', label: 'Visión General' },
        { id: 'maestra', href: 'maestra.html', icono: 'ph-crown', label: 'Cuenta Maestra' },
        { id: 'cuentas', href: 'cuentas.html', icono: 'ph-users', label: 'Cuentas Destino' },
        { id: 'historial', href: 'historial.html', icono: 'ph-clock-counter-clockwise', label: 'Historial' },
        { id: 'journal', href: 'journal.html', icono: 'ph-notebook', label: 'Trader Journal' },
        { id: 'guardian', href: 'guardian.html', icono: 'ph-shield-check', label: 'NLT Guardian' },
        { id: 'afiliado', href: 'afiliado.html', icono: 'ph-share-network', label: 'NLT Affiliate' },
    ];
    const NAV_CFD_AJUSTES = [
        { id: 'suscripcion', href: 'suscripcion.html', icono: 'ph-credit-card', label: 'Suscripción' },
        { id: 'configuracion', href: 'configuracion.html', icono: 'ph-gear-six', label: 'Configuración' },
    ];
    // futuros.html es una sola página con secciones ancladas (Mis cuentas /
    // Operaciones / Historial / Logs) -- estos 4 ids SOLO tienen sentido
    // ahí. futuros-configuracion.html y futuros-admin.html son páginas
    // aparte, sin esas secciones, así que desde ellas el link es uno solo
    // de vuelta a futuros.html (NAV_FUTURES_LINK).
    const FUTURES_HOME_IDS = ['futuros-cuentas', 'futuros-operaciones', 'futuros-historial', 'futuros-logs'];
    const NAV_FUTURES_HOME = [
        { id: 'futuros-cuentas', href: '#seccion-cuentas', icono: 'ph-squares-four', label: 'Mis cuentas' },
        { id: 'futuros-operaciones', href: '#seccion-operaciones', icono: 'ph-arrows-clockwise', label: 'Operaciones / Copias' },
        { id: 'futuros-historial', href: '#seccion-historial', icono: 'ph-clock-counter-clockwise', label: 'Historial' },
        { id: 'futuros-logs', href: '#seccion-logs', icono: 'ph-terminal-window', label: 'Logs' },
    ];
    const NAV_FUTURES_LINK = [
        { id: 'futuros-dashboard', href: 'futuros.html', icono: 'ph-squares-four', label: 'Dashboard / Cuentas' },
    ];
    const NAV_FUTURES_AJUSTES = [
        { id: 'futuros-config', href: 'futuros-configuracion.html', icono: 'ph-gear-six', label: 'Configuración' },
    ];
    // NLT Broker -- broker-dashboard.html es la única página autenticada
    // hoy (no tiene su propia página de Ajustes todavía, reusa NAV_CFD_AJUSTES
    // porque Suscripción/Configuración son globales, no específicos de CFD).
    const NAV_BROKER = [
        { id: 'broker-dashboard', href: 'broker-dashboard.html', icono: 'ph-squares-four', label: 'Dashboard' },
        { id: 'broker-landing', href: 'broker.html', icono: 'ph-briefcase', label: 'Explorar Broker' },
    ];

    const NAV_PROPFIRM = [
        { id: 'propfirm-dashboard', href: 'propfirm-dashboard.html', icono: 'ph-squares-four', label: 'Dashboard' },
        { id: 'propfirm-landing', href: 'propfirm.html', icono: 'ph-trophy', label: 'Challenges' },
        // Prop Hub -- directorio de prop firms EXTERNAS con salida por referral,
        // distinto del challenge propio de NLT (propfirm-landing/-dashboard de
        // arriba). Ver nlt-web/supabase/prop_hub.sql.
        { id: 'prop-hub', href: 'funded.html', icono: 'ph-buildings', label: 'Prop Hub' },
        { id: 'guardian', href: 'guardian.html', icono: 'ph-shield-check', label: 'NLT Guardian' },
    ];

    // NLT Elite Signals -- mismo patrón que NAV_BROKER/NAV_PROPFIRM (un solo
    // producto, sin Ajustes propios -- reusa NAV_CFD_AJUSTES).
    const NAV_SIGNALS = [
        { id: 'signals-dashboard', href: 'signals-dashboard.html', icono: 'ph-squares-four', label: 'Dashboard' },
        { id: 'signals-landing', href: 'signals.html', icono: 'ph-broadcast', label: 'Elite Signals' },
    ];

    // NLT Indicator -- panel autenticado del indicador (Connect TradingView,
    // AI Zone Analysis, Analysis History). Mismo patrón que NAV_SIGNALS.
    const NAV_INDICATOR = [
        { id: 'indicator-dashboard', href: 'indicator-dashboard.html', icono: 'ph-squares-four', label: 'Panel' },
        { id: 'indicator-landing', href: 'indicator.html', icono: 'ph-crosshair', label: 'Sobre el Indicador' },
    ];

    // NLT Bot Supreme (Fase 4, ver RATIFIED INTEGRATION CONTRACT v1) -- un
    // solo item hoy: todavía no existe una landing/marketing page propia
    // (eso es Fase 6+, fuera de esta fase), así que a diferencia de
    // NAV_SIGNALS/NAV_PROPFIRM no hay un segundo link "Explorar/Landing".
    const NAV_BOT = [
        { id: 'bot-dashboard', href: 'nlt-bot-dashboard.html', icono: 'ph-robot', label: 'Dashboard' },
    ];

    // Equipo + Acuerdos + Firma -- una sola página (equipo.html) con
    // secciones ancladas, mismo patrón que NAV_FUTURES_HOME (#seccion-*).
    const NAV_EQUIPO = [
        { id: 'equipo-mios', href: '#seccion-mis-acuerdos', icono: 'ph-file-text', label: 'Mis Acuerdos' },
        { id: 'equipo-roster', href: '#seccion-equipo', icono: 'ph-users-three', label: 'Equipo' },
        { id: 'equipo-acuerdos', href: '#seccion-acuerdos-admin', icono: 'ph-folder-lock', label: 'Acuerdos (Admin)' },
        { id: 'equipo-auditoria', href: '#seccion-auditoria', icono: 'ph-scroll', label: 'Auditoría' },
    ];

    // Color de identidad de cada seccion de la app -- el mismo que ese
    // producto tiene en NLT_MODULES / el index (Copy System azul, Broker
    // teal, Funded ambar, Signals verde, Indicator cian, Bot rojo...), para
    // que el sidebar hable el mismo idioma visual que el resto del sitio.
    const SECTION_RGB = {
        cfd: '67,120,255', broker: '45,212,191', propfirm: '245,158,11',
        signals: '34,197,94', indicator: '34,211,238', bot: '248,113,113',
        equipo: '168,85,247', futures: '245,158,11',
    };

    function _navItemHTML(item, activo, rgb = '67,120,255') {
        const on = item.id === activo;
        const base = 'flex items-center gap-3 px-4 py-3 rounded-2xl font-medium text-sm transition-all';
        const cls = on ? `${base} border` : `${base} text-gray-400 hover:text-white hover:bg-white/5`;
        const style = on
            ? `background:rgba(${rgb},0.12); color:rgb(${rgb}); border-color:rgba(${rgb},0.25); box-shadow:0 0 26px -12px rgba(${rgb},0.7)`
            : '';
        const iconCls = on ? `ph-fill ${item.icono}` : `ph ${item.icono}`;
        const iconStyle = on ? '' : ` style="color:rgba(${rgb},0.75)"`;
        return `<a href="${item.href}" class="${cls}"${style ? ` style="${style}"` : ''}><i class="${iconCls} text-lg"${iconStyle}></i> ${item.label}</a>`;
    }

    // seccion: 'cfd' | 'futures'. activo: id del item actual (ver NAV_* arriba)
    // o 'admin'/'futuros-admin' para las páginas de administración. Dentro de
    // 'futures', si activo es una de las 4 secciones de futuros.html se usan
    // las anclas internas; si no (estamos en Configuración/Administración),
    // se usa un solo link de vuelta a futuros.html.
    function renderSidebar({ activo, seccion = 'cfd' } = {}) {
        const esFuturesHome = seccion === 'futures' && FUTURES_HOME_IDS.includes(activo);
        const nav = seccion === 'broker' ? NAV_BROKER : seccion === 'propfirm' ? NAV_PROPFIRM : seccion === 'signals' ? NAV_SIGNALS : seccion === 'indicator' ? NAV_INDICATOR : seccion === 'bot' ? NAV_BOT : seccion === 'equipo' ? NAV_EQUIPO : seccion === 'futures' ? (esFuturesHome ? NAV_FUTURES_HOME : NAV_FUTURES_LINK) : NAV_CFD;
        const ajustes = seccion === 'futures' ? NAV_FUTURES_AJUSTES : NAV_CFD_AJUSTES;
        const grupoLabel = seccion === 'broker' ? 'NLT Broker' : seccion === 'propfirm' ? 'NLT Funded' : seccion === 'signals' ? 'NLT Elite Signals' : seccion === 'indicator' ? 'NLT Indicator' : seccion === 'bot' ? 'NLT Bot Supreme' : seccion === 'equipo' ? 'Equipo NLT' : seccion === 'futures' ? 'Futuros' : null;
        const ajustesLabel = seccion === 'futures' ? 'Ajustes Futures' : 'Ajustes';
        const adminLabel = seccion === 'futures' ? 'Administración' : 'Panel Admin';
        const adminHref = seccion === 'broker' ? 'admin.html#broker' : seccion === 'propfirm' ? 'admin.html#propfirm' : seccion === 'signals' ? 'admin.html#elite_signals' : seccion === 'indicator' ? 'admin.html#indicador' : seccion === 'futures' ? 'admin.html#futures' : 'admin.html';
        const rgb = SECTION_RGB[seccion] || SECTION_RGB.cfd;
        const adminOn = activo === 'admin' || activo === 'futuros-admin';
        const adminCls = adminOn
            ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/10'
            : 'text-yellow-400 hover:text-yellow-300 hover:bg-white/5';

        return `
            <div class="h-24 flex items-center justify-between px-8">
                <a href="dashboard.html" class="flex items-center gap-3">
                    <img src="assets/img/nlt-icon.png" alt="NLT" class="w-9 h-9">
                    <span class="font-semibold text-lg tracking-tight">NLT</span>
                </a>
                ${notifBellHTML('sidebarNotifBell')}
            </div>
            <nav class="flex-1 px-4 py-4 space-y-1.5 overflow-y-auto">
                <button type="button" data-nlt-palette class="w-full flex items-center gap-3 px-4 py-2.5 mb-2 rounded-2xl text-sm text-gray-500 bg-white/[0.03] border border-white/[0.07] hover:border-white/20 hover:text-gray-300 transition-all cursor-pointer">
                    <i class="ph ph-magnifying-glass text-lg"></i><span class="flex-1 text-left">Buscar…</span><span class="nlt-kbd">${/Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘K' : 'Ctrl K'}</span>
                </button>
                <a href="ecosystem.html" class="flex items-center gap-3 px-4 py-3 mb-2 pb-4 border-b border-white/5 rounded-2xl font-medium text-sm transition-all text-gray-400 hover:text-white hover:bg-white/5">
                    <i class="ph ph-compass text-lg"></i> Ecosistema
                </a>
                ${grupoLabel ? `<p class="px-4 pb-2 text-[10px] font-bold uppercase tracking-widest" style="color:rgba(${rgb},0.8)">${grupoLabel}</p>` : ''}
                ${nav.map((i) => _navItemHTML(i, activo, rgb)).join('')}
                <div class="pt-6 pb-2 px-4"><p class="text-[10px] font-bold text-gray-600 uppercase tracking-widest">${ajustesLabel}</p></div>
                ${ajustes.map((i) => _navItemHTML(i, activo, rgb)).join('')}
                <a href="equipo.html" id="nav-equipo" class="hidden items-center gap-3 px-4 py-3 rounded-2xl font-medium text-sm transition-all ${activo === 'equipo-mios' || activo === 'equipo-roster' || activo === 'equipo-acuerdos' || activo === 'equipo-auditoria' ? 'bg-nlt-accent/10 text-nlt-accent border border-nlt-accent/10' : 'text-gray-400 hover:text-white hover:bg-white/5'}">
                    <i class="ph-fill ph-users-three text-lg"></i> Equipo
                </a>
                <a href="${adminHref}" id="nav-admin" class="hidden items-center gap-3 px-4 py-3 rounded-2xl font-medium text-sm transition-all ${adminCls}">
                    <i class="ph-fill ph-shield-star text-lg"></i> ${adminLabel}
                </a>
            </nav>
            <div class="p-6 relative" id="sidebarProfileBox">
                <button id="sidebarProfileBtn" type="button" class="w-full glass-item p-3 flex items-center gap-3 cursor-pointer hover:bg-white/5 transition-colors text-left">
                    <div class="w-10 h-10 rounded-full bg-gradient-to-tr from-gray-700 to-gray-600 flex items-center justify-center text-xs font-bold text-white overflow-hidden shrink-0" id="userAvatarInitial" data-nlt-profile-avatar>·</div>
                    <div class="flex-1 overflow-hidden">
                        <p class="text-sm font-semibold text-white truncate" id="userEmail">Cargando...</p>
                        <p class="text-[11px] text-nlt-accent font-medium" id="userPlanLabel"></p>
                    </div>
                    <i class="ph ph-caret-up text-gray-500 text-sm shrink-0"></i>
                </button>
                <div id="sidebarProfilePanel" class="hidden glass-card p-0 overflow-hidden nlt-profile-panel"></div>
            </div>
        `;
    }

    // El <aside id="sidebar"> de las 15 páginas de la app (dashboard,
    // cuentas, maestra, historial, afiliado, suscripción, configuración,
    // futuros*, admin, equipo, journal, *-dashboard) es un ancho FIJO de
    // 280px -- confirmado real revisando el CSS: sin ningún breakpoint
    // que lo reduzca. En un celular de 375px de ancho eso se come el 75%
    // de la pantalla y deja el contenido real en una tira de ~95px,
    // imposible de usar -- coincide con "no se logra navegar" reportado
    // en mobile. Se convierte en un drawer: fuera de pantalla por
    // defecto en mobile, con un botón hamburguesa fijo + fondo oscuro
    // para abrirlo/cerrarlo, y vuelve a ser el sidebar estático normal
    // desde md: hacia arriba -- desktop queda exactamente igual que antes.
    //
    // FIX (validación post-deploy, 28/08): el estado base "fuera de
    // pantalla" ya NO se agrega acá vía classList -- se movió a CSS puro
    // (@media (max-width:767px) #sidebar{...}, en el <style> de cada una
    // de las 15 páginas). Antes, mientras mountSidebar() esperaba
    // requireSession()+miSuscripcion() (~1s real, más en conexiones
    // lentas), el aside quedaba como flex item ESTÁTICO de 280px --
    // confirmado real con un poll de 15ms: scrollWidth 539 vs viewport
    // 375 durante toda esa ventana, recién bajaba al llamar esta función.
    // Con el estado base en CSS, el aside nace ya posicionado fuera de
    // pantalla desde el primer paint, sin depender de ningún timing de
    // JS -- esta función ahora SOLO agrega la interactividad (botón,
    // backdrop, listeners), nunca el layout.
    function _mountMobileSidebarToggle(aside) {
        if (document.getElementById('mobileSidebarToggle')) return;

        const toggle = document.createElement('button');
        toggle.id = 'mobileSidebarToggle';
        toggle.setAttribute('aria-label', 'Abrir menú');
        toggle.className = 'md:hidden fixed top-4 left-4 z-[60] w-11 h-11 rounded-full bg-nlt-bg/90 border border-white/10 backdrop-blur-xl flex items-center justify-center text-gray-300 hover:text-white transition-colors cursor-pointer shadow-lg';
        toggle.innerHTML = '<i class="ph-bold ph-list text-lg"></i>';
        document.body.appendChild(toggle);

        const backdrop = document.createElement('div');
        backdrop.id = 'mobileSidebarBackdrop';
        backdrop.className = 'hidden md:hidden fixed inset-0 bg-black/60 z-40';
        document.body.appendChild(backdrop);

        function abrir() {
            aside.classList.add('sidebar-open');
            backdrop.classList.remove('hidden');
            toggle.innerHTML = '<i class="ph-bold ph-x text-lg"></i>';
        }
        function cerrar() {
            aside.classList.remove('sidebar-open');
            backdrop.classList.add('hidden');
            toggle.innerHTML = '<i class="ph-bold ph-list text-lg"></i>';
        }
        toggle.addEventListener('click', () => aside.classList.contains('sidebar-open') ? cerrar() : abrir());
        backdrop.addEventListener('click', cerrar);
        aside.querySelectorAll('a').forEach((a) => a.addEventListener('click', cerrar));
    }

    // Inserta el sidebar en <aside id="sidebar"></aside> y engancha email,
    // admin y plan -- reemplaza la lógica que cada página repetía a mano.
    // planLabel opcional: si la página ya tiene la suscripción cargada (ej.
    // dashboard.html, que la usa también para sus métricas), se la pasa acá
    // para no pedirla dos veces; si no se pasa, se busca sola vía NLT_API
    // (si el script está cargado en la página).
    async function mountSidebar(session, { activo, seccion = 'cfd', planLabel } = {}) {
        _mountGlobalVisualEffects();
        const aside = document.getElementById('sidebar');
        if (!aside) return;
        aside.innerHTML = renderSidebar({ activo, seccion });
        _mountMobileSidebarToggle(aside);
        mountNotifBell('sidebarNotifBell');

        document.getElementById('userEmail').textContent = session.user.email;
        mountProfileMenu(session, 'sidebarProfile');

        function _revelarNavAdmin() {
            const navAdmin = document.getElementById('nav-admin');
            if (!navAdmin) return;
            navAdmin.classList.remove('hidden');
            navAdmin.classList.add('flex');
        }
        function _revelarNavEquipo() {
            const navEquipo = document.getElementById('nav-equipo');
            if (!navEquipo) return;
            navEquipo.classList.remove('hidden');
            navEquipo.classList.add('flex');
        }

        if (isAdmin(session)) {
            _revelarNavAdmin();
            _revelarNavEquipo();
        } else if (typeof window.NLT_API !== 'undefined') {
            // "Equipo" solo es relevante para el puñado de personas del
            // equipo interno de NLT -- para el resto de usuarios esta
            // llamada devuelve es_miembro:false y el link nunca aparece.
            // Fire-and-forget: un fallo acá nunca debe romper el resto del
            // sidebar (mismo criterio que el resto de mountSidebar).
            window.NLT_API.teamMiRol().then((rol) => {
                if (rol && rol.es_miembro) _revelarNavEquipo();
            }).catch(() => {});
        }

        const labelEl = document.getElementById('userPlanLabel');
        if (!labelEl) return;
        if (planLabel !== undefined) {
            labelEl.textContent = planLabel;
        } else if (typeof window.NLT_API !== 'undefined') {
            try {
                const sub = await window.NLT_API.miSuscripcion();
                labelEl.textContent = (sub && sub.plan && sub.status === 'active') ? sub.plan : 'Sin plan activo';
                // tiene_acceso_admin viaja en esta MISMA respuesta (piggyback
                // en /billing/subscription, que esta pagina ya pedia) -- un
                // admin secundario ve el link "Admin" sin sumar ningun
                // request de red nuevo. isAdmin(session) ya cubrio al Global
                // Admin arriba, así que esto es solo para admins secundarios.
                if (!isAdmin(session) && sub && sub.tiene_acceso_admin) _revelarNavAdmin();
            } catch (err) {
                labelEl.textContent = '';
            }
        }
    }

    // Franja compacta de acceso rápido a los módulos del ecosistema (Fase 2:
    // "NLT Platform" visible desde el Dashboard) -- reutiliza NLT_MODULES,
    // la misma fuente que usa la homepage, para no mantener la lista dos veces.
    function renderModuleStrip(activo) {
        return NLT_MODULES.map((m) => {
            const active = m.id === activo;
            const disponible = m.status === 'live';
            const tag = disponible ? 'a' : 'div';
            const hrefAttr = disponible ? `href="${m.href}"` : '';
            const c = m.color || '67,120,255';
            const estadoCls = active
                ? ''
                : disponible
                    ? 'border-white/5 text-gray-300 hover:border-white/15 hover:bg-white/5 cursor-pointer'
                    : 'border-white/5 text-gray-600 opacity-60';
            const estadoStyle = active
                ? ` style="background:rgba(${c},0.12); border-color:rgba(${c},0.4); color:rgb(${c}); box-shadow:0 0 24px -10px rgba(${c},0.7)"`
                : '';
            const iconStyle = disponible && !active ? ` style="color:rgb(${c})"` : '';
            return `
                <${tag} ${hrefAttr} class="shrink-0 flex items-center gap-2.5 px-4 py-2.5 rounded-2xl border transition-all ${estadoCls}"${estadoStyle}>
                    <i class="ph-fill ${m.icono} text-base"${iconStyle}></i>
                    <span class="text-xs font-semibold whitespace-nowrap">${m.nombre}</span>
                    ${!disponible ? '<span class="text-[8px] uppercase font-bold text-gray-600 border border-gray-700 rounded-full px-1.5 py-0.5 ml-0.5">Pronto</span>' : ''}
                </${tag}>
            `;
        }).join('');
    }

    // Red de seguridad para [data-reveal] (animaciones "aparecer al hacer
    // scroll" con GSAP ScrollTrigger, usadas en 8 páginas: index, ecosystem,
    // copy-system, plans, indicator, academy, calculators, news). Confirmado
    // real (14/08, navegando copy-system.html en mobile): 24 de 27 elementos
    // quedaban en opacity:0 PARA SIEMPRE -- causa conocida de ScrollTrigger,
    // el resize dinámico de la barra de direcciones del navegador en mobile
    // invalida sus cálculos de posición justo después de cargar la página,
    // y el trigger de scroll nunca llega a dispararse para el contenido que
    // ya estaba "pasado" ese punto. No importa arreglar la causa exacta en
    // cada una de las 8 páginas -- lo que nunca puede pasar es que quede
    // contenido invisible. Si sigue en opacity:0 pasado un tiempo prudencial,
    // se fuerza visible directamente, sin esperar a que GSAP decida.
    function _revealSafetyNet() {
        // 16 de las 24 páginas no usan [data-reveal] en absoluto -- sin este
        // corte, igual corrían querySelectorAll + getComputedStyle (fuerza
        // recálculo de layout) dos veces por carga, sobre las 24 páginas.
        if (!document.querySelector('[data-reveal]')) return;
        const forzarVisibles = () => {
            document.querySelectorAll('[data-reveal]').forEach((el) => {
                if (getComputedStyle(el).opacity === '0') {
                    el.style.opacity = '1';
                    el.style.transform = 'none';
                }
            });
        };
        window.addEventListener('load', () => setTimeout(forzarVisibles, 1200));
        setTimeout(forzarVisibles, 2500); // red final, por si 'load' tarda o ya disparó
    }
    _revealSafetyNet();

    // Reemplaza a setInterval(fn, ms) directo para el polling de datos en
    // background (dashboard/cuentas/maestra/futuros/news) -- antes esos
    // temporizadores corrían para siempre aunque el usuario cambiara de
    // pestaña, gastando batería/CPU y red sin que nadie estuviera mirando.
    // Se pausa solo con document.hidden===true y, al volver a estar
    // visible, refresca una vez de inmediato (los datos pudieron quedar
    // viejos) y retoma el intervalo normal.
    function pollWhileVisible(fn, ms) {
        let id = null;
        function start() {
            if (id !== null) return;
            id = setInterval(fn, ms);
        }
        function stop() {
            if (id === null) return;
            clearInterval(id);
            id = null;
        }
        if (!document.hidden) start();
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                stop();
            } else {
                fn();
                start();
            }
        });
        return { stop, start };
    }

    // ─── NLT Global Notification Center (🔔) ──────────────────────────
    // Capa transversal: el mismo componente se monta en las 14 páginas del
    // sidebar (ver renderSidebar más abajo) y, por separado, en Community y
    // Academy (headers propios, ver community.html/academy-dashboard.html)
    // -- una sola implementación, nunca 3 sistemas distintos. Pega contra
    // /community/notifications* (nombre histórico del endpoint -- ver
    // auditoría: la tabla ya es la infraestructura global, no hace falta
    // mover la URL para no romper contratos existentes).
    function _escNotif(texto) {
        return String(texto ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _tiempoRelativoNotif(iso) {
        const diff = (Date.now() - new Date(iso).getTime()) / 1000;
        if (diff < 60) return 'ahora';
        if (diff < 3600) return `${Math.floor(diff / 60)}m`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
        return `${Math.floor(diff / 86400)}d`;
    }

    const _NOTIF_ICONOS = {
        comment: 'ph-chat-circle', reply: 'ph-arrow-bend-up-left', reaction: 'ph-heart',
        mention: 'ph-at', announcement: 'ph-megaphone', certificate: 'ph-certificate',
        new_dm: 'ph-envelope-simple-open', elite_signal_new: 'ph-chart-line-up', elite_signal_tp: 'ph-target',
        elite_signal_sl: 'ph-warning-octagon', elite_signal_cancelled: 'ph-x-circle', elite_signal_expired: 'ph-clock-countdown',
        academy_lesson_completed: 'ph-check-circle', academy_certificate: 'ph-certificate',
        payment_confirmed: 'ph-credit-card', payment_failed: 'ph-credit-card',
        subscription_renewal: 'ph-arrows-clockwise', subscription_cancelled: 'ph-x-circle',
        promotion: 'ph-tag', new_feature: 'ph-sparkle',
        support_message_new: 'ph-lifebuoy', support_reply: 'ph-lifebuoy',
    };

    // Navegación al hacer click (Fase 5: "abrir el recurso correspondiente
    // cuando exista") -- a nivel de PÁGINA, no de anchor puntual (mismos
    // ejemplos que pidió el pedido: "Nueva señal -> Elite Signals", no un
    // deep-link a la señal exacta -- no se inventa esa capacidad).
    const _NOTIF_HREFS = {
        comment: 'community.html', reply: 'community.html', reaction: 'community.html', mention: 'community.html',
        announcement: 'community.html', certificate: 'academy-dashboard.html',
        new_dm: 'community.html?vista=mensajes',
        elite_signal_new: 'signals-dashboard.html', elite_signal_tp: 'signals-dashboard.html',
        elite_signal_sl: 'signals-dashboard.html', elite_signal_cancelled: 'signals-dashboard.html', elite_signal_expired: 'signals-dashboard.html',
        academy_lesson_completed: 'academy-dashboard.html', academy_certificate: 'academy-dashboard.html',
        payment_confirmed: 'suscripcion.html', payment_failed: 'suscripcion.html',
        subscription_renewal: 'suscripcion.html', subscription_cancelled: 'suscripcion.html',
        promotion: 'dashboard.html', new_feature: 'dashboard.html',
        // support_message_new: le llega a un admin con permiso "soporte" ->
        // directo a la bandeja de Admin. support_reply: le llega al usuario
        // que escribió -> el fallback es Dashboard, pero _irAlRecurso (abajo)
        // abre el widget flotante en el momento si ya está montado en la
        // página actual, en vez de navegar.
        support_message_new: 'admin.html#soporte', support_reply: 'dashboard.html',
    };

    function notifBellHTML(idPrefix = 'notifBell') {
        return `
            <div class="relative" id="${idPrefix}Box">
                <button id="${idPrefix}Btn" type="button" aria-label="Notificaciones" class="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-300 relative transition-colors">
                    <i class="ph ph-bell text-lg"></i>
                    <span id="${idPrefix}Badge" class="hidden absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-nlt-danger text-white text-[9px] font-bold flex items-center justify-center"></span>
                </button>
                <div id="${idPrefix}Panel" class="hidden absolute top-11 w-80 max-h-96 overflow-y-auto glass-card p-0 z-50 shadow-2xl"></div>
            </div>
        `;
    }

    // Monta el comportamiento sobre markup ya insertado en el DOM (por
    // renderSidebar, o pegado a mano en community.html/academy-dashboard.html)
    // -- separado de notifBellHTML para que cada página decida DÓNDE va el
    // botón sin duplicar la lógica de polling/render/click.
    function mountNotifBell(idPrefix = 'notifBell') {
        const btn = document.getElementById(`${idPrefix}Btn`);
        const badge = document.getElementById(`${idPrefix}Badge`);
        const panel = document.getElementById(`${idPrefix}Panel`);
        if (!btn || !badge || !panel || typeof window.NLT_API === 'undefined') return null;

        async function refrescarBadge() {
            try {
                const { count } = await window.NLT_API.communityNoLeidas();
                if (count > 0) { badge.textContent = count > 9 ? '9+' : String(count); badge.classList.remove('hidden'); }
                else badge.classList.add('hidden');
            } catch (_) {
                badge.classList.add('hidden');
            }
        }

        function _irAlRecurso(n) {
            const href = _NOTIF_HREFS[n.type] || 'dashboard.html';
            const [ruta] = href.split('?');
            // Ya estamos en Community y la notificación es de DM -- cambia de
            // pestaña en la misma página en vez de recargarla (mejor UX, sin
            // inventar un router: solo se usa si la función ya existe en scope).
            if (n.type === 'new_dm' && window.location.pathname.endsWith(ruta.split('?')[0]) && typeof window.mostrarVista === 'function') {
                panel.classList.add('hidden');
                window.mostrarVista('mensajes');
                return;
            }
            // support_reply: si el widget de "Contact us" ya está montado en
            // esta misma página (está en casi todas, ver mountSupportChat),
            // se abre directo en vez de navegar -- mejor UX que mandar a
            // Dashboard para terminar abriendo el mismo panel igual.
            if (n.type === 'support_reply' && typeof window.NLT !== 'undefined' && typeof window.NLT.abrirSupportChat === 'function') {
                panel.classList.add('hidden');
                window.NLT.abrirSupportChat();
                return;
            }
            window.location.href = href;
        }

        function _renderItem(n) {
            const icono = _NOTIF_ICONOS[n.type] || 'ph-bell';
            const titulo = n.title ? _escNotif(n.title) : '';
            return `
                <button type="button" data-id="${n.id}" class="notif-item w-full text-left p-3 border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors flex gap-2.5 items-start ${n.read ? 'opacity-60' : ''}">
                    <i class="ph-fill ${icono} text-nlt-accent text-base mt-0.5 shrink-0"></i>
                    <span class="flex-1 min-w-0">
                        ${titulo ? `<p class="text-xs font-semibold text-white truncate">${titulo}</p>` : ''}
                        <p class="text-xs text-gray-300 line-clamp-2">${_escNotif(n.message)}</p>
                        <p class="text-[10px] text-gray-600 mt-0.5">${_tiempoRelativoNotif(n.created_at)}</p>
                    </span>
                    ${!n.read ? '<span class="w-2 h-2 rounded-full bg-nlt-accent shrink-0 mt-1"></span>' : ''}
                </button>
            `;
        }

        function _posicionarPanel() {
            // El bundle de Tailwind de este proyecto está PRECOMPILADO (sin
            // build step JIT) -- una clase arbitraria nueva (ej. w-[min(...)])
            // simplemente no existe en el CSS y no tiene efecto (confirmado:
            // 0 matches en assets/css/tailwind.css). Por eso el ancho máximo
            // se fuerza acá con estilos inline, nunca con una clase nueva.
            //
            // right-0 puro (absolute, la clase de base) asume que sobra
            // espacio a la izquierda del botón -- falso en mobile cuando el
            // botón NO está pegado al borde derecho REAL de la pantalla
            // (header de Community/Academy, a diferencia del sidebar de
            // escritorio). "left" en un elemento absolute es relativo a su
            // offset parent (el propio wrapper del botón), NO al viewport --
            // por eso, cuando no entra, se pasa a fixed (ahí sí left/top son
            // relativos al viewport real) en vez de solo cambiar left/right.
            const ancho = Math.min(320, window.innerWidth - 24);
            panel.style.width = `${ancho}px`;
            const rectBtn = btn.getBoundingClientRect();
            if (rectBtn.right - ancho >= 8) {
                panel.style.position = '';
                panel.style.top = '';
                panel.style.left = 'auto';
                panel.style.right = '0';
            } else {
                panel.style.position = 'fixed';
                panel.style.top = `${rectBtn.bottom + 6}px`;
                panel.style.left = '8px';
                panel.style.right = 'auto';
            }
        }

        async function abrirPanel() {
            const oculto = panel.classList.contains('hidden');
            panel.classList.toggle('hidden');
            if (!oculto) return; // se estaba cerrando, nada más que hacer

            panel.innerHTML = '<p class="text-xs text-gray-500 animate-pulse p-4">Cargando...</p>';
            _posicionarPanel();
            let notifs;
            try {
                notifs = await window.NLT_API.communityNotificaciones();
            } catch (_) {
                panel.innerHTML = '<p class="text-xs text-nlt-danger p-4">No se pudieron cargar las notificaciones.</p>';
                return;
            }
            if (!notifs.length) {
                panel.innerHTML = '<p class="text-xs text-gray-500 p-4">Sin notificaciones todavía.</p>';
                return;
            }
            panel.innerHTML = `
                <div class="flex items-center justify-between p-3 border-b border-white/5">
                    <p class="text-xs font-semibold text-white">Notificaciones</p>
                    <button id="${idPrefix}MarcarTodas" type="button" class="text-[10px] text-nlt-accent hover:underline cursor-pointer">Marcar todas leídas</button>
                </div>
                ${notifs.map(_renderItem).join('')}
            `;
            document.getElementById(`${idPrefix}MarcarTodas`).addEventListener('click', async (e) => {
                e.stopPropagation();
                try { await window.NLT_API.communityMarcarTodasLeidas(); } catch (_) { /* red -- se reintenta en el próximo open */ }
                refrescarBadge();
                panel.querySelectorAll('.notif-item').forEach((el) => {
                    el.classList.add('opacity-60');
                    const punto = el.querySelector('.bg-nlt-accent.shrink-0');
                    if (punto) punto.remove();
                });
            });
            panel.querySelectorAll('.notif-item').forEach((el) => {
                el.addEventListener('click', () => {
                    const n = notifs.find((x) => x.id === el.getAttribute('data-id'));
                    if (!n) return;
                    if (!n.read) window.NLT_API.communityMarcarLeida(n.id).catch(() => {});
                    _irAlRecurso(n);
                });
            });
        }

        btn.addEventListener('click', (e) => { e.stopPropagation(); abrirPanel(); });
        document.addEventListener('click', (e) => {
            if (!panel.classList.contains('hidden') && !panel.contains(e.target) && e.target !== btn) panel.classList.add('hidden');
        });

        refrescarBadge();
        pollWhileVisible(refrescarBadge, 20000);
        return { refrescarBadge };
    }

    // --- Perfil global (menú de cuenta) ---------------------------------------
    // Reemplaza dos puntos sueltos que existían antes: la tarjeta estática del
    // fondo del sidebar (solo mostraba iniciales, sin click) y el botón de
    // texto "Cerrar sesión" repetido a mano en el <header> de 18 páginas
    // distintas. Un solo componente: click en el avatar abre un dropdown con
    // "Mi perfil", "Configuración" y "Cerrar sesión" al final. Reutiliza 100%
    // el mecanismo de foto/nombre ya construido para Community
    // (GET/PATCH /community/profile/me) -- confirmado que ese endpoint solo
    // exige sesión (get_current_user_id), sin requiere_membresia, así que
    // sirve como identidad "global" del ecosistema para CUALQUIER usuario
    // logueado, sin ninguna tabla/endpoint nuevo.

    function _inicialesPerfil(nombre) {
        return String(nombre || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
    }

    // Avatar compacto + panel -- usado por mountPublicHeader() y por
    // community.html (#miPerfilSlot, ver Fase 2). El sidebar autenticado NO
    // usa esto: su tarjeta (avatar+email+plan) ya viene escrita a mano en
    // renderSidebar(), pero se conecta con el mismo mountProfileMenu() de abajo.
    function profileMenuHTML(idPrefix) {
        return `
            <div class="relative" id="${idPrefix}Box">
                <button id="${idPrefix}Btn" type="button" aria-label="Mi cuenta" class="w-9 h-9 rounded-full bg-gradient-to-tr from-gray-700 to-gray-600 flex items-center justify-center text-[10px] font-bold text-white overflow-hidden cursor-pointer" data-nlt-profile-avatar>·</button>
                <div id="${idPrefix}Panel" class="hidden glass-card p-0 overflow-hidden nlt-profile-panel"></div>
            </div>
        `;
    }

    // El bundle de Tailwind de este proyecto está PRECOMPILADO (sin build
    // JIT) -- clases arbitrarias nuevas que ningún .html use ya (ej.
    // top-full/bottom-full/w-64/shadow-2xl, confirmado con grep contra
    // tailwind.css: 0 matches) simplemente no existen y no tienen efecto,
    // igual que el caso ya documentado en _posicionarPanel() del notif bell.
    // Por eso el panel de perfil se posiciona con position:fixed calculado
    // en JS (ver _posicionarPerfilPanel), nunca con clases de posición
    // nuevas -- mismo patrón ya probado acá mismo para el notif bell.
    let _profileMenuCSSInyectado = false;
    function _inyectarProfileMenuCSS() {
        if (_profileMenuCSSInyectado) return;
        _profileMenuCSSInyectado = true;
        const style = document.createElement('style');
        style.textContent = `.nlt-profile-panel { width: 256px; max-width: calc(100vw - 24px); box-shadow: 0 20px 45px -12px rgba(0,0,0,0.55); z-index: 50; }`;
        document.head.appendChild(style);
    }
    function _posicionarPerfilPanel(btn, panel) {
        const rect = btn.getBoundingClientRect();
        const alturaEstimada = 220;
        const abrirArriba = (window.innerHeight - rect.bottom) < alturaEstimada && rect.top > alturaEstimada;
        panel.style.position = 'fixed';
        const ancho = Math.min(256, window.innerWidth - 24);
        panel.style.width = `${ancho}px`;
        if (rect.right - ancho >= 8) {
            panel.style.left = 'auto';
            panel.style.right = `${window.innerWidth - rect.right}px`;
        } else {
            panel.style.right = 'auto';
            panel.style.left = '12px';
        }
        if (abrirArriba) {
            panel.style.top = 'auto';
            panel.style.bottom = `${window.innerHeight - rect.top + 8}px`;
        } else {
            panel.style.bottom = 'auto';
            panel.style.top = `${rect.bottom + 8}px`;
        }
    }

    // idPrefix debe tener ya insertado el markup de profileMenuHTML() (o, en
    // el caso del sidebar, el markup equivalente escrito a mano en
    // renderSidebar()) -- mismo patrón que mountNotifBell(). opts:
    //   - perfilInicial: {avatar_url, display_name} ya cargado (evita un
    //     fetch duplicado si la página que llama ya lo tiene, ej. community.html).
    //   - onMiPerfil: handler custom para "Mi perfil" (community.html lo usa
    //     para abrir SU vista de perfil en vez del modal genérico).
    //   - miPerfilLabel: texto custom del ítem "Mi perfil" en el menú.
    async function mountProfileMenu(session, idPrefix, opts = {}) {
        const box = document.getElementById(`${idPrefix}Box`);
        const btn = document.getElementById(`${idPrefix}Btn`);
        const panel = document.getElementById(`${idPrefix}Panel`);
        if (!box || !btn || !panel || !session) return;
        const avatarSlot = box.querySelector('[data-nlt-profile-avatar]');

        function pintarAvatar(p) {
            if (!avatarSlot) return;
            avatarSlot.innerHTML = p && p.avatar_url
                ? `<img src="${_escNotif(p.avatar_url)}" alt="" class="w-full h-full object-cover">`
                : _escNotif(_inicialesPerfil(p ? p.display_name : session.user.email));
        }

        if (avatarSlot) avatarSlot.textContent = (session.user.email || '??').slice(0, 2).toUpperCase();
        if (opts.perfilInicial) {
            pintarAvatar(opts.perfilInicial);
        } else if (typeof window.NLT_API !== 'undefined') {
            // Fire-and-forget: si falla (red, o esta página no cargó
            // nlt-api-client.js) se queda con las iniciales del email, igual
            // que se comportaba antes -- nunca bloquea el resto de la página.
            window.NLT_API.communityMiPerfil().then(pintarAvatar).catch(() => {});
        }

        _inyectarProfileMenuCSS();
        function cerrarPanel() { panel.classList.add('hidden'); }
        function abrirPanel() {
            _posicionarPerfilPanel(btn, panel);
            const label = opts.miPerfilLabel || 'Mi perfil';
            panel.innerHTML = `
                <div class="px-4 py-3 border-b border-white/5">
                    <p class="text-xs font-semibold text-white truncate">${_escNotif(session.user.email)}</p>
                </div>
                <button id="${idPrefix}MenuPerfil" type="button" class="w-full text-left px-4 py-2.5 text-xs text-gray-300 hover:bg-white/5 hover:text-white transition-colors cursor-pointer flex items-center gap-2"><i class="ph ph-user-circle text-sm"></i> ${_escNotif(label)}</button>
                <a href="configuracion.html" class="block px-4 py-2.5 text-xs text-gray-300 hover:bg-white/5 hover:text-white transition-colors flex items-center gap-2"><i class="ph ph-gear-six text-sm"></i> Configuración</a>
                <div class="border-t border-white/5"></div>
                <button id="${idPrefix}MenuSalir" type="button" class="w-full text-left px-4 py-2.5 text-xs text-nlt-danger hover:bg-nlt-danger/10 transition-colors cursor-pointer flex items-center gap-2"><i class="ph ph-sign-out text-sm"></i> Cerrar sesión</button>
            `;
            panel.classList.remove('hidden');
            document.getElementById(`${idPrefix}MenuPerfil`).addEventListener('click', () => {
                cerrarPanel();
                if (typeof opts.onMiPerfil === 'function') opts.onMiPerfil();
                else abrirModalPerfilGlobal();
            });
            document.getElementById(`${idPrefix}MenuSalir`).addEventListener('click', () => signOut());
        }

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.classList.contains('hidden') ? abrirPanel() : cerrarPanel();
        });
        document.addEventListener('click', (e) => {
            if (!panel.classList.contains('hidden') && !box.contains(e.target)) cerrarPanel();
        });
    }

    // --- Modal "Mi perfil" (global, dos campos: foto + nombre) ----------------
    // Reutiliza EXACTAMENTE el mismo mecanismo que ya usa community.html para
    // editar avatar/nombre (mismo upload, mismo PATCH parcial) pero como modal
    // centrado, para poder abrirse desde cualquier página, no solo desde el
    // feed de Community. Username/bio/privacidad quedan en el editor completo
    // de Community (link al final del modal) -- son conceptos propios de esa
    // sección, no de la identidad global del ecosistema.
    let _modalPerfilGlobalMontado = false;
    function _montarModalPerfilGlobalDOM() {
        if (_modalPerfilGlobalMontado) return;
        _modalPerfilGlobalMontado = true;
        const overlay = document.createElement('div');
        overlay.id = 'nltPerfilGlobalModal';
        overlay.className = 'fixed inset-0 z-[100] hidden bg-black/85 backdrop-blur-sm flex items-center justify-center p-5';
        overlay.innerHTML = `
            <div class="nlt-modal-panel glass-card w-full max-w-sm p-6">
                <div class="flex items-center justify-between mb-5">
                    <h3 class="text-sm font-semibold text-white">Mi perfil</h3>
                    <button id="btn-cerrar-perfil-global" type="button" class="text-gray-500 hover:text-white cursor-pointer"><i class="ph-bold ph-x text-lg"></i></button>
                </div>
                <div id="perfilGlobalBody"><p class="text-xs text-gray-500 animate-pulse">Cargando...</p></div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrarModalPerfilGlobal(); });
        document.getElementById('btn-cerrar-perfil-global').addEventListener('click', cerrarModalPerfilGlobal);
    }
    function cerrarModalPerfilGlobal() {
        const overlay = document.getElementById('nltPerfilGlobalModal');
        if (overlay) overlay.classList.add('hidden');
    }
    async function abrirModalPerfilGlobal() {
        _montarModalPerfilGlobalDOM();
        const overlay = document.getElementById('nltPerfilGlobalModal');
        const body = document.getElementById('perfilGlobalBody');
        overlay.classList.remove('hidden');
        body.innerHTML = '<p class="text-xs text-gray-500 animate-pulse">Cargando...</p>';
        animarEntradaModal(overlay.firstElementChild);

        if (typeof window.NLT_API === 'undefined') {
            body.innerHTML = '<p class="text-xs text-nlt-danger">No se pudo cargar tu perfil.</p>';
            return;
        }
        let perfil;
        try {
            perfil = await window.NLT_API.communityMiPerfil();
        } catch (err) {
            body.innerHTML = `<p class="text-xs text-nlt-danger">No se pudo cargar tu perfil: ${_escNotif(err.message)}</p>`;
            return;
        }

        let avatarUrlActual = perfil.avatar_url || null;
        body.innerHTML = `
            <div class="flex items-center gap-3 mb-4">
                <div id="pgAvatarPreview" class="w-14 h-14 rounded-full bg-gradient-to-tr from-gray-700 to-gray-600 flex items-center justify-center text-sm font-bold text-white overflow-hidden shrink-0">${avatarUrlActual ? `<img src="${_escNotif(avatarUrlActual)}" class="w-full h-full object-cover" alt="">` : _escNotif(_inicialesPerfil(perfil.display_name))}</div>
                <div>
                    <input type="file" id="pgAvatarInput" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden">
                    <button id="btn-pg-cambiar-avatar" type="button" class="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold cursor-pointer">Cambiar foto</button>
                    <p id="pgAvatarMsg" class="text-[11px] text-gray-500 mt-1 hidden"></p>
                </div>
            </div>
            <input id="pgDisplayName" placeholder="Nombre visible" value="${_escNotif(perfil.display_name)}" class="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-sm text-white mb-4">
            <div class="flex items-center gap-2 mb-4">
                <button id="btn-pg-guardar" type="button" class="px-4 py-2 rounded-full bg-nlt-accent text-white text-xs font-semibold cursor-pointer">Guardar</button>
                <p id="pgMsg" class="text-xs hidden"></p>
            </div>
            <a href="community.html?editar_perfil=1" class="text-[11px] text-nlt-accent hover:underline">Editar perfil completo de Community →</a>
        `;
        document.getElementById('btn-pg-cambiar-avatar').addEventListener('click', () => document.getElementById('pgAvatarInput').click());
        document.getElementById('pgAvatarInput').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const msg = document.getElementById('pgAvatarMsg');
            msg.classList.remove('hidden'); msg.className = 'text-[11px] text-gray-500 mt-1'; msg.textContent = 'Subiendo...';
            try {
                const { url } = await window.NLT_API.communitySubirImagen(file);
                avatarUrlActual = url;
                document.getElementById('pgAvatarPreview').innerHTML = `<img src="${_escNotif(url)}" class="w-full h-full object-cover" alt="">`;
                msg.className = 'text-[11px] text-nlt-success mt-1'; msg.textContent = '✓ Foto lista -- haz click en Guardar';
            } catch (err) {
                msg.className = 'text-[11px] text-nlt-danger mt-1'; msg.textContent = 'Error: ' + err.message;
            }
        });
        document.getElementById('btn-pg-guardar').addEventListener('click', async () => {
            const msg = document.getElementById('pgMsg');
            const nombre = document.getElementById('pgDisplayName').value.trim();
            msg.classList.remove('hidden'); msg.className = 'text-xs text-gray-400'; msg.textContent = 'Guardando...';
            try {
                await window.NLT_API.communityActualizarPerfil({ display_name: nombre, avatar_url: avatarUrlActual });
                msg.className = 'text-xs text-nlt-success'; msg.textContent = '✓ Guardado';
                // Refresca cualquier avatar de perfil ya montado en esta misma
                // página (sidebar y/o header) sin recargar.
                document.querySelectorAll('[data-nlt-profile-avatar]').forEach((el) => {
                    el.innerHTML = avatarUrlActual ? `<img src="${_escNotif(avatarUrlActual)}" alt="" class="w-full h-full object-cover">` : _escNotif(_inicialesPerfil(nombre));
                });
            } catch (err) {
                msg.className = 'text-xs text-nlt-danger'; msg.textContent = 'Error: ' + err.message;
            }
        });
    }

    // --- "Contact us" (chat de soporte flotante) ------------------------------
    // Burbuja + panel flotante, montada UNA sola vez por página para
    // CUALQUIER usuario logueado, sin exigir ninguna suscripción -- reusa
    // GET/POST /support/conversation/* (ver NLT_API/app/api/routes/support.py:
    // ese endpoint NUNCA exige membresía, a propósito). Se monta
    // automáticamente desde requireSession() y mountPublicHeader() (ver esas
    // funciones más arriba) -- ninguna de las ~39 páginas necesita llamarla a
    // mano. Del lado del equipo (admin.html -> tab Soporte) se responde con
    // adminSupportResponder -- acá solo vive el lado usuario.
    let _supportChatCSSInyectado = false;
    function _inyectarSupportChatCSS() {
        if (_supportChatCSSInyectado) return;
        _supportChatCSSInyectado = true;
        const style = document.createElement('style');
        style.textContent = `
            .nlt-support-bubble {
                position: fixed; bottom: 20px; right: 20px; z-index: 55;
                width: 56px; height: 56px; border-radius: 9999px; border: none;
                background: var(--color-nlt-accent, #4378ff); color: #fff;
                display: flex; align-items: center; justify-content: center;
                box-shadow: 0 10px 30px -8px rgba(67,120,255,0.55);
                cursor: pointer; transition: transform 180ms ease;
            }
            .nlt-support-bubble:hover { transform: scale(1.06); }
            .nlt-support-badge {
                position: absolute; top: -2px; right: -2px; min-width: 18px; height: 18px;
                padding: 0 4px; border-radius: 9999px; background: var(--color-nlt-danger, #ef4444);
                color: #fff; font-size: 10px; font-weight: 700; display: none;
                align-items: center; justify-content: center; border: 2px solid var(--color-nlt-bg, #05070d);
            }
            .nlt-support-panel {
                position: fixed; bottom: 88px; right: 20px; z-index: 55;
                width: 340px; max-width: calc(100vw - 24px);
                height: 480px; max-height: calc(100vh - 120px);
                display: none; flex-direction: column; overflow: hidden; border-radius: 24px;
                box-shadow: 0 25px 50px -12px rgba(0,0,0,0.55);
            }
            /* display:none/flex propio, en vez de depender de la clase
               compartida .hidden -- este <style> se inyecta en <head> DESPUÉS
               de tailwind.css (recién cuando se monta el widget), así que en
               un empate de especificidad esta regla siempre le gana a
               .hidden{display:none} y el panel quedaba SIEMPRE visible (bug
               real reportado: "el chat aparece abierto siempre"). Con el
               estado manejado 100% acá adentro (.nlt-support-panel-open) no
               hay cascada compartida de la que depender. */
            .nlt-support-panel.nlt-support-panel-open { display: flex; }
            @media (max-width: 480px) {
                .nlt-support-panel { right: 12px; left: 12px; width: auto; bottom: 84px; }
            }
            @media (prefers-reduced-motion: reduce) {
                .nlt-support-bubble { transition: none; }
            }
        `;
        document.head.appendChild(style);
    }

    function _renderMensajesSupportChat(mensajes) {
        const cont = document.getElementById('supportChatMensajes');
        if (!cont) return;
        if (!mensajes.length) {
            cont.innerHTML = '<p class="text-xs text-gray-500 text-center py-6">Escribinos lo que necesites -- el equipo NLT te responde acá mismo.</p>';
            return;
        }
        cont.innerHTML = mensajes.map((m) => {
            const esMio = m.sender_role === 'user';
            // Nunca se muestra QUÉ persona del equipo respondió (ver
            // support.sql) -- siempre "Equipo NLT" genérico.
            const quien = esMio ? '' : '<p class="text-[10px] text-nlt-accent font-semibold mb-0.5">Equipo NLT</p>';
            return `
                <div class="flex ${esMio ? 'justify-end' : 'justify-start'}">
                    <div class="max-w-[80%] ${esMio ? 'bg-nlt-accent text-white' : 'bg-white/5 text-gray-200'} rounded-2xl px-3 py-2">
                        ${quien}
                        <p class="text-xs whitespace-pre-wrap break-words">${_escNotif(m.content)}</p>
                    </div>
                </div>
            `;
        }).join('');
        cont.scrollTop = cont.scrollHeight;
    }

    function mountSupportChat(session) {
        if (!session || document.getElementById('supportChatBubble') || typeof window.NLT_API === 'undefined') return;
        _inyectarSupportChatCSS();

        const bubble = document.createElement('button');
        bubble.id = 'supportChatBubble';
        bubble.type = 'button';
        bubble.setAttribute('aria-label', 'Contact us');
        bubble.className = 'nlt-support-bubble';
        bubble.innerHTML = '<i class="ph-fill ph-chats-circle" style="font-size:26px"></i><span id="supportChatBadge" class="nlt-support-badge"></span>';
        document.body.appendChild(bubble);

        const panel = document.createElement('div');
        panel.id = 'supportChatPanel';
        panel.className = 'nlt-support-panel glass-card';
        panel.innerHTML = `
            <div class="flex items-center justify-between px-4 py-3 border-b border-white/5 shrink-0">
                <p class="text-sm font-semibold text-white flex items-center gap-2"><i class="ph-fill ph-lifebuoy text-nlt-accent"></i> Contact us</p>
                <button id="btn-cerrar-support-chat" type="button" class="text-gray-500 hover:text-white cursor-pointer"><i class="ph-bold ph-x text-lg"></i></button>
            </div>
            <div id="supportChatMensajes" class="flex-1 overflow-y-auto px-3 py-3 space-y-2"></div>
            <div class="p-3 border-t border-white/5 shrink-0 flex items-end gap-2">
                <textarea id="supportChatInput" rows="1" placeholder="Escribe tu mensaje..." class="flex-1 bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-sm text-white resize-none"></textarea>
                <button id="btn-support-enviar" type="button" aria-label="Enviar" class="w-9 h-9 rounded-full bg-nlt-accent text-white flex items-center justify-center cursor-pointer shrink-0"><i class="ph-fill ph-paper-plane-tilt text-sm"></i></button>
            </div>
        `;
        document.body.appendChild(panel);

        let abierto = false;
        let cargado = false;

        async function _cargarMensajes() {
            try {
                _renderMensajesSupportChat(await window.NLT_API.supportMensajes());
            } catch (err) {
                const cont = document.getElementById('supportChatMensajes');
                if (cont) cont.innerHTML = '<p class="text-xs text-nlt-danger text-center py-6">No se pudo cargar la conversación.</p>';
            }
        }

        async function _refrescarBadge() {
            try {
                const { count } = await window.NLT_API.supportNoLeidos();
                const badge = document.getElementById('supportChatBadge');
                if (!badge) return;
                if (count > 0) { badge.textContent = count > 9 ? '9+' : String(count); badge.style.display = 'flex'; }
                else badge.style.display = 'none';
            } catch (_) {}
        }

        async function abrir() {
            panel.classList.add('nlt-support-panel-open');
            abierto = true;
            if (!cargado) { cargado = true; await _cargarMensajes(); }
            try { await window.NLT_API.supportMarcarLeido(); } catch (_) {}
            _refrescarBadge();
        }
        function cerrar() {
            panel.classList.remove('nlt-support-panel-open');
            abierto = false;
        }
        bubble._nltAbrir = abrir;  // hook para abrirSupportChat() -- ver Notification Center más arriba

        bubble.addEventListener('click', () => (abierto ? cerrar() : abrir()));
        document.getElementById('btn-cerrar-support-chat').addEventListener('click', cerrar);

        async function enviar() {
            const input = document.getElementById('supportChatInput');
            const contenido = input.value.trim();
            if (!contenido) return;
            input.value = '';
            input.disabled = true;
            try {
                await window.NLT_API.supportEnviarMensaje({
                    content: contenido,
                    client_message_id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                });
                await _cargarMensajes();
            } catch (err) {
                alert('No se pudo enviar el mensaje: ' + err.message);
            } finally {
                input.disabled = false;
                input.focus();
            }
        }
        document.getElementById('btn-support-enviar').addEventListener('click', enviar);
        document.getElementById('supportChatInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
        });

        _refrescarBadge();
        pollWhileVisible(_refrescarBadge, 20000);
        // Poll de mensajes nuevos SOLO mientras el panel está abierto -- no
        // gastar requests si el usuario ni lo tiene abierto (mismo criterio
        // de auto-pausa que el resto de los pollers de este archivo).
        pollWhileVisible(() => { if (abierto) _cargarMensajes(); }, 15000);
    }

    // Usado por el Notification Center (_irAlRecurso, más arriba) para abrir
    // el panel directo en vez de navegar, cuando el widget ya está montado
    // en la página actual.
    function abrirSupportChat() {
        const bubble = document.getElementById('supportChatBubble');
        if (bubble && typeof bubble._nltAbrir === 'function') bubble._nltAbrir();
    }

    // --- Motion System NLT (Performance Sprint, Fase F/11-13) ---------------
    // Reemplazo nativo de GSAP+ScrollTrigger para el patrón de scroll-reveal
    // que se repetía IDÉNTICO en las 10 páginas públicas (academy, broker,
    // copy-system, ecosystem, index, indicator, news, plans, propfirm,
    // signals): gsap.set(el,{y:24}) + gsap.to(el,{opacity:1,y:0,duration:0.8,
    // scrollTrigger:{trigger:el,start:'top 90%'}}) -- 115KB de librería
    // (gsap.min.js 72KB + ScrollTrigger.min.js 43KB) para un fade+translate
    // que un IntersectionObserver + CSS transitions hacen en unas pocas
    // líneas, más rápido de cargar y sin dependencia externa.
    //
    // Tokens de duración (pedido explícito): MICRO 120-180ms (micro-
    // interacciones: botones, chips), STANDARD 180-260ms (hover de cards,
    // dropdowns), EMPHASIS 260-400ms (reveals de entrada, modals). Un solo
    // easing consistente en todo el sitio -- variante de ease-out-expo,
    // "rápido al principio, se asienta suave" -- nunca un rebote/bounce.
    let _motionCSSInyectado = false;
    function _inyectarMotionCSS() {
        if (_motionCSSInyectado) return;
        _motionCSSInyectado = true;
        const style = document.createElement('style');
        style.textContent = `
            :root {
                --nlt-ease: cubic-bezier(0.16, 1, 0.3, 1);
                --nlt-micro: 150ms;
                --nlt-standard: 220ms;
                --nlt-emphasis: 350ms;
            }
            [data-reveal], [data-supreme-reveal] {
                opacity: 0; transform: translateY(24px);
                transition: opacity var(--nlt-emphasis) var(--nlt-ease), transform var(--nlt-emphasis) var(--nlt-ease);
            }
            [data-reveal].nlt-in, [data-supreme-reveal].nlt-in { opacity: 1; transform: translateY(0); }
            .nlt-modal-panel {
                opacity: 0; transform: translateY(24px) scale(0.97);
                transition: opacity var(--nlt-emphasis) var(--nlt-ease), transform var(--nlt-emphasis) var(--nlt-ease);
            }
            .nlt-modal-panel.nlt-in { opacity: 1; transform: translateY(0) scale(1); }
            @media (prefers-reduced-motion: reduce) {
                [data-reveal], [data-supreme-reveal], .nlt-modal-panel {
                    transition: none !important; opacity: 1 !important; transform: none !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // Reemplaza gsap.set+gsap.to+ScrollTrigger para [data-reveal]/[data-supreme-reveal].
    // stagger (ms) opcional: aplica transition-delay incremental (reemplaza
    // el gsap.timeline({stagger:...}) de ecosystem.html). once=true (default,
    // igual al comportamiento default de ScrollTrigger acá: revela y no
    // vuelve a esconder al scrollear hacia arriba).
    function mountReveal(selector = '[data-reveal]', { threshold = 0.1, stagger = 0 } = {}) {
        _inyectarMotionCSS();
        const elementos = document.querySelectorAll(selector);
        if (!elementos.length) return;
        if (!('IntersectionObserver' in window)) {
            elementos.forEach((el) => el.classList.add('nlt-in'));
            return;
        }
        const obs = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                const el = entry.target;
                if (stagger > 0) {
                    const i = [...elementos].indexOf(el);
                    el.style.transitionDelay = `${i * stagger}ms`;
                }
                el.classList.add('nlt-in');
                obs.unobserve(el);
            });
        }, { threshold, rootMargin: '0px 0px -10% 0px' });
        elementos.forEach((el) => obs.observe(el));
    }

    // Reemplaza gsap.fromTo(el,{textContent:0},{textContent:target,...}) --
    // cuenta de 0 al valor real cuando el elemento entra en viewport.
    // Respeta prefers-reduced-motion (salta directo al valor final).
    function animateCounter(el, target, { duration = 1200 } = {}) {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            el.textContent = target;
            return;
        }
        const t0 = performance.now();
        function frame(ahora) {
            const progreso = Math.min((ahora - t0) / duration, 1);
            const eased = 1 - Math.pow(1 - progreso, 3); // ease-out cubic, sin dependencias
            el.textContent = Math.round(target * eased);
            if (progreso < 1) requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    function mountCounters(selector = '[data-count]', opts = {}) {
        const elementos = document.querySelectorAll(selector);
        if (!elementos.length || !('IntersectionObserver' in window)) return;
        const obs = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                const el = entry.target;
                animateCounter(el, parseFloat(el.getAttribute('data-count')), opts);
                obs.unobserve(el);
            });
        }, { threshold: 0.5 });
        elementos.forEach((el) => obs.observe(el));
    }

    // Entrada de un modal (fade + translate + scale sutil) -- reemplaza el
    // gsap.timeline({...}).to(panel,{...}).to('[data-supreme-reveal]',
    // {...,stagger}) de ecosystem.html. panel necesita la clase
    // "nlt-modal-panel" en el HTML; los hijos con stagger opcional via
    // childrenSelector (ej. '[data-supreme-reveal]' dentro del panel).
    function animarEntradaModal(panel, { childrenSelector = null, stagger = 60 } = {}) {
        _inyectarMotionCSS();
        panel.classList.remove('nlt-in');
        if (childrenSelector) {
            panel.querySelectorAll(childrenSelector).forEach((el, i) => {
                el.classList.remove('nlt-in');
                el.style.transitionDelay = `${i * stagger}ms`;
            });
        }
        // Doble rAF: fuerza un reflow real entre "estado inicial" y "estado
        // final" para que la transition SIEMPRE dispare (si se agrega la
        // clase en el mismo frame que se remueve, el navegador puede
        // coalescer ambos cambios y saltar directo al estado final sin animar).
        requestAnimationFrame(() => requestAnimationFrame(() => {
            panel.classList.add('nlt-in');
            if (childrenSelector) panel.querySelectorAll(childrenSelector).forEach((el) => el.classList.add('nlt-in'));
        }));
    }

    // Los efectos visuales NO pueden depender de cuando (o si) cada pagina
    // llama a mountPublicHeader()/mountSidebar(): indicator.html y
    // signals.html, por ejemplo, la llaman recien despues de esperar un
    // fetch al backend -- si tarda o falla (signals.html hasta hace
    // `return` antes), la pagina quedaba sin fondo/tarjetas/header glass.
    // Se montan solos apenas hay DOM, en toda pagina con header publico
    // (header.nav-blur) o shell de sidebar (#sidebar). Todas las funciones
    // son idempotentes (chequean su propio id), asi que la llamada tardia
    // de mountPublicHeader()/mountSidebar() es un no-op inofensivo.
    function _autoMountVisualEffects() {
        // .glass-card cubre las pantallas sueltas sin header ni sidebar
        // (pago-confirmado.html / pago-pendiente.html: una sola tarjeta
        // centrada) -- mismo lenguaje visual que el resto del flujo.
        if (
            document.querySelector('header.nav-blur') ||
            document.getElementById('sidebar') ||
            document.querySelector('.glass-card')
        ) {
            _mountGlobalVisualEffects();
        }
        mountStories();
        mountDisplayFont();
        mountPageTransitions();
        mountSmoothScroll();
        mountHeroIntro();
        mountPartnersMarquee();
        mountCountUp();
        mountAppEntrance();
        mountCommandPalette();
        mountScrollSequence();
        mountTiltFrames();
        mountAutoVideos();
        mountAccordions();
        mountLandmarks();
        mountSkipLink();
        mountShortcuts();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _autoMountVisualEffects);
    } else {
        _autoMountVisualEffects();
    }

    // Selector de método de pago para una orden ya creada (de /billing/orders
    // o /indicator/orders). Tarjeta = Whop, cripto = NOWPayments: el cobro
    // ocurre en la página del proveedor y el backend activa la orden cuando
    // llega su webhook -- esta pantalla nunca marca nada como pagado.
    async function mountMetodosPago(box, orden) {
        const monto = Number(orden.final_amount || 0).toFixed(2);
        box.innerHTML = `
            <h3 class="text-lg font-bold mb-1">Elige cómo pagar</h3>
            <p class="text-xs text-gray-500 mb-6">Orden ${String(orden.order_id).replace(/[^A-Z0-9-]/gi, '')} -- $${monto} USD. El pago se hace en la página segura del procesador; NLT nunca ve los datos de tu tarjeta ni tu wallet.</p>
            <div class="space-y-3">
                <button data-proveedor="whop" class="nlt-metodo-pago hidden w-full py-3.5 rounded-xl bg-nlt-accent font-semibold text-sm hover:bg-blue-500 transition-all flex items-center justify-center gap-2"><i class="ph-fill ph-credit-card"></i> Pagar con tarjeta</button>
                <button data-proveedor="nowpayments" class="nlt-metodo-pago hidden w-full py-3.5 rounded-xl bg-white/10 hover:bg-white/20 font-semibold text-sm transition-all flex items-center justify-center gap-2"><i class="ph-fill ph-currency-btc"></i> Pagar con cripto (USDT, BTC y más)</button>
            </div>
            <p data-metodos-msg class="mt-3 text-xs p-3 rounded-lg bg-blue-500/10 text-blue-400">Cargando métodos de pago...</p>
        `;
        box.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const msg = box.querySelector('[data-metodos-msg]');
        const botones = [...box.querySelectorAll('.nlt-metodo-pago')];
        const mostrar = (texto, tono) => {
            const tonos = { info: 'bg-blue-500/10 text-blue-400', warn: 'bg-yellow-500/10 text-yellow-400', error: 'bg-nlt-danger/10 text-nlt-danger' };
            msg.className = `mt-3 text-xs p-3 rounded-lg ${tonos[tono] || tonos.info}`;
            msg.textContent = texto;
            msg.classList.remove('hidden');
        };

        let metodos = { card: false, crypto: false };
        try {
            metodos = await NLT_API.metodosPago();
        } catch (e) { /* sin métodos -> mensaje de abajo */ }
        const disponibles = { whop: !!metodos.card, nowpayments: !!metodos.crypto };
        botones.forEach(b => b.classList.toggle('hidden', !disponibles[b.dataset.proveedor]));
        if (!disponibles.whop && !disponibles.nowpayments) {
            mostrar('Los pagos están temporalmente no disponibles. Tu orden quedó guardada; intenta de nuevo más tarde o escríbenos a soporte.', 'warn');
            return;
        }
        msg.classList.add('hidden');

        botones.forEach(btn => btn.addEventListener('click', async () => {
            botones.forEach(b => { b.disabled = true; });
            const original = btn.innerHTML;
            btn.textContent = 'Abriendo página de pago segura...';
            try {
                const r = await NLT_API.iniciarCheckout(orden.order_id, btn.dataset.proveedor);
                window.location.href = r.url;
            } catch (e) {
                botones.forEach(b => { b.disabled = false; });
                btn.innerHTML = original;
                mostrar(e.message || 'No pudimos abrir la página de pago. Intenta de nuevo.', 'error');
            }
        }));
    }

    // NLT Prop Hub -- vitrina de partners REALES (/prop-hub/partners) con su
    // descuento y código. Se usa en index.html y ecosystem.html. Sin partners
    // (o si falla la API) la sección que la contiene se oculta: nunca se
    // muestra un partner o un descuento inventado.
    const HUB_RGB = '129,140,248';
    function _cssPropHub() {
        if (document.getElementById('nlt-hub-css')) return;
        const st = document.createElement('style');
        st.id = 'nlt-hub-css';
        st.textContent = `
        .hub-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(178px,1fr)); gap:14px; }
        .hub-ticket { --hub:${HUB_RGB}; position:relative; display:flex; flex-direction:column; gap:14px; padding:18px 18px 16px;
            border-radius:20px; overflow:hidden; contain:layout paint;
            background:linear-gradient(180deg, rgba(20,24,34,0.78), rgba(12,15,21,0.92));
            border:1px solid rgba(var(--hub),0.18);
            transition:transform .35s cubic-bezier(.2,.8,.2,1), border-color .35s ease, box-shadow .35s ease; }
        .hub-ticket::before { content:''; position:absolute; inset:-1px; border-radius:inherit; pointer-events:none; opacity:0;
            background:radial-gradient(120% 70% at 50% -10%, rgba(var(--hub),0.22), transparent 60%); transition:opacity .35s ease; }
        @media (hover:hover) { .hub-ticket:hover { transform:translateY(-4px); border-color:rgba(var(--hub),0.5);
            box-shadow:0 22px 50px -28px rgba(var(--hub),0.85); } .hub-ticket:hover::before { opacity:1; } }
        .hub-link { position:absolute; inset:0; z-index:1; border-radius:inherit; }
        .hub-link:focus-visible { outline:2px solid rgb(var(--hub)); outline-offset:2px; }
        .hub-head { display:flex; align-items:center; gap:12px; }
        .hub-logo { width:40px; height:40px; border-radius:12px; object-fit:contain; background:rgba(255,255,255,0.06); padding:5px; flex-shrink:0; }
        .hub-mono { width:40px; height:40px; border-radius:12px; flex-shrink:0; display:flex; align-items:center; justify-content:center;
            font-weight:800; font-size:17px; color:#fff; background:linear-gradient(135deg, rgba(var(--hub),0.9), rgba(168,85,247,0.75)); }
        .hub-name { font-weight:700; color:#fff; font-size:15px; line-height:1.2; }
        .hub-kind { font-size:11px; color:#9ca3af; letter-spacing:.04em; }
        .hub-off { display:flex; align-items:baseline; gap:6px; padding-bottom:12px; border-bottom:1px dashed rgba(255,255,255,0.1); }
        .hub-pct { font-size:42px; line-height:1; font-weight:800; letter-spacing:-0.035em;
            background:linear-gradient(135deg,#fff 20%, rgb(var(--hub)) 100%); -webkit-background-clip:text; background-clip:text; color:transparent; }
        .hub-offl { font-size:12px; font-weight:800; letter-spacing:.18em; color:rgb(var(--hub)); }
        .hub-foot { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; margin-top:auto; }
        .hub-code { position:relative; z-index:2; display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:10px;
            border:1px dashed rgba(var(--hub),0.55); background:rgba(var(--hub),0.08); color:#e5e7eb; font-size:12px; cursor:pointer;
            transition:background .2s ease, border-color .2s ease; }
        .hub-code b { letter-spacing:.06em; }
        .hub-code:hover { background:rgba(var(--hub),0.16); }
        .hub-code.is-ok { border-style:solid; border-color:rgba(34,197,94,0.7); color:#86efac; }
        .hub-go { font-size:12px; font-weight:700; color:rgb(var(--hub)); display:inline-flex; align-items:center; gap:4px; white-space:nowrap; }
        /* Teléfono: carrusel horizontal con snap (se desliza con el dedo) en
           vez de una columna larga de tarjetas. */
        @media (max-width: 639px) {
            .hub-grid { grid-template-columns:none; grid-auto-flow:column; grid-auto-columns:78%; overflow-x:auto; overscroll-behavior-x:contain;
                scroll-snap-type:x mandatory; scrollbar-width:none; --b:var(--hub-bleed,24px); margin:0 calc(-1 * var(--b)); padding:4px var(--b) 8px; scroll-padding:0 var(--b); }
            .hub-grid::-webkit-scrollbar { display:none; }
            .hub-ticket { scroll-snap-align:start; }
        }
        @media (prefers-reduced-motion: reduce) { .hub-ticket, .hub-ticket::before { transition:none; } }
        `;
        document.head.appendChild(st);
    }

    function _escHub(s) {
        return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    async function _copiarTexto(texto) {
        try { await navigator.clipboard.writeText(texto); return true; } catch (e) { /* fallback abajo */ }
        try {
            const t = document.createElement('textarea');
            t.value = texto; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
            document.body.appendChild(t); t.select();
            const ok = document.execCommand('copy'); t.remove(); return ok;
        } catch (e) { return false; }
    }

    // box: contenedor de las tarjetas. seccion: elemento a ocultar si no hay
    // partners. Devuelve la lista usada (para textos dinámicos, ej. "hasta 25%").
    async function mountPropHubShowcase(box, { seccion = null, max = 6, origen = 'web' } = {}) {
        if (!box || !window.NLT_API || !NLT_API.propHubListarPartners) return [];
        _cssPropHub();
        let lista = [];
        try { lista = await NLT_API.propHubListarPartners(); } catch (e) { lista = []; }
        lista = (Array.isArray(lista) ? lista : [])
            .filter((p) => p && p.name && p.slug)
            .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99))
            .slice(0, max);
        if (!lista.length) { if (seccion) seccion.hidden = true; return []; }
        if (seccion) seccion.hidden = false;

        box.classList.add('hub-grid');
        box.innerHTML = lista.map((p) => {
            const pct = Number(p.discount_percent) > 0 ? Math.round(Number(p.discount_percent)) : null;
            const logo = p.logo_url
                ? `<img class="hub-logo" src="${_escHub(p.logo_url)}" alt="" loading="lazy" decoding="async" width="40" height="40">`
                : `<span class="hub-mono" aria-hidden="true">${_escHub(p.name.trim()[0].toUpperCase())}</span>`;
            const oferta = pct
                ? `<span class="hub-pct">${pct}%</span><span class="hub-offl">OFF</span>`
                : `<span class="hub-pct" style="font-size:26px">Partner</span>`;
            const codigo = p.discount_code
                ? `<button type="button" class="hub-code" data-code="${_escHub(p.discount_code)}" data-pid="${_escHub(p.id)}" aria-label="Copiar código ${_escHub(p.discount_code)}"><span>Código</span><b>${_escHub(p.discount_code)}</b><i class="ph ph-copy"></i></button>`
                : '<span></span>';
            return `
                <article class="hub-ticket" data-pid="${_escHub(p.id)}">
                    <a class="hub-link" href="/funded/${encodeURIComponent(p.slug)}" aria-label="Ver ${_escHub(p.name)} en Prop Hub"></a>
                    <div class="hub-head">${logo}<div><p class="hub-name">${_escHub(p.name)}</p><p class="hub-kind">Partner NLT</p></div></div>
                    <div class="hub-off">${oferta}</div>
                    <div class="hub-foot">${codigo}<span class="hub-go">Ver oferta <i class="ph ph-arrow-right"></i></span></div>
                </article>`;
        }).join('');

        const evento = (tipo, pid) => {
            try { NLT_API.propHubRegistrarEventos([{ event_type: tipo, partner_id: pid, source_page: origen }]).catch(() => {}); } catch (e) { /* best-effort */ }
        };
        box.querySelectorAll('.hub-code').forEach((b) => b.addEventListener('click', async (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const ok = await _copiarTexto(b.dataset.code);
            if (!ok) {
                // Sin permiso de portapapeles: deja el código seleccionado para copiarlo a mano.
                try { const r = document.createRange(); r.selectNodeContents(b.querySelector('b')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) { /* nada */ }
                return;
            }
            const original = b.innerHTML;
            b.classList.add('is-ok');
            b.innerHTML = '<i class="ph-fill ph-check-circle"></i><b>¡Copiado!</b>';
            setTimeout(() => { b.classList.remove('is-ok'); b.innerHTML = original; }, 1600);
            evento('copy_code', b.dataset.pid);
        }));
        // Una impresión por partner cuando la vitrina entra en pantalla (un solo envío).
        if ('IntersectionObserver' in window) {
            const io = new IntersectionObserver((es) => {
                if (!es.some((e) => e.isIntersecting)) return;
                io.disconnect();
                try {
                    NLT_API.propHubRegistrarEventos(lista.map((p) => ({ event_type: 'impression', partner_id: p.id, source_page: origen }))).catch(() => {});
                } catch (e) { /* best-effort */ }
            }, { threshold: 0.2 });
            io.observe(box);
        }
        return lista;
    }

    // Web Push (notificaciones nativas navegador/PWA) -- soporta señales
    // nuevas, pago confirmado, operación copiada y mensajes de comunidad
    // (ver NLT_API/app/services/notifications.py, un solo punto real que
    // ya dispara estos 4 tipos + push va montado ahí). Nunca se pide
    // permiso solo -- SIEMPRE en respuesta a un click real del usuario
    // (mejor práctica: pedirlo al cargar la página se ignora o se rechaza
    // la mayoría de las veces, y una vez rechazado el navegador no deja
    // volver a preguntar).
    function _b64UrlAUint8(b64url) {
        const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
        const base64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/');
        const raw = atob(base64);
        return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
    }

    function pushSoportado() {
        return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    }

    async function _registrarSW() {
        return navigator.serviceWorker.register('/sw.js');
    }

    // Estado real (consulta el navegador, nunca localStorage): 'sin-soporte' |
    // 'denegado' | 'suscrito' | 'no-suscrito'.
    async function pushEstado() {
        if (!pushSoportado()) return 'sin-soporte';
        if (Notification.permission === 'denied') return 'denegado';
        try {
            const reg = await navigator.serviceWorker.getRegistration('/sw.js');
            const sub = reg && await reg.pushManager.getSubscription();
            return sub ? 'suscrito' : 'no-suscrito';
        } catch (e) { return 'no-suscrito'; }
    }

    // Llamar SOLO desde el handler de un click real. Devuelve true si quedó
    // suscrito. Si el usuario rechaza el permiso del navegador, el propio
    // navegador ya se lo dijo (su propio prompt) -- acá no se insiste ni se
    // muestra un segundo mensaje de error.
    async function pushActivar() {
        if (!pushSoportado()) return false;
        const permiso = await Notification.requestPermission();
        if (permiso !== 'granted') return false;
        try {
            const clave = await NLT_API.pushVapidPublicKey();
            if (!clave.enabled || !clave.public_key) return false; // VAPID sin configurar del lado del servidor todavía
            const reg = await _registrarSW();
            await navigator.serviceWorker.ready;
            let sub = await reg.pushManager.getSubscription();
            if (!sub) {
                sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _b64UrlAUint8(clave.public_key) });
            }
            await NLT_API.pushSuscribirse(sub.toJSON());
            return true;
        } catch (e) {
            return false;
        }
    }

    async function pushDesactivar() {
        if (!pushSoportado()) return true;
        try {
            const reg = await navigator.serviceWorker.getRegistration('/sw.js');
            const sub = reg && await reg.pushManager.getSubscription();
            if (!sub) return true;
            const endpoint = sub.endpoint;
            await sub.unsubscribe();
            await NLT_API.pushDesuscribirse(endpoint).catch(() => {});
            return true;
        } catch (e) { return false; }
    }

    // Monta un botón/switch existente (ej. en Configuración): refleja el
    // estado real al cargar y alterna al click -- la página solo necesita
    // un elemento con este id, el resto (texto, disabled, etc.) lo maneja
    // esta función para que ninguna página reimplemente el mismo estado.
    async function mountPushToggle(elementId) {
        const el = document.getElementById(elementId);
        if (!el) return;
        const pintar = (estado) => {
            el.dataset.pushEstado = estado;
            el.disabled = estado === 'sin-soporte' || estado === 'denegado';
            el.textContent = {
                'suscrito': 'Desactivar notificaciones',
                'no-suscrito': 'Activar notificaciones',
                'denegado': 'Notificaciones bloqueadas (revisá el navegador)',
                'sin-soporte': 'Tu navegador no soporta notificaciones',
            }[estado] || 'Activar notificaciones';
        };
        pintar(await pushEstado());
        el.addEventListener('click', async () => {
            const actual = el.dataset.pushEstado;
            el.disabled = true;
            const ok = actual === 'suscrito' ? await pushDesactivar() : await pushActivar();
            pintar(ok ? await pushEstado() : actual);
        });
    }

    window.NLT = {
        mountPropHubShowcase,
        mountMetodosPago,
        pushSoportado, pushEstado, pushActivar, pushDesactivar, mountPushToggle,
        supabase,
        ADMIN_EMAIL,
        getSession,
        requireSession,
        getAuthRedirectError,
        signOut,
        bindLogoutButton,
        isAdmin,
        isGlobalAdmin,
        ensurePerfil,
        renderEstadoBadge,
        marketTypeToggleHTML,
        MT5_SERVERS,
        injectServerDatalist,
        NLT_MODULES,
        renderSidebar,
        mountSidebar,
        renderModuleStrip,
        mountAuthAwareCTA,
        mountPublicHeader,
        startTour,
        registerPaletteAction,
        chartPolish,
        mountLandmarks,
        mountPartnersMarquee,
        pollWhileVisible,
        notifBellHTML,
        mountNotifBell,
        profileMenuHTML,
        mountProfileMenu,
        mountSupportChat,
        abrirSupportChat,
        mountReveal,
        animateCounter,
        mountCounters,
        animarEntradaModal,
    };
})();
