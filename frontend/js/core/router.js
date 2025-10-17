// mapa de rutas (hash -> archivo HTML)
const routes = {
  inicio: "pages/inicio.html",
  historico: "pages/historico.html",
};

let currentView = null;   // guarda la vista actual para evitar recargas innecesarias
let routerStarted = false;

async function loadView(view) {
  const file = routes[view] || routes["inicio"];
  const res = await fetch(file, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar ${file}`);
  const html = await res.text();

  const content = document.getElementById("content");
  if (!content) throw new Error("No existe el contenedor #content");
  content.innerHTML = html;

  // Cargar JS específico de la vista si existe
  try {
    const module = await import(`../views/${view}View.js`);
    if (module?.init) await module.init();
  } catch (err) {
    // opcional: silenciar si no existe el módulo de la vista
    // console.debug(`Sin controlador para la vista ${view}`);
  }
}

async function navigateTo(hash) {
  const view = hash?.replace(/^#/, "") || "inicio";
  const exists = !!routes[view];

  // normaliza hash inválido hacia #inicio (y evita bucle si ya estamos)
  if (!exists) {
    if (location.hash !== "#inicio") {
      history.replaceState(null, "", "#inicio");
    }
    return navigateTo("#inicio");
  }

  // evita recarga de la misma vista en bucle
  if (currentView === view) return;

  currentView = view;
  await loadView(view);
}

function onHashChange() {
  // Solo navega a la ruta actual
  navigateTo(location.hash);
}

export async function initRouter() {
  if (routerStarted) return;
  routerStarted = true;

  // listeners
  window.addEventListener("hashchange", onHashChange);

  // primera navegación
  await navigateTo(location.hash);
}