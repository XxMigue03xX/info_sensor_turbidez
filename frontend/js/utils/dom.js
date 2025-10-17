export function disableDateInputs(dis) {
  ["inpDesde", "inpHasta", "btnBuscar"].forEach((id) => {
    document.getElementById(id).disabled = dis;
  });
}

export function showLoader(on) {
  let div = document.getElementById("histLoader");
  if (on && !div) {
    div = document.createElement("div");
    div.id = "histLoader";
    div.className =
      "overlay d-flex flex-column justify-content-center align-items-center";
    div.innerHTML = `<i class="fas fa-spinner fa-spin fa-2x mb-2"></i>Cargando…`;
    document.querySelector("#dataView .container-fluid").prepend(div);
  } else if (!on && div) {
    div.remove();
  }
}