/**
 * Vista: Inicio
 */

import commandService from "../services/commandService.js";
import sessionService from "../services/sessionService.js";
import { timeSeriesChart } from "../components/timeSeriesChart.js";

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
  const countEl = document.getElementById("stat-count");
  let ntuChart; // instancia de timeSeriesChart
  let pollingTimer = null;

  function resetStatsAndChart() {
    lastMeta.textContent = "—";
    meanEl.textContent =
      medianEl.textContent =
      modeEl.textContent =
      stddevEl.textContent =
      rangeEl.textContent =
        "—";
    if (countEl) countEl.textContent = "—";

    if (ntuChart) {
      // Vacía la serie; el propio wrapper se encarga de actualizar el chart interno
      ntuChart.load([]);
    }
  }

  function startRealtimePolling() {
    if (pollingTimer) {
      clearInterval(pollingTimer);
    }
    // llamada inicial inmediata
    loadLastSession().catch(console.error);
    // polling cada 5 s
    pollingTimer = setInterval(() => {
      loadLastSession().catch(console.error);
    }, 5000);
  }

  function stopRealtimePolling() {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
  }

  // Helpers de tiempo
  const fmtTimeLocal = (isoOrMs) => {
    const dt =
      typeof isoOrMs === "number"
        ? luxon.DateTime.fromMillis(isoOrMs, { zone: "utc" })
        : luxon.DateTime.fromISO(String(isoOrMs), { zone: "utc" });
    return dt.setZone("America/Bogota").toFormat("dd LLL yyyy · HH:mm:ss");
  };
  const toMsUTC = (v) => {
    if (v == null) return NaN;
    if (v instanceof Date) return v.getTime();
    if (typeof v === "number") return v;
    let s = String(v).trim();
    let dt = luxon.DateTime.fromISO(s, { zone: "utc" });
    if (dt.isValid) return dt.toMillis();
    dt = luxon.DateTime.fromFormat(s, "yyyy-LL-dd HH:mm:ss.SSS", {
      zone: "utc",
    });
    if (dt.isValid) return dt.toMillis();
    dt = luxon.DateTime.fromFormat(s, "yyyy-LL-dd HH:mm:ss", { zone: "utc" });
    if (dt.isValid) return dt.toMillis();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) {
      const isoLike = s.replace(" ", "T") + "Z";
      dt = luxon.DateTime.fromISO(isoLike, { zone: "utc" });
      if (dt.isValid) return dt.toMillis();
    }
    if (/^\d+$/.test(s)) return Number(s);
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
          ? `Sesión activa: finaliza a las ${fmtTimeLocal(cmd.expires_at)}.`
          : `No hay sesión activa.`;

      // Controlar el polling según haya sesión activa o no
      if (cmd.command === "start") {
        startRealtimePolling();
      } else {
        stopRealtimePolling();
      }
    } catch (e) {
      console.error(e);
      statusBox.innerHTML = `
      <span class="text-danger">
        <i class="fas fa-exclamation-circle mr-1"></i>Error al consultar /admin/command
      </span>`;
      footerNote.textContent = "Ver consola para más detalles.";
      // Si hay error, por seguridad detiene polling
      stopRealtimePolling();
    }
  }

  function renderSessionStatus(cmd) {
    if (cmd.command === "start") {
      return `
        <span class="badge badge-success mr-2">
          <i class="fas fa-check-circle mr-1"></i>Sesión activa
        </span>
        <span>Termina: <strong>${fmtTimeLocal(cmd.expires_at)}</strong></span>
      `;
    }
    return `
      <span class="badge badge-secondary mr-2">
        <i class="fas fa-pause-circle mr-1"></i>Sin sesión activa
      </span>
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

      // Limpiar gráfico + stats al crear la nueva sesión
      resetStatsAndChart();

      await loadCommand(); // esto activará startRealtimePolling() si command === "start"

      // Usar window.toastr para evitar ReferenceError si toastr no está cargado
      if (window.toastr?.success) {
        window.toastr.success(
          `Sesión #${res.session_id} creada. Termina: ${fmtTimeLocal(
            res.active_until
          )}`,
          "OK"
        );
      }
    } catch (e) {
      console.error(e);
      if (window.toastr?.error) {
        window.toastr.error("No se pudo crear la sesión.");
      }
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
    countEl && (countEl.textContent = "—");

    try {
      // Estructura esperada:
      // { session_id, started_at, ended_at|null, data:[{device_recorded_at, ntu}], stats:{...} }
      const last = await sessionService.getLastSession();

      if (!last) {
        lastMeta.textContent = "No hay sesiones registradas todavía.";
        resetStatsAndChart();
        return;
      }

      const series = (last.data || []).map((d) => ({
        x: toMsUTC(d.device_recorded_at),
        y: Number(d.ntu),
      }));

      const count = series.length;
      const hasEnded = Boolean(last.ended_at);

      if (hasEnded) {
        lastMeta.textContent = `Sesión #${
          last.session_id
        } — Terminó: ${fmtTimeLocal(last.ended_at)} — Mediciones: ${count}`;
      } else {
        lastMeta.textContent = `Sesión #${last.session_id} — En progreso — Mediciones: ${count}`;
      }

      countEl && (countEl.textContent = String(count));

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

      // Ventana temporal:
      const tStart = toMsUTC(last.started_at);
      let tEnd;

      if (hasEnded) {
        tEnd = toMsUTC(last.ended_at);
      } else if (series.length > 0) {
        // Si está en progreso, usamos el último punto como "fin" provisional
        tEnd = series[series.length - 1].x;
      } else {
        // Sin datos aún: ventana mínima alrededor de start
        tEnd = tStart + 5 * 60 * 1000; // 5 minutos arbitrarios
      }

      const span = tEnd - tStart;
      const unit =
        span <= 2 * 60 * 1000
          ? "second"
          : span <= 60 * 60 * 1000
          ? "minute"
          : "hour";

      ntuChart.setWindowWithUnit(tStart, tEnd, unit);
      ntuChart.updateThresholdRange(tStart, tEnd);

      // Stats del backend (parcial si la sesión va en curso)
      const s = last.stats || {};
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
      lastMeta.textContent = "Error cargando datos de la sesión.";
    }
  }

  /* ==========================
   * Listeners y primeras cargas
   * ========================== */
  btnNew?.addEventListener("click", openConfirmModal);
  btnConfirmNew?.addEventListener("click", createSession);
  btnReloadLast?.addEventListener("click", () => {
    loadLastSession().catch(console.error);
  });

  // Primero, saber si hay sesión activa
  await loadCommand();
  // Cargar una primera vez lo que sea la "última sesión" conocida
  await loadLastSession();
}