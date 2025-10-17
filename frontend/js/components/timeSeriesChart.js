/* timeSeriesChart – envoltorio minimal para Chart.js 3/4  */
/* Requiere: chart.js, chartjs-plugin-zoom, chartjs-adapter-luxon           */

// ── Registro explícito del plugin de zoom ──────────────────────────────
try {
  // CDN global: la librería expone ChartZoom o chartjsPluginZoom
  const zoomPlugin = window.ChartZoom || window.chartjsPluginZoom;
  if (zoomPlugin && !Chart.registry.plugins.get(zoomPlugin.id)) {
    Chart.register(zoomPlugin);
  }
} catch (e) {
  console.warn("chartjs-plugin-zoom no encontrado: el zoom estará deshabilitado");
}

/* ── Luxon en español ───────────────────── */
luxon.Settings.defaultLocale = "es";

/* --- Configuración global ---------- */
const MIN_RANGE_MS = 10 * 60 * 1000; // 10 min — evita que el zoom deje la gráfica vacía
const SPAN_GAP_MS    = 60 * 60 * 1000;       // 1 hora → puente máximo

/* ─── Plugin: DayBackground ───────────────────────────────────── */
const dayBackgroundPlugin = {
  id: "dayBackground",
  beforeDraw(chart, _args, opts) {
    if (!opts.enabled) return;

    const {
      ctx,
      chartArea,
      scales: { x },
    } = chart;
    const min = x.getUserBounds().min;
    const max = x.getUserBounds().max;

    // empieza en 00:00 del primer día visible
    let cur = luxon.DateTime.fromMillis(min).startOf("day");
    const end = luxon.DateTime.fromMillis(max).endOf("day");

    let toggle = false; // alterna colores

    ctx.save();
    ctx.globalAlpha = opts.opacity ?? 0.06;

    while (cur < end) {
      const next = cur.plus({ days: 1 });
      const xStart = x.getPixelForValue(cur.toMillis());
      const xEnd = x.getPixelForValue(next.toMillis());

      ctx.fillStyle = toggle
        ? opts.colorB ?? "#ced4da" // gris medio
        : opts.colorA ?? "#f8f9fa"; // gris muy claro
      ctx.fillRect(
        xStart,
        chartArea.top,
        xEnd - xStart,
        chartArea.bottom - chartArea.top
      );

      toggle = !toggle;
      cur = next;
    }
    ctx.restore();
  },
};

/* Registrar (una sola vez) si aún no existe */
if (!Chart.registry.plugins.get("dayBackground"))
  Chart.register(dayBackgroundPlugin);

/* ── Plugin: AdaptiveTimeUnit ──────────────────────────
   Cambia automáticamente de “hour” a “minute” cuando
   el rango visible en X es ≤ 1 hora.               */
const adaptiveTimeUnitPlugin = {
  id: "adaptiveTimeUnit",
  beforeUpdate(chart) {
    const x = chart.scales.x;
    if (!x) return;

    const optX = chart.options.scales.x;      // ← NUEVO
    /* Usa primero min/max del *options* (pueden haber cambiado justo antes)
       y cae al valor de la escala si aún no se tocaron                     */
    const min = optX.min ?? x.min;
    const max = optX.max ?? x.max;
    const span = max - min;

    const timeOpt = optX.time;               // la misma referencia

    /* ― Elección de unidad y paso ― */
    let unit, step;
    if (span <= 60 * 60 * 1000) {
      // ≤ 1 h
      unit = "minute";
      step = 5; // 5 min
    } else if (span <= 2 * 24 * 60 * 60 * 1000) {
      // ≤ 2 d
      unit = "hour";
      step = 1;
    } else if (span <= 90 * 24 * 60 * 60 * 1000) {
      // ≤ 3 m
      unit = "day";
      step = 1;
    } else if (span <= 2 * 365 * 24 * 60 * 60 * 1000) {
      // ≤ 2 a
      unit = "month";
      step = 1;
    } else {
      unit = "year";
      step = 1;
    }

    if (timeOpt.unit !== unit || timeOpt.stepSize !== step) {
      timeOpt.unit = unit;
      timeOpt.stepSize = step;
    }
  },
};

/* Registrar (una sola vez) si aún no existe */
if (!Chart.registry.plugins.get("adaptiveTimeUnit"))
  Chart.register(adaptiveTimeUnitPlugin);

export class timeSeriesChart {
  constructor(
    canvas,
    {
      label,
      color,
      thresholds = null, // { tMin, tMax, hMin, hMax } según el gráfico
      maxPoints = Infinity, // solo se aplica en tiempo real
      highlightDays = false, // <— NUEVO
    } = {}
  ) {
    this._canvas = canvas;
    this._maxPoints = maxPoints;
    this._thresholds = thresholds;

    const ctx = canvas.getContext("2d");
    this._chart = new Chart(ctx, {
      type: "line",
      data: { datasets: [this._makeMainDataset(label, color)] },
      options: this._baseOptions(label, highlightDays),
    });

    if (thresholds) this._injectThresholdLines(thresholds);
  }

  /* ---------- API pública ---------- */

  /* --- Ventana X fija + límites de zoom --- */
  setWindow(min, max) {
    const o = this._chart.options;
    o.scales.x.min = min;
    o.scales.x.max = max;

    /* solo movemos los topes de la ventana, dejamos intacto minRange */
    const lim = o.plugins.zoom.limits?.x;
    if (lim) {
      lim.min = min;
      lim.max = max;
      // lim.minRange permanece ➝ el zoom-in mínimo sigue activo
    }
    this._chart.update("none");
  }

  clear() {
    /* ➊ Nos quedamos solo con el dataset principal */
    this._chart.data.datasets = [this._chart.data.datasets[0]];
    this._chart.data.datasets[0].data = [];

    /* ➋ Re-crear umbrales actuales (si existen) */
    if (this._thresholds) this._injectThresholdLines(this._thresholds);

    this._chart.update("none");
  }

  load(points) {
    this._chart.data.datasets[0].data = [...points];
    this._cutIfNeeded();
    this._updateThresholdLines();
    this._chart.update();
  }

  append(point) {
    this._chart.data.datasets[0].data.push(point);
    this._cutIfNeeded();
    this._updateThresholdLines();
    this._chart.update("none");
  }

  get chart() {
    return this._chart;
  }

  /* ---------- Helpers internos ---------- */
  _makeMainDataset(label, color) {
    return {
      label,
      borderColor: color,
      backgroundColor: color + "22",
      data: [],
      parsing: false,
      borderWidth: 2,
      pointRadius: 3,
      tension: 0.3,
      fill: false,
      spanGaps: SPAN_GAP_MS, // ← UNE huecos ≤ 1 h
    };
  }

  _baseOptions(label, highlightDays) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: 12 },
      animation: false, // ← NEW: sin animación
      spanGaps: SPAN_GAP_MS, // ← une huecos ≤ 1 h, rompe los mayores,
      plugins: {
        legend: { labels: { color: "#343a40" } },
        tooltip: {
          callbacks: {
            title: (items) => {
              const ms = items[0].parsed.x;
              const dt =
                luxon.DateTime.fromMillis(ms).setZone("America/Bogota");
              return dt.isValid ? dt.toFormat("dd LLL h:mm a") : "—";
            },
          },
        },
        zoom: {
          /* ─ Zoom (rueda + pellizco) ─ */
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: "x",
          },
          pan: { enabled: false },
          // Límites globales
          limits: {
            x: { minRange: MIN_RANGE_MS },
          },
        },
        dayBackground: {
          // ← pasa la flag al plugin
          enabled: highlightDays,
          colorA: "#6c757d",
          colorB: "#adb5bd",
          opacity: 0.15, // ≈ 15 %
        },
      },
      scales: {
        x: {
          type: "time",
          /* ── Configuración de etiquetas ── */
          time: {
            unit: "hour",
            stepSize: 1,
            displayFormats: {
              hour: "h:mm a",
              minute: "h:mm a",
              day: "dd LLL", // 01 Ene
              month: "LLL yyyy", // Ene 2025
              year: "yyyy", // 2025
            },
            tooltipFormat: "dd LLL · h:mm a",
          },
          ticks: {
            autoSkip: true, // ← Chart.js omitirá si aún hay demasiadas
            maxRotation: 0, // ← evita rotación vertical
            color: "#343a40",
          },
          grid: { color: "#dee2e6" },
          title: { display: true, text: "Hora", color: "#6c757d" },
        },
        y: {
          grid: { color: "#e9ecef" },
          ticks: { color: "#343a40" },
          title: { display: true, text: label, color: "#6c757d" },
        },
      },
    };
  }

  _injectThresholdLines(th) {
    /* ➊ Persistimos los nuevos valores para futuros clear() */
    this._thresholds = th;

    /* ➋ Borramos cualquier línea de umbral previa */
    this._chart.data.datasets = this._chart.data.datasets.filter(
      (ds) => !ds.isThreshold
    );

    /* ➌ Volvemos a insertar las líneas necesarias */
    const add = (val, lbl) => ({
      label: lbl,
      data: [],
      borderColor: "#fd7e14",
      borderDash: [6, 4],
      borderWidth: 1.8,
      pointRadius: 0,
      fill: false,
      spanGaps: true, // ← Siempre dibuja la línea completa
      clip: true,
      borderCapStyle: "round",
      order: 9_999,
      isThreshold: true,
      _y: val,
    });
    if (th.tMin !== undefined)
      this._chart.data.datasets.push(add(th.tMin, "Min"));
    if (th.tMax !== undefined)
      this._chart.data.datasets.push(add(th.tMax, "Max"));
    if (th.hMin !== undefined)
      this._chart.data.datasets.push(add(th.hMin, "Min"));
    if (th.hMax !== undefined)
      this._chart.data.datasets.push(add(th.hMax, "Max"));
  }

  _updateThresholdLines() {
    const main = this._chart.data.datasets[0].data;
    if (!main.length) return;
    const minX = main[0].x,
      maxX = main[main.length - 1].x;

    this._chart.data.datasets.forEach((ds) => {
      if (ds.isThreshold) {
        ds.data = [
          { x: minX, y: ds._y },
          { x: maxX, y: ds._y },
        ];
      }
    });
  }

  _cutIfNeeded() {
    const arr = this._chart.data.datasets[0].data;
    while (arr.length > this._maxPoints) arr.shift();
  }

  /* Cambia la unidad temporal del eje X y refresca sin animación */
  setTimeUnit(unit = "hour", skipUpdate = false) {
    const x = this._chart.options.scales.x;
    x.time.unit = unit;
    x.time.stepSize = unit === "minute" ? 5 : unit === "hour" ? 1 : 1; // day / month / year → 1
    if (!skipUpdate) this._chart.update("none");
  }

  /* Wrapper auxiliar para que el caller elija la unidad
     y luego establezca la ventana                                       */
  setWindowWithUnit(minTs, maxTs, unit = "hour") {
    /* 1️⃣  Establece la ventana **sin** actualizar aún */
    const o = this._chart.options;
    o.scales.x.min = minTs;
    o.scales.x.max = maxTs;
    const lim = o.plugins.zoom.limits?.x;
    if (lim) {
      lim.min = minTs;
      lim.max = maxTs;
    }

    /* 2️⃣  Fija la unidad y realiza **un único** update */
    this.setTimeUnit(unit, /*skipUpdate=*/ true);
    this._chart.update("none");
  }

  /* Permite cambiar el límite dinámicamente */
  setMaxPoints(val = Infinity) {
    this._maxPoints = Number.isFinite(val) ? val : Infinity;
  }

  /* Actualiza dinámicamente el umbral para unir puntos           */
  setSpanGap(ms) {
    this._chart.data.datasets.forEach((ds) => {
      if (!ds.isThreshold) ds.spanGaps = ms;
    });
    /* No hace falta update: lo llamaremos antes de setWindowWithUnit */
  }

  updateThresholdRange(minX, maxX) {
    this._chart.data.datasets.forEach((ds) => {
      if (ds.isThreshold)
        ds.data = [
          { x: minX, y: ds._y },
          { x: maxX, y: ds._y },
        ];
    });
  }
}