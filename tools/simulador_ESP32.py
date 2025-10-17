#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
ESP32 simulator for /command and /session
- Polls GET /command with X-Auth-Token
- If "start": generates 60 readings (5 s apart) with epoch_ms timestamps
- Sends POST /session with { session_id, readings[ {seq, device_epoch_ms, ntu, raw_mv} ] }
- Sleeps 60 s after posting, then loops

Usage examples:
  python esp32_sim.py --base http://localhost/info_sensor_turbidez/api --token YOUR_TOKEN --mode fast
  python esp32_sim.py --base http://localhost/info_sensor_turbidez/api --token YOUR_TOKEN --mode real --poll 3
"""

import argparse
import time
import math
import random
import sys
from typing import List, Dict, Tuple
import requests


def now_epoch_ms() -> int:
    return int(time.time() * 1000)


def generate_readings(
    start_epoch_ms: int,
    count: int = 60,
    step_ms: int = 5000,
    seed: int | None = None,
    baseline_mv_range: Tuple[int, int] = (1200, 3000),
    drift_mv_per_sample: int = 5,
) -> List[Dict]:
    """
    Generate 'count' readings spaced by 'step_ms' in epoch ms.
    raw_mv ~ [1200..3000] and ntu inversely related (high mV -> low NTU).
    Adds small drift and noise to feel realistic.
    """
    if seed is not None:
        rnd = random.Random(seed)
    else:
        rnd = random

    min_mv, max_mv = baseline_mv_range
    # Choose a baseline within range
    base_mv = rnd.randint(min_mv + 50, max_mv - 50)

    readings = []
    # Mapping: raw_mv in [min_mv, max_mv] -> ntu in [ntu_min, ntu_max] (inverse relation)
    ntu_min, ntu_max = 0.2, 10.0

    for i in range(count):
        # drift + small noise
        drift = (i * rnd.choice([-drift_mv_per_sample, drift_mv_per_sample, 0]))
        noise = rnd.randint(-20, 20)  # ±20 mV noise
        mv = base_mv + drift + noise
        mv = max(min_mv, min(max_mv, mv))

        # inverse linear mapping to NTU
        span_mv = max(1, (max_mv - min_mv))
        frac = (max_mv - mv) / span_mv  # mv alto -> frac pequeño -> NTU bajo
        ntu = ntu_min + frac * (ntu_max - ntu_min)

        # a tiny random wobble to ntu
        ntu += rnd.uniform(-0.05, 0.05)
        ntu = max(0.0, ntu)

        ts = start_epoch_ms + i * step_ms
        readings.append({
            "seq": i,
            "device_epoch_ms": ts,
            "ntu": round(ntu, 3),
            "raw_mv": int(round(mv)),
        })

    return readings


def poll_command(base_url: str, token: str, extra_params: dict | None = None, timeout: int = 10) -> dict:
    """
    GET /command with X-Auth-Token; returns parsed JSON.
    """
    url = f"{base_url.rstrip('/')}/command"
    headers = {"X-Auth-Token": token}
    params = extra_params or {}
    r = requests.get(url, headers=headers, params=params, timeout=timeout)
    r.raise_for_status()
    return r.json()


def post_session(base_url: str, token: str, session_id: int, readings: List[Dict], timeout: int = 15) -> dict:
    """
    POST /session with payload:
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
    payload = {
        "session_id": session_id,
        "readings": readings,
    }
    r = requests.post(url, headers=headers, json=payload, timeout=timeout)
    # The API may return 201 or 204; we accept 2xx generally
    if r.status_code // 100 != 2:
        # Try to surface API error
        try:
            print("POST /session error:", r.status_code, r.json(), file=sys.stderr)
        except Exception:
            print("POST /session error:", r.status_code, r.text[:500], file=sys.stderr)
        r.raise_for_status()
    # In some cases API returns no JSON (204). Keep it robust:
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
      - poll GET /command every poll_sec when idle
      - on "start": generate 60 readings then POST /session
      - sleep post_sleep_sec, then resume polling
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
            # Expected: {"command":"start","session_id":123,"expires_at":"...Z"} or {"command":"idle"}
            command = cmd.get("command")
            print(f"[SIM] /command -> {cmd}")

            if command == "start":
                session_id = int(cmd["session_id"])
                # generate readings
                start_ms = now_epoch_ms()
                readings = generate_readings(start_ms, count=60, step_ms=5000)

                if mode == "real":
                    # In real mode we wait 5s as if we were sampling live,
                    # but we still send the batch at the end (like your API expects).
                    print("[SIM] Generating 60 samples with real 5s waits (~5 minutes)...")
                    for i in range(60):
                        if i > 0:
                            time.sleep(5)
                        # Optionally print a tiny live log
                        if i % 10 == 0:
                            print(f"[SIM]  collected {i}/60 ...")
                    # Rebuild with fresh timestamps aligned to now
                    start_ms = now_epoch_ms()
                    readings = generate_readings(start_ms, count=60, step_ms=5000)

                # Post the batch
                print(f"[SIM] Posting 60 readings to /session for session_id={session_id} ...")
                res = post_session(base_url, token, session_id, readings)
                print(f"[SIM] POST /session -> {res}")

                # Sleep to allow API/DB to close the session (as per your flow)
                print(f"[SIM] Sleeping {post_sleep_sec}s to allow session to close...")
                time.sleep(post_sleep_sec)

            else:
                # idle or unknown -> keep polling
                time.sleep(poll_sec)

        except requests.HTTPError as e:
            # Surface HTTP errors with potential JSON body
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
    ap = argparse.ArgumentParser(description="ESP32 turbidity simulator (GET /command, POST /session)")
    ap.add_argument("--base", required=True, help="API base URL, e.g. http://localhost/info_sensor_turbidez/api")
    ap.add_argument("--token", required=True, help="X-Auth-Token value for the device")
    ap.add_argument("--mode", choices=["fast", "real"], default="fast", help="fast = no wait; real = wait 5s per sample (~5min)")
    ap.add_argument("--poll", type=int, default=5, help="seconds between GET /command polls when idle")
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