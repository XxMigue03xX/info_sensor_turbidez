import { apiFetch } from "../core/apiClient.js";

export async function init() {
  const lastNtu = document.getElementById("last-ntu");
  const lastTs  = document.getElementById("last-ts");
  const countEl = document.getElementById("sample-count");
  const btn     = document.getElementById("btn-refresh");

  async function load() {
    try {
      // Ajusta a tus endpoints reales
      const latest = await apiFetch("/turbidity/latest"); // { ts, ntu }
      const series = await apiFetch("/turbidity/series?last=60"); // [{ts, ntu}, ...]

      lastNtu.textContent = Number(latest.ntu).toFixed(1);
      lastTs.textContent  = latest.ts ? new Date(latest.ts).toLocaleTimeString() : "—";
      countEl.textContent = series.length;
    } catch (e) {
      console.error(e);
      lastNtu.textContent = lastTs.textContent = "—";
      countEl.textContent = "0";
    }
  }

  btn?.addEventListener("click", load);
  await load();
}