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
    async function mountPublicHeader(opts = {}) {
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
            const inicial = (session.user.email || '??').slice(0, 2).toUpperCase();
            box.innerHTML = `
                <div class="flex items-center gap-3">
                    <a href="dashboard.html" class="px-5 py-2.5 rounded-full bg-nlt-accent text-white font-semibold text-xs tracking-wide transition-all glow-button">Dashboard</a>
                    <div class="hidden sm:flex items-center gap-2 pl-1">
                        <div class="w-8 h-8 rounded-full bg-gradient-to-tr from-gray-700 to-gray-600 flex items-center justify-center text-[10px] font-bold text-white" title="${session.user.email}">${inicial}</div>
                        <button id="headerLogoutBtn" class="text-xs text-gray-500 hover:text-white transition-colors cursor-pointer">Cerrar sesión</button>
                    </div>
                </div>
            `;
            const logoutBtn = document.getElementById('headerLogoutBtn');
            if (logoutBtn) logoutBtn.addEventListener('click', () => signOut());
            _mountMobileNavToggle(box);
        }
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
    const NLT_MODULES = [
        {
            id: 'copy', nombre: 'NLT Copy System', status: 'live', href: 'dashboard.html',
            icono: 'ph-arrows-left-right', descripcion: 'Copiado de operaciones en tiempo real entre tu cuenta maestra y tus cuentas destino -- CFDs, Forex y Futuros.',
        },
        {
            // DAFRYX ZONE AI es el indicador real de NLT -- análisis de zonas
            // (oferta/demanda, FVG, BOS), AI Score, bias y probabilidad,
            // directo en TradingView. No es un producto separado de "Zone
            // Engine": es la misma herramienta, así que no se listan dos veces.
            id: 'indicator', nombre: 'NLT Indicator', status: 'live', href: 'indicator.html',
            icono: 'ph-crosshair', descripcion: 'Análisis de zonas con IA para TradingView -- AI Score, bias, calidad de zona y probabilidad en tiempo real.',
        },
        {
            id: 'futures-calc', nombre: 'Futures Calculator', status: 'live', href: 'calculators.html#futures',
            icono: 'ph-calculator', descripcion: 'Calculadora profesional de contratos y riesgo para ES, NQ, YM, RTY, CL, GC.',
        },
        {
            id: 'forex-calc', nombre: 'Forex Calculator', status: 'live', href: 'calculators.html#forex',
            icono: 'ph-currency-circle-dollar', descripcion: 'Tamaño de posición, valor de pip y riesgo calculado al instante para cualquier par.',
        },
        {
            id: 'news', nombre: 'NLT News', status: 'live', href: 'news.html',
            icono: 'ph-newspaper', descripcion: 'Calendario económico y noticias de mercado, organizados por impacto -- entendé el día en segundos.',
        },
        {
            id: 'tools', nombre: 'Trading Tools', status: 'live', href: 'tools.html',
            icono: 'ph-wrench', descripcion: 'Caja de herramientas del trader: margen, pips, prop firms y más.',
        },
        {
            id: 'community', nombre: 'Community', status: 'live', href: 'community.html',
            icono: 'ph-users-three', descripcion: 'La comunidad NLT -- anuncios, contenido y conversación entre traders.',
        },
        {
            id: 'academy', nombre: 'NLT Academy', status: 'live', href: 'academy.html',
            icono: 'ph-graduation-cap', descripcion: 'Cursos y lecciones estructuradas para llevar tu operativa al siguiente nivel.',
        },
        {
            // La landing está viva (status: 'live') aunque el trading real
            // todavía no lo esté -- ver TRADING_ENABLED en el backend. Hoy
            // es Broker Partner + Referral (Eightcap), no un broker propio.
            id: 'broker', nombre: 'NLT Broker', status: 'live', href: 'broker.html',
            icono: 'ph-briefcase', descripcion: 'Descubrí brokers partner de confianza y conectá tu experiencia de trading con el ecosistema NLT.',
        },
        {
            id: 'propfirm', nombre: 'NLT Funded', status: 'live', href: 'propfirm.html',
            icono: 'ph-trophy', descripcion: 'Comprá tu challenge y accedé a una cuenta funded a través de nuestro partner de PropFirm.',
        },
        {
            id: 'journal', nombre: 'NLT Trader Journal', status: 'live', href: 'journal.html',
            icono: 'ph-notebook', descripcion: 'Registrá tus operaciones, medí tu desempeño real y construí disciplina con analítica profesional.',
        },
        {
            id: 'elite-signals', nombre: 'NLT Elite Signals', status: 'live', href: 'signals.html',
            icono: 'ph-broadcast', descripcion: 'Señales BUY/SELL con entry, TP y SL, clasificadas por Quality Score (NORMAL/OPTIMA/STRONG/PERFECTA/ELITE).',
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

    // Equipo + Acuerdos + Firma -- una sola página (equipo.html) con
    // secciones ancladas, mismo patrón que NAV_FUTURES_HOME (#seccion-*).
    const NAV_EQUIPO = [
        { id: 'equipo-mios', href: '#seccion-mis-acuerdos', icono: 'ph-file-text', label: 'Mis Acuerdos' },
        { id: 'equipo-roster', href: '#seccion-equipo', icono: 'ph-users-three', label: 'Equipo' },
        { id: 'equipo-acuerdos', href: '#seccion-acuerdos-admin', icono: 'ph-folder-lock', label: 'Acuerdos (Admin)' },
        { id: 'equipo-auditoria', href: '#seccion-auditoria', icono: 'ph-scroll', label: 'Auditoría' },
    ];

    function _navItemHTML(item, activo) {
        const on = item.id === activo;
        const base = 'flex items-center gap-3 px-4 py-3 rounded-2xl font-medium text-sm transition-all';
        const cls = on ? `${base} bg-nlt-accent/10 text-nlt-accent border border-nlt-accent/10` : `${base} text-gray-400 hover:text-white hover:bg-white/5`;
        const iconCls = on ? `ph-fill ${item.icono}` : `ph ${item.icono}`;
        return `<a href="${item.href}" class="${cls}"><i class="${iconCls} text-lg"></i> ${item.label}</a>`;
    }

    // seccion: 'cfd' | 'futures'. activo: id del item actual (ver NAV_* arriba)
    // o 'admin'/'futuros-admin' para las páginas de administración. Dentro de
    // 'futures', si activo es una de las 4 secciones de futuros.html se usan
    // las anclas internas; si no (estamos en Configuración/Administración),
    // se usa un solo link de vuelta a futuros.html.
    function renderSidebar({ activo, seccion = 'cfd' } = {}) {
        const esFuturesHome = seccion === 'futures' && FUTURES_HOME_IDS.includes(activo);
        const nav = seccion === 'broker' ? NAV_BROKER : seccion === 'propfirm' ? NAV_PROPFIRM : seccion === 'signals' ? NAV_SIGNALS : seccion === 'indicator' ? NAV_INDICATOR : seccion === 'equipo' ? NAV_EQUIPO : seccion === 'futures' ? (esFuturesHome ? NAV_FUTURES_HOME : NAV_FUTURES_LINK) : NAV_CFD;
        const ajustes = seccion === 'futures' ? NAV_FUTURES_AJUSTES : NAV_CFD_AJUSTES;
        const grupoLabel = seccion === 'broker' ? 'NLT Broker' : seccion === 'propfirm' ? 'NLT Funded' : seccion === 'signals' ? 'NLT Elite Signals' : seccion === 'indicator' ? 'NLT Indicator' : seccion === 'equipo' ? 'Equipo NLT' : seccion === 'futures' ? 'Futuros' : null;
        const ajustesLabel = seccion === 'futures' ? 'Ajustes Futures' : 'Ajustes';
        const adminLabel = seccion === 'futures' ? 'Administración' : 'Panel Admin';
        const adminHref = seccion === 'broker' ? 'admin.html#broker' : seccion === 'propfirm' ? 'admin.html#propfirm' : seccion === 'signals' ? 'admin.html#elite_signals' : seccion === 'indicator' ? 'admin.html#indicador' : seccion === 'futures' ? 'admin.html#futures' : 'admin.html';
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
                ${grupoLabel ? `<p class="px-4 pb-2 text-[10px] font-bold text-gray-600 uppercase tracking-widest">${grupoLabel}</p>` : ''}
                ${nav.map((i) => _navItemHTML(i, activo)).join('')}
                <div class="pt-6 pb-2 px-4"><p class="text-[10px] font-bold text-gray-600 uppercase tracking-widest">${ajustesLabel}</p></div>
                ${ajustes.map((i) => _navItemHTML(i, activo)).join('')}
                <a href="equipo.html" id="nav-equipo" class="hidden items-center gap-3 px-4 py-3 rounded-2xl font-medium text-sm transition-all ${activo === 'equipo-mios' || activo === 'equipo-roster' || activo === 'equipo-acuerdos' || activo === 'equipo-auditoria' ? 'bg-nlt-accent/10 text-nlt-accent border border-nlt-accent/10' : 'text-gray-400 hover:text-white hover:bg-white/5'}">
                    <i class="ph-fill ph-users-three text-lg"></i> Equipo
                </a>
                <a href="${adminHref}" id="nav-admin" class="hidden items-center gap-3 px-4 py-3 rounded-2xl font-medium text-sm transition-all ${adminCls}">
                    <i class="ph-fill ph-shield-star text-lg"></i> ${adminLabel}
                </a>
            </nav>
            <div class="p-6">
                <div class="glass-item p-3 flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-gradient-to-tr from-gray-700 to-gray-600 flex items-center justify-center text-xs font-bold text-white" id="userAvatarInitial">·</div>
                    <div class="flex-1 overflow-hidden">
                        <p class="text-sm font-semibold text-white truncate" id="userEmail">Cargando...</p>
                        <p class="text-[11px] text-nlt-accent font-medium" id="userPlanLabel"></p>
                    </div>
                </div>
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
        const aside = document.getElementById('sidebar');
        if (!aside) return;
        aside.innerHTML = renderSidebar({ activo, seccion });
        _mountMobileSidebarToggle(aside);
        mountNotifBell('sidebarNotifBell');

        document.getElementById('userEmail').textContent = session.user.email;
        const avatar = document.getElementById('userAvatarInitial');
        if (avatar) avatar.textContent = (session.user.email || '??').slice(0, 2).toUpperCase();

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
            const estadoCls = active
                ? 'bg-nlt-accent/10 border-nlt-accent/30 text-nlt-accent'
                : disponible
                    ? 'border-white/5 text-gray-300 hover:border-white/15 hover:bg-white/5 cursor-pointer'
                    : 'border-white/5 text-gray-600 opacity-60';
            return `
                <${tag} ${hrefAttr} class="shrink-0 flex items-center gap-2.5 px-4 py-2.5 rounded-2xl border transition-all ${estadoCls}">
                    <i class="ph-fill ${m.icono} text-base"></i>
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

    window.NLT = {
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
        pollWhileVisible,
        notifBellHTML,
        mountNotifBell,
        mountReveal,
        animateCounter,
        mountCounters,
        animarEntradaModal,
    };
})();
