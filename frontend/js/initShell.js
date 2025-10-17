// js/initShell.js
import { renderNavbar }  from "./components/navbar.js";
import { renderSidebar } from "./components/sidebar.js";
import { initRouter }    from "./core/router.js";

window.addEventListener("DOMContentLoaded", async () => {
  // 1) monta el shell
  await Promise.all([renderNavbar(), renderSidebar()]);
  // 2) inicia el router (una sola vez)
  await initRouter();
});