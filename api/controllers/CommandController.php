<?php
declare(strict_types=1);
require_once __DIR__ . '/../services/CommandService.php';
require_once __DIR__ . '/../models/SessionModel.php';

final class CommandController
{
    public static function get(PDO $pdo, string $deviceId = 'esp32-A'): never
    {
        $service = new CommandService(new SessionModel($pdo));
        $payload = $service->getCommandForDevice($deviceId);

        sendResponse($payload, 200);
    }
}