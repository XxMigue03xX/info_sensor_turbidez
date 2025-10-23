/**
 * Vista: Histórico
 * - Pobla el <select> con todas las sesiones
 * - Carga la sesión seleccionada al pulsar "Ver sesión"
 * - La Caja 2 (gráfico + estadísticos) se usa tal cual como en Inicio
 */

import sessionService from "../services/sessionService.js";
import { timeSeriesChart } from "../components/timeSeriesChart.js";

let ntuChart;            // instancia de timeSeriesChart
let currentSessionId;    // última sesión cargada en el gráfico

export async function init() {
  // Referencias DOM (Caja 1)
  const selectEl = document.getElementById("select-session");
  const btnLoadSelected = document.getElementById("btn-load-selected");
  const btnReloadList = document.getElementById("btn-reload-sessions");
  const historicNote = document.getElementById("historic-footer-note");

  // Referencias DOM (Caja 2)
  const btnReloadChart = document.getElementById("btn-reload-last");
  const chartCanvas = document.getElementById("chart-last-session");
  const lastMeta = document.getElementById("last-session-meta");
  const meanEl = document.getElementById("stat-mean");
  const modeEl = document.getElementById("stat-mode");
  const medianEl = document.getElementById("stat-median");
  const stddevEl = document.getElementById("stat-stddev");
  const rangeEl = document.getElementById("stat-range");
  const countEl = document.getElementById("stat-count");

  // ===== Helpers de tiempo (mismos que Inicio) =====
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
    dt = luxon.DateTime.fromFormat(s, "yyyy-LL-dd HH:mm:ss.SSS", { zone: "utc" });
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

  // ===== UI helpers =====
  const setStatsLoading = () => {
    lastMeta.textContent = "Cargando…";
    meanEl.textContent =
      medianEl.textContent =
      modeEl.textContent =
      stddevEl.textContent =
      rangeEl.textContent =
        "—";
    if (countEl) countEl.textContent = "—";
  };

  const setStatsFrom = (stats) => {
    const s = stats || {};
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
  };

  const labelForSession = (s) => {
    // Tolerante: usa ended_at si existe; si no, active_until o started_at
    const endLike = s.active_until;
    const when = endLike ? fmtTimeLocal(endLike) : "sin fecha";
    return `#${s.session_id} — finalizada ${when}`;
  };

  // ===== Datos =====
  async function loadSessionsList() {
    try {
      historicNote.textContent = "Cargando listado…";
      selectEl.disabled = true;
      btnLoadSelected.disabled = true;

      const res = await sessionService.getAllSessions();
      const list = res.sessions;
      // Array de {session_id, ended_at, ...}
      const sessions = Array.isArray(list) ? list.slice() : (list?.items ?? []);
      // Ordénalas descendente por ended_at (o session_id)
      sessions.sort((a, b) => {
        const ams = toMsUTC(a.active_until ?? 0);
        const bms = toMsUTC(b.active_until ?? 0);
        return bms - ams || (b.session_id ?? 0) - (a.session_id ?? 0);
      });

      // Poblar <select>
      selectEl.innerHTML = "";
      if (!sessions.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "No hay sesiones registradas";
        selectEl.appendChild(opt);
        historicNote.textContent = "No hay sesiones para mostrar.";
        currentSessionId = undefined;
        return;
      }

      for (const s of sessions) {
        const opt = document.createElement("option");
        opt.value = s.session_id;
        opt.textContent = labelForSession(s);
        selectEl.appendChild(opt);
      }

      // Preselecciona la más reciente
      selectEl.value = sessions[0].session_id;
      currentSessionId = sessions[0].session_id;
      historicNote.textContent = "Selecciona una sesión y pulsa “Ver sesión”.";
      btnLoadSelected.disabled = false;
      selectEl.disabled = false;
    } catch (e) {
      console.error(e);
      historicNote.textContent = "Error cargando el listado de sesiones.";
      toastr?.error?.("No se pudo cargar el listado de sesiones.");
    } finally {
      btnLoadSelected.disabled = !selectEl.value;
    }
  }

  async function loadSessionById(sessionId) {
    if (!sessionId) return;
    setStatsLoading();

    try {
      // { session_id, started_at, ended_at, data:[{device_recorded_at, ntu}], stats:{...} }
      const res = await sessionService.getSessionById(sessionId);

      const series = (res?.data || []).map((d) => ({
        x: toMsUTC(d.device_recorded_at),
        y: Number(d.ntu),
      }));

      const count = series.length;
      lastMeta.textContent = `Sesión #${res.session_id} — Terminó: ${fmtTimeLocal(
        res.ended_at
      )} — Mediciones: ${count}`;
      if (countEl) countEl.textContent = String(count);

      if (!ntuChart) {
        ntuChart = new timeSeriesChart(chartCanvas, {
          label: "NTU",
          color: "#0d6efd",
          highlightDays: false,
        });
        ntuChart.setSpanGap(30_000);
      }

      ntuChart.load(series);

      const tStart = toMsUTC(res.started_at);
      const tEnd = toMsUTC(res.ended_at);
      const span = tEnd - tStart;
      const unit = span <= 2 * 60 * 1000 ? "second" : span <= 60 * 60 * 1000 ? "minute" : "hour";
      ntuChart.setWindowWithUnit(tStart, tEnd, unit);
      ntuChart.updateThresholdRange(tStart, tEnd);

      setStatsFrom(res?.stats);
      currentSessionId = res.session_id;
    } catch (e) {
      console.error(e);
      lastMeta.textContent = "Error cargando datos de la sesión seleccionada.";
      toastr?.error?.("No se pudo cargar la sesión seleccionada.");
    }
  }

  // ===== Listeners =====
  btnReloadList?.addEventListener("click", loadSessionsList);

  btnLoadSelected?.addEventListener("click", () => {
    const id = Number(selectEl.value);
    if (!id) return;
    loadSessionById(id);
  });

  btnReloadChart?.addEventListener("click", () => {
    const id = currentSessionId ?? Number(selectEl.value);
    if (!id) return;
    loadSessionById(id);
  });

  // ===== Primera carga =====
  await loadSessionsList();

  if (selectEl.value) {
    await loadSessionById(Number(selectEl.value));
  }
}