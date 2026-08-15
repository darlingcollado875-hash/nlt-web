// Cliente para NLT_API (FastAPI). Requiere que nlt-shared.js se haya
// cargado antes (usa NLT.supabase para sacar el token de la sesión actual).
//
// Nunca manda user_id en ningún request -- el backend lo saca del token
// verificado (ver NLT_API/app/api/deps.py::get_current_user_id). Si el
// fetch no lleva un token válido, el backend responde 401.
(function () {
    // Ajustar al desplegar: mientras se prueba en local, NLT_API corre en
    // localhost:8091. En producción, esto debe apuntar al dominio real de NLT_API.
    // (No se usa 8090: en este PC otro programa ajeno -- WsToastNotification.exe
    // de Wondershare -- también escucha ahí, y el choque de puertos causaba
    // "Failed to fetch" intermitente sin dejar rastro en el log de NLT_API,
    // confirmado con netstat: dos procesos distintos en el puerto 8090 a la vez.)
    //
    // Un navegador NUNCA puede llamar a 127.0.0.1 desde una página pública en
    // HTTPS (Private Network Access del navegador la bloquea -- confirmado
    // real: "Failed to fetch"/net::ERR_BLOCKED_BY_CLIENT). Por eso, si esta
    // página está servida desde localhost/127.0.0.1 usamos el backend local
    // directo; si no (deploy real), usamos NLT_API desplegado en Railway
    // (reemplazó al túnel de Cloudflare, que dependía de que la PC local
    // estuviera prendida y se caía en cada corte de luz/reinicio).
    const esLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    // Mismo protocolo que la propia página -- si nlt-web se sirve por HTTPS
    // local (ver dev_server.py + .local-certs/, necesario para que Accept.js
    // acepte tokenizar tarjetas), una llamada a NLT_API por HTTP simple
    // quedaría bloqueada como "contenido mixto" por el navegador.
    const BASE_URL = esLocal ? `${window.location.protocol}//127.0.0.1:8091` : 'https://nlt-api-production.up.railway.app';

    async function _token() {
        // Reusa la misma sesión cacheada por nlt-shared.js -- antes esto
        // pedía su propia sesión a Supabase en cada llamada a la API,
        // sumado a los pedidos de requireSession()/mountPublicHeader().
        const session = await NLT.getSession();
        if (!session) throw new Error('No hay sesión activa');
        return session.access_token;
    }

    // Sin límite de tiempo, un fetch() nunca falla por sí solo si el
    // servidor está lento o arrancando en frío (cold start de Railway) --
    // se queda colgado sin límite, y eso es lo que hacía que la página
    // pareciera tardar hasta 1 minuto en cargar en mobile. AbortController
    // le pone un techo real: pasados TIMEOUT_MS se cancela y se lanza un
    // error normal, que ya fluye por el mismo catch que usa cada página
    // para sus errores de red/HTTP existentes -- no es un modo de falla nuevo.
    const FETCH_TIMEOUT_MS = 9000;
    async function _fetchConTimeout(url, opciones = {}, timeoutMs = FETCH_TIMEOUT_MS) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(url, { ...opciones, signal: controller.signal });
        } catch (err) {
            if (err.name === 'AbortError') {
                throw new Error('El servidor tardó demasiado en responder. Probá de nuevo en un momento.');
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    // fetch() solo tira una excepción (TypeError "Failed to fetch") cuando
    // la conexión falla a nivel red -- nunca para una respuesta HTTP real,
    // aunque sea un error 4xx/5xx (eso sigue de largo con resp.ok=false).
    // Un reintento acá NO tapa errores reales de la app, solo blips de red
    // reales: confirmado real (14/08) que esto pasa justo en la ventana de
    // unos segundos mientras Railway termina de levantar un redeploy nuevo
    // -- el usuario lo veía como "Failed to fetch" en Academy que se
    // arreglaba solo al refrescar la página un momento después. Ahora
    // también reintenta si el primer intento se cortó por timeout (ej. el
    // cold-start de Railway sigue en curso en el primer intento).
    async function _fetchConReintento(url, opciones, intentos = 2) {
        for (let i = 0; i < intentos; i++) {
            try {
                return await _fetchConTimeout(url, opciones);
            } catch (err) {
                if (i === intentos - 1) throw err;
                await new Promise((r) => setTimeout(r, 800));
            }
        }
    }

    async function request(path, options = {}) {
        const token = await _token();
        const resp = await _fetchConReintento(BASE_URL + path, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                ...(options.headers || {}),
            },
        });

        let body = null;
        try { body = await resp.json(); } catch (_) { /* respuesta vacía, ok */ }

        if (!resp.ok) {
            const detalle = (body && body.detail) ? body.detail : `Error HTTP ${resp.status}`;
            throw new Error(detalle);
        }
        return body;
    }

    // Para subir archivos (multipart/form-data) con progreso real -- fetch()
    // no expone eventos de progreso de subida, por eso esto usa XHR en vez
    // del helper `request()` de arriba. onProgress(fraccion0a1) es opcional.
    function subirArchivo(path, formData, onProgress) {
        return new Promise(async (resolve, reject) => {
            let token;
            try { token = await _token(); } catch (err) { reject(err); return; }

            const xhr = new XMLHttpRequest();
            xhr.open('POST', BASE_URL + path);
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            if (onProgress) {
                xhr.upload.addEventListener('progress', (e) => {
                    if (e.lengthComputable) onProgress(e.loaded / e.total, e.loaded, e.total);
                });
            }
            xhr.onload = () => {
                let body = null;
                try { body = JSON.parse(xhr.responseText); } catch (_) { /* respuesta vacía, ok */ }
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(body);
                } else {
                    reject(new Error((body && body.detail) ? body.detail : `Error HTTP ${xhr.status}`));
                }
            };
            xhr.onerror = () => reject(new Error('Error de red al subir el archivo'));
            xhr.send(formData);
        });
    }

    // Para los portales públicos de producto (copy-system.html, plans.html,
    // indicator.html): visitantes sin sesión también tienen que poder ver
    // precios, así que esto NUNCA manda Authorization -- solo pega a
    // endpoints que el backend ya expone sin auth (ver billing.py::/plans*).
    async function requestPublico(path) {
        const resp = await _fetchConTimeout(BASE_URL + path);
        let body = null;
        try { body = await resp.json(); } catch (_) { /* respuesta vacía, ok */ }
        if (!resp.ok) {
            const detalle = (body && body.detail) ? body.detail : `Error HTTP ${resp.status}`;
            throw new Error(detalle);
        }
        return body;
    }

    // Como requestPublico, pero manda el token si hay una sesión activa --
    // sin exigirla (nunca lanza por falta de sesión, a diferencia de
    // request()). Para endpoints públicos que opcionalmente devuelven más
    // datos a un usuario logueado (ej. perfil de comunidad: is_following/
    // is_own solo tienen sentido si hay un viewer real).
    async function requestConSesionOpcional(path) {
        const headers = {};
        try {
            const session = await NLT.getSession();
            if (session) headers['Authorization'] = `Bearer ${session.access_token}`;
        } catch (_) { /* sin sesión -- sigue como visitante público */ }
        const resp = await _fetchConTimeout(BASE_URL + path, { headers });
        let body = null;
        try { body = await resp.json(); } catch (_) { /* respuesta vacía, ok */ }
        if (!resp.ok) {
            const detalle = (body && body.detail) ? body.detail : `Error HTTP ${resp.status}`;
            throw new Error(detalle);
        }
        return body;
    }

    const NLT_API = {
        // --- cuentas (cualquier proveedor) ---
        listarCuentas: () => request('/accounts'),
        crearCuentaLocal: (datos) => request('/accounts', { method: 'POST', body: JSON.stringify(datos) }),
        crearCuentaMT5API: (datos) => request('/mt5api/accounts', { method: 'POST', body: JSON.stringify(datos) }),
        crearCuentaTickerAll: (datos) => request('/tickerall/accounts', { method: 'POST', body: JSON.stringify(datos) }),
        borrarCuenta: (id) => request(`/accounts/${id}`, { method: 'DELETE' }),
        reconectarCuenta: (id) => request(`/accounts/${id}/reconnect`, { method: 'POST' }),
        // TickerAll enfría la sesión con el tiempo (status=CONNECTED pero hot=false)
        // y no guardamos la contraseña -- hace falta pedirla de nuevo para reconectar.
        reconectarTickerAll: (id, password) => request(`/tickerall/accounts/${id}/reconnect`, { method: 'POST', body: JSON.stringify({ password }) }),

        // --- datos (funcionan para cualquier proveedor, leen de las mismas tablas) ---
        datosDeCuenta: (id) => request(`/accounts/${id}/data`),
        eventosDeCuenta: (id) => request(`/accounts/${id}/events`),
        estadoConexion: (id) => request(`/accounts/${id}/connection`),

        // --- billing (planes, cupones, órdenes, suscripción) ---
        listarPlanes: () => request('/billing/plans'),
        // Públicos (sin sesión) -- para los portales de producto.
        planesTodos: () => requestPublico('/billing/plans/all'),
        planesPorProducto: (producto) => requestPublico(`/billing/plans/producto/${producto}`),
        validarCupon: (code, plan) => request('/billing/coupons/validate', { method: 'POST', body: JSON.stringify({ code, plan }) }),
        crearOrden: (plan, billing_period, coupon_code) => request('/billing/orders', { method: 'POST', body: JSON.stringify({ plan, billing_period, coupon_code: coupon_code || null }) }),
        obtenerOrden: (orderId) => request(`/billing/orders/${orderId}`),
        // Checkout real vía el tokenizador oficial de Pay2Commerce
        // (P2C.tokenize) -- ver NLT_API/app/integrations/payments/pay2commerce_checkout.py.
        checkoutConfig: (orderId) => request(`/billing/orders/${orderId}/checkout-config`),
        pagarOrden: (orderId, payment_method_id) =>
            request(`/billing/orders/${orderId}/pay`, {
                method: 'POST',
                body: JSON.stringify({ payment_method_id }),
            }),
        listarFacturas: () => request('/billing/invoices'),
        miSuscripcion: () => request('/billing/subscription'),
        // Los <a href> normales no pueden mandar el header Authorization,
        // así que se pide el HTML autenticado y se abre como blob: URL.
        verComprobante: async (orderId) => {
            const token = await _token();
            const resp = await fetch(`${BASE_URL}/billing/orders/${orderId}/receipt`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!resp.ok) throw new Error(`No se pudo abrir el comprobante (HTTP ${resp.status})`);
            const html = await resp.text();
            const blob = new Blob([html], { type: 'text/html' });
            window.open(URL.createObjectURL(blob), '_blank');
        },

        // --- Futures (completamente separado de CFD -- otras tablas, otro conector) ---
        futuresProveedor: () => request('/futures/accounts/provider'),
        futuresContratos: () => request('/futures/accounts/contracts'),
        futuresListarCuentas: () => request('/futures/accounts'),
        futuresCrearCuenta: (datos) => request('/futures/accounts', { method: 'POST', body: JSON.stringify(datos) }),
        futuresBorrarCuenta: (id) => request(`/futures/accounts/${id}`, { method: 'DELETE' }),
        futuresResumen: (id) => request(`/futures/accounts/${id}/summary`),
        futuresPosiciones: (id) => request(`/futures/accounts/${id}/positions`),
        futuresHistorial: (id) => request(`/futures/accounts/${id}/history`),
        futuresEventos: (id) => request(`/futures/accounts/${id}/events`),
        futuresSalud: (id) => request(`/futures/accounts/${id}/health`),
        futuresReconectar: (id) => request(`/futures/accounts/${id}/reconnect`, { method: 'POST' }),
        // --- Futures MOCK (solo disponible mientras FUTURES_PROVIDER=MOCK) ---
        futuresMockAbrir: (id, { symbol, side, quantity, stop_loss, take_profit }) => {
            const qs = new URLSearchParams({ symbol, side, quantity, ...(stop_loss ? { stop_loss } : {}), ...(take_profit ? { take_profit } : {}) });
            return request(`/futures/mock/${id}/abrir?${qs}`, { method: 'POST' });
        },
        futuresMockModificar: (id, ticket, { stop_loss, take_profit }) => {
            const qs = new URLSearchParams({ ...(stop_loss !== undefined ? { stop_loss } : {}), ...(take_profit !== undefined ? { take_profit } : {}) });
            return request(`/futures/mock/${id}/modificar/${ticket}?${qs}`, { method: 'POST' });
        },
        futuresMockCerrar: (id, ticket) => request(`/futures/mock/${id}/cerrar/${ticket}`, { method: 'POST' }),
        futuresMockEnfriar: (id) => request(`/futures/mock/${id}/enfriar`, { method: 'POST' }),
        futuresMockDuplicar: (id) => request(`/futures/mock/${id}/duplicar-evento`, { method: 'POST' }),

        // --- Futures: administración (admin-only) ---
        futuresAdminStatus: () => request('/admin/futures/status'),
        futuresAdminCuentas: () => request('/admin/futures/accounts'),
        futuresAdminStats: () => request('/admin/futures/stats'),

        // --- admin: pagos (Copy System) ---
        adminListarOrdenes: (status) => request(`/admin/billing/orders${status ? '?status=' + status : ''}`),
        adminConfirmarPago: (orderId, payment_reference) => request(`/admin/billing/orders/${orderId}/confirm`, { method: 'POST', body: JSON.stringify({ payment_reference: payment_reference || null }) }),
        adminRechazarPago: (orderId, motivo) => request(`/admin/billing/orders/${orderId}/reject`, { method: 'POST', body: JSON.stringify({ motivo: motivo || null }) }),
        adminStats: () => request('/admin/billing/stats'),
        adminListarUsuarios: () => request('/admin/billing/users'),
        adminAsignarPlan: (userId, plan) => request(`/admin/billing/users/${userId}/plan`, { method: 'POST', body: JSON.stringify({ plan }) }),

        // --- NLT Indicator (usuario) ---
        indicadorCrearOrden: (plan_id, tradingview_username) => request('/indicator/orders', { method: 'POST', body: JSON.stringify({ plan_id, tradingview_username }) }),
        indicadorMisOrdenes: () => request('/indicator/orders/mine'),
        indicadorConfirmarPagoTest: (orderId) => request(`/indicator/orders/${orderId}/test-confirm-payment`, { method: 'POST' }),
        indicadorCheckoutConfig: (orderId) => request(`/indicator/orders/${orderId}/checkout-config`),
        indicadorPagarOrden: (orderId, payment_method_id) => request(`/indicator/orders/${orderId}/pay`, { method: 'POST', body: JSON.stringify({ payment_method_id }) }),

        // --- admin: NLT Indicator ---
        adminListarOrdenesIndicador: (status) => request(`/admin/indicator/orders${status ? '?status=' + status : ''}`),
        adminAprobarIndicador: (orderId, nota) => request(`/admin/indicator/orders/${orderId}/approve`, { method: 'POST', body: JSON.stringify({ nota: nota || null }) }),
        adminRechazarIndicador: (orderId, nota) => request(`/admin/indicator/orders/${orderId}/reject`, { method: 'POST', body: JSON.stringify({ nota: nota || null }) }),

        // --- admin: catálogo de planes (todos los productos) ---
        adminListarPlanes: (producto) => request(`/admin/plans${producto ? '?producto=' + producto : ''}`),
        adminCrearPlan: (datos) => request('/admin/plans', { method: 'POST', body: JSON.stringify(datos) }),
        adminActualizarPlan: (planId, datos) => request(`/admin/plans/${planId}`, { method: 'PATCH', body: JSON.stringify(datos) }),
        adminTogglePlan: (planId) => request(`/admin/plans/${planId}/toggle`, { method: 'POST' }),

        // --- Contenido del ecosistema (CMS mínimo) ---
        contenidoEcosistema: (seccion) => requestPublico(`/ecosystem-content${seccion ? '?seccion=' + seccion : ''}`),
        adminListarContenido: (seccion) => request(`/admin/ecosystem-content${seccion ? '?seccion=' + seccion : ''}`),
        adminCrearContenido: (datos) => request('/admin/ecosystem-content', { method: 'POST', body: JSON.stringify(datos) }),
        adminActualizarContenido: (itemId, datos) => request(`/admin/ecosystem-content/${itemId}`, { method: 'PATCH', body: JSON.stringify(datos) }),
        adminBorrarContenido: (itemId) => request(`/admin/ecosystem-content/${itemId}`, { method: 'DELETE' }),

        // --- NLT Media Library ---
        mediaPorPlacement: (placement) => requestPublico(`/media/placement/${placement}`),
        adminListarMedia: (filtros = {}) => {
            const qs = new URLSearchParams();
            if (filtros.category) qs.set('category', filtros.category);
            if (filtros.status) qs.set('status', filtros.status);
            if (filtros.kind) qs.set('kind', filtros.kind);
            const query = qs.toString();
            return request(`/admin/media${query ? '?' + query : ''}`);
        },
        adminObtenerMedia: (mediaId) => request(`/admin/media/${mediaId}`),
        adminSubirMedia: (file, { title, description, category }, onProgress) => {
            const fd = new FormData();
            fd.append('file', file);
            fd.append('title', title);
            if (description) fd.append('description', description);
            fd.append('category', category || 'other');
            return subirArchivo('/admin/media', fd, onProgress);
        },
        adminActualizarMedia: (mediaId, datos) => request(`/admin/media/${mediaId}`, { method: 'PATCH', body: JSON.stringify(datos) }),
        adminActualizarPlacementsMedia: (mediaId, placements) => request(`/admin/media/${mediaId}/placements`, { method: 'PUT', body: JSON.stringify({ placements }) }),
        adminReemplazarMedia: (mediaId, file, onProgress) => {
            const fd = new FormData();
            fd.append('file', file);
            return subirArchivo(`/admin/media/${mediaId}/replace`, fd, onProgress);
        },
        adminBorrarMedia: (mediaId) => request(`/admin/media/${mediaId}`, { method: 'DELETE' }),

        // --- NLT Economic Calendar (público, sin sesión -- consumido por news.html y dashboard.html) ---
        calendarEventos: (filtros = {}) => {
            const qs = new URLSearchParams();
            if (filtros.from) qs.set('from_', filtros.from);
            if (filtros.to) qs.set('to', filtros.to);
            if (filtros.currency) qs.set('currency', filtros.currency);
            if (filtros.impact) qs.set('impact', filtros.impact);
            const query = qs.toString();
            return requestPublico(`/calendar/events${query ? '?' + query : ''}`);
        },
        calendarProximoAltoImpacto: () => requestPublico('/calendar/next-high-impact'),
        calendarStatus: () => requestPublico('/calendar/status'),

        // --- admin: Economic Calendar ---
        adminCalendarSettings: () => request('/admin/calendar/settings'),
        adminCalendarActualizarSettings: (datos) => request('/admin/calendar/settings', { method: 'PUT', body: JSON.stringify(datos) }),
        adminCalendarSyncAhora: () => request('/admin/calendar/sync-now', { method: 'POST' }),
        adminCalendarSyncLogs: (limit = 10) => request(`/admin/calendar/sync-logs?limit=${limit}`),

        // --- NLT Calculator Engine (público, sin sesión -- sin datos de usuario involucrados) ---
        calcForexInstrumentos: () => requestPublico('/calculators/forex/instruments'),
        calcFuturesInstrumentos: () => requestPublico('/calculators/futures/instruments'),
        calcLotSize: (datos) => fetch(BASE_URL + '/calculators/lot-size', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) })
            .then(async (resp) => { const body = await resp.json().catch(() => null); if (!resp.ok) throw new Error((body && body.detail) || `Error HTTP ${resp.status}`); return body; }),
        calcFuturesContracts: (datos) => fetch(BASE_URL + '/calculators/futures-contracts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) })
            .then(async (resp) => { const body = await resp.json().catch(() => null); if (!resp.ok) throw new Error((body && body.detail) || `Error HTTP ${resp.status}`); return body; }),

        // --- admin: Calculator Engine (instrumentos) ---
        adminCalcListarForex: () => request('/admin/calculators/forex/instruments'),
        adminCalcCrearForex: (datos) => request('/admin/calculators/forex/instruments', { method: 'POST', body: JSON.stringify(datos) }),
        adminCalcActualizarForex: (symbol, datos) => request(`/admin/calculators/forex/instruments/${symbol}`, { method: 'PATCH', body: JSON.stringify(datos) }),
        adminCalcBorrarForex: (symbol) => request(`/admin/calculators/forex/instruments/${symbol}`, { method: 'DELETE' }),
        adminCalcListarFutures: () => request('/admin/calculators/futures/instruments'),
        adminCalcCrearFutures: (datos) => request('/admin/calculators/futures/instruments', { method: 'POST', body: JSON.stringify(datos) }),
        adminCalcActualizarFutures: (symbol, datos) => request(`/admin/calculators/futures/instruments/${symbol}`, { method: 'PATCH', body: JSON.stringify(datos) }),
        adminCalcBorrarFutures: (symbol) => request(`/admin/calculators/futures/instruments/${symbol}`, { method: 'DELETE' }),

        // --- NLT Academy (estudiante) ---
        academyAccess: () => request('/academy/access'),
        academyCurso: () => request('/academy/course'),
        academyContinueLearning: () => request('/academy/continue-learning'),
        academyActualizarProgreso: (lessonId, video_progress_percent) => request(`/academy/lessons/${lessonId}/progress`, { method: 'POST', body: JSON.stringify({ video_progress_percent }) }),
        academyObtenerQuiz: (lessonId) => request(`/academy/lessons/${lessonId}/quiz`),
        academyEnviarQuiz: (lessonId, answers) => request(`/academy/lessons/${lessonId}/quiz/submit`, { method: 'POST', body: JSON.stringify({ answers }) }),
        academyCertificados: () => request('/academy/certificates'),
        academyCertificadosEmitidos: () => request('/academy/certificates/issued'),
        academySettings: () => requestPublico('/academy/settings'),
        academyVerificar: (code) => requestPublico(`/academy/verify/${code}`),

        // --- NLT Trading Tools (público -- funciona con y sin sesión) ---
        toolsCategorias: () => requestPublico('/tools/categories'),
        toolsListar: async () => {
            // Público, pero si hay sesión mandamos el token para que el
            // backend calcule locked/is_favorite reales -- nunca dos
            // requests separados para lo mismo.
            try {
                const token = await _token();
                return fetch(BASE_URL + '/tools', { headers: { 'Authorization': `Bearer ${token}` } })
                    .then(async (resp) => { const body = await resp.json(); if (!resp.ok) throw new Error((body && body.detail) || `Error HTTP ${resp.status}`); return body; });
            } catch (_) {
                return requestPublico('/tools');
            }
        },
        toolsRegistrarUso: async (toolId, symbol) => {
            // Público (usuarios anónimos también pueden usar herramientas),
            // pero si hay sesión mandamos el token -- si no, el backend
            // registra el uso con user_id=None y "Recently Used Tools" del
            // usuario logueado nunca lo ve (mismo patrón que toolsListar).
            const opts = { method: 'POST', body: JSON.stringify({ symbol: symbol || null }) };
            let headers = { 'Content-Type': 'application/json' };
            try { headers.Authorization = `Bearer ${await _token()}`; } catch (_) { /* sin sesión, sigue anónimo */ }
            return fetch(BASE_URL + `/tools/${toolId}/use`, { ...opts, headers })
                .then(async (resp) => { const body = await resp.json().catch(() => null); if (!resp.ok) throw new Error((body && body.detail) || `Error HTTP ${resp.status}`); return body; });
        },
        toolsFavoritos: () => request('/tools/favorites'),
        toolsAlternarFavorito: (toolId) => request(`/tools/${toolId}/favorite`, { method: 'POST' }),
        toolsRecientes: () => request('/tools/recent'),
        calcRisk: (datos) => fetch(BASE_URL + '/calculators/risk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) })
            .then(async (resp) => { const body = await resp.json(); if (!resp.ok) throw new Error((body && body.detail) || `Error HTTP ${resp.status}`); return body; }),
        calcRR: (datos) => fetch(BASE_URL + '/calculators/rr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) })
            .then(async (resp) => { const body = await resp.json(); if (!resp.ok) throw new Error((body && body.detail) || `Error HTTP ${resp.status}`); return body; }),
        calcPipValue: (datos) => fetch(BASE_URL + '/calculators/pip-value', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) })
            .then(async (resp) => { const body = await resp.json(); if (!resp.ok) throw new Error((body && body.detail) || `Error HTTP ${resp.status}`); return body; }),
        calcMargin: (datos) => fetch(BASE_URL + '/calculators/margin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) })
            .then(async (resp) => { const body = await resp.json(); if (!resp.ok) throw new Error((body && body.detail) || `Error HTTP ${resp.status}`); return body; }),
        calcPropChallenge: (datos) => fetch(BASE_URL + '/calculators/prop-challenge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) })
            .then(async (resp) => { const body = await resp.json(); if (!resp.ok) throw new Error((body && body.detail) || `Error HTTP ${resp.status}`); return body; }),
        calcPropPayout: (datos) => fetch(BASE_URL + '/calculators/prop-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) })
            .then(async (resp) => { const body = await resp.json(); if (!resp.ok) throw new Error((body && body.detail) || `Error HTTP ${resp.status}`); return body; }),

        // --- admin: NLT Trading Tools ---
        adminToolsListarCategorias: () => request('/admin/tools/categories'),
        adminToolsCrearCategoria: (datos) => request('/admin/tools/categories', { method: 'POST', body: JSON.stringify(datos) }),
        adminToolsActualizarCategoria: (id, datos) => request(`/admin/tools/categories/${id}`, { method: 'PATCH', body: JSON.stringify(datos) }),
        adminToolsListar: () => request('/admin/tools'),
        adminToolsActualizar: (id, datos) => request(`/admin/tools/${id}`, { method: 'PATCH', body: JSON.stringify(datos) }),
        adminToolsStats: () => request('/admin/tools/stats'),

        // --- NLT Community (público -- funciona con y sin sesión) ---
        communityAcceso: () => request('/community/access'),
        communityFeed: async (filtros = {}) => {
            const qs = new URLSearchParams();
            if (filtros.tipo) qs.set('tipo', filtros.tipo);
            if (filtros.limit) qs.set('limit', filtros.limit);
            if (filtros.offset) qs.set('offset', filtros.offset);
            const query = qs.toString();
            try {
                const token = await _token();
                return fetch(`${BASE_URL}/community/feed${query ? '?' + query : ''}`, { headers: { 'Authorization': `Bearer ${token}` } })
                    .then(async (resp) => { const body = await resp.json(); if (!resp.ok) throw new Error((body && body.detail) || `Error HTTP ${resp.status}`); return body; });
            } catch (_) {
                return requestPublico(`/community/feed${query ? '?' + query : ''}`);
            }
        },
        communityOficiales: () => requestPublico('/community/official'),
        communityAdsActivos: (placement) => requestPublico(`/community/ads/active${placement ? '?placement=' + placement : ''}`),
        communityAdImpresion: (adId) => fetch(BASE_URL + `/community/ads/${adId}/impression`, { method: 'POST' }).catch(() => {}),
        communityAdClick: (adId) => fetch(BASE_URL + `/community/ads/${adId}/click`, { method: 'POST' }).catch(() => {}),
        communityMiPerfil: () => request('/community/profile/me'),
        communityActualizarPerfil: (datos) => request('/community/profile/me', { method: 'PATCH', body: JSON.stringify(datos) }),
        communityPerfilPublico: (username) => requestConSesionOpcional(`/community/profile/${username}`),
        communityPostsDePerfil: (username) => requestPublico(`/community/profile/${username}/posts`),
        communitySeguir: (username) => request(`/community/follow/${username}`, { method: 'POST' }),
        communityDejarDeSeguir: (username) => request(`/community/follow/${username}`, { method: 'DELETE' }),
        communitySubirImagen: (file, onProgress) => {
            const fd = new FormData();
            fd.append('file', file);
            return subirArchivo('/community/upload-image', fd, onProgress);
        },
        communityCrearPost: (datos) => request('/community/posts', { method: 'POST', body: JSON.stringify(datos) }),
        communityObtenerPost: (id) => requestPublico(`/community/posts/${id}`),
        communityActualizarPost: (id, datos) => request(`/community/posts/${id}`, { method: 'PATCH', body: JSON.stringify(datos) }),
        communityBorrarPost: (id) => request(`/community/posts/${id}`, { method: 'DELETE' }),
        communityComentarios: (postId) => requestPublico(`/community/posts/${postId}/comments`),
        communityCrearComentario: (postId, body, parent_comment_id) => request(`/community/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify({ body, parent_comment_id: parent_comment_id || null }) }),
        communityBorrarComentario: (id) => request(`/community/comments/${id}`, { method: 'DELETE' }),
        communityReaccionar: (postId, reaction_type) => request(`/community/posts/${postId}/react`, { method: 'POST', body: JSON.stringify({ reaction_type }) }),
        communityReportarPost: (postId, reason, details) => request(`/community/posts/${postId}/report`, { method: 'POST', body: JSON.stringify({ reason, details: details || null }) }),
        communityReportarComentario: (commentId, reason, details) => request(`/community/comments/${commentId}/report`, { method: 'POST', body: JSON.stringify({ reason, details: details || null }) }),
        communityNotificaciones: () => request('/community/notifications'),
        communityNoLeidas: () => request('/community/notifications/unread-count'),
        communityMarcarLeida: (id) => request(`/community/notifications/${id}/read`, { method: 'POST' }),
        communityMarcarTodasLeidas: () => request('/community/notifications/read-all', { method: 'POST' }),

        // --- admin: NLT Community ---
        adminCommunityStats: () => request('/admin/community/stats'),
        adminCommunityListarPosts: (status) => request(`/admin/community/posts${status ? '?status=' + status : ''}`),
        adminCommunityModerarPost: (id, action, note) => request(`/admin/community/posts/${id}/moderate`, { method: 'POST', body: JSON.stringify({ action, note: note || null }) }),
        adminCommunityModerarComentario: (id, action, note) => request(`/admin/community/comments/${id}/moderate`, { method: 'POST', body: JSON.stringify({ action, note: note || null }) }),
        adminCommunityListarReportes: (status) => request(`/admin/community/reports${status ? '?status=' + status : ''}`),
        adminCommunityResolverReporte: (id, status) => request(`/admin/community/reports/${id}/resolve`, { method: 'POST', body: JSON.stringify({ status }) }),
        adminCommunityUsuariosModerados: () => request('/admin/community/moderated-users'),
        adminCommunityObtenerModeracion: (userId) => request(`/admin/community/users/${userId}/moderation`),
        adminCommunityActualizarModeracion: (userId, datos) => request(`/admin/community/users/${userId}/moderation`, { method: 'PUT', body: JSON.stringify(datos) }),
        adminCommunityListarOficiales: () => request('/admin/community/official'),
        adminCommunityCrearOficial: (datos) => request('/admin/community/official', { method: 'POST', body: JSON.stringify(datos) }),
        adminCommunityActualizarOficial: (id, datos) => request(`/admin/community/official/${id}`, { method: 'PATCH', body: JSON.stringify(datos) }),
        adminCommunityBorrarOficial: (id) => request(`/admin/community/official/${id}`, { method: 'DELETE' }),
        adminCommunityListarAds: () => request('/admin/community/ads'),
        adminCommunityCrearAd: (datos) => request('/admin/community/ads', { method: 'POST', body: JSON.stringify(datos) }),
        adminCommunityActualizarAd: (id, datos) => request(`/admin/community/ads/${id}`, { method: 'PATCH', body: JSON.stringify(datos) }),
        adminCommunityBorrarAd: (id) => request(`/admin/community/ads/${id}`, { method: 'DELETE' }),

        // --- admin: NLT Academy ---
        adminAcademyListarCursos: () => request('/admin/academy/courses'),
        adminAcademyCrearCurso: (datos) => request('/admin/academy/courses', { method: 'POST', body: JSON.stringify(datos) }),
        adminAcademyActualizarCurso: (id, datos) => request(`/admin/academy/courses/${id}`, { method: 'PATCH', body: JSON.stringify(datos) }),
        adminAcademyListarModulos: (courseId) => request(`/admin/academy/modules${courseId ? '?course_id=' + courseId : ''}`),
        adminAcademyCrearModulo: (datos) => request('/admin/academy/modules', { method: 'POST', body: JSON.stringify(datos) }),
        adminAcademyActualizarModulo: (id, datos) => request(`/admin/academy/modules/${id}`, { method: 'PATCH', body: JSON.stringify(datos) }),
        adminAcademyBorrarModulo: (id) => request(`/admin/academy/modules/${id}`, { method: 'DELETE' }),
        adminAcademyListarLecciones: (moduleId) => request(`/admin/academy/lessons${moduleId ? '?module_id=' + moduleId : ''}`),
        adminAcademyCrearLeccion: (datos) => request('/admin/academy/lessons', { method: 'POST', body: JSON.stringify(datos) }),
        adminAcademyActualizarLeccion: (id, datos) => request(`/admin/academy/lessons/${id}`, { method: 'PATCH', body: JSON.stringify(datos) }),
        adminAcademyBorrarLeccion: (id) => request(`/admin/academy/lessons/${id}`, { method: 'DELETE' }),
        adminAcademyObtenerQuiz: (lessonId) => request(`/admin/academy/lessons/${lessonId}/quiz`),
        adminAcademyCrearQuiz: (lessonId, passing_score_percent) => request(`/admin/academy/lessons/${lessonId}/quiz`, { method: 'POST', body: JSON.stringify({ lesson_id: lessonId, passing_score_percent }) }),
        adminAcademyActualizarQuiz: (quizId, passing_score_percent) => request(`/admin/academy/quizzes/${quizId}`, { method: 'PATCH', body: JSON.stringify({ lesson_id: '', passing_score_percent }) }),
        adminAcademyBorrarQuiz: (quizId) => request(`/admin/academy/quizzes/${quizId}`, { method: 'DELETE' }),
        adminAcademyCrearPregunta: (quizId, datos) => request(`/admin/academy/quizzes/${quizId}/questions`, { method: 'POST', body: JSON.stringify(datos) }),
        adminAcademyActualizarPregunta: (id, datos) => request(`/admin/academy/questions/${id}`, { method: 'PATCH', body: JSON.stringify(datos) }),
        adminAcademyBorrarPregunta: (id) => request(`/admin/academy/questions/${id}`, { method: 'DELETE' }),
        adminAcademyListarCertificados: () => request('/admin/academy/certificates'),
        adminAcademyActualizarCertificado: (id, datos) => request(`/admin/academy/certificates/${id}`, { method: 'PATCH', body: JSON.stringify(datos) }),
        adminAcademySettings: () => request('/admin/academy/settings'),
        adminAcademyActualizarSettings: (datos) => request('/admin/academy/settings', { method: 'PUT', body: JSON.stringify(datos) }),
        adminAcademyListarEstudiantes: () => request('/admin/academy/students'),
        adminAcademyObtenerEstudiante: (userId) => request(`/admin/academy/students/${userId}`),
        adminAcademyStats: () => request('/admin/academy/stats'),
        adminAcademyListarAccess: () => request('/admin/academy/access'),
        adminAcademyConcederAcceso: (userId, datos) => request(`/admin/academy/access/${userId}/grant`, { method: 'POST', body: JSON.stringify(datos) }),
        adminAcademyRevocarAcceso: (userId) => request(`/admin/academy/access/${userId}/revoke`, { method: 'POST' }),
        adminAcademyExtenderAcceso: (userId, dias) => request(`/admin/academy/access/${userId}/extend`, { method: 'POST', body: JSON.stringify({ dias }) }),
        adminAcademyCambiarNivel: (userId, nivel) => request(`/admin/academy/access/${userId}/change-level`, { method: 'POST', body: JSON.stringify({ nivel }) }),

        // --- NLT Affiliates (usuario) ---
        afiliadoRegistrarme: (nombre) => request('/affiliates/register', { method: 'POST', body: JSON.stringify({ nombre: nombre || null }) }),
        afiliadoMiPerfil: () => request('/affiliates/me'),
        afiliadoMisStats: () => request('/affiliates/me/stats'),
        afiliadoMisCodigos: () => request('/affiliates/me/codes'),
        afiliadoMisReferidos: () => request('/affiliates/me/referrals'),
        afiliadoMisComisiones: () => request('/affiliates/me/commissions'),
        afiliadoActualizarMetodoPago: (metodo, datos) => request('/affiliates/me/payout-method', { method: 'POST', body: JSON.stringify({ metodo, datos }) }),
        afiliadoSolicitarPayout: (monto) => request('/affiliates/me/payouts', { method: 'POST', body: JSON.stringify({ monto }) }),
        afiliadoMisPayouts: () => request('/affiliates/me/payouts'),
        afiliadoAtribuirReferido: (codigo) => request('/affiliates/atribuir', { method: 'POST', body: JSON.stringify({ codigo }) }),

        // --- admin: NLT Affiliates ---
        adminAfiliadosStats: () => request('/admin/affiliates/stats'),
        adminAfiliadosListar: () => request('/admin/affiliates'),
        adminAfiliadosDetalle: (id) => request(`/admin/affiliates/${id}`),
        adminAfiliadosActualizarEstado: (id, estado) => request(`/admin/affiliates/${id}`, { method: 'PATCH', body: JSON.stringify({ estado }) }),
        adminAfiliadosCrearCodigo: (id, datos) => request(`/admin/affiliates/${id}/codes`, { method: 'POST', body: JSON.stringify(datos) }),
        adminAfiliadosActualizarCodigo: (codeId, datos) => request(`/admin/affiliates/codes/${codeId}`, { method: 'PATCH', body: JSON.stringify(datos) }),
        adminAfiliadosListarReglas: () => request('/admin/affiliates/commission-rules/all'),
        adminAfiliadosGuardarRegla: (datos) => request('/admin/affiliates/commission-rules', { method: 'PUT', body: JSON.stringify(datos) }),
        adminAfiliadosAprobarComision: (id) => request(`/admin/affiliates/commissions/${id}/approve`, { method: 'POST' }),
        adminAfiliadosRechazarComision: (id) => request(`/admin/affiliates/commissions/${id}/reject`, { method: 'POST' }),
        adminAfiliadosListarPayouts: (estado) => request(`/admin/affiliates/payouts/all${estado ? '?estado=' + estado : ''}`),
        adminAfiliadosAprobarPayout: (id) => request(`/admin/affiliates/payouts/${id}/approve`, { method: 'POST' }),
        adminAfiliadosRechazarPayout: (id, notas_admin) => request(`/admin/affiliates/payouts/${id}/reject`, { method: 'POST', body: JSON.stringify({ notas_admin }) }),
        adminAfiliadosMarcarPagado: (id, referencia_transaccion, notas_admin) => request(`/admin/affiliates/payouts/${id}/mark-paid`, { method: 'POST', body: JSON.stringify({ referencia_transaccion, notas_admin }) }),

        // --- Administración jerárquica (Global Admin) ---
        adminMisPermisos: () => request('/admin/me/permissions'),
        adminGlobalUsuarios: (q) => request(`/admin/global/users${q ? '?q=' + encodeURIComponent(q) : ''}`),
        adminGlobalAdmins: () => request('/admin/global/admins'),
        adminGlobalGuardarPermisos: (userId, permissions) => request(`/admin/global/admins/${userId}/permissions`, { method: 'PUT', body: JSON.stringify({ permissions }) }),
        adminGlobalRevocar: (userId, hard) => request(`/admin/global/admins/${userId}${hard ? '?hard=true' : ''}`, { method: 'DELETE' }),
        adminGlobalVerificar: (userId, verified) => request(`/admin/global/users/${userId}/verified`, { method: 'PUT', body: JSON.stringify({ verified }) }),
    };

    window.NLT_API = NLT_API;
})();
