<?php
declare(strict_types=1);

require_once __DIR__ . '/../models/SessionModel.php';
require_once __DIR__ . '/../models/MeasurementModel.php';

final class SessionController
{
    /**
     * POST /activate
     * Body: { "duration_sec": 300 } (opcional "duration_sec", default 300)
     * Nota: requireDeviceAuth exige que venga device_id (query o body) del frontend.
     */
    public static function activate(PDO $pdo): never
    {
        $deviceId = requireDeviceAuth($pdo);
        $body = read_json();

        $duration = (int)($body['duration_sec'] ?? 300);
        if ($duration < 60 || $duration > 600) {
            sendResponse(['error' => 'duration_sec inválido (60..600)'], 400);
        }

        $sm  = new SessionModel($pdo);
        $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));

        if ($sm->hasActive($deviceId, $now)) {
            sendResponse(['error' => 'Sesión activa existente'], 409);
        }

        $sessionId = $sm->createWithDuration($deviceId, $duration, $now);
        $created   = $sm->getById($sessionId);

        if (!$created) {
            sendResponse(['error' => 'Fallo al intentar crear sesión'], 500);
        }

        sendResponse([
            'session_id'   => (int)$created['session_id'],
            'device_id'    => $created['device_id'],
            'started_at'   => self::toIsoZ($created['started_at']),
            'active_until' => self::toIsoZ($created['active_until']),
        ], 201);
    }

    /**
     * GET /session/{id}
     * Devuelve detalle de sesión + mediciones + stats.
     */
    public static function getOne(PDO $pdo, int $sessionId): never
    {
        $sm  = new SessionModel($pdo);
        $mm  = new MeasurementModel($pdo);

        $session = $sm->getById($sessionId);
        if (!$session) {
            sendResponse(['error' => 'Sesión no encontrada'], 404);
        }

        $meas  = $mm->getForSession($sessionId);
        $stats = $mm->getStatsForSession($sessionId);

        // Formateo ISO Z
        $session['started_at']   = self::toIsoZ($session['started_at']);
        $session['active_until'] = self::toIsoZ($session['active_until']);
        foreach ($meas as &$m) {
            $m['device_recorded_at'] = self::toIsoZ($m['device_recorded_at']);
            $m['seq'] = (int)$m['seq'];
            $m['ntu'] = (float)$m['ntu'];
            $m['raw_mv'] = (int)$m['raw_mv'];
        }

        sendResponse([
            'session'      => $session,
            'measurements' => $meas,
            'stats'        => $stats,
        ], 200);
    }

    /**
     * GET /session
     * Query: device_id (opcional), limit, offset
     */
    public static function list(PDO $pdo): never
    {
        $deviceId = $_GET['filter_device_id'] ?? null; // para listar sesiones de otro device, si aplica
        if ($deviceId !== null && $deviceId === '') $deviceId = null;

        $limit  = isset($_GET['limit'])  ? (int)$_GET['limit']  : 50;
        $offset = isset($_GET['offset']) ? (int)$_GET['offset'] : 0;

        $sm = new SessionModel($pdo);
        $res = $sm->list($deviceId, $limit, $offset);

        // Normalizamos ISO Z
        foreach ($res['items'] as &$it) {
            $it['session_id']   = (int)$it['session_id'];
            $it['started_at']   = self::toIsoZ($it['started_at']);
            $it['active_until'] = self::toIsoZ($it['active_until']);
        }

        sendResponse($res, 200);
    }

    private static function toIsoZ(string $dtWithMicros): string
    {
        $dt = DateTimeImmutable::createFromFormat('Y-m-d H:i:s.u', $dtWithMicros, new DateTimeZone('UTC'));
        if (!$dt) $dt = new DateTimeImmutable($dtWithMicros . ' UTC');
        $ms = (int)floor((int)$dt->format('u') / 1000);
        return $dt->format('Y-m-d\TH:i:s') . '.' . str_pad((string)$ms, 3, '0', STR_PAD_LEFT) . 'Z';
    }
}