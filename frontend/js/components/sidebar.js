/* -----------------------------------------------------------
   BeeMonitor – componente Sidebar
   ----------------------------------------------------------- */
import { requireAuth } from "../services/authService.js";

/* Menú principal; cada entrada define roles que lo pueden ver */
const MENU = [
  { hash: "users", icon: "users", text: "Usuarios", roles: ["admin"] },
  {
    hash: "dashboard",
    icon: "tachometer-alt",
    text: "Dashboard",
    roles: ["admin", "user"],
  },
  {
    hash: "apiaries",
    icon: "tree",
    text: "Apiarios",
    roles: ["admin", "user"],
  },
  { hash: "hives", icon: "cubes", text: "Colmenas", roles: ["admin", "user"] },
  {
    hash: "devices",
    icon: "microchip",
    text: "Dispositivos",
    roles: ["admin", "user"],
  },
  { hash: "data", icon: "chart-line", text: "Datos", roles: ["admin", "user"] },
  {
    hash: "alerts",
    icon: "exclamation-triangle",
    text: "Alertas",
    roles: ["admin", "user"],
  },
  /* ── PRUEBA de zoom Chart.js ── */
  // {
  //   url: "zoom-test.html",          // ← enlace absoluto
  //   icon: "search-plus",
  //   text: "Test Zoom",
  //   roles: ["admin", "user"],
  // }
];

export function renderSidebar() {
  const user = requireAuth();
  const sidebar = document.getElementById("sidebar");

  sidebar.innerHTML = `
    <!-- Brand -->
    <a href="#dashboard" class="brand-link">
      <img src="assets/img/logo.png" alt="BeeMonitor"
           class="brand-image img-circle elevation-3" style="opacity:.85">
      <span class="brand-text font-weight-light">BeeMonitor</span>
    </a>

    <!-- Menu -->
    <div class="sidebar">
      <nav class="mt-2">
        <ul class="nav nav-pills nav-sidebar flex-column" role="menu">
            ${MENU.filter((m) => m.roles.includes(user.role))
            .map(
              (m) => `
                   <li class="nav-item">
                     <a href="#${m.hash}" class="nav-link" data-hash="${m.hash}">
                       <i class="nav-icon fas fa-${m.icon}"></i>
                       <p>${m.text}</p>
                     </a>
                   </li>
                 `
            )
            .join("")}
        </ul>
      </nav>
    </div>
  `;

  highlightActive(); // primera marca
  window.addEventListener("hashchange", highlightActive);

  /* ---------------- Auto-cerrar (solo < 992 px) usando el plugin ------ */
  sidebar.querySelectorAll("a.nav-link").forEach((a) => {
    a.addEventListener("click", () => {
      if (window.innerWidth < 992) {
        $('[data-widget="pushmenu"]').PushMenu('collapse');
      }
    });
  });

  /*– resalta enlace actual –*/
  function highlightActive() {
    const current = location.hash.replace("#", "") || "dashboard";
    sidebar.querySelectorAll("a.nav-link").forEach((a) => {
      a.classList.toggle("active", a.dataset.hash === current);
    });
  }
}
            //* Prueba de zoom chart.js
            // ${MENU.filter((m) => m.roles.includes(user.role))
            // .map((m) =>
            //   m.url
            //     ? `
            //          <li class="nav-item">
            //            <a href="${m.url}" class="nav-link" target="_self">
            //              <i class="nav-icon fas fa-${m.icon}"></i>
            //              <p>${m.text}</p>
            //            </a>
            //          </li>`
            //     : `
            //          <li class="nav-item">
            //            <a href="#${m.hash}" class="nav-link" data-hash="${m.hash}">
            //              <i class="nav-icon fas fa-${m.icon}"></i>
            //              <p>${m.text}</p>
            //            </a>
            //          </li>`
            // )
            // .join("")}