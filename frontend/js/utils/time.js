/* utils/time.js
 * Herramientas para generar series vacías y fusionarlas.

 * Rellena el rango [startTs, endTs] con puntos «vacíos» (y =null) para mantener
 * el eje X fijo, **sin perder** los timestamps originales que SÍ tienen lectura.
 *
 *  • Los puntos reales se conservan tal cual llegaron.
 *  • Para cada intervalo que no contenga lectura, se añade un placeholder.
 *  • El resultado queda ordenado por X ascendente.
 */
export function mergeWithEmptyTimestamps(
  points,
  startTs,
  endTs,
  intervalMs = 600_000 // 10 min por defecto
) {
  if (!points?.length) {
    // no hay datos: devolvemos solo placeholders
    const arr = [];
    for (let t = startTs; t <= endTs; t += intervalMs)
      arr.push({ x: t, y: null });
    return arr;
  }

  // 1.  Índice por bucket (floor) para saber dónde ya hay datos
  const bucketOf = (ms) => Math.floor(ms / intervalMs);
  const buckets = new Set(points.map((p) => bucketOf(p.x)));

  // 2.  Copiamos los puntos reales
  const merged = [...points];

  // 3.  Insertamos placeholders donde falten lecturas
  for (let t = startTs; t <= endTs; t += intervalMs) {
    if (!buckets.has(bucketOf(t))) merged.push({ x: t, y: null });
  }

  // 4.  Orden cronológico ascendente (Chart.js lo exige)
  merged.sort((a, b) => a.x - b.x);
  return merged;
}