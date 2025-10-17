export async function renderNavbar() {
  const navbar = document.getElementById("navbar");
  navbar.innerHTML = `
    <div class="container">
      <a href="#/inicio" class="navbar-brand">
        <i class="fas fa-tint"></i> Info_Sensor_Turbidez
      </a>
      <button class="navbar-toggler order-1" type="button" data-toggle="collapse" data-target="#navbarCollapse">
        <span class="navbar-toggler-icon"></span>
      </button>

      <div class="collapse navbar-collapse order-3" id="navbarCollapse">
        <ul class="navbar-nav">
          <li class="nav-item"><a class="nav-link" href="#/inicio"><i class="fas fa-home mr-1"></i>Inicio</a></li>
          <li class="nav-item"><a class="nav-link" href="#/historico"><i class="fas fa-chart-line mr-1"></i>Histórico</a></li>
        </ul>
      </div>

      <ul class="order-1 order-md-3 navbar-nav navbar-no-expand ml-auto">
        <li class="nav-item d-none d-md-inline">
          <span class="nav-link text-muted small">v1.0</span>
        </li>
      </ul>
    </div>
  `;
}