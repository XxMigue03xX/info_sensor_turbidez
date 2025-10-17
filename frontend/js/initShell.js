import { renderNavbar } from "./components/navbar.js";
import { initRouter }   from "./core/router.js";

window.addEventListener("DOMContentLoaded", async () => {
  await renderNavbar();
  await initRouter();
});