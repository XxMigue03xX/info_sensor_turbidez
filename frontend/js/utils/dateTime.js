const DateTime = luxon.DateTime;

/* 🔸 Convierte ms → ISO “yyyy-MM-ddTHH:mm” (sin segundos)  */
export const msToISO = (ms) =>
    typeof ms === "number" 
        ? DateTime.fromMillis(ms).toFormat("yyyy-LL-dd'T'HH:mm")
        : "";

/* 🔸 Calcula la diferencia en días entre fechas  */
export const diffDays = (d1ISO, d2ISO) =>
    (Date.parse(d2ISO) - Date.parse(d1ISO)) / 86_400_000;