// Servicios para endpoints de comando del ESP32.

import { apiFetch } from "../core/apiClient.js";

const commandService = {
  /**
   * GET /admin/command
   * @returns {Promise<GetCommandResponse>}
   */
  async getCommand() {
    return apiFetch("/admin/command", {
      method: "GET",
      cache: "no-store",
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

export default commandService;