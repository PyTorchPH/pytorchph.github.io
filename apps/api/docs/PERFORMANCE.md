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

### Production public HTTPS, 2026-09-29

After the tested binary was deployed (SHA-256 `96a768cf5bb7f9b0bb5beba1dd110c8debeabc6438a6e72d04217d9e41cc4f14`), `oha` 1.15.0 ran from the separate Windows Docker client against `https://api.pytorch.ph` with valid TLS, HTTP keepalive, 16 connections, 50 offered QPS, and a 10-second window per read-only endpoint. The API process on the VPS had 100 CPU ticks/second. CPU time is the process user + system tick delta across each window. Its peak `VmHWM` was 21,120 KiB (20.6 MiB); `VmRSS` after the two stages was 18.1 and 18.2 MiB. The API returned empty JSON arrays (2 bytes), so these are empty-data reads. Raw `oha` output is in `results/2026-09-29-public-events-50.json` and `results/2026-09-29-leaderboard-50.json`.

| Path | HTTP 200 | Deadline aborts | `oha` req/s | p50 / p95 / p99 ms | API CPU ms / 1,000 HTTP 200 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/public/events` | 495 | 7 | 50.19 | 103.251 / 181.351 / 430.576 | 1,131 |
| `/leaderboard` | 495 | 7 | 50.19 | 102.686 / 177.045 / 426.815 | 1,111 |

There were no HTTP error responses. `oha`'s request rate includes attempts; the seven aborted requests per endpoint reached the ten-second deadline, so completed-success throughput was about 49.5/s. The quickest responses were about 100 ms, showing that public network/TLS time dominates the earlier loopback latency. The p99 values include client/network variability. Ten seconds at 50 QPS is a bounded smoke load, not a sustainable-capacity claim. Earlier on the same date, public SSH and HTTPS both timed out temporarily while the instance remained running; access recovered before this test. That reachability incident remains a reliability finding separate from request latency.

## Repeatable HTTP benchmark

Use the upstream `oha` 1.15.0 OCI image (`ghcr.io/hatoo/oha:1.15`, tested digest `sha256:57c2247792c1466c88ecc83ddb9253aa0b58dcb852b1d7f2026a0acf7744c965`) on a separate client. It reports success rate, request rate, and latency percentiles in JSON. Run only public, read-only endpoints. Keep each stage at 10 seconds and concurrency at no more than 16 for the current VPS. Pin the image digest for a formal comparison.

```powershell
$image = 'ghcr.io/hatoo/oha:1.15'
$base = 'https://api.pytorch.ph'
foreach ($path in @('/health', '/public/events', '/leaderboard')) {
  foreach ($rate in @(5, 20, 50)) {
    $name = ($path.TrimStart('/') -replace '/', '-') + "-$rate"
    docker run --rm $image --no-tui -z 10s -c 16 -q $rate --latency-correction --output-format json "$base$path" > "${name}.json"
  }
}
```

Before each run, capture API process CPU time (`/proc/<pid>/stat` user + system ticks divided by `getconf CLK_TCK`) and `VmRSS`/`VmHWM` from `/proc/<pid>/status`; capture them again afterward. Keep the generator off the VPS so its CPU use does not enter the API measurement. Save the bounded JSON summary, tool version, commit, timestamp, VPS bundle, client region, response bytes, and the CPU/RSS readings alongside any reported result. Stop increasing rate if errors appear or p95 rises sharply; the last ten-second stage is still only a candidate capacity, not proof of sustained capacity. A production capacity claim needs longer runs at steady rate and repeat runs.

Report each endpoint and rate with attempted/successful requests, HTTP status distribution, achieved requests/s, p50/p95/p99, total response bytes, API CPU seconds, CPU milliseconds per 1,000 successful requests, and peak API RSS. Formula: `CPU ms/1k success = 1,000,000 × API CPU seconds / successful requests`. Compare the same work mix; `/health` is not representative of database reads or authenticated writes.

## Cost model

AWS lists the Lightsail Linux 0.5 GB bundle with public IPv4 at **US$5/month**, 2 vCPUs, 20 GB storage, and 1 TB transfer. The VPS looks consistent with this size, but its actual billed bundle and extras have not been verified. Use actual billing for a real cost ratio. At a *sustained, measured* successful rate `R`, an illustrative 30-day instance-only cost per million successful requests is `monthly USD × 1,000,000 / (R × 2,592,000)`. For example, **if** this $5 bundle sustained 50 successful requests/s for the entire month, the instance component would be about **$0.039 per million**. The observed ten-second run does not establish that sustained rate. Storage extras, data transfer overages, domains, relay costs, backups, downtime, and workload changes are excluded.

Sources: [oha CLI and JSON output](https://github.com/hatoo/oha/blob/master/README.md), [oha JSON schema](https://github.com/hatoo/oha/blob/master/schema.json), [Lightsail bundle specifications](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html).
