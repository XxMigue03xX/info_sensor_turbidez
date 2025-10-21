/**
 * Vista: Inicio
 * - Consulta /command para mostrar si hay sesión activa y su hora de finalización.
 * - Botón "Nueva sesión" con modal de confirmación que hace POST /session.
 * - Carga la última sesión culminada (GET /sessions/last) y grafica 60 NTU con Chart.js.
 * - Calcula Mediana y Moda de esos 60 valores.
 */

import { apiFetch } from "../core/apiClient.js";

let chart; // instancia Chart.js reutilizable

export async function init() {
  // Referencias DOM
  const statusBox      = document.getElementById("session-status");
  const footerNote     = document.getElementById("session-footer-note");
  const btnNew         = document.getElementById("btn-new-session");
  const btnConfirmNew  = document.getElementById("btn-confirm-new-session");
  const btnReloadLast  = document.getElementById("btn-reload-last");
  const lastMeta       = document.getElementById("last-session-meta");
  const meanEl         = document.getElementById("stat-mean");
  const medianEl       = document.getElementById("stat-median");
  const modeEl         = document.getElementById("stat-mode");
  const chartCanvas    = document.getElementById("chart-last-session");

  // Helpers de formato
  const fmtTime = (s) => new Date(s).toLocaleString();

  /* ===========================
   * 1) Estado de sesión actual
   * =========================== */
  async function loadCommand() {
    statusBox.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>Cargando estado…`;
    footerNote.textContent = "—";

    try {
      const cmd = await apiFetch("/admin/command"); // { active: boolean, active_until?: string }
      statusBox.innerHTML = renderSessionStatus(cmd);
      footerNote.textContent = cmd.active
        ? `La sesión terminará a las ${fmtTime(cmd.active_until)}.`
        : `No hay sesión activa.`;
    } catch (e) {
      console.error(e);
      statusBox.innerHTML = `
        <span class="text-danger">
          <i class="fas fa-exclamation-circle mr-1"></i>Error al consultar /command
        </span>`;
      footerNote.textContent = "Ver consola para más detalles.";
    }
  }

  function renderSessionStatus(cmd) {
    if (cmd.active) {
      return `
        <span class="badge badge-success mr-2"><i class="fas fa-check-circle mr-1"></i>Sesión activa</span>
        <span>Termina: <strong>${fmtTime(cmd.active_until)}</strong></span>
      `;
    }
    return `
      <span class="badge badge-secondary mr-2"><i class="fas fa-pause-circle mr-1"></i>Sin sesión activa</span>
      <span>Puedes crear una nueva sesión cuando lo desees.</span>
    `;
  }

  /* ===================================
   * 2) Crear nueva sesión (POST /session)
   * =================================== */
  function openConfirmModal() {
    // Bootstrap modal (AdminLTE usa Bootstrap 4)
    $("#modal-new-session").modal("show");
  }

  async function createSession() {
    btnConfirmNew.disabled = true;
    btnConfirmNew.innerHTML = `<i class="fas fa-spinner fa-spin mr-1"></i>Creando…`;
    try {
      const res = await apiFetch("/activate", { method: "POST", body: JSON.stringify({}) });
      // Cerrar modal y recargar estado
      $("#modal-new-session").modal("hide");
      await loadCommand();
      // Feedback
      toastr?.success?.(`Sesión #${res.session_id} creada. Termina: ${fmtTime(res.active_until)}`, "OK");
    } catch (e) {
      console.error(e);
      toastr?.error?.("No se pudo crear la sesión.");
    } finally {
      btnConfirmNew.disabled = false;
      btnConfirmNew.innerHTML = `<i class="fas fa-check mr-1"></i>Sí, crear`;
    }
  }

  /* ============================================================
   * 3) Última sesión culminada: gráfico + estadísticas descriptivas
   * ============================================================ */
  async function loadLastSession() {
    lastMeta.textContent = "Cargando…";
    meanEl.textContent = medianEl.textContent = modeEl.textContent = "—";

    try {
      /** Esperado:
       * { session_id: number, ended_at: string, data: [{ ts, ntu }, ... ] } con longitud 60
       */
      const last = await apiFetch("/session/last");
      const series = (last?.data || []).map(d => ({ x: new Date(d.ts), y: Number(d.ntu) }));

      // Meta de sesión
      const count = series.length;
      lastMeta.textContent = `Sesión #${last.session_id} — terminó: ${fmtTime(last.ended_at)} — muestras: ${count}`;

      // Gráfico
      renderOrUpdateChart(chartCanvas, series);

      // Estadísticos con los y
      const values = series.map(p => p.y);
      const { mean, median, mode } = calcStats(values);

      meanEl.textContent   = isFinite(mean)   ? mean.toFixed(2)   : "—";
      medianEl.textContent = isFinite(median) ? median.toFixed(2) : "—";
      modeEl.textContent   = Array.isArray(mode)
        ? (mode.length ? mode.map(v => v.toFixed(2)).join(", ") : "—")
        : (isFinite(mode) ? mode.toFixed(2) : "—");

    } catch (e) {
      console.error(e);
      lastMeta.textContent = "Error cargando datos de la última sesión.";
    }
  }

  function renderOrUpdateChart(canvas, series) {
    const data = {
      datasets: [
        {
          label: "NTU",
          data: series,
          borderWidth: 2,
          tension: 0.25,
          pointRadius: 0
        },
      ],
    };
    const options = {
      parsing: false,
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { type: "time", time: { tooltipFormat: "HH:mm:ss" }, title: { display: true, text: "Tiempo" } },
        y: { title: { display: true, text: "NTU" }, ticks: { precision: 2 } }
      },
      plugins: { legend: { display: false } }
    };

    if (!chart) {
      chart = new Chart(canvas.getContext("2d"), { type: "line", data, options });
    } else {
      chart.data = data;
      chart.options = options;
      chart.update();
    }
  }

  /** ==========================
   * Estadísticos: media, mediana, moda
   *  - media: promedio aritmético
   *  - mediana: valor central (o promedio de los 2 centrales si N par)
   *  - moda: valor(es) con mayor frecuencia (resolución 2 decimales para agrupar)
   * =========================== */
  function calcStats(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return { mean: NaN, median: NaN, mode: [] };

    const n = arr.length;
    const sum = arr.reduce((a, b) => a + b, 0);
    const mean = sum / n;

    const sorted = [...arr].sort((a, b) => a - b);
    const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;

    // Agrupar por valor con redondeo a 2 decimales para evitar “modas” por ruido flotante
    const freq = new Map();
    for (const v of arr) {
      const key = Number(v.toFixed(2));
      freq.set(key, (freq.get(key) || 0) + 1);
    }
    const maxF = Math.max(...freq.values());
    const mode = [...freq.entries()]
      .filter(([_, f]) => f === maxF)
      .map(([k]) => Number(k))
      .sort((a, b) => a - b);

    return { mean, median, mode };
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