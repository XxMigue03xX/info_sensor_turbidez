<?php
declare(strict_types=1);

/**
 * Rutas de comandos del dispositivo
 * Endpoints:
 *  - GET /command
 *  - POST /activate                -> crear sesión activa (ventana de captura)
 */

require_once __DIR__ . '/../middleware/Auth.php';
require_once __DIR__ . '/../controllers/CommandController.php';
require_once __DIR__ . '/../controllers/SessionController.php';

/* ===== GET /command (ESP32)===== */
if ($uri === '/command' and $method === 'GET') {
    // Autenticación por token
    $pdo = db();
    $deviceId = requireDeviceAuth($pdo);
    // Ejecuta el controlador
    CommandController::get($pdo, $deviceId);
    return true;
}

/* ===== GET /admin/command (Admin)===== */
if ($uri === '/admin/command' and $method === 'GET') {
    // Autenticación por origen e instancia db
    requireLocalhost();
    $pdo = db();
    // Controlador maneja la lógica y responde
    CommandController::get($pdo);
    return true;
}

/* ===== POST /activate ===== */
if ($uri === '/activate' and $method === 'POST') {
    // Autenticación por origen e instancia db
    requireLocalhost();
    $pdo = db();
    // Controlador maneja la lógica y responde
    SessionController::activate($pdo);
    return true;
}

return false;