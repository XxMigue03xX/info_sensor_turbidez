#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
ESP32 simulator for /admin/command and /session
- Polls GET /admin/command with X-Auth-Token
- If "start": generates 60 readings (5 s apart) ALIGNED to real-time ticks
- FAST mode: no waits (batch immediate) but timestamps t_i = t0 + i*5s
- REAL mode: waits and samples at each real tick t_i; posts batch at the end
- Sends POST /session with:
    { "session_id", "readings": [ {seq, device_epoch_ms, ntu, raw_mv}, ... ] }
- Sleeps post_sleep_sec after posting, then loops

Usage:
  python esp32_sim.py --base http://localhost/info_sensor_turbidez/api --token YOUR_TOKEN --mode fast
  python esp32_sim.py --base http://localhost/info_sensor_turbidez/api --token YOUR_TOKEN --mode real --poll 3
"""

import argparse
import time
import random
import sys
from typing import List, Dict, Tuple, Optional
import requests


STEP_MS = 5000
COUNT = 60  # 60 muestras -> 5 min (último ts = t0 + 59*5s)


def now_epoch_ms() -> int:
    return int(time.time() * 1000)


def align_next_tick_ms(ms: int, step_ms: int) -> int:
    """Devuelve el próximo múltiplo de step_ms (si ms ya es múltiplo, retorna ms)."""
    rem = ms % step_ms
    return ms if rem == 0 else ms + (step_ms - rem)


def synth_sample_values(rnd: random.Random, i: int,
                        baseline_mv_range: Tuple[int, int] = (1200, 3000),
                        drift_mv_per_sample: int = 5) -> Tuple[float, int]:
    """
    Genera (ntu, raw_mv) realistas para el índice i.
    - raw_mv en [1200..3000], con drift leve y ruido
    - NTU inversamente proporcional a mv, con wobble pequeño
    """
    min_mv, max_mv = baseline_mv_range
    # baseline estable por ejecución (guardado en la instancia de Random)
    base_mv = getattr(rnd, "_base_mv", None)
    if base_mv is None:
        base_mv = rnd.randint(min_mv + 50, max_mv - 50)
        rnd._base_mv = base_mv

    drift = i * rnd.choice([-drift_mv_per_sample, drift_mv_per_sample, 0])
    noise = rnd.randint(-20, 20)
    mv = base_mv + drift + noise
    mv = max(min_mv, min(max_mv, mv))

    # Mapeo inverso mv -> NTU
    ntu_min, ntu_max = 0.2, 10.0
    span_mv = max(1, (max_mv - min_mv))
    frac = (max_mv - mv) / span_mv
    ntu = ntu_min + frac * (ntu_max - ntu_min)
    ntu += rnd.uniform(-0.05, 0.05)  # wobble
    ntu = max(0.0, ntu)

    return round(ntu, 3), int(round(mv))


def generate_readings_fast_aligned(
    start_epoch_ms_aligned: int,
    count: int = COUNT,
    step_ms: int = STEP_MS,
    seed: Optional[int] = None,
) -> List[Dict]:
    """
    Genera 'count' lecturas con timestamps t_i = t0 + i*step_ms (sin esperar).
    """
    rnd = random.Random(seed) if seed is not None else random
    readings = []
    for i in range(count):
        ts = start_epoch_ms_aligned + i * step_ms
        ntu, mv = synth_sample_values(rnd, i)
        readings.append({
            "seq": i,
            "device_epoch_ms": ts,
            "ntu": ntu,
            "raw_mv": mv,
        })
    return readings


def collect_readings_real_time(
    start_epoch_ms_aligned: int,
    count: int = COUNT,
    step_ms: int = STEP_MS,
    seed: Optional[int] = None,
    log_every: int = 10,
) -> List[Dict]:
    """
    Toma lecturas en tiempo real, esperando a cada tick exacto t_i.
    Si se llega tarde a un tick, no se duerme para ese i (se continúa).
    """
    rnd = random.Random(seed) if seed is not None else random
    readings = []
    print(f"[SIM] REAL sampling: start={start_epoch_ms_aligned} "
          f"({time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(start_epoch_ms_aligned/1000))}Z), "
          f"step={step_ms}ms, count={count}")

    # Esperar al primer tick si estamos antes de t0
    delay0 = (start_epoch_ms_aligned - now_epoch_ms()) / 1000.0
    if delay0 > 0:
        time.sleep(delay0)

    for i in range(count):
        t_i = start_epoch_ms_aligned + i * step_ms
        delay = (t_i - now_epoch_ms()) / 1000.0
        if delay > 0:
            time.sleep(delay)
        ntu, mv = synth_sample_values(rnd, i)
        readings.append({
            "seq": i,
            "device_epoch_ms": t_i,  # ← SIEMPRE el tick exacto
            "ntu": ntu,
            "raw_mv": mv,
        })
        if log_every and i % log_every == 0:
            print(f"[SIM]  collected {i}/{count} at {t_i}")

    return readings


def poll_command(base_url: str, token: str, extra_params: dict | None = None, timeout: int = 10) -> dict:
    """
    GET /admin/command  (nota: ruta /admin/command según tu frontend)
    Esperado:
      {"command":"start","session_id":123,"expires_at":"...Z"}  ó  {"command":"idle"}
    """
    url = f"{base_url.rstrip('/')}/admin/command"
    headers = {"X-Auth-Token": token}
    params = extra_params or {}
    r = requests.get(url, headers=headers, params=params, timeout=timeout)
    r.raise_for_status()
    return r.json()


def post_session(base_url: str, token: str, session_id: int, readings: List[Dict], timeout: int = 15) -> dict:
    """
    POST /session con:
    {
      "session_id": <id>,
      "readings": [
        {"seq":0,"device_epoch_ms":...,"ntu":...,"raw_mv":...}, ...
      ]
    }
    """
    url = f"{base_url.rstrip('/')}/session"
    headers = {
        "X-Auth-Token": token,
        "Content-Type": "application/json",
    }
    payload = {"session_id": session_id, "readings": readings}
    r = requests.post(url, headers=headers, json=payload, timeout=timeout)
    if r.status_code // 100 != 2:
        try:
            print("POST /session error:", r.status_code, r.json(), file=sys.stderr)
        except Exception:
            print("POST /session error:", r.status_code, r.text[:500], file=sys.stderr)
        r.raise_for_status()
    try:
        return r.json()
    except Exception:
        return {"status": r.status_code}


def run_loop(
    base_url: str,
    token: str,
    mode: str = "fast",
    poll_sec: int = 5,
    post_sleep_sec: int = 60,
    include_device_id_param: str | None = None,
) -> None:
    """
    Main loop:
      - poll GET /admin/command cada poll_sec cuando está idle
      - on "start": genera 60 lecturas alineadas a ticks de 5s
            FAST: sin esperar (batch inmediato)
            REAL: espera en tiempo real cada tick; postea al final
      - POST /session
      - sleep post_sleep_sec, y vuelve a hacer polling
    """
    assert mode in ("fast", "real"), "mode must be 'fast' or 'real'"

    print(f"[SIM] base={base_url} mode={mode} poll={poll_sec}s token=***...")
    if include_device_id_param:
        print(f"[SIM] Using query param device_id={include_device_id_param}")

    while True:
        try:
            params = {}
            if include_device_id_param:
                params["device_id"] = include_device_id_param

            cmd = poll_command(base_url, token, extra_params=params)
            print(f"[SIM] /admin/command -> {cmd}")

            command = cmd.get("command")
            if command == "start":
                session_id = int(cmd["session_id"])

                # t0 = próximo tick de 5 s (alineado al reloj real)
                now_ms = now_epoch_ms()
                t0 = align_next_tick_ms(now_ms, STEP_MS)

                if mode == "real":
                    print("[SIM] REAL mode: sampling aligned 5s ticks (~5 minutes total)...")
                    readings = collect_readings_real_time(t0, count=COUNT, step_ms=STEP_MS)
                else:
                    print("[SIM] FAST mode: generating aligned timestamps without waiting...")
                    readings = generate_readings_fast_aligned(t0, count=COUNT, step_ms=STEP_MS)

                # Logs de control
                if readings:
                    print(f"[SIM] First ts: {readings[0]['device_epoch_ms']}  "
                          f"Last ts:  {readings[-1]['device_epoch_ms']}")

                # POST batch
                print(f"[SIM] Posting {len(readings)} readings to /session for session_id={session_id} ...")
                res = post_session(base_url, token, session_id, readings)
                print(f"[SIM] POST /session -> {res}")

                # Dar tiempo al backend para cerrar sesión
                print(f"[SIM] Sleeping {post_sleep_sec}s to allow session to close...")
                time.sleep(post_sleep_sec)

            else:
                # idle u otro -> seguir consultando
                time.sleep(poll_sec)

        except requests.HTTPError as e:
            try:
                print("[SIM] HTTPError:", e.response.status_code, e.response.json(), file=sys.stderr)
            except Exception:
                print("[SIM] HTTPError:", str(e), file=sys.stderr)
            time.sleep(poll_sec)

        except requests.RequestException as e:
            print("[SIM] Network error:", str(e), file=sys.stderr)
            time.sleep(poll_sec)

        except KeyboardInterrupt:
            print("\n[SIM] Stopped by user.")
            break

        except Exception as e:
            print("[SIM] Unexpected error:", repr(e), file=sys.stderr)
            time.sleep(poll_sec)


def main():
    ap = argparse.ArgumentParser(description="ESP32 turbidity simulator (GET /admin/command, POST /session)")
    ap.add_argument("--base", required=True, help="API base URL, e.g. http://localhost/info_sensor_turbidez/api")
    ap.add_argument("--token", required=True, help="X-Auth-Token value for the device")
    ap.add_argument("--mode", choices=["fast", "real"], default="fast",
                    help="fast = no wait; real = wait 5s per sample (~5min)")
    ap.add_argument("--poll", type=int, default=5, help="seconds between GET /admin/command polls when idle")
    ap.add_argument("--post-sleep", type=int, default=60, help="seconds to sleep after POST /session")
    ap.add_argument("--device-id-param", default=None,
                    help="(Optional) include ?device_id=<id> in requests if your auth still needs it")
    args = ap.parse_args()

    run_loop(
        base_url=args.base,
        token=args.token,
        mode=args.mode,
        poll_sec=args.poll,
        post_sleep_sec=args.post_sleep,
        include_device_id_param=args.device_id_param,
    )


if __name__ == "__main__":
    main()