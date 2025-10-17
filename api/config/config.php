<?php
/**
 * Configuración global
 * - PDO único a MySQL.
 * - Helpers de request/response.
 */

declare(strict_types=1);

/* ====== Parámetros de conexión ====== */
const DB_HOST = '127.0.0.1';
const DB_NAME = 'iot';
const DB_USER = 'root';
const DB_PASS = '';
const DB_CHARSET = 'utf8mb4';

/* ====== Conexión PDO (singleton) ====== */
function db(): PDO {
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;

    $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET;
    $opts = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ];
    $pdo = new PDO($dsn, DB_USER, DB_PASS, $opts);
    // Forzar zona horaria a UTC a nivel de sesión para DATETIME(3)
    $pdo->exec("SET time_zone = '+00:00'");
    return $pdo;
}

/* ====== Helpers HTTP ====== */
function read_json(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}
function sendResponse(array $data, int $status = 200): never {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/* ====== Utilidad para obtener método y path normalizado ====== */
function request_method(): string {
    return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}
function request_path(): string {
    // Normaliza separadores
    $scriptName = str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '');
    $scriptDir  = rtrim(str_replace('\\', '/', dirname($scriptName)), '/'); // p.ej. "/info_sensor_turbidez/api"

    // Path real solicitado (sin querystring)
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';
    $path = str_replace('\\', '/', $path);

    // Intenta quitar el directorio del script si es prefijo
    if ($scriptDir !== '' && str_starts_with($path, $scriptDir)) {
        $rel = substr($path, strlen($scriptDir));
    } else {
        // Fallback: prueba con prefijos conocidos si por alguna razón SCRIPT_NAME no coincide
        $prefixes = ['/info_sensor_turbidez/api', '/api'];
        $rel = $path;
        foreach ($prefixes as $p) {
            if (str_starts_with($rel, $p)) {
                $rel = substr($rel, strlen($p));
                break;
            }
        }
    }

    // Normaliza resultado
    $rel = '/' . ltrim($rel, '/');
    $rel = rtrim($rel, '/');
    return $rel === '' ? '/' : $rel; // "/" para raíz exacta
}