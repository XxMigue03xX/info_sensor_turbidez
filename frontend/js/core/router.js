import { loadHtmlInto } from "../utils/dom.js";

const routes = {
  inicio:    { page: "pages/inicio.html",    controller: () => import("../views/inicioView.js") },
  historico: { page: "pages/historico.html", controller: () => import("../views/historicoView.js") },
};

let currentView = null;
let started = false;

function parseHash() {
  const raw = (location.hash || "").replace(/^#\/?/, "");
  const [view] = raw.split("?");
  return view || "inicio";
}

async function loadRoute(viewName) {
  const route = routes[viewName] || routes.inicio;
  if (currentView === viewName) return;         // evita recargar lo mismo
  currentView = viewName;

  await loadHtmlInto("#content", route.page);   // inyecta HTML
  try {
    const mod = await route.controller();       // carga controlador si existe
    if (typeof mod.init === "function") await mod.init();
  } catch (e) {
    // si no hay controlador, no es error
    // console.debug(`Vista ${viewName} sin controlador específico`, e);
  }
}

function onHashChange() {
  loadRoute(parseHash());
}

export async function initRouter() {
  if (started) return;
  started = true;

  window.addEventListener("hashchange", onHashChange);
  // primera navegación (normaliza hash)
  if (!location.hash) {
    history.replaceState(null, "", "#/inicio");
  }
  await loadRoute(parseHash());
}