// Servicios para endpoints de sesiones.

import { apiFetch } from "../core/apiClient.js";

const sessionService = {
  /**
   * GET /session
   * @returns {Promise<GetCommandResponse>}
  */
  async getLastSession() {
    return apiFetch("/session", {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  },

  /**
   * GET /session/{id}
   * @returns {Promise<GetCommandResponse>}
  */
  async getLastSession(id) {
    return apiFetch(`/session/${id}}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  },

  /**
   * GET /session/last
   * @returns {Promise<GetCommandResponse>}
  */
  async getLastSession() {
    return apiFetch("/session/last", {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  },

  /**
   * POST /activate
   * @returns {Promise<ActivateSessionResponse>}
   */
  async activate() {
    return apiFetch("/activate", {
      method: "POST",
      headers: { Accept: "application/json" },
    });
  },
};

export default sessionService;