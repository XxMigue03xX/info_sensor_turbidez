import { apiFetch } from "../core/apiClient.js";

/* ------------- helpers internos ---------------------------------- */
function persistSession({ token, user }) {
  localStorage.setItem("jwt", token);
  if (user)           // el backend ya lo envía
    localStorage.setItem("user", JSON.stringify(user));
  return { token, user };
}

/* ------------- API pública --------------------------------------- */
export async function login(email, password) {
  const session = await apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return persistSession(session);
}

export async function register(payload) {
  const session = await apiFetch("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return persistSession(session);
}

export function logout() {
  localStorage.removeItem("jwt");
  localStorage.removeItem("user");
  location.href = "index.html";
}

/**
 * Devuelve el *payload* decodificado del JWT y lanza logout()
 * si ha expirado.
 */
export function requireAuth() {
  const token = localStorage.getItem("jwt");
  if (!token) logout();

  const [, payloadB64] = token.split(".");
  const payload = JSON.parse(atob(payloadB64));

  if (Date.now() / 1000 >= payload.exp) logout();
  return payload;               // { user_id, role?, iat, exp, … }
}

/* -------------------------------------------------------------
   Devuelve el payload decodificado del JWT
   (alias de requireAuth para un nombre más descriptivo)
------------------------------------------------------------- */
export function getTokenData() {
  return requireAuth();   // retorna { user_id, role, iat, exp, … }
}

/**
 * Devuelve un objeto usuario completo:
 *  - Primero mira localStorage
 *  - Si no existe, lo trae de /usuarios/:id y lo cachea
 */
export async function getCurrentUser() {
  const cached = localStorage.getItem("user");
  if (cached) return JSON.parse(cached);

  const { user_id } = requireAuth();
  const user = await apiFetch(`/usuarios/${user_id}`);
  localStorage.setItem("user", JSON.stringify(user));
  return user;                  // { id, name, username, role, … }
}

export async function isAdmin() {
  const user = await getCurrentUser();
  return user?.role === "admin";
}