<?php
declare(strict_types=1);

/**
 * Router maestro – incluye cada archivo de rutas en orden.
 * Si una ruta maneja la petición, el archivo devuelve true
 * y la ejecución se detiene. De lo contrario, al final 404.
 *
 * Requisitos/Convenciones:
 *  - Cada archivo de rutas debe hacer `return true` si atendió la petición; de lo contrario `return false`.
 *  - `sendResponse(mixed $data, int $status=200)` está disponible para salidas JSON/HTTP.
 */

// Asegura helpers disponibles (db, request_method, request_path, sendResponse)
if (!function_exists('request_method') || !function_exists('request_path')) {
    require_once __DIR__ . '/../config.php';
}

// === Método y path normalizados desde config.php ===
$method = request_method();   // GET/POST/...
$uri    = request_path();     // path relativo al script (sin prefijos del directorio)

// Orden de carga de módulos de rutas.
// Importante: el orden puede afectar resoluciones si hay patrones solapados.
$routes = [
    __DIR__ . '/SessionsRoutes.php',
    __DIR__ . '/CommandsRoutes.php',
];

// Itera módulos de rutas. Cada módulo usa $method y $uri ya normalizados
foreach ($routes as $file) {
    if (!is_file($file)) {
        // Si falta el archivo, continúa (útil en desarrollo)
        continue;
    }
    // Cada archivo de rutas debe devolver true si atendió la petición
    if (require $file) {
        return;
    }
}

// Si llega aquí => no hubo match
sendResponse(['error' => 'Endpoint no encontrado', 'method' => $method, 'path' => $uri], 404);