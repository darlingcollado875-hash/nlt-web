/* NLT Script -- ejecuta el script del usuario en un Web Worker aparte (sin acceso a la página ni a tu sesión).
 * La página lo detiene (terminate) si tarda demasiado. El intérprete no usa eval ni red. */
importScripts('nlts.js' + (self.location.search || ''));
self.onmessage = (e) => {
    const { id, codigo, velas, inputs, ast } = e.data || {};
    let r;
    try { r = self.NLTS.ejecutar(String(codigo || ''), velas, ast ? { inputs: inputs || {}, ast } : { inputs: inputs || {} }); }
    catch (x) { r = { ok: false, n: 0, errores: [{ linea: null, mensaje: String((x && x.message) || x) }], meta: {}, inputs: [], plots: [], hlines: [], bgcolors: [], shapes: [], alerts: [] }; }
    self.postMessage({ id, r });
};
