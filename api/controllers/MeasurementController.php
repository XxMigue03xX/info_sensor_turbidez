<?php
declare(strict_types=1);

final class MeasurementController
{
    /**
     * POST /session
     * Body:
     * {
     *   "session_id": 123,
     *   "readings": [
     *     {"seq":0,"device_epoch_ms":1697382000100,"ntu":1.23,"raw_mv":2540},
     *     ...
     *   ]
     * }
     *
     * Acepta "epoch_ms" o "device_epoch_ms" (alias) por compatibilidad.
     */
    // MeasurementController.php
    public static function register(PDO $pdo, string $deviceId): never
    {
        $body = read_json();

        $sessionId = (int) ($body['session_id'] ?? 0);
        $readings = $body['readings'] ?? null;

        if ($sessionId <= 0 || !is_array($readings)) {
            sendResponse(['error' => 'invalid payload'], 400);
        }
        // ⬇️ exige 60 muestras exactas
        if (count($readings) !== 60) {
            sendResponse(['error' => 'expected 60 readings'], 400);
        }

        $sm = new SessionModel($pdo);
        $session = $sm->getById($sessionId);
        if (!$session || $session['device_id'] !== $deviceId) {
            sendResponse(['error' => 'invalid session'], 404);
        }

        // Prevalidación seq
        $seen = [];
        foreach ($readings as $r) {
            if (!is_array($r))
                sendResponse(['error' => 'invalid reading'], 400);
            $seq = (int) ($r['seq'] ?? -1);
            if ($seq < 0 || $seq > 59)
                sendResponse(['error' => 'seq out of range'], 400);
            if (isset($seen[$seq]))
                sendResponse(['error' => 'duplicate seq'], 400);
            $seen[$seq] = true;
            if (!isset($r['ntu'], $r['raw_mv'])) {
                sendResponse(['error' => 'missing fields in reading'], 400);
            }
        }

        // Convertir a epoch_ms -> DateTime(UTC)
        $rowsEpoch = [];
        foreach ($readings as $r) {
            $ms = $r['device_epoch_ms'] ?? $r['epoch_ms'] ?? null;
            if (!is_numeric($ms)) {
                sendResponse(['error' => 'missing epoch_ms/device_epoch_ms'], 400);
            }
            $rowsEpoch[] = [
                'seq' => (int) $r['seq'],
                'epoch_ms' => (int) $ms,
                'ntu' => (float) $r['ntu'],
                'raw_mv' => (int) $r['raw_mv'],
            ];
        }

        $mm = new MeasurementModel($pdo);

        try {
            // Inserción atómica: o entran las 60, o ninguna
            $mm->bulkInsertFromEpochMs($sessionId, $rowsEpoch);

            // ⬅️ cierre anticipado de sesión (marca fin inmediato)
            $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
            $sm->closeNow($sessionId, $now);

        } catch (PDOException $e) {
            $mysqlCode = $e->errorInfo[1] ?? null;
            if ($mysqlCode === 1062) {
                sendResponse(['error' => 'duplicate seq for session'], 409);
            }
            throw $e;
        } catch (InvalidArgumentException $e) {
            sendResponse(['error' => $e->getMessage()], 400);
        } catch (Throwable $e) {
            sendResponse(['error' => 'internal'], 500);
        }

        sendResponse(['ok' => true, 'inserted' => 60, 'session_closed' => true], 201);
    }
}