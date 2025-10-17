const API_BASE = "/info_sensor_turbidez/api"; // ajusta si es necesario

function getToken() {
  return localStorage.getItem("X_AUTH_TOKEN") || "";
}

export async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("X-Auth-Token", token);

  const res = await fetch(API_BASE + path, { ...options, headers, credentials: "omit" });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} - ${txt || res.statusText}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}