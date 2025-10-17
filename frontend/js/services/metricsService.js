/* ──────────────────────────────────────────────────────────────
   MÉTRICAS – optimizado para usar /dashboard/resumen
──────────────────────────────────────────────────────────────── */
import { dashboardService } from "./dashboardService.js";

const DAY_MS = 86_400_000;

/* -------------------------------------------------------------
   Resumen global del dashboard
   (reemplaza el antiguo fan-out de peticiones)
------------------------------------------------------------- */
export async function getSummary() {
  // 1 request → backend ya entrega todo agregado
  const { summary, apiaries } = await dashboardService.getSummary();

  // Aplana las colmenas e inyecta datos útiles para la vista
  const hives = apiaries.flatMap((a) =>
    (a.hives || []).map((h) => ({
      ...h,
      apiary_id: a.id,
      apiary_internal_code: a.internal_code,
      apiary_name: a.name,
    }))
  );

  const alerts = buildLastAlerts(apiaries);

  return {
    apiaryCount: summary.apiaryCount,
    hiveCount: summary.hiveCount,
    deviceCount: summary.deviceCount,
    alerts24h: summary.alerts24h,
    readings24h: summary.readings24h,
    apiaries,
    hives,
    alerts,
  };
}

//* Construye lista de alertas recientes
function buildLastAlerts(apiaries) {
  const alerts = [];

  for (const apiary of apiaries) {
    if (!apiary.hives) continue;

    for (const hive of apiary.hives) {
      if (!hive.lastAlerts) continue; // sin alerta
      else {
        for (const alert of hive.lastAlerts){
          if (!isRecentAlert(alert)) continue; // alerta vieja
    
          /* ── Enriquecer alerta con origen ───────────────────────── */
          alerts.push({
            ...alert,
            apiary_internal_code: apiary.internal_code,
            apiary_name:          apiary.name,
            hive_internal_code:   hive.internal_code,
            hive_name:            hive.name,
          });
        }
      }
    }
  }

  // Ordenar in-place: más reciente primero
  alerts.sort((a, b) => new Date(b.recorded_at_iso) - new Date(a.recorded_at_iso));

  return alerts;
}

/* -------------------------------------------------------------
   Wrappers finos todavía necesarios en otras vistas
------------------------------------------------------------- */

export const isRecentAlert = (alert) => {
  const now = new Date();
  const alertDate = new Date(alert.recorded_at_iso);
  return now - alertDate < DAY_MS;
};

/* -------------------------------------------------------------
   Utilidades varias
------------------------------------------------------------- */
/**
 * Convierte un objeto Date a string con formato ISO local (MySQL compatible)
 * usando la zona horaria del navegador.
 *
 * Ejemplo de salida: "2025-06-09 11:15:00"
 */
export function toISO(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 19).replace("T", " ");
}

export function humanAlert(t) {
  return { temperature: "Temperatura", humidity: "Humedad" }[t] ?? t ?? "–";
}

export function timeAgo(dateString) {
  const diffMs = Date.now() - new Date(dateString).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Hace segundos";
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `Hace ${diffHr} h`;
  const diffD = Math.floor(diffHr / 24);
  return `Hace ${diffD} día${diffD !== 1 ? "s" : ""}`;
}