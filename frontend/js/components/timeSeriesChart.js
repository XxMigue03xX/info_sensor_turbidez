/* timeSeriesChart – envoltorio minimal para Chart.js 3/4  */
/* Requiere: chart.js, chartjs-plugin-zoom, chartjs-adapter-luxon           */

/* ── Luxon en español ───────────────────── */
luxon.Settings.defaultLocale = "es";
luxon.Settings.defaultZone = "America/Bogota"; // ← mostrar SIEMPRE en hora COL

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
/* minRange base pequeño; se ajustará dinámicamente a una fracción del span */
const BASE_MIN_RANGE_MS = 250;                 // 250 ms
const SPAN_GAP_MS       = 60 * 60 * 1000;      // 1 hora → puente máximo

/* ─── Plugin: DayBackground ───────────────────────────────────── */
const dayBackgroundPlugin = {
  id: "dayBackground",
  beforeDraw(chart, _args, opts) {
    if (!opts.enabled) return;

    const { ctx, chartArea, scales: { x } } = chart;
    const min = x.getUserBounds().min;
    const max = x.getUserBounds().max;

    let cur = luxon.DateTime.fromMillis(min).startOf("day");
    const end = luxon.DateTime.fromMillis(max).endOf("day");

    let toggle = false; // alterna colores

    ctx.save();
    ctx.globalAlpha = opts.opacity ?? 0.06;

    while (cur < end) {
      const next = cur.plus({ days: 1 });
      const xStart = x.getPixelForValue(cur.toMillis());
      const xEnd   = x.getPixelForValue(next.toMillis());

      ctx.fillStyle = toggle ? (opts.colorB ?? "#ced4da") : (opts.colorA ?? "#f8f9fa");
      ctx.fillRect(xStart, chartArea.top, xEnd - xStart, chartArea.bottom - chartArea.top);

      toggle = !toggle;
      cur = next;
    }
    ctx.restore();
  },
};
if (!Chart.registry.plugins.get("dayBackground")) Chart.register(dayBackgroundPlugin);

/* ── Plugin: AdaptiveTimeUnit ──────────────────────────
   Añade "second". Cambia de unidad según el span visible. */
const adaptiveTimeUnitPlugin = {
  id: "adaptiveTimeUnit",
  beforeUpdate(chart) {
    const x = chart.scales.x;
    if (!x) return;

    const optX = chart.options.scales.x;
    const min  = optX.min ?? x.min;
    const max  = optX.max ?? x.max;
    const span = max - min;

    const timeOpt = optX.time;
    let unit, step;
    if (span <= 2 * 60 * 1000) {         // ≤ 2 min
      unit = "second";
      // paso fino si ventana < 30 s
      step = span <= 30 * 1000 ? 1 : 5;  // 1 s o 5 s
    } else if (span <= 60 * 60 * 1000) { // ≤ 1 h
      unit = "minute";
      step = 5;
    } else if (span <= 2 * 24 * 60 * 60 * 1000) {
      unit = "hour";
      step = 1;
    } else if (span <= 90 * 24 * 60 * 60 * 1000) {
      unit = "day";
      step = 1;
    } else if (span <= 2 * 365 * 24 * 60 * 60 * 1000) {
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
if (!Chart.registry.plugins.get("adaptiveTimeUnit")) Chart.register(adaptiveTimeUnitPlugin);

export class timeSeriesChart {
  constructor(
    canvas,
    {
      label,
      color = "#0d6efd",
      thresholds = null,
      maxPoints = Infinity,
      highlightDays = false,
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

  setWindow(min, max) {
    const o = this._chart.options;
    o.scales.x.min = min;
    o.scales.x.max = max;

    const lim = o.plugins.zoom.limits?.x;
    if (lim) {
      lim.min = min;
      lim.max = max;
      // minRange lo ajusta setWindowWithUnit
    }
    this._chart.update("none");
  }

  clear() {
    this._chart.data.datasets = [this._chart.data.datasets[0]];
    this._chart.data.datasets[0].data = [];
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

  get chart() { return this._chart; }

  /* ---------- Helpers internos ---------- */
  _makeMainDataset(label, color) {
    return {
      label,
      borderColor: color,
      backgroundColor: color + "22",
      data: [],
      parsing: false,
      borderWidth: 2,
      pointRadius: 2,
      tension: 0.25,
      fill: false,
      spanGaps: SPAN_GAP_MS,
    };
  }

  _baseOptions(label, highlightDays) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: 12 },
      animation: false,
      spanGaps: SPAN_GAP_MS,
      plugins: {
        legend: { labels: { color: "#343a40" } },
        tooltip: {
          callbacks: {
            title: (items) => {
              const ms = items[0].parsed.x;
              const dt = luxon.DateTime.fromMillis(ms).setZone("America/Bogota");
              return dt.isValid ? dt.toFormat("dd LLL yyyy · HH:mm:ss") : "—";
            },
          },
        },
        zoom: {
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: "x",
          },
          pan: { enabled: false },
          limits: { x: { minRange: BASE_MIN_RANGE_MS } }, // dinámico en setWindowWithUnit
        },
        dayBackground: {
          enabled: highlightDays,
          colorA: "#6c757d",
          colorB: "#adb5bd",
          opacity: 0.15,
        },
      },
      scales: {
        x: {
          type: "time",
          time: {
            unit: "second",
            stepSize: 1,
            displayFormats: {
              second: "HH:mm:ss",
              minute: "HH:mm",
              hour:   "HH:mm",
              day:    "dd LLL",
              month:  "LLL yyyy",
              year:   "yyyy",
            },
            tooltipFormat: "dd LLL yyyy · HH:mm:ss",
          },
          ticks: {
            autoSkip: true,
            maxRotation: 0,
            color: "#343a40",
          },
          grid: { color: "#dee2e6" },
          title: { display: true, text: "Tiempo", color: "#6c757d" },
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
    this._thresholds = th;
    this._chart.data.datasets = this._chart.data.datasets.filter(ds => !ds.isThreshold);
    const add = (val, lbl) => ({
      label: lbl,
      data: [],
      borderColor: "#fd7e14",
      borderDash: [6, 4],
      borderWidth: 1.8,
      pointRadius: 0,
      fill: false,
      spanGaps: true,
      clip: true,
      borderCapStyle: "round",
      order: 9_999,
      isThreshold: true,
      _y: val,
    });
    if (th.tMin !== undefined) this._chart.data.datasets.push(add(th.tMin, "Min"));
    if (th.tMax !== undefined) this._chart.data.datasets.push(add(th.tMax, "Max"));
    if (th.hMin !== undefined) this._chart.data.datasets.push(add(th.hMin, "Min"));
    if (th.hMax !== undefined) this._chart.data.datasets.push(add(th.hMax, "Max"));
  }

  _updateThresholdLines() {
    const main = this._chart.data.datasets[0].data;
    if (!main.length) return;
    const minX = main[0].x, maxX = main[main.length - 1].x;
    this._chart.data.datasets.forEach(ds => {
      if (ds.isThreshold) ds.data = [{ x: minX, y: ds._y }, { x: maxX, y: ds._y }];
    });
  }

  _cutIfNeeded() {
    const arr = this._chart.data.datasets[0].data;
    while (arr.length > this._maxPoints) arr.shift();
  }

  setTimeUnit(unit = "hour", skipUpdate = false) {
    const x = this._chart.options.scales.x;
    x.time.unit = unit;
    x.time.stepSize = unit === "second" ? 1 : unit === "minute" ? 5 : 1;
    if (!skipUpdate) this._chart.update("none");
  }

  /* Establece ventana y ajusta minRange de zoom a una fracción del span */
  setWindowWithUnit(minTs, maxTs, unit = "second") {
    const span = Math.max(0, maxTs - minTs);
    const dynMinRange = Math.max(BASE_MIN_RANGE_MS, Math.floor(span * 0.1)); // 10% del span (mín 250 ms)

    const o = this._chart.options;
    o.scales.x.min = minTs;
    o.scales.x.max = maxTs;

    const lim = o.plugins.zoom.limits?.x;
    if (lim) {
      lim.min = minTs;
      lim.max = maxTs;
      lim.minRange = dynMinRange;
    }

    this.setTimeUnit(unit, /*skipUpdate=*/ true);
    this._chart.update("none");
  }

  setMaxPoints(val = Infinity) {
    this._maxPoints = Number.isFinite(val) ? val : Infinity;
  }

  setSpanGap(ms) {
    this._chart.data.datasets.forEach(ds => { if (!ds.isThreshold) ds.spanGaps = ms; });
  }

  updateThresholdRange(minX, maxX) {
    this._chart.data.datasets.forEach(ds => {
      if (ds.isThreshold) ds.data = [{ x: minX, y: ds._y }, { x: maxX, y: ds._y }];
    });
  }
}