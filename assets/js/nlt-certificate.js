// Render del certificado real de NLT Academy -- una sola fuente visual
// compartida por academy-dashboard.html (modal "Ver certificado") y
// verify.html (verificación pública vía QR). Nunca texto plano: cada
// certificado se genera con el nombre real del estudiante y sus datos
// reales (título, fecha, código), nunca una plantilla estática.
//
// Paleta e identidad -- línea gráfica NLT provista: acento #3B82F6, fondo
// #0D1117, superficie #1F2937, texto secundario #E5E7EB, blanco #FFFFFF.
// Tipografía Poppins (se carga acá porque el resto del sitio usa Inter --
// es exclusiva de este componente, a propósito, para que el certificado se
// sienta como un documento distinto, no una pantalla más de la app).
(function () {
    if (!document.getElementById('nlt-cert-font')) {
        const link = document.createElement('link');
        link.id = 'nlt-cert-font';
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap';
        document.head.appendChild(link);
    }
    if (!document.getElementById('nlt-cert-style')) {
        const style = document.createElement('style');
        style.id = 'nlt-cert-style';
        style.textContent = `
            .nlt-cert-wrap { font-family: 'Poppins', sans-serif; }
            .nlt-cert {
                position: relative;
                width: 100%;
                max-width: 860px;
                aspect-ratio: 1.414 / 1;
                margin: 0 auto;
                background:
                    radial-gradient(circle at 15% 15%, rgba(59,130,246,0.14), transparent 45%),
                    radial-gradient(circle at 85% 85%, rgba(59,130,246,0.10), transparent 45%),
                    linear-gradient(160deg, #0D1117 0%, #0D1117 60%, #1F2937 140%);
                border-radius: 18px;
                overflow: hidden;
                box-shadow: 0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.05);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: space-between;
                padding: clamp(20px, 4vw, 48px) clamp(24px, 5.5vw, 64px);
                color: #E5E7EB;
                box-sizing: border-box;
            }
            .nlt-cert::before, .nlt-cert::after {
                content: ''; position: absolute; width: 34px; height: 34px;
                border: 1.5px solid rgba(59,130,246,0.55);
            }
            .nlt-cert::before { top: 16px; left: 16px; border-right: none; border-bottom: none; }
            .nlt-cert::after { bottom: 16px; right: 16px; border-left: none; border-top: none; }
            .nlt-cert-corner-tr, .nlt-cert-corner-bl {
                position: absolute; width: 34px; height: 34px; border: 1.5px solid rgba(59,130,246,0.55);
            }
            .nlt-cert-corner-tr { top: 16px; right: 16px; border-left: none; border-bottom: none; }
            .nlt-cert-corner-bl { bottom: 16px; left: 16px; border-right: none; border-top: none; }
            .nlt-cert-frame {
                position: absolute; inset: 10px; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; pointer-events: none;
            }
            .nlt-cert-top { text-align: center; z-index: 1; }
            .nlt-cert-brand { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: clamp(10px, 2vw, 18px); }
            .nlt-cert-brand img { width: clamp(24px, 3.2vw, 34px); height: clamp(24px, 3.2vw, 34px); }
            .nlt-cert-brand span { font-weight: 600; font-size: clamp(13px, 1.6vw, 17px); letter-spacing: 0.14em; color: #fff; text-transform: uppercase; }
            .nlt-cert-eyebrow { font-size: clamp(9px, 1vw, 11px); font-weight: 600; letter-spacing: 0.32em; text-transform: uppercase; color: #3B82F6; margin-bottom: clamp(14px, 3vw, 26px); }
            .nlt-cert-lede { font-size: clamp(10px, 1.15vw, 13px); color: #9CA6B4; margin-bottom: clamp(6px, 1.2vw, 10px); }
            .nlt-cert-name { font-weight: 700; font-size: clamp(24px, 4.4vw, 44px); color: #fff; letter-spacing: 0.01em; margin: 0 0 clamp(10px, 2vw, 16px); line-height: 1.1; }
            .nlt-cert-sub { font-size: clamp(10px, 1.15vw, 13px); color: #9CA6B4; margin-bottom: clamp(4px, 1vw, 8px); }
            .nlt-cert-title { font-weight: 700; font-size: clamp(16px, 2.4vw, 24px); color: #3B82F6; margin: 0 0 clamp(8px, 1.6vw, 14px); }
            .nlt-cert-desc { font-size: clamp(10px, 1.05vw, 12.5px); color: #9CA6B4; max-width: 520px; margin: 0 auto; line-height: 1.5; }
            .nlt-cert-bottom { width: 100%; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; z-index: 1; }
            .nlt-cert-meta { text-align: left; }
            .nlt-cert-meta p { margin: 0 0 4px; font-size: clamp(8.5px, 0.95vw, 10.5px); color: #6B7280; letter-spacing: 0.06em; text-transform: uppercase; }
            .nlt-cert-meta .nlt-cert-meta-val { color: #E5E7EB; font-size: clamp(9.5px, 1.05vw, 11.5px); font-weight: 500; text-transform: none; letter-spacing: 0; font-family: monospace; }
            .nlt-cert-tagline { font-size: clamp(8.5px, 0.95vw, 10.5px); letter-spacing: 0.18em; text-transform: uppercase; color: #4B5563; }
            .nlt-cert-qr-box { text-align: center; }
            .nlt-cert-qr-box img { width: clamp(58px, 8vw, 84px); height: clamp(58px, 8vw, 84px); border-radius: 8px; background: #fff; padding: 4px; display: block; }
            .nlt-cert-qr-box p { margin: 6px 0 0; font-size: clamp(7.5px, 0.85vw, 9px); color: #6B7280; }
            .nlt-cert-badge {
                display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px;
                background: rgba(59,130,246,0.1); border: 1px solid rgba(59,130,246,0.25); color: #93C5FD;
                font-size: clamp(8.5px, 0.9vw, 10px); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
                margin-top: clamp(8px, 1.6vw, 14px);
            }
            @media print {
                body * { visibility: hidden; }
                .nlt-cert-wrap, .nlt-cert-wrap * { visibility: visible; }
                .nlt-cert-wrap { position: fixed; inset: 0; margin: 0; padding: 24px; }
                .nlt-cert { box-shadow: none; }
            }
        `;
        document.head.appendChild(style);
    }

    const TIER_LABEL = { fundamentals: 'Nivel 1 · Fundamentos', technical_analyst: 'Nivel 2 · Análisis Técnico', specialist: 'Nivel 3 · Programa Completo' };

    function render(container, data) {
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=${encodeURIComponent(data.verification_url)}`;
        const fecha = data.issued_at ? new Date(data.issued_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }) : '-';
        container.innerHTML = `
            <div class="nlt-cert-wrap">
                <div class="nlt-cert" id="nltCertNode">
                    <div class="nlt-cert-corner-tr"></div>
                    <div class="nlt-cert-corner-bl"></div>
                    <div class="nlt-cert-frame"></div>
                    <div class="nlt-cert-top">
                        <div class="nlt-cert-brand">
                            <img src="assets/img/nlt-mark.svg" alt="NLT">
                            <span>NLT Academy</span>
                        </div>
                        <p class="nlt-cert-eyebrow">Certificate of Completion</p>
                    </div>
                    <div style="text-align:center; z-index:1;">
                        <p class="nlt-cert-lede">Se certifica que</p>
                        <h1 class="nlt-cert-name">${_esc(data.student_name)}</h1>
                        <p class="nlt-cert-sub">completó exitosamente</p>
                        <p class="nlt-cert-title">${_esc(data.title)}</p>
                        ${data.description ? `<p class="nlt-cert-desc">${_esc(data.description)}</p>` : ''}
                        ${TIER_LABEL[data.slug] ? `<div class="nlt-cert-badge">${TIER_LABEL[data.slug]}</div>` : ''}
                    </div>
                    <div class="nlt-cert-bottom">
                        <div class="nlt-cert-meta">
                            <p>Emitido</p>
                            <p class="nlt-cert-meta-val" style="margin-bottom:10px;">${fecha}</p>
                            <p>Certificate ID</p>
                            <p class="nlt-cert-meta-val">${_esc(data.certificate_code)}</p>
                        </div>
                        <p class="nlt-cert-tagline">Elevate your standards.</p>
                        <div class="nlt-cert-qr-box">
                            <img src="${qrUrl}" alt="QR de verificación">
                            <p>Verificar autenticidad</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    window.NLT_CERT = { render };
})();
