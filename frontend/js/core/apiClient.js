/* -------------------------------------------------------------
   apiClient.js
   Enrutador único de peticiones HTTP (fetch) con manejo de JWT,
   cabeceras JSON y control de respuestas vacías o no-JSON.
------------------------------------------------------------- */

// Base API relativa al mismo host
const API_BASE = new URL('/api', window.location.origin).href;

/**
 * apiFetch(endpoint, options = {})
 *  - endpoint: string   → Ej. "/usuarios"
 */
export async function apiFetch(endpoint, options = {}) {
  const {
    fetchOpts
  } = options;

  const token = localStorage.getItem("jwt");
  const headers = {
    ...(fetchOpts.body ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...fetchOpts.headers,
  };

  const res = await fetch(`${API_BASE}${endpoint}`, { ...fetchOpts, headers });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(err || `${res.status} ${res.statusText}`);
  }
  if ([204, 205].includes(res.status)) return {};

  /* —— Texto / JSON —— */
  const txt = await res.text();
  if (!txt) return {};
  try {
    return JSON.parse(txt);
  } catch {
    return txt;
  }
}