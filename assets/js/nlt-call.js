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

    const SYNC_RAPIDO = 900, SYNC_NORMAL = 2500, ERRORES_MAX = 8;
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
    };

    // ---------- utilidades ----------
    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const iniciales = (n) => (String(n || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('') || '?').toUpperCase();
    const api = () => window.NLT_API;
    const avisar = () => S.oyentes.forEach((f) => { try { f(estado()); } catch (_) { /* un oyente roto no afecta a los demás */ } });

    function estado() {
        return {
            activa: !!S.call, callId: S.call ? S.call.id : null, scope: S.call ? S.call.scope : null, conversationId: S.call ? S.call.conversationId : null,
            muted: S.muted, compartiendo: !!S.share, participantes: S.roster.slice(), soportaPantalla, sinMic: S.sinMic,
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
        .nc-btn .nc-tip { position: absolute; left: 50%; top: 100%; transform: translateX(-50%); font-size: 10px; color: #94a3b8; white-space: nowrap; margin-top: 3px; }
        .nc-toast { position: fixed; left: 50%; top: calc(env(safe-area-inset-top, 0px) + 12px); transform: translateX(-50%); background: rgba(12,16,26,.96); border: 1px solid rgba(255,255,255,.12);
            color: #f3f4f6; padding: 9px 16px; border-radius: 999px; font-size: 13px; font-weight: 600; box-shadow: 0 10px 30px rgba(0,0,0,.5); max-width: 90vw; text-align: center; animation: ncToast 3.2s ease forwards; pointer-events: none; }
        @keyframes ncToast { 0% { opacity: 0; transform: translate(-50%, -8px); } 10%, 85% { opacity: 1; transform: translate(-50%, 0); } 100% { opacity: 0; } }
        .nc-visor { position: fixed; inset: 0; pointer-events: auto; background: #05070b; display: flex; flex-direction: column; }
        .nc-visor video { flex: 1; min-height: 0; width: 100%; object-fit: contain; background: #000; }
        .nc-visor .nc-barra { display: flex; align-items: center; gap: 10px; padding: calc(env(safe-area-inset-top, 0px) + 10px) 12px 10px; background: rgba(12,16,26,.95); }
        .nc-visor .nc-barra b { flex: 1; font-size: 14px; }
        .nc-visor .nc-min { flex: none; }
        #nltCallFrame { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; z-index: 2147482000; background: #080A0F; }
        @media (prefers-reduced-motion: reduce) { .nc-burbuja::after, .nc-toast { animation: none; } .nc-toast { opacity: 1; } }`;
        document.head.appendChild(st);
    }

    // ---------- interfaz ----------
    let raiz = null, elBurbuja = null, elPanel = null, elVisor = null, elAudios = null, tickTimer = null;

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
        if (!activa) { if (elVisor) cerrarVisor(); return; }

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
                    <div class="nc-nom">${esc(p.display_name)}${yo ? ' <i>(tú)</i>' : ''}</div>
                    <div class="nc-est">${p.sharing ? `<span title="Compartiendo pantalla">${IC.screen}</span>` : ''}${p.muted ? `<span title="Silenciado">${IC.micOff}</span>` : ''}
                    ${comparte ? `<button class="nc-ver" data-nc="ver" data-uid="${esc(p.user_id)}">Ver</button>` : ''}</div></div>`;
            }).join('');
            const titulo = S.call.scope === 'global' ? 'Llamada grupal' : `Llamada con ${esc(S.call.label || 'tu contacto')}`;
            const htmlPanel = `
                <div class="nc-cab"><div class="nc-tit"><b>${titulo}</b><small><span data-nc-t>§T§</span> · ${S.roster.length} ${S.roster.length === 1 ? 'persona' : 'personas'}</small></div>
                    <button class="nc-min" data-nc="min" aria-label="Minimizar">${IC.down}</button></div>
                <div class="nc-lista">${filas || '<div class="nc-fila"><div class="nc-nom"><i>Conectando…</i></div></div>'}</div>
                <div class="nc-ctrl">
                    <button class="nc-btn ${S.muted ? 'nc-on' : ''}" data-nc="mic" aria-label="${S.muted ? 'Activar micrófono' : 'Silenciar micrófono'}">${S.muted ? IC.micOff : IC.mic}</button>
                    <button class="nc-btn ${S.share ? 'nc-on' : ''}" data-nc="pantalla" aria-label="${S.share ? 'Dejar de compartir pantalla' : 'Compartir pantalla'}" ${soportaPantalla ? '' : 'hidden'}>${IC.screen}</button>
                    <button class="nc-btn nc-rojo" data-nc="salir" aria-label="Salir de la llamada">${IC.hangup}<span>Salir</span></button>
                </div>`;
            // solo se vuelve a dibujar si algo cambió (si no, un toque a mitad de un redibujo se perdería)
            if (elPanel._html !== htmlPanel) { elPanel._html = htmlPanel; const lista = elPanel.querySelector('.nc-lista'); const top = lista ? lista.scrollTop : 0; elPanel.innerHTML = htmlPanel.replace('§T§', tiempo()); const l2 = elPanel.querySelector('.nc-lista'); if (l2) l2.scrollTop = top; }
        }
        avisar();
    }

    function toast(texto) {
        montarUI();
        const t = document.createElement('div');
        t.className = 'nc-toast'; t.textContent = texto;
        raiz.appendChild(t);
        setTimeout(() => t.remove(), 3300);
    }

    // ---------- ver la pantalla de otra persona ----------
    function abrirVisor(uid) {
        const peer = S.peers.get(uid);
        const p = S.roster.find((x) => x.user_id === uid);
        if (!peer || !peer.pantalla) { toast('Todavía no llega la pantalla, espera un momento…'); return; }
        cerrarVisor();
        S.viendo = uid;
        elVisor = document.createElement('div');
        elVisor.className = 'nc-visor';
        elVisor.innerHTML = `<div class="nc-barra"><b>Pantalla de ${esc(p ? p.display_name : '')}</b><button class="nc-min" data-v="full" aria-label="Pantalla completa">${IC.full}</button><button class="nc-min" data-v="x" aria-label="Cerrar">${IC.close}</button></div><video autoplay playsinline muted></video>`;
        raiz.appendChild(elVisor);
        const v = elVisor.querySelector('video');
        v.srcObject = peer.pantalla; v.play().catch(() => {});
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
        if (S.share) { detenerPantalla(); return; }
        if (!soportaPantalla) { toast('Compartir pantalla funciona desde el computador (Chrome, Edge, Firefox o Safari de escritorio).'); return; }
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 20 }, width: { max: 1920 } }, audio: false });
            const track = stream.getVideoTracks()[0];
            S.share = { stream, track };
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
    function enviarSenal(uid, tipo, payload) {
        const callId = S.call && S.call.id;
        if (!callId) return;
        S.cola = S.cola.then(() => api().callSenal(callId, { to_user_id: uid, kind: tipo, payload }).catch(() => { /* la otra persona pudo salir */ }));
    }

    async function ponerLocal(pc, tipo) {
        try { await pc.setLocalDescription(); }
        catch (_) { await pc.setLocalDescription(await (tipo === 'offer' ? pc.createOffer() : pc.createAnswer())); }
    }

    function crearPeer(uid) {
        const pc = new RTCPeerConnection({ iceServers: S.ice });
        const peer = { uid, pc, polite: S.myId < uid, haciendoOferta: false, ignorarOferta: false, pantalla: null, pantallaSender: null, audioEl: null, ausencias: 0, cola: Promise.resolve(), cerrado: false };
        S.peers.set(uid, peer);
        // siempre hay un canal de audio (aunque no tengas micrófono todavía), así la conexión se arma igual
        const tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
        peer.audioSender = tr.sender;
        if (S.mic) tr.sender.replaceTrack(S.mic.track).catch(() => {});
        if (S.share) anadirPantalla(peer);

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
                peer.audioEl.play().catch(() => {});
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
            if (pc.connectionState === 'failed') { try { pc.restartIce(); } catch (_) { /* sin reinicio */ } }
            if (pc.connectionState === 'closed' || peer.cerrado) return;
            if (pc.connectionState === 'failed') setTimeout(() => { if (!peer.cerrado && pc.connectionState === 'failed') { cerrarPeer(uid); } }, 12000);
        };
        return peer;
    }

    function cerrarPeer(uid) {
        const peer = S.peers.get(uid);
        if (!peer) return;
        peer.cerrado = true;
        try { peer.pc.close(); } catch (_) { /* ya cerrada */ }
        if (peer.audioEl) { peer.audioEl.srcObject = null; peer.audioEl.remove(); }
        quitarVigia(uid);
        if (S.viendo === uid) cerrarVisor();
        S.peers.delete(uid);
    }

    // Señal entrante ("negociación perfecta": las dos partes pueden ofrecer a la vez y se resuelve sin quedarse trabadas).
    function recibirSenal(de, tipo, payload) {
        let peer = S.peers.get(de) || crearPeer(de);
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
                        await ponerLocal(pc, 'answer');
                        enviarSenal(de, 'answer', { description: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription });
                    }
                } else if (tipo === 'ice') {
                    try { await pc.addIceCandidate(payload); } catch (e) { if (!peer.ignorarOferta) throw e; }
                }
            } catch (_) { /* una señal rota no debe tumbar la llamada: el estado de la conexión lo dirá */ }
        });
    }

    // ---------- bucle con el servidor ----------
    let syncPendiente = false;
    function sincronizarYa() { if (S.call && !syncPendiente) { clearTimeout(S.timer); bucle(); } }

    function intervalo() {
        for (const p of S.peers.values()) { const c = p.pc.connectionState; if (c !== 'connected') return SYNC_RAPIDO; }
        return S.roster.length > 1 ? SYNC_NORMAL : SYNC_NORMAL + 500;
    }

    function aplicarRoster(lista) {
        const antes = new Set(S.roster.map((p) => p.user_id));
        const ahora = new Set(lista.map((p) => p.user_id));
        lista.forEach((p) => { if (p.user_id !== S.myId && !antes.has(p.user_id) && S.roster.length) toast(`${p.display_name} se unió a la llamada`); });
        S.roster.forEach((p) => { if (p.user_id !== S.myId && !ahora.has(p.user_id)) toast(`${p.display_name} salió de la llamada`); });
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
        if (!S.call) return;
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
    async function unirse({ scope, conversationId, label, myId }) {
        if (!hayWebRTC) throw new Error('Tu navegador no permite llamadas. Actualízalo o prueba con Chrome o Safari.');
        if (!window.isSecureContext) throw new Error('Las llamadas necesitan una conexión segura (https).');
        if (S.call) {
            const igual = S.call.scope === scope && (scope === 'global' || S.call.conversationId === conversationId);
            if (igual) { S.panelAbierto = true; montarUI(); pintar(); return estado(); }
            throw new Error('Ya estás en otra llamada. Sal de ella primero.');
        }
        montarUI();
        S.myId = myId;
        S.muted = false; S.sinMic = false; S.seq = 0; S.errores = 0; S.roster = [];
        await pedirMic();                                              // dentro del toque del usuario: así el navegador deja sonar el audio
        let r;
        try { r = await api().callUnirse(scope, scope === 'dm' ? conversationId : null); }
        catch (e) { liberarMedios(); throw e; }
        S.call = { id: r.call_id, scope, conversationId: conversationId || null, label: label || '', startedAt: Date.now() };
        S.ice = r.ice_servers || [];
        S.panelAbierto = true;
        S.roster = (r.participants || []);
        S.roster.forEach((p) => { if (p.user_id !== S.myId) crearPeer(p.user_id); });
        if (!tickTimer) tickTimer = setInterval(() => { document.querySelectorAll('#nltCallRoot [data-nc-t]').forEach((el) => { el.textContent = tiempo(); }); medirVoz(); }, 600);
        pintar();
        bucle();
        return estado();
    }

    function liberarMedios() {
        if (S.mic) { try { S.mic.track.stop(); } catch (_) { /* parado */ } quitarVigia(S.myId); S.mic = null; }
        if (S.share) { try { S.share.track.stop(); } catch (_) { /* parado */ } S.share = null; }
    }

    function terminarLocal(aviso) {
        clearTimeout(S.timer);
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
        const callId = S.call && S.call.id;
        terminarLocal('Saliste de la llamada');
        if (callId && api()) api().callSalir(callId).catch(() => {});
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
    window.addEventListener('pagehide', (e) => { if (S.call && api() && !e.persisted) { try { api().callSalir(S.call.id); } catch (_) { /* el servidor lo da por salido a los 30 s */ } } });
    window.addEventListener('resize', () => {
        if (!elBurbuja || !elBurbuja.style.left) return;
        elBurbuja.style.left = Math.min(parseFloat(elBurbuja.style.left), window.innerWidth - 64) + 'px';
        elBurbuja.style.top = Math.min(parseFloat(elBurbuja.style.top), window.innerHeight - 90) + 'px';
    });

    window.NLTCall = {
        unirse, salir, toast,
        alternarMic, alternarPantalla,
        abrirPanel() { S.panelAbierto = true; montarUI(); pintar(); },
        estado,
        alCambiar(fn) { S.oyentes.add(fn); return () => S.oyentes.delete(fn); },
        soportaPantalla, hayWebRTC,
        // Para pruebas y soporte: estado de cada conexión y bytes de audio/pantalla recibidos
        async diagnostico() {
            const salida = [];
            for (const [uid, p] of S.peers) {
                let audio = 0, video = 0;
                try { (await p.pc.getStats()).forEach((r) => { if (r.type === 'inbound-rtp') { if (r.kind === 'audio') audio += r.bytesReceived || 0; else video += r.bytesReceived || 0; } }); } catch (_) { /* sin estadísticas */ }
                salida.push({ uid, estado: p.pc.connectionState, audio, video, pantalla: !!p.pantalla });
            }
            return salida;
        },
    };
})();
