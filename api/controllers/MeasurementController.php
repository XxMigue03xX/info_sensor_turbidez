<?php
declare(strict_types=1);

final class MeasurementController
{
    public static function registerSingleReading(PDO $pdo, string $deviceId): never
    {
        $body = read_json();

        $sessionId = (int) ($body['session_id'] ?? 0);
        $seq       = isset($body['seq']) ? (int) $body['seq'] : -1;
        $ntu       = $body['ntu'] ?? null;
        $rawMv     = $body['raw_mv'] ?? null;

        if ($sessionId <= 0) {
            sendResponse(['error' => 'invalid payload'], 400);
        }

        // Validación de campos requeridos (equivalente a la de tu bucle actual)
        if ($seq < 0 || $seq > 59) {
            sendResponse(['error' => 'seq out of range'], 400);
        }

        if ($ntu === null || $rawMv === null) {
            sendResponse(['error' => 'missing fields in reading'], 400);
        }

        $ms = $body['device_epoch_ms'] ?? $body['epoch_ms'] ?? null;
        if (!is_numeric($ms)) {
            sendResponse(['error' => 'missing epoch_ms/device_epoch_ms'], 400);
        }

        // Validar sesión y pertenencia al dispositivo
        $sm = new SessionModel($pdo);
        $session = $sm->getById($sessionId);
        if (!$session || $session['device_id'] !== $deviceId) {
            sendResponse(['error' => 'invalid session'], 404);
        }

        // Preparar el "rowEpoch" como en tu código original
        $rowEpoch = [
            'seq'       => $seq,
            'epoch_ms'  => (int) $ms,
            'ntu'       => (float) $ntu,
            'raw_mv'    => (int) $rawMv,
        ];

        $mm = new MeasurementModel($pdo);

        try {
            // Reutilizamos la lógica de inserción existente.
            // bulkInsertFromEpochMs ahora recibe solo un elemento.
            $mm->bulkInsertFromEpochMs($sessionId, [$rowEpoch]);

            // Opcional pero muy recomendable:
            // Cerrar sesión automáticamente cuando llegues a 60 lecturas.
            $total = $mm->countBySessionId($sessionId);
            $sessionClosed = false;

            if ($total >= 60) {
                $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
                $sm->closeNow($sessionId, $now);
                $sessionClosed = true;
            }

        } catch (PDOException $e) {
            $mysqlCode = $e->errorInfo[1] ?? null;
            if ($mysqlCode === 1062) {
                // Mensaje en caso de duplicados
                sendResponse(['error' => 'duplicate seq for session'], 409);
            }
            throw $e;
        } catch (InvalidArgumentException $e) {
            sendResponse(['error' => $e->getMessage()], 400);
        } catch (Throwable $e) {
            sendResponse(['error' => 'internal'], 500);
        }

        sendResponse([
            'ok'              => true,
            'inserted'        => 1,
            'session_closed'  => $sessionClosed,
        ], 201);
    }
}