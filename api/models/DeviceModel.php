<?php
declare(strict_types=1);

/**
 * DeviceModel
 * - Operaciones de lectura/validación sobre la tabla device.
 * - No gestiona autenticación (eso ya lo hace requireDeviceAuth), pero expone utilidades.
 */
final class DeviceModel
{
    private PDO $pdo;

    public function __construct(?PDO $pdo = null)
    {
        $this->pdo = $pdo ?? db();
    }

    /** Obtiene el device por ID o null si no existe. */
    public function getById(string $deviceId): ?array
    {
        $st = $this->pdo->prepare(
            "SELECT device_id, api_token
             FROM device
             WHERE device_id = ?
             LIMIT 1"
        );
        $st->execute([$deviceId]);
        $row = $st->fetch();
        return $row ?: null;
    }

    /** Devuelve true si existe el device. */
    public function exists(string $deviceId): bool
    {
        $st = $this->pdo->prepare("SELECT 1 FROM device WHERE device_id = ? LIMIT 1");
        $st->execute([$deviceId]);
        return (bool)$st->fetchColumn();
    }

    /** Valida que el token corresponda al device indicado. */
    public function tokenMatches(string $deviceId, string $apiToken): bool
    {
        $st = $this->pdo->prepare(
            "SELECT 1
             FROM device
             WHERE device_id = ? AND api_token = ?
             LIMIT 1"
        );
        $st->execute([$deviceId, $apiToken]);
        return (bool)$st->fetchColumn();
    }

    /** (Opcional) Actualiza el api_token del device. */
    public function updateToken(string $deviceId, string $newToken): bool
    {
        $st = $this->pdo->prepare(
            "UPDATE device
             SET api_token = ?
             WHERE device_id = ?
             LIMIT 1"
        );
        $st->execute([$newToken, $deviceId]);
        return $st->rowCount() > 0;
    }
}