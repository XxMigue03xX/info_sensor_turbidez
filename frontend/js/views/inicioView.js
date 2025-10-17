import { statBox } from "../components/statBox.js";
import { apiaryCard } from "../components/apiaryCard.js";
import { timeSeriesChart } from "../components/timeSeriesChart.js";
import { mergeWithEmptyTimestamps } from "../utils/time.js";
import { pickUnit } from "../utils/pickUnit.js";
import { getSummary, humanAlert } from "../services/metricsService.js";
import { dataService } from "../services/dataService.js";
import { msToISO } from "../utils/dateTime.js";

/* ───── Config RT dashboard (12 h) ───── */
const DASH_WINDOW_HRS = 12;
const DASH_REFRESH_MS = 10 * 60_000; // 10 min
const DASH_INTERVAL_MIN = 10;
const DASH_MAX_POINTS = DASH_WINDOW_HRS * (60 / DASH_INTERVAL_MIN); // 72
const ALERT_ACTIVE_LIMIT_MIN = 60;

let summary = null;
let dashHiveId = null;
let dashTimerId = null;
let dashTempChart, dashHumChart;
let allHivesDash = [];
let lastAlertTimestamp = 0;

/* ---------- Inicializa vista ---------- */
export async function init() {
  ensureAlertBox();
  // Carga inicial
  await refreshDashboard();
  setupDashboardRealtime(summary?.hives ?? []);

  /*  Desbloqueo de audio y segunda verificación de alerta
  ya lo gestiona ensureAlertBox → unlock()                */
  setInterval(refreshDashboard, DASH_REFRESH_MS);
}

/* ---------- Actualizar todo el dashboard ---------- */
async function refreshDashboard() {
  try {
    summary = await getSummary();
    renderStatBoxes(summary);
    renderApiaryCards(summary.apiaries);

    // Renderizar tabla solo si hay alertas
    if (summary.alerts24h > 0) {
      renderRecentAlerts();
    }

    // Siempre actualizar la caja de alerta activa
    checkActiveAlert();
  } catch (err) {
    console.error("[Dashboard] Error al cargar:", err);
  }
}

/* ────────────────────────────────────────────────────────────────
 *        BLOQUE  RT 12 h  —   Dashboard
 *────────────────────────────────────────────────────────────────*/

function setupDashboardRealtime(hives) {
  loadDashboardHives(hives);
  buildDashboardChartCards();
  applyDashboardThresholds();
  startDashboardRealtime();
}

/* --- Cargar colmenas y vincular selector ---------------------- */
function loadDashboardHives(hives) {
  const sel = document.getElementById("selDashboardHive");
  if (!sel) return;
  allHivesDash = hives.sort((a, b) => a.id - b.id);
  sel.innerHTML = allHivesDash
    .map(
      (h) => `
      <option value="${h.id}">
        (#${h.internal_code}) ${h.name} → (#${h.apiary_internal_code}) ${h.apiary_name}
      </option>`
    )
    .join("");
  dashHiveId = allHivesDash[0]?.id ?? null;
  sel.value = dashHiveId;
  sel.onchange = (e) => {
    dashHiveId = +e.target.value;
    resetDashboardCharts();
    applyDashboardThresholds();
    stopDashboardRealtime();
    startDashboardRealtime();
  };
}

/* --- Tarjetas + lienzos (se genera una sola vez) -------------- */
function buildDashboardChartCards() {
  document.getElementById("tempChartCol").innerHTML = `
    <div class="card h-100">
      <div class="card-header">
        <h3 class="card-title mb-0">Temperatura – <span id="dashHiveLblT"></span></h3>
      </div>
      <div class="card-body p-0 position-relative">
        <div class="p-3" style="height:300px;">
          <canvas id="dashTempCanvas" class="w-100 h-100" style="touch-action:none"></canvas>
        </div>
      </div>
    </div>`;

  document.getElementById("humChartCol").innerHTML = `
    <div class="card h-100">
      <div class="card-header">
        <h3 class="card-title mb-0">Humedad – <span id="dashHiveLblH"></span></h3>
      </div>
      <div class="card-body p-0 position-relative">
        <div class="p-3" style="height:300px;">
          <canvas id="dashHumCanvas" class="w-100 h-100" style="touch-action:none"></canvas>
        </div>
      </div>
    </div>`;

  dashTempChart = new timeSeriesChart(
    document.getElementById("dashTempCanvas"),
    {
      label: "Temp °C",
      color: "rgba(255,99,132,1)",
      highlightDays: true,
    }
  );
  dashHumChart = new timeSeriesChart(document.getElementById("dashHumCanvas"), {
    label: "Hum %HR",
    color: "rgba(54,162,235,1)",
    highlightDays: true,
  });
}

/* --- Umbrales por colmena ------------------------------------- */
function applyDashboardThresholds() {
  const h = allHivesDash.find((x) => x.id === dashHiveId);
  if (!h) return;
  dashTempChart._injectThresholdLines({
    tMin: +h.temp_threshold_min,
    tMax: +h.temp_threshold_max,
  });
  dashHumChart._injectThresholdLines({
    hMin: +h.humidity_threshold_min,
    hMax: +h.humidity_threshold_max,
  });

  /* Etiqueta: (#cod colmena) Nombre → (#cod apiario) Apiario */
  const hiveLabel = `(#${h.internal_code}) ${h.name} `;
  document.getElementById("dashHiveLblT").textContent = hiveLabel;
  document.getElementById("dashHiveLblH").textContent = hiveLabel;

  dashTempChart.chart.update();
  dashHumChart.chart.update();
}

/* --- Ciclo RT cada 10 min ------------------------------------- */
function startDashboardRealtime() {
  stopDashboardRealtime();
  loadDashboardRecent(); // 1.ª carga inmediata
  dashTimerId = setInterval(loadDashboardRecent, DASH_REFRESH_MS);
}

function stopDashboardRealtime() {
  if (dashTimerId) {
    clearInterval(dashTimerId);
    dashTimerId = null;
  }
}

/* --- Cargar lecturas recientes (últimas 12 h) ----------------- */
async function loadDashboardRecent() {
  if (!dashHiveId) return;
  const end = Date.now();
  const start = end - DASH_WINDOW_HRS * 3_600_000;

  /* ── Solicita las últimas lecturas (como en dataView.js) ── */
  let rows = [];

  try {
    const res = await dataService.historical(
      dashHiveId,
      msToISO(start) + ":00",
      msToISO(end) + ":00"
    );
    rows = res.data
  } catch (err) {
    console.error("[Dashboard] Error recibiendo lecturas:", err);
    rows = [];
  }

  /* ──────────────────────────────────────────────────────────────
   * CASO: la API devuelve **cero filas** en la ventana RT (12 h).
   *       ‣ Aún debemos mostrar los umbrales y la escala completa.
   *       ‣ El zoom-out debe quedar limitado a esas 12 h.
   * ────────────────────────────────────────────────────────────── */
  if (!rows.length) {
    /* 1️⃣  Limpia datasets (conserva configuración de umbrales) */
    dashTempChart.clear();
    dashHumChart.clear();

    /* 2️⃣  Redibuja las líneas de umbral a lo largo de la ventana */
    dashTempChart.updateThresholdRange(start, end);
    dashHumChart.updateThresholdRange(start, end);

    /* 3️⃣  Fija la ventana X y los límites de zoom (12 h)         */
    const unit = pickUnit(end - start);
    dashTempChart.setWindowWithUnit(start, end, unit);
    dashHumChart.setWindowWithUnit(start, end, unit);
    return; // ⬅️  Nada más que hacer: no hay puntos de datos
  }

  const points = rows
    .slice() // copia
    .reverse() // ascendente (antiguo → reciente)
    .filter((r) => Date.parse(r.recorded_at_iso) >= start)
    .slice(-DASH_MAX_POINTS);

  const tempRaw = points.map((r) => ({
    x: Date.parse(r.recorded_at_iso),
    y: +r.temperature,
  }));

  const humRaw = points.map((r) => ({
    x: Date.parse(r.recorded_at_iso),
    y: +r.humidity,
  }));

  const intervalMs = DASH_INTERVAL_MIN * 60_000;
  const tempArr = mergeWithEmptyTimestamps(tempRaw, start, end, intervalMs);
  const humArr = mergeWithEmptyTimestamps(humRaw, start, end, intervalMs);

  dashTempChart.clear();
  dashHumChart.clear();
  dashTempChart.load(tempArr);
  dashHumChart.load(humArr);

  const unit = pickUnit(end - start);
  dashTempChart.setWindowWithUnit(start, end, unit);
  dashHumChart.setWindowWithUnit(start, end, unit);
}

/* --- Helpers --------------------------------------------------- */
function resetDashboardCharts() {
  [dashTempChart, dashHumChart].forEach((c) => {
    if (!c) return;
    c.chart.resetZoom();
    c.clear();
  });
}

/* ---------- Caja de alerta activa ---------- */
function checkActiveAlert() {
  const latest = summary.alerts[0];
  const box = document.getElementById("activeAlertBox");
  if (!box) return;

  // ⇢ No hay alertas
  if (!latest) return showInactive(box);

  const ts = Date.parse(latest.recorded_at_iso);
  const mins = Math.round((Date.now() - ts) / 60000);
  const recent = mins <= ALERT_ACTIVE_LIMIT_MIN;
  const isNew = ts > lastAlertTimestamp;
  lastAlertTimestamp = Math.max(lastAlertTimestamp, ts);

  // ⇢ Alerta fuera del rango “activa”
  if (!recent) return showInactive(box);

  /* --- Alerta ACTIVA --- */
  box.className = "callout callout-danger alert-blink mb-3";
  box.innerHTML = `
    <i class="fas fa-exclamation-triangle mr-2"></i>
    ${humanAlert(latest.alert_type)} — ${latest.value}
    (<small>${mins}&nbsp;min atrás</small>) → (#${latest.hive_internal_code}) ${
    latest.hive_name
  }
  `;

  // Sonido solo si audio desbloqueado y la alerta es nueva
  if (isNew && window.__audioUnlocked)
    document
      .getElementById("alertAudio")
      ?.play()
      .catch(() => {});
}

function showInactive(box) {
  box.className = "callout callout-success mb-3";
  box.innerHTML = `<i class="fas fa-check-circle mr-2"></i>Sin alertas activas`;
}

/* ---------- Helpers de interfaz ---------- */
function ensureAlertBox() {
  const content = document.querySelector(".content");
  if (!content || document.getElementById("activeAlertBox")) return;

  // Caja inicial en gris "verificando…"
  const div = document.createElement("div");
  div.id = "activeAlertBox";
  div.className = "callout callout-secondary mb-3";
  div.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>Verificando alertas…`;
  content.prepend(div);

  // Elemento de audio
  const audio = document.createElement("audio");
  audio.id = "alertAudio";
  audio.src = "assets/sounds/alert.mp3";
  audio.preload = "auto";
  document.body.appendChild(audio);

  /* ── Desbloqueo de audio (clic una sola vez) ── */
  window.__audioUnlocked = false;
  const unlock = () => {
    audio.volume = 0; // silencio
    audio
      .play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = 1;
        window.__audioUnlocked = true;

        /*  Re-verificar de inmediato:
        al reiniciar lastAlertTimestamp forzamos isNew = true
        y garantizamos que el sonido se reproduzca si ya había
        una alerta activa antes del desbloqueo. */
        lastAlertTimestamp = 0;
        checkActiveAlert();
      })
      .catch(() => {});
    window.removeEventListener("click", unlock);
  };
  window.addEventListener("click", unlock, { once: true });
}

/* ---------- Renderizadores ---------- */
function renderStatBoxes({
  apiaryCount,
  hiveCount,
  deviceCount,
  alerts24h,
  readings24h,
}) {
  const row = document.getElementById("statsRow");
  row.innerHTML = "";
  row.append(
    statBox({
      color: "info",
      icon: "globe",
      value: apiaryCount,
      label: "Apiarios",
    }),
    statBox({
      color: "success",
      icon: "cubes",
      value: hiveCount,
      label: "Colmenas",
    }),
    statBox({
      color: "primary",
      icon: "microchip",
      value: deviceCount,
      label: "Dispositivos",
    }),
    statBox({
      color: "danger",
      icon: "exclamation-triangle",
      value: alerts24h,
      label: "Alertas 24 h",
    }),
    statBox({
      color: "warning",
      icon: "chart-line",
      value: readings24h,
      label: "Lecturas 24 h",
    })
  );
}

function renderApiaryCards(apiaries) {
  const panel = document.getElementById("apiariesPanel");
  panel.innerHTML = "";
  const cards = apiaries.map(apiaryCard);
  cards.forEach((c) => panel.appendChild(c));
}

function renderRecentAlerts() {
  const col = document.getElementById("alertsCol");
  const alerts = summary.alerts
    .sort((a, b) => new Date(b.recorded_at_iso) - new Date(a.recorded_at_iso))
    .slice(0, 5);

  col.innerHTML = `
    <div class="card">
      <div class="card-header"><h3 class="card-title mb-0">Alertas últimas 24 h</h3></div>
        <div class="card-body p-0">
          <div class="table-responsive-sm">
            <table class="table table-sm table-hover mb-0">
            <thead class="thead-light"><tr><th>Hora</th><th>Parámetro</th><th>Valor</th><th>Apiario</th><th>Colmena</th></tr></thead>
            <tbody>${alerts
              .map(
                (a) => `
                <tr>
                  <td>${new Date(a.recorded_at_iso).toLocaleTimeString()}</td>
                  <td>${humanAlert(a.alert_type)}</td>
                  <td>${a.value}</td>
                  <td>(#${a.apiary_internal_code}) ${a.apiary_name}</td>
                  <td>(#${a.hive_internal_code}) ${a.hive_name}</td>
                </tr>`
              )
              .join("")}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}