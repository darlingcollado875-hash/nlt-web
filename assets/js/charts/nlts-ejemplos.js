/* NLT Script -- ejemplos listos para copiar y cambiar. */
(function () {
    const EJEMPLOS = [
        { nombre: 'Media móvil simple', codigo: `//@version=5
indicator("Mi media móvil", overlay=true)
largo = input.int(20, "Período", minval=1)
media = ta.sma(close, largo)
plot(media, "Media", color=color.blue, linewidth=2)
` },
        { nombre: 'Cruce de medias', codigo: `//@version=5
indicator("Cruce de medias", overlay=true)
rapida = ta.ema(close, input.int(9, "Rápida"))
lenta = ta.ema(close, input.int(21, "Lenta"))
plot(rapida, "Rápida", color=color.orange)
plot(lenta, "Lenta", color=color.blue)
arriba = ta.crossover(rapida, lenta)
abajo = ta.crossunder(rapida, lenta)
plotshape(arriba, "Compra", style=shape.triangleup, location=location.belowbar, color=color.green, text="C")
plotshape(abajo, "Venta", style=shape.triangledown, location=location.abovebar, color=color.red, text="V")
alertcondition(arriba, "Cruce al alza", "La media rápida cruzó arriba")
` },
        { nombre: 'RSI con zonas', codigo: `//@version=5
indicator("RSI con zonas")
largo = input.int(14, "Período")
valor = ta.rsi(close, largo)
plot(valor, "RSI", color=color.purple, linewidth=2)
hline(70, "Sobrecompra", color=color.red)
hline(30, "Sobreventa", color=color.green)
bgcolor(valor > 70 ? color.new(color.red, 85) : valor < 30 ? color.new(color.green, 85) : na)
` },
        { nombre: 'Bandas de Bollinger', codigo: `//@version=5
indicator("Bandas", overlay=true)
[medio, alta, baja] = ta.bb(close, input.int(20, "Período"), input.float(2.0, "Desviaciones"))
plot(medio, "Media", color=color.gray)
plot(alta, "Superior", color=color.red)
plot(baja, "Inferior", color=color.green)
` },
        { nombre: 'Histograma de MACD', codigo: `//@version=5
indicator("MACD propio")
[linea, senal, hist] = ta.macd(close, 12, 26, 9)
plot(hist, "Histograma", style=plot.style_histogram, color=hist >= 0 ? color.green : color.red)
plot(linea, "MACD", color=color.blue)
plot(senal, "Señal", color=color.orange)
hline(0, "Cero", color=color.gray)
` },
        { nombre: 'Máximos y mínimos de N velas', codigo: `//@version=5
indicator("Canal de precio", overlay=true)
n = input.int(20, "Velas")
techo = ta.highest(high, n)
piso = ta.lowest(low, n)
plot(techo, "Techo", color=color.red)
plot(piso, "Piso", color=color.green)
rompe = close > techo[1]
plotshape(rompe, "Ruptura", style=shape.circle, location=location.belowbar, color=color.lime)
` },
    ];
    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.nltsEjemplos = EJEMPLOS;
})();
