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
        if (count($rows) === 0)
            return;

        $this->pdo->beginTransaction();
        try {
            $sql = "INSERT INTO measurement(session_id, seq, device_recorded_at, ntu, raw_mv)
                    VALUES (?, ?, ?, ?, ?)";
            $st = $this->pdo->prepare($sql);

            foreach ($rows as $r) {
                $seq = (int) ($r['seq'] ?? -1);
                $dt = $r['device_recorded_at'] ?? null;
                $ntu = $r['ntu'] ?? null;
                $raw = $r['raw_mv'] ?? null;

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
                    (float) $ntu,
                    (int) $raw,
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
            $ms = (int) ($r['epoch_ms'] ?? -1);
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
                'seq' => (int) $r['seq'],
                'device_recorded_at' => $dt,
                'ntu' => (float) $r['ntu'],
                'raw_mv' => (int) $r['raw_mv'],
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
        return (int) $st->fetchColumn();
    }

    /**
     * Agregados estadísticos simples para una sesión (para dashboard).
     * Cálculos en cada petición (no se almacenan en BD).
     *
     * Retorna:
     * [
     *   'count'      => int,
     *   'ntu_min'    => float|null,
     *   'ntu_max'    => float|null,
     *   'ntu_mean'   => float|null,
     *   'ntu_stddev' => float|null,
     *   'ntu_median' => float|null,
     *   'ntu_mode'   => float|null,
     *   'ntu_range'  => float|null
     * ]
     */
    public function getStatsForSession(int $sessionId): array
    {
        // 1) Básicos + desviación estándar
        $st = $this->pdo->prepare(
            "SELECT
            COUNT(*)             AS cnt,
            MIN(ntu)             AS ntu_min,
            MAX(ntu)             AS ntu_max,
            AVG(ntu)             AS ntu_mean,
            STDDEV_SAMP(ntu)     AS ntu_stddev
         FROM measurement
         WHERE session_id = ?"
        );
        $st->execute([$sessionId]);
        $row = $st->fetch() ?: [];

        $count = (int) ($row['cnt'] ?? 0);
        if ($count === 0) {
            return [
                'count' => 0,
                'ntu_mean' => null,
                'ntu_stddev' => null,
                'ntu_median' => null,
                'ntu_mode' => null,
                'ntu_range' => null,
            ];
        }

        $min = isset($row['ntu_min']) ? (float) $row['ntu_min'] : null;
        $max = isset($row['ntu_max']) ? (float) $row['ntu_max'] : null;
        $mean = isset($row['ntu_mean']) ? (float) $row['ntu_mean'] : null;
        $sd = isset($row['ntu_stddev']) ? (float) $row['ntu_stddev'] : null;

        // 2) Mediana
        if ($count % 2 === 1) {
            $k = intdiv($count, 2);
            $stmMed = $this->pdo->prepare(
                "SELECT ntu
             FROM measurement
             WHERE session_id = ?
             ORDER BY ntu
             LIMIT 1 OFFSET ?"
            );
            $stmMed->bindValue(1, $sessionId, \PDO::PARAM_INT);
            $stmMed->bindValue(2, $k, \PDO::PARAM_INT);
            $stmMed->execute();
            $median = (float) $stmMed->fetchColumn();
        } else {
            $k1 = $count / 2 - 1;
            $stmMed = $this->pdo->prepare(
                "SELECT ntu
             FROM measurement
             WHERE session_id = ?
             ORDER BY ntu
             LIMIT 2 OFFSET ?"
            );
            $stmMed->bindValue(1, $sessionId, \PDO::PARAM_INT);
            $stmMed->bindValue(2, $k1, \PDO::PARAM_INT);
            $stmMed->execute();
            $vals = $stmMed->fetchAll(\PDO::FETCH_COLUMN, 0);
            $median = count($vals) === 2
                ? ((float) $vals[0] + (float) $vals[1]) / 2.0
                : (float) $vals[0];
        }

        // 3) Moda
        $stmMode = $this->pdo->prepare(
            "SELECT ntu AS val
         FROM measurement
         WHERE session_id = ?
         GROUP BY ntu
         ORDER BY COUNT(*) DESC, val ASC
         LIMIT 1"
        );
        $stmMode->execute([$sessionId]);
        $mode = $stmMode->fetchColumn();
        $mode = ($mode !== false) ? (float) $mode : null;

        // 4) Rango
        $range = ($min !== null && $max !== null) ? ($max - $min) : null;

        // 5) Normalizar a 3 decimales
        $fmt = fn($v) => $v !== null ? round($v, 3) : null;

        return [
            'count' => $count,
            'ntu_mean' => $fmt($mean),
            'ntu_stddev' => $fmt($sd),
            'ntu_median' => $fmt($median),
            'ntu_mode' => $fmt($mode),
            'ntu_range' => $fmt($range),
        ];
    }

    public function countBySessionId(int $sessionId): int
    {
        $stmt = $this->pdo->prepare('SELECT COUNT(*) FROM measurement WHERE session_id = ?');
        $stmt->execute([$sessionId]);
        return (int) $stmt->fetchColumn();
    }

    /** Formatea DateTime(UTC) a 'Y-m-d H:i:s.v' (milisegundos). */
    public static function fmtDtMs(DateTimeInterface $dt): string
    {
        $utc = (new DateTimeImmutable($dt->format('Y-m-d H:i:s.u'), new DateTimeZone('UTC')));
        $micro = (int) $utc->format('u');
        $ms = (int) floor($micro / 1000);
        return $utc->format('Y-m-d H:i:s') . '.' . str_pad((string) $ms, 3, '0', STR_PAD_LEFT);
    }
}