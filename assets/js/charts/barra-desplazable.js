/* Barra superior del gráfico (símbolo, temporalidad, indicadores, watchlist...) desplazable en PC.
 * Con el ancho de una pantalla normal no caben todas las opciones y el scroll estaba oculto: no había forma de llegar a las
 * últimas. Ahora: la rueda del mouse la desplaza, se arrastra con el mouse, y aparecen flechas ‹ › cuando hay más opciones. */
(function () {
    'use strict';
    const barra = document.getElementById('chToolbar');
    if (!barra || barra.dataset.desplazable) return;
    barra.dataset.desplazable = '1';

    // Envoltorio para poder poner flechas encima sin tocar lo que dibuja ui.js dentro de la barra.
    const caja = document.createElement('div');
    caja.className = 'ch-tbwrap';
    barra.parentNode.insertBefore(caja, barra);
    caja.appendChild(barra);
    const flecha = (lado) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = `ch-tbflecha ${lado}`; b.hidden = true;
        b.setAttribute('aria-label', lado === 'izq' ? 'Ver opciones anteriores' : 'Ver más opciones');
        b.innerHTML = `<i class="ph ph-caret-${lado === 'izq' ? 'left' : 'right'}"></i>`;
        b.addEventListener('click', () => barra.scrollBy({ left: (lado === 'izq' ? -1 : 1) * Math.max(220, barra.clientWidth * 0.6), behavior: 'smooth' }));
        caja.appendChild(b);
        return b;
    };
    const izq = flecha('izq'), der = flecha('der');
    function actualizar() {
        const max = barra.scrollWidth - barra.clientWidth;
        izq.hidden = barra.scrollLeft < 8;
        der.hidden = max < 8 || barra.scrollLeft > max - 8;
    }
    barra.addEventListener('scroll', actualizar, { passive: true });
    window.addEventListener('resize', actualizar);
    if (window.ResizeObserver) new ResizeObserver(actualizar).observe(barra);
    new MutationObserver(actualizar).observe(barra, { childList: true, subtree: true });

    // Rueda vertical -> desplazamiento horizontal (el trackpad ya manda deltaX: se deja tal cual).
    barra.addEventListener('wheel', (e) => {
        if (barra.scrollWidth <= barra.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        e.preventDefault();
        barra.scrollLeft += e.deltaY;
    }, { passive: false });

    // Arrastrar con el mouse (sin romper los clics: solo cuenta si se movió más de 5 px).
    let x0 = null, s0 = 0, arrastro = false;
    barra.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse' || e.button !== 0) return; x0 = e.clientX; s0 = barra.scrollLeft; arrastro = false; });
    window.addEventListener('pointermove', (e) => {
        if (x0 === null) return;
        const d = e.clientX - x0;
        if (!arrastro && Math.abs(d) > 5) { arrastro = true; barra.classList.add('arrastrando'); }
        if (arrastro) barra.scrollLeft = s0 - d;
    });
    window.addEventListener('pointerup', () => { x0 = null; barra.classList.remove('arrastrando'); });
    barra.addEventListener('click', (e) => { if (arrastro) { e.stopPropagation(); e.preventDefault(); arrastro = false; } }, true);
    actualizar();
})();
