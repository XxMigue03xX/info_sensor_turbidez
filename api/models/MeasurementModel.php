<?php
declare(strict_types=1);

/**
 * MeasurementModel
 * - Inserción en bloque de 60 mediciones por sesión (transaccional).
 * - Consulta de mediciones por sesión y agregados simples.
 * - device_recorded_at siempre en UTC con milisegundos (DATETIME(3)).
 */
final class MeasurementModel
{
    private PDO $pdo;

    public function __construct(?PDO $pdo = null)
    {
        $this->pdo = $pdo ?? db();
    }

    /**
     * Inserta en bloque las lecturas de una sesión.
     * Cada fila debe tener:
     *   - seq (int 0..59, único por sesión)
     *   - device_recorded_at (DateTimeInterface)  // ya en UTC
     *   - ntu (float)
     *   - raw_mv (int)
     * Lanza excepción si hay error; usa transacción.
     */
    public function bulkInsert(int $sessionId, array $rows): void
    {
        if ($sessionId <= 0) {
            throw new InvalidArgumentException("sessionId inválido");
        }
        if (count($rows) === 0) return;

        $this->pdo->beginTransaction();
        try {
            $sql = "INSERT INTO measurement(session_id, seq, device_recorded_at, ntu, raw_mv)
                    VALUES (?, ?, ?, ?, ?)";
            $st = $this->pdo->prepare($sql);

            foreach ($rows as $r) {
                $seq  = (int)($r['seq'] ?? -1);
                $dt   = $r['device_recorded_at'] ?? null;
                $ntu  = $r['ntu'] ?? null;
                $raw  = $r['raw_mv'] ?? null;

                if ($seq < 0 || $seq > 59) {
                    throw new InvalidArgumentException("seq fuera de rango: {$seq}");
                }
                if (!$dt instanceof DateTimeInterface) {
                    throw new InvalidArgumentException("device_recorded_at debe ser DateTimeInterface");
                }
                if (!is_numeric($ntu) || !is_numeric($raw)) {
                    throw new InvalidArgumentException("ntu/raw_mv inválidos");
                }

                $st->execute([
                    $sessionId,
                    $seq,
                    self::fmtDtMs($dt),
                    (float)$ntu,
                    (int)$raw,
                ]);
            }

            $this->pdo->commit();
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }

    /**
     * Variante práctica: desde epoch_ms (int) → convierte a UTC DATETIME(3).
     * $rowsEpoch: cada fila: ['seq'=>int, 'epoch_ms'=>int, 'ntu'=>float, 'raw_mv'=>int]
     */
    public function bulkInsertFromEpochMs(int $sessionId, array $rowsEpoch): void
    {
        $rows = [];
        foreach ($rowsEpoch as $r) {
            $ms = (int)($r['epoch_ms'] ?? -1);
            if ($ms < 0) {
                throw new InvalidArgumentException("epoch_ms inválido");
            }
            $sec = intdiv($ms, 1000);
            $rem = $ms % 1000;

            // Epoch siempre se interpreta como UTC:
            $dt = (new DateTimeImmutable('@' . $sec))->setTimezone(new DateTimeZone('UTC'));
            // Ajusta milisegundos:
            $dt = $dt->modify(sprintf('+%d milliseconds', $rem));

            $rows[] = [
                'seq' => (int)$r['seq'],
                'device_recorded_at' => $dt,
                'ntu' => (float)$r['ntu'],
                'raw_mv' => (int)$r['raw_mv'],
            ];
        }
        $this->bulkInsert($sessionId, $rows);
    }

    /** Devuelve mediciones de una sesión ordenadas por seq asc. */
    public function getForSession(int $sessionId): array
    {
        $st = $this->pdo->prepare(
            "SELECT seq,
                    DATE_FORMAT(device_recorded_at, '%Y-%m-%d %H:%i:%s.%f') AS device_recorded_at,
                    ntu,
                    raw_mv
             FROM measurement
             WHERE session_id = ?
             ORDER BY seq ASC"
        );
        $st->execute([$sessionId]);
        return $st->fetchAll();
    }

    /** Cuenta cuántas mediciones hay en la sesión. */
    public function countForSession(int $sessionId): int
    {
        $st = $this->pdo->prepare("SELECT COUNT(*) FROM measurement WHERE session_id = ?");
        $st->execute([$sessionId]);
        return (int)$st->fetchColumn();
    }

    /**
     * Agregados simples para una sesión (útiles para dashboard).
     * Retorna: ['count'=>int, 'ntu_min'=>float|null, 'ntu_max'=>float|null, 'ntu_mean'=>float|null]
     */
    public function getStatsForSession(int $sessionId): array
    {
        $st = $this->pdo->prepare(
            "SELECT COUNT(*) AS cnt,
                    MIN(ntu)  AS ntu_min,
                    MAX(ntu)  AS ntu_max,
                    AVG(ntu)  AS ntu_mean
             FROM measurement
             WHERE session_id = ?"
        );
        $st->execute([$sessionId]);
        $row = $st->fetch() ?: ['cnt'=>0,'ntu_min'=>null,'ntu_max'=>null,'ntu_mean'=>null];

        return [
            'count'    => (int)($row['cnt'] ?? 0),
            'ntu_min'  => isset($row['ntu_min']) ? (float)$row['ntu_min'] : null,
            'ntu_max'  => isset($row['ntu_max']) ? (float)$row['ntu_max'] : null,
            'ntu_mean' => isset($row['ntu_mean']) ? (float)$row['ntu_mean'] : null,
        ];
    }

    /** Formatea DateTime(UTC) a 'Y-m-d H:i:s.v' (milisegundos). */
    public static function fmtDtMs(DateTimeInterface $dt): string
    {
        $utc = (new DateTimeImmutable($dt->format('Y-m-d H:i:s.u'), new DateTimeZone('UTC')));
        $micro = (int)$utc->format('u');
        $ms = (int)floor($micro / 1000);
        return $utc->format('Y-m-d H:i:s') . '.' . str_pad((string)$ms, 3, '0', STR_PAD_LEFT);
    }
}