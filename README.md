# Ledger Load & Performance Tests

Performance validation for the Distributed Ledger Platform. Two complementary
suites:

1. **Kafka command-stream load** (`kafka` — the primary write-path test). Drives
   the ledger by producing transaction *commands* to the Kafka command topic with
   the Kafka Java client, exactly how a real upstream producer feeds the system.
   This exercises the new ingestion path (see
   `../docs/kafka-command-ingestion.md`).
2. **k6 HTTP suite** (`k6/`). Exercises the synchronous HTTP API — reads
   (balances, listing), idempotency, batch, and the HTTP write path — for
   comparison and read-side coverage.

All scenarios are trimmed to **≤ 2 minutes** for routine runs.

## Kafka command-stream load

The generator lives in the main project (`src/loadtest`, run via Gradle) so it
can reuse the app's command contract and the Kafka client already on the
classpath. It seeds accounts over HTTP, produces `PostTransaction` commands at a
target rate, consumes the **results topic** to tally every command's outcome
(CREATED / REPLAYED / FAILED) and end-to-end latency, and exits non-zero if the
run misses its SLA (success rate, zero DLQ, results fully drained).

```bash
# From the repo root, with the stack up and the app running with
# COMMAND_INGEST_ENABLED=true (see below):
RATE=200 DURATION_SECONDS=120 ACCOUNTS=500 ./gradlew kafkaLoadTest
```

Bring up the dependencies and app first, either way:

```bash
# Option A — full stack in Docker (app already has command ingestion enabled)
docker compose -f docker/docker-compose.yml up -d --build

# Option B — infra in Docker, app on the host
docker compose -f docker-compose-test.yml up -d
COMMAND_INGEST_ENABLED=true KAFKA_BOOTSTRAP=localhost:19092 ./gradlew bootRun
```

The load generator runs from the host in both cases (it talks to the API on
`localhost:8080` and Kafka on `localhost:19092`).

### Configuration (environment variables)

| Var | Default | Purpose |
|-----|---------|---------|
| `BASE_URL` | `http://localhost:8080` | API base URL (account seeding) |
| `KAFKA_BOOTSTRAP` | `localhost:19092` | Kafka bootstrap servers |
| `TENANT` | random `kafka-load-…` | `X-Tenant-Id` for accounts + commands |
| `RATE` | `200` | Commands produced per second |
| `DURATION_SECONDS` | `120` | How long to produce |
| `DRAIN_SECONDS` | `30` | How long to wait for results after producing |
| `ACCOUNTS` | `500` | Seeded account pool size |
| `PARTITION_BUCKETS` | `64` | Partition-key spread (`{tenant}:{bucket}`) |
| `MIN_SUCCESS_RATE` | `0.99` | SLA: (CREATED+REPLAYED)/produced |

## k6 HTTP suite

```bash
export BASE_URL=http://localhost:8080
export TENANT=t1
k6 run k6/smoke.js
```

See [`k6/README.md`](k6/README.md) for the full scenario list. Durations have
been trimmed to ≤ 2 minutes; raise them in each script's `options` for longer
soak/stress runs.
