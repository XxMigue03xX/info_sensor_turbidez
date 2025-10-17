import { apiFetch } from "../core/apiClient.js";

let chart = null;

export async function init() {
  const ctx = document.getElementById("chart-turbidity");
  const list = document.getElementById("history-list");
  const btn  = document.getElementById("btn-hist-refresh");

  async function load() {
    try {
      const series = await apiFetch("/turbidity/series?last=120"); // 120 muestras
      const data = series.map(d => ({ x: new Date(d.ts), y: Number(d.ntu) }));

      if (!chart) {
        chart = new Chart(ctx.getContext("2d"), {
          type: "line",
          data: { datasets: [{ label: "NTU", data, borderWidth: 2, tension: 0.25, pointRadius: 0 }] },
          options: {
            parsing: false,
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: { type: "time", time: { tooltipFormat: "HH:mm:ss" }, title: { display: true, text: "Tiempo" } },
              y: { title: { display: true, text: "NTU" } }
            }
          }
        });
      } else {
        chart.data.datasets[0].data = data;
        chart.update();
      }

      // lista últimas 20
      list.innerHTML = "";
      series.slice(-20).reverse().forEach(d => {
        const li = document.createElement("li");
        li.className = "mb-1";
        li.textContent = `${new Date(d.ts).toLocaleTimeString()} — ${Number(d.ntu).toFixed(2)} NTU`;
        list.appendChild(li);
      });

    } catch (e) {
      console.error(e);
    }
  }

  btn?.addEventListener("click", load);
  await load();
}