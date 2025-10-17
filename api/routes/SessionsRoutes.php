<?php
declare(strict_types=1);

/**
 * Rutas de sesiones
 * Endpoints:
 *  - POST /activate                -> crear sesión activa (ventana de captura)
 *  - GET  /session                 -> listar sesiones (paginado)
 *  - GET  /session/{session_id}    -> detalle de una sesión
 */

require_once __DIR__ . '/../middleware/Auth.php';
require_once __DIR__ . '/../controllers/SessionController.php';
require_once __DIR__ . '/../controllers/MeasurementController.php';

$pdo = db();

/* ===== /session ===== */
if ($uri === '/session') {
    if ($method !== 'GET' and $method !== 'POST') {
        header('Allow: GET, POST');
        sendResponse(['error' => 'Método no permitido'], 405);
    }
    if ($method === 'GET'){
        // /GET listar sesiones
        SessionController::list($pdo);
    }
    else if ($method === 'POST'){
        // /POST registrar nueva sesión
        $pdo = db();
        requireDeviceAuth($pdo);
        // Controlador de registro de mediciones (lote)
        MeasurementController::register($pdo);
    }
    return true;
}

/* ===== GET /session/{id} ===== */
if (preg_match('#^/session/(\d+)$#', $uri, $m)) {
    if ($method !== 'GET') {
        header('Allow: GET');
        sendResponse(['error' => 'Método no permitido'], 405);
    }

    $sessionId = (int)$m[1];
    SessionController::getOne($pdo, $sessionId);
    return true;
}

return false;