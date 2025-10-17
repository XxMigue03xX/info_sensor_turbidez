export async function loadHtmlInto(selector, url) {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`No se encontró ${selector}`);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Error cargando ${url} (${res.status})`);
  el.innerHTML = await res.text();
}

export function qs(sel, root = document) { return root.querySelector(sel); }
export function qsa(sel, root = document) { return [...root.querySelectorAll(sel)]; }