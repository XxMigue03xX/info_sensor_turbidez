<?php
declare(strict_types=1);

final class CommandService
{
    public function __construct(
        private SessionModel $sessionModel
    ) {}

    /**
     * Regresa el comando para el dispositivo:
     * - Si hay sesión activa → ["command"=>"start","session_id"=>...,"expires_at"=>ISO_UTC]
     * - Si no → ["command"=>"idle"]
     */
    public function getCommandForDevice(string $deviceId, ?DateTimeInterface $now = null): array
    {
        $now = $now ?? new DateTimeImmutable('now', new DateTimeZone('UTC'));
        $active = $this->sessionModel->getActive($deviceId, $now);
        if ($active) {
            return [
                'command'    => 'start',
                'session_id' => (int)$active['session_id'],
                'expires_at' => $this->toIsoZ($active['active_until']),
            ];
        }
        return ['command' => 'idle'];
    }

    private function toIsoZ(string $dtWithMicros): string
    {
        // $dtWithMicros viene como 'Y-m-d H:i:s.%f' en UTC (por SessionModel::getActive)
        $dt = DateTimeImmutable::createFromFormat('Y-m-d H:i:s.u', $dtWithMicros, new DateTimeZone('UTC'));
        if (!$dt) {
            // fallback robusto si por algún motivo falla el parseo
            $dt = new DateTimeImmutable($dtWithMicros . ' UTC');
        }
        // recortamos a milisegundos para coherencia con DATETIME(3)
        $ms = (int)floor((int)$dt->format('u') / 1000);
        return $dt->format('Y-m-d\TH:i:s') . '.' . str_pad((string)$ms, 3, '0', STR_PAD_LEFT) . 'Z';
    }
}