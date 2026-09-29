#!/usr/bin/env python3
"""Bounded loopback latency smoke for public read endpoints."""

import concurrent.futures
import json
import statistics
import time
import urllib.request


PATHS = ("/health", "/public/events", "/leaderboard")
SAMPLES = 30


def once(path):
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:8787{path}", timeout=5) as response:
            response.read(4096)
            status = response.status
    except Exception:
        status = 0
    return status, round((time.perf_counter() - started) * 1000, 2)


def summarize(path):
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(once, [path] * SAMPLES))
    latencies = sorted(duration for status, duration in results if status == 200)
    return {
        "path": path,
        "requests": SAMPLES,
        "success": len(latencies),
        "p50_ms": statistics.median(latencies) if latencies else None,
        "p95_ms": latencies[min(len(latencies) - 1, int(len(latencies) * 0.95))] if latencies else None,
    }


for path in PATHS:
    print(json.dumps({"event": "api.performance_smoke", **summarize(path)}))
