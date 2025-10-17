<?php
/* ====== Autenticación por token ====== */
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