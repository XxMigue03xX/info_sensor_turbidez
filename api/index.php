<?php
/**
 * Punto de entrada – API
 * Estructura:
 *   /api/index.php
 *   /api/config/config.php
 *   /api/routes/routes.php
 *   /api/controllers/
 *   /api/models/
 */

declare(strict_types=1);

/* ========= CORS y salida JSON ========= */
function send_cors(): void {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Headers: Content-Type, X-Auth-Token');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Max-Age: 86400');
}
function json_out(int $status, array $payload): never {
    send_cors();
    header('Content-Type: application/json; charset=utf-8');
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

/* ========= Entorno mínimo ========= */
date_default_timezone_set('UTC');
header_remove('X-Powered-By');

/* ========= Preflight CORS ========= */
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    send_cors();
    http_response_code(204);
    exit;
}

/* ========= Errores → JSON (simple) ========= */
set_error_handler(static function($severity, $message, $file, $line) {
    throw new ErrorException($message, 0, $severity, $file, $line);
});
set_exception_handler(static function(Throwable $e) {
    json_out(500, ['error' => 'server_error', 'detail' => $e->getMessage()]);
});

/* ========= Configuración (DB + helpers) ========= */
require_once __DIR__ . '/config/config.php';

/* ========= Router ========= */
require_once __DIR__ . '/routes/routes.php';