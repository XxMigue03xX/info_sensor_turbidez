<?php
/* ====== Autenticación por token de dispositivo ====== */
function requireDeviceAuth(PDO $pdo): string {
    $token = $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';
    $token = trim((string)$token);
    
    if ($token === '') {
        sendResponse(['error' => 'No autorizado'], 401);
    }

    // Busca el device_id correspondiente al token
    $st = $pdo->prepare("SELECT device_id FROM device WHERE api_token = ? LIMIT 1");
    $st->execute([$token]);
    $deviceId = $st->fetchColumn();

    if ($deviceId === false || $deviceId === null || $deviceId === '') {
        sendResponse(['error' => 'No autorizado'], 401);
    }

    return (string)$deviceId;
}

/* ====== Autenticación por origen local ====== */
function is_request_local(): bool {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    return $ip === '127.0.0.1' || $ip === '::1';
}

function requireLocalhost(): void {
    if (!is_request_local()) {
        // 403 evita revelar que existe el endpoint
        sendResponse(['error' => 'Forbidden'], 403);
    }
}