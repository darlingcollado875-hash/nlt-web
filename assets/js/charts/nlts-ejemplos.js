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
        { nombre: 'Tendencia en varias temporalidades', codigo: `//@version=5
indicator("Tendencia MTF", overlay=true)

// Datos de cada temporalidad: se calculan allá y se traen a este gráfico
f_datos() =>
    e10 = ta.ema(close, 10)
    e55 = ta.ema(close, 55)
    e200 = ta.ema(close, 200)
    [e10, e55, e200, close]

[a10, a55, a200, ac] = request.security(syminfo.tickerid, "5", f_datos())
[b10, b55, b200, bc] = request.security(syminfo.tickerid, "15", f_datos())
[c10, c55, c200, cc] = request.security(syminfo.tickerid, "60", f_datos())

f_tendencia(float precio, float e10, float e55, float e200) =>
    t = "Neutral"
    if precio > e10 and e10 > e55 and e55 > e200
        t := "Alcista"
    else if precio < e10 and e10 < e55 and e55 < e200
        t := "Bajista"
    t

f_color(string t) =>
    switch t
        "Alcista" => color.new(color.green, 30)
        "Bajista" => color.new(color.red, 30)
        => color.new(color.gray, 40)

t5 = f_tendencia(ac, a10, a55, a200)
t15 = f_tendencia(bc, b10, b55, b200)
t60 = f_tendencia(cc, c10, c55, c200)

var table tabla = table.new(position.top_left, 2, 4, bgcolor = color.new(color.black, 30))
if barstate.islast
    tfs = array.from("5m", "15m", "1H")
    ts = array.from(t5, t15, t60)
    table.cell(tabla, 0, 0, "TF", text_color = color.white)
    table.cell(tabla, 1, 0, "Tendencia", text_color = color.white)
    for i = 0 to 2
        table.cell(tabla, 0, i + 1, array.get(tfs, i), text_color = color.white)
        table.cell(tabla, 1, i + 1, array.get(ts, i), text_color = color.white, bgcolor = f_color(array.get(ts, i)))

plot(b55, "EMA 55 (15m)", color = color.orange, linewidth = 2)
` },
    ];
    window.NLTCharts = window.NLTCharts || {};
    window.NLTCharts.nltsEjemplos = EJEMPLOS;
})();
