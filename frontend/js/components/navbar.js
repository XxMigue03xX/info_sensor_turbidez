/* -----------------------------------------------------------
   BeeMonitor – Navbar sin dependencias de jQuery
   ----------------------------------------------------------- */
import {
  requireAuth,
  logout,
  getCurrentUser,
} from "../services/authService.js";

export async function renderNavbar() {
  /* ---------- Datos de sesión ---------- */
  const payload = requireAuth(); // { role, exp, ... }
  const user = await getCurrentUser(); // { username, name, ... }

  /* ---------- HTML del navbar ---------- */
  const navbar = document.getElementById("navbar");
  navbar.innerHTML = `
  <!-- Botón hamburguesa controlado 100 % por AdminLTE -->
   <ul class="navbar-nav">
     <li class="nav-item">
      <a href="#" class="nav-link"
         id="toggleSidebar"
         data-widget="pushmenu"         /* ← activa plugin */
         role="button">
         <i class="fas fa-bars"></i>
       </a>
     </li>
   </ul>

  <!-- Menú de usuario -->
  <ul class="navbar-nav ml-auto">
    <li class="nav-item dropdown" id="userDropdown">
      <a href="#" class="nav-link d-flex align-items-center">
        <i class="far fa-user pr-1"></i>
        <span id="userLabel">${user.name || user.username}</span>
        <i class="fas fa-caret-down pl-1"></i>
      </a>

      <div class="dropdown-menu dropdown-menu-right">
        <!-- Enlace a Mi perfil -->
        <a href="myUser" class="dropdown-item" id="myProfileLink" data-hash="myUser">
          <i class="fas fa-id-badge mr-2"></i> Mi perfil
        </a>
        <div class="dropdown-divider"></div>
        <a href="#" class="dropdown-item" id="logoutBtn">
          <i class="fas fa-sign-out-alt mr-2"></i> Cerrar sesión
        </a>
      </div>
    </li>
  </ul>
`;

  /* ---------- Interacciones ---------- */
  const dropdownLi = navbar.querySelector("#userDropdown");
  const logoutBtn = navbar.querySelector("#logoutBtn");
  const myProfileLink = navbar.querySelector("#myProfileLink");
  const menu = dropdownLi.querySelector(".dropdown-menu");

  // 1) Mostrar / ocultar menú de usuario (vanilla)
  dropdownLi.addEventListener("click", (e) => {
    e.preventDefault(); // evita cambiar hash
    e.stopPropagation(); // no propaga al documento
    menu.classList.toggle("show");
  });

  // 2) Cerrar menú si hago clic fuera
  document.addEventListener("click", () => menu.classList.remove("show"));

  // 3) Logout
  logoutBtn.addEventListener("click", (e) => {
    e.preventDefault();
    logout();
  });

  // 4) Navegar a «Mi usuario»
  myProfileLink.addEventListener("click", (e) => {
    e.preventDefault();          // evita navegación cancelada por <li>
    e.stopPropagation();         // no deja burbujarlo al listener del li
    menu.classList.remove("show");
    location.hash = "#myUser";   // dispara el router
  });
}
