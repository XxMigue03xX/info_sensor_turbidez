import { apiFetch } from "../core/apiClient.js";
export const dashboardService = {
  getSummary: () => apiFetch("/dashboard/resumen"),
};
