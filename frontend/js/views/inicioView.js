/**
 * Vista: Inicio
 * - Consulta /admin/command para mostrar si hay sesión activa y hora de finalización.
 * - Botón "Nueva sesión" -> POST /activate.
 * - Carga la última sesión culminada (GET /sessions/last) y grafica 60 NTU con timeSeriesChart (Chart.js).
 * - Muestra Media/Mediana/Moda/StdDev/Rango provenientes del backend (ya normalizados a 3 decimales).
 */

import commandService from "../services/commandService.js";
import sessionService from "../services/sessionService.js";
import { timeSeriesChart } from "../components/timeSeriesChart.js";

let ntuChart; // instancia de timeSeriesChart

export async function init() {
  // Referencias DOM
  const statusBox = document.getElementById("session-status");
  const footerNote = document.getElementById("session-footer-note");
  const btnNew = document.getElementById("btn-new-session");
  const btnConfirmNew = document.getElementById("btn-confirm-new-session");
  const btnReloadLast = document.getElementById("btn-reload-last");
  const lastMeta = document.getElementById("last-session-meta");
  const meanEl = document.getElementById("stat-mean");
  const modeEl = document.getElementById("stat-mode");
  const medianEl = document.getElementById("stat-median");
  const stddevEl = document.getElementById("stat-stddev");
  const rangeEl = document.getElementById("stat-range");
  const chartCanvas = document.getElementById("chart-last-session");

  // Helpers de tiempo: parsear SIEMPRE timestamps backend como UTC (epoch ms),
  // y formatear SIEMPRE para mostrar en America/Bogota (ya definido en timeSeriesChart).
  const fmtTimeLocal = (isoOrMs) => {
    const dt =
      typeof isoOrMs === "number"
        ? luxon.DateTime.fromMillis(isoOrMs, { zone: "utc" })
        : luxon.DateTime.fromISO(String(isoOrMs), { zone: "utc" });
    return dt.setZone("America/Bogota").toFormat("dd LLL yyyy · HH:mm:ss");
  };
  // UTC -> epoch ms (robusto)
  const toMsUTC = (v) => {
    if (v == null) return NaN;

    // 1) Date
    if (v instanceof Date) return v.getTime();

    // 2) Número (epoch ms)
    if (typeof v === "number") return v;

    // 3) String
    let s = String(v).trim();

    // 3.a ISO directo (acepta con o sin Z). Lo interpretamos en UTC.
    let dt = luxon.DateTime.fromISO(s, { zone: "utc" });
    if (dt.isValid) return dt.toMillis();

    // 3.b Formato SQL: "YYYY-MM-DD HH:mm:ss[.SSS]" (sin 'T')
    dt = luxon.DateTime.fromFormat(s, "yyyy-LL-dd HH:mm:ss.SSS", {
      zone: "utc",
    });
    if (dt.isValid) return dt.toMillis();

    dt = luxon.DateTime.fromFormat(s, "yyyy-LL-dd HH:mm:ss", { zone: "utc" });
    if (dt.isValid) return dt.toMillis();

    // 3.c Caso común: viene sin 'T' -> forzamos 'T' y 'Z'
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) {
      const isoLike = s.replace(" ", "T") + "Z";
      dt = luxon.DateTime.fromISO(isoLike, { zone: "utc" });
      if (dt.isValid) return dt.toMillis();
    }

    // 3.d String numérico (epoch ms)
    if (/^\d+$/.test(s)) return Number(s);

    // 4) No se pudo parsear
    return NaN;
  };

  /* ===========================
   * 1) Estado de sesión actual
   * =========================== */
  async function loadCommand() {
    statusBox.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>Cargando estado…`;
    footerNote.textContent = "—";
    try {
      const cmd = await commandService.getCommand();
      statusBox.innerHTML = renderSessionStatus(cmd);
      footerNote.textContent =
        cmd.command === "start"
          ? `La sesión termina a las ${fmtTimeLocal(cmd.expires_at)}.`
          : `No hay sesión activa.`;
    } catch (e) {
      console.error(e);
      statusBox.innerHTML = `
        <span class="text-danger">
          <i class="fas fa-exclamation-circle mr-1"></i>Error al consultar /admin/command
        </span>`;
      footerNote.textContent = "Ver consola para más detalles.";
    }
  }

  function renderSessionStatus(cmd) {
    if (cmd.command === "start") {
      return `
        <span class="badge badge-success mr-2"><i class="fas fa-check-circle mr-1"></i>Sesión activa</span>
        <span>Termina: <strong>${fmtTimeLocal(cmd.expires_at)}</strong></span>
      `;
    }
    return `
      <span class="badge badge-secondary mr-2"><i class="fas fa-pause-circle mr-1"></i>Sin sesión activa</span>
      <span>Puedes crear una nueva sesión cuando lo desees.</span>
    `;
  }

  /* ==========================================
   * 2) Crear nueva sesión (POST /activate)
   * ========================================== */
  function openConfirmModal() {
    $("#modal-new-session").modal("show");
  }

  async function createSession() {
    btnConfirmNew.disabled = true;
    btnConfirmNew.innerHTML = `<i class="fas fa-spinner fa-spin mr-1"></i>Creando…`;
    try {
      const res = await commandService.activate(); // { session_id, active_until, ... }
      $("#modal-new-session").modal("hide");
      await loadCommand();
      toastr?.success?.(
        `Sesión #${res.session_id} creada. Termina: ${fmtTimeLocal(
          res.active_until
        )}`,
        "OK"
      );
    } catch (e) {
      console.error(e);
      toastr?.error?.("No se pudo crear la sesión.");
    } finally {
      btnConfirmNew.disabled = false;
      btnConfirmNew.innerHTML = `<i class="fas fa-check mr-1"></i>Sí, crear`;
    }
  }

  /* ============================================================
   * 3) Última sesión culminada: gráfico + estadísticos del backend
   * ============================================================ */
  async function loadLastSession() {
    lastMeta.textContent = "Cargando…";
    meanEl.textContent =
      medianEl.textContent =
      modeEl.textContent =
      stddevEl.textContent =
      rangeEl.textContent =
        "—";

    try {
      // Estructura esperada:
      // { session_id, started_at, ended_at, data:[{device_recorded_at, ntu}], stats:{...} }
      const last = await sessionService.getLastSession();

      // Serie de puntos: UTC -> epoch ms
      const series = (last?.data || []).map((d) => ({
        x: toMsUTC(d.device_recorded_at),
        y: Number(d.ntu),
      }));

      // Meta de sesión
      const count = series.length;
      lastMeta.textContent = `Sesión #${
        last.session_id
      } — terminó: ${fmtTimeLocal(last.ended_at)} — muestras: ${count}`;

      // Instanciar chart si no existe
      if (!ntuChart) {
        ntuChart = new timeSeriesChart(chartCanvas, {
          label: "NTU",
          color: "#0d6efd",
          highlightDays: false,
        });
        ntuChart.setSpanGap(30_000); // une huecos ≤ 30 s
      }

      // Cargar datos
      ntuChart.load(series);
      console.log(series);

      // Ventana temporal EXACTA: UTC -> epoch ms
      const tStart = toMsUTC(last.started_at);
      const tEnd = toMsUTC(last.ended_at);

      // Elegir unidad por span
      const span = tEnd - tStart;
      const unit =
        span <= 2 * 60 * 1000
          ? "second"
          : span <= 60 * 60 * 1000
          ? "minute"
          : "hour";

      ntuChart.setWindowWithUnit(tStart, tEnd, unit);
      ntuChart.updateThresholdRange(tStart, tEnd); // si usas umbrales

      // Stats del backend (ya normalizados a 3 decimales)
      const s = last?.stats || {};
      const mean = Number(s.ntu_mean);
      const median = Number(s.ntu_median);
      const mode = s.ntu_mode;
      const stddev = Number(s.ntu_stddev);
      const range = Number(s.ntu_range);

      meanEl.textContent = Number.isFinite(mean) ? mean : "—";
      medianEl.textContent = Number.isFinite(median) ? median : "—";
      modeEl.textContent = Number.isFinite(Number(mode)) ? Number(mode) : "—";
      stddevEl.textContent = Number.isFinite(stddev) ? stddev : "—";
      rangeEl.textContent = Number.isFinite(range) ? range : "—";
    } catch (e) {
      console.error(e);
      lastMeta.textContent = "Error cargando datos de la última sesión.";
    }
  }

  /* ==========================
   * Listeners y primeras cargas
   * ========================== */
  btnNew?.addEventListener("click", openConfirmModal);
  btnConfirmNew?.addEventListener("click", createSession);
  btnReloadLast?.addEventListener("click", loadLastSession);

  await loadCommand();
  await loadLastSession();
}