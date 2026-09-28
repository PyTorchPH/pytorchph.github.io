# API performance record

This record separates measured response time, server resource use, and cost assumptions. A request rate or latency is never independent of hardware: compare deployments using the same endpoint, response size, database state, client location, TLS mode, connection reuse, concurrency, and offered rate. CPU time per successful request is the main hardware-normalized efficiency measure; it still depends on CPU architecture and load.

## Results

### Production loopback smoke, 2026-09-29

`deploy/perf-smoke.py` made 30 GET requests per path from the VPS itself to `127.0.0.1:8787`, with two client workers. The VPS exposed 422,168 KiB `MemTotal` during this test. All requests returned HTTP 200. These are short latency checks, not maximum throughput or public HTTPS measurements.

| Path | Success | p50 | p95 |
| --- | ---: | ---: | ---: |
| `/health` | 30/30 | 1.255 ms | 57.33 ms |
| `/public/events` | 30/30 | 1.605 ms | 2.77 ms |
| `/leaderboard` | 30/30 | 1.645 ms | 2.30 ms |

The `/health` p95 outlier needs a longer run before diagnosing it. This sample does not establish a sustainable request rate, p99, CPU cost, memory ceiling, or dollar cost per request.

### Isolated local load run, 2026-09-29

The current Rust binary (`cargo build --locked`) ran in Docker with a 2-CPU, 512-MiB container limit and an empty SQLite database. `oha` 1.15.0 ran in a separate container on the same Windows Docker host over a private bridge, without TLS. Each stage lasted 10 seconds; concurrency was four at 20 QPS and eight at 100 QPS. CPU is the API container's cgroup `usage_usec` delta, including its small idle and measurement overhead (idle sample: 43 ms/10 s). Memory is the container cgroup peak, not process RSS. The host and client compete for physical CPU, so use these results for regression comparison under the same setup, not as VPS capacity.

| Path | Offered QPS | HTTP 200 | Deadline aborts | Achieved req/s | p50 / p95 / p99 ms | CPU ms / 1,000 HTTP 200 | Peak MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/health` | 20 | 200 | 0 | 19.99 | 1.059 / 3.529 / 7.178 | 1,274 | 45.2 |
| `/public/events` | 20 | 200 | 0 | 19.77 | 1.807 / 2.812 / 81.321 | 4,095 | 45.7 |
| `/leaderboard` | 20 | 200 | 1 | 20.10 | 2.024 / 6.875 / 70.544 | 3,854 | 46.0 |
| `/health` | 100 | 1,000 | 1 | 100.08 | 1.094 / 1.592 / 1.777 | 796 | 46.4 |
| `/public/events` | 100 | 1,000 | 2 | 100.18 | 1.692 / 2.816 / 3.268 | 1,800 | 46.3 |
| `/leaderboard` | 100 | 1,000 | 2 | 100.18 | 1.852 / 2.836 / 3.115 | 1,895 | 46.3 |

There were no HTTP error responses. The deadline aborts occurred as the 10-second generator window ended; they are still listed rather than hidden. Both data endpoints returned empty JSON arrays (2 bytes), so this is an empty-database baseline. The 20-QPS p99 outliers and lower apparent CPU efficiency show that ten-second, shared-host samples are noisy. Repeat longer on a dedicated client with populated data before selecting a service limit or budget.

### Public HTTPS benchmark

Pending. A new bounded benchmark could not run on 2026-09-29: `ssh` to `47.129.167.4:22` and `curl --connect-timeout 5 https://api.pytorch.ph/health` both timed out from the test client; an external web check also could not reach the URL. DNS still resolved to `47.129.167.4`, and the instance owner reported that it was running at that IP. No production throughput or cost-efficiency result is inferred from the loopback or local-container tests. Repeat the procedure below once reachability is restored.

## Repeatable HTTP benchmark

Use the upstream `oha` 1.15.0 OCI image (`ghcr.io/hatoo/oha:1.15`) on a separate client. It reports success rate, throughput, and latency percentiles in JSON. Run only public, read-only endpoints. Keep each stage at 10 seconds and concurrency at four to limit load on the small production VPS. Pin the image digest for a formal comparison.

```powershell
$image = 'ghcr.io/hatoo/oha:1.15'
$base = 'https://api.pytorch.ph'
foreach ($path in @('/health', '/public/events', '/leaderboard')) {
  foreach ($rate in @(5, 20, 50)) {
    $name = ($path.TrimStart('/') -replace '/', '-') + "-$rate"
    docker run --rm $image --no-tui -z 10s -c 4 -q $rate --latency-correction --output-format json "$base$path" > "${name}.json"
  }
}
```

Before each run, capture API process CPU time (`/proc/<pid>/stat` user + system ticks divided by `getconf CLK_TCK`) and `VmRSS`/`VmHWM` from `/proc/<pid>/status`; capture them again afterward. Keep the generator off the VPS so its CPU use does not enter the API measurement. Save the bounded JSON summary, tool version, commit, timestamp, VPS bundle, client region, response bytes, and the CPU/RSS readings alongside any reported result. Stop increasing rate if errors appear or p95 rises sharply; the last ten-second stage is still only a candidate capacity, not proof of sustained capacity. A production capacity claim needs longer runs at steady rate and repeat runs.

Report each endpoint and rate with attempted/successful requests, HTTP status distribution, achieved requests/s, p50/p95/p99, total response bytes, API CPU seconds, CPU milliseconds per 1,000 successful requests, and peak API RSS. Formula: `CPU ms/1k success = 1,000,000 × API CPU seconds / successful requests`. Compare the same work mix; `/health` is not representative of database reads or authenticated writes.

## Cost model

AWS lists the Lightsail Linux 0.5 GB bundle with public IPv4 at **US$5/month**, 2 vCPUs, 20 GB storage, and 1 TB transfer. The VPS looks consistent with this size, but its actual billed bundle and extras have not been verified. Use actual billing for a real cost ratio. At a *sustained, measured* successful rate `R`, an illustrative 30-day instance-only cost per million successful requests is `monthly USD × 1,000,000 / (R × 2,592,000)`. For example, **if** this $5 bundle sustained 20 successful requests/s for the entire month, the instance component would be about **$0.096 per million**. This is a formula example, not a measured capacity or bill; storage extras, data transfer overages, domains, relay costs, backups, downtime, and workload changes are excluded.

Sources: [oha CLI and JSON output](https://github.com/hatoo/oha/blob/master/README.md), [oha JSON schema](https://github.com/hatoo/oha/blob/master/schema.json), [Lightsail bundle specifications](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html).
