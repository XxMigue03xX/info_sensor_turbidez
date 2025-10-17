<?php
declare(strict_types=1);
require_once __DIR__ . '/../services/CommandService.php';
require_once __DIR__ . '/../models/SessionModel.php';

final class CommandController
{
    public static function get(PDO $pdo): never
    {
        // Autenticación por token + device_id (query/post), según tu helper:
        $deviceId = requireDeviceAuth($pdo);

        $service = new CommandService(new SessionModel($pdo));
        $payload = $service->getCommandForDevice($deviceId);

        sendResponse($payload, 200);
    }
}