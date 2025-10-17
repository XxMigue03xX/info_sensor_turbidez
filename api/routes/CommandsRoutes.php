<?php
declare(strict_types=1);

/**
 * Rutas de comandos del dispositivo
 * Endpoints:
 *  - GET /command
 */

require_once __DIR__ . '/../middleware/Auth.php';
require_once __DIR__ . '/../controllers/CommandController.php';
require_once __DIR__ . '/../controllers/SessionController.php';

/* ===== GET /command ===== */
if ($uri === '/command' and $method === 'GET') {
    // Autenticación por token
    $pdo = db();
    requireDeviceAuth($pdo);
    // Ejecuta el controlador
    CommandController::get($pdo);
    return true;
}

/* ===== POST /activate ===== */
if ($uri === '/activate' and $method === 'POST') {
    // Auth: frontend debe enviar token para iniciar sesión
    $pdo = db();
    requireDeviceAuth($pdo);
    // Controlador maneja la lógica y responde
    SessionController::activate($pdo);
    return true;
}

return false;