/* NLT Call -- llamadas de voz y compartir pantalla de Community.
 *
 * El audio y la pantalla viajan directo entre los navegadores (WebRTC, en malla: cada persona con cada una de las demás); el servidor
 * (/community/calls, ver nlt-api app/services/community_calls.py) solo dice quién está y pasa las "señales" de conexión.
 *
 * La llamada NO se corta al salir de Community: mientras hay una llamada y tocas un enlace a otra página de NLT, esa página se abre
 * dentro de un marco a pantalla completa (la ventana principal -- y con ella la llamada -- sigue viva debajo). Las páginas dentro del
 * marco usan esta misma llamada (window.NLTCall apunta a la de la ventana principal) y la burbuja flotante se ve en todas, también
 * en el gráfico. Solo se sale de la llamada con el botón "Salir". */
(function () {
    'use strict';

    // Dentro del marco: se reutiliza la llamada de la ventana principal.
    if (window.top !== window.self) {
        try { if (window.top.NLTCall) { window.NLTCall = window.top.NLTCall; return; } } catch (_) { /* otro origen: nada */ }
    }
    if (window.NLTCall) return;

    const SYNC_RAPIDO = 600, SYNC_NORMAL = 1500, ERRORES_MAX = 8;
    const hayWebRTC = typeof RTCPeerConnection !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const soportaPantalla = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    const S = {
        call: null,            // { id, scope, conversationId, label, startedAt }
        myId: null,
        ice: [],
        peers: new Map(),      // userId -> peer
        roster: [],
        seq: 0,
        errores: 0,
        timer: null,
        muted: false,
        sinMic: false,
        mic: null,             // { stream, track }
        share: null,           // { stream, track } mientras compartes
        panelAbierto: false,
        viendo: null,          // userId de quien estás viendo
        cola: Promise.resolve(),
        oyentes: new Set(),
        hablando: new Set(),
        llamando: false,       // llamada privada esperando que la otra persona conteste
        sono: false,           // ya sonó el «conectado» de esta llamada
        live: null,            // sala «Operativa en vivo»: { room }
        pantallasLive: new Map(),   // userId -> MediaStream de su pantalla
        prevOculta: false,     // vista previa de TU pantalla compartida: la cierras con la X y vuelve con el botón «Vista previa»
    };

    // ---------- utilidades ----------
    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const iniciales = (n) => (String(n || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('') || '?').toUpperCase();
    const api = () => window.NLT_API;
    // Tonos (los define nlt-shared.js: NLT.tonos). Se leen de la ventana principal, que es donde vive la llamada.
    const tonos = () => { let t = null; try { t = (window.top.NLT || window.NLT || {}).tonos; } catch (_) { t = (window.NLT || {}).tonos; } return t && typeof t.sonar === 'function' ? t : null; };
    const sonar = (n) => { try { const t = tonos(); if (t) t.sonar(n); } catch (_) { /* un sonido que falla no afecta a la llamada */ } };
    const avisar = () => S.oyentes.forEach((f) => { try { f(estado()); } catch (_) { /* un oyente roto no afecta a los demás */ } });

    function estado() {
        return {
            activa: !!S.call, callId: S.call ? S.call.id : null, scope: S.call ? S.call.scope : null, conversationId: S.call ? S.call.conversationId : null,
            muted: S.muted, compartiendo: !!S.share || !!(S.live && S.live.room.localParticipant.isScreenShareEnabled), participantes: S.roster.slice(), hablando: [...S.hablando], soportaPantalla, sinMic: S.sinMic,
        };
    }

    // ---------- iconos (SVG propios: la burbuja vive en páginas con y sin la fuente de iconos) ----------
    const IC = {
        phone: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z"/></svg>',
        mic: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11z"/></svg>',
        micOff: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 11h-2a5 5 0 0 1-.8 2.7l1.45 1.45A7 7 0 0 0 19 11zM15 11V5a3 3 0 0 0-5.9-.8L15 10.1V11zM4.3 3 3 4.3l6 6V11a3 3 0 0 0 4.3 2.7l1.5 1.5A5 5 0 0 1 7 11H5a7 7 0 0 0 6 6.92V21h2v-3.08a7 7 0 0 0 2.6-.9l4.1 4.1L21 19.7z"/></svg>',
        screen: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h7v2H8v2h8v-2h-2v-2h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 13H3V5h18z"/></svg>',
        hangup: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1a1 1 0 0 1-.56.9 9.9 9.9 0 0 0-2.67 1.84 1 1 0 0 1-1.4 0L.3 13.7a1 1 0 0 1-.29-.7 1 1 0 0 1 .29-.7C3.3 9.4 7.4 8 12 8s8.7 1.4 11.7 4.3a1 1 0 0 1 0 1.4l-2.47 2.47a1 1 0 0 1-1.4 0 9.9 9.9 0 0 0-2.67-1.84 1 1 0 0 1-.56-.9v-3.1A15 15 0 0 0 12 9z"/></svg>',
        down: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg>',
        close: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z"/></svg>',
        full: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 5h5v2H7v3H5zm9 0h5v5h-2V7h-3zM5 14h2v3h3v2H5zm12 0h2v5h-5v-2h3z"/></svg>',
        chat: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4.3 3.6A.5.5 0 0 1 3 21.2V6a2 2 0 0 1 1-2z"/></svg>',
    };

    // ---------- estilos ----------
    function inyectarCSS() {
        if (document.getElementById('nltCallCSS')) return;
        const st = document.createElement('style');
        st.id = 'nltCallCSS';
        st.textContent = `
        #nltCallRoot { position: fixed; inset: 0; z-index: 2147483600; pointer-events: none; font-family: inherit; color: #F3F4F6; }
        #nltCallRoot * { box-sizing: border-box; }
        #nltCallRoot svg { width: 100%; height: 100%; display: block; }
        .nc-burbuja { position: fixed; width: 58px; height: 58px; border-radius: 50%; pointer-events: auto; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none;
            background: linear-gradient(135deg, #1fbf6a, #14a057); color: #fff; display: flex; align-items: center; justify-content: center;
            box-shadow: 0 10px 28px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.14) inset; }
        .nc-burbuja .nc-ico { width: 26px; height: 26px; }
        .nc-burbuja::after { content: ''; position: absolute; inset: -5px; border-radius: 50%; border: 2px solid rgba(34,197,94,.55); animation: ncPulso 2s ease-out infinite; pointer-events: none; }
        .nc-burbuja.nc-habla::after { border-color: #4378FF; animation-duration: .8s; }
        .nc-burbuja .nc-n { position: absolute; top: -4px; right: -4px; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px; background: #0b0f17; border: 1.5px solid #22c55e;
            font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
        .nc-burbuja .nc-t { position: absolute; bottom: -18px; left: 50%; transform: translateX(-50%); font-size: 10px; font-weight: 600; color: #cbd5e1; text-shadow: 0 1px 3px #000; white-space: nowrap; }
        .nc-burbuja.nc-mudo { background: linear-gradient(135deg, #475569, #334155); }
        @keyframes ncPulso { 0% { transform: scale(.92); opacity: .9; } 100% { transform: scale(1.35); opacity: 0; } }
        .nc-panel { position: fixed; pointer-events: auto; background: rgba(12,16,26,.97); border: 1px solid rgba(255,255,255,.1); border-radius: 22px;
            box-shadow: 0 24px 60px rgba(0,0,0,.6); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); overflow: hidden; display: flex; flex-direction: column; max-height: 78dvh; }
        .nc-panel.nc-oculto, .nc-burbuja.nc-oculto, .nc-visor.nc-oculto { display: none; }
        @media (max-width: 640px) { .nc-panel { left: 8px; right: 8px; bottom: calc(env(safe-area-inset-bottom, 0px) + 8px); } }
        @media (min-width: 641px) { .nc-panel { right: 18px; bottom: 18px; width: 360px; } }
        .nc-cab { display: flex; align-items: center; gap: 10px; padding: 14px 14px 10px 16px; }
        .nc-cab .nc-tit { flex: 1; min-width: 0; }
        .nc-cab b { display: block; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .nc-cab small { color: #94a3b8; font-size: 12px; }
        .nc-min { width: 34px; height: 34px; border-radius: 50%; border: 0; background: rgba(255,255,255,.08); color: #e5e7eb; padding: 8px; cursor: pointer; }
        .nc-lista { overflow-y: auto; padding: 4px 10px 8px; display: flex; flex-direction: column; gap: 4px; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
        .nc-fila { display: flex; align-items: center; gap: 11px; padding: 8px 8px; border-radius: 14px; }
        .nc-av { position: relative; width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #3b4658, #252d3b); flex: none; display: flex; align-items: center; justify-content: center;
            font-size: 13px; font-weight: 700; overflow: visible; }
        .nc-av img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
        .nc-fila.nc-habla .nc-av { box-shadow: 0 0 0 2.5px #4378FF, 0 0 14px rgba(67,120,255,.7); }
        .nc-nom { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .nc-nom i { font-style: normal; color: #94a3b8; font-weight: 500; font-size: 12px; }
        .nc-est { display: flex; align-items: center; gap: 6px; flex: none; color: #94a3b8; }
        .nc-est svg { width: 17px; height: 17px; }
        .nc-ver { border: 0; border-radius: 999px; padding: 6px 12px; font-size: 12px; font-weight: 700; background: #4378FF; color: #fff; cursor: pointer; }
        .nc-ctrl { display: flex; justify-content: center; gap: 14px; padding: 12px 14px calc(14px + env(safe-area-inset-bottom, 0px) * 0); border-top: 1px solid rgba(255,255,255,.07); }
        .nc-btn { width: 54px; height: 54px; border-radius: 50%; border: 0; padding: 15px; cursor: pointer; background: rgba(255,255,255,.1); color: #fff; position: relative; }
        .nc-btn.nc-on { background: #fff; color: #0b0f17; }
        .nc-btn.nc-rojo { background: #ef4444; color: #fff; width: auto; border-radius: 27px; padding: 0 20px; display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; }
        #nltCallRoot .nc-btn.nc-rojo svg { width: 22px; height: 22px; flex: none; }
        #nltCallRoot .nc-est svg { width: 17px; height: 17px; }
        #nltCallRoot .nc-cab .nc-min svg, #nltCallRoot .nc-visor .nc-min svg { width: 100%; height: 100%; }
        .nc-btn[hidden] { display: none; }
        .nc-chat { display: flex; align-items: center; justify-content: center; gap: 8px; width: calc(100% - 28px); margin: 2px 14px 12px; padding: 11px 14px; border: 1px solid rgba(255,255,255,.12); border-radius: 14px;
            background: rgba(255,255,255,.06); color: #f3f4f6; font-size: 14px; font-weight: 700; cursor: pointer; }
        .nc-chat:hover { background: rgba(255,255,255,.12); }
        #nltCallRoot .nc-chat svg { width: 18px; height: 18px; flex: none; }
        .nc-btn .nc-tip { position: absolute; left: 50%; top: 100%; transform: translateX(-50%); font-size: 10px; color: #94a3b8; white-space: nowrap; margin-top: 3px; }
        .nc-dialogo { position: fixed; inset: 0; pointer-events: auto; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 5; }
        .nc-caja { background: #0c101a; border: 1px solid rgba(255,255,255,.12); border-radius: 22px; padding: 22px; max-width: 360px; width: 100%; box-shadow: 0 24px 60px rgba(0,0,0,.6); }
        .nc-caja b { font-size: 16px; } .nc-caja p { color: #94a3b8; font-size: 14px; line-height: 1.45; margin: 8px 0 18px; }
        .nc-caja div { display: flex; gap: 10px; justify-content: flex-end; }
        .nc-caja button { border: 0; border-radius: 999px; padding: 11px 18px; font-size: 14px; font-weight: 700; cursor: pointer; }
        .nc-d-no { background: rgba(255,255,255,.1); color: #e5e7eb; } .nc-d-ok { background: #16a34a; color: #fff; }
        .nc-toast { position: fixed; left: 50%; top: calc(env(safe-area-inset-top, 0px) + 12px); transform: translateX(-50%); background: rgba(12,16,26,.96); border: 1px solid rgba(255,255,255,.12);
            color: #f3f4f6; padding: 9px 16px; border-radius: 999px; font-size: 13px; font-weight: 600; box-shadow: 0 10px 30px rgba(0,0,0,.5); max-width: 90vw; text-align: center; animation: ncToast 3.2s ease forwards; pointer-events: none; }
        @keyframes ncToast { 0% { opacity: 0; transform: translate(-50%, -8px); } 10%, 85% { opacity: 1; transform: translate(-50%, 0); } 100% { opacity: 0; } }
        .nc-visor { position: fixed; inset: 0; pointer-events: auto; background: #05070b; display: flex; flex-direction: column; }
        .nc-visor video { flex: 1; min-height: 0; width: 100%; object-fit: contain; background: #000; }
        .nc-visor .nc-barra { display: flex; align-items: center; gap: 10px; padding: calc(env(safe-area-inset-top, 0px) + 10px) 12px 10px; background: rgba(12,16,26,.95); }
        .nc-visor .nc-barra b { flex: 1; font-size: 14px; }
        .nc-visor .nc-min { flex: none; }
        .nc-prev { position: fixed; left: 18px; bottom: 18px; width: 272px; pointer-events: auto; background: rgba(12,16,26,.97); border: 1px solid rgba(255,255,255,.12); border-radius: 16px;
            box-shadow: 0 18px 44px rgba(0,0,0,.55); overflow: hidden; }
        .nc-prev-cab { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 12px; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
        .nc-prev-cab b { flex: 1; min-width: 0; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .nc-prev-cab b::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #ef4444; margin-right: 7px; animation: ncPulso 1.6s ease-out infinite; }
        .nc-prev .nc-min { width: 28px; height: 28px; padding: 6px; flex: none; }
        .nc-prev video { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: contain; background: #000; }
        .nc-prev-pie { padding: 7px 12px 9px; font-size: 11px; color: #94a3b8; line-height: 1.4; }
        .nc-prev-chip { position: fixed; left: 18px; bottom: 18px; pointer-events: auto; border: 1px solid rgba(255,255,255,.14); background: rgba(12,16,26,.96); color: #f3f4f6; border-radius: 999px;
            padding: 8px 14px; font-size: 12px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 7px; box-shadow: 0 10px 28px rgba(0,0,0,.5); }
        .nc-prev-chip::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: #ef4444; }
        #nltCallFrame { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; z-index: 2147482000; background: #080A0F; }
        @media (prefers-reduced-motion: reduce) { .nc-burbuja::after, .nc-toast, .nc-prev-cab b::before { animation: none; } .nc-toast { opacity: 1; } }`;
        document.head.appendChild(st);
    }

    // ---------- interfaz ----------
    let raiz = null, elBurbuja = null, elPanel = null, elVisor = null, elAudios = null, tickTimer = null, elPrev = null, elChip = null;

    function montarUI() {
        if (raiz) return;
        inyectarCSS();
        raiz = document.createElement('div');
        raiz.id = 'nltCallRoot';
        raiz.innerHTML = '<div id="ncAudios" style="display:none"></div>';
        document.body.appendChild(raiz);
        elAudios = raiz.querySelector('#ncAudios');

        elBurbuja = document.createElement('div');
        elBurbuja.className = 'nc-burbuja nc-oculto';
        elBurbuja.setAttribute('role', 'button'); elBurbuja.setAttribute('aria-label', 'Llamada en curso: abrir');
        raiz.appendChild(elBurbuja);
        arrastrable(elBurbuja, () => { S.panelAbierto = !S.panelAbierto; pintar(); });

        elPanel = document.createElement('div');
        elPanel.className = 'nc-panel nc-oculto';
        elPanel.setAttribute('role', 'dialog'); elPanel.setAttribute('aria-label', 'Llamada');
        raiz.appendChild(elPanel);
        elPanel.addEventListener('click', (e) => {
            const b = e.target.closest('[data-nc]'); if (!b) return;
            const acc = b.getAttribute('data-nc');
            if (acc === 'min') { S.panelAbierto = false; pintar(); }
            else if (acc === 'mic') alternarMic();
            else if (acc === 'pantalla') alternarPantalla();
            else if (acc === 'salir') salir();
            else if (acc === 'ver') abrirVisor(b.getAttribute('data-uid'));
            else if (acc === 'chat') irAlChat();
        });
    }

    function posicionBurbuja() {
        let p = null;
        try { p = JSON.parse(localStorage.getItem('nlt_call_burbuja') || 'null'); } catch (_) { /* sin guardado */ }
        const w = window.innerWidth, h = window.innerHeight;
        const x = p ? Math.min(Math.max(p.x, 6), w - 64) : w - 72;
        const y = p ? Math.min(Math.max(p.y, 6), h - 90) : Math.max(90, Math.round(h * 0.28));
        return { x, y };
    }

    function arrastrable(el, alTocar) {
        let inicio = null;
        el.addEventListener('pointerdown', (e) => {
            inicio = { px: e.clientX, py: e.clientY, x: el.offsetLeft, y: el.offsetTop, movio: false };
            try { el.setPointerCapture(e.pointerId); } catch (_) { /* sin captura */ }
            el.style.cursor = 'grabbing';
        });
        el.addEventListener('pointermove', (e) => {
            if (!inicio) return;
            const dx = e.clientX - inicio.px, dy = e.clientY - inicio.py;
            if (!inicio.movio && Math.hypot(dx, dy) < 6) return;
            inicio.movio = true;
            el.style.left = Math.min(Math.max(inicio.x + dx, 6), window.innerWidth - 64) + 'px';
            el.style.top = Math.min(Math.max(inicio.y + dy, 6), window.innerHeight - 90) + 'px';
        });
        const fin = () => {
            if (!inicio) return;
            const movio = inicio.movio; inicio = null; el.style.cursor = '';
            if (movio) { try { localStorage.setItem('nlt_call_burbuja', JSON.stringify({ x: el.offsetLeft, y: el.offsetTop })); } catch (_) { /* sin guardado */ } }
            else alTocar();
        };
        el.addEventListener('pointerup', fin);
        el.addEventListener('pointercancel', () => { inicio = null; el.style.cursor = ''; });
    }

    function tiempo() {
        if (!S.call) return '';
        const s = Math.max(0, Math.floor((Date.now() - S.call.startedAt) / 1000));
        const m = Math.floor(s / 60);
        return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }

    function pintar() {
        if (!raiz) return;
        const activa = !!S.call;
        elBurbuja.classList.toggle('nc-oculto', !activa || S.panelAbierto);
        elPanel.classList.toggle('nc-oculto', !activa || !S.panelAbierto);
        if (!activa) { if (elVisor) cerrarVisor(); pintarPrevia(); return; }

        const habla = S.hablando.size > 0;
        elBurbuja.classList.toggle('nc-habla', habla);
        elBurbuja.classList.toggle('nc-mudo', S.muted);
        if (!elBurbuja.style.left) { const p = posicionBurbuja(); elBurbuja.style.left = p.x + 'px'; elBurbuja.style.top = p.y + 'px'; }
        const htmlBurbuja = `<span class="nc-ico">${S.muted ? IC.micOff : IC.phone}</span><span class="nc-n">${S.roster.length}</span><span class="nc-t" data-nc-t>§T§</span>`;
        if (elBurbuja._html !== htmlBurbuja) { elBurbuja._html = htmlBurbuja; elBurbuja.innerHTML = htmlBurbuja.replace('§T§', tiempo()); }

        if (S.panelAbierto) {
            const filas = S.roster.map((p) => {
                const yo = p.user_id === S.myId;
                const comparte = p.sharing && !yo;
                return `<div class="nc-fila ${S.hablando.has(p.user_id) ? 'nc-habla' : ''}" data-uid="${esc(p.user_id)}">
                    <div class="nc-av">${p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="">` : esc(iniciales(p.display_name))}</div>
                    <div class="nc-nom">${esc(p.display_name)}${yo ? ' <i>(tú)</i>' : ''}${p.host ? ' <i>· anfitrión</i>' : ''}</div>
                    <div class="nc-est">${p.sharing ? `<span title="Compartiendo pantalla">${IC.screen}</span>` : ''}${p.muted ? `<span title="Silenciado">${IC.micOff}</span>` : ''}
                    ${comparte ? `<button class="nc-ver" data-nc="ver" data-uid="${esc(p.user_id)}">Ver</button>` : ''}</div></div>`;
            }).join('');
            const titulo = S.call.scope === 'live' ? 'Operativa en vivo' : (S.call.scope === 'global' ? 'Llamada grupal' : `Llamada con ${esc(S.call.label || 'tu contacto')}`);
            const htmlPanel = `
                <div class="nc-cab"><div class="nc-tit"><b>${titulo}</b><small>${S.llamando ? 'Llamando…' : `<span data-nc-t>§T§</span> · ${S.roster.length} ${S.roster.length === 1 ? 'persona' : 'personas'}`}</small></div>
                    <button class="nc-min" data-nc="min" aria-label="Minimizar">${IC.down}</button></div>
                <div class="nc-lista">${filas || '<div class="nc-fila"><div class="nc-nom"><i>Conectando…</i></div></div>'}</div>
                ${S.call.scope === 'live' ? '' : `<button class="nc-chat" data-nc="chat" type="button">${IC.chat}<span>${S.call.scope === 'global' ? 'Ir al chat general' : 'Ir al chat'}</span></button>`}
                <div class="nc-ctrl">
                    <button class="nc-btn ${S.muted ? 'nc-on' : ''}" data-nc="mic" aria-label="${S.muted ? 'Activar micrófono' : 'Silenciar micrófono'}">${S.muted ? IC.micOff : IC.mic}</button>
                    <button class="nc-btn ${S.share || (S.live && S.live.room.localParticipant.isScreenShareEnabled) ? 'nc-on' : ''}" data-nc="pantalla" aria-label="${S.share ? 'Dejar de compartir pantalla' : 'Compartir pantalla'}" ${soportaPantalla && (!S.live || S.live.anfitrion) ? '' : 'hidden'}>${IC.screen}</button>
                    <button class="nc-btn nc-rojo" data-nc="salir" aria-label="Salir de la llamada">${IC.hangup}<span>Salir</span></button>
                </div>`;
            // solo se vuelve a dibujar si algo cambió (si no, un toque a mitad de un redibujo se perdería)
            if (elPanel._html !== htmlPanel) { elPanel._html = htmlPanel; const lista = elPanel.querySelector('.nc-lista'); const top = lista ? lista.scrollTop : 0; elPanel.innerHTML = htmlPanel.replace('§T§', tiempo()); const l2 = elPanel.querySelector('.nc-lista'); if (l2) l2.scrollTop = top; }
        }
        pintarPrevia();
        avisar();
    }

    function toast(texto) {
        montarUI();
        const t = document.createElement('div');
        t.className = 'nc-toast'; t.textContent = texto;
        raiz.appendChild(t);
        setTimeout(() => t.remove(), 3300);
    }

    // ---------- pregunta (cambiar de llamada) ----------
    function preguntar(titulo, texto, textoOk) {
        montarUI();
        return new Promise((resolver) => {
            const d = document.createElement('div');
            d.className = 'nc-dialogo';
            d.innerHTML = `<div class="nc-caja" role="alertdialog" aria-label="${esc(titulo)}"><b>${esc(titulo)}</b><p>${esc(texto)}</p><div><button class="nc-d-no" type="button">Quedarme</button><button class="nc-d-ok" type="button">${esc(textoOk)}</button></div></div>`;
            raiz.appendChild(d);
            const fin = (v) => { d.remove(); resolver(v); };
            d.querySelector('.nc-d-ok').onclick = () => fin(true);
            d.querySelector('.nc-d-no').onclick = () => fin(false);
        });
    }

    // ---------- vista previa de TU pantalla compartida ("así te ven") ----------
    // Mientras compartes, una tarjeta pequeña muestra lo que estás enviando. Si compartes TODA la pantalla, la tarjeta también sale en lo que ven los demás:
    // se puede mover o cerrar con la X (el botón «Vista previa» la vuelve a abrir). Si compartes una ventana u otra pestaña, ellos no la ven.
    function pistaLocalPantalla() {
        try {
            if (S.live) {
                const LK = window.LivekitClient, pub = LK && S.live.room.localParticipant.getTrackPublication(LK.Track.Source.ScreenShare);
                return (pub && pub.track && pub.track.mediaStreamTrack) || null;
            }
            return S.share ? S.share.track : null;
        } catch (_) { return null; }
    }
    function describirPantalla(track) {
        let st = {}; try { st = track.getSettings() || {}; } catch (_) { /* sin datos */ }
        const sup = { monitor: 'Pantalla completa', window: 'Una ventana', browser: 'Una pestaña' }[st.displaySurface] || 'Tu pantalla';
        const res = st.width && st.height ? `${st.width}×${st.height}${st.frameRate ? ' · ' + Math.round(st.frameRate) + ' fps' : ''}` : '';
        return { sup, res, monitor: st.displaySurface === 'monitor' };
    }
    function quitarPrevia() {
        if (elPrev) { const v = elPrev.querySelector('video'); if (v) v.srcObject = null; elPrev.remove(); elPrev = null; }
        if (elChip) { elChip.remove(); elChip = null; }
    }
    function arrastrarPorCabecera(caja, cab) {
        let ini = null;
        cab.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button')) return;
            const r = caja.getBoundingClientRect();
            ini = { px: e.clientX, py: e.clientY, x: r.left, y: r.top };
            try { cab.setPointerCapture(e.pointerId); } catch (_) { /* sin captura */ }
            cab.style.cursor = 'grabbing';
        });
        cab.addEventListener('pointermove', (e) => {
            if (!ini) return;
            const x = Math.min(Math.max(ini.x + e.clientX - ini.px, 4), window.innerWidth - caja.offsetWidth - 4);
            const y = Math.min(Math.max(ini.y + e.clientY - ini.py, 4), window.innerHeight - caja.offsetHeight - 4);
            caja.style.left = x + 'px'; caja.style.top = y + 'px'; caja.style.bottom = 'auto';
        });
        const fin = () => { if (!ini) return; ini = null; cab.style.cursor = ''; try { localStorage.setItem('nlt_call_prev', JSON.stringify({ x: caja.offsetLeft, y: caja.offsetTop })); } catch (_) { /* sin guardado */ } };
        cab.addEventListener('pointerup', fin); cab.addEventListener('pointercancel', fin);
    }
    function pintarPrevia() {
        const track = S.call && raiz ? pistaLocalPantalla() : null;
        if (!track || track.readyState === 'ended') { S.prevOculta = false; quitarPrevia(); return; }
        if (S.prevOculta) {
            if (elPrev) { const v = elPrev.querySelector('video'); if (v) v.srcObject = null; elPrev.remove(); elPrev = null; }
            if (!elChip) {
                elChip = document.createElement('button');
                elChip.type = 'button'; elChip.className = 'nc-prev-chip'; elChip.textContent = 'Vista previa';
                elChip.addEventListener('click', () => { S.prevOculta = false; pintarPrevia(); });
                raiz.appendChild(elChip);
            }
            return;
        }
        if (elChip) { elChip.remove(); elChip = null; }
        const d = describirPantalla(track);
        if (!elPrev) {
            elPrev = document.createElement('div');
            elPrev.className = 'nc-prev'; elPrev.setAttribute('role', 'region'); elPrev.setAttribute('aria-label', 'Vista previa de tu pantalla compartida');
            elPrev.innerHTML = `<div class="nc-prev-cab"><b>Así te ven</b><button type="button" class="nc-min" data-prev="x" aria-label="Cerrar la vista previa">${IC.close}</button></div><video autoplay playsinline muted></video><div class="nc-prev-pie"></div>`;
            raiz.appendChild(elPrev);
            try { const p = JSON.parse(localStorage.getItem('nlt_call_prev') || 'null'); if (p) { elPrev.style.left = Math.min(Math.max(p.x, 4), Math.max(4, window.innerWidth - 276)) + 'px'; elPrev.style.top = Math.min(Math.max(p.y, 4), Math.max(4, window.innerHeight - 200)) + 'px'; elPrev.style.bottom = 'auto'; } } catch (_) { /* posición por defecto */ }
            elPrev.querySelector('[data-prev="x"]').addEventListener('click', () => { S.prevOculta = true; pintarPrevia(); });
            arrastrarPorCabecera(elPrev, elPrev.querySelector('.nc-prev-cab'));
        }
        const v = elPrev.querySelector('video');
        if (v._pista !== track) { v._pista = track; v.srcObject = new MediaStream([track]); v.play().catch(() => {}); }
        const pie = `${esc(d.sup)}${d.res ? ' · ' + esc(d.res) : ''}${d.monitor ? '<br>Compartes toda la pantalla: esta tarjeta también se ve. Muévela o ciérrala con la X.' : ''}`;
        const elPie = elPrev.querySelector('.nc-prev-pie');
        if (elPie._html !== pie) { elPie._html = pie; elPie.innerHTML = pie; }
    }

    // ---------- ver la pantalla de otra persona ----------
    function abrirVisor(uid) {
        const peer = S.peers.get(uid);
        const p = S.roster.find((x) => x.user_id === uid);
        const flujo = S.live ? S.pantallasLive.get(uid) : (peer && peer.pantalla);
        if (!flujo) { toast('Todavía no llega la pantalla, espera un momento…'); return; }
        cerrarVisor();
        S.viendo = uid;
        elVisor = document.createElement('div');
        elVisor.className = 'nc-visor';
        elVisor.innerHTML = `<div class="nc-barra"><b>Pantalla de ${esc(p ? p.display_name : '')}</b><button class="nc-min" data-v="full" aria-label="Pantalla completa">${IC.full}</button><button class="nc-min" data-v="x" aria-label="Cerrar">${IC.close}</button></div><video autoplay playsinline muted></video>`;
        raiz.appendChild(elVisor);
        const v = elVisor.querySelector('video');
        v.srcObject = flujo; v.play().catch(() => {});
        elVisor.addEventListener('click', (e) => {
            const b = e.target.closest('[data-v]'); if (!b) return;
            if (b.getAttribute('data-v') === 'x') cerrarVisor();
            else if (v.requestFullscreen) v.requestFullscreen().catch(() => {}); else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
        });
    }
    function cerrarVisor() { if (elVisor) { elVisor.remove(); elVisor = null; } S.viendo = null; }

    // ---------- micrófono ----------
    async function pedirMic() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
            S.mic = { stream, track: stream.getAudioTracks()[0] };
            S.sinMic = false;
            S.mic.track.enabled = !S.muted;
            vigilarVoz(S.myId, stream);
            return true;
        } catch (e) {
            S.sinMic = true; S.muted = true;
            toast(e && e.name === 'NotAllowedError' ? 'Permite el micrófono para hablar. Puedes escuchar mientras tanto.' : 'No se pudo usar el micrófono.');
            return false;
        }
    }

    async function alternarMic() {
        if (S.live) {
            try {
                const room = S.live.room;
                const encender = !room.localParticipant.isMicrophoneEnabled;
                await room.localParticipant.setMicrophoneEnabled(encender);
                S.muted = !encender; S.sinMic = false;
            } catch (e) { toast(e && e.name === 'NotAllowedError' ? 'Permite el micrófono para hablar.' : 'No se pudo usar el micrófono.'); }
            actualizarRosterLive(); return;
        }
        if (S.sinMic || !S.mic) {
            if (!(await pedirMic())) { pintar(); return; }
            S.muted = false; S.mic.track.enabled = true;
            S.peers.forEach((p) => { if (p.audioSender) p.audioSender.replaceTrack(S.mic.track).catch(() => {}); });
        } else {
            S.muted = !S.muted; S.mic.track.enabled = !S.muted;
        }
        pintar();
    }

    // ---------- compartir pantalla ----------
    async function alternarPantalla() {
        if (S.live) {
            if (!S.live.anfitrion) { toast('Solo los anfitriones comparten pantalla en la operativa.'); return; }
            if (!soportaPantalla) { toast('Compartir pantalla funciona desde el computador.'); return; }
            try {
                const lp = S.live.room.localParticipant;
                if (!lp.isScreenShareEnabled) S.prevOculta = false;
                await lp.setScreenShareEnabled(!lp.isScreenShareEnabled, { audio: false, contentHint: 'detail', resolution: { width: 1920, height: 1080, frameRate: 15 } });
            } catch (e) { if (e && e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast('No se pudo compartir la pantalla.'); }
            actualizarRosterLive(); return;
        }
        if (S.share) { detenerPantalla(); return; }
        if (!soportaPantalla) { toast('Compartir pantalla funciona desde el computador (Chrome, Edge, Firefox o Safari de escritorio).'); return; }
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 20 }, width: { max: 1920 } }, audio: false });
            const track = stream.getVideoTracks()[0];
            S.share = { stream, track }; S.prevOculta = false;
            track.addEventListener('ended', detenerPantalla);
            S.peers.forEach((p) => anadirPantalla(p));
            toast('Estás compartiendo tu pantalla');
            sincronizarYa();
            pintar();
        } catch (e) {
            if (e && e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast('No se pudo compartir la pantalla.');
        }
    }
    function anadirPantalla(peer) {
        if (!S.share || peer.pantallaSender) return;
        try {
            peer.pantallaSender = peer.pc.addTrack(S.share.track, S.share.stream);
            const params = peer.pantallaSender.getParameters();
            if (!params.encodings || !params.encodings.length) params.encodings = [{}];
            params.encodings[0].maxBitrate = 1200000;
            peer.pantallaSender.setParameters(params).catch(() => {});
        } catch (_) { /* el peer puede estar cerrándose */ }
    }
    function detenerPantalla() {
        if (!S.share) return;
        const { track } = S.share;
        S.peers.forEach((p) => { if (p.pantallaSender) { try { p.pc.removeTrack(p.pantallaSender); } catch (_) { /* ya cerrado */ } p.pantallaSender = null; } });
        try { track.stop(); } catch (_) { /* ya parado */ }
        S.share = null;
        sincronizarYa();
        pintar();
    }

    // ---------- quién está hablando ----------
    let audioCtx = null;
    const vigias = new Map();       // id -> { analizador, datos, fuente }
    function vigilarVoz(id, stream) {
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
            quitarVigia(id);
            const fuente = audioCtx.createMediaStreamSource(stream);
            const analizador = audioCtx.createAnalyser(); analizador.fftSize = 512;
            fuente.connect(analizador);
            vigias.set(id, { analizador, datos: new Uint8Array(analizador.fftSize), fuente });
        } catch (_) { /* sin indicador de voz: no afecta a la llamada */ }
    }
    function quitarVigia(id) { const v = vigias.get(id); if (v) { try { v.fuente.disconnect(); } catch (_) { /* ya desconectado */ } vigias.delete(id); } S.hablando.delete(id); }
    function medirVoz() {
        let cambio = false;
        vigias.forEach((v, id) => {
            v.analizador.getByteTimeDomainData(v.datos);
            let max = 0; for (let i = 0; i < v.datos.length; i++) max = Math.max(max, Math.abs(v.datos[i] - 128));
            const habla = max > 9 && !(id === S.myId && S.muted);
            if (habla !== S.hablando.has(id)) { habla ? S.hablando.add(id) : S.hablando.delete(id); cambio = true; }
        });
        if (cambio) pintar();
    }

    // ---------- conexiones entre personas (WebRTC) ----------
    // Las señales se juntan 60 ms y salen en UN solo viaje (la oferta y sus candidatos van juntas); la oferta/respuesta no espera.
    let salida = [], salidaTimer = null;
    function vaciarSalida() {
        clearTimeout(salidaTimer); salidaTimer = null;
        const callId = S.call && S.call.id, lote = salida; salida = [];
        if (!callId || !lote.length) return;
        S.cola = S.cola.then(() => api().callSenales(callId, { signals: lote }).catch(() => { /* la otra persona pudo salir */ }));
    }
    function enviarSenal(uid, tipo, payload) {
        if (!S.call) return;
        const pe = S.peers.get(uid);
        // sid: identifica ESTA entrada a la llamada (si vuelves a entrar es otra); pid: identifica ESTA conexión con esa persona (si se rehace, es otra)
        salida.push({ to_user_id: uid, kind: tipo, payload: { sid: S.sid, pid: pe ? pe.pid : null, d: payload } });
        if (tipo === 'ice') { if (!salidaTimer) salidaTimer = setTimeout(vaciarSalida, 60); } else vaciarSalida();
    }

    async function ponerLocal(pc, tipo) {
        try { await pc.setLocalDescription(); }
        catch (_) { await pc.setLocalDescription(await (tipo === 'offer' ? pc.createOffer() : pc.createAnswer())); }
    }

    // Quien llegó después es quien ofrece (así no se cruzan dos ofertas a la vez y la conexión se arma en un solo intercambio).
    // La otra parte espera la oferta; si en 8 s no llega, ofrece ella.
    function esIniciador(uid) {
        const yo = S.roster.find((p) => p.user_id === S.myId), el = S.roster.find((p) => p.user_id === uid);
        if (!yo || !el || !yo.joined_at || !el.joined_at) return S.myId > uid;
        return yo.joined_at === el.joined_at ? S.myId > uid : yo.joined_at > el.joined_at;
    }
    function iniciarOferta(peer) {
        if (peer.audioSender || peer.cerrado) return;
        // siempre hay un canal de audio (aunque no tengas micrófono todavía), así la conexión se arma igual
        const tr = peer.pc.addTransceiver('audio', { direction: 'sendrecv' });
        peer.audioSender = tr.sender;
        if (S.mic) tr.sender.replaceTrack(S.mic.track).catch(() => {});
        if (S.share) anadirPantalla(peer);
    }

    function crearPeer(uid, iniciar) {
        const pc = new RTCPeerConnection({ iceServers: S.ice, iceCandidatePoolSize: 4, bundlePolicy: 'max-bundle' });
        const peer = { uid, pid: Math.random().toString(36).slice(2, 10), remotePid: null, pc, polite: S.myId < uid, haciendoOferta: false, ignorarOferta: false, pantalla: null, pantallaSender: null, audioSender: null, audioEl: null, ausencias: 0, cola: Promise.resolve(), cerrado: false };
        S.peers.set(uid, peer);
        if (iniciar === undefined ? esIniciador(uid) : iniciar) iniciarOferta(peer);
        else peer.espera = setTimeout(() => { if (!peer.cerrado && !pc.remoteDescription) iniciarOferta(peer); }, 8000);

        pc.onicecandidate = (e) => { if (e.candidate) enviarSenal(uid, 'ice', e.candidate.toJSON()); };
        pc.onnegotiationneeded = async () => {
            try {
                peer.haciendoOferta = true;
                await ponerLocal(pc, 'offer');
                enviarSenal(uid, 'offer', { description: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription });
            } catch (_) { /* se reintenta con la próxima negociación */ } finally { peer.haciendoOferta = false; }
        };
        pc.ontrack = (e) => {
            if (e.track.kind === 'audio') {
                if (!peer.audioEl) { peer.audioEl = document.createElement('audio'); peer.audioEl.autoplay = true; peer.audioEl.setAttribute('playsinline', ''); elAudios.appendChild(peer.audioEl); }
                peer.audioEl.srcObject = e.streams[0] || new MediaStream([e.track]);
                reproducir(peer.audioEl);
                vigilarVoz(uid, peer.audioEl.srcObject);
            } else {
                peer.pantalla = e.streams[0] || new MediaStream([e.track]);
                e.track.addEventListener('ended', () => { if (peer.pantalla) peer.pantalla = null; if (S.viendo === uid) cerrarVisor(); });
                e.track.addEventListener('mute', () => { if (S.viendo === uid && elVisor) { /* la imagen se congela hasta que vuelva */ } });
                if (S.viendo === uid && elVisor) elVisor.querySelector('video').srcObject = peer.pantalla;
                pintar();
            }
        };
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected' && !S.sono) { S.sono = true; sonar('conectado'); }
            if (pc.connectionState === 'failed') { try { pc.restartIce(); } catch (_) { /* sin reinicio */ } }
            if (pc.connectionState === 'closed' || peer.cerrado) return;
            if (pc.connectionState === 'failed') setTimeout(() => { if (!peer.cerrado && pc.connectionState === 'failed') { cerrarPeer(uid); } }, 12000);
        };
        return peer;
    }

    function cerrarPeer(uid) {
        const peer = S.peers.get(uid);
        if (!peer) return;
        peer.cerrado = true; clearTimeout(peer.espera);
        try { peer.pc.close(); } catch (_) { /* ya cerrada */ }
        if (peer.audioEl) { peer.audioEl.srcObject = null; peer.audioEl.remove(); }
        quitarVigia(uid);
        if (S.viendo === uid) cerrarVisor();
        S.peers.delete(uid);
    }

    // Señal entrante ("negociación perfecta": las dos partes pueden ofrecer a la vez y se resuelve sin quedarse trabadas).
    function recibirSenal(de, tipo, envoltorio) {
        const sid = envoltorio && envoltorio.sid, pid = envoltorio && envoltorio.pid, payload = envoltorio && envoltorio.d;
        let peer = S.peers.get(de);
        // la otra persona salió y volvió a entrar, o rehízo su conexión con nosotros: se empieza una conexión nueva en vez de mezclar
        if (peer && ((sid && peer.sid && peer.sid !== sid) || (pid && peer.remotePid && peer.remotePid !== pid))) { cerrarPeer(de); peer = null; }
        if (!peer) peer = crearPeer(de, false);
        if (sid) peer.sid = sid;
        if (pid) peer.remotePid = pid;
        peer.cola = peer.cola.then(async () => {
            if (peer.cerrado) return;
            const pc = peer.pc;
            try {
                if (tipo === 'offer' || tipo === 'answer') {
                    const desc = payload && payload.description;
                    if (!desc) return;
                    const colision = desc.type === 'offer' && (peer.haciendoOferta || pc.signalingState !== 'stable');
                    peer.ignorarOferta = !peer.polite && colision;
                    if (peer.ignorarOferta) return;
                    await pc.setRemoteDescription(desc);
                    if (desc.type === 'offer') {
                        if (!peer.audioSender) {
                            const tr = pc.getTransceivers().find((t) => t.receiver && t.receiver.track && t.receiver.track.kind === 'audio');
                            if (tr) { tr.direction = 'sendrecv'; peer.audioSender = tr.sender; if (S.mic) await tr.sender.replaceTrack(S.mic.track).catch(() => {}); }
                        }
                        await ponerLocal(pc, 'answer');
                        enviarSenal(de, 'answer', { description: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription });
                        if (S.share) anadirPantalla(peer);
                    }
                } else if (tipo === 'ice') {
                    try { await pc.addIceCandidate(payload); } catch (e) { if (!peer.ignorarOferta) throw e; }
                }
            } catch (_) { /* una señal rota no debe tumbar la llamada: el estado de la conexión lo dirá */ }
        });
    }

    // ---------- bucle con el servidor ----------
    let syncPendiente = false;
    function sincronizarYa() { if (S.call && !S.live && !syncPendiente) { clearTimeout(S.timer); bucle(); } }

    function intervalo() {
        for (const p of S.peers.values()) { const c = p.pc.connectionState; if (c !== 'connected') return SYNC_RAPIDO; }
        return S.roster.length > 1 ? SYNC_NORMAL : SYNC_NORMAL + 500;
    }

    function aplicarRoster(lista) {
        const antes = new Set(S.roster.map((p) => p.user_id));
        const ahora = new Set(lista.map((p) => p.user_id));
        const dm = S.call && S.call.scope === 'dm';
        lista.forEach((p) => { if (p.user_id !== S.myId && !antes.has(p.user_id) && S.roster.length) { if (!dm) { toast(`${p.display_name} se unió a la llamada`); sonar('entra'); } } });
        S.roster.forEach((p) => { if (p.user_id !== S.myId && !ahora.has(p.user_id)) { toast(dm ? `${p.display_name} colgó` : `${p.display_name} salió de la llamada`); if (!dm) sonar('sale'); } });
        // llamada privada: al contestar la otra persona deja de sonar el «tuuu» y suena el de conectado; si cuelga, se cuelga también
        if (dm && S.llamando && lista.length > 1) { S.llamando = false; clearTimeout(S.sinRespuesta); const t = tonos(); if (t) t.detener(); if (!S.sono) { S.sono = true; sonar('conectado'); } }
        if (dm && S.roster.length > 1 && lista.length <= 1 && S.call) { const id = S.call.id; setTimeout(() => { if (S.call && S.call.id === id && S.roster.length <= 1) salir(); }, 1200); }
        S.roster = lista;
        lista.forEach((p) => { if (p.user_id !== S.myId && !S.peers.has(p.user_id)) crearPeer(p.user_id); });
        // una persona nueva puede mandar su señal un instante antes de aparecer en la lista: se cierra solo tras 2 ausencias seguidas
        [...S.peers.keys()].forEach((uid) => {
            const peer = S.peers.get(uid);
            if (ahora.has(uid)) { peer.ausencias = 0; return; }
            if (++peer.ausencias >= 2) cerrarPeer(uid);
        });
    }

    async function bucle() {
        if (!S.call || S.live) return;
        syncPendiente = true;
        const callId = S.call.id;
        try {
            const r = await api().callSync(callId, { after: S.seq, muted: S.muted, sharing: !!S.share });
            if (!S.call || S.call.id !== callId) return;
            if (!r.active) { terminarLocal('La llamada terminó'); return; }
            S.errores = 0; S.seq = r.seq;
            aplicarRoster(r.participants || []);
            // sola en la llamada: no se queda abierta para siempre (privada 1 min, grupal 5 min)
            if (S.roster.length <= 1) {
                S.sola = S.sola || Date.now();
                if (Date.now() - S.sola > (S.call.scope === 'dm' ? 60000 : 300000)) { salir(); toast('Nadie más en la llamada: se cerró'); return; }
            } else S.sola = 0;
            for (const s of (r.signals || [])) recibirSenal(s.from_user, s.kind, s.payload);
            pintar();
        } catch (e) {
            if (e && e.status === 404) { terminarLocal('La llamada terminó'); return; }
            if (++S.errores >= ERRORES_MAX) { terminarLocal('Se perdió la conexión con la llamada'); return; }
        } finally { syncPendiente = false; }
        if (S.call && S.call.id === callId) S.timer = setTimeout(bucle, intervalo());
    }

    // ---------- entrar / salir ----------
    function mismaLlamada(scope, conversationId) {
        return !!S.call && S.call.scope === scope && (scope === 'global' || scope === 'live' || S.call.conversationId === conversationId);
    }

    // Una persona puede estar en una sola llamada a la vez; entrar a otra pregunta primero y sale de la actual (nunca se tumba nada sin avisar)
    async function unirse({ scope, conversationId, label, myId, cambiar, soloUnirse }) {
        if (S.call && !mismaLlamada(scope, conversationId)) {
            const donde = S.call.scope === 'live' ? 'la Operativa en vivo' : (S.call.scope === 'global' ? 'la llamada grupal' : 'una llamada privada');
            const ok = cambiar || await preguntar('Ya estás en una llamada', `Estás en ${donde}. ¿Quieres salir de ella para entrar a esta otra?`, 'Cambiar de llamada');
            if (!ok) return estado();
            salir();
        }
        if (scope === 'live') return unirseLive({ myId });
        if (!hayWebRTC) throw new Error('Tu navegador no permite llamadas. Actualízalo o prueba con Chrome o Safari.');
        if (!window.isSecureContext) throw new Error('Las llamadas necesitan una conexión segura (https).');
        if (S.call) {
            const igual = S.call.scope === scope && (scope === 'global' || S.call.conversationId === conversationId);
            if (igual) { S.panelAbierto = true; montarUI(); pintar(); return estado(); }
            throw new Error('Ya estás en otra llamada. Sal de ella primero.');
        }
        if (S.uniendo) return estado();                                // doble toque: ya se está entrando
        montarUI();
        S.myId = myId; S.sid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
        S.muted = false; S.sinMic = false; S.seq = 0; S.errores = 0; S.roster = []; S.sono = false; S.llamando = false;
        S.uniendo = true; S.cancelarUnion = false;
        let r;
        try {
            await pedirMic();                                          // dentro del toque del usuario: así el navegador deja sonar el audio
            r = await api().callUnirse(scope, scope === 'dm' ? conversationId : null, !!soloUnirse);
        } catch (e) { liberarMedios(); throw e; }
        finally { S.uniendo = false; }
        if (S.cancelarUnion) {                                         // colgó mientras todavía se estaba entrando: se sale de inmediato, sin dejar la llamada abierta
            S.cancelarUnion = false; liberarMedios(); api().callSalir(r.call_id).catch(() => {}); pintar(); return estado();
        }
        S.call = { id: r.call_id, scope, conversationId: conversationId || null, label: label || '', startedAt: Date.now() };
        S.ice = r.ice_servers || [];
        S.panelAbierto = true;
        S.roster = (r.participants || []);
        S.roster.forEach((p) => { if (p.user_id !== S.myId) crearPeer(p.user_id); });
        if (scope === 'dm' && S.roster.filter((p) => p.user_id !== S.myId).length === 0) {
            // yo llamo: suena el «tuuu» hasta que contesten (o 45 s)
            S.llamando = true; const t = tonos(); if (t) t.iniciar('llamando', 45);
            S.sinRespuesta = setTimeout(() => { if (S.call && S.llamando) { S.llamando = false; toast(`${label || 'La otra persona'} no contestó`); pintar(); } }, 45000);
        }
        if (!tickTimer) tickTimer = setInterval(() => { document.querySelectorAll('#nltCallRoot [data-nc-t]').forEach((el) => { el.textContent = tiempo(); }); medirVoz(); }, 600);
        guardarResume();
        pintar();
        bucle();
        return estado();
    }

    // ---------- Operativa en vivo (sala con servidor LiveKit: hasta 30 personas; los anfitriones comparten pantalla) ----------
    let cargaLiveKit = null;
    function cargarLiveKit() {
        if (window.LivekitClient) return Promise.resolve();
        if (!cargaLiveKit) {
            cargaLiveKit = new Promise((ok, mal) => {
                const sc = document.createElement('script');
                sc.src = 'assets/vendor/livekit-client.umd.js';
                sc.onload = ok; sc.onerror = () => { cargaLiveKit = null; mal(new Error('No se pudo cargar la sala. Revisa tu conexión.')); };
                document.head.appendChild(sc);
            });
        }
        return cargaLiveKit;
    }

    function metaDe(p) { try { return JSON.parse(p.metadata || '{}'); } catch (_) { return {}; } }
    function entradaRoster(p, esYo) {
        const m = metaDe(p);
        return { user_id: p.identity, display_name: p.name || m.username || 'Miembro', avatar_url: m.avatar || null, host: !!m.host,
                 muted: !p.isMicrophoneEnabled, sharing: !!p.isScreenShareEnabled, joined_at: p.joinedAt ? new Date(p.joinedAt).toISOString() : '' , yo: esYo };
    }
    function actualizarRosterLive() {
        if (!S.live) return;
        const room = S.live.room;
        const lista = [entradaRoster(room.localParticipant, true), ...[...room.remoteParticipants.values()].map((p) => entradaRoster(p, false))];
        lista.sort((a, b) => (b.host - a.host) || a.display_name.localeCompare(b.display_name));
        S.roster = lista;
        S.muted = !room.localParticipant.isMicrophoneEnabled;
        pintar();
    }

    async function unirseLive({ myId }) {
        if (S.call) {
            if (S.call.scope === 'live') { S.panelAbierto = true; montarUI(); pintar(); return estado(); }
            throw new Error('Ya estás en otra llamada. Sal de ella primero.');
        }
        if (!hayWebRTC || !window.isSecureContext) throw new Error('Tu navegador no permite llamadas seguras. Actualízalo o prueba con Chrome o Safari.');
        montarUI();
        S.myId = myId; S.muted = true; S.sinMic = false; S.roster = [];
        const [pase] = await Promise.all([api().liveToken(), cargarLiveKit()]);
        const LK = window.LivekitClient;
        const room = new LK.Room({
            adaptiveStream: true, dynacast: true,
            audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            publishDefaults: { screenShareEncoding: { maxBitrate: 2500000, maxFramerate: 15 }, screenShareSimulcastLayers: [] },
        });
        const E = LK.RoomEvent;
        room.on(E.ParticipantConnected, (p) => { const m = metaDe(p); if (m.host) toast(`${p.name || 'El anfitrión'} entró a la operativa`); actualizarRosterLive(); });
        room.on(E.ParticipantDisconnected, (p) => { S.pantallasLive.delete(p.identity); if (S.viendo === p.identity) cerrarVisor(); S.hablando.delete(p.identity); actualizarRosterLive(); });
        room.on(E.TrackSubscribed, (track, pub, p) => {
            if (track.kind === 'audio') { const el = track.attach(); el.setAttribute('playsinline', ''); elAudios.appendChild(el); reproducir(el); }
            else if (pub.source === LK.Track.Source.ScreenShare) {
                S.pantallasLive.set(p.identity, new MediaStream([track.mediaStreamTrack]));
                toast(`${p.name || 'El anfitrión'} está compartiendo pantalla`);
                if (!elVisor) abrirVisor(p.identity);                       // en una operativa la pantalla es lo principal: se abre sola
            }
            actualizarRosterLive();
        });
        room.on(E.TrackUnsubscribed, (track, pub, p) => {
            track.detach().forEach((el) => el.remove());
            if (pub.source === LK.Track.Source.ScreenShare) { S.pantallasLive.delete(p.identity); if (S.viendo === p.identity) cerrarVisor(); }
            actualizarRosterLive();
        });
        [E.TrackMuted, E.TrackUnmuted, E.LocalTrackPublished, E.LocalTrackUnpublished, E.ParticipantMetadataChanged, E.TrackPublished, E.TrackUnpublished].forEach((ev) => room.on(ev, actualizarRosterLive));
        room.on(E.ActiveSpeakersChanged, (hablan) => { S.hablando = new Set(hablan.map((p) => p.identity)); pintar(); });
        room.on(E.Reconnecting, () => toast('Reconectando…'));
        room.on(E.Reconnected, () => toast('Reconectado'));
        room.on(E.Disconnected, () => { if (S.live && S.live.room === room) terminarLocal('Se cortó la conexión con la operativa'); });
        try {
            await room.connect(pase.url, pase.token);
            room.startAudio().catch(() => {});
        } catch (e) { try { room.disconnect(); } catch (_) { /* nada */ } throw new Error(e && e.message ? 'No se pudo entrar a la operativa: ' + e.message : 'No se pudo entrar a la operativa.'); }
        S.live = { room, anfitrion: !!pase.is_host };
        S.sono = true; sonar('conectado');
        S.call = { id: 'live', scope: 'live', conversationId: null, label: 'Operativa en vivo', startedAt: Date.now() };
        S.panelAbierto = true;
        S.myId = myId;
        guardarResume();
        if (!tickTimer) tickTimer = setInterval(() => { document.querySelectorAll('#nltCallRoot [data-nc-t]').forEach((el) => { el.textContent = tiempo(); }); }, 600);
        actualizarRosterLive();
        if (pase.is_host) { room.localParticipant.setMicrophoneEnabled(true).then(actualizarRosterLive).catch(() => { toast('Permite el micrófono para hablar.'); }); }
        return estado();
    }

    // Si el navegador no deja sonar el audio todavía (no hubo un toque en esta página), se avisa y suena al primer toque
    let esperandoToque = false;
    function reproducir(el) {
        const p = el.play();
        if (p && p.catch) p.catch((e) => { if (e && e.name === 'NotAllowedError') esperarToque(); });
    }
    function esperarToque() {
        if (esperandoToque) return;
        esperandoToque = true; toast('Toca la pantalla para activar el sonido');
        const f = () => {
            esperandoToque = false; document.removeEventListener('pointerdown', f, true);
            document.querySelectorAll('#nltCallRoot audio, audio').forEach((a) => { if (a.srcObject) a.play().catch(() => {}); });
            if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
        };
        document.addEventListener('pointerdown', f, true);
    }

    function liberarMedios() {
        if (S.mic) { try { S.mic.track.stop(); } catch (_) { /* parado */ } quitarVigia(S.myId); S.mic = null; }
        if (S.share) { try { S.share.track.stop(); } catch (_) { /* parado */ } S.share = null; }
    }

    function terminarLocal(aviso) {
        borrarResume();
        clearTimeout(S.timer); clearTimeout(S.sinRespuesta);
        if (S.call) { const t = tonos(); if (t) t.detener(); sonar('colgar'); }
        S.llamando = false;
        if (S.live) { const room = S.live.room; S.live = null; try { room.disconnect(); } catch (_) { /* ya desconectada */ } S.pantallasLive.clear(); }
        [...S.peers.keys()].forEach(cerrarPeer);
        liberarMedios();
        S.call = null; S.roster = []; S.panelAbierto = false; S.hablando.clear();
        cerrarVisor();
        clearInterval(tickTimer); tickTimer = null;
        if (aviso) toast(aviso);
        pintar();
        avisar();
    }

    function salir() {
        if (!S.call && S.uniendo) { S.cancelarUnion = true; return; }
        const callId = S.call && S.call.id, enSala = !!S.live;
        terminarLocal(enSala ? 'Saliste de la operativa' : 'Saliste de la llamada');
        if (callId && !enSala && api()) api().callSalir(callId).catch(() => {});
    }

    // Al volver a la app (después de bloquear el teléfono o cambiar de app) el sistema puede haber cortado el micrófono: se recupera solo
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState !== 'visible' || !S.call) return;
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
        S.peers.forEach((p) => { if (p.audioEl) p.audioEl.play().catch(() => {}); });
        if (S.mic && S.mic.track.readyState === 'ended') {
            const estabaMudo = S.muted;
            S.mic = null;
            if (await pedirMic()) { S.muted = estabaMudo; S.mic.track.enabled = !estabaMudo; S.peers.forEach((p) => { if (p.audioSender) p.audioSender.replaceTrack(S.mic.track).catch(() => {}); }); }
            pintar();
        }
        sincronizarYa();
    });

    // ---------- «Ir al chat» desde el panel de la llamada ----------
    // Llamada grupal -> chat general; llamada privada (2 o más personas) -> esa conversación. La llamada NO se corta: si la página de Community está a la vista
    // la propia página cambia de pestaña (registrarChat); si no, Community se abre en el marco de siempre, encima de lo que estuvieras haciendo.
    let hookChat = null;
    function registrarChat(fn) { hookChat = fn; return () => { if (hookChat === fn) hookChat = null; }; }
    async function irAlChat() {
        if (!S.call || S.call.scope === 'live') return;
        const sc = S.call.scope, cid = S.call.conversationId;
        S.panelAbierto = false; pintar();
        let enMarcoComunidad = false;
        try { enMarcoComunidad = !!marco && /community\.html$/.test(marco.contentWindow.location.pathname); } catch (_) { /* otro origen */ }
        if ((!marco || enMarcoComunidad) && hookChat) { try { if (await hookChat(sc, cid)) return; } catch (_) { /* se abre la página */ } }
        const url = 'community.html?' + (sc === 'global' ? 'vista=chat' : `vista=mensajes&c=${encodeURIComponent(cid || '')}`);
        if (marco || S.call) abrirMarco(new URL(url, location.href).href); else location.href = url;
    }

    // ---------- seguir en la llamada al RECARGAR la página ----------
    // Al recargar (F5, o la página se actualiza sola) se pierde todo lo que vive en memoria. Por eso, mientras hay llamada se guarda en esta pestaña
    // a cuál y como quien estás; al cargar la página se vuelve a entrar sola, sin avisar a nadie de que «empezó» una llamada. Lo que NO se puede
    // recuperar solo es la pantalla compartida (el navegador exige que vuelvas a pulsar «Compartir»): se avisa. Salir con el botón, o que la llamada
    // termine, borra el guardado.
    const CLAVE_RESUME = 'nlt_call_resume', VIGENCIA_RESUME = 90000;
    function guardarResume(extra) {
        if (!S.call || !S.myId) return;
        try {
            sessionStorage.setItem(CLAVE_RESUME, JSON.stringify({ scope: S.call.scope, conversationId: S.call.conversationId, label: S.call.label, myId: S.myId,
                empezo: S.call.startedAt, muted: !!S.muted, t: Date.now(), ...(extra || {}) }));
        } catch (_) { /* sin almacenamiento: no se podrá retomar tras recargar */ }
    }
    function borrarResume() { try { sessionStorage.removeItem(CLAVE_RESUME); } catch (_) { /* nada */ } }
    function leerResume() {
        try {
            const r = JSON.parse(sessionStorage.getItem(CLAVE_RESUME) || 'null');
            return r && r.scope && r.myId && Date.now() - (r.t || 0) < VIGENCIA_RESUME ? r : null;
        } catch (_) { return null; }
    }
    let retomando = false;
    async function retomarLlamada() {
        const r = leerResume();
        if (!r || S.call || retomando || (window.top !== window.self)) return;
        retomando = true;
        toast('Volviendo a la llamada…');
        // la sesión de la página tarda un momento en estar lista después de recargar: se reintenta unos segundos
        let ultimo = null;
        for (let i = 0; i < 6 && !S.call; i++) {
            try {
                await (r.scope === 'live' ? unirseLive({ myId: r.myId }) : unirse({ scope: r.scope, conversationId: r.conversationId, label: r.label, myId: r.myId, cambiar: true, soloUnirse: true }));
                ultimo = null; break;
            } catch (e) {
                ultimo = e;
                if (e && (e.status === 404 || e.status === 403 || e.status === 409)) break;        // la llamada ya no existe o no se puede entrar: no se insiste
                await new Promise((ok) => setTimeout(ok, 1500 + i * 700));
            }
        }
        retomando = false;
        if (S.call) {
            if (r.empezo) S.call.startedAt = r.empezo;          // el reloj sigue donde iba
            if (r.muted && !S.live) { S.muted = true; if (S.mic) S.mic.track.enabled = false; }
            S.panelAbierto = false;
            guardarResume();
            pintar();
            if (r.compartia) toast('Se recargó la página: vuelve a pulsar «Compartir pantalla».');
        } else {
            borrarResume();
            toast(ultimo && ultimo.message ? 'No se pudo volver a la llamada: ' + ultimo.message : 'La llamada ya terminó.');
        }
    }

    // ---------- seguir en la llamada al cambiar de página ----------
    let marco = null;
    function abrirMarco(url, sinHistorial) {
        if (!marco) {
            marco = document.createElement('iframe');
            marco.id = 'nltCallFrame';
            marco.setAttribute('allow', 'microphone; display-capture; clipboard-write; fullscreen');
            marco.addEventListener('load', () => {
                try {
                    const w = marco.contentWindow;
                    if (w.location.href !== 'about:blank') { history.replaceState(history.state, '', w.location.href); document.title = w.document.title || document.title; }
                } catch (_) { /* otro origen */ }
            });
            document.body.appendChild(marco);
            if (!sinHistorial) { try { history.pushState({ nltMarco: 1 }, '', url); } catch (_) { /* sin historial */ } }
        }
        marco.src = url;
    }
    function cerrarMarco() { if (marco) { marco.remove(); marco = null; } }

    document.addEventListener('click', (e) => {
        if (!S.call || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
        let u; try { u = new URL(a.href, location.href); } catch (_) { return; }
        if (u.origin !== location.origin || !/(\.html|\/)$/.test(u.pathname)) return;
        if (!marco && u.pathname === location.pathname && u.search === location.search) return;     // ancla o la misma página
        e.preventDefault();
        abrirMarco(u.href);
    }, true);

    // Navegaciones hechas por código (location.href = ...): donde el navegador lo permite (Chrome/Edge/Android) también se abren en el marco
    if (window.navigation && typeof window.navigation.addEventListener === 'function') {
        window.navigation.addEventListener('navigate', (e) => {
            if (!S.call || !e.canIntercept || e.hashChange || e.downloadRequest || e.formData || e.navigationType !== 'push') return;
            let u; try { u = new URL(e.destination.url); } catch (_) { return; }
            if (u.origin !== location.origin || !/(\.html|\/)$/.test(u.pathname)) return;
            e.intercept({ handler: async () => { abrirMarco(u.href, true); } });
        });
    }
    window.addEventListener('popstate', () => { if (marco && !(history.state && history.state.nltMarco)) { cerrarMarco(); document.title = document.title; } });
    window.addEventListener('beforeunload', (e) => { if (S.call) { e.preventDefault(); e.returnValue = ''; } });
    // Recargar y cerrar la pestaña se ven igual desde aquí, así que NO se cuelga: se deja guardado (con la hora) y, si la página vuelve en unos segundos, retoma la llamada.
    // Si de verdad se cerró la pestaña, el servidor da a la persona por salida a los pocos segundos sin señales (y la sala en vivo se desconecta ya mismo).
    window.addEventListener('pagehide', (e) => {
        if (!S.call || e.persisted) return;
        guardarResume({ compartia: !!pistaLocalPantalla() });
        if (S.live) { try { S.live.room.disconnect(); } catch (_) { /* nada */ } }
    });
    window.addEventListener('resize', () => {
        if (!elBurbuja || !elBurbuja.style.left) return;
        elBurbuja.style.left = Math.min(parseFloat(elBurbuja.style.left), window.innerWidth - 64) + 'px';
        elBurbuja.style.top = Math.min(parseFloat(elBurbuja.style.top), window.innerHeight - 90) + 'px';
    });

    if (window.top === window.self && leerResume()) {
        const arrancar = () => setTimeout(retomarLlamada, 400);
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar, { once: true }); else arrancar();
    }

    window.NLTCall = {
        unirse, salir, toast, registrarChat, irAlChat,
        alternarMic, alternarPantalla,
        abrirPanel() { S.panelAbierto = true; montarUI(); pintar(); },
        // Abrir una página sin cortar la llamada (la usa el aviso del teléfono al tocarlo)
        abrirUrl(url) {
            let u; try { u = new URL(url, location.href); } catch (_) { return false; }
            if (u.origin !== location.origin) return false;
            if (S.call) { abrirMarco(u.href); return true; }
            location.href = u.href; return true;
        },
        estado,
        alCambiar(fn) { S.oyentes.add(fn); return () => S.oyentes.delete(fn); },
        soportaPantalla, hayWebRTC,
        // Para pruebas y soporte: estado de cada conexión y bytes de audio/pantalla recibidos
        async diagnostico() {
            const salida = [];
            if (S.live) {
                const room = S.live.room;
                for (const p of room.remoteParticipants.values()) {
                    let audio = 0;
                    for (const pub of p.audioTrackPublications.values()) { if (pub.track && pub.track.getRTCStatsReport) { try { (await pub.track.getRTCStatsReport()).forEach((r) => { if (r.type === 'inbound-rtp') audio += r.bytesReceived || 0; }); } catch (_) { /* sin estadísticas */ } } }
                    salida.push({ uid: p.identity, estado: room.state, audio, video: 0, pantalla: S.pantallasLive.has(p.identity) });
                }
                return salida;
            }
            for (const [uid, p] of S.peers) {
                let audio = 0, video = 0;
                try { (await p.pc.getStats()).forEach((r) => { if (r.type === 'inbound-rtp') { if (r.kind === 'audio') audio += r.bytesReceived || 0; else video += r.bytesReceived || 0; } }); } catch (_) { /* sin estadísticas */ }
                salida.push({ uid, estado: p.pc.connectionState, audio, video, pantalla: !!p.pantalla });
            }
            return salida;
        },
    };
})();
