<?php
declare(strict_types=1);

/**
 * SessionModel
 * - Gestión de sesiones de muestreo (crear, consultar, listar, activa).
 * - Fechas en UTC usando DATETIME(3). Este modelo no modifica el time_zone (lo hace db()).
 */
final class SessionModel
{
    private PDO $pdo;

    public function __construct(?PDO $pdo = null)
    {
        $this->pdo = $pdo ?? db();
    }

    /** Crea una sesión con active_until dado. Retorna session_id (AUTO_INCREMENT). */
    public function create(string $deviceId, DateTimeInterface $activeUntil): int
    {
        $sql = "INSERT INTO session(device_id, active_until)
                VALUES (?, ?)";
        $st = $this->pdo->prepare($sql);
        $st->execute([$deviceId, self::fmtDtMs($activeUntil)]);
        return (int) $this->pdo->lastInsertId();
    }

    /** Crea una sesión calculando active_until a partir de duration_sec. */
    public function createWithDuration(string $deviceId, int $durationSec, ?DateTimeInterface $now = null): int
    {
        if ($durationSec < 1) {
            throw new InvalidArgumentException("durationSec debe ser > 0");
        }
        $now = $now ?? new DateTimeImmutable('now', new DateTimeZone('UTC'));
        $activeUntil = (new DateTimeImmutable($now->format('Y-m-d H:i:s.u'), new DateTimeZone('UTC')))
            ->add(new DateInterval('PT' . $durationSec . 'S'));
        return $this->create($deviceId, $activeUntil);
    }

    /** Devuelve la sesión por ID o null si no existe. */
    public function getById(int $sessionId): ?array
    {
        $st = $this->pdo->prepare(
            "SELECT session_id, device_id,
                    DATE_FORMAT(started_at, '%Y-%m-%d %H:%i:%s.%f') AS started_at,
                    DATE_FORMAT(active_until, '%Y-%m-%d %H:%i:%s.%f') AS active_until
             FROM session
             WHERE session_id = ?
             LIMIT 1"
        );
        $st->execute([$sessionId]);
        $row = $st->fetch();
        return $row ?: null;
    }

    /**
     * Devuelve la sesión activa más reciente para un device (active_until > now).
     * Si no hay, retorna null.
     */
    public function getActive(string $deviceId, ?DateTimeInterface $now = null): ?array
    {
        $now = $now ?? new DateTimeImmutable('now', new DateTimeZone('UTC'));
        $st = $this->pdo->prepare(
            "SELECT session_id, device_id,
                    DATE_FORMAT(started_at, '%Y-%m-%d %H:%i:%s.%f') AS started_at,
                    DATE_FORMAT(active_until, '%Y-%m-%d %H:%i:%s.%f') AS active_until
             FROM session
             WHERE device_id = ?
               AND active_until > ?
             ORDER BY session_id DESC
             LIMIT 1"
        );
        $st->execute([$deviceId, self::fmtDtMs($now)]);
        $row = $st->fetch();
        return $row ?: null;
    }

    /**
     * Última sesión culminada (active_until <= now).
     * Si $deviceId es null → busca en todos los dispositivos.
     * Retorna fila con started_at y active_until en formato 'Y-m-d H:i:s.u'
     */
    public function getLastFinished(?string $deviceId = null, ?DateTimeInterface $now = null): ?array
    {
        $now = $now ?? new DateTimeImmutable('now', new DateTimeZone('UTC'));

        if ($deviceId) {
            $st = $this->pdo->prepare(
                "SELECT session_id, device_id,
                    DATE_FORMAT(started_at,   '%Y-%m-%d %H:%i:%s.%f') AS started_at,
                    DATE_FORMAT(active_until, '%Y-%m-%d %H:%i:%s.%f') AS active_until
             FROM session
             WHERE device_id = ?
               AND active_until <= ?
             ORDER BY session_id DESC
             LIMIT 1"
            );
            $st->execute([$deviceId, self::fmtDtMs($now)]);
        } else {
            $st = $this->pdo->prepare(
                "SELECT session_id, device_id,
                    DATE_FORMAT(started_at,   '%Y-%m-%d %H:%i:%s.%f') AS started_at,
                    DATE_FORMAT(active_until, '%Y-%m-%d %H:%i:%s.%f') AS active_until
             FROM session
             WHERE active_until <= ?
             ORDER BY session_id DESC
             LIMIT 1"
            );
            $st->execute([self::fmtDtMs($now)]);
        }

        $row = $st->fetch();
        return $row ?: null;
    }

    /** True si existe una sesión activa para el device. */
    public function hasActive(string $deviceId, ?DateTimeInterface $now = null): bool
    {
        return $this->getActive($deviceId, $now) !== null;
    }

    /**
     * Lista sesiones con paginación. Si pasas $deviceId = null, lista todas.
     * Retorna: ['items' => [...], 'total' => int]
     */
    public function list(?string $deviceId, int $limit = 50, int $offset = 0): array
    {
        $limit = max(1, min(100, $limit));

        if ($deviceId) {
            $st = $this->pdo->prepare(
                "SELECT SQL_CALC_FOUND_ROWS
                        session_id, device_id,
                        DATE_FORMAT(started_at, '%Y-%m-%d %H:%i:%s.%f') AS started_at,
                        DATE_FORMAT(active_until, '%Y-%m-%d %H:%i:%s.%f') AS active_until
                 FROM session
                 WHERE device_id = ?
                 ORDER BY session_id DESC
                 LIMIT ? OFFSET ?"
            );
            $st->bindValue(1, $deviceId, PDO::PARAM_STR);
            $st->bindValue(2, $limit, PDO::PARAM_INT);
            $st->bindValue(3, $offset, PDO::PARAM_INT);
            $st->execute();
        } else {
            $st = $this->pdo->prepare(
                "SELECT SQL_CALC_FOUND_ROWS
                        session_id, device_id,
                        DATE_FORMAT(started_at, '%Y-%m-%d %H:%i:%s.%f') AS started_at,
                        DATE_FORMAT(active_until, '%Y-%m-%d %H:%i:%s.%f') AS active_until
                 FROM session
                 ORDER BY session_id DESC
                 LIMIT ? OFFSET ?"
            );
            $st->bindValue(1, $limit, PDO::PARAM_INT);
            $st->execute();
        }

        $items = $st->fetchAll();
        $total = (int) $this->pdo->query("SELECT FOUND_ROWS()")->fetchColumn();

        return ['sessions' => $items, 'total' => $total, 'limit' => $limit];
    }

    /** Formatea DateTime(UTC) a 'Y-m-d H:i:s.v' compatible con DATETIME(3) */
    public static function fmtDtMs(DateTimeInterface $dt): string
    {
        // Asegura TZ UTC en la cadena resultante (db() ya está en UTC)
        $utc = (new DateTimeImmutable($dt->format('Y-m-d H:i:s.u'), new DateTimeZone('UTC')));
        // MySQL DATETIME(3) = milisegundos → corta a 3 decimales:
        $micro = (int) $utc->format('u'); // 0..999999
        $ms = (int) floor($micro / 1000);
        return $utc->format('Y-m-d H:i:s') . '.' . str_pad((string) $ms, 3, '0', STR_PAD_LEFT);
    }

    // Terminar sesión
    public function closeNow(int $sessionId, ?DateTimeInterface $when = null): bool
    {
        $when = $when ?? new DateTimeImmutable('now', new DateTimeZone('UTC'));
        $st = $this->pdo->prepare(
            "UPDATE session
         SET active_until = ?
         WHERE session_id = ?
         LIMIT 1"
        );
        $st->execute(params: [self::fmtDtMs($when), $sessionId]);
        return $st->rowCount() > 0;
    }
}