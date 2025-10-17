/*
 *  dataView.js — Refactor 2025‑07‑08
 *  ──────────────────────────────────────────────────────────────────────────
 *  Implementa el nuevo modelo de datos históricos:
 *    • Elimina peticiones automáticas al hacer zoom.
 *    • Añade botón manual “Ver con más detalle” cuando la ventana visible
 *      es lo suficientemente pequeña (≤ 12 h).
 *    • Mantiene el resto de la lógica (RT, exportaciones, etc.).
 *
 *  Requiere añadir en el HTML un botón (oculto por defecto):
 *    <button id="btnVerDetalle" class="btn btn-primary d-none" style="position:absolute; right:1rem; top:0.5rem; z-index:10;">
 *       <i class="fas fa-search-plus"></i> Ver con más detalle
 *    </button>
 *  ubicado sobre los lienzos de los gráficos.
 *
 *  Dependencias externas y utilidades no han cambiado.
 *  ──────────────────────────────────────────────────────────────────────────
 */

/* ───── Imports ───── */
import { mergeWithEmptyTimestamps } from "../utils/time.js";
import { msToISO, diffDays } from "../utils/dateTime.js";
import { breakLargeGaps, getMaxHistPoints, needsMoreData } from "../utils/chartHelpers.js";
import { triggerDownload } from "../utils/download.js";
import { disableDateInputs, showLoader } from "../utils/dom.js";
import { pickUnit } from "../utils/pickUnit.js";
import { timeSeriesChart } from "../components/timeSeriesChart.js";
import { hiveService } from "../services/hiveService.js";
import { dataService } from "../services/dataService.js";

/* ───── Configuración ───── */
const RT_WINDOW_HRS = 24; // ventana mostrada en tiempo real
const RT_REFRESH_MS = 10 * 60_000; // 10 min
const RT_INTERVAL_MIN = 10; // paso base (10 min)
const MAX_RT_POINTS = RT_WINDOW_HRS * 6; // 144

/* ——— Lógica Histórica ——— */
const DETAIL_THRESHOLD_MS = 12 * 3_600_000; // ≤ 12 h → mostrar botón
let histStart = null;
let histEnd = null;
let lastQueryString = "";
let lastDesdeISO = "";
let lastHastaISO = "";
let allHives = [];
let hiveId = null;
let timerId = null;
let tempChart, humChart;
let lastIsRaw = false;          // ← se actualiza en cada llamada al backend
/* —— Exportación —— */
let exportMode = null; // 'csv' | 'pdf'

/*  Botones “Ver con más detalle”                                */
const btnDetalleTemp = document.getElementById("btnVerDetalleTemp");
const btnDetalleHum = document.getElementById("btnVerDetalleHum");

/* ——— Helpers de estado ——— */
const setBtnState = (btn, activo) => {
  btn.disabled = !activo; // inactivo = gris + disabled
  btn.classList.toggle("btn-warning", activo); // activo  = amarillo
  btn.classList.toggle("btn-secondary", !activo);
};

/*  Desactiva ambos (gris)                                        */
const hideDetailBtns = () => {
  setBtnState(btnDetalleTemp, false);
  setBtnState(btnDetalleHum, false);
};

/* ───── Init desde router ───── */
export async function init() {
  bindEvents();
  await setupCharts();
  await loadHives();
  /*  Botones siempre visibles, pero inactivos al inicio  */
  btnDetalleTemp.classList.remove("d-none");
  btnDetalleHum.classList.remove("d-none");
  [btnDetalleTemp, btnDetalleHum].forEach((b) =>
    b.classList.remove("btn-primary")
  );
  hideDetailBtns();
  document.getElementById("chkRealtime").checked = true;
  disableDateInputs(true);
  startRealtime();
}

/* ───── Vínculo de eventos ───── */
function bindEvents() {
  document.getElementById("selHive").onchange = onHiveChange;
  document.getElementById("chkRealtime").onchange = onRealtimeToggle;
  document.getElementById("btnBuscar").onclick = () => fetchHistorical();
  document.getElementById("resetZoomTempBtn").onclick = () => resetZoom("temp");
  document.getElementById("resetZoomHumBtn").onclick = () => resetZoom("hum");

  btnDetalleTemp.onclick = () => {
    const c = tempChart.chart;
    fetchHistorical(c.scales.x.min, c.scales.x.max, true);
    hideDetailBtns();
  };
  btnDetalleHum.onclick = () => {
    const c = humChart.chart;
    fetchHistorical(c.scales.x.min, c.scales.x.max, true);
    hideDetailBtns();
  };
}

/* ───── Preparar gráficos ───── */
async function setupCharts() {
  tempChart = new timeSeriesChart(document.getElementById("tempCanvas"), {
    label: "Temp °C",
    color: "rgba(255,99,132,1)",
    maxPoints: Infinity,
    highlightDays: true,
  });
  humChart = new timeSeriesChart(document.getElementById("humCanvas"), {
    label: "Hum %HR",
    color: "rgba(54,162,235,1)",
    maxPoints: Infinity,
    highlightDays: true,
  });

  /* ➊ Callback: solo mostramos/ocultamos botón */
  const onZoom = ({ chart }) => handleZoom(chart);
  tempChart.chart.options.plugins.zoom.zoom.onZoomComplete = onZoom;
  humChart.chart.options.plugins.zoom.zoom.onZoomComplete = onZoom;
}

/* ───── Mostrar/ocultar botón detalle ───── */
function handleZoom(chart) {
  if (document.getElementById("chkRealtime").checked) return; // RT ignora

  const visMin = chart.scales.x.min;
  const visMax = chart.scales.x.max;
  const winMs = visMax - visMin;

  /* — Heurística restaurada —
     • Ventana pequeña   (≤ 12 h)                       → mostrar
     • Muy pocos/muchos puntos visibles respecto al límite
       ( <40 %  o  >120 % )                             → mostrar
     • Parte de la ventana está fuera del dataset       → mostrar
  */

  const ptsVis = chart.data.datasets[0].data.filter(
    (p) => p.x >= visMin && p.x <= visMax
  ).length;
  const limit = getMaxHistPoints();

  const needMore = needsMoreData(chart, visMin, visMax);   // ya existente

  /* ── Decide si mostrar u ocultar el botón ── */
  let showBtn;

  if (lastIsRaw) {
    /* Datos crudos → solo importa si hace falta más datos alrededor */
    showBtn = needMore;
  } else {
    /* Buckets → importa needMore  OR  heurísticas de densidad/ventana */
    showBtn =
      needMore ||
      (ptsVis < limit * 0.4 ||
        ptsVis > limit * 1.2 ||
        winMs <= DETAIL_THRESHOLD_MS);
  }

  //  Desactiva ambos y luego activa solo el que corresponda
  hideDetailBtns();
  if (showBtn) {
    const btn =
      chart.canvas.id === "tempCanvas" ? btnDetalleTemp : btnDetalleHum;
    setBtnState(btn, true); // amarillo + clic habilitado
  }
}

/* ───── Cambio de colmena ───── */
function onHiveChange(e) {
  hiveId = +e.target.value;
  stopRealtime();
  histStart = histEnd = null; // ← reinicia ventana guardada
  resetCharts(); // limpia datos y estado de zoom
  applyThresholds(); // reinyecta umbrales sobre limpio
  hideDetailBtns();

  if (document.getElementById("chkRealtime").checked) startRealtime();
}

/* ───── Tiempo real ON/OFF ───── */
function onRealtimeToggle(e) {
  if (e.target.checked) {
    disableDateInputs(true);
    startRealtime();
    hideDetailBtns();
  } else {
    stopRealtime();
    disableDateInputs(false);
    hideDetailBtns();
  }
}

function startRealtime() {
  stopRealtime();
  histStart = histEnd = null;
  loadRecent().then(() => {});
  timerId = setInterval(loadRecent, RT_REFRESH_MS);
}

function stopRealtime() {
  if (timerId) clearInterval(timerId);
  timerId = null;
}

/* ───── Cargar últimos puntos para RT ───── */
async function loadRecent() {
  if (!hiveId) return;
  const end   = Date.now();
  const start = end - RT_WINDOW_HRS * 3_600_000;
  const tId = setTimeout(() => showLoader(true), 250);
  
  const res = await dataService.historical(
    hiveId,
    msToISO(start) + ":00",
    msToISO(end)   + ":00"
  );
  const rows = res.data || [];
  clearTimeout(tId);
  showLoader(false);

  /* ──────────────────────────────────────────────────────────────
   * CASO: la API devuelve **cero filas** en la ventana RT (24 h).
   *       ‣ Aún debemos mostrar los umbrales y la escala completa.
   *       ‣ El zoom-out debe quedar limitado a esas 24 h.
   * ────────────────────────────────────────────────────────────── */
  if (!rows.length) {
    /* 1️⃣  Limpia datasets (conserva configuración de umbrales) */
    tempChart.clear();
    humChart.clear();

    /* 2️⃣  Redibuja las líneas de umbral a lo largo de la ventana */
    tempChart.updateThresholdRange(start, end);
    humChart.updateThresholdRange(start, end);

    /* 3️⃣  Fija la ventana X y los límites de zoom (24 h)         */
    const unit = pickUnit(end - start);
    tempChart.setWindowWithUnit(start, end, unit);
    humChart.setWindowWithUnit(start, end, unit);
    return; // ⬅️  Nada más que hacer: no hay puntos de datos
  }

  const points = rows
    .slice()
    .reverse()
    .filter((r) => Date.parse(r.recorded_at_iso) >= start)
    .slice(-MAX_RT_POINTS);

  const tempRaw = points.map((r) => ({
    x: Date.parse(r.recorded_at_iso),
    y: +r.temperature,
  }));

  const humRaw = points.map((r) => ({
    x: Date.parse(r.recorded_at_iso),
    y: +r.humidity,
  }));
  
  const intervalMs = RT_INTERVAL_MIN * 60_000;
  const tempArr = mergeWithEmptyTimestamps(tempRaw, start, end, intervalMs);
  const humArr = mergeWithEmptyTimestamps(humRaw, start, end, intervalMs);

  tempChart.clear();
  humChart.clear();
  tempChart.load(tempArr);
  humChart.load(humArr);

  const unit = pickUnit(end - start);
  tempChart.setWindowWithUnit(start, end, unit);
  humChart.setWindowWithUnit(start, end, unit);
}

/* ───── Histórico principal ───── */
async function fetchHistorical(
  startMs = null,
  endMs = null,
  isRefetch = false
) {
  if (!hiveId) return;
  if (startMs instanceof Event) {
    startMs = null;
    endMs = null;
  }

  /* Nueva búsqueda manual (no refetch) → reinicia la ventana histórica */
  if (!isRefetch && startMs === null && endMs === null) {
    histStart = histEnd = null;
  }

  const dISO =
    startMs === null ? document.getElementById("inpDesde").value : msToISO(startMs);
  const hISO =
    endMs === null ? document.getElementById("inpHasta").value : msToISO(endMs);

  lastDesdeISO = dISO;
  lastHastaISO = hISO;
  const tNow = Date.now();
  const tStart = Date.parse(dISO);
  const tEnd = Date.parse(hISO);
  if (isNaN(tStart) || isNaN(tEnd) || tStart >= tEnd)
    return alert("Rango inválido");
  if (tEnd > tNow) return alert('La fecha "hasta" no puede ser futura.');

  stopRealtime();
  resetCharts();
  showLoader(true);

  const maxPts = getMaxHistPoints();
  const res = await dataService
    .historical(hiveId, dISO + ":00", hISO + ":00", { maxPts })
    .catch(() => []);
  lastIsRaw = res.is_raw ?? false;
  const rows = res.data || [];
  showLoader(false);
  document.getElementById("btnCsv").disabled = document.getElementById(
    "btnPdf"
  ).disabled = !rows.length;
  if (!rows.length) {
    if (!isRefetch) alert("No hay datos en el rango seleccionado.");
    return;
  }

  const tempRaw = rows.map((r) => ({
    x: Date.parse(r.recorded_at_iso),
    y: +r.temperature,
  }));
  const humRaw = rows.map((r) => ({
    x: Date.parse(r.recorded_at_iso),
    y: +r.humidity,
  }));
  const bucketMs =
    rows.length > 1
      ? Date.parse(rows[1].recorded_at_iso) - Date.parse(rows[0].recorded_at_iso)
      : 10 * 60_000;
  const tempArr = breakLargeGaps(
    mergeWithEmptyTimestamps(tempRaw, tStart, tEnd, bucketMs),
    bucketMs
  );
  const humArr = breakLargeGaps(
    mergeWithEmptyTimestamps(humRaw, tStart, tEnd, bucketMs),
    bucketMs
  );

  tempChart.clear();
  humChart.clear();
  tempChart.load(tempArr);
  humChart.load(humArr);
  tempChart.setSpanGap(bucketMs * 1.2);
  humChart.setSpanGap(bucketMs * 1.2);
  tempChart.updateThresholdRange(tStart, tEnd);
  humChart.updateThresholdRange(tStart, tEnd);

  const unit = pickUnit(tEnd - tStart);

  tempChart.setWindowWithUnit(tStart, tEnd, unit);
  humChart.setWindowWithUnit(tStart, tEnd, unit);

  /* 🆕  Restablece límites:
   *     • zoom-in permitido hasta 10 min (definido en minRange del plugin)
   *     • zoom-out máximo = rango que el usuario buscó originalmente       */
  [tempChart, humChart].forEach((ts) => {
    const limX = ts.chart.options.plugins.zoom.limits.x ?? {};
    limX.min = histStart ?? tStart; // si es la 1.ª vez, usa ventana actual
    limX.max = histEnd ?? tEnd;
    ts.chart.options.plugins.zoom.limits.x = limX;
    ts.chart.update("none"); // aplica sin animación
  });

  /*  Guarda la ventana **solo la primera vez** (no en refetch)           */
  if (!isRefetch && histStart === null && histEnd === null) {
    histStart = tStart;
    histEnd = tEnd;
  }

  const qs = new URLSearchParams({
    colmena_id: hiveId,
    desde: dISO + ":00",
    hasta: hISO + ":00",
    max_pts: maxPts,
  }).toString();
  lastQueryString = qs;

  hideDetailBtns();
}

/* ───── Utilidades UI ───── */
function resetCharts() {
  [tempChart, humChart].forEach((ts) => {
    if (!ts) return;
    ts.chart.resetZoom(); // elimina transformaciones previas del plugin zoom
    ts.clear(); // borra datasets & umbrales para un lienzo limpio
  });
}

function resetZoom(which) {
  const isRT = document.getElementById("chkRealtime").checked;
  const chart =
    which === "temp" ? tempChart : which === "hum" ? humChart : null;
  if (!chart) return;
  chart.chart.resetZoom();
  hideDetailBtns();

  if (isRT) {
    const end = Date.now();
    const start = end - RT_WINDOW_HRS * 3_600_000;
    const unit = pickUnit(end - start);
    chart.setWindowWithUnit(start, end, unit);
  } else if (histStart && histEnd) {
    fetchHistorical(histStart, histEnd, true).then(() => {
      const unit = pickUnit(histEnd - histStart);
      chart.setWindowWithUnit(histStart, histEnd, unit);
    });
  }
}

/* ───── Thresholds ───── */
function applyThresholds() {
  const h = allHives.find((x) => x.id === hiveId);
  if (!h) return;
  tempChart._injectThresholdLines({
    tMin: +h.temp_threshold_min,
    tMax: +h.temp_threshold_max,
  });
  humChart._injectThresholdLines({
    hMin: +h.humidity_threshold_min,
    hMax: +h.humidity_threshold_max,
  });
  tempChart.chart.update();
  humChart.chart.update();
}

/* ───── Cargar colmenas ───── */
async function loadHives() {
  const sel = document.getElementById("selHive");
  allHives = (await hiveService.getAll()).sort((a, b) => a.id - b.id);
  sel.innerHTML = allHives
    .map(
      (h) =>
        `<option value="${h.id}">(#${h.internal_code}) ${h.name} → (#${h.apiary_internal_code}) ${h.apiary_name}</option>`
    )
    .join("");
  hiveId = allHives[0]?.id ?? null;
  sel.value = hiveId;
  applyThresholds();
}

/* ————————————————  Modal Exportación  ———————————————— */
async function openExportModal(mode) {
  if (!lastDesdeISO || !lastHastaISO) return;
  exportMode = mode;

  const lbl = document.getElementById("exportModalLbl");
  const warn = document.getElementById("exportWarn");
  const cnt = document.getElementById("exportCount");
  const btn = document.getElementById("btnExportConfirm");

  lbl.textContent = mode === "csv" ? "Exportar CSV" : "Generar PDF";
  warn.classList.add("d-none");
  btn.disabled = true;
  cnt.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Calculando…';

  /* → conteo real de filas */
  let n = 0;
  try {
    n = await dataService.count(
      hiveId,
      lastDesdeISO + ":00",
      lastHastaISO + ":00"
    );
    n = n.count || 0;
  } catch (_) {
    cnt.textContent = "Error al contar registros";
  }

  cnt.textContent = `Se exportarán ${n} registro${n !== 1 ? "s" : ""}.`;
  btn.disabled = false;

  /* reglas PDF */
  if (mode === "pdf" && diffDays(lastDesdeISO, lastHastaISO) > 365) {
    warn.textContent = "El PDF está limitado a 1 año. Reduce el rango.";
    warn.classList.remove("d-none");
    btn.disabled = true;
  }

  $("#exportModal").modal("show");
}

document.getElementById("btnCsv").onclick = () => openExportModal("csv");
document.getElementById("btnPdf").onclick = () => openExportModal("pdf");
document.getElementById("btnExportConfirm").onclick = exportConfirm;

async function exportConfirm() {
  $("#exportModal").modal("hide");
  showLoader(true);

  const metricas = document.getElementById("selMetricas").value;
  const qsExport = `${lastQueryString}&metricas=${metricas}`;
  let result;

  try {
    if (exportMode === "csv") {
      result = await dataService.csv(qsExport);
    } else {
      const dias = diffDays(lastDesdeISO, lastHastaISO);
      const estSeg = Math.round((dias / 30) * 6);
      if (
        dias > 30 &&
        !confirm(
          `Se generarán varios PDF (ZIP). Esto puede tardar ~${estSeg}s.\n¿Continuar?`
        )
      ) {
        showLoader(false);
        return;
      }
      result = await dataService.pdf(qsExport);
    }
  } catch (e) {
    console.error(e);
  }
  showLoader(false);
  if (!result || !result.blob) return alert("Error generando archivo");

  /*  Nombre real recibido; si no vino, deduce por MIME  */
  let { blob, fileName } = result;
  if (!fileName) {
    const ext = blob.type.includes("zip")
      ? "zip"
      : blob.type.includes("pdf")
      ? "pdf"
      : "csv";
    fileName = `descarga.${ext}`;
  }
  triggerDownload(blob, fileName);
}