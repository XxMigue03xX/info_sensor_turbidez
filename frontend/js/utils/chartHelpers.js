export function needsMoreData(chart, visMin, visMax) {
  const d = chart.data.datasets[0].data;
  if (!d.length) return true;
  const dataMin = d[0].x;
  const dataMax = d[d.length - 1].x;
  return visMin < dataMin || visMax > dataMax;
}

/**
 * Devuelve el máximo de puntos que podemos dibujar sin que desaparezcan los
 * segmentos, adaptado al ancho visible y al device-pixel-ratio.
 *
 * Fórmula:  anchoCSS(px)  ×  factor  /  dpr
 *   – factor ≈ 1.3 pts/px mantiene continuidad y rendimiento
 *   – dpr corrige pantallas Retina (2×, 3×…)
 *   – min y max son topes de seguridad
 */
export function getMaxHistPoints({
  factor = 1.0,   // ← densidad 1 pto / px (antes ~1,3)
  min    = 200,   // ← suficiente para ≥ 8 h en móvil
  max    = 900,   // ← top absoluto (antes 1600)
  canvasId = "tempCanvas",
} = {}) {
  const el   = document.getElementById(canvasId);
  const wCss = el?.clientWidth || window.innerWidth || 1024;      // ancho lógico
  const dpr  = window.devicePixelRatio || 1;

  const calc = Math.floor((wCss * factor) / dpr);
  return Math.min(max, Math.max(min, calc));
}

export function breakLargeGaps(arr, gapMs) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    if (i > 0 && arr[i].x - arr[i - 1].x > gapMs * 1.01) {
      // inserta un punto nulo para que Chart.js abra el trazo
      out.push({ x: arr[i - 1].x + gapMs, y: null });
    }
    out.push(arr[i]);
  }
  return out;
}